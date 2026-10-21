# AGENTS.md — opencode-remote-control

Remote control for OpenCode: an Android app that drives OpenCode sessions on this PC through the official `opencode pair --remote` tunnel (no custom bridge), plus a PC-side TUI indicator plugin.

## Layout

- `mobile/` — the Expo SDK 58 app (expo-router, React 19.3, React Native 0.88). Talks directly to OpenCode's HTTP API.
- `plugins/rc-dot/` — OpenCode CLI plugin: green/red "RC active" indicator in the TUI footer. Install: copy the folder to `~/.config/opencode/plugins/rc-dot/` and restart OpenCode (details in its README).
- `PLAN.md` — as-built v1 plan. `TO-DO.md` — backlog. `PRODUCT.md` / `DESIGN.md` — product and design context.

## Design context (read before any UI work)

`PRODUCT.md` and `DESIGN.md` at the repo root are the source of truth. `DESIGN.md` (Stitch format) defines "The Flight Deck" system: navy tonal surfaces, state-only color, zero shadows, tactile motion. `mobile/src/constants/theme.ts` implements it — keep the two in sync when changing tokens.

## Commands (from `mobile/`)

- `npm run start` — Expo dev server (`--tunnel` required for phone-over-mobile-data testing)
- `npm run typecheck` — `tsc --noEmit`; run before any commit
- `npm run lint` — `expo lint`
- `npm run web` — web preview (storage falls back to localStorage in `src/lib/storage.ts`)

## Conventions

- TypeScript path alias `@/` maps to `src/`. Routes are expo-router files in `src/app/`.
- UI: tokens only from `@/constants/theme` (`Colors` via `useTheme()`, `Spacing`, `Radius`, `Touch`); text via `ThemedText` variants; shared primitives and motion in `@/components/ui` (`PressableScale`, `StatusDot`, `Pill`, `Banner`, `Entrance`, …). No hardcoded hex, no shadows, no second pulsing element per screen.
- Respect reduced motion: gate every ambient animation behind `useReduceMotion()`.
- State: connection config via `@/lib/connection` (SecureStore on native, localStorage on web); live data via SSE + 15s polling in `@/lib/events`.
- Permissions are the safety boundary of the product: `~/.config/opencode/opencode.json` asks on `bash`/`edit`. Do not weaken permission settings without explicit instruction.

## Gotchas

- The OpenCode v2 background server binds a dynamic loopback port; `opencode service status` prints the current URL (for example `http://127.0.0.1:45278`). The app uses the URL returned by `opencode pair`; the rc-dot plugin discovers the listener by process name.
- Default pairing is the `opencode pair --remote` tunnel. A full LAN pairing link also works: bind the server with `opencode service set hostname 0.0.0.0` and restart it (`opencode service restart`), read the port from `opencode service status`, then mint the link with `opencode pair --url http://<pc-lan-ip>:<port>`. The app rejects a bare `host:port` — the one-time code is after `/auth/connect/`. The Expo dev-server port (`8977`/`8978`) is not the OpenCode port.
- LAN pairing is plain HTTP. `mobile/plugins/with-cleartext.js` sets `android:usesCleartextTraffic="true"` so release builds can reach it; the token and API traffic are unencrypted on the LAN. Prefer the HTTPS tunnel on untrusted networks, and bind back to `127.0.0.1` when LAN access is no longer needed.
- `cli.json` has `session.permissions: "autoaccept"` while `opencode.json` sets `bash`/`edit` to `ask` — verify effective behavior with a fresh session before any remote exposure.
