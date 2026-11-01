#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
	const o = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const k = a.slice(2);
		const v = argv[i + 1];
		if (v === undefined || v.startsWith('--')) o[k] = true;
		else { o[k] = v; i++; }
	}
	return o;
}
export function makeResolver(target, snapshot) {
	return (rel) => {
		if (snapshot) {
			const s = path.join(snapshot, rel);
			if (fs.existsSync(s)) return s;
		}
		return path.join(target, rel);
	};
}
export function writeIfChanged(file, content) {
	const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
	if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, buf);
	return true;
}
const posix = (p) => p.replace(/\\/g, '/');

export function loadAnchors(file) {
	const a = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!a.extends) return a;
	const base = loadAnchors(path.resolve(path.dirname(file), a.extends));
	const out = { ...base, ...a };
	for (const k of ['rules', 'light', 'shadows', 'tint', 'contrastChecks']) out[k] = { ...(base[k] || {}), ...(a[k] || {}) };
	out.pins = {};
	for (const k of new Set([...Object.keys(base.pins || {}), ...Object.keys(a.pins || {})]))
		out.pins[k] = { ...((base.pins || {})[k] || {}), ...((a.pins || {})[k] || {}) };
	out.literals = {};
	for (const r of ['bg', 'text', 'border']) out.literals[r] = { ...((base.literals || {})[r] || {}), ...((a.literals || {})[r] || {}) };
	delete out.extends;
	return out;
}

const NAMED = { white: '#ffffff', black: '#000000' };
export function norm(raw) {
	const c = String(raw).trim().toLowerCase();
	if (NAMED[c]) return NAMED[c];
	if (/^#[0-9a-f]{3}$/.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('');
	return c;
}
export const isHex6 = (c) => /^#[0-9a-f]{6}$/.test(c);
export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lin8 = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const lum = (h) => {
	const [r, g, b] = rgb(h).map(lin8);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
export const isNeutral = (h) => {
	const c = rgb(h);
	return Math.max(...c) - Math.min(...c) <= 2;
};
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function parseHex01(h) {
	let s = h.trim().replace('#', '');
	if (s.length === 3) s = [...s].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}
const toHex01 = (v) => '#' + v.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
function srgbToOklch(v) {
	const [r, g, b] = v.map(toLin);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
export const oklch = (h) => srgbToOklch(parseHex01(h));
function oklchToLinear(L, C, H) {
	const a = C * Math.cos(H), b = C * Math.sin(H);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}
export function oklchToHex(L, C, H) {
	let v = oklchToLinear(L, C, H);
	while (C > 0 && v.some((c) => c < -0.001 || c > 1.001)) {
		C -= 0.005;
		v = oklchToLinear(L, C, H);
	}
	return toHex01(v.map((c) => toGamma(Math.min(1, Math.max(0, c)))));
}
function localAdaptForDark(h, { bg = '#1e2027', minContrast = 3, maxL = 0.86 } = {}) {
	if (!h) return h;
	let [L, C, H] = oklch(h);
	if (L > maxL) L = maxL;
	let out = oklchToHex(L, C, H);
	while (contrast(out, bg) < minContrast && L < 1) {
		L += 0.01;
		out = oklchToHex(L, C, H);
	}
	return out;
}
export function tintAtContrast(target, surface, tint, dir) {
	if (tint.maxContrast && dir !== 'darker') target = Math.min(target, tint.maxContrast);
	const Ys = lum(surface);
	const Yt = dir === 'darker' ? (Ys + 0.05) / target - 0.05 : target * (Ys + 0.05) - 0.05;
	const H = (tint.hue * Math.PI) / 180;
	let lo = 0, hi = 1;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		if (lum(oklchToHex(mid, tint.chroma, H)) < Yt) lo = mid; else hi = mid;
	}
	let best = null;
	for (let d = -0.004; d <= 0.0041; d += 0.001) {
		const hx = oklchToHex((lo + hi) / 2 + d, tint.chroma, H);
		const err = Math.abs(Math.log(contrast(hx, surface) / target));
		if (!best || err < best.err - 1e-12) best = { hx, err };
	}
	return best.hx;
}

export async function loadColorLib() {
	const probe = ['#4c40a2', '#0303b0', '#571961', '#d40014', '#182bfb', '#8a6117'];
	try {
		const f = path.join(KIT, 'lib', 'color.mjs');
		if (fs.existsSync(f)) {
			const m = await import(pathToFileURL(f).href);
			if (typeof m.adaptForDark === 'function') {
				const same = probe.every((c) => {
					try { return norm(m.adaptForDark(c, { minContrast: 3, bg: '#1e2027' })) === localAdaptForDark(c, { minContrast: 3, bg: '#1e2027' }); }
					catch { return false; }
				});
				if (same) return { adaptForDark: (c, o) => norm(m.adaptForDark(c, o)), source: 'lib/color.mjs' };
				return { adaptForDark: localAdaptForDark, source: 'local (lib/color.mjs adaptForDark differs from v1 on probe colours)' };
			}
		}
	} catch (e) {
		return { adaptForDark: localAdaptForDark, source: 'local (lib/color.mjs failed to load: ' + e.message + ')' };
	}
	return { adaptForDark: localAdaptForDark, source: 'local (lib/color.mjs absent)' };
}
export { localAdaptForDark };

export function iconRamp(A) {
	const S = norm(A.surface.dark), SL = norm(A.surface.light || '#ffffff');
	const pins = (A.pins && A.pins.ramp) || {};
	const out = [];
	for (const [, h, dir] of A.ramp) {
		if (dir === 'darker') continue;
		const l = norm(h);
		let d;
		if (l === SL) d = S;
		else if (pins[l]) d = norm(pins[l]);
		else d = tintAtContrast(contrast(l, SL), S, A.tint, 'lighter');
		out.push([l, d]);
	}
	return out;
}
export function makeMirror(RAMP, SURFACE) {
	const pts = RAMP.map(([l, d]) => ({ l, d, cl: contrast(l, '#ffffff'), cd: contrast(d, SURFACE) })).sort((a, b) => a.cl - b.cl);
	return function mirrorGrey(h) {
		const target = contrast(h, '#ffffff');
		const exact = pts.find((p) => p.l === h);
		if (exact) return exact.d;
		if (target >= pts[pts.length - 1].cl) return pts[pts.length - 1].d;
		let i = 0;
		while (i < pts.length - 2 && target > pts[i + 1].cl) i++;
		const [a, b] = [pts[i], pts[i + 1]];
		const want = a.cd + ((target - a.cl) / (b.cl - a.cl)) * (b.cd - a.cd);
		const [ca, cb] = [rgb(a.d), rgb(b.d)];
		let lo = 0, hi = 1, out = a.d;
		for (let k = 0; k < 40; k++) {
			const t = (lo + hi) / 2;
			out = hex(ca.map((v, j) => v + (cb[j] - v) * t));
			if (contrast(out, SURFACE) < want) lo = t;
			else hi = t;
		}
		return out;
	};
}

export const COLOR_ATTRS = ['fill', 'stroke', 'stop-color'];
const WHITE = '#ffffff';
export function walkFiles(dir, re, acc = []) {
	if (!fs.existsSync(dir)) return acc;
	for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walkFiles(p, re, acc);
		else if (re.test(e.name)) acc.push(p);
	}
	return acc;
}
const TAG_RE = /<([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const ATTR_RE = /(\s)(fill|stroke|stop-color)(\s*=\s*)(["'])([^"']*)\4/gi;
export function rewriteSvg(src, fn, rootExtra) {
	const kept = [];
	let s = src.replace(/<!--[\s\S]*?-->|<(clipPath|mask)\b[\s\S]*?<\/\1>/gi, (m) => `\u0000${kept.push(m) - 1}\u0000`);
	let seenRoot = false;
	let whiteIndex = 0;
	s = s.replace(TAG_RE, (tagText, tag, attrs, selfClose) => {
		const isRoot = !seenRoot && tag.toLowerCase() === 'svg';
		if (isRoot) seenRoot = true;
		const found = [];
		attrs.replace(ATTR_RE, (m, sp, name, eq, q, val, offset) => {
			found.push({ name: name.toLowerCase(), val, offset });
			return m;
		});
		found.sort((a, b) => COLOR_ATTRS.indexOf(a.name) - COLOR_ATTRS.indexOf(b.name) || a.offset - b.offset);
		const replacement = new Map();
		for (const f of found) {
			const value = norm(f.val);
			const isWhite = value === WHITE;
			const ctx = { tag, isRoot, attr: f.name, raw: f.val, value, whiteIndex: isWhite && !isRoot ? whiteIndex++ : -1 };
			const out = fn(ctx);
			if (out !== undefined && out !== f.val) replacement.set(f.offset, out);
		}
		let newAttrs = attrs.replace(ATTR_RE, (m, sp, name, eq, q, val, offset) =>
			replacement.has(offset) ? `${sp}${name}${eq}${q}${replacement.get(offset)}${q}` : m
		);
		const extra = isRoot && rootExtra ? rootExtra(attrs) || '' : '';
		if (!replacement.size && !extra) return tagText;
		newAttrs += extra;
		return `<${tag}${newAttrs}${selfClose ? '/' : ''}>`;
	});
	return s.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[+i]);
}
const STYLE_COLOR_RE = /((?:^|[;{\s])(?:fill|stroke|stop-color)\s*:\s*)(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|white\b|black\b)/gi;
export function rewriteSvgStyles(src, fn) {
	const sub = (css) => css.replace(STYLE_COLOR_RE, (m, pre, c) => {
		const out = fn(norm(c), c);
		return out === undefined ? m : pre + out;
	});
	return src
		.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + sub(css) + b)
		.replace(/(\sstyle\s*=\s*)(["'])([^"']*)\2/gi, (m, a, q, css) => a + q + sub(css) + q);
}
export function svgStyleColors(src) {
	const out = [];
	rewriteSvgStyles(src, (c) => { out.push(c); return undefined; });
	return out;
}
function collect(src) {
	const occ = [];
	rewriteSvg(src, (ctx) => { occ.push(ctx); });
	return occ;
}
const GRAY_BASES = ['#4f4f4f', '#878787', '#696969', '#505050', '#757575', '#424242'];
function classifyWhite(occ, aliases, grayBases) {
	const seq = occ
		.filter((o) => !o.isRoot && o.value !== 'none' && !o.value.startsWith('url(') && !o.value.startsWith('var('))
		.map((o) => ({ c: aliases[o.value] || o.value, w: o.whiteIndex }));
	const first = seq.findIndex((x) => x.c === WHITE);
	if (first === -1) return { cls: 'none', cut: [] };
	const nonWhite = seq.filter((x) => x.c !== WHITE);
	let cls;
	if (nonWhite.length === 0) cls = 'white-only';
	else if (first === 0) cls = 'plate';
	else cls = seq.slice(0, first).every((x) => grayBases.includes(x.c)) ? 'detail-on-gray' : 'detail-on-color';
	const cut = [];
	if (cls === 'plate' || cls === 'detail-on-gray') {
		let prev = null;
		for (const x of seq) {
			if (x.c === WHITE) {
				if (prev === null || !isHex6(prev) || isNeutral(prev)) cut.push(x.w);
			} else prev = x.c;
		}
	}
	return { cls, cut };
}

function skipString(s, i) {
	const q = s[i];
	for (let j = i + 1; j < s.length; j++) {
		if (s[j] === '\\') j++;
		else if (s[j] === q) return j + 1;
	}
	return s.length;
}
export function stripComments(css) {
	let out = '';
	for (let i = 0; i < css.length; i++) {
		const ch = css[i];
		if (ch === '"' || ch === "'") {
			const j = skipString(css, i);
			out += css.slice(i, j);
			i = j - 1;
		} else if (ch === '/' && css[i + 1] === '*') {
			const j = css.indexOf('*/', i + 2);
			i = j === -1 ? css.length : j + 1;
		} else out += ch;
	}
	return out;
}
export function parseBlocks(css) {
	const nodes = [];
	let i = 0, start = 0, paren = 0;
	while (i < css.length) {
		const ch = css[i];
		if (ch === '"' || ch === "'") { i = skipString(css, i); continue; }
		if (ch === '(') paren++;
		else if (ch === ')') paren = Math.max(0, paren - 1);
		else if (ch === ';' && paren === 0 && css.slice(start, i).trim().startsWith('@')) { start = i + 1; }
		else if (ch === '{' && paren === 0) {
			const prelude = css.slice(start, i).trim();
			let depth = 1, j = i + 1;
			while (j < css.length && depth) {
				const c = css[j];
				if (c === '"' || c === "'") { j = skipString(css, j); continue; }
				if (c === '{') depth++;
				else if (c === '}') depth--;
				j++;
			}
			const body = css.slice(i + 1, j - 1);
			const node = { prelude, body };
			if (/^@(media|supports|document|layer)\b/i.test(prelude)) node.children = parseBlocks(body);
			nodes.push(node);
			i = start = j;
			continue;
		}
		i++;
	}
	return nodes;
}
export function splitTop(s, sep) {
	const parts = [];
	let depth = 0, start = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '"' || ch === "'") { i = skipString(s, i) - 1; continue; }
		if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (ch === sep && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
	}
	parts.push(s.slice(start));
	return parts;
}
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
function prefixSelector(sel) {
	sel = sel.trim();
	if (/^html\b/i.test(sel)) return sel.replace(/^html/i, 'html:where([data-theme="dark"])');
	if (/^:root\b/i.test(sel)) return sel.replace(/^:root/i, ':root:where([data-theme="dark"])');
	return `:where(html[data-theme="dark"]) ${sel}`;
}

export function loadIconExceptions(file) {
	const ov = JSON.parse(fs.readFileSync(file, 'utf8'));
	const lc = (k) => k.toLowerCase();
	return {
		raw: ov,
		cutout: new Map(Object.entries(ov.cutout || {}).map(([k, v]) => [lc(k), v])),
		keepWhite: new Set((ov.keepWhite || []).map(lc)),
		noRemap: new Set((ov.noRemap || []).map(lc)),
		logoIds: new Set(((ov.logos && ov.logos.ids) || []).map(lc)),
		logoColors: new Set(((ov.logos && ov.logos.colors) || []).map(norm)),
		logoInkToken: (ov.logos && ov.logos.inkToken) || '--text',
		noFill: new Map(Object.entries(ov.noFill || {}).map(([k, v]) => [lc(k), { ...v }])),
		aliases: Object.fromEntries(Object.entries(ov.aliases || {}).map(([k, v]) => [norm(k), norm(v)])),
		liftExclude: (ov.liftExclude || []).map(norm),
		liftExcludeTokens: ov.liftExcludeTokens || [],
		liftExcludeTokenMinContrast: ov.liftExcludeTokenMinContrast == null ? 2 : ov.liftExcludeTokenMinContrast,
		liftMinContrast: ov.liftMinContrast == null ? 3 : ov.liftMinContrast,
		grayBases: (ov.grayBases || GRAY_BASES).map(norm),
		grayBaseTokens: ov.grayBaseTokens || []
	};
}

export function rampTokenDark(A, token) {
	const S = norm(A.surface.dark), SL = norm(A.surface.light || '#ffffff');
	const light = A.light && A.light[token] ? norm(A.light[token]) : null;
	if (!light) return null;
	const pin = A.pins && A.pins[token] && (A.pins[token][light] || A.pins[token]['*']);
	if (pin) return norm(pin);
	const step = iconRamp(A).find(([l]) => l === light);
	if (step) return step[1];
	return tintAtContrast(contrast(light, SL), S, A.tint, 'lighter');
}

export async function genIcons(opts) {
	const target = path.resolve(opts.target);
	const snapshot = opts.snapshot && opts.snapshot !== true ? path.resolve(opts.snapshot) : null;
	const outDir = path.resolve(opts.out);
	const A = loadAnchors(path.resolve(opts.anchors));
	const ex = loadIconExceptions(opts.exceptions ? path.resolve(opts.exceptions) : path.join(KIT, 'exceptions', 'icons.json'));
	const log = opts.quiet ? () => {} : (...a) => console.log(...a);
	const resolve = makeResolver(target, snapshot);
	const color = opts['color-lib'] === 'local' ? { adaptForDark: localAdaptForDark, source: 'local (--color-lib local)' } : await loadColorLib();
	const adaptForDark = color.adaptForDark;

	const CLIENT_REL = 'Innovator/Client';
	const CLIENT = path.join(target, CLIENT_REL);
	const IMAGES = path.join(CLIENT, 'images');
	const DARK_IMAGES = path.join(CLIENT, 'images-dark');
	const CSS_BASE = path.join(CLIENT, 'darkmode');
	const readRel = (absInTarget) => fs.readFileSync(resolve(posix(path.relative(target, absInTarget))), 'utf8');

	const SURFACE = norm(A.surface.dark);
	const RAMP = iconRamp(A);
	const mirrorGrey = makeMirror(RAMP, SURFACE);
	const logoInk = rampTokenDark(A, ex.logoInkToken) || '#dde0e8';
	const cutoutDark = SURFACE;
	for (const v of ex.noFill.values()) v.static = /^--/.test(v.static) ? rampTokenDark(A, v.static) || '#000000' : norm(v.static);

	const liftExclude = [...ex.liftExclude];
	const liftExcludeFromTokens = [];
	for (const t of ex.liftExcludeTokens) {
		const l = A.light && A.light[t] ? norm(A.light[t]) : null;
		if (l && isHex6(l) && !liftExclude.includes(l) && contrast(l, SURFACE) >= ex.liftExcludeTokenMinContrast) {
			liftExclude.push(l);
			liftExcludeFromTokens.push({ token: t, light: l, contrast: +contrast(l, SURFACE).toFixed(2) });
		}
	}
	const grayBases = [...ex.grayBases];
	for (const t of ex.grayBaseTokens) {
		const l = A.light && A.light[t] ? norm(A.light[t]) : null;
		if (l && isHex6(l) && isNeutral(l) && !grayBases.includes(l)) grayBases.push(l);
	}
	const nearExcluded = (c) => liftExclude.some((e) => rgb(e).every((v, i) => Math.abs(v - rgb(c)[i]) <= 6));

	const files = walkFiles(IMAGES, /\.svg$/i);
	const icons = files.map((f) => {
		const rel = posix(path.relative(IMAGES, f));
		const key = rel.replace(/\.svg$/i, '').toLowerCase();
		const src = readRel(f);
		return { rel, key, src, occ: collect(src), styleColors: svgStyleColors(src), topLevel: !rel.includes('/') };
	});
	const byKey = new Map(icons.map((ic) => [ic.key, ic]));
	const aliases = ex.aliases;

	const used = new Map();
	for (const ic of icons) {
		const set = new Set([...ic.occ.map((o) => aliases[o.value] || o.value), ...ic.styleColors]);
		for (const o of ic.occ) {
			const m = /^var\([^,]+,\s*(#[0-9a-f]{3,6})\s*\)$/.exec(o.value);
			if (m) set.add(norm(m[1]));
		}
		for (const c of set) if (isHex6(c)) used.set(c, (used.get(c) || 0) + 1);
	}
	const greys = {};
	const lifts = {};
	const keptLow = [];
	for (const c of [...used.keys()].sort()) {
		if (c === WHITE) continue;
		if (isNeutral(c)) greys[c] = mirrorGrey(c);
		else if (contrast(c, SURFACE) < ex.liftMinContrast) {
			if (nearExcluded(c)) { keptLow.push({ color: c, contrast: +contrast(c, SURFACE).toFixed(2), files: used.get(c) }); continue; }
			const d = norm(adaptForDark(c, { minContrast: ex.liftMinContrast, bg: SURFACE }));
			if (d !== c) lifts[c] = d;
		}
	}
	const varFor = (c) => (greys[c] ? `--dm-svg-g-${c.slice(1)}` : lifts[c] ? `--dm-svg-c-${c.slice(1)}` : null);
	const darkFor = (c) => greys[c] || lifts[c] || null;

	const logoColors = new Set(ex.logoColors);
	for (const id of ex.logoIds) {
		const ic = byKey.get(id);
		if (!ic) continue;
		for (const o of ic.occ) {
			const c = aliases[o.value] || o.value;
			if (isHex6(c) && c !== WHITE && isNeutral(c) && contrast(c, '#ffffff') >= 4.5) logoColors.add(c);
		}
	}

	const mapCutout = {};
	const changed = [];
	const styled = [];
	const stats = { cutoutIcons: 0, cutoutFills: 0, overridden: [], overrideMissing: [], overrideSkipped: [], classes: {} };
	for (const key of [...ex.cutout.keys(), ...ex.keepWhite, ...ex.noRemap, ...ex.noFill.keys(), ...ex.logoIds])
		if (!byKey.has(key)) stats.overrideMissing.push(key);
	for (const ic of icons) {
		if (ex.noRemap.has(ic.key)) { ic.skipped = true; continue; }
		const { cls, cut } = classifyWhite(ic.occ, aliases, grayBases);
		ic.cls = cls;
		stats.classes[cls] = (stats.classes[cls] || 0) + 1;
		let cutIdx = cut;
		const whiteCount = ic.occ.filter((o) => o.whiteIndex >= 0).length;
		if (ex.keepWhite.has(ic.key)) { cutIdx = []; stats.overridden.push(`${ic.rel}: keep white`); }
		if (ex.cutout.has(ic.key)) {
			const v = ex.cutout.get(ic.key);
			if (v === 'all') {
				cutIdx = [...Array(whiteCount).keys()];
				stats.overridden.push(`${ic.rel}: cut-out all`);
			} else {
				const spec = Array.isArray(v) ? { indices: v } : v;
				if (spec.whites != null && spec.whites !== whiteCount) {
					stats.overrideSkipped.push({ icon: ic.rel, reason: `cut-out indices ${JSON.stringify(spec.indices)} reviewed for ${spec.whites} white fills, this file has ${whiteCount}; heuristic used` });
				} else {
					cutIdx = spec.indices.filter((i) => i < whiteCount);
					stats.overridden.push(`${ic.rel}: cut-out ${JSON.stringify(spec.indices)}`);
				}
			}
		}
		ic.cut = new Set(cutIdx);
		if (cutIdx.length && ic.topLevel) mapCutout[ic.key] = [...cutIdx].sort((a, b) => a - b);
		if (cutIdx.length) { stats.cutoutIcons++; stats.cutoutFills += cutIdx.length; }
		const isLogo = ex.logoIds.has(ic.key);
		const nf = ex.noFill.get(ic.key);
		const hasFill = ic.occ.some((o) => o.attr === 'fill') || ic.styleColors.length > 0;
		const nfLight = nf ? norm(nf.light) : null;
		let out = rewriteSvg(
			ic.src,
			(o) => {
				if (o.value === WHITE) return o.whiteIndex >= 0 && ic.cut.has(o.whiteIndex) ? cutoutDark : undefined;
				if (nf && o.value === nfLight) return nf.static === nfLight ? undefined : nf.static;
				const vm = /^var\(([^,]+),\s*(#[0-9a-f]{3,6})\s*\)$/i.exec(o.raw.trim());
				if (vm) {
					return darkFor(norm(vm[2])) || undefined;
				}
				const c = aliases[o.value] || o.value;
				if (isLogo) return logoColors.has(c) ? logoInk : undefined;
				return darkFor(c) || undefined;
			},
			nf && !hasFill ? (attrs) => (/\sfill\s*=/.test(attrs) ? '' : ` fill="${nf.static}"`) : null
		);
		if (ic.styleColors.length) {
			styled.push(ic.key);
			out = rewriteSvgStyles(out, (c) => {
				const cc = aliases[c] || c;
				if (cc === WHITE) return undefined;
				if (isLogo) return logoColors.has(cc) ? logoInk : undefined;
				return darkFor(cc) || undefined;
			});
		}
		if (out !== ic.src) changed.push({ ic, out });
	}

	const fills = {};
	const vars = {};
	for (const c of [...Object.keys(greys), ...Object.keys(lifts)]) { fills[c] = darkFor(c); vars[c] = varFor(c); }
	const nofillMap = {};
	for (const [k, v] of ex.noFill) {
		if (k.includes('/') || !byKey.has(k)) continue;
		nofillMap[k] = { var: `--dm-svg-nofill-${k}`, light: v.light, dark: norm(v.static) };
	}
	const iconsJson = {
		schema: 'aras-darkmode-icons/1',
		_generated: 'by DarkModeKit/lib/gen-icons.mjs - do not edit; edit exceptions/icons.json and re-run',
		surface: SURFACE,
		attrs: COLOR_ATTRS,
		fills,
		vars,
		aliases,
		cutout: mapCutout,
		cutoutVar: '--dm-svg-cutout',
		cutoutDark,
		keepWhite: [...ex.keepWhite].filter((k) => byKey.has(k)).sort(),
		noRemap: [...ex.noRemap].filter((k) => byKey.has(k)).sort(),
		logos: { ids: [...ex.logoIds].filter((k) => byKey.has(k)).sort(), colors: [...logoColors].sort(), var: '--dm-svg-logo-ink', ink: logoInk },
		nofill: nofillMap,
		styled: styled.filter((k) => !k.includes('/')).sort(),
		files: Object.fromEntries(changed.map((x) => x.ic.rel).sort().map((r) => [`images/${r}`, `images-dark/${r}`]))
	};

	const changedByRel = new Map(changed.map((x) => [x.ic.rel.toLowerCase(), x.ic.rel]));
	const relFromCss = (p) => posix(path.relative(CSS_BASE, p));
	const L = [];
	L.push('/*');
	L.push(' * GENERATED by DarkModeKit/lib/gen-icons.mjs - do not edit by hand.');
	L.push(' * Icon custom properties and <img>/CSS-background overrides. url()s are relative to');
	L.push(' * Innovator/Client/darkmode/ (this text is concatenated into darkmode/dark.css).');
	L.push(' * Nothing here applies in light mode: every rule is scoped to html[data-theme="dark"], and the');
	L.push(' * --dm-svg-* properties are undefined in light (the sprite hook writes var(--dm-svg-*, <original>)).');
	L.push(' */');
	L.push('');
	L.push(`/* Neutral grey remap: contrast vs ${SURFACE} in dark = contrast vs #fff in light.`);
	L.push('   light     dark      C(light,#fff) C(dark,surface) files */');
	const varLines = [];
	for (const [l, d] of Object.entries(greys)) {
		L.push(`/* ${l}   ${d}   ${contrast(l, '#ffffff').toFixed(2).padStart(6)}       ${contrast(d, SURFACE).toFixed(2).padStart(6)}        ${String(used.get(l)).padStart(4)}${RAMP.some((r) => r[0] === l) ? '   (ramp)' : ''} */`);
		varLines.push(`\t${varFor(l)}: ${d};`);
	}
	L.push(`/* Lifted dim colours: adaptForDark(c, { minContrast: ${ex.liftMinContrast}, bg: ${SURFACE} }).`);
	L.push('   light     dark      C(light) C(dark) files */');
	for (const [l, d] of Object.entries(lifts)) {
		L.push(`/* ${l}   ${d}   ${contrast(l, SURFACE).toFixed(2)}     ${contrast(d, SURFACE).toFixed(2)}    ${String(used.get(l)).padStart(4)} */`);
		varLines.push(`\t${varFor(l)}: ${d};`);
	}
	L.push('');
	L.push('html[data-theme="dark"] {');
	L.push(...varLines);
	L.push(`\t--dm-svg-cutout: var(--dm-surface, ${cutoutDark}); /* white cut-outs and page plates */`);
	L.push(`\t--dm-svg-logo-ink: ${logoInk}; /* logo lettering (${ex.logoInkToken}) */`);
	for (const [k, v] of Object.entries(nofillMap)) {
		const nf = ex.noFill.get(k);
		L.push(`\t${v.var}: ${nf.cssDark || nf.static};`);
	}
	L.push('}');
	L.push('');
	L.push('/* <img src=".../images/X.svg"> -> images-dark/X.svg (changed icons only). */');
	for (const { ic } of changed) {
		L.push(`html[data-theme="dark"] img[src$="images/${ic.rel}" i]:not([src*="Modules/" i]):not([src*="customer/" i]) { content: url("${relFromCss(path.join(DARK_IMAGES, ic.rel))}"); }`);
	}
	L.push('');

	const cssFiles = [];
	(function walkCss(dir) {
		if (!fs.existsSync(dir)) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
			const p = path.join(dir, e.name);
			const rel = posix(path.relative(CLIENT, p));
			if (e.isDirectory()) {
				if (/3rdPartyLibs|thirdparty/i.test(rel) || /^(nodejs|node_modules|vendors|images|images-dark|imagesLegacy|darkmode|styles\/darkmode|javascript\/(dojo|dijit|dojox))$/i.test(rel) || /node_modules$/i.test(rel)) continue;
				walkCss(p);
			} else if (/\.css$/i.test(e.name) && !/\.min\.css$/i.test(e.name)) cssFiles.push(p);
		}
	})(CLIENT);

	const svgDataRe = /^data:image\/svg\+xml/i;
	const shape = (s) => s.replace(/^﻿/, '').replace(/#[0-9a-f]{3,6}\b/gi, '#').replace(/\s+/g, ' ').trim();
	const iconShapes = new Set(walkFiles(path.join(CLIENT, 'styles/svg'), /\.svg$/i).map((f) => shape(readRel(f))));
	const isIconDataSvg = (svg) => iconShapes.has(shape(svg));
	const dataDark = (c) => {
		if (!isHex6(c) || c === WHITE) return null;
		if (darkFor(c)) return darkFor(c);
		if (isNeutral(c)) return mirrorGrey(c);
		if (contrast(c, SURFACE) < ex.liftMinContrast && !nearExcluded(c)) return norm(adaptForDark(c, { minContrast: ex.liftMinContrast, bg: SURFACE }));
		return null;
	};
	const remapDataSvg = (svg) =>
		rewriteSvg(svg, (o) => {
			if (o.value === WHITE) return undefined;
			const d = dataDark(aliases[o.value] || o.value);
			if (!d || d === o.value) return undefined;
			return o.raw === o.raw.toUpperCase() ? d.toUpperCase() : d;
		});
	const cssStats = { files: 0, rules: 0, dataUri: 0, perFile: {} };
	const unresolved = [];
	let unresolvedWebHelp = 0;
	const rasterRefs = new Map();
	for (const file of cssFiles) {
		const text = readRel(file);
		const fileRel = posix(path.relative(CLIENT, file));
		for (const m of text.matchAll(/url\(\s*["']?([^"')]+\.(?:png|gif|jpe?g))/gi)) rasterRefs.set(fileRel, (rasterRefs.get(fileRel) || 0) + 1);
		if (!/url\(/i.test(text) || !/\.svg|svg\+xml/i.test(text)) continue;
		const out = [];
		const resolveUrl = (u) => {
			if (svgDataRe.test(u)) {
				const comma = u.indexOf(',');
				const head = u.slice(0, comma);
				const isB64 = /;base64$/i.test(head);
				let svg;
				try { svg = isB64 ? Buffer.from(u.slice(comma + 1), 'base64').toString('utf8') : decodeURIComponent(u.slice(comma + 1)); } catch { return null; }
				if (!isIconDataSvg(svg)) return null;
				const dark = remapDataSvg(svg);
				if (dark === svg) return { url: u, changed: false };
				cssStats.dataUri++;
				return { url: isB64 ? `${head},${Buffer.from(dark).toString('base64')}` : `${head},${encodeURIComponent(dark).replace(/'/g, '%27')}`, changed: true };
			}
			if (/^(data:|https?:|\/\/|#)/i.test(u) || !u) return null;
			const clean = u.split(/[?#]/)[0];
			const abs = path.resolve(path.dirname(file), clean);
			let relImg = null;
			const underImages = path.relative(IMAGES, abs);
			if (!underImages.startsWith('..') && !path.isAbsolute(underImages)) relImg = posix(underImages);
			else if (!fs.existsSync(abs)) {
				const m = /(?:^|\/)images\/(.+\.svg)$/i.exec(clean);
				if (m && fs.existsSync(path.join(IMAGES, m[1]))) relImg = m[1];
			}
			if (relImg && /\.svg$/i.test(relImg)) {
				const hit = changedByRel.get(relImg.toLowerCase());
				if (hit) return { url: relFromCss(path.join(DARK_IMAGES, hit)), changed: true };
				return { url: relFromCss(path.join(IMAGES, relImg)), changed: false };
			}
			if (fs.existsSync(abs)) return { url: relFromCss(abs), changed: false };
			if (/\.svg$/i.test(clean)) {
				if (/^WebHelp\//i.test(fileRel)) unresolvedWebHelp++;
				else unresolved.push({ file: fileRel, url: u });
			}
			return null;
		};
		const handleRule = (node, indent) => {
			const decls = splitTop(node.body, ';');
			const outDecls = [];
			for (const d of decls) {
				const ci = d.indexOf(':');
				if (ci < 0) continue;
				const prop = d.slice(0, ci).trim().toLowerCase();
				if (!['background', 'background-image', 'content'].includes(prop)) continue;
				let value = d.slice(ci + 1).trim();
				const important = /!\s*important\s*$/i.test(value);
				value = value.replace(/!\s*important\s*$/i, '').trim();
				if (!/url\(/i.test(value)) continue;
				let anyChanged = false, bad = false;
				const rewriteUrls = (v) =>
					v.replace(URL_RE, (m, a, b, c) => {
						const r = resolveUrl(a ?? b ?? c ?? '');
						if (!r) { bad = true; return m; }
						if (r.changed) anyChanged = true;
						return `url("${r.url}")`;
					});
				let outValue;
				if (prop === 'background') {
					outValue = splitTop(value, ',')
						.map((layer) => {
							const m = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)|(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/i.exec(layer);
							return m ? rewriteUrls(m[0]) : 'none';
						})
						.join(', ');
				} else outValue = rewriteUrls(value);
				if (!anyChanged || bad) continue;
				outDecls.push(`${prop === 'content' ? 'content' : 'background-image'}: ${outValue}${important ? ' !important' : ''};`);
			}
			if (!outDecls.length) return;
			const sel = splitTop(node.prelude.replace(/\s+/g, ' '), ',').map(prefixSelector).join(',\n' + indent);
			out.push(`${indent}${sel} {\n${outDecls.map((x) => `${indent}\t${x}`).join('\n')}\n${indent}}`);
			cssStats.rules++;
			cssStats.perFile[fileRel] = (cssStats.perFile[fileRel] || 0) + 1;
		};
		const visit = (nodes, indent) => {
			for (const n of nodes) {
				if (n.children) {
					const before = out.length;
					out.push(`${indent}${n.prelude} {`);
					visit(n.children, indent + '\t');
					if (out.length === before + 1) out.pop();
					else out.push(`${indent}}`);
				} else if (!n.prelude.startsWith('@')) handleRule(n, indent);
			}
		};
		visit(parseBlocks(stripComments(text)), '');
		if (out.length) {
			cssStats.files++;
			L.push(`/* from ${fileRel} */`);
			L.push(...out);
			L.push('');
		}
	}
	const css = L.join('\n');

	const outputs = new Map();
	const outImages = path.join(outDir, 'images-dark');
	for (const { ic, out } of changed) outputs.set(path.join(outImages, ic.rel), out);
	outputs.set(path.join(outDir, 'client', 'gen', 'icons-dark.css'), css);
	outputs.set(path.join(outDir, 'data', 'icons.json'), JSON.stringify(iconsJson, null, '\t') + '\n');
	const stale = walkFiles(outImages, /\.svg$/i).filter((p) => !outputs.has(p));
	let written = 0;
	for (const [p, content] of outputs) if (writeIfChanged(p, content)) written++;
	for (const p of stale) fs.unlinkSync(p);

	const moduleSvgDirs = {};
	for (const f of walkFiles(path.join(CLIENT, 'Modules'), /\.svg$/i)) {
		const d = posix(path.relative(CLIENT, path.dirname(f)));
		if (/3rdPartyLibs/i.test(d)) continue;
		moduleSvgDirs[d] = (moduleSvgDirs[d] || 0) + 1;
	}
	const noFillGaps = icons.filter((ic) => !ic.occ.some((o) => o.attr === 'fill') && !ic.styleColors.length && !ex.noFill.has(ic.key)).map((ic) => ic.rel);
	const paleTints = [...used.keys()].filter((c) => !isNeutral(c) && c !== WHITE && contrast(c, '#ffffff') < 1.6).sort();
	const coverage = {
		schema: 'aras-darkmode-coverage-icons/1',
		target,
		anchorsVersion: A.version,
		colorLib: color.source,
		surface: SURFACE,
		ramp: RAMP,
		logoInk,
		counts: {
			iconsScanned: icons.length,
			darkCopies: changed.length,
			unchanged: icons.length - changed.length - icons.filter((i) => i.skipped).length,
			skipped: icons.filter((i) => i.skipped).map((i) => i.rel),
			greys: Object.keys(greys).length,
			lifts: Object.keys(lifts).length,
			cutoutFills: stats.cutoutFills,
			cutoutIcons: stats.cutoutIcons,
			whiteClasses: stats.classes,
			imgRules: changed.length,
			cssBackgroundRules: cssStats.rules,
			cssBackgroundFiles: cssStats.files,
			dataUriRemapped: cssStats.dataUri,
			styleSvgShapes: iconShapes.size,
			filesWritten: written,
			staleRemoved: stale.length
		},
		greys,
		lifts,
		keptBelowContrast: keptLow,
		liftExcludeFromTokens,
		logoColors: [...logoColors].sort(),
		grayBases,
		styledIcons: styled,
		overrides: { applied: stats.overridden, notInThisVersion: [...new Set(stats.overrideMissing)].sort(), skipped: stats.overrideSkipped },
		gaps: {
			iconsWithoutFillNoOverride: noFillGaps,
			paleTintsUnchanged: paleTints,
			unresolvedCssSvgUrls: unresolved,
			unresolvedCssSvgUrlsInWebHelp: unresolvedWebHelp,
			cssFilesWithRasterUrls: Object.fromEntries([...rasterRefs].sort()),
			moduleSvgFoldersNotCovered: moduleSvgDirs,
			notCovered: [
				'Modules/*/images (Viewers, CMF, QueryBuilder, SSVC): not recoloured (same as v1)',
				'GraphView <image href> set from data',
				'raster images (png/gif) and claro sprites',
				'aras-image <img> fallback inside its shadow root: needs hook-components.js (data/icons.json files map)'
			]
		},
		cssBackgroundRulesPerFile: cssStats.perFile
	};
	writeIfChanged(path.join(outDir, 'report', 'coverage-icons.json'), JSON.stringify(coverage, null, '\t') + '\n');

	log(`gen-icons: ${A.version} target=${target}`);
	log(`  colour lib:   ${color.source}`);
	log(`  icons:        ${icons.length} scanned, ${changed.length} dark copies, ${coverage.counts.skipped.length} skipped`);
	log(`  colours:      ${Object.keys(greys).length} greys remapped, ${Object.keys(lifts).length} dim colours lifted, ${keptLow.length} kept (brand)`);
	log(`  cut-out:      ${stats.cutoutFills} white fills in ${stats.cutoutIcons} icons; overrides applied ${stats.overridden.length}, skipped ${stats.overrideSkipped.length}, not in version ${coverage.overrides.notInThisVersion.length}`);
	log(`  css:          ${changed.length} <img> rules, ${cssStats.rules} background rules from ${cssStats.files} files (${cssStats.dataUri} data-URI SVGs)`);
	if (noFillGaps.length) log(`  WARNING icons without any fill and no noFill override: ${noFillGaps.join(', ')}`);
	log(`  written:      ${written} file(s) changed, ${stale.length} stale removed`);
	return { coverage, iconsJson, written };
}

export const isMainModule = (url) => !!process.argv[1] && path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();
if (isMainModule(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	for (const k of ['target', 'anchors', 'out']) if (!args[k] || args[k] === true) { console.error(`gen-icons: --${k} is required`); process.exit(2); }
	genIcons(args).catch((e) => { console.error(e); process.exit(1); });
}
