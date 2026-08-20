# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`aptrust-docs` is the scaffolding for the unified APTrust documentation site (https://docs.aptrust.org), built with MkDocs Material and the `mkdocs-monorepo-plugin`. **This repo does not contain most of the documentation content.** It combines four separately-maintained doc repos into one site at build time:

| Tab | Source repo | URL path | Nav defined in |
|---|---|---|---|
| User Guide | APTrust/userguide | `/user-guide/` | `repos/userguide/mkdocs.yml` |
| DART | APTrust/dart-docs | `/dart-docs/` | `repos/dart/mkdocs.yml` |
| Registry | APTrust/registry-docs | `/registry-docs/` | `repos/registry/mkdocs.yml` |
| Preservation Services | APTrust/preserv-docs | `/preservation-services-docs/` | `repos/preserv/mkdocs.yml` |

`docs/` in *this* repo only holds: the landing page (`index.md`), the API reference page (`api.md` + `member_api_v3.yml`), two bridge pages that link out to aptrust.org (`documentation.md`, `policies.md`), an accessibility page, and `stylesheets/extra.css`.

Sub-repos are cloned into `repos/` (not `docs/`) at build time so MkDocs's own file scanner doesn't pick up their markdown as a second, duplicate copy of the content. `repos/` is not committed — it's created fresh by cloning in CI or manually for local builds.

Before editing content, check which repo actually owns it: nav sections that resolve via `!include ./repos/<name>/mkdocs.yml` live in that sub-repo, not here. Only `index.md`, `api.md`, `documentation.md`, `policies.md`, `accessibility.md`, and the theme/CSS overrides belong in this repo.

## Commands

```bash
pip install -r requirements.txt

# Clone the sub-repos into repos/ (required before serve/build — repos/ is gitignored-equivalent, not committed)
git clone --depth 1 https://github.com/APTrust/preserv-docs  repos/preserv
git clone --depth 1 https://github.com/APTrust/registry-docs  repos/registry
git clone --depth 1 https://github.com/APTrust/dart-docs      repos/dart
git clone --depth 1 https://github.com/APTrust/userguide      repos/userguide

mkdocs serve     # live preview at http://127.0.0.1:8000 (or via .claude/launch.json on :8123)
mkdocs build     # write static site to ./site/
```

There is no lint/test suite. `mkdocs build` (without `--strict`) is the closest thing to a correctness check — it will still succeed with broken internal links, since `--strict` is intentionally disabled (see "Known constraints" below).

## Architecture

- **`mkdocs.yml`** is the root config: theme, plugins, and the `nav:` block that stitches the four sub-repos together via `!include ./repos/<name>/mkdocs.yml` entries. Adding/removing/reordering a top-level tab means editing this file.
- **`mkdocs-monorepo-plugin`** reads each sub-repo's own `mkdocs.yml` for its nav tree and `docs_dir`, then merges all of them into one site build.
- **`overrides/`** is the Material theme's `custom_dir`. It holds two kinds of thing. **`overrides/partials/`** are *forks* of specific mkdocs-material 9.6.7 templates — `nav.html`, `nav-item.html`, `toc.html` and `header.html` render the sidebar and header chrome as real headings and real buttons instead of Material's CSS-only `<label>` + checkbox pairs (plus the pre-existing `copyright.html` and `search.html`); see the **Accessibility** section below before editing any of them, and note that `requirements.txt` pins the theme version because of these forks. **`overrides/main.html`** extends `base.html` to inject Matomo analytics and the remaining WCAG 2.2 AA JS (focus trap for the mobile drawer, bridging the new buttons to the checkboxes that still hold their state, aria-current, external-link `target="_blank"` + "opens in new tab" treatment, swagger iframe titling, skip-link fallback). These exist because Material's stock templates have accessibility gaps — read the inline comments before changing header/nav/drawer behavior, they explain *why* each patch exists, not just what it does. The same file also carries two bug fixes that are not accessibility patches: the swagger iframe sizing/dark-mode fallback described under "Known constraints", and an inline `<style>` in `extrahead` that sizes Material's inline SVG icons. Those icons carry only a `viewBox`, so with no stylesheet applied the header logo renders ~1500px square in black — visible as a flash because `navigation.instant` swaps the stylesheet `<link>` elements on every navigation, and a cold or revalidating fetch leaves a gap with nothing applied. The rule is inline (no network dependency, and Material's head swap only touches `<link>`s) and wrapped in `:where()` so it has zero specificity and never overrides Material's own icon sizing.
- **`docs/stylesheets/extra.css`** adds search-result site-label badges and external-link indicators, plus the styling that supports the partial overrides: user-agent resets for the new `<button>`/`<h*>` nav elements, the breakpoint rules that show exactly one of each section heading/toggle pair, and a block of compatibility shims for Material rules that select on `[for=__drawer]`/`[for=__toc]` (see **Accessibility**). The badge selectors are keyed to each sub-repo's `site_name`-derived URL prefix — if a sub-repo's `site_name` changes, the matching `href*=` selector here must change too.
- **API page**: `docs/api.md` embeds `docs/member_api_v3.yml` via `<swagger-ui src="member_api_v3.yml"/>` (the `mkdocs-swagger-ui-tag` plugin). The committed YAML copy is a fallback for offline `mkdocs serve`; in CI it's overwritten on every build by curling the live spec from `APTrust/registry` (master branch, `member_api_v3.yml` at repo root — note: the *registry* repo, not *registry-docs*). Don't hand-edit the committed spec at all: it won't persist to prod, and the nightly run (see the workflow bullet below) commits the upstream version back over it on `main`. `api.md` also sets `hide: toc` in its front matter: the whole reference lives inside the iframe, so the page generates no headings and Material's secondary sidebar would otherwise sit there as 266px of empty space. Hiding it hands that column to the iframe (757px → ~1032px) without touching `.md-grid`, so the header, tab bar, left nav and footer stay aligned with every other page.
- **`.github/workflows/build-and-deploy.yml`** builds and deploys to `gh-pages` via `peaceiris/actions-gh-pages` (force-orphan, custom domain `docs.aptrust.org`). It fires on: push to `main` in this repo, manual `workflow_dispatch`, `repository_dispatch` (`sub-repo-updated`) sent by each sub-repo's own `notify-parent-docs.yml` workflow when *its* main/master changes, and a nightly `schedule` at 07:00 UTC. That dispatch requires a `DOCS_DISPATCH_TOKEN`/`DOCS_DISPATCH_PAT` fine-grained PAT (Contents: Read and write on `APTrust/aptrust-docs`) stored as a secret in each sub-repo. The nightly schedule exists because the Member API spec lives in `APTrust/registry`, which sends no dispatch here — on `schedule` and `workflow_dispatch` only, Step 5 commits the curled spec back to `main` when it differs, so the offline fallback copy stays current and spec changes get a git history. The commit lives in this workflow rather than a standalone sync workflow because `GITHUB_TOKEN` pushes don't trigger workflow runs (which is also why it can't loop) — a separate workflow would need a PAT to make the site redeploy.

## Known constraints

- **Page `<meta name="description">` comes only from per-page front matter — there is deliberately no `site_description` fallback.** Material's `base.html` prefers `page.meta.description` and falls back to `config.site_description`; setting the latter would stamp one identical boilerplate line onto every page that lacks its own, which is worse for search than letting Google generate a per-page snippet from real content. Use `description: >-` (folded **with** the strip indicator) — a bare `>` leaves a trailing newline that is emitted verbatim inside the `content="…"` attribute. Two gotchas when checking whether the tag is present: that embedded newline breaks single-line regexes, and `/api/` is reserialized by `mkdocs-swagger-ui-tag`'s BeautifulSoup post-page hook, which alphabetizes attributes (`content=` before `name=`) and self-closes void tags — so `grep '<meta name="description"'` reports a false negative on that page even when the tag is there. All five pages this repo owns carry a description; most sub-repo pages do not, and that has to be fixed in those repos.
- **`--strict` is intentionally off** in the build workflow: `dart-docs`'s nav currently references pages that don't exist in the repo. Don't add `--strict` back without first reconciling that nav (see the comment in `build-and-deploy.yml` Step 8).
- **Root-relative internal links** (e.g. `/workers/ingest/bucket-reader`) inside `preserv-docs` and `registry-docs` content don't resolve correctly once merged into the unified site — they need fixing in the source repos, not here.
- **URL prefixes** for each tab come from that sub-repo's `site_name` in its own `mkdocs.yml`, not from this repo's nav labels.
- **`mkdocs-swagger-ui-tag` is incompatible with `navigation.instant`.** The plugin appends its control script to the end of `<body>`, outside `[data-md-component=container]` — the only region Material replaces and re-executes scripts in during instant navigation. Reaching `/api/` from any in-site link therefore left the Swagger iframe at its default ~150px height (looking like it failed to load) and stuck in light mode until a hard refresh. `overrides/main.html` now reproduces the plugin's four jobs from inside `document$` (iframe height callback, `__init_is_dark_mode`, scroll-position feed, palette observer), written so it stays harmless when the plugin's own copy also runs on full page loads. Don't "clean up" that block as duplicate of the plugin — it is the only copy that runs on an instant navigation.
- **`navigation.instant` causes a flash of unstyled content on every navigation, and removing it was considered and deferred (2026-08-14).** On each in-site navigation Material adds the incoming page's stylesheet `<link>` elements and removes the outgoing ones in the same tick; the new elements only apply once loaded, so if that needs the network there is a window with no CSS attached. Measured mid-swap on `mkdocs serve`: `document.styleSheets` 6 → 3, `.md-header` background `rgba(0,0,0,0)`, `.md-nav__list` `list-style: disc` — the nav renders as a plain bullet list. **This is far worse locally than in production**: `mkdocs serve` sends no `Cache-Control`, `ETag` or `Last-Modified` at all, so every navigation refetches all four stylesheets and flashes; GitHub Pages sends `max-age=14400` + ETag, and the identical probe on docs.aptrust.org showed no gap in either direction (styles never detached, zero CSS requests during the swap). Production only hits the window on a genuine first visit or after that 4-hour window expires. Mitigation shipped: the inline icon-sizing `<style>` in `overrides/main.html` (see the `overrides/` bullet above), which keeps the flash to unstyled text instead of a ~1500px black logo. Dropping `navigation.instant` would eliminate it everywhere and retire three workarounds that exist only because of it (the swagger iframe patch, the sidebar scrollbar fix in `extra.css`, the icon guard) — and it measured nearly free on this site: with a warm cache a full page load is 33–86 ms to `domInteractive` and fetches 0 bytes beyond ~16 KB of gzipped HTML (all 13 subresources cached), versus 31–188 ms for an instant swap. It was kept anyway; the real costs of removing it are losing sidebar scroll position across pages and re-running `bundle.js` plus a 626 KB `search_index.json` worker rebuild on every load, which matters on low-end devices. Revisit only if the flash becomes a complaint from actual readers, not from local authoring.
- **MkDocs 2.0 is coming and will break this stack.** It removes the plugin system entirely and switches config from YAML to TOML with no migration path — that breaks `mkdocs-material` (the theme), `mkdocs-monorepo-plugin` (how the four sub-repos are stitched together), and this repo's `mkdocs.yml`. No release date yet; MkDocs 1.x keeps working but won't get further updates, and `mkdocs-material>=9.7.5` already pins `mkdocs<2.0` to prevent an accidental break. The Material maintainer's answer is [Zensical](https://zensical.org), a new (not forked) static site generator aiming to be a drop-in replacement for MkDocs 1.x — plugin-ecosystem support, including monorepo-style multi-repo merging, is not yet complete. Don't touch `requirements.txt`/`mkdocs.yml`/CI over this pre-emptively; re-check Zensical's plugin compatibility (especially anything replacing `mkdocs-monorepo-plugin`) before planning a migration. Source: https://squidfunk.github.io/mkdocs-material/blog/2026/02/18/mkdocs-2.0/

## Accessibility

The site is audited externally (Ablr) against WCAG 2.2 AA. **Read this before
touching anything in `overrides/` or the sidebar.**

### The rule that keeps getting broken

**ARIA cannot repair the wrong element.** Material for MkDocs builds its header
and sidebar chrome out of CSS-only `<label>` + hidden-checkbox pairs. A `<label>`
maps to `generic`, and ARIA in HTML permits **no `role` and no `aria-label`** on
it. Two separate rounds of audit findings came from trying to patch those labels
with ARIA instead of rendering the right element:

- `role="heading"` on `label.md-nav__title` — invalid, so AT discarded it and the
  auditor re-reported "the visual headings still announce as clickable".
- `aria-label` on `label.md-header__button` — a *serious* axe
  `aria-prohibited-attr` violation on every page.

Both are fixed by template overrides that emit real `<h2>`–`<h6>` and real
`<button>` elements. The hidden checkbox stays as the state holder, so Material's
own `:checked ~ …` CSS is untouched; small handlers in `overrides/main.html`
bridge button to checkbox and keep `aria-expanded` truthful.

### Sidebar section headers are viewport-dependent — do not "simplify" this

Every one of Material's `.md-nav__item--section` rules is scoped to
`@media (min-width: 76.25em)`. So the same nav item is two different things:

| Width | What it is | What we render |
|---|---|---|
| ≥ 76.25em (desktop) | inert visual heading — the theme sets `pointer-events: none` and leaves `tabindex` empty **on purpose** | real `<h3>`/`<h4>` |
| < 76.25em (drawer) | genuine slide-in panel toggle, with a chevron | real `<button aria-expanded aria-controls>` |

`overrides/partials/nav-item.html` renders **both** and CSS shows exactly one
(`display: none` also removes the other from the accessibility tree, so AT never
meets one item with two roles). Rendering only the heading strands every child
page in the mobile drawer; rendering only the toggle reproduces the original
finding on desktop.

**Section headers must never be given a `tabindex`, a `role`, or an event
handler.** The regression that failed the re-audit was a JS sweep over
`label[for^="__nav_"]` that forced `tabindex="0"` onto them, creating
keyboard-focusable controls that were `pointer-events: none` and whose checkbox
did nothing — precisely "announces as Clickable, but doesn't redirect the user".

### Overridden partials are forks — re-diff them on upgrade

`overrides/partials/{nav,nav-item,toc,header}.html` are copies of
mkdocs-material 9.6.7's templates with marked edits. `requirements.txt` pins
`mkdocs-material==9.6.7` **because of this**. Each file's header comment carries
the upstream md5; diff against the installed theme before bumping the pin.

`docs/stylesheets/extra.css` also carries a "Compatibility shims" block, and it
is load-bearing: several Material rules select on the literal attributes
`[for=__drawer]`, `[for=__search]` and `[for=__toc]`, which stopped matching once
those elements were no longer `<label>`s. Each shim reproduces one upstream rule
against the equivalent class or data attribute, at the same breakpoint. Missing
one is a *visual* regression that the automated check cannot see — the hamburger
reappearing on desktop, the drawer header losing its indigo background — so
always eyeball the header and sidebar at both widths after touching a partial,
and re-diff these shims when bumping the theme.

Two things are deliberately *not* converted: the **palette toggles** (their
`<input type="radio">` is only visually hidden, so it stays focusable, in the
accessibility tree, and already carries a valid `aria-label` — the `<label>` is
just the icon), and the **overlay backdrop** (decorative; Escape and the drawer's
Close button are the real exits).

### Verifying — do both before telling the auditor to retest

**1. Automated.** `cd tools/a11y-check && npm run a11y` — 7 pages x 3 viewport
states, axe-core plus assertions read from Chrome's real accessibility tree. See
`tools/a11y-check/README.md`. `report/*.ax.json` is the evidence pack to send the
auditor: it shows the role and name the screen reader actually receives.

**2. Manual, with VoiceOver.** Automated checks cannot confirm how a screen
reader speaks. At 1280px and at 375px:

- Rotor → Headings lists the sidebar section headers. Each announces
  **"heading level N"** — never "clickable".
- Tab through the sidebar on desktop: section headers are **skipped entirely**.
- In the mobile drawer: section items announce **"<name>, collapsed/expanded,
  button"**, and Enter/Space visibly slides the panel in.
- Open the drawer: focus lands on **Close**, Tab stays trapped inside, Escape
  closes and returns focus to the hamburger.
- The sidebar logo is silent (decorative); the header logo still announces as the
  home link.

### Gotcha when testing locally

`mkdocs serve` does **not** watch `overrides/`. Editing a template there will not
trigger a rebuild — touch a file under `docs/` or restart the server, or you will
spend a while debugging markup the browser never received.

## Keeping docs in sync

`README.md` and this file cover overlapping ground (repo structure, build steps, workflow triggers) for two different audiences — README for humans, this file for Claude. When a change touches either one (adding a sub-repo, changing the build/deploy workflow, adding a new page type), check whether the other needs the same update too.

## Adding things

- **New sub-repo tab**: add an `!include` entry to `nav:` in `mkdocs.yml`; add a matching `git clone` line to the workflow's Clone step; add `notify-parent-docs.yml` + `DOCS_DISPATCH_TOKEN` to the new sub-repo; add a badge selector to `docs/stylesheets/extra.css`.
- **New Swagger/API page**: copy the spec into `docs/` (avoids cross-origin fetch issues locally), reference it with `<swagger-ui src="../your-spec.yml"/>`, add it to `nav:`, and if the spec lives in another repo add a `curl` refresh step to the workflow like the existing Member API step.
- **New bridge page**: add a markdown file in `docs/` linking to the external content, then add it to `nav:`.
