---
name: OpenCode Remote
description: A calm flight deck for a coding agent — control OpenCode sessions from your phone.
colors:
  deep-watch: "#0A1219"
  panel-navy: "#111C26"
  lifted-panel: "#1B2937"
  code-well: "#0D1721"
  instrument-hairline: "#1F2D3B"
  starlight: "#E8EEF6"
  haze: "#9AA6B8"
  fog: "#677386"
  signal-cobalt: "#6C8CFF"
  on-signal: "#0A1219"
  cobalt-wash: "#6C8CFF22"
  watch-cyan: "#2CCFE8"
  cyan-wash: "#2CCFE81F"
  caution-amber: "#F2A93B"
  amber-wash: "#F2A93B22"
  alert-coral: "#FF6B7F"
  coral-wash: "#FF6B7F1F"
  cleared-mint: "#3DD598"
  mint-wash: "#3DD59820"
typography:
  display:
    fontFamily: "Spline Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: "52px"
    letterSpacing: "-1.4px"
  headline:
    fontFamily: "Spline Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: "40px"
    letterSpacing: "-0.9px"
  title:
    fontFamily: "Spline Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.4px"
  body:
    fontFamily: "Spline Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "25px"
  body-small:
    fontFamily: "Spline Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Spline Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.1px"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  sm: "8px"
  md: "14px"
  lg: "20px"
  pill: "999px"
spacing:
  half: "2px"
  one: "4px"
  two: "8px"
  three: "16px"
  four: "24px"
  five: "32px"
  six: "64px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cobalt}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 24px"
  button-secondary:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.starlight}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 24px"
  button-danger:
    backgroundColor: "{colors.coral-wash}"
    textColor: "{colors.alert-coral}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 24px"
  button-ghost:
    textColor: "{colors.signal-cobalt}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 24px"
  status-pill:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.caution-amber}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  session-card:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.starlight}"
    rounded: "{rounded.lg}"
    padding: "16px"
  approval-card:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.starlight}"
    rounded: "{rounded.lg}"
    padding: "16px"
  composer-field:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.starlight}"
    rounded: "26px"
    padding: "5px 5px 5px 16px"
  banner:
    backgroundColor: "{colors.coral-wash}"
    textColor: "{colors.alert-coral}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  app-header:
    backgroundColor: "{colors.deep-watch}"
    textColor: "{colors.starlight}"
    height: "52px"
    padding: "0 8px"
---

# Design System: OpenCode Remote

## 1. Overview

**Creative North Star: "The Flight Deck"**

This is the flight deck of a quiet aircraft: a dark instrument panel, a handful of state lights, one operator watching a machine think. The system exists so a glance answers the only question that matters — what is the agent doing, and does it need me? — and so the two decisions that require a hand (approve, steer) are always one thumb-reach away. Nothing on the deck glows for decoration: every cyan, amber, coral, and mint light means something specific, and the moment it stops meaning something, it stops glowing.

Density is deliberately low. The phone is checked in passing, so each screen carries one dominant reading: a list of sessions with state rails, a transcript that breathes, a composer that waits. Depth comes from tone, not shadow — stepped navy surfaces separated by hairline seams, like panel sections bolted together.

The system explicitly rejects the **AI-slop SaaS look** (gradient accents, identical icon + title card grids, decorative glassmorphism, big-number hero metrics), the **chat-app clone** (messenger bubbles and chat chrome), and the **admin dashboard** (data-table-first screens, widget walls, dense toolbars). If any screen could pass for one of those, it has failed, regardless of polish.

**Key Characteristics:**
- Dark-first deck navy (#0A1219) with a frost-white day mode that mirrors it exactly.
- Color is state, never decoration: cobalt = action, cyan = working, amber = needs you, coral = failed, mint = succeeded.
- Flat with tonal layering and hairline seams. Zero shadows anywhere.
- Tactile and alive: press-springs, pulsing status dots, a spring-up approval card — motion reserved for feedback and the one interruption the UI allows itself.
- Instrument typography: one system sans (Spline Sans on web), tightened at scale; monospace only for machine data.

## 2. Colors: The Panel-Light Palette

A dark panel with five signal lights: quiet navy surfaces, and color that only appears when a state demands it.

### Primary
- **Signal Cobalt** (#6C8CFF): the action color, and nothing else. Backgrounds of primary buttons (Allow once, Send), focus rings, links, the composer border on focus, accent text. Its rarity is deliberate — on a given screen it should feel like the only switch lit up.

### Secondary
The state lights. Each one pairs with a translucent wash of the same hue; washes are the only way a state color becomes a surface (`cobalt-wash` #6C8CFF22, `cyan-wash` #2CCFE81F, `amber-wash` #F2A93B22, `coral-wash` #FF6B7F1F, `mint-wash` #3DD59820).
- **Watch Cyan** (#2CCFE8): something is running, streaming, working. Status dots, progress sweep, "Working…" text.
- **Caution Amber** (#F2A93B): the agent needs a human. Approval card ring, pending badges, warning banners. Also the session-card rail when approvals wait.
- **Alert Coral** (#FF6B7F): failure. Error banners, failed-turn status, the Reject button (a wash, never a solid — the destructive path is quiet until pressed).
- **Cleared Mint** (#3DD598): success. Reserved for confirmations; used sparingly because most screens never need to say "done".

### Neutral
- **Deep Watch** (#0A1219): the app background. The night around the panel.
- **Panel Navy** (#111C26): raised surfaces — cards, buttons, composer, sheets.
- **Lifted Panel** (#1B2937): selected or pressed surfaces, skeletons, model tags.
- **Code Well** (#0D1721): code blocks and resource chips; a recessed surface, one step deeper than the background.
- **Instrument Hairline** (#1F2D3B): every seam. Borders are always hairline width, never thick.
- **Starlight** (#E8EEF6): primary text on dark.
- **Haze** (#9AA6B8) / **Fog** (#677386): secondary and tertiary text, timestamps, placeholders.

The morning deck (light scheme) mirrors the night one: **Frost Deck** #EEF1F6 background, **Panel White** #FFFFFF elements, **Cool Steel** #E2E7F0 selected, **Frost Well** #E7EBF3 code, **Frost Hairline** #DAE0EB seams, **Deck Ink** #0D1420 / **Slate** #566074 / **Mist** #8791A3 text, and the same five signals at daylight intensity — Signal Cobalt deepens to #2F5BFF, Harbor Cyan #0A8FA8, Burnt Amber #B86E00, Signal Coral #D63950, Harbor Mint #168A5A.

### Launch Surface
The launcher icon, splash and startup intro are the one brand exception: OpenCode blueprint blue (#208AEF, with the icon's #49A8FF → #0273DF gradient), a translucent terminal frame and the Watch Cyan cursor. This surface exists only before the app and does not change the state-only color rule inside it.

### Named Rules
**The State-Only Color Rule.** Color communicates state or action, never mood. If a surface is cobalt, it is because it is *the* action on that screen. There are no tinted sections, no colored headers, no decorative accents.

**The One Glow Rule.** A screen may have exactly one pulsing element — the thing that needs you. Pulse is a heartbeat, not wallpaper.

**The Wash Rule.** State colors become surfaces only as washes (~12–13% alpha). Solid saturated fills are reserved for the one primary action and for dots.

## 3. Typography

**Display Font:** Spline Sans on web; the platform system sans everywhere else (system-ui, Segoe UI, Roboto)
**Body Font:** Same stack — one voice for the whole deck
**Label/Mono Font:** JetBrains Mono on web; platform monospace elsewhere

**Character:** Instrument typography. A single humanist sans carries every label on the panel, tightened with negative tracking at large sizes so headings read like engraved plate markings — not airy marketing type. The only second voice is monospace, and it speaks only for machine data.

### Hierarchy
- **Display** (700, 48/52, -1.4): screen-scale statements, empty-state moments. Rare by design.
- **Headline** (700, 34/40, -0.9): large section moments and result statements.
- **Title** (600, 22/28, -0.4): section headers, sheet titles, empty-state titles.
- **Body** (400, 16/25): transcripts, descriptions, message input. Content is capped at 760px wide so lines never sprawl.
- **Body Small** (400, 14/20): dense card content, status lines, banner text.
- **Label** (500, 12/16, +0.1): pills, timestamps, captions, metadata. Sentence case, never uppercase.
- **Code** (400, 12.5/18, mono): file paths, commands, model ids, resource chips.

### Named Rules
**The Engraved Rule.** Anything at 22px or larger gets negative tracking (-0.4px or tighter). Large type is precision-machined, never airy.

**The Mono-as-Data Rule.** Monospace is for machine data only — code, paths, identifiers. It is never used for mood, branding, or emphasis.

## 4. Elevation

This system has no shadows. None — the codebase contains zero shadow or elevation declarations, and that is the doctrine. Depth is tonal and structural: surfaces step from Deep Watch to Panel Navy to Lifted Panel, separated by hairline seams. When a layer needs to read as "above" (the approval card, a banner), it does not lift with a drop shadow — it *arrives* with motion (spring-up from below, slide-in from the top) and carries its own surface tone plus, when urgent, a state border.

### Named Rules
**The Flat-By-Default Rule.** Zero shadows, ever. If a surface needs separation, use a lighter tone or a hairline seam. If a layer needs arrival, use motion.

**The State Border Rule.** Attention is carried by borders: the approval card wears a 1.5px amber ring (the only non-hairline border in the system); everything else keeps hairlines.

## 5. Components

### Buttons
Tactile, thumb-first, and quiet. Every button is a spring under the finger.
- **Shape:** min-height 44px, radius 14px (medium), hairline border, label in Body Small at weight 600.
- **Primary:** Signal Cobalt background, On-Signal (#0A1219) text. One per screen — the action that matters (Allow once, Send).
- **Secondary:** Panel Navy background, Starlight text, hairline seam. The default weight ("Always", routine confirms).
- **Danger:** Coral Wash background, Alert Coral text, no border. Quiet until pressed — this is Reject's weight.
- **Ghost:** transparent background, cobalt text. Inline tertiary actions only.
- **Pressed / Focus:** scale to 0.97 on press-in with a spring (no bounce), back on release; web focus gets a 2px cobalt outline at 2px offset; disabled drops to 50% opacity.
- **Compact:** min-height 36px, padding 16px, radius 10px — for dense rows.

### Chips / Pills
- **Style:** pill radius, wash background of the state hue, Label type at weight 600 in the state hue, optional 6px status dot, padding 4px × 10px.
- **State:** "Working…" wears the cyan wash; "Waiting for your approval" the amber wash with a pulsing dot. Model tags wear Lifted Panel with Haze text — informational, not stateful.

### Cards / Containers
- **Corner Style:** 20px (large).
- **Background:** Panel Navy on Deep Watch; Code Well for recessed content.
- **Shadow Strategy:** none (see Elevation).
- **Border:** hairline seam, Instrument Hairline.
- **Internal Padding:** 16px, 8px vertical rhythm between rows.
- **Session card signature:** a 4px rail on the left edge carries state — amber = needs you, cyan = working, transparent = idle — so the list is scannable without reading a word. Press feedback scales to 0.985, gentler than buttons.

### Inputs / Fields
- **Composer:** a capsule (26px radius) in Panel Navy with a hairline seam that turns cobalt on focus. Multiline input at Body size, 36px minimum height. The send button is a 38px circle (radius 19) — cobalt with an up-arrow when sendable, Lifted Panel with a fog arrow when not.
- **Focus:** border color shift only. No glow, no ring on native.
- **Error:** conveyed by banners and inline error surfaces (Alert Coral text on coral wash), never by field chrome alone.

### Navigation
Screens are headed by a hairline bottom seam and a view-drawn back chevron; titles are 16/22 semibold. No tab bars on session screens; home is one list. Navigation chrome stays out of the deck's way.

### Signature Component — The Approval Card
Docks directly above the composer so the decision is always one thumb-reach away. Wears the system's only state border: a 1.5px amber ring around Panel Navy, a pulsing 8px amber dot, "Approval needed" in Body Small semibold, the request message in Haze, and resource chips in Code Well with mono type for paths. Springs up from +40px with slight overshoot when a request arrives — the one interruption the UI is allowed to make. Three actions in a row: Reject (danger), Always (secondary), Allow once (primary, widest).

### Signature Component — The Status System
Every "is it alive?" signal shares one vocabulary. A solid dot (7–8px) that, while working or waiting, pulses a radiating ring that scales 1→3 and fades 0.6→0 over 1.5s. Three bouncing 6px dots (typing) while the agent composes. A 2px sweeping bar under a header while work is in progress. All ambient motion stops entirely under reduced motion.

## 6. Do's and Don'ts

### Do:
- **Do** reserve color for state and action: cobalt = action, cyan = working, amber = needs you, coral = failed, mint = succeeded. Nothing else gets color.
- **Do** keep every touch target at 44px or larger, and use the radius steps: 8 (small), 14 (medium), 20 (large), pill for chips.
- **Do** build depth with tone and seam: Deep Watch → Panel Navy → Lifted Panel, hairline borders, no exceptions.
- **Do** give arrivals motion: spring-up for the approval card, slide-in for banners, 380ms fade-and-rise entrances once per screen load.
- **Do** keep the approval card one thumb-reach from the composer, wearing its 1.5px amber ring.
- **Do** stop every ambient animation under `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled()`.
- **Do** tighten tracking on anything ≥22px (-0.4px or tighter). Engraved, not airy.
- **Do** pair every status color with a label or dot shape so state never depends on color alone.

### Don't:
- **Don't** use drop shadows. If it looks like a card needs a shadow, the tone step or seam is wrong.
- **Don't** let two things pulse on the same screen. One glow rule.
- **Don't** reintroduce the **AI-slop SaaS look**: gradient accents, identical icon + title card grids, decorative glassmorphism, big-number hero metrics.
- **Don't** build a **chat-app clone**: no messenger chrome, no bubble tails, no read receipts; the transcript is telemetry, not a conversation.
- **Don't** build an **admin dashboard**: no data tables, no widget walls, no dense toolbars, no metric rows.
- **Don't** tint sections, headers, or navigation with state colors, and never use gradient text.
- **Don't** use monospace for mood. It is the voice of machine data only.
- **Don't** fill a state surface with a solid saturated color — washes only (≤13% alpha), except the one primary action.
