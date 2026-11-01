(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : null;
	if (!w || w.__dmHookReports) {
		return;
	}
	var stats = { patchedAras: false, decorated: 0, errors: 0 };
	w.__dmHookReports = stats;

	var dm = w.__dm || (w.__dm = { misses: [] });
	if (!dm.reportLog) {
		dm.reportLog = [];
	}
	var missed = {};
	function miss(reason, extra) {
		if (missed[reason]) {
			return;
		}
		missed[reason] = true;
		if (typeof dm.miss === 'function') {
			dm.miss('hook-reports', reason, extra);
		} else {
			try {
				dm.misses.push({ hook: 'hook-reports', reason: reason });
			} catch (e) {}
		}
	}
	function log(entry) {
		try {
			dm.reportLog.push(entry);
			if (dm.reportLog.length > 50) {
				dm.reportLog.shift();
			}
		} catch (e) {}
	}

	function decorate(doc, kind, source) {
		try {
			var api = w.arasTheme;
			if (!api || typeof api.decorateDocument !== 'function') {
				miss('arasTheme.decorateDocument missing');
				return false;
			}
			var ok = api.decorateDocument(doc, { kind: kind });
			stats.decorated++;
			log({
				source: source,
				kind: kind,
				ok: !!ok,
				doc: doc,
				time: Date.now()
			});
			return ok;
		} catch (e) {
			stats.errors++;
			miss('decorate threw: ' + (e && e.message));
			return false;
		}
	}

	function docOf(win) {
		try {
			return win && win.document && win.document.documentElement ? win.document : null;
		} catch (e) {
			return null;
		}
	}

	function isInjected(doc) {
		try {
			return !!doc.querySelector(
				'script[src*="darkmode/dm-boot.js"], link[href*="darkmode/dark.css"]'
			);
		} catch (e) {
			return true;
		}
	}

	function setHidden(obj, key, value) {
		try {
			Object.defineProperty(obj, key, {
				value: value,
				configurable: true,
				enumerable: false,
				writable: true
			});
		} catch (e) {}
	}

	var active = null;
	function record(win, source) {
		if (!active || !win) {
			return;
		}
		for (var i = 0; i < active.wins.length; i++) {
			if (active.wins[i].win === win) {
				return;
			}
		}
		active.wins.push({ win: win, source: source });
	}

	var BLANK_RE = /(^|\/)blank\.html(\?|#|$)/i;
	function wrapOpen() {
		var orig = w.open;
		if (typeof orig !== 'function') {
			miss('window.open not a function');
			return;
		}
		if (orig.__dmReportsWrapped) {
			return;
		}
		var wrapper = function () {
			var result = orig.apply(this, arguments);
			try {
				if (active) {
					record(result, 'open');
				} else {
					var url = arguments.length ? String(arguments[0] || '') : '';
					if (result && BLANK_RE.test(url)) {
						Promise.resolve().then(function () {
							var doc = docOf(result);
							if (
								doc &&
								!isInjected(doc) &&
								!doc.documentElement.hasAttribute('data-dm-doc') &&
								doc.body &&
								doc.body.childNodes.length
							) {
								decorate(doc, 'page', 'open:blank');
							}
						});
					}
				}
			} catch (e) {
				stats.errors++;
			}
			return result;
		};
		setHidden(wrapper, '__dmReportsWrapped', orig);
		try {
			w.open = wrapper;
		} catch (e) {
			miss('window.open not writable');
		}
	}

	function wrapTabs(mainWin) {
		try {
			var tabs = mainWin && mainWin.arasTabs;
			if (!tabs) {
				return;
			}
			var orig = tabs.open;
			if (typeof orig !== 'function') {
				miss('arasTabs.open missing');
				return;
			}
			if (orig.__dmReportsWrapped) {
				return;
			}
			var wrapper = function () {
				var result = orig.apply(this, arguments);
				try {
					record(result, 'arasTabs.open');
				} catch (e) {}
				return result;
			};
			setHidden(wrapper, '__dmReportsWrapped', orig);
			tabs.open = wrapper;
		} catch (e) {
			miss('arasTabs.open not wrappable: ' + (e && e.message));
		}
	}

	function tempWrapContentWindow(win) {
		try {
			var proto = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype;
			var d = proto && Object.getOwnPropertyDescriptor(proto, 'contentWindow');
			if (!d || typeof d.get !== 'function' || !d.configurable) {
				return null;
			}
			var getter = d.get;
			Object.defineProperty(proto, 'contentWindow', {
				configurable: true,
				enumerable: d.enumerable,
				get: function () {
					var r = getter.call(this);
					try {
						record(r, 'contentWindow');
					} catch (e) {}
					return r;
				}
			});
			return function () {
				try {
					Object.defineProperty(proto, 'contentWindow', d);
				} catch (e) {}
			};
		} catch (e) {
			return null;
		}
	}

	function mainWindowOf(arasInst) {
		try {
			return arasInst && typeof arasInst.getMainWindow === 'function'
				? arasInst.getMainWindow()
				: null;
		} catch (e) {
			return null;
		}
	}

	function finish(col, result, arasInst, args) {
		if (result && typeof result === 'object' && result.window === result) {
			var outer = active;
			active = col;
			record(result, 'return');
			active = outer;
		}
		var isService = col.method === 'targetReport' && args[1] === 'service';
		var mainWin = mainWindowOf(arasInst);

		if (!col.wins.length && mainWin && args[0]) {
			try {
				var id = arasInst.getItemProperty(args[0], 'id');
				var frames = mainWin.document.querySelectorAll(
					'iframe[id^="' + String(arasInst.mainWindowName) + '_' + id + '"]'
				);
				for (var f = 0; f < frames.length; f++) {
					col.wins.push({ win: frames[f].contentWindow, source: 'frameId' });
				}
			} catch (e) {}
		}

		var count = 0;
		for (var i = 0; i < col.wins.length; i++) {
			var item = col.wins[i];
			var doc = docOf(item.win);
			if (isService) {
				hookServiceLoad(item.win);
				continue;
			}
			if (!doc || isInjected(doc)) {
				continue;
			}
			var root = doc.documentElement;
			if (
				(item.source === 'contentWindow' || item.source === 'frameId') &&
				root.hasAttribute('data-theme') &&
				!root.hasAttribute('data-dm-doc')
			) {
				continue;
			}
			if (decorate(doc, 'report', col.method + ':' + item.source)) {
				count++;
			}
		}
		col.decorated = count;
	}

	function hookServiceLoad(win) {
		try {
			var target = win.frameElement || win;
			target.addEventListener(
				'load',
				function () {
					var doc = docOf(win);
					if (doc && !isInjected(doc)) {
						decorate(doc, 'report', 'service:load');
					}
				},
				{ once: true }
			);
		} catch (e) {}
	}

	function wrapCollecting(proto, name) {
		var orig = proto[name];
		if (typeof orig !== 'function') {
			miss('anchor missing: Aras.prototype.' + name);
			return false;
		}
		if (orig.__dmReportsWrapped) {
			return true;
		}
		var wrapper = function () {
			var outer = active;
			var col = { method: name, wins: [] };
			var restores = [];
			var args = arguments;
			try {
				var mainWin = mainWindowOf(this);
				wrapTabs(mainWin);
				var r1 = tempWrapContentWindow(w);
				if (r1) {
					restores.push(r1);
				}
				if (mainWin && mainWin !== w) {
					var r2 = tempWrapContentWindow(mainWin);
					if (r2) {
						restores.push(r2);
					}
				}
			} catch (e) {
				stats.errors++;
			}
			active = col;
			var result;
			try {
				result = orig.apply(this, args);
			} finally {
				active = outer;
				for (var i = restores.length - 1; i >= 0; i--) {
					restores[i]();
				}
			}
			try {
				finish(col, result, this, args);
			} catch (e) {
				stats.errors++;
				miss('finish threw: ' + (e && e.message));
			}
			return result;
		};
		setHidden(wrapper, '__dmReportsWrapped', orig);
		try {
			Object.defineProperty(wrapper, 'length', { value: orig.length, configurable: true });
		} catch (e) {}
		proto[name] = wrapper;
		return true;
	}

	function wrapRecording(proto, name) {
		var orig = proto[name];
		if (typeof orig !== 'function') {
			miss('anchor missing: Aras.prototype.' + name);
			return;
		}
		if (orig.__dmReportsWrapped) {
			return;
		}
		var wrapper = function () {
			var result = orig.apply(this, arguments);
			try {
				record(result, name);
			} catch (e) {}
			return result;
		};
		setHidden(wrapper, '__dmReportsWrapped', orig);
		proto[name] = wrapper;
	}

	function patchAras() {
		try {
			var A = w.Aras;
			if (typeof A !== 'function' || !A.prototype) {
				return false;
			}
			var P = A.prototype;
			if (P.__dmReportsPatched) {
				return true;
			}
			if (typeof P.getItemProperty !== 'function') {
				miss('anchor missing: Aras.prototype.getItemProperty');
				return false;
			}
			setHidden(P, '__dmReportsPatched', true);
			var a = wrapCollecting(P, 'targetReport');
			var b = wrapCollecting(P, 'invokeAction');
			wrapRecording(P, 'getActionTargetWindow');
			stats.patchedAras = a || b;
			return true;
		} catch (e) {
			stats.errors++;
			miss('patchAras threw: ' + (e && e.message));
			return false;
		}
	}

	function wrapModalDialog() {
		try {
			if (!/modalDialog\.html$/i.test(w.location.pathname)) {
				return;
			}
			var fe = w.frameElement;
			var args = fe && fe.dialogArguments;
			if (!args || typeof args.writeContent !== 'function') {
				miss('anchor missing: modalDialog dialogArguments.writeContent');
				return;
			}
			var orig = args.writeContent;
			if (orig.__dmReportsWrapped) {
				return;
			}
			var wrapper = function (target) {
				var result = orig.apply(this, arguments);
				try {
					var doc = docOf(target);
					if (doc) {
						decorate(doc, 'page', 'modalDialog.writeContent');
					}
				} catch (e) {}
				return result;
			};
			setHidden(wrapper, '__dmReportsWrapped', orig);
			args.writeContent = wrapper;
		} catch (e) {
			miss('modalDialog wrap failed: ' + (e && e.message));
		}
	}

	function isBareDocument(doc) {
		try {
			return !doc.querySelector('script[src], link[rel~="stylesheet"][href]');
		} catch (e) {
			return false;
		}
	}
	function onFrameLoad(e) {
		var el = e.target;
		if (!el || (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME')) {
			return;
		}
		try {
			var doc = docOf(el.contentWindow);
			if (!doc || !doc.body) {
				return;
			}
			var root = doc.documentElement;
			if (root.hasAttribute('data-dm-doc') || isInjected(doc) || !isBareDocument(doc)) {
				return;
			}
			decorate(doc, 'page', 'iframe:' + (el.id || el.name || 'anonymous'));
		} catch (err) {
			stats.errors++;
		}
	}

	try {
		wrapOpen();
	} catch (e) {
		miss('wrapOpen threw');
	}
	wrapModalDialog();
	try {
		w.document.addEventListener('load', onFrameLoad, true);
	} catch (e) {}
	if (!patchAras()) {
		try {
			w.addEventListener('DOMContentLoaded', patchAras, true);
			w.addEventListener(
				'load',
				function () {
					patchAras();
				},
				{ once: true }
			);
		} catch (e) {}
	}
	stats.patchAras = patchAras;
	stats.decorate = decorate;
})();
