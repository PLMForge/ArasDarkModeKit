import fs from 'node:fs';
import { isMain as isMainModule } from './util.mjs';
import path from 'node:path';
import {
	parseColor, toHex6, toCss, norm, lum, contrast, oklch, oklchToHex, adaptForDark, tintAtContrast, bgTint, hueMatch,
	rgbChroma, rgbHue, SYSTEM, mixHex, colorMix
} from './color.mjs';

export const DARK = 'html[data-theme="dark"]';
export const DARK_WHERE = ':where(html[data-theme="dark"])';

const MERGE_KEYS = ['rules', 'pins', 'light', 'shadows', 'tint', 'contrastChecks', 'features', 'rampRef', 'charts'];
export function loadAnchors(file) {
	const a = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
	if (!a.extends) return a;
	const base = loadAnchors(path.resolve(path.dirname(file), a.extends));
	const out = { ...base, ...a };
	for (const k of MERGE_KEYS) out[k] = { ...(base[k] || {}), ...(a[k] || {}) };
	out.pins = {};
	for (const k of new Set([...Object.keys(base.pins || {}), ...Object.keys(a.pins || {})]))
		out.pins[k] = { ...((base.pins || {})[k] || {}), ...((a.pins || {})[k] || {}) };
	out.literals = {};
	for (const r of new Set([...Object.keys(base.literals || {}), ...Object.keys(a.literals || {})])) {
		if (r.startsWith('_')) continue;
		out.literals[r] = { ...((base.literals || {})[r] || {}), ...((a.literals || {})[r] || {}) };
	}
	out.tokens = { ...(base.tokens || {}), ...(a.tokens || {}) };
	out.tokens.legacy = { ...((base.tokens || {}).legacy || {}), ...((a.tokens || {}).legacy || {}) };
	delete out.extends;
	return out;
}

export function derive(A, { formulaOnly = false } = {}) {
	const S = norm(A.surface.dark), SL = norm(A.surface.light || '#ffffff');
	const pin = (group, light) => {
		if (formulaOnly) return undefined;
		const g = A.pins[group] || {};
		return (light && g[norm(light)]) || g['*'];
	};
	const out = {}, why = {};
	const darkerSteps = new Set(A.ramp.filter(([, , d]) => d === 'darker').map(([v]) => v));
	const ramp = A.ramp.map(([v, hex, dir]) => {
		const light = norm(hex);
		let dark, how;
		if (light === SL && dir !== 'darker') { dark = S; how = 'surface'; }
		else if (pin('ramp', light)) { dark = pin('ramp', light); how = 'pin'; }
		else { dark = tintAtContrast(contrast(light, SL), S, A.tint, dir === 'darker' ? 'darker' : 'lighter'); how = dir === 'darker' ? 'sunken' : 'ramp'; }
		out[v] = dark;
		why[v] = how;
		return { v, light, dark, c: contrast(light, SL), darker: dir === 'darker' };
	});
	const snap = (light) => {
		const c = contrast(norm(light), SL);
		let best = null;
		for (const r of ramp) {
			if (r.light === SL || darkerSteps.has(r.v)) continue;
			const e = Math.abs(Math.log(c / r.c));
			if (!best || e < best.e) best = { ...r, e };
		}
		return best;
	};
	const rampByLight = (light) => ramp.find((r) => r.light === norm(light) && !darkerSteps.has(r.v));
	for (const [tok, rule0] of Object.entries(A.rules)) {
		const rule = typeof rule0 === 'string' ? { rule: rule0 } : rule0;
		const lightSrc = A.light[tok] != null ? A.light[tok] : rule.of ? A.light[rule.of] : null;
		const light = lightSrc != null ? norm(lightSrc) : null;
		const lightFree = ['contrast', 'surface', 'shift', 'alias', 'var', 'fixed'].includes(rule.rule);
		if (light == null && !lightFree) continue;
		const p = pin(tok, light);
		let dark, how;
		if (rule.rule === 'alias') { dark = out[rule.to] != null ? out[rule.to] : `var(${rule.to})`; how = 'alias ' + rule.to; }
		else if (rule.rule === 'var') { dark = rule.value; how = 'literal'; }
		else if (rule.rule === 'fixed') { dark = norm(rule.value); how = 'fixed'; }
		else if (p) { dark = p; how = 'pin'; }
		else if (rule.rule === 'surface') { dark = S; how = 'surface'; }
		else if (rule.rule === 'keep') { dark = light; how = 'keep'; }
		else if (rule.rule === 'ramp') {
			const r = rampByLight(light);
			if (r) { dark = r.dark; how = 'ramp ' + r.v; }
			else { dark = tintAtContrast(contrast(light, SL), S, A.tint, 'lighter'); how = 'contrast-match'; }
		} else if (rule.rule === 'snap') { const r = snap(light); dark = r.dark; how = 'snap ' + r.v; }
		else if (rule.rule === 'contrast') { dark = tintAtContrast(rule.target, S, A.tint, rule.dir || 'lighter'); how = 'contrast ' + rule.target; }
		else if (rule.rule === 'adapt') { dark = adaptForDark(light, { bg: S, minContrast: rule.contrast, maxL: rule.maxL == null ? 1 : rule.maxL }); how = 'adapt ' + rule.contrast; }
		else if (rule.rule === 'fill') {
			const [L0, C, H] = oklch(light);
			let L = L0, hx = light;
			while (contrast(hx, S) < (rule.surfaceMin || 1.5) && L < 1) { L += 0.005; hx = oklchToHex(L, C, H); }
			dark = hx; how = 'fill';
		} else if (rule.rule === 'shift') {
			const [L, C, H] = oklch(out[rule.of]);
			dark = oklchToHex(L + rule.dL, C, H); how = `shift ${rule.of} ${rule.dL}`;
		} else if (rule.rule === 'bgTint') {
			dark = bgTint(light, out[rule.text || '--text'], rule.textContrast, rule.chroma); how = 'bgTint ' + rule.textContrast;
		} else throw new Error(`${tok}: unknown rule ${rule.rule}`);
		out[tok] = dark;
		why[tok] = how;
	}
	if (out['--surface']) {
		const c = parseColor(out['--surface']);
		out['--tint-base-rgb'] = `${c.r} ${c.g} ${c.b}`;
		why['--tint-base-rgb'] = 'channels of --surface';
	}
	const f = A.shadow || { factor: 1.6, cap: 0.7 };
	for (const [tok, s] of Object.entries(A.shadows || {})) {
		out[tok] = s.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/g, (_, a) => `rgba(0, 0, 0, ${+Math.min(f.cap, +a * f.factor).toFixed(3)})`);
		why[tok] = 'shadow x' + f.factor;
	}
	const hex = {};
	const resolve = (t, depth = 0) => {
		const v = out[t];
		if (v == null || depth > 8) return null;
		const m = /^var\((--[\w-]+)\)$/.exec(String(v).trim());
		if (m) return resolve(m[1], depth + 1);
		return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
	};
	for (const t of Object.keys(out)) hex[t] = resolve(t);
	return { tokens: out, hex, why, ramp, snap, S, SL, rampByLight };
}

export function createMapper(A, D, ex = {}) {
	const T = D.tokens;
	const ctxRe = (k, d) => new RegExp((ex.context && ex.context[k]) || d, 'i');
	const RE_FLOAT = ctxRe('floating', 'menu(?!bar)|tooltip|popup|dropdown|popover|flyout|autocomplete|suggest|contextmenu');
	const RE_FLOAT_NOT = ctxRe('floatingNotLast', 'menubar');
	const RE_TOOLBAR = ctxRe('toolbar', 'toolbar');
	const RE_TOOLBAR_NOT = ctxRe('toolbarNotLast', 'button|item|separator|select|label|input');
	const RE_INPUT = ctxRe('input', 'input|textbox|textarea|select|combobox|spinner|field|editor|dijitTextBox|cell');
	const lastCompound = (sel) => sel.trim().split(/\s*[\s>+~]\s*/).pop() || '';
	const isFloating = (sel) => RE_FLOAT.test(sel) && !RE_FLOAT_NOT.test(lastCompound(sel));
	const isToolbar = (sel) => RE_TOOLBAR.test(lastCompound(sel)) && !RE_TOOLBAR_NOT.test(lastCompound(sel));
	const isInputCtx = (sel) => RE_INPUT.test(sel);

	const SLn = D.SL;
	const rampSteps = D.ramp.map((r) => ({ ...r, t: r.light === SLn && !r.darker ? '--surface' : r.v, L: lum(r.light) }));
	const nearestRamp = (c) => {
		const L = lum(c);
		let best = rampSteps[0];
		for (const r of rampSteps) if (Math.abs(r.L - L) < Math.abs(best.L - L)) best = r;
		return best.t;
	};
	const rampExact = new Map();
	for (const r of D.ramp) if (!rampExact.has(r.light)) rampExact.set(r.light, r.v);
	const CLASS = (ex.lessSemantic && !Array.isArray(ex.lessSemantic) ? Object.fromEntries(Object.entries(ex.lessSemantic).filter(([k]) => !k.startsWith('_'))) : null) || {
		bg: '^--(selection|highlight-row|search-match|required-bg|error-subtle|primary|secondary|error|success|warning)$',
		text: '^--(primary-text|secondary-text|error-text|success-text|warning-text|calendar-today|link)$',
		border: '^--(focus|primary-text|error-text|border-input)$'
	};
	const semByLight = {};
	for (const [r, re] of Object.entries(CLASS)) {
		const rx = new RegExp(re);
		semByLight[r] = {};
		for (const [t, hx] of Object.entries(A.light || {})) if (rx.test(t) && T[t] != null && !semByLight[r][norm(hx)]) semByLight[r][norm(hx)] = t;
	}
	const tokName = (t) => {
		if (t.startsWith('MIX:')) return t;
		if (T[t] != null || t === '--surface') return t;
		const ref = (A.rampRef || {})[t];
		if (ref) return nearestRamp(parseColor(ref));
		return T[t] != null ? t : null;
	};
	const EXACT = {};
	for (const [r, tab] of Object.entries(A.literals || {})) {
		EXACT[r] = {};
		for (const [h, t] of Object.entries(tab)) if (!h.startsWith('_')) EXACT[r][norm(h)] = t;
	}
	const ROLES = (ex.roles || []).map((o) => ({
		file: o.file ? new RegExp(o.file, 'i') : null,
		sel: o.selector ? o.selector.toLowerCase().replace(/\s+/g, ' ') : null,
		selRe: o.selectorRe ? new RegExp(o.selectorRe, 'i') : null,
		prop: o.prop ? new RegExp(o.prop, 'i') : null,
		lit: o.literal ? norm(o.literal) : null,
		token: o.token,
		keep: !!o.keep,
		policy: o.policy || null
	}));
	const roleOverride = (h, ctx) => {
		const selL = (ctx.sel || '').toLowerCase().replace(/\s+/g, ' ');
		for (const o of ROLES) {
			if (o.lit && o.lit !== h) continue;
			if (o.file && !o.file.test(ctx.file || '')) continue;
			if (o.sel && !selL.includes(o.sel)) continue;
			if (o.selRe && !o.selRe.test(ctx.sel || '')) continue;
			if (o.prop && !o.prop.test(ctx.prop || '')) continue;
			if (o.policy && o.policy !== ctx.policy) continue;
			return o.keep ? 'KEEP' : o.token;
		}
		return null;
	};

	const darkOf = (t) => {
		if (t.startsWith('MIX:')) {
			const [name, pct] = t.slice(4).split(' ');
			return parseColor(mixHex(D.hex[tokName(name)] || '#000000', D.S, parseFloat(pct) / 100));
		}
		return parseColor(D.hex[t] || (t === '--surface' ? D.S : '#ff00ff'));
	};
	const tok = (t) => {
		t = tokName(t) || t;
		if (t.startsWith('MIX:')) {
			const [name, pct] = t.slice(4).split(' ');
			return { expr: `color-mix(in srgb, var(--dm${tokName(name).slice(1)}) ${pct}, var(--dm-surface))`, dark: darkOf(t), token: null };
		}
		return { expr: `var(--dm${t.slice(1)})`, dark: darkOf(t), token: t };
	};
	const todo = (t, why) => ({ ...tok(t), todo: why });

	function family(c) {
		const h = rgbHue(c);
		if (h < 45 && rgbChroma(c) < 120 && Math.max(c.r, c.g, c.b) < 200) return 'yellow';
		if (h < 18 || h >= 330) return 'red';
		if (h < 70) return 'yellow';
		if (h < 170) return 'green';
		if (h < 270) return 'blue';
		return 'purple';
	}

	function mapOpaque(c, role, ctx) {
		const h = toHex6(c);
		const sel = ctx.sel || '';
		const ov = roleOverride(h, ctx);
		if (ov === 'KEEP') return null;
		if (ov) return { ...tok(ov), via: 'exception' };
		const neutral = rgbChroma(c) <= 24;
		const v = (c.r + c.g + c.b) / 3;
		const last = lastCompound(sel);
		const disabled = /disabled|readonly/i.test(last);
		const hoverish = /hover|over|active|focus/i.test(sel);

		if (ctx.policy === 'less') {
			const lr = role === 'shadow' || role === 'outline' ? 'border' : role === 'fill' || role === 'stroke' || role === 'custom' ? 'text' : role;
			const st = semByLight[lr] && semByLight[lr][h];
			if (st && !rampExact.has(h)) return { ...tok(st), via: 'less: semantic ' + st };
			const r = rampExact.get(h);
			if (r) {
				if (h === SLn) {
					if (role === 'text') return { ...tok('--on-accent'), via: 'less: white text = on-accent' };
					if ((role === 'bg' || role === 'fill') && isFloating(sel)) return { ...tok('--surface-raised'), via: 'less: floating white = surface-raised' };
				}
				return { ...tok(r), via: 'less: ramp ' + r };
			}
			if (ex.lessKeepOthers !== false) return null;
		}
		if (role === 'custom') role = 'text';
		if (role === 'stroke') role = 'fill';
		if (role === 'outline') role = 'border';

		if (role === 'bg') {
			let t = EXACT.bg && EXACT.bg[h];
			if (t === '--selection' && hoverish && /toolbar/i.test(sel)) t = '--gray300';
			if (!t && neutral) {
				if (v < 40) return null;
				t = nearestRamp(c);
			}
			if (t && (tokName(t) === '--surface' || t === '--surface')) {
				if (isFloating(sel)) t = '--surface-raised';
				else if (isToolbar(sel)) t = '--surface-commandbar';
			}
			if (t) return { ...tok(t), via: 'bg table/ramp' };
			const L = lum(c), fam = family(c);
			if (L > 0.6) {
				const m = { blue: '--selection', purple: '--selection', yellow: '--highlight-row', red: '--error-subtle', green: 'MIX:--success 20%' }[fam];
				return { ...todo(m, `light ${fam} background`), via: 'bg family' };
			}
			return null;
		}
		if (role === 'text') {
			let t = EXACT.text && EXACT.text[h];
			if (t === '--link' && isFloating(sel) && /hover|selected/i.test(sel) && h === '#3668b1') t = '--primary-text';
			if (!t && neutral) {
				if (v >= 250) t = '--on-accent';
				else if (v > 215) return null;
				else if (v <= 90) t = '--text';
				else if (v <= 125) t = '--text-muted';
				else t = '--text-disabled';
				if (disabled && /^--text(-strong|-secondary|-muted)?$/.test(t)) t = '--text-disabled';
				if (/placeholder/i.test(sel) && t === '--text') t = '--text-muted';
			}
			if (t) return { ...tok(t), via: 'text table/ramp' };
			const fam = family(c);
			const m = { blue: '--link', purple: '--link', red: '--error-text', green: '--success-text', yellow: '--warning-text' }[fam];
			if (lum(c) > 0.7) return null;
			return { ...todo(m, `${fam} text`), via: 'text family' };
		}
		if (role === 'border') {
			let t = EXACT.border && EXACT.border[h];
			if (!t && neutral) {
				if (v >= 250) t = isFloating(sel) ? '--surface-raised' : '--surface';
				else if (v >= 230) t = '--gray300';
				else if (v >= 181) t = '--border-subtle';
				else if (v >= 110) t = '--border';
				else if (v >= 40) t = isInputCtx(sel) ? '--border-input' : '--border';
				else t = '--border';
			}
			if (t) return { ...tok(t), via: 'border table/ramp' };
			const L = lum(c), fam = family(c);
			if (fam === 'red') return { ...tok('--error-text'), via: 'border red' };
			if (fam === 'green' && L < 0.4) return { ...tok('--success-text'), via: 'border green' };
			if (L > 0.5) return { ...todo(fam === 'blue' ? '--selection' : '--border-subtle', `light ${fam} border`), via: 'border family' };
			if (fam === 'blue') return { ...todo('--focus', 'blue border'), via: 'border family' };
			return null;
		}
		if (role === 'shadow') {
			if (neutral && v >= 250) return { expr: 'transparent', dark: { r: 0, g: 0, b: 0, a: 0 }, via: 'white shadow -> transparent' };
			if (neutral && v >= 120) return { ...tok('--border-subtle'), via: 'light shadow' };
			if (neutral) return null;
			return mapOpaque(c, 'border', ctx);
		}
		if (role === 'fill') {
			if (h === '#4f4f4f' || h === '#555555') return { ...tok('--icon'), via: 'fill icon' };
			if (neutral && v >= 230) return mapOpaque(c, 'bg', ctx);
			return mapOpaque(c, 'text', ctx);
		}
		return null;
	}

	const mixA = (r, a) => ({
		expr: `color-mix(in srgb, ${r.expr} ${+(a * 100).toFixed(1)}%, transparent)`,
		dark: colorMix(r.dark, { r: 0, g: 0, b: 0, a: 0 }, a),
		via: r.via + ' @alpha',
		todo: r.todo
	});

	function mapColor(lit, role, ctx = {}) {
		const c = parseColor(lit);
		if (!c || c.kw) return null;
		if (c.a === 0) return null;
		if (c.sys) {
			const r = mapColor(toCss(c), role, ctx);
			if (r) return { ...r, via: 'system ' + c.sys + ': ' + r.via };
			return { expr: toCss(c), dark: c, via: 'system ' + c.sys + ' pinned light' };
		}
		if (c.a < 1) {
			const h = toHex6(c);
			const ov = roleOverride(h, ctx);
			if (ov === 'KEEP') return null;
			if (ov) return { ...tok(ov), via: 'exception (opaque, v1 OVERRIDES semantics)' };
			const neutral = rgbChroma(c) <= 24, v = (c.r + c.g + c.b) / 3;
			if (role === 'shadow' && ctx.policy === 'less' && ex.lessKeepOthers !== false) return null;
			if (role === 'shadow') {
				if (neutral && v < 90) {
					const a = +Math.min((A.shadow || {}).cap || 0.7, c.a * ((A.shadow || {}).factor || 1.6)).toFixed(3);
					return { expr: `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`, dark: { ...c, a }, via: 'shadow alpha x factor' };
				}
				if (neutral && v >= 200) return { expr: 'transparent', dark: { r: 0, g: 0, b: 0, a: 0 }, via: 'light shadow -> transparent' };
			}
			if (neutral && v >= 250) {
				const surf = isFloating(ctx.sel || '') && ex.floatingVeils ? '--surface-raised' : '--surface';
				return mixA({ ...tok(surf), via: 'white veil = surface' }, c.a);
			}
			if (ctx.policy === 'less' && ex.lessKeepOthers !== false) {
				const b = mapOpaque({ r: c.r, g: c.g, b: c.b, a: 1 }, role, ctx);
				return b ? mixA(b, c.a) : null;
			}
			if (neutral && v < 40 && role === 'bg') {
				if (c.a >= 0.3) return null;
				return mixA({ ...todo('--text', 'dark hover tint inverted'), via: 'dark tint inverted' }, c.a);
			}
			const base = mapOpaque({ r: c.r, g: c.g, b: c.b, a: 1 }, role === 'shadow' ? 'border' : role, ctx);
			if (!base) return null;
			return mixA(base, c.a);
		}
		return mapOpaque(c, role, ctx);
	}
	return { mapColor, isFloating, isToolbar, nearestRamp, tok, tokName };
}

const dmName = (t) => '--dm' + t.slice(1);
function dmValue(v, known) {
	return String(v).replace(/var\((--[\w-]+)/g, (m, n) => (known.has(n) ? `var(${dmName(n)}` : m));
}
export function renderTokensCss(A, D, { defs = {}, header = '' } = {}) {
	const T = D.tokens;
	const known = new Set(Object.keys(T));
	known.add('--surface');
	const L = [];
	L.push('/*');
	L.push(` * Aras dark mode: generated tokens (${A.version}). GENERATED by DarkModeKit/lib/derive-palette.mjs - do not edit.`);
	L.push(' * Everything here is defined ONLY under html[data-theme="dark"] and only for screen media, so light mode and');
	L.push(' * printing resolve every var(--dm-..., <light literal>) to its light literal.');
	if (header) L.push(' * ' + header);
	L.push(' */');
	L.push('@media screen {');
	L.push(`${DARK} {`);
	L.push('\tcolor-scheme: dark;');
	L.push('\t/* ramp */');
	for (const r of D.ramp) L.push(`\t${dmName(r.v)}: ${r.dark};`);
	L.push('\t/* semantic */');
	const rampNames = new Set(D.ramp.map((r) => r.v));
	for (const [t, v] of Object.entries(T)) if (!rampNames.has(t)) L.push(`\t${dmName(t)}: ${dmValue(v, known)};`);
	if (!T['--surface']) L.push(`\t--dm-surface: ${D.S};`);
	const legacy = legacyDefs(A, D);
	if (Object.keys(legacy).length) {
		L.push('\t/* vendor legacy custom properties (dark only) */');
		for (const [k, v] of Object.entries(legacy)) L.push(`\t${k}: ${v};`);
	}
	const keys = Object.keys(defs).sort();
	if (keys.length) {
		L.push('\t/* literal map: --dm-<role>-<hex> and derived expressions */');
		for (const k of keys) L.push(`\t${k}: ${defs[k]};`);
	}
	L.push('}');
	L.push('}');
	return L.join('\n') + '\n';
}
export function legacyDefs(A, D) {
	const out = {};
	for (const r of D.ramp) out[r.v] = r.dark;
	for (const [name, spec] of Object.entries((A.tokens || {}).legacy || {})) {
		if (name.startsWith('_')) continue;
		if (spec === 'keep' || spec == null) continue;
		const t = typeof spec === 'string' ? spec : spec.token;
		const h = D.hex[t];
		if (h) out[name] = h;
		else if (D.tokens[t] != null) out[name] = D.tokens[t];
	}
	return out;
}

function lessVars(text) {
	const vars = {};
	const body = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of body.matchAll(/@([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
	return vars;
}
function resolveLess(v, vars, depth = 0) {
	if (depth > 10) return null;
	v = v.trim();
	const vm = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/.exec(v);
	if (vm) return resolveLess(vm[1], vars, depth + 1);
	if (v.startsWith('@')) return vars[v.slice(1)] != null ? resolveLess(vars[v.slice(1)], vars, depth + 1) : null;
	const c = parseColor(v);
	return c && !c.kw ? toHex6(c) : null;
}
export function deriveCharts(A, D, readLess) {
	const res = { palettes: {}, settings: {}, source: [] };
	const vtext = readLess('styles/less/core/variables.less');
	if (!vtext) return res;
	const vars = lessVars(vtext);
	const ptext = readLess('styles/less/components/chart-palettes.less');
	if (ptext) {
		res.source.push('styles/less/components/chart-palettes.less');
		const pv = lessVars(ptext);
		const all = { ...vars, ...pv };
		for (const name of (pv['chart-palettes'] || '').split(',').map((s) => s.trim()).filter(Boolean)) {
			const list = (pv[name] || '').split(',').map((s) => resolveLess(s, all));
			res.palettes[name] = list.map((h) => (h == null ? null : contrast(h, D.S) >= 3 ? h : adaptForDark(h, { bg: D.S, minContrast: 3 })));
		}
	}
	const stext = readLess('styles/less/components/chart-settings.less');
	if (stext) {
		res.source.push('styles/less/components/chart-settings.less');
		const sv = lessVars(stext);
		const all = { ...vars, ...sv };
		for (const [k, v] of Object.entries(sv)) {
			if (!k.startsWith('color-')) continue;
			const h = resolveLess(v, all);
			if (!h) continue;
			const r = D.rampByLight(h);
			res.settings[k] = h === D.SL ? D.S : r ? r.dark : adaptForDark(h, { bg: D.S, minContrast: 3 });
		}
		res.settings['color-tooltip-background'] = D.hex['--surface-raised'] || D.S;
		res.settings['color-tooltip-border'] = D.hex['--border'] || res.settings['color-gray800'];
		res.settings['color-element-border'] = D.S;
	}
	return res;
}
export function buildPalette(A, D, { readLess = () => null } = {}) {
	const tokens = {};
	for (const [t, h] of Object.entries(D.hex)) if (h) tokens[dmName(t)] = h;
	for (const r of D.ramp) tokens[dmName(r.v)] = r.dark;
	const system = {};
	for (const name of Object.keys(SYSTEM)) system[name] = SYSTEM[name][1];
	return {
		schema: 'aras-darkmode-palette/1',
		version: A.version,
		surface: D.S,
		surfaceLight: D.SL,
		surfaceRaised: D.hex['--surface-raised'] || D.S,
		text: D.hex['--text'],
		adaptForDark: { bg: D.S, itemTypeMinContrast: 3, formTextMinContrast: 4.5, maxL: 0.86 },
		tintBaseRgb: D.tokens['--tint-base-rgb'],
		features: A.features || {},
		tokens,
		legacy: legacyDefs(A, D),
		system,
		charts: deriveCharts(A, D, readLess)
	};
}

function readV1Dark(file) {
	const css = fs.readFileSync(file, 'utf8');
	const i = css.indexOf("html[data-theme='dark'] {");
	const block = css.slice(i, css.indexOf('}', i));
	const m = {};
	for (const [, k, v] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!k.startsWith('--dm-tooltip')) m[k] = v.trim();
	return m;
}
export function compareV1(D, file) {
	const V = readV1Dark(file);
	const T = D.tokens;
	const diffs = [];
	for (const k of new Set([...Object.keys(V), ...Object.keys(T)])) {
		const a = (T[k] || '').toLowerCase().replace(/\s+/g, ' '), b = (V[k] || '').toLowerCase().replace(/\s+/g, ' ');
		if (!V[k]) continue;
		if (a !== b) diffs.push({ token: k, derived: T[k] || null, v1: V[k] });
	}
	return { v1Tokens: Object.keys(V).length, diffs };
}
export function contrastTable(A, D) {
	const rows = [];
	for (const [name, [fg, bg, want]] of Object.entries(A.contrastChecks || {})) {
		const v = (x) => (x.startsWith('#') ? x : D.hex[x]);
		if (!v(fg) || !v(bg)) { rows.push({ name, value: null }); continue; }
		const c = contrast(v(fg), v(bg));
		rows.push({ name, fg: v(fg), bg: v(bg), value: +c.toFixed(2), want, ok: want == null || Math.abs(c - want) <= 0.1 });
	}
	return rows;
}

async function main() {
	const util = await import('./util.mjs');
	const args = util.parseArgs();
	const log = util.createLogger('derive-palette');
	const t0 = Date.now();
	const A = loadAnchors(util.requireArg(args, 'anchors'));
	const D = derive(A, { formulaOnly: !!args.formulaOnly });
	if (args.compare) {
		const r = compareV1(D, args.compare);
		log.info(`compare with v1: ${r.v1Tokens} v1 tokens, ${r.diffs.length} differences`);
		for (const d of r.diffs) log.info(`  DIFF ${d.token}: derived=${d.derived} v1=${d.v1}`);
		if (r.diffs.length) process.exitCode = 1;
	}
	const assert = A.assertChecks !== false;
	for (const r of contrastTable(A, D)) {
		const tag = r.want == null ? '' : assert ? ` (want ${r.want}) ${r.ok ? 'OK' : 'FAIL'}` : ` (2025 v1: ${r.want}, delta ${(r.value - r.want >= 0 ? '+' : '') + (r.value - r.want).toFixed(2)})`;
		log.info(`  ${r.name.padEnd(28)} ${r.value == null ? 'n/a' : r.value.toFixed(2)}${tag}  ${r.fg || ''} on ${r.bg || ''}`);
		if (assert && r.want != null && !r.ok) process.exitCode = 1;
	}
	if (args.target && args.out) {
		const go = await import('./gen-overrides.mjs');
		const res = await go.generate({ target: args.target, snapshot: args.snapshot, anchors: args.anchors, out: args.out, only: 'tokens', log });
		log.info(`tokens.css/palette.json written (${res.written.length} changed) in ${Date.now() - t0} ms`);
	}
}
if (isMainModule(import.meta.url)) {
	main().catch((e) => {
		console.error(e && e.stack ? e.stack : e);
		process.exit(1);
	});
}
