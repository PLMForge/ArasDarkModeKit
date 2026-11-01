#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
	parseArgs,
	requireArg,
	createLogger,
	sha256,
	splitBom,
	encodeText,
	readJson,
	writeJson,
	walkFiles,
	hasKitMarkers,
	hasV1Reference,
	reconstructPristine,
	defaultSnapshotDir,
	mkdirp,
	isMain,
	abs
} from './util.mjs';
import { kitWrittenVendorFiles, CLIENT_CONFIG } from './inject-entrypoints.mjs';

const log = createLogger('snapshot');
export const SCHEMA = 'aras-darkmode-snapshot/1';

export const VENDOR_WATCH = [
	['Innovator/Client/jsBundles', () => true, []],
	['Innovator/Client/styles', () => true, ['darkmode']],
	['Innovator/Client/images', () => true, []],
	['Innovator/Client/Modules', (r) => /\.(css|less)$/i.test(r), []],
	['Innovator/Client/javascript', (r) => /\.css$/i.test(r), ['darkmode']],
	['OAuthServer/wwwroot/css', (r) => !/^login(\.min)?\.css$/i.test(r), ['darkmode']],
	['OAuthServer/wwwroot/images', () => true, []]
];

function normaliseForCompare(rel, text) {
	let t = reconstructPristine(text);
	if (rel === CLIENT_CONFIG) t = t.replace(/(<cachingModule\b[^>]*\bfilesRevision=")[^"]*(")/, '$1*$2');
	return t;
}

export function takeSnapshot({ target, snapshot, vendor = true }) {
	const manifestFile = path.join(snapshot, 'manifest.json');
	const manifest = readJson(manifestFile, null) || { schema: SCHEMA, created: new Date().toISOString(), target, files: {}, vendor: {} };
	manifest.files = manifest.files || {};
	manifest.vendor = manifest.vendor || {};
	const res = { snapshot, added: [], reconstructed: [], ok: 0, stale: [], errors: [], missing: [], vendorAdded: 0, vendorTotal: 0 };

	for (const rel of kitWrittenVendorFiles()) {
		const file = abs(target, rel);
		if (!fs.existsSync(file)) {
			res.missing.push(rel);
			continue;
		}
		const cur = fs.readFileSync(file);
		const { bom, body } = splitBom(cur);
		const text = body.toString('utf8');
		const snapFile = abs(snapshot, rel);
		const entry = manifest.files[rel];

		if (entry && fs.existsSync(snapFile)) {
			const snap = fs.readFileSync(snapFile);
			if (sha256(snap) !== entry.sha256) {
				res.errors.push({ rel, error: 'snapshot file does not match its manifest sha256 (edited by hand?)' });
				continue;
			}
			const snapText = splitBom(snap).body.toString('utf8');
			if (normaliseForCompare(rel, text) !== normaliseForCompare(rel, snapText)) res.stale.push(rel);
			else res.ok++;
			continue;
		}

		let bytes = cur;
		let source = 'pristine';
		if (hasKitMarkers(text) || hasV1Reference(text)) {
			const rebuilt = reconstructPristine(text);
			if (hasKitMarkers(rebuilt) || hasV1Reference(rebuilt)) {
				res.errors.push({ rel, error: 'carries dark-mode edits outside marker blocks; cannot reconstruct the pristine file (restore it from the vendor media)' });
				continue;
			}
			bytes = encodeText(rebuilt, bom);
			source = 'reconstructed';
			res.reconstructed.push(rel);
		}
		mkdirp(path.dirname(snapFile));
		fs.writeFileSync(snapFile, bytes);
		manifest.files[rel] = { sha256: sha256(bytes), size: bytes.length, source, at: new Date().toISOString() };
		res.added.push(rel);
	}

	if (vendor) {
		manifest.vendorWatch = VENDOR_WATCH.map(([dir, filter, excl]) => ({ dir, filter: filter.toString(), exclude: excl }));
		for (const [dir, filter, excl] of VENDOR_WATCH) {
			const root = abs(target, dir);
			for (const r of walkFiles(root)) {
				if (!filter(r) || excl.some((x) => r === x || r.startsWith(x + '/'))) continue;
				const rel = `${dir}/${r}`;
				res.vendorTotal++;
				if (manifest.vendor[rel]) continue;
				const b = fs.readFileSync(abs(root, r));
				manifest.vendor[rel] = { sha256: sha256(b), size: b.length };
				res.vendorAdded++;
			}
		}
	}
	manifest.updated = new Date().toISOString();
	writeJson(manifestFile, manifest);
	return res;
}

if (isMain(import.meta.url)) {
	try {
		const args = parseArgs();
		const target = path.resolve(requireArg(args, 'target'));
		const snapshot = args.snapshot ? path.resolve(args.snapshot) : defaultSnapshotDir(target);
		const res = takeSnapshot({ target, snapshot, vendor: !args.noVendor });
		if (args.verbose) for (const r of res.reconstructed) log.info(`reconstructed pristine ${r} (marker blocks stripped)`);
		for (const r of res.stale) log.error(`${r} differs from its snapshot beyond the kit's own edits: vendor update? Delete ${snapshot} and re-run to re-snapshot.`);
		for (const e of res.errors) log.error(`${e.rel}: ${e.error}`);
		log.info(`${snapshot}: ${res.added.length} added (${res.reconstructed.length} reconstructed), ${res.ok} already snapshotted, ${res.stale.length} stale, ${res.missing.length} not present in target; vendor hashes ${res.vendorAdded} added / ${res.vendorTotal} watched`);
		if (args.result) writeJson(path.resolve(args.result), res);
		if (res.errors.length || res.stale.length) process.exit(1);
	} catch (e) {
		log.error(e.stack || e.message);
		process.exit(1);
	}
}
