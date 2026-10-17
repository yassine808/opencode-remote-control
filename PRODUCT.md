# Product

## Register

product

## Users

Yassine, a solo developer, away from his PC. The app runs on his Android phone, usually on mobile data, often in passing: queue, couch, train. The job: check on the coding agent and steer it without walking back to the desk. Personal first, but the polish bar is "hand a friend the phone without apology".

## Product Purpose

A control deck for an OpenCode agent running on the user's PC. See every session, watch a transcript stream live, send prompts, stop runs, approve or reject permission requests. Success: trustworthy remote operation. The app should feel like carrying the desk with you, not like reading logs. Scope: this document covers the mobile app (`mobile/`). The repo also ships a PC-side TUI indicator plugin (`plugins/rc-dot/`), outside this design context.

## Brand Personality

Calm, precise, alive. Voice: terse and technical, matching the tool it controls. Emotional goal: quiet confidence. The screen answers "what is the agent doing?" in one glance, with no shouting and no decoration that competes with state.

## Anti-references

- **AI-slop SaaS look**: gradient accents, identical icon + title card grids, decorative glassmorphism, big-number hero metrics. If it could pass for a generic AI landing page, it failed.
- **Chat-app clone**: messenger bubbles and chat chrome. The transcript is telemetry, not a conversation.
- **Admin dashboard**: data-table-first screens, widget walls, dense toolbars. One agent to watch, not a metrics warehouse.

## Design Principles

1. **State over decoration.** Color, space, and motion are reserved for meaning: running, needs-you, failed, succeeded. Ornament never competes with signal.
2. **A control deck, not a conversation.** Approvals, steering, and stop are the controls; the transcript is telemetry. Controls get the immediate, physical treatment.
3. **Glanceable first, depth on demand.** The phone is checked in passing. One second must answer "is anything wrong or waiting?"; detail appears when asked.
4. **Calm under load.** Long sessions, streaming text, failures. Restraint and hierarchy keep the operator oriented when things get busy.
5. **Precision at touch scale.** Every interactive element feels exact: real touch targets, immediate feedback, no jitter, no false affordances.

## Accessibility & Inclusion

Personal scope, no formal WCAG target, but the bar holds: respect reduced motion (implemented), 44pt minimum touch targets (implemented), and never communicate state by color alone (pair with label, icon, or shape). Contrast should stay comfortable in both schemes for phone-in-sunlight and bed-at-2am use.
