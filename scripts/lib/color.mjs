// Colour maths for design-lint: read a CSS colour, mix two the way
// color-mix(in oklab, ...) does, and measure WCAG 2 contrast. Solid sRGB colours
// only; an alpha is composited over the colour it sits on before it is measured.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklab({ r, g, b }) {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b], alpha = 1) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channel = (v) => clamp(Math.round(fromLinear(clamp(v, 0, 1))), 0, 255);
  return {
    r: channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

/** #rgb, #rgba, #rrggbb, #rrggbbaa and oklch(L C H [/ A]); null for anything else. */
export function parseColor(text) {
  const t = text.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(t)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = Number.parseInt(full.slice(0, 6), 16);
    const a = full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  const ok = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(t);
  if (ok) {
    const L = ok[1].endsWith('%') ? Number.parseFloat(ok[1]) / 100 : Number.parseFloat(ok[1]);
    const C = Number.parseFloat(ok[2]);
    const H = (Number.parseFloat(ok[3]) * Math.PI) / 180;
    const alpha = ok[4] === undefined ? 1 : ok[4].endsWith('%') ? Number.parseFloat(ok[4]) / 100 : Number.parseFloat(ok[4]);
    return fromOklab([L, C * Math.cos(H), C * Math.sin(H)], alpha);
  }
  return null;
}

/** color-mix(in oklab, a pct%, b), for two solid colours. */
export function mixOklab(a, pct, b) {
  const A = toOklab(a);
  const B = toOklab(b);
  const t = pct / 100;
  return fromOklab(A.map((v, i) => v * t + B[i] * (1 - t)));
}

/** A colour with an alpha, composited over a solid one. */
export function over(fg, bg) {
  if (fg.a >= 1) return fg;
  const mixed = (x, y) => Math.round(x * fg.a + y * (1 - fg.a));
  return { r: mixed(fg.r, bg.r), g: mixed(fg.g, bg.g), b: mixed(fg.b, bg.b), a: 1 };
}

const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
