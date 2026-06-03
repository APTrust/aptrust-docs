# APTrust Documentation

Unified documentation site for APTrust, combining four previously separate doc repos into a single site using [mkdocs-monorepo-plugin](https://github.com/backstage/mkdocs-monorepo-plugin).

**Live site:** https://aptrust.github.io/aptrust-docs/

---

## What's in this repo

This repo contains only the scaffolding for the unified site. It does not contain the actual documentation content — that lives in the four source repos below.

| Tab | Source repo | URL path |
|---|---|---|
| User Guide | [APTrust/userguide](https://github.com/APTrust/userguide) | `/aptrust-user-guide/` |
| DART | [APTrust/dart-docs](https://github.com/APTrust/dart-docs) | `/dart-documentation/` |
| Preservation Services | [APTrust/preserv-docs](https://github.com/APTrust/preserv-docs) | `/aptrust-preservation-services/` |
| Registry | [APTrust/registry-docs](https://github.com/APTrust/registry-docs) | `/aptrust-registry/` |

Files in this repo:

```
mkdocs.yml          # Root MkDocs config — theme, plugins, nav with !include entries
requirements.txt    # Python dependencies for building the site
docs/
└── index.md        # Landing page (the only content file owned by this repo)
.github/
└── workflows/
    └── build-and-deploy.yml
```

## How the build works

At build time, each sub-repo is cloned into `repos/` at the project root. The `mkdocs-monorepo-plugin` reads each sub-repo's `mkdocs.yml` to get its navigation tree, then merges all four into a single site. Sub-repos live in `repos/` rather than `docs/` so MkDocs's own file scanner doesn't pick them up as a second copy of the content.

```
repos/               ← created at build time, not committed
├── preserv/         ← clone of APTrust/preserv-docs
├── registry/        ← clone of APTrust/registry-docs
├── dart/            ← clone of APTrust/dart-docs
└── userguide/       ← clone of APTrust/userguide
```

## Automatic deploys

The build-and-deploy workflow runs on three triggers:

1. **Push to `main` in this repo** — for changes to the landing page, `mkdocs.yml`, or `requirements.txt`.

2. **Push to `master` in any sub-repo** — each sub-repo has a `.github/workflows/notify-parent-docs.yml` that sends a `repository_dispatch` event here when content changes. This requires a secret named `DOCS_DISPATCH_TOKEN` in each sub-repo: a fine-grained PAT with **Actions: write** permission on this repo (`APTrust/aptrust-docs`).

3. **Manual run** — from the Actions tab → Build and Deploy Documentation → Run workflow.

The workflow clones the four sub-repos, runs `mkdocs build`, and deploys the output to the `gh-pages` branch via [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages). GitHub Pages serves from that branch.

## Building locally

```bash
pip install -r requirements.txt

# Clone the sub-repos into repos/
git clone --depth 1 https://github.com/APTrust/preserv-docs  repos/preserv
git clone --depth 1 https://github.com/APTrust/registry-docs  repos/registry
git clone --depth 1 https://github.com/APTrust/dart-docs      repos/dart
git clone --depth 1 https://github.com/APTrust/userguide      repos/userguide

mkdocs serve     # live preview at http://127.0.0.1:8000
mkdocs build     # write static site to ./site/
```

## Adding or removing a sub-repo

1. Add an `!include` entry to the `nav:` block in `mkdocs.yml`.
2. Add a matching `git clone` line to the Clone step in `.github/workflows/build-and-deploy.yml`.
3. Add `notify-parent-docs.yml` to the new sub-repo and configure `DOCS_DISPATCH_TOKEN` in its secrets.

## Known issues

- **Internal absolute links**: preserv-docs and registry-docs contain links written as root-relative paths (e.g., `/workers/ingest/bucket-reader`) that worked on their standalone sites but don't resolve correctly in the unified site. These need to be fixed in the source repos.
- **URL namespaces**: The monorepo plugin derives URL path prefixes from each sub-repo's `site_name` (e.g., "APTrust Preservation Services" → `aptrust-preservation-services/`). To change the URL prefix, change `site_name` in the sub-repo's `mkdocs.yml`.
