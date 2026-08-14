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
- **`overrides/`** is the Material theme's `custom_dir`. `overrides/main.html` extends `base.html` to inject Matomo analytics and a large block of WCAG 2.2 AA JS patches (keyboard-operable drawer/nav toggles, focus trap for the mobile drawer, aria-label/aria-current fixes, external-link `target="_blank"` + "opens in new tab" treatment, swagger iframe titling, skip-link fallback). These patches exist because Material's stock templates have accessibility gaps — read the inline comments in that file before changing header/nav/drawer behavior, they explain *why* each patch exists, not just what it does. The same file also carries two bug fixes that are not accessibility patches: the swagger iframe sizing/dark-mode fallback described under "Known constraints", and an inline `<style>` in `extrahead` that sizes Material's inline SVG icons. Those icons carry only a `viewBox`, so with no stylesheet applied the header logo renders ~1500px square in black — visible as a flash because `navigation.instant` swaps the stylesheet `<link>` elements on every navigation, and a cold or revalidating fetch leaves a gap with nothing applied. The rule is inline (no network dependency, and Material's head swap only touches `<link>`s) and wrapped in `:where()` so it has zero specificity and never overrides Material's own icon sizing.
- **`docs/stylesheets/extra.css`** adds search-result site-label badges and external-link indicators. The badge selectors are keyed to each sub-repo's `site_name`-derived URL prefix — if a sub-repo's `site_name` changes, the matching `href*=` selector here must change too.
- **API page**: `docs/api.md` embeds `docs/member_api_v3.yml` via `<swagger-ui src="member_api_v3.yml"/>` (the `mkdocs-swagger-ui-tag` plugin). The committed YAML copy is a fallback for offline `mkdocs serve`; in CI it's overwritten on every build by curling the live spec from `APTrust/registry` (master branch, `member_api_v3.yml` at repo root — note: the *registry* repo, not *registry-docs*). Don't hand-edit the committed spec expecting it to persist to prod. `api.md` also sets `hide: toc` in its front matter: the whole reference lives inside the iframe, so the page generates no headings and Material's secondary sidebar would otherwise sit there as 266px of empty space. Hiding it hands that column to the iframe (757px → ~1032px) without touching `.md-grid`, so the header, tab bar, left nav and footer stay aligned with every other page.
- **`.github/workflows/build-and-deploy.yml`** builds and deploys to `gh-pages` via `peaceiris/actions-gh-pages` (force-orphan, custom domain `docs.aptrust.org`). It fires on: push to `main` in this repo, manual `workflow_dispatch`, and `repository_dispatch` (`sub-repo-updated`) sent by each sub-repo's own `notify-parent-docs.yml` workflow when *its* main/master changes. That dispatch requires a `DOCS_DISPATCH_TOKEN`/`DOCS_DISPATCH_PAT` fine-grained PAT (Contents: Read and write on `APTrust/aptrust-docs`) stored as a secret in each sub-repo.

## Known constraints

- **Page `<meta name="description">` comes only from per-page front matter — there is deliberately no `site_description` fallback.** Material's `base.html` prefers `page.meta.description` and falls back to `config.site_description`; setting the latter would stamp one identical boilerplate line onto every page that lacks its own, which is worse for search than letting Google generate a per-page snippet from real content. Use `description: >-` (folded **with** the strip indicator) — a bare `>` leaves a trailing newline that is emitted verbatim inside the `content="…"` attribute. Two gotchas when checking whether the tag is present: that embedded newline breaks single-line regexes, and `/api/` is reserialized by `mkdocs-swagger-ui-tag`'s BeautifulSoup post-page hook, which alphabetizes attributes (`content=` before `name=`) and self-closes void tags — so `grep '<meta name="description"'` reports a false negative on that page even when the tag is there. All five pages this repo owns carry a description; most sub-repo pages do not, and that has to be fixed in those repos.
- **`--strict` is intentionally off** in the build workflow: `dart-docs`'s nav currently references pages that don't exist in the repo. Don't add `--strict` back without first reconciling that nav (see the comment in `build-and-deploy.yml` Step 8).
- **Root-relative internal links** (e.g. `/workers/ingest/bucket-reader`) inside `preserv-docs` and `registry-docs` content don't resolve correctly once merged into the unified site — they need fixing in the source repos, not here.
- **URL prefixes** for each tab come from that sub-repo's `site_name` in its own `mkdocs.yml`, not from this repo's nav labels.
- **`mkdocs-swagger-ui-tag` is incompatible with `navigation.instant`.** The plugin appends its control script to the end of `<body>`, outside `[data-md-component=container]` — the only region Material replaces and re-executes scripts in during instant navigation. Reaching `/api/` from any in-site link therefore left the Swagger iframe at its default ~150px height (looking like it failed to load) and stuck in light mode until a hard refresh. `overrides/main.html` now reproduces the plugin's four jobs from inside `document$` (iframe height callback, `__init_is_dark_mode`, scroll-position feed, palette observer), written so it stays harmless when the plugin's own copy also runs on full page loads. Don't "clean up" that block as duplicate of the plugin — it is the only copy that runs on an instant navigation.
- **`navigation.instant` causes a flash of unstyled content on every navigation, and removing it was considered and deferred (2026-08-14).** On each in-site navigation Material adds the incoming page's stylesheet `<link>` elements and removes the outgoing ones in the same tick; the new elements only apply once loaded, so if that needs the network there is a window with no CSS attached. Measured mid-swap on `mkdocs serve`: `document.styleSheets` 6 → 3, `.md-header` background `rgba(0,0,0,0)`, `.md-nav__list` `list-style: disc` — the nav renders as a plain bullet list. **This is far worse locally than in production**: `mkdocs serve` sends no `Cache-Control`, `ETag` or `Last-Modified` at all, so every navigation refetches all four stylesheets and flashes; GitHub Pages sends `max-age=14400` + ETag, and the identical probe on docs.aptrust.org showed no gap in either direction (styles never detached, zero CSS requests during the swap). Production only hits the window on a genuine first visit or after that 4-hour window expires. Mitigation shipped: the inline icon-sizing `<style>` in `overrides/main.html` (see the `overrides/` bullet above), which keeps the flash to unstyled text instead of a ~1500px black logo. Dropping `navigation.instant` would eliminate it everywhere and retire three workarounds that exist only because of it (the swagger iframe patch, the sidebar scrollbar fix in `extra.css`, the icon guard) — and it measured nearly free on this site: with a warm cache a full page load is 33–86 ms to `domInteractive` and fetches 0 bytes beyond ~16 KB of gzipped HTML (all 13 subresources cached), versus 31–188 ms for an instant swap. It was kept anyway; the real costs of removing it are losing sidebar scroll position across pages and re-running `bundle.js` plus a 626 KB `search_index.json` worker rebuild on every load, which matters on low-end devices. Revisit only if the flash becomes a complaint from actual readers, not from local authoring.
- **MkDocs 2.0 is coming and will break this stack.** It removes the plugin system entirely and switches config from YAML to TOML with no migration path — that breaks `mkdocs-material` (the theme), `mkdocs-monorepo-plugin` (how the four sub-repos are stitched together), and this repo's `mkdocs.yml`. No release date yet; MkDocs 1.x keeps working but won't get further updates, and `mkdocs-material>=9.7.5` already pins `mkdocs<2.0` to prevent an accidental break. The Material maintainer's answer is [Zensical](https://zensical.org), a new (not forked) static site generator aiming to be a drop-in replacement for MkDocs 1.x — plugin-ecosystem support, including monorepo-style multi-repo merging, is not yet complete. Don't touch `requirements.txt`/`mkdocs.yml`/CI over this pre-emptively; re-check Zensical's plugin compatibility (especially anything replacing `mkdocs-monorepo-plugin`) before planning a migration. Source: https://squidfunk.github.io/mkdocs-material/blog/2026/02/18/mkdocs-2.0/

## Keeping docs in sync

`README.md` and this file cover overlapping ground (repo structure, build steps, workflow triggers) for two different audiences — README for humans, this file for Claude. When a change touches either one (adding a sub-repo, changing the build/deploy workflow, adding a new page type), check whether the other needs the same update too.

## Adding things

- **New sub-repo tab**: add an `!include` entry to `nav:` in `mkdocs.yml`; add a matching `git clone` line to the workflow's Clone step; add `notify-parent-docs.yml` + `DOCS_DISPATCH_TOKEN` to the new sub-repo; add a badge selector to `docs/stylesheets/extra.css`.
- **New Swagger/API page**: copy the spec into `docs/` (avoids cross-origin fetch issues locally), reference it with `<swagger-ui src="../your-spec.yml"/>`, add it to `nav:`, and if the spec lives in another repo add a `curl` refresh step to the workflow like the existing Member API step.
- **New bridge page**: add a markdown file in `docs/` linking to the external content, then add it to `nav:`.
