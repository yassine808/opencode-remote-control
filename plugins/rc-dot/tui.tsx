import { exec } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"

const TOKEN = ":49374"
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
// connection to the OpenCode server port. Same check as the PS prompt dot.
async function isRcActive(): Promise<boolean> {
  const net = await run("netstat -ano")
  const pids = new Set<string>()
  for (const line of net.split(/\r?\n/)) {
    if (!line.includes("ESTABLISHED") || !line.includes(TOKEN)) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    if (!parts[2].endsWith(TOKEN)) continue
    pids.add(parts[4])
  }
  if (pids.size === 0) return false
  const tasks = await run("tasklist /FO CSV /NH")
  const names = new Map<string, string>()
  for (const line of tasks.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line)
    if (match) names.set(match[2], match[1].replace(/\.exe$/i, "").toLowerCase())
  }
  for (const pid of pids) {
    if (ALLOW.test(names.get(pid) ?? "")) return true
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
