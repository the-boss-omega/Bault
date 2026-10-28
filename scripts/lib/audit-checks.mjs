import { AxeBuilder } from '@axe-core/playwright';

/**
 * The checks the audit makes of a page in a browser, kept apart from the script that walks the app so that
 * the tests can point them at pages with a mistake planted in them and at a page's real markup.
 */

async function inspect(page, locale, width) {
  return page.evaluate(
    ({ locale, width }) => {
      const { document, window, NodeFilter } = globalThis;
      const ISOLATES = '.serial, .amount, .ltr-run, .code-inline, .bidi, [dir="ltr"], code, kbd, input, textarea, select, script, style';
      const flags = [];
      const text = document.body.innerText;
      const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
      if (uuid) flags.push(`id on screen: ${uuid[0]}`);
      const cents = text.match(/\b\d[\d,]*\s*cents\b/i);
      if (cents) flags.push(`minor units on screen: ${cents[0]}`);
      const enums = [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((w) => !w.includes('@'));
      if (enums.length) flags.push(`enum names on screen: ${enums.slice(0, 6).join(', ')}`);
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
      if (locale === 'he' || locale === 'mixed') {
        // Text that is drawn the wrong way round. The bidirectional algorithm is not asked what it did;
        // where the characters ended up is measured, and compared with where a Hebrew reader expects them.
        const spot = (node, start, end) => {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          const box = range.getBoundingClientRect();
          return box.width > 0 ? box : null;
        };
        const backwards = [];
        const reading = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = reading.nextNode(); node; node = reading.nextNode()) {
          const owner = node.parentElement;
          if (!owner || !owner.checkVisibility?.() || owner.closest('script, style, input, textarea, select')) continue;
          const value = node.textContent ?? '';
          // Hebrew is read from the right, so what comes first is the right-most. A phrase whose first word is
          // to the left of its last one (a date drawn year-first, a price before 'a month' in the wrong order)
          // was drawn left to right by something that forced it.
          const letters = (value.match(/\p{L}/gu) ?? []).length;
          const hebrew = (value.match(/\p{Script=Hebrew}/gu) ?? []).length;
          if (letters >= 3 && hebrew / letters >= 0.4) {
            const words = [...value.matchAll(/\S+/g)].filter((m) => /[\p{L}\d]/u.test(m[0]));
            if (words.length >= 2) {
              const head = words[0];
              const tail = words[words.length - 1];
              const first = spot(node, head.index, head.index + head[0].length);
              const last = spot(node, tail.index, tail.index + tail[0].length);
              if (first && last && Math.abs(first.top - last.top) < 4 && first.left + 1 < last.left) {
                backwards.push(`Hebrew drawn left to right "${value.trim().slice(0, 30)}"`);
              }
            }
          }
          // A price: the sign is drawn before the figure (to its left), as it is written.
          const price = /\$(?=\d)/.exec(value);
          if (price) {
            const sign = spot(node, price.index, price.index + 1);
            const figure = spot(node, price.index + 1, price.index + 2);
            if (sign && figure && Math.abs(sign.top - figure.top) < 4 && sign.left > figure.left) backwards.push(`price drawn figure-first "${value.slice(price.index, price.index + 9)}"`);
          }
          // An English sentence: its full stop ends it, so it is to the right of where it began.
          const trimmed = value.trim();
          if (/^[A-Za-z][^\p{Script=Hebrew}]{12,}[.!?]$/u.test(trimmed) && !owner.closest(ISOLATES)) {
            const at = value.indexOf(trimmed);
            const first = spot(node, at, at + 1);
            const last = spot(node, at + trimmed.length - 1, at + trimmed.length);
            if (first && last && Math.abs(first.top - last.top) < 4 && last.left < first.left) backwards.push(`full stop drawn at the start "${trimmed.slice(0, 28)}"`);
          }
        }
        if (backwards.length) flags.push(`text drawn the wrong way round: ${[...new Set(backwards)].slice(0, 4).join('; ')}`);

        // The same question asked of every English phrase, character by character, wherever it sits and however
        // it wraps: in a left-to-right run each character is to the right of the one before it on its line. A
        // year that has gone to the end of its name, a full stop at the start of a sentence, a parenthesis on the
        // wrong side, a minus after its figure: each is a character that is left of the one it follows. The
        // words of a phrase are taken from the page's own text, across the elements that split them.
        const wrong = [];
        const flowOf = (node) => {
          let block = node.parentElement;
          while (block && block !== document.body && window.getComputedStyle(block).display === 'inline') block = block.parentElement;
          return block;
        };
        const flows = new Map();
        const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = texts.nextNode(); node; node = texts.nextNode()) {
          const owner = node.parentElement;
          if (!owner || !owner.checkVisibility?.() || owner.closest('script, style, input, textarea, select, svg')) continue;
          const flow = flowOf(node);
          if (!flow) continue;
          if (!flows.has(flow)) flows.set(flow, []);
          flows.get(flow).push(node);
        }
        const rectOf = (entry) => {
          const range = document.createRange();
          range.setStart(entry.node, entry.i);
          range.setEnd(entry.node, entry.i + 1);
          const box = range.getClientRects()[0];
          return box && box.width > 0 ? box : null;
        };
        const sameLine = (a, b) => Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < Math.min(a.height, b.height) * 0.5;
        let budget = 20000;
        for (const [flow, nodes] of flows) {
          if (budget <= 0) break;
          const flowStyle = window.getComputedStyle(flow);
          if (flowStyle.direction === 'ltr' && flowStyle.unicodeBidi !== 'plaintext') continue;
          // Text for a screen reader (a pixel wide, clipped away) is not drawn anywhere a person looks; it is read
          // in the order it is written, and where its characters sit means nothing.
          const room = flow.getBoundingClientRect();
          if (room.width < 3 || room.height < 3) continue;
          // Characters in logical order, each with the thing that gives it its direction: the nearest element
          // that is an island (an isolate, an override, a plaintext block, or reads the other way) or, failing
          // one, the block itself. Only characters in the same context are ordered by the same rules, so a
          // phrase is checked inside its island and never across the edge of one.
          const contextOf = (node) => {
            for (let up = node.parentElement; up && up !== flow; up = up.parentElement) {
              const around = window.getComputedStyle(up);
              if (around.unicodeBidi !== 'normal' || around.direction !== flowStyle.direction) return up;
            }
            return flow;
          };
          const groups = [];
          for (const node of nodes) {
            const context = contextOf(node);
            if (!groups.length || groups[groups.length - 1].context !== context) groups.push({ context, entries: [] });
            const value = node.textContent ?? '';
            for (let i = 0; i < value.length; i += 1) groups[groups.length - 1].entries.push({ node, i, ch: value[i] });
          }
          for (const { entries } of groups) {
            const flat = entries.map((e) => e.ch).join('');
            // An English phrase: from its first Latin letter (or the number that stands in front of it, "2011
            // Pokémon") to the next Hebrew letter, or to the end of its context.
            // (An isolate or a direction mark written into the text, as t() strings carry them, ends a phrase:
            // what is inside is its own run, and what is outside is the sentence's.)
            const phrase = /(?:\b\d{1,4}\s+)?[A-Za-z\u00C0-\u024F][^\p{Script=Hebrew}\p{Script=Arabic}\u2066-\u2069\u200E\u200F]*/gu;
            const hebrew = /\p{Script=Hebrew}/u.test(flat);
            for (const m of flat.matchAll(phrase)) {
              let core = m[0];
              const after = flat[m.index + core.length];
              // A neutral between the phrase and what follows it belongs to what follows; and the full stop of a
              // Hebrew sentence that ends in an English word is the sentence's, which ends at its left. Only where
              // the whole text is English does the full stop belong to the phrase.
              core = after || hebrew ? core.replace(/[^A-Za-z0-9\u00C0-\u024F]+$/u, '') : core.replace(/\s+$/u, '');
              if (core.length < 2) continue;
              budget -= core.length;
              let previous = null;
              for (let k = 0; k < core.length; k += 1) {
                if (/\s/.test(core[k])) continue;
                const box = rectOf(entries[m.index + k]);
                if (!box) continue;
                if (previous && sameLine(previous, box) && box.left < previous.left - 1.5) {
                  wrong.push(`"${core.slice(0, 36)}" (at "${core.slice(Math.max(0, k - 2), k + 3)}")`);
                  break;
                }
                previous = box;
              }
            }
            // A sign belongs in front of the figure it signs.
            for (const m of flat.matchAll(/(?<![\w])[-−](?=[$\d])/g)) {
              budget -= 2;
              const sign = rectOf(entries[m.index]);
              const figure = rectOf(entries[m.index + 1]);
              if (sign && figure && sameLine(sign, figure) && sign.left > figure.left) wrong.push(`a sign after its figure "${flat.slice(m.index, m.index + 9)}"`);
            }
          }
        }
        if (wrong.length) flags.push(`an English phrase or a figure drawn out of order: ${[...new Set(wrong)].slice(0, 4).join('; ')}`);

        // A cell that reads the page's way, with English text in it that nothing isolates: its punctuation and
        // its numbers go where the page's direction puts them. (Cells that take their own text's direction are
        // fine; so is anything in a <bdi>, a code or a serial.)
        const plain = [];
        for (const cell of document.querySelectorAll('td, th')) {
          const style = window.getComputedStyle(cell);
          if (!cell.checkVisibility?.() || style.direction !== 'rtl' || style.unicodeBidi !== 'normal') continue;
          const inner = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          for (let node = inner.nextNode(); node; node = inner.nextNode()) {
            const owner = node.parentElement;
            if (!owner?.checkVisibility?.()) continue;
            let isolated = false;
            for (let up = owner; up && up !== cell; up = up.parentElement) {
              const around = window.getComputedStyle(up);
              if (around.unicodeBidi !== 'normal' || around.direction === 'ltr' || /^(?:BUTTON|INPUT|SELECT|BDI)$/.test(up.tagName)) {
                isolated = true;
                break;
              }
            }
            if (isolated) continue;
            const value = node.textContent ?? '';
            const latin = (value.match(/[A-Za-z]/g) ?? []).length;
            const hebrew = (value.match(/\p{Script=Hebrew}/gu) ?? []).length;
            if (latin >= 8 && latin > hebrew) plain.push(`"${value.trim().slice(0, 36)}"`);
          }
        }
        if (plain.length) flags.push(`English text in a Hebrew cell with no island of its own: ${[...new Set(plain)].slice(0, 3).join(', ')}`);
      }
      const foreign = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (locale === 'mixed') break;
        if (!el || el.closest(ISOLATES) || !el.checkVisibility?.()) continue;
        const value = node.textContent ?? '';
        if (locale === 'he') {
          for (const word of value.match(/(?<![\p{L}\d])[a-z][a-z'’]{2,}(?![\p{L}\d])/gu) ?? []) foreign.push(word);
        } else if (/[֐-׿]/.test(value)) {
          foreign.push(value.trim().slice(0, 40));
        }
      }
      if (foreign.length) {
        const sample = [...new Set(foreign)].slice(0, 8).join(', ');
        flags.push(locale === 'he' ? `English words on a Hebrew page: ${sample}` : `Hebrew on an English page: ${sample}`);
      }
      return { flags, title: document.title };
    },
    { locale, width },
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
  return page.evaluate(() => {
    const { document, getComputedStyle, matchMedia } = globalThis;
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
      if (!el.disabled && (box.width < 24 || box.height < 24))
        say(`${Math.round(box.width)}x${Math.round(box.height)}px, under the 24px a target needs`);
      else if (
        !el.disabled &&
        coarse &&
        (box.width < 44 || box.height < 44) &&
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
      if (box.width === 0 || box.height === 0 || (box.width >= 24 && box.height >= 24)) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
      const key = `target|${el.tagName}|${el.className}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push(`target "${name}" (${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}): ${Math.round(box.width)}x${Math.round(box.height)}px, under the 24px a target needs`);
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
