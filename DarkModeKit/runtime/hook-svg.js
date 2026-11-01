;(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : this;
	if (!w || w.__dmH2Svg) {
		return;
	}
	w.__dmH2Svg = true;

	var dm = w.__dm || (w.__dm = { misses: [] });
	if (!dm.misses) {
		dm.misses = [];
	}
	var state = (dm.h2 = dm.h2 || {});
	var svgState = (state.svg = {
		installed: false,
		fetchHooked: false,
		parseHooked: false,
		attrVarSupported: null,
		responsesThemed: 0,
		parsesThemed: 0,
		symbolsThemed: 0
	});

	function miss(reason) {
		try {
			dm.misses.push({ hook: 'svg', reason: String(reason) });
		} catch (e) {}
	}

	var COLOR_ATTRS = ['fill', 'stroke', 'stop-color'];
	var WHITE = '#ffffff';
	var NAMED = { white: '#ffffff', black: '#000000' };

	function norm(raw) {
		var c = String(raw).trim().toLowerCase();
		if (NAMED.hasOwnProperty(c)) {
			return NAMED[c];
		}
		if (/^#[0-9a-f]{3}$/.test(c)) {
			return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
		}
		return c;
	}

	var TAG_RE = /<([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)(\s*)(\/?)>/g;
	var ATTR_RE = /(\s)(fill|stroke|stop-color)(\s*=\s*)(["'])([^"']*)\4/gi;
	var STYLE_COLOR_RE = /((?:^|[;{\s])(?:fill|stroke|stop-color)\s*:\s*)(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|white\b|black\b)/gi;

	function rewriteSvg(src, fn, rootExtra, rootTag) {
		var kept = [];
		var s = src.replace(/<!--[\s\S]*?-->|<(clipPath|mask)\b[\s\S]*?<\/\1>/gi, function (m) {
			return '\u0000' + (kept.push(m) - 1) + '\u0000';
		});
		var seenRoot = false;
		var whiteIndex = 0;
		s = s.replace(TAG_RE, function (tagText, tag, attrs, ws, selfClose) {
			var isRoot = !seenRoot && tag.toLowerCase() === rootTag;
			if (isRoot) {
				seenRoot = true;
			}
			var found = [];
			attrs.replace(ATTR_RE, function (m, sp, name, eq, q, val, offset) {
				found.push({ name: name.toLowerCase(), val: val, offset: offset });
				return m;
			});
			found.sort(function (a, b) {
				return COLOR_ATTRS.indexOf(a.name) - COLOR_ATTRS.indexOf(b.name) || a.offset - b.offset;
			});
			var replacement = {};
			var replaced = 0;
			for (var i = 0; i < found.length; i++) {
				var f = found[i];
				var value = norm(f.val);
				var isWhite = value === WHITE;
				var out = fn({
					tag: tag,
					isRoot: isRoot,
					attr: f.name,
					raw: f.val,
					value: value,
					whiteIndex: isWhite && !isRoot ? whiteIndex++ : -1
				});
				if (out !== undefined && out !== f.val) {
					replacement[f.offset] = out;
					replaced++;
				}
			}
			var newAttrs = attrs.replace(ATTR_RE, function (m, sp, name, eq, q, val, offset) {
				return replacement.hasOwnProperty(offset) ? sp + name + eq + q + replacement[offset] + q : m;
			});
			var extra = isRoot && rootExtra ? rootExtra(attrs) || '' : '';
			if (!replaced && !extra) {
				return tagText;
			}
			newAttrs += extra;
			return '<' + tag + newAttrs + ws + (selfClose ? '/' : '') + '>';
		});
		return s.replace(/\u0000(\d+)\u0000/g, function (m, i) {
			return kept[+i];
		});
	}

	function rewriteSvgStyles(src, fn) {
		var sub = function (css) {
			return css.replace(STYLE_COLOR_RE, function (m, pre, c) {
				var out = fn(norm(c), c);
				return out === undefined ? m : pre + out;
			});
		};
		return src
			.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, function (m, a, css, b) {
				return a + sub(css) + b;
			})
			.replace(/(\sstyle\s*=\s*)(["'])([^"']*)\2/gi, function (m, a, q, css) {
				return a + q + sub(css) + q;
			});
	}

	function has(list, x) {
		return Array.isArray(list) && list.indexOf(x) !== -1;
	}

	function prepare(icons) {
		var m = icons && typeof icons === 'object' ? icons : {};
		return {
			__prepared: true,
			vars: m.vars || {},
			aliases: m.aliases || {},
			cutout: m.cutout || {},
			cutoutVar: m.cutoutVar || '--dm-svg-cutout',
			noRemap: (m.noRemap || ['headerlogonash']).map(function (x) {
				return String(x).toLowerCase();
			}),
			logos: m.logos && m.logos.ids ? m.logos : { ids: [], colors: [], var: '' },
			nofill: m.nofill || {},
			styled: m.styled || [],
			empty: !m.vars && !m.cutout && !m.nofill && !(m.logos && m.logos.ids)
		};
	}

	function themeSymbolText(svgText, id, map, rootTag) {
		rootTag = rootTag || 'svg';
		id = String(id).toLowerCase();
		if (has(map.noRemap, id)) {
			return svgText;
		}
		var cut = map.cutout[id] || [];
		var isLogo = has(map.logos.ids, id);
		var nf = map.nofill[id];
		var rootRe = rootTag === 'svg' ? /<svg\b[^>]*>/ : /<symbol\b[^>]*>/;
		var hasFill = /\sfill\s*=/.test(svgText.replace(rootRe, '')) || has(map.styled, id);
		var v = function (name, raw) {
			return 'var(' + name + ', ' + raw + ')';
		};
		var out = rewriteSvg(
			svgText,
			function (o) {
				if (o.value.indexOf('var(') === 0) {
					return undefined;
				}
				if (o.value === WHITE) {
					return o.whiteIndex >= 0 && has(cut, o.whiteIndex) ? v(map.cutoutVar, o.raw) : undefined;
				}
				if (nf && o.value === norm(nf.light)) {
					return v(nf.var, o.raw);
				}
				var c = map.aliases[o.value] || o.value;
				if (isLogo) {
					return has(map.logos.colors, c) ? v(map.logos.var, o.raw) : undefined;
				}
				return map.vars[c] ? v(map.vars[c], o.raw) : undefined;
			},
			nf && !hasFill
				? function (attrs) {
						return /\sfill\s*=/.test(attrs) ? '' : ' fill="' + v(nf.var, nf.light) + '"';
				  }
				: null,
			rootTag
		);
		if (has(map.styled, id)) {
			out = rewriteSvgStyles(out, function (c, raw) {
				var cc = map.aliases[c] || c;
				if (cc === WHITE) {
					return undefined;
				}
				if (isLogo) {
					return has(map.logos.colors, cc) ? v(map.logos.var, raw) : undefined;
				}
				return map.vars[cc] ? v(map.vars[cc], raw) : undefined;
			});
		}
		return out;
	}

	var SYMBOL_RE = /<symbol\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/symbol>/gi;
	var SYMBOL_ID_RE = /^<symbol\b(?:[^>"']|"[^"]*"|'[^']*')*?\sid\s*=\s*(["'])([^"']*)\1/i;

	function themeText(text, icons) {
		var map = icons && icons.__prepared ? icons : prepare(icons);
		var result = { text: text, symbols: 0 };
		if (typeof text !== 'string' || map.empty || text.indexOf('<symbol') === -1) {
			return result;
		}
		result.text = text.replace(SYMBOL_RE, function (sym) {
			var m = SYMBOL_ID_RE.exec(sym);
			var id = m ? m[2] : '';
			if (!/^svg-/i.test(id) || sym.indexOf('var(--dm-svg-') !== -1 || sym.indexOf('var(' + map.cutoutVar + ',') !== -1) {
				return sym;
			}
			var out = themeSymbolText(sym, id.slice(4), map, 'symbol');
			if (out !== sym) {
				result.symbols++;
			}
			return out;
		});
		return result;
	}

	var prepared = null;
	function getPrepared() {
		if (prepared) {
			return prepared;
		}
		var data = dm.data || w.__dmData;
		if (!data) {
			try {
				data = w.top && w.top !== w ? w.top.__dmData : null;
			} catch (e) {}
		}
		var icons = data && data.icons;
		if (!icons) {
			miss('no icon map (__dm.data.icons)');
		}
		prepared = prepare(icons);
		return prepared;
	}

	dm.svg = {
		themeText: themeText,
		themeSymbolText: themeSymbolText,
		rewriteSvg: rewriteSvg,
		rewriteSvgStyles: rewriteSvgStyles,
		prepare: prepare,
		norm: norm
	};

	if (typeof w.document === 'undefined' || typeof w.fetch !== 'function') {
		return;
	}
	var doc = w.document;

	function probeAttrVar() {
		if (svgState.attrVarSupported !== null) {
			return;
		}
		var ok = true;
		try {
			var NS = 'http://www.w3.org/2000/svg';
			var svg = doc.createElementNS(NS, 'svg');
			svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;--dm-h2-probe:rgb(1, 2, 3)');
			var rect = doc.createElementNS(NS, 'rect');
			rect.setAttribute('fill', 'var(--dm-h2-probe, rgb(4, 5, 6))');
			svg.appendChild(rect);
			(doc.body || doc.documentElement).appendChild(svg);
			var fill = w.getComputedStyle(rect).fill;
			svg.parentNode.removeChild(svg);
			ok = /1,\s*2,\s*3/.test(fill);
		} catch (e) {
			ok = true;
		}
		svgState.attrVarSupported = ok;
		if (!ok) {
			miss('presentation-attribute var() not resolved by this engine; sprite icons stay light');
		}
	}

	var lastThemed = null;
	function themeSprite(text) {
		var map = getPrepared();
		if (map.empty) {
			return text;
		}
		probeAttrVar();
		var r = themeText(text, map);
		if (r.text !== text) {
			svgState.symbolsThemed += r.symbols;
			lastThemed = r.text;
		}
		return r.text;
	}

	var SPRITE_URL_RE = /\/include\.aspx\?(?:[^#]*&)?svg=/i;

	try {
		var nativeFetch = w.fetch;
		var wrappedFetch = function fetch(input) {
			var url = '';
			try {
				url = typeof input === 'string' ? input : input && (input.url || String(input));
			} catch (e) {}
			var promise = nativeFetch.apply(this, arguments);
			if (!url || !SPRITE_URL_RE.test(url)) {
				return promise;
			}
			return promise.then(function (response) {
				try {
					if (!response || !response.ok || typeof w.Response !== 'function') {
						return response;
					}
					return response
						.clone()
						.text()
						.then(function (text) {
							var themed = themeSprite(text);
							if (themed === text) {
								return response;
							}
							var headers = new w.Headers(response.headers);
							headers.delete('content-length');
							headers.delete('content-encoding');
							svgState.responsesThemed++;
							return new w.Response(themed, {
								status: response.status,
								statusText: response.statusText,
								headers: headers
							});
						})
						.catch(function (e) {
							miss('sprite rewrite failed: ' + (e && e.message));
							return response;
						});
				} catch (e) {
					miss('sprite rewrite failed: ' + (e && e.message));
					return response;
				}
			});
		};
		wrappedFetch.__dmWrapped = true;
		w.fetch = wrappedFetch;
		svgState.fetchHooked = true;
	} catch (e) {
		miss('fetch not hookable: ' + (e && e.message));
	}

	try {
		var DP = w.DOMParser && w.DOMParser.prototype;
		var nativeParse = DP && DP.parseFromString;
		if (typeof nativeParse === 'function') {
			DP.parseFromString = function parseFromString(text, type) {
				if (
					type === 'text/html' &&
					typeof text === 'string' &&
					text !== lastThemed &&
					text.indexOf('<symbol id="svg-') !== -1
				) {
					try {
						var themed = themeSprite(text);
						if (themed !== text) {
							svgState.parsesThemed++;
							var args = Array.prototype.slice.call(arguments);
							args[0] = themed;
							return nativeParse.apply(this, args);
						}
					} catch (e) {
						miss('sprite parse rewrite failed: ' + (e && e.message));
					}
				}
				return nativeParse.apply(this, arguments);
			};
			svgState.parseHooked = true;
		} else {
			miss('DOMParser.prototype.parseFromString missing');
		}
	} catch (e) {
		miss('DOMParser not hookable: ' + (e && e.message));
	}

	svgState.installed = svgState.fetchHooked || svgState.parseHooked;
})();
