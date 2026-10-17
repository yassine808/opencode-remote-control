# RC dot — TUI connection indicator

OpenCode CLI plugin that shows, right in the TUI footer, whether a remote client is connected to the background server:

- green `● RC active` — a paired client (browser, phone app, or tunnel) has a live connection
- red `● RC disabled` — no remote client connected

It renders in the session prompt footer and on the home screen.

## Install (new PC)

Windows, with OpenCode v2 already installed (`netstat` / `tasklist` are used for detection).

```powershell
# from a clone of this repo
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\plugins" | Out-Null
Copy-Item -Recurse .\plugins\rc-dot "$env:USERPROFILE\.config\opencode\plugins\"
```

Restart OpenCode. No config entry needed — plugins in `~/.config/opencode/plugins/` are auto-discovered. Check: the file `~/.config/opencode/plugins/rc-dot/tui.tsx` exists.

## How it works

Every 5 s the plugin runs `netstat -ano` and looks for `ESTABLISHED` connections to the OpenCode background server port (`:49374` by default). Connections owned by OpenCode's own processes are ignored; if the remaining owner is an allow-listed client process, the dot goes active:

`brave | chrome | code | msedge | firefox | opera | vivaldi | ngrok | opentunnel`

Port and allow-list are constants at the top of `tui.tsx` — edit them there if your server port or client differs.
