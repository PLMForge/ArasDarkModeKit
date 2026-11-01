#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	parseArgs, makeResolver, writeIfChanged, loadAnchors, norm, isHex6, rgb, contrast, isNeutral, oklch, oklchToHex,
	tintAtContrast, localAdaptForDark, loadColorLib, rewriteSvg, stripComments, parseBlocks, splitTop, isMainModule
} from './gen-icons.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bgTint(light, text, textContrast, chroma) {
	const [, C0, H] = oklch(light);
	const C = chroma == null ? C0 : chroma;
	const lumOf = (h) => { const [r, g, b] = rgb(h).map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
	const Yt = (lumOf(text) + 0.05) / textContrast - 0.05;
	let lo = 0, hi = 1;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		if (lumOf(oklchToHex(mid, C, H)) < Yt) lo = mid; else hi = mid;
	}
	return oklchToHex(lo, C, H);
}
function localDerive(A, adaptForDark) {
	const S = norm(A.surface.dark), SL = norm(A.surface.light || '#ffffff');
	const pin = (group, light) => { const g = A.pins[group] || {}; return (light && g[norm(light)]) || g['*']; };
	const out = {};
	const ramp = A.ramp.map(([v, h, dir]) => {
		const light = norm(h);
		let dark;
		if (light === SL && dir !== 'darker') dark = S;
		else if (pin('ramp', light)) dark = norm(pin('ramp', light));
		else dark = tintAtContrast(contrast(light, SL), S, A.tint, dir === 'darker' ? 'darker' : 'lighter');
		out[v] = dark;
		return { v, light, dark, dir, c: contrast(light, SL) };
	});
	const darkerSteps = new Set(A.ramp.filter(([, , d]) => d === 'darker').map(([v]) => v));
	const rampByLight = (light) => ramp.find((r) => r.light === norm(light) && !darkerSteps.has(r.v));
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
	for (const [tok, rule0] of Object.entries(A.rules || {})) {
		const rule = typeof rule0 === 'string' ? { rule: rule0 } : rule0;
		const lightSrc = A.light[tok] != null ? A.light[tok] : rule.of ? A.light[rule.of] : null;
		const light = lightSrc != null ? norm(lightSrc) : null;
		const lightFree = ['contrast', 'surface', 'shift', 'alias', 'var', 'fixed'].includes(rule.rule);
		if (light == null && !lightFree) continue;
		const p = pin(tok, light);
		let dark;
		if (rule.rule === 'alias') dark = out[rule.to] != null ? out[rule.to] : null;
		else if (rule.rule === 'var') dark = null;
		else if (rule.rule === 'fixed') dark = norm(rule.value);
		else if (p) dark = norm(p);
		else if (rule.rule === 'surface') dark = S;
		else if (rule.rule === 'keep') dark = light;
		else if (rule.rule === 'ramp') { const r = rampByLight(light); dark = r ? r.dark : tintAtContrast(contrast(light, SL), S, A.tint, 'lighter'); }
		else if (rule.rule === 'snap') dark = snap(light).dark;
		else if (rule.rule === 'contrast') dark = tintAtContrast(rule.target, S, A.tint, rule.dir || 'lighter');
		else if (rule.rule === 'adapt') dark = norm(adaptForDark(light, { bg: S, minContrast: rule.contrast, maxL: rule.maxL == null ? 1 : rule.maxL }));
		else if (rule.rule === 'fill') {
			const [L0, C, H] = oklch(light);
			let L = L0, hx = light;
			while (contrast(hx, S) < (rule.surfaceMin || 1.5) && L < 1) { L += 0.005; hx = oklchToHex(L, C, H); }
			dark = hx;
		} else if (rule.rule === 'shift') {
			const base = out[rule.of];
			if (!base) continue;
			const [L, C, H] = oklch(base);
			dark = oklchToHex(L + rule.dL, C, H);
		} else if (rule.rule === 'bgTint') dark = bgTint(light, out[rule.text || '--text'], rule.textContrast, rule.chroma);
		else continue;
		if (dark) out[tok] = dark;
	}
	return { tokens: out, ramp, S, SL };
}
async function deriveTokens(A, adaptForDark) {
	const f = path.join(KIT, 'lib', 'derive-palette.mjs');
	if (fs.existsSync(f)) {
		try {
			const m = await import(pathToFileURL(f).href);
			if (typeof m.derive === 'function') {
				const r = m.derive(A);
				const t = r && (r.tokens || r);
				if (t && typeof t['--text'] === 'string' && /^#[0-9a-f]{6}$/i.test(t['--text'])) {
					const local = localDerive(A, adaptForDark);
					const tokens = {};
					for (const [k, v] of Object.entries(local.tokens)) tokens[k] = typeof t[k] === 'string' && /^#[0-9a-f]{6}$/i.test(t[k]) ? t[k].toLowerCase() : v;
					return { ...local, tokens, source: 'lib/derive-palette.mjs derive()' };
				}
			}
		} catch (e) {  }
	}
	return { ...localDerive(A, adaptForDark), source: 'local port of the R3 derive()' };
}

const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^()]*\)|\b(?:white|black|transparent)\b/g;
function parseCssColor(s) {
	s = s.trim().toLowerCase();
	if (s === 'transparent') return { hex: '#000000', a: 0 };
	if (s === 'white' || s === 'black') return { hex: norm(s), a: 1 };
	let m = /^#([0-9a-f]{8})$/.exec(s);
	if (m) return { hex: '#' + m[1].slice(0, 6), a: parseInt(m[1].slice(6), 16) / 255 };
	if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/.test(s)) return { hex: norm(s), a: 1 };
	m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s);
	if (m) {
		const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
		return { hex: '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join(''), a };
	}
	return null;
}
const fmtColor = (hex, a) => {
	if (a >= 1) return hex;
	const [r, g, b] = rgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
};
const ROLE = (prop) => (/^(color|-webkit-text-fill-color|caret-color)$/.test(prop) ? 'text' : /^outline/.test(prop) ? 'outline' : /^border/.test(prop) ? 'border' : /^(background|background-color|background-image)$/.test(prop) ? 'bg' : /^(fill)$/.test(prop) ? 'fill' : /^stroke$/.test(prop) ? 'stroke' : null);

const TEMPLATE = [
	[[':root'], [['color-scheme', { raw: 'dark' }, null, null]]],
	[['body'], [['background', '--surface-canvas', '#ffffff', '--surface-canvas']]],
	[['.login-area__form'], [['background-color', { token: '--surface', keepAlpha: true }, 'rgba(255, 255, 255, 0.9)', '--surface, same alpha as light']]],
	[['label'], [['color', '--text', '#353535', '--text']]],
	[['.login-area__info-description', '.login-area__version-info'], [['color', '--text-secondary', '#4f4f4f', '--text-secondary']]],
	[['.login-area__info-error-label', '.login-area__error'], [['color', '--error-text', '#cc2027', '--error-text']]],
	[['.aras-input'], [
		['border-color', '--border', '#878787', '--border'],
		['background-color', '--surface', '#ffffff', '--surface'],
		['color', '--text', '#353535', '--text']]],
	[['.aras-input::-moz-placeholder'], [['color', '--text-muted', '#696969', '--text-muted']]],
	[['.aras-input::placeholder'], [['color', '--text-muted', '#696969', '--text-muted']]],
	[['.aras-input:not(:disabled)[readonly]'], [
		['border-color', '--border-subtle', '#cfcfcf', '--border-subtle'],
		['background-color', { ramp: '#f5f5f5' }, '#f5f5f5', 'ramp #f5f5f5']]],
	[['.aras-input:not(:disabled):not([readonly]):hover'], [
		['background-color', '--surface', '#ffffff', '--surface'],
		['border-color', { ramp: '#4f4f4f' }, '#4f4f4f', 'ramp #4f4f4f']]],
	[['.aras-input:not(:disabled):focus:not([readonly])'], [
		['outline-color', '--focus', '#0f66cb', '--focus'],
		['background-color', '--surface', '#ffffff', '--surface']]],
	[[".aras-input:not(:disabled)[readonly='disabled']", '.aras-input:disabled'], [
		['background-color', { ramp: '#fbfbfb' }, '#fbfbfb', 'ramp #fbfbfb (sunken)'],
		['border-color', { ramp: '#dfdfdf' }, '#dfdfdf', 'ramp #dfdfdf'],
		['color', '--text-muted', '#696969', '--text-muted']]],
	[['.aras-input:not(:disabled).aras-input_invalid:not(:focus)'], [
		['border-color', '--error', '#cc2027', '--error'],
		['background', '--error-subtle', 'linear-gradient(0deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.94)), #cc2027', '--error-subtle']]],
	[['.aras-select__container select', '.aras-select__container select option'], [
		['color', '--text', '#353535', '--text'],
		['background-color', { ramp: '#f5f5f5' }, '#f5f5f5', 'ramp #f5f5f5']]],
	[['.aras-select__container select'], [['border-color', '--border', '#878787', '--border']]],
	[['.aras-select__container select:disabled'], [
		['background-color', '--surface', '#ffffff', '--surface'],
		['border-color', '--border-subtle', '#cfcfcf', '--border-subtle']]],
	[['.aras-select__container select:not(:disabled):hover'], [['background-color', { ramp: '#ebebeb' }, '#ebebeb', 'ramp #ebebeb']]],
	[['.aras-select__container select:not(:disabled):focus'], [['background-color', { ramp: '#dfdfdf' }, '#dfdfdf', 'ramp #dfdfdf']]],
	[['.aras-select__container .aras-select__button::before'], [['background', '--icon', '#4f4f4f', '--icon']]],
	[['.login-area .aras-button', ".login-area .aras-button:not([disabled]):not([aria-disabled='true']):focus"], [
		['background-color', '--secondary', '#1e212b', '--secondary: the light fill disappears on a dark surface']]],
	[[".login-area .aras-button:not([disabled]):not([aria-disabled='true']):hover"], [
		['background', '--secondary-hover', 'linear-gradient(0deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.15)), #1e212b', '--secondary-hover']]],
	[[".login-area .aras-button:not([disabled]):not([aria-disabled='true']):active"], [
		['background', '--secondary-active', 'linear-gradient(0deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.3)), #1e212b', '--secondary-active']]]
];

export async function genLogin(opts) {
	const target = path.resolve(opts.target);
	const snapshot = opts.snapshot && opts.snapshot !== true ? path.resolve(opts.snapshot) : null;
	const outDir = path.resolve(opts.out);
	const A = loadAnchors(path.resolve(opts.anchors));
	const log = opts.quiet ? () => {} : (...a) => console.log(...a);
	const resolve = makeResolver(target, snapshot);
	const color = opts['color-lib'] === 'local' ? { adaptForDark: localAdaptForDark, source: 'local' } : await loadColorLib();
	const D = await deriveTokens(A, color.adaptForDark);
	const S = D.S, SL = D.SL;
	const T = D.tokens;
	let pristine = (t) => t;
	try { const u = await import(pathToFileURL(path.join(KIT, 'lib', 'util.mjs')).href); if (typeof u.reconstructPristine === 'function') pristine = u.reconstructPristine; } catch {  }
	const report = { schema: 'aras-darkmode-coverage-login/1', target, anchorsVersion: A.version, tokensFrom: D.source, colorLib: color.source, template: [], sweep: [], droppedSelectors: [], notes: [] };

	const cssRel = ['OAuthServer/wwwroot/css/login.css', 'OAuthServer/wwwroot/css/login.min.css'].find((r) => fs.existsSync(resolve(r)));
	if (!cssRel) throw new Error('gen-login: no OAuthServer/wwwroot/css/login(.min).css in target');
	const cssText = pristine(fs.readFileSync(resolve(cssRel), 'utf8').replace(/^﻿/, ''));
	report.source = cssRel;

	const normSel = (s) => s.trim().replace(/\s+/g, ' ').replace(/"/g, "'");
	const rules = [];
	const declMap = new Map();
	const allSels = new Set();
	const visit = (nodes, top) => {
		for (const n of nodes) {
			if (n.children) { if (/^@media\b/i.test(n.prelude) && !/print/i.test(n.prelude)) visit(n.children, false); continue; }
			if (n.prelude.startsWith('@')) continue;
			const sels = splitTop(n.prelude, ',').map(normSel).filter(Boolean);
			const decls = [];
			for (const d of splitTop(n.body, ';')) {
				const i = d.indexOf(':');
				if (i < 0) continue;
				decls.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]);
			}
			for (const s of sels) {
				allSels.add(s);
				if (!top) continue;
				const m = declMap.get(s) || {};
				for (const [p, v] of decls) m[p] = v;
				declMap.set(s, m);
			}
			if (top) rules.push({ sels, decls });
		}
	};
	visit(parseBlocks(stripComments(cssText)), true);

	const lightAt = (sel, prop) => {
		const m = declMap.get(normSel(sel));
		if (!m) return null;
		const fam = prop === 'background' || prop === 'background-color' ? ['background-color', 'background'] : prop === 'border-color' ? ['border-color', 'border'] : prop === 'outline-color' ? ['outline-color', 'outline'] : [prop];
		for (const p of fam) if (m[p] != null) return { prop: p, value: m[p].replace(/\s*!important\s*$/i, '') };
		return null;
	};
	const sameColors = (a, b) => {
		const ca = (a.match(COLOR_RE) || []).map(parseCssColor).filter(Boolean).map((c) => fmtColor(c.hex, c.a));
		const cb = (b.match(COLOR_RE) || []).map(parseCssColor).filter(Boolean).map((c) => fmtColor(c.hex, c.a));
		return ca.length > 0 && JSON.stringify(ca) === JSON.stringify(cb);
	};

	const rampExact = (hex) => { const r = D.ramp.find((x) => x.light === hex && x.dir !== 'darker'); return r ? r.dark : null; };
	const mirror = (hex) => rampExact(hex) || (hex === SL ? S : tintAtContrast(contrast(hex, SL), S, A.tint, 'lighter'));
	const tokenOf = (role, hex) => {
		if (role === 'fill' || role === 'stroke') return null;
		const tab = A.literals && A.literals[role === 'outline' ? 'border' : role];
		const t = tab && tab[hex];
		return t && !/^MIX:/.test(t) && T[t] ? T[t] : null;
	};
	const mapColor = (role, c) => {
		if (c.a === 0) return null;
		const hex = c.hex;
		const viaTable = tokenOf(role, hex);
		if (viaTable) return viaTable;
		if (isNeutral(hex)) {
			if (hex === '#ffffff' && role !== 'bg') return null;
			if (role === 'text' || role === 'fill' || role === 'stroke') return mirror(hex);
			if (contrast(hex, SL) >= 4.5) return null;
			return mirror(hex);
		}
		if (role === 'bg') {
			if (contrast(hex, SL) < 1.3) {
				const [, C, H] = oklch(hex);
				return tintAtContrast(contrast(hex, SL), S, { hue: (H * 180) / Math.PI, chroma: Math.min(C, 0.06), maxContrast: A.tint.maxContrast }, 'lighter');
			}
			return null;
		}
		const min = role === 'text' ? 4.5 : 3;
		if (contrast(hex, S) >= min) return null;
		return norm(color.adaptForDark(hex, { bg: S, minContrast: min, maxL: 1 }));
	};
	const mapSvgData = (u) => {
		const comma = u.indexOf(',');
		const head = u.slice(0, comma);
		if (/;base64$/i.test(head)) return null;
		let svg;
		try { svg = decodeURIComponent(u.slice(comma + 1)); } catch { return null; }
		let changed = false;
		const out = rewriteSvg(svg, (o) => {
			if (!isHex6(o.value)) return undefined;
			const d = mapColor(o.attr === 'stroke' ? 'stroke' : 'fill', { hex: o.value, a: 1 });
			if (!d || d === o.value) return undefined;
			changed = true;
			return d;
		});
		return changed ? `${head},${encodeURIComponent(out).replace(/'/g, '%27')}` : null;
	};
	const mapValue = (prop, value) => {
		const role = ROLE(prop);
		if (!role) return null;
		let changed = false;
		let v = value.replace(/url\(\s*(['"]?)(data:image\/svg\+xml[^'")]*)\1\s*\)/gi, (m, q, u) => {
			const d = mapSvgData(u);
			if (!d) return m;
			changed = true;
			return `url("${d}")`;
		});
		v = v.replace(/url\([^)]*\)/gi, (m) => m.replace(COLOR_RE, (x) => `\u0001${x}`));
		v = v.replace(/(^|[^\u0001])(#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^()]*\)|\b(?:white|black)\b)/g, (m, pre, x) => {
			const c = parseCssColor(x);
			if (!c) return m;
			const d = mapColor(role, c);
			if (!d) return m;
			changed = true;
			return pre + fmtColor(d, c.a);
		});
		v = v.replace(/\u0001/g, '');
		return changed ? v : null;
	};

	const blocks = [];
	const covered = new Set();
	const fam = (p) => (/^background/.test(p) ? 'background' : /^border/.test(p) ? 'border' : /^outline/.test(p) ? 'outline' : p);
	const always = new Set([':root', 'body', 'label', 'html']);
	for (const [sels0, decls] of TEMPLATE) {
		const sels = sels0.filter((s) => always.has(s) || allSels.has(normSel(s)));
		for (const s of sels0) if (!sels.includes(s)) report.droppedSelectors.push(s);
		if (!sels.length) continue;
		const outDecls = [];
		for (const [prop, ref, v1Light, comment] of decls) {
			let line = null;
			const entry = { selectors: sels, prop };
			if (ref && ref.raw) { line = `${prop}: ${ref.raw};`; entry.how = 'raw'; }
			else {
				const L = lightAt(sels[0], prop);
				const tokenDark = typeof ref === 'string' ? T[ref] : ref.token ? T[ref.token] : ref.ramp ? (D.ramp.find((r) => r.light === norm(ref.ramp)) || {}).dark : null;
				if (v1Light && !L) {
					entry.how = 'no light declaration in this version: skipped';
				} else if (v1Light && !sameColors(L.value, v1Light)) {
					const mv = mapValue(L.prop, L.value);
					entry.how = `light differs (${L.value} vs v1 ${v1Light}): ${mv ? 'mapped literal' : 'kept (already reads on dark)'}`;
					if (mv) line = `${L.prop}: ${mv}; /* mapped from ${L.value.replace(/\*\//g, '')} */`;
				} else if (!tokenDark) {
					entry.how = 'token not derived for this version: skipped';
				} else {
					let val = tokenDark;
					if (ref.keepAlpha && L) {
						const c = (L.value.match(COLOR_RE) || []).map(parseCssColor).filter(Boolean).pop();
						if (c) val = fmtColor(tokenDark, c.a);
					}
					line = `${prop}: ${val};${comment ? ` /* ${comment} */` : ''}`;
					entry.how = v1Light && L ? 'token (light value verified)' : 'token (no light counterpart to verify)';
				}
			}
			report.template.push(entry);
			if (line) { outDecls.push(line); for (const s of sels) covered.add(`${normSel(s)}|${fam(prop)}`); }
		}
		if (outDecls.length) blocks.push(`  ${sels.join(',\n  ')} {\n${outDecls.map((d) => '    ' + d).join('\n')}\n  }`);
	}

	const isLoginSel = (s) => /login|^\.aras-input|^\.aras-select__container select/i.test(s) || /^(body|label|html)$/i.test(s);
	for (const r of rules) {
		const sels = r.sels.filter(isLoginSel);
		if (!sels.length) continue;
		const outDecls = [];
		for (const [prop, value0] of r.decls) {
			if (!ROLE(prop)) continue;
			if (sels.every((s) => covered.has(`${s}|${fam(prop)}`))) continue;
			const important = /!\s*important\s*$/i.test(value0);
			const value = value0.replace(/\s*!\s*important\s*$/i, '');
			const mv = mapValue(prop, value);
			if (!mv) continue;
			outDecls.push(`${prop}: ${mv}${important ? ' !important' : ''}; /* was ${value.length > 60 ? value.slice(0, 57) + '...' : value} */`);
			report.sweep.push({ selectors: sels, prop, light: value.length > 120 ? value.slice(0, 117) + '...' : value });
		}
		if (outDecls.length) blocks.push(`  ${sels.join(',\n  ')} {\n${outDecls.map((d) => '    ' + d).join('\n')}\n  }`);
	}

	let logoRel = 'OAuthServer/wwwroot/images/arasInnovator.svg';
	const cfg = resolve('OAuthServer/OAuthServer.config');
	if (fs.existsSync(cfg)) {
		const m = /key="LogoUrl"\s+value="([^"]*)"/i.exec(fs.readFileSync(cfg, 'utf8'));
		if (m) {
			if (/^~\/images\/arasInnovator\.svg$/i.test(m[1])) report.notes.push('LogoUrl is the default ~/images/arasInnovator.svg');
			else { logoRel = null; report.notes.push(`LogoUrl is customised (${m[1]}): no dark logo generated, the custom logo is left alone`); }
		}
	} else report.notes.push('OAuthServer.config not found: assuming the default LogoUrl ~/images/arasInnovator.svg');
	const ink = T['--text'];
	let logoWritten = false;
	if (logoRel && fs.existsSync(resolve(logoRel))) {
		const src = fs.readFileSync(resolve(logoRel), 'utf8');
		const inked = new Set();
		const dark = rewriteSvg(src, (o) => {
			if (isHex6(o.value) && isNeutral(o.value) && o.value !== '#ffffff' && contrast(o.value, '#ffffff') >= 4.5) { inked.add(o.value); return ink; }
			return undefined;
		});
		report.logo = { source: logoRel, ink, recoloured: [...inked] };
		writeIfChanged(path.join(outDir, 'oauth', 'arasInnovator-dark.svg'), dark);
		logoWritten = true;
		if (allSels.has('.login-area__logo-image'))
			blocks.push(`  .login-area__logo-image {\n    content: url("arasInnovator-dark.svg"); /* lettering ${[...inked].join(', ')} -> ${ink}, brand colours kept */\n  }`);
		else report.droppedSelectors.push('.login-area__logo-image');
	}

	const bump = (s) => /^(html|:root)\b/i.test(s) ? 'html:root' + s.replace(/^(html|:root)/i, '') : 'html:root ' + s;
	for (let i = 0; i < blocks.length; i++) {
		blocks[i] = blocks[i].replace(/^  ([^{]+?) \{/, (m, sel) => '  ' + sel.split(',\n  ').map((s) => bump(s.trim())).join(',\n  ') + ' {');
	}

	const css = [
		'/*',
		' * GENERATED by DarkModeKit/lib/gen-login.mjs - do not edit by hand.',
		` * OAuth login page dark theme for ${A.version}. The login views are compiled, so the theme follows the OS`,
		' * setting. Served from OAuthServer/wwwroot/css/darkmode/ via the @import at the top of login(.min).css.',
		' */',
		'@media (prefers-color-scheme: dark) {',
		blocks.join('\n'),
		'}',
		''
	].join('\n');
	const wrote = writeIfChanged(path.join(outDir, 'oauth', 'login-dark.css'), css);
	report.counts = { blocks: blocks.length, templateDecls: report.template.length, templateEmitted: report.template.filter((e) => /^token|^raw|mapped/.test(e.how)).length, sweepDecls: report.sweep.length, droppedSelectors: report.droppedSelectors.length, logo: logoWritten };
	writeIfChanged(path.join(outDir, 'report', 'coverage-login.json'), JSON.stringify(report, null, '\t') + '\n');
	log(`gen-login: ${A.version} from ${cssRel} (tokens: ${D.source})`);
	log(`  rules: ${blocks.length}; template decls ${report.template.length} (${report.template.filter((e) => /light differs/.test(e.how)).length} remapped for this version), sweep decls ${report.sweep.length}, dropped selectors ${report.droppedSelectors.length}`);
	log(`  logo: ${logoWritten ? `${report.logo.recoloured.join(',')} -> ${ink}` : 'not generated'}; login-dark.css ${wrote ? 'written' : 'unchanged'}`);
	return report;
}

if (isMainModule(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	for (const k of ['target', 'anchors', 'out']) if (!args[k] || args[k] === true) { console.error(`gen-login: --${k} is required`); process.exit(2); }
	genLogin(args).catch((e) => { console.error(e); process.exit(1); });
}
