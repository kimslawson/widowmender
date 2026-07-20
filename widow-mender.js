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
 *     onProcess: null,        // optional callback(element, result) fired after each element
 *   });
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

  function processElement(el, opts) {
    if (!originals.has(el)) originals.set(el, el.innerHTML);
    el.innerHTML = originals.get(el);

    wrapWords(el);
    let lines = getLines(el);
    if (lines.length < 2) {
      // nothing to fix on a single line
      return { method: 'none', lastWords: lines.length ? lines[0].length : 0, spacing: 0 };
    }

    let last = lines[lines.length - 1];
    if (last.length >= opts.minLastLineWords) {
      // no widow
      return { method: 'none', lastWords: last.length, spacing: 0 };
    }

    const origLineCount = lines.length;
    let method = null;
    let appliedSpacing = 0;

    // Only the tail matters: tightening the last line's own spacing can't
    // pull a word up, since the last line already fits by definition. What
    // needs to shrink is the line ABOVE it, so it can absorb one more word.
    // We wrap the last two lines together and tighten just that span.
    const targetWords = lines[lines.length - 2].concat(lines[lines.length - 1]);
    const sameParent = targetWords.every((w) => w.parentNode === targetWords[0].parentNode);
    let wrapper = null;

    if (sameParent) {
      try {
        const range = document.createRange();
        range.setStartBefore(targetWords[0]);
        range.setEndAfter(targetWords[targetWords.length - 1]);
        wrapper = document.createElement('span');
        wrapper.className = 'wm-tighten';
        range.surroundContents(wrapper);
      } catch (e) {
        wrapper = null; // markup crosses boundaries the Range API won't span cleanly
      }
    }

    if (wrapper) {
      let spacing = 0;
      while (spacing < opts.maxLetterSpacing) {
        spacing += opts.step;
        wrapper.style.letterSpacing = `-${spacing.toFixed(3)}em`;
        lines = getLines(el);
        last = lines[lines.length - 1];
        if (last.length >= opts.minLastLineWords || lines.length < origLineCount) {
          method = 'tighten';
          appliedSpacing = spacing;
          wrapper.dataset.wmSpacing = wrapper.style.letterSpacing;
          break;
        }
      }
      if (!method) wrapper.style.letterSpacing = '';
    }

    if (!method) {
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
