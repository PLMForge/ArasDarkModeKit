(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : null;
	if (!w || w.__dmScopeMarkers) {
		return;
	}
	w.__dmScopeMarkers = true;
	var dm = w.__dm || (w.__dm = { misses: [] });
	var ATTR = 'data-dm-scope';
	var EVENT = 'aras-theme-change';

	function miss(reason) {
		try {
			if (typeof dm.miss === 'function') {
				dm.miss('scope-markers', reason);
			}
		} catch (e) {}
	}

	var checks = [];
	try {
		var list = (dm.data && dm.data.scopes) || [];
		for (var i = 0; i < list.length; i++) {
			var t = list[i] && list[i].t;
			var s = list[i] && list[i].s;
			if (typeof t !== 'string' || typeof s !== 'string' || !t) {
				continue;
			}
			var m = /^link\[href\*="([^"]*)"\]$/.exec(s);
			if (m) {
				checks.push({ t: t, sub: m[1] });
				continue;
			}
			m = /^link\[href="([^"]*)"\]$/.exec(s);
			if (m) {
				checks.push({ t: t, eq: m[1] });
				continue;
			}
			checks.push({ t: t, sel: s });
		}
	} catch (e) {
		miss('bad __dmData.scopes: ' + (e && e.message));
	}

	function isDark(doc) {
		try {
			return doc.documentElement.getAttribute('data-theme') === 'dark';
		} catch (e) {
			return false;
		}
	}

	function evaluate(doc, st) {
		var root = doc.documentElement;
		if (!root) {
			return;
		}
		var hrefs = [];
		var links = st.links;
		for (var i = 0; i < links.length; i++) {
			var h = links[i].getAttribute('href');
			if (h) {
				hrefs.push(h);
			}
		}
		var on = [];
		for (var c = 0; c < checks.length; c++) {
			var k = checks[c];
			var hit = false;
			if (k.sub !== undefined) {
				for (var a = 0; a < hrefs.length && !hit; a++) {
					hit = hrefs[a].indexOf(k.sub) !== -1;
				}
			} else if (k.eq !== undefined) {
				for (var b = 0; b < hrefs.length && !hit; b++) {
					hit = hrefs[b] === k.eq;
				}
			} else {
				try {
					hit = !!doc.querySelector(k.sel);
				} catch (e) {
					hit = false;
				}
			}
			if (hit) {
				on.push(k.t);
			}
		}
		var value = on.join(' ');
		if (value === st.value) {
			return;
		}
		st.value = value;
		if (value) {
			root.setAttribute(ATTR, value);
		} else if (root.hasAttribute(ATTR)) {
			root.removeAttribute(ATTR);
		}
	}

	function start(doc, st) {
		if (st.mo) {
			return;
		}
		st.value = null;
		evaluate(doc, st);
		var MO = (doc.defaultView && doc.defaultView.MutationObserver) || w.MutationObserver;
		if (typeof MO !== 'function') {
			return;
		}
		st.mo = new MO(function () {
			try {
				evaluate(doc, st);
			} catch (e) {}
		});
		try {
			st.mo.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'id'] });
		} catch (e) {
			st.mo = null;
			miss('observe failed: ' + (e && e.message));
		}
	}

	function stop(doc, st) {
		if (st.mo) {
			st.mo.disconnect();
			st.mo = null;
		}
		st.value = null;
		try {
			if (doc.documentElement && doc.documentElement.hasAttribute(ATTR)) {
				doc.documentElement.removeAttribute(ATTR);
			}
		} catch (e) {}
	}

	function sync(doc, st) {
		try {
			if (isDark(doc)) {
				start(doc, st);
			} else {
				stop(doc, st);
			}
		} catch (e) {
			miss('sync threw: ' + (e && e.message));
		}
	}

	function watchScopes(doc) {
		try {
			if (!doc || !checks.length || doc.__dmScopeState) {
				return !!(doc && doc.__dmScopeState);
			}
			var st = { links: doc.getElementsByTagName('link'), mo: null, value: null };
			doc.__dmScopeState = st;
			var win = doc.defaultView;
			if (win && typeof win.addEventListener === 'function') {
				win.addEventListener(EVENT, function () {
					sync(doc, st);
				});
				win.addEventListener('load', function () {
					if (st.mo) {
						evaluate(doc, st);
					}
				});
			}
			sync(doc, st);
			return true;
		} catch (e) {
			miss('watchScopes threw: ' + (e && e.message));
			return false;
		}
	}

	dm.watchScopes = watchScopes;
	watchScopes(w.document);
})();
