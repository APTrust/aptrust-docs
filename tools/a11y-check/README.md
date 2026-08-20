# Accessibility regression check

Run this before telling an external auditor the site is ready to retest.

```bash
cd tools/a11y-check
npm run setup     # once: installs deps + a pinned Chromium
npm run a11y      # builds the site, serves it, sweeps, writes report/
```

`npm run setup` is optional if you already have Google Chrome installed — the
script falls back to it automatically. Exit code is non-zero if anything fails,
so it can gate a release.

## What it sweeps

7 pages x 3 states = 21 combinations:

| | |
|---|---|
| **Pages** | `/`, `/user-guide/`, `/user-guide/preservation/ingest/`, `/dart-docs/`, `/registry-docs/`, `/api/`, `/policies/` |
| **States** | desktop 1280x800; mobile 375x812 drawer closed; mobile 375x812 **drawer open** |

The drawer-open state matters: it is the only state in which the sidebar's own
header, Close button and back buttons are on screen.

## Two layers, because they catch different things

**1. axe-core** — the same engine behind Deque's axe Auditor, which is what our
external auditor runs. Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa`, `best-practice`.

**2. Structural assertions read from Chrome's real accessibility tree** (via CDP
`Accessibility.queryAXTree`). This layer exists because **axe did not catch the
finding that prompted this tool**. A `<label>` that looks like a heading,
announces as "clickable", and does nothing when activated is invisible to
rule-based scanning but obvious to a screen-reader user. The accessibility tree
is literally what the screen reader consumes, so "does this announce as a
heading" becomes a machine-checked assertion instead of a manual judgement.

Assertions:

| Check | Why |
|---|---|
| `label-with-role` | ARIA in HTML permits no role on `<label>`. Bolting `role="heading"` on one is invalid and AT may discard it — this is exactly how the previous fix attempt failed. |
| `section-double-exposed` / `section-wrong-element` / `section-is-label` / `section-heading-focusable` | Section items render as a heading/toggle pair (desktop vs drawer). Exactly one must be visible, and it must be the right element for that width — never a `<label>`, never a focusable heading. |
| `heading-not-exposed-as-heading` / `heading-without-name` | The heading must actually reach the screen reader as a named heading. |
| `control-without-name` / `control-exposed-as-heading` | Every operable control announces a name; no control masquerades as a heading. |
| `self-link-without-aria-current` | A sidebar link to the current page is fine *if* announced as current; otherwise it is the audit's "link that doesn't take the user anywhere". |
| `aria-expanded-on-nav` | Not an allowed attribute on `role="navigation"`; Material ships it by default. |
| `aria-expanded-stale` / `toggle-no-state` | A disclosure button whose `aria-expanded` disagrees with its checkbox announces the wrong state. |
| `focusable-in-aria-hidden` | AT skips it while the keyboard still lands on it. |

## report/

Regenerated on every run, gitignored:

- `results.json` — all findings, machine-readable
- `<state>_<page>.ax.json` — **the evidence pack.** Every sidebar element with the
  role and name the screen reader receives. Send this to the auditor: it answers
  "how does this announce?" directly rather than by assertion.
- `<state>_<page>.png` — screenshot of each state

## What this does not cover

Automated checks cannot confirm how a real screen reader speaks. Before signing
off, do the manual pass in the repo's `CLAUDE.md` (Accessibility section) with
VoiceOver at both widths.
