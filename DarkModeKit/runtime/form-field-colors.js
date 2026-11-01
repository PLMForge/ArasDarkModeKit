(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : null;
	if (!w || w.__dmFormFieldColors) {
		return;
	}
	w.__dmFormFieldColors = { active: false, adapted: 0, vendor: 0 };
	var stats = w.__dmFormFieldColors;

	var EVENT = 'aras-theme-change';
	var SURFACE_FALLBACK = '#1e2027';
	var VENDOR_DEFAULTS = ['#333333', '#444444', '#000000'];
	var LABELS = [
		'.sys_f_label[style*="color"]',
		'.aras-field__label[style*="color"]',
		'.aras-field-xclasses legend > span[style*="color"]',
		'.sys_ft_label span[name]'
	].join(',');
	var FORM_MARKERS =
		'.sys_f_label, .aras-field__label, .sys_ft_label, fieldset.aras-field-xclasses';
	var STORE = 'dmLightColor';
	var VENDOR = 'dmVendorLabel';

	function miss(reason) {
		try {
			var dm = w.__dm;
			if (dm && typeof dm.miss === 'function') {
				dm.miss('form-field-colors', reason);
			}
		} catch (e) {}
	}

	function getTheme() {
		try {
			if (w.arasTheme && typeof w.arasTheme.get === 'function') {
				return w.arasTheme.get();
			}
		} catch (e) {}
		return w.document.documentElement.getAttribute('data-theme') || 'light';
	}

	function toHex(cssColor) {
		var m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
			cssColor || ''
		);
		if (!m) {
			return null;
		}
		if (
			m[4] !== undefined &&
			parseFloat(m[4]) < (m[4].charAt(m[4].length - 1) === '%' ? 100 : 1)
		) {
			return null;
		}
		return (
			'#' +
			[m[1], m[2], m[3]]
				.map(function (v) {
					var s = Math.min(255, +v).toString(16);
					return s.length < 2 ? '0' + s : s;
				})
				.join('')
		);
	}

	function getSurface() {
		var value = '';
		try {
			value = getComputedStyle(w.document.documentElement)
				.getPropertyValue('--dm-surface')
				.trim();
		} catch (e) {}
		if (/^#[0-9a-f]{6}$/i.test(value)) {
			return value;
		}
		try {
			var p = w.__dm && w.__dm.data && w.__dm.data.palette;
			var s = p && (p.surface || (p.tokens && p.tokens['--dm-surface']));
			if (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)) {
				return s;
			}
		} catch (e) {}
		return SURFACE_FALLBACK;
	}

	function hasCustomBackground(label) {
		var xclasses = label.closest('fieldset.aras-field-xclasses');
		if (xclasses) {
			return !!xclasses.style.backgroundColor;
		}
		var container = label.closest('[name]');
		var name = container && container.getAttribute('name');
		var targets = [label, container];
		if (name) {
			var more = container.querySelectorAll('.' + CSS.escape(name));
			for (var i = 0; i < more.length; i++) {
				targets.push(more[i]);
			}
		}
		return targets.some(function (el) {
			return (
				el &&
				getComputedStyle(el).getPropertyValue('--custom-bg-color').trim() !== ''
			);
		});
	}

	function applyDark() {
		var dm = w.__dm || {};
		var adapt = dm.adaptForDark;
		var contrast = dm.contrast;
		if (typeof adapt !== 'function' || typeof contrast !== 'function') {
			miss('__dm.adaptForDark missing');
			return;
		}
		var surface = getSurface();
		var labels = w.document.querySelectorAll(LABELS);
		for (var i = 0; i < labels.length; i++) {
			var label = labels[i];
			if (label.dataset[STORE] !== undefined || label.dataset[VENDOR] !== undefined) {
				continue;
			}
			var color = toHex(getComputedStyle(label).color);
			if (color && VENDOR_DEFAULTS.indexOf(color) !== -1) {
				if (label.style.getPropertyValue('color') === '') {
					label.dataset[VENDOR] = '';
					label.style.setProperty('color', 'var(--dm-text)', 'important');
					stats.vendor++;
				}
				continue;
			}
			if (!color || contrast(color, surface) >= 4.5 || hasCustomBackground(label)) {
				continue;
			}
			label.dataset[STORE] = label.style.getPropertyValue('color');
			label.style.setProperty(
				'color',
				adapt(color, { bg: surface, minContrast: 4.5, maxL: 1 }),
				'important'
			);
			stats.adapted++;
		}
	}

	function restoreLight() {
		var doc = w.document;
		var vendor = doc.querySelectorAll('[data-dm-vendor-label]');
		for (var i = 0; i < vendor.length; i++) {
			var label = vendor[i];
			delete label.dataset[VENDOR];
			label.style.removeProperty('color');
			if (!label.getAttribute('style')) {
				label.removeAttribute('style');
			}
		}
		var stored = doc.querySelectorAll('[data-dm-light-color]');
		for (var j = 0; j < stored.length; j++) {
			var el = stored[j];
			var original = el.dataset[STORE];
			delete el.dataset[STORE];
			if (original) {
				el.style.setProperty('color', original);
			} else {
				el.style.removeProperty('color');
			}
		}
	}

	function update() {
		try {
			if (getTheme() === 'dark') {
				applyDark();
			} else {
				restoreLight();
			}
		} catch (e) {
			miss('update threw: ' + (e && e.message));
		}
	}

	function isFormDocument() {
		try {
			return (
				typeof w.Field === 'function' ||
				!!w.document.querySelector(FORM_MARKERS)
			);
		} catch (e) {
			return false;
		}
	}

	function observe() {
		if (typeof w.MutationObserver !== 'function' || !w.document.body) {
			return;
		}
		var timer = 0;
		var mo = new w.MutationObserver(function () {
			if (timer || getTheme() !== 'dark') {
				return;
			}
			timer = setTimeout(function () {
				timer = 0;
				update();
			}, 50);
		});
		mo.observe(w.document.body, { childList: true, subtree: true });
		stats.observer = mo;
	}

	function start() {
		if (stats.active || !isFormDocument()) {
			return;
		}
		stats.active = true;
		w.addEventListener(EVENT, update);
		update();
		observe();
	}

	if (w.document.readyState === 'loading') {
		w.document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
	w.addEventListener('load', start, { once: true });
})();
