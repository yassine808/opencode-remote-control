# OpenCode Mobile Remote — Plan v3

**Tailored for:** Windows PC · OpenCode V2 launched as plain `opencode` from PowerShell · remote access from anywhere (like Claude remote control) · Expo / React Native app, Android first.

Control every OpenCode session on my PC from my phone: sessions appear automatically, stream live, accept prompts, interrupt, and ask me to approve permissions, from home or from mobile data.

**Legend:** `[ ]` todo · `[x]` done · **(S/M/L)** ≈ half a day / 1–2 days / 3+ days

---

## 0. Done so far
- [x] Decide app stack: Expo (React Native), Android first
- [x] Research OpenCode V2 (v2.0.32 source): shared background service, pairing, remote tunnel, API, auth, events
- [x] Collect setup facts: Windows, V2, plain `opencode` in PowerShell, remote access required
- [x] Drop the custom PC bridge (OpenCode V2 already provides what it was for)

> Everything about V2 below was read from source and docs. **None of it has been run yet.** Milestone 0 confirms it on the real PC before any app code is written.

---

## 1. Your setup and what it means

| Your setup | What it means for the plan |
|---|---|
| Windows PC | Service default port is **45278** (macOS/Linux use 49374). `opencode service status` prints the URL. Session paths look like `C:\Users\…`, so the app must display and group Windows paths properly. Console QR codes can render badly in old PowerShell, so the app also accepts a pasted link. |
| OpenCode V2, plain `opencode` | The TUI attaches to the **shared background service** by default, so every session you open is visible to the app. Only TUIs started with `--standalone` or `--server <url>` are invisible. |
| Remote access needed | The main transport is `opencode pair --remote` (OpenTunnel, HTTPS, outbound-only). No router, port-forwarding or Windows Firewall changes. LAN-only mode is dropped from v1, which also removes Android's cleartext-HTTP problem. |
| Internet-exposed PC | Security weight goes up: long server password, permissions set to `ask`, app lock, clear lost-phone procedure (section 5 and Appendix B). |
| Works while I'm away | Pairing tokens last 30 days and re-pairing needs the PC's screen, so the app must **renew its token silently** before it expires. The PC must stay awake and online (power settings, Appendix B). |
| Expo / Android | On Windows, use Expo Go for fast dev and **EAS cloud builds** for the dev build and APK, so Android Studio is not required. |

---

## 2. Goals, non-goals, success criteria

**Goals**
- [ ] Open OpenCode in PowerShell, and within seconds the session shows on the phone with live status
- [ ] Read the transcript live (streaming text, tool calls, diffs)
- [ ] Send prompts (steer or queue), interrupt, run slash commands, switch model/agent, revert
- [ ] Approve or reject permission requests and answer agent questions (forms) from the phone
- [ ] Works from mobile data, stays signed in for months without re-pairing
- [ ] Safe by default: remote access is opt-in and easy to switch off

**Non-goals (v1):** running the agent on the phone, editing files by hand, iOS release (code stays portable), multi-user sharing, our own cloud relay, LAN-only `http` mode.

---

## 3. Verified facts (read from OpenCode v2.0.32 source, not yet run)

**Service and auth**
- Background service on `127.0.0.1`, default port 45278 on Windows. Managed with `opencode service start|stop|restart|status|get|set|unset`. Changing a setting stops the service until `opencode service start`.
- `GET /api/info` → `{version, pid, urls, paths, capabilities}`.
- HTTP Basic: username `opencode`, password = server password **or a pairing session token**. Tokens are HMAC-signed, last 30 days, and **changing the server password invalidates all of them at once**. There is no per-device revoke.
- `opencode pair` prints one-time links `/auth/connect/<code>` (valid 5 min, single use) and a QR with JSON `{code, urls}`. `GET /auth/connect/:code` with `Accept: application/json` returns `{token}`. `POST /api/pair` (authenticated) mints a new code, so an already-paired app should be able to renew its own token.
- `opencode pair --remote` enables OpenTunnel remote access: asks consent the first time, can take about a minute to set up, gives an HTTPS URL on a persistent random subdomain (changes if remote access is turned off and on). The service's own text says traffic is end-to-end encrypted and access needs the server password. Turn off with `opencode service set remote false`.

**API (all under `/api`)**
- Sessions: `GET /session` (query: `limit` default 50, `order`, `search`, `parentID` (`null` = roots only), `directory`, `project`, `subpath`, `cursor`), `GET /session/active`, `GET/PATCH/DELETE /session/:id`, `POST /session` (create), `POST /session/:id/fork`
- Transcript: `GET /session/:id/message` (cursor, type filter), `GET /session/:id/message/:messageID`, `GET /session/:id/diff`, `GET /session/:id/context`
- Control: `POST /session/:id/prompt` body `{text, files?, agents?, skills?, delivery?: "steer"|"queue", resume?, metadata?, id?}`; `POST /session/:id/interrupt` → `{interrupted}` (interrupt reasons seen in events: user, shutdown, superseded, inactivity); `/command`, `/shell`, `/compact`, `/agent`, `/model`, `/revert/stage|commit` and `DELETE /revert`
- Permissions: `GET /permission/request` (pending, per location via `location[directory]`), `GET /session/:id/permission`, `POST /session/:id/permission/:requestID/reply` body `{decision: "once"|"always"|"reject"}`, `GET /permission/saved`
- Forms (agent questions): `GET/POST /session/:id/form`, `POST …/form/:formID/reply`, `DELETE …/form/:formID`
- OpenAPI at `/doc`. Durable log (experimental): `GET /experimental/session/:id/log?after=<seq>&follow=true`.

**Live events (`GET /api/event`, SSE)**
- Envelope: `{id: "evt_…", type, created, data, location?, metadata?, durable?: {aggregateID, seq, version}}`. First event is `server.connected`.
- **Durable** events (session lifecycle, inbox, execution) carry `durable.seq`, a per-session counter. **Ephemeral** events (`permission.asked|replied`, `form.created|replied|cancelled`, `session.status`, `session.usage.updated`) have no seq.
- Seen in source: `session.created|renamed|deleted|forked|moved`, `session.agent.selected`, `session.model.selected`, `session.metadata.updated`, `session.permissions`, `session.viewed`, `session.usage.recorded`, `session.inbox.enqueued|delivered|cancelled|delivery.changed`, `session.execution.started|succeeded|failed|interrupted`, `session.status` (`idle` | `busy` | `retry{attempt,message,next}`). Events that stream assistant text and tool progress also exist; their exact names are captured in M0.
- The stream is **volatile by contract**: a slow consumer overflows and the stream fails, and events during a disconnect are lost.

**Data shapes**
- Session: `id, parentID?, projectID, agent?, model?, cost, tokens, outcome? (succeeded|failed|interrupted), time{created,updated,idle?,viewed?,archived?}, title?, location{directory}, subpath?, permissions?, revert?`
- Message types: `user, synthetic, system, skill, shell, assistant, compaction (running|completed|failed), idle (outcome), agent-switched, model-switched, location-switched`. Assistant content parts: `text`, `reasoning`, `tool` (state: streaming → running → completed | error).
- Permission request: `{id, sessionID, action, resources[], save?, metadata?, source?, message?}`. Reply `once` = this request, `always` = matching patterns, `reject`.

**Permissions default (important for remote use):** the OpenCode docs say most permissions default to `allow`, and only `external_directory` and `doom_loop` default to `ask`. Unless you configure `ask`, shell commands and edits run without any approval, so the phone would never be asked. Confirm V2's default in M0 and set `ask` explicitly (Appendix B).

**Expo**
- Remote push notifications are **not** available in Expo Go on Android (since SDK 53); local notifications are. Remote push needs a development build (EAS cloud build works from Windows). Android 13+ needs a notification channel before a push token is requested.
- `expo/fetch` streams response bodies (ReadableStream, `TextDecoderStream`), which is the basis for SSE. Abort behavior is undocumented, so it is tested in M0.
- Other OpenCode mobile clients exist (Android and iOS apps, OpenChamber, community repos); most connect by typing a server URL. Their V2 support is unknown.

---

## 4. Architecture

```
 Android phone (Expo app)
   ├─ Pair by QR/link → token in secure storage → silent renewal
   ├─ REST client + SSE (/api/event) + sync engine (snapshot, seq gap detection)
   └─ read-only cache for offline

        HTTPS (OpenTunnel  https://<random>.<host>)
                       │
 Windows PC ───────────▼───────────────────────────────
   OpenCode V2 background service  (port 45278 on localhost)
      ▲ PowerShell TUI(s) attach here too
   [optional] notifier sidecar → push notification (M8)
```

Repo layout:
```
opencode-mobile/
  apps/mobile        Expo app (TypeScript, expo-router)
  apps/notifier      optional PC sidecar (M8)
  packages/api       typed client, SSE parser, event reducers, sync engine (pure TS, unit-tested)
  docs/              PROTOCOL-NOTES.md, SECURITY.md, ADRs
  PLAN.md
```

---

## 5. Key design decisions

- [ ] **DD1: Talk to OpenCode's server directly.** No custom bridge, no second server to secure.
- [ ] **DD2: Remote-first.** Pair from the QR `{code, urls}`, prefer the HTTPS tunnel URL, store only the session token (never the password).
- [ ] **DD3: Silent token renewal.** When fewer than 7 days remain, call `POST /api/pair` with the current token, redeem the new code, replace the token. Also renew on every app open. Warn loudly if renewal fails and expiry is near, because re-pairing needs the PC's screen. (Confirm a paired token may call `/api/pair` in M0.)
- [ ] **DD4: Snapshot + stream + gap detection.** Rebuild from REST on start, foreground, reconnect, and stream error. For durable events, track `durable.seq` per session; a jump means missed events, so refetch that session (or read the durable log after the last seq). Ephemeral state (pending permissions, forms, status) is always re-fetched from REST after a reconnect.
- [ ] **DD5: Prompt delivery.** Default to `queue` while a session is busy, offer `steer` explicitly ("interrupt with guidance"). Verify semantics in M0.
- [ ] **DD6: Client library.** Use `@opencode/client` if it bundles in Metro and streams in React Native, otherwise a small typed client over `fetch` built from `/doc`. Show a compatibility banner from `/api/info.version`.
- [ ] **DD7: Stack.** expo-router, TanStack Query (REST cache), Zustand (live state), FlashList, expo-secure-store, expo-camera (QR), expo-local-authentication (app lock), react-native-markdown-display plus a code highlighter.
- [ ] **DD8: Safety posture.** A remote prompt runs code on the PC as my Windows user, so approvals are the safety boundary: permissions set to `ask`, clear approval UI, biometric gate for `always`, app lock.
- [ ] **DD9: Notifications.** Decide in M8. Default recommendation: notifier sidecar plus Expo Push, with the phone's push token registered once while at the PC. Fallbacks: ntfy, or in-app alerts only.

---

## 6. Milestones

### M0 — Validate on the real Windows PC (M) — before any app code
Use the PowerShell runbook in **Appendix A**. Save results in `docs/PROTOCOL-NOTES.md` (redact project names and prompt text before sharing).
- [ ] `opencode --version` is 2.x; note the exact version
- [ ] `opencode service status` prints a URL; note the port (expect 45278)
- [ ] Open TUIs in two different projects; confirm **both appear** in `GET /api/session` and that `/api/session/active` reflects the one that is running
- [ ] `opencode pair` → redeem the link as JSON → token works as the Basic password; a second redeem fails (single use); `/api/info` without a token returns 401
- [ ] **Token renewal:** with the token, `POST /api/pair` works and the new code redeems to a new token
- [ ] Capture 60 s of `/api/event` during a real prompt; record the real names and payloads of text-streaming, tool, status and permission events; confirm `durable.seq` behaves as read in source
- [ ] Trigger a permission prompt in the TUI; `permission.asked` arrives; replying through the API resolves it **and the TUI updates**
- [ ] Send a prompt through the API in both `queue` and `steer` modes; record the behavior while busy and idle
- [ ] Confirm the **default permission behavior** for `bash` and `edit` in V2 and find the right config syntax to set `ask`
- [ ] `opencode pair --remote`; open the link on the phone with Wi-Fi off (web UI loads and signs in); note setup time and any firewall/antivirus prompt
- [ ] Hold `/api/event` open **through the tunnel for 10 minutes**; note idle timeouts, drops, and latency from mobile data
- [ ] Reboot test: does the service (and remote access) come back after reboot, sleep/wake, and closing PowerShell?
- [ ] Check that TUIs started with `--standalone` or `--server` are invisible (document in README)
- [ ] Spike in Expo Go: read `/api/event` via `expo/fetch` against the tunnel URL; check chunk framing, cancel/abort, and behavior when the app is backgrounded
- [ ] Check Metro bundling of `@opencode/client` and decide DD6
- [ ] Check whether OpenCode V2 plugins could run the notifier inside OpenCode instead of a sidecar (input to M8)
- [ ] 2-hour look at one existing OpenCode mobile client against V2; write down what it lacks (this defines our edge)
- **Exit criteria:** every "to confirm" above is resolved or turned into a risk; DD1, DD3 and DD6 confirmed or revised.

### M1 — Windows dev environment and foundations (S–M)
- [ ] Install current Node LTS; enable pnpm with `corepack enable`; allow scripts in PowerShell with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- [ ] Keep the repo at a short path such as `C:\dev\opencode-mobile` (avoids Windows path-length problems); enable Git long paths
- [ ] `npx create-expo-app@latest` (expo-router template), pnpm workspace with `apps/mobile` and `packages/api`
- [ ] Expo Go on the phone; if Metro is unreachable, allow Node through Windows Firewall (private network) or use `npx expo start --tunnel`
- [ ] TypeScript strict, ESLint, Prettier, Jest + React Native Testing Library
- [ ] `packages/api`: client wrapper, response validation at the boundary, typed errors (`Unauthorized`, `Unreachable`, `VersionMismatch`, `TokenExpiring`)
- [ ] EAS account and project; first **development build** via EAS cloud (no Android Studio needed)
- [ ] GitHub Actions: lint, typecheck, tests
- [ ] `AGENTS.md` with conventions so later agent sessions stay consistent

### M2 — Remote pairing and connection (M)
- [ ] First-run screen: "run `opencode pair --remote` on your PC" with copyable command
- [ ] QR scan (`{code, urls}`) plus pasted-link fallback; clear message when the code expired (5 min) or was already used
- [ ] Redeem as JSON, store token in secure storage, support several saved servers
- [ ] Silent token renewal (DD3), including a foreground check on every launch and a periodic background task if Expo allows
- [ ] Connection health screen: server version, URL, latency, token expiry date
- [ ] `401` handling: "password changed or token expired, run `opencode pair --remote` again"
- [ ] Unreachable handling: distinguish "PC asleep/offline" from "tunnel down" from "wrong server" as best as possible
- **Acceptance:** pair on Wi-Fi, switch Wi-Fi off, force-close and reopen the app: still connected. Simulated near-expiry token renews itself.

### M3 — Session list with live status (M)
- [ ] Paginated `GET /session` (cursor), grouped by project directory, newest activity first, search
- [ ] Windows path display: show last two segments, full path on long-press; handle `\` and drive letters
- [ ] Live badges from `/session/active`, `session.status` (idle, busy, retry) and `session.execution.*`; last outcome (succeeded, failed, interrupted)
- [ ] Waiting-for-approval badge from pending permissions
- [ ] New and renamed sessions appear without refresh; pull to refresh; empty, error and offline states
- **Acceptance:** start `opencode` in a new PowerShell window; the session shows up on the phone within a few seconds.

### M4 — Session view and sync engine (L)
- [ ] Message pagination with a stable scroll position; renderers for every message type in section 3
- [ ] Markdown and code blocks with copy; collapsible tool cards (streaming, running, completed, error); long outputs truncated with "show more"
- [ ] Diff viewer from `/diff`
- [ ] Live streaming from `/api/event`, filtered per session, applied by a pure reducer
- [ ] **Sync engine (DD4):** snapshot on open, seq-gap detection per session, resync on reconnect/foreground/stream error, dedupe by IDs; unit tests built from the captured M0 payloads, including gaps and duplicates
- **Acceptance:** watch a long run on the phone, toggle airplane mode mid-run; after reconnect the transcript matches the TUI exactly.

### M5 — Control (M)
- [ ] Composer: send prompt with `queue` default and explicit `steer`; queued/pending state; draft persistence
- [ ] Interrupt button; clear feedback when nothing was running
- [ ] Slash commands (`/command` list), model and agent switching, compact, fork, new session in a chosen project
- [ ] Revert flow: stage, preview, commit or clear
- [ ] Shell box, labeled "runs on your PC"
- [ ] Image attachments only if the prompt API supports them well
- **Acceptance:** prompt from the phone appears in the PowerShell TUI; interrupting from the phone stops it.

### M6 — Approvals and agent questions (M)
- [ ] On `permission.asked`: bottom sheet with action, resources (paths or commands), metadata, source tool call, session and project
- [ ] `once` and `reject` in one tap; `always` needs confirmation plus biometrics and shows the pattern it saves
- [ ] Races: answered in the TUI first (`permission.replied`) → sheet closes quietly
- [ ] Pending list per project from `/permission/request`, so nothing is lost after reconnecting
- [ ] Forms: render `form.created`, submit or cancel
- [ ] Saved permissions screen with remove
- **Acceptance:** an agent needs shell approval; approve from the phone; the TUI continues. Approve in the TUI while the sheet is open: no error.

### M7 — Reliability on real networks (M)
- [ ] SSE client: exponential backoff with jitter, idle detection, AppState-aware pause/resume with resync
- [ ] Mobile network handoffs (Wi-Fi ↔ 4G/5G) without losing the view
- [ ] PC sleep/wake and service restart: app shows a clear state and recovers automatically
- [ ] Offline cache of the session list and recent transcripts, read-only
- [ ] Chaos checks: kill the service mid-stream, rotate the password, drop the tunnel
- [ ] Budget: 1,000+ message transcript scrolls smoothly; memory steady over a 30-minute stream
- **Acceptance:** 30-minute soak test from mobile data with forced disconnects: no missing or duplicated messages.

### M8 — Notifications (M–L) — decision gate
- [ ] Spike and record the decision (ADR): (a) sidecar + Expo Push, (b) sidecar + ntfy, (c) OpenCode plugin instead of a sidecar, (d) in-app only
- [ ] Always: in-app alerts for permission requests and finished runs while the app is open
- [ ] If sidecar: `apps/notifier` (Node) subscribes to `/api/event`, sends push on `permission.asked` and `session.execution.succeeded|failed`; runs at Windows logon via Task Scheduler; config file for device tokens
- [ ] If Expo Push: use the EAS dev build, create the notification channel before requesting the token (Android 13+), and register the token **once while at the PC** (copy/paste or sidecar QR), so no remote registration endpoint is needed
- [ ] Settings: per-event toggles, quiet hours, per-project mute; tapping a notification opens the right session or approval sheet
- **Acceptance:** app fully closed, from mobile data, an agent asks for approval: a notification arrives within about 10 seconds and opens the approval sheet.

### M9 — Security hardening for internet access (M)
- [ ] `docs/SECURITY.md`: threats (stolen phone, leaked pairing link, guessed tunnel URL, weak password, prompt injection leading to dangerous approvals)
- [ ] App lock (biometric/device credential) on launch and after inactivity; optional screen-capture protection
- [ ] Token only in Keystore-backed secure storage; secrets redacted from logs and crash reports
- [ ] Lost-phone procedure written down and tested: `opencode service set password …` then `opencode service start` signs out every device
- [ ] In-app reminders: remote access is on, weak or default password detected (cannot detect, so show a checklist instead)
- [ ] Optional sidecar audit log of remote approvals
- [ ] Dependency audit in CI
- **Acceptance:** following SECURITY.md, revoking a lost phone takes under 2 minutes.

### M10 — UX polish (M)
- [ ] Visual identity pass with the `frontend-design` skill (dark first, not template defaults)
- [ ] Haptics on approvals, swipe actions, tablet/landscape, keyboard and edge-to-edge handling
- [ ] Accessibility (TalkBack labels, font scaling, contrast), strings externalized and layout RTL-ready
- [ ] Onboarding and error copy that tells you what to run in PowerShell

### M11 — Release (S–M)
- [ ] EAS Build preview APK, signing credentials, versioning, release notes
- [ ] EAS Update for JavaScript-only fixes; opt-in crash reporting
- [ ] README: 3-step quick start, Windows notes, troubleshooting (tunnel, sleep, version mismatch), security warning
- [ ] Optional Play Store internal testing track

### M12 — Optional extras
- [ ] LAN mode for faster access at home (`opencode service set hostname 0.0.0.0`, Windows Firewall rule, Android cleartext policy)
- [ ] Plan B transport if OpenTunnel proves unreliable from your network: Tailscale (Serve for HTTPS) or Cloudflare Tunnel in front of the local service
- [ ] iOS build from the same codebase
- [ ] Support for several PCs in one app

---

## 7. Testing strategy
- **Unit:** event reducers, sync engine and gap detection, SSE parser, QR/link parsing, URL selection, token renewal timing. Written from the real payloads captured in M0.
- **Contract:** run the typed client against a real OpenCode V2 server in CI (simulation mode if M0 confirms it) so API drift fails loudly; pin a supported version range.
- **Component:** React Native Testing Library with a mock server.
- **E2E:** Maestro on an Android emulator against a local or simulated server.
- **Manual release checklist (your real setup):** Windows PC + phone on mobile data, notifications with the app closed, token renewal, PC sleep/wake.
- **Soak/chaos:** scripted disconnects and service restarts (M7).

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| V2 behaves differently from what I read | Rework | M0 validates before app code |
| Permissions default to `allow` | Phone never asked; agent runs unattended | Set `ask` explicitly; confirm in M0 |
| PC sleeps or goes offline | App unreachable | Power settings (Appendix B); clear "PC offline" state |
| Token expires while away (30 days) | Locked out, re-pair needs the PC | Silent renewal (DD3), warnings, renewal on every launch |
| Remote access exposes the PC to the internet | High impact if password is weak | Long random password, `ask` permissions, app lock, off switch, SECURITY.md |
| No per-device revoke | Lost phone = sign out everything | Documented, rehearsed procedure |
| SSE drops events; tunnel idle timeouts | Wrong transcript | Seq-gap detection + REST resync; measure in M0 |
| OpenTunnel unreliable from my network | Remote unusable | Plan B transports in M12; measure in M0 |
| Remote push not in Expo Go; needs dev build and FCM | Slower notification work | EAS cloud dev build; decision gate in M8; ntfy or in-app fallback |
| TUIs started with `--standalone`/`--server` are invisible | Missing sessions | Document; show a hint when the list looks empty |
| OpenCode V2 changes fast (near-daily releases) | Breakage | Version range, compatibility banner, contract tests |
| Existing mobile clients overlap | Wasted effort | M0 comparison; focus on auto-discovery, approvals UX, notifications |

## 9. Acceptance script (definition of done, remote edition)
1. On the PC (PowerShell): `opencode service status` shows the service; open `opencode` in two projects.
2. `opencode pair --remote`; scan the QR with the app. Both sessions appear within seconds.
3. Turn Wi-Fi off. Open a session; watch a running prompt stream; toggle airplane mode and back; the transcript is still correct.
4. Send a prompt from the phone; it appears in the TUI and runs.
5. Trigger a permission request; approve from the phone; the TUI continues.
6. Close the app completely; trigger another request; a notification arrives; tapping it opens the approval sheet.
7. Rotate the server password; the app asks to re-pair; re-pairing works.
8. Leave the phone unused past the renewal window in a simulated-expiry test; the token renews on open without touching the PC.

## 10. Open questions (still need your answer)
- [ ] Is a notification while the app is fully closed a must-have for v1, or is "alert when I open the app" enough to start?
- [ ] Android phone confirmed, and which Android version?
- [ ] Do you want LAN mode later (M12), or is remote-only fine permanently?
- [ ] Are you comfortable setting OpenCode permissions to `ask` for shell commands and edits (needed for approvals to exist)?
- [ ] App name?

---

## Appendix A — M0 PowerShell runbook (run on the PC)

Use Windows Terminal if you can. The outputs contain project paths and prompt text, so redact before sharing.

```powershell
# A1. Basics
opencode --version
opencode service status          # prints the service URL; expect port 45278 on Windows

# A2. Show the QR/links correctly (Windows PowerShell 5.1)
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# A3. Pair locally, then redeem the link as JSON
opencode pair                    # copy the first http://127.0.0.1:…/auth/connect/… link
$base  = "http://127.0.0.1:45278"        # use the URL printed in A1
$link  = "<paste the link here>"
$res   = Invoke-RestMethod -Uri $link -Headers @{ Accept = "application/json" }
$token = $res.token
$auth  = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$token")) }
# Run the Invoke-RestMethod line again with the same $link: it should fail (single use).
# Invoke-RestMethod "$base/api/info" with no -Headers should return 401.

# A4. Read-only checks (open TUIs in two different projects first)
Invoke-RestMethod "$base/api/info" -Headers $auth | ConvertTo-Json -Depth 6
Invoke-RestMethod "$base/api/session?limit=10" -Headers $auth | ConvertTo-Json -Depth 8
Invoke-RestMethod "$base/api/session/active" -Headers $auth | ConvertTo-Json -Depth 6
Invoke-RestMethod "$base/api/permission/request" -Headers $auth | ConvertTo-Json -Depth 8

# A5. Capture the live event stream for 60 s; run a harmless prompt in a TUI meanwhile
curl.exe -N -s -m 60 -H ("Authorization: " + $auth.Authorization) "$base/api/event" | Tee-Object -FilePath .\m0-events.txt

# A6. Token renewal check
$code = Invoke-RestMethod -Method Post -Uri "$base/api/pair" -Headers $auth
$new  = Invoke-RestMethod -Uri "$base/auth/connect/$($code.code)" -Headers @{ Accept = "application/json" }
$new.token.Length                # a fresh token was issued

# A7. Send a prompt through the API (take an id from A4)
$sid  = "<session id>"
$body = @{ text = "reply with the word pong"; delivery = "queue" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/session/$sid/prompt" -Headers $auth -ContentType "application/json" -Body $body

# A8. Answer a pending permission (ids from A4/A5; use a harmless command)
$rid  = "<permission request id>"
$body = @{ decision = "once" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/session/$sid/permission/$rid/reply" -Headers $auth -ContentType "application/json" -Body $body

# A9. Remote access
opencode pair --remote           # first time: consent prompt and tunnel setup (can take a minute)
# Open the printed https link on the phone with Wi-Fi OFF; it should load and sign in.
# Then redeem a fresh remote link as in A3, set $base to the https URL, and run A5 with -m 600
# to see whether the stream survives 10 minutes through the tunnel.
```

## Appendix B — Windows hardening and uptime checklist
- [ ] **Long server password** (generate in PowerShell, store in a password manager):
  ```powershell
  $b = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('=')
  ```
  Then `opencode service set password "<value>"` and `opencode service start`. Do this **before** enabling remote access and while no important session is running (changing settings restarts the service).
- [ ] **Permissions set to `ask`** for `bash` (and `edit`, `webfetch` if you want) in your global OpenCode config. The docs show the `permission` setting and an `OPENCODE_PERMISSION` environment variable that takes inline JSON; confirm the exact V2 syntax and Windows config location in M0.
- [ ] **Keep the PC awake while you're away:** Settings → System → Power & battery → Screen and sleep → set "When plugged in, put my device to sleep after" to **Never** (or `powercfg /change standby-timeout-ac 0`; PowerToys Awake also works).
- [ ] Run OpenCode as your normal Windows user, not as administrator.
- [ ] Turn remote access off when you don't need it: `opencode service set remote false`.
- [ ] **Lost or stolen phone:** change the password (`opencode service set password "<new>"`, then `opencode service start`); every paired device is signed out at once. Optionally `opencode service set remote false` until you re-pair.

## Sources
- OpenCode v2.0.32 source: `packages/cli/src/commands/handlers/pair.ts`, `packages/cli/src/services/{server-connection,remote-tunnel}.ts`, `packages/server/src/{process,pairing,auth}.ts`, `packages/protocol/src/groups/{server,session,message,permission,event}.ts`, `packages/schema/src/{session,session-message,session-event,session-status-event,session-inbox,prompt-input,permission,event}.ts`, `CHANGELOG.md`, `services/www/src/docs/content/cli/{web,commands}.mdx`
- OpenCode docs: https://opencode.ai/docs/permissions/ , https://opencode.ai/docs/server/ (1.x-era pages; V2 differs)
- Expo: https://docs.expo.dev/versions/v57.0.0/sdk/notifications.md , https://docs.expo.dev/develop/development-builds/introduction.md , https://docs.expo.dev/versions/v57.0.0/sdk/expo.md
- Existing client example: https://www.vibebrowser.app/opencode
