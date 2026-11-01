;(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : this;
	if (!w || w.__dmH2Components) {
		return;
	}
	w.__dmH2Components = true;

	var dm = w.__dm || (w.__dm = { misses: [] });
	if (!dm.misses) {
		dm.misses = [];
	}
	var state = (dm.h2 = dm.h2 || {});
	var compState = (state.components = {
		defineHooked: false,
		patched: {},
		imgRewrites: 0,
		chartThemed: 0
	});
	var EVENT = 'aras-theme-change';

	function miss(hook, reason) {
		try {
			dm.misses.push({ hook: hook, reason: String(reason) });
		} catch (e) {}
	}

	function isDark(doc) {
		try {
			return (doc || w.document).documentElement.getAttribute('data-theme') === 'dark';
		} catch (e) {
			return false;
		}
	}

	function getData() {
		var data = dm.data || w.__dmData;
		if (!data) {
			try {
				data = w.top && w.top !== w ? w.top.__dmData : null;
			} catch (e) {}
		}
		return data || null;
	}

	var darkFiles = null;
	function getDarkFiles() {
		if (darkFiles) {
			return darkFiles;
		}
		darkFiles = {};
		var icons = (getData() || {}).icons || {};
		var k;
		if (Array.isArray(icons.files)) {
			icons.files.forEach(function (f) {
				var rel = String(f).replace(/\\/g, '/').replace(/^(\.\.\/|\/)*(innovator\/client\/)?images\//i, '');
				darkFiles[rel.toLowerCase()] = rel;
			});
		} else if (icons.files && typeof icons.files === 'object') {
			for (k in icons.files) {
				if (Object.prototype.hasOwnProperty.call(icons.files, k)) {
					var rel = String(k).replace(/\\/g, '/').replace(/^(\.\.\/|\/)*(innovator\/client\/)?images\//i, '');
					var dst = String(icons.files[k]).replace(/\\/g, '/').replace(/^(\.\.\/|\/)*(innovator\/client\/)?images-dark\//i, '');
					darkFiles[rel.toLowerCase()] = dst;
				}
			}
		}
		if (Array.isArray(icons.darkFiles)) {
			icons.darkFiles.forEach(function (f) {
				darkFiles[String(f).toLowerCase()] = String(f);
			});
		}
		if (!Object.keys(darkFiles).length) {
			miss('aras-image', 'no dark image list (icons.files / darkFiles)');
		}
		return darkFiles;
	}

	var IMG_URL_RE = /^((?:\.\.\/)+|(?:[a-z]+:\/\/[^/]+)?\/[^?#]*?\/client\/(?:x-salt=[^/]+\/)?)images\/([^?#]+\.svg)$/i;

	function toDarkUrl(url) {
		var m = IMG_URL_RE.exec(String(url || ''));
		if (!m) {
			return url;
		}
		var dst = getDarkFiles()[m[2].toLowerCase()];
		return dst ? m[1] + 'images-dark/' + dst : url;
	}

	function toDarkBackground(value) {
		return String(value).replace(/url\((["']?)([^"')]+)\1\)/g, function (all, q, u) {
			var d = toDarkUrl(u);
			return d === u ? all : 'url(' + q + d + q + ')';
		});
	}

	function applyImg(img, dark) {
		var cur = img.getAttribute('src');
		var orig = img.__dmSrcSet !== undefined && cur === img.__dmSrcSet ? img.__dmSrcOrig : cur;
		if (orig !== null && orig !== undefined) {
			var want = dark ? toDarkUrl(orig) : orig;
			if (want !== cur) {
				img.setAttribute('src', want);
				compState.imgRewrites++;
			}
			img.__dmSrcOrig = orig;
			img.__dmSrcSet = want;
		}
		var bg = img.style && img.style.backgroundImage;
		if (bg || img.__dmBgSet !== undefined) {
			var origBg = img.__dmBgSet !== undefined && bg === img.__dmBgSet ? img.__dmBgOrig : bg;
			var wantBg = dark && origBg ? toDarkBackground(origBg) : origBg;
			if (wantBg !== bg) {
				img.style.backgroundImage = wantBg;
			}
			img.__dmBgOrig = origBg;
			img.__dmBgSet = img.style.backgroundImage;
		}
	}

	function Tracker() {
		this.items = [];
		this.seen = typeof WeakSet === 'function' ? new WeakSet() : null;
	}
	Tracker.prototype.add = function (el) {
		if (this.seen) {
			if (this.seen.has(el)) {
				return;
			}
			this.seen.add(el);
		} else if (el.__dmTracked) {
			return;
		} else {
			el.__dmTracked = true;
		}
		this.items.push(typeof WeakRef === 'function' ? new WeakRef(el) : { deref: function () { return el; } });
	};
	Tracker.prototype.each = function (fn) {
		var keep = [];
		for (var i = 0; i < this.items.length; i++) {
			var el = this.items[i].deref();
			if (!el) {
				continue;
			}
			keep.push(this.items[i]);
			if (el.isConnected) {
				try {
					fn(el);
				} catch (e) {}
			}
		}
		this.items = keep;
	};

	var imageInstances = new Tracker();
	var chartInstances = new Tracker();

	function patchImage(Ctor) {
		var proto = Ctor && Ctor.prototype;
		if (!proto || typeof proto.render !== 'function') {
			miss('aras-image', 'prototype.render missing');
			return;
		}
		if (proto.render.__dmWrapped) {
			return;
		}
		var nativeRender = proto.render;
		var render = function render() {
			var result = nativeRender.apply(this, arguments);
			try {
				var root = this.shadowRoot;
				var imgs = root && root.querySelectorAll ? root.querySelectorAll('img.aras-image__image') : null;
				if (imgs && imgs.length) {
					imageInstances.add(this);
					var dark = isDark(this.ownerDocument);
					for (var i = 0; i < imgs.length; i++) {
						applyImg(imgs[i], dark);
					}
				}
			} catch (e) {
				miss('aras-image', 'render post-process failed: ' + (e && e.message));
			}
			return result;
		};
		render.__dmWrapped = true;
		render.__dmNative = nativeRender;
		proto.render = render;
		compState.patched['aras-image'] = true;
	}

	function cssToken(doc, name, fallback) {
		try {
			var v = w.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
			if (v && v.indexOf('var(') === -1) {
				return v;
			}
		} catch (e) {}
		var pal = (getData() || {}).palette || {};
		var bare = name.replace(/^--dm-/, '');
		var cands = [
			pal.chart && pal.chart[bare],
			pal.tokens && pal.tokens[name],
			pal.dark && pal.dark[name],
			pal.dark && pal.dark['--' + bare],
			pal[name],
			pal['--' + bare],
			pal[bare]
		];
		for (var i = 0; i < cands.length; i++) {
			if (typeof cands[i] === 'string' && /^#[0-9a-f]{3,8}$/i.test(cands[i])) {
				return cands[i];
			}
		}
		return fallback;
	}

	function chartDarkOptions(doc) {
		var text = cssToken(doc, '--dm-text', '#dde0e8');
		var strong = cssToken(doc, '--dm-text-strong', '#f3f4f6');
		var secondary = cssToken(doc, '--dm-text-secondary', '#b5b8c0');
		var axis = cssToken(doc, '--dm-gray800', '#93969e');
		var grid = cssToken(doc, '--dm-border-subtle', '#3e4046');
		var surface = cssToken(doc, '--dm-surface', '#1e2027');
		var raised = cssToken(doc, '--dm-surface-raised', '#272a32');
		var border = cssToken(doc, '--dm-border', '#74777e');
		var scale = {
			grid: { color: grid },
			border: { color: axis },
			ticks: { color: text, backdropColor: surface },
			title: { color: text }
		};
		return {
			color: text,
			borderColor: axis,
			backgroundColor: surface,
			scales: { x: scale, y: scale },
			plugins: {
				legend: { labels: { color: text }, title: { color: text } },
				title: { color: text },
				subtitle: { color: secondary },
				tooltip: {
					backgroundColor: raised,
					borderColor: border,
					bodyColor: strong,
					titleColor: strong,
					footerColor: secondary
				}
			}
		};
	}

	function isPlain(o) {
		if (!o || typeof o !== 'object' || Object.prototype.toString.call(o) !== '[object Object]') {
			return false;
		}
		var p = Object.getPrototypeOf(o);
		return p === null || Object.getPrototypeOf(p) === null;

	}

	function mergeInto(base, over) {
		var out = {};
		var k;
		if (isPlain(base)) {
			for (k in base) {
				if (Object.prototype.hasOwnProperty.call(base, k)) {
					out[k] = base[k];
				}
			}
		}
		for (k in over) {
			if (!Object.prototype.hasOwnProperty.call(over, k)) {
				continue;
			}
			if (isPlain(over[k])) {
				out[k] = mergeInto(isPlain(out[k]) ? out[k] : {}, over[k]);
			} else {
				out[k] = over[k];
			}
		}
		return out;
	}

	function themeChart(el) {
		var chart = el._chart;
		if (!chart || !isDark(el.ownerDocument)) {
			return;
		}
		var cfg = chart.config;
		var raw = cfg ? cfg.options : null;
		var base = isPlain(raw) ? raw : {};
		var over = chartDarkOptions(el.ownerDocument);
		var existingScales = base.scales && isPlain(base.scales) ? Object.keys(base.scales) : [];
		if (existingScales.length) {
			var scales = {};
			existingScales.forEach(function (id) {
				scales[id] = over.scales.x;
			});
			over.scales = scales;
		} else if (cfg && /^(pie|doughnut|polarArea|radar)$/.test(cfg.type)) {
			delete over.scales;
		}
		chart.options = mergeInto(base, over);
		chart.update('none');
		compState.chartThemed++;
	}

	function patchChart(Ctor) {
		var proto = Ctor && Ctor.prototype;
		if (!proto || typeof proto.render !== 'function') {
			miss('aras-chart', 'prototype.render missing');
			return;
		}
		if (proto.render.__dmWrapped) {
			return;
		}
		var nativeRender = proto.render;
		var render = function render() {
			var result = nativeRender.apply(this, arguments);
			try {
				chartInstances.add(this);
				if (this._chart === undefined) {
					miss('aras-chart', 'public _chart field missing');
				} else if (this._chart) {
					themeChart(this);
				}
			} catch (e) {
				miss('aras-chart', 'dark options failed: ' + (e && e.message));
			}
			return result;
		};
		render.__dmWrapped = true;
		render.__dmNative = nativeRender;
		proto.render = render;
		compState.patched['aras-chart'] = true;
	}

	var PATCHERS = { 'aras-image': patchImage, 'aras-chart': patchChart };

	dm.components = {
		toDarkUrl: toDarkUrl,
		toDarkBackground: toDarkBackground,
		applyImg: applyImg,
		mergeInto: mergeInto,
		patchImage: patchImage,
		patchChart: patchChart
	};

	var CER = w.CustomElementRegistry;
	if (!CER || !CER.prototype || typeof CER.prototype.define !== 'function' || !w.customElements) {
		if (w.document) {
			miss('components', 'CustomElementRegistry.prototype.define missing');
		}
		return;
	}

	try {
		var nativeDefine = CER.prototype.define;
		var define = function define(name, ctor) {
			try {
				var p = PATCHERS[name];
				if (p) {
					p(ctor);
				}
			} catch (e) {
				miss('components', 'patch ' + name + ' failed: ' + (e && e.message));
			}
			return nativeDefine.apply(this, arguments);
		};
		define.__dmWrapped = true;
		CER.prototype.define = define;
		compState.defineHooked = true;
	} catch (e) {
		miss('components', 'define not hookable: ' + (e && e.message));
	}

	Object.keys(PATCHERS).forEach(function (name) {
		try {
			var existing = w.customElements.get(name);
			if (existing) {
				PATCHERS[name](existing);
				var nodes = w.document.querySelectorAll(name);
				for (var i = 0; i < nodes.length; i++) {
					try {
						nodes[i].render();
					} catch (e) {}
				}
			}
		} catch (e) {}
	});

	w.addEventListener(EVENT, function () {
		imageInstances.each(function (el) {
			el.render();
		});
		chartInstances.each(function (el) {
			if (el._chart) {
				el.render();
			}
		});
	});
})();
