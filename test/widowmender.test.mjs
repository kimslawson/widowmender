// Browser-driven tests for widow-mender.js. Runs the real library in real
// Chromium, measures real line layout, and asserts on the outcome.
//
//   npm install
//   npm test
//
// Widths are discovered at runtime (by measuring where the fixture text
// naturally leaves a one-word last line) so the tests don't depend on any
// particular font being installed.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'widow-mender.js');
const DEMO = path.join(ROOT, 'widowmender-demo.html');

const FIXTURE_TEXT =
  'The point of all this tinkering is that a paragraph should end with some grace instead of leaving one word to fend for itself at the end';

const FIXTURE_HTML = `
<style>body{ margin: 0; font: 16px/1.5 Georgia, serif; }</style>
<div><p id="p" class="widow">${FIXTURE_TEXT}</p></div>
`;

// In-page helpers, installed on every test page.
const HELPERS = () => {
  // Group the library's .wm-word spans into rendered lines.
  window.measure = (el) => {
    const words = Array.from(el.querySelectorAll('.wm-word'));
    const lines = [];
    let lastTop = null;
    for (const w of words) {
      const top = Math.round(w.getBoundingClientRect().top);
      if (lastTop === null || Math.abs(top - lastTop) > 1) {
        lines.push([]);
        lastTop = top;
      }
      lines[lines.length - 1].push(w.textContent);
    }
    return { lineCount: lines.length, last: lines[lines.length - 1] || [] };
  };

  // Measure how the element lays out naturally, without the library:
  // temporarily wrap each word in a bare span, read line groups, restore.
  window.naturalLines = (el) => {
    const orig = el.innerHTML;
    const text = el.textContent.trim();
    el.textContent = '';
    const spans = text.split(/\s+/).map((word, i) => {
      if (i) el.appendChild(document.createTextNode(' '));
      const s = document.createElement('span');
      s.textContent = word;
      el.appendChild(s);
      return s;
    });
    const lines = [];
    let lastTop = null;
    for (const s of spans) {
      const top = Math.round(s.getBoundingClientRect().top);
      if (lastTop === null || Math.abs(top - lastTop) > 1) {
        lines.push([]);
        lastTop = top;
      }
      lines[lines.length - 1].push(s.textContent);
    }
    el.innerHTML = orig;
    return { lineCount: lines.length, last: lines[lines.length - 1] || [] };
  };

  // Find a pixel width at which the element's natural last line has exactly
  // `n` words (and at least 3 lines total, so there's a real body of text).
  window.findWidthFor = (el, n, lo = 160, hi = 640) => {
    for (let w = hi; w >= lo; w -= 2) {
      el.style.width = w + 'px';
      const m = window.naturalLines(el);
      if (m.lineCount >= 3 && m.last.length === n) return w;
    }
    return null;
  };
};

let browser;
let passed = 0;
const failures = [];

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    // Version-mismatched browser download; fall back to the system chromium.
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

async function newFixturePage(html = FIXTURE_HTML) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  await page.addScriptTag({ path: LIB });
  await page.evaluate(HELPERS);
  return page;
}

// Init the library and wait out its debounce/fonts re-runs so state is stable.
async function initAndSettle(page, selector, options = {}) {
  await page.evaluate(
    ([sel, opts]) => {
      window.__results = [];
      window.__wm = window.Widowmender.init(sel, {
        ...opts,
        onProcess: (el, result) => window.__results.push({ id: el.id, ...result }),
      });
    },
    [selector, options]
  );
  await page.waitForTimeout(400);
}

function lastResultFor(results, id) {
  const mine = results.filter((r) => r.id === id);
  return mine[mine.length - 1];
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  FAIL - ${name}\n    ${String(err.message || err).split('\n').join('\n    ')}`);
  }
}

browser = await launchBrowser();

console.log('widow-mender.js');

await test('mends a paragraph whose natural last line is a single word', async () => {
  const page = await newFixturePage();
  const width = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 1));
  assert.ok(width, 'no width in range produced a natural widow (fixture text needs adjusting)');
  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), width);

  await initAndSettle(page, '.widow');
  const result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.ok(['tighten', 'nbsp'].includes(result.method), `expected a fix, got "${result.method}"`);

  const after = await page.evaluate(() => window.measure(document.getElementById('p')));
  assert.ok(
    after.last.length >= 2,
    `last line should hold >= 2 words after mending, got ${after.last.length} ("${after.last.join(' ')}")`
  );
  await page.close();
});

await test('reports the applied tracking when it mends by tightening', async () => {
  const page = await newFixturePage();
  const width = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 1));
  assert.ok(width, 'no natural widow found');
  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), width);

  await initAndSettle(page, '.widow');
  const result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  if (result.method === 'tighten') {
    assert.ok(result.spacing > 0 && result.spacing <= 0.06, `spacing out of range: ${result.spacing}`);
    const annotated = await page.evaluate(() => document.querySelector('.wm-tighten')?.dataset.wmSpacing || '');
    assert.match(annotated, /^-0\.\d{3}em$/, `data-wm-spacing should be a CSS length, got "${annotated}"`);
  }
  await page.close();
});

await test('leaves a paragraph with a healthy last line untouched', async () => {
  const page = await newFixturePage();
  const width = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 3));
  assert.ok(width, 'no width in range produced a 3-word last line');
  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), width);

  await initAndSettle(page, '.widow');
  const result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.equal(result.method, 'none');
  const state = await page.evaluate(() => ({
    text: document.getElementById('p').textContent,
    tightened: !!document.querySelector('.wm-tighten'),
    hasNbsp: document.getElementById('p').textContent.includes(' '),
  }));
  assert.equal(state.text, FIXTURE_TEXT, 'text content must be unchanged');
  assert.equal(state.tightened, false, 'no tighten wrapper should be added');
  assert.equal(state.hasNbsp, false, 'no nbsp should be injected');
  await page.close();
});

await test('falls back to a non-breaking space join when tightening is not allowed', async () => {
  const page = await newFixturePage();
  const width = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 1));
  assert.ok(width, 'no natural widow found');
  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), width);

  await initAndSettle(page, '.widow', { maxLetterSpacing: 0 });
  const result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.equal(result.method, 'nbsp');
  const state = await page.evaluate(() => ({
    hasNbsp: document.getElementById('p').textContent.includes(' '),
    after: window.measure(document.getElementById('p')),
  }));
  assert.ok(state.hasNbsp, 'an nbsp should join the last two words');
  assert.ok(state.after.last.length >= 2, `widow should be gone, last line: "${state.after.last.join(' ')}"`);
  await page.close();
});

await test('treats minLastLineWords as the widow threshold', async () => {
  const page = await newFixturePage();
  const width = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 2));
  assert.ok(width, 'no width in range produced a 2-word last line');
  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), width);

  // Default threshold (2): a 2-word last line is fine.
  await initAndSettle(page, '.widow');
  let result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.equal(result.method, 'none', 'a 2-word last line is not a widow by default');
  await page.evaluate(() => window.__wm.destroy());

  // Raised threshold (3): the same layout now counts as a widow.
  await initAndSettle(page, '.widow', { minLastLineWords: 3 });
  result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.ok(['tighten', 'nbsp'].includes(result.method), `expected a fix at threshold 3, got "${result.method}"`);
  await page.close();
});

await test('preserves inline markup (em, strong, a) while wrapping words', async () => {
  const page = await newFixturePage(`
    <style>body{ margin: 0; font: 16px/1.5 Georgia, serif; }</style>
    <p id="p" class="widow" style="width:300px">Alpha beta <em>gamma delta</em> epsilon
    <strong>zeta eta</strong> theta iota <a href="#x">kappa</a> lambda and then one more word at the very end</p>
  `);
  const before = await page.evaluate(() => document.getElementById('p').textContent.replace(/\s+/g, ' ').trim());
  await initAndSettle(page, '.widow');
  const state = await page.evaluate(() => ({
    em: document.querySelector('#p em')?.textContent,
    strong: document.querySelector('#p strong')?.textContent,
    a: document.querySelector('#p a')?.getAttribute('href'),
    text: document.getElementById('p').textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(),
  }));
  assert.equal(state.em, 'gamma delta', 'em must survive processing');
  assert.equal(state.strong, 'zeta eta', 'strong must survive processing');
  assert.equal(state.a, '#x', 'anchor href must survive processing');
  assert.equal(state.text, before, 'visible text must be unchanged (modulo nbsp)');
  await page.close();
});

await test('refresh() re-mends after a width change', async () => {
  const page = await newFixturePage();
  const clean = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 3));
  const widowed = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 1));
  assert.ok(clean && widowed, 'need both a clean and a widowed width');

  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), clean);
  await initAndSettle(page, '.widow');
  let result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.equal(result.method, 'none');

  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), widowed);
  await page.evaluate(() => window.__wm.refresh());
  result = await page.evaluate(() => window.__results[window.__results.length - 1]);
  assert.ok(['tighten', 'nbsp'].includes(result.method), `expected a fix after refresh, got "${result.method}"`);
  await page.close();
});

await test('destroy() restores the original markup exactly and stops re-running', async () => {
  const page = await newFixturePage();
  const width = await page.evaluate(() => window.findWidthFor(document.getElementById('p'), 1));
  await page.evaluate((w) => (document.getElementById('p').style.width = w + 'px'), width);
  const original = await page.evaluate(() => document.getElementById('p').innerHTML);

  await initAndSettle(page, '.widow');
  const wrapped = await page.evaluate(() => document.querySelectorAll('#p .wm-word').length);
  assert.ok(wrapped > 0, 'words should be wrapped while active');

  await page.evaluate(() => window.__wm.destroy());
  const restored = await page.evaluate(() => document.getElementById('p').innerHTML);
  assert.equal(restored, original, 'destroy() must restore the exact original innerHTML');

  // A later refresh on the destroyed instance must be a no-op.
  await page.evaluate(() => window.__wm.refresh());
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.getElementById('p').innerHTML);
  assert.equal(after, original, 'a destroyed instance must not process elements again');
  await page.close();
});

await test('two instances keep independent state (destroying one leaves the other alive)', async () => {
  const page = await newFixturePage(`
    <style>body{ margin: 0; font: 16px/1.5 Georgia, serif; }</style>
    <p id="pa" class="a" style="width:300px">${FIXTURE_TEXT}</p>
    <p id="pb" class="b" style="width:300px">${FIXTURE_TEXT}</p>
  `);
  await page.evaluate(() => {
    window.__wmA = window.Widowmender.init('.a');
    window.__wmB = window.Widowmender.init('.b');
  });
  await page.waitForTimeout(400);

  await page.evaluate(() => window.__wmA.destroy());
  const state = await page.evaluate(() => ({
    aWrapped: document.querySelectorAll('#pa .wm-word').length,
    bWrapped: document.querySelectorAll('#pb .wm-word').length,
  }));
  assert.equal(state.aWrapped, 0, 'destroyed instance A must unwrap its element');
  assert.ok(state.bWrapped > 0, 'instance B must be unaffected by destroying A');

  // B must still be able to reprocess.
  await page.evaluate(() => window.__wmB.refresh());
  const bStill = await page.evaluate(() => document.querySelectorAll('#pb .wm-word').length);
  assert.ok(bStill > 0, 'instance B must still work after A is destroyed');
  await page.close();
});

console.log('widowmender-demo.html');

await test('demo page loads the real library with no errors, no widow-kill leftovers, UTF-8 intact', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err));
  await page.goto('file://' + DEMO);
  await page.waitForFunction(() => document.getElementById('status-p-text').textContent !== 'measuring...');
  await page.waitForFunction(() => document.getElementById('status-h-text').textContent !== 'measuring...');

  assert.equal(errors.length, 0, `page errors: ${errors.join(', ')}`);
  const state = await page.evaluate(() => ({
    charset: document.characterSet,
    widowKill: document.querySelectorAll('.widow-kill').length,
    widowEls: document.querySelectorAll('.widow').length,
    usesLibrary: typeof window.Widowmender === 'object',
    statusP: document.getElementById('status-p-text').textContent,
    statusH: document.getElementById('status-h-text').textContent,
  }));
  assert.equal(state.charset, 'UTF-8', 'demo must declare and decode as UTF-8');
  assert.equal(state.widowKill, 0, 'no .widow-kill class should remain');
  assert.ok(state.widowEls >= 3, 'demo should tag elements with .widow');
  assert.ok(state.usesLibrary, 'demo must load widow-mender.js');
  assert.match(state.statusP, /^(mended|no widow)/, `paragraph status: "${state.statusP}"`);
  assert.match(state.statusH, /^(mended|no widow)/, `heading status: "${state.statusH}"`);
  await page.close();
});

await test('demo illustration really shows a widow: "same." alone on the last line', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto('file://' + DEMO);

  const check = () =>
    page.evaluate(() => {
      const word = document.querySelector('.wm-widow-word');
      const p = word.closest('.wm-illus-text');
      // Top of the text line immediately before the widow word.
      const nodes = Array.from(p.childNodes);
      const idx = nodes.findIndex((n) => n.nodeType === 1 && n.classList.contains('wm-widow-word'));
      let prevText = null;
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (nodes[i].nodeType === 3 && nodes[i].textContent.trim()) { prevText = nodes[i]; break; }
      }
      const range = document.createRange();
      range.selectNodeContents(prevText);
      const prevRects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const prevBottomTop = Math.max(...prevRects.map((r) => r.top));
      const wordRect = word.getBoundingClientRect();
      return {
        wordOnLowerLine: wordRect.top > prevBottomTop + 4,
        wordIsShort: wordRect.width < p.getBoundingClientRect().width * 0.5,
      };
    });

  let r = await check();
  assert.ok(r.wordOnLowerLine, 'desktop: "same." must sit on its own line below the text');
  assert.ok(r.wordIsShort, 'desktop: the widow line must be visibly short');

  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(300);
  r = await check();
  assert.ok(r.wordOnLowerLine, 'mobile: "same." must sit on its own line below the text');
  assert.ok(r.wordIsShort, 'mobile: the widow line must be visibly short');
  await page.close();
});

await test('demo playgrounds re-mend when their boxes are resized (ResizeObserver path)', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto('file://' + DEMO);
  await page.waitForFunction(() => document.getElementById('status-p-text').textContent !== 'measuring...');
  await page.evaluate(HELPERS);

  // Drive the paragraph resizer to a width where the text naturally widows.
  const width = await page.evaluate(() => {
    const p = document.querySelector('#resizer-p p');
    return window.findWidthFor(p, 1, 180, 620);
  });
  assert.ok(width, 'no widow-producing width found for the demo paragraph');
  await page.evaluate((w) => {
    document.querySelector('#resizer-p p').style.width = '';
    document.getElementById('resizer-p').style.width = w + 48 + 'px'; // + horizontal padding
  }, width);
  await page.waitForTimeout(500); // ResizeObserver + debounce

  const state = await page.evaluate(() => ({
    status: document.getElementById('status-p-text').textContent,
    after: window.measure(document.querySelector('#resizer-p p')),
  }));
  assert.match(state.status, /^mended/, `expected a mend after resize, status: "${state.status}"`);
  assert.ok(state.after.last.length >= 2, `widow should be gone, last line: "${state.after.last.join(' ')}"`);

  // Same for the heading box.
  const hWidth = await page.evaluate(() => {
    const h = document.querySelector('#resizer-h h3');
    return window.findWidthFor(h, 1, 150, 500);
  });
  assert.ok(hWidth, 'no widow-producing width found for the demo heading');
  await page.evaluate((w) => {
    document.querySelector('#resizer-h h3').style.width = '';
    document.getElementById('resizer-h').style.width = w + 48 + 'px';
  }, hWidth);
  await page.waitForTimeout(500);

  const hState = await page.evaluate(() => ({
    status: document.getElementById('status-h-text').textContent,
    after: window.measure(document.querySelector('#resizer-h h3')),
  }));
  assert.match(hState.status, /^mended/, `expected a heading mend after resize, status: "${hState.status}"`);
  assert.ok(hState.after.last.length >= 2, `heading widow should be gone, last line: "${hState.after.last.join(' ')}"`);
  await page.close();
});

await browser.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
