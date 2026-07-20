/*!
 * Widowmender — kills typographic widows by nudging tracking (letter-spacing)
 * on just the tail of a paragraph, falling back to a non-breaking space join
 * when tightening alone can't rescue the orphaned word.
 *
 * Usage:
 *   <p class="widow-kill">Your paragraph…</p>
 *   <script src="widow-mender.js"></script>
 *   <script>Widowmender.init();</script>
 *
 * Or target anything with a selector:
 *   Widowmender.init('.article p, .article h1, .article h2');
 *
 * Options:
 *   Widowmender.init('.widow-kill', {
 *     minLastLineWords: 2,   // a last line with fewer words than this counts as a widow
 *     maxLetterSpacing: 0.06, // em — ceiling on how far tracking will tighten before giving up
 *     step: 0.004              // em — how finely to walk the tightening loop
 *   });
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    selector: '.widow-kill',
    minLastLineWords: 2,
    maxLetterSpacing: 0.06,
    step: 0.004,
  };

  // element -> original innerHTML, so we can cleanly re-run on resize/font-load
  const originals = new WeakMap();
  let controlled = [];
  let resizeObserver = null;
  let debounceTimer = null;

  function isWordChar(part) {
    return part !== '' && !/^\s+$/.test(part);
  }

  // Wrap each run of non-whitespace text in a <span class="wk-word">,
  // walking the DOM so existing inline markup (em, a, strong…) is preserved.
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
            span.className = 'wk-word';
            span.textContent = part;
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(part));
          }
        });
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('wk-word')) return;
        Array.from(node.childNodes).forEach(walk);
      }
    }
    Array.from(el.childNodes).forEach(walk);
  }

  // Group .wk-word spans into visual lines by their rendered top offset.
  function getLines(el) {
    const words = el.querySelectorAll('.wk-word');
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
    if (lines.length < 2) return { method: 'none' }; // nothing to fix on a single line

    let last = lines[lines.length - 1];
    if (last.length >= opts.minLastLineWords) return { method: 'none' }; // no widow

    const origLineCount = lines.length;
    let method = null;

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
        wrapper.className = 'wk-tighten';
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
          wrapper.dataset.wkSpacing = wrapper.style.letterSpacing;
          break;
        }
      }
      if (!method) wrapper.style.letterSpacing = '';
    }

    if (!method) {
      // Guaranteed fallback: glue the last two words with a non-breaking
      // space. They'll either both fit on the prior line, or wrap down
      // together — either way the widow can never be a lone word again.
      const words = Array.from(el.querySelectorAll('.wk-word'));
      if (words.length >= 2) {
        const lastW = words[words.length - 1];
        const prevW = words[words.length - 2];
        let node = prevW.nextSibling;
        while (node && node !== lastW) {
          if (node.nodeType === Node.TEXT_NODE) node.nodeValue = '\u00A0';
          node = node.nextSibling;
        }
        method = 'nbsp';
      }
    }

    return { method };
  }

  function run(opts) {
    const els = Array.from(document.querySelectorAll(opts.selector));
    controlled = els;
    els.forEach((el) => processElement(el, opts));
  }

  function debouncedRun(opts) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => run(opts), 120);
  }

  function init(selector, options) {
    const opts = Object.assign({}, DEFAULTS, { selector: selector || DEFAULTS.selector }, options || {});

    const start = () => {
      run(opts);
      window.addEventListener('resize', () => debouncedRun(opts));
      if ('fonts' in document) {
        document.fonts.ready.then(() => run(opts));
      }
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => debouncedRun(opts));
        controlled.forEach((el) => resizeObserver.observe(el.parentElement || el));
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }

    return {
      refresh: () => run(opts),
      destroy: () => {
        controlled.forEach((el) => {
          if (originals.has(el)) el.innerHTML = originals.get(el);
        });
        if (resizeObserver) resizeObserver.disconnect();
        window.removeEventListener('resize', debouncedRun);
      },
    };
  }

  global.Widowmender = { init };
})(window);
