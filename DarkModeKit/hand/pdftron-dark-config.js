(function () {
	'use strict';
	if (window.__dmPdftronConfig) {
		return;
	}
	window.__dmPdftronConfig = true;

	var root = document.documentElement;

	function hostRoot() {
		var win = window;
		for (var i = 0; i < 8; i++) {
			try {
				if (!win.parent || win.parent === win) {
					return null;
				}
				win = win.parent;
				var r = win.document.documentElement;
				if (r && r.getAttribute('data-theme')) {
					return r;
				}
			} catch (e) {
				return null;
			}
		}
		return null;
	}

	var host = hostRoot();

	function sync() {
		var theme = (host && host.getAttribute('data-theme')) || 'light';
		if (root.getAttribute('data-theme') !== theme) {
			root.setAttribute('data-theme', theme);
		}
	}
	sync();

	try {
		if (host && typeof MutationObserver === 'function') {
			new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['data-theme'] });
		}
	} catch (e) {}
	window.addEventListener('aras-theme-change', sync);

	var script = document.currentScript;
	var src = script && script.src;
	if (!src) {
		return;
	}
	var link = document.createElement('link');
	link.rel = 'stylesheet';
	link.setAttribute('data-aras-darkmode', 'pdftron');
	link.href = src.replace(/pdftron-dark-config\.js(\?.*)?$/, 'pdftron-dark.css$1');
	(document.head || root).appendChild(link);
})();
