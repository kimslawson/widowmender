# Widowmender

Javascript implementation of a newspaper production hack to tidy up rogue lines of text at the end of paragraphs.

## What a weird name, eh?

In the world of typography, those short lines at the end of an otherwise fine-looking paragraph are called “widows”. These:

![Animation showing a widow at the end of a paragraph being mended](lorax.gif)

So, to make a long story short, this little bit of JavaScript fixes widows on your website. It can be applied in a few different ways to suit your needs and it has some options to suit your fancy.

## Backstory

<small>(This is the part where you’re just looking for a recipe and the author goes on a long-winded story about their duck Quackers and their childhood best friend and the antics they used to get up to in Guernsey and yadda yadda…)</small>

To make a short story longer, I was once a designer for a local newspaper. One of the duties of the production team (me and 4 other designers) was to put stories into the print version of the paper. This involved setting blocks of type around ads (or as we called it, filling the “news hole”.) Sometimes, for either practical or aesthetic reasons we needed to adjust lines of text to make a story fit or to make it look better. Over time I developed a habit, almost second nature, to remove stray widows at the end of paragraphs. The InDesign keyboard shortcuts became ingrained as muscle memory in my fingers.

Those days may be gone, and my fingers may not recall the keystrokes to fix widows in InDesign, but they’re still there on the web and I still want to mend them. I made this tiny JavaScript library to do just that, and I'd like to share it with you. Also here's a picture of a duck whose name is Marshmallow, not Quackers.

<img title="" src="marshmallow.jpg" alt="A duck named Marshmallow" data-align="inline" width="260">

## Recipe

Here's how to actually use this thing. Either:

1. Apply it surgically to a specific class (defaults to `widow`), and make sure that problematic passages are tagged with that class; or

2. Spray’n’pray: call it on an arbitrary selector and hope for the best.

It's performant enough that it won't slow your pages down terribly. I'd advise calling it on a moderately-targeted selector, like `article p, article h1, article h2`, rather than `*` or `body` or `html`.

### Optional configuration

Widowmender ships with sensible defaults baked in, but feel free to tweak the (few) config options as needed. Default values are as follows:

1. `selector: '.widow'`

2. `minLastLineWords: 2`

3. `maxLetterSpacing: 0.06`

4. `step: 0.004`

5. `strategy: 'local'` (where to tighten to pull the widow up)

6. `onProcess: null` (optional callback, called as `onProcess(element, result)` after each element is processed; `result.method` is one of `'none'` (no widow), `'tighten'`, `'nbsp'`, or `'skip'`)

On a measure too narrow to bind the tail without overflowing the container, the non-breaking-space fallback stands down rather than break the layout: it leaves the widow in place and reports `method: 'skip'`.

### Tightening strategy

When it fixes a widow by tightening, Widowmender has to choose *which* text to tighten. The second-to-last line is the obvious place, but it isn’t always the cheapest — a short line ending a sentence higher up often has more slack, so nudging it clears the widow with far less tracking. Pick with `strategy`:

- `'local'` (default): tighten the last two lines. The change stays at the bottom of the paragraph, next to the problem; simplest, and steadiest while a box is being resized.
- `'minimal'`: probe every line and tighten the single one that clears the widow with the least tracking. Gentlest tracking (often several times gentler than `'local'`), at the cost of a reflow that can ripple through more lines.
- `'even'`: track the whole paragraph uniformly by the least amount that clears the widow. The classic typesetter’s move: evenest color, no single line stands out.

On a static page the reader never sees the pre-fix layout, so the extra reflow of `'minimal'`/`'even'` is invisible — only the (smaller) tracking shows. `'local'` is the default mainly because it’s the most stable to watch during live resizing. The demo below lets you flip between all three on the same paragraph.

## Tests

There’s a small Playwright-driven test suite that exercises the library in a real browser:

```
npm install
npm test
```

## And now for something completely different (but named the same)

Maybe you landed here looking for a short film? I found it the opposite way when looking for a name for this little bit of code.

If you're in the mood for a bit of steampunk meets cyberpunk meets noir, check out Donny Knowles’ [*Widowmender*](https://vimeo.com/22816755)

