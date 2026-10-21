# OpenCode Mobile Remote — Plan (v1, as-built)

Control OpenCode sessions on Yassine's Windows PC from an Android phone, from anywhere — like Claude Code's Remote Control. The app talks **directly** to OpenCode's HTTP API over the `opencode pair --remote` tunnel. No custom bridge, no PWA. The default path is the tunnel; a full LAN pairing link is also supported when the server is deliberately bound to the LAN.

**Status:** v1 vertical slice implemented, typechecked, and pushed (`6db1d78`). Local session alerts are implemented; reliable background delivery (ntfy, M6') remains backlog.
**Repo:** https://github.com/yassine808/opencode-remote-control

---

## What v1 does

| Flow | Implementation |
|---|---|
| Pair | Scan QR (or paste link) from `opencode pair --remote --yes`; a LAN link from `opencode pair --url http://<pc-ip>:<port>` also works; server URL + token stored in SecureStore |
| Stay paired | Token lives ~30 days; app renews it silently when < 5 days remain (on launch + app foreground) — no PC screen needed |
| Sessions | List of all sessions with running/idle status, pending-approval badges; auto-refresh from SSE + 15 s poll |
| Transcript | Live: streaming text + reasoning deltas, tool call cards (status/input/output, expandable), token/cost updates |
| Send | Composer with multiline input; `delivery: "steer"` (default); stop button while running |
| Approvals | Cards for pending permission requests with Allow once / Always / Reject — the safety boundary for remote use |
| Resilience | Refetch on SSE reconnect, screen focus, and after tool/lifecycle events; connection state banner |

**Not in v1 (backlog):** sync engine with seq-gap detection, diff viewer, agent forms (questions), revert/compact, model/agent switching, image attachments, background push notifications, multiple PCs/servers, iOS, LAN auto-discovery (full LAN links already work), offline cache.

---

## As-built architecture

```
Android (Expo SDK 58 app, mobile/)
  ├─ src/lib/api.ts         typed client (fetch, Basic auth, describeError, token expiry parse)
  ├─ src/lib/events.ts      SSE client for GET /api/event (expo/fetch streaming)
  ├─ src/lib/connection.tsx ConnectionProvider: pair/unpair, silent renewal, AppState hooks
  ├─ src/lib/storage.ts     SecureStore persistence (baseUrl + token)
  ├─ src/app/setup.tsx      QR scan (expo-camera) / paste-link pairing
  ├─ src/app/index.tsx      sessions list
  └─ src/app/session/[id].tsx  transcript + composer + approvals + stop
        │
        │ HTTPS (OpenTunnel https://<random-domain>) or HTTP (LAN)
        ▼
Windows PC ── OpenCode background service (dynamic loopback port; `opencode service status`)
              ▲ PowerShell TUI(s) attach here — every session is visible
```

Repo layout: single Expo app at `mobile/` plus `plugins/rc-dot/` (PC-side TUI indicator — see below). No monorepo — deliberate deviation; a workspace would have been pure overhead for a v1 vertical slice.

### PC-side indicator (plugins/rc-dot)

CLI plugin for the PC: the TUI footer shows green `● RC active` when a local browser/editor or external tunnel client has a live connection to the background server, red `● RC disabled` otherwise — a glance check while sitting at the PC. OpenCode v2 runs its built-in tunnel inside the server process, so a phone connected through that tunnel is not a separate allow-listed client. Install: copy the folder to `~/.config/opencode/plugins/rc-dot/` and restart OpenCode (details in `plugins/rc-dot/README.md`).

### Decisions (as-built)

- **DD1 · Direct to OpenCode API.** No bridge process. Everything the app needs is already exposed.
- **DD2 · Remote-first.** Pair via the tunnel URL (or an explicit LAN link); store only the session token, never the password.
- **DD3 · Silent renewal.** `POST /api/pair` (authenticated) → one-time code → `GET /auth/connect/:code` with `Accept: application/json` → fresh token. **Proven live in M0.**
- **DD4 · Stream deltas + refetch on signal (v1 simplification).** SSE carries text/reasoning deltas applied in memory; tool/lifecycle events trigger a 500 ms debounced transcript refetch. No seq tracking yet; `durable.seq` is logged in `__DEV__` from day one to inform a future sync engine.
- **DD5 · Direct HTTP client** over `expo/fetch`, typed from the `/doc` OpenAPI spec — not `@opencode/client` (avoids Metro/RN bundling risk).

---

## M0 — validated against live server (done)

All checks run against OpenCode **2.0.28** on this machine (plan originally researched from v2.0.32 source). Test method: create scratch sessions with an explicit model, prompt, capture SSE, delete — never touch real sessions.

Confirmed live:
- Pairing code → token exchange works; token authenticates as Basic password.
- `POST /api/pair` with a paired token mints a fresh code that redeems to a new token (**silent renewal works — DD3 valid**).
- Prompt send (`delivery: "steer"` default), message list (`order=asc|desc`, cursor), session create (explicit model), interrupt, session delete — all work as documented.
- Permission flow **exercised live end-to-end**: with permissions set to `ask`, a bash call blocked (`status:"running"`, `executed:false`) → pending request listed → `POST …/permission/{requestID}/reply {decision:"once"}` → tool completed, output verified in transcript.
- Permission requests are **location-scoped**: `GET /api/permission/request` answers for the server's own directory unless you pass `?location[directory]=<dir>`; sessions in project dirs need per-directory calls. `GET /api/session/{id}/permission` is the location-free per-session variant (used by the session screen). Request shape: `{id, sessionID, action:"shell", resources:[cmd], save:[always-pattern], source:{type, messageID, id}}`.
- Reply body is `{decision: "once"|"always"|"reject"}` (plus optional `message`); the reply response has an empty body.
- SSE event vocabulary captured: streaming deltas (`session.text.delta`, `session.reasoning.delta`, `session.usage.updated`), durable lifecycle (`inbox.enqueued/delivered`, `execution.started/succeeded/failed`, `step.started/streamed/ended`, `renamed`, `instructions.updated`), tool events (`tool.input.started/ended`, `tool.called`, `tool.progress`, `tool.success`). Envelope: `{id, created, type, location?, data, durable:{aggregateID, seq, version}}`.
- Token format: `<unix-expiry>.<signature>` — expiry parsed locally, no round-trip needed.

Dev notes discovered in M0:
- Machine's default model is an OpenRouter model without credits — scratch sessions need `{"model":{"providerID":"opencode","id":"deepseek-v4.1-flash-free","variant":"max"}}` with session create.
- The SSE stream is **volatile by contract** — events during a disconnect are lost; always refetch after reconnect (implemented).
- Windows curl quirk: JSON bodies need `--data-binary @file` (inline `-d` quoting mangles).

---

## Next steps (in order)

1. **Device test** (needs Yassine): `cd mobile && npx expo start` → Expo Go on the phone → on PC run `opencode pair --remote --yes` (**consent needed — this exposes the service to the internet**) → scan QR → verify: sessions list, live stream of a real prompt, send a message, stop, approval card.
2. **M6' · ntfy notifications:** subscribe from the phone to an ntfy topic; a tiny PC script (or OpenCode plugin hook) publishes on `permission.asked` / `execution.finished`. Tapping opens the app. (Expo Push needs a dev build + sidecar — deferred.)
3. **Backlog pull-in as needed:** image attachments (shape known: `PromptInput.FileAttachment {uri, name?, description?}`; whether `uri` accepts data URLs unvalidated), diff viewer, agent forms, model/agent switching.

---

## Security posture (unchanged, read before exposing)

A remote prompt runs code on the PC as Yassine's Windows user. Approvals are the entire safety boundary.

- **Permissions are set to `ask`** (`opencode.json`: `bash`/`edit`; `cli.json`: `session.permissions: "prompt"`), verified live. Observed behavior: a session keeps the permission set from when it started — older sessions stay auto-allowed; start a fresh session to exercise approvals.
- **Long random server password** before enabling remote access; changing it signs out every device (there is no per-device revoke — that's the lost-phone procedure).
- Run OpenCode as a normal user, not administrator.
- Keep the PC awake when away: `powercfg /change standby-timeout-ac 0` (or Never in Settings).
- Turn remote off when unused: `opencode service set remote false`.

Known limitations: no per-device revoke; no app lock yet (planned); approving `always` from a phone deserves a confirmation step (planned).
