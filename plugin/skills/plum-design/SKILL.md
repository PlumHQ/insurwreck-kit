---
name: plum-design
description: Use whenever you build or restyle any user interface for a participant - a page, dashboard, form, table, email template or deployed app. Plum's real design system, the one plumhq.com and the Insurwreck event site are built with. Apply it by default; do not invent a palette or reach for a generic template look.
---

# Plum design system

This is not a suggestion or a starting point. Every interface a participant deploys carries Plum's name, so it uses Plum's system unless they explicitly ask for something else.

**Apply it without being asked.** If you are writing HTML, JSX, Tailwind config or CSS, these tokens are the palette. Do not open with `slate-50` and `indigo-600`.

## Use the stylesheet, don't retype the values

```bash
cp "${CLAUDE_PLUGIN_ROOT}/skills/plum-design/plum.css" ./app/plum.css   # or ./public, ./styles, wherever
```

Then import it once and build with the tokens. It ships light and dark, a type scale, and the handful of components the system actually defines.

Using Tailwind instead? Map these into `theme.extend.colors` rather than approximating them.

## The palette

Light is Plum's real palette, lifted from `site/styles.css` in this repo. **Dark is derived** — the published system has no dark theme and says so (*"white page background; never use a dark section"*). Where a participant wants dark, the tokens below carry the same identity onto a dark ground with AA contrast preserved.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ink` | `#211D20` | `#F4F1F3` | primary text |
| `--stone` | `#696267` | `#A79FA4` | secondary text |
| `--faint` | `#9A9297` | `#7B7379` | labels, metadata |
| `--paper` | `#FFFFFF` | `#171416` | page background |
| `--mist` | `#F8F7F7` | `#1F1B1E` | soft sections, code |
| `--line` | `#E9E5E7` | `#322C30` | every border and divider |
| `--plum` | `#7A315D` | `#C97BA5` | the one recurring accent |
| `--plum-ink` | `#54203F` | `#E3AAC8` | accent hover |
| `--plum-wash` | `#F7EEF3` | `#2A1B24` | selected and highlight background |
| `--signal` | `#C65A32` | `#E08A62` | deadline or caution, **once per page** |

Two rules that matter more than the values: **plum is the only recurring accent**, and **colour never carries meaning alone** — pair it with a label, an icon or a position.

Dark-mode notes worth keeping: the neutrals hold the warm `#211D20` hue rather than drifting to blue-grey or flat black, and plum is lifted because `#7A315D` fails contrast on a dark ground. Hover goes *lighter* on dark, not darker.

## Type

| Role | Face | Where |
|---|---|---|
| Display | **Bricolage Grotesque** 700–800 | h1/h2, decisive statements. Tracking tight, line-height ≤ 1.08 |
| Body | **Inter** 400–650 | all prose, nav, controls, cards. 14–17px, line-height 1.55 |
| System | **IBM Plex Mono** 400–600 | eyebrows, dates, steps, tool names, status, any figure in a column |

Google Fonts with system fallbacks. **Eyebrows are the system's most recognisable tell**: mono, 11–12px, uppercase, `0.14em` tracking, plum. Avoid all-caps anywhere else.

## Layout

- Wrap `1120px`; 24px padding on mobile, 40px on desktop
- Section rhythm 88px desktop / 64px mobile
- Cards: 1px line, **18px radius, no drop shadow** — the hairline does the work
- Dense technical content sits on `--mist` or `--plum-wash`, never in a dark terminal block
- Dividers and alignment do more work than decoration

## What this system is not

Do not produce: gradients, glassmorphism, neon-on-black, floating orbs, generic robot or "AI" imagery, drop shadows on cards, confetti, decorative parallax, scroll-jacking, autoplay media.

The house style is **calm, editorial, quietly technical**. If a page looks like a generic SaaS landing template, it is wrong regardless of how polished it is.

## Copy, because words are part of the design

Personal, direct, concrete. Name the person, action, date and finish line.

- "Bring one recurring problem you understand" — not "Unlock transformative AI opportunities"
- "Get one workflow running end to end" — not "Build an innovative solution"
- Banned: revolutionary, magical, game-changing, disruption, cutting-edge, seamless

Short sentences carry decisions; longer prose is for reasoning. Errors say what went wrong and how to fix it. A control says exactly what happens: a button labelled **Publish** produces a toast saying **Published**.

## Non-negotiables

- WCAG AA contrast, both themes
- Semantic headings and landmarks; every interaction works by keyboard
- Visible focus states — never remove them
- 44×44px minimum touch target
- Body copy stays 16px on small screens
- Motion is functional only, 160–240ms, and respects `prefers-reduced-motion`
- Test at 320px, 768px and 1280px

## The signature: the workflow rail

The recurring Plum motif is a visible workflow, and it is the thing to reach for instead of decorative AI art:

```
Trigger → Inputs → AI judgment → Human check → Action
```

Nodes are white cards with hairline borders. The active path is plum with small circular ports and fine connectors. **Human approval is visually distinct** — an outlined approval icon and explicit language, never buried in a footnote. Legible at 320px; stack vertically on mobile. The diagram needs an equivalent text description for screen readers.

If a participant is building anything that makes a judgment and then acts, this diagram is how Plum shows it.

## Full reference

`site/DESIGN.md` in this repo is the source of truth, including communication anatomy and the interactive patterns (build-path switcher, preparation list, idea deck). Read it when building something larger than a single page.
