#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, requireArg, createLogger, setLogStream, KIT_DIR, writeJson, readJson, isMain } from './util.mjs';

setLogStream('stderr');
const log = createLogger('detect');

export const DLL_CANDIDATES = ['Innovator/Client/bin/Aras.Client.dll', 'Innovator/Client/bin/Aras.Client.exe', 'Innovator/Server/bin/Aras.Server.Core.dll', 'Innovator/Server/bin/InnovatorCore.dll'];

export function peFileVersion(file) {
	const buf = fs.readFileSync(file);
	const sig = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
	let i = buf.indexOf(sig);
	while (i >= 0) {
		if (i + 24 <= buf.length && buf.readUInt32LE(i + 4) === 0x00010000) {
			const ms = buf.readUInt32LE(i + 8);
			const ls = buf.readUInt32LE(i + 12);
			return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.');
		}
		i = buf.indexOf(sig, i + 4);
	}
	return null;
}

function globToRe(glob) {
	return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}
function nums(v) {
	return String(v)
		.split('.')
		.map((n) => parseInt(n, 10))
		.filter((n) => !Number.isNaN(n));
}
function distance(a, b) {
	const w = [1e12, 1e6, 1];
	let d = 0;
	for (let k = 0; k < 3; k++) d += Math.abs((a[k] || 0) - (b[k] || 0)) * w[k];
	return d;
}

export function pickAnchors(version, anchorsDir) {
	const files = fs.existsSync(anchorsDir) ? fs.readdirSync(anchorsDir).filter((f) => /\.json$/i.test(f) && !f.startsWith('_')) : [];
	const cands = files.map((f) => {
		let glob = null;
		try {
			glob = readJson(path.join(anchorsDir, f)).detect?.clientVersion || null;
		} catch {
		}
		const name = f.replace(/\.json$/i, '');
		if (!glob) glob = name + '.*';
		return { file: path.join(anchorsDir, f), name, glob };
	});
	const exact = cands.filter((c) => globToRe(c.glob).test(version)).sort((a, b) => b.glob.length - a.glob.length);
	if (exact.length) return { ...exact[0], nearest: false };
	if (!cands.length) return null;
	const v = nums(version);
	const best = cands.map((c) => ({ ...c, d: distance(v, nums(c.name)) })).sort((a, b) => a.d - b.d)[0];
	return { file: best.file, name: best.name, glob: best.glob, nearest: true };
}

export function detect({ target, kit = KIT_DIR, fileVersion }) {
	let version = null;
	let dll = null;
	let source = null;
	for (const rel of DLL_CANDIDATES) {
		const f = path.join(target, ...rel.split('/'));
		if (!fs.existsSync(f)) continue;
		try {
			const v = peFileVersion(f);
			if (v && v !== '0.0.0.0') {
				version = v;
				dll = rel;
				source = 'pe';
				break;
			}
		} catch (e) {
			log.warn(`${rel}: ${e.message}`);
		}
	}
	if (!version && fileVersion && fileVersion !== true) {
		version = String(fileVersion).trim();
		source = 'powershell';
		dll = DLL_CANDIDATES[0];
	}
	if (!version) throw new Error(`no Aras client version found under ${target} (looked for ${DLL_CANDIDATES.join(', ')})`);
	const pick = pickAnchors(version, path.join(kit, 'anchors'));
	if (!pick) throw new Error(`no anchors\\*.json in ${kit}`);
	if (pick.nearest) log.warn(`no anchors file matches ${version}; using the nearest, ${path.basename(pick.file)} (${pick.glob}). Review the result carefully.`);
	return { version, dll, source, anchors: pick.file, anchorsName: pick.name, nearest: pick.nearest };
}

if (isMain(import.meta.url)) {
	try {
		const args = parseArgs();
		const target = path.resolve(requireArg(args, 'target'));
		const res = detect({ target, kit: args.kit ? path.resolve(args.kit) : KIT_DIR, fileVersion: args.fileVersion });
		log.info(`Aras client ${res.version} (${res.dll}, ${res.source}) -> anchors ${path.basename(res.anchors)}${res.nearest ? ' (NEAREST)' : ''}`);
		if (args.result) writeJson(path.resolve(args.result), res);
		process.stdout.write(JSON.stringify(res) + '\n');
	} catch (e) {
		log.error(e.message);
		process.exit(1);
	}
}
