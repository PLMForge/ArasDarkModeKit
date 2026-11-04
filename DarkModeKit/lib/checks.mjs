import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as util from './util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_DIR = path.resolve(HERE, '..');

const toRel = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const absOf = (root, rel) => path.join(root, ...toRel(rel).split('/'));
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
export function readTextNoBom(file) {
	const buf = fs.readFileSync(file);
	const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
	return { text: (bom ? buf.subarray(3) : buf).toString('utf8'), bom, buf };
}
export function readJsonFile(file) {
	return JSON.parse(readTextNoBom(file).text);
}
export function sha256Buf(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex');
}
export function sha256File(file) {
	return new Promise((resolve, reject) => {
		const h = crypto.createHash('sha256');
		const s = fs.createReadStream(file, { highWaterMark: 1 << 20 });
		s.on('error', reject);
		s.on('data', (d) => h.update(d));
		s.on('end', () => resolve(h.digest('hex')));
	});
}
export async function pool(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
	return out;
}
export function walk(dir, { skip = () => false } = {}) {
	const out = [];
	const rec = (d, rel) => {
		let ents;
		try {
			ents = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of ents) {
			const r = rel ? rel + '/' + e.name : e.name;
			if (skip(r, e)) continue;
			if (e.isDirectory()) rec(path.join(d, e.name), r);
			else if (e.isFile()) out.push(r);
		}
	};
	rec(dir, '');
	return out;
}
const lineCol = (text, off) => {
	let line = 1;
	let last = -1;
	for (let i = 0; i < off && i < text.length; i++) if (text.charCodeAt(i) === 10) {
		line++;
		last = i;
	}
	return `${line}:${off - last}`;
};
const clip = (s, n = 160) => {
	s = String(s).replace(/\s+/g, ' ');
	return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export const fnv1a32 = util.fnv1a32;
export const sheetKey = util.sheetKey;
export function parseSheetKey(key) {
	const m = /^([0-9a-fA-F]{1,8}):(\d+)$/.exec(key);
	return m ? { hash: parseInt(m[1], 16) >>> 0, length: Number(m[2]) } : null;
}
export function keyMatches(key, text) {
	const k = parseSheetKey(key);
	return !!k && k.length === text.length && k.hash === parseInt(fnv1a32(text), 16) >>> 0;
}

const isDigit = (c) => c >= 48 && c <= 57;
const isHex = (c) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isNameStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 0x80;
const isNameChar = (c) => isNameStart(c) || isDigit(c) || c === 45;
const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;

export function tokenizeCss(src) {
	const toks = [];
	const n = src.length;
	let i = 0;
	const cc = (k) => (k < n ? src.charCodeAt(k) : -1);
	const validEscape = (k) => cc(k) === 92 && cc(k + 1) !== 10 && cc(k + 1) !== 13 && cc(k + 1) !== 12 && k + 1 < n;
	const startsIdent = (k) => {
		const c = cc(k);
		if (c === 45) return isNameStart(cc(k + 1)) || cc(k + 1) === 45 || validEscape(k + 1);
		if (isNameStart(c)) return true;
		return validEscape(k);
	};
	const startsNumber = (k) => {
		const c = cc(k);
		if (c === 43 || c === 45) return isDigit(cc(k + 1)) || (cc(k + 1) === 46 && isDigit(cc(k + 2)));
		if (c === 46) return isDigit(cc(k + 1));
		return isDigit(c);
	};
	const consumeEscape = () => {
		if (isHex(cc(i))) {
			let k = 0;
			while (k < 6 && isHex(cc(i))) {
				i++;
				k++;
			}
			if (cc(i) === 13 && cc(i + 1) === 10) i += 2;
			else if (isWs(cc(i))) i++;
		} else if (i < n) i++;
	};
	const consumeName = () => {
		const s = i;
		for (;;) {
			const c = cc(i);
			if (isNameChar(c)) i++;
			else if (validEscape(i)) {
				i++;
				consumeEscape();
			} else break;
		}
		return src.slice(s, i);
	};
	const consumeNumber = () => {
		if (cc(i) === 43 || cc(i) === 45) i++;
		while (isDigit(cc(i))) i++;
		if (cc(i) === 46 && isDigit(cc(i + 1))) {
			i++;
			while (isDigit(cc(i))) i++;
		}
		if ((cc(i) === 101 || cc(i) === 69) && (isDigit(cc(i + 1)) || ((cc(i + 1) === 43 || cc(i + 1) === 45) && isDigit(cc(i + 2))))) {
			i += 2;
			while (isDigit(cc(i))) i++;
		}
	};
	while (i < n) {
		const s = i;
		const c = cc(i);
		if (c === 47 && cc(i + 1) === 42) {
			const e = src.indexOf('*/', i + 2);
			i = e < 0 ? n : e + 2;
			toks.push({ t: 'comment', s, e: i });
			continue;
		}
		if (isWs(c)) {
			while (isWs(cc(i))) i++;
			toks.push({ t: 'ws', s, e: i });
			continue;
		}
		if (c === 34 || c === 39) {
			i++;
			let bad = false;
			for (;;) {
				const d = cc(i);
				if (d === -1) break;
				if (d === c) {
					i++;
					break;
				}
				if (d === 10 || d === 13 || d === 12) {
					bad = true;
					break;
				}
				if (d === 92) {
					if (i + 1 >= n) {
						i++;
						continue;
					}
					const e2 = cc(i + 1);
					if (e2 === 10 || e2 === 12) i += 2;
					else if (e2 === 13) i += cc(i + 2) === 10 ? 3 : 2;
					else {
						i++;
						consumeEscape();
					}
					continue;
				}
				i++;
			}
			toks.push({ t: bad ? 'bad-string' : 'string', s, e: i });
			continue;
		}
		if (c === 35) {
			if (isNameChar(cc(i + 1)) || validEscape(i + 1)) {
				i++;
				consumeName();
				toks.push({ t: 'hash', s, e: i });
			} else {
				i++;
				toks.push({ t: 'delim', s, e: i });
			}
			continue;
		}
		if (startsNumber(i)) {
			consumeNumber();
			let t = 'number';
			if (cc(i) === 37) {
				i++;
				t = 'percentage';
			} else if (startsIdent(i)) {
				consumeName();
				t = 'dimension';
			}
			toks.push({ t, s, e: i });
			continue;
		}
		if (c === 60 && src.startsWith('<!--', i)) {
			i += 4;
			toks.push({ t: 'cdo', s, e: i });
			continue;
		}
		if (c === 45 && src.startsWith('-->', i)) {
			i += 3;
			toks.push({ t: 'cdc', s, e: i });
			continue;
		}
		if (startsIdent(i)) {
			const name = consumeName();
			if (cc(i) === 40) {
				i++;
				if (name.toLowerCase() === 'url') {
					let k = i;
					while (isWs(cc(k))) k++;
					if (cc(k) !== 34 && cc(k) !== 39) {
						i = k;
						let bad = false;
						for (;;) {
							const d = cc(i);
							if (d === -1) break;
							if (d === 41) {
								i++;
								break;
							}
							if (isWs(d)) {
								while (isWs(cc(i))) i++;
								if (cc(i) === 41) {
									i++;
									break;
								}
								if (cc(i) === -1) break;
								bad = true;
								continue;
							}
							if (d === 34 || d === 39 || d === 40) {
								bad = true;
								i++;
								continue;
							}
							if (d === 92) {
								if (validEscape(i)) {
									i++;
									consumeEscape();
								} else {
									bad = true;
									i++;
								}
								continue;
							}
							i++;
						}
						toks.push({ t: bad ? 'bad-url' : 'url', s, e: i });
						continue;
					}
				}
				toks.push({ t: 'function', s, e: i, name: name.toLowerCase() });
			} else toks.push({ t: 'ident', s, e: i });
			continue;
		}
		if (c === 64) {
			i++;
			if (startsIdent(i)) {
				const name = consumeName();
				toks.push({ t: 'at', s, e: i, name: name.toLowerCase() });
			} else toks.push({ t: 'delim', s, e: i });
			continue;
		}
		if (c === 92) {
			if (validEscape(i)) {
			}
			i++;
			toks.push({ t: 'delim', s, e: i });
			continue;
		}
		i++;
		const ch = String.fromCharCode(c);
		toks.push({ t: '{}()[]:;,'.includes(ch) ? ch : 'delim', s, e: i });
	}
	return toks;
}

const GROUP_AT = new Set(['media', 'supports', 'container', 'layer', 'document', '-moz-document', 'scope', 'starting-style']);
const KEYFRAMES_AT = new Set(['keyframes', '-webkit-keyframes', '-moz-keyframes', '-o-keyframes']);

export function parseCss(src) {
	const toks = tokenizeCss(src);
	const errors = [];
	let p = 0;
	const N = toks.length;
	const text = (a, b) => src.slice(a, b);
	const skipWs = () => {
		while (p < N && (toks[p].t === 'ws' || toks[p].t === 'comment')) p++;
	};
	const CLOSE = { '{': '}', '(': ')', '[': ']', function: ')' };
	const consumeComponent = () => {
		const t = toks[p];
		if (t.t === '{' || t.t === '(' || t.t === '[' || t.t === 'function') {
			const stack = [CLOSE[t.t]];
			p++;
			while (p < N && stack.length) {
				const u = toks[p];
				if (u.t === stack[stack.length - 1]) stack.pop();
				else if (u.t === '{' || u.t === '(' || u.t === '[' || u.t === 'function') stack.push(CLOSE[u.t]);
				p++;
			}
			if (stack.length) errors.push({ msg: 'unclosed block', at: t.s });
			return p < N || !stack.length ? toks[p - 1].e : src.length;
		}
		p++;
		return t.e;
	};
	const listRules = (nested, ctxName) => {
		const rules = [];
		while (p < N) {
			const t = toks[p];
			if (t.t === 'ws' || t.t === 'comment' || ((t.t === 'cdo' || t.t === 'cdc') && !nested)) {
				p++;
				continue;
			}
			if (t.t === '}') {
				if (nested) return rules;
				errors.push({ msg: 'unmatched "}" at top level', at: t.s });
				p++;
				continue;
			}
			if (t.t === 'at') rules.push(atRule());
			else {
				const r = qualifiedRule(nested, ctxName);
				if (r) rules.push(r);
			}
		}
		if (nested) errors.push({ msg: 'unclosed block (EOF)', at: src.length });
		return rules;
	};
	const atRule = () => {
		const t = toks[p++];
		const r = { type: 'at', name: t.name, s: t.s, e: t.e, prelude: '' };
		const ps = p;
		let pe = t.e;
		while (p < N) {
			const u = toks[p];
			if (u.t === ';') {
				r.prelude = text(toks[ps] ? toks[ps].s : t.e, u.s).trim();
				r.e = u.e;
				p++;
				return r;
			}
			if (u.t === '}') {
				r.prelude = text(toks[ps] ? toks[ps].s : t.e, u.s).trim();
				r.e = u.s;
				return r;
			}
			if (u.t === '{') {
				r.prelude = text(toks[ps] ? toks[ps].s : t.e, u.s).trim();
				p++;
				if (GROUP_AT.has(r.name) || KEYFRAMES_AT.has(r.name)) r.rules = listRules(true, r.name);
				else {
					const b = blockContents();
					r.decls = b.decls;
					if (b.rules.length) r.rules = b.rules;
				}
				if (p < N && toks[p].t === '}') {
					r.e = toks[p].e;
					p++;
				} else r.e = src.length;
				return r;
			}
			pe = consumeComponent();
		}
		r.prelude = text(toks[ps] ? toks[ps].s : t.e, pe).trim();
		r.e = src.length;
		return r;
	};
	const qualifiedRule = (nested, ctxName) => {
		const s = toks[p].s;
		const ps = p;
		while (p < N) {
			const u = toks[p];
			if (u.t === '{') {
				const preludeToks = toks.slice(ps, p);
				const r = { type: 'qualified', s, e: 0, prelude: text(s, u.s).trim(), preludeToks, decls: [], rules: [] };
				p++;
				const b = blockContents();
				r.decls = b.decls;
				r.rules = b.rules;
				if (p < N && toks[p].t === '}') {
					r.e = toks[p].e;
					p++;
				} else {
					r.e = src.length;
					errors.push({ msg: 'unclosed rule block (EOF)', at: s });
				}
				if (ctxName && KEYFRAMES_AT.has(ctxName)) r.keyframe = true;
				return r;
			}
			if (u.t === '}' && nested) {
				errors.push({ msg: 'qualified rule without block', at: s });
				return null;
			}
			consumeComponent();
		}
		errors.push({ msg: 'qualified rule without block (EOF): ' + clip(text(s, src.length), 60), at: s });
		return null;
	};
	const blockContents = () => {
		const decls = [];
		const rules = [];
		for (;;) {
			skipWs();
			if (p >= N) {
				errors.push({ msg: 'unclosed block (EOF)', at: src.length });
				return { decls, rules };
			}
			const t = toks[p];
			if (t.t === '}') return { decls, rules };
			if (t.t === ';') {
				p++;
				continue;
			}
			if (t.t === 'at') {
				rules.push(atRule());
				continue;
			}
			let q = p;
			const isCustom = t.t === 'ident' && src.startsWith('--', t.s);
			const ps = p;
			let sawColon = false;
			if (t.t === 'ident') {
				q = p + 1;
				while (q < N && (toks[q].t === 'ws' || toks[q].t === 'comment')) q++;
				sawColon = q < N && toks[q].t === ':';
			}
			if (isCustom && sawColon) {
				p = q + 1;
				const vs = p;
				while (p < N && toks[p].t !== ';' && toks[p].t !== '}') consumeComponent();
				decls.push(mkDecl(t, vs, p));
				continue;
			}
			let isRule = false;
			while (p < N) {
				const u = toks[p];
				if (u.t === ';' || u.t === '}') break;
				if (u.t === '{') {
					isRule = true;
					break;
				}
				consumeComponent();
			}
			if (isRule) {
				p = ps;
				const r = qualifiedRule(true);
				if (r) rules.push(r);
			} else if (sawColon) {
				decls.push(mkDecl(t, q + 1, p));
			} else {
				errors.push({ msg: 'invalid declaration: ' + clip(text(t.s, p < N ? toks[p].s : src.length), 60), at: t.s });
			}
		}
	};
	const mkDecl = (nameTok, vs, ve) => {
		let a = vs;
		let b = ve;
		while (a < b && (toks[a].t === 'ws' || toks[a].t === 'comment')) a++;
		while (b > a && (toks[b - 1].t === 'ws' || toks[b - 1].t === 'comment')) b--;
		let important = false;
		if (b - a >= 2 && toks[b - 1].t === 'ident' && src.slice(toks[b - 1].s, toks[b - 1].e).toLowerCase() === 'important') {
			let k = b - 2;
			while (k > a && (toks[k].t === 'ws' || toks[k].t === 'comment')) k--;
			if (toks[k].t === 'delim' && src[toks[k].s] === '!') {
				important = true;
				b = k;
				while (b > a && (toks[b - 1].t === 'ws' || toks[b - 1].t === 'comment')) b--;
			}
		}
		const vS = a < b ? toks[a].s : a < N ? toks[a].s : src.length;
		const vE = a < b ? toks[b - 1].e : vS;
		return {
			name: src.slice(nameTok.s, nameTok.e),
			value: src.slice(vS, vE),
			important,
			s: nameTok.s,
			e: ve < N ? toks[ve].s : src.length,
			vs: vS,
			ve: vE
		};
	};
	const rules = listRules(false);
	return { rules, errors, toks };
}

export function walkRules(rules, cb, anc = []) {
	for (const r of rules) {
		cb(r, anc);
		if (r.rules && r.rules.length) walkRules(r.rules, cb, anc.concat([r]));
	}
}

const SPACE_DROP_AFTER = new Set(['(', '[', ',', '>', '+', '~', '=']);
const SPACE_DROP_BEFORE = new Set([')', ']', ',', '>', '+', '~', '=']);
export function selectorsFromToks(src, toks) {
	const out = [];
	let cur = [];
	let depth = 0;
	for (const t of toks) {
		if (t.t === '(' || t.t === '[' || t.t === 'function') depth++;
		else if (t.t === ')' || t.t === ']') depth--;
		if (t.t === ',' && depth === 0) {
			out.push(cur);
			cur = [];
		} else cur.push(t);
	}
	out.push(cur);
	return out.map((ts) => canonSelector(src, ts)).filter((s) => s !== '');
}
export function canonSelector(src, toks) {
	const parts = [];
	let bracket = 0;
	let attrAfterOp = false;
	for (const t of toks) {
		if (t.t === 'comment') continue;
		if (t.t === 'ws') {
			if (bracket === 0) parts.push(' ');
			continue;
		}
		let s = src.slice(t.s, t.e);
		if (t.t === '[') {
			bracket++;
			attrAfterOp = false;
		} else if (t.t === ']') {
			bracket--;
			attrAfterOp = false;
		} else if (bracket > 0 && t.t === 'delim' && s === '=') attrAfterOp = true;
		else if (bracket > 0 && attrAfterOp && (t.t === 'string' || t.t === 'ident')) {
			s = '"' + (t.t === 'string' ? unescapeCssString(s.slice(1, -1)) : s) + '"';
			attrAfterOp = false;
		}
		parts.push(s);
	}
	const res = [];
	for (let k = 0; k < parts.length; k++) {
		const x = parts[k];
		if (x === ' ') {
			const prev = res[res.length - 1];
			const next = parts[k + 1];
			if (prev === undefined || next === undefined || next === ' ') continue;
			if (SPACE_DROP_AFTER.has(prev) || (prev && prev.endsWith('('))) continue;
			if (SPACE_DROP_BEFORE.has(next)) continue;
		}
		res.push(x);
	}
	return res
		.join('')
		.trim()
		.replace(/(^|[^:]):(before|after|first-line|first-letter)\b/gi, (m, a, b) => a + '::' + b.toLowerCase());
}
function unescapeCssString(s) {
	return s.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(\r\n|[\n\r\f])|(.))/g, (m, hex, nl, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : nl ? '' : ch));
}

const RE_DARK_SCOPE = /^(?::where\(html\[data-theme="dark"\]\)|html\[data-theme="dark"\])(?=$|[ >+~.:[#])/;
export function isDarkSelector(canon) {
	return RE_DARK_SCOPE.test(canon);
}
export function stripDarkScope(canon) {
	return canon.replace(RE_DARK_SCOPE, '').trim().replace(/^[>+~]\s*/, (m) => m);
}

export const DARK_RULE_V1_BUGGY = /(^|\n)[ \t]*((?:html\[data-theme=['"]?dark['"]?\][^,{]*,\s*)*html\[data-theme=['"]?dark['"]?\][^,{]*)\{[^}]*\}\n?/g;
export const DARK_RULE = /(?<=^|\n)[ \t]*((?:(?::where\()?html\[data-theme=['"]?dark['"]?\]\)?[^,{]*,\s*)*(?::where\()?html\[data-theme=['"]?dark['"]?\]\)?[^,{]*)\{[^}]*\}\n?/g;
const EMPTY_MEDIA = /(^|\n)[ \t]*@(?:media|supports)[^{]*\{\s*\}\n?/g;
export function dropDarkRulesRegex(css, { buggy = false } = {}) {
	let out = buggy ? css.replace(DARK_RULE_V1_BUGGY, '$1') : css.replace(DARK_RULE, '');
	for (let k = 0; k < 4; k++) out = out.replace(EMPTY_MEDIA, '$1');
	return out;
}
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const NAMED_HEX =
	'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';
export const NAMED = new Map(NAMED_HEX.split(',').map((x) => x.split(':')));
export const SYSTEM_COLOURS = new Set(
	'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow window windowframe windowtext'.split(' ')
);
export function parseColour(text) {
	const t = String(text).trim().toLowerCase();
	if (t === 'transparent') return { rgba: [0, 0, 0, 0] };
	if (NAMED.has(t)) return parseColour('#' + NAMED.get(t));
	if (SYSTEM_COLOURS.has(t)) return { system: t };
	if (t === 'currentcolor' || t === 'inherit' || t === 'initial' || t === 'unset' || t === 'revert') return { keyword: t };
	let m = /^#([0-9a-f]{3,8})$/.exec(t);
	if (m) {
		let h = m[1];
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
		if (h.length !== 6 && h.length !== 8) return null;
		const v = (k) => parseInt(h.slice(k, k + 2), 16);
		return { rgba: [v(0), v(2), v(4), h.length === 8 ? v(6) / 255 : 1] };
	}
	m = /^(rgba?|hsla?)\((.*)\)$/.exec(t);
	if (m) {
		let parts;
		if (m[2].includes(',')) parts = m[2].split(',').map((x) => x.trim());
		else {
			const [c, al] = m[2].split('/');
			parts = c.trim().split(/\s+/);
			if (al !== undefined) parts.push(al.trim());
		}
		if (parts.length < 3 || parts.length > 4) return null;
		const num = (x, scale) => (x.endsWith('%') ? (parseFloat(x) / 100) * scale : parseFloat(x));
		const a = parts[3] !== undefined ? num(parts[3], 1) : 1;
		let rgb;
		if (m[1].startsWith('rgb')) rgb = parts.slice(0, 3).map((x) => num(x, 255));
		else {
			const hh = ((parseFloat(parts[0]) % 360) + 360) % 360;
			const s = parseFloat(parts[1]) / 100;
			const l = parseFloat(parts[2]) / 100;
			const f = (k0) => {
				const k = (k0 + hh / 30) % 12;
				return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
			};
			rgb = [f(0), f(8), f(4)];
		}
		if ([...rgb, a].some((x) => Number.isNaN(x))) return null;
		return { rgba: [...rgb, a] };
	}
	return null;
}
export function sameColour(a, b) {
	if (!a || !b) return false;
	if (a.system || b.system) return a.system === b.system;
	if (a.keyword || b.keyword) return a.keyword === b.keyword;
	return a.rgba.slice(0, 3).every((v, k) => Math.abs(v - b.rgba[k]) <= 0.5) && Math.abs(a.rgba[3] - b.rgba[3]) <= 1 / 255 + 1e-9;
}

export function matchParen(s, openIdx) {
	let depth = 0;
	for (let k = openIdx; k < s.length; k++) {
		const c = s[k];
		if (c === '"' || c === "'") {
			k++;
			while (k < s.length && s[k] !== c) {
				if (s[k] === '\\') k++;
				k++;
			}
			continue;
		}
		if (c === '/' && s[k + 1] === '*') {
			const e = s.indexOf('*/', k + 2);
			k = e < 0 ? s.length : e + 1;
			continue;
		}
		if (c === '(') depth++;
		else if (c === ')') {
			depth--;
			if (depth === 0) return k;
		}
	}
	return -1;
}
function topLevelComma(s) {
	let depth = 0;
	for (let k = 0; k < s.length; k++) {
		const c = s[k];
		if (c === '"' || c === "'") {
			k++;
			while (k < s.length && s[k] !== c) {
				if (s[k] === '\\') k++;
				k++;
			}
			continue;
		}
		if (c === '(') depth++;
		else if (c === ')') depth--;
		else if (c === ',' && depth === 0) return k;
	}
	return -1;
}
const RE_DM_VAR = /var\(\s*(--dm-[A-Za-z0-9_-]+)/g;
export function findDmVars(s) {
	const out = [];
	RE_DM_VAR.lastIndex = 0;
	let m;
	while ((m = RE_DM_VAR.exec(s))) {
		const open = m.index + 3;
		const close = matchParen(s, open);
		if (close < 0) {
			out.push({ name: m[1], start: m.index, end: s.length, fallback: null, unclosed: true });
			continue;
		}
		const inner = s.slice(open + 1, close);
		const k = topLevelComma(inner);
		let fallback = null;
		if (k >= 0) {
			fallback = inner.slice(k + 1);
			if (fallback.startsWith(' ')) fallback = fallback.slice(1);
		}
		out.push({ name: m[1], start: m.index, end: close + 1, fallback });
	}
	return out;
}
export function unwrapDmVars(s) {
	let out = '';
	let k = 0;
	RE_DM_VAR.lastIndex = 0;
	for (;;) {
		RE_DM_VAR.lastIndex = k;
		const m = RE_DM_VAR.exec(s);
		if (!m) break;
		const open = m.index + 3;
		const close = matchParen(s, open);
		if (close < 0) break;
		const inner = s.slice(open + 1, close);
		const c = topLevelComma(inner);
		out += s.slice(k, m.index);
		if (c < 0) out += s.slice(m.index, close + 1);
		else {
			let fb = inner.slice(c + 1);
			if (fb.startsWith(' ')) fb = fb.slice(1);
			out += unwrapDmVars(fb);
		}
		k = close + 1;
	}
	return out + s.slice(k);
}
const RE_LITERAL_NAME = /^--dm-(bg|text|border|shadow|fill|stroke|outline)-(.+)$/;

export function loadAnchors(file) {
	if (!file || !isFile(file)) return null;
	const a = readJsonFile(file);
	if (a.extends) {
		const base = path.join(path.dirname(file), a.extends);
		if (isFile(base)) {
			const b = readJsonFile(base);
			return { ...b, ...a, light: { ...(b.light || {}), ...(a.light || {}) }, rules: { ...(b.rules || {}), ...(a.rules || {}) }, tokens: { ...(b.tokens || {}), ...(a.tokens || {}) }, _file: file };
		}
	}
	return { ...a, _file: file };
}
export function legacyNames(anchorFiles) {
	const set = new Set(['--white', '--link', '--focus', '--red800', '--required-classic']);
	for (const f of anchorFiles) {
		let a;
		try {
			a = readJsonFile(f);
		} catch {
			continue;
		}
		const leg = a.tokens && a.tokens.legacy;
		if (Array.isArray(leg)) leg.forEach((x) => set.add(typeof x === 'string' ? x : x && x.name));
		else if (leg && typeof leg === 'object') Object.keys(leg).forEach((x) => set.add(x));
		(a.ramp || []).forEach((r) => Array.isArray(r) && set.add(r[0]));
		if (a.extends) Object.keys(a.rules || {}).forEach((x) => set.add(x));
		Object.keys(a.light || {}).forEach((x) => /^--(theme|neutral|blue|red|gray|grey)-?/.test(x) && set.add(x));
		Object.keys(a.shadows || {}).forEach((x) => set.add(x));
	}
	set.delete(undefined);
	return set;
}
const RE_LEGACY_PATTERN = /^--(gray\d+|neutral-[0-9a-f]+|theme-[\w-]+)$/;
export function isLegacyName(name, legacy) {
	return legacy.has(name) || RE_LEGACY_PATTERN.test(name);
}
function semanticLight(anchors, dmName) {
	if (!anchors) return undefined;
	const base = '--' + dmName.slice(5);
	if (anchors.light && anchors.light[base]) return anchors.light[base];
	for (const r of anchors.ramp || []) if (r[0] === base) return r[1];
	return undefined;
}

function decodeJsEscape(s, k, out, template) {
	const c = s[k];
	const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
	if (c === 'x' && /^[0-9a-fA-F]{2}$/.test(s.substr(k + 1, 2))) {
		out.push(String.fromCharCode(parseInt(s.substr(k + 1, 2), 16)));
		return k + 3;
	}
	if (c === 'u') {
		if (s[k + 1] === '{') {
			const e = s.indexOf('}', k + 2);
			out.push(String.fromCodePoint(parseInt(s.slice(k + 2, e), 16)));
			return e + 1;
		}
		out.push(String.fromCharCode(parseInt(s.substr(k + 1, 4), 16)));
		return k + 5;
	}
	if (c === '\r') return s[k + 1] === '\n' ? k + 2 : k + 1;
	if (c === '\n' || c === ' ' || c === ' ') return k + 1;
	if (c === '0' && /[0-9]/.test(s[k + 1] || '')) return -1;
	if (Object.prototype.hasOwnProperty.call(simple, c)) {
		out.push(simple[c]);
		return k + 1;
	}
	out.push(c);
	return k + 1;
}
export function* jsLiterals(src, { minLength = 0 } = {}) {
	const n = src.length;
	for (let i = 0; i < n; i++) {
		const q = src[i];
		if (q !== '`' && q !== '"' && q !== "'") continue;
		const out = [];
		let k = i + 1;
		let ok = true;
		let subst = false;
		while (k < n) {
			const c = src[k];
			if (c === q) break;
			if (c === '\\') {
				k = decodeJsEscape(src, k + 1, out, q === '`');
				if (k < 0) {
					ok = false;
					break;
				}
				continue;
			}
			if (q !== '`' && (c === '\n' || c === '\r')) {
				ok = false;
				break;
			}
			if (q === '`' && c === '$' && src[k + 1] === '{') subst = true;
			if (q === '`' && c === '\r') {
				out.push('\n');
				k += src[k + 1] === '\n' ? 2 : 1;
				continue;
			}
			out.push(c);
			k++;
		}
		if (k >= n || !ok) continue;
		const text = subst ? null : out.join('');
		if (subst || text.length >= minLength) yield { text, start: i, end: k + 1, quote: q, hasSubst: subst };
	}
}

export function reachableBundles(clientDir) {
	const dir = path.join(clientDir, 'jsBundles');
	let files;
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
	} catch {
		return { all: [], live: [], dead: [] };
	}
	const entries = files.filter((f) => !/^chunk-|Telemetry-/.test(f));
	const live = new Set();
	const q = [...entries];
	while (q.length) {
		const f = q.pop();
		if (live.has(f) || !files.includes(f)) continue;
		live.add(f);
		let t;
		try {
			t = fs.readFileSync(path.join(dir, f), 'utf8');
		} catch {
			continue;
		}
		for (const m of t.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) q.push(m[1]);
	}
	return { all: files, live: [...live].sort(), dead: files.filter((f) => !live.has(f)).sort(), dir };
}

export function recoverOriginals(target, wantedKeys) {
	const want = new Map();
	for (const k of wantedKeys) {
		const p = parseSheetKey(k);
		if (p) want.set(`${p.hash}:${p.length}`, k);
	}
	const lengths = new Set([...want.keys()].map((x) => Number(x.split(':')[1])));
	const found = {};
	const rb = reachableBundles(path.join(target, 'Innovator', 'Client'));
	for (const f of rb.live) {
		const src = fs.readFileSync(path.join(rb.dir, f), 'utf8');
		for (const lit of jsLiterals(src)) {
			if (lit.hasSubst || !lengths.has(lit.text.length)) continue;
			const id = `${parseInt(fnv1a32(lit.text), 16) >>> 0}:${lit.text.length}`;
			if (want.has(id) && found[want.get(id)] === undefined) found[want.get(id)] = lit.text;
		}
	}
	return { originals: found, bundles: rb.live.length };
}

function newCheck(id, title) {
	return { id, title, status: 'PENDING', fails: [], warns: [], infos: [], stats: {}, skipped: null };
}
function finish(c) {
	if (c.fails.length) c.status = 'FAIL';
	else if (c.skipped && !c.stats.checked) c.status = 'SKIPPED';
	else if (c.partial && c.partial.length) c.status = 'PARTIAL';
	else if (c.warns.length) c.status = 'WARN';
	else c.status = 'PASS';
	return c;
}
const cap = (arr, item, max = 400) => {
	if (arr.length < max) arr.push(item);
	else if (arr.length === max) arr.push('… (more suppressed)');
};

const CONFIG_REL = 'Innovator/Client/InnovatorClient.config';
const normFilesRevision = (t) => t.replace(/(filesRevision\s*=\s*")[^"]*(")/g, '$1#$2');

export function loadManifest(snapshotDir, target) {
	const f = snapshotDir && path.join(snapshotDir, 'manifest.json');
	if (!f || !isFile(f)) return null;
	const j = readJsonFile(f);
	const toMap = (src) => {
		const m = new Map();
		const add = (rel, v) => {
			if (!rel) return;
			const sha = typeof v === 'string' ? v : v && (v.sha256 || v.hash || v.sha);
			if (typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha)) m.set(toRel(rel), sha.toLowerCase());
		};
		if (Array.isArray(src)) src.forEach((e) => add(e.path || e.rel || e.file, e));
		else if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) add(k, v);
		return m;
	};
	const files = toMap(j.files || j.entries || (!j.vendor ? j : null));
	const vendor = j.vendor ? toMap(j.vendor) : files;
	const watch = Array.isArray(j.vendorWatch) ? j.vendorWatch.filter((w) => w && w.dir).map((w) => ({ dir: toRel(w.dir).replace(/\/$/, ''), filter: parseWatchFilter(w.filter), filterSrc: w.filter || null, exclude: (w.exclude || []).map(toRel) })) : null;
	let base = '';
	const sampleMap = vendor.size ? vendor : files;
	if (target && sampleMap.size) {
		const sample = [...sampleMap.keys()].slice(0, 25);
		const hitRoot = sample.filter((r) => exists(absOf(target, r))).length;
		const hitClient = sample.filter((r) => exists(absOf(path.join(target, 'Innovator', 'Client'), r))).length;
		if (hitClient > hitRoot) base = 'Innovator/Client/';
	}
	return { file: f, schema: j.schema || null, files, vendor, entries: files, watch, base };
}
export function parseWatchFilter(src) {
	if (!src || typeof src !== 'string') return null;
	const s = src.trim();
	if (/^\(\s*\w*\s*\)\s*=>\s*true$/.test(s)) return null;
	const m = /^\(?\s*(\w+)\s*\)?\s*=>\s*(!?)\s*\/((?:\\.|[^/\\])+)\/([gimsuy]*)\.test\(\s*\1\s*\)$/.exec(s);
	if (!m) return { unparsed: s };
	const re = new RegExp(m[3], m[4].replace('g', ''));
	return m[2] ? (r) => !re.test(r) : (r) => re.test(r);
}

export function snapshotFiles(snapshotDir) {
	if (!snapshotDir || !exists(snapshotDir)) return [];
	return walk(snapshotDir).filter((r) => r.includes('/'));
}

export function razorAtIssues(block) {
	const fails = [];
	const warns = [];
	const body = block.replace(/@@/g, '');
	for (const m of body.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) if (m[2].includes('@')) fails.push(`bare "@" inside a <${m[1].toLowerCase()}> body`);
	const outside = body.replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, '<$1$2>').replace(/@\(Url\.ContentWithSalt\("~\/[^"()]*"\)\)/g, '');
	if (outside.includes('@')) warns.push(`Razor "@" outside script/style bodies other than @(Url.ContentWithSalt("~/…")): ${clip(outside.slice(Math.max(0, outside.indexOf('@') - 30), outside.indexOf('@') + 40), 80)}`);
	return { fails, warns };
}

export function stripMarkers(text) {
	return util.stripKitBlocks(util.stripForeignBlocks(text));
}

export async function checkA({ target, snapshot, manifest, injectTargets = [] }) {
	const c = newCheck('a', 'Injected files minus marker blocks equal their snapshot; snapshot reproduces the shipped file');
	const snaps = snapshotFiles(snapshot);
	if (!snaps.length) {
		c.skipped = `no snapshot files under ${snapshot || '(none)'} (P1 snapshot.mjs not run yet)`;
		return finish(c);
	}
	const snapSet = new Set(snaps.map((r) => r.toLowerCase()));
	let checked = 0;
	for (const rel of snaps) {
		const sPath = absOf(snapshot, rel);
		const tPath = absOf(target, rel);
		const sBuf = fs.readFileSync(sPath);
		const mKey = manifest ? (manifest.base && rel.startsWith(manifest.base) ? rel.slice(manifest.base.length) : rel) : null;
		if (manifest && manifest.entries.has(mKey)) {
			if (sha256Buf(sBuf) !== manifest.entries.get(mKey)) c.fails.push(`${rel}: snapshot copy does not match the manifest hash (snapshot is not the shipped file)`);
		} else if (manifest) c.infos.push(`${rel}: not in manifest (snapshot integrity not verifiable)`);
		if (!isFile(tPath)) {
			c.fails.push(`${rel}: snapshotted but missing in target`);
			continue;
		}
		checked++;
		const tBuf = fs.readFileSync(tPath);
		if (tBuf.equals(sBuf)) continue;
		const bomS = sBuf[0] === 0xef && sBuf[1] === 0xbb && sBuf[2] === 0xbf;
		const bomT = tBuf[0] === 0xef && tBuf[1] === 0xbb && tBuf[2] === 0xbf;
		if (bomS !== bomT) {
			c.fails.push(`${rel}: BOM ${bomS ? 'removed' : 'added'} (edge case 18)`);
			continue;
		}
		const sText = sBuf.subarray(bomS ? 3 : 0).toString('utf8');
		const tText = tBuf.subarray(bomT ? 3 : 0).toString('utf8');
		let stripped = stripMarkers(tText);
		if (/aras-darkmode:(begin|end)/.test(stripped)) {
			c.fails.push(`${rel}: marker text left after stripping (unrecognised block shape) at ${lineCol(stripped, stripped.search(/aras-darkmode:(begin|end)/))}`);
			continue;
		}
		let a = sText;
		let b = stripped;
		const isConfig = rel.toLowerCase() === CONFIG_REL.toLowerCase();
		if (isConfig) {
			const rs = /filesRevision\s*=\s*"([^"]*)"/.exec(sText);
			const rt = /filesRevision\s*=\s*"([^"]*)"/.exec(tText);
			if (rs && rt && rs[1] !== rt[1]) c.infos.push(`${rel}: filesRevision ${rs[1]} -> ${rt[1]} (allowed)`);
			a = normFilesRevision(a);
			b = normFilesRevision(b);
		}
		if (a !== b) {
			let k = 0;
			while (k < a.length && a[k] === b[k]) k++;
			const crlf = /\r\n/.test(a) && a.replace(/\r\n/g, '') === b.replace(/\r\n|\n/g, '') ? ' (line endings changed: edge case 18)' : '';
			c.fails.push(`${rel}: differs from snapshot outside the marker blocks at ${lineCol(b, k)}${crlf}: snapshot ${JSON.stringify(a.slice(k, k + 60))} vs target ${JSON.stringify(b.slice(k, k + 60))}`);
		}
		if (/\.cshtml$/i.test(rel)) {
			for (const m of tText.matchAll(/<!-- aras-darkmode:begin (\w+) -->([\s\S]*?)<!-- aras-darkmode:end \1 -->/g)) {
				const r17 = razorAtIssues(m[2]);
				r17.fails.forEach((x) => c.fails.push(`${rel}: ${m[1]} block: ${x} (edge case 17)`));
				r17.warns.forEach((x) => c.warns.push(`${rel}: ${m[1]} block: ${x}`));
			}
		}
		const sCrlf = (sText.match(/\r\n/g) || []).length;
		const sLf = (sText.match(/\n/g) || []).length - sCrlf;
		const tCrlf = (tText.match(/\r\n/g) || []).length;
		const tLf = (tText.match(/\n/g) || []).length - tCrlf;
		if ((sLf === 0 && sCrlf > 0 && tLf > 0) || (sCrlf === 0 && sLf > 0 && tCrlf > 0)) c.fails.push(`${rel}: injection introduced ${sLf === 0 ? 'LF' : 'CRLF'} line breaks into a ${sLf === 0 ? 'CRLF' : 'LF'} file (edge case 18)`);
	}
	for (const rel of injectTargets) {
		if (snapSet.has(rel.toLowerCase())) continue;
		const tPath = absOf(target, rel);
		if (!isFile(tPath)) continue;
		const t = fs.readFileSync(tPath, 'utf8');
		if (util.hasKitMarkers(t)) c.fails.push(`${rel}: has kit markers but no snapshot copy (cannot prove pristine)`);
	}
	c.stats.checked = checked;
	c.stats.snapshotFiles = snaps.length;
	return finish(c);
}

const AT_FORBIDDEN = new Set(['import', 'font-face', 'namespace', 'property', 'page', 'counter-style', 'font-palette-values', 'font-feature-values', 'view-transition', 'color-profile']);
const AT_CONTAINER = new Set(['media', 'supports', 'container', 'starting-style', 'scope']);

export function analyseCss(css, opts) {
	const { file, strict = true, mediaDark = false, legacy = new Set() } = opts;
	const res = { fails: [], warns: [], infos: [], stats: { rules: 0, darkRules: 0, decls: 0, dmVars: 0 }, rules: [] };
	const sev = (msg) => (strict ? res.fails : res.warns).push(msg);
	const { rules, errors } = parseCss(css);
	for (const e of errors) res.fails.push(`${file}:${lineCol(css, e.at)}: CSS parse error: ${e.msg}`);
	let first = true;
	const visit = (list, ctx) => {
		for (const r of list) {
			const where = `${file}:${lineCol(css, r.s)}`;
			if (r.type === 'at') {
				const name = r.name;
				if (name === 'charset') {
					if (!first) res.warns.push(`${where}: @charset not first`);
				} else if (AT_FORBIDDEN.has(name)) {
					res.fails.push(`${where}: @${name} in kit CSS has effects in light mode (${clip(r.prelude, 80)})`);
				} else if (KEYFRAMES_AT.has(name)) {
					if (!/^["']?dm-/.test(r.prelude)) res.warns.push(`${where}: @${name} ${r.prelude}: global name may collide with a vendor animation (prefix it dm-)`);
				} else if (name === 'layer') {
					res.warns.push(`${where}: @layer changes cascade order of everything inside it (${clip(r.prelude, 60)})`);
					if (r.rules) visit(r.rules, ctx);
				} else if (AT_CONTAINER.has(name)) {
					const isDarkMedia = name === 'media' && mediaDark && /prefers-color-scheme\s*:\s*dark/i.test(r.prelude);
					if (r.rules) visit(r.rules, { ...ctx, dark: ctx.dark || isDarkMedia, media: [...ctx.media, '@' + name + ' ' + r.prelude] });
					if (r.decls && r.decls.length) res.fails.push(`${where}: declarations directly inside @${name}`);
				} else {
					res.warns.push(`${where}: unexpected at-rule @${name}`);
					if (r.rules) visit(r.rules, ctx);
				}
				first = false;
				continue;
			}
			first = false;
			if (r.keyframe) continue;
			res.stats.rules++;
			const sels = selectorsFromToks(css, r.preludeToks);
			const darkSel = sels.map((s) => isDarkSelector(s));
			const dark = ctx.dark || (sels.length > 0 && darkSel.every(Boolean));
			if (dark) res.stats.darkRules++;
			res.rules.push({ s: r.s, selectors: sels, dark, ctxDark: ctx.dark, media: ctx.media, decls: r.decls, file });
			if (!dark) {
				const bad = sels.filter((s, k) => !darkSel[k]);
				const rootish = bad.filter((s) => /^(:root|html)(?![\w-])/.test(s) || /^\*/.test(s));
				if (rootish.length) res.fails.push(`${where}: light-mode ${rootish[0].startsWith('*') ? 'universal' : ':root/html'} rule without the dark attribute: ${clip(rootish.join(', '), 120)}`);
				else sev(`${where}: selector not dark-scoped: ${clip(bad.join(', '), 160)}${ctx.media.length ? ' (inside ' + ctx.media.join(' > ') + ')' : ''}`);
			}
			for (const d of r.decls) {
				res.stats.decls++;
				const dn = d.name.toLowerCase();
				if (!dark) {
					if (dn.startsWith('--dm-')) res.fails.push(`${where}: ${d.name} defined outside dark`);
					else if (dn.startsWith('--') && isLegacyName(d.name, legacy)) res.fails.push(`${where}: legacy ${d.name} redefined outside dark (edge case 5)`);
					else if (dn.startsWith('--')) res.warns.push(`${where}: custom property ${d.name} defined outside dark`);
					if (dn === 'color-scheme') res.fails.push(`${where}: unscoped color-scheme: ${d.value}`);
					for (const v of findDmVars(d.value)) if (v.fallback === null) res.fails.push(`${where}: var(${v.name}) without fallback outside dark resolves to nothing in light`);
				}
			}
			if (r.rules && r.rules.length) visit(r.rules, { ...ctx, dark, media: ctx.media });
		}
	};
	visit(rules, { dark: false, media: [] });
	if (strict && !mediaDark) {
		const residue = stripCssComments(dropDarkRulesRegex(css)).replace(/@charset[^;]*;/g, '').trim();
		const unscoped = res.rules.filter((r) => !r.dark).length;
		res.stats.regexResidueChars = residue.length;
		if (residue && !unscoped && !res.fails.length) res.infos.push(`${file}: v1 regex strip leaves ${residue.length} chars (multi-line/nested shapes the regex cannot see; tokenizer verdict stands): ${clip(residue, 80)}`);
		if (!residue && unscoped) res.fails.push(`${file}: tokenizer found ${unscoped} unscoped rule(s) that the v1 regex missed`);
	}
	return res;
}

export function fallbackIssuesCss(css, file, anchors) {
	const fails = [];
	const warns = [];
	let checked = 0;
	const { rules } = parseCss(css);
	walkRules(rules, (r) => {
		for (const d of r.decls || []) {
			for (const v of findDmVars(d.value)) {
				if (v.fallback === null) continue;
				checked++;
				const issue = fallbackIssue(v.name, v.fallback, anchors);
				if (issue) (issue.hard ? fails : warns).push(`${file}:${lineCol(css, d.vs + v.start)}: ${d.name}: ${issue.msg}`);
			}
		}
	});
	return { fails, warns, checked };
}
export function fallbackIssue(name, fallback, anchors) {
	const fb = unwrapDmVars(fallback).trim();
	const m = RE_LITERAL_NAME.exec(name);
	if (m) {
		const id = m[2].toLowerCase();
		const want = /^[0-9a-f]{6}$|^[0-9a-f]{8}$/.test(id) ? parseColour('#' + id) : parseColour(id);
		if (!want) return null;
		const got = parseColour(fb);
		if (!got) return { hard: true, msg: `fallback "${clip(fb, 60)}" of ${name} is not a colour` };
		if (!sameColour(want, got)) return { hard: true, msg: `fallback "${fb}" != light literal ${id} named by ${name}` };
		return null;
	}
	const light = semanticLight(anchors, name);
	if (light !== undefined) {
		const want = parseColour(light);
		const got = parseColour(fb);
		if (want && got && !sameColour(want, got)) return { hard: false, msg: `fallback "${fb}" != anchors light value ${light} of ${name}` };
	}
	return null;
}

export function verifySheets(sheets, originals) {
	const fails = [];
	const warns = [];
	const stats = { keys: 0, edits: 0, verified: 0, noOriginal: 0, fallbacksChecked: 0 };
	const cfails = [];
	if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets)) {
		fails.push('sheets.json is not an object { key: edits[] }');
		return { fails, warns, stats, cfails };
	}
	for (const [key, edits] of Object.entries(sheets)) {
		stats.keys++;
		if (!parseSheetKey(key)) {
			fails.push(`${key}: malformed key (want <fnv1a32-hex>:<length>)`);
			continue;
		}
		if (!Array.isArray(edits)) {
			fails.push(`${key}: value is not an array`);
			continue;
		}
		stats.edits += edits.length;
		const orig = originals ? originals[key] : undefined;
		let prevEnd = -1;
		let shapeOk = true;
		for (const [k, e] of edits.entries()) {
			if (!Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || typeof e[2] !== 'string') {
				fails.push(`${key}#${k}: edit is not [start, end, "replacement"]`);
				shapeOk = false;
				continue;
			}
			const [s, en, rep] = e;
			if (s < 0 || en < s) {
				fails.push(`${key}#${k}: bad range [${s},${en})`);
				shapeOk = false;
			}
			if (s < prevEnd) {
				fails.push(`${key}#${k}: edits ${s < (edits[k - 1] || [0])[0] ? 'not sorted' : 'overlap'} ([${s},${en}) starts before previous end ${prevEnd})`);
				shapeOk = false;
			}
			prevEnd = Math.max(prevEnd, en);
			const vars = findDmVars(rep);
			if (!vars.length || vars[0].start !== 0 || vars[0].end !== rep.length) {
				fails.push(`${key}#${k}: replacement is not one var(--dm-…, X) wrapper: ${clip(rep, 100)}`);
				shapeOk = false;
				continue;
			}
			if (vars[0].fallback === null) {
				fails.push(`${key}#${k}: ${vars[0].name} has no fallback (light would break)`);
				shapeOk = false;
				continue;
			}
			if (orig !== undefined) {
				if (en > orig.length) {
					fails.push(`${key}#${k}: range [${s},${en}) beyond original length ${orig.length}`);
					shapeOk = false;
					continue;
				}
				const slice = orig.slice(s, en);
				const fbRaw = unwrapDmVars(vars[0].fallback);
				stats.fallbacksChecked++;
				if (fbRaw !== slice) cfails.push(`${key}#${k}: fallback ${JSON.stringify(clip(fbRaw, 60))} != original text at [${s},${en}) ${JSON.stringify(clip(slice, 60))}`);
			}
			const fi = fallbackIssue(vars[0].name, vars[0].fallback, null);
			if (fi) cfails.push(`${key}#${k}: ${fi.msg}`);
		}
		if (orig === undefined) {
			stats.noOriginal++;
			continue;
		}
		if (!keyMatches(key, orig)) {
			fails.push(`${key}: original text does not hash to its key (FNV-1a ${fnv1a32(orig)}:${orig.length})`);
			continue;
		}
		if (!shapeOk) continue;
		let rewritten = '';
		let pos = 0;
		for (const [s, en, rep] of edits) {
			rewritten += orig.slice(pos, s) + rep;
			pos = en;
		}
		rewritten += orig.slice(pos);
		const back = unwrapDmVars(rewritten);
		if (back !== orig) {
			let k = 0;
			while (k < back.length && back[k] === orig[k]) k++;
			fails.push(`${key}: unwrapping does not reproduce the original at ${k}: ${JSON.stringify(orig.slice(k, k + 40))} vs ${JSON.stringify(back.slice(k, k + 40))}`);
		} else stats.verified++;
	}
	return { fails, warns, stats, cfails };
}

export function stagingPaths(staging, target) {
	const S = (r) => (staging ? absOf(staging, r) : null);
	const T = (r) => (target ? absOf(target, r) : null);
	return {
		tokens: S('client/gen/tokens.css'),
		overrides: S('client/gen/overrides.css'),
		icons: S('client/gen/icons-dark.css'),
		darkStaging: S('client/dark.css'),
		bootStaging: S('client/dm-boot.js'),
		reportDarkStaging: S('client/report-dark.css'),
		login: S('oauth/login-dark.css'),
		sheets: S('data/sheets.json'),
		palette: S('data/palette.json'),
		iconsData: S('data/icons.json'),
		dataDir: S('data'),
		originals: S('report/sheets-originals.json'),
		darkTarget: T('Innovator/Client/darkmode/dark.css'),
		bootTarget: T('Innovator/Client/darkmode/dm-boot.js'),
		loginTarget: T('OAuthServer/wwwroot/css/darkmode/login-dark.css'),
		runtimeDark: path.join(KIT_DIR, 'hand', 'runtime-dark.css'),
		reportDark: path.join(KIT_DIR, 'hand', 'report-dark.css'),
		pdftronDark: path.join(KIT_DIR, 'hand', 'pdftron-dark.css')
	};
}

function cssTargets(P) {
	return [
		{ id: 'tokens.css', file: P.tokens, strict: true, gen: true },
		{ id: 'overrides.css', file: P.overrides, strict: true, gen: true },
		{ id: 'icons-dark.css', file: P.icons, strict: true, gen: true },
		{ id: 'hand/runtime-dark.css', file: P.runtimeDark, strict: true },
		{ id: 'staging client/dark.css', file: P.darkStaging, strict: true },
		{ id: 'target darkmode/dark.css', file: P.darkTarget, strict: true },
		{ id: 'hand/report-dark.css', file: P.reportDark, strict: false },
		{ id: 'hand/pdftron-dark.css', file: P.pdftronDark, strict: false },
		{ id: 'oauth/login-dark.css', file: P.login, strict: true, mediaDark: true },
		{ id: 'target css/darkmode/login-dark.css', file: P.loginTarget, strict: true, mediaDark: true }
	];
}

export function checkB({ target, staging, legacy, anchors, recover = true }) {
	const c = newCheck('b', 'sheets.json unwraps to the originals; generated CSS is dark-scoped; no --dm-*/legacy defined outside dark');
	const P = stagingPaths(staging, target);
	let checked = 0;
	const missingGen = [];
	for (const t of cssTargets(P)) {
		if (!t.file || !isFile(t.file)) {
			if (t.gen) missingGen.push(t.id);
			continue;
		}
		const css = readTextNoBom(t.file).text;
		const r = analyseCss(css, { file: t.id, strict: t.strict, mediaDark: t.mediaDark, legacy, anchors });
		r.fails.forEach((x) => cap(c.fails, x));
		r.warns.forEach((x) => cap(c.warns, x));
		r.infos.forEach((x) => cap(c.infos, x));
		c.stats[t.id] = r.stats;
		checked++;
	}
	if (missingGen.length) {
		c.partial = missingGen.slice();
		c.infos.push(`not produced yet (SKIPPED): ${missingGen.join(', ')}`);
	}
	if (P.sheets && isFile(P.sheets)) {
		const sheets = readJsonFile(P.sheets);
		let originals = null;
		let source = '';
		if (P.originals && isFile(P.originals)) {
			originals = readJsonFile(P.originals);
			source = 'report/sheets-originals.json (G1)';
		} else if (recover && target) {
			const r = recoverOriginals(target, Object.keys(sheets));
			originals = r.originals;
			source = `recovered from ${r.bundles} reachable bundles of --target (no report/sheets-originals.json)`;
		}
		const v = verifySheets(sheets, originals);
		v.fails.forEach((x) => cap(c.fails, x));
		v.warns.forEach((x) => cap(c.warns, x));
		c.stats.sheets = { ...v.stats, originalsSource: source || 'none' };
		c._sheetsC = v;
		if (v.stats.noOriginal) {
			const msg = `sheets.json: ${v.stats.noOriginal}/${v.stats.keys} keys have no original string (${source || 'no originals'}); their round trip is unverified`;
			if (v.stats.noOriginal === v.stats.keys) c.warns.push(msg + ' -> sheets part SKIPPED');
			else c.warns.push(msg);
		}
		checked++;
	} else {
		(c.partial = c.partial || []).push('data/sheets.json');
		c.infos.push('data/sheets.json not produced yet (SKIPPED)');
	}
	c.stats.checked = checked;
	if (!checked) c.skipped = 'no kit CSS or sheets.json found in staging/target';
	return finish(c);
}

export function checkC({ target, staging, anchors, sheetsResult }) {
	const c = newCheck('c', 'Every var(--dm-…, X) fallback equals the light literal at that position');
	const P = stagingPaths(staging, target);
	let checked = 0;
	for (const t of cssTargets(P)) {
		if (!t.file || !isFile(t.file)) continue;
		const r = fallbackIssuesCss(readTextNoBom(t.file).text, t.id, anchors);
		r.fails.forEach((x) => cap(c.fails, x));
		r.warns.forEach((x) => cap(c.warns, x));
		c.stats[t.id] = r.checked;
		checked += r.checked;
	}
	let v = sheetsResult;
	if (!v && P.sheets && isFile(P.sheets)) {
		const sheets = readJsonFile(P.sheets);
		const originals = P.originals && isFile(P.originals) ? readJsonFile(P.originals) : target ? recoverOriginals(target, Object.keys(sheets)).originals : null;
		v = verifySheets(sheets, originals);
	}
	if (v) {
		v.cfails.forEach((x) => cap(c.fails, x));
		c.stats.sheetsFallbacks = v.stats.fallbacksChecked;
		checked += v.stats.edits;
		if (v.stats.edits && !v.stats.fallbacksChecked) c.warns.push('sheets.json fallbacks not compared with originals (no originals available): only name-vs-fallback colour checked');
	}
	c.stats.checked = checked;
	if (!checked) c.skipped = 'no var(--dm-…) uses found (generators not run yet)';
	return finish(c);
}

export const VOLATILE = [
	/^Innovator\/Client\/jsBundles\/data\.json$/i,
	/^Innovator\/Client\/jsBundles\/compile\.log$/i,
	/^OAuthServer\/App_Data\//i,
	/^Innovator\/Server\/(logs|temp)\//i,
	/\.log$/i
];
export const KIT_OUTPUT = [/^Innovator\/Client\/darkmode\//i, /^Innovator\/Client\/images-dark\//i, /^OAuthServer\/wwwroot\/css\/darkmode\//i, /^DarkModeKit\//i, /^\.git\//i];

export async function checkD({ target, snapshot, manifest, walkNew = true, concurrency = 16 }) {
	const c = newCheck('d', 'Vendor files unchanged against the snapshot manifest (only marker injections + filesRevision)');
	if (!manifest) {
		c.skipped = `no ${snapshot ? path.join(snapshot, 'manifest.json') : '<snapshot>/manifest.json'} (P1 snapshot.mjs not run yet)`;
		return finish(c);
	}
	const injected = new Set(snapshotFiles(snapshot).map((r) => r.toLowerCase()));
	for (const r of manifest.files.keys()) injected.add((manifest.base + r).toLowerCase());
	const items = [...manifest.vendor.entries()];
	if (!items.length) {
		c.skipped = `${manifest.file} has no vendor hashes`;
		return finish(c);
	}
	let checked = 0;
	let changed = 0;
	const volatile = [];
	await pool(items, concurrency, async ([relM, sha]) => {
		const rel = manifest.base + relM;
		if (injected.has(rel.toLowerCase())) return;
		if (KIT_OUTPUT.some((re) => re.test(rel))) return;
		const p = absOf(target, rel);
		let h;
		try {
			h = await sha256File(p);
		} catch {
			if (VOLATILE.some((re) => re.test(rel))) volatile.push(`${rel} (missing)`);
			else cap(c.fails, `${rel}: vendor file missing`);
			return;
		}
		checked++;
		if (h !== sha) {
			if (VOLATILE.some((re) => re.test(rel))) volatile.push(rel);
			else {
				changed++;
				cap(c.fails, `${rel}: vendor file changed${/^Innovator\/Client\/jsBundles\//i.test(rel) ? ' (jsBundles: edge cases 14/15)' : ''}`);
			}
		}
	});
	if (volatile.length) c.infos.push(`volatile build files changed (not vendor edits): ${volatile.join(', ')}`);
	if (walkNew) {
		const known = new Set([...manifest.vendor.keys(), ...manifest.files.keys()].map((r) => (manifest.base + r).toLowerCase()));
		const candidates = [];
		if (manifest.watch && manifest.watch.length) {
			for (const wd of manifest.watch) {
				if (wd.filter && wd.filter.unparsed) c.warns.push(`vendorWatch ${wd.dir}: filter not understood (${clip(wd.filter.unparsed, 60)}); scanning all files`);
				const fn = typeof wd.filter === 'function' ? wd.filter : null;
				const ex = wd.exclude.map((x) => x.toLowerCase());
				for (const r of walk(absOf(target, wd.dir), { skip: (rr, e) => e.isDirectory() && ex.some((x) => rr.toLowerCase() === x || rr.toLowerCase().startsWith(x + '/')) })) {
					if (fn && !fn(r)) continue;
					candidates.push(wd.dir + '/' + r);
				}
			}
			c.stats.watchDirs = manifest.watch.length;
		} else {
			for (const d of new Set([...manifest.vendor.keys()].map((r) => path.posix.dirname(manifest.base + r)))) {
				let ents;
				try {
					ents = fs.readdirSync(absOf(target, d), { withFileTypes: true });
				} catch {
					continue;
				}
				for (const e of ents) if (e.isFile()) candidates.push(d === '.' ? e.name : d + '/' + e.name);
			}
		}
		let added = 0;
		for (const rel of candidates) {
			if (known.has(rel.toLowerCase()) || KIT_OUTPUT.some((re) => re.test(rel)) || VOLATILE.some((re) => re.test(rel))) continue;
			added++;
			const msg = `${rel}: new file in a vendor folder${/jsBundles\/chunk-/i.test(rel) ? ' (stale chunk from a rebuild? edge case 14)' : ''}`;
			if (/\.(js|mjs|ts|css|less|cshtml|html?|aspx|config|json|xml)$/i.test(rel)) cap(c.fails, msg);
			else cap(c.warns, msg);
		}
		c.stats.added = added;
	}
	c.stats.checked = checked;
	c.stats.changed = changed;
	c.stats.manifestEntries = manifest.vendor.size;
	return finish(c);
}

export function extractBootData(js) {
	const i = js.search(/(?:window|self|globalThis)\s*\.\s*__dmData\s*=/);
	if (i < 0) return null;
	const o = js.indexOf('{', i);
	if (o < 0) return null;
	let depth = 0;
	for (let k = o; k < js.length; k++) {
		const ch = js[k];
		if (ch === '"' || ch === "'" || ch === '`') {
			k++;
			while (k < js.length && js[k] !== ch) {
				if (js[k] === '\\') k++;
				k++;
			}
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return { text: js.slice(o, k + 1), start: o, end: k + 1 };
		}
	}
	return null;
}
function findVarInJson(obj, pathStr, out, skipTop) {
	if (typeof obj === 'string') {
		if (/var\s*\(/i.test(obj)) out.push(`${pathStr}: ${clip(obj, 100)}`);
	} else if (Array.isArray(obj)) obj.forEach((v, k) => findVarInJson(v, `${pathStr}[${k}]`, out));
	else if (obj && typeof obj === 'object')
		for (const [k, v] of Object.entries(obj)) {
			if (skipTop && skipTop.includes(k)) continue;
			if (/var\s*\(/i.test(k)) out.push(`${pathStr}.${k} (key)`);
			findVarInJson(v, `${pathStr}.${k}`, out);
		}
}
export function checkE({ target, staging }) {
	const c = newCheck('e', 'No var( in any JS/JSON data the kit emits (edge case 3)');
	const P = stagingPaths(staging, target);
	let checked = 0;
	if (P.dataDir && exists(P.dataDir)) {
		for (const f of walk(P.dataDir).filter((r) => r.endsWith('.json'))) {
			const j = readJsonFile(path.join(P.dataDir, f));
			const hits = [];
			if (f === 'sheets.json') {
				c.infos.push('data/sheets.json carries CSS by design (var() wrappers are its purpose); checked by b/c, not e');
				continue;
			}
			findVarInJson(j, 'data/' + f, hits);
			hits.forEach((h) => cap(c.fails, h));
			checked++;
		}
	}
	for (const [id, file] of [
		['staging client/dm-boot.js', P.bootStaging],
		['target darkmode/dm-boot.js', P.bootTarget]
	]) {
		if (!file || !isFile(file)) continue;
		const js = readTextNoBom(file).text;
		const d = extractBootData(js);
		if (!d) {
			c.fails.push(`${id}: no window.__dmData = {…} data section found`);
			continue;
		}
		let obj = null;
		try {
			obj = JSON.parse(d.text);
		} catch {
			obj = null;
		}
		const hits = [];
		if (obj) findVarInJson(obj, id + ' __dmData', hits, ['sheets']);
		else {
			const m = /["']?sheets["']?\s*:\s*\{/.exec(d.text);
			let t = d.text;
			if (m) {
				const o = m.index + m[0].length - 1;
				const e = extractBootData('window.__dmData=' + t.slice(o));
				if (e) t = t.slice(0, o) + '{}' + t.slice(o + e.text.length);
			}
			for (const mm of t.matchAll(/var\s*\(/g)) hits.push(`${id} __dmData (non-JSON) @${mm.index}: ${clip(t.slice(Math.max(0, mm.index - 40), mm.index + 40), 90)}`);
			c.warns.push(`${id}: data section is not plain JSON; scanned as text`);
		}
		hits.forEach((h) => cap(c.fails, h));
		checked++;
	}
	c.stats.checked = checked;
	if (!checked) c.skipped = 'no data/*.json or dm-boot.js yet';
	return finish(c);
}

export function checkIdempotence(input) {
	const c = newCheck('f', 'Idempotence: a second run writes 0 files; -DryRun lists 0 pending');
	let obj = input;
	if (typeof input === 'string') {
		if (!isFile(input)) {
			c.skipped = `idempotence log not found: ${input}`;
			return finish(c);
		}
		const t = readTextNoBom(input).text;
		try {
			obj = JSON.parse(t);
		} catch {
			obj = null;
			let n = 0;
			for (const m of t.matchAll(/\b(written|pending|wrote|changed|deleted)\b["']?\s*[:=]\s*(\d+)/gi)) {
				n++;
				const v = Number(m[2]);
				if (v) c.fails.push(`${m[1]} = ${v}`);
			}
			c.stats.checked = n;
			if (!n) c.skipped = 'no written/pending counts in the log';
			return finish(c);
		}
	}
	let n = 0;
	const visit = (o, p) => {
		if (!o || typeof o !== 'object') return;
		for (const [k, v] of Object.entries(o)) {
			if (/^(written|pending|wrote|changed|deleted)$/i.test(k)) {
				n++;
				const cnt = Array.isArray(v) ? v.length : typeof v === 'number' ? v : v && typeof v === 'object' ? Object.keys(v).length : 0;
				if (cnt) c.fails.push(`${p}${k} = ${cnt}${Array.isArray(v) ? ': ' + clip(v.join(', '), 200) : ''}`);
			} else visit(v, `${p}${k}.`);
		}
	};
	visit(obj, '');
	c.stats.checked = n;
	if (!n) c.skipped = 'no written/pending counts in the log';
	return finish(c);
}

export function checkLightIdentity({ target, staging, legacy }) {
	const c = newCheck('l', 'Light identity (static): nothing in the generated CSS can apply in light');
	const P = stagingPaths(staging, target);
	let checked = 0;
	for (const t of cssTargets(P)) {
		if (t.gen && (!t.file || !isFile(t.file))) (c.partial = c.partial || []).push(t.id);
		if (!t.file || !isFile(t.file) || !t.strict) continue;
		const css = readTextNoBom(t.file).text;
		const r = analyseCss(css, { file: t.id, strict: true, mediaDark: t.mediaDark, legacy });
		for (const f of r.fails) cap(c.fails, f);
		c.stats[t.id] = { rules: r.stats.rules, darkRules: r.stats.darkRules };
		checked++;
	}
	c.stats.checked = checked;
	if (!checked) c.skipped = 'no generated CSS yet';
	return finish(c);
}

export function injectTargets(target) {
	const p1 = path.join(KIT_DIR, 'lib', 'inject-entrypoints.mjs');
	const lists = [];
	const extract = (file, prefix) => {
		const src = fs.readFileSync(file, 'utf8');
		const m = /const\s+TARGETS\s*=\s*\[([\s\S]*?)\n\s*\];?/.exec(src);
		if (!m) return null;
		const out = [];
		for (const s of m[1].matchAll(/['"]([^'"\n]+\.(?:cshtml|html?|aspx|css))['"]/g)) out.push(prefix + toRel(s[1]));
		return out.length ? out : null;
	};
	if (isFile(p1)) {
		const l = extract(p1, '');
		if (l) lists.push({ source: 'lib/inject-entrypoints.mjs', list: l.map((r) => (/^(Innovator|OAuthServer)\//.test(r) ? r : 'Innovator/Client/' + r)) });
	}
	return lists[0] || null;
}

export async function runChecks(opts) {
	const target = opts.target ? path.resolve(opts.target) : null;
	const snapshot = opts.snapshot ? path.resolve(opts.snapshot) : target ? path.join(target, 'DarkModeKit', '.snapshot') : null;
	const staging = opts.staging ? path.resolve(opts.staging) : target ? path.join(target, 'DarkModeKit', '.staging') : null;
	const only = opts.only ? new Set(String(opts.only).split(',')) : null;
	const want = (id) => !only || only.has(id);
	const anchorDir = path.join(KIT_DIR, 'anchors');
	const anchorFiles = [...(exists(anchorDir) ? fs.readdirSync(anchorDir).filter((f) => f.endsWith('.json')).map((f) => path.join(anchorDir, f)) : []), ...(opts.anchors ? [path.resolve(opts.anchors)] : [])];
	const legacy = legacyNames(anchorFiles);
	const anchors = opts.anchors ? loadAnchors(path.resolve(opts.anchors)) : null;
	const manifest = snapshot ? loadManifest(snapshot, target) : null;
	const it = injectTargets(target);
	const results = { target, snapshot, staging, anchors: anchors ? anchors._file : null, legacyNames: legacy.size, node: process.version, checks: {} };
	if (want('a')) results.checks.a = await checkA({ target, snapshot, manifest, injectTargets: it ? it.list : [] });
	let b = null;
	if (want('b') || want('c')) b = checkB({ target, staging, legacy, anchors, recover: opts.recover !== false });
	if (want('b')) results.checks.b = b;
	if (want('c')) results.checks.c = checkC({ target, staging, anchors, sheetsResult: b && b._sheetsC });
	if (b) delete b._sheetsC;
	if (want('d')) results.checks.d = await checkD({ target, snapshot, manifest, walkNew: opts.walkNew !== false });
	if (want('e')) results.checks.e = checkE({ target, staging });
	if (want('f') || opts.idempotence) {
		results.checks.f = opts.idempotence ? checkIdempotence(path.resolve(opts.idempotence)) : finish(Object.assign(newCheck('f', 'Idempotence'), { skipped: 'run with --idempotence <second-run log> (apply-darkmode.ps1 second run)' }));
	}
	if (want('l')) results.checks.l = checkLightIdentity({ target, staging, legacy });
	results.ok = !Object.values(results.checks).some((c) => c.status === 'FAIL');
	return results;
}

export function formatResults(results, { verbose = false, max = 25 } = {}) {
	const lines = [];
	lines.push(`DarkModeKit checks  (node ${results.node})`);
	lines.push(`  target   ${results.target}`);
	lines.push(`  snapshot ${results.snapshot}`);
	lines.push(`  staging  ${results.staging}`);
	for (const c of Object.values(results.checks)) {
		const st = Object.entries(c.stats || {})
			.filter(([, v]) => typeof v === 'number')
			.map(([k, v]) => `${k}=${v}`)
			.join(' ');
		lines.push(`\n== (${c.id}) ${c.status.padEnd(7)} ${c.title}${st ? '  [' + st + ']' : ''}`);
		if (c.skipped && c.status === 'SKIPPED') lines.push(`   skipped: ${c.skipped}`);
		const show = (tag, arr) => {
			arr.slice(0, verbose ? arr.length : max).forEach((x) => lines.push(`   ${tag} ${x}`));
			if (!verbose && arr.length > max) lines.push(`   ${tag} … ${arr.length - max} more (--verbose / --json)`);
		};
		show('FAIL', c.fails);
		show('warn', c.warns);
		if (verbose || c.infos.length <= 5) show('info', c.infos);
	}
	lines.push(`\nRESULT: ${results.ok ? 'OK (no FAIL)' : 'FAIL'}`);
	return lines.join('\n');
}

async function main() {
	const args = util.parseArgs();
	if (args.help || (!args.target && !args.idempotence)) {
		console.log('usage: node lib/checks.mjs --target <root> [--snapshot <dir>] [--staging <dir>] [--anchors <file>] [--json <out>] [--only a,b,c,d,e,f,l] [--idempotence <log>] [--no-walk] [--verbose]');
		process.exit(args.help ? 0 : 2);
	}
	const results = await runChecks({
		target: args.target,
		snapshot: args.snapshot,
		staging: args.staging,
		anchors: args.anchors,
		only: args.only,
		idempotence: args.idempotence,
		walkNew: !args.noWalk
	});
	if (args.json) {
		fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
		fs.writeFileSync(path.resolve(args.json), JSON.stringify(results, null, 1) + '\n');
	}
	if (!args.quiet) console.log(formatResults(results, { verbose: !!args.verbose }));
	process.exit(results.ok ? 0 : 1);
}

if (util.isMain(import.meta.url)) {
	main().catch((e) => {
		console.error(e && e.stack ? e.stack : e);
		process.exit(2);
	});
}
