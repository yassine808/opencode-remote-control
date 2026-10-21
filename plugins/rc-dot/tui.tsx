import { exec } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"

const ALLOW = /^(brave|chrome|code|msedge|firefox|opera|vivaldi|ngrok|opentunnel)$/
const TASK_LINE = /^"([^"]+)","(\d+)"/

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

// RC active = an RC client (browser/tunnel process) has an established
// connection to the OpenCode server. v2 binds a dynamic loopback port, so the
// listeners are found by process name rather than by a fixed port.
async function isRcActive(): Promise<boolean> {
  const [net, tasks] = await Promise.all([run("netstat -ano"), run("tasklist /FO CSV /NH")])
  const names = new Map<string, string>()
  for (const line of tasks.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line)
    if (match) names.set(match[2], match[1].replace(/\.exe$/i, "").toLowerCase())
  }

  const serverPorts = new Set<string>()
  const established: { foreign: string; pid: string }[] = []
  for (const line of net.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    if (parts[3] === "LISTENING" && names.get(parts[4]) === "opencode") {
      const port = parts[1].slice(parts[1].lastIndexOf(":") + 1)
      if (port) serverPorts.add(`:${port}`)
    } else if (parts[3] === "ESTABLISHED") {
      established.push({ foreign: parts[2], pid: parts[4] })
    }
  }
  if (serverPorts.size === 0) return false

  for (const conn of established) {
    if (![...serverPorts].some((port) => conn.foreign.endsWith(port))) continue
    if (ALLOW.test(names.get(conn.pid) ?? "")) return true
  }
  return false
}

export default Plugin.define({
  id: "rc.dot",
  setup(context) {
    const [state, updateState] = context.storage.memory("rc-dot-status", {
      initial: { active: false },
    })

    let stopped = false

    const poll = async () => {
      if (stopped) return
      try {
        const active = await isRcActive()
        updateState((draft) => {
          draft.active = active
        })
      } catch {
        // transient exec failure: keep last known state
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), 5000)

    // green "● RC active" while a client is connected; red "● RC disabled" otherwise
    const dot = () => (
      <text fg={state.active ? "#22c55e" : "#ef4444"}>
        {state.active ? "● RC active" : "● RC disabled"}
      </text>
    )

    const disposePrompt = context.ui.slot({ append: "prompt.footer.status", render: dot })
    const disposeHome = context.ui.slot({ append: "home.footer.status", render: dot })

    return () => {
      stopped = true
      clearInterval(timer)
      disposePrompt()
      disposeHome()
    }
  },
})
