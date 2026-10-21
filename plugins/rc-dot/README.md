# RC dot — TUI connection indicator

OpenCode CLI plugin that shows, right in the TUI footer, whether a local browser/editor or an external tunnel client is connected to the background server:

- green `● RC active` — an allow-listed client has a live connection
- red `● RC disabled` — no such client is connected

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

Every 5 s the plugin runs `netstat -ano` and `tasklist`, then finds the OpenCode server's loopback listener by process name. OpenCode v2 uses a dynamic port, so there is no port to configure. It looks for `ESTABLISHED` connections to that port whose owning process is allow-listed:

`brave | chrome | code | msedge | firefox | opera | vivaldi | ngrok | opentunnel`

The allow-list is a constant at the top of `tui.tsx` — edit it there if your client differs.

OpenCode v2 runs its built-in OpenTunnel inside the OpenCode process, so a phone connected through that tunnel is not visible here as a separate client. The dot reflects local browser/editor clients and external tunnel processes.
