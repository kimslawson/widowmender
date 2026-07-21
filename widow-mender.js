/*!
 * Widowmender: mends typographic widows by nudging tracking (letter-spacing)
 * on just the tail of a paragraph, falling back to a non-breaking space join
 * when tightening alone can't rescue the orphaned word.
 *
 * Usage:
 *   <p class="widow">Your paragraph...</p>
 *   <script src="widow-mender.js"></script>
 *   <script>Widowmender.init();</script>
 *
 * Or target anything with a selector:
 *   Widowmender.init('.article p, .article h1, .article h2');
 *
 * Options:
 *   Widowmender.init('.widow', {
 *     minLastLineWords: 2,    // a last line with fewer words than this counts as a widow
 *     maxLetterSpacing: 0.06, // em; ceiling on how far tracking will tighten before giving up
 *     step: 0.004,            // em; how finely to walk the tightening loop (must be > 0)
 *     strategy: 'local',      // where to tighten: 'local' | 'minimal' | 'even' (see below)
 *     onProcess: null,        // optional callback(element, result) fired after each element
 *   });
 *
 * strategy picks WHICH text gets tightened to pull the widow up:
 *   'local'   (default) tighten the last two lines. The change stays at the
 *             bottom of the paragraph, next to the problem; simplest and most
 *             stable while resizing.
 *   'minimal' probe every line and tighten the single one that clears the widow
 *             with the least tracking (often a short, sentence-ending line far
 *             above). Gentlest tracking, but the reflow can ripple through more
 *             lines; ties break toward the most local line.
 *   'even'    track the whole paragraph uniformly by the least amount that
 *             clears the widow. The classic typesetter's move: evenest color,
 *             no single line stands out.
 *
 * The result passed to onProcess looks like:
 *   { method: 'none' | 'tighten' | 'nbsp' | 'skip', lastWords: <number>, spacing: <em number> }
 * where 'none' means no widow was present, 'tighten'/'nbsp' are the two fixes,
 * and 'skip' means a widow was found but deliberately left unmended because
 * binding its tail would have overflowed the container (too narrow a measure).
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    selector: '.widow',
    minLastLineWords: 2,
    maxLetterSpacing: 0.06,
    step: 0.004,
    strategy: 'local',
    onProcess: null,
  };

  // element -> original innerHTML, so we can cleanly re-run on resize/font-load
  const originals = new WeakMap();

  function isWordChar(part) {
    return part !== '' && !/^\s+$/.test(part);
  }

  // Wrap each run of non-whitespace text in a <span class="wm-word">,
  // walking the DOM so existing inline markup (em, a, strong, ...) is preserved.
  function wrapWords(el) {
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (!text || !text.trim()) return;
        const frag = document.createDocumentFragment();
        text.split(/(\s+)/).forEach((part) => {
          if (part === '') return;
          if (isWordChar(part)) {
            const span = document.createElement('span');
            span.className = 'wm-word';
            span.textContent = part;
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(part));
          }
        });
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('wm-word')) return;
        Array.from(node.childNodes).forEach(walk);
      }
    }
    Array.from(el.childNodes).forEach(walk);
  }

  // Group .wm-word spans into visual lines by their rendered top offset.
  function getLines(el) {
    const words = el.querySelectorAll('.wm-word');
    const lines = [];
    let lastTop = null;
    words.forEach((w) => {
      const top = Math.round(w.getBoundingClientRect().top);
      if (lastTop === null || Math.abs(top - lastTop) > 1) {
        lines.push([]);
        lastTop = top;
      }
      lines[lines.length - 1].push(w);
    });
    return lines;
  }

  // Reset an element to its stored original markup and re-wrap its words,
  // returning the freshly measured lines. Each tighten attempt starts here so
  // it measures against a clean, known layout.
  function cleanWrap(el) {
    el.innerHTML = originals.get(el);
    wrapWords(el);
    return getLines(el);
  }

  // Wrap a run of adjacent word spans in a .wm-tighten span and walk its
  // letter-spacing tighter, step by step, until the widow clears or we hit the
  // ceiling. Returns the applied spacing (positive em) on success, leaving the
  // tightening in place; returns null on failure, neutralizing the span.
  function tightenWords(el, targetWords, opts, origLineCount) {
    if (!targetWords.length) return null;
    const sameParent = targetWords.every((w) => w.parentNode === targetWords[0].parentNode);
    if (!sameParent) return null; // markup crosses boundaries the Range API won't span cleanly

    let wrapper;
    try {
      const range = document.createRange();
      range.setStartBefore(targetWords[0]);
      range.setEndAfter(targetWords[targetWords.length - 1]);
      wrapper = document.createElement('span');
      wrapper.className = 'wm-tighten';
      range.surroundContents(wrapper);
    } catch (e) {
      return null;
    }

    let spacing = 0;
    while (spacing < opts.maxLetterSpacing) {
      spacing += opts.step;
      wrapper.style.letterSpacing = `-${spacing.toFixed(3)}em`;
      const lines = getLines(el);
      if (lines[lines.length - 1].length >= opts.minLastLineWords || lines.length < origLineCount) {
        wrapper.dataset.wmSpacing = wrapper.style.letterSpacing;
        return spacing;
      }
    }
    wrapper.style.letterSpacing = '';
    return null;
  }

  const flatten = (lines) => lines.reduce((all, line) => all.concat(line), []);

  // Pick the words a strategy tightens, given the freshly measured lines.
  // 'local' and 'even' are single deterministic targets; 'minimal' probes.
  function applyStrategy(el, lines, opts, origLineCount) {
    if (opts.strategy === 'even') {
      // Track the whole paragraph uniformly by the least amount that clears it.
      return tightenWords(el, flatten(lines), opts, origLineCount);
    }

    if (opts.strategy === 'minimal') {
      // Probe each single line (plus the local last-two span) on a fresh clean
      // layout, and keep the one that clears the widow with the least tracking.
      // Ties break toward the most local target, to disturb the fewest lines.
      const candidates = [];
      for (let k = 0; k <= origLineCount - 2; k += 1) candidates.push({ line: k, rank: k });
      candidates.push({ local: true, rank: origLineCount });

      const pickTarget = (candidate, ls) =>
        candidate.local ? ls[ls.length - 2].concat(ls[ls.length - 1]) : ls[candidate.line];

      let best = null;
      candidates.forEach((candidate) => {
        const spacing = tightenWords(el, pickTarget(candidate, cleanWrap(el)), opts, origLineCount);
        if (spacing == null) return;
        const better = !best || spacing < best.spacing - 1e-9;
        const tie = best && Math.abs(spacing - best.spacing) < 1e-9 && candidate.rank > best.rank;
        if (better || tie) best = { candidate, spacing };
      });

      if (!best) {
        cleanWrap(el); // no winner; hand a clean layout to the fallback
        return null;
      }
      // Re-apply the winner on a clean layout so the DOM ends on the best choice.
      return tightenWords(el, pickTarget(best.candidate, cleanWrap(el)), opts, origLineCount);
    }

    // 'local' (default): tighten the last two lines together. The last line
    // already fits by definition, so what needs to shrink is the line above it;
    // wrapping the pair lets that line absorb one more word.
    return tightenWords(el, lines[origLineCount - 2].concat(lines[origLineCount - 1]), opts, origLineCount);
  }

  function processElement(el, opts) {
    if (!originals.has(el)) originals.set(el, el.innerHTML);

    let lines = cleanWrap(el);
    if (lines.length < 2) {
      // nothing to fix on a single line
      return { method: 'none', lastWords: lines.length ? lines[0].length : 0, spacing: 0 };
    }

    const last = lines[lines.length - 1];
    if (last.length >= opts.minLastLineWords) {
      // no widow
      return { method: 'none', lastWords: last.length, spacing: 0 };
    }

    const origLineCount = lines.length;
    let method = null;
    let appliedSpacing = 0;

    const spacing = applyStrategy(el, lines, opts, origLineCount);
    if (spacing != null) {
      method = 'tighten';
      appliedSpacing = spacing;
    }

    if (!method) {
      // Tightening didn't (or couldn't) clear it. Start the fallback from a
      // clean, untightened layout so any probe wrappers are gone.
      cleanWrap(el);
      // Blunt fallback: glue the tail together with non-breaking spaces so it
      // can't settle as a too-short last line. We bind the last N words, where
      // N is the widow threshold. For the default threshold of 2 this is the
      // classic "join the last two words" trick; for a higher threshold it
      // binds proportionally more, so the unbreakable tail is at least N words
      // long and the last line can never come to rest below N.
      const words = Array.from(el.querySelectorAll('.wm-word'));
      if (words.length >= 2) {
        const bind = Math.min(words.length, Math.max(2, opts.minLastLineWords));
        const touched = [];
        for (let i = words.length - bind; i < words.length - 1; i++) {
          let node = words[i].nextSibling;
          while (node && node !== words[i + 1]) {
            if (node.nodeType === Node.TEXT_NODE) {
              touched.push({ node, text: node.nodeValue });
              node.nodeValue = '\u00A0';
            }
            node = node.nextSibling;
          }
        }
        // Binding makes that run unbreakable, which on a narrow measure can be
        // wider than the line box. Better to leave a widow than to shove the
        // page into horizontal overflow, so if the join would overflow the
        // element we undo it and report that we deliberately stood down.
        if (el.scrollWidth > el.clientWidth + 1) {
          touched.forEach((t) => (t.node.nodeValue = t.text));
          method = 'skip';
        } else {
          method = 'nbsp';
        }
      }
    }

    lines = getLines(el);
    return {
      method: method || 'none',
      lastWords: lines.length ? lines[lines.length - 1].length : 0,
      spacing: appliedSpacing,
    };
  }

  function init(selector, options) {
    const opts = Object.assign({}, DEFAULTS, { selector: selector || DEFAULTS.selector }, options || {});

    // A non-positive or non-numeric step can never advance the tightening loop
    // (spacing += step would never grow), so the `while (spacing < max)` walk
    // would spin forever. Fall back to the default so no caller can hang the
    // page with step: 0.
    if (!(opts.step > 0)) opts.step = DEFAULTS.step;

    // Unknown strategy names fall back to the safe, default 'local' behavior.
    if (opts.strategy !== 'minimal' && opts.strategy !== 'even') opts.strategy = 'local';

    // State is scoped per init() call so multiple instances don't clobber
    // each other's element lists, observers, or debounce timers.
    let controlled = [];
    let resizeObserver = null;
    let debounceTimer = null;
    let destroyed = false;

    function run() {
      if (destroyed) return;
      controlled = Array.from(document.querySelectorAll(opts.selector));
      controlled.forEach((el) => {
        const result = processElement(el, opts);
        if (typeof opts.onProcess === 'function') opts.onProcess(el, result);
      });
    }

    function debouncedRun() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(run, 120);
    }

    const start = () => {
      if (destroyed) return;
      run();
      window.addEventListener('resize', debouncedRun);
      if ('fonts' in document) {
        document.fonts.ready.then(() => {
          if (!destroyed) run();
        });
      }
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(debouncedRun);
        controlled.forEach((el) => resizeObserver.observe(el.parentElement || el));
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }

    return {
      refresh: run,
      destroy: () => {
        destroyed = true;
        clearTimeout(debounceTimer);
        window.removeEventListener('resize', debouncedRun);
        if (resizeObserver) resizeObserver.disconnect();
        controlled.forEach((el) => {
          if (originals.has(el)) el.innerHTML = originals.get(el);
        });
      },
    };
  }

  global.Widowmender = { init };
})(window);
