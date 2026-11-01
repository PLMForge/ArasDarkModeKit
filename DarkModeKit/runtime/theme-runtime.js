(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : null;
	if (!w || w.__dmThemeRuntime) {
		return;
	}
	w.__dmThemeRuntime = true;
	if (w.arasTheme && w.arasTheme.__darkmodeRuntime) {
		return;
	}

	var KEY = 'aras.colorScheme';
	var EVENT = 'aras-theme-change';
	var PREFERENCES = ['light', 'dark', 'system'];
	var dm = w.__dm || (w.__dm = { misses: [] });
	if (!dm.misses) {
		dm.misses = [];
	}
	function miss(reason, extra) {
		if (typeof dm.miss === 'function') {
			dm.miss('theme-runtime', reason, extra);
		} else {
			try {
				dm.misses.push({ hook: 'theme-runtime', reason: reason });
			} catch (e) {}
		}
	}

	var mql = dm.mql || null;
	if (!mql) {
		try {
			mql = w.matchMedia ? w.matchMedia('(prefers-color-scheme: dark)') : null;
		} catch (e) {}
	}

	function normalize(pref) {
		return PREFERENCES.indexOf(pref) === -1 ? 'light' : pref;
	}

	function readPreference() {
		if (typeof dm.preference === 'function') {
			try {
				return normalize(dm.preference());
			} catch (e) {}
		}
		try {
			return normalize(w.localStorage.getItem(KEY));
		} catch (e) {
			return 'light';
		}
	}

	function resolve(pref) {
		return pref === 'dark' || (pref === 'system' && mql && mql.matches)
			? 'dark'
			: 'light';
	}

	function current() {
		return resolve(readPreference());
	}

	function setRootTheme(root, theme) {
		var previous = root.getAttribute('data-theme');
		if (previous !== theme) {
			root.setAttribute('data-theme', theme);
		}
		if (theme === 'dark') {
			if (root.style.colorScheme !== 'dark') {
				root.style.colorScheme = 'dark';
			}
		} else if (root.style.colorScheme) {
			root.style.removeProperty('color-scheme');
			if (!root.getAttribute('style')) {
				root.removeAttribute('style');
			}
		}
		return previous !== theme;
	}

	function applyToWindow(win, theme) {
		var root;
		try {
			root = win.document && win.document.documentElement;
		} catch (e) {
			return false;
		}
		if (!root) {
			return false;
		}
		if (!setRootTheme(root, theme)) {
			return false;
		}
		try {
			var EventCtor = win.CustomEvent || CustomEvent;
			win.dispatchEvent(new EventCtor(EVENT, { detail: { theme: theme } }));
		} catch (e) {}
		return true;
	}

	function walk(win, theme, depth) {
		if (!win || depth > 32) {
			return;
		}
		applyToWindow(win, theme);
		var frames;
		try {
			frames = win.frames;
		} catch (e) {
			return;
		}
		var count = 0;
		try {
			count = frames.length;
		} catch (e) {}
		for (var i = 0; i < count; i++) {
			var child = null;
			try {
				child = frames[i];
			} catch (e) {}
			if (child && child !== win) {
				walk(child, theme, depth + 1);
			}
		}
	}

	function topmostWindow() {
		var win = w;
		try {
			while (win.parent && win.parent !== win) {
				void win.parent.document;
				win = win.parent;
			}
		} catch (e) {}
		return win;
	}

	var decorated = [];
	function rethemeDecorated(theme) {
		var keep = [];
		for (var i = 0; i < decorated.length; i++) {
			var doc = decorated[i];
			var win = null;
			try {
				win = doc.defaultView;
				if (!win || win.closed || !doc.documentElement) {
					continue;
				}
			} catch (e) {
				continue;
			}
			keep.push(doc);
			walk(win, theme, 0);
		}
		decorated = keep;
	}

	function propagate(theme) {
		walk(topmostWindow(), theme, 0);
		rethemeDecorated(theme);
	}

	function sync() {
		var theme = current();
		if (topmostWindow() === w) {
			walk(w, theme, 0);
		} else {
			applyToWindow(w, theme);
		}
		rethemeDecorated(theme);
	}

	var PLM_REPORT_CSS = /Solutions\/PLM\/styles\/report\.css/i;

	function isInjected(doc) {
		try {
			return !!doc.querySelector(
				'script[src*="darkmode/dm-boot.js"], link[href*="darkmode/dark.css"]'
			);
		} catch (e) {
			return false;
		}
	}

	function isPlmReport(doc) {
		try {
			var links = doc.querySelectorAll('link[href]');
			for (var i = 0; i < links.length; i++) {
				if (
					PLM_REPORT_CSS.test(links[i].getAttribute('href') || '') ||
					PLM_REPORT_CSS.test(links[i].href || '')
				) {
					return true;
				}
			}
			var styles = doc.querySelectorAll('style');
			for (var j = 0; j < styles.length; j++) {
				if (PLM_REPORT_CSS.test(styles[j].textContent || '')) {
					return true;
				}
			}
		} catch (e) {}
		return false;
	}

	function addSheet(doc, name, media) {
		if (doc.querySelector('link[data-dm-sheet="' + name + '"]')) {
			return true;
		}
		var href = typeof dm.assetUrl === 'function' ? dm.assetUrl(name) : '';
		if (!href) {
			miss('decorateDocument: no darkmode base URL', { sheet: name });
			return false;
		}
		var link = doc.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		if (media) {
			link.media = media;
		}
		link.setAttribute('data-dm-sheet', name);
		var target = doc.head || doc.body || doc.documentElement;
		target.appendChild(link);
		return true;
	}

	function decorateDocument(doc, options) {
		var root;
		try {
			root = doc && doc.documentElement;
		} catch (e) {
			return false;
		}
		if (!root) {
			return false;
		}
		try {
			var theme = current();
			var win = null;
			try {
				win = doc.defaultView;
			} catch (e) {}
			if (win) {
				applyToWindow(win, theme);
			} else {
				setRootTheme(root, theme);
			}
			if (decorated.indexOf(doc) === -1) {
				decorated.push(doc);
				if (decorated.length > 64) {
					decorated.shift();
				}
			}
			var kind = (options && options.kind) || 'report';
			if (isInjected(doc)) {
				ensureDarkCssLast(doc);
				return true;
			}
			if (kind === 'page') {
				root.setAttribute('data-dm-doc', 'page');
				return addSheet(doc, 'dark.css');
			}
			root.setAttribute('data-dm-doc', isPlmReport(doc) ? 'plm-report' : 'report');
			var ok1 = addSheet(doc, 'gen/tokens.css');
			var ok2 = addSheet(doc, 'report-dark.css');
			return ok1 && ok2;
		} catch (e) {
			miss('decorateDocument threw: ' + (e && e.message));
			return false;
		}
	}

	var MOVE_CAP = 20;
	function isStyleNode(n) {
		if (!n || n.nodeType !== 1) {
			return false;
		}
		var name = n.localName;
		return (
			name === 'style' ||
			(name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(n.getAttribute('rel') || ''))
		);
	}
	function isDarkLink(n) {
		return (
			!!n &&
			n.nodeType === 1 &&
			n.localName === 'link' &&
			/darkmode\/dark\.css/i.test(n.getAttribute('href') || '')
		);
	}
	function darkLinks(doc) {
		var out = [];
		var list = doc.querySelectorAll('link[href*="darkmode/dark.css"]');
		for (var i = 0; i < list.length; i++) {
			out.push(list[i]);
		}
		return out;
	}
	function ensureDarkCssLast(doc) {
		try {
			doc = doc || w.document;
			var head = doc.head;
			if (!head) {
				return false;
			}
			var links = darkLinks(doc);
			if (!links.length) {
				return false;
			}
			var link = links[links.length - 1];
			if (link.__dmPending) {
				return false;
			}
			var later = link.parentNode !== head;
			for (var n = link.nextSibling; !later && n; n = n.nextSibling) {
				if (isStyleNode(n) && !isDarkLink(n) && !n.hasAttribute('data-dm-sheet')) {
					later = true;
				}
			}
			if (!later) {
				return false;
			}
			var count = (doc.__dmDarkMoves || 0) + 1;
			doc.__dmDarkMoves = count;
			if (count > MOVE_CAP) {
				if (count === MOVE_CAP + 1) {
					miss('dark.css re-append cap reached (another script keeps appending styles)');
				}
				return false;
			}
			var clone = link.cloneNode(false);
			clone.__dmPending = true;
			var done = false;
			var finish = function () {
				if (done) {
					return;
				}
				done = true;
				clone.__dmPending = false;
				for (var i = 0; i < links.length; i++) {
					if (links[i] !== clone && links[i].parentNode) {
						links[i].parentNode.removeChild(links[i]);
					}
				}
			};
			clone.addEventListener('load', finish);
			clone.addEventListener('error', function () {
				done = true;
				if (clone.parentNode) {
					clone.parentNode.removeChild(clone);
				}
				miss('dark.css clone failed to load');
			});
			head.appendChild(clone);
			setTimeout(function () {
				try {
					if (!done && clone.sheet) {
						finish();
					}
				} catch (e) {}
			}, 3000);
			return true;
		} catch (e) {
			miss('ensureDarkCssLast threw: ' + (e && e.message));
			return false;
		}
	}

	function watchHead(doc) {
		try {
			if (!doc.head || typeof w.MutationObserver !== 'function' || doc.__dmHeadObserver) {
				return;
			}
			var scheduled = false;
			var mo = new w.MutationObserver(function (records) {
				var relevant = false;
				for (var i = 0; i < records.length && !relevant; i++) {
					var added = records[i].addedNodes;
					for (var j = 0; j < added.length; j++) {
						if (
							isStyleNode(added[j]) &&
							!isDarkLink(added[j]) &&
							!added[j].hasAttribute('data-dm-sheet')
						) {
							relevant = true;
							break;
						}
					}
				}
				if (relevant && !scheduled) {
					scheduled = true;
					setTimeout(function () {
						scheduled = false;
						ensureDarkCssLast(doc);
					}, 0);
				}
			});
			mo.observe(doc.head, { childList: true });
			doc.__dmHeadObserver = mo;
		} catch (e) {
			miss('head observer failed: ' + (e && e.message));
		}
	}

	var COLOUR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black)\b/i;
	var DM_VAR_RE = /var\(--dm-[\w-]+,\s*(?:[^()]|\([^()]*\))*\)/g;
	var tailSheet = null;
	function sheetText(sheet) {
		var s = '';
		try {
			var rules = sheet.cssRules;
			for (var i = 0; i < rules.length; i++) {
				s += rules[i].cssText + '\n';
			}
		} catch (e) {}
		return s;
	}
	function checkAdopted() {
		try {
			var doc = w.document;
			var list = doc.adoptedStyleSheets;
			if (!list || !list.length) {
				return;
			}
			var colourful = 0;
			var sample = '';
			for (var i = 0; i < list.length; i++) {
				if (list[i] === tailSheet) {
					continue;
				}
				var text = sheetText(list[i]).replace(DM_VAR_RE, '');
				if (COLOUR_RE.test(text)) {
					colourful++;
					if (!sample) {
						sample = text.slice(0, 120);
					}
				}
			}
			dm.adoptedCheck = { count: list.length, colourful: colourful };
			if (!colourful) {
				return;
			}
			miss('document adoptedStyleSheets carry raw colour literals', {
				count: colourful,
				sample: sample
			});
			adoptTail(doc);
		} catch (e) {
			miss('adopted check threw: ' + (e && e.message));
		}
	}
	function adoptTail(doc) {
		var link = darkLinks(doc).pop();
		if (!link || typeof w.fetch !== 'function' || !w.CSSStyleSheet) {
			return;
		}
		var keepLast = function () {
			try {
				var list = Array.prototype.slice.call(doc.adoptedStyleSheets);
				var at = list.indexOf(tailSheet);
				if (at === list.length - 1) {
					return;
				}
				if (at !== -1) {
					list.splice(at, 1);
				}
				list.push(tailSheet);
				doc.adoptedStyleSheets = list;
			} catch (e) {}
		};
		if (tailSheet) {
			keepLast();
			return;
		}
		w.fetch(link.href, { credentials: 'same-origin' })
			.then(function (r) {
				return r.ok ? r.text() : '';
			})
			.then(function (text) {
				if (!text || tailSheet) {
					return;
				}
				var sheet = new w.CSSStyleSheet();
				var native = CSSStyleSheet.prototype.replaceSync;
				native = (native && native.__dmWrapped) || native;
				native.call(sheet, text);
				tailSheet = sheet;
				dm.adoptedTail = sheet;
				keepLast();
			})
			.catch(function (e) {
				miss('adopted tail fetch failed: ' + (e && e.message));
			});
	}

	var api = {
		__darkmodeRuntime: true,
		decorateDocument: decorateDocument,
		ensureDarkCssLast: ensureDarkCssLast,
		KEY: KEY,
		EVENT: EVENT,
		get: function () {
			return w.document.documentElement.getAttribute('data-theme') === 'dark'
				? 'dark'
				: 'light';
		},
		getPreference: readPreference,
		setPreference: function (pref) {
			if (PREFERENCES.indexOf(pref) === -1) {
				throw new TypeError(
					'arasTheme.setPreference: expected light, dark or system, got ' + pref
				);
			}
			try {
				w.localStorage.setItem(KEY, pref);
			} catch (e) {}
			var theme = resolve(pref);
			propagate(theme);
			return theme;
		}
	};
	w.arasTheme = api;
	dm.decorateDocument = decorateDocument;

	applyToWindow(w, current());

	w.addEventListener('storage', function (e) {
		if (e.key === KEY || e.key === null) {
			sync();
		}
	});

	if (mql) {
		var onSchemeChange = function () {
			if (readPreference() === 'system') {
				sync();
			}
		};
		if (mql.addEventListener) {
			mql.addEventListener('change', onSchemeChange);
		} else if (mql.addListener) {
			mql.addListener(onSchemeChange);
		}
	}

	w.document.addEventListener(
		'load',
		function (e) {
			var el = e.target;
			if (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
				var win = null;
				try {
					win = el.contentWindow;
				} catch (err) {}
				if (win) {
					walk(win, current(), 0);
				}
			}
		},
		true
	);

	function onReady() {
		ensureDarkCssLast(w.document);
		watchHead(w.document);
		checkAdopted();
	}
	if (w.document.readyState === 'loading') {
		w.document.addEventListener('DOMContentLoaded', onReady, { once: true });
	} else {
		onReady();
	}
	w.addEventListener(
		'load',
		function () {
			ensureDarkCssLast(w.document);
			checkAdopted();
		},
		{ once: true }
	);
})();
