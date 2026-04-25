// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DMC App — UI Components
// Custom Select — div-based dark-theme dropdown
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function _injectCSS() {
  if (document.getElementById('dmc-ui-styles')) return;
  var s = document.createElement('style');
  s.id = 'dmc-ui-styles';
  s.textContent = [
    '.cs-wrap{position:relative;width:100%;}',
    '.cs-btn{display:flex;align-items:center;gap:6px;width:100%;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 10px 9px 12px;color:var(--white);font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;text-align:left;cursor:pointer;transition:border-color 0.15s;box-sizing:border-box;outline:none;line-height:1.3;}',
    '.cs-btn:hover{border-color:rgba(245,197,24,0.5);}',
    '.cs-btn:focus{border-color:var(--stripe);}',
    '.cs-btn.cs-open{border-color:var(--stripe);border-radius:var(--radius) var(--radius) 0 0;}',
    '.cs-lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;}',
    '.cs-lbl.cs-ph{color:var(--concrete-dim);}',
    '.cs-arr{font-size:9px;color:var(--concrete-dim);flex-shrink:0;transition:transform 0.15s;line-height:1;user-select:none;}',
    '.cs-btn.cs-open .cs-arr{transform:rotate(180deg);}',
    '.cs-drop{display:none;position:absolute;top:calc(100% - 1px);left:0;right:0;z-index:9000;background:var(--asphalt-mid);border:1px solid var(--stripe);border-top:none;border-radius:0 0 var(--radius) var(--radius);max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.6);}',
    '.cs-item{padding:8px 12px;font-family:\'DM Sans\',sans-serif;font-size:13px;color:var(--concrete);cursor:pointer;transition:background 0.1s,color 0.1s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cs-item:hover{background:rgba(245,197,24,0.1);color:var(--white);}',
    '.cs-item.cs-sel{color:var(--stripe);font-weight:700;background:rgba(245,197,24,0.06);}',
    '.cs-item.cs-hi{background:rgba(245,197,24,0.08);}',
  ].join('');
  (document.head || document.documentElement).appendChild(s);
})();

var _csActive = null;

document.addEventListener('mousedown', function(e) {
  if (_csActive && !_csActive.contains(e.target)) _csClose(_csActive);
}, true);

document.addEventListener('keydown', function(e) {
  if (!_csActive) return;
  var drop = _csActive.querySelector('.cs-drop');
  var items = Array.from(drop.querySelectorAll('.cs-item'));
  var hi = drop.querySelector('.cs-hi') || drop.querySelector('.cs-sel');
  var idx = hi ? items.indexOf(hi) : -1;
  if (e.key === 'Escape') { _csClose(_csActive); e.preventDefault(); }
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (hi) hi.classList.remove('cs-hi');
    var next = items[Math.min(idx + 1, items.length - 1)];
    if (next) { next.classList.add('cs-hi'); next.scrollIntoView({block:'nearest'}); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (hi) hi.classList.remove('cs-hi');
    var prev = items[Math.max(idx - 1, 0)];
    if (prev) { prev.classList.add('cs-hi'); prev.scrollIntoView({block:'nearest'}); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    var target = drop.querySelector('.cs-hi') || drop.querySelector('.cs-sel');
    if (target) target.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
  }
});

function _csClose(wrap) {
  if (!wrap) return;
  var btn = wrap.querySelector('.cs-btn');
  var drop = wrap.querySelector('.cs-drop');
  if (btn) btn.classList.remove('cs-open');
  if (drop) { drop.style.display = 'none'; drop.querySelectorAll('.cs-hi').forEach(function(el){el.classList.remove('cs-hi');}); }
  if (_csActive === wrap) _csActive = null;
}

// ── createCustomSelect ────────────────────────────────────────────────────────
// options  : [{value, label}] or ['string']
// value    : initial selected value
// onChange : function(value) called on selection
// placeholder : text shown when nothing selected
// Returns a DOM element with .getValue() and .setValue(v) methods

function createCustomSelect(options, value, onChange, placeholder) {
  var opts = (options || []).map(function(o) {
    return typeof o === 'string' ? {value: o, label: o} : o;
  });

  var cur = (value !== undefined && value !== null) ? String(value) : '';

  var wrap = document.createElement('div');
  wrap.className = 'cs-wrap';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  var lbl = document.createElement('span');
  lbl.className = 'cs-lbl';
  btn.appendChild(lbl);

  var arr = document.createElement('span');
  arr.className = 'cs-arr';
  arr.textContent = '▾';
  btn.appendChild(arr);

  var drop = document.createElement('div');
  drop.className = 'cs-drop';
  drop.setAttribute('role', 'listbox');
  drop.style.display = 'none';

  function _refresh(val) {
    cur = val;
    var found = null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === val) { found = opts[i]; break; }
    }
    if (found) {
      lbl.textContent = found.label;
      lbl.classList.remove('cs-ph');
    } else {
      lbl.textContent = placeholder || '— Select —';
      lbl.classList.add('cs-ph');
    }
    drop.querySelectorAll('.cs-item').forEach(function(el) {
      el.classList.toggle('cs-sel', el.dataset.v === val);
    });
  }

  opts.forEach(function(o) {
    var item = document.createElement('div');
    item.className = 'cs-item' + (o.value === cur ? ' cs-sel' : '');
    item.dataset.v = o.value;
    item.textContent = o.label;
    item.setAttribute('role', 'option');
    item.addEventListener('mousedown', function(e) {
      e.preventDefault();
      _refresh(o.value);
      _csClose(wrap);
      if (onChange) onChange(o.value);
    });
    drop.appendChild(item);
  });

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = drop.style.display !== 'none';
    if (_csActive && _csActive !== wrap) _csClose(_csActive);
    if (isOpen) {
      _csClose(wrap);
    } else {
      _csActive = wrap;
      btn.classList.add('cs-open');
      btn.setAttribute('aria-expanded', 'true');
      drop.style.display = 'block';
      var sel = drop.querySelector('.cs-sel');
      if (sel) sel.scrollIntoView({block: 'nearest'});
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(drop);

  _refresh(cur);

  wrap.getValue = function() { return cur; };
  wrap.setValue = function(val) { _refresh(String(val !== null && val !== undefined ? val : '')); };

  return wrap;
}

// ── upgradeSelect ─────────────────────────────────────────────────────────────
// Wraps a native <select> with the custom UI.
// The native select is hidden but kept in the DOM so existing id-based
// reads (document.getElementById(id).value) continue to work.
// The value setter is overridden so programmatic el.value = x updates the visual.

function upgradeSelect(sel) {
  if (!sel || sel._csUp || sel.getAttribute('data-no-cs') !== null) return null;
  sel._csUp = true;

  var opts = [];
  var ph = null;
  var initVal = sel.value;

  Array.from(sel.options).forEach(function(o) {
    if (!o.value && opts.length === 0) { ph = o.text; return; }
    opts.push({value: o.value, label: o.text});
  });

  // Copy relevant sizing hints from the native select
  var computedFontSize = sel.style.fontSize || '';
  var computedPadding = sel.style.padding || '';

  var cs = createCustomSelect(opts, initVal, function(val) {
    sel._setting = true;
    sel.value = val;
    sel._setting = false;
    sel.dispatchEvent(new Event('change', {bubbles: true}));
  }, ph);

  if (computedFontSize) cs.querySelector('.cs-btn').style.fontSize = computedFontSize;
  if (computedPadding) cs.querySelector('.cs-btn').style.padding = computedPadding;

  // Mirror explicit inline width if set
  if (sel.style.width && sel.style.width !== '100%') {
    cs.style.width = sel.style.width;
  }

  // Hide native select, keep in DOM for attribute/id access
  sel.style.cssText = 'position:absolute!important;opacity:0!important;pointer-events:none!important;width:0!important;height:0!important;overflow:hidden!important;';
  sel.parentNode.insertBefore(cs, sel);

  // Override the value property so el.value = x also updates the custom UI
  try {
    var nativeDef = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      get: function() { return nativeDef.get.call(this); },
      set: function(v) {
        nativeDef.set.call(this, v);
        if (!this._setting) cs.setValue(v);
      },
      configurable: true,
    });
  } catch (e) { /* ignore — visual sync via manual refreshes only */ }

  return cs;
}

// ── upgradeAllSelects ─────────────────────────────────────────────────────────
// Call this on a container (or omit for entire document) to upgrade all
// native selects within it that haven't been upgraded yet.

function upgradeAllSelects(container) {
  (container || document).querySelectorAll('select:not([data-no-cs])').forEach(upgradeSelect);
}

// ── Auto-upgrade: MutationObserver ───────────────────────────────────────────
// Automatically upgrades selects as they're added to the DOM — no changes
// needed to individual modal/render functions.

(function _autoUpgrade() {
  function _init() {
    upgradeAllSelects();
    var obs = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'SELECT') {
            upgradeSelect(n);
          } else if (n.querySelectorAll) {
            n.querySelectorAll('select:not([data-no-cs])').forEach(upgradeSelect);
          }
        });
      });
    });
    obs.observe(document.body, {childList: true, subtree: true});
  }
  if (document.body) _init();
  else document.addEventListener('DOMContentLoaded', _init);
})();
