import { AxeBuilder } from '@axe-core/playwright';

/**
 * The checks the audit makes of a page in a browser, kept apart from the script that walks the app so that
 * the tests can point them at pages with a mistake planted in them and at a page's real markup.
 */

async function inspect(page, width) {
  return page.evaluate(
    ({ width }) => {
      const { document, window } = globalThis;
      const flags = [];
      const text = document.body.innerText;
      // An id that is shown as nothing but an id (a record's own number, in the face of a code, beside its label)
      // is what it is there to be; one in a name or a sentence has got there by mistake.
      const alone = new Set(
        [...document.querySelectorAll('code, .code-inline')]
          .filter((el) => el.checkVisibility?.() ?? true)
          .map((el) => (el.textContent ?? '').trim().toLowerCase()),
      );
      const uuid = (text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) ?? []).find((id) => !alone.has(id.toLowerCase()));
      if (uuid) flags.push(`id on screen: ${uuid}`);
      const cents = text.match(/\b\d[\d,]*\s*cents\b/i);
      if (cents) flags.push(`minor units on screen: ${cents[0]}`);
      const enums = [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((w) => !w.includes('@'));
      if (enums.length) flags.push(`enum names on screen: ${enums.slice(0, 6).join(', ')}`);
      // The line over a heading says what the paper is (a kicker); it is not the heading again.
      const repeated = [];
      for (const kicker of document.querySelectorAll('[class*="kicker"]')) {
        if (!kicker.checkVisibility?.()) continue;
        const said = (kicker.textContent ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (!said) continue;
        const room = kicker.closest('.drawer-tag, .auth-slip, .request-slip, article, section, li, form') ?? kicker.parentElement;
        for (const heading of room?.querySelectorAll('h1, h2, h3, h4, [class*="title"]') ?? []) {
          if (heading === kicker || kicker.contains(heading) || !heading.checkVisibility?.()) continue;
          if ((heading.textContent ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === said) repeated.push(`"${said.slice(0, 40)}"`);
        }
      }
      if (repeated.length) flags.push(`a kicker that says its heading again: ${[...new Set(repeated)].slice(0, 3).join(', ')}`);
      // An icon is the size of a letter. One that has been given no size is as large as the box it is in: the
      // chevron beside a link, two hundred pixels tall, which nothing else on the page would say was wrong.
      const oversized = [];
      for (const icon of document.querySelectorAll('svg[aria-hidden="true"]')) {
        if (!icon.checkVisibility?.() || icon.closest('.landing, .slab, .barcode')) continue;
        const box = icon.getBoundingClientRect();
        if (box.width > 96 || box.height > 96) {
          oversized.push(`${Math.round(box.width)}x${Math.round(box.height)} beside "${(icon.parentElement?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`);
        }
      }
      if (oversized.length) flags.push(`an icon drawn larger than text: ${[...new Set(oversized)].slice(0, 3).join('; ')}`);
      if (document.documentElement.scrollWidth > window.innerWidth + 1 && width < 800) {
        flags.push(`scrolls sideways: ${document.documentElement.scrollWidth}px wide at ${window.innerWidth}px`);
      }
      if (width < 800) {
        // Anything that reaches past the edge of a phone and is not inside something that scrolls sideways
        // is cut off by whatever clips the page, and cannot be read or reached.
        const past = [];
        for (const el of document.body.querySelectorAll('*')) {
          if (el.closest('.rail, .rail-scrim, .modal-backdrop, .toast, [aria-hidden="true"]')) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.right <= window.innerWidth + 1 && box.left >= -1) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          let scrolls = false;
          for (let up = el.parentElement; up && up !== document.body && up !== document.documentElement; up = up.parentElement) {
            const overflow = window.getComputedStyle(up).overflowX;
            if (overflow === 'auto' || overflow === 'scroll') {
              scrolls = true;
              break;
            }
          }
          if (!scrolls) past.push(el);
        }
        const outermost = past.filter((el) => !past.includes(el.parentElement));
        if (outermost.length) {
          const named = outermost
            .slice(0, 3)
            .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
          flags.push(`content past the edge of the screen: ${named.join(', ')}`);
        }
      }
      return { flags, title: document.title };
    },
    { width },
  );
}

/**
 * axe-core's WCAG 2.x A and AA rules over the page as it stands. Contrast is
 * the reason this exists: it is measured against the computed colours of
 * whichever theme is on screen, which no reading of the stylesheet can do.
 * Motion is reduced for the whole run, so nothing is mid-fade when it looks.
 */
async function audit(page, { forced = false } = {}) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  // Under forced colours the person's own palette is drawn, which no stylesheet chooses and which the contrast
  // criterion does not hold a page to: axe reads the colours the stylesheet asked for, not the ones that are shown.
  if (forced) builder.disableRules(['color-contrast']);
  const result = await builder.analyze();
  return result.violations.map((v) => {
    const target = v.nodes[0]?.target?.join(' ') ?? '';
    return `axe ${v.id} (${v.impact}) x${v.nodes.length}: ${target}`.slice(0, 200);
  });
}

/**
 * Tabs through the first stops of the page and measures the focus indicator of
 * each against the colour behind it. A ring that is absent, or under 3:1
 * (WCAG 1.4.11), is a flag. The colour behind is the nearest opaque background
 * up the tree; where something with an image or gradient comes first the
 * contrast is not known and is not reported. A ring is also a flag when the box
 * it sits in cuts it off: a ring is drawn outside its element, and whatever
 * scrolls or clips (a tab strip, a sheet, a table's wrapper) cuts off what is
 * drawn outside it.
 */
async function auditFocus(page, stops = 40) {
  const flags = [];
  await page.evaluate(() => {
    globalThis.document.activeElement?.blur?.();
    globalThis.scrollTo(0, 0);
  });
  const seen = new Set();
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    // Focus scrolls what it lands on into view, and smoothly where the person allows motion: the ring is measured
    // once what has focus has come to rest, not on the way to its place.
    await page.evaluate(async () => {
      const { document, matchMedia, performance, requestAnimationFrame } = globalThis;
      const el = document.activeElement;
      if (!el || el === document.body || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const began = performance.now();
      let last = '';
      let still = 0;
      while (still < 2 && performance.now() - began < 1200) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const box = el.getBoundingClientRect();
        const now = `${box.top}|${box.left}`;
        still = now === last ? still + 1 : 0;
        last = now;
      }
    });
    const stop = await page.evaluate(() => {
      const { document, getComputedStyle } = globalThis;
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return { skip: true };
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = (css) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const over = (top, under) => ({
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
        a: 1,
      });
      const name = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
      // The element draws its own ring, or a wrapper does (a search box rings the
      // box around its input, with :focus-within).
      const ringOf = (node) => {
        const style = getComputedStyle(node);
        if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
          return { css: style.outlineColor, inside: parseFloat(style.outlineOffset) < 0 };
        }
        // A shadow is a ring only if it is a solid band round the box: no offset, no blur, a spread.
        const band = /(rgba?\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|color\([^)]*\))\s+0px\s+0px\s+0px\s+(?:[2-9]|\d{2,})px/.exec(
          style.boxShadow,
        );
        if (band) return { css: band[1], inside: false };
        return null;
      };
      let ringNode = el;
      let ring = ringOf(el);
      for (let up = el.parentElement, hops = 0; !ring && up && hops < 3; up = up.parentElement, hops += 1) {
        ring = ringOf(up);
        ringNode = up;
      }
      if (!ring) return { name, label, none: true };
      // How far the ring reaches outside the box it is drawn on: its width and its offset, or a shadow's spread.
      const reach = (() => {
        const style = getComputedStyle(ringNode);
        if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) return parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        return parseFloat(/0px\s+0px\s+0px\s+(\d+(?:\.\d+)?)px/.exec(style.boxShadow)?.[1] ?? '0');
      })();
      // Whether something that clips (an ancestor that scrolls or hides its overflow) cuts the ring off.
      let clip = null;
      if (reach > 0) {
        const own = ringNode.getBoundingClientRect();
        const outer = { left: own.left - reach, right: own.right + reach, top: own.top - reach, bottom: own.bottom + reach };
        let absolute = getComputedStyle(ringNode).position === 'absolute';
        const fixed = getComputedStyle(ringNode).position === 'fixed';
        for (let up = fixed ? null : ringNode.parentElement; up && up !== document.body && up !== document.documentElement; up = up.parentElement) {
          const around = getComputedStyle(up);
          if (absolute) {
            if (around.position === 'static' && around.transform === 'none') continue;
            absolute = false;
          }
          if (around.position === 'fixed') break;
          if (![around.overflowX, around.overflowY].some((o) => o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll')) continue;
          const box = up.getBoundingClientRect();
          const room = { left: box.left + up.clientLeft, top: box.top + up.clientTop };
          room.right = room.left + up.clientWidth;
          room.bottom = room.top + up.clientHeight;
          const side = ['left', 'right', 'top', 'bottom'].find((edge) => (edge === 'left' || edge === 'top' ? outer[edge] < room[edge] - 0.5 : outer[edge] > room[edge] + 0.5));
          if (side) {
            const by = `${up.tagName.toLowerCase()}${up.className && typeof up.className === 'string' ? '.' + up.className.trim().split(/\s+/)[0] : ''}`;
            clip = { by, side };
            break;
          }
        }
      }
      // What is behind the ring: the nearest opaque background, from the element (ring inside it) or its parent.
      let node = ring.inside ? ringNode : ringNode.parentElement;
      let under = null;
      const layers = [];
      for (; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== 'none') {
          const alpha = rgba(style.backgroundColor).a;
          if (alpha < 1) return { name, label, unknown: true, clip };
        }
        const bg = rgba(style.backgroundColor);
        if (bg.a > 0) layers.push(bg);
        if (bg.a >= 1) break;
      }
      if (layers.length === 0 || layers[layers.length - 1].a < 1) layers.push({ r: 255, g: 255, b: 255, a: 1 });
      under = layers.reduceRight((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
      const fg = over(rgba(ring.css), under);
      const [hi, lo] = [lum(fg), lum(under)].sort((a, b) => b - a);
      return { name, label, ratio: (hi + 0.05) / (lo + 0.05), clip };
    });
    if (stop.end) break;
    if (stop.skip) continue;
    const key = `${stop.name}|${stop.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (stop.clip) flags.push(`focus: the ring on ${stop.name} "${stop.label}" is cut off by ${stop.clip.by}, on its ${stop.clip.side}`);
    if (stop.unknown) continue;
    if (stop.none) flags.push(`focus: no visible indicator on ${stop.name} "${stop.label}"`);
    else if (stop.ratio < 3) flags.push(`focus: ring ${stop.ratio.toFixed(2)}:1 on ${stop.name} "${stop.label}"`);
  }
  return flags;
}

/**
 * The buttons on a page, seen as a visitor sees them: each one's label against its own face, its edge (the face
 * where it is filled, its line where it is outlined) against what it stands on, and its size as a target. The
 * colours of a button come from tokens that the surface it is on may change (the paper and the room have their
 * own), so what is measured is what is drawn, where it is drawn. A button with no face and no line (a ghost)
 * has the page for a face; a text button (a link set in a sentence) is asked only for its size, and its colours are
 * the text's, which axe measures.
 */
async function auditButtons(page) {
  // A button is measured where it comes to rest. A transition still in flight (the count that is fading out of the
  // rail as focus leaves it) is a word that is, for a moment, where it is not going to stay. What never ends is left.
  await page.evaluate(async () => {
    const { document } = globalThis;
    const moving = () =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([
      Promise.allSettled(moving().map((a) => a.finished)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  });
  return page.evaluate(() => {
    const { document, getComputedStyle, matchMedia, NodeFilter } = globalThis;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const over = (top, under) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // What a button stands on: the nearest opaque background above it. null where it is a picture or a gradient.
    const behind = (el) => {
      const layers = [];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const bg = rgba(style.backgroundColor);
        if (style.backgroundImage !== 'none' && bg.a < 1) return null;
        if (bg.a > 0) layers.push(bg);
        if (bg.a >= 1) break;
      }
      return layers.reduceRight((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
    };
    const coarse = matchMedia('(pointer: coarse)').matches;
    // Whether the words of a control are drawn on something beside it: the text that can be seen (not what is clear,
    // hidden or clipped by the control or what is inside it) that lies outside the control's box, and a control
    // that it lies over (the next tab, the next button). Words that run a few pixels out into empty space are not drawn on anything.
    const CONTROLS = 'button, a[href], [role="tab"], [role="button"], input, select, textarea, summary';
    const wordsOutside = (control) => {
      const box = control.getBoundingClientRect();
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      const outside = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        let seenAndFree = true;
        for (let up = node.parentElement; up; up = up.parentElement) {
          const style = getComputedStyle(up);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || style.overflowX !== 'visible') {
            seenAndFree = false;
            break;
          }
          if (up === control) break;
        }
        if (!seenAndFree) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width === 0) continue;
          if (rect.left < box.left - 1) outside.push({ left: rect.left, right: Math.min(rect.right, box.left), top: rect.top, bottom: rect.bottom });
          if (rect.right > box.right + 1) outside.push({ left: Math.max(rect.left, box.right), right: rect.right, top: rect.top, bottom: rect.bottom });
        }
      }
      if (outside.length === 0) return null;
      for (const other of document.querySelectorAll(CONTROLS)) {
        if (other === control || control.contains(other) || other.contains(control)) continue;
        if (!other.checkVisibility?.({ checkVisibilityCSS: true })) continue;
        const at = other.getBoundingClientRect();
        if (at.width === 0 || at.height === 0) continue;
        const over = outside.find((o) => o.left < at.right - 1 && o.right > at.left + 1 && o.top < at.bottom - 1 && o.bottom > at.top + 1);
        if (over) {
          const name = (other.getAttribute('aria-label') || other.textContent || '').trim().slice(0, 24);
          return { by: Math.round(Math.max(...outside.map((o) => o.right - o.left))), over: name };
        }
      }
      return null;
    };
    const flags = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('.btn, .icon-btn')) {
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(el);
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
      const kind =
        [...el.classList].find((c) => /^(?:btn|icon-btn)--/.test(c)) ??
        (el.classList.contains('icon-btn') ? 'icon-btn' : 'btn');
      const stand = behind(el);
      // One report for the same button on the same ground: the row of twenty Cancels is one finding, and the
      // same button on the paper and on the page is two.
      const key = `${kind}|${name}|${el.disabled}|${stand ? [stand.r, stand.g, stand.b].map(Math.round).join(',') : 'picture'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const say = (message) => flags.push(`button "${name}" (${kind}): ${message}`);
      // A target a finger or a pointer has to hit.
      // Its words are in it: text that is drawn outside the box it is in, where nothing clips it, is drawn on what is beside it.
      const out = wordsOutside(el);
      if (out) say(`its words run out of it, ${out.by}px, over "${out.over}"`);
      if (!el.disabled && (box.width < 24 || box.height < 24))
        say(`${Math.round(box.width)}x${Math.round(box.height)}px, under the 24px a target needs`);
      else if (
        !el.disabled &&
        coarse &&
        (box.width < 44 || box.height < 44) &&
        // A text button set in a sentence or under a form has the 24px of a target; it is not a block to press.
        !el.classList.contains('btn--link') &&
        !el.closest('.ph-controls')
      ) {
        say(
          `${Math.round(box.width)}x${Math.round(box.height)}px, under 44px where the pointer is a finger`,
        );
      }
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      // Text set in a sentence is held to the text's rules (axe), not to a button's: only its size, above, is asked of it.
      if (!stand || el.classList.contains('btn--link')) continue;
      const own = rgba(style.backgroundColor);
      const face = own.a > 0 ? over(own, stand) : stand;
      const label = over(rgba(style.color), face);
      const need = el.classList.contains('icon-btn') ? 3 : 4.5;
      const labelRatio = ratio(label, face);
      if (labelRatio < need)
        say(`its label is ${labelRatio.toFixed(2)}:1 on its own face, which needs ${need}:1`);
      // The shape: filled, it is the face against what it stands on; outlined, it is the line.
      const line = rgba(style.borderTopColor);
      const lineVisible =
        style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0 && line.a > 0;
      const filled = own.a > 0 && ratio(face, stand) >= 1.2;
      if (filled || lineVisible) {
        const edge = Math.max(
          filled ? ratio(face, stand) : 0,
          lineVisible ? ratio(over(line, stand), stand) : 0,
        );
        if (
          edge < 3 &&
          !el.classList.contains('btn--ghost') &&
          !el.classList.contains('icon-btn--bare')
        ) {
          say(`its edge is ${edge.toFixed(2)}:1 against what it stands on, which needs 3:1`);
        }
      }
    }
    // Every other button (a crumb, a tab, a card that opens): not the family's, but a target all the same.
    for (const el of document.querySelectorAll('button:not(.btn, .icon-btn), [role="button"]:not(.btn, .icon-btn)')) {
      if (!el.checkVisibility?.({ checkVisibilityCSS: true }) || el.disabled) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
      const kind = `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`;
      // Its words are in it: a tab that is let shrink below its word draws the word on the next tab.
      const out = wordsOutside(el);
      if (out) {
        const runs = `words|${el.tagName}|${el.className}|${name}`;
        if (!seen.has(runs)) {
          seen.add(runs);
          flags.push(`target "${name}" (${kind}): its words run out of it, ${out.by}px, over "${out.over}"`);
        }
      }
      if (box.width >= 24 && box.height >= 24) continue;
      const key = `target|${el.tagName}|${el.className}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push(`target "${name}" (${kind}): ${Math.round(box.width)}x${Math.round(box.height)}px, under the 24px a target needs`);
    }
    return flags;
  });
}

/**
 * Forced colours: the system paints the page in its own palette, so what said "this one" by a tint or a
 * gradient says nothing unless it was drawn in the system's highlight. The selected tab and the current page
 * are checked for a mark that survives it.
 */
async function auditForced(page) {
  return page.evaluate(() => {
    const { document, getComputedStyle } = globalThis;
    const flags = [];
    const canvas = getComputedStyle(document.body).backgroundColor;
    const marked = (el, pseudo) => {
      const style = getComputedStyle(el, pseudo);
      return style.content !== 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== canvas && parseFloat(style.height) > 0 && parseFloat(style.width) > 0;
    };
    const visible = (el) => el.checkVisibility?.({ checkVisibilityCSS: true });
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      const tab = list.querySelector('[aria-selected="true"]');
      if (!tab || !visible(tab)) continue;
      if (!(list.dataset.ready === 'true' ? marked(list, '::after') : marked(tab, '::after'))) {
        flags.push(`forced colours: the selected tab "${tab.textContent.trim().slice(0, 24)}" is not marked`);
      }
    }
    for (const item of document.querySelectorAll('.rail-item.is-active')) {
      if (visible(item) && !marked(item, '::before')) flags.push(`forced colours: the current page "${item.textContent.trim().slice(0, 24)}" is not marked in the rail`);
    }
    return flags;
  });
}

/**
 * That the page is in the theme it was asked to be in, all the way down: the attribute the stylesheets
 * read, the colour scheme the browser draws its own controls in (a calendar, a checkbox, a select's list),
 * and the colour the browser paints its own chrome. A page can look right and still hand a light checkbox to
 * a dark page.
 */
async function auditTheme(page, expected) {
  return page.evaluate((theme) => {
    const { document, getComputedStyle } = globalThis;
    const flags = [];
    const root = document.documentElement;
    const attribute = root.getAttribute('data-theme');
    if (attribute && attribute !== theme) flags.push(`theme: the page says ${attribute}, it was asked for ${theme}`);
    const scheme = getComputedStyle(root).colorScheme;
    // Forced colours take the colour scheme away (it computes to "light dark"): the person's palette is drawn.
    const forced = globalThis.matchMedia?.('(forced-colors: active)').matches;
    if (!forced && scheme !== theme) flags.push(`theme: the browser draws its own controls in "${scheme}" on a ${theme} page`);
    const chrome = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    if (chrome) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = chrome;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
      if (light !== (theme === 'light')) flags.push(`theme: the browser's own chrome is ${chrome}, which is ${light ? 'light' : 'dark'} on a ${theme} page`);
    }
    return flags;
  }, expected);
}

export { audit, auditButtons, auditFocus, auditForced, auditTheme, inspect };
