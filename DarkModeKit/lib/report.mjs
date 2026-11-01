import fs from 'node:fs';
import path from 'node:path';
import * as util from './util.mjs';
import * as C from './checks.mjs';

export const HOOK_ANCHORS = [
	{ id: 'replaceSync', hook: 'H1 hook-stylesheets', ref: '', where: 'bundles', all: ['new CSSStyleSheet', '\\.replaceSync\\('] },
	{ id: 'adoptedStyleSheets', hook: 'H1 hook-stylesheets', ref: '', where: 'bundles', all: ['adoptedStyleSheets='] },
	{ id: 'lit-cssText-styleSheet', hook: 'H1 hook-stylesheets', ref: 'lit CSSResult', where: 'bundles', all: ['\\.replaceSync\\(this\\.cssText\\)'], required: false },
	{ id: 'svg-sprite-fetch', hook: 'H2 hook-svg', ref: 'include.aspx?svg=', where: 'bundles', all: ['"javascript/include\\.aspx"', '\\.set\\("svg",', 'window\\.fetch\\([\\w$]+\\.toString\\(\\),\\{headers:\\{Accept:"application/xml"'] },
	{ id: 'svg-symbols', hook: 'H2 hook-svg', ref: '#svg-symbols', where: 'bundles', all: ['"svg-symbols"'] },
	{ id: 'SvgManager-getSvgNode', hook: 'H2 hook-svg', ref: '', where: 'bundles', all: ['getSvgNode:'] },
	{ id: 'aras-image-define', hook: 'H2 hook-components', ref: 'customElements.define "aras-image"', where: 'bundles', all: ['customElements\\.define\\(', '`aras-\\$\\{', 'aras-image__image'] },
	{ id: 'aras-chart', hook: 'H2 hook-components', ref: 'aras-chart', where: 'bundles', all: ['aras-chart__canvas-container', '_chart'] },
	{ id: 'window.fetch', hook: 'H2 hook-svg', ref: '', where: 'bundles', all: ['window\\.fetch\\('] },
	{ id: 'CuiLayout-global', hook: 'H3 form/item-type colour', ref: '', where: 'bundles', all: ['window\\.CuiLayout=', 'window\\.ItemViewCuiLayout='] },
	{ id: 'attachCssItemTypeColor', hook: 'H3 item-type colour', ref: '', where: 'bundles', all: ['attachCssItemTypeColor\\(\\)\\{'] },
	{ id: 'reInitByCUIDependencies', hook: 'H3 theme-menu', ref: '', where: 'bundles', all: ['"reInitByCUIDependencies"'] },
	{ id: 'headerCommandsBar', hook: 'H3 theme-menu', ref: '', where: 'file', file: 'Index.cshtml', all: ['id="headerCommandsBar"'] },
	{ id: 'aras-header__user-menu', hook: 'H3 theme-menu', ref: '', where: 'file', file: 'styles/main.css', all: ['\\.aras-header__user-menu'] },
	{ id: 'MonacoEnvironment-globalAPI', hook: 'H2 hook-apps (Monaco)', ref: '', where: 'bundles', all: ['globalThis\\.MonacoEnvironment', '\\?\\.globalAPI\\|\\|', 'globalThis\\.monaco='] },
	{ id: 'MethodEditor.html', hook: 'H2 hook-apps (Monaco)', ref: '', where: 'file', file: 'scripts/CodeEditor/MethodEditor.html', all: ['methodEditor'] },
	{ id: 'Aras-global', hook: 'H3 hook-reports', ref: '', where: 'file', file: 'javascript/aras_object.ts', all: ['function Aras\\(parent\\)'] },
	{ id: 'targetReport', hook: 'H3 hook-reports', ref: '', where: 'file', file: 'javascript/aras_object.ts', all: ['Aras\\.prototype\\.targetReport\\s*=\\s*function'] },
	{ id: 'invokeAction', hook: 'H3 hook-reports', ref: '', where: 'file', file: 'javascript/aras_object.ts', all: ['Aras\\.prototype\\.invokeAction\\s*=\\s*function'] },
	{ id: 'getActionTargetWindow', hook: 'H3 hook-reports', ref: '', where: 'file', file: 'javascript/aras_object.ts', all: ['Aras\\.prototype\\.getActionTargetWindow\\s*=\\s*function'] },
	{ id: 'modalDialog-writeContent', hook: 'H3 hook-reports', ref: 'other written documents', where: 'file', file: 'scripts/modalDialog.html', all: ['writeContent'] },
	{ id: 'ShowFormAsADialog-formFrame', hook: 'H3 hook-reports', ref: '', where: 'file', file: 'scripts/ShowFormAsADialog.html', all: ['formFrame', 'document\\.write|\\.write\\('], required: false },
	{ id: 'DomToSVG-toSVG', hook: 'H2 hook-apps (export)', ref: '', where: 'file', file: 'Modules/aras.innovator.Printing/Scripts/Classes/DomToSVG.ts', all: ['DomToSVG\\.prototype\\.toSVG\\s*=', 'DomToSVG\\.prototype\\._setInlineStyles\\s*='] },
	{ id: 'PDFTron.WebViewer', hook: 'H2 hook-apps (PDFTron)', ref: '', where: 'file', file: 'Modules/aras.innovator.Viewers/Scripts/3rdPartyLibs/pdftronwebviewer-v2.2/lib/WebViewer.js', all: ['PDFTron\\.WebViewer\\s*=\\s*function'] },
	{ id: 'Ace-setTheme', hook: 'H2 hook-apps (Ace)', ref: '', where: 'file', file: 'vendors/ace-editor/ace.js', all: ['setTheme\\s*=\\s*function', 'ace/virtual_renderer'] },
	{ id: 'RichText-onLoad', hook: 'H2 hook-apps (HtmlEditor)', ref: '', where: 'file', file: 'javascript/dijit/_editor/RichText.js', all: ['define\\("dijit/_editor/RichText"', 'onLoad:function\\('] }
];

const exists = (p) => {
	try {
		fs.accessSync(p);
		return true;
	} catch {
		return false;
	}
};
const isFile = (p) => {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
};
const absOf = (root, rel) => path.join(root, ...String(rel).replace(/\\/g, '/').split('/'));
const clip = (s, n = 100) => {
	s = String(s).replace(/\s+/g, ' ');
	return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const mdEsc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const readJson = (f) => (f && isFile(f) ? C.readJsonFile(f) : null);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');

const CSS_SKIP_DIR = /^(darkmode|images-dark|nodejs|node_modules|WebHelp|docs|temp|logs|bin|App_Data)$/i;
export function indexSourceCss(target, snapshot) {
	const roots = [
		['Innovator/Client', absOf(target, 'Innovator/Client')],
		['OAuthServer/wwwroot/css', absOf(target, 'OAuthServer/wwwroot/css')]
	];
	const files = new Map();
	const global = new Map();
	let bytes = 0;
	let parseErrors = 0;
	for (const [prefix, dir] of roots) {
		if (!exists(dir)) continue;
		const rels = C.walk(dir, { skip: (r, e) => e.isDirectory() && CSS_SKIP_DIR.test(e.name) }).filter((r) => /\.css$/i.test(r));
		const set = new Set(rels.map((r) => r.toLowerCase()));
		for (const r of rels) {
			if (/\.min\.css$/i.test(r) && set.has(r.toLowerCase().replace(/\.min\.css$/, '.css'))) continue;
			const rel = prefix + '/' + r;
			const p = snapshot && isFile(absOf(snapshot, rel)) ? absOf(snapshot, rel) : absOf(target, rel);
			const css = C.readTextNoBom(p).text;
			bytes += css.length;
			const sels = new Set();
			const parsed = C.parseCss(css);
			parseErrors += parsed.errors.length;
			C.walkRules(parsed.rules, (rule) => {
				if (rule.type !== 'qualified' || rule.keyframe) return;
				for (const s of C.selectorsFromToks(css, rule.preludeToks)) {
					sels.add(s);
					if (!global.has(s)) global.set(s, []);
					global.get(s).push(rel);
				}
			});
			files.set(rel, sels);
		}
	}
	return { files, global, bytes, parseErrors };
}

export function addJsStyleSources(idx, target, snapshot, overridesCss) {
	const names = new Set([...overridesCss.matchAll(/\/\* ==== ([\w.\-\/]+\.js)#([A-Za-z_$][\w$]*) /g)].map((m) => m[1] + '#' + m[2]));
	for (const name of names) {
		const [rel, id] = name.split('#');
		const p = snapshot && isFile(absOf(snapshot, rel)) ? absOf(snapshot, rel) : absOf(target, rel);
		if (!isFile(p)) continue;
		const js = C.readTextNoBom(p).text;
		const m = js.match(new RegExp(`(?:const|let|var)\\s+${id.replace(/\$/g, '\\$')}\\s*=\\s*\`([^\`]*)\``));
		if (!m) continue;
		const sels = new Set();
		const parsed = C.parseCss(m[1]);
		C.walkRules(parsed.rules, (rule) => {
			if (rule.type !== 'qualified' || rule.keyframe) return;
			for (const s of C.selectorsFromToks(m[1], rule.preludeToks)) {
				sels.add(s);
				if (!idx.global.has(s)) idx.global.set(s, []);
				idx.global.get(s).push(name);
			}
		});
		idx.files.set(name, sels);
	}
	return idx;
}

function sectionFiles(css, toks) {
	const marks = [];
	for (const t of toks) {
		if (t.t !== 'comment') continue;
		const m = /([\w.\-]+(?:\/[\w.\-]+)*\.(?:(?:min\.)?css\b|js#[A-Za-z_$][\w$]*))/.exec(css.slice(t.s, t.e));
		if (m) marks.push({ at: t.s, file: m[1] });
	}
	return (off) => {
		let lo = 0;
		let hi = marks.length - 1;
		let best = null;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (marks[mid].at < off) {
				best = marks[mid];
				lo = mid + 1;
			} else hi = mid - 1;
		}
		return best ? best.file : null;
	};
}
const INLINE_ATTR = /\[(style|fill|stroke|bgcolor|color|background)[\^*$~|]?=/i;
export function stripGates(sel) {
	let s = sel;
	for (let guard = 0; guard < 4; guard++) {
		const m = /^:where\(:has\(/.exec(s);
		if (!m) break;
		const close = C.matchParen(s, 6);
		if (close < 0) break;
		s = s.slice(close + 1).replace(/^ /, '');
	}
	return s;
}

export function selectorExistence(overridesCss, idx, { handSelectors = new Set(), file = 'overrides.css' } = {}) {
	const parsed = C.parseCss(overridesCss);
	const sectionOf = sectionFiles(overridesCss, parsed.toks);
	const res = { total: 0, inFile: 0, elsewhere: 0, missing: [], exempt: { root: 0, inline: 0, hand: 0 }, unscoped: 0, perFile: {}, noSection: 0 };
	const fileKeys = [...idx.files.keys()];
	const resolveFile = (name) => {
		if (!name) return null;
		const n = name.replace(/\\/g, '/').toLowerCase().replace(/\.min\.css$/, '.css');
		return fileKeys.find((k) => k.toLowerCase().endsWith('/' + n) || k.toLowerCase() === n) || null;
	};
	C.walkRules(parsed.rules, (rule) => {
		if (rule.type !== 'qualified' || rule.keyframe) return;
		const section = sectionOf(rule.s);
		const srcFile = resolveFile(section);
		if (!section) res.noSection++;
		const pf = (res.perFile[srcFile || section || '(no section)'] = res.perFile[srcFile || section || '(no section)'] || { total: 0, inFile: 0, elsewhere: 0, missing: 0, exempt: 0 });
		for (const sel of C.selectorsFromToks(overridesCss, rule.preludeToks)) {
			res.total++;
			pf.total++;
			if (!C.isDarkSelector(sel)) {
				res.unscoped++;
				continue;
			}
			const rest = stripGates(C.stripDarkScope(sel));
			if (handSelectors.has(sel) || handSelectors.has(rest)) {
				res.exempt.hand++;
				pf.exempt++;
				continue;
			}
			if (rest === '' || /^(body|html|:root)$/.test(rest)) {
				res.exempt.root++;
				pf.exempt++;
				continue;
			}
			if (INLINE_ATTR.test(rest)) {
				res.exempt.inline++;
				pf.exempt++;
				continue;
			}
			const cands = /^[>+~.:[#]/.test(rest) ? ['html' + rest, ':root' + rest, rest.replace(/^[>+~]/, '')] : [rest, 'html ' + rest, ':root ' + rest, 'body ' + rest];
			const set = srcFile ? idx.files.get(srcFile) : null;
			if (set && cands.some((x) => set.has(x))) {
				res.inFile++;
				pf.inFile++;
			} else if (cands.some((x) => idx.global.has(x))) {
				res.elsewhere++;
				pf.elsewhere++;
			} else {
				pf.missing++;
				res.missing.push({ selector: rest, section: section || null });
			}
		}
	});
	res.parseErrors = parsed.errors.length;
	return res;
}

export function hookAnchors(target, anchors = HOOK_ANCHORS) {
	const client = absOf(target, 'Innovator/Client');
	const rb = C.reachableBundles(client);
	const liveText = new Map(rb.live.map((f) => [f, fs.readFileSync(path.join(rb.dir, f), 'utf8')]));
	const deadText = new Map(rb.dead.map((f) => [f, fs.readFileSync(path.join(rb.dir, f), 'utf8')]));
	const out = [];
	for (const a of anchors) {
		const res = { id: a.id, hook: a.hook, ref: a.ref, where: a.where, file: a.file || null, required: a.required !== false, status: 'FAIL', detail: [] };
		const res2 = a.all.map((src) => new RegExp(src));
		if (a.where === 'bundles') {
			let allOk = true;
			for (const re of res2) {
				const hits = [...liveText].filter(([, t]) => re.test(t)).map(([f]) => f);
				if (hits.length) res.detail.push(`/${re.source}/ in ${hits.length} live: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''}`);
				else {
					allOk = false;
					const dead = [...deadText].filter(([, t]) => re.test(t)).map(([f]) => f);
					res.detail.push(`/${re.source}/ NOT in live bundles${dead.length ? ` (only in unreachable: ${dead.slice(0, 3).join(', ')})` : ''}`);
				}
			}
			res.status = allOk ? 'PASS' : res.required ? 'FAIL' : 'WARN';
		} else {
			const p = absOf(client, a.file);
			if (!isFile(p)) {
				res.detail.push(`${a.file} missing`);
				res.status = res.required ? 'FAIL' : 'WARN';
			} else {
				const t = fs.readFileSync(p, 'utf8');
				const miss = res2.filter((re) => !re.test(t));
				res.detail.push(miss.length ? `missing in ${a.file}: ${miss.map((r) => '/' + r.source + '/').join(' ')}` : `${a.file}: all ${res2.length} pattern(s) found`);
				res.status = miss.length ? (res.required ? 'FAIL' : 'WARN') : 'PASS';
			}
		}
		out.push(res);
	}
	return { anchors: out, bundles: { total: rb.all.length, live: rb.live.length, dead: rb.dead.length, deadList: rb.dead } };
}

export function summariseCssCoverage(j) {
	const perFile = {};
	const unmatched = [];
	const addLit = (file, item) => {
		const f = file || '(unknown)';
		const e = (perFile[f] = perFile[f] || { count: 0, samples: [] });
		e.count++;
		if (e.samples.length < 6) e.samples.push(typeof item === 'string' ? item : clip(JSON.stringify(item), 90));
	};
	if (!j) return null;
	const isUnmappedKey = (k) => /unmapped|todo|missing|unresolved/i.test(k);
	const isUnmatchedKey = (k) => /unmatched/i.test(k);
	const visit = (o, file, depth) => {
		if (depth > 5 || !o || typeof o !== 'object') return;
		for (const [k, v] of Object.entries(o)) {
			if (isUnmatchedKey(k) && Array.isArray(v)) v.forEach((x) => unmatched.push(typeof x === 'string' ? { selector: x, file } : { file, ...x }));
			else if (isUnmappedKey(k) && Array.isArray(v)) v.forEach((x) => addLit((x && x.file) || file, x));
			else if (isUnmappedKey(k) && v && typeof v === 'object' && !Array.isArray(v)) {
				for (const [kk, vv] of Object.entries(v)) {
					if (Array.isArray(vv)) vv.forEach((x) => addLit(kk, x));
					else if (typeof vv === 'number') {
						const e = (perFile[kk] = perFile[kk] || { count: 0, samples: [] });
						e.count += vv;
					} else addLit(file, { [kk]: vv });
				}
			} else if (v && typeof v === 'object') visit(v, /files|perFile|byFile/i.test(k) || /\.css$/i.test(k) ? (/\.css$/i.test(k) ? k : file) : file, depth + 1);
		}
	};
	if (Array.isArray(j)) j.forEach((x) => addLit(x && x.file, x));
	else visit(j, null, 0);
	return { perFile, unmatched, topKeys: Array.isArray(j) ? ['(array)'] : Object.keys(j) };
}
export function summariseIconCoverage(j) {
	if (!j) return null;
	const gaps = [];
	const visit = (o, p, depth) => {
		if (depth > 4 || !o || typeof o !== 'object') return;
		for (const [k, v] of Object.entries(o)) {
			const gapKey = /gap|missing|unmapped|todo|unhandled|nofill|no-fill|notInThisVersion|keptBelowContrast|notCovered/i.test(k);
			if (gapKey && Array.isArray(v)) v.forEach((x) => gaps.push({ kind: p + k, item: typeof x === 'string' ? x : clip(JSON.stringify(x), 100) }));
			else if (gapKey && v && typeof v === 'object') {
				for (const [kk, vv] of Object.entries(v)) {
					if (Array.isArray(vv)) vv.forEach((x) => gaps.push({ kind: p + k + '.' + kk, item: typeof x === 'string' ? x : clip(JSON.stringify(x), 100) }));
					else if (vv && typeof vv === 'object') Object.entries(vv).forEach(([a, b]) => gaps.push({ kind: p + k + '.' + kk, item: `${a}: ${clip(JSON.stringify(b), 80)}` }));
				}
			} else if (v && typeof v === 'object' && !Array.isArray(v)) visit(v, p + k + '.', depth + 1);
		}
	};
	visit(j, '', 0);
	return { gaps, topKeys: Object.keys(j), stats: j.stats || j.summary || null };
}

export function extractTargetsFrom(file) {
	if (!file || !isFile(file)) return null;
	const src = fs.readFileSync(file, 'utf8');
	const m = /const\s+TARGETS\s*=\s*\[([\s\S]*?)\n\s*\];?/.exec(src);
	if (!m) return null;
	const out = [];
	for (const s of m[1].matchAll(/['"]([^'"\n]+\.(?:cshtml|html?|aspx|css))['"]/g)) {
		const r = s[1].replace(/\\/g, '/');
		out.push(/^(Innovator|OAuthServer)\//.test(r) ? r : 'Innovator/Client/' + r);
	}
	return out.length ? out : null;
}
export function injectionStatus(target, list) {
	const res = { total: list.length, notFound: [], injected: 0, notInjected: [], partial: [] };
	for (const rel of list) {
		const p = absOf(target, rel);
		if (!isFile(p)) {
			res.notFound.push(rel);
			continue;
		}
		const t = fs.readFileSync(p, 'utf8');
		const head = t.includes('<!-- aras-darkmode:begin head -->');
		const css = t.includes('<!-- aras-darkmode:begin css -->');
		const imp = t.includes('/* aras-darkmode:begin import */');
		if ((head && css) || imp) res.injected++;
		else if (head || css) res.partial.push(rel + (head ? ' (head only)' : ' (css only)'));
		else res.notInjected.push(rel);
	}
	return res;
}

const COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black|red|green|blue|gr[ae]y|silver|orange|yellow|navy|transparent|buttonface|buttontext|canvas|canvastext|window|windowtext|threedface)\b/i;
const CSS_LIKE = /[^{}]*\{[^{}]*:[^{}]*\}/;
function looksLikeCss(text) {
	if (/=>|\bfunction\b|\breturn\b|\bvar \w+=|\blet \w+=|\)\{|&&|\|\|/.test(text)) return false;
	const p = C.parseCss(text);
	if (p.errors.length) return false;
	let decls = 0;
	C.walkRules(p.rules, (r) => (decls += (r.decls || []).length));
	return decls > 0;
}
export function sheetsEstimate(target, sheets) {
	const rb = C.reachableBundles(absOf(target, 'Innovator/Client'));
	const keys = new Set(Object.keys(sheets || {}).map((k) => {
		const p = C.parseSheetKey(k);
		return p ? `${p.hash}:${p.length}` : k;
	}));
	const seen = new Set();
	const res = { liveBundles: rb.live.length, candidates: 0, withColour: 0, hits: 0, misses: [], composed: 0, keysNotInBundles: 0, replaceSyncSites: 0 };
	const foundKeys = new Set();
	for (const f of rb.live) {
		const src = fs.readFileSync(path.join(rb.dir, f), 'utf8');
		res.replaceSyncSites += (src.match(/\.replaceSync\(/g) || []).length;
		for (const lit of C.jsLiterals(src, { minLength: 8 })) {
			if (lit.hasSubst) {
				const raw = src.slice(lit.start, lit.end);
				if (CSS_LIKE.test(raw) && COLOUR_RE.test(raw)) res.composed++;
				continue;
			}
			if (lit.quote !== '`' && lit.text.length < 30) continue;
			if (!CSS_LIKE.test(lit.text)) continue;
			const id = `${parseInt(C.fnv1a32(lit.text), 16) >>> 0}:${lit.text.length}`;
			if (seen.has(id)) continue;
			seen.add(id);
			if (!looksLikeCss(lit.text)) continue;
			res.candidates++;
			if (!COLOUR_RE.test(lit.text)) continue;
			res.withColour++;
			if (keys.has(id)) {
				res.hits++;
				foundKeys.add(id);
			} else if (res.misses.length < 400) res.misses.push({ key: C.sheetKey(lit.text), bundle: f, sample: clip(lit.text, 90) });
		}
	}
	res.keysNotInBundles = [...keys].filter((k) => !foundKeys.has(k)).length;
	return res;
}

export async function buildReport(opts) {
	const target = path.resolve(opts.target);
	const staging = opts.staging ? path.resolve(opts.staging) : path.join(target, 'DarkModeKit', '.staging');
	const snapshot = opts.snapshot ? path.resolve(opts.snapshot) : path.join(target, 'DarkModeKit', '.snapshot');
	const P = C.stagingPaths(staging, target);
	const R = { generated: new Date().toISOString(), node: process.version, target, staging, snapshot, version: opts.version || null, sections: {} };
	if (!R.version) {
		try {
			const dv = await import('./detect-version.mjs');
			const d = dv.detect({ target });
			R.version = d && (d.version || d.anchorsName) ? `${d.version || '?'} (anchors ${d.anchorsName || '?'})` : null;
		} catch (e) {
			R.version = null;
		}
	}
	const covFile = path.join(staging, 'report', 'coverage-css.json');
	const cov = summariseCssCoverage(readJson(covFile));
	const overridesFile = opts.overrides ? path.resolve(opts.overrides) : P.overrides;
	const overridesCss = overridesFile && isFile(overridesFile) ? C.readTextNoBom(overridesFile).text : null;
	const dmTodo = overridesCss ? (overridesCss.match(/DM-TODO/g) || []).length : null;
	R.sections.unmapped = cov ? { source: covFile, ...cov, dmTodoComments: dmTodo } : { skipped: `no ${covFile} (G1 not run yet)`, dmTodoComments: dmTodo };
	if (overridesCss) {
		const idx = addJsStyleSources(indexSourceCss(target, snapshot), target, snapshot, overridesCss);
		const hand = new Set();
		const exc = readJson(path.join(C.KIT_DIR, 'exceptions', 'overrides.json'));
		for (const r of (exc && exc.rules) || []) {
			const cssText = typeof r === 'string' ? r : r.css || (r.selector ? r.selector + '{}' : '');
			const p = C.parseCss(cssText);
			C.walkRules(p.rules, (rule) => rule.type === 'qualified' && C.selectorsFromToks(cssText, rule.preludeToks).forEach((s) => hand.add(s)));
			if (r && r.selector) hand.add(r.selector);
		}
		const se = selectorExistence(overridesCss, idx, { handSelectors: hand });
		R.sections.selectors = { overrides: overridesFile, sourceCssFiles: idx.files.size, sourceCssBytes: idx.bytes, sourceParseErrors: idx.parseErrors, ...se, status: se.missing.length || se.unscoped ? 'FAIL' : 'PASS' };
	} else R.sections.selectors = { skipped: `no overrides.css (${overridesFile || 'staging'}): G1 not run yet; pass --overrides <css> for a synthetic run`, status: 'SKIPPED' };
	const icFile = path.join(staging, 'report', 'coverage-icons.json');
	const ic = summariseIconCoverage(readJson(icFile));
	R.sections.icons = ic ? { source: icFile, ...ic } : { skipped: `no ${icFile} (G2 not run yet)` };
	const listFile = opts.injectList ? path.resolve(opts.injectList) : path.join(C.KIT_DIR, 'lib', 'inject-entrypoints.mjs');
	const list = extractTargetsFrom(listFile);
	if (list) {
		const extra = ['OAuthServer/wwwroot/css/login.min.css', 'OAuthServer/wwwroot/css/login.css'].filter((x) => !list.includes(x));
		R.sections.injection = { source: listFile, ...injectionStatus(target, list.concat(extra)) };
	} else R.sections.injection = { skipped: `no TARGETS list in ${listFile} (P1 not run yet); pass --inject-list <v1 inject-entrypoints.mjs>` };
	if (P.sheets && isFile(P.sheets)) {
		const sheets = C.readJsonFile(P.sheets);
		const size = fs.statSync(P.sheets).size;
		const edits = Object.values(sheets).reduce((a, e) => a + (Array.isArray(e) ? e.length : 0), 0);
		R.sections.sheets = { file: P.sheets, bytes: size, keys: Object.keys(sheets).length, edits, estimate: sheetsEstimate(target, sheets) };
	} else R.sections.sheets = { skipped: 'no data/sheets.json (G1 not run yet)', estimate: sheetsEstimate(target, {}) };
	let anchors = HOOK_ANCHORS;
	if (opts.hookAnchors) {
		const extra = C.readJsonFile(path.resolve(opts.hookAnchors));
		const byId = new Map(anchors.map((a) => [a.id, a]));
		for (const a of Array.isArray(extra) ? extra : extra.anchors || []) byId.set(a.id, a);
		anchors = [...byId.values()];
	}
	const ha = hookAnchors(target, anchors);
	R.sections.hooks = { ...ha, status: ha.anchors.some((a) => a.status === 'FAIL') ? 'FAIL' : 'PASS' };
	R.ok = R.sections.selectors.status !== 'FAIL' && R.sections.hooks.status !== 'FAIL';
	return R;
}

export function renderMarkdown(R) {
	const L = [];
	const S = R.sections;
	L.push('# KIT-COVERAGE');
	L.push('');
	L.push(`Generated ${R.generated} by \`DarkModeKit/lib/report.mjs\` (node ${R.node}).`);
	L.push('');
	L.push(`- target: \`${R.target}\`${R.version ? ` (version ${R.version})` : ''}`);
	L.push(`- staging: \`${R.staging}\``);
	L.push('');
	L.push('| Section | Result |');
	L.push('|---|---|');
	const u = S.unmapped;
	const uCount = u && u.perFile ? Object.values(u.perFile).reduce((a, e) => a + e.count, 0) : null;
	L.push(`| 1. Unmapped literals (DM-TODO) | ${u.skipped ? 'SKIPPED: ' + mdEsc(u.skipped) : `${uCount} in ${Object.keys(u.perFile).length} files`}${u.dmTodoComments != null ? `; ${u.dmTodoComments} DM-TODO comments in overrides.css` : ''} |`);
	const se = S.selectors;
	L.push(`| 2. Selectors exist in this version's CSS (static check i) | ${se.skipped ? 'SKIPPED: ' + mdEsc(se.skipped) : `**${se.status}**: ${se.inFile} in their file, ${se.elsewhere} elsewhere, ${se.missing.length} missing, ${se.exempt.root + se.exempt.inline + se.exempt.hand} exempt, of ${se.total}`} |`);
	const gapKinds = S.icons.gaps ? Object.entries(S.icons.gaps.reduce((a, g) => ((a[g.kind] = (a[g.kind] || 0) + 1), a), {})).map(([k, n]) => `${k} ${n}`).join(', ') : '';
	L.push(`| 3. Icon gaps | ${S.icons.skipped ? 'SKIPPED: ' + mdEsc(S.icons.skipped) : S.icons.gaps.length + ' gaps' + (gapKinds ? ` (${mdEsc(gapKinds)})` : '')} |`);
	const inj = S.injection;
	L.push(`| 4. Injection targets | ${inj.skipped ? 'SKIPPED: ' + mdEsc(inj.skipped) : `${inj.total} listed, ${inj.notFound.length} not found, ${inj.injected} injected, ${inj.notInjected.length} not injected`} |`);
	const sh = S.sheets;
	const est = sh.estimate;
	L.push(`| 5. sheets.json | ${sh.skipped ? 'SKIPPED: ' + mdEsc(sh.skipped) : `${(sh.bytes / 1024).toFixed(1)} KiB, ${sh.keys} keys, ${sh.edits} edits`}; estimate: ${est.hits}/${est.withColour} colour-bearing CSS strings mapped (${pct(est.hits, est.withColour)}) |`);
	const hk = S.hooks;
	L.push(`| 6. Hook anchors (static check ii) | **${hk.status}**: ${hk.anchors.filter((a) => a.status === 'PASS').length}/${hk.anchors.length} present; bundles ${hk.bundles.live} live / ${hk.bundles.dead} unreachable |`);
	L.push('');

	L.push('## 1. Unmapped literals per file (DM-TODO)');
	L.push('');
	if (u.skipped) L.push(`SKIPPED: ${u.skipped}`);
	else {
		L.push(`Source: \`${u.source}\` (top-level keys: ${u.topKeys.join(', ')}).`);
		L.push('');
		L.push('| File | Unmapped | Samples |');
		L.push('|---|---:|---|');
		for (const [f, e] of Object.entries(u.perFile).sort((a, b) => b[1].count - a[1].count)) L.push(`| \`${mdEsc(f)}\` | ${e.count} | ${e.samples.map((x) => '`' + mdEsc(clip(x, 60)) + '`').join(' ')} |`);
	}
	L.push('');
	L.push('## 2. Selectors');
	L.push('');
	if (u && !u.skipped && u.unmatched && u.unmatched.length) {
		L.push(`### G1 unmatched selectors (${u.unmatched.length})`);
		L.push('');
		u.unmatched.slice(0, 200).forEach((x) => L.push(`- \`${mdEsc(clip(x.selector || JSON.stringify(x), 140))}\`${x.file ? ' in `' + mdEsc(x.file) + '`' : ''}`));
		L.push('');
	}
	L.push('### Static check (i): every generated selector exists in the CSS it overrides');
	L.push('');
	if (se.skipped) L.push(`SKIPPED: ${se.skipped}`);
	else {
		L.push(`Override sheet: \`${se.overrides}\`. Source index: ${se.sourceCssFiles} CSS files (${(se.sourceCssBytes / 1048576).toFixed(1)} MiB; \`.min.css\` twins skipped; snapshot-first). Scope prefix stripped; both sides canonicalised (whitespace, attribute quotes, \`:before\`→\`::before\`).`);
		L.push('');
		L.push(`- in the file named by the section comment: ${se.inFile}`);
		L.push(`- elsewhere in this version's CSS: ${se.elsewhere}`);
		L.push(`- exempt: ${se.exempt.root} root (\`html\`/\`body\`), ${se.exempt.inline} inline-literal attribute selectors (R4 a), ${se.exempt.hand} hand rules (exceptions/overrides.json)`);
		L.push(`- not dark-scoped (see checks b/l): ${se.unscoped}`);
		L.push(`- **missing: ${se.missing.length}**`);
		L.push('');
		const pfRows = Object.entries(se.perFile).filter(([, e]) => e.missing);
		if (pfRows.length) {
			L.push('| Section (source file) | Selectors | Missing |');
			L.push('|---|---:|---:|');
			pfRows.sort((a, b) => b[1].missing - a[1].missing).forEach(([f, e]) => L.push(`| \`${mdEsc(f)}\` | ${e.total} | ${e.missing} |`));
			L.push('');
			L.push('<details><summary>Missing selectors (first 300)</summary>');
			L.push('');
			se.missing.slice(0, 300).forEach((m) => L.push(`- \`${mdEsc(clip(m.selector, 160))}\` (${mdEsc(m.section || 'no section')})`));
			L.push('');
			L.push('</details>');
		}
	}
	L.push('');
	L.push('## 3. Icon gaps');
	L.push('');
	if (S.icons.skipped) L.push(`SKIPPED: ${S.icons.skipped}`);
	else {
		L.push(`Source: \`${S.icons.source}\` (top-level keys: ${S.icons.topKeys.join(', ')}).`);
		L.push('');
		S.icons.gaps.slice(0, 300).forEach((g) => L.push(`- ${mdEsc(g.kind)}: \`${mdEsc(g.item)}\``));
	}
	L.push('');
	L.push('## 4. Injection targets');
	L.push('');
	if (inj.skipped) L.push(`SKIPPED: ${inj.skipped}`);
	else {
		L.push(`List: \`${inj.source}\` (+ OAuth login(.min).css).`);
		L.push('');
		L.push(`- not found in this version (${inj.notFound.length}): ${inj.notFound.map((x) => '`' + x + '`').join(', ') || 'none'}`);
		L.push(`- injected: ${inj.injected}; partial: ${inj.partial.map((x) => '`' + x + '`').join(', ') || 'none'}`);
		L.push(`- not injected (${inj.notInjected.length})${inj.injected ? '' : ' (injection has not run on this target)'}${inj.notInjected.length && inj.injected ? ': ' + inj.notInjected.map((x) => '`' + x + '`').join(', ') : ''}`);
	}
	L.push('');
	L.push('## 5. sheets.json');
	L.push('');
	if (sh.skipped) L.push(`SKIPPED: ${sh.skipped}`);
	else L.push(`\`${sh.file}\`: ${sh.bytes} bytes, ${sh.keys} keys, ${sh.edits} edits.`);
	L.push('');
	L.push(`Estimate over ${est.liveBundles} reachable bundles (${est.replaceSyncSites} \`.replaceSync(\` sites): ${est.candidates} distinct CSS-like string literals, ${est.withColour} with a colour literal, **${est.hits} keyed in sheets.json** (${pct(est.hits, est.withColour)}), ${est.withColour - est.hits} not keyed; ${est.composed} colour-bearing templates are composed with \`\${}\` (their runtime text cannot be keyed statically; H1 records them in \`__dm.misses\`). ${sh.skipped ? '' : `${est.keysNotInBundles} sheets.json keys match no static literal (composed at runtime, or stale).`}`);
	L.push('');
	L.push('Not every CSS-like literal reaches `replaceSync` (some are lit `css` parts or test strings), so this is an estimate; the runtime truth is `__dm.misses`.');
	if (est.misses.length) {
		L.push('');
		L.push('<details><summary>Unkeyed colour-bearing CSS strings (first 60)</summary>');
		L.push('');
		est.misses.slice(0, 60).forEach((m) => L.push(`- \`${m.key}\` ${m.bundle}: \`${mdEsc(m.sample)}\``));
		L.push('');
		L.push('</details>');
	}
	L.push('');
	L.push('## 6. Static check (ii): runtime hook anchors');
	L.push('');
	L.push(`Reachable bundles: ${hk.bundles.live} of ${hk.bundles.total} (unreachable: ${hk.bundles.deadList.join(', ') || 'none'}). Anchors never key on chunk names.`);
	L.push('');
	L.push('| Anchor | Hook | Where | Result | Detail |');
	L.push('|---|---|---|---|---|');
	for (const a of hk.anchors) L.push(`| \`${a.id}\` | ${mdEsc(a.hook)}${a.ref ? ' (' + mdEsc(a.ref) + ')' : ''} | ${a.where === 'file' ? '`' + a.file + '`' : 'bundles'} | ${a.status} | ${mdEsc(a.detail.join('; '))} |`);
	L.push('');
	return L.join('\n');
}

export function parseSha256sum(text) {
	const out = new Map();
	const bad = [];
	for (const [n, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const m = /^\\?([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
		if (!m) {
			bad.push(n + 1);
			continue;
		}
		out.set(m[2].replace(/\\/g, '/').replace(/^\.\//, ''), m[1].toLowerCase());
	}
	return { entries: out, bad };
}
export async function manifestVerify(beforeFile, root, { added = true, concurrency = 8, onProgress, ignore = [] } = {}) {
	const t0 = Date.now();
	const { entries, bad } = parseSha256sum(fs.readFileSync(beforeFile, 'utf8'));
	const res = { before: beforeFile, root, entries: entries.size, badLines: bad, matched: 0, changed: [], missing: [], added: [], bytes: 0 };
	const items = [...entries];
	let done = 0;
	await C.pool(items, concurrency, async ([rel, sha]) => {
		const p = absOf(root, rel);
		try {
			const st = fs.statSync(p);
			res.bytes += st.size;
			const h = await C.sha256File(p);
			if (h === sha) res.matched++;
			else res.changed.push(rel);
		} catch {
			res.missing.push(rel);
		}
		done++;
		if (onProgress && done % 2000 === 0) onProgress(done, items.length);
	});
	if (added) {
		const known = new Set([...entries.keys()].map((k) => k.toLowerCase()));
		for (const r of C.walk(root)) if (!known.has(r.toLowerCase())) res.added.push(r);
	}
	if (ignore && ignore.length) {
		res.ignored = [];
		for (const k of ['changed', 'missing', 'added'])
			res[k] = res[k].filter((r) => {
				if (!ignore.some((re) => re.test(r))) return true;
				res.ignored.push(`${k} ${r}`);
				return false;
			});
	}
	res.changed.sort();
	res.missing.sort();
	res.added.sort();
	res.ms = Date.now() - t0;
	res.identical = !res.changed.length && !res.missing.length && !res.added.length && !bad.length;
	return res;
}
export async function manifestWrite(outFile, root, { concurrency = 8 } = {}) {
	const files = C.walk(root).sort();
	const hashes = await C.pool(files, concurrency, (r) => C.sha256File(absOf(root, r)));
	fs.writeFileSync(outFile, files.map((r, i) => `${hashes[i]} *./${r}`).join('\n') + '\n');
	return files.length;
}

async function main() {
	const args = util.parseArgs();
	if (args.manifestVerify) {
		const before = args.manifestVerify;
		const root = args._[0];
		if (!before || before === true || !root) {
			console.error('usage: node lib/report.mjs --manifest-verify <before.txt> <root> [--json <out>] [--no-added] [--concurrency N]');
			process.exit(2);
		}
		const res = await manifestVerify(path.resolve(before), path.resolve(root), {
			added: !args.noAdded,
			concurrency: Number(args.concurrency) || 8,
			ignore: typeof args.ignore === 'string' ? args.ignore.split(',').map((x) => new RegExp(x, 'i')) : [],
			onProgress: args.quiet ? null : (d, n) => process.stderr.write(`  hashed ${d}/${n}\r`)
		});
		if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(res, null, 1) + '\n');
		console.log(`manifest-verify ${res.identical ? 'IDENTICAL' : 'DIFFERENT'}: ${res.entries} entries, ${res.matched} matched, ${res.changed.length} changed, ${res.missing.length} missing, ${res.added.length} added${res.badLines.length ? `, ${res.badLines.length} unparseable lines` : ''} (${(res.bytes / 1048576).toFixed(0)} MiB in ${(res.ms / 1000).toFixed(1)} s)`);
		for (const [k, arr] of [
			['changed', res.changed],
			['missing', res.missing],
			['added', res.added]
		])
				arr.slice(0, 50).forEach((r) => console.log(`  ${k.padEnd(7)} ./${r}`));
		(res.ignored || []).forEach((r) => console.log(`  ignored ${r} (--ignore)`));
		process.exit(res.identical ? 0 : 1);
	}
	if (args.manifestWrite) {
		const root = args._[0];
		if (!root) {
			console.error('usage: node lib/report.mjs --manifest-write <out.txt> <root>');
			process.exit(2);
		}
		const n = await manifestWrite(path.resolve(args.manifestWrite), path.resolve(root), { concurrency: Number(args.concurrency) || 8 });
		console.log(`manifest-write: ${n} files -> ${args.manifestWrite}`);
		return;
	}
	if (!args.target || !args.out) {
		console.error('usage: node lib/report.mjs --target <root> [--staging <dir>] [--snapshot <dir>] --out <dir> [--overrides <css>] [--hook-anchors <json>] [--inject-list <mjs>] [--strict]');
		process.exit(2);
	}
	const R = await buildReport({ target: args.target, staging: args.staging, snapshot: args.snapshot, overrides: args.overrides, hookAnchors: args.hookAnchors, injectList: args.injectList, version: args.version });
	const out = path.resolve(args.out);
	fs.mkdirSync(out, { recursive: true });
	const md = renderMarkdown(R);
	fs.writeFileSync(path.join(out, 'KIT-COVERAGE.md'), md + '\n');
	fs.writeFileSync(path.join(out, 'KIT-COVERAGE.json'), JSON.stringify(R, null, 1) + '\n');
	if (!args.quiet) console.log(md.split('\n').slice(0, 16).join('\n') + `\n\nwritten: ${path.join(out, 'KIT-COVERAGE.md')} (+ .json)`);
	process.exit(args.strict && !R.ok ? 1 : 0);
}

if (util.isMain(import.meta.url)) {
	main().catch((e) => {
		console.error(e && e.stack ? e.stack : e);
		process.exit(2);
	});
}
