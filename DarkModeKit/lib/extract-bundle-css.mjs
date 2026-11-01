import fs from 'node:fs';
import { isMain as isMainModule } from './util.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function fnv1a32(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return ('0000000' + h.toString(16)).slice(-8);
}
export const sheetKey = (s) => fnv1a32(s) + ':' + s.length;

const CSS_PROP = /(^|[{;\s])(color|background(-color|-image)?|border(-[a-z-]+)?|display|margin|padding|width|height|font(-[a-z]+)?|fill|stroke|position|box-shadow|outline|cursor|flex|grid-[a-z-]+|opacity|transform|overflow|--[\w-]+)\s*:/;
export const looksCss = (s) =>
	s.length >= 12 && /[^{}]\{[^{}]*:[^{}]*\}/.test(s) && CSS_PROP.test(s) && !/\b(function|return|=>|var |const |let )/.test(s);

const TEXT_EXT = /\.(html?|cshtml|aspx|ascx|xml|config|js|ts|tsx|mjs)$/i;
const SKIP_DIRS = new Set(['jsBundles', 'nodejs', 'node_modules', 'images', 'images-dark', 'darkmode', 'WebHelp', 'vendors', 'customer']);

function walk(dir, rel, out) {
	let ents;
	try {
		ents = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of ents) {
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue;
			walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, out);
		} else if (TEXT_EXT.test(e.name)) out.push(path.join(dir, e.name));
	}
	return out;
}

export function findReachableBundles(clientDir) {
	const bdir = path.join(clientDir, 'jsBundles');
	let files = [];
	try {
		files = fs.readdirSync(bdir).filter((f) => /\.js$/i.test(f));
	} catch {
		return { live: [], dead: [], entries: [], referrers: {} };
	}
	const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
	const resolveName = (n) => {
		n = n.toLowerCase().replace(/[?#].*$/, '');
		return lower.get(n) || lower.get(n + '.js') || null;
	};
	const entries = new Set();
	const referrers = {};
	const RE = /jsbundles\/([\w.-]+)/gi;
	for (const f of walk(clientDir, '', [])) {
		let t;
		try {
			const st = fs.statSync(f);
			if (st.size > 8 << 20) continue;
			t = fs.readFileSync(f, 'latin1');
		} catch {
			continue;
		}
		if (!/jsbundles/i.test(t)) continue;
		for (const m of t.matchAll(RE)) {
			const b = resolveName(m[1]);
			if (!b) continue;
			entries.add(b);
			(referrers[b] = referrers[b] || new Set()).add(path.relative(clientDir, f).replace(/\\/g, '/'));
		}
	}
	const live = new Set();
	const q = [...entries];
	const IMP = /["'`]\.\/([\w.-]+\.js)["'`]/g;
	while (q.length) {
		const f = q.pop();
		if (live.has(f)) continue;
		live.add(f);
		let t;
		try {
			t = fs.readFileSync(path.join(bdir, f), 'utf8');
		} catch {
			continue;
		}
		for (const m of t.matchAll(IMP)) {
			const b = resolveName(m[1]);
			if (b && !live.has(b)) q.push(b);
		}
		for (const m of t.matchAll(RE)) {
			const b = resolveName(m[1]);
			if (b && !live.has(b)) q.push(b);
		}
	}
	return {
		live: [...live].sort(),
		dead: files.filter((f) => !live.has(f)).sort(),
		entries: [...entries].sort(),
		referrers: Object.fromEntries(Object.entries(referrers).map(([k, v]) => [k, [...v].sort().slice(0, 5)]))
	};
}

function loadSwc(clientDir) {
	const p = path.join(clientDir, 'nodejs', 'node_modules', '@swc', 'core');
	if (!fs.existsSync(p)) return null;
	try {
		const req = createRequire(pathToFileURL(path.join(clientDir, 'nodejs', 'package.json')).href);
		return req(p);
	} catch {
		return null;
	}
}
function swcStrings(swc, code) {
	let ast = null;
	for (const opts of [{ syntax: 'ecmascript', isModule: true }, { syntax: 'ecmascript', isModule: false }]) {
		try {
			ast = swc.parseSync(code, opts);
			break;
		} catch {
			ast = null;
		}
	}
	if (!ast) return null;
	const out = [];
	const stack = [ast];
	while (stack.length) {
		const n = stack.pop();
		if (!n || typeof n !== 'object') continue;
		if (Array.isArray(n)) {
			for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]);
			continue;
		}
		if (n.type === 'StringLiteral') {
			if (typeof n.value === 'string' && n.value.length >= 12 && looksCss(n.value)) out.push({ text: n.value, via: 'string' });
			continue;
		}
		if (n.type === 'TemplateLiteral' || n.type === 'Tpl') {
			const quasis = n.quasis || [];
			const exprs = n.expressions || n.exprs || [];
			const parts = quasis.map((x) => (x.cooked != null ? x.cooked : x.raw));
			const txt = parts.join('\u0000');
			if (looksCss(txt.replace(/\u0000/g, ' '))) {
				if (exprs.length) out.push({ text: parts.join('${…}'), via: 'template', dynamic: true });
				else out.push({ text: parts[0], via: 'template' });
			}
			for (const e of exprs) stack.push(e);
			continue;
		}
		for (const k in n) {
			if (k === 'span' || k === 'ctxt') continue;
			const v = n[k];
			if (v && typeof v === 'object') stack.push(v);
		}
	}
	return out;
}

function unescapeJs(body) {
	return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0-7]{1,3}|\r\n|[\s\S])/g, (m, e) => {
		if (e[0] === 'u') return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
		if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
		if (/^[0-7]+$/.test(e)) return e === '0' ? '\0' : String.fromCharCode(parseInt(e, 8));
		if (e === '\n' || e === '\r\n' || e === '\r') return '';
		return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' }[e] ?? e;
	});
}
function lexStrings(code) {
	const out = [];
	const RE = /"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'|`((?:[^`\\$]|\\[\s\S]|\$(?!\{))*)`/g;
	for (const m of code.matchAll(RE)) {
		const raw = m[1] ?? m[2] ?? m[3];
		if (raw == null || raw.length < 12) continue;
		const text = unescapeJs(raw);
		if (looksCss(text)) out.push({ text, via: m[3] != null ? 'template(lex)' : 'string(lex)' });
	}
	return out;
}

export function extractBundleCss({ target, log } = {}) {
	const clientDir = path.join(target, 'Innovator', 'Client');
	const reach = findReachableBundles(clientDir);
	const swc = loadSwc(clientDir);
	const engine = swc ? 'swc' : 'lexer';
	if (!swc && log) log.warn('@swc/core not found under nodejs/node_modules: using the lexer fallback');
	const byKey = new Map();
	const dynamic = [];
	const perBundle = {};
	for (const f of reach.live) {
		const code = fs.readFileSync(path.join(clientDir, 'jsBundles', f), 'utf8');
		let list = swc ? swcStrings(swc, code) : null;
		let eng = engine;
		if (!list) {
			list = lexStrings(code);
			eng = 'lexer';
		}
		perBundle[f] = { engine: eng, strings: 0 };
		for (const s of list) {
			if (s.dynamic) {
				dynamic.push({ bundle: f, sample: s.text.slice(0, 160) });
				continue;
			}
			const key = sheetKey(s.text);
			let e = byKey.get(key);
			if (!e) byKey.set(key, (e = { key, text: s.text, bundles: [], via: s.via }));
			if (!e.bundles.includes(f)) {
				e.bundles.push(f);
				perBundle[f].strings++;
			}
		}
	}
	const strings = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
	return { bundles: reach, strings, dynamic, engine, perBundle };
}

async function main() {
	const util = await import('./util.mjs');
	const args = util.parseArgs();
	const log = util.createLogger('extract-bundle-css');
	const t0 = Date.now();
	const res = extractBundleCss({ target: util.requireArg(args, 'target'), log });
	log.info(`engine ${res.engine}; bundles live ${res.bundles.live.length}, dead ${res.bundles.dead.length}; CSS strings ${res.strings.length}; dynamic ${res.dynamic.length}; ${Date.now() - t0} ms`);
	if (args.out) {
		const idx = { bundles: res.bundles, engine: res.engine, perBundle: res.perBundle, dynamic: res.dynamic, strings: res.strings.map((s) => ({ key: s.key, length: s.text.length, bundles: s.bundles, via: s.via, sample: s.text.slice(0, 120) })) };
		util.writeIfChanged(path.join(args.out, 'report', 'bundle-css.json'), JSON.stringify(idx, null, 1) + '\n');
	}
	if (args.dump) {
		fs.mkdirSync(args.dump, { recursive: true });
		for (const s of res.strings) fs.writeFileSync(path.join(args.dump, s.key.replace(':', '_') + '.css'), s.text);
	}
}
if (isMainModule(import.meta.url)) {
	main().catch((e) => {
		console.error(e && e.stack ? e.stack : e);
		process.exit(1);
	});
}
