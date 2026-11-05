import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as util from './util.mjs';
import { parseColor, toHex6, hexKey, toCss, COLOR_SCAN, rgbChroma } from './color.mjs';
import { loadAnchors, scopeExceptions, derive, createMapper, renderTokensCss, buildPalette, legacyDefs, DARK, DARK_WHERE } from './derive-palette.mjs';
import { extractBundleCss, fnv1a32 } from './extract-bundle-css.mjs';
import { entryPointsFromExceptions } from './inject-entrypoints.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function maskComments(css) {
	let out = '';
	let i = 0, last = 0, q = null;
	while (i < css.length) {
		const ch = css[i];
		if (q) {
			if (ch === '\\') { i += 2; continue; }
			if (ch === q || ch === '\n') q = null;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") { q = ch; i++; continue; }
		if (ch === '/' && css[i + 1] === '*') {
			const e = css.indexOf('*/', i + 2);
			const stop = e < 0 ? css.length : e + 2;
			out += css.slice(last, i) + css.slice(i, stop).replace(/[^\n]/g, ' ');
			last = i = stop;
			continue;
		}
		i++;
	}
	return out + css.slice(last);
}
const GROUP_AT = /^(media|supports|layer|container|document|-moz-document|scope|starting-style)$/i;
export function parseCss(src) {
	const css = maskComments(src.charCodeAt(0) === 0xfeff ? ' ' + src.slice(1) : src);
	const n = css.length;
	function scanTo(from, stops) {
		let depth = 0, q = null;
		for (let k = from; k < n; k++) {
			const ch = css[k];
			if (q) {
				if (ch === '\\') { k++; continue; }
				if (ch === q) q = null;
				continue;
			}
			if (ch === '"' || ch === "'") q = ch;
			else if (ch === '(' || ch === '[') depth++;
			else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
			else if (depth === 0 && stops.includes(ch)) return k;
		}
		return n;
	}
	function matchBrace(open) {
		let depth = 0, q = null;
		for (let k = open; k < n; k++) {
			const ch = css[k];
			if (q) {
				if (ch === '\\') { k++; continue; }
				if (ch === q) q = null;
				continue;
			}
			if (ch === '"' || ch === "'") q = ch;
			else if (ch === '{') depth++;
			else if (ch === '}') {
				depth--;
				if (depth === 0) return k;
			}
		}
		return n;
	}
	function decls(from, to) {
		const out = [];
		let nested = 0, k = from;
		while (k < to) {
			let e = scanTo(k, ';{}');
			if (e > to) e = to;
			if (css[e] === '{') {
				nested++;
				k = matchBrace(e) + 1;
				continue;
			}
			const c = scanTo(k, ':;');
			if (c < e && css[c] === ':') {
				const prop = css.slice(k, c).trim();
				let vs = c + 1;
				while (vs < e && /\s/.test(css[vs])) vs++;
				let ve = e;
				while (ve > vs && /\s/.test(css[ve - 1])) ve--;
				let value = css.slice(vs, ve);
				let important = false;
				const im = value.match(/\s*!\s*important\s*$/i);
				if (im) {
					important = true;
					ve -= im[0].length;
					value = css.slice(vs, ve);
				}
				if (prop && /^-{0,2}[a-zA-Z_][-\w]*$/.test(prop)) out.push({ prop, value, vStart: vs, vEnd: ve, important });
			}
			k = e + 1;
		}
		return { decls: out, nested };
	}
	function block(from, to) {
		const items = [];
		let i = from;
		while (i < to) {
			while (i < to && /\s/.test(css[i])) i++;
			if (i >= to) break;
			if (css[i] === '}') { i++; continue; }
			const h = scanTo(i, '{;}');
			if (h >= to || css[h] === '}') {
				const head = css.slice(i, Math.min(h, to)).trim();
				if (head) items.push({ type: 'skip', name: '?', prelude: head, start: i, end: Math.min(h, to) });
				i = Math.min(h, to) + 1;
				continue;
			}
			const head = css.slice(i, h).trim();
			if (css[h] === ';') {
				items.push({ type: 'skip', name: head.startsWith('@') ? head.split(/[\s;(]/)[0].slice(1).toLowerCase() : '?', prelude: head, start: i, end: h + 1 });
				i = h + 1;
				continue;
			}
			const close = matchBrace(h);
			if (head.startsWith('@')) {
				const name = ((head.match(/^@([-\w]+)/) || [])[1] || '').toLowerCase();
				if (GROUP_AT.test(name)) items.push({ type: 'at', name, prelude: head.replace(/\s+/g, ' '), start: i, end: close + 1, children: block(h + 1, close) });
				else items.push({ type: 'skip', name, prelude: head, start: i, end: close + 1 });
				i = close + 1;
				continue;
			}
			const d = decls(h + 1, close);
			items.push({ type: 'rule', sel: head, start: i, end: close + 1, decls: d.decls, nested: d.nested });
			i = close + 1;
		}
		return items;
	}
	return block(0, n);
}
export function* eachRule(items, ats = []) {
	for (const it of items) {
		if (it.type === 'rule') yield { rule: it, ats };
		else if (it.type === 'at') yield* eachRule(it.children, ats.concat(it.prelude));
	}
}
export function splitTop(s, sep = ',') {
	const out = [];
	let depth = 0, q = null, start = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (q) {
			if (ch === '\\') { i++; continue; }
			if (ch === q) q = null;
			continue;
		}
		if (ch === '"' || ch === "'") q = ch;
		else if (ch === '(' || ch === '[') depth++;
		else if (ch === ')' || ch === ']') depth--;
		else if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
			out.push(s.slice(start, i));
			start = i + 1;
		}
	}
	out.push(s.slice(start));
	return sep === ' ' ? out.filter((x) => x !== '') : out;
}

const SCAN_RE = new RegExp(COLOR_SCAN, 'gi');
function maskValue(v) {
	return v
		.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, (m) => 'u'.repeat(m.length))
		.replace(/"[^"]*"|'[^']*'/g, (m) => 'q'.repeat(m.length));
}
export function findLiterals(v, keepVars = []) {
	const masked = maskValue(v);
	const keepRanges = [];
	if (keepVars.length) {
		const re = new RegExp(`var\\(\\s*(${keepVars.map((s) => s.replace(/[-]/g, '\\-')).join('|')})\\s*,`, 'gi');
		for (const m of masked.matchAll(re)) {
			let depth = 1, k = m.index + m[0].length;
			for (; k < masked.length && depth; k++) {
				if (masked[k] === '(') depth++;
				else if (masked[k] === ')') depth--;
			}
			keepRanges.push([m.index, k]);
		}
	}
	const out = [];
	SCAN_RE.lastIndex = 0;
	for (const m of masked.matchAll(SCAN_RE)) {
		const lit = v.slice(m.index, m.index + m[0].length);
		const low = lit.toLowerCase();
		if (low === 'transparent' || low === 'currentcolor') continue;
		const kept = keepRanges.some(([a, b]) => m.index >= a && m.index < b);
		out.push({ lit, start: m.index, end: m.index + m[0].length, kept });
	}
	return out;
}
const GRADIENT_RE = /(?:-(?:webkit|moz|o|ms)-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(|-webkit-gradient\(/i;
const COLOR_PROPS = /^(-(webkit|moz|o|ms)-)?(color|caret-color|fill|stroke|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|border-color|outline(-color)?|box-shadow|text-shadow|column-rule(-color)?|text-decoration(-color)?|scrollbar-color|stop-color|flood-color|text-fill-color|text-stroke-color|accent-color)$/i;
export function roleOfProp(prop) {
	const p = prop.toLowerCase().replace(/^-(webkit|moz|o|ms)-/, '');
	if (p.startsWith('--')) {
		if (/shadow/.test(p)) return 'shadow';
		if (/(^|-)(bg|background|surface|fill)(-|$)/.test(p)) return 'bg';
		if (/(border|outline|stroke|line|divider|separator|splitter|ring)/.test(p)) return 'border';
		return 'custom';
	}
	if (p === 'color' || p === 'caret-color' || p === 'text-fill-color' || p.startsWith('text-decoration') || p === 'accent-color') return 'text';
	if (p.startsWith('background') || p === 'scrollbar-color' || p === 'flood-color' || p === 'stop-color') return 'bg';
	if (/shadow/.test(p)) return 'shadow';
	if (p === 'fill') return 'fill';
	if (p === 'stroke' || p === 'text-stroke-color') return 'stroke';
	if (p.startsWith('outline')) return 'outline';
	return 'border';
}
const NAME_ROLE = { bg: 'bg', text: 'text', border: 'border', shadow: 'shadow', fill: 'fill', stroke: 'stroke', outline: 'outline', custom: 'text' };

function compileList(list) {
	return (list || []).filter((s) => typeof s === 'string' && !s.startsWith('_')).map((s) => new RegExp(s, 'i'));
}
const anyMatch = (res, s) => res.some((r) => r.test(s));

export function createContext({ target, snapshot, anchors, exceptions, log }) {
	util.initSources({ target, snapshot });
	const A = loadAnchors(anchors);
	const D = derive(A);
	const exFile = exceptions || path.join(KIT, 'exceptions', 'overrides.json');
	const EX = scopeExceptions(util.readJson(exFile), A);
	const M = createMapper(A, D, EX);
	const keepVars = (EX.keepVarFallbacks || []).filter((s) => !s.startsWith('_'));
	const defs = {};
	const urlDefs = {};
	const reg = {
		name(role, lit, expr) {
			const c = parseColor(lit);
			const base = `--dm-${NAME_ROLE[role] || role}-${c && c.sys ? c.sys : (c && !c.kw ? hexKey(c) : '#x').slice(1)}`;
			if (defs[base] == null) {
				defs[base] = expr;
				return base;
			}
			if (defs[base] === expr) return base;
			const alt = base + '-' + fnv1a32(expr).slice(0, 4);
			defs[alt] = expr;
			return alt;
		}
	};
	const X = { A, D, M, EX, keepVars, defs, urlDefs, reg, log: log || util.createLogger('gen-overrides'), target };
	X.legacyNames = new Set([...Object.keys(legacyDefs(A, D)), ...Object.keys((A.tokens || {}).legacy || {}), ...Object.keys(EX.themeVars || {}), ...keepVars].filter((k) => k.startsWith('--')));
	X.shadowByLight = new Map(Object.entries(A.shadows || {}).map(([t, s]) => [normShadow(s), t]));
	return X;
}

function wrapLiteral(X, lit, role, ctx, stats) {
	const res = X.M.mapColor(lit, role, ctx);
	if (!res) {
		if (stats) stats.kept.push({ lit, role });
		return null;
	}
	if (stats && res.todo) stats.todo.push({ lit, role, why: res.todo });
	const name = X.reg.name(role, lit, res.expr);
	return { text: `var(${name}, ${lit})`, res };
}

export function normShadow(v) {
	let s = v.trim().toLowerCase();
	const lits = findLiterals(s);
	let out = '', last = 0;
	for (const L of lits) {
		const c = parseColor(L.lit);
		out += s.slice(last, L.start) + (c && !c.kw ? `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+(+c.a).toFixed(3)})` : L.lit);
		last = L.end;
	}
	s = out + s.slice(last);
	return s.replace(/\b0px\b/g, '0').replace(/(^|[\s(,])\.(\d)/g, '$10.$2').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
}
const roleClass = (role) => (role === 'bg' || role === 'fill' ? 'bg' : role === 'text' || role === 'custom' ? 'text' : 'border');
export function valueEdits(X, value, role, ctx, stats) {
	const edits = [];
	if (role === 'shadow' && X.shadowByLight) {
		const t = X.shadowByLight.get(normShadow(value));
		if (t) return [{ start: 0, end: value.length, text: `var(--dm${t.slice(1)}, ${value})` }];
	}
	const tv = X.EX.themeVars || {};
	const masked = maskValue(value);
	const taken = [];
	for (const m of masked.matchAll(/var\(\s*(--[\w-]+)\s*,/gi)) {
		const spec = tv[m[1]];
		if (!spec) continue;
		const t = spec[roleClass(role)];
		let d = 1, k = m.index + 4;
		for (; k < masked.length && d; k++) {
			if (masked[k] === '(') d++;
			else if (masked[k] === ')') d--;
		}
		if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue;
		taken.push([m.index, k]);
		const tk = t && X.M.tokName(t);
		if (tk && X.D.tokens[tk] != null) edits.push({ start: m.index, end: k, text: `var(--dm${tk.slice(1)}, ${value.slice(m.index, k)})` });
	}
	for (const L of findLiterals(value, X.keepVars)) {
		if (L.kept || taken.some(([a, b]) => L.start >= a && L.start < b)) continue;
		const w = wrapLiteral(X, L.lit, role, ctx, stats);
		if (w) edits.push({ start: L.start, end: L.end, text: w.text });
	}
	return edits.sort((a, b) => a.start - b.start);
}
export function mapValue(X, value, role, ctx, stats) {
	const edits = valueEdits(X, value, role, ctx, stats);
	if (!edits.length) return { text: value, changed: false };
	let out = '', last = 0;
	for (const e of edits) {
		out += value.slice(last, e.start) + e.text;
		last = e.end;
	}
	return { text: out + value.slice(last), changed: true };
}

const SVG_COLOR_RE = /(fill|stroke|stop-color|flood-color|color)(%3D|=|%3A|:)(\s*)(%22|%27|"|'|%20)?(%23|#)?([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3}|[a-zA-Z]+)(?=[%"'\s;,/)>&]|$)/g;
export function darkDataUrl(X, urlText, ctx) {
	if (!/^url\(\s*["']?data:image\/svg\+xml/i.test(urlText)) return null;
	let changed = false;
	const enc = /%23/i.test(urlText);
	const out = urlText.replace(SVG_COLOR_RE, (m, attr, eq, sp, q, hash, val) => {
		const lit = hash ? '#' + val : val;
		const c = parseColor(lit);
		if (!c || c.kw) return m;
		if (!hash && !/^[a-z]+$/i.test(val)) return m;
		if (c.r >= 250 && c.g >= 250 && c.b >= 250 && !X.M.isFloating(ctx.sel || '')) return m;
		const role = attr.toLowerCase() === 'stroke' ? 'stroke' : attr.toLowerCase() === 'color' ? 'text' : 'fill';
		const r = X.M.mapColor(lit, role, ctx);
		if (!r || !r.dark || r.dark.a === 0) return m;
		const hx = toHex6(r.dark);
		if (hx === toHex6(c)) return m;
		changed = true;
		return `${attr}${eq}${sp}${q || ''}${enc ? '%23' : '#'}${hx.slice(1)}`;
	});
	return changed ? out : null;
}
function urlVar(X, urlText, darkUrl) {
	const name = '--dm-url-' + fnv1a32(urlText);
	X.urlDefs[name] = darkUrl;
	return `var(${name}, ${urlText})`;
}
function mapUrls(X, value, ctx) {
	let changed = false;
	const text = value.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, (u) => {
		const d = darkDataUrl(X, u, ctx);
		if (!d) return u;
		changed = true;
		return urlVar(X, u, d);
	});
	return { text, changed };
}

export function veilEdits(X, value, ctx) {
	const rules = X.EX.veils || [];
	if (!rules.length || !GRADIENT_RE.test(value)) return null;
	const lits = findLiterals(value, []);
	let gradEnd = -1;
	for (const m of value.matchAll(new RegExp(GRADIENT_RE.source, 'gi'))) {
		let d = 1, k = m.index + m[0].length;
		for (; k < value.length && d; k++) {
			if (value[k] === '(') d++;
			else if (value[k] === ')') d--;
		}
		gradEnd = Math.max(gradEnd, k);
	}
	const base = lits.filter((l) => l.start >= gradEnd);
	const whites = lits.filter((l) => l.start < gradEnd);
	if (base.length !== 1 || !whites.length) return null;
	const wc = whites.map((l) => parseColor(l.lit));
	if (!wc.every((c) => c && !c.kw && c.r >= 250 && c.g >= 250 && c.b >= 250 && c.a < 1)) return null;
	const a = wc[0].a;
	if (!wc.every((c) => Math.abs(c.a - a) < 0.005)) return null;
	const bc = parseColor(base[0].lit);
	if (!bc || bc.kw) return null;
	const bh = toHex6(bc);
	const rule = rules.find((r) => {
		if (!r || !r.base || !r.token) return false;
		const want = r.base.startsWith('--') ? X.A.light[r.base] : r.base;
		if (!want || toHex6(parseColor(want)) !== bh) return false;
		const [lo, hi] = r.alpha || [0, 1];
		if (a < lo - 1e-6 || a > hi + 1e-6) return false;
		if (r.selectorRe && !new RegExp(r.selectorRe, 'i').test(ctx.sel || '')) return false;
		return true;
	});
	if (!rule) return null;
	const tok = X.M.tokName(rule.token);
	if (!tok || X.D.tokens[tok] == null) return null;
	const edits = whites.map((l) => ({ start: l.start, end: l.end, text: `var(${X.reg.name('bg', l.lit, 'transparent')}, ${l.lit})` }));
	let s = base[0].start, e = base[0].end;
	const before = value.slice(0, s);
	const vm = /var\(\s*--[\w-]+\s*,\s*$/.exec(before);
	if (vm) {
		s = vm.index;
		let d = 1, k = vm.index + 4;
		for (; k < value.length && d; k++) {
			if (value[k] === '(') d++;
			else if (value[k] === ')') d--;
		}
		e = k;
	}
	const name = vm ? '--dm' + tok.slice(1) : X.reg.name('bg', base[0].lit, `var(--dm${tok.slice(1)})`);
	edits.push({ start: s, end: e, text: `var(${name}, ${value.slice(s, e)})` });
	return edits.sort((x, y) => x.start - y.start);
}

export function transformDecl(X, d, ctx, stats) {
	const P = d.prop.toLowerCase();
	const base = P.replace(/^-(webkit|moz|o|ms)-/, '');
	const I = d.important ? ' !important' : '';
	const v = d.value.trim();
	const isClaro = /dijit\/themes\/claro/i.test(ctx.file);
	const isGloss = (val) => (isClaro && /Gradient\.png/i.test(val)) || /(row_back\.png|grid_dx_gradient\.gif)/i.test(val);
	const lits = findLiterals(v, X.keepVars);
	const tvNames = Object.keys(X.EX.themeVars || {}).filter((k) => k.startsWith('--'));
	const themeRe = new RegExp('var\\(\\s*(' + (tvNames.join('|') || '--none-') + ')\\s*,', 'i');
	const hasLit = lits.some((l) => !l.kept) || themeRe.test(v);
	const hasDataSvg = !!X.EX.pageDataUrls && /url\(\s*["']?data:image\/svg\+xml/i.test(v);
	const mapped = (val, role) => mapValue(X, val, role, { ...ctx, prop: P }, stats);
	const role = roleOfProp(P);

	const gradientValue = (g) => {
		if (ctx.policy !== 'less') {
			const cols = findLiterals(g).map((l) => parseColor(l.lit)).filter((c) => c && !c.kw);
			const veil = cols.length > 0 && cols.every((c) => c.a === 0 || (rgbChroma(c) <= 24 && (c.r + c.g + c.b) / 3 >= 180 && c.a < 1) || c.a <= 0.15);
			if (isClaro || veil) return 'none';
		}
		return mapped(g, 'bg').text;
	};

	if (P.startsWith('--')) {
		const rootOnly = !ctx.sel || ctx.sel.split(',').every((s) => /^\s*(:root|html|body)(?![\w-])/i.test(s));
		if (X.legacyNames.has(d.prop) && (rootOnly || !hasLit)) return [];
		if (!hasLit && !hasDataSvg) return ctx.verbatim ? [`${d.prop}: ${v}${I}`] : [];
		let t = mapped(v, role).text;
		if (hasDataSvg) t = mapUrls(X, t, { ...ctx, prop: P }).text;
		return [`${d.prop}: ${t}${I}`];
	}
	if (!COLOR_PROPS.test(P)) return [];
	const verbatim = () => (ctx.verbatim ? [`${P}: ${v}${I}`] : []);

	if (base === 'background' || base === 'background-image') {
		const ve = veilEdits(X, v, ctx);
		if (ve) {
			let o = '', last = 0;
			for (const e of ve) {
				o += v.slice(last, e.start) + e.text;
				last = e.end;
			}
			return [`${P}: ${o + v.slice(last)}${I}`];
		}
	}
	if (base === 'background') {
		const layers = splitTop(v, ',');
		const lastLayer = layers[layers.length - 1];
		const colorTok = splitTop(lastLayer, ' ').filter((t) => !GRADIENT_RE.test(t) && !/^url\(/i.test(t) && !/^var\(/i.test(t)).join(' ');
		const outside = findLiterals(colorTok).map((l) => l.lit).concat(colorTok.match(/(?<![\w-])(transparent|currentcolor|inherit|initial)(?![\w-])/gi) || []);
		const varTok = splitTop(lastLayer, ' ').find((t) => /^var\(/i.test(t));
		const out = [];
		const c = outside[0];
		if (varTok && !c) out.push(`background-color: ${mapped(varTok, 'bg').text}${I}`);
		else if (!c) out.push(`background-color: transparent${I}`);
		else if (/^(transparent|currentcolor|inherit|initial)$/i.test(c)) out.push(`background-color: ${c}${I}`);
		else out.push(`background-color: ${mapped(c, 'bg').text}${I}`);
		if (GRADIENT_RE.test(v) && !/url\(/i.test(v)) {
			const g = layers.map((l) => l.trim()).filter((l) => GRADIENT_RE.test(l)).map((l) => (l.match(/((?:-\w+-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)|-webkit-gradient\(.*\))/i) || [])[1]).filter(Boolean);
			if (g.length) {
				const gv = g.map(gradientValue);
				out.push(`background-image: ${gv.every((x) => x === 'none') ? 'none' : gv.join(', ')}${I}`);
			}
		} else if (isGloss(v)) out.push(`background-image: none${I}`);
		else if (hasDataSvg) {
			const imgs = layers.map((l) => (l.match(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/i) || [])[0]).filter(Boolean);
			const r = imgs.map((u) => mapUrls(X, u, { ...ctx, prop: 'background-image' }));
			if (r.some((x) => x.changed)) out.push(`background-image: ${r.map((x) => x.text).join(', ')}${I}`);
		}
		if (!hasLit && !ctx.verbatim && out.length === 1 && /^background-color: (transparent|currentcolor|inherit|initial)/i.test(out[0]) && !isGloss(v)) return [];
		return out;
	}
	if (base === 'background-image') {
		if (isGloss(v)) return [`${P}: none${I}`];
		if (GRADIENT_RE.test(v) && !/url\(/i.test(v)) {
			const layers = splitTop(v, ',').map((l) => l.trim());
			const gv = layers.map((l) => (GRADIENT_RE.test(l) ? gradientValue(l) : l));
			return [`${P}: ${gv.every((x) => x === 'none') ? 'none' : gv.join(', ')}${I}`];
		}
		if (hasDataSvg) {
			const r = mapUrls(X, v, { ...ctx, prop: P });
			if (r.changed) return [`${P}: ${r.text}${I}`];
		}
		return [];
	}
	if (/^(background-color|color|caret-color|fill|stroke|outline-color|column-rule-color|text-decoration-color|scrollbar-color|stop-color|flood-color|text-fill-color|text-stroke-color|accent-color)$/.test(base) || /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color$/.test(base)) {
		if (!hasLit) return verbatim();
		return [`${P}: ${mapped(v, role).text}${I}`];
	}
	const bm = base.match(/^(border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|column-rule|text-decoration)$/);
	if (bm) {
		const longhand = `${bm[1]}-color`;
		const toks = splitTop(v, ' ');
		const colTok =
			toks.find((t) => findLiterals(t, X.keepVars).some((l) => !l.kept) || themeRe.test(t)) ||
			toks.find((t) => /^color-mix\(/i.test(t)) ||
			toks.find((t) => /^var\(/i.test(t) && findLiterals(t).length) ||
			toks.find((t) => /^(transparent|currentcolor|inherit|initial)$/i.test(t));
		if (colTok) {
			const mv = mapped(colTok, roleOfProp(longhand));
			if (mv.changed || ctx.verbatim) return [`${longhand}: ${mv.text}${I}`];
			return [];
		}
		const varT = toks.find((t) => /^var\(/i.test(t));
		if (!ctx.verbatim) return [];
		if (toks.some((t) => /^(none|hidden|0[a-z%]*)$/i.test(t))) return [];
		if (varT && toks.length === 1) return [`${longhand}: ${varT}${I}`];
		if (varT && toks.some((t) => /^(-?[\d.]+[a-z%]*|thin|medium|thick)$/i.test(t))) return [`${longhand}: ${varT}${I}`];
		if (bm[1] === 'outline' || bm[1] === 'text-decoration') return [];
		return [`${longhand}: currentcolor${I}`];
	}
	if (base === 'box-shadow' || base === 'text-shadow') {
		if (!hasLit) return verbatim();
		return [`${P}: ${mapped(v, 'shadow').text}${I}`];
	}
	return [];
}

function isGenericSel(p, sharedRe) {
	const s = p.replace(/:not\([^)]*\)/g, '').replace(sharedRe, '').replace(/\[(id|type|name|disabled|readonly)(?:[~|^$*]?=[^\]]*)?\]/gi, '');
	return !/[.#\[]/.test(s);
}
export function pageMarker(file) {
	const m = /^Innovator\/Client\/(.+)#style\d+$/.exec(file || '');
	return m ? 'url:/' + m[1] : null;
}
export function scopeToken(marker) {
	let m;
	if ((m = /^link\[href\*="([^"\s]+)"\]$/.exec(marker))) return m[1];
	if ((m = /^link\[href="([^"\s]+)"\]$/.exec(marker))) return '=' + m[1];
	return marker.replace(/\s+/g, '');
}
export function scopeGate(marker) {
	return `[data-dm-scope~="${scopeToken(marker).replace(/["\\]/g, '\\$&')}"]`;
}
export function scopeList(EX, extra = []) {
	const seen = new Set();
	const out = [];
	for (const [f, marker] of [...Object.entries(EX.scopes || {}), ...extra.map((m) => ['page', m])]) {
		if (f.startsWith('_') || typeof marker !== 'string') continue;
		const t = scopeToken(marker);
		if (seen.has(t)) continue;
		seen.add(t);
		out.push({ t, s: marker });
	}
	return out;
}
export function prefixSelector(X, sel, file, layer) {
	const parts = splitTop(sel, ',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
	const out = [];
	const dropped = [];
	const EX = X.EX;
	const global = anyMatch(X.globalRes, file);
	const sharedRe = X.sharedRe;
	for (const p of parts) {
		if (/(^|[\s>+~])\.(dj_a11y|dj_ie\d*|dj_quirks|dijit_a11y|dj_ff\d|dj_ios|dj_android)\b/i.test(p)) continue;
		const where = layer === 'where';
		let has = '';
		const pm = pageMarker(file);
		if (pm) has = scopeGate(pm);
		else if (!global && isGenericSel(p, sharedRe)) {
			const marker = Object.entries(EX.scopes || {}).find(([f]) => !f.startsWith('_') && new RegExp(f, 'i').test(file));
			if (!marker) {
				dropped.push(p);
				continue;
			}
			has = scopeGate(marker[1]);
		}
		const root = (where ? DARK_WHERE : DARK) + (has ? `:where(${has})` : '');
		let m;
		if ((m = p.match(/^(html|:root)(?=$|[\s.#\[:>+~])/i))) {
			out.push(root + (where ? (m[1].toLowerCase() === 'html' ? ':is(html)' : ':root') : '') + p.slice(m[1].length));
		} else if ((m = p.match(/^((?:\.dj_[\w-]+)+)(.*)$/))) out.push(root + m[1] + m[2]);
		else out.push(root + ' ' + p);
	}
	return { sels: out, dropped };
}

function simpleShare(items) {
	let n = 0, s = 0;
	for (const { rule } of eachRule(items)) {
		for (const p of splitTop(rule.sel, ',')) {
			const t = p.trim();
			if (!t) continue;
			n++;
			if (!/[\s>+~]/.test(t) && (t.match(/[.#\[:]/g) || []).length <= 1) s++;
		}
	}
	return n ? s / n : 0;
}
export function discoverCssFiles(X) {
	const EX = X.EX;
	const F = EX.files || {};
	const clientRoot = path.join(X.target, 'Innovator', 'Client');
	const inc = compileList(F.include);
	const exc = compileList(F.exclude);
	const all = util.walkFiles(clientRoot, { skipDirs: new Set(['node_modules', 'jsBundles', 'images', 'images-dark', 'darkmode', 'WebHelp', 'docs', 'nodejs']) })
		.filter((f) => /\.css$/i.test(f))
		.map((f) => 'Innovator/Client/' + f);
	const set = new Set(all);
	let picked = all.filter((f) => anyMatch(inc, f) && !anyMatch(exc, f));
	picked = picked.filter((f) => !(/\.min\.css$/i.test(f) && set.has(f.replace(/\.min\.css$/i, '.css'))));
	const order = compileList(F.order);
	const rank = (f) => {
		const i = order.findIndex((r) => r.test(f));
		return i < 0 ? order.length : i;
	};
	picked.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
	return picked;
}

export function discoverJsStyleSources(X) {
	const srcs = compileList((X.EX.files || {}).jsStyleSources);
	if (!srcs.length) return { files: [], skipped: [] };
	const clientRoot = path.join(X.target, 'Innovator', 'Client');
	const rels = util.walkFiles(clientRoot, { skipDirs: new Set(['node_modules', 'jsBundles', 'images', 'images-dark', 'darkmode', 'WebHelp', 'docs', 'nodejs']) })
		.filter((f) => /\.js$/i.test(f))
		.map((f) => 'Innovator/Client/' + f)
		.filter((f) => anyMatch(srcs, f))
		.sort();
	const files = [];
	const skipped = [];
	for (const rel of rels) {
		const js = util.readText(util.resolveSource(rel)).text;
		if (!/createElement\(\s*['"]style['"]\s*\)/.test(js)) continue;
		const idents = new Set([...js.matchAll(/\.textContent\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)].map((m) => m[1]));
		for (const id of idents) {
			const m = js.match(new RegExp(`(?:const|let|var)\\s+${id.replace(/\$/g, '\\$')}\\s*=\\s*\`([^\`]*)\``));
			if (!m) { skipped.push({ file: rel, ident: id, why: 'no template-literal declaration found' }); continue; }
			if (m[1].includes('${')) { skipped.push({ file: rel, ident: id, why: 'template literal has ${...} interpolation' }); continue; }
			files.push({ rel: `${rel}#${id}`, css: m[1] });
		}
	}
	return { files, skipped };
}

export function discoverPageStyleSources(X) {
	if ((X.EX.files || {}).pageStyles === false) return { files: [], skipped: [] };
	const files = [];
	const skipped = [];
	for (const t of entryPointsFromExceptions(X.EX).targets) {
		const rel = 'Innovator/Client/' + t;
		let html;
		try {
			html = util.readText(util.resolveSource(rel)).text;
		} catch {
			continue;
		}
		let n = 0;
		for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
			n++;
			let css = m[1];
			if (/\.cshtml$/i.test(rel)) {
				if (/@(?!@)/.test(css.replace(/@@/g, ''))) { skipped.push({ file: rel, block: n, why: 'Razor expression in <style>' }); continue; }
				css = css.replace(/@@/g, '@');
			}
			if (!findLiterals(css).length) continue;
			files.push({ rel: `${rel}#style${n}`, css });
		}
	}
	return { files, skipped };
}

function layerOf(X, file, items) {
	const L = X.EX.layers || {};
	if (pageMarker(file)) return { layer: 'where', why: 'page <style> block' };
	if (anyMatch(compileList(L.bump), file)) return { layer: 'bump', why: 'exceptions.layers.bump' };
	if (anyMatch(compileList(L.where), file)) return { layer: 'where', why: 'exceptions.layers.where' };
	const share = simpleShare(items);
	if (share >= (L.baseShare || 0.6)) return { layer: 'where', why: `base heuristic (${Math.round(share * 100)}% simple selectors)` };
	return { layer: 'bump', why: `component (${Math.round(share * 100)}% simple selectors)` };
}
function keepLightMatch(X, file, sel) {
	for (const k of X.keepLightRes) {
		if (k.file && !k.file.test(file)) continue;
		if (k.sel && !k.sel.test(sel)) continue;
		return true;
	}
	return false;
}
export function genFile(X, rel, css) {
	const items = parseCss(css);
	const policy = anyMatch(compileList((X.EX.policies || {}).less), rel) ? 'less' : 'legacy';
	const { layer, why } = layerOf(X, rel, items);
	const st = { file: rel, policy, layer, layerWhy: why, rules: 0, decls: 0, important: 0, kept: [], todo: [], dropped: [], keyframes: 0, keptBySel: {} };
	const lines = [];
	const walk = (list, indent) => {
		for (const it of list) {
			if (it.type === 'skip') {
				if (/keyframes/.test(it.name) && /#[0-9a-f]{3}|rgba?\(/i.test(css.slice(it.start, it.end))) st.keyframes++;
				continue;
			}
			if (it.type === 'at') {
				const save = lines.length;
				walk(it.children, indent + '\t');
				const body = lines.splice(save);
				if (body.length) lines.push(`${indent}${it.prelude} {`, ...body, `${indent}}`);
				continue;
			}
			const selN = it.sel.replace(/\s+/g, ' ').trim();
			if (keepLightMatch(X, rel, selN)) continue;
			const decls = [];
			const local = { kept: [], todo: [] };
			for (const d of it.decls) {
				const res = transformDecl(X, d, { file: rel, sel: selN, policy, verbatim: true }, local);
				for (const r of res) {
					decls.push(r);
					if (/!important/.test(r)) st.important++;
				}
			}
			if (local.kept.length) {
				st.kept.push(...local.kept.map((k) => ({ ...k, sel: selN })));
			}
			if (local.todo.length) st.todo.push(...local.todo.map((k) => ({ ...k, sel: selN })));
			if (!decls.length) continue;
			const { sels, dropped } = prefixSelector(X, it.sel, rel, layer);
			if (dropped.length) st.dropped.push(...dropped);
			if (!sels.length) continue;
			for (let a = decls.length - 1; a >= 0; a--) if (decls.indexOf(decls[a]) !== a) decls.splice(decls.indexOf(decls[a]), 1);
			st.rules++;
			st.decls += decls.length;
			lines.push(`${indent}${sels.join(`,\n${indent}`)} {`);
			for (const d of decls) lines.push(`${indent}\t${d};`);
			lines.push(`${indent}}`);
		}
	};
	walk(items, '');
	return { css: lines.join('\n'), stats: st };
}

function rgbSpelling(lit) {
	const c = parseColor(lit);
	return c ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : null;
}
export function genInlineRules(X) {
	const out = [];
	for (const e of X.EX.inlineLiterals || []) {
		if (!e || !e.prop || e._skip) continue;
		const spell = new Set();
		for (const lit of e.literals) {
			const cssom = (() => {
				const ls = findLiterals(lit);
				if (!ls.length) return null;
				let o = '', last = 0;
				for (const L of ls) {
					o += lit.slice(last, L.start) + (rgbSpelling(L.lit) || L.lit);
					last = L.end;
				}
				return o + lit.slice(last);
			})();
			const forms = [...new Set([lit, lit.toLowerCase(), cssom].filter(Boolean))];
			for (const f of forms) {
				for (const sp of e.props || [e.prop]) {
					spell.add(`[style*="${sp}:${f}" i]`);
					spell.add(`[style*="${sp}: ${f}" i]`);
				}
			}
		}
		const el = e.element || '';
		const sels = [...spell].map((a) => `${DARK} ${e.scope ? e.scope + ' ' : ''}${el}${a}`);
		const lit0 = (findLiterals(e.literals[0])[0] || { lit: e.literals[0] }).lit;
		const role = roleOfProp(e.set || e.prop);
		const tk = e.token ? X.M.tokName(e.token) || e.token : null;
		const w = tk ? { text: `var(${X.reg.name(roleOfProp(e.set || e.prop), lit0, `var(--dm${tk.slice(1)})`)}, ${lit0})` } : wrapLiteral(X, lit0, role, { file: 'inline:' + e.site, sel: el, prop: e.set || e.prop, policy: 'legacy' });
		if (!w) continue;
		out.push(`/* ${e.site} */\n${sels.join(',\n')} {\n\t${e.set || e.prop}: ${w.text} !important;\n}`);
	}
	return out.join('\n');
}
export function genHandRules(X) {
	const out = [];
	for (const r of X.EX.rules || []) {
		if (!r || !r.selector) continue;
		const root = r.where ? DARK_WHERE : DARK;
		const sels = splitTop(r.selector, ',').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('&') ? root + s.slice(1) : `${root} ${s}`));
		const decls = (Array.isArray(r.decls) ? r.decls : [r.decls]).map((d) =>
			d.replace(/;?\s*$/, ';').replace(/var\(--dm-([\w-]+)/g, (m, n) => {
				if (X.D.tokens['--' + n] != null || n === 'surface') return m;
				const t = X.M.tokName('--' + n);
				return t && t !== '--' + n ? `var(--dm${t.slice(1)}` : m;
			})
		);
		out.push(`${r.why ? `/* ${r.why} */\n` : ''}${sels.join(',\n')} {\n${decls.map((d) => '\t' + d).join('\n')}\n}`);
	}
	return out.join('\n');
}

export function genSheetEdits(X, text, key, stats) {
	const items = parseCss(text);
	const edits = [];
	const ctxBase = { file: 'bundle:' + key, policy: (X.EX.bundlePolicy || 'less') };
	for (const { rule } of eachRule(items)) {
		const selN = rule.sel.replace(/\s+/g, ' ').trim();
		if (keepLightMatch(X, 'bundle', selN)) continue;
		for (const d of rule.decls) {
			const P = d.prop.toLowerCase();
			const isCustom = P.startsWith('--');
			if (!isCustom && !COLOR_PROPS.test(P) && !/^(content|mask(-image)?|list-style(-image)?|border-image(-source)?)$/.test(P)) continue;
			const value = text.slice(d.vStart, d.vEnd);
			const role = roleOfProp(P);
			const ctx = { ...ctxBase, sel: selN, prop: P };
			if (/url\(\s*["']?data:image\/svg\+xml/i.test(value)) {
				for (const m of value.matchAll(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi)) {
					const dk = darkDataUrl(X, m[0], ctx);
					if (dk) edits.push([d.vStart + m.index, d.vStart + m.index + m[0].length, urlVar(X, m[0], dk)]);
				}
			}
			if (!isCustom && !COLOR_PROPS.test(P)) continue;
			if (P === 'background' || P === 'background-image') {
				const ve = veilEdits(X, value, ctx);
				if (ve) {
					for (const e of ve) edits.push([d.vStart + e.start, d.vStart + e.end, e.text]);
					continue;
				}
			}
			const lr = (P === 'background' || P === 'background-image') ? 'bg' : role;
			for (const e of valueEdits(X, value, isCustom ? role : lr, ctx, stats)) edits.push([d.vStart + e.start, d.vStart + e.end, e.text]);
		}
	}
	edits.sort((a, b) => a[0] - b[0]);
	for (let i = 1; i < edits.length; i++) if (edits[i][0] < edits[i - 1][1]) throw new Error('overlapping edits in ' + key);
	return edits;
}
export function applyEdits(text, edits) {
	let out = '', last = 0;
	for (const [s, e, r] of edits) {
		out += text.slice(last, s) + r;
		last = e;
	}
	return out + text.slice(last);
}
export function stripDmWrappers(text) {
	let prev;
	do {
		prev = text;
		text = text.replace(/var\(--dm-[\w-]+,\s?((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*)\)/g, '$1');
	} while (text !== prev);
	return text;
}

function preRegister(X, files, strings) {
	const seen = new Map();
	const add = (lit, role) => {
		const c = parseColor(lit);
		if (!c || c.kw) return;
		const k = role + ' ' + hexKey(c);
		if (!seen.has(k)) seen.set(k, { lit: toCss(c) === 'transparent' ? lit : (c.a < 1 ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(3)})` : toHex6(c)), role, n: 0 });
		seen.get(k).n++;
	};
	const scan = (css) => {
		for (const { rule } of eachRule(parseCss(css))) for (const d of rule.decls) {
			const P = d.prop.toLowerCase();
			if (!P.startsWith('--') && !COLOR_PROPS.test(P)) continue;
			let role = roleOfProp(P);
			if (P === 'background' || P === 'background-image') role = 'bg';
			if (role === 'custom') role = 'text';
			for (const L of findLiterals(d.value, X.keepVars)) if (!L.kept) add(L.lit, role);
		}
	};
	for (const f of files) scan(f.css);
	for (const s of strings) scan(s.text);
	const keys = [...seen.keys()].sort();
	for (const k of keys) {
		const { lit, role } = seen.get(k);
		const r = X.M.mapColor(lit, role, { file: '', sel: '', prop: '', policy: 'legacy' });
		if (r) X.reg.name(role, lit, r.expr);
	}
	return seen;
}

export async function generate({ target, snapshot, anchors, out, exceptions, only, dryRun = false, log } = {}) {
	const t0 = Date.now();
	const X = createContext({ target, snapshot, anchors, exceptions, log });
	const EX = X.EX;
	X.globalRes = compileList(EX.globalFiles);
	X.sharedRe = new RegExp(EX.sharedClassRe || '\\.(?:claro|dj_[\\w-]+|dijit[\\w-]*|dojox[\\w-]*|dojo[\\w-]*|aras-[\\w-]+|menu|menu_dropdown|toolbar[\\w-]*|dndDrag[\\w-]*|dndItem[\\w-]*)(?![\\w-])', 'g');
	X.keepLightRes = (EX.keepLight || []).filter((k) => k && typeof k === 'object').map((k) => ({ file: k.file ? new RegExp(k.file, 'i') : null, sel: k.selector ? new RegExp(k.selector, 'i') : null }));
	const files = discoverCssFiles(X).map((rel) => {
		const p = util.resolveSource(rel);
		return { rel, css: util.readText(p).text };
	});
	const jsStyles = discoverJsStyleSources(X);
	files.push(...jsStyles.files);
	const pageStyles = discoverPageStyleSources(X);
	files.push(...pageStyles.files);
	const t1 = Date.now();
	const bundle = extractBundleCss({ target, log: X.log });
	const t2 = Date.now();
	const census = preRegister(X, files, bundle.strings);

	const parts = [];
	const fileStats = [];
	for (const f of files) {
		const r = genFile(X, f.rel, f.css);
		fileStats.push(r.stats);
		if (r.css) parts.push(`/* ==== ${f.rel} (${r.stats.policy}, ${r.stats.layer}: ${r.stats.rules} rules, ${r.stats.decls} declarations) ==== */\n${r.css}`);
	}
	const inline = genInlineRules(X);
	const hand = genHandRules(X);
	const header = [
		'/*',
		` * Aras dark mode: generated overrides (${X.A.version}). GENERATED by DarkModeKit/lib/gen-overrides.mjs - do not edit;`,
		' * change DarkModeKit/exceptions/overrides.json or the anchors and re-run apply-darkmode.ps1.',
		' * Every rule is scoped to html[data-theme="dark"] (base-layer files: :where(html[data-theme="dark"]), so they keep',
		' * the vendor specificity and win by source order; dark.css is the last stylesheet). Every rewritten literal is',
		' * var(--dm-…, <light literal>); --dm-* exist only under dark (tokens.css).',
		' */'
	].join('\n');
	const overridesCss = `${header}\n${parts.join('\n')}\n\n/* ==== JS inline colour literals (attribute selectors: source + CSSOM rgb() spellings) ==== */\n${inline}\n\n/* ==== hand rules (exceptions/overrides.json "rules") ==== */\n${hand}\n`;

	const sheets = {};
	const originals = {};
	const sheetStats = { strings: bundle.strings.length, withEdits: 0, edits: 0, kept: [], todo: [] };
	for (const s of bundle.strings) {
		const st = { kept: [], todo: [] };
		const edits = genSheetEdits(X, s.text, s.key, st);
		sheetStats.kept.push(...st.kept.map((k) => ({ ...k, key: s.key })));
		sheetStats.todo.push(...st.todo.map((k) => ({ ...k, key: s.key })));
		if (!edits.length) continue;
		sheets[s.key] = edits;
		originals[s.key] = s.text;
		sheetStats.withEdits++;
		sheetStats.edits += edits.length;
	}

	const defs = { ...X.defs, ...X.urlDefs };
	const tokensCss = renderTokensCss(X.A, X.D, { defs });
	const readLess = (rel) => {
		try {
			return util.readText(util.resolveSource('Innovator/Client/' + rel)).text;
		} catch {
			return null;
		}
	};
	const palette = buildPalette(X.A, X.D, { readLess });

	const coverage = { version: X.A.version, files: {}, bundles: {}, jsStyleSourcesSkipped: jsStyles.skipped, pageStylesSkipped: pageStyles.skipped, totals: { keptLiterals: 0, todoLiterals: 0, droppedSelectors: 0 } };
	for (const s of fileStats) {
		const bySel = {};
		for (const k of s.kept) (bySel[k.sel] = bySel[k.sel] || []).push(`${k.role} ${k.lit}`);
		const todo = {};
		for (const k of s.todo) (todo[k.sel] = todo[k.sel] || []).push(`${k.role} ${k.lit} (${k.why})`);
		coverage.files[s.file] = { policy: s.policy, layer: s.layer, layerWhy: s.layerWhy, rules: s.rules, decls: s.decls, important: s.important, kept: bySel, todo, droppedGenericSelectors: s.dropped, keyframesWithColours: s.keyframes };
		coverage.totals.keptLiterals += s.kept.length;
		coverage.totals.todoLiterals += s.todo.length;
		coverage.totals.droppedSelectors += s.dropped.length;
	}
	for (const k of sheetStats.kept) (coverage.bundles[k.key] = coverage.bundles[k.key] || { kept: [], todo: [] }).kept.push(`${k.role} ${k.lit}`);
	for (const k of sheetStats.todo) (coverage.bundles[k.key] = coverage.bundles[k.key] || { kept: [], todo: [] }).todo.push(`${k.role} ${k.lit} (${k.why})`);

	const written = [];
	const W = (rel, content) => {
		if (util.writeIfChanged(path.join(out, ...rel.split('/')), content, { dryRun })) written.push(rel);
	};
	W('client/gen/tokens.css', tokensCss);
	W('data/palette.json', JSON.stringify(palette, null, 1) + '\n');
	if (only !== 'tokens') {
		W('client/gen/overrides.css', overridesCss);
		W('data/sheets.json', JSON.stringify(sheets) + '\n');
		W('data/scopes.json', JSON.stringify(scopeList(X.EX, pageStyles.files.map((f) => pageMarker(f.rel)))) + '\n');
		W('report/sheets-originals.json', JSON.stringify(originals, null, 1) + '\n');
		W('report/coverage-css.json', JSON.stringify(coverage, null, 1) + '\n');
		W('report/bundle-css.json', JSON.stringify({ engine: bundle.engine, bundles: bundle.bundles, perBundle: bundle.perBundle, dynamic: bundle.dynamic, strings: bundle.strings.map((s) => ({ key: s.key, length: s.text.length, bundles: s.bundles })) }, null, 1) + '\n');
		W('report/g1-summary.json', JSON.stringify({
			version: X.A.version,
			files: fileStats.map((s) => ({ file: s.file, policy: s.policy, layer: s.layer, rules: s.rules, decls: s.decls, kept: s.kept.length, todo: s.todo.length, dropped: s.dropped.length })),
			census: census.size, defs: Object.keys(X.defs).length, urlDefs: Object.keys(X.urlDefs).length,
			sheets: { strings: sheetStats.strings, withEdits: sheetStats.withEdits, edits: sheetStats.edits, kept: sheetStats.kept.length, todo: sheetStats.todo.length },
			bundles: { engine: bundle.engine, live: bundle.bundles.live.length, dead: bundle.bundles.dead.length }
		}, null, 1) + '\n');
	}
	return { written, X, files, fileStats, bundle, sheets, overridesCss, tokensCss, palette, ms: Date.now() - t0 };
}

async function main() {
	const args = util.parseArgs();
	const log = util.createLogger('gen-overrides');
	const res = await generate({
		target: util.requireArg(args, 'target'),
		snapshot: args.snapshot === true ? undefined : args.snapshot,
		anchors: util.requireArg(args, 'anchors'),
		out: util.requireArg(args, 'out'),
		exceptions: args.exceptions,
		dryRun: !!args.dryRun,
		log
	});
	const s = res.fileStats.reduce((a, f) => ({ rules: a.rules + f.rules, decls: a.decls + f.decls }), { rules: 0, decls: 0 });
	log.info(`${res.files.length} CSS files -> ${s.rules} rules / ${s.decls} declarations; ${Object.keys(res.sheets).length}/${res.bundle.strings.length} bundle strings edited; ${res.written.length} files ${args.dryRun ? 'would change' : 'written'}; ${res.ms} ms`);
	for (const w of res.written) log.info('  ' + w);
}
if (util.isMain(import.meta.url)) {
	main().catch((e) => {
		console.error(e && e.stack ? e.stack : e);
		process.exit(1);
	});
}
