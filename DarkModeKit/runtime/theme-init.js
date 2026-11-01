(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : null;
	if (!w || w.__dmInit) {
		return;
	}
	w.__dmInit = true;

	var KEY = 'aras.colorScheme';
	var PREFS = ['light', 'dark', 'system'];

	function sameOriginWin(win) {
		try {
			if (win && win !== w && win.document) {
				return win;
			}
		} catch (e) {}
		return null;
	}

	function relatives() {
		var list = [];
		var seen = [];
		function add(win) {
			var ok = sameOriginWin(win);
			if (ok && seen.indexOf(ok) === -1) {
				seen.push(ok);
				list.push(ok);
			}
		}
		try {
			var p = w.parent;
			var guard = 0;
			while (p && p !== w && guard++ < 32) {
				add(p);
				if (p === p.parent) {
					break;
				}
				p = p.parent;
			}
		} catch (e) {}
		try {
			add(w.top);
		} catch (e) {}
		try {
			add(w.opener);
		} catch (e) {}
		return list;
	}

	function normalize(p) {
		return PREFS.indexOf(p) === -1 ? 'light' : p;
	}

	function readPreference() {
		try {
			var v = w.localStorage.getItem(KEY);
			return normalize(v);
		} catch (e) {}
		var rel = relatives();
		for (var i = 0; i < rel.length; i++) {
			try {
				var t = rel[i].arasTheme;
				if (t && typeof t.getPreference === 'function') {
					return normalize(t.getPreference());
				}
				var d = rel[i].__dm;
				if (d && typeof d.preference === 'function') {
					return normalize(d.preference());
				}
			} catch (e) {}
		}
		return 'light';
	}

	var mql = null;
	try {
		mql = w.matchMedia ? w.matchMedia('(prefers-color-scheme: dark)') : null;
	} catch (e) {}

	function resolve(pref) {
		return pref === 'dark' || (pref === 'system' && !!mql && mql.matches)
			? 'dark'
			: 'light';
	}

	var dm = w.__dm && typeof w.__dm === 'object' ? w.__dm : {};
	try {
		w.__dm = dm;
	} catch (e) {}

	function findData() {
		if (w.__dmData) {
			return w.__dmData;
		}
		var rel = relatives();
		for (var i = 0; i < rel.length; i++) {
			try {
				var d = (rel[i].__dm && rel[i].__dm.data) || rel[i].__dmData;
				if (d) {
					return d;
				}
			} catch (e) {}
		}
		return null;
	}

	if (!dm.data) {
		dm.data = findData();
	}
	if (!dm.misses || typeof dm.misses.push !== 'function') {
		dm.misses = [];
	}
	dm.miss = function (hook, reason, extra) {
		try {
			var rec = { hook: String(hook), reason: String(reason) };
			if (extra && typeof extra === 'object') {
				for (var k in extra) {
					if (Object.prototype.hasOwnProperty.call(extra, k)) {
						rec[k] = extra[k];
					}
				}
			}
			if (dm.misses.length < 1000) {
				dm.misses.push(rec);
			}
		} catch (e) {}
	};
	dm.KEY = KEY;
	dm.preference = readPreference;
	dm.resolve = resolve;
	dm.mql = mql;
	dm.theme = function () {
		try {
			return w.document.documentElement.getAttribute('data-theme') === 'dark'
				? 'dark'
				: 'light';
		} catch (e) {
			return 'light';
		}
	};

	var base = '';
	var query = '';
	try {
		var src = '';
		var cs = w.document.currentScript;
		if (cs && cs.src && /darkmode\//i.test(cs.src)) {
			src = cs.src;
		}
		if (!src) {
			var s = w.document.querySelector('script[src*="darkmode/dm-boot.js"]');
			src = s ? s.src : '';
		}
		if (src) {
			var q = src.indexOf('?');
			var path = q === -1 ? src : src.slice(0, q);
			query = q === -1 ? '' : src.slice(q);
			base = path.slice(0, path.lastIndexOf('/') + 1);
		}
	} catch (e) {}
	if (!base) {
		var rels = relatives();
		for (var r = 0; r < rels.length && !base; r++) {
			try {
				if (rels[r].__dm && rels[r].__dm.base) {
					base = rels[r].__dm.base;
					query = rels[r].__dm.query || '';
				}
			} catch (e) {}
		}
	}
	dm.base = base;
	dm.query = query;
	dm.assetUrl = function (name) {
		if (!dm.base) {
			return '';
		}
		var qs = dm.query;
		try {
			var assets = dm.data && dm.data.assets;
			if (assets && typeof assets[name] === 'string' && assets[name]) {
				qs = '?v=' + assets[name];
			}
		} catch (e) {}
		return dm.base + name + qs;
	};

	try {
		var root = w.document.documentElement;
		var dark = resolve(readPreference()) === 'dark';
		root.setAttribute('data-theme', dark ? 'dark' : 'light');
		if (dark) {
			root.style.colorScheme = 'dark';
		}
	} catch (e) {
		dm.miss('theme-init', 'could not set data-theme: ' + (e && e.message));
	}
})();
