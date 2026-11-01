(function () {
  'use strict';
  var w = typeof window !== 'undefined' ? window : null;
  if (!w || w.__dmAdaptForDark) return;
  w.__dmAdaptForDark = true;

const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parseHex(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function toHex(rgb) {
  return '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
}
function luminance(rgb) {
  const [r, g, b] = rgb.map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(hexA, hexB) {
  const [a, b] = [luminance(parseHex(hexA)), luminance(parseHex(hexB))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
function srgbToOklch(rgb) {
  const [r, g, b] = rgb.map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function oklchToLinear(L, C, H) {
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function oklchToHex(L, C, H) {
  let lin = oklchToLinear(L, C, H);
  while (C > 0 && lin.some(c => c < -0.001 || c > 1.001)) {
    C -= 0.005;
    lin = oklchToLinear(L, C, H);
  }
  return toHex(lin.map(c => toGamma(Math.min(1, Math.max(0, c)))));
}

function adaptForDark(hex, { bg = '#1e2027', minContrast = 3, maxL = 0.86 } = {}) {
  if (!hex) return hex;
  let [L, C, H] = srgbToOklch(parseHex(hex));
  if (L > maxL) L = maxL;
  let out = oklchToHex(L, C, H);
  while (contrast(out, bg) < minContrast && L < 1) {
    L += 0.01;
    out = oklchToHex(L, C, H);
  }
  return out;
}

  var HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  function isHexColor(value) {
    return typeof value === 'string' && HEX.test(value.trim());
  }
  function adaptHexForDark(value, options) {
    if (!isHexColor(value)) {
      return null;
    }
    return adaptForDark(value.trim(), options);
  }

  var dm = w.__dm || (w.__dm = { misses: [] });
  dm.adaptForDark = adaptForDark;
  dm.contrast = contrast;
  dm.isHexColor = isHexColor;
  dm.adaptHexForDark = adaptHexForDark;
})();
