(function () {
  'use strict';
  var w = typeof window !== 'undefined' ? window : null;
  if (!w || w.__dmHookSheets) return;

  var VERSION = 1;
  var MISS_CAP = 400;
  var INSERT_RULE_MISS_CAP = 50;

  var stats = {
    version: VERSION,
    installed: false,
    calls: 0,
    hits: 0,
    misses: 0,
    clean: 0,
    skipped: 0,
    errors: 0,
    preHook: 0,
    timeMs: 0,
    hitKeys: []
  };

  var imul = Math.imul;
  function fnv1a32(str) {
    var h = 0x811c9dc5;
    for (var i = 0, n = str.length; i < n; i++) {
      h ^= str.charCodeAt(i);
      h = imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function keyOf(str) { return fnv1a32(str) + ':' + str.length; }

  var COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|:\s*(?:white|black|red|green|blue|gr[ae]y|silver|orange|yellow|navy|maroon|purple|teal|olive|lime|aqua|fuchsia|coral|transparent|buttonface|buttontext|buttonborder|canvas|canvastext|field|fieldtext|highlight|highlighttext|graytext|window|windowtext|threedface|threedshadow|threedhighlight)\b/i;
  function hasColour(text) { return COLOUR_RE.test(text); }

  function dmNs() {
    var dm = w.__dm;
    if (!dm || typeof dm !== 'object') {
      try { dm = w.__dm = {}; } catch (e) { return null; }
    }
    if (!dm.misses || typeof dm.misses.push !== 'function') {
      try { dm.misses = []; } catch (e) {  }
    }
    return dm;
  }

  var sheetsMap = null;
  function getSheets() {
    if (sheetsMap) return sheetsMap;
    var data = null;
    try {
      var dm = w.__dm;
      data = (dm && dm.data) || w.__dmData || null;
      if (!data || !data.sheets) {
        var t = w.top;
        if (t && t !== w) data = (t.__dm && t.__dm.data) || t.__dmData || data;
      }
    } catch (e) {  }
    if (data && data.sheets && typeof data.sheets === 'object') sheetsMap = data.sheets;
    return sheetsMap;
  }

  var missSeen = Object.create(null);
  var missCount = 0;
  var insertRuleMisses = 0;
  function recordMiss(rec) {
    if (missSeen[rec.key]) return;
    missSeen[rec.key] = 1;
    if (missCount >= MISS_CAP) return;
    if (rec.via === 'insertRule') {
      if (insertRuleMisses >= INSERT_RULE_MISS_CAP) return;
      insertRuleMisses++;
    }
    missCount++;
    var dm = dmNs();
    try { if (dm && dm.misses) dm.misses.push(rec); } catch (e) {  }
  }

  function applyEdits(text, edits) {
    if (!edits || typeof edits.length !== 'number') return null;
    var out = '';
    var pos = 0;
    for (var i = 0; i < edits.length; i++) {
      var e = edits[i];
      if (!e) return null;
      var s = e[0], en = e[1], r = e[2];
      if (typeof s !== 'number' || typeof en !== 'number' || typeof r !== 'string' ||
          s < pos || en < s || en > text.length) return null;
      out += text.slice(pos, s) + r;
      pos = en;
    }
    return out + text.slice(pos);
  }

  var cache = new Map();
  var hitKeySeen = Object.create(null);
  var now = (w.performance && typeof w.performance.now === 'function')
    ? function () { return w.performance.now(); } : function () { return Date.now(); };

  function rewrite(text, via) {
    stats.calls++;
    if (typeof text !== 'string') { stats.skipped++; return text; }
    var t0 = now();
    try {
      var c = cache.get(text);
      if (c !== undefined) {
        if (c.hit) stats.hits++; else if (c.miss) stats.misses++; else stats.clean++;
        return c.out;
      }
      var sheets = getSheets();
      var key = keyOf(text);
      var entry = sheets ? sheets[key] : undefined;
      var res;
      if (entry !== undefined && Object.prototype.hasOwnProperty.call(sheets, key)) {
        var out = applyEdits(text, entry);
        if (out === null) {
          stats.skipped++;
          recordMiss({ hook: 'hook-stylesheets', via: via, key: key, length: text.length,
            reason: 'invalid edits', sample: text.slice(0, 120) });
          res = { out: text, hit: false, miss: false };
        } else {
          stats.hits++;
          if (!hitKeySeen[key]) { hitKeySeen[key] = 1; stats.hitKeys.push(key); }
          res = { out: out, hit: true, miss: false };
        }
      } else if (hasColour(text)) {
        stats.misses++;
        recordMiss({ hook: 'hook-stylesheets', via: via, key: key, length: text.length,
          sample: text.slice(0, 120), reason: sheets ? 'no entry' : 'no data' });
        res = { out: text, hit: false, miss: true };
      } else {
        stats.clean++;
        res = { out: text, hit: false, miss: false };
      }
      if (via !== 'insertRule') cache.set(text, res);
      return res.out;
    } catch (err) {
      stats.errors++;
      return text;
    } finally {
      stats.timeMs += now() - t0;
    }
  }

  var CSSProto = w.CSSStyleSheet && w.CSSStyleSheet.prototype;
  if (!CSSProto) {
    var dm0 = dmNs();
    try { if (dm0) dm0.misses.push({ hook: 'hook-stylesheets', reason: 'no CSSStyleSheet' }); } catch (e) {  }
    w.__dmHookSheets = stats;
    return;
  }

  var originals = {};
  var processed = typeof WeakSet === 'function' ? new WeakSet() : null;

  function wrapMethod(name, via, argIndex) {
    var desc = Object.getOwnPropertyDescriptor(CSSProto, name);
    if (!desc || typeof desc.value !== 'function') return false;
    var orig = desc.value;
    if (orig.__dmWrapped) return true;
    originals[name] = orig;
    var wrapper = function () {
      var args = Array.prototype.slice.call(arguments);
      if (args.length > argIndex) {
        try {
          args[argIndex] = rewrite(args[argIndex], via);
          if (processed && name !== 'insertRule' && this && typeof this === 'object') processed.add(this);
        } catch (e) { stats.errors++; }
      }
      return orig.apply(this, args);
    };
    try {
      Object.defineProperty(wrapper, 'name', { value: name, configurable: true });
      Object.defineProperty(wrapper, 'length', { value: orig.length, configurable: true });
      Object.defineProperty(wrapper, '__dmWrapped', { value: orig });
    } catch (e) {  }
    Object.defineProperty(CSSProto, name, {
      value: wrapper,
      writable: desc.writable,
      enumerable: desc.enumerable,
      configurable: desc.configurable
    });
    return true;
  }

  try {
    var ok1 = wrapMethod('replaceSync', 'replaceSync', 0);
    var ok2 = wrapMethod('replace', 'replace', 0);
    var ok3 = wrapMethod('insertRule', 'insertRule', 0);
    stats.installed = !!(ok1 && ok2);
    stats.wrapped = { replaceSync: ok1, replace: ok2, insertRule: ok3 };
    if (!ok1 || !ok2) {
      var dm1 = dmNs();
      if (dm1) dm1.misses.push({ hook: 'hook-stylesheets', reason: 'replaceSync/replace not wrappable' });
    }
  } catch (e) {
    stats.errors++;
  }

  function serialise(sheet) {
    var s = '';
    try {
      var rules = sheet.cssRules;
      for (var i = 0; i < rules.length; i++) s += rules[i].cssText + '\n';
    } catch (e) {  }
    return s;
  }
  function checkSheets(list, where) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var sh = list[i];
      if (!sh || (processed && processed.has(sh))) continue;
      if (processed) processed.add(sh);
      var text = serialise(sh);
      if (!text || text.indexOf('var(--dm-') !== -1 || !hasColour(text)) continue;
      stats.preHook++;
      recordMiss({ hook: 'hook-stylesheets', via: 'preHook', key: 'prehook:' + keyOf(text),
        length: text.length, where: where, reason: 'constructed before hook (text not keyable)',
        sample: text.slice(0, 120) });
    }
  }
  function walk(root, depth) {
    if (depth > 30 || !root || !root.querySelectorAll) return;
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var sr = all[i].shadowRoot;
      if (sr) {
        checkSheets(sr.adoptedStyleSheets, 'shadow:' + all[i].localName);
        walk(sr, depth + 1);
      }
    }
  }
  function sweep() {
    try {
      var d = w.document;
      if (!d) return;
      checkSheets(d.adoptedStyleSheets, 'document');
      walk(d, 0);
    } catch (e) { stats.errors++; }
  }
  stats.sweep = sweep;
  try {
    var doc = w.document;
    if (doc && doc.addEventListener) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', sweep, { once: true });
      else sweep();
    }
  } catch (e) { stats.errors++; }

  stats.fnv1a32 = fnv1a32;
  stats.keyOf = keyOf;
  stats.originals = originals;
  w.__dmHookSheets = stats;
})();
