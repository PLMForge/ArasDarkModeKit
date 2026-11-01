;(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : this;
	if (!w || w.__dmH2Apps) {
		return;
	}
	w.__dmH2Apps = true;

	var dm = w.__dm || (w.__dm = { misses: [] });
	if (!dm.misses) {
		dm.misses = [];
	}
	var state = (dm.h2 = dm.h2 || {});
	var appState = (state.apps = {
		itemTypeColor: { hooked: false, set: 0 },
		domToSvg: { wrapped: false, captures: 0 },
		htmlEditor: { hooked: false, styled: 0 },
		pdftron: { wrapped: false, configured: 0 },
		monaco: { envPreset: false, captured: false, created: 0 },
		ace: { trapped: false, wrapped: false, renderers: 0 }
	});
	var EVENT = 'aras-theme-change';
	var doc = w.document;
	if (!doc) {
		return;
	}

	function miss(hook, reason) {
		try {
			dm.misses.push({ hook: hook, reason: String(reason) });
		} catch (e) {}
	}

	function isDark(d) {
		try {
			return (d || doc).documentElement.getAttribute('data-theme') === 'dark';
		} catch (e) {
			return false;
		}
	}

	function onThemeChange(fn) {
		w.addEventListener(EVENT, function () {
			try {
				fn(isDark());
			} catch (e) {}
		});
	}

	var BOOT_SRC = (function () {
		try {
			var cs = doc.currentScript;
			if (cs && cs.src && /dm-boot\.js/i.test(cs.src)) {
				return cs.src;
			}
			var scripts = doc.getElementsByTagName('script');
			for (var i = 0; i < scripts.length; i++) {
				if (/\/darkmode\/dm-boot\.js/i.test(scripts[i].src)) {
					return scripts[i].src;
				}
			}
			if (cs && cs.src) {
				return cs.src;
			}
		} catch (e) {}
		return '';
	})();

	function kitUrl(rel) {
		try {
			return BOOT_SRC ? new URL(rel, BOOT_SRC).href : '';
		} catch (e) {
			return '';
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

	function cssToken(name, fallback) {
		try {
			var v = w.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
			if (v && v.indexOf('var(') === -1) {
				return v;
			}
		} catch (e) {}
		var pal = (getData() || {}).palette || {};
		var bare = name.replace(/^--dm-/, '');
		var cands = [
			pal.tokens && pal.tokens[name],
			pal.dark && pal.dark[name],
			pal.dark && pal.dark['--' + bare],
			pal[name],
			pal['--' + bare],
			pal[bare] && typeof pal[bare] === 'object' ? pal[bare].dark : pal[bare]
		];
		for (var i = 0; i < cands.length; i++) {
			if (typeof cands[i] === 'string' && /^#[0-9a-f]{3,8}$/i.test(cands[i].trim())) {
				return cands[i].trim();
			}
		}
		return fallback;
	}

	var fallbackAdapt = (function () {
		function toLin(c) {
			return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		}
		function toGamma(c) {
			return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
		}
		function parseColor(input) {
			var s = String(input).trim().toLowerCase();
			var m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
			if (m) {
				var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
				return [0, 2, 4].map(function (i) {
					return parseInt(h.slice(i, i + 2), 16) / 255;
				});
			}
			m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
			if (m) {
				return [m[1], m[2], m[3]].map(function (x) {
					return Math.min(255, +x) / 255;
				});
			}
			return null;
		}
		function toHex(rgb) {
			return (
				'#' +
				rgb
					.map(function (c) {
						var v = Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16);
						return v.length < 2 ? '0' + v : v;
					})
					.join('')
			);
		}
		function lum(rgb) {
			var l = rgb.map(toLin);
			return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
		}
		function contrast(a, b) {
			var x = lum(a);
			var y = lum(b);
			return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
		}
		function toOklch(rgb) {
			var c = rgb.map(toLin);
			var l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
			var m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
			var s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
			var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
			var A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
			var B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
			return [L, Math.sqrt(A * A + B * B), Math.atan2(B, A)];
		}
		function fromOklch(L, C, H) {
			var a = C * Math.cos(H);
			var b = C * Math.sin(H);
			var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
			var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
			var s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
			return [
				4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
				-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
				-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
			];
		}
		function oklchToRgb(L, C, H) {
			var lin = fromOklch(L, C, H);
			while (C > 0 && lin.some(function (c) { return c < -0.001 || c > 1.001; })) {
				C -= 0.005;
				lin = fromOklch(L, C, H);
			}
			return lin.map(function (c) {
				return toGamma(Math.min(1, Math.max(0, c)));
			});
		}
		return function adaptForDark(color, opts) {
			opts = opts || {};
			var rgb = parseColor(color);
			var bg = parseColor(opts.bg || '#1e2027');
			if (!rgb || !bg) {
				return null;
			}
			var minContrast = opts.minContrast || 3;
			var maxL = opts.maxL === undefined ? 0.86 : opts.maxL;
			var lch = toOklch(rgb);
			var L = Math.min(lch[0], maxL);
			var out = oklchToRgb(L, lch[1], lch[2]);
			while (contrast(out, bg) < minContrast && L < 1) {
				L += 0.01;
				out = oklchToRgb(L, lch[1], lch[2]);
			}
			return toHex(out);
		};
	})();

	function adapt(color, opts) {
		var fn =
			(dm && typeof dm.adaptForDark === 'function' && dm.adaptForDark) ||
			(w.arasTheme && typeof w.arasTheme.adaptForDark === 'function' && w.arasTheme.adaptForDark) ||
			(typeof w.adaptForDark === 'function' && w.adaptForDark) ||
			fallbackAdapt;
		try {
			var out = fn(color, opts);
			return typeof out === 'string' && /^#[0-9a-f]{6}$/i.test(out) ? out : fallbackAdapt(color, opts);
		} catch (e) {
			return fallbackAdapt(color, opts);
		}
	}

	(function () {
		var CSD = w.CSSStyleDeclaration && w.CSSStyleDeclaration.prototype;
		if (!CSD || typeof CSD.setProperty !== 'function') {
			miss('item-type-color', 'CSSStyleDeclaration.prototype.setProperty missing');
			return;
		}
		var COMPANION = {
			'--item-type-color': { name: '--item-type-color-dark', minContrast: 3 },
			'--theme-primary': { name: '--theme-primary-text-dark', minContrast: 4.5, maxL: 1 }
		};
		var nativeSet = CSD.setProperty;
		var nativeRemove = CSD.removeProperty;
		var tracked = [];
		var seenBySource = {};

		function update(decl, source, dark) {
			var c = COMPANION[source];
			var value = String(decl.getPropertyValue(source) || '').trim();
			if (dark && value) {
				var bg = cssToken('--dm-surface', '#1e2027');
				var out = adapt(value, { bg: bg, minContrast: c.minContrast, maxL: c.maxL });
				if (out) {
					nativeSet.call(decl, c.name, out);
					appState.itemTypeColor.set++;
					return;
				}
			}
			if (decl.getPropertyValue(c.name)) {
				nativeRemove.call(decl, c.name);
			}
		}

		CSD.setProperty = function setProperty(name) {
			var result = nativeSet.apply(this, arguments);
			if (typeof name === 'string' && name.charCodeAt(0) === 45 && COMPANION.hasOwnProperty(name)) {
				try {
					var seen = seenBySource[name] || (seenBySource[name] = typeof WeakSet === 'function' ? new WeakSet() : null);
					if (!seen || !seen.has(this)) {
						if (seen) {
							seen.add(this);
						}
						tracked.push({ decl: typeof WeakRef === 'function' ? new WeakRef(this) : { deref: (function (d) { return function () { return d; }; })(this) }, source: name });
					}
					update(this, name, isDark());
				} catch (e) {
					miss('item-type-color', 'companion failed: ' + (e && e.message));
				}
			}
			return result;
		};
		appState.itemTypeColor.hooked = true;

		onThemeChange(function (dark) {
			var keep = [];
			for (var i = 0; i < tracked.length; i++) {
				var d = tracked[i].decl.deref();
				if (d) {
					keep.push(tracked[i]);
					try {
						update(d, tracked[i].source, dark);
					} catch (e) {}
				}
			}
			tracked = keep;
		});
	})();

	function trapGlobal(name, onSet) {
		try {
			var desc = Object.getOwnPropertyDescriptor(w, name);
			if (desc && !desc.configurable) {
				miss(name, 'global not configurable');
				return false;
			}
			var value = desc ? (desc.get ? desc.get.call(w) : desc.value) : undefined;
			Object.defineProperty(w, name, {
				configurable: true,
				enumerable: true,
				get: function () {
					return value;
				},
				set: function (v) {
					value = v;
					try {
						onSet(v);
					} catch (e) {
						miss(name, 'trap handler failed: ' + (e && e.message));
					}
				}
			});
			if (value !== undefined) {
				onSet(value);
			}
			return true;
		} catch (e) {
			miss(name, 'trap failed: ' + (e && e.message));
			return false;
		}
	}

	(function () {
		var MID = 'Printing/Scripts/Classes/DomToSVG';
		var requested = false;

		function forceLight(captureDoc, element) {
			var docs = [captureDoc];
			try {
				var frames = element && element.querySelectorAll ? element.querySelectorAll('iframe') : [];
				for (var i = 0; i < frames.length; i++) {
					try {
						if (frames[i].contentDocument) {
							docs.push(frames[i].contentDocument);
						}
					} catch (e) {}
				}
			} catch (e) {}
			var restores = [];
			docs.forEach(function (d) {
				var root = d && d.documentElement;
				if (!root || root.getAttribute('data-theme') !== 'dark') {
					return;
				}
				var prevStyleAttr = root.getAttribute('style');
				var prevScheme = root.style.colorScheme;
				root.setAttribute('data-theme', 'light');
				root.style.colorScheme = 'light';
				restores.push(function () {
					root.setAttribute('data-theme', 'dark');
					if (prevStyleAttr === null) {
						root.removeAttribute('style');
					} else {
						root.style.colorScheme = prevScheme;
					}
				});
			});
			return function () {
				for (var i = restores.length - 1; i >= 0; i--) {
					try {
						restores[i]();
					} catch (e) {}
				}
			};
		}

		function wrap(instance) {
			var proto = instance && Object.getPrototypeOf(instance);
			if (!proto || typeof proto._setInlineStyles !== 'function') {
				miss('DomToSVG', '_setInlineStyles missing');
				return;
			}
			if (proto._setInlineStyles.__dmWrapped) {
				return;
			}
			var native = proto._setInlineStyles;
			var depth = 0;
			var wrapped = function _setInlineStyles(elem, origElem) {
				if (depth > 0) {
					return native.apply(this, arguments);
				}
				var restore = null;
				try {
					restore = forceLight(origElem && origElem.ownerDocument, origElem);
					appState.domToSvg.captures++;
				} catch (e) {}
				depth++;
				try {
					return native.apply(this, arguments);
				} finally {
					depth--;
					if (restore) {
						restore();
					}
				}
			};
			wrapped.__dmWrapped = true;
			proto._setInlineStyles = wrapped;
			appState.domToSvg.wrapped = true;
		}

		function ensure() {
			if (requested || !isDark()) {
				return;
			}
			var req = w.require;
			if (typeof req !== 'function' || typeof req.toUrl !== 'function' || typeof w.define !== 'function') {
				return;
			}
			var url = '';
			try {
				url = req.toUrl(MID);
			} catch (e) {}
			if (!/aras\.innovator\.Printing/i.test(url)) {
				return;
			}
			requested = true;
			try {
				req([MID], function (instance) {
					try {
						wrap(instance);
					} catch (e) {
						miss('DomToSVG', 'wrap failed: ' + (e && e.message));
					}
				});
			} catch (e) {
				miss('DomToSVG', 'require failed: ' + (e && e.message));
			}
		}

		function later() {
			setTimeout(ensure, 1500);
		}
		if (doc.readyState === 'complete') {
			later();
		} else {
			w.addEventListener('load', later);
		}
		onThemeChange(function (dark) {
			if (dark) {
				ensure();
			}
		});
		dm.domToSvg = { forceLight: forceLight, wrap: wrap };
	})();

	(function () {
		var STYLE_ATTR = 'data-aras-darkmode';

		function editorCss() {
			var surface = cssToken('--dm-surface', '#1e2027');
			var text = cssToken('--dm-text', '#dde0e8');
			var link = cssToken('--dm-link', '#9fb3ee');
			return (
				'body:not([style*="background-color"]) { color-scheme: dark; background-color: ' + surface +
				'; color: ' + text + '; }\n' +
				'body:not([style*="background-color"]) a { color: ' + link + '; }\n'
			);
		}

		function styleEditor(widget) {
			var editDoc = widget.document || (widget.iframe && widget.iframe.contentDocument);
			if (!editDoc || !editDoc.head) {
				return;
			}
			var node = editDoc.head.querySelector('style[' + STYLE_ATTR + '="editor"]');
			var dark = isDark();
			if (!node && !dark) {
				return;
			}
			if (!node) {
				node = editDoc.createElement('style');
				node.setAttribute(STYLE_ATTR, 'editor');
				editDoc.head.appendChild(node);
			}
			node.textContent = dark ? editorCss() : '';
			appState.htmlEditor.styled++;
		}

		function isRichText(widget) {
			return !!(
				widget &&
				widget.onLoadDeferred &&
				typeof widget.execCommand === 'function' &&
				typeof widget.getValue === 'function'
			);
		}

		function attach(widget) {
			if (!isRichText(widget) || widget.__dmEditor) {
				return;
			}
			widget.__dmEditor = true;
			var d = widget.onLoadDeferred;
			var run = function (r) {
				try {
					styleEditor(widget);
				} catch (e) {}
				return r;
			};
			if (typeof d.addCallback === 'function') {
				d.addCallback(run);
			} else if (typeof d.then === 'function') {
				d.then(run);
			}
		}

		function findWidget(control, options) {
			var reg = w.dijit && (w.dijit.registry || w.dijit);
			var byId = reg && (reg.byId || (w.dijit && w.dijit.byId));
			if (typeof byId !== 'function') {
				return null;
			}
			var ids = [];
			if (control && control.propsId_Experimental) {
				ids.push(control.propsId_Experimental);
			}
			if (options && options.id) {
				ids.push(options.id);
			}
			for (var i = 0; i < ids.length; i++) {
				var wdg = byId.call(reg, ids[i]);
				if (isRichText(wdg)) {
					return wdg;
				}
			}
			return isRichText(control) ? control : null;
		}

		function wrapFactory(proto) {
			if (!proto || typeof proto.createControl !== 'function') {
				miss('HtmlEditor', 'ClientControlsFactory.prototype.createControl missing');
				return;
			}
			if (proto.createControl.__dmWrapped) {
				return;
			}
			var native = proto.createControl;
			var wrapped = function createControl(type, options) {
				var p = native.apply(this, arguments);
				if (typeof type === 'string' && /HtmlEditor/i.test(type) && p && typeof p.then === 'function') {
					p.then(function (control) {
						try {
							attach(findWidget(control, options));
						} catch (e) {}
					});
				}
				return p;
			};
			wrapped.__dmWrapped = true;
			proto.createControl = wrapped;
			appState.htmlEditor.hooked = true;
		}

		trapGlobal('clientControlsFactory', function (instance) {
			if (instance) {
				wrapFactory(Object.getPrototypeOf(instance));
			}
		});
		doc.addEventListener('DOMContentLoaded', function () {
			try {
				if (typeof w.ClientControlsFactory === 'function') {
					wrapFactory(w.ClientControlsFactory.prototype);
				}
			} catch (e) {}
		});

		onThemeChange(function () {
			var reg = w.dijit && w.dijit.registry;
			if (!reg || typeof reg.toArray !== 'function') {
				return;
			}
			reg.toArray().forEach(function (widget) {
				if (isRichText(widget)) {
					try {
						attach(widget);
						styleEditor(widget);
					} catch (e) {}
				}
			});
		});
		dm.htmlEditor = { styleEditor: styleEditor, wrapFactory: wrapFactory, editorCss: editorCss };
	})();

	(function () {
		var CONFIG = kitUrl('pdftron-dark-config.js');
		function wrapViewer(ns) {
			var WV = ns && ns.WebViewer;
			var proto = WV && WV.prototype;
			if (!proto) {
				return;
			}
			if (typeof proto._create !== 'function') {
				miss('pdftron', 'WebViewer.prototype._create missing');
				return;
			}
			if (proto._create.__dmWrapped) {
				return;
			}
			var native = proto._create;
			var wrapped = function _create() {
				try {
					if (isDark() && CONFIG && this.options && !this.options.config) {
						this.options.config = CONFIG;
						appState.pdftron.configured++;
					}
				} catch (e) {}
				return native.apply(this, arguments);
			};
			wrapped.__dmWrapped = true;
			proto._create = wrapped;
			appState.pdftron.wrapped = true;
		}
		if (!CONFIG) {
			miss('pdftron', 'dm-boot.js URL unknown; config path not derivable');
		}
		trapGlobal('PDFTron', wrapViewer);
	})();

	(function () {
		var monacoState = appState.monaco;
		var defaultThemed = false;
		try {
			if (/\/CodeEditor\/MethodEditor\.html$/i.test(w.location.pathname) && w.MonacoEnvironment === undefined) {
				w.MonacoEnvironment = { globalAPI: true };
				monacoState.envPreset = true;
			}
		} catch (e) {}

		function hook(monaco) {
			var ed = monaco && monaco.editor;
			if (!ed || typeof ed.create !== 'function') {
				miss('monaco', 'monaco.editor.create missing');
				return;
			}
			monacoState.captured = true;
			if (ed.create.__dmWrapped) {
				return;
			}
			var native = ed.create;
			var wrapped = function create(el, options) {
				var args = Array.prototype.slice.call(arguments);
				try {
					if (!options || options.theme === undefined || options.theme === null) {
						defaultThemed = true;
						if (isDark()) {
							var copy = {};
							for (var k in options || {}) {
								if (Object.prototype.hasOwnProperty.call(options, k)) {
									copy[k] = options[k];
								}
							}
							copy.theme = 'vs-dark';
							args[1] = copy;
						}
					}
				} catch (e) {}
				monacoState.created++;
				return native.apply(this, args);
			};
			wrapped.__dmWrapped = true;
			try {
				ed.create = wrapped;
			} catch (e) {
				miss('monaco', 'editor.create not writable');
			}
		}
		trapGlobal('monaco', function (m) {
			if (m) {
				hook(m);
			}
		});
		onThemeChange(function (dark) {
			var m = w.monaco;
			if (defaultThemed && m && m.editor && typeof m.editor.setTheme === 'function') {
				m.editor.setTheme(dark ? 'vs-dark' : 'vs');
			}
		});
	})();

	(function () {
		var aceState = appState.ace;
		var DARK = 'ace/theme/tomorrow_night';
		var LIGHT_DEFAULT = 'ace/theme/textmate';
		var renderers = [];
		var nativeSetTheme = null;
		var urlRegistered = false;

		function isLightDefault(theme) {
			return theme === undefined || theme === null || theme === '' || theme === LIGHT_DEFAULT || theme === 'textmate';
		}

		function themeUrl() {
			try {
				var scripts = doc.getElementsByTagName('script');
				for (var i = 0; i < scripts.length; i++) {
					if (/\/ace-editor\/ace\.js(\?.*)?$/i.test(scripts[i].src)) {
						return scripts[i].src.replace(/ace\.js(\?.*)?$/i, 'theme-tomorrow_night.js');
					}
				}
			} catch (e) {}
			return kitUrl('../vendors/ace-editor/theme-tomorrow_night.js');
		}

		function register(ace) {
			if (urlRegistered) {
				return;
			}
			try {
				var url = themeUrl();
				if (url && ace.config && typeof ace.config.setModuleUrl === 'function') {
					ace.config.setModuleUrl(DARK, url);
					urlRegistered = true;
				} else {
					miss('ace', 'ace.config.setModuleUrl missing');
				}
			} catch (e) {}
		}

		function pick(renderer, requested) {
			var d = renderer && renderer.container ? renderer.container.ownerDocument : doc;
			if (isDark(d) && isLightDefault(requested)) {
				register(w.ace);
				return DARK;
			}
			return requested;
		}

		function wrap(ace) {
			if (aceState.wrapped || !ace || typeof ace.require !== 'function') {
				return;
			}
			var mod = null;
			try {
				mod = ace.require('ace/virtual_renderer');
			} catch (e) {}
			var proto = mod && mod.VirtualRenderer && mod.VirtualRenderer.prototype;
			if (!proto || typeof proto.setTheme !== 'function') {
				miss('ace', 'ace/virtual_renderer VirtualRenderer.prototype.setTheme missing');
				return;
			}
			if (proto.setTheme.__dmWrapped) {
				aceState.wrapped = true;
				return;
			}
			nativeSetTheme = proto.setTheme;
			var wrapped = function setTheme(theme) {
				var args = Array.prototype.slice.call(arguments);
				try {
					if (!this.__dmAce) {
						this.__dmAce = true;
						renderers.push(typeof WeakRef === 'function' ? new WeakRef(this) : { deref: (function (r) { return function () { return r; }; })(this) });
						aceState.renderers++;
					}
					this.__dmRequested = theme;
					args[0] = pick(this, theme);
				} catch (e) {}
				return nativeSetTheme.apply(this, args);
			};
			wrapped.__dmWrapped = true;
			proto.setTheme = wrapped;
			aceState.wrapped = true;
		}

		aceState.trapped = trapGlobal('ace', function (ace) {
			if (!ace || aceState.wrapped) {
				return;
			}
			wrap(ace);
			if (!aceState.wrapped) {
				var retry = function () {
					wrap(w.ace);
				};
				if (typeof Promise === 'function') {
					Promise.resolve().then(retry);
				} else {
					setTimeout(retry, 0);
				}
			}
		});

		onThemeChange(function () {
			var keep = [];
			for (var i = 0; i < renderers.length; i++) {
				var r = renderers[i].deref();
				if (!r) {
					continue;
				}
				keep.push(renderers[i]);
				if (isLightDefault(r.__dmRequested) && nativeSetTheme) {
					try {
						nativeSetTheme.call(r, pick(r, r.__dmRequested === undefined ? LIGHT_DEFAULT : r.__dmRequested));
					} catch (e) {}
				}
			}
			renderers = keep;
		});
	})();
})();
