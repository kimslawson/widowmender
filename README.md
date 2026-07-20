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

5. `onProcess: null` (optional callback, called as `onProcess(element, result)` after each element is processed; `result.method` is one of `'none'` (no widow), `'tighten'`, `'nbsp'`, or `'skip'`)

On a measure too narrow to bind the tail without overflowing the container, the non-breaking-space fallback stands down rather than break the layout: it leaves the widow in place and reports `method: 'skip'`.

## Tests

There's a small Playwright-driven test suite that exercises the library in a real browser:

```
npm install
npm test
```

## And now for something completely different (but named the same)

Maybe you landed here looking for a short film? I found it the opposite way when looking for a name for this little bit of code.

If you're in the mood for a bit of steampunk meets cyberpunk meets noir, check out Donny Knowles’ [*Widowmender*](https://vimeo.com/22816755)

