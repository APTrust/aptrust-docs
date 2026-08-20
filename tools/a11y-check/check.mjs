/**
 * Accessibility regression check for the APTrust docs site.
 *
 * Two layers, because they catch different things:
 *
 *   1. axe-core — the same engine behind Deque's axe Auditor, which is what our
 *      external auditor (Ablr) runs. Catches the rule-based violations.
 *
 *   2. Structural assertions read from Chrome's REAL accessibility tree, via
 *      CDP Accessibility.getFullAXTree. This layer exists because axe did NOT
 *      catch the finding that prompted this tool: a <label> that looks like a
 *      heading, announces as "clickable", and does nothing when activated is
 *      invisible to rule-based scanning but obvious to a screen-reader user.
 *      The AX tree is literally what the screen reader consumes, so "does it
 *      announce as a heading" becomes a machine-checked assertion.
 *
 * Usage:
 *   npm run setup     # once
 *   npm run a11y      # builds the site, serves it, sweeps, writes report/
 *
 * Exit code is non-zero if any check fails, so this can gate a release.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../..');
const SITE = join(REPO, 'site');
const REPORT = join(HERE, 'report');
const PORT = 8199;

/* The pages to sweep: one from this repo, one from each sub-repo tab, the
   Swagger page (different enough to be worth its own pass), and a deep nested
   page where the sidebar is at its most complex. */
const PAGES = [
  '/',
  '/user-guide/',
  '/user-guide/preservation/ingest/',
  '/dart-docs/',
  '/registry-docs/',
  '/api/',
  '/policies/',
];

/* Desktop, mobile with the drawer shut, and mobile with the drawer open. The
   drawer-open state matters: it is the only state in which the sidebar's own
   header, close button and back buttons are on screen. */
const STATES = [
  { name: 'desktop',      width: 1280, height: 800, drawer: false },
  { name: 'mobile',       width: 375,  height: 812, drawer: false },
  { name: 'mobile-drawer', width: 375, height: 812, drawer: true  },
  /* 320px is the width WCAG 1.4.10 (Reflow) names, and the width the auditor
     tested — 1366x768 zoomed to 200% is the same CSS viewport. The drawer is
     at its most cramped here, so it is the state where an off-screen or
     covered tab stop shows up. */
  { name: 'mobile-320-drawer', width: 320, height: 512, drawer: true },
];

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.yml': 'text/yaml; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8',
  '.ico': 'image/x-icon', '.map': 'application/json; charset=utf-8',
};

function serveSite() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      /* Contain path traversal: resolve, then require the result to stay
         inside SITE. */
      const full = normalize(join(SITE, p));
      if (!full.startsWith(SITE)) { res.writeHead(403).end('forbidden'); return; }
      const body = await readFile(full);
      res.writeHead(200, { 'content-type': MIME[extname(full)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

/* ------------------------------------------------------------------------ */
/* Structural assertions, evaluated in the page.                             */
/*                                                                          */
/* Each returns a list of failures. Empty list = pass. The ax argument is a  */
/* map from backendDOMNodeId to the node's real accessibility-tree entry.    */
/* ------------------------------------------------------------------------ */

const STRUCTURAL_CHECKS = `
(() => {
  const fail = [];
  const add = (id, msg) => fail.push({ check: id, detail: msg });

  const sidebars = [...document.querySelectorAll('.md-sidebar')];
  const visible = (e) => {
    if (!e.isConnected) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return e.getBoundingClientRect().height > 0 || e.getBoundingClientRect().width > 0;
  };
  const hidden = (e) => e.closest('[aria-hidden="true"]') !== null;
  const label = (e) => (e.textContent || '').trim().split('\\n')[0].trim().slice(0, 40);

  /* 1. No <label> in a sidebar may carry a role. ARIA in HTML permits no role
        on <label>, so any such markup is invalid and AT may discard it. This is
        exactly how the previous attempted fix failed. */
  for (const sb of sidebars) {
    for (const el of sb.querySelectorAll('label[role]')) {
      add('label-with-role', 'label[role=' + el.getAttribute('role') + '] "' + label(el) + '"');
    }
  }

  /* 2. Section items render as a heading/toggle pair (see nav-item.html):
        the heading is the desktop form, the toggle is the drawer form. Assert
        that EXACTLY ONE of the pair is visible, and that whichever it is has
        the right element type. Both visible would mean AT meets the same item
        twice with two different roles; neither would mean the section vanished. */
  for (const sb of sidebars) {
    for (const item of sb.querySelectorAll('.md-nav__item--section')) {
      const shown = [...item.children].filter((e) => e.matches('.md-nav__link') && visible(e));
      if (shown.length === 0) continue;                 // whole section is off-screen
      if (shown.length > 1) {
        add('section-double-exposed', shown.map((e) => e.tagName).join(' + ') + ' "' + label(shown[0]) + '"');
        continue;
      }
      const el = shown[0];
      const isHeading = /^H[1-6]$/.test(el.tagName);
      const isToggle = el.tagName === 'BUTTON' && el.classList.contains('md-nav__link--section-toggle');
      if (!isHeading && !isToggle) {
        add('section-wrong-element', el.tagName + '.' + el.className + ' "' + label(el) + '"');
      }
      /* Whichever form is showing, it must never be a <label> or otherwise
         announce as clickable while doing nothing — the original finding. */
      if (el.tagName === 'LABEL') add('section-is-label', label(el));
      if (isHeading) {
        const ti = el.getAttribute('tabindex');
        if (ti !== null && ti !== '-1') add('section-heading-focusable', label(el) + ' tabindex=' + ti);
      }
    }
  }

  /* 3. Nothing may be both a heading and an interactive control. A focusable
        heading, or a heading bound to a form control via for=, is the
        "announces as clickable" defect. */
  for (const sb of sidebars) {
    for (const el of sb.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      if (!visible(el)) continue;
      const ti = el.getAttribute('tabindex');
      if (ti !== null && ti !== '-1') add('heading-focusable', label(el) + ' has tabindex=' + ti);
      if (el.hasAttribute('for')) add('heading-is-label', label(el) + ' has for=' + el.getAttribute('for'));
      if (el.closest('a[href], button')) add('heading-inside-control', label(el));
    }
  }

  /* 4. No visible sidebar link may point at the page the user is already on —
        the audit's "an <a> tag that doesn't take the user anywhere". Anchors
        (#fragment) are legitimate in-page navigation and are exempt. */
  for (const sb of sidebars) {
    for (const a of sb.querySelectorAll('a[href]')) {
      if (!visible(a) || hidden(a)) continue;
      const href = a.getAttribute('href');
      if (href.startsWith('#')) continue;
      const target = new URL(a.href);
      if (target.hash) continue;
      if (target.origin + target.pathname === location.origin + location.pathname) {
        /* A nav entry for the page you are on is normal and expected — as long
           as it is announced as the current page. Without aria-current it is
           the audit's "link that doesn't take the user anywhere". */
        if (a.getAttribute('aria-current') !== 'page') {
          add('self-link-without-aria-current', '"' + label(a) + '" -> ' + href);
        }
      }
    }
  }

  /* 5. aria-expanded is only valid on certain roles; role="navigation" is not
        one of them. Material ships this on its nested <nav> by default. */
  for (const el of document.querySelectorAll('nav[aria-expanded], [role="navigation"][aria-expanded]')) {
    add('aria-expanded-on-nav', el.tagName + '.' + el.className);
  }

  /* 6. Every disclosure button's aria-expanded must match the checkbox that
        actually holds the state, or AT announces the wrong thing. */
  for (const btn of document.querySelectorAll('.md-nav__link--toggle[aria-controls]')) {
    const cb = document.getElementById(btn.getAttribute('aria-controls').replace(/_content$/, ''));
    if (!cb) { add('toggle-no-state', label(btn)); continue; }
    if (btn.getAttribute('aria-expanded') !== String(cb.checked)) {
      add('aria-expanded-stale',
          label(btn) + ' says ' + btn.getAttribute('aria-expanded') + ' but checkbox is ' + cb.checked);
    }
  }

  /* 7. Nothing focusable may sit inside an aria-hidden subtree: AT skips it
        while the keyboard still lands on it. */
  for (const el of document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button')) {
    if (el.getAttribute('tabindex') !== '-1') add('focusable-in-aria-hidden', el.tagName + ' "' + label(el) + '"');
  }

  /* 8. WCAG 1.4.10 (Reflow), the finding this check was added for. The mobile
        drawer is a stack of absolutely-positioned panels: Material moves the
        collapsed ones off-canvas with a transform only, and an open panel
        covers its parent. Neither is hidden from the tab order by the theme, so
        without the drawer reflow rules in extra.css the keyboard walks through
        ~200 controls the user cannot see, and the browser scrolls the visible
        panel away trying to reveal them.

        Assert the tab order matches the screen: every tabbable sidebar control
        must be inside the viewport AND be the topmost thing at its own centre.
        Only meaningful with the drawer open at the drawer breakpoint. */
  const drawerCb = document.getElementById('__drawer');
  const sidebar = document.querySelector('.md-sidebar--primary');
  if (drawerCb && drawerCb.checked && sidebar &&
      matchMedia('(max-width: 76.234375em)').matches) {
    for (const el of sidebar.querySelectorAll('a[href], button')) {
      if (el.getAttribute('tabindex') === '-1' || hidden(el)) continue;
      if (!visible(el)) continue;
      /* Emulate what focusing actually does: browsers scroll a focused element
         into view. An item merely below the fold of the drawer's scrollable
         list is fine — the scroll reveals it. An item parked off-canvas by a
         transform cannot be scrolled to, so it stays outside. */
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
        add('tabbable-offscreen-in-drawer',
            '"' + label(el) + '" still at ' + Math.round(r.left) + ',' + Math.round(r.top) +
            ' after scrollIntoView');
        continue;
      }
      const top = document.elementFromPoint(cx, cy);
      if (top !== el && !el.contains(top)) {
        add('tabbable-covered-in-drawer',
            '"' + label(el) + '" covered by ' +
            (top ? top.tagName + '.' + String(top.className).slice(0, 40) : 'nothing'));
      }
    }
    /* Leave the drawer as we found it so the evidence screenshot below shows
       the top of the nav rather than wherever the sweep left it. */
    sidebar.querySelectorAll('.md-nav__list, .md-sidebar__scrollwrap')
      .forEach((e) => { e.scrollTop = 0; });
    window.scrollTo(0, 0);
  }

  return fail;
})()
`;

/* Assertions that need the real accessibility tree rather than the DOM.
   This is the layer that would have caught the original finding: it asks what
   the screen reader is actually handed, not what the markup looks like. */
function axChecks(axByKey, domInfo) {
  const fail = [];
  const nameOf = (n) => ((n.name && n.name.value) || '').trim();
  const roleOf = (n) => (n.role && n.role.value) || '';

  for (const el of domInfo) {
    const node = axByKey.get(el.key);
    if (!node) continue;                  // not exposed to AT at all — fine

    if (el.kind === 'control') {
      /* Every operable control must announce a name. An unnamed control is the
         "clickable, no label" case the audit reported for the nav toggles. */
      if (!nameOf(node)) {
        fail.push({ check: 'control-without-name', detail: `${el.tag}.${el.cls} role=${roleOf(node)} "${el.text}"` });
      }
      /* A control must not be exposed as a heading. */
      if (roleOf(node) === 'heading') {
        fail.push({ check: 'control-exposed-as-heading', detail: `${el.tag} "${el.text}"` });
      }
    }

    if (el.kind === 'heading') {
      if (roleOf(node) !== 'heading') {
        fail.push({ check: 'heading-not-exposed-as-heading', detail: `${el.tag} "${el.text}" -> role=${roleOf(node)}` });
      }
      if (!nameOf(node)) {
        fail.push({ check: 'heading-without-name', detail: `${el.tag} "${el.text}"` });
      }
    }
  }
  return fail;
}

async function run() {
  if (!existsSync(SITE)) throw new Error(`No build at ${SITE} — run \`mkdocs build\` first.`);
  await rm(REPORT, { recursive: true, force: true });
  await mkdir(REPORT, { recursive: true });

  const server = await serveSite();
  /* Prefer Playwright's pinned Chromium; fall back to the system Chrome so the
     check is runnable without waiting on `npx playwright install`. */
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    console.log('Bundled Chromium not installed — falling back to system Chrome.');
    browser = await chromium.launch({ channel: 'chrome' });
  }
  const axeSource = await readFile(join(HERE, 'node_modules/axe-core/axe.min.js'), 'utf8');

  const results = [];
  let failures = 0;

  for (const state of STATES) {
    const ctx = await browser.newContext({ viewport: { width: state.width, height: state.height } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');

    for (const path of PAGES) {
      const url = `http://127.0.0.1:${PORT}${path}`;
      const id = `${state.name}${path.replace(/\//g, '_') || '_root'}`;
      await page.goto(url, { waitUntil: 'networkidle' });

      if (state.drawer) {
        await page.evaluate(() => {
          const cb = document.getElementById('__drawer');
          if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
        });
        await page.waitForTimeout(400);
      }

      /* --- axe-core --- */
      await page.addScriptTag({ content: axeSource });
      const axe = await page.evaluate(
        (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
        AXE_TAGS,
      );
      const violations = axe.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      }));

      /* --- structural assertions (DOM) --- */
      const structural = await page.evaluate(STRUCTURAL_CHECKS);

      /* --- structural assertions (real accessibility tree) --- */
      /* Tag the visible elements we care about, then resolve them through CDP.
         Going via a data attribute keeps this on public CDP surface (no
         JSHandle internals) and guarantees the DOM metadata and the AX nodes
         refer to the same elements. */
      const domInfo = await page.evaluate(() => {
        document.querySelectorAll('[data-a11y-check]').forEach((e) => e.removeAttribute('data-a11y-check'));
        const visible = (e) => {
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const r = e.getBoundingClientRect();
          return r.height > 0 || r.width > 0;
        };
        const grab = (sel, kind) => [...document.querySelectorAll(sel)]
          .filter((e) => visible(e) && !e.closest('[aria-hidden="true"]'))
          .map((e, i) => {
            const key = kind + ':' + i;
            e.setAttribute('data-a11y-check', key);
            return { key, kind, tag: e.tagName, cls: e.className.toString().slice(0, 50),
                     text: (e.textContent || '').trim().split('\n')[0].trim().slice(0, 40) };
          });
        return [
          ...grab('.md-sidebar a[href], .md-sidebar button', 'control'),
          ...grab('.md-sidebar h1, .md-sidebar h2, .md-sidebar h3, .md-sidebar h4, .md-sidebar h5, .md-sidebar h6', 'heading'),
        ];
      });

      const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
        nodeId: root.nodeId, selector: '[data-a11y-check]',
      });
      const axByKey = new Map();
      for (const nodeId of nodeIds) {
        const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
        const ai = attributes.indexOf('data-a11y-check');
        if (ai === -1) continue;
        const key = attributes[ai + 1];
        const { nodes } = await cdp.send('Accessibility.queryAXTree', { nodeId }).catch(() => ({ nodes: [] }));
        /* queryAXTree returns the node plus its descendants; the first
           non-ignored entry is the element's own accessibility node. */
        const own = nodes.find((n) => !n.ignored);
        if (own) axByKey.set(key, own);
      }

      const axFail = axChecks(axByKey, domInfo);

      /* --- evidence for the auditor --- */
      /* Evidence pack: what the screen reader is handed for each sidebar
         element, in document order. This is what to send the auditor. */
      const sidebarAx = domInfo.map((el) => {
        const n = axByKey.get(el.key);
        return { tag: el.tag, text: el.text,
                 role: n ? (n.role && n.role.value) || '' : '(not exposed)',
                 name: n ? ((n.name && n.name.value) || '') : '' };
      });
      await writeFile(join(REPORT, `${id}.ax.json`), JSON.stringify(sidebarAx, null, 2));
      await page.screenshot({ path: join(REPORT, `${id}.png`), fullPage: false });

      const allFail = [...structural, ...axFail];
      failures += violations.length + allFail.length;
      results.push({ state: state.name, path, violations, structural: allFail });

      const mark = violations.length + allFail.length === 0 ? 'PASS' : 'FAIL';
      console.log(`${mark}  ${state.name.padEnd(14)} ${path.padEnd(36)} axe:${violations.length} structural:${allFail.length}`);
      for (const v of violations) console.log(`        axe/${v.id} (${v.impact}) x${v.nodes}: ${v.targets[0] || ''}`);
      for (const f of allFail) console.log(`        ${f.check}: ${f.detail}`);
    }
    await ctx.close();
  }

  await writeFile(join(REPORT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();

  console.log(`\nReport written to ${REPORT}`);
  if (failures) {
    console.error(`\n${failures} accessibility failure(s).`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

/* Rebuild first so the check always reflects current sources. */
console.log('Building site...');
await execFileAsync('mkdocs', ['build'], { cwd: REPO }).catch((e) => {
  console.error('mkdocs build failed:', e.stderr || e.message);
  process.exit(1);
});
await run();
