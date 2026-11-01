(function () {
	'use strict';
	var w = typeof window !== 'undefined' ? window : null;
	if (!w || w.__dmThemeMenu) {
		return;
	}
	w.__dmThemeMenu = true;

	var TOOLBAR_ID = 'headerCommandsBar';
	var USER_MENU_CLASS = 'aras-header__user-menu';
	var GROUP = 'dm_theme_group';
	var PARENT_ID = 'dm_theme';
	var SEPARATOR_ID = 'dm_theme_sep';
	var CHOICES = [
		{ id: 'dm_theme_light', pref: 'light', label: 'Light' },
		{ id: 'dm_theme_dark', pref: 'dark', label: 'Dark' },
		{ id: 'dm_theme_system', pref: 'system', label: 'Use system setting' }
	];
	var OWN_IDS = [PARENT_ID, SEPARATOR_ID].concat(
		CHOICES.map(function (c) {
			return c.id;
		})
	);
	var LOGOUT_PATTERN = /log\s*-?\s*(out|off)|sign\s*-?\s*out/i;

	function miss(reason) {
		try {
			var dm = w.__dm;
			if (dm && typeof dm.miss === 'function') {
				dm.miss('theme-menu', reason);
			} else if (dm && dm.misses) {
				dm.misses.push({ hook: 'theme-menu', reason: reason });
			}
		} catch (e) {}
	}

	function preference() {
		try {
			return w.arasTheme ? w.arasTheme.getPreference() : 'light';
		} catch (e) {
			return 'light';
		}
	}

	function hasClass(value, cls) {
		return (
			typeof value === 'string' &&
			(' ' + value + ' ').indexOf(' ' + cls + ' ') !== -1
		);
	}

	function findUserMenuId(toolbar) {
		var data = toolbar.data;
		if (!data || typeof data.forEach !== 'function') {
			return null;
		}
		var found = null;
		data.forEach(function (item, key) {
			if (
				!found &&
				item &&
				item.data instanceof Map &&
				(hasClass(item.cssClass, USER_MENU_CLASS) ||
					hasClass(item.buttonCssClass, USER_MENU_CLASS))
			) {
				found = key;
			}
		});
		if (found) {
			return found;
		}
		var node = toolbar.querySelector('.' + USER_MENU_CLASS);
		var holder = node && node.closest('[data-id]');
		var id = holder && holder.getAttribute('data-id');
		var item = id && data.get(id);
		return item && item.data instanceof Map ? id : null;
	}

	function findUserMenuIdSafe(toolbar) {
		try {
			return findUserMenuId(toolbar);
		} catch (e) {
			return null;
		}
	}

	function isSeparator(map, id) {
		var item = map.get(id);
		return !!item && item.type === 'separator';
	}

	function itemLabel(map, id) {
		var item = map.get(id) || {};
		return [id, item.name, item.label].join(' ');
	}

	function ensureInjected(toolbar) {
		var menuId = findUserMenuId(toolbar);
		if (!menuId) {
			return false;
		}
		var menu = toolbar.data.get(menuId);
		var map = menu.data;
		var changed = false;
		var pref = preference();

		if (!map.has(SEPARATOR_ID)) {
			map.set(SEPARATOR_ID, { id: SEPARATOR_ID, type: 'separator' });
			changed = true;
		}

		var children = CHOICES.map(function (c) {
			return c.id;
		});
		var parent = map.get(PARENT_ID);
		if (!parent || !Array.isArray(parent.children)) {
			map.set(PARENT_ID, {
				id: PARENT_ID,
				label: 'Theme',
				children: children
			});
			changed = true;
		}

		CHOICES.forEach(function (choice) {
			var existing = map.get(choice.id);
			var checked = choice.pref === pref;
			if (!existing || existing.checked !== checked) {
				map.set(choice.id, {
					id: choice.id,
					type: 'checkbox',
					group_id: GROUP,
					label: choice.label,
					checked: checked
				});
				changed = true;
			}
		});

		var roots = Array.isArray(menu.roots)
			? menu.roots.slice()
			: Array.from(map.keys()).filter(function (id) {
					return OWN_IDS.indexOf(id) === -1;
				});
		if (roots.indexOf(PARENT_ID) === -1) {
			roots = roots.filter(function (id) {
				return id !== SEPARATOR_ID;
			});
			var logoutIndex = -1;
			for (var i = 0; i < roots.length; i++) {
				if (LOGOUT_PATTERN.test(itemLabel(map, roots[i]))) {
					logoutIndex = i;
					break;
				}
			}
			if (logoutIndex === -1) {
				roots.push(SEPARATOR_ID, PARENT_ID);
			} else if (logoutIndex > 0 && isSeparator(map, roots[logoutIndex - 1])) {
				roots.splice(logoutIndex - 1, 0, SEPARATOR_ID, PARENT_ID);
			} else {
				roots.splice(logoutIndex, 0, PARENT_ID, SEPARATOR_ID);
			}
			menu.roots = roots;
			changed = true;
		}

		return changed;
	}

	function install(toolbar) {
		if (toolbar.__darkmodeThemeMenu) {
			return;
		}
		if (typeof toolbar.render !== 'function') {
			miss('anchor missing: headerCommandsBar.render');
			return;
		}
		toolbar.__darkmodeThemeMenu = true;

		var originalRender = toolbar.render;
		toolbar.render = function () {
			var injected = false;
			try {
				injected = ensureInjected(this);
			} catch (e) {
				miss('injection failed: ' + (e && e.message));
			}
			var result = originalRender.apply(this, arguments);
			if (!injected && !findUserMenuIdSafe(this) && result && result.then) {
				var self = this;
				result.then(function () {
					try {
						if (ensureInjected(self)) {
							originalRender.call(self);
						}
					} catch (e) {}
				});
			}
			return result;
		};

		toolbar.addEventListener('click', function (e) {
			var li = e.target && e.target.closest && e.target.closest('li[data-index]');
			if (!li || !w.arasTheme) {
				return;
			}
			var id = li.getAttribute('data-index');
			for (var i = 0; i < CHOICES.length; i++) {
				if (CHOICES[i].id === id) {
					w.arasTheme.setPreference(CHOICES[i].pref);
					toolbar.render();
					return;
				}
			}
		});

		w.addEventListener('aras-theme-change', function () {
			toolbar.render();
		});
		w.addEventListener('storage', function (e) {
			if (e.key === 'aras.colorScheme' || e.key === null) {
				toolbar.render();
			}
		});

		if (toolbar.data && toolbar.data.size) {
			toolbar.render();
		}
	}

	var started = false;
	function start() {
		if (started) {
			return;
		}
		var toolbar = w.document.getElementById(TOOLBAR_ID);
		if (!toolbar) {
			return;
		}
		started = true;
		var ready =
			w.customElements && typeof w.customElements.whenDefined === 'function'
				? w.customElements.whenDefined('aras-toolbar')
				: Promise.resolve();
		ready.then(function () {
			try {
				install(toolbar);
			} catch (e) {
				miss('install failed: ' + (e && e.message));
			}
		});
	}

	if (w.document.readyState === 'loading') {
		w.document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
	w.addEventListener('load', start, { once: true });
})();
