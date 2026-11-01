#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
	parseArgs,
	requireArg,
	createLogger,
	readText,
	encodeText,
	shortHash,
	writeIfChanged,
	writeJson,
	readJson,
	walkFiles,
	stripKitBlocks,
	stripV1Blocks,
	hasKitMarkers,
	hasV1Reference,
	MARK,
	CLIENT_REL,
	defaultStagingDir,
	isMain
} from './util.mjs';

const log = createLogger('inject');

export const TARGETS = [
	'Index.cshtml',
	'scripts/nash.aspx.cshtml',
	'scripts/deepLinking.aspx.cshtml',
	'Modules/aras.innovator.core.ItemWindow/Views/Shared/_baseLayout.cshtml',
	'Modules/aras.innovator.core.Form/Views/FormInstance.cshtml',
	'Modules/aras.innovator.TDF/Views/Layouts/_baseViewLayout.cshtml',
	'Modules/aras.innovator.TDF/Views/SearchDialogFrameInLink.cshtml',
	'Modules/aras.innovator.AuthenticationFramework/Views/Shared/_CallbackLayout.cshtml',
	'SupportedBrowsers.html',
	'scripts/ClassStructureDialog.html',
	'scripts/ClipboardManager.html',
	'scripts/CodeEditor/MethodEditor.html',
	'scripts/ConfigurableGrid.html',
	'scripts/Dashboard.html',
	'scripts/FindAndReplaceDialog.html',
	'scripts/FormTool/canvas.html',
	'scripts/FormTool/fieldTools.html',
	'scripts/FormTool/formTabs.html',
	'scripts/FormTool/formtool.html',
	'scripts/HTMLEditorDialog.html',
	'scripts/ImageBrowser/externalImageViewerToolbar.html',
	'scripts/ImageBrowser/imageBrowser.html',
	'scripts/ImageBrowser/imageTreeViewer.html',
	'scripts/ImageBrowser/imageViewer.html',
	'scripts/ImageBrowser/imageViewerToolbar.html',
	'scripts/ImageBrowser/innovatorImageBrowser.html',
	'scripts/ImplementsGrid.html',
	'scripts/InBasket/InBasket-VoteDialog.html',
	'scripts/InBasket/InBasket.html',
	'scripts/InheritedServerEventsGrid.html',
	'scripts/Licensing/FeatureTree.html',
	'scripts/Licensing/LicManager.html',
	'scripts/Licensing/RequestActivationKey.html',
	'scripts/LifeCycle/lifecycleEditor.html',
	'scripts/LifeCycleDialog.html',
	'scripts/MassChange/default.htm',
	'scripts/ReportTool/UserInputDialog.html',
	'scripts/ReportTool/default.htm',
	'scripts/ReportTool/stylesheet.html',
	'scripts/ShowFormAsADialog.html',
	'scripts/ShowFormInFrame.html',
	'scripts/SitePreference/commonTabPage.html',
	'scripts/SitePreference/deletePreferencesDialog.html',
	'scripts/SitePreference/globalLayout.html',
	'scripts/SitePreference/gridLayout.html',
	'scripts/SitePreference/propSelectTree.html',
	'scripts/SitePreference/showColumnDialog.html',
	'scripts/StructureBrowser.html',
	'scripts/StructureBrowserFrame.html',
	'scripts/StructureToolbar.html',
	'scripts/UserNotification/ArasLatestReleaseProxy.html',
	'scripts/Workflow/workflowEditor.html',
	'scripts/Workflow/workflowRelationships.html',
	'scripts/WorkflowProcess/WflProcessReport.html',
	'scripts/WorkflowProcess/WflProcessViewer.html',
	'scripts/blank.html',
	'scripts/colorDialog.html',
	'scripts/configureEMail.html',
	'scripts/dirtyItemsList.html',
	'scripts/foreignPropSelectTree.html',
	'scripts/groupChgsDialog.html',
	'scripts/itemsGrid.html',
	'scripts/manageFileDialog.html',
	'scripts/modalDialog.html',
	'scripts/parametersGrid.html',
	'scripts/relationships.html',
	'scripts/relationshipsInfernoGrid.html',
	'scripts/revisionDialog.html',
	'scripts/searchDialog.html',
	'scripts/spinner.html',
	'scripts/textDialog.html',
	'scripts/waitPropertyStatusDialog.html',
	'scripts/whereUsed.html',
	'scripts/xClass.html',
	'Modules/aras.innovator.CMF/Views/CMFAdminRelationshipsGrid.html',
	'Modules/aras.innovator.CMF/Views/CopyPasteOptions.html',
	'Modules/aras.innovator.CMF/Views/DocumentEditor.html',
	'Modules/aras.innovator.DomainAccessControl/Views/RulesGridWrapper.html',
	'Modules/aras.innovator.ES/Views/GetLicense.html',
	'Modules/aras.innovator.ExtendedClassification/Views/xClassEditorGridWrapper.html',
	'Modules/aras.innovator.GraphView/Views/GraphViewInFrame.html',
	'Modules/aras.innovator.MacPolicy/Views/MacQueryBuilderEditor.html',
	'Modules/aras.innovator.QueryBuilder/Views/changeNameView.html',
	'Modules/aras.innovator.QueryBuilder/Views/conditionsView.html',
	'Modules/aras.innovator.QueryBuilder/Views/enterParametersForExecuteForm.html',
	'Modules/aras.innovator.QueryBuilder/Views/orderView.html',
	'Modules/aras.innovator.QueryBuilder/Views/propertiesView.html',
	'Modules/aras.innovator.QueryBuilder/html/toolbar.html',
	'Modules/aras.innovator.SSVC/Views/CreateForum.html',
	'Modules/aras.innovator.SSVC/Views/GetLicense.html',
	'Modules/aras.innovator.SSVC/Views/Identities.html',
	'Modules/aras.innovator.SSVC/Views/MyDiscussions.html',
	'Modules/aras.innovator.SSVC/Views/SelectForum.html',
	'Modules/aras.innovator.SSVC/Views/SelectShare.html',
	'Modules/aras.innovator.TDF/HtmlPages/toolbar.html',
	'Modules/aras.innovator.TreeGridView/Scripts/Configurator/TgvUsageDeactivation/deactivationForm.html',
	'Modules/aras.innovator.TreeGridView/Views/CreateGroupDialog.html',
	'Modules/aras.innovator.TreeGridView/Views/FilterViewer.html',
	'Modules/aras.innovator.TreeGridView/Views/MainPage.html',
	'Modules/aras.innovator.TreeGridView/html/iconTemplate.html',
	'Modules/aras.innovator.TreeGridView/html/saveCancelToolbar.html',
	'Modules/aras.innovator.Viewers/Views/AdvancedImageViewer.html',
	'Modules/aras.innovator.Viewers/Views/AdvancedImageXODViewer.html',
	'Modules/aras.innovator.Viewers/Views/ComparisonViewer.html',
	'Modules/aras.innovator.Viewers/Views/FlowHoopsViewer.html',
	'Modules/aras.innovator.Viewers/Views/PDFClientViewer.html',
	'Modules/aras.innovator.Viewers/Views/PDFXODViewer.html',
	'Modules/aras.innovator.Viewers/Views/SketchViewer.html',
	'Modules/aras.innovator.Viewers/Views/VCollabViewer.html',
	'Modules/aras.innovator.Viewers/Views/imageViewer.html',
	'Modules/aras.innovator.core.EffectivityServices/Views/EffectivityCriteriaDialog.html',
	'Modules/aras.innovator.core.EffectivityServices/Views/EffectivityDefinitionEditor.html',
	'Modules/aras.innovator.core.EffectivityServices/Views/EffectivityExpressionEditor.html',
	'Modules/aras.innovator.core.EffectivityServices/Views/EffectivityExpressionItemGrid.html',
	'Modules/aras.innovator.core.EffectivityServices/Views/informationMessageView.html',
	'Modules/formPreview/formPreview.html',
	'Solutions/PLM/scripts/SelectRelationship.html',
	'Solutions/PLM/scripts/TgvGrids/Tab.html'
];

export const OAUTH_TARGETS = ['OAuthServer/wwwroot/css/login.min.css', 'OAuthServer/wwwroot/css/login.css'];
export const CLIENT_CONFIG = 'Innovator/Client/InnovatorClient.config';

export function kitWrittenVendorFiles() {
	return [...TARGETS.map((t) => `${CLIENT_REL}/${t}`), CLIENT_CONFIG, ...OAUTH_TARGETS];
}

const EXCLUDE = [
	/^javascript\//,
	/\/ThirdParty\//,
	/\/3rdPartyLibs\//,
	/^Modules\/aras\.innovator\.core\.License\/Views\/LicenseForm\.cshtml$/,
	/^scripts\/include\/InitialSetupHeader\.cshtml$/,
	/^customer\/test_page\.html$/,
	/^darkmode\//,
	/^images-dark\//
];
const DISCOVER_SKIP_DIRS = new Set(['vendors', 'jsBundles', 'nodejs', 'WebHelp', 'docs', 'node_modules', 'temp', 'logs', 'bin', 'App_Data', 'BrowserCode']);

function mask(text) {
	const blank = (s) => s.replace(/[^\r\n]/g, ' ');
	return text
		.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, body, c) => a + blank(body) + c)
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/@\*[\s\S]*?\*@/g, blank);
}

function canUseSalt(rel, text) {
	if (!rel.endsWith('.cshtml')) return false;
	return rel.startsWith('Modules/') || /@using\s+Aras\.Client\b/.test(text);
}

function majorityPrefix(text, dir) {
	const depth = dir === '.' ? 0 : dir.split('/').length;
	const counts = new Map();
	for (const m of text.matchAll(/(?:src|href)\s*=\s*["']((?:\.\.\/)*)(?:javascript|styles|jsBundles|vendors|images)\//g)) {
		if (m[1].length / 3 < depth) continue;
		counts.set(m[1], (counts.get(m[1]) || 0) + 1);
	}
	let best = null;
	for (const [prefix, n] of counts) if (best === null || n > counts.get(best)) best = prefix;
	return best;
}

function relPrefix(fromDir) {
	const r = path.posix.relative(fromDir, '.');
	return r ? r + '/' : '';
}

export function analyse(rel, text) {
	const masked = mask(text);
	const head = /<head(?:\s[^>]*)?>/i.exec(masked);
	if (!head) return { error: 'no <head>' };
	const headOpenEnd = head.index + head[0].length;
	const closeRe = /<\/head\s*>/gi;
	closeRe.lastIndex = headOpenEnd;
	const close = closeRe.exec(masked);
	const headEnd = close ? close.index : masked.length;
	const headMasked = masked.slice(headOpenEnd, headEnd);

	const baseM = /<base\b[^>]*>/i.exec(headMasked);
	const baseIndex = baseM ? headOpenEnd + baseM.index : Infinity;
	let staticBaseHref = null;
	if (baseM) {
		const h = /href\s*=\s*["']([^"']*)["']/i.exec(text.slice(baseIndex, baseIndex + baseM[0].length));
		if (h) staticBaseHref = h[1];
	}
	const firstScript = /<script\b/i.exec(headMasked);
	const scriptIndex = firstScript ? headOpenEnd + firstScript.index : Infinity;

	let anchor = headOpenEnd;
	const charset = /<meta\b[^>]*charset[^>]*>/i.exec(headMasked);
	if (charset) {
		const ci = headOpenEnd + charset.index;
		if (ci < baseIndex && ci < scriptIndex) anchor = ci + charset[0].length;
	}

	const salt = canUseSalt(rel, text);
	const dir = path.posix.dirname(rel);
	let docPrefix = relPrefix(dir);
	let cssPrefix = docPrefix;
	if (!salt) {
		if (staticBaseHref !== null) {
			if (/^([a-z]+:)?\/\//i.test(staticBaseHref) || staticBaseHref.startsWith('/') || staticBaseHref.includes('@')) {
				return { error: `static <base href="${staticBaseHref}"> is not relative; add an override` };
			}
			const baseDir = path.posix.normalize(path.posix.join(dir, staticBaseHref.replace(/[^/]*$/, '') || '.'));
			cssPrefix = relPrefix(baseDir === '.' ? '' : baseDir.replace(/\/$/, ''));
		} else {
			const seen = majorityPrefix(text, dir);
			if (seen !== null) docPrefix = cssPrefix = seen;
		}
	}
	return { anchor, close: close ? close.index : -1, salt, docPrefix, cssPrefix, staticBaseHref };
}

function url(info, file, hash, which) {
	if (info.salt) return `@(Url.ContentWithSalt("~/darkmode/${file}"))?v=${hash}`;
	return `${which === 'css' ? info.cssPrefix : info.docPrefix}darkmode/${file}?v=${hash}`;
}

function lineIndentAfter(text, index) {
	const after = text.slice(index).match(/\r?\n([ \t]*)\S/);
	if (after) return after[1];
	const lineStart = text.lastIndexOf('\n', index - 1) + 1;
	return text.slice(lineStart).match(/^[ \t]*/)[0];
}
function indentBefore(text, index) {
	const lineStart = text.lastIndexOf('\n', index - 1) + 1;
	const prefix = text.slice(lineStart, index);
	return /^[ \t]*$/.test(prefix) ? prefix : null;
}
function eolOf(text) {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

export function injectHtml(rel, base, hashes) {
	const info = analyse(rel, base);
	if (info.error) return { error: info.error };
	const eol = eolOf(base);
	let out = base;
	if (info.close >= 0) {
		const pad = indentBefore(base, info.close) ?? '';
		const block = `${MARK.cssBegin}<link rel="stylesheet" href="${url(info, 'dark.css', hashes.css, 'css')}">${MARK.cssEnd}` + eol + pad;
		out = out.slice(0, info.close) + block + out.slice(info.close);
	}
	const ind = lineIndentAfter(base, info.anchor);
	const head = eol + ind + `${MARK.headBegin}<script src="${url(info, 'dm-boot.js', hashes.boot, 'head')}"></script>${MARK.headEnd}`;
	out = out.slice(0, info.anchor) + head + out.slice(info.anchor);
	if (stripKitBlocks(out) !== base) return { error: 'internal: strip would not be byte-exact' };
	if (rel.endsWith('.cshtml')) {
		for (const m of out.matchAll(/<!-- aras-darkmode:begin[\s\S]*?<!-- aras-darkmode:end[^>]*-->/g)) {
			for (const s of m[0].matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi)) if (s[2].includes('@')) return { error: 'bare @ inside an injected <script>/<style> body' };
		}
	}
	return { text: out, info, hasCss: info.close >= 0 };
}

export function injectLoginCss(base, hash) {
	const eol = eolOf(base);
	const out = `${MARK.importBegin}@import url("darkmode/login-dark.css?v=${hash}");${MARK.importEnd}` + eol + base;
	if (stripKitBlocks(out) !== base) return { error: 'internal: strip would not be byte-exact' };
	return { text: out };
}

export function modifyDateSources(clientDir) {
	try {
		const src = fs.readFileSync(path.join(clientDir, 'nodejs', 'jsCompileHelper.js'), 'utf8');
		const m = /modifyDateSources\s*=\s*\[([^\]]*)\]/.exec(src);
		if (m) {
			const list = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
			if (list.length) return list;
		}
	} catch {
	}
	return ['Modules', 'styles/less', 'Solutions'];
}
export function maxMtimeSec(dir) {
	let max = -Infinity;
	const rec = (d) => {
		let entries;
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const f = path.join(d, e.name);
			if (e.isDirectory()) rec(f);
			else {
				const t = (fs.statSync(f).mtimeMs / 1000) | 0;
				if (t > max) max = t;
			}
		}
	};
	rec(dir);
	return max;
}
export function bundleFreshness(clientDir) {
	const sources = modifyDateSources(clientDir);
	const recorded = readJson(path.join(clientDir, 'jsBundles', 'data.json'), {});
	const actual = {};
	for (const s of sources) {
		const m = maxMtimeSec(path.join(clientDir, ...s.split('/')));
		actual[s] = Number.isFinite(m) ? m : null;
	}
	return { sources, recorded, actual, fresh: sources.every((s) => recorded[s] === actual[s]) };
}

function fileHash(candidates) {
	for (const f of candidates) if (f && fs.existsSync(f)) return { hash: shortHash(fs.readFileSync(f)), from: f };
	return null;
}

export function run(args) {
	const target = path.resolve(requireArg(args, 'target'));
	const clientDir = path.join(target, ...CLIENT_REL.split('/'));
	const staging = args.staging ? path.resolve(args.staging) : defaultStagingDir(target);
	const dryRun = !!args.dryRun;
	const uninstall = !!args.uninstall;
	const verbose = !!args.verbose;
	const result = { mode: uninstall ? 'uninstall' : 'apply', dryRun, target, targets: TARGETS.length, found: 0, missing: [], changed: [], unchanged: 0, errors: [], written: 0, oauth: [], untargeted: [], bundleFreshness: null };

	if (args.discover) {
		const targets = new Set(TARGETS);
		for (const rel of walkFiles(clientDir, { skipDirs: DISCOVER_SKIP_DIRS }).filter((r) => /\.(html?|cshtml)$/i.test(r))) {
			if (targets.has(rel) || EXCLUDE.some((re) => re.test(rel)) || /^(vendors|jsBundles|nodejs|WebHelp|docs|node_modules|temp|logs|bin|App_Data|BrowserCode)\//.test(rel)) continue;
			const text = fs.readFileSync(path.join(clientDir, rel), 'utf8');
			if (!/<head[\s>]/i.test(mask(text))) continue;
			result.untargeted.push(rel);
			log.info(`untargeted document with <head>: ${rel}`);
		}
		log.info(result.untargeted.length ? `${result.untargeted.length} untargeted document(s)` : 'every document with a <head> is targeted or excluded');
		return result;
	}

	const hb = fileHash([path.join(staging, 'client', 'dm-boot.js'), path.join(clientDir, 'darkmode', 'dm-boot.js')]);
	const hc = fileHash([path.join(staging, 'client', 'dark.css'), path.join(clientDir, 'darkmode', 'dark.css')]);
	const hl = fileHash([path.join(staging, 'oauth', 'login-dark.css'), path.join(target, 'OAuthServer', 'wwwroot', 'css', 'darkmode', 'login-dark.css')]);
	if (!uninstall) {
		if (!hb) log.warn('dm-boot.js not found in staging or target; injecting with hash 00000000');
		if (!hc) log.warn('dark.css not found in staging or target; injecting with hash 00000000');
	}
	const hashes = { boot: hb ? hb.hash : '00000000', css: hc ? hc.hash : '00000000' };

	const sources = modifyDateSources(clientDir);
	const preMax = {};
	const touchedSources = new Set();
	const sourceOf = (rel) => sources.find((s) => rel.startsWith(s + '/'));
	let freshBefore = null;

	const writeFile = (file, rel, bytes) => {
		const src = sourceOf(rel);
		if (src && !(src in preMax)) {
			if (freshBefore === null) freshBefore = bundleFreshness(clientDir);
			preMax[src] = freshBefore.actual[src];
		}
		if (dryRun) return;
		const before = fs.statSync(file);
		fs.writeFileSync(file, bytes);
		if (src) {
			touchedSources.add(src);
			const max = preMax[src];
			if (Number.isFinite(max)) {
				let t = max * 1000 + 500;
				if (Math.abs(before.mtimeMs - t) < 1) t = max * 1000 + 250;
				fs.utimesSync(file, before.atime, new Date(t));
			}
		}
	};

	for (const t of TARGETS) {
		const rel = `${CLIENT_REL}/${t}`;
		const file = path.join(clientDir, ...t.split('/'));
		if (!fs.existsSync(file)) {
			result.missing.push(t);
			log.warn(`MISSING ${t}`);
			continue;
		}
		result.found++;
		const { text, bom } = readText(file);
		const hadKit = hasKitMarkers(text);
		const hadV1 = hasV1Reference(text);
		let next;
		if (uninstall) next = stripKitBlocks(text);
		else {
			const base = stripV1Blocks(stripKitBlocks(text));
			if (hasV1Reference(base)) {
				result.errors.push({ rel: t, error: 'v1 dark-mode reference outside v1 marker blocks' });
				log.error(`${t}: v1 dark-mode reference outside v1 marker blocks; fix by hand`);
				continue;
			}
			const r = injectHtml(t, base, hashes);
			if (r.error) {
				result.errors.push({ rel: t, error: r.error });
				log.error(`${t}: ${r.error}`);
				continue;
			}
			next = r.text;
			if (verbose) log.info(`  ${t}: ${r.info.salt ? 'ContentWithSalt' : `head=${r.info.docPrefix || './'} css=${r.info.cssPrefix || './'}`}${r.hasCss ? '' : ' (no </head>: head block only)'}`);
		}
		if (next === text) {
			result.unchanged++;
			continue;
		}
		const kind = uninstall ? 'removed' : hadKit ? 'updated' : hadV1 ? 'replaced-v1' : 'patched';
		writeFile(file, t, encodeText(next, bom));
		result.changed.push({ rel: t, kind });
		result.written++;
		log.info(`${dryRun ? 'would ' : ''}${kind.padEnd(11)} ${t}`);
	}

	const oauthDir = path.join(target, 'OAuthServer', 'wwwroot', 'css');
	if (!fs.existsSync(oauthDir)) log.warn('OAuthServer/wwwroot/css not found: login page not themed');
	else if (!uninstall && !hl) log.warn('login-dark.css not in staging or target (gen-login.mjs not run?): OAuth @import not injected');
	else {
		for (const rel of OAUTH_TARGETS) {
			const file = path.join(target, ...rel.split('/'));
			if (!fs.existsSync(file)) {
				result.missing.push(rel);
				log.warn(`MISSING ${rel}`);
				continue;
			}
			const { text, bom } = readText(file);
			let next;
			if (uninstall) next = stripKitBlocks(text);
			else {
				const base = stripV1Blocks(stripKitBlocks(text));
				const r = injectLoginCss(base, hl.hash);
				if (r.error) {
					result.errors.push({ rel, error: r.error });
					continue;
				}
				next = r.text;
			}
			if (next === text) {
				result.oauth.push({ rel, changed: false });
				continue;
			}
			if (!dryRun) writeIfChanged(file, encodeText(next, bom));
			result.oauth.push({ rel, changed: true });
			result.written++;
			log.info(`${dryRun ? 'would ' : ''}${uninstall ? 'remove import' : 'inject import'} ${rel}`);
		}
	}

	if (freshBefore) {
		const after = dryRun ? freshBefore : bundleFreshness(clientDir);
		result.bundleFreshness = { sources, recorded: freshBefore.recorded, before: freshBefore.actual, after: after.actual, freshBefore: freshBefore.fresh, freshAfter: after.fresh, touched: [...touchedSources] };
		for (const s of touchedSources) {
			if (after.actual[s] !== freshBefore.actual[s]) {
				result.errors.push({ rel: s, error: `max mtime of ${s} moved ${freshBefore.actual[s]} -> ${after.actual[s]}; jsBundles/data.json is now stale` });
				log.error(`edge case 15: max mtime of ${s} moved; Aras will recompile bundles on the next app start`);
			}
		}
		if (!freshBefore.fresh) log.warn(`jsBundles/data.json was already stale before injection (recorded ${JSON.stringify(freshBefore.recorded)}, actual ${JSON.stringify(freshBefore.actual)}): Aras will run build.js on the next app start regardless of the kit`);
		else log.info(`edge case 15: data.json ${after.fresh ? 'still fresh' : 'STALE'} after ${dryRun ? '(dry run)' : 'writes'} under ${[...new Set(Object.keys(preMax))].join(', ')}`);
	}

	log.info(`${result.mode}${dryRun ? ' (dry run)' : ''}: ${result.found}/${result.targets} entry points found, ${result.written} file(s) ${dryRun ? 'pending' : 'written'}, ${result.unchanged} unchanged, ${result.missing.length} missing, ${result.errors.length} error(s)`);
	return result;
}

if (isMain(import.meta.url)) {
	try {
		const args = parseArgs();
		const result = run(args);
		if (args.result) writeJson(path.resolve(args.result), result);
		if (result.errors.length) process.exit(1);
	} catch (e) {
		log.error(e.stack || e.message);
		process.exit(1);
	}
}
