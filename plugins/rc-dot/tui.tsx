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
type Conn = { foreign: string; pid: string }

function parseProcessNames(stdout: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line)
    if (match) names.set(match[2], match[1].replace(/\.exe$/i, "").toLowerCase())
  }
  return names
}

interface NetworkState {
  serverPorts: Set<string>
  established: Conn[]
}

function parseNetstat(stdout: string, names: ReadonlyMap<string, string>): NetworkState {
  const state: NetworkState = { serverPorts: new Set(), established: [] }
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    if (parts[3] === "LISTENING" && names.get(parts[4]) === "opencode") {
      const port = parts[1].slice(parts[1].lastIndexOf(":") + 1)
      if (port) state.serverPorts.add(`:${port}`)
    } else if (parts[3] === "ESTABLISHED") {
      state.established.push({ foreign: parts[2], pid: parts[4] })
    }
  }
  return state
}

function isRcConnection(
  conn: Conn,
  ports: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): boolean {
  for (const port of ports) {
    if (conn.foreign.endsWith(port)) return ALLOW.test(names.get(conn.pid) ?? "")
  }
  return false
}

async function isRcActive(): Promise<boolean> {
  const [net, tasks] = await Promise.all([run("netstat -ano"), run("tasklist /FO CSV /NH")])
  const names = parseProcessNames(tasks)
  const { serverPorts, established } = parseNetstat(net, names)
  if (serverPorts.size === 0) return false
  return established.some((conn) => isRcConnection(conn, serverPorts, names))
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
