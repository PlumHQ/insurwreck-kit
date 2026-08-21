# Design system — Insurwreck 4.0

The source of truth for every Insurwreck communication and event page. It is forked from the Bangalore Treks system: the same quiet surfaces, editorial typography, disciplined spacing, and one memorable interactive. The subject changes from landscapes to working systems.

**Philosophy:** minimalist, workflow-first, quietly technical. The problem and the path to a working outcome are the heroes. The interface stays white, calm, and precise so the content, system diagrams, and one signature interaction carry the page.

## Design principles

1. **Show the work.** Prefer a trigger → input → judgment → action diagram over decorative AI imagery.
2. **One idea per section.** Each section should answer one question and end before it becomes a document dump.
3. **Calm confidence.** No gradients, neon-on-black AI tropes, glassmorphism, floating orbs, or generic robot imagery.
4. **Useful before impressive.** A page should help someone decide, prepare, or act.
5. **Human control is visible.** Approval points, safety boundaries, and owners are designed into workflow visuals rather than hidden in footnotes.

## Color

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#211D20` | Primary text and icons |
| `--stone` | `#696267` | Secondary text |
| `--faint` | `#9A9297` | Tertiary labels and metadata |
| `--mist` | `#F8F7F7` | Soft section and code background |
| `--line` | `#E9E5E7` | All borders and dividers |
| `--plum` | `#7A315D` | Primary accent, links, active states, workflow path |
| `--plum-ink` | `#54203F` | Accent hover and dark accent text |
| `--plum-wash` | `#F7EEF3` | Highlight and selected-state background |
| `--signal` | `#C65A32` | Rare signal for a deadline, caution, or live action |
| `--signal-wash` | `#FBF0EB` | Rare signal background |

Rules: white page background; never use a dark section. Plum is the only recurring accent. Signal orange appears at most once per page. Color never carries meaning alone.

## Typography

| Role | Face | Usage |
|---|---|---|
| Display | **Bricolage Grotesque** 700–800 | H1/H2 and decisive statements; tight tracking, line-height ≤ 1.08 |
| Body | **Inter** 400–650 | All prose, navigation, controls, and card copy; 14–17px, line-height 1.55 |
| System | **IBM Plex Mono** 400–600 | Eyebrows, dates, steps, tool names, status, and workflow metadata |

Load from Google Fonts with system fallbacks. Eyebrows are mono, 11–12px, uppercase, `0.14em` tracking, plum. Avoid all-caps outside short labels.

## Layout

- Content wrap: `max-width: 1120px`, 24px mobile padding, 40px desktop padding.
- Sticky navigation: 64px, white at 88% opacity with a restrained blur and 1px bottom line.
- Section rhythm: 88px desktop / 64px mobile top padding.
- Hero: two-column editorial layout; the event name is the dominant visual and the supporting card reinforces leadership ownership.
- Cards: 1px line, 18px radius, white, no drop shadows.
- Dense technical information sits inside mist or plum-wash surfaces, not dark terminals.
- Dividers and alignment do more work than decoration.

## Iconography

Use an inline SVG symbol sprite. Icons use a 24×24 viewBox, no fill, `1.7px` stroke, round caps and joins. Use simple single-concept glyphs. Product marks are stored locally, shown in restrained white tiles, and never hotlinked. A typographic mark is acceptable when an official reusable asset is unavailable.

## Signature visual language

### Workflow rail

The recurring event motif is a visible workflow:

`Trigger → Inputs → AI judgment → Human check → Action`

- Nodes are white cards with hairline borders.
- The active path is plum, with small circular ports and fine connector lines.
- Human approval is visually distinct through an outlined hand/approval icon and explicit language.
- Keep diagrams legible at 320px; stack nodes vertically on mobile.

### Build-path switcher

When two valid approaches exist, use a segmented control rather than parallel walls of copy. The chosen panel updates immediately, preserves keyboard focus, and never hides essential safety information.

### Persistent preparation list

Use custom checkboxes stored in `localStorage` for participant pre-work. Checked items become quieter but remain readable. Show progress as a plain count, not gamified confetti.

### Swipeable idea deck

When examples are meant to expand thinking, keep the prompt visible and place examples in a horizontal, scroll-snapping card deck. Support touch swipes, keyboard arrows, visible previous/next controls, and a plain position count. Each card should describe one workflow and one concrete success measure.

## Communication anatomy

Every major communication should follow this order:

1. **Why this matters now.** One clear headline and a short human explanation.
2. **What is being built.** Describe the working system and the real work it completes.
3. **What is available.** Group resources by role, not vendor inventory.
4. **What the reader should do.** One primary action with a concrete completion bar.
5. **Examples.** Personal and company examples that clarify scope without prescribing answers.
6. **Safety and limits.** Put controls beside the relevant action.
7. **What comes next.** Owner, date, or next artifact.

## Copy voice

Personal, direct, concrete, and builder-oriented. Sound like a thoughtful founder inviting peers to work alongside them.

- Prefer “Bring one recurring problem you understand” over “Unlock transformative AI opportunities.”
- Prefer “Get one workflow running end to end” over “Build an innovative solution.”
- Prefer “working system” or “working prototype” over treating skill acquisition as the finish line.
- Name the person, action, date, and finish line.
- Acknowledge that people have different technical comfort levels without creating beginner/expert status.
- Avoid hype words: revolutionary, magical, game-changing, disruption, cutting-edge.
- Short sentences carry key decisions. Longer prose is reserved for reasoning.

## Motion and interaction

- Motion is functional: panel changes, card navigation, progress updates, and a subtle workflow-path reveal.
- Respect `prefers-reduced-motion`.
- Transitions stay within 160–240ms.
- No scroll-jacking, autoplay media, cursor effects, or decorative parallax.

## Accessibility

- Target WCAG AA contrast.
- Use semantic headings and landmarks.
- Every interactive works with keyboard and touch.
- Minimum touch target: 44×44px.
- Never remove visible focus styles.
- The workflow diagram must have an equivalent text description.
- Body copy stays at 16px on small screens.

## Implementation rules

- Static HTML/CSS/JS is the default for communication pages.
- Pages should work without JavaScript; interactions are progressive enhancement.
- Keep assets local except fonts, and provide system fallbacks.
- No analytics, trackers, external forms, or production connectors without an explicit decision.
- Test at 320px, 768px, 1280px, and with reduced motion.
- `DESIGN.md` changes are intentional decisions and should be recorded in `docs/working-log.md`.
