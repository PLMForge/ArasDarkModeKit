import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLIENT_REL = 'Innovator/Client';

export const OUTPUT_DIRS = ['Innovator/Client/darkmode', 'Innovator/Client/images-dark', 'OAuthServer/wwwroot/css/darkmode'];

export function parseArgs(argv = process.argv.slice(2)) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) {
			out._.push(a);
			continue;
		}
		let key = a.slice(2);
		let value = true;
		const eq = key.indexOf('=');
		if (eq >= 0) {
			value = key.slice(eq + 1);
			key = key.slice(0, eq);
		} else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
			value = argv[++i];
		}
		out[key.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
	}
	return out;
}

export function requireArg(args, name) {
	const v = args[name];
	if (v === undefined || v === true || v === '') throw new Error(`missing required argument --${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`);
	return v;
}

let logStream = process.stdout;
export function setLogStream(which) {
	logStream = which === 'stderr' ? process.stderr : process.stdout;
}
export const logCounts = { warn: 0, error: 0 };
export function createLogger(tag) {
	const w = (level, msg) => logStream.write(`[${tag}] ${level ? level + ' ' : ''}${msg}\n`);
	return {
		info: (msg) => w('', msg),
		warn: (msg) => {
			logCounts.warn++;
			w('WARN', msg);
		},
		error: (msg) => {
			logCounts.error++;
			w('ERROR', msg);
		},
		debug: (msg) => {
			if (process.env.DM_DEBUG) w('debug', msg);
		}
	};
}
export const log = createLogger('dm');

export function toRel(p) {
	return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
export function relJoin(...parts) {
	return path.posix.join(...parts.map(toRel));
}
export function abs(root, rel) {
	return path.join(root, ...toRel(rel).split('/'));
}
export function defaultSnapshotDir(target) {
	return path.join(target, 'DarkModeKit', '.snapshot');
}
export function defaultStagingDir(target) {
	return path.join(target, 'DarkModeKit', '.staging');
}

export function isKitOutput(rel) {
	const r = path.posix.normalize(toRel(rel)).toLowerCase();
	return OUTPUT_DIRS.some((d) => r === d.toLowerCase() || r.startsWith(d.toLowerCase() + '/'));
}

let sources = null;
export function initSources({ target, snapshot }) {
	if (!target) throw new Error('initSources: target is required');
	sources = { target: path.resolve(target), snapshot: snapshot ? path.resolve(snapshot) : defaultSnapshotDir(target) };
	return sources;
}
export function resolveSource(rel, opts = sources) {
	if (!opts) throw new Error('resolveSource: call initSources({target, snapshot}) first');
	const r = path.posix.normalize(toRel(rel));
	if (r.startsWith('../') || path.isAbsolute(rel)) throw new Error(`resolveSource: rel must be install-relative: ${rel}`);
	if (isKitOutput(r)) throw new Error(`resolveSource: refusing to read the kit's own output (${r})`);
	if (opts.snapshot) {
		const s = abs(opts.snapshot, r);
		if (fs.existsSync(s)) return s;
	}
	return abs(opts.target, r);
}
export function readSource(rel, opts) {
	return fs.readFileSync(resolveSource(rel, opts));
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
export function splitBom(buf) {
	const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
	return { bom, body: bom ? buf.subarray(3) : buf };
}
export function readText(file) {
	const { bom, body } = splitBom(fs.readFileSync(file));
	const text = body.toString('utf8');
	return { text, bom, eol: detectEol(text) };
}
export function encodeText(text, bom) {
	const body = Buffer.from(text, 'utf8');
	return bom ? Buffer.concat([BOM, body]) : body;
}
export function detectEol(text) {
	const crlf = (text.match(/\r\n/g) || []).length;
	const lf = (text.match(/\n/g) || []).length - crlf;
	return crlf > 0 && crlf >= lf ? '\r\n' : '\n';
}

export function sha256(data) {
	return crypto.createHash('sha256').update(data).digest('hex');
}
export function shortHash(data) {
	return sha256(data).slice(0, 8);
}

export function mkdirp(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

export function writeIfChanged(file, bytes, { dryRun = false } = {}) {
	const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
	let cur = null;
	try {
		cur = fs.readFileSync(file);
	} catch {
		cur = null;
	}
	if (cur && cur.equals(buf)) return false;
	if (!dryRun) {
		mkdirp(path.dirname(file));
		fs.writeFileSync(file, buf);
	}
	return true;
}

export function writeJson(file, obj) {
	mkdirp(path.dirname(file));
	fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
}
export function readJson(file, fallback) {
	try {
		return JSON.parse(splitBom(fs.readFileSync(file)).body.toString('utf8'));
	} catch (e) {
		if (fallback !== undefined) return fallback;
		throw e;
	}
}

export function walkFiles(dir, { skipDirs = new Set() } = {}) {
	const out = [];
	const rec = (d, rel) => {
		let entries;
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (!skipDirs.has(r) && !skipDirs.has(e.name)) rec(path.join(d, e.name), r);
			} else if (e.isFile()) out.push(r);
		}
	};
	rec(dir, '');
	return out.sort();
}

export function fnv1a32(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return ('0000000' + h.toString(16)).slice(-8);
}
export function sheetKey(cssText) {
	return fnv1a32(cssText) + ':' + cssText.length;
}

export const MARK = {
	headBegin: '<!-- aras-darkmode:begin head -->',
	headEnd: '<!-- aras-darkmode:end head -->',
	cssBegin: '<!-- aras-darkmode:begin css -->',
	cssEnd: '<!-- aras-darkmode:end css -->',
	importBegin: '/* aras-darkmode:begin import */',
	importEnd: '/* aras-darkmode:end import */'
};
export const RE_KIT_HEAD = /\r?\n[ \t]*<!-- aras-darkmode:begin head -->[\s\S]*?<!-- aras-darkmode:end head -->/g;
export const RE_KIT_CSS = /<!-- aras-darkmode:begin css -->[\s\S]*?<!-- aras-darkmode:end css -->\r?\n[ \t]*/g;
export const RE_KIT_IMPORT = /\/\* aras-darkmode:begin import \*\/[\s\S]*?\/\* aras-darkmode:end import \*\/\r?\n/g;

export function hasKitMarkers(text) {
	return text.includes('aras-darkmode:begin');
}
export function stripKitBlocks(text) {
	return text.replace(RE_KIT_HEAD, '').replace(RE_KIT_CSS, '').replace(RE_KIT_IMPORT, '');
}

export const RE_V1_PRE = /\r?\n[ \t]*<!-- darkmode:begin pre-paint[\s\S]*?<!-- darkmode:end pre-paint -->/;
export const RE_V1_LEGACY = /<!-- darkmode:begin legacy[\s\S]*?<!-- darkmode:end legacy -->\r?\n[ \t]*/;
const RE_V1_LOGIN = /(\r?\n)?\/\* darkmode:begin login[\s\S]*?\/\* darkmode:end login \*\/(\r?\n)?/;

export function hasV1Reference(text) {
	return /darkmode:begin (pre-paint|legacy|login)|styles\/darkmode\/|javascript\/darkmode\/|dark ?mode \(B\d|aras-theme-change/.test(text);
}
export function stripV1Blocks(text) {
	let out = text.replace(RE_V1_PRE, '').replace(RE_V1_LEGACY, '');
	const m = RE_V1_LOGIN.exec(out);
	if (m) {
		const before = out.slice(0, m.index);
		const after = out.slice(m.index + m[0].length);
		const minified = !/\n/.test(before);
		out = before + (m[1] && !minified ? m[1] : '') + after;
	}
	return out;
}

export const RE_FOREIGN_BLOCK = /^[ \t]*(?:<!-- |\/\/ )(aras-(?!darkmode:)[a-z0-9-]+):begin (\S+)(?: -->)?\r?\n[\s\S]*?^[ \t]*(?:<!-- |\/\/ )\1:end \2(?: -->)?\r?\n/gm;
export function stripForeignBlocks(text) {
	return text.replace(RE_FOREIGN_BLOCK, '');
}

export function reconstructPristine(text) {
	return stripV1Blocks(stripKitBlocks(stripForeignBlocks(text)));
}

export function fail(logger, msg, code = 1) {
	logger.error(msg);
	process.exit(code);
}

export function isMain(importMetaUrl) {
	if (!process.argv[1]) return false;
	try {
		return path.resolve(fileURLToPath(importMetaUrl)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();
	} catch {
		return false;
	}
}
