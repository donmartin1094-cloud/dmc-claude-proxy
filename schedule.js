// ── Schedule System + Lookahead + Schedule AI — schedule.js ──────────────────
// Extracted from index.html. Loaded via <script src="/schedule.js"> before
// main script. State variables are var (global). Functions are globals.

// ════════════════════════════════════════
//  SCHEDULE SYSTEM
// ════════════════════════════════════════
const SCHEDULE_KEY = 'pavescope_sched_v2';
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const BLOCK_FIELDS = [
  { key:'jobName',   label:'Job Name:' },
  { key:'jobNum',    label:'Job #:' },
  { key:'plant',     label:'Plant:' },
  { key:'material',  label:'Material:', type:'material' },
  { key:'equipment', label:'Equipment:', type:'equipment' },
  { key:'operators', label:'Operators:', type:'operators' },
  { key:'qc',        label:'QC:',     buttons:['DMC','Others'] },
  { key:'tack',      label:'Tack:',   buttons:['DMC','Others'] },
  { key:'rubber',    label:'Rubber:', buttons:['DMC','Others'] },
  { key:'loadTime',  label:'Load Time:' },
  { key:'trucking',  label:'Trucking:', type:'trucking' },
  { key:'contact',   label:'Contact:' },
  { key:'notes',     label:'Notes:' },
];

// Block types with user-customizable colors
const DEFAULT_BLOCK_TYPES = [
  { id:'day',     label:'Day Work',    color:'#0d4f7c', fontColor:'#000000' },
  { id:'night',   label:'Night Work',  color:'#1a0a4a', fontColor:'#c8b8ff' },
  { id:'pending', label:'Pending',     color:'#5c4000', fontColor:'#f5c518' },
  { id:'blank',   label:'No Work',     color:'#ffffff', fontColor:'#000000' },
];

var schedData = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '{}');

// ── Block copy/paste clipboard ──
var schedClipboard = null; // { type, fields } — deep copy of a block's data

function copySchedBlock(key, slot) {
  let src;
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    src = schedData[key]?.extras?.[idx]?.data;
  } else {
    src = (schedData[key]||{})[slot];
  }
  if (!src) { schedClipboard = null; renderSchedule(); return; }
  schedClipboard = JSON.parse(JSON.stringify(src)); // deep clone
  // Flash all paste buttons to active state
  renderSchedule();
  pushNotif('success', 'Block Copied', 'Click any 📌 paste button to paste this job.', null);
}

function pasteSchedBlock(key, slot) {
  if (!schedClipboard) return;
  const data = JSON.parse(JSON.stringify(schedClipboard));
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
    schedData[key].extras[idx].data = data;
  } else {
    if (!schedData[key]) schedData[key] = {};
    schedData[key][slot] = data;
  }
  saveSchedData();
  renderSchedule();
}

function clearSchedClipboard() {
  schedClipboard = null;
  renderSchedule();
}


// ── Day-note (yellow bar) special actions ────────────────────────────────────
function openDayNoteSADrop(key, btn) {
  document.getElementById('dayNoteSADrop')?.remove();
  const dn = schedData[key] || {};
  const assigned = dn.dayNoteSA || [];
  const available = specialActions.filter(sa => !assigned.includes(sa.id) && (sa.id !== 'sa6' || canSeeVacation()));
  if (!available.length) {
    btn.textContent = '✓ All';
    setTimeout(() => { btn.textContent = '+ Action'; }, 1000);
    return;
  }
  const drop = document.createElement('div');
  drop.id = 'dayNoteSADrop';
  drop.className = 'sa-drop';
  // Dark background version for visibility over the yellow bar
  drop.style.cssText = 'position:fixed;min-width:180px;max-width:240px;z-index:5001;';
  drop.innerHTML = available.map(sa => `
    <div class="sa-drop-item" tabindex="0" onmousedown="event.preventDefault();addDayNoteSA('${key}','${sa.id}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();addDayNoteSA('${key}','${sa.id}');}if(event.key==='ArrowDown'&&this.nextElementSibling){event.preventDefault();this.nextElementSibling.focus();}if(event.key==='ArrowUp'&&this.previousElementSibling){event.preventDefault();this.previousElementSibling.focus();}if(event.key==='Escape'){document.getElementById('dayNoteSADrop')?.remove();}">
      <span class="sa-dot" style="background:${sa.color};"></span>
      <span>${sa.label}</span>
    </div>`).join('');
  document.body.appendChild(drop);
  const r = btn.getBoundingClientRect();
  drop.style.top  = (r.bottom + 4) + 'px';
  drop.style.left = Math.max(4, r.left) + 'px';
  setTimeout(() => { drop.querySelector('.sa-drop-item')?.focus(); }, 30);
  setTimeout(() => {
    document.addEventListener('click', function _dnsa() {
      document.getElementById('dayNoteSADrop')?.remove();
      document.removeEventListener('click', _dnsa);
    });
  }, 10);
}

function addDayNoteSA(key, saId) {
  document.getElementById('dayNoteSADrop')?.remove();
  const saInfo = specialActions.find(s => s.id === saId);
  if (saInfo && _saIsLocationAction(saInfo)) {
    openSALocationPicker(key, null, saId, function(loc) {
      _commitDayNoteSAWithLocation(key, saId, loc);
    });
    return;
  }
  if (!schedData[key]) schedData[key] = {};
  const cur = schedData[key].dayNoteSA || [];
  if (!cur.includes(saId)) schedData[key].dayNoteSA = [...cur, saId];
  saveSchedDataDirect();
  renderSchedule();
}

function removeDayNoteSA(key, saId) {
  if (!schedData[key]) return;
  schedData[key].dayNoteSA = (schedData[key].dayNoteSA || []).filter(id => id !== saId);
  if (schedData[key].dayNoteSALocations) delete schedData[key].dayNoteSALocations[saId];
  saveSchedDataDirect();
  renderSchedule();
}

// ── Day-note drag (moves the whole yellow bar + its data between days) ────────
var _dnDragSrc = null;
var _dnDragGhost = null;

function createDayNoteDragGhost(fromKey) {
  const dn = schedData[fromKey] || {};
  const sa = (dn.dayNoteSA || []).map(id => {
    const hit = specialActions.find(s => s.id === id);
    return hit ? hit.label : null;
  }).filter(Boolean);
  const text = sa.length ? sa.join(' • ') : 'Action Card';

  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed',
    'top:-9999px',
    'left:-9999px',
    'height:28px',
    'max-width:320px',
    'padding:0 8px',
    'display:flex',
    'align-items:center',
    'gap:6px',
    'border-radius:4px',
    'background:#f5c518',
    'border:1px solid rgba(0,0,0,0.25)',
    'box-shadow:0 8px 20px rgba(0,0,0,0.35)',
    'font-family:DM Mono, monospace',
    'font-size:9px',
    'font-weight:700',
    'letter-spacing:.2px',
    'color:#000',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'pointer-events:none',
    'z-index:99999'
  ].join(';');
  ghost.textContent = '+ Action  ' + text;
  document.body.appendChild(ghost);
  return ghost;
}

function schedDayNoteDragStart(e, fromKey) {
  _dnDragSrc = fromKey;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'daynote|' + fromKey);
  _dnDragGhost = createDayNoteDragGhost(fromKey);
  try { e.dataTransfer.setDragImage(_dnDragGhost, 80, 14); } catch(err) {}
  e.stopPropagation(); // Don't trigger block drag
  setTimeout(() => {
    const el = e.target.closest('.sched-day-note-wrap');
    if (el) el.style.opacity = '0.5';
  }, 0);
}

function schedDayNoteDragEnd(e) {
  _dnDragSrc = null;
  const el = e.target.closest('.sched-day-note-wrap');
  if (el) el.style.opacity = '';
  if (_dnDragGhost && _dnDragGhost.parentNode) _dnDragGhost.parentNode.removeChild(_dnDragGhost);
  _dnDragGhost = null;
  document.querySelectorAll('.sched-day-note-wrap').forEach(w => {
    w.style.outline = '';
  });
}

// Press-and-hold on day note: short press = open SA menu, hold = drag
var _dnPressTimer = null;
var _dnPressMoved = false;
function dayNotePressStart(e, key, el) {
  // If clicking the + Action button, let it handle itself
  if (e.target.closest('.sa-action-btn') || e.target.closest('.sched-day-note-sa-chip')) return;
  _dnPressMoved = false;
  // Hold 320ms → activate drag
  _dnPressTimer = setTimeout(() => {
    _dnPressTimer = null;
    if (_dnPressMoved) return;
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  }, 320);
  // Clean up on release without drag — quick click opens SA drop
  const onUp = () => {
    document.removeEventListener('mouseup', onUp);
    if (_dnPressTimer) {
      clearTimeout(_dnPressTimer);
      _dnPressTimer = null;
      if (!_dnPressMoved) {
        openDayNoteSADrop(key, el.querySelector('.sa-action-btn') || el);
      }
    }
  };
  const onMove = () => { _dnPressMoved = true; };
  document.addEventListener('mouseup', onUp, { once: true });
  document.addEventListener('mousemove', onMove, { once: true });
}

// Accept day-note drops on other note wrappers (swap/move notes between days)
document.addEventListener('dragover', e => {
  if (!_dnDragSrc) return;
  const wrap = e.target.closest('.sched-day-note-wrap');
  if (!wrap) return;
  e.preventDefault();
  wrap.style.outline = '3px solid rgba(0,0,0,0.4)';
});

document.addEventListener('dragleave', e => {
  const wrap = e.target.closest('.sched-day-note-wrap');
  if (wrap) wrap.style.outline = '';
});

document.addEventListener('drop', e => {
  if (!_dnDragSrc) return;
  const wrap = e.target.closest('.sched-day-note-wrap');
  if (!wrap) return;
  e.preventDefault();
  wrap.style.outline = '';
  const toKey = wrap.dataset.dayKey || wrap.querySelector('textarea')?.dataset?.key;
  if (!toKey || toKey === _dnDragSrc) { _dnDragSrc = null; return; }
  // Swap note text and SA chips between the two days
  const srcData = schedData[_dnDragSrc] || {};
  const dstData = schedData[toKey]      || {};
  const tmpNote = srcData.dayNote  || '';
  const tmpSA   = srcData.dayNoteSA || [];
  if (!schedData[_dnDragSrc]) schedData[_dnDragSrc] = {};
  if (!schedData[toKey])      schedData[toKey]      = {};
  schedData[_dnDragSrc].dayNote   = dstData.dayNote   || '';
  schedData[_dnDragSrc].dayNoteSA = dstData.dayNoteSA || [];
  schedData[toKey].dayNote   = tmpNote;
  schedData[toKey].dayNoteSA = tmpSA;
  _dnDragSrc = null;
  saveSchedDataDirect();
  renderSchedule();
});

function saveSchedDayNote(key, el) {
  if (!schedData[key]) schedData[key] = {};
  schedData[key].dayNote = el.value;
  saveSchedData();
}

// ── Rain-out system ──
function nextWorkday(dateKey) {
  const p = dateKey.split('-');
  const d = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
  do { d.setDate(d.getDate()+1); }
  while (d.getDay()===0 || d.getDay()===6 || holidays.has(dk(d)));
  return dk(d);
}
function prevWorkday(dateKey) {
  const p = dateKey.split('-');
  const d = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
  do { d.setDate(d.getDate()-1); }
  while (d.getDay()===0 || d.getDay()===6 || holidays.has(dk(d)));
  return dk(d);
}
function isWorkday(dateKey) {
  const p = dateKey.split('-');
  const d = new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
  const dow = d.getDay();
  return dow!==0 && dow!==6 && !holidays.has(dateKey);
}
function slotHasWork(key, slot) {
  const block = (schedData[key]||{})[slot];
  if (!block) return false;
  if (block.rainedOut) return true;
  if (block.type && block.type!=='blank') return true;
  return Object.values(block.fields||{}).some(v=>v&&v.trim());
}
// ── Equipment double-booking guard ───────────────────────────────────────────
// Returns {conflict:true, jobName, source} if eqName is already committed on dateStr
function _eqIsBookedOn(eqName, dateStr, excludeJobName) {
  if (!eqName || !dateStr) return { conflict: false };
  var nameLC = eqName.toLowerCase().trim();
  // Check schedule
  var day = schedData[dateStr] || {};
  var slots = ['top','bottom'].concat((day.extras||[]).map(function(_,i){ return 'extra_'+i; }));
  for (var si = 0; si < slots.length; si++) {
    var sKey = slots[si];
    var block = sKey.startsWith('extra_') ? ((day.extras||[])[parseInt(sKey.split('_')[1])]||{}).data : day[sKey];
    if (!block || !block.fields) continue;
    var eqField = (block.fields.equipment || '');
    var eqNames = eqField.split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
    if (eqNames.includes(nameLC)) {
      var bJobName = (block.fields.jobName||block.fields.jobNum||'a scheduled job');
      if (excludeJobName && bJobName === excludeJobName) continue;
      return { conflict: true, jobName: bJobName, source: 'schedule' };
    }
  }
  // Check lowbed plan moves
  var plan = (function(){ try { return JSON.parse(localStorage.getItem('dmc_lowbed_plan')||'null'); } catch(e){ return null; }})();
  if (plan && plan.jobs) {
    for (var ji = 0; ji < plan.jobs.length; ji++) {
      var job = plan.jobs[ji];
      if (!job.date || job.date !== dateStr) continue;
      for (var mi = 0; mi < (job.moves||[]).length; mi++) {
        var mv = job.moves[mi];
        if (mv.status === 'complete') continue;
        for (var ei = 0; ei < (mv.equipment||[]).length; ei++) {
          if ((mv.equipment[ei].name||'').toLowerCase().trim() === nameLC) {
            var lbJobName = job.jobName || job.jobNum || 'a lowbed move';
            if (excludeJobName && lbJobName === excludeJobName) continue;
            return { conflict: true, jobName: lbJobName, source: 'lowbed' };
          }
        }
      }
    }
  }
  return { conflict: false };
}

// ── Schedule: mark job complete ───────────────────────────────────────────────
function _schedCompleteJob(key, slot) {
  var block = (schedData[key]||{})[slot];
  if (!block || !block.fields) return;
  var jobName = block.fields.jobName || block.fields.jobNum || 'this job';
  var eqStr   = block.fields.equipment || '';
  var ops     = block.fields.operators || '';
  if (!confirm('Mark "' + jobName + '" as COMPLETE?\n\nThis will:\n• Flag the job as finished\n• Free all assigned equipment\n• Notify operators and managers')) return;
  // Mark block as completed
  block._completed   = true;
  block._completedAt = new Date().toISOString();
  block._completedBy = localStorage.getItem('dmc_u') || 'Admin';
  // Release equipment from fleet assignments
  if (eqStr) {
    eqStr.split(',').forEach(function(eName) {
      eName = eName.trim();
      if (!eName) return;
      var fIdx = equipmentFleet.findIndex(function(e){ return (e.name||'').toLowerCase() === eName.toLowerCase(); });
      if (fIdx >= 0 && equipmentFleet[fIdx].assignedJobName === jobName) {
        equipmentFleet[fIdx].assignedJobId   = null;
        equipmentFleet[fIdx].assignedJobName = null;
      }
    });
    saveFleet();
  }
  saveSchedData();
  // Notify operators
  var opList = ops.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  opList.forEach(function(opName) {
    pushNotif('success', '✅ Job Complete: ' + jobName,
      'Job finished on ' + key + '. Equipment released — report to dispatch for next assignment.',
      null, opName.toLowerCase());
  });
  // Notify managers
  ['dj','donmartin'].forEach(function(t) {
    pushNotif('success', '✅ Job Complete: ' + jobName,
      'Marked complete by ' + (block._completedBy) + ' on ' + key + '. Equipment freed: ' + (eqStr||'none') + '.',
      null, t);
  });
  if (typeof renderSchedule === 'function') renderSchedule();
}

// ── Schedule: flag equipment clean-out ───────────────────────────────────────
function _schedCleanOutJob(key, slot) {
  var block = (schedData[key]||{})[slot];
  if (!block || !block.fields) return;
  var jobName = block.fields.jobName || block.fields.jobNum || 'this job';
  var eqStr   = block.fields.equipment || '';
  if (!eqStr.trim()) { alert('No equipment listed on this block to clean out.'); return; }
  var isAdmin_ = isAdmin();
  if (!confirm('Request EQUIPMENT CLEAN-OUT for "' + jobName + '"?\n\nEquipment: ' + eqStr + '\n\nThis flags the job for lowbed pick-up and notifies drivers.')) return;
  block._cleanOut   = true;
  block._cleanOutAt = new Date().toISOString();
  block._cleanOutBy = localStorage.getItem('dmc_u') || 'Admin';
  saveSchedData();
  // Mark each piece as needing a move in the fleet
  eqStr.split(',').forEach(function(eName) {
    eName = eName.trim();
    if (!eName) return;
    var fIdx = equipmentFleet.findIndex(function(e){ return (e.name||'').toLowerCase() === eName.toLowerCase(); });
    if (fIdx >= 0) {
      equipmentFleet[fIdx]._needsMove   = true;
      equipmentFleet[fIdx]._needsMoveAt = new Date().toISOString();
      equipmentFleet[fIdx]._needsMoveJob = jobName;
    }
  });
  saveFleet();
  // Notify lowbed drivers and managers
  ['dj','donmartin'].forEach(function(t) {
    pushNotif('info', '🔄 Clean-Out Needed: ' + jobName,
      'Equipment ready for pick-up: ' + eqStr + '. Requested by ' + (block._cleanOutBy) + '.',
      null, t);
  });
  if (typeof renderSchedule === 'function') renderSchedule();
}

// ── Mobile block detail sheet ──────────────────────────────────────────────
function openMobBlockDetail(key, slot) {
  const bdata  = slot.startsWith('extra_')
    ? ((schedData[key]?.extras || [])[parseInt(slot.split('_')[1])]?.data || {})
    : ((schedData[key]||{})[slot] || {});
  const fields = bdata.fields || {};
  const btype  = (typeof getBlockType === 'function') ? getBlockType(bdata.type || 'blank') : { color:'#888', label:'—' };
  const canEdit = (isAdmin() || (typeof canEditTab==='function' && canEditTab('schedule'))) && schedEditMode;
  const fmName  = slot === 'top'
    ? ((typeof foremanRoster !== 'undefined' && foremanRoster[0]) || 'Top Crew')
    : slot === 'bottom'
    ? ((typeof foremanRoster !== 'undefined' && foremanRoster[1]) || 'Bottom Crew')
    : 'Extra Crew';
  // Parse chips for display
  const eqList  = fields.equipment ? fields.equipment.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const opList  = fields.operators  ? fields.operators.split(',').map(s=>s.trim()).filter(Boolean)  : [];
  let matStr = '';
  try { const mi = parseMaterialField(fields.material||''); matStr = mi.map(m=>materialChipLabel(m)).join(', '); } catch(e){}
  const row = (lbl, val, chips) => {
    if (!val && !chips) return '';
    const content = chips
      ? `<div>${chips.map(c=>`<span class="sched-mob-sheet-chip">${escHtml(c)}</span>`).join('')}</div>`
      : `<span class="sched-mob-sheet-val">${escHtml(val)}</span>`;
    return `<div class="sched-mob-sheet-row"><span class="sched-mob-sheet-lbl">${lbl}</span>${content}</div>`;
  };
  const bodyHtml = [
    row('Foreman',   fmName),
    row('Type',      btype.label),
    row('Job #',     fields.jobNum),
    row('Job Name',  fields.jobName),
    row('Plant',     fields.plant),
    row('Mix',       matStr),
    row('Load Time', fields.loadTime),
    row('Trucking',  (() => { try { const td=JSON.parse(fields.trucking||'{}'); return [td.trucks?`🚛 ${td.trucks}`:'', td.loadTime?`⏱ ${td.loadTime}`:'', td.spacing?`📏 ${td.spacing}`:''].filter(Boolean).join(' · '); } catch(e){return fields.trucking||'';} })()),
    eqList.length  ? `<div class="sched-mob-sheet-row"><span class="sched-mob-sheet-lbl">Equipment</span><div>${eqList.map(e=>`<span class="sched-mob-sheet-chip">🔧 ${escHtml(e)}</span>`).join('')}</div></div>` : '',
    opList.length  ? `<div class="sched-mob-sheet-row"><span class="sched-mob-sheet-lbl">Operators</span><div>${opList.map(o=>`<span class="sched-mob-sheet-chip">👷 ${escHtml(o)}</span>`).join('')}</div></div>` : '',
    row('Contact',   fields.contact),
    row('Notes',     fields.notes),
    bdata.rainedOut ? row('Status', '🌧 Rained Out') : '',
  ].filter(Boolean).join('');
  const dateLabel = (() => { try { const d=new Date(key+'T12:00:00'); return d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}); } catch(e){return key;} })();
  const footBtns = canEdit ? [
    `<button class="sched-mob-sheet-btn" style="background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.4);color:var(--stripe);" onclick="generateDailyOrder('${key}','${slot}',event)">📋 Daily Order</button>`,
    isAdmin() ? `<button class="sched-mob-sheet-btn" style="background:rgba(155,148,136,0.08);border:1px solid rgba(155,148,136,0.3);color:#9b9488;" onclick="rainOutBlock('${key}','${slot}');document.getElementById('_mobSheet').remove();">🌧 Rain Out</button>` : '',
    (bdata.type !== 'blank' && (fields.jobName||fields.jobNum)) ? `<button class="sched-mob-sheet-btn" style="background:rgba(126,203,143,0.1);border:1px solid rgba(126,203,143,0.4);color:#7ecb8f;" onclick="_schedCompleteJob('${key}','${slot}');document.getElementById('_mobSheet').remove();">✅ Complete</button>` : '',
    (bdata.type !== 'blank' && (fields.jobName||fields.jobNum)) ? `<button class="sched-mob-sheet-btn" style="background:rgba(90,180,245,0.08);border:1px solid rgba(90,180,245,0.35);color:#5ab4f5;" onclick="_schedCleanOutJob('${key}','${slot}');document.getElementById('_mobSheet').remove();">🔄 Clean Out</button>` : '',
    `<button class="sched-mob-sheet-btn sched-mob-sheet-close" onclick="document.getElementById('_mobSheet').remove()">✕ Close</button>`,
  ].filter(Boolean).join('') : `<button class="sched-mob-sheet-btn sched-mob-sheet-close" onclick="document.getElementById('_mobSheet').remove()">✕ Close</button>`;
  const ovl = document.createElement('div');
  ovl.id = '_mobSheet';
  ovl.className = 'sched-mob-sheet-overlay';
  ovl.innerHTML = `<div class="sched-mob-sheet" style="border-top:3px solid ${btype.color};">
    <div class="sched-mob-sheet-hdr">
      <div>
        <div class="sched-mob-sheet-title" style="color:${btype.color};">${escHtml(fields.jobName||'No Job')}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:2px;">${dateLabel} · ${escHtml(fmName)}</div>
      </div>
      <button onclick="document.getElementById('_mobSheet').remove()" style="background:none;border:none;color:var(--concrete-dim);font-size:20px;cursor:pointer;padding:4px 8px;">✕</button>
    </div>
    <div class="sched-mob-sheet-body">${bodyHtml || '<div style="padding:20px 0;text-align:center;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--concrete-dim);">No job scheduled</div>'}</div>
    <div class="sched-mob-sheet-foot">${footBtns}</div>
  </div>`;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

// ── Mobile calendar: tap / long-press / move-mode logic ─────────────────────
var _mobMoveState = null; // null | { key, slot }

function _mobCalCrewTap(key, slot) {
  // If in move-mode and tapping a blank target → execute the move
  if (_mobMoveState) {
    const src = _mobMoveState;
    if (src.key === key && src.slot === slot) {
      // Tapped the same block — cancel move
      _mobMoveClear();
      return;
    }
    // Check target is blank
    const tgtData = slot.startsWith('extra_')
      ? ((schedData[key]?.extras||[])[parseInt(slot.split('_')[1])]?.data || {type:'blank',fields:{}})
      : ((schedData[key]||{})[slot] || {type:'blank',fields:{}});
    const tgtHasJob = !!((tgtData.fields||{}).jobName || (tgtData.fields||{}).jobNum);
    if (tgtData.type !== 'blank' || tgtHasJob) {
      // Target not blank — open its detail instead
      _mobMoveClear();
      openMobBlockDetail(key, slot);
      return;
    }
    // Execute move: copy source → target, clear source
    const srcData = src.slot.startsWith('extra_')
      ? ((schedData[src.key]?.extras||[])[parseInt(src.slot.split('_')[1])]?.data || {})
      : ((schedData[src.key]||{})[src.slot] || {});
    // Write to target
    if (!schedData[key]) schedData[key] = {};
    schedData[key][slot] = JSON.parse(JSON.stringify(srcData));
    // Clear source
    if (src.slot.startsWith('extra_')) {
      const ei = parseInt(src.slot.split('_')[1]);
      if (schedData[src.key]?.extras?.[ei]) {
        schedData[src.key].extras[ei].data = {type:'blank',fields:{}};
      }
    } else {
      if (!schedData[src.key]) schedData[src.key] = {};
      schedData[src.key][src.slot] = {type:'blank',fields:{}};
    }
    saveSchedDataDirect();
    _mobMoveState = null;
    renderSchedule();
    return;
  }
  // Normal tap — open detail sheet (if has a job)
  const bdata = slot.startsWith('extra_')
    ? ((schedData[key]?.extras||[])[parseInt(slot.split('_')[1])]?.data || {type:'blank',fields:{}})
    : ((schedData[key]||{})[slot] || {type:'blank',fields:{}});
  const hasJob = !!((bdata.fields||{}).jobName || (bdata.fields||{}).jobNum);
  if (hasJob || (bdata.type && bdata.type !== 'blank')) {
    openMobBlockDetail(key, slot);
  }
}

function _mobMoveStart(key, slot) {
  // Only allow move on blocks with actual jobs
  const bdata = slot.startsWith('extra_')
    ? ((schedData[key]?.extras||[])[parseInt(slot.split('_')[1])]?.data || {type:'blank',fields:{}})
    : ((schedData[key]||{})[slot] || {type:'blank',fields:{}});
  const hasJob = !!((bdata.fields||{}).jobName || (bdata.fields||{}).jobNum);
  if (!hasJob && (!bdata.type || bdata.type === 'blank')) return;

  _mobMoveState = { key, slot };
  // Highlight source and mark blank targets
  _mobMoveRefreshUI();
  // Show banner
  _mobMoveShowBanner();
}

function _mobMoveClear() {
  _mobMoveState = null;
  document.querySelectorAll('.mob-move-src,.mob-move-target').forEach(el => {
    el.classList.remove('mob-move-src','mob-move-target');
  });
  const banner = document.getElementById('_mobMoveBanner');
  if (banner) banner.remove();
}

function _mobMoveRefreshUI() {
  if (!_mobMoveState) return;
  const src = _mobMoveState;
  document.querySelectorAll('.sched-mob-cal-crew').forEach(el => {
    const k = el.dataset.key;
    const s = el.dataset.slot;
    el.classList.remove('mob-move-src','mob-move-target');
    if (k === src.key && s === src.slot) {
      el.classList.add('mob-move-src');
    } else if (el.classList.contains('crew-blank')) {
      el.classList.add('mob-move-target');
    }
  });
}

function _mobMoveShowBanner() {
  let banner = document.getElementById('_mobMoveBanner');
  if (banner) banner.remove();
  const src = _mobMoveState;
  if (!src) return;
  const bdata = src.slot.startsWith('extra_')
    ? ((schedData[src.key]?.extras||[])[parseInt(src.slot.split('_')[1])]?.data || {})
    : ((schedData[src.key]||{})[src.slot] || {});
  const jobLabel = (bdata.fields||{}).jobNum ? '#'+(bdata.fields||{}).jobNum : ((bdata.fields||{}).jobName || 'Job');
  banner = document.createElement('div');
  banner.id = '_mobMoveBanner';
  banner.className = 'mob-move-banner';
  banner.innerHTML = `<span>📦 Moving ${escHtml(jobLabel)} — tap an empty slot</span><button onclick="_mobMoveClear()">✕ Cancel</button>`;
  const cal = document.querySelector('.sched-mob-cal');
  if (cal) cal.insertBefore(banner, cal.firstChild);
}

// ── Long-press detection for mobile calendar crew blocks ──
(function() {
  let _lpTimer = null;
  let _lpTarget = null;
  let _lpFired = false;
  const LP_DELAY = 500; // ms

  function _findCrewEl(el) {
    return el && el.closest ? el.closest('.sched-mob-cal-crew') : null;
  }

  document.addEventListener('touchstart', function(e) {
    const crew = _findCrewEl(e.target);
    if (!crew || crew.classList.contains('crew-blank')) return;
    _lpFired = false;
    _lpTarget = crew;
    _lpTimer = setTimeout(function() {
      _lpFired = true;
      const k = crew.dataset.key;
      const s = crew.dataset.slot;
      if (k && s) {
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(30);
        _mobMoveStart(k, s);
      }
    }, LP_DELAY);
  }, { passive: true });

  document.addEventListener('touchmove', function() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    if (_lpFired) {
      // Prevent the normal tap from firing after long-press
      e.preventDefault();
      _lpFired = false;
    }
  });

  document.addEventListener('touchcancel', function() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    _lpFired = false;
  }, { passive: true });
})();

function rainOutBlock(key, slot) {
  if (!isAdmin()) return;

  const cur = (schedData[key]||{})[slot];

  // ── Toggle OFF: remove rain-out flag ─────────────────────────────────
  if (cur?.rainedOut) {
    if (!confirm('Remove rain-out flag? (Jobs will NOT shift back automatically.)')) return;
    schedData[key][slot].rainedOut = false;
    saveSchedDataDirect(); renderSchedule(); return;
  }

  if (!slotHasWork(key, slot)) {
    alert('No job is scheduled on this block to rain out.');
    return;
  }

  // ── Mark the block as rained out ─────────────────────────────────────
  schedData[key][slot].rainedOut = true;

  // ── Collect the consecutive run of occupied workdays starting the day
  //    after the rain-out. We stop collecting only when we hit a workday
  //    that is genuinely empty (no job at all). That empty day is the
  //    natural absorber — the cascade stops there.
  // ─────────────────────────────────────────────────────────────────────
  const run = [];   // [ dateKey, … ] chronological, all have jobs
  let scan = nextWorkday(key);

  for (let i = 0; i < 365; i++) {
    if (slotHasWork(scan, slot)) {
      run.push(scan);
      scan = nextWorkday(scan);
    } else {
      // This is an empty workday — the cascade stops here naturally.
      // We do NOT include this day in the run.
      break;
    }
  }

  // ── Shift every job in the run forward by exactly 1 workday ──────────
  // Process in REVERSE so we never overwrite a job that hasn't moved yet.
  for (let i = run.length - 1; i >= 0; i--) {
    const fromKey = run[i];
    const toKey   = nextWorkday(fromKey);
    if (!schedData[toKey]) schedData[toKey] = {};
    schedData[toKey][slot] = JSON.parse(JSON.stringify(schedData[fromKey][slot]));
    schedData[toKey][slot].rainedOut = false;
    schedData[fromKey][slot] = { type: 'blank', fields: {} };
  }

  saveSchedDataDirect();
  renderSchedule();

  // ── Notifications ─────────────────────────────────────────────────────
  const foreman = slot === 'top' ? 'Filipe Joaquim' : 'Louie Medeiros';
  let totalContacts = 0;

  // One notification per shifted job that has contacts
  run.forEach(fromKey => {
    const toKey    = nextWorkday(fromKey);
    const jobName  = getBlockJobName(toKey, slot);
    const contacts = getBlockContacts(toKey, slot);
    const origDate = fmtScheduleDate(fromKey);
    const newDate  = fmtScheduleDate(toKey);
    totalContacts += contacts.length;

    if (contacts.length && isAdmin()) {
      contacts.forEach(contact => {
        pushNotif('info',
          '🌧 Rain Delay — ' + escHtml(jobName),
          '<strong>Contact to notify:</strong> ' + escHtml(contact) + '<br>' +
          'Job <em>' + escHtml(jobName) + '</em> (' + escHtml(foreman) + ') ' +
          'was originally scheduled for <strong>' + origDate + '</strong> ' +
          'and has been pushed to <strong>' + newDate + '</strong> (+1 workday) due to a rain-out.',
          null
        );
      });
    }
  });

  // Summary
  if (run.length === 0) {
    pushNotif('info', '🌧 Rained Out',
      escHtml(foreman.split(' ')[0]) + '\'s block on ' + fmtScheduleDate(key) +
      ' marked as rained out. No following jobs needed to shift.',
      null);
  } else {
    pushNotif('success', '🌧 Rained Out — Schedule Pushed +1 Day',
      escHtml(foreman.split(' ')[0]) + '\'s ' + run.length +
      ' consecutive job' + (run.length !== 1 ? 's' : '') +
      ' shifted forward by 1 workday. Cascade stopped at the first open slot.' +
      (totalContacts > 0 && isAdmin()
        ? ' ' + totalContacts + ' contact' + (totalContacts !== 1 ? 's' : '') + ' flagged for notification.'
        : (totalContacts > 0 ? ' Admin notified to contact affected parties.' : '')),
      null
    );
  }
}


const HOLIDAYS_KEY = 'pavescope_holidays';
var holidays = new Set((function(){ try { const p = JSON.parse(localStorage.getItem(HOLIDAYS_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })());
function saveHolidays() {
  localStorage.setItem(HOLIDAYS_KEY, JSON.stringify([...holidays]));
  _checkLocalStorageSize();
  fbSet('holidays', [...holidays]);
}
function toggleHoliday(key) {
  if (!isAdmin()) return;
  if (holidays.has(key)) holidays.delete(key); else holidays.add(key);
  saveHolidays();
  renderSchedule();
}
var blockTypes = JSON.parse(localStorage.getItem('pavescope_blocktypes') || JSON.stringify(DEFAULT_BLOCK_TYPES));
// One-time migration: ensure Day Work uses black font (was previously white)
(function() {
  const day = blockTypes.find(t => t.id === 'day');
  if (day && day.fontColor === '#ffffff') { day.fontColor = '#000000'; saveBlockTypes(); }
})();
var schedMonthOffset = 0;
var schedViewMode = 'month'; // always monthly — no toggle on desktop
var schedScrollToToday = true; // scroll to today on first render; false after that to preserve position
var lookaheadActiveSupplier = null; // for 2-week lookahead supplier filterlet schedSettingsOpen = false;
var colorPickTarget = null;
var schedDragSrc = null;
var schedZoom = parseFloat(localStorage.getItem('pavescope_sched_zoom') || '1.0');

// ── Edit / Publish mode ──
var schedEditMode = true;           // always true for admins — edits are local until Publish
var schedDraft = null;              // unused — kept for compat
var schedPublishedData = null;      // snapshot before publish for conflict detection

function changeSchedZoom(delta) {
  if (delta === 0) {
    schedZoom = 1.0;
  } else {
    schedZoom = Math.max(0.4, Math.min(2.0, schedZoom + delta));
    schedZoom = Math.round(schedZoom * 10) / 10;
  }
  localStorage.setItem('pavescope_sched_zoom', schedZoom);
  _checkLocalStorageSize();

  const inner = document.getElementById('schedScrollInner');
  if (inner) {
    inner.style.transform = `scale(${schedZoom})`;
    // When zoomed out, expand the container width so scroll area accounts for the gap
    inner.style.width = schedZoom < 1 ? (100 / schedZoom).toFixed(1) + '%' : '100%';
  }

  const label = document.getElementById('schedZoomLabel');
  if (label) label.textContent = Math.round(schedZoom * 100) + '%';

  // Re-run textarea auto-resize since layout changed
  document.querySelectorAll('.sched-field-input').forEach(autoResize);
}

// ── Foreman roster (for extra blocks) ──
const FOREMAN_KEY = 'pavescope_foremans';
const DEFAULT_FOREMANS = ['Filipe Joaquim','Louie Medeiros'];
var foremanRoster = JSON.parse(localStorage.getItem(FOREMAN_KEY) || JSON.stringify(DEFAULT_FOREMANS));
function saveForemanRoster() { localStorage.setItem(FOREMAN_KEY, JSON.stringify(foremanRoster)); _checkLocalStorageSize(); fbSet('foremans', foremanRoster); }
var mobSchedForemanFilter = 'top'; // 'top' = first foreman, 'bottom' = second foreman


// ── Rental Crews ────────────────────────────────────────────────────────────
// Shape: [{ id, name, contact, notes }]
const RENTAL_CREWS_KEY = 'pavescope_rental_crews';
const DEFAULT_RENTAL_CREWS = [];
var rentalCrews = (function(){ try { const p = JSON.parse(localStorage.getItem(RENTAL_CREWS_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();
function saveRentalCrews() {
  localStorage.setItem(RENTAL_CREWS_KEY, JSON.stringify(rentalCrews));
  _checkLocalStorageSize();
  try { if (db) fbSet('rental_crews', rentalCrews); } catch(e) {}
}

// ── Operators roster ──
const OPERATORS_KEY = 'pavescope_operators';
const DEFAULT_OPERATORS = [
  'Luis Almonte','Carlos Brito','Manuel Cruz','Jorge Dias','Antonio Ferreira',
  'Ricardo Gomes','Paulo Lopes','Sergio Matos','Fernando Neves','Miguel Oliveira'
];
var operatorsList = JSON.parse(localStorage.getItem(OPERATORS_KEY) || JSON.stringify(DEFAULT_OPERATORS));
function saveOperatorsList() { localStorage.setItem(OPERATORS_KEY, JSON.stringify(operatorsList)); _checkLocalStorageSize(); fbSet('operators', operatorsList); }

// ── Equipment roster ──
const EQUIPMENT_KEY = 'pavescope_equipment';
const EQUIPMENT_CAT_KEY = 'pavescope_equipment_categories';
const EQUIPMENT_CAT_MAP_KEY = 'pavescope_equipment_cat_map';
const DEFAULT_EQUIPMENT = [
  'Paver','Roller — Steel Drum','Roller — Rubber','Milling Machine',
  'Dump Truck','Tack Truck','Water Truck','Skid Steer','Excavator','Compactor'
];
var equipmentList = JSON.parse(localStorage.getItem(EQUIPMENT_KEY) || JSON.stringify(DEFAULT_EQUIPMENT));
var equipmentCategoryList = (function(){ try { const p = JSON.parse(localStorage.getItem(EQUIPMENT_CAT_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();
var equipmentCategoryMap  = JSON.parse(localStorage.getItem(EQUIPMENT_CAT_MAP_KEY) || '{}');
function saveEquipmentList() {
  localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(equipmentList));
  _checkLocalStorageSize();
  localStorage.setItem(EQUIPMENT_CAT_KEY, JSON.stringify(equipmentCategoryList));
  _checkLocalStorageSize();
  localStorage.setItem(EQUIPMENT_CAT_MAP_KEY, JSON.stringify(equipmentCategoryMap));
  _checkLocalStorageSize();
  fbSet('equipment', equipmentList);
  fbSet('equipment_categories', equipmentCategoryList);
  fbSet('equipment_cat_map', equipmentCategoryMap);
}

// ── Material roster ──
const MATERIAL_KEY = 'pavescope_materials';
const DEFAULT_MATERIALS = [
  '12.5mm Surface Course','19mm Binder Course','25mm Base Course',
  'Cold Patch','Crack Filler','Reclaimed Asphalt','Stone Base'
];
var materialList = JSON.parse(localStorage.getItem(MATERIAL_KEY) || JSON.stringify(DEFAULT_MATERIALS));
const MATERIAL_DISPLAY_KEY = 'pavescope_material_display';
var materialDisplayNames = JSON.parse(localStorage.getItem(MATERIAL_DISPLAY_KEY) || '{}');
function saveMaterialDisplayNames() { localStorage.setItem(MATERIAL_DISPLAY_KEY, JSON.stringify(materialDisplayNames)); _checkLocalStorageSize(); }
function matDisplayName(name) {
  if (!name) return name;
  // Direct lookup in mixTypesList by desc (most reliable)
  const mix = mixTypesList.find(m => m.desc === name);
  if (mix && mix.displayName) return mix.displayName;
  // Fallback to materialDisplayNames map (populated from backlog items)
  return materialDisplayNames[name] || name;
}

// ── Mix Types ─────────────────────────────────────────────────────────────────
// Shape: [{ id, desc, itemNo, displayName, gyrations }]
// materialList is kept in sync as a derived flat array — do not edit it separately.
const MIX_TYPES_KEY = 'pavescope_mix_types';
var mixTypesList = (function(){ try { const p = JSON.parse(localStorage.getItem(MIX_TYPES_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();

function saveMixTypesList() {
  localStorage.setItem(MIX_TYPES_KEY, JSON.stringify(mixTypesList));
  _checkLocalStorageSize();
  try { if(db) fbSet('mix_types', mixTypesList); } catch(e){}
  // Keep materialList fully in sync with mix types (single source of truth)
  materialList = mixTypesList.map(m => m.desc).filter(Boolean);
  saveMaterialList();
}

// Rebuild materialDisplayNames from all mix types — call whenever mixTypesList changes or on render
function syncMixTypeDisplayNames() {
  mixTypesList.forEach(m => {
    if (m.desc && m.displayName) materialDisplayNames[m.desc] = m.displayName;
  });
  // Also keep materialList synced on load
  const mixDescs = mixTypesList.map(m => m.desc).filter(Boolean);
  // Merge: keep any existing materialList entries that aren't already in mixTypes
  // (legacy data migration) but don't create duplicates
  mixDescs.forEach(d => { if (!materialList.includes(d)) materialList.push(d); });
}
// Sync on load
syncMixTypeDisplayNames();

// ── Special Actions ───────────────────────────────────────────────────────────
// Shape: [{ id, label, color }]
const SPECIAL_ACTIONS_KEY = 'pavescope_special_actions';
const DEFAULT_SPECIAL_ACTIONS = [
  { id:'sa1', label:'Night Work',       color:'#8b5cf6' },
  { id:'sa2', label:'Traffic Control',  color:'#f59e0b' },
  { id:'sa3', label:'Inspection Hold',  color:'#ef4444' },
  { id:'sa4', label:'Milling Required', color:'#3b82f6' },
  { id:'sa5', label:'Tack Required',    color:'#10b981' },
  { id:'sa6', label:'Person on Vacation', color:'#ec4899' },
];
var specialActions = JSON.parse(localStorage.getItem(SPECIAL_ACTIONS_KEY) || JSON.stringify(DEFAULT_SPECIAL_ACTIONS));

// ── Tab Visibility Permissions ───────────────────────────────────────────────
// Shape: { [role]: { [tabId]: boolean } }
// tabId = 'ap' | 'backlog' | 'bids' | 'chat' | 'schedule' | 'reports'
const TAB_PERMS_KEY = 'pavescope_tab_perms';
const ALL_TABS = [
  { id:'ap',         label:'🧾 AR' },
  { id:'backlog',    label:'📋 Backlog' },
  { id:'bids',       label:'📁 Bids' },
  { id:'chat',       label:'💬 Chat' },
  { id:'schedule',   label:'📅 Master Schedule' },
  { id:'reports',    label:'📊 Reports' },
  { id:'equipment',  label:'🔧 Equipment' },
  { id:'heimdall',   label:'👁 Heimdall' },
  { id:'atow_bills', label:'🧾 My Bills' },
];
const DEFAULT_TAB_PERMS = {
  // Values: 'edit' = full access, 'view' = read-only, false = hidden
  admin:      { ap:'edit', backlog:'edit', bids:'edit', chat:'edit', schedule:'edit', reports:'edit', equipment:'edit', heimdall:'edit' },
  controller: { ap:'edit', backlog:'edit', bids:'edit', chat:'edit', schedule:'edit', reports:'edit', equipment:'edit', heimdall:'edit' },
  qc:         { ap:false,  backlog:false,  bids:false,  chat:'edit', schedule:'view', reports:'edit', equipment:false,  heimdall:false  },
  staff:      { ap:false,  backlog:false,  bids:'view', chat:'edit', schedule:'view', reports:'view', equipment:false,  heimdall:false  },
  driver:          { ap:false, backlog:false, bids:false, chat:false, schedule:false, reports:false, equipment:'view', heimdall:'edit' },
  lowbed_driver:   { ap:false, backlog:false, bids:false, chat:false, schedule:false, reports:false, equipment:'view', heimdall:'edit' },
  operator:   { ap:false,  backlog:false,  bids:false,  chat:false,  schedule:false,  reports:false,  equipment:'view', heimdall:false  },
  laborer:    { ap:false,  backlog:false,  bids:false,  chat:false,  schedule:false,  reports:false,  equipment:false,  heimdall:false  },
};

function cloneDefaultTabPerms() {
  return JSON.parse(JSON.stringify(DEFAULT_TAB_PERMS));
}

function hydrateTabPerms(raw) {
  const base = cloneDefaultTabPerms();
  const src = (raw && typeof raw === 'object') ? raw : {};
  ['admin','controller','qc','staff','driver','lowbed_driver'].forEach(role => {
    const roleSrc = (src[role] && typeof src[role] === 'object') ? src[role] : {};
    base[role] = { ...base[role], ...roleSrc };
  });

  // Controller must always have these tabs inherently on login.
  base.controller.ap = 'edit';
  base.controller.backlog = 'edit';
  return base;
}

var tabPerms = (() => {
  try { return hydrateTabPerms(JSON.parse(localStorage.getItem(TAB_PERMS_KEY))); }
  catch(e) { return cloneDefaultTabPerms(); }
})();

// ── Sidebar sub-folder toggles (AP, Bids, Chat, Reports) ───────────────────
const SIDEBAR_FOLDER_TOGGLE_KEY = 'dmc_sidebar_folder_toggles_v1';
const DEFAULT_SIDEBAR_FOLDER_TOGGLES = { ap:false, bids:false, chat:false, reports:false, settings:false };
var sidebarFolderToggles = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_FOLDER_TOGGLE_KEY) || '{}');
    return {
      ap: !!saved.ap,
      bids: !!saved.bids,
      chat: !!saved.chat,
      reports: !!saved.reports,
      settings: !!saved.settings,
    };
  } catch (e) {
    return { ...DEFAULT_SIDEBAR_FOLDER_TOGGLES };
  }
})();

function saveSidebarFolderToggles() {
  localStorage.setItem(SIDEBAR_FOLDER_TOGGLE_KEY, JSON.stringify(sidebarFolderToggles));
  _checkLocalStorageSize();
}

function applySidebarFolderToggles() {
  if (!sidebarFolderToggles || typeof sidebarFolderToggles !== 'object') return;
  const map = {
    ap:      { subId:'apSubTabs',      toggleId:'toggleApSubTabs',      parentId:'tabInvoices', title:'AP' },
    bids:    { subId:'bidSubTabs',     toggleId:'toggleBidsSubTabs',    parentId:'tabBids',     title:'Bids' },
    chat:    { subId:'chatSubTabs',    toggleId:'toggleChatSubTabs',    parentId:'tabChat',     title:'Chat' },
    reports: { subId:'reportsSubTabs', toggleId:'toggleReportsSubTabs', parentId:'tabReports',  title:'Reports' },
    settings:{ subId:'settingsSubTabs',toggleId:'toggleSettingsSubTabs',parentId:'tabSettings', title:'Settings' },
  };

  Object.keys(map).forEach((key) => {
    const cfg = map[key];
    const sub = document.getElementById(cfg.subId);
    const toggle = document.getElementById(cfg.toggleId);
    const parent = document.getElementById(cfg.parentId);
    const parentVisible = !!parent && parent.style.display !== 'none';
    const isOpen = !!sidebarFolderToggles[key];

    if (sub) sub.style.display = (parentVisible && isOpen) ? 'flex' : 'none';
    if (toggle) {
      toggle.textContent = isOpen ? '▾' : '▸';
      toggle.title = (isOpen ? 'Hide ' : 'Show ') + cfg.title + ' subfolders';
    }
  });
}

function setSidebarFolderOpen(folderKey, open, persist=true) {
  if (!sidebarFolderToggles || typeof sidebarFolderToggles !== 'object') {
    sidebarFolderToggles = { ...DEFAULT_SIDEBAR_FOLDER_TOGGLES };
  }
  if (!(folderKey in sidebarFolderToggles)) return;
  sidebarFolderToggles[folderKey] = !!open;
  if (persist) saveSidebarFolderToggles();
  applySidebarFolderToggles();
}

// ── Collapsed sidebar toggle ──────────────────────────────────────────────────
var _sidebarCollapsed = true;

function toggleSidebar() {
  _sidebarCollapsed = !_sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', _sidebarCollapsed);
  localStorage.setItem('dmc_sidebar_collapsed', _sidebarCollapsed ? '1' : '0');
  _checkLocalStorageSize();
  if (_sidebarCollapsed) {
    updateCollapsedNavActive(window.activeTab || 'schedule');
    updateCollNavQueueBadge();
  }
}

function scrollCollapsedNav(delta) {
  var el = document.getElementById('collNavScroll');
  if (el) el.scrollBy({ left: delta, behavior: 'smooth' });
}

function toggleReportsSubNav(e) {
  if (e) e.stopPropagation();
  var sub    = document.getElementById('collNavReportsSub');
  var arrow  = document.getElementById('collNavReportsArrow');
  var btn    = document.getElementById('collNavReports');
  if (!sub) return;
  var opening = !sub.classList.contains('open');
  sub.classList.toggle('open', opening);
  if (arrow) arrow.textContent = opening ? '▴' : '▾';
  if (btn) btn.classList.toggle('active', opening);
  // Also navigate to the Reports home tab when opening
  if (opening) switchTab('reports');
  // Scroll the nav so sub-buttons are visible
  if (opening) {
    setTimeout(function() {
      var nav = document.getElementById('collNavScroll');
      if (nav) nav.scrollBy({ left: 200, behavior: 'smooth' });
    }, 60);
  }
}

// Open Reports sub-nav automatically when navigating to any reports sub-tab
function _ensureReportsSubNavOpen() {
  var sub   = document.getElementById('collNavReportsSub');
  var arrow = document.getElementById('collNavReportsArrow');
  var btn   = document.getElementById('collNavReports');
  if (!sub || sub.classList.contains('open')) return;
  sub.classList.add('open');
  if (arrow) arrow.textContent = '▴';
  if (btn) btn.classList.add('active');
}

function toggleArSubNav(e) {
  if (e) e.stopPropagation();
  var sub   = document.getElementById('collNavArSub');
  var arrow = document.getElementById('collNavArArrow');
  var btn   = document.getElementById('collNavAr');
  if (!sub) return;
  var opening = !sub.classList.contains('open');
  sub.classList.toggle('open', opening);
  if (arrow) arrow.textContent = opening ? '▴' : '▾';
  if (btn) btn.classList.toggle('active', opening);
  if (opening) switchTab('ap');
  if (opening) {
    setTimeout(function() {
      var nav = document.getElementById('collNavScroll');
      if (nav) nav.scrollBy({ left: 200, behavior: 'smooth' });
    }, 60);
  }
}

function _ensureArSubNavOpen() {
  var sub   = document.getElementById('collNavArSub');
  var arrow = document.getElementById('collNavArArrow');
  var btn   = document.getElementById('collNavAr');
  if (!sub || sub.classList.contains('open')) return;
  sub.classList.add('open');
  if (arrow) arrow.textContent = '▴';
  if (btn) btn.classList.add('active');
}

function toggleSettingsSubNav(e) {
  if (e) e.stopPropagation();
  var sub   = document.getElementById('collNavSettingsSub');
  var arrow = document.getElementById('collNavSettingsArrow');
  var btn   = document.getElementById('collNavSettings');
  if (!sub) return;
  var opening = !sub.classList.contains('open');
  sub.classList.toggle('open', opening);
  if (arrow) arrow.textContent = opening ? '▴' : '▾';
  if (btn) btn.classList.toggle('active', opening);
  if (opening) switchTab('settings-theme');
  if (opening) {
    setTimeout(function() {
      var nav = document.getElementById('collNavScroll');
      if (nav) nav.scrollBy({ left: 300, behavior: 'smooth' });
    }, 60);
  }
}

function _ensureSettingsSubNavOpen() {
  var sub   = document.getElementById('collNavSettingsSub');
  var arrow = document.getElementById('collNavSettingsArrow');
  var btn   = document.getElementById('collNavSettings');
  if (!sub || sub.classList.contains('open')) return;
  sub.classList.add('open');
  if (arrow) arrow.textContent = '▴';
  if (btn) btn.classList.add('active');
}

var _collNavOpenDrop = null;
var COLL_NAV_DROPS = {
  ap: {
    wrapId: 'collNavArWrap',
    items: [
      { label: '📊 Analytics', tab: 'apAnalytics' },
      { label: '📋 AIA Reqs & Quarterly Sales', tab: 'apAia' },
      { label: '🧾 Invoices', tab: 'apMix' }
    ]
  },
  bids: {
    wrapId: 'collNavBidsWrap',
    items: [
      { label: '📋 Projects Bid', tab: 'bid' },
      { label: '🏆 Projects Awarded', tab: 'awarded' },
      { label: '💰 Projects Priced', tab: 'priced' },
      { label: '💲 Project Pricing', tab: 'pricing' }
    ]
  },
  chat: {
    wrapId: 'collNavChatWrap',
    items: []
  },
  reports: {
    wrapId: 'collNavReportsWrap',
    items: [
      { label: '📄 Daily Orders', tab: 'reportsDailyOrders' },
      { label: '📊 2 Week Look Aheads', tab: 'reportsTwoWeek' },
      { label: "👷 Foremen's Reports", tab: 'reportsForemens' },
      { label: '🔬 QC Reports', tab: 'reportsQC' },
      { label: '🧪 Job Mix Formula', tab: 'reportsJobMix' }
    ]
  },
  settings: {
    wrapId: 'collNavSettingsWrap',
    items: [
      { label: '🎨 Theme', tab: 'settings-theme' },
      { label: '📅 Schedule', tab: 'settings-schedule' },
      { label: '👷 Rosters', tab: 'settings-rosters' },
      { label: '🏭 Suppliers', tab: 'settings-plants' },
      { label: '🚛 Truck Pricing', tab: 'settings-trucking' },
      { label: '👥 Users', tab: 'settings-users' }
    ]
  }
};

function collNavToggleDrop(key, triggerBtn) {
  if (_collNavOpenDrop) {
    var oldDrop = document.getElementById('collNavDrop_' + _collNavOpenDrop);
    if (oldDrop) oldDrop.remove();
    var wasKey = _collNavOpenDrop;
    _collNavOpenDrop = null;
    document.removeEventListener('click', _collNavOutsideHandler);
    if (wasKey === key) return;
  }
  var cfg = COLL_NAV_DROPS[key];
  if (!cfg) return;
  if (key === 'chat') { switchTab('chat'); return; }
  var wrap = document.getElementById(cfg.wrapId);
  if (!wrap) return;
  _collNavOpenDrop = key;
  var drop = document.createElement('div');
  drop.id = 'collNavDrop_' + key;
  drop.className = 'coll-nav-drop';
  drop.innerHTML = cfg.items.map(function(item) {
    var onclick = item.tab
      ? "switchTab('" + item.tab + "');collNavCloseDrop()"
      : item.fn + ";collNavCloseDrop()";
    return '<div class="coll-nav-drop-item" onclick="' + onclick + '">' + item.label + '</div>';
  }).join('');
  // Use fixed positioning appended to body to escape overflow:hidden on the scroll container
  var rect = wrap.getBoundingClientRect();
  drop.style.position = 'fixed';
  drop.style.top = (rect.bottom + 4) + 'px';
  drop.style.left = rect.left + 'px';
  document.body.appendChild(drop);
  setTimeout(function() {
    document.addEventListener('click', _collNavOutsideHandler);
  }, 0);
}

function _collNavOutsideHandler(e) {
  if (!_collNavOpenDrop) return;
  var wrap = document.getElementById((COLL_NAV_DROPS[_collNavOpenDrop] || {}).wrapId);
  var drop = document.getElementById('collNavDrop_' + _collNavOpenDrop);
  if ((wrap && wrap.contains(e.target)) || (drop && drop.contains(e.target))) return;
  collNavCloseDrop();
}

function collNavCloseDrop() {
  if (_collNavOpenDrop) {
    var old = document.getElementById('collNavDrop_' + _collNavOpenDrop);
    if (old) old.remove();
    _collNavOpenDrop = null;
  }
  document.removeEventListener('click', _collNavOutsideHandler);
}

function collNavToggleQueue(ev) {
  if (ev) ev.stopPropagation();
  var panel = document.getElementById('collNavQueuePanel');
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  var btn = document.getElementById('collNavQueueBtn');
  if (btn) {
    var rect = btn.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top  = (rect.bottom + 4) + 'px';
    panel.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  }
  _renderQueuePanelList(document.getElementById('collNavQueueList'));
  panel.style.display = 'block';
  setTimeout(function() {
    document.addEventListener('click', function _closeQP(e) {
      var outer = document.getElementById('collNavQueueOuter');
      if (outer && !outer.contains(e.target)) {
        panel.style.display = 'none';
        document.removeEventListener('click', _closeQP);
      }
    });
  }, 0);
}

function collNavQueueRemove(id) {
  if (typeof removeFromQueue === 'function') removeFromQueue(id);
  updateCollNavQueueBadge();
  var panel = document.getElementById('collNavQueuePanel');
  if (panel && panel.style.display !== 'none') {
    panel.style.display = 'none';
    setTimeout(function() { collNavToggleQueue(null); }, 0);
  }
}

function collNavQueueDrop(ev) {
  var queueDropZone = document.getElementById('queueDropZone');
  if (queueDropZone && typeof queueDrop === 'function') {
    queueDrop(ev);
  }
  updateCollNavQueueBadge();
}

function updateCollNavQueueBadge() {
  var count = ((typeof schedQueue !== 'undefined' ? schedQueue : []) || []).length;
  var badge = document.getElementById('collNavQueueBadge');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
  var hdrBadge = document.getElementById('schedHdrQueueBadge');
  if (hdrBadge) { hdrBadge.textContent = count; hdrBadge.style.display = count > 0 ? '' : 'none'; }
}

function _renderQueuePanelList(listEl) {
  if (!listEl) return;
  var items = ((typeof schedQueue !== 'undefined' ? schedQueue : []) || []).slice().sort(function(a,b){ return a.addedAt - b.addedAt; });
  if (!items.length) {
    listEl.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--concrete-dim);">Queue is empty</div>';
  } else {
    listEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;padding:8px;';
    listEl.innerHTML = items.map(function(item) { return (typeof _buildQueueMiniCard === 'function') ? _buildQueueMiniCard(item) : ''; }).join('');
  }
}

function toggleSchedHeaderQueue(ev, forceClose) {
  // Panel replaced with inline strip — no-op
  if (ev) ev.stopPropagation();
}

function schedHeaderQueueDrop(ev) {
  queueDrop(ev);
  updateCollNavQueueBadge();
}

function updateCollapsedNavActive(tab) {
  var isSettings = tab === 'settings' || tab === 'settings-theme' || tab === 'settings-schedule' || tab === 'settings-rosters' || tab === 'settings-plants' || tab === 'settings-trucking' || tab === 'settings-users';
  var isReportsSub = tab === 'reportsDailyOrders' || tab === 'reportsTwoWeek' || tab === 'reportsForemens' || tab === 'reportsQC' || tab === 'reportsJobMix';
  var isArSub = tab === 'ap' || tab === 'apAia' || tab === 'apMix';
  if (isReportsSub) _ensureReportsSubNavOpen();
  if (isArSub) _ensureArSubNavOpen();
  if (isSettings) _ensureSettingsSubNavOpen();
  var map = {
    collNavAr:           tab === 'ap' || tab === 'apAia' || tab === 'apMix',
    collNavArAia:        tab === 'apAia',
    collNavArMix:        tab === 'apMix',
    collNavBacklog:      tab === 'backlog',
    collNavBids:         tab === 'bid' || tab === 'pricing',
    collNavBidsPricing:  tab === 'pricing',
    collNavChat:         tab === 'chat',
    collNavSchedule:     tab === 'schedule',
    collNavReports:      tab === 'reports' || tab === 'reportsDocs' || tab === 'reportsQC' || tab === 'reportsDailyOrders' || tab === 'reportsTwoWeek' || tab === 'reportsForemens' || tab === 'reportsJobMix',
    collNavRepDaily:     tab === 'reportsDailyOrders',
    collNavRep2Wk:       tab === 'reportsTwoWeek',
    collNavRepForemens:  tab === 'reportsForemens',
    collNavRepQC:        tab === 'reportsQC',
    collNavRepJobMix:    tab === 'reportsJobMix',
    collNavSettings:     isSettings,
    collNavStngTheme:    tab === 'settings-theme',
    collNavStngSchedule: tab === 'settings-schedule',
    collNavStngRosters:  tab === 'settings-rosters',
    collNavStngPlants:   tab === 'settings-plants',
    collNavStngTrucking: tab === 'settings-trucking',
    collNavStngUsers:    tab === 'settings-users',
    collNavEmployees:    tab === 'employees',
    collNavEquipment:    tab === 'equipment',
    collNavHeimdall:     tab === 'heimdall',
    collNavMail:         tab === 'mail'
  };
  Object.keys(map).forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', !!map[id]);
  });
}

function toggleSidebarFolder(folderKey, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (!sidebarFolderToggles || typeof sidebarFolderToggles !== 'object') {
    sidebarFolderToggles = { ...DEFAULT_SIDEBAR_FOLDER_TOGGLES };
  }
  if (!(folderKey in sidebarFolderToggles)) return;
  sidebarFolderToggles[folderKey] = !sidebarFolderToggles[folderKey];
  saveSidebarFolderToggles();
  applySidebarFolderToggles();
}

function saveTabPerms() {
  tabPerms = hydrateTabPerms(tabPerms);
  localStorage.setItem(TAB_PERMS_KEY, JSON.stringify(tabPerms));
  _checkLocalStorageSize();
  try { if (db) fbSet('tab_perms', tabPerms); } catch(e) {}
}
function isHardcodedUser() {
  const u = (localStorage.getItem('dmc_u') || '').trim().toLowerCase();
  return DEFAULT_TEAM_ACCOUNTS.some(a => a.username.toLowerCase() === u || (a.email || '').toLowerCase() === u);
}
function canSeeTab(tabId) {
  // atow_bills is exclusively for ATow — block all other users including admins
  if (tabId === 'atow_bills') {
    return (localStorage.getItem('dmc_u') || '').toLowerCase() === 'atow';
  }
  if (isAdmin()) return true;
  const role = getCurrentRole();
  // ATow (Andy's Towing) — only Heimdall, Equipment, and My Bills
  if ((localStorage.getItem('dmc_u') || '').toLowerCase() === 'atow') {
    return ['heimdall', 'equipment', 'atow_bills'].includes(tabId);
  }
  // Operators, laborers, and drivers cannot access the master schedule
  if (['operator','laborer','driver','lowbed_driver'].includes(role) && tabId === 'schedule') return false;
  // Drivers always follow their tab perms — no bypass
  if (role === 'driver' || role === 'lowbed_driver') {
    const p = (tabPerms[role] || {})[tabId];
    return p === 'edit' || p === 'view' || p === true;
  }
  // AR-only staff (DGomez): restricted to schedule (view-only), AR, and reports
  if (role === 'ar_staff') {
    return ['ap', 'apMix', 'apAia', 'schedule', 'reports'].includes(tabId);
  }
  // All other hardcoded accounts get full view access
  if (isHardcodedUser()) return true;
  const p = (tabPerms[role] || tabPerms.staff || {})[tabId];
  return p === 'edit' || p === 'view' || p === true;
}
function canEditTab(tabId) {
  if (isAdmin()) return true;
  const role = getCurrentRole();
  // AR-only staff: can edit AR and reports, but schedule is view-only
  if (role === 'ar_staff') {
    return ['ap', 'apMix', 'apAia', 'reports'].includes(tabId);
  }
  const p = (tabPerms[role] || tabPerms.staff || {})[tabId];
  return p === 'edit' || p === true;
}
function getCurrentRole() {
  const u = (localStorage.getItem('dmc_u') || '').trim();
  const uLc = u.toLowerCase();
  // Hardcoded accounts always use their hardcoded role — cannot be overridden by Firebase
  const hardcoded = DEFAULT_TEAM_ACCOUNTS.find(a => a.username.toLowerCase() === uLc || (a.email || '').toLowerCase() === uLc);
  if (hardcoded) return hardcoded.role;
  try {
    const stored = localStorage.getItem(ACCOUNTS_KEY);
    if (stored) {
      const accounts = JSON.parse(stored);
      const acct = accounts.find(a => a.username.toLowerCase() === uLc);
      return acct?.role || 'staff';
    }
  } catch(e) {}
  return 'staff';
}

function getDriverTypes(username) {
  const uLc = (username || localStorage.getItem('dmc_u') || '').trim().toLowerCase();
  const hardcoded = DEFAULT_TEAM_ACCOUNTS.find(a => a.username.toLowerCase() === uLc);
  if (hardcoded) return hardcoded.driverTypes || [];
  try {
    const accounts = JSON.parse(localStorage.getItem(typeof ACCOUNTS_KEY !== 'undefined' ? ACCOUNTS_KEY : 'pavescope_accounts') || '[]');
    const acct = accounts.find(a => (a.username || '').toLowerCase() === uLc);
    return acct?.driverTypes || [];
  } catch(e) { return []; }
}
function isLowbedDriver(username) { return getDriverTypes(username).includes('lowbed'); }
function isMixtruckDriver(username) { return getDriverTypes(username).includes('mixtruck'); }

// ── Vacation visibility ───────────────────────────────────────────────────────
// Only admins, controllers, and office staff can see "Person on Vacation" chips/actions
function canSeeVacation() {
  if (isAdmin()) return true;
  const role = getCurrentRole();
  if (role === 'controller') return true;
  // Office accounts (hardcoded by username)
  const u = (localStorage.getItem('dmc_u') || '').trim().toLowerCase();
  const OFFICE_USERNAMES = ['dsouza','dgomez','office3','office4'];
  if (OFFICE_USERNAMES.includes(u)) return true;
  // Also match employees with role 'office'
  const emp = (typeof employees !== 'undefined' ? employees : []).find(e => (e.name||'').toLowerCase() === u || (e.username||'').toLowerCase() === u);
  if (emp && emp.role === 'office') return true;
  return false;
}

// ── Apply tab permissions to sidebar nav ─────────────────────────────────────
function applyTabPermissions() {
  tabPerms = hydrateTabPerms(tabPerms);

  // Sidebar button id for each tab (null = no dedicated sidebar button)
  const tabMap = {
    ap:         'tabInvoices',
    backlog:    'tabBacklog',
    bids:       'tabBids',
    chat:       'tabChat',
    schedule:   'tabSchedule',
    reports:    'tabReports',
    equipment:  'tabEquipment',
    heimdall:   null,
    atow_bills: 'tabATowBills',
  };
  // Expand/collapse toggle buttons for each tab
  const toggleMap = {
    ap:      'toggleApSubTabs',
    bids:    'toggleBidsSubTabs',
    chat:    'toggleChatSubTabs',
    reports: 'toggleReportsSubTabs',
  };
  // All additional nav elements (header folders + collapsible nav) for each tab
  const extraMap = {
    ap:        ['hdrFolderAR',     'collNavAr',       'collNavArSub'],
    backlog:   ['hdrFolderJD',     'collNavBacklog'],
    bids:      ['hdrFolderBids',   'collNavBids',     'collNavBidsPricing'],
    chat:      ['hdrFolderChat',   'collNavChat'],
    schedule:  ['hdrFolderSched',  'collNavSchedule'],
    reports:   ['hdrFolderReports','collNavReports',  'collNavReportsSub'],
    equipment:  ['hdrFolderEquip',  'collNavEquipment'],
    heimdall:   ['hdrFolderHeimdall','collNavHeimdall'],
    atow_bills: ['collNavATowBills'],
  };

  ALL_TABS.forEach(t => {
    const visible = canSeeTab(t.id);
    const btn = tabMap[t.id] ? document.getElementById(tabMap[t.id]) : null;
    if (btn) btn.style.display = visible ? '' : 'none';
    const toggleBtn = document.getElementById(toggleMap[t.id] || '');
    if (toggleBtn) toggleBtn.style.display = visible ? '' : 'none';
    (extraMap[t.id] || []).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    });
    // Hide sub-tab panels when parent is hidden
    if (t.id === 'ap'      && !visible) { const s = document.getElementById('apSubTabs');       if (s) s.style.display = 'none'; }
    if (t.id === 'bids'    && !visible) { const s = document.getElementById('bidSubTabs');      if (s) s.style.display = 'none'; }
    if (t.id === 'reports' && !visible) { const s = document.getElementById('reportsSubTabs'); if (s) s.style.display = 'none'; }
  });

  // Tabs not in ALL_TABS (Employees, Mail, Settings) — hide entirely for drivers and ar_staff
  const role = getCurrentRole();
  const isDriverRole = role === 'driver' || role === 'lowbed_driver';
  const isArStaff    = role === 'ar_staff';
  const isATow       = (localStorage.getItem('dmc_u') || '').toLowerCase() === 'atow';
  const restrictedHideIds = (isDriverRole || isArStaff || isATow)
    ? ['tabEmployees','tabMail','tabSettings','toggleSettingsSubTabs','settingsSubTabs',
       'collNavEmployees','collNavMail','collNavSettings','collNavSettingsSub',
       'hdrFolderMail','hdrFolderEmp','hdrFolderTakeoffs']
    : [];
  restrictedHideIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // If current tab is now hidden, redirect to first visible tab
  const allVisible = ALL_TABS.filter(t => canSeeTab(t.id));
  if (allVisible.length) {
    const cur = activeTab || '';
    const isContentTab = cur && !cur.startsWith('settings') && cur !== 'home';
    if (isContentTab) {
      const curBase = cur.replace('Docs','').replace('QC','').replace('Analytics','').replace('Aia','').replace('Mix','').toLowerCase();
      const stillVisible = allVisible.find(t => curBase.startsWith(t.id) || t.id === cur);
      if (!stillVisible) switchTab(allVisible[0].id);
    }
  }
  applySidebarFolderToggles();
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULE WEATHER ENGINE
// Uses Open-Meteo (no API key) + Nominatim geocoding (no key)
// Default fallback: Marshfield MA (lat 42.0912, lon -70.7082)
// Cache: sessionStorage keyed by "wxcache_lat_lon_date"
// ══════════════════════════════════════════════════════════════════════════════

const WX_DEFAULT_LAT = 42.0912;
const WX_DEFAULT_LON = -70.7082;
const WX_DEFAULT_LABEL = 'Marshfield, MA';

// Cache geocode results: address → {lat,lon,label}
const _wxGeoCache = {};
// Cache weather results: "lat|lon|date" → wx object
const _wxDayCache = {};

// WMO code → {icon, label}
const WX_CODES = {
  0:  { icon:'☀️',  label:'Clear'          },
  1:  { icon:'🌤️', label:'Mostly Clear'    },
  2:  { icon:'⛅',  label:'Partly Cloudy'  },
  3:  { icon:'☁️',  label:'Overcast'       },
  45: { icon:'🌫️', label:'Foggy'           },
  48: { icon:'🌫️', label:'Icy Fog'         },
  51: { icon:'🌦️', label:'Light Drizzle'   },
  53: { icon:'🌦️', label:'Drizzle'         },
  55: { icon:'🌧️', label:'Heavy Drizzle'   },
  61: { icon:'🌧️', label:'Light Rain'      },
  63: { icon:'🌧️', label:'Rain'            },
  65: { icon:'🌧️', label:'Heavy Rain'      },
  71: { icon:'🌨️', label:'Light Snow'      },
  73: { icon:'❄️',  label:'Snow'           },
  75: { icon:'❄️',  label:'Heavy Snow'     },
  77: { icon:'🌨️', label:'Snow Grains'     },
  80: { icon:'🌦️', label:'Showers'         },
  81: { icon:'🌧️', label:'Heavy Showers'   },
  82: { icon:'⛈️', label:'Violent Showers' },
  85: { icon:'🌨️', label:'Snow Showers'    },
  86: { icon:'🌨️', label:'Heavy Snow Showers'},
  95: { icon:'⛈️', label:'Thunderstorm'    },
  96: { icon:'⛈️', label:'T-Storm + Hail'  },
  99: { icon:'⛈️', label:'T-Storm + Hail'  },
};

function wxCodeInfo(code) {
  return WX_CODES[code] || { icon:'🌡️', label:'Unknown' };
}

// Geocode a free-text address → {lat,lon,label} or null
async function wxGeocode(address) {
  if (!address || !address.trim()) return null;
  const key = address.trim().toLowerCase();
  if (_wxGeoCache[key]) return _wxGeoCache[key];
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (!data.length) return null;
    const r = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name.split(',').slice(0,2).join(', ') };
    _wxGeoCache[key] = r;
    return r;
  } catch(e) { return null; }
}

// Fetch weather for a lat/lon on a specific YYYY-MM-DD date
// Returns { hi, lo, code, icon, label, precip } or null
async function wxFetchDay(lat, lon, dateStr) {
  const cacheKey = lat.toFixed(4)+'|'+lon.toFixed(4)+'|'+dateStr;
  if (_wxDayCache[cacheKey]) return _wxDayCache[cacheKey];
  // Check sessionStorage
  try {
    const cached = sessionStorage.getItem('wxc_'+cacheKey);
    if (cached) { const r = JSON.parse(cached); _wxDayCache[cacheKey] = r; return r; }
  } catch(e) {}

  try {
    // Open-Meteo supports up to 92 past days on the forecast endpoint via past_days param
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    const targetDate = new Date(dateStr);
    const todayDate  = new Date(todayStr);
    const diffDays   = Math.round((targetDate - todayDate) / 86400000);
    // Build URL with past_days for historical or forecast_days for future
    let url;
    if (diffDays < 0) {
      // Past date — use past_days parameter (max 92)
      const pastDays = Math.min(Math.abs(diffDays) + 1, 92);
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York&past_days=${pastDays}&forecast_days=1&start_date=${dateStr}&end_date=${dateStr}`;
    } else {
      // Today or future — standard forecast endpoint (up to 16 days)
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York&start_date=${dateStr}&end_date=${dateStr}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (!data.daily || !data.daily.time || !data.daily.time.length) return null;
    // Open-Meteo renamed 'weathercode' → 'weather_code' — support both
    const codeArr = data.daily.weather_code || data.daily.weathercode;
    if (!codeArr || !codeArr.length) return null;
    const code = codeArr[0];
    const info = wxCodeInfo(code);
    const r = {
      hi:     Math.round(data.daily.temperature_2m_max[0]),
      lo:     Math.round(data.daily.temperature_2m_min[0]),
      code,
      icon:   info.icon,
      label:  info.label,
      precip: data.daily.precipitation_sum[0],
    };
    _wxDayCache[cacheKey] = r;
    try { sessionStorage.setItem('wxc_'+cacheKey, JSON.stringify(r)); } catch(e) {}
    return r;
  } catch(e) { return null; }
}

// Resolve lat/lon for a schedule block:
// 1. Get jobNum from block fields → look up backlogJobs → get location
// 2. Geocode that address
// 3. Fallback to Marshfield if missing/failed
async function wxResolveBlock(fields) {
  const jobNum = (fields.jobNum||'').trim();
  let address = '';

  if (jobNum) {
    const job = (backlogJobs||[]).find(j => j.num && j.num.trim().toLowerCase() === jobNum.toLowerCase());
    if (job && job.location && job.location.trim()) {
      address = job.location.trim();
    }
  }

  // Also try matching by job name if no num
  if (!address) {
    const jobName = (fields.jobName||'').trim();
    if (jobName) {
      // "GC — Project Name" format
      const namePart = jobName.includes(' \u2014 ') ? jobName.split(' \u2014 ')[1] : jobName;
      const job = (backlogJobs||[]).find(j => {
        const jfull = j.gc && j.name ? j.gc + ' \u2014 ' + j.name : j.name;
        return jfull === jobName || j.name === namePart;
      });
      if (job && job.location && job.location.trim()) {
        address = job.location.trim();
      }
    }
  }

  if (address) {
    const geo = await wxGeocode(address);
    if (geo) return { lat: geo.lat, lon: geo.lon, label: geo.label };
  }

  return { lat: WX_DEFAULT_LAT, lon: WX_DEFAULT_LON, label: WX_DEFAULT_LABEL };
}

// Paint weather overlay into an already-rendered block element
async function wxPaintBlock(blockEl, dateKey, fields) {
  const geo = await wxResolveBlock(fields);
  const wx  = await wxFetchDay(geo.lat, geo.lon, dateKey);
  if (!wx) return;

  // Inject the faded background overlay
  const old = blockEl.querySelector('.sched-wx-bg');
  if (old) old.remove();
  const oldPill = blockEl.querySelector('.sched-wx-pill');
  if (oldPill) oldPill.remove();

  const bg = document.createElement('div');
  bg.className = 'sched-wx-bg';
  bg.innerHTML = `<div class="sched-wx-icon">${wx.icon}</div><div class="sched-wx-temps">${wx.hi}° / ${wx.lo}°</div>`;
  blockEl.insertBefore(bg, blockEl.firstChild);

  const pill = document.createElement('div');
  pill.className = 'sched-wx-pill';
  const precipStr = wx.precip > 0 ? ` · ${wx.precip}"` : '';
  pill.title = `${wx.label} · High ${wx.hi}°F · Low ${wx.lo}°F${precipStr ? ' · Precip '+wx.precip+'"' : ''} · ${geo.label}`;
  pill.textContent = `${wx.icon} ${wx.hi}°/${wx.lo}°${precipStr}`;
  blockEl.appendChild(pill);
}

// Called after renderSchedule — paints weather on all non-blank schedule blocks
function wxPaintAllBlocks() {
  // Group non-blank blocks by date — one geo+weather fetch per date, painted to all blocks that day
  const dateMap = {};
  document.querySelectorAll('.sched-block[data-date-key]').forEach(blockEl => {
    const dateKey   = blockEl.dataset.dateKey;
    const blockType = blockEl.dataset.blockType || 'blank';
    if (!dateKey || blockType === 'blank') return;
    const fields = {};
    blockEl.querySelectorAll('textarea[data-field]').forEach(t => {
      if (t.dataset.field) fields[t.dataset.field] = t.value;
    });
    if (!dateMap[dateKey]) dateMap[dateKey] = [];
    dateMap[dateKey].push({ blockEl, fields });
  });

  const dateKeys = Object.keys(dateMap);
  if (!dateKeys.length) return;

  async function paintDate(dateKey) {
    const entries = dateMap[dateKey];
    if (!entries || !entries.length) return;
    try {
      const geo = await wxResolveBlock(entries[0].fields);
      const wx  = await wxFetchDay(geo.lat, geo.lon, dateKey);
      if (!wx) return;
      const precipStr = wx.precip > 0 ? ' · ' + wx.precip + '"' : '';
      entries.forEach(function({ blockEl }) {
        var oldBg = blockEl.querySelector('.sched-wx-bg');
        if (oldBg) oldBg.remove();
        var oldPill = blockEl.querySelector('.sched-wx-pill');
        if (oldPill) oldPill.remove();
        var bg = document.createElement('div');
        bg.className = 'sched-wx-bg';
        bg.innerHTML = '<div class="sched-wx-icon">' + wx.icon + '</div><div class="sched-wx-temps">' + wx.hi + '° / ' + wx.lo + '°</div>';
        blockEl.insertBefore(bg, blockEl.firstChild);
        var pill = document.createElement('div');
        pill.className = 'sched-wx-pill';
        pill.title = wx.label + ' · High ' + wx.hi + '°F · Low ' + wx.lo + '°F' + (precipStr ? ' · Precip ' + wx.precip + '"' : '') + ' · ' + geo.label;
        pill.textContent = wx.icon + ' ' + wx.hi + '°/' + wx.lo + '°' + precipStr;
        blockEl.appendChild(pill);
      });
    } catch(e) { /* silently skip this date */ }
  }

  var i = 0;
  function next() {
    if (i >= dateKeys.length) { _schedEqDebounced(); return; }
    paintDate(dateKeys[i++]).then(next).catch(next);
  }
  for (var t = 0; t < Math.min(4, dateKeys.length); t++) next();
}

function saveSpecialActions() {
  localStorage.setItem(SPECIAL_ACTIONS_KEY, JSON.stringify(specialActions));
  _checkLocalStorageSize();
  try { if (db) fbSet('special_actions', specialActions); } catch(e) {}
}
// ── Special Actions on Schedule ──────────────────────────────────────────────

function openSpecialActionDrop(key, slot, btn) {
  // Close any open dropdown first
  document.getElementById('saDropMenu')?.remove();

  const bdata = getSlotData(key, slot);
  const fields = bdata.fields || {};
  const assigned = fields._specialActions || [];

  // Filter out already-assigned ones + hide sa6 (vacation) from unauthorized users
  const available = specialActions.filter(sa => !assigned.includes(sa.id) && (sa.id !== 'sa6' || canSeeVacation()));
  if (!available.length) {
    btn.textContent = '✓ All assigned';
    setTimeout(() => { btn.textContent = '+ Action'; }, 1200);
    return;
  }

  const drop = document.createElement('div');
  drop.id = 'saDropMenu';
  drop.className = 'sa-drop';
  drop.innerHTML = available.map(sa => `
    <div class="sa-drop-item" tabindex="0" onmousedown="event.preventDefault();addSchedSpecialAction('${key}','${slot}','${sa.id}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();addSchedSpecialAction('${key}','${slot}','${sa.id}');}if(event.key==='ArrowDown'&&this.nextElementSibling){event.preventDefault();this.nextElementSibling.focus();}if(event.key==='ArrowUp'&&this.previousElementSibling){event.preventDefault();this.previousElementSibling.focus();}if(event.key==='Escape'){document.getElementById('saDropMenu')?.remove();}">
      <span class="sa-dot" style="background:${sa.color};"></span>
      <span>${sa.label}</span>
    </div>`).join('');

  // Position anchored to the button
  const rect = btn.getBoundingClientRect();
  // Find nearest sched-notes-wrap and append there for proper z-index
  const wrap = btn.closest('.sched-notes-wrap');
  if (wrap) {
    drop.style.position = 'absolute';
    drop.style.top = '100%';
    drop.style.left = '0';
    drop.style.right = '0';
    wrap.appendChild(drop);
  } else {
    drop.style.position = 'fixed';
    drop.style.top  = rect.bottom + 4 + 'px';
    drop.style.left = rect.left   + 'px';
    drop.style.width = '220px';
    document.body.appendChild(drop);
  }

  // Auto-focus first item for keyboard nav
  setTimeout(() => { drop.querySelector('.sa-drop-item')?.focus(); }, 30);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function _sa() {
      document.getElementById('saDropMenu')?.remove();
      document.removeEventListener('click', _sa);
    });
  }, 10);
}

function getSlotData(key, slot) {
  if (slot === 'top' || slot === 'bottom') {
    return schedData[key]?.[slot] || { type:'blank', fields:{} };
  }
  const idx = parseInt(slot.replace('extra_',''));
  return schedData[key]?.extras?.[idx]?.data || { type:'blank', fields:{} };
}

function addSchedSpecialAction(key, slot, saId) {
  document.getElementById('saDropMenu')?.remove();
  // Vacation action needs a picker — intercept before saving
  const saInfo = specialActions.find(s => s.id === saId);
  if (saInfo && saInfo.id === 'sa6') {
    openVacationPicker(key, slot, saId);
    return;
  }
  // Milling / Grading actions need a location — intercept before saving
  if (saInfo && _saIsLocationAction(saInfo)) {
    openSALocationPicker(key, slot, saId);
    return;
  }
  const bdata = getSlotData(key, slot);
  if (!bdata.fields) bdata.fields = {};
  const current = bdata.fields._specialActions || [];
  if (!current.includes(saId)) {
    bdata.fields._specialActions = [...current, saId];
    // Write back
    if (slot === 'top' || slot === 'bottom') {
      if (!schedData[key]) schedData[key] = {};
      schedData[key][slot] = bdata;
    } else {
      const idx = parseInt(slot.replace('extra_',''));
      if (schedData[key]?.extras?.[idx]) schedData[key].extras[idx].data = bdata;
    }
    saveSchedDataDirect();
    renderSchedule();
  }
}

function removeSchedSpecialAction(key, slot, saId) {
  const bdata = getSlotData(key, slot);
  if (!bdata.fields) return;
  bdata.fields._specialActions = (bdata.fields._specialActions || []).filter(id => id !== saId);
  if (bdata.fields._saLocations) delete bdata.fields._saLocations[saId];
  if (slot === 'top' || slot === 'bottom') {
    if (!schedData[key]) schedData[key] = {};
    schedData[key][slot] = bdata;
  } else {
    const idx = parseInt(slot.replace('extra_',''));
    if (schedData[key]?.extras?.[idx]) schedData[key].extras[idx].data = bdata;
  }
  saveSchedDataDirect();
  renderSchedule();
}

// ── Milling / Grading location picker ────────────────────────────────────────

function _saIsLocationAction(saInfo) {
  var lbl = (saInfo && saInfo.label || '').toLowerCase();
  return lbl.indexOf('milling') >= 0 || lbl.indexOf('grader') >= 0;
}

function openSALocationPicker(key, slot, saId, onConfirm) {
  document.getElementById('saLocPicker')?.remove();
  var saInfo = specialActions.find(function(s) { return s.id === saId; });
  if (!saInfo) return;

  var overlay = document.createElement('div');
  overlay.id = 'saLocPicker';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';

  overlay.innerHTML =
    '<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:22px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.6);">' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1px;color:var(--stripe);margin-bottom:4px;">📍 ' + saInfo.label + '</div>' +
      '<div style="font-family:\'DM Sans\',sans-serif;font-size:12px;color:var(--concrete-dim);margin-bottom:14px;">Type a location or select from matching jobs</div>' +
      '<div style="position:relative;">' +
        '<input id="saLocInput" type="text" placeholder="Location, street, or job name…" autocomplete="off"' +
          ' style="width:100%;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 12px;color:var(--white);font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:700;box-sizing:border-box;outline:none;"' +
          ' oninput="saLocFilter(this.value)" onkeydown="saLocKeydown(event)" />' +
        '<div id="saLocSuggestions" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:10001;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-top:none;border-radius:0 0 var(--radius) var(--radius);max-height:200px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.5);"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">' +
        '<button onclick="document.getElementById(\'saLocPicker\').remove()"' +
          ' style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:8px 18px;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">' +
          'Cancel</button>' +
        '<button id="saLocConfirm"' +
          ' style="background:#1a3000;border:1px solid rgba(134,239,172,0.5);border-radius:var(--radius);padding:8px 18px;color:#86efac;font-family:\'DM Sans\',sans-serif;font-size:12px;font-weight:800;cursor:pointer;">' +
          '📍 Save Location</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  setTimeout(function() { document.getElementById('saLocInput')?.focus(); }, 60);

  document.getElementById('saLocConfirm').onclick = function() {
    var loc = (document.getElementById('saLocInput')?.value || '').trim();
    if (onConfirm) { onConfirm(loc); } else { _commitSAWithLocation(key, slot, saId, loc); }
    document.getElementById('saLocPicker')?.remove();
  };

  overlay.addEventListener('mousedown', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

function saLocFilter(query) {
  var box = document.getElementById('saLocSuggestions');
  if (!box) return;
  var q = (query || '').trim().toLowerCase();
  if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
  var jobs = (typeof backlogJobs !== 'undefined' ? backlogJobs : []);
  var matches = jobs.filter(function(j) {
    var num  = (j.num || j.jobNum || '').toString().toLowerCase();
    var name = (j.name || j.jobName || '').toString().toLowerCase();
    return num.indexOf(q) >= 0 || name.indexOf(q) >= 0;
  }).slice(0, 12);
  if (!matches.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.innerHTML = matches.map(function(j) {
    var num  = j.num  || j.jobNum  || '';
    var name = j.name || j.jobName || '';
    var display = (num ? '# ' + num : '') + (num && name ? ' — ' : '') + name;
    var safe = display.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<div style="padding:8px 14px;cursor:pointer;display:flex;align-items:baseline;gap:8px;" ' +
      'onmousedown="event.preventDefault();saLocPickSuggestion(\'' + safe + '\')" ' +
      'onmouseover="this.style.background=\'rgba(245,197,24,0.1)\'" ' +
      'onmouseout="this.style.background=\'\'">' +
      '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);flex-shrink:0;">' + (num ? '#' + num : '') + '</span>' +
      '<span style="font-family:\'DM Sans\',sans-serif;font-size:12px;color:var(--white);">' + (name || display) + '</span>' +
      '</div>';
  }).join('');
  box.style.display = 'block';
}

function saLocPickSuggestion(text) {
  var input = document.getElementById('saLocInput');
  if (input) { input.value = text; input.focus(); }
  var box = document.getElementById('saLocSuggestions');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function saLocKeydown(e) {
  if (e.key === 'Enter') { document.getElementById('saLocConfirm')?.click(); }
  if (e.key === 'Escape') { document.getElementById('saLocPicker')?.remove(); }
}

function _commitSAWithLocation(key, slot, saId, location) {
  var bdata = getSlotData(key, slot);
  if (!bdata.fields) bdata.fields = {};
  var current = bdata.fields._specialActions || [];
  if (!current.includes(saId)) bdata.fields._specialActions = [...current, saId];
  if (location) {
    bdata.fields._saLocations = Object.assign({}, bdata.fields._saLocations || {});
    bdata.fields._saLocations[saId] = location;
  }
  if (slot === 'top' || slot === 'bottom') {
    if (!schedData[key]) schedData[key] = {};
    schedData[key][slot] = bdata;
  } else {
    var idx = parseInt(slot.replace('extra_',''));
    if (schedData[key]?.extras?.[idx]) schedData[key].extras[idx].data = bdata;
  }
  saveSchedDataDirect();
  renderSchedule();
}

function _commitDayNoteSAWithLocation(key, saId, location) {
  if (!schedData[key]) schedData[key] = {};
  const cur = schedData[key].dayNoteSA || [];
  if (!cur.includes(saId)) schedData[key].dayNoteSA = [...cur, saId];
  if (location) {
    schedData[key].dayNoteSALocations = Object.assign({}, schedData[key].dayNoteSALocations || {});
    schedData[key].dayNoteSALocations[saId] = location;
  }
  saveSchedDataDirect();
  renderSchedule();
}

// ── Load Special Actions from Firebase ───────────────────────────────────────


function saveMaterialList() { localStorage.setItem(MATERIAL_KEY, JSON.stringify(materialList)); _checkLocalStorageSize(); fbSet('materials', materialList); }

// ── Awarding Authorities ──────────────────────────────────────

const TRUCK_PRICING_KEY = 'pavescope_truck_pricing';
// Shape:
//   dmc: { rateType, ratePerLoad, ratePerDay, notes }   — single DMC fleet rate
//   brokers:   [ { id, name, rateType, ratePerLoad, ratePerDay, notes } ]
//   suppliers: [ { id, name, rateType, ratePerLoad, ratePerDay, notes } ]
function _defaultTruckPricing() {
  return {
    dmc:       { rateType: 'load', ratePerLoad: 0, ratePerDay: 0, ratePerHour: 0, notes: '' },
    brokers:   [],
    suppliers: [],
  };
}
function _migrateTruckPricing(raw) {
  // Migrate old flat broker/supplier keys to new arrays
  if (!raw) return _defaultTruckPricing();
  const out = { ..._defaultTruckPricing(), ...raw };
  if (!Array.isArray(out.brokers)) {
    const old = raw.broker || {};
    out.brokers = old.ratePerLoad || old.ratePerDay
      ? [{ id: '1', name: 'Default Broker', rateType: old.rateType||'load', ratePerLoad: old.ratePerLoad||0, ratePerDay: old.ratePerDay||0, notes: old.notes||'' }]
      : [];
  }
  if (!Array.isArray(out.suppliers)) {
    const old = raw.supplier || {};
    out.suppliers = old.ratePerLoad || old.ratePerDay
      ? [{ id: '1', name: 'Default Supplier', rateType: old.rateType||'load', ratePerLoad: old.ratePerLoad||0, ratePerDay: old.ratePerDay||0, notes: old.notes||'' }]
      : [];
  }
  return out;
}
var truckPricing = _migrateTruckPricing((function(){ try { return JSON.parse(localStorage.getItem(TRUCK_PRICING_KEY)); } catch(e) { return null; } })());
function saveTruckPricing() {
  localStorage.setItem(TRUCK_PRICING_KEY, JSON.stringify(truckPricing));
  _checkLocalStorageSize();
  try { if (db) fbSet('truck_pricing', truckPricing); } catch(e) {}
}
// Lookup helpers — used by calcProjectedTrucking
function getTruckRate(category, name) {
  // category: 'dmc' | 'broker' | 'supplier'
  if (category === 'dmc') return truckPricing.dmc || {};
  const list = category === 'broker' ? (truckPricing.brokers||[]) : (truckPricing.suppliers||[]);
  // Match by name (case-insensitive) first, then fall back to first entry, then empty
  const n = (name||'').trim().toLowerCase();
  return list.find(e => e.name.trim().toLowerCase() === n)
      || list[0]
      || { rateType: 'manual', ratePerLoad: 0, ratePerDay: 0 };
}
function applyRate(rateObj, count) {
  if (!count || !rateObj) return 0;
  if (rateObj.rateType === 'load')   return count * (parseFloat(rateObj.ratePerLoad)||0);
  if (rateObj.rateType === 'day')    return count * (parseFloat(rateObj.ratePerDay)||0);
  if (rateObj.rateType === 'hourly') return count * (parseFloat(rateObj.ratePerHour)||0);
  return 0;
}


const AIA_REQS_KEY = 'pavescope_aia_reqs';
const QSJ_KEY      = 'pavescope_quarterly_sales_journal';
// AIA Req shape: { id, reqNo, dateCreated, dateWorkDone, jobNo, gcName, jobName, reqAmount, costAmount, notes, fileData, fileName, fileType, fileSizeKB }
// QSJ entry shape: auto-generated from AIA reqs — derived, not separately stored
var aiaReqs = (function(){ try { const p = JSON.parse(localStorage.getItem(AIA_REQS_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();

// ── Bills in Progress ──────────────────────────────────────────────────────
// Each bill: { id, jobName, jobNum, gcName, backlogJobId, schedDates[], isMultiDay,
//   shifts:[{date,foreman,tonnage,confirmed,confirmedAt,confirmedBy}],
//   totalTonnage, personnelConfirmed, status:'accumulating'|'pending_tonnage'|'ready'|'generated',
//   notes, createdAt, updatedAt, generatedReqId }
const BILLS_KEY     = 'dmc_bills_progress';
const BILLS_DAY_KEY = 'dmc_bills_last_day';
var billsInProgress = [];
function _billsLoad() {
  try { billsInProgress = JSON.parse(localStorage.getItem(BILLS_KEY) || '[]'); } catch(e) { billsInProgress = []; }
}
function _billsSave() {
  localStorage.setItem(BILLS_KEY, JSON.stringify(billsInProgress));
  _checkLocalStorageSize();
  try { if (db) fbSet('bills_in_progress', billsInProgress); } catch(e) {}
}
_billsLoad();

function saveAiaReqs() {
  // Strip legacy base64 fileData — files now in Firebase Storage
  const slim = aiaReqs.map(r => {
    const { fileData, ...rest } = r;
    return rest;
  });
  localStorage.setItem(AIA_REQS_KEY, JSON.stringify(slim));
  _checkLocalStorageSize();
  try { if (db) fbSet('aia_reqs', slim); } catch(e) { _logFbError('saveAiaReqs', e); }
}
// ── Paving Slips ──────────────────────────────────────────────────────────────
// Slip shape: { id, jobId, jobName, jobNum, reqId, date:'YYYY-MM-DD', mixType,
//   tons, rapPct, plant, truckNum, ticketNo, photoUrl, autoScanned, notes, createdAt }
const TAKEOFFS_KEY = 'dmc_takeoffs';
var takeoffFolders = [];
function _toFoldersLoad() { try { takeoffFolders = JSON.parse(localStorage.getItem(TAKEOFFS_KEY)||'[]'); } catch(e) { takeoffFolders=[]; } }
function _toFoldersSave() { localStorage.setItem(TAKEOFFS_KEY, JSON.stringify(takeoffFolders)); _checkLocalStorageSize(); }
_toFoldersLoad();
_slipsLoad();

function _normalizeMixType(mixCode, mixType) {
  if (!mixCode) return mixType;
  var key = mixCode.trim().toLowerCase();
  var existing = pavingSlips.find(function(s) {
    return s.mixCode && s.mixCode.trim().toLowerCase() === key
      && s.mixType && s.mixType.trim() !== '';
  });
  return existing ? existing.mixType : mixType;
}


// Silent global mix type normalization on load
(function() {
  var codeGroups = {};
  pavingSlips.forEach(function(s) {
    if (!s.mixCode || !s.mixType) return;
    var key = s.mixCode.trim().toLowerCase();
    if (!codeGroups[key]) codeGroups[key] = [];
    codeGroups[key].push(s.mixType.trim());
  });
  var changed = false;
  pavingSlips = pavingSlips.map(function(s) {
    if (!s.mixCode) return s;
    var key = s.mixCode.trim().toLowerCase();
    var names = codeGroups[key];
    if (!names) return s;
    var counts = {};
    names.forEach(function(t){ counts[t]=(counts[t]||0)+1; });
    var best = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; })[0];
    if (best && s.mixType !== best) { changed=true; return Object.assign({},s,{mixType:best}); }
    return s;
  });
  if (changed) _slipsSave();
})();

const AA_KEY = 'pavescope_awarding_authorities';
// Shape: [{ id, name, website, notifTitle, notifMsg }]
var awardingAuthorities = (function(){ try { const p = JSON.parse(localStorage.getItem(AA_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();
function saveAwardingAuthorities() {
  localStorage.setItem(AA_KEY, JSON.stringify(awardingAuthorities));
  _checkLocalStorageSize();
  try { if(db) fbSet('awarding_authorities', awardingAuthorities); } catch(e) {}
}


// ── Suppliers & Plants roster ──
// Data shape: suppliersList = [ { name: "Green Diamond", plants: ["Concord, NH", "Bow, NH"] }, … ]
// plantsList is a derived flat array kept for backward compatibility with all existing pickers/lookahead code.
const SUPPLIERS_KEY = 'pavescope_suppliers';
const PLANTS_KEY    = 'pavescope_plants';   // kept so old localStorage key still saves/loads

function _migrateSuppliers() {
  // If we already have the new structure, use it
  const stored = localStorage.getItem(SUPPLIERS_KEY);
  if (stored) { try { const p = JSON.parse(stored); if (Array.isArray(p)) return p; } catch(e) {} }

  // Migrate from old flat plantsList
  const oldFlat = JSON.parse(localStorage.getItem(PLANTS_KEY) || 'null');
  const flatArr = Array.isArray(oldFlat) ? oldFlat : [
    'Green Diamond — Concord, NH',
    'Aggregate Industries — Chelmsford, MA',
    'Pike Industries — Tilton, NH',
    'Granite State Concrete — Manchester, NH',
    'Continental Paving — Londonderry, NH',
  ];
  // Convert "Supplier — Location, ST" → { name:"Supplier", plants:["Location, ST"] }
  const map = {};
  flatArr.forEach(p => {
    const parts = p.split('—').map(s => s.trim());
    const sup = parts[0] || p;
    const loc = parts.slice(1).join('—').trim();
    if (!map[sup]) map[sup] = [];
    if (loc && !map[sup].includes(loc)) map[sup].push(loc);
  });
  return Object.keys(map).map(name => ({ name, plants: map[name] }));
}

var suppliersList = _migrateSuppliers();

function saveSuppliersList() {
  localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(suppliersList));
  _checkLocalStorageSize();
  // Keep flat plantsList in old key so Firebase sync & any legacy reads still work
  localStorage.setItem(PLANTS_KEY, JSON.stringify(getPlantsList()));
  _checkLocalStorageSize();
  fbSet('plants', getPlantsList());
}

/** Returns the flat "Supplier — Location" array used by all existing pickers */
function getPlantsList() {
  const flat = [];
  suppliersList.forEach(s => {
    if (s.plants && s.plants.length) {
      s.plants.forEach(p => flat.push(`${s.name} — ${p}`));
    } else {
      flat.push(s.name);
    }
  });
  return flat;
}

// Backward-compat shim: plantsList is a live proxy via getter
// All existing code that reads `plantsList` will call getPlantsList() transparently.
Object.defineProperty(window, 'plantsList', {
  get: getPlantsList,
  set: function(val) {
    // Called by Firebase sync (val is old flat array) — migrate on the fly
    if (Array.isArray(val)) {
      const map = {};
      val.forEach(p => {
        const parts = p.split('—').map(s => s.trim());
        const sup = parts[0] || p;
        const loc = parts.slice(1).join('—').trim();
        if (!map[sup]) map[sup] = [];
        if (loc && !map[sup].includes(loc)) map[sup].push(loc);
      });
      suppliersList = Object.keys(map).map(name => ({ name, plants: map[name] }));
    }
  },
  configurable: true
});

// savePlantsList kept for backward compat (called by old pickers/backlog modal add-plant flows)
function savePlantsList() { saveSuppliersList(); }

// pending picker target
var operatorPickTarget = null;

function saveSchedData() {
  // Always save live — changes are immediately synced to Firebase for all users
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedData));
  _checkLocalStorageSize();
  fbSetSchedule();
  // Keep draft in sync
  schedDraft = JSON.parse(JSON.stringify(schedData));
  localStorage.setItem('pavescope_sched_draft', JSON.stringify(schedDraft));
  _checkLocalStorageSize();
  // Keep DJ's home Daily Overview widget in sync
  if (typeof _homeFleetRerender === 'function') _homeFleetRerender();
}

// Saves directly to Firebase regardless of edit mode (used for rain-out, holidays, etc.)
// Also syncs schedDraft so renderSchedule (which reads draft when in edit mode) stays current.
function saveSchedDataDirect() {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedData));
  _checkLocalStorageSize();
  fbSetSchedule();
  // Keep draft in sync so the visual render reflects the change immediately
  schedDraft = JSON.parse(JSON.stringify(schedData));
  localStorage.setItem('pavescope_sched_draft', JSON.stringify(schedDraft));
  _checkLocalStorageSize();
  // Keep DJ's home Daily Overview widget in sync
  if (typeof _homeFleetRerender === 'function') _homeFleetRerender();
}

// ── Enter edit mode ──
// ── Publish schedule — with centered confirm modal ──
function publishSchedule() {
  if (!isAdmin()) return;
  document.getElementById('publishConfirmModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'publishConfirmModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9800;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1.5px;color:var(--stripe);margin-bottom:6px;">🚀 Publish Schedule</div>
      <div style="font-family:'DM Sans',sans-serif;font-size:14px;color:var(--white);margin-bottom:10px;line-height:1.5;">
        Save over the last published version and make your changes live for all users?
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);margin-bottom:22px;">
        This will overwrite the current published schedule. All users will see your version immediately.
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('publishConfirmModal').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:10px 20px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;">
          Cancel
        </button>
        <button onclick="confirmPublishSchedule()"
          style="background:var(--stripe);border:none;border-radius:var(--radius);padding:10px 22px;color:#000;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">
          🚀 Yes, Publish
        </button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

async function confirmPublishSchedule() {
  document.getElementById('publishConfirmModal')?.remove();

  // Check for conflicting editor
  const myUser = localStorage.getItem('dmc_u') || 'Admin';
  if (db) {
    try {
      const presenceDoc = await db.collection('app_data').doc('schedule_editing').get();
      if (presenceDoc.exists) {
        const presence = presenceDoc.data();
        const otherUser = presence.user || 'Another admin';
        if (otherUser.toLowerCase() !== myUser.toLowerCase()) {
          // Show conflict modal
          const cModal = document.createElement('div');
          cModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9801;display:flex;align-items:center;justify-content:center;padding:24px;';
          cModal.innerHTML = `
            <div style="background:var(--asphalt-mid);border:1px solid rgba(213,64,61,0.5);border-radius:var(--radius-lg);padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;color:var(--red);margin-bottom:10px;">⚠️ Publish Conflict</div>
              <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:var(--white);line-height:1.5;margin-bottom:20px;">
                <strong>${otherUser}</strong> is also editing the schedule.<br><br>
                Publishing now will overwrite their unsaved changes. Proceed?
              </div>
              <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button onclick="this.closest('[style*=fixed]').remove()"
                  style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>
                <button onclick="this.closest('[style*=fixed]').remove();doPublishSchedule()"
                  style="background:var(--red);border:none;border-radius:var(--radius);padding:9px 18px;color:#fff;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:800;cursor:pointer;">Overwrite &amp; Publish</button>
              </div>
            </div>`;
          document.body.appendChild(cModal);
          return;
        }
      }
    } catch(e) { /* offline */ }
  }
  doPublishSchedule();
}

async function doPublishSchedule() {
  // Push local schedData to Firebase
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedData));
  _checkLocalStorageSize();
  fbSetSchedule();

  // Write presence so others know we just published
  const myUser = localStorage.getItem('dmc_u') || 'Admin';
  if (db) {
    try {
      await db.collection('app_data').doc('schedule_editing').set({
        user: myUser, startedAt: Date.now(), data: JSON.stringify(schedData)
      });
      // Clear presence after short delay
      setTimeout(async () => {
        try { await db.collection('app_data').doc('schedule_editing').delete(); } catch(e) {}
      }, 2000);
    } catch(e) {}
  }
  localStorage.removeItem('pavescope_sched_draft');
  renderSchedule();
  pushNotif('success', '🚀 Schedule Published', 'Your changes are now live for all users.', null);
}


/**
 * Split schedData into per-month buckets and save each as its own Firestore doc
 * (doc id: "schedule_YYYY_MM"). This keeps each doc well under the 1 MB limit.
 */
function fbSetSchedule() {
  if (!db) return;
  // Group keys by YYYY_MM
  const buckets = {};
  Object.keys(schedData).forEach(key => {
    const m = key.match(/^(\d{4})-(\d{2})/);
    if (!m) return;
    const bucket = `schedule_${m[1]}_${m[2]}`;
    if (!buckets[bucket]) buckets[bucket] = {};
    buckets[bucket][key] = schedData[key];
  });
  // Save each bucket (fire-and-forget, no await needed here)
  Object.entries(buckets).forEach(([docId, data]) => {
    fbSetDoc(docId, data);
  });
  // If schedData is empty, also clear by writing an empty marker
  if (!Object.keys(buckets).length) fbSetDoc('schedule_empty', {});
}

async function fbSetDoc(docName, value) {
  if (!db) { localStorage.setItem('pavescope_fb_' + docName, JSON.stringify(value)); return; }
  _checkLocalStorageSize();
  try {
    setSyncBadge('saving');
    const payload = JSON.stringify(value);
    // Firestore 1MB doc limit safety check — fall back to localStorage if too large
    if (payload.length > 900000) {
      console.warn('fbSetDoc: payload too large for Firestore, localStorage only:', docName, payload.length);
      localStorage.setItem('pavescope_fb_' + docName, payload);
      _checkLocalStorageSize();
      setSyncBadge('synced');
      return;
    }
    await db.collection('app_data').doc(docName).set({ data: payload, updatedAt: Date.now() });
    setSyncBadge('synced');
  } catch(e) {
    console.warn('fbSetDoc error:', docName, e.message || e);
    localStorage.setItem('pavescope_fb_' + docName, JSON.stringify(value));
    _checkLocalStorageSize();
    // Only show error badge for non-size errors
    if (e.code === 'invalid-argument' || (e.message && e.message.includes('maximum'))) {
      setSyncBadge('synced'); // silently fall back — data is safe in localStorage
    } else {
      setSyncBadge('error');
    }
  }
}
function saveBlockTypes() { localStorage.setItem('pavescope_blocktypes', JSON.stringify(blockTypes)); _checkLocalStorageSize(); try { if(db) fbSet('blocktypes', blockTypes); } catch(e){} }

// ── Extra (additional foreman) block rendering ──
function renderExtraBlock(key, idx, ex, isLast) {
  const slot = `extra_${idx}`;
  const bdata = ex.data || { type:'blank', fields:{} };
  const effectiveType = bdata.type || 'blank';
  const btype = getBlockType(effectiveType);
  const isBlankExtra = effectiveType === 'blank';
  const extraBg = isBlankExtra ? '#ffffff' : btype.color;
  const fc = isBlankExtra ? '#000000' : (btype.fontColor || '#ffffff');
  const fields = bdata.fields || {};

  const fieldsHtml = BLOCK_FIELDS.map(f => {
    if (f.type === 'operators' || f.type === 'equipment' || f.type === 'material') {
      let chips = '';
      if (f.type === 'material') {
        const matItems = parseMaterialField(fields[f.key] || '');
        chips = matItems.map(item => {
          const label = materialChipLabel(item);
          return `<span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;">
            🪨 ${label}
            <button class="op-chip-del" style="color:#888;" onclick="removeMaterialItem('${key}','${slot}','${item.name.replace(/'/g,"\\'")}',this)" title="Remove">✕</button>
          </span>`;
        }).join('');
      } else {
        const ops = fields[f.key] ? fields[f.key].split(',').filter(Boolean) : [];
        chips = ops.map(op => `
          <span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;">
            ${op.trim()}
            <button class="op-chip-del" style="color:#888;" onclick="removePickerItem('${key}','${slot}','${f.key}','${op.trim().replace(/'/g,"\\'")}');renderSchedule();" title="Remove">✕</button>
          </span>`).join('');
      }
      return `<div class="sched-field sched-field-operators">
        <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
        <div class="op-chips-wrap mat-chips-wrap">${chips}
          <input class="mat-inline-search" placeholder="Search mix…" autocomplete="off"
            onfocus="openMatSearchFromInline(this,'${key}','${slot}')"
            oninput="openMatSearchFromInline(this,'${key}','${slot}')" />
        </div>
      </div>`;
    }
    // ── Plant field: single-value supplier/plant picker ──
    if (f.key === 'plant') {
      const cur = fields.plant || '';
      if (cur) {
        return `<div class="sched-field sched-field-operators">
          <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
          <div class="op-chips-wrap">
            <span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;cursor:pointer;" onclick="openSchedPlantPicker('${key}','${slot}',this)" title="Click to change plant">
              🏭 ${cur}
              <button class="op-chip-del" style="color:#888;" onclick="event.stopPropagation();clearSchedPlant('${key}','${slot}',this)" title="Clear plant">✕</button>
            </span>
          </div>
        </div>`;
      }
      return `<div class="sched-field sched-field-operators">
        <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
        <div class="op-chips-wrap">
          <button class="op-add-btn" style="color:${fc}60;border-color:${fc}30;" onclick="openSchedPlantPicker('${key}','${slot}',this)">+</button>
        </div>
      </div>`;
    }
    // ── Trucking field: label (hover = truck list, click = modal) + meta chips ──
    if (f.key === 'trucking') {
      let td = {};
      try { td = JSON.parse(fields.trucking || '{}'); } catch(e) {}
      const trucks = td.trucks || td.numTrucks || '';
      const load   = td.loadTime || '';
      const space  = td.spacing  || '';
      const metaChips = [
        trucks ? `🚛 ${trucks}` : '',
        load   ? `⏱ ${load}`   : '',
        space  ? `📏 ${space}` : '',
      ].filter(Boolean).map(m => `<span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;font-size:9px;padding:1px 6px;">${m}</span>`).join('');
      const hasAny = trucks || load || space;
      return `<div class="sched-field sched-field-operators">
        <div class="sched-field-label" style="color:${fc}80;cursor:default;"
          onmouseenter="showTruckingTooltip(event,'${key}','${slot}')"
          onmouseleave="hideTruckingTooltip()">${f.label}</div>
        <div class="op-chips-wrap">
          ${metaChips}
          ${!hasAny ? '<span style="font-size:11px;color:var(--concrete-dim);">—</span>' : ''}
        </div>
      </div>`;
    }

    if (f.buttons) {
      const cur = fields[f.key] || '';
      const btnsHtml = f.buttons.map(b => {
        const active = cur === b;
        return `<button class="sched-field-toggle ${active?'sched-field-toggle-on':''}"
          style="${active?`color:${fc};border-color:${fc}99;background:rgba(255,255,255,0.15);`:`color:${fc}50;border-color:${fc}25;`}"
          onclick="toggleSchedFieldBtn('${key}','${slot}','${f.key}','${b.replace(/'/g,"\\'")}',this)"
        >${b}</button>`;
      }).join('');
      return `<div class="sched-field">
        <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
        <div class="sched-field-btns">${btnsHtml}</div>
      </div>`;
    }
    // Job Name — backlog search dropdown
    if (f.key === 'jobName') {
      return `<div class="sched-field" style="position:relative;">
        <div class="sched-field-label" style="color:${fc}80;cursor:pointer;text-decoration:underline dotted;" title="Click to change job name"
          onclick="var ta=this.closest('.sched-field').querySelector('textarea');ta.focus();ta.select();schedJobNameInput(ta);">
          ${f.label}
        </div>
        <div style="position:relative;flex:1;">
          <textarea class="sched-field-input" rows="1"
            placeholder="—"
            style="color:${fc};width:100%;"
            data-key="${key}" data-slot="${slot}" data-field="${f.key}"
            autocomplete="off"
            onchange="saveSchedFieldExtra(this,'${key}',${idx})"
            oninput="autoResize(this);schedJobNameInput(this);"
            onblur="schedJobNameBlur(this)"
            onfocus="schedJobNameInput(this)"
            onkeydown="schedJobNameKeydown(event,this)"
          >${fields[f.key]||''}</textarea>
          <div class="sched-jobnum-drop" id="sjn-${key}-${slot}" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:3000;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:0 0 var(--radius) var(--radius);max-height:220px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.5);"
               onmouseenter="this._hovering=true" onmouseleave="this._hovering=false"></div>
        </div>
      </div>`;
    }
    // Job # — backlog number dropdown
    if (f.key === 'jobNum') {
      return `<div class="sched-field" style="position:relative;">
        <div class="sched-field-label" style="color:${fc}80;cursor:pointer;text-decoration:underline dotted;" title="Click to change job #"
          onclick="var ta=this.closest('.sched-field').querySelector('textarea');ta.focus();ta.select();schedJobNumInputExtra(ta,'${key}',${idx});">
          ${f.label}
        </div>
        <div style="position:relative;flex:1;">
          <textarea class="sched-field-input" rows="1"
            placeholder="—"
            style="color:${fc};width:100%;"
            data-key="${key}" data-slot="${slot}" data-field="${f.key}"
            autocomplete="off"
            onchange="saveSchedFieldExtra(this,'${key}',${idx});lookupBacklogByJobNumExtra(this,'${key}',${idx});"
            oninput="autoResize(this);schedJobNumInputExtra(this,'${key}',${idx});"
            onblur="schedJobNumBlurExtra(this,'${key}',${idx})"
            onfocus="schedJobNumInputExtra(this,'${key}',${idx})"
            onkeydown="schedJobNumKeydownExtra(event,this,'${key}',${idx})"
          >${fields[f.key]||''}</textarea>
          <div class="sched-jobnum-drop" id="sjde-${key}-${slot}" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:3000;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:0 0 var(--radius) var(--radius);max-height:220px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.5);"
               onmouseenter="this._hovering=true" onmouseleave="this._hovering=false"></div>
        </div>
      </div>`;
    }
    // Notes gets special treatment — taller, no label, no action button (special actions live on the day-note bar only)
    if (f.key === 'notes') {
      const saAssigned = (fields._specialActions || []);
      const saChipsHtml = saAssigned.length ? `<div class="sa-chips-row">` +
        saAssigned.map((sid,ci) => {
          const sa = specialActions.find(s => s.id === sid);
          if (!sa) return '';
          if (sa.id === 'sa6' && !canSeeVacation()) return '';
          const chipLabel1 = (sa.id === 'sa6' && fields._vacationPerson)
            ? fields._vacationPerson
            : (fields._saLocations?.[sid] ? sa.label + ' — ' + fields._saLocations[sid] : sa.label);
          return `<span class="sa-chip" style="color:#fff;border-color:${sa.color};background:${sa.color};">
            ${chipLabel1}
            <button style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);font-size:10px;padding:0;line-height:1;"
              onclick="event.stopPropagation();removeSchedSpecialAction('${key}','${slot}','${sid}')">✕</button>
          </span>`;
        }).join('') + `</div>` : '';
      return `<div class="sched-field sched-notes-wrap" id="sanw_${key}_${slot.replace(/[^a-z0-9]/g,'_')}">
        ${saChipsHtml}
        <textarea class="sched-field-input sched-notes-input" rows="1" placeholder="Notes…" style="color:${fc};"
          data-key="${key}" data-slot="${slot}" data-field="${f.key}"
          onchange="saveSchedFieldExtra(this,'${key}',${idx})"
          oninput="autoResize(this)">${fields[f.key]||''}</textarea>
      </div>`;
    }
    return `<div class="sched-field">
      <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
      <textarea class="sched-field-input" rows="1" placeholder="—" style="color:${fc};"
        data-key="${key}" data-slot="${slot}" data-field="${f.key}"
        onchange="saveSchedFieldExtra(this,'${key}',${idx})"
        oninput="autoResize(this)">${fields[f.key]||''}</textarea>
    </div>`;
  }).join('');

  const typeBtnsHtml = blockTypes.filter(t => t.id !== 'blank').map(t => {
    const active = effectiveType === t.id;
    return `<button class="sched-type-btn ${active?'active':''}"
      onclick="setExtraBlockType('${key}',${idx},'${t.id}')"
      title="${t.label}"
      style="${active?`border-color:${fc}80;background:rgba(255,255,255,0.15);color:${fc};`:`color:${fc}40;border-color:${fc}20;background:rgba(0,0,0,0.2);`}">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${t.color};border:1px solid rgba(255,255,255,0.3);vertical-align:middle;margin-right:3px;"></span>${active ? t.label.replace(' Work','').replace('Pending','Pend') : ''}
    </button>`;
  }).join('');

  const hasClip = !!schedClipboard;
  const copyPasteExtra = `
    <button class="sched-copy-btn" onclick="copySchedBlock('${key}','${slot}')" title="Copy this job card">📋</button>
    <button class="sched-paste-btn ${hasClip?'has-clip':''}" onclick="pasteSchedBlock('${key}','${slot}')" title="${hasClip?'Paste copied job here':'No job copied yet'}">📌</button>
    <button class="sched-queue-btn" onclick="addBlockToQueue('${key}','${slot}')" title="Send to queue">→</button>`;

  const isSecondStop = !!ex.parentSlot;
  return `
    <div class="sched-block sched-extra-block${isLast?' sched-block-bottom':''}${isSecondStop?' sched-second-stop':''}"
         data-date-key="${key}" data-block-slot="${slot}" data-block-type="${effectiveType}" data-parent-slot="${ex.parentSlot||''}"
         style="background:${extraBg};${isSecondStop?'border-left:3px solid var(--stripe);':''}"
         ondragover="schedBlockDragOver(event,'${key}','${slot}','${effectiveType}')"
         ondragleave="schedBlockDragLeave(event)"
         ondrop="schedBlockDrop(event,'${key}','${slot}','${effectiveType}')">
      <button class="sched-extra-remove" onclick="removeExtraBlock('${key}',${idx})" title="Remove this card">✕</button>
      ${isSecondStop ? '' : `
      <div class="sched-block-header">
        <div class="sched-block-header-row1">
          <span class="sched-foreman-name">${ex.foreman||'Extra Crew'}</span>
        </div>
        ${isAdmin() ? `<div class="sched-block-header-row2"><button class="sched-rainout-btn${bdata.rainedOut?' is-rained-out':''}" onclick="rainOutBlock('${key}','${slot}')" title="${bdata.rainedOut?'Remove rain-out flag':'Mark as rained out — pushes this job forward by 1 workday'}">🌧${bdata.rainedOut?' Rained Out':''}</button></div>` : ''}
      </div>`}
      <div class="sched-fields sched-drag-handle" draggable="true"
           ondragstart="schedBlockDragStart(event,'${key}','${slot}')"
           ondragend="schedBlockDragEnd(event)"
           style="cursor:grab;">
        ${fieldsHtml}
      </div>
      <div class="sched-type-btns">${typeBtnsHtml}${copyPasteExtra}</div>
    </div>`;
}

function saveSchedFieldExtra(el, key, idx) {
  const { slot, field } = el.dataset;
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key].extras) schedData[key].extras = [];
  if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
  if (!schedData[key].extras[idx].data.fields) schedData[key].extras[idx].data.fields = {};
  schedData[key].extras[idx].data.fields[field] = el.value;
  saveSchedData();
  if (field === 'jobNum' && el.value.trim()) {
    _schedCheckJobCompliance(el.value.trim(), el);
  }
}

function setExtraBlockType(key, idx, typeId) {
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key].extras) schedData[key].extras = [];
  if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
  const cur = schedData[key].extras[idx].data.type || 'blank';
  schedData[key].extras[idx].data.type = cur === typeId ? 'blank' : typeId;
  saveSchedData(); renderSchedule();
}

function removeExtraBlock(key, idx) {
  if (!schedData[key]?.extras) return;
  schedData[key].extras.splice(idx, 1);
  if (!schedData[key].extras.length) delete schedData[key].extras;
  saveSchedData(); renderSchedule();
}

// ── Add foreman modal ──

function openClearDayModal(key) {
  document.getElementById('clearDayModal')?.remove();

  // Build list of occupied blocks for this day
  const occupiedBlocks = [];

  const topData = (schedData[key]||{}).top;
  if (topData && topData.type && topData.type !== 'blank') {
    occupiedBlocks.push({ slot: 'top', label: 'Filipe Joaquim', jobName: topData.fields?.jobName || '(no job name)', type: topData.type });
  }
  const bottomData = (schedData[key]||{}).bottom;
  if (bottomData && bottomData.type && bottomData.type !== 'blank') {
    occupiedBlocks.push({ slot: 'bottom', label: 'Louie Medeiros', jobName: bottomData.fields?.jobName || '(no job name)', type: bottomData.type });
  }
  const extras = schedData[key]?.extras || [];
  extras.forEach((ex, idx) => {
    const exType = ex.data?.type || 'blank';
    const exJob  = ex.data?.fields?.jobName || (exType === 'blank' ? '(empty card)' : '(no job name)');
    const isSecondStop = !!ex.parentSlot;
    const label = (isSecondStop ? '↳ ' : '') + (ex.foreman || `Crew ${idx + 3}`) + (isSecondStop ? ' — 2nd Stop' : '');
    occupiedBlocks.push({ slot: `extra_${idx}`, label, jobName: exJob, type: exType });
  });

  if (!occupiedBlocks.length) {
    pushNotif('info', 'Nothing to Remove', 'All blocks on this day are already empty and no extra crews are assigned.', null);
    return;
  }

  const [yr, mo, dy] = key.split('-').map(Number);
  const dateLabel = new Date(yr, mo-1, dy).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

  const blockBtns = occupiedBlocks.map(b => {
    const btype = getBlockType(b.type);
    return `<button onclick="confirmClearBlock('${key}','${b.slot}')"
      style="width:100%;text-align:left;background:${btype.color}18;border:1px solid ${btype.color}40;border-radius:var(--radius);padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:all 0.15s;"
      onmouseover="this.style.background='${btype.color}30'"
      onmouseout="this.style.background='${btype.color}18'">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${btype.color};flex-shrink:0;"></span>
      <div>
        <div style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;color:#fff;">${b.label}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,0.5);margin-top:2px;">${b.jobName} · ${btype.label}</div>
      </div>
    </button>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'clearDayModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9600;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">Clear Job Card</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:18px;">${dateLabel} — select which crew to clear</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">${blockBtns}</div>
      <div style="display:flex;justify-content:flex-end;">
        <button onclick="document.getElementById('clearDayModal').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:8px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function confirmClearBlock(key, slot) {
  document.getElementById('clearDayModal')?.remove();
  if (slot.startsWith('extra_')) {
    // Remove the extra card entirely (not just blank the data)
    removeExtraBlock(key, parseInt(slot.replace('extra_', '')));
  } else {
    // clearBlockData already hooks into queue suggestion logic
    clearBlockData(key, slot);
    saveSchedData();
    renderSchedule();
  }
}

function openAddForemanModal(key) {
  openUnifiedSchedPicker({
    type: 'foreman',
    title: '👷 Add Crew to Day',
    key,
    slot: null,
    field: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED SCHEDULE PICKER
// A single consistent modal used by every + button on the schedule.
// type: 'foreman' | 'operators' | 'equipment' | 'material' | 'mixtype' | 'plant'
// ─────────────────────────────────────────────────────────────────────────────
function openUnifiedSchedPicker({ type, title, key, slot, field }) {
  document.getElementById('unifiedSchedPicker')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'unifiedSchedPicker';
  overlay.className = 'uspm-overlay';

  // ── helpers ──────────────────────────────────────────────────────────────
  function closePicker() { overlay.remove(); }

  // ── Build inner HTML based on type ───────────────────────────────────────
  let listHtml = '';
  let addSectionHtml = '';
  let footerHtml = '';
  let hasMaterialSave = false;

  if (type === 'foreman') {
    const roster = (foremanRoster.length ? foremanRoster : DEFAULT_FOREMANS);
    listHtml = roster.length
      ? roster.map(f => `
          <div class="uspm-item" onclick="uspmSelectForeman('${key}','${f.replace(/'/g,"\\'")}')">
            <span class="uspm-item-icon">👷</span>${f}
          </div>`).join('')
      : `<div class="uspm-empty">No foremans in roster yet.<br><span style="font-size:11px;">Add them in ⚙️ Settings → Rosters.</span></div>`;
    addSectionHtml = `
      <div class="uspm-add-section">
        <div class="uspm-add-label">Add New Foreman to Roster & Day</div>
        <div class="uspm-add-row">
          <input class="uspm-add-input" id="uspmNewForeman" placeholder="Foreman name…" />
          <button class="uspm-add-btn" onclick="uspmAddNewForeman('${key}')">Add</button>
        </div>
      </div>`;

  } else if (type === 'operators' || type === 'equipment') {
    const pool = type === 'equipment' ? equipmentList : operatorsList;
    const current = getPickerItems(key, slot, field);
    const icon = type === 'equipment' ? '🚜' : '👤';
    const placeholder = type === 'equipment' ? 'e.g. Paver, Roller…' : 'Name…';
    listHtml = pool.length
      ? pool.map(item => {
          const sel = current.includes(item);
          return `<div class="uspm-item ${sel ? 'selected' : ''}" onclick="uspmToggleItem('${key}','${slot}','${field}','${type}','${item.replace(/'/g,"\\'")}',this)">
            <span class="uspm-item-icon">${icon}</span>${item}
          </div>`;
        }).join('')
      : `<div class="uspm-empty">No ${type} in roster yet.<br><span style="font-size:11px;">Add them in ⚙️ Settings → Rosters.</span></div>`;
    addSectionHtml = `
      <div class="uspm-add-section">
        <div class="uspm-add-label">Add New ${type === 'equipment' ? 'Equipment' : 'Operator'} to Roster</div>
        <div class="uspm-add-row">
          <input class="uspm-add-input" id="uspmNewItem" placeholder="${placeholder}" />
          <button class="uspm-add-btn" onclick="uspmAddNewItem('${key}','${slot}','${field}','${type}')">Add</button>
        </div>
      </div>`;
    footerHtml = `<div class="uspm-footer"><button class="btn btn-primary" onclick="document.getElementById('unifiedSchedPicker').remove()">Done</button></div>`;

  } else if (type === 'material') {
    hasMaterialSave = true;
    const rawVal = (() => {
      if (slot.startsWith('extra_')) { const i=parseInt(slot.replace('extra_','')); return schedData[key]?.extras?.[i]?.data?.fields?.material||''; }
      return ((schedData[key]||{})[slot]||{}).fields?.material||'';
    })();
    const current = parseMaterialField(rawVal);
    const currentMap = {};
    current.forEach(it => { currentMap[it.name] = it.tons||''; });
    // Use mixTypesList as the single source — fall back to materialList for legacy
    const pool = mixTypesList.length ? mixTypesList : materialList.map(d => ({ desc: d, displayName: '', itemNo: '' }));
    listHtml = pool.length
      ? pool.map((entry, i) => {
          const desc = typeof entry === 'string' ? entry : entry.desc;
          const label = (typeof entry === 'object' && entry.displayName) ? entry.displayName : desc;
          const sub   = (typeof entry === 'object' && entry.itemNo) ? `#${entry.itemNo}` : '';
          const checked = currentMap.hasOwnProperty(desc);
          const tons = checked ? (currentMap[desc]||'') : '';
          return `<div class="uspm-mat-row${checked?' checked':''}" id="uspm-mat-row-${i}">
            <input type="checkbox" id="uspm-mat-chk-${i}" ${checked?'checked':''} onchange="uspmMatToggle(${i})" />
            <label class="uspm-mat-label" for="uspm-mat-chk-${i}">${label}${sub?`<span class="uspm-mat-sub" style="margin-left:8px;">${sub}</span>`:''}${label!==desc?`<span class="uspm-mat-sub" style="margin-left:6px;">${desc}</span>`:''}</label>
            <input type="number" class="uspm-mat-tons" id="uspm-mat-tons-${i}" value="${tons}" placeholder="tons" min="0" step="0.1" ${checked?'':'disabled'} oninput="uspmMatTonsInput(${i})" />
            <span class="uspm-mat-unit">T</span>
          </div>`;
        }).join('')
      : `<div class="uspm-empty">No mix types defined yet.<br><span style="font-size:11px;"><a href="#" onclick="openSettings('rosters');document.getElementById('unifiedSchedPicker')?.remove();" style="color:var(--blue);">Add them in ⚙️ Settings → Mix &amp; Materials</a></span></div>`;
    addSectionHtml = `
      <div class="uspm-add-section">
        <div class="uspm-add-label">Add New Mix Type</div>
        <div class="uspm-add-row">
          <button class="uspm-add-btn" style="width:100%;justify-content:center;" onclick="document.getElementById('unifiedSchedPicker')?.remove();openSettings('rosters');stngOpenAddMixType()">+ Open Mix Type Form</button>
        </div>
      </div>`;
    footerHtml = `<div class="uspm-footer">
      <button class="btn btn-ghost" onclick="document.getElementById('unifiedSchedPicker').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="uspmSaveMaterial('${key}','${slot}')">✓ Save</button>
    </div>`;

  } else if (type === 'mixtype') {
    const pool = mixTypesList;
    const rawVal = (() => {
      if (slot.startsWith('extra_')) { const i=parseInt(slot.replace('extra_','')); return schedData[key]?.extras?.[i]?.data?.fields?.material||''; }
      return ((schedData[key]||{})[slot]||{}).fields?.material||'';
    })();
    const current = parseMaterialField(rawVal);
    const currentNames = current.map(i => i.name);
    listHtml = pool.length
      ? pool.map(m => {
          const label = m.displayName || m.desc;
          const sub = m.itemNo ? `#${m.itemNo}` : '';
          const sel = currentNames.includes(m.desc);
          return `<div class="uspm-item ${sel?'selected':''}" onclick="uspmSelectMixType('${key}','${slot}','${m.desc.replace(/'/g,"\\'")}','${(m.displayName||'').replace(/'/g,"\\'")}')">
            <span class="uspm-item-icon">🪨</span>
            <span style="flex:1;">${label}</span>
            ${sub ? `<span class="uspm-item-sub">${sub}</span>` : ''}
            ${m.displayName && m.displayName!==m.desc ? `<span class="uspm-item-sub" style="margin-left:6px;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${m.desc}</span>` : ''}
          </div>`;
        }).join('')
      : `<div class="uspm-empty">No mix types defined yet.<br><span style="font-size:11px;"><a href="#" onclick="openSettings('rosters');document.getElementById('unifiedSchedPicker')?.remove();" style="color:var(--blue);">Add them in ⚙️ Settings → Mix Types</a></span></div>`;
    footerHtml = `<div class="uspm-footer"><button class="btn btn-primary" onclick="document.getElementById('unifiedSchedPicker').remove()">Done</button></div>`;

  } else if (type === 'plant') {
    const currentVal = (() => {
      if (slot.startsWith('extra_')) { const i=parseInt(slot.replace('extra_','')); return schedData[key]?.extras?.[i]?.data?.fields?.plant||''; }
      return ((schedData[key]||{})[slot]||{}).fields?.plant||'';
    })();
    if (!suppliersList.length) {
      listHtml = `<div class="uspm-empty">No suppliers yet.<br><span style="font-size:11px;"><a href="#" onclick="openSettings('plants');document.getElementById('unifiedSchedPicker')?.remove();" style="color:var(--blue);">⚙️ Add them in Settings → Suppliers</a></span></div>`;
    } else {
      suppliersList.forEach((sup, si) => {
        listHtml += `<div class="uspm-group-header">🏭 ${sup.name}</div>`;
        if (sup.plants.length) {
          sup.plants.forEach(loc => {
            const fullVal = `${sup.name} — ${loc}`;
            const sel = currentVal === fullVal;
            listHtml += `<div class="uspm-item ${sel?'selected':''}" onclick="uspmSelectPlant('${key.replace(/'/g,"\\'")}','${slot.replace(/'/g,"\\'")}','${fullVal.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
              <span class="uspm-item-icon">📍</span>${loc}
            </div>`;
          });
        } else {
          listHtml += `<div class="uspm-empty" style="padding:6px 22px;font-size:11px;font-style:italic;">No plant locations — add in Settings</div>`;
        }
      });
    }
    addSectionHtml = `
      <div class="uspm-add-section">
        <div class="uspm-add-label">Add New Supplier / Location</div>
        <div class="uspm-add-row">
          <input class="uspm-add-input" id="uspmNewPlant" placeholder="Supplier — Location…" />
          <button class="uspm-add-btn" onclick="uspmAddNewPlant('${key}','${slot}')">Add</button>
        </div>
      </div>`;
  }

  // ── Search bar only for multi-item lists ──────────────────────────────────
  const showSearch = (type !== 'material');
  const searchHtml = showSearch ? `
    <div class="uspm-search-wrap">
      <span class="uspm-search-icon">🔍</span>
      <input class="uspm-search" id="uspmSearch" placeholder="Search…" oninput="uspmFilter(this.value)" autocomplete="off" />
    </div>` : '';

  overlay.innerHTML = `
    <div class="uspm-box">
      <div class="uspm-header">
        <div class="uspm-title">${title}</div>
        <button class="uspm-close" onclick="document.getElementById('unifiedSchedPicker').remove()">✕</button>
      </div>
      ${searchHtml}
      <div class="uspm-list" id="uspmList">${listHtml}</div>
      ${addSectionHtml}
      ${footerHtml}
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Auto-focus search or first input
  setTimeout(() => {
    const s = document.getElementById('uspmSearch');
    if (s) { s.focus(); return; }
    const a = document.getElementById('uspmNewForeman') || document.getElementById('uspmNewItem') || document.getElementById('uspmNewMat') || document.getElementById('uspmNewPlant');
    // Only focus add input if list is empty
    const list = document.getElementById('uspmList');
    if (list && list.querySelector('.uspm-empty') && a) a.focus();
  }, 60);

  // Enter key on add inputs
  ['uspmNewForeman','uspmNewItem','uspmNewMat','uspmNewPlant'].forEach(id => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (id === 'uspmNewForeman') uspmAddNewForeman(key);
      else if (id === 'uspmNewItem') uspmAddNewItem(key, slot, field, type);
      else if (id === 'uspmNewMat')  uspmAddNewMat(key, slot);
      else if (id === 'uspmNewPlant') uspmAddNewPlant(key, slot);
    });
  });

  // Enter key anywhere in the picker: accept & close
  // - If picker has a footer primary button (Save / Done), click it
  // - Otherwise (single-select: foreman, plant, mixtype), click the first visible item
  const _addInputIds = new Set(['uspmNewForeman','uspmNewItem','uspmNewMat','uspmNewPlant']);
  overlay.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    // Let native button/checkbox Enter events pass through
    if (e.target.tagName === 'BUTTON') return;
    if (e.target.type === 'checkbox') return;
    // Let "add" inputs handle themselves (handled above)
    if (_addInputIds.has(e.target.id)) return;
    // Prefer footer primary button (Done / Save)
    const primaryBtn = overlay.querySelector('.uspm-footer .btn-primary');
    if (primaryBtn) { e.preventDefault(); primaryBtn.click(); return; }
    // Single-select mode: click first visible item
    const list = document.getElementById('uspmList');
    if (list) {
      const first = Array.from(list.querySelectorAll('.uspm-item')).find(el => el.offsetParent !== null && el.style.display !== 'none');
      if (first) { e.preventDefault(); first.click(); return; }
    }
    e.preventDefault();
    overlay.remove();
  });
}

// ── Unified picker action helpers ────────────────────────────────────────────

function uspmFilter(q) {
  const list = document.getElementById('uspmList');
  if (!list) return;
  const lq = q.toLowerCase();
  list.querySelectorAll('.uspm-item').forEach(el => {
    el.style.display = !q || el.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
  list.querySelectorAll('.uspm-group-header').forEach(hdr => {
    // Hide group header if all its following siblings until next header are hidden
    let next = hdr.nextElementSibling;
    let anyVisible = false;
    while (next && !next.classList.contains('uspm-group-header')) {
      if (next.style.display !== 'none') anyVisible = true;
      next = next.nextElementSibling;
    }
    hdr.style.display = anyVisible ? '' : 'none';
  });
}

function uspmSelectForeman(key, name) {
  document.getElementById('unifiedSchedPicker')?.remove();
  // Check if this foreman already has a card on this day — offer second-stop placement
  const dayData = schedData[key] || {};
  const topName    = foremanRoster[0] || 'Filipe Joaquim';
  const bottomName = foremanRoster[1] || 'Louie Medeiros';
  let existingSlot = null;
  if (name === topName)    existingSlot = 'top';
  else if (name === bottomName) existingSlot = 'bottom';
  else {
    const ex = dayData.extras || [];
    const eIdx = ex.findIndex(e => e.foreman === name);
    if (eIdx >= 0) existingSlot = 'extra_' + eIdx;
  }
  if (existingSlot !== null) {
    _showSecondStopConfirm(key, name, existingSlot);
  } else {
    _addForemanExtra(key, name, null);
  }
}

function _showSecondStopConfirm(key, name, existingSlot) {
  document.getElementById('_secondStopDlg')?.remove();
  const dlg = document.createElement('div');
  dlg.id = '_secondStopDlg';
  dlg.style.cssText = 'position:fixed;inset:0;z-index:9700;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);';
  const safeName = name.replace(/'/g,"\\'");
  dlg.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px 28px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">Second Stop?</div>
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);margin-bottom:18px;line-height:1.5;">
        <strong style="color:var(--white);">${name}</strong> already has a card today.<br>Add directly below their card, or as a separate crew?
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
        <button onclick="_addForemanExtra('${key}','${safeName}','${existingSlot}');document.getElementById('_secondStopDlg').remove();"
          style="text-align:left;padding:12px 16px;background:rgba(245,197,24,0.1);border:1px solid rgba(245,197,24,0.4);border-radius:var(--radius);cursor:pointer;transition:background 0.15s;"
          onmouseover="this.style.background='rgba(245,197,24,0.22)'"
          onmouseout="this.style.background='rgba(245,197,24,0.1)'">
          <div style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;color:var(--stripe);">↳ Second Stop</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:3px;">Card placed directly below ${name}'s existing card</div>
        </button>
        <button onclick="_addForemanExtra('${key}','${safeName}',null);document.getElementById('_secondStopDlg').remove();"
          style="text-align:left;padding:12px 16px;background:rgba(90,180,245,0.08);border:1px solid rgba(90,180,245,0.3);border-radius:var(--radius);cursor:pointer;transition:background 0.15s;"
          onmouseover="this.style.background='rgba(90,180,245,0.18)'"
          onmouseout="this.style.background='rgba(90,180,245,0.08)'">
          <div style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;color:#5ab4f5;">+ Separate Crew Card</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:3px;">Added as an independent card below all others</div>
        </button>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button onclick="document.getElementById('_secondStopDlg').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:8px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
}

function _addForemanExtra(key, name, parentSlot) {
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key].extras) schedData[key].extras = [];
  schedData[key].extras.push({ foreman: name, parentSlot: parentSlot || null, data: { type:'blank', fields:{} } });
  saveSchedData(); renderSchedule();
}

function uspmAddNewForeman(key) {
  const inp = document.getElementById('uspmNewForeman');
  const name = inp?.value.trim();
  if (!name) return;
  if (!foremanRoster.includes(name)) { foremanRoster.push(name); saveForemanRoster(); }
  uspmSelectForeman(key, name);
}

function uspmToggleItem(key, slot, field, type, name, el) {
  const items = getPickerItems(key, slot, field);
  const idx = items.indexOf(name);
  if (idx >= 0) items.splice(idx, 1); else items.push(name);
  setPickerItems(key, slot, field, items);
  el.classList.toggle('selected', items.includes(name));
  updatePickerChips(key, slot, field);
}

function uspmAddNewItem(key, slot, field, type) {
  const inp = document.getElementById('uspmNewItem');
  const name = inp?.value.trim();
  if (!name) return;
  const pool = type === 'equipment' ? equipmentList : operatorsList;
  if (!pool.includes(name)) {
    pool.push(name);
    if (type === 'equipment') saveEquipmentList(); else saveOperatorsList();
  }
  const items = getPickerItems(key, slot, field);
  if (!items.includes(name)) { items.push(name); setPickerItems(key, slot, field, items); }
  // Rebuild the picker with fresh data
  const typeLabel = type === 'equipment' ? '🚜 Equipment' : '👷 Operators';
  document.getElementById('unifiedSchedPicker')?.remove();
  openUnifiedSchedPicker({ type, title: typeLabel, key, slot, field });
}

function uspmMatToggle(i) {
  const chk = document.getElementById(`uspm-mat-chk-${i}`);
  const tons = document.getElementById(`uspm-mat-tons-${i}`);
  const row = document.getElementById(`uspm-mat-row-${i}`);
  if (!chk || !tons) return;
  tons.disabled = !chk.checked;
  tons.style.borderColor = chk.checked ? 'var(--stripe)' : 'var(--asphalt-light)';
  row?.classList.toggle('checked', chk.checked);
  if (chk.checked) setTimeout(() => tons.focus(), 10);
}

function uspmMatTonsInput(i) {
  const chk = document.getElementById(`uspm-mat-chk-${i}`);
  const tons = document.getElementById(`uspm-mat-tons-${i}`);
  if (chk && tons && tons.value && !chk.checked) { chk.checked = true; uspmMatToggle(i); }
}

function uspmAddNewMat(key, slot) {
  const inp = document.getElementById('uspmNewMat');
  const name = inp?.value.trim();
  if (!name) return;
  if (!materialList.includes(name)) { materialList.push(name); saveMaterialList(); }
  document.getElementById('unifiedSchedPicker')?.remove();
  openUnifiedSchedPicker({ type: 'material', title: '🪨 Material & Tonnage', key, slot, field: 'material' });
}

function uspmSaveMaterial(key, slot) {
  const list = document.getElementById('uspmList');
  if (!list) return;
  // Resolve the pool the same way the picker built it
  const pool = mixTypesList.length ? mixTypesList : materialList.map(d => ({ desc: d }));
  const rows = list.querySelectorAll('.uspm-mat-row');
  const items = [];
  rows.forEach((row, i) => {
    const chk = document.getElementById(`uspm-mat-chk-${i}`);
    const tonsEl = document.getElementById(`uspm-mat-tons-${i}`);
    if (chk?.checked) {
      const entry = pool[i];
      const name = (typeof entry === 'object' ? entry.desc : entry) || '';
      const tons = tonsEl?.value?.trim() || '';
      if (name) items.push({ name, tons });
    }
  });
  const serialized = serializeMaterialField(items);
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
    if (!schedData[key].extras[idx].data.fields) schedData[key].extras[idx].data.fields = {};
    schedData[key].extras[idx].data.fields.material = serialized;
  } else {
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
    schedData[key][slot].fields.material = serialized;
  }
  saveSchedData();
  document.getElementById('unifiedSchedPicker')?.remove();
  renderSchedule();
}

function uspmSelectMixType(key, slot, desc, displayName) {
  const el = document.querySelector(`#unifiedSchedPicker .uspm-item[onclick*="${desc.replace(/'/g,"\\'")}"]`);
  // Toggle selection state in UI
  const current = parseMaterialField((() => {
    if (slot.startsWith('extra_')) { const i=parseInt(slot.replace('extra_','')); return schedData[key]?.extras?.[i]?.data?.fields?.material||''; }
    return ((schedData[key]||{})[slot]||{}).fields?.material||'';
  })());
  const idx = current.findIndex(i => i.name === desc);
  if (idx >= 0) current.splice(idx, 1); else current.push({ name: desc, tons: '' });
  if (displayName && desc) { materialDisplayNames[desc] = displayName; saveMaterialDisplayNames(); }
  saveSchedField(key, slot, 'material', JSON.stringify(current));
  // Refresh picker items in place
  document.getElementById('unifiedSchedPicker')?.remove();
  openUnifiedSchedPicker({ type: 'mixtype', title: '🪨 Mix Type', key, slot, field: 'material' });
}

function uspmSelectPlant(key, slot, value) {
  document.getElementById('unifiedSchedPicker')?.remove();
  selectSchedPlant(key, slot, value, null);
}

function uspmAddNewPlant(key, slot) {
  const inp = document.getElementById('uspmNewPlant');
  const name = inp?.value.trim();
  if (!name) return;
  // Parse "Supplier — Location" or just add as a raw plant
  const parts = name.split('—').map(s => s.trim());
  const supName = parts[0];
  const loc = parts.slice(1).join('—').trim();
  let sup = suppliersList.find(s => s.name.toLowerCase() === supName.toLowerCase());
  if (!sup) { sup = { name: supName, plants: loc ? [loc] : [] }; suppliersList.push(sup); }
  else if (loc && !sup.plants.includes(loc)) { sup.plants.push(loc); }
  saveSuppliersList();
  document.getElementById('unifiedSchedPicker')?.remove();
  openUnifiedSchedPicker({ type: 'plant', title: '🏭 Supplier Plant', key, slot, field: 'plant' });
}

// ─────────────────────────────────────────────────────────────────────────────

function addForemanBlock(key, foremanName) {
  document.getElementById('addForemanModal')?.remove();
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key].extras) schedData[key].extras = [];
  schedData[key].extras.push({ foreman: foremanName, data: { type:'blank', fields:{} } });
  saveSchedData(); renderSchedule();
}

function addNewForemanToDay(key) {
  const input = document.getElementById('newForemanName');
  const name = input?.value.trim();
  if (!name) return;
  if (!foremanRoster.includes(name)) { foremanRoster.push(name); saveForemanRoster(); }
  addForemanBlock(key, name);
}

// ── Operator/Equipment helpers ──
function getPickerItems(key, slot, field) {
  let raw = '';
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    raw = schedData[key]?.extras?.[idx]?.data?.fields?.[field] || '';
  } else {
    raw = ((schedData[key]||{})[slot]||{}).fields?.[field] || '';
  }
  return raw ? raw.split(',').map(s=>s.trim()).filter(Boolean) : [];
}

function setPickerItems(key, slot, field, items) {
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
    if (!schedData[key].extras[idx].data.fields) schedData[key].extras[idx].data.fields = {};
    schedData[key].extras[idx].data.fields[field] = items.join(',');
  } else {
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
    schedData[key][slot].fields[field] = items.join(',');
  }
  saveSchedData();
}
function removePickerItem(key, slot, field, name) {
  const items = getPickerItems(key, slot, field).filter(o => o !== name);
  setPickerItems(key, slot, field, items);
  updatePickerChips(key, slot, field);
}

// Keep old name for compatibility
function removeOperator(key, slot, name) { removePickerItem(key, slot, 'operators', name); }

function getPool(type) {
  if (type === 'equipment') return equipmentList;
  if (type === 'operators') return operatorsList;
  // 'material' → use mix types as the single source; fall back to materialList for legacy data
  return mixTypesList.length ? mixTypesList.map(m => m.desc).filter(Boolean) : materialList;
}

// ── Backlog Supplier Plant picker ──
function openPlantPicker(itemId, triggerBtn) {
  // Remove any existing plant picker
  document.getElementById('plantPickerDrop')?.remove();

  const drop = document.createElement('div');
  drop.id = 'plantPickerDrop';
  drop.style.cssText = 'position:fixed;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);min-width:260px;max-width:340px;max-height:220px;overflow-y:auto;z-index:6000;box-shadow:0 8px 32px rgba(0,0,0,0.6);';

  const items = plantsList.length
    ? plantsList.map(p => `
        <div style="padding:9px 14px;font-size:12px;color:var(--concrete);cursor:pointer;border-bottom:1px solid var(--asphalt-light);transition:background 0.1s;"
             onmouseover="this.style.background='var(--asphalt-light)'" onmouseout="this.style.background=''"
             onmousedown="selectPlant('${itemId}','${p.replace(/'/g,"\\'").replace(/"/g,'&quot;')}',event)">
          ${p}
        </div>`).join('')
    : '<div style="padding:12px 14px;font-size:12px;color:var(--concrete-dim);">No plants yet — add them in Settings</div>';

  drop.innerHTML = `
    <div style="padding:7px 12px 6px;border-bottom:1px solid var(--asphalt-light);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Select Supplier Plant</div>
    ${items}
    <div style="padding:8px 12px;border-top:1px solid var(--asphalt-light);">
      <div style="display:flex;gap:6px;">
        <input id="plantPickerNewInput" class="op-picker-input" placeholder="Add new plant..." style="flex:1;" />
        <button class="btn btn-primary btn-sm" style="font-size:11px;" onmousedown="addNewPlantFromPicker('${itemId}',event)">Add</button>
      </div>
    </div>`;

  // Position below button
  const rect = triggerBtn.getBoundingClientRect();
  drop.style.top  = Math.min(rect.bottom + 4, window.innerHeight - 240) + 'px';
  drop.style.left = Math.min(rect.left, window.innerWidth - 350) + 'px';
  document.body.appendChild(drop);
  _plantPickerAttachKeys(drop, 'plantPickerDrop', closePlantPickerOutside);

  drop.querySelector('#plantPickerNewInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addNewPlantFromPicker(itemId, e); }
  });

  setTimeout(() => { document.addEventListener('click', closePlantPickerOutside); }, 10);
}

/**
 * buildSupplierDrop({ title, titleColor, itemsHtml, inputId, addHandler })
 * ─────────────────────────────────────────────────────────────────────────
 * Shared helper that constructs and returns the plantPickerDrop <div>.
 * Callers are responsible for:
 *   1. Removing any existing #plantPickerDrop before calling.
 *   2. Positioning the returned element (drop.style.top / left).
 *   3. Appending it to document.body.
 *   4. Wiring keydown → Enter on the input if needed.
 *   5. Registering closePlantPickerOutside via setTimeout.
 *
 * @param {object} cfg
 * @param {string} cfg.title       - Header label text
 * @param {string} [cfg.titleColor]- CSS color for header (default: var(--concrete-dim))
 * @param {string} cfg.itemsHtml   - Pre-built HTML string for the list rows
 * @param {string} cfg.inputId     - id to assign to the "Add new plant" <input>
 * @param {string} cfg.addHandler  - Raw JS string for the Add button's onmousedown
 * @returns {HTMLDivElement}
 */
function buildSupplierDrop({ title, titleColor = 'var(--concrete-dim)', itemsHtml, inputId, addHandler }) {
  const drop = document.createElement('div');
  drop.id = 'plantPickerDrop';
  drop.style.cssText = 'position:fixed;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);min-width:260px;max-width:360px;max-height:220px;overflow-y:auto;z-index:6000;box-shadow:0 8px 32px rgba(0,0,0,0.6);';
  drop.innerHTML = `
    <div style="padding:7px 12px 6px;border-bottom:1px solid var(--asphalt-light);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:${titleColor};">${title}</div>
    ${itemsHtml}
    <div style="padding:8px 12px;border-top:1px solid var(--asphalt-light);">
      <div style="display:flex;gap:6px;">
        <input id="${inputId}" class="op-picker-input" placeholder="Add new plant..." style="flex:1;" />
        <button class="btn btn-primary btn-sm" style="font-size:11px;" onmousedown="${addHandler}">Add</button>
      </div>
    </div>`;
  return drop;
}


// ── Shared arrow-key navigation for any plant picker dropdown ────────────────
function _plantPickerAttachKeys(drop, dropId, closeHandler) {
  if (!drop) return;
  let _kbdIdx = -1;

  // Collect all clickable rows (exclude headers, inputs, buttons)
  const getRows = () => Array.from(drop.querySelectorAll('[onmousedown]:not(button):not(input)'));

  const highlight = (rows, idx) => {
    rows.forEach((r, i) => {
      const isSelected = r.style.background.includes('245,197,24') || r.textContent.trim().startsWith('✓');
      r.style.background = i === idx ? 'var(--asphalt-light)' : (isSelected ? 'rgba(245,197,24,0.12)' : '');
    });
    rows[idx]?.scrollIntoView({ block:'nearest' });
  };

  // Add arrow-button UI strip at top of drop
  const arrowStrip = document.createElement('div');
  arrowStrip.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px;background:var(--asphalt);border-bottom:1px solid var(--asphalt-light);flex-shrink:0;';
  arrowStrip.innerHTML = `
    <button id="_ppUp" style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:12px;padding:2px 8px;cursor:pointer;line-height:1;transition:all 0.1s;"
      title="Previous (↑)" onmouseover="this.style.borderColor='var(--stripe)';this.style.color='var(--stripe)'" onmouseout="this.style.borderColor='var(--asphalt-light)';this.style.color='var(--concrete-dim)'">▲</button>
    <span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:var(--concrete-dim);">↑ ↓ to navigate · Enter to select</span>
    <button id="_ppDown" style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:12px;padding:2px 8px;cursor:pointer;line-height:1;transition:all 0.1s;"
      title="Next (↓)" onmouseover="this.style.borderColor='var(--stripe)';this.style.color='var(--stripe)'" onmouseout="this.style.borderColor='var(--asphalt-light)';this.style.color='var(--concrete-dim)'">▼</button>`;

  // Insert after the title header (first child)
  const firstChild = drop.firstElementChild;
  if (firstChild) {
    drop.insertBefore(arrowStrip, firstChild.nextSibling);
  } else {
    drop.prepend(arrowStrip);
  }

  // Button click handlers
  arrowStrip.querySelector('#_ppUp').addEventListener('mousedown', e => {
    e.preventDefault();
    const rows = getRows();
    if (!rows.length) return;
    _kbdIdx = _kbdIdx <= 0 ? rows.length - 1 : _kbdIdx - 1;
    highlight(rows, _kbdIdx);
  });
  arrowStrip.querySelector('#_ppDown').addEventListener('mousedown', e => {
    e.preventDefault();
    const rows = getRows();
    if (!rows.length) return;
    _kbdIdx = _kbdIdx >= rows.length - 1 ? 0 : _kbdIdx + 1;
    highlight(rows, _kbdIdx);
  });

  // Keyboard handler — capture on document while drop is open
  function onKey(e) {
    const d = document.getElementById(dropId);
    if (!d) { document.removeEventListener('keydown', onKey, true); return; }
    const rows = getRows();
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _kbdIdx = _kbdIdx >= rows.length - 1 ? 0 : _kbdIdx + 1;
      highlight(rows, _kbdIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _kbdIdx = _kbdIdx <= 0 ? rows.length - 1 : _kbdIdx - 1;
      highlight(rows, _kbdIdx);
    } else if (e.key === 'Enter') {
      if (_kbdIdx >= 0 && rows[_kbdIdx]) {
        e.preventDefault();
        rows[_kbdIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      document.getElementById(dropId)?.remove();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('keydown', onKey, true);
    }
  }
  document.addEventListener('keydown', onKey, true);

  // Clean up key listener when drop is removed
  const observer = new MutationObserver(() => {
    if (!document.getElementById(dropId)) {
      document.removeEventListener('keydown', onKey, true);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList:true, subtree:false });
}

function closePlantPickerOutside(e) {
  if (!document.getElementById('plantPickerDrop')?.contains(e.target)) {
    document.getElementById('plantPickerDrop')?.remove();
    document.removeEventListener('click', closePlantPickerOutside);
  }
}

// ── Schedule block plant picker (hierarchical supplier → plant location) ──
function openSchedPlantPicker(key, slot, triggerBtn) {
  openUnifiedSchedPicker({ type: 'plant', title: '🏭 Supplier Plant', key, slot, field: 'plant' });
}

function closeSchedPlantPickerOutside(e) {
  if (!document.getElementById('schedPlantPickerDrop')?.contains(e.target)) {
    document.getElementById('schedPlantPickerDrop')?.remove();
    document.removeEventListener('click', closeSchedPlantPickerOutside);
  }
}

function selectSchedPlant(key, slot, value, e) {
  if (e) e.preventDefault();
  document.getElementById('schedPlantPickerDrop')?.remove();
  document.removeEventListener('click', closeSchedPlantPickerOutside);

  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
    if (!schedData[key].extras[idx].data.fields) schedData[key].extras[idx].data.fields = {};
    schedData[key].extras[idx].data.fields.plant = value;
  } else {
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
    schedData[key][slot].fields.plant = value;
  }
  saveSchedData();
  renderSchedule();
}

function clearSchedPlant(key, slot, btn) {
  selectSchedPlant(key, slot, '', null);
}

function selectPlant(itemId, plantName, e) {
  if (e) e.preventDefault();
  document.getElementById('plantPickerDrop')?.remove();
  document.removeEventListener('click', closePlantPickerOutside);
  updateItemRow(itemId, 'supplierPlant', plantName);
  renderItemsTable();
}

function addNewPlantFromPicker(itemId, e) {
  if (e) e.preventDefault();
  const input = document.getElementById('plantPickerNewInput');
  const name = input?.value.trim();
  if (!name) return;
  // Add to suppliersList if not already a known flat entry
  if (!getPlantsList().includes(name)) {
    const parts = name.split('—').map(s => s.trim());
    const supName = parts[0];
    const loc = parts.slice(1).join('—').trim();
    let sup = suppliersList.find(s => s.name.toLowerCase() === supName.toLowerCase());
    if (!sup) { sup = { name: supName, plants: [] }; suppliersList.push(sup); }
    if (loc && !sup.plants.includes(loc)) sup.plants.push(loc);
    saveSuppliersList();
  }
  document.getElementById('plantPickerDrop')?.remove();
  document.removeEventListener('click', closePlantPickerOutside);
  updateItemRow(itemId, 'supplierPlant', name);
  renderItemsTable();
}

// Opens the material picker modal, pre-filling the search with whatever the user typed inline
function openMatSearchFromInline(inputEl, key, slot) {
  const query = inputEl.value || '';
  inputEl.blur(); // unfocus so it doesn't steal keys from the modal
  openUnifiedSchedPicker({ type:'material', title:'🪨 Material & Tonnage', key, slot, field:'material' });
  // Pre-fill search after the modal renders
  setTimeout(() => {
    const s = document.getElementById('uspmSearch');
    if (s && query) { s.value = query; uspmFilter(query); s.focus(); }
    else if (s) { s.focus(); }
    // Reset the inline input so it's ready for the next search
    if (inputEl && document.body.contains(inputEl)) inputEl.value = '';
  }, 80);
}

function openMixTypeChipMenu(key, slot, itemName, chipEl) {
  openUnifiedSchedPicker({ type:'material', title:'🪨 Material & Tonnage', key, slot, field:'material' });
}

function openPickerDropdown(key, slot, field, type) {
  if (type === 'material') { openUnifiedSchedPicker({ type:'material', title:'🪨 Material & Tonnage', key, slot, field:'material' }); return; }
  const label = type === 'equipment' ? '🚜 Equipment' : '👷 Operators';
  openUnifiedSchedPicker({ type: type === 'equipment' ? 'equipment' : 'operators', title: label, key, slot, field });
}

// Keep old name for compatibility
function openOperatorPicker(key, slot) { openPickerDropdown(key, slot, 'operators', 'operators'); }

function closeOpPickerOutside(e) {
  if (!document.getElementById('opPicker')?.contains(e.target)) {
    document.getElementById('opPicker')?.remove();
    document.removeEventListener('click', closeOpPickerOutside);
  }
}

// ── Material + Tonnage picker modal ──

/**
 * parseMaterialField(raw) — parse stored material value into [{name,tons}]
 * Handles both legacy comma-string and new JSON format.
 */
function parseMaterialField(raw) {
  if (!raw || !raw.trim()) return [];
  if (raw.trim().startsWith('[')) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  // Legacy: "Mat A,Mat B" with no tonnage
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, tons: '' }));
}

/**
 * serializeMaterialField(items) — [{name,tons}] → stored string
 */
function serializeMaterialField(items) {
  return items.length ? JSON.stringify(items) : '';
}

/**
 * materialChipLabel(item) — display string for a chip
 */
function materialChipLabel(item) {
  const label = matDisplayName(item.name);
  return item.tons ? `${label} — ${item.tons}T` : label;
}

/**
 * openMaterialModal(key, slot) — centered modal for selecting materials + tonnage
 */
function openMaterialModal(key, slot) {
  document.getElementById('materialModal')?.remove();

  const current = parseMaterialField(getPickerItems(key, slot, 'material').join(',') || (() => {
    if (slot.startsWith('extra_')) {
      const idx = parseInt(slot.replace('extra_',''));
      return schedData[key]?.extras?.[idx]?.data?.fields?.material || '';
    }
    return ((schedData[key]||{})[slot]||{}).fields?.material || '';
  })());

  const currentMap = {};
  current.forEach(item => { currentMap[item.name] = item.tons || ''; });

  const pool = materialList;

  const rowsHtml = pool.map((mat, i) => {
    const checked = currentMap.hasOwnProperty(mat);
    const tons = checked ? (currentMap[mat] || '') : '';
    return `
      <div class="mat-row" id="mat-row-${i}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--asphalt-light);transition:background 0.1s;${checked?'background:rgba(245,197,24,0.06);':''}">
        <input type="checkbox" id="mat-chk-${i}" ${checked?'checked':''} onchange="matRowToggle(${i})"
          style="width:15px;height:15px;accent-color:var(--stripe);cursor:pointer;flex-shrink:0;" />
        <label for="mat-chk-${i}" style="flex:1;font-size:13px;font-weight:700;color:var(--concrete);cursor:pointer;">${matDisplayName(mat)}<span style="font-size:10px;font-weight:400;color:var(--concrete-dim);margin-left:6px;">${matDisplayName(mat)!==mat?mat:''}</span></label>
        <div style="display:flex;align-items:center;gap:4px;">
          <input type="number" id="mat-tons-${i}" value="${tons}" min="0" step="0.1"
            placeholder="tons" ${checked?'':'disabled'}
            style="width:72px;padding:4px 7px;background:var(--asphalt);border:1px solid ${checked?'var(--stripe)':'var(--asphalt-light)'};border-radius:var(--radius);color:var(--white);font-size:12px;font-weight:700;outline:none;text-align:right;"
            oninput="matTonsInput(${i})" />
          <span style="font-size:11px;font-weight:700;color:var(--concrete-dim);">T</span>
        </div>
      </div>`;
  }).join('');

  // Also allow adding a new material inline
  const modal = document.createElement('div');
  modal.id = 'materialModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:7500;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);width:100%;max-width:440px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.7);">
      <div style="padding:16px 18px 12px;border-bottom:1px solid var(--asphalt-light);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1.5px;color:var(--white);">🪨 Material &amp; Tonnage</div>
        <button onclick="document.getElementById('materialModal').remove()" style="background:none;border:none;cursor:pointer;color:var(--concrete-dim);font-size:16px;padding:2px 6px;">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;" id="matRowsWrap">
        ${rowsHtml || '<div style="padding:16px;font-size:13px;color:var(--concrete-dim);">No materials in roster yet. Add them in ⚙️ Settings → Rosters.</div>'}
      </div>
      <div style="padding:10px 12px;border-top:1px solid var(--asphalt-light);border-bottom:1px solid var(--asphalt-light);flex-shrink:0;">
        <div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);margin-bottom:6px;letter-spacing:0.5px;">ADD NEW MATERIAL</div>
        <div style="display:flex;gap:6px;">
          <input class="form-input" id="matNewName" placeholder="Material name..." style="flex:1;font-size:12px;" />
          <button class="btn btn-primary btn-sm" style="font-size:11px;" onclick="matAddNew('${key}','${slot}')">Add</button>
        </div>
      </div>
      <div style="padding:12px 14px;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">
        <button class="btn btn-ghost" onclick="document.getElementById('materialModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveMaterialModal('${key}','${slot}')">✓ Save</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector('#mat-tons-0')?.closest('.mat-row')?.querySelector('input[type=checkbox]')?.focus?.(), 60);
}

function matRowToggle(i) {
  const chk = document.getElementById(`mat-chk-${i}`);
  const tonsInput = document.getElementById(`mat-tons-${i}`);
  const row = document.getElementById(`mat-row-${i}`);
  if (!chk || !tonsInput) return;
  tonsInput.disabled = !chk.checked;
  tonsInput.style.borderColor = chk.checked ? 'var(--stripe)' : 'var(--asphalt-light)';
  row.style.background = chk.checked ? 'rgba(245,197,24,0.06)' : '';
  if (chk.checked) setTimeout(() => tonsInput.focus(), 10);
}

function matTonsInput(i) {
  // Auto-check the row when typing tons
  const chk = document.getElementById(`mat-chk-${i}`);
  const tonsInput = document.getElementById(`mat-tons-${i}`);
  if (chk && tonsInput && tonsInput.value && !chk.checked) {
    chk.checked = true;
    matRowToggle(i);
  }
}

function matAddNew(key, slot) {
  const input = document.getElementById('matNewName');
  const name = input?.value.trim();
  if (!name) return;
  if (!materialList.includes(name)) { materialList.push(name); saveMaterialList(); }
  if (input) input.value = '';
  // Re-open the modal to refresh the list
  document.getElementById('materialModal')?.remove();
  openMaterialModal(key, slot);
}

function saveMaterialModal(key, slot) {
  const wrap = document.getElementById('matRowsWrap');
  if (!wrap) return;
  const rows = wrap.querySelectorAll('.mat-row');
  const items = [];
  rows.forEach((row, i) => {
    const chk = document.getElementById(`mat-chk-${i}`);
    const tonsEl = document.getElementById(`mat-tons-${i}`);
    if (chk?.checked) {
      const label = row.querySelector('label');
      const name = label?.textContent?.trim() || materialList[i] || '';
      const tons = tonsEl?.value?.trim() || '';
      if (name) items.push({ name, tons });
    }
  });

  const serialized = serializeMaterialField(items);

  // Write directly to schedData (same path as setPickerItems)
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
    if (!schedData[key].extras[idx].data.fields) schedData[key].extras[idx].data.fields = {};
    schedData[key].extras[idx].data.fields.material = serialized;
  } else {
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
    schedData[key][slot].fields.material = serialized;
  }
  saveSchedData();
  document.getElementById('materialModal')?.remove();
  renderSchedule();
}

function removeMaterialItem(key, slot, name, btn) {
  // Read current, filter out the named item, re-save
  let raw = '';
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    raw = schedData[key]?.extras?.[idx]?.data?.fields?.material || '';
  } else {
    raw = ((schedData[key]||{})[slot]||{}).fields?.material || '';
  }
  const items = parseMaterialField(raw).filter(it => it.name !== name);
  const serialized = serializeMaterialField(items);
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    schedData[key].extras[idx].data.fields.material = serialized;
  } else {
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    schedData[key][slot].fields.material = serialized;
  }
  saveSchedData();
  renderSchedule();
}

function togglePickerItem(key, slot, field, name, type, el) {
  const items = getPickerItems(key, slot, field);
  const idx = items.indexOf(name);
  if (idx >= 0) items.splice(idx, 1); else items.push(name);
  setPickerItems(key, slot, field, items);
  el.classList.toggle('selected', items.includes(name));
  // Update just the chips area in the DOM — no full re-render so dropdown stays open
  updatePickerChips(key, slot, field);
}

function updatePickerChips(key, slot, field) {
  // Find the chips wrap for this field in the DOM and update it
  const block = document.querySelector(
    slot.startsWith('extra_')
      ? `[data-extra-key="${key}"][data-extra-slot="${slot}"]`
      : `.sched-block`
  );
  // Find all sched-fields in DOM for this key/slot
  document.querySelectorAll('.sched-field-input, .op-chip-del, .op-chips-wrap').forEach(el => {
    const kEl = el.closest('[data-key]') || el.querySelector('[data-key]');
    if (!kEl) return;
  });
  // Simpler approach: find the specific chips wrap by looking for op-add-btn with matching onclick
  const allAddBtns = document.querySelectorAll('.op-add-btn');
  allAddBtns.forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    if (onclick.includes(`'${key}'`) && onclick.includes(`'${slot}'`) && onclick.includes(`'${field}'`)) {
      const wrap = btn.closest('.op-chips-wrap') || btn.parentElement;
      if (!wrap) return;
      // Get current items and block color
      const items = getPickerItems(key, slot, field);
      // Get fc from the block's current style
      const blockEl = btn.closest('.sched-block');
      const fc = blockEl ? getComputedStyle(blockEl).color : '#000000';
      // Rebuild chips
      const existingChips = wrap.querySelectorAll('.op-chip');
      existingChips.forEach(c => c.remove());
      items.forEach(item => {
        const chip = document.createElement('span');
        chip.className = 'op-chip';
        chip.style.cssText = `color:#111;border-color:rgba(0,0,0,0.18);background:#fff;`;
        chip.innerHTML = `${item} <button class="op-chip-del" onclick="removePickerItem('${key}','${slot}','${field}','${item.replace(/'/g,"\\'")}',this)" title="Remove">✕</button>`;
        wrap.insertBefore(chip, btn);
      });
    }
  });
}

// Keep old name for compatibility
function toggleOperator(key, slot, name, el) { togglePickerItem(key, slot, 'operators', name, 'operators', el); }

function addNewPickerItem(key, slot, field, type) {
  const input = document.getElementById('opPickerNewName');
  const name = input?.value.trim();
  if (!name) return;
  const pool = getPool(type);
  if (!pool.includes(name)) {
    pool.push(name);
    type === 'equipment' ? saveEquipmentList() : type === 'material' ? saveMaterialList() : saveOperatorsList();
  }
  const items = getPickerItems(key, slot, field);
  if (!items.includes(name)) { items.push(name); setPickerItems(key, slot, field, items); }
  document.getElementById('opPicker')?.remove();
  document.removeEventListener('click', closeOpPickerOutside);
  updatePickerChips(key, slot, field);
}

function getBlockType(id) { return blockTypes.find(t=>t.id===id) || blockTypes[0]; }

function getMonthDates(offset) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth()+offset, 1);
  const last  = new Date(now.getFullYear(), now.getMonth()+offset+1, 0);
  const dates = [];
  for (let d=new Date(first); d<=last; d.setDate(d.getDate()+1)) dates.push(new Date(d));
  return dates;
}

function getMonthLabel(offset) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth()+offset, 1)
    .toLocaleDateString('en-US',{month:'long',year:'numeric'});
}

function dk(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isToday(d) {
  const n=new Date(); return d.getDate()===n.getDate()&&d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();
}

function getWeeks(dates) {
  const weeks = [];
  let week = [];
  dates.forEach((d,i) => {
    if (i===0) {
      // pad start of first week
      for (let p=0; p<d.getDay(); p++) week.push(null);
    }
    week.push(d);
    if (week.length===7 || i===dates.length-1) { weeks.push(week); week=[]; }
  });
  return weeks;
}

// ── Schedule block height equalizer ───────────────────────────────────────────
// Keeps all top-slot blocks the same height and all bottom-slot blocks the same
// height within each week row, so adding chips/content to one card doesn't
// throw off the alignment of the rest of the week.
var _schedEqTimer = null;
var _schedEqObs = null;

function _equalizeSchedBlocks() {
  document.querySelectorAll('.sched-week-days').forEach(function(weekEl) {
    ['top', 'bottom'].forEach(function(slot) {
      var blocks = Array.from(weekEl.querySelectorAll('.sched-block[data-block-slot="' + slot + '"]'));
      if (blocks.length < 2) return;
      // Reset so we measure natural height
      blocks.forEach(function(b) { b.style.minHeight = ''; });
      // Find tallest
      var maxH = Math.max.apply(null, blocks.map(function(b) { return b.offsetHeight; }));
      if (maxH > 0) blocks.forEach(function(b) { b.style.minHeight = maxH + 'px'; });

      // Equalize second-stop wrap sections so days without stops reserve the same
      // vertical space as the tallest stop section, keeping bottom blocks aligned.
      var stopWraps = Array.from(weekEl.querySelectorAll('.sched-second-stops-wrap[data-stop-slot="' + slot + '"]'));
      if (stopWraps.length >= 2) {
        stopWraps.forEach(function(w) { w.style.minHeight = ''; });
        var maxWrapH = Math.max.apply(null, stopWraps.map(function(w) { return w.offsetHeight; }));
        if (maxWrapH > 0) stopWraps.forEach(function(w) { w.style.minHeight = maxWrapH + 'px'; });
      }
    });
  });
}

function _schedEqDebounced() {
  clearTimeout(_schedEqTimer);
  _schedEqTimer = setTimeout(_equalizeSchedBlocks, 80);
}

function _attachSchedEqObserver() {
  if (_schedEqObs) _schedEqObs.disconnect();
  if (typeof ResizeObserver === 'undefined') return;
  _schedEqObs = new ResizeObserver(_schedEqDebounced);
  document.querySelectorAll('.sched-block[data-block-slot]').forEach(function(b) {
    _schedEqObs.observe(b);
  });
}

function renderSchedule() {
  try {
  syncMixTypeDisplayNames();
  const wrap = document.getElementById('scheduleView');
  const dates = getMonthDates(schedMonthOffset);
  const weeks = getWeeks(dates);
  const monthLabel = getMonthLabel(schedMonthOffset);

  const legendHtml = [
    ...blockTypes.filter(t => t.id !== 'blank').map(t=>`
      <div class="sched-legend-item" title="Click to customize color" onclick="openSchedSettings()">
        <div class="sched-legend-dot" style="background:${t.color};border:1px solid rgba(255,255,255,0.15);"></div>
        ${t.label}
      </div>`),
    `<div class="sched-legend-item">
      <div class="sched-legend-dot" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.18);"></div>
      Weekend
    </div>`,
    `<div class="sched-legend-item">
      <div class="sched-legend-dot" style="background:#e8d5f5;border:1px solid rgba(180,150,210,0.6);"></div>
      <span style="color:#c084fc;">Holiday</span>
    </div>`
  ].join('');

  const weeksHtml = weeks.map(week => {
    const daysHtml = week.map(d => {
      if (!d) return `<div></div>`;
      const key = dk(d);
      const todayCls = isToday(d)?'today':'';
      const dayName = DAY_NAMES[d.getDay()];
      const dayNum  = d.getDate();

      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

      const renderBlock = (slot) => {
        const stored = (schedData[key]||{})[slot];
        const defaultType = 'blank';
        const bdata = stored || { type: defaultType, fields:{} };
        const effectiveType = bdata.type || 'blank';
        const btype = getBlockType(effectiveType);
        // Weekend with no work set → lilac; otherwise use btype color
        const isWeekendBlank = isWeekend && effectiveType === 'blank';
        const isWeekdayBlank = !isWeekend && effectiveType === 'blank';
        const blockBg = isHoliday ? '#e8d5f5' : isWeekendBlank ? '#e8d5f5' : isWeekdayBlank ? '#ffffff' : btype.color;
        const fc = (isHoliday || isWeekendBlank || isWeekdayBlank) ? '#000000' : (btype.fontColor || '#ffffff');
        const fields = bdata.fields || {};
        const canEdit = (isAdmin() || canEditTab('schedule')) && schedEditMode;

        // ── After-night-shift rest day detection ──
        const isAfterNight = !!(stored?.afterNightShift) && effectiveType === 'blank';

        const hasContent = Object.values(fields).some(v => v && v.trim());

        const fieldsHtml = BLOCK_FIELDS.map(f => {
          if (f.type === 'operators' || f.type === 'equipment' || f.type === 'material') {
            // Material uses JSON [{name,tons}] format; operators/equipment use comma-string
            let chips = '';
            if (f.type === 'material') {
              const matItems = parseMaterialField(fields[f.key] || '');
              chips = matItems.map(item => {
                const label = materialChipLabel(item);
                const safeLabel = label.replace(/'/g,"\\'");
                return `<span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;${canEdit?'cursor:pointer;':''}" ${ canEdit ? `onclick="openMixTypeChipMenu('${key}','${slot}','${item.name.replace(/'/g,"\\'")}',this)" title="Edit or remove"` : ''}>
                  🪨 ${label}
                  ${canEdit ? `<button class="op-chip-del" style="color:#888;" onclick="event.stopPropagation();removeMaterialItem('${key}','${slot}','${item.name.replace(/'/g,"\\'")}',this)" title="Remove">✕</button>` : ''}
                </span>`;
              }).join('');
            } else {
              const ops = fields[f.key] ? fields[f.key].split(',').filter(Boolean) : [];
              chips = ops.map(op => `
                <span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;">
                  ${op.trim()}
                  ${canEdit ? `<button class="op-chip-del" style="color:#888;" onclick="removePickerItem('${key}','${slot}','${f.key}','${op.trim().replace(/'/g,"\\'")}',this)" title="Remove">✕</button>` : ''}
                </span>`).join('');
            }
            return `<div class="sched-field sched-field-operators">
              <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
              <div class="op-chips-wrap ${f.type === 'material' ? 'mat-chips-wrap' : ''}">
                ${chips}
                ${canEdit ? (f.type === 'material'
                  ? `<input class="mat-inline-search" placeholder="Search mix…" autocomplete="off"
                      onfocus="openMatSearchFromInline(this,'${key}','${slot}')"
                      oninput="openMatSearchFromInline(this,'${key}','${slot}')" />`
                  : `<button class="op-add-btn" style="color:${fc}60;border-color:${fc}30;" onclick="openPickerDropdown('${key}','${slot}','${f.key}','${f.type}')">+</button>`)
                : ''}
              </div>
            </div>`;
          }
          // ── Plant field: single-value supplier/plant picker ──
          if (f.key === 'plant') {
            const cur = fields.plant || '';
            if (cur) {
              return `<div class="sched-field sched-field-operators">
                <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
                <div class="op-chips-wrap">
                  <span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;cursor:pointer;" onclick="openSchedPlantPicker('${key}','${slot}',this)" title="Click to change plant">
                    🏭 ${cur}
                    ${canEdit ? `<button class="op-chip-del" style="color:#888;" onclick="event.stopPropagation();clearSchedPlant('${key}','${slot}',this)" title="Clear plant">✕</button>` : ''}
                  </span>
                </div>
              </div>`;
            }
            return `<div class="sched-field sched-field-operators">
              <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
              <div class="op-chips-wrap">
                ${canEdit ? `<button class="op-add-btn" style="color:${fc}60;border-color:${fc}30;" onclick="openSchedPlantPicker('${key}','${slot}',this)">+</button>` : ''}
              </div>
            </div>`;
          }
          // -- Trucking field: label-button (hover=truck list, click=modal) + meta chips --
          if (f.key === 'trucking') {
            let td = {};
            try { td = JSON.parse(fields.trucking || '{}'); } catch(e) {}
            const trucks = td.trucks || td.numTrucks || '';
            const load   = td.loadTime || '';
            const space  = td.spacing  || '';
            const metaChips = [
              trucks ? `🚛 ${trucks}` : '',
              load   ? `⏱ ${load}`   : '',
              space  ? `📏 ${space}` : '',
            ].filter(Boolean).map(m => `<span class="op-chip" style="color:#111;border-color:rgba(0,0,0,0.18);background:#fff;font-size:9px;padding:1px 6px;">${m}</span>`).join('');
            const hasAny = trucks || load || space;
            const labelEl = canEdit
              ? `<button class="sched-field-label-btn" style="color:${fc}80;"
                  onclick="openTruckingModal('${key}','${slot}')"
                  onmouseenter="showTruckingTooltip(event,'${key}','${slot}')"
                  onmouseleave="hideTruckingTooltip()"
                  title="Hover to see trucks · Click to edit">${f.label}</button>`
              : `<div class="sched-field-label" style="color:${fc}80;"
                  onmouseenter="showTruckingTooltip(event,'${key}','${slot}')"
                  onmouseleave="hideTruckingTooltip()">${f.label}</div>`;
            return `<div class="sched-field sched-field-operators">
              ${labelEl}
              <div class="op-chips-wrap">
                ${metaChips}
                ${!hasAny ? `<span style="font-size:11px;color:var(--concrete-dim);">${canEdit ? '' : '—'}</span>` : ''}
              </div>
            </div>`;
          }

          if (f.buttons) {
            const cur = fields[f.key] || '';
            const btnsHtml = f.buttons.map(b => {
              const active = cur === b;
              return `<button class="sched-field-toggle ${active?'sched-field-toggle-on':''}"
                style="${active?`color:${fc};border-color:${fc}99;background:rgba(255,255,255,0.15);`:`color:${fc}50;border-color:${fc}25;`}"
                ${canEdit ? `onclick="toggleSchedFieldBtn('${key}','${slot}','${f.key}','${b.replace(/'/g,"\\'")}',this)"` : 'disabled style="cursor:default;opacity:0.6;"'}
              >${b}</button>`;
            }).join('');
            return `<div class="sched-field">
              <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
              <div class="sched-field-btns">${btnsHtml}</div>
            </div>`;
          }
          if (f.key === 'jobName') {
            return `<div class="sched-field" style="position:relative;">
              <div class="sched-field-label" style="color:${fc}80;${canEdit?'cursor:pointer;text-decoration:underline dotted;':''}" title="${canEdit?'Click to change job name':''}" ${canEdit?`onclick="var ta=this.closest('.sched-field').querySelector('textarea');ta.removeAttribute('readonly');ta.style.pointerEvents='';ta.focus();ta.select();schedJobNameInput(ta);"`:''}>
                ${f.label}
              </div>
              <div style="position:relative;flex:1;">
                <textarea class="sched-field-input" rows="1"
                  placeholder="—"
                  style="color:${fc};width:100%;"
                  data-key="${key}" data-slot="${slot}" data-field="${f.key}"
                  autocomplete="off"
                  onchange="saveSchedField(this)"
                  oninput="autoResize(this);schedJobNameInput(this);"
                  onblur="schedJobNameBlur(this)"
                  onfocus="schedJobNameInput(this)"
                  onkeydown="schedJobNameKeydown(event,this)"
                  ${canEdit?'':'readonly style="pointer-events:none;cursor:default;"'}
                >${fields[f.key]||''}</textarea>
                <div class="sched-jobnum-drop" id="sjn-${key}-${slot}" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:3000;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:0 0 var(--radius) var(--radius);max-height:220px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.5);"
                     onmouseenter="this._hovering=true" onmouseleave="this._hovering=false"></div>
              </div>
            </div>`;
          }
          if (f.key === 'jobNum') {
            return `<div class="sched-field" style="position:relative;">
              <div class="sched-field-label" style="color:${fc}80;${canEdit?'cursor:pointer;text-decoration:underline dotted;':''}" title="${canEdit?'Click to change job #':''}" ${canEdit?`onclick="var ta=this.closest('.sched-field').querySelector('textarea');ta.focus();ta.select();schedJobNumInput(ta);"`:''}>
                ${f.label}
              </div>
              <div style="position:relative;flex:1;">
                <textarea class="sched-field-input" rows="1"
                  placeholder="—"
                  style="color:${fc};width:100%;"
                  data-key="${key}" data-slot="${slot}" data-field="${f.key}"
                  autocomplete="off"
                  onchange="saveSchedField(this);lookupBacklogByJobNum(this);"
                  oninput="autoResize(this);schedJobNumInput(this);"
                  onblur="schedJobNumBlur(this)"
                  onfocus="schedJobNumInput(this)"
                  onkeydown="schedJobNumKeydown(event,this)"
                >${fields[f.key]||''}</textarea>
                <div class="sched-jobnum-drop" id="sjd-${key}-${slot}" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:3000;background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:0 0 var(--radius) var(--radius);max-height:220px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.5);"
                     onmouseenter="this._hovering=true" onmouseleave="this._hovering=false"></div>
              </div>
            </div>`;
          }
          // Notes — taller, no label, no action button (special actions live on the day-note bar only)
          if (f.key === 'notes') {
            const saA = (fields._specialActions || []);
            const saChips = saA.length ? `<div class="sa-chips-row">` +
              saA.map(sid => {
                const sa = specialActions.find(s => s.id === sid);
                if (!sa) return '';
                if (sa.id === 'sa6' && !canSeeVacation()) return '';
                const chipLabel2 = (sa.id === 'sa6' && fields._vacationPerson)
                  ? fields._vacationPerson
                  : (fields._saLocations?.[sid] ? sa.label + ' — ' + fields._saLocations[sid] : sa.label);
                return `<span class="sa-chip" style="color:#fff;border-color:${sa.color};background:${sa.color};">
                  ${chipLabel2}
                  ${canEdit ? `<button style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);font-size:10px;padding:0;line-height:1;"
                    onclick="event.stopPropagation();removeSchedSpecialAction('${key}','${slot}','` + sid + `')">✕</button>` : ''}
                </span>`;
              }).join('') + `</div>` : '';
            return `<div class="sched-field sched-notes-wrap" id="sanw_${key}_${slot.replace(/[^a-z0-9]/g,'_')}">
              ${saChips}
              <textarea class="sched-field-input sched-notes-input" rows="1"
                placeholder="Notes…"
                style="color:${fc};"
                data-key="${key}" data-slot="${slot}" data-field="${f.key}"
                onchange="saveSchedField(this)"
                oninput="autoResize(this);saveSchedField(this)"
                ${canEdit?'':'readonly style="pointer-events:none;cursor:default;"'}
              >${fields[f.key]||''}</textarea>
            </div>`;
          }
          return `<div class="sched-field">
            <div class="sched-field-label" style="color:${fc}80;">${f.label}</div>
            <textarea class="sched-field-input" rows="1"
              placeholder="—"
              style="color:${fc};"
              data-key="${key}" data-slot="${slot}" data-field="${f.key}"
              onchange="saveSchedField(this)"
              oninput="autoResize(this);saveSchedField(this)"
              ${canEdit?'':'readonly style="pointer-events:none;cursor:default;"'}
            >${fields[f.key]||''}</textarea>
          </div>`;
        }).join('');

        const typeBtnsHtml = blockTypes.filter(t => t.id !== 'blank').map(t => {
          const active = effectiveType === t.id;
          return `<button class="sched-type-btn ${active?'active':''}"
                  ${canEdit ? `onclick="setBlockType('${key}','${slot}','${t.id}')"` : 'disabled'}
                  title="${t.label}"
                  style="${active?`border-color:${fc}80;background:rgba(0,0,0,0.15);color:${fc};`:`color:${fc}40;border-color:${fc}20;background:rgba(0,0,0,0.08);`}${canEdit?'':';cursor:default;opacity:0.5;'}">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${t.color};border:1px solid rgba(255,255,255,0.3);vertical-align:middle;margin-right:3px;"></span>${active ? t.label.replace(' Work','').replace('Pending','Pend') : ''}
          </button>`;
        }).join('');

        const hasClip = !!schedClipboard;
        const copyPasteBtns = canEdit ? `
          <button class="sched-copy-btn" onclick="copySchedBlock('${key}','${slot}')" title="Copy this job card">📋</button>
          <button class="sched-paste-btn ${hasClip?'has-clip':''}" onclick="pasteSchedBlock('${key}','${slot}')" title="${hasClip?'Paste copied job here':'No job copied yet'}">📌</button>
          <button class="sched-queue-btn" onclick="addBlockToQueue('${key}','${slot}')" title="Send to queue">→</button>` : '';
        const jobFinishBtns = (canEdit && effectiveType !== 'blank' && (fields.jobName||fields.jobNum)) ? `
          <button onclick="_schedCompleteJob('${key}','${slot}')" title="Mark job COMPLETE — frees all equipment and notifies operators"
            style="background:rgba(126,203,143,0.12);border:1px solid rgba(126,203,143,0.35);border-radius:3px;color:#7ecb8f;font-family:'DM Sans',sans-serif;font-size:9px;font-weight:700;padding:2px 7px;cursor:pointer;white-space:nowrap;margin-left:2px;">✅ Complete</button>
          <button onclick="_schedCleanOutJob('${key}','${slot}')" title="Equipment clean-out — flag equipment for lowbed pick-up and notify drivers"
            style="background:rgba(90,180,245,0.1);border:1px solid rgba(90,180,245,0.35);border-radius:3px;color:#5ab4f5;font-family:'DM Sans',sans-serif;font-size:9px;font-weight:700;padding:2px 7px;cursor:pointer;white-space:nowrap;margin-left:2px;">🔄 Clean Out</button>` : '';

        const isBlank = effectiveType === 'blank';
        const hasData = Object.values(fields).some(v => v && v.trim && v.trim());

        const dragDropAttrs = canEdit
          ? 'ondragover="schedBlockDragOver(event,\''+key+'\',\''+slot+'\',\''+effectiveType+'\')" ondragleave="schedBlockDragLeave(event)" ondrop="schedBlockDrop(event,\''+key+'\',\''+slot+'\',\''+effectiveType+'\')"'
          : '';
        const fieldsClass = canEdit ? 'sched-fields sched-drag-handle' : 'sched-fields';
        const fieldsAttrs = canEdit
          ? 'draggable="true" ondragstart="schedBlockDragStart(event,\''+key+'\',\''+slot+'\')" ondragend="schedBlockDragEnd(event)" oncontextmenu="startCopyDrag(event,\''+key+'\',\''+slot+'\')" title="Left-drag: move | Right-drag: copy run" style="cursor:grab;"'
          : 'style="cursor:default;"';

        // Green outline if any service (QC/Tack/Rubber) is selected
        // Lookahead blackout logic
        const twoWeekKeys = lookaheadActiveSupplier ? getLookahead2WeekKeys() : null;
        const inLookaheadWindow = twoWeekKeys && twoWeekKeys.has(key);
        let lookaheadBlockout = false;
        let lookaheadHighlight = false;
        if (inLookaheadWindow && effectiveType !== 'blank') {
          const plant = fields.plant || '';
          const supplierCompany = lookaheadActiveSupplier.split('—')[0].trim().toLowerCase();
          const plantMatch = plant.trim() && (plant.toLowerCase().includes(supplierCompany) || supplierCompany.includes(plant.toLowerCase().split('—')[0].trim()));
          if (plantMatch) lookaheadHighlight = true;
          else lookaheadBlockout = true;
        }

        const isRainedOut = !!bdata.rainedOut;
        const finalBg = lookaheadBlockout ? '#111111' : isRainedOut ? '#4a4a4a' : isAfterNight ? '#5a5a5a' : blockBg;
        const finalFc = lookaheadBlockout ? '#333333' : isRainedOut ? '#aaaaaa' : isAfterNight ? '#cccccc' : fc;
        const serviceOutline = lookaheadHighlight ? 'outline:3px solid #f5c518;outline-offset:-3px;' : '';

        return `
          <div class="sched-block${isRainedOut?' rained-out':''}${slot==='bottom' && !_botStops.length && !_otherExtras.length?' sched-block-bottom':''}"
               data-date-key="${key}" data-block-slot="${slot}" data-block-type="${effectiveType}"
               style="background:${finalBg};${serviceOutline}${lookaheadBlockout?'user-select:none;':''}"
               ${dragDropAttrs}>
            <div class="sched-block-header" style="${isAfterNight ? 'background:#4a4a4a;border-bottom:2px solid #666;' : ''}">
              <div class="sched-block-header-row1">
                <span class="sched-foreman-name">${slot==='top'?(foremanRoster[0]||'Filipe Joaquim'):(foremanRoster[1]||'Louie Medeiros')}</span>
                ${((schedData[key]?.extras)||[]).some(x=>x.parentSlot===slot) ? '<span style="font-family:\'DM Mono\',monospace;font-size:7px;font-weight:700;color:var(--stripe);letter-spacing:.4px;white-space:nowrap;margin-left:4px;">· 2nd Stop Today</span>' : ''}
                <span style="flex:1;"></span>
                ${!lookaheadBlockout && isAdmin() ? `<button class="sched-rainout-btn${isRainedOut?' is-rained-out':''}" onclick="rainOutBlock('${key}','${slot}')" title="${isRainedOut?'Remove rain-out flag':'Mark as rained out — pushes this job and all consecutive following jobs forward by 1 workday'}">🌧${isRainedOut?' Rained Out':''}</button>` : ''}
                ${!lookaheadBlockout ? `<button onclick="generateDailyOrder('${key}','${slot}',event)" title="Generate Daily Order"
                  style="background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.35);border-radius:3px;color:#f5c518;font-family:'DM Sans',sans-serif;font-size:9px;font-weight:700;padding:2px 7px;cursor:pointer;white-space:nowrap;transition:all 0.12s;"
                  onmouseover="this.style.background='rgba(245,197,24,0.25)'"
                  onmouseout="this.style.background='rgba(245,197,24,0.12)';this.style.transform='';this.style.boxShadow=''"
                  onmousedown="this.style.transform='scale(0.88)';this.style.background='rgba(245,197,24,0.4)';this.style.boxShadow='inset 0 1px 4px rgba(0,0,0,0.4)'"
                  onmouseup="this.style.transform='';this.style.boxShadow=''">📋 Daily Order</button>` : ''}
              </div>
            </div>
            ${isAfterNight ? `
            <div style="background:#4a4a4a;padding:8px 10px;border-bottom:1px solid #666;display:flex;flex-direction:column;align-items:flex-start;gap:6px;">
              <span style="background:#333;border:1px solid #888;border-radius:4px;padding:2px 7px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:#ddd;letter-spacing:0.5px;white-space:nowrap;">🌙 No Work After Night Shift</span>
              ${canEdit ? `<button onclick="clearAfterNightFlag('${key}','${slot}')"
                style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);border-radius:4px;padding:3px 9px;font-family:'DM Sans',sans-serif;font-size:9px;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap;transition:all 0.15s;align-self:flex-start;"
                onmouseover="this.style.background='rgba(255,255,255,0.2)'"
                onmouseout="this.style.background='rgba(255,255,255,0.1)'"
                title="Override: allow scheduling on this day">Override →</button>` : ''}
            </div>` : ''}
            <div class="${fieldsClass}" ${lookaheadBlockout ? 'style="pointer-events:none;opacity:0.08;"' : isAfterNight ? 'style="pointer-events:none;opacity:0.25;"' : fieldsAttrs}>
              ${lookaheadBlockout ? '' : fieldsHtml}
            </div>
            <div class="sched-type-btns">${typeBtnsHtml}${copyPasteBtns}${jobFinishBtns}</div>
          </div>`;
      };

      // Get extra blocks for this day
      const extras = (schedData[key]?.extras) || [];
      // Group extras: second-stops go under parent card; unaffiliated go at bottom
      const _topStops    = extras.map((ex,i)=>({ex,i})).filter(x=>x.ex.parentSlot==='top');
      const _botStops    = extras.map((ex,i)=>({ex,i})).filter(x=>x.ex.parentSlot==='bottom');
      const _otherExtras = extras.map((ex,i)=>({ex,i})).filter(x=>!x.ex.parentSlot);
      const _lastExtraI  = _otherExtras.length ? _otherExtras[_otherExtras.length-1].i
                         : _botStops.length    ? _botStops[_botStops.length-1].i : -1;

      const isHoliday = holidays.has(key);
      const canEditSched = (isAdmin() || canEditTab('schedule')) && schedEditMode;

      return `
        <div class="sched-day-col">
          <div class="sched-day-header ${todayCls}${isWeekend?' sched-weekend':''}${isHoliday?' sched-holiday':''}" style="position:relative;">
            ${canEditSched ? `<button onclick="openClearDayModal('${key}')" title="Clear a job card for this day"
              style="position:absolute;right:5px;bottom:4px;background:none;border:none;color:rgba(255,255,255,0.45);font-size:9px;font-weight:700;width:16px;height:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;line-height:1;transition:color 0.15s;"
              onmouseover="this.style.color='#ff6b6b'"
              onmouseout="this.style.color='rgba(255,255,255,0.45)'">✕</button>` : ''}
            <div class="sched-day-name">${dayName}</div>
            <button class="sched-day-num-btn${isHoliday?' is-holiday':''}"
              onclick="${canEditSched ? `toggleHoliday('${key}')` : ''}"
              title="${canEditSched ? (isHoliday ? 'Click to remove holiday' : 'Click to mark as holiday') : ''}"
              style="${canEditSched ? '' : 'cursor:default;'}"
            >${dayNum}${isHoliday ? '<span class="sched-holiday-badge">HOLIDAY</span>' : ''}</button>
            <button class="sched-day-add-btn" onclick="openAddForemanModal('${key}')" title="Add foreman crew for this day">+</button>
          </div>
          ${renderBlock('top')}
          <div class="sched-second-stops-wrap" data-stop-slot="top" style="order:2;width:100%;box-sizing:border-box;align-self:stretch;">${_topStops.map(({ex,i}) => renderExtraBlock(key, i, ex, false)).join('')}</div>
          ${(()=>{
            const dn = schedData[key]||{};
            const dayNoteSA = dn.dayNoteSA||[];
            const hasActions = dayNoteSA.length > 0;
            const saChips = dayNoteSA.map(sid => {
              const sa = specialActions.find(s=>s.id===sid);
              if (!sa) return '';
              const _graderChip = sa.label === 'Jimmy in Grader' || sa.label === 'Steve in Grader';
              const chipBg      = _graderChip ? '#f5c518'              : (sa.color || 'rgba(0,0,0,0.14)');
              const chipBorder  = _graderChip ? '2px solid #000'       : `1px solid ${sa.color || 'rgba(0,0,0,0.25)'}`;
              const chipColor   = _graderChip ? '#000'                 : '#fff';
              const xColor      = _graderChip ? 'rgba(0,0,0,0.55)'    : 'rgba(255,255,255,0.7)';
              const saLoc       = dn.dayNoteSALocations?.[sid];
              const chipLabel   = saLoc ? sa.label + ' — ' + saLoc : sa.label;
              return `<span class="sched-day-note-sa-chip" style="background:${chipBg};border:${chipBorder};color:${chipColor};">
                ${chipLabel}
                ${canEditSched?`<button style="background:none;border:none;cursor:pointer;font-size:9px;padding:0 0 0 2px;line-height:1;color:${xColor};"
                  onclick="event.stopPropagation();removeDayNoteSA('${key}','${sid}')">✕</button>`:''}
              </span>`;
            }).join('');
            return `<div class="sched-day-note-wrap sched-day-note-drag"
              data-day-key="${key}"
              draggable="${canEditSched}"
              ondragstart="${canEditSched?`schedDayNoteDragStart(event,'${key}')`:'false'}"
              ondragend="schedDayNoteDragEnd(event)"
              onmousedown="${canEditSched?`dayNotePressStart(event,'${key}',this)`:''}">
              ${hasActions ? `<div class="sched-day-note-sa-chips">${saChips}</div>` : ''}
              ${canEditSched?`<button class="sa-action-btn" onclick="event.stopPropagation();openDayNoteSADrop('${key}',this)" title="Add special action">+ Action</button>`:''}
            </div>`;
          })()}
          ${renderBlock('bottom')}
          <div class="sched-second-stops-wrap" data-stop-slot="bottom" style="order:4;width:100%;box-sizing:border-box;align-self:stretch;">${_botStops.map(({ex,i}) => renderExtraBlock(key, i, ex, !_otherExtras.length && i===_lastExtraI)).join('')}</div>
          ${_otherExtras.map(({ex,i}) => renderExtraBlock(key, i, ex, i===_lastExtraI)).join('')}
        </div>`;
    }).join('');

    const { colW, blockH } = getWeekMetrics(week);
    return `<div class="sched-week"><div class="sched-week-days" style="--col-w:${colW}px;--block-h:${blockH}px;">${daysHtml}</div></div>`;
  }).join('');

  // ── Mobile: queue-style foreman rows per day ────────────────────────────
  const canEditSchedMob = (isAdmin() || canEditTab('schedule')) && schedEditMode;
  const mobileWeeksHtml = weeks.map(week => {
    const weekStart = week.find(Boolean);
    const weekEnd   = [...week].reverse().find(Boolean);
    const wkLabel   = weekStart
      ? weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' – ' +
        (weekEnd||weekStart).toLocaleDateString('en-US',{month:'short',day:'numeric'})
      : '';
    const daysHtml = week.map(d => {
      if (!d) return '';
      const key      = dk(d);
      const dayName  = DAY_NAMES[d.getDay()];
      const dayNum   = d.getDate();
      const isWknd   = d.getDay() === 0 || d.getDay() === 6;
      const isTodayD = isToday(d);
      const isHolD   = holidays.has(key);
      // Build all slots (top, bottom, extras)
      const slotDefs = [
        { slot:'top',    foreman: foremanRoster[0]||'Filipe Joaquim' },
        { slot:'bottom', foreman: foremanRoster[1]||'Louie Medeiros'  }
      ];
      const extras = (schedData[key]?.extras) || [];
      extras.forEach((ex, ei) => {
        slotDefs.push({ slot: 'extra_'+ei, foreman: ex.data?.foremanName || 'Extra Crew' });
      });
      const rows = slotDefs.map(({ slot, foreman }) => {
        const bdata = slot.startsWith('extra_')
          ? (extras[parseInt(slot.split('_')[1])]?.data || {type:'blank',fields:{}})
          : ((schedData[key]||{})[slot] || {type:'blank',fields:{}});
        const effectiveType = bdata.type || 'blank';
        const fields   = bdata.fields || {};
        const hasJob   = !!(fields.jobName || fields.jobNum);
        const btype    = getBlockType(effectiveType);
        const isRained = !!bdata.rainedOut;
        // Build GC from backlog lookup (jobName often contains gc—name)
        const parts    = (fields.jobName || '').split('—').map(s => s.trim());
        const gc       = parts.length >= 2 ? parts[0] : '';
        const jobTitle = parts.length >= 2 ? parts.slice(1).join(' — ') : (fields.jobName || '');
        const chipText = [
          fields.jobNum ? `#${escHtml(fields.jobNum)}` : '',
          gc ? escHtml(gc) : '',
          jobTitle ? escHtml(jobTitle) : (hasJob ? '' : '—')
        ].filter(Boolean).join(' · ');
        if (!hasJob && isWknd) return '';
        return `<div class="sched-mob-row" onclick="openMobBlockDetail('${key}','${slot}')"
            style="border-left:3px solid ${hasJob ? btype.color : 'var(--asphalt-light)'};${!hasJob?'opacity:0.4;':''}">
          <span class="sched-mob-foreman-label">${escHtml(foreman.split(' ')[0])}</span>
          <span class="sched-mob-row-chip ${isRained?'sched-mob-row-rined':''}">
            ${isRained ? '🌧 ' : ''}${chipText || '—'}
          </span>
          <span class="sched-mob-row-type" style="color:${hasJob ? btype.color : 'var(--concrete-dim)'};">${hasJob ? (btype.label.replace(' Work','')) : ''}</span>
        </div>`;
      }).join('');
      const hasContent = slotDefs.some(({ slot }) => {
        const bd = slot.startsWith('extra_') ? extras[parseInt(slot.split('_')[1])]?.data : (schedData[key]||{})[slot];
        return bd && bd.type !== 'blank';
      });
      if (!hasContent && isWknd) return '';
      return `<div class="sched-mob-day${isTodayD?' sched-mob-today-day':''}${isHolD?' sched-mob-hol-day':''}">
        <div class="sched-mob-day-hdr">
          <span class="sched-mob-dname">${dayName}</span>
          <span class="sched-mob-dnum">${dayNum}</span>
          ${isTodayD ? '<span class="sched-mob-badge sched-mob-badge-today">TODAY</span>' : ''}
          ${isHolD   ? '<span class="sched-mob-badge sched-mob-badge-hol">HOLIDAY</span>'  : ''}
        </div>
        <div class="sched-mob-rows">${rows || '<div class="sched-mob-empty-day">No jobs</div>'}</div>
      </div>`;
    }).join('');
    if (!daysHtml.trim()) return '';
    return `<div class="sched-mob-week">
      <div class="sched-mob-week-label">Week of ${wkLabel}</div>
      ${daysHtml}
    </div>`;
  }).join('');

  // ── Mobile: monthly calendar grid ────────────────────────────────────────
  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowHdrHtml = DOW_LABELS.map((d,i) =>
    `<div class="sched-mob-cal-dow${(i===0||i===6)?' weekend':''}">${d}</div>`
  ).join('');

  // Build flat 7-col grid: pad start with empty cells
  // Helper: get initials from a full name (first letter of each word)
  const _fmInit = (name) => (name||'').split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().slice(0,2);

  const firstDate = dates[0];
  const startDow  = firstDate.getDay(); // 0=Sun
  let calCells = [];
  // leading empties
  for (let i=0; i<startDow; i++) calCells.push('<div class="sched-mob-cal-cell empty"></div>');
  // actual days — split into Filipe / Louie halves
  dates.forEach(d => {
    const key      = dk(d);
    const dow      = d.getDay();
    const dayNum   = d.getDate();
    const isWknd   = dow === 0 || dow === 6;
    const isTodayD = isToday(d);
    const isHolD   = holidays.has(key);
    const cls = ['sched-mob-cal-cell',
      isWknd  ? 'weekend'  : '',
      isTodayD? 'today'    : '',
      isHolD  ? 'holiday'  : '',
    ].filter(Boolean).join(' ');

    // Build crew block for selected foreman only
    const allSlotDefs = [
      { slot:'top',    foreman: foremanRoster[0]||'Filipe Joaquim', parentSlot:'top' },
      { slot:'bottom', foreman: foremanRoster[1]||'Louie Medeiros',  parentSlot:'bottom' }
    ];
    const dayExtras = (schedData[key]?.extras) || [];
    dayExtras.forEach((ex,ei) => {
      allSlotDefs.push({ slot:'extra_'+ei, foreman: ex.data?.foremanName||'Extra Crew', parentSlot: ex.parentSlot||'top' });
    });
    const slotDefs = allSlotDefs.filter(({ slot, parentSlot }) =>
      slot === mobSchedForemanFilter ||
      (slot.startsWith('extra_') && parentSlot === mobSchedForemanFilter)
    );

    const crewBlocks = slotDefs.map(({ slot, foreman }) => {
      const bdata = slot.startsWith('extra_')
        ? (dayExtras[parseInt(slot.split('_')[1])]?.data || {type:'blank',fields:{}})
        : ((schedData[key]||{})[slot] || {type:'blank',fields:{}});
      const effectiveType = bdata.type || 'blank';
      const fields   = bdata.fields || {};
      const hasJob   = !!(fields.jobName || fields.jobNum);
      const btype    = getBlockType(effectiveType);
      const isRained = !!bdata.rainedOut;
      const initials = _fmInit(foreman);

      // Determine background color
      let bg;
      if (effectiveType === 'blank' || (!hasJob && effectiveType === 'blank')) {
        bg = 'transparent';
      } else if (isRained) {
        bg = '#4a4a4a';
      } else {
        bg = btype.color;
      }

      const jobNum = fields.jobNum ? '#'+fields.jobNum : '';
      const blankCls = (!hasJob && effectiveType === 'blank') ? ' crew-blank' : '';
      const rainCls  = isRained ? ' crew-rained' : '';

      if (!hasJob && effectiveType === 'blank') {
        // Empty slot — still show initials dimmed, tappable for move-mode target
        return `<div class="sched-mob-cal-crew${blankCls}" data-key="${key}" data-slot="${slot}"
          style="background:${bg};"
          onclick="_mobCalCrewTap('${key}','${slot}')"
          oncontextmenu="event.preventDefault()">
          <span class="sched-mob-cal-crew-init" style="color:rgba(255,255,255,0.15);">${initials}</span>
        </div>`;
      }

      return `<div class="sched-mob-cal-crew${rainCls}" data-key="${key}" data-slot="${slot}"
        style="background:${bg};"
        onclick="_mobCalCrewTap('${key}','${slot}')"
        oncontextmenu="event.preventDefault()">
        <span class="sched-mob-cal-crew-init">${initials}</span>
        <span class="sched-mob-cal-crew-job">${escHtml(jobNum)}</span>
      </div>`;
    }).join('');

    let innerHtml = `<div class="sched-mob-cal-crews">${crewBlocks}</div>`;
    innerHtml += `<span class="sched-mob-cal-daynum">${dayNum}</span>`;
    if (isHolD) innerHtml += `<span class="sched-mob-cal-hol-lbl">HOL</span>`;

    calCells.push(`<div class="${cls}">${innerHtml}</div>`);
  });

  const mobileCalHtml = `
    <div class="sched-mob-cal-dow-hdr">${dowHdrHtml}</div>
    <div class="sched-mob-cal-grid" id="mobCalGrid">${calCells.join('')}</div>`;
  // ─────────────────────────────────────────────────────────────────────────

  // Save scroll position before re-render so field edits don't snap to top
  const scrollOuter = document.getElementById('schedScrollOuter');
  const savedScrollTop  = scrollOuter ? scrollOuter.scrollTop  : 0;
  const savedScrollLeft = scrollOuter ? scrollOuter.scrollLeft : 0;

  wrap.innerHTML = `
    <div class="schedule-wrap">

      <!-- ── Schedule Header ───────────────────────────────────────── -->
      <div class="schedule-header sched-hdr-new">

        <!-- LEGEND: absolutely positioned top-right corner -->
        <div class="sched-legend-wrap">
          <div class="sched-legend">${legendHtml}</div>
        </div>

        <div class="sched-hdr-row1">

          <!-- LEFT: queue drop zone fills the left 1fr column -->
          <div id="queueDropZone" class="sched-hdr-queue-row">
            <span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:#555;padding:0 10px;flex-shrink:0;white-space:nowrap;">📦 QUEUE</span>
            <div id="schedQueueStrip" class="sched-queue-strip">
              <span class="sched-queue-empty-text">Drop jobs here to queue</span>
            </div>
          </div>

          <!-- CENTER: title + month nav (truly centered in banner) -->
          <div style="display:flex;flex-direction:column;align-items:center;gap:5px;">
            <div class="schedule-title" style="position:static;transform:none;font-size:20px;line-height:1;">📅 Master Schedule</div>
            <div class="schedule-month-nav" style="margin:0;">
              <button onclick="open2WeekLookahead();" title="2-Week Lookahead"
                style="background:var(--blue);border:none;border-radius:var(--radius);padding:3px 8px;color:#fff;font-size:13px;cursor:pointer;line-height:1;">📷</button>
              <button class="schedule-nav-btn" onclick="schedMonthOffset--;renderSchedule();">◀</button>
              <div class="schedule-month-label">${monthLabel}</div>
              <button class="schedule-nav-btn" onclick="schedMonthOffset++;renderSchedule();">▶</button>
              <button id="sched-ai-hdr-btn" onclick="window._schedAI?.open()" title="AI Schedule Assistant"
                style="background:rgba(126,203,143,0.15);border:1px solid rgba(126,203,143,0.4);border-radius:var(--radius);padding:3px 8px;color:#7ecb8f;font-size:13px;cursor:pointer;line-height:1;">🤖</button>
              <button class="btn btn-ghost btn-sm" onclick="schedMonthOffset=0;schedScrollToToday=true;renderSchedule();" style="font-size:10px;padding:3px 7px;">Today</button>
              ${lookaheadActiveSupplier ? `<button class="btn btn-sm" onclick="clearLookahead()" style="font-size:10px;padding:3px 8px;background:rgba(213,64,61,0.15);border-color:var(--red);color:var(--red);">✕ ${lookaheadActiveSupplier.split('—')[0].trim()}</button>` : ''}
            </div>
          </div>

          <!-- RIGHT: zoom controls -->
          <div class="sched-hdr-right">
            <div style="display:flex;align-items:center;gap:3px;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:2px 4px;">
              <button class="schedule-nav-btn" onclick="changeSchedZoom(-0.1)" style="width:22px;height:22px;font-size:12px;">−</button>
              <span id="schedZoomLabel" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);min-width:28px;text-align:center;">${Math.round(schedZoom*100)}%</span>
              <button class="schedule-nav-btn" onclick="changeSchedZoom(0.1)" style="width:22px;height:22px;font-size:12px;">+</button>
              <button class="schedule-nav-btn" onclick="changeSchedZoom(0)" style="width:22px;height:22px;font-size:9px;">⊡</button>
            </div>
          </div>

        </div>

      </div>

      <!-- ── Mobile monthly calendar (shown ≤600px) ──────────────────── -->
      <div class="sched-mob-view">
        <!-- Mobile nav: prev/next month + month label + Today -->
        <div class="sched-mob-nav">
          <button class="sched-mob-nav-btn" onclick="schedMonthOffset--;renderSchedule();" aria-label="Previous month">&#9664;</button>
          <div class="sched-mob-nav-center">
            <div class="sched-mob-nav-month">${monthLabel}</div>
            <div class="sched-mob-nav-today" onclick="schedMonthOffset=0;schedScrollToToday=true;renderSchedule();">Today</div>
          </div>
          <button class="sched-mob-nav-btn" onclick="schedMonthOffset++;renderSchedule();" aria-label="Next month">&#9654;</button>
        </div>
        <!-- Foreman toggle -->
        <div class="sched-mob-fm-toggle">
          <button class="sched-mob-fm-btn${mobSchedForemanFilter==='top'?' active':''}"
            onclick="mobSchedForemanFilter='top';renderSchedule()">${foremanRoster[0]||'Filipe Joaquim'}</button>
          <button class="sched-mob-fm-btn${mobSchedForemanFilter==='bottom'?' active':''}"
            onclick="mobSchedForemanFilter='bottom';renderSchedule()">${foremanRoster[1]||'Louie Medeiros'}</button>
        </div>
        <!-- Monthly calendar grid -->
        <div class="sched-mob-cal">${mobileCalHtml}</div>
      </div>

      <!-- ── Desktop grid (hidden ≤600px) ────────────────────────────── -->
      <div class="schedule-scroll" id="schedScrollOuter">
        <div id="schedScrollInner" style="transform-origin:top left;transform:scale(${schedZoom});width:${schedZoom < 1 ? (100/schedZoom).toFixed(1)+'%' : '100%'};">
          ${weeksHtml}
        </div>
      </div>
    </div>`;

  // Auto-resize all textareas
  wrap.querySelectorAll('.sched-field-input').forEach(autoResize);
  // Refresh queue list
  renderQueueList();
  // Re-attach queue drop zone handlers (element is recreated on every render)
  var queueZone = document.getElementById('queueDropZone');
  console.log('[Queue] attaching drop handlers to:', document.getElementById('queueDropZone'));
  if (queueZone) {
    queueZone.addEventListener('dragover', queueDragOver);
    queueZone.addEventListener('dragleave', queueDragLeave);
    queueZone.addEventListener('drop', queueDrop);
  }

  // Paint weather overlays — fires async in background after DOM settles
  setTimeout(wxPaintAllBlocks, 80);

  // Re-apply mobile move-mode highlights if still active
  if (_mobMoveState) {
    setTimeout(function() { _mobMoveRefreshUI(); _mobMoveShowBanner(); }, 50);
  }

  // Equalize block heights and watch for future changes (chips, typing, wx banners)
  setTimeout(function() {
    _equalizeSchedBlocks();
    _attachSchedEqObserver();
  }, 120);

  // Scroll handling: scroll to today on tab open, otherwise restore position
  const newScrollOuter = document.getElementById('schedScrollOuter');
  if (newScrollOuter) {
    if (schedScrollToToday) {
      schedScrollToToday = false;
      // Find the today column and scroll it into view within the scroll container
      setTimeout(() => {
        const todayEl = newScrollOuter.querySelector('.sched-day-header.today');
        if (todayEl) {
          const colEl = todayEl.closest('.sched-day-col') || todayEl;
          const containerTop = newScrollOuter.getBoundingClientRect().top;
          const elTop = colEl.getBoundingClientRect().top;
          newScrollOuter.scrollTop += (elTop - containerTop) - 20; // 20px padding above
        }
      }, 0);
    } else {
      // Restore previous scroll position after re-render
      newScrollOuter.scrollTop  = savedScrollTop;
      newScrollOuter.scrollLeft = savedScrollLeft;
    }
  }
  } catch(e) {
    console.error('renderSchedule error:', e);
  }
}

function autoResize(el) {
  el.style.height='auto';
  el.style.height=el.scrollHeight+'px';
}

function saveSchedField(elOrKey, slot, field, value) {
  var key, val, el;
  if (typeof elOrKey === 'string') {
    // Programmatic call: saveSchedField(key, slot, field, value)
    key = elOrKey;
    val = value;
  } else {
    // DOM element call: saveSchedField(el)
    el = elOrKey;
    key = el.dataset.key;
    slot = el.dataset.slot;
    field = el.dataset.field;
    val = el.value;
  }
  if (!schedData[key] || !schedData[key][slot]) return;
  schedData[key][slot].fields = schedData[key][slot].fields || {};
  schedData[key][slot].fields[field] = val;
  saveSchedData();
  // Compliance check when job# is entered (DOM path only — needs the element)
  if (el && field === 'jobNum' && val.trim()) {
    _schedCheckJobCompliance(val.trim(), el);
  }
}

function lookupBacklogByJobNum(el) {
  const { key, slot } = el.dataset;
  const num = el.value.trim();
  if (!num) return;
  const match = (typeof backlogJobs !== 'undefined' ? backlogJobs : [])
    .find(j => {
      const jn = (j.num || j.jobNum || j.number || '').trim().toLowerCase();
      return jn && jn === num.toLowerCase();
    });
  if (!match) return;
  const parts = [match.gc, match.name].filter(Boolean);
  const autoName = parts.join(' — ');
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
  if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
  const currentJobName = schedData[key][slot].fields.jobName || '';
  if (!currentJobName || currentJobName.includes(' — ') || currentJobName === autoName) {
    schedData[key][slot].fields.jobName = autoName;
    saveSchedData();
    const block = el.closest('.sched-block');
    if (block) {
      const jobNameEl = block.querySelector('[data-field="jobName"]');
      if (jobNameEl) { jobNameEl.value = autoName; autoResize(jobNameEl); }
    }
  }
}

function lookupBacklogByJobName(el) {
  const { key, slot } = el.dataset;
  const name = el.value.trim();
  if (!name) return;
  const pool = (typeof backlogJobs !== 'undefined' ? backlogJobs : []);
  const match = pool.find(j => {
    const jName = j.name || j.jobName || '';
    const full = [j.gc, jName].filter(Boolean).join(' — ');
    return full.toLowerCase() === name.toLowerCase() || jName.toLowerCase() === name.toLowerCase();
  });
  if (!match) return;
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
  if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
  const currentJobNum = schedData[key][slot].fields.jobNum || '';
  const matchNum = match.num || match.jobNum || match.number || '';
  if (!currentJobNum) {
    schedData[key][slot].fields.jobNum = matchNum;
    saveSchedData();
    const block = el.closest('.sched-block');
    if (block) {
      const jobNumEl = block.querySelector('[data-field="jobNum"]');
      if (jobNumEl) { jobNumEl.value = matchNum; autoResize(jobNumEl); }
    }
  }
}

function schedJobNameInput(el) {
  const { key, slot } = el.dataset;
  const dropId = `sjn-${key}-${slot}`;
  const drop = document.getElementById(dropId);
  if (!drop) return;
  const val = el.value.trim().toLowerCase();
  const pool = (typeof backlogJobs !== 'undefined' ? backlogJobs : [])
    .filter(j => j.name || j.jobName)
    .sort((a,b) => ((a.name||a.jobName||'')).localeCompare((b.name||b.jobName||'')));
  const matches = val
    ? pool.filter(j => {
        const n = (j.name||j.jobName||'').toLowerCase();
        const gc = (j.gc||'').toLowerCase();
        const num = (j.num||j.jobNum||j.number||'').toLowerCase();
        return n.includes(val) || gc.includes(val) || num.includes(val);
      })
    : pool;
  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = matches.slice(0,30).map(j => {
    const fullName = [j.gc, (j.name||j.jobName)].filter(Boolean).join(' — ');
    return `<div class="sched-jobnum-item" data-name="${fullName.replace(/"/g,'&quot;')}" data-num="${(j.num||'').replace(/"/g,'&quot;')}"
         onmousedown="selectSchedJobName(event,'${key}','${slot}','${fullName.replace(/'/g,"\\'")}','${(j.num||'').replace(/'/g,"\\'")}')">
      <div class="sched-jobnum-item-num">${j.num||''}</div>
      <div class="sched-jobnum-item-name">${fullName}</div>
    </div>`;
  }).join('');
  drop.style.display = 'block';
}

function schedJobNameBlur(el) {
  const { key, slot } = el.dataset;
  const drop = document.getElementById(`sjn-${key}-${slot}`);
  setTimeout(() => {
    if (drop && !drop._hovering) drop.style.display = 'none';
  }, 200);
}

function schedJobNameKeydown(e, el) {
  const { key: dkey, slot } = el.dataset;
  const drop = document.getElementById(`sjn-${dkey}-${slot}`);
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('.sched-jobnum-item');
  let active = drop.querySelector('.sched-jobnum-item.active');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!active) { items[0]?.classList.add('active'); }
    else { active.classList.remove('active'); (active.nextElementSibling||items[0]).classList.add('active'); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!active) { items[items.length-1]?.classList.add('active'); }
    else { active.classList.remove('active'); (active.previousElementSibling||items[items.length-1]).classList.add('active'); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cur = drop.querySelector('.sched-jobnum-item.active') || items[0];
    if (cur) { selectSchedJobName(null, dkey, slot, cur.dataset.name, cur.dataset.num); el.blur(); }
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
  }
}

function selectSchedJobName(e, key, slot, name, num) {
  if (e) e.preventDefault();
  const nameEl = document.querySelector(`[data-key="${key}"][data-slot="${slot}"][data-field="jobName"]`);
  if (nameEl) {
    nameEl.value = name;
    if (typeof saveSchedField === 'function') saveSchedField(nameEl);
    autoResize(nameEl);
  }
  // Auto-fill job # if blank
  if (num) {
    const numEl = document.querySelector(`[data-key="${key}"][data-slot="${slot}"][data-field="jobNum"]`);
    if (numEl && !numEl.value.trim()) {
      numEl.value = num;
      if (typeof saveSchedField === 'function') saveSchedField(numEl);
      autoResize(numEl);
    }
    // Also update schedData directly
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
    if (!schedData[key][slot].fields.jobNum) {
      schedData[key][slot].fields.jobNum = num;
      saveSchedData();
    }
  }
  const drop = document.getElementById(`sjn-${key}-${slot}`);
  if (drop) drop.style.display = 'none';
}

// Extra-block versions of the job# functions (use saveSchedFieldExtra instead of saveSchedField)
function schedJobNumInputExtra(el, key, idx) {
  const slot = `extra_${idx}`;
  const dropId = `sjde-${key}-${slot}`;
  const drop = document.getElementById(dropId);
  if (!drop) return;
  const val = el.value.trim().toLowerCase();
  const pool = (typeof backlogJobs !== 'undefined' ? backlogJobs : [])
    .filter(j => j.num)
    .sort((a,b) => (a.num||'').localeCompare(b.num||''));
  const matches = val
    ? pool.filter(j => j.num.toLowerCase().includes(val) || (j.gc||'').toLowerCase().includes(val) || (j.name||'').toLowerCase().includes(val))
    : pool;
  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = matches.map(j => `
    <div class="sched-jobnum-item" data-num="${j.num.replace(/"/g,'&quot;')}"
         onmousedown="selectSchedJobNumExtra(event,'${key}',${idx},'${j.num.replace(/'/g,"\\'")}')">
      <div class="sched-jobnum-item-num">${j.num}</div>
      <div class="sched-jobnum-item-name">${[j.gc,j.name].filter(Boolean).join(' — ')}</div>
    </div>`).join('');
  drop.style.display = 'block';
}

function schedJobNumBlurExtra(el, key, idx) {
  const slot = `extra_${idx}`;
  const drop = document.getElementById(`sjde-${key}-${slot}`);
  setTimeout(() => { if (drop && !drop._hovering) drop.style.display = 'none'; }, 200);
}

function schedJobNumKeydownExtra(e, el, key, idx) {
  const slot = `extra_${idx}`;
  const drop = document.getElementById(`sjde-${key}-${slot}`);
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('.sched-jobnum-item');
  let active = drop.querySelector('.sched-jobnum-item.active');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!active) { items[0]?.classList.add('active'); }
    else { active.classList.remove('active'); (active.nextElementSibling||items[0]).classList.add('active'); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!active) { items[items.length-1]?.classList.add('active'); }
    else { active.classList.remove('active'); (active.previousElementSibling||items[items.length-1]).classList.add('active'); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cur = drop.querySelector('.sched-jobnum-item.active') || items[0];
    if (cur) { selectSchedJobNumExtra(null, key, idx, cur.dataset.num); el.blur(); }
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
  }
}

function selectSchedJobNumExtra(e, key, idx, num) {
  if (e) e.preventDefault();
  const slot = `extra_${idx}`;
  const block = document.querySelector(`[data-key="${key}"][data-slot="${slot}"][data-field="jobNum"]`);
  if (block) {
    block.value = num;
    saveSchedFieldExtra(block, key, idx);
    lookupBacklogByJobNumExtra(block, key, idx);
    autoResize(block);
  }
  const drop = document.getElementById(`sjde-${key}-${slot}`);
  if (drop) drop.style.display = 'none';
}

function lookupBacklogByJobNumExtra(el, key, idx) {
  const slot = `extra_${idx}`;
  const num = el.value.trim();
  if (!num) return;
  const match = (typeof backlogJobs !== 'undefined' ? backlogJobs : [])
    .find(j => j.num && j.num.trim().toLowerCase() === num.toLowerCase());
  if (!match) return;
  const autoName = [match.gc, match.name].filter(Boolean).join(' — ');
  if (schedData[key]?.extras?.[idx]?.data?.fields) {
    const currentJobName = schedData[key].extras[idx].data.fields.jobName || '';
    if (!currentJobName || currentJobName.includes(' — ') || currentJobName === autoName) {
      schedData[key].extras[idx].data.fields.jobName = autoName;
      saveSchedData();
      const block = el.closest('.sched-block');
      if (block) {
        const jobNameEl = block.querySelector('[data-field="jobName"]');
        if (jobNameEl) { jobNameEl.value = autoName; autoResize(jobNameEl); }
      }
    }
  }
}

function schedJobNumInput(el) {
  const { key, slot } = el.dataset;
  const dropId = `sjd-${key}-${slot}`;
  const drop = document.getElementById(dropId);
  if (!drop) return;
  const val = el.value.trim().toLowerCase();
  const pool = (typeof backlogJobs !== 'undefined' ? backlogJobs : [])
    .filter(j => j.num)
    .sort((a,b) => (a.num||'').localeCompare(b.num||''));
  const matches = val
    ? pool.filter(j => j.num.toLowerCase().includes(val) || (j.gc||'').toLowerCase().includes(val) || (j.name||'').toLowerCase().includes(val))
    : pool;
  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = matches.map((j,i) => `
    <div class="sched-jobnum-item" data-num="${j.num.replace(/"/g,'&quot;')}"
         onmousedown="selectSchedJobNum(event,'${key}','${slot}','${j.num.replace(/'/g,"\\'")}')">
      <div class="sched-jobnum-item-num">${j.num}</div>
      <div class="sched-jobnum-item-name">${[j.gc,j.name].filter(Boolean).join(' — ')}</div>
    </div>`).join('');
  drop.style.display = 'block';
}

function schedJobNumBlur(el) {
  const { key, slot } = el.dataset;
  const drop = document.getElementById(`sjd-${key}-${slot}`);
  // Don't close if mouse is currently inside the dropdown (user may be scrolling)
  setTimeout(() => {
    if (drop && !drop._hovering) drop.style.display = 'none';
  }, 200);
}

function schedJobNumKeydown(e, el) {
  const { key: dkey, slot } = el.dataset;
  const drop = document.getElementById(`sjd-${dkey}-${slot}`);
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('.sched-jobnum-item');
  let active = drop.querySelector('.sched-jobnum-item.active');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!active) { items[0]?.classList.add('active'); }
    else { active.classList.remove('active'); (active.nextElementSibling||items[0]).classList.add('active'); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!active) { items[items.length-1]?.classList.add('active'); }
    else { active.classList.remove('active'); (active.previousElementSibling||items[items.length-1]).classList.add('active'); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cur = drop.querySelector('.sched-jobnum-item.active') || items[0];
    if (cur) { selectSchedJobNum(null, dkey, slot, cur.dataset.num); el.blur(); }
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
  }
}

function selectSchedJobNum(e, key, slot, num) {
  if (e) e.preventDefault();
  // Find the textarea and update it
  const block = document.querySelector(`[data-key="${key}"][data-slot="${slot}"][data-field="jobNum"]`);
  if (block) {
    block.value = num;
    saveSchedField(block);
    lookupBacklogByJobNum(block);
    autoResize(block);
  }
  const drop = document.getElementById(`sjd-${key}-${slot}`);
  if (drop) drop.style.display = 'none';
}

function toggleSchedFieldBtn(key, slot, field, value, el) {
  if (!schedData[key]) schedData[key]={};
  if (!schedData[key][slot]) schedData[key][slot]={type:'blank',fields:{}};
  if (!schedData[key][slot].fields) schedData[key][slot].fields={};
  const cur = schedData[key][slot].fields[field];
  schedData[key][slot].fields[field] = (cur === value) ? '' : value;
  saveSchedData();
  // Update button states in-place
  const row = el.closest('.sched-field');
  row.querySelectorAll('.sched-field-toggle').forEach(btn => {
    const isActive = btn.textContent.trim() === schedData[key][slot].fields[field];
    btn.classList.toggle('sched-field-toggle-on', isActive);
  });
}

// ═══════════════════════════════════════════════════════
// NIGHT SHIFT CONSECUTIVE SCHEDULER
// ═══════════════════════════════════════════════════════

function setBlockType(key, slot, typeId) {
  if (!schedData[key]) schedData[key] = {};
  if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };

  const current = schedData[key][slot].type;

  // If selecting night and not already night, show the consecutive picker
  if (typeId === 'night' && current !== 'night') {
    openNightShiftPicker(key, slot);
    return;
  }

  // If selecting day and not already day, show the consecutive day picker
  if (typeId === 'day' && current !== 'day') {
    openDayShiftPicker(key, slot);
    return;
  }

  // Toggle off if clicking same type (back to blank), or apply directly
  schedData[key][slot].type = current === typeId ? 'blank' : typeId;
  saveSchedData();
  renderSchedule();
}

function openNightShiftPicker(startKey, startSlot) {
  document.getElementById('nightPickerModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'nightPickerModal';
  overlay.className = 'night-picker-overlay';

  // Parse the start date from the key
  const [yr, mo, dy] = startKey.split('-').map(Number);
  const startDate = new Date(yr, mo - 1, dy);
  const dateLabel = startDate.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });

  overlay.innerHTML = `
    <div class="night-picker-box">
      <div class="night-picker-title">🌙 Night Shifts</div>
      <div class="night-picker-sub">Starting ${dateLabel} — how many consecutive nights?</div>
      <div class="night-scroll-wrap" id="nightScrollWrap">
        <div class="night-scroll-fade-top"></div>
        <div class="night-scroll-selector"></div>
        <div class="night-scroll-fade-bot"></div>
        <div class="night-scroll-inner" id="nightScrollInner"></div>
      </div>
      <div class="night-picker-actions">
        <button onclick="document.getElementById('nightPickerModal').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">
          Cancel
        </button>
        <button id="nightPickerConfirm"
          style="background:#1a0a4a;border:1px solid rgba(200,184,255,0.5);border-radius:var(--radius);padding:9px 18px;color:#c8b8ff;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:800;cursor:pointer;">
          🌙 Schedule Nights
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Build scroll list with padding items (1-10)
  const inner = document.getElementById('nightScrollInner');
  const ITEM_H = 50;
  const PADDING = 2; // blank items top & bottom for centering
  const values = [];
  for (let i = 0; i < PADDING; i++) values.push('');
  for (let i = 1; i <= 10; i++) values.push(i);
  for (let i = 0; i < PADDING; i++) values.push('');

  inner.innerHTML = values.map((v, i) => {
    const sel = v === 1 ? ' selected' : '';
    return `<div class="night-scroll-item${sel}" data-val="${v}" style="width:100%;">${v !== '' ? v + (v === 1 ? ' night' : ' nights') : ''}</div>`;
  }).join('');

  let selectedIdx = PADDING; // index 2 = value 1
  const wrap = document.getElementById('nightScrollWrap');

  function snapTo(idx) {
    idx = Math.max(PADDING, Math.min(PADDING + 9, idx));
    selectedIdx = idx;
    inner.style.transition = 'transform 0.18s cubic-bezier(.25,.8,.25,1)';
    inner.style.transform = `translateY(${(PADDING - idx) * ITEM_H + (ITEM_H / 2)}px)`;
    // Update selected class
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => {
      el.classList.toggle('selected', i === idx);
    });
    const val = values[idx];
    document.getElementById('nightPickerConfirm').textContent = `🌙 Schedule ${val} Night${val !== 1 ? 's' : ''}`;
  }

  // Initial position
  inner.style.transition = 'none';
  inner.style.transform = `translateY(${(PADDING - selectedIdx) * ITEM_H + (ITEM_H / 2)}px)`;

  // Mouse wheel
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    snapTo(selectedIdx + dir);
  }, { passive: false });

  // Touch / drag
  let dragStartY = 0, dragStartIdx = 0, isDragging = false;
  wrap.addEventListener('mousedown', e => { isDragging = true; dragStartY = e.clientY; dragStartIdx = selectedIdx; inner.style.transition = 'none'; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const delta = Math.round((dragStartY - e.clientY) / ITEM_H);
    const newIdx = Math.max(PADDING, Math.min(PADDING + 9, dragStartIdx + delta));
    inner.style.transform = `translateY(${(PADDING - newIdx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === newIdx));
    selectedIdx = newIdx;
  });
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; snapTo(selectedIdx); } });

  // Touch
  wrap.addEventListener('touchstart', e => { dragStartY = e.touches[0].clientY; dragStartIdx = selectedIdx; inner.style.transition = 'none'; }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const delta = Math.round((dragStartY - e.touches[0].clientY) / ITEM_H);
    const newIdx = Math.max(PADDING, Math.min(PADDING + 9, dragStartIdx + delta));
    inner.style.transform = `translateY(${(PADDING - newIdx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === newIdx));
    selectedIdx = newIdx;
  }, { passive: true });
  wrap.addEventListener('touchend', () => snapTo(selectedIdx));

  // Arrow key support — listen on the overlay so it works immediately when modal opens
  const keyHandler = e => {
    if (!document.getElementById('nightPickerModal')) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      snapTo(selectedIdx - 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      snapTo(selectedIdx + 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('nightPickerConfirm')?.click();
    } else if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);
  // Clean up if modal is removed externally
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', keyHandler));

  // Snap on first render
  requestAnimationFrame(() => snapTo(selectedIdx));

  // Confirm button
  document.getElementById('nightPickerConfirm').onclick = () => {
    const count = values[selectedIdx];
    if (!count || count < 1) return;
    applyConsecutiveNightShifts(startKey, startSlot, count);
    overlay.remove();
  };
}

function openVacationPicker(key, slot, saId) {
  document.getElementById('vacationPickerModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vacationPickerModal';
  overlay.className = 'night-picker-overlay';

  const [yr, mo, dy] = key.split('-').map(Number);
  const startDate = new Date(yr, mo - 1, dy);
  const dateLabel = startDate.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });

  // Build roster from employees array, sorted by name
  const empRoster = (typeof employees !== 'undefined' ? employees : [])
    .filter(e => e.name && e.status !== 'inactive')
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));

  overlay.innerHTML = `
    <div class="night-picker-box" style="max-width:460px;">
      <div class="night-picker-title">🏖 Person on Vacation</div>
      <div class="night-picker-sub">Starting ${dateLabel} — select a person and duration</div>
      <div style="margin:10px 0 6px;">
        <input id="vacPersonSearch" type="text" placeholder="Search employees…"
          style="width:100%;box-sizing:border-box;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);color:var(--white);font-family:'DM Sans',sans-serif;font-size:13px;padding:8px 10px;outline:none;"
          oninput="filterVacPersonBtns(this.value)" />
      </div>
      <div style="max-height:180px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:5px;padding:4px 0;" id="vacPersonBtns">
        ${empRoster.map(e => `<button class="vac-person-btn" data-name="${escHtml(e.name)}" onclick="selectVacPerson(this,'${e.name.replace(/'/g,"\\'")}')">
          ${escHtml(e.name)}
        </button>`).join('')}
        <button class="vac-person-btn" data-name="other" onclick="selectVacPerson(this,'Other')" style="opacity:0.6;">Other…</button>
      </div>
      <div id="vacOtherWrap" style="display:none;margin-bottom:10px;">
        <input id="vacOtherName" type="text" placeholder="Enter name…"
          style="width:100%;box-sizing:border-box;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);color:var(--white);font-family:'DM Sans',sans-serif;font-size:13px;padding:8px 10px;">
      </div>
      <div class="night-picker-sub" style="margin-top:10px;">How many days?</div>
      <div class="night-scroll-wrap" id="vacScrollWrap">
        <div class="night-scroll-fade-top"></div>
        <div class="night-scroll-selector"></div>
        <div class="night-scroll-fade-bot"></div>
        <div class="night-scroll-inner" id="vacScrollInner"></div>
      </div>
      <div class="night-picker-actions">
        <button onclick="document.getElementById('vacationPickerModal').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">
          Cancel
        </button>
        <button id="vacPickerConfirm"
          style="background:#4a0a2a;border:1px solid rgba(255,184,220,0.5);border-radius:var(--radius);padding:9px 18px;color:#ffb8dc;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:800;cursor:pointer;opacity:0.4;pointer-events:none;">
          🏖 Schedule Days
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Build scroll list (1-30 days)
  const inner = document.getElementById('vacScrollInner');
  const ITEM_H = 50;
  const PADDING = 2;
  const values = [];
  for (let i = 0; i < PADDING; i++) values.push('');
  for (let i = 1; i <= 30; i++) values.push(i);
  for (let i = 0; i < PADDING; i++) values.push('');

  inner.innerHTML = values.map((v) => {
    const sel = v === 1 ? ' selected' : '';
    return `<div class="night-scroll-item${sel}" data-val="${v}">${v !== '' ? v + (v === 1 ? ' day' : ' days') : ''}</div>`;
  }).join('');

  let selectedIdx = PADDING;
  const wrap = document.getElementById('vacScrollWrap');
  let selectedPerson = '';

  function updateConfirmBtn() {
    const btn = document.getElementById('vacPickerConfirm');
    if (!btn) return;
    const enabled = !!selectedPerson;
    btn.style.opacity = enabled ? '1' : '0.4';
    btn.style.pointerEvents = enabled ? 'auto' : 'none';
    if (enabled) btn.textContent = `🏖 Schedule ${values[selectedIdx]} Day${values[selectedIdx] !== 1 ? 's' : ''}`;
  }

  window.filterVacPersonBtns = function(q) {
    const lq = q.toLowerCase();
    document.querySelectorAll('#vacPersonBtns .vac-person-btn').forEach(b => {
      const n = (b.dataset.name || '').toLowerCase();
      b.style.display = (!lq || n.includes(lq)) ? '' : 'none';
    });
  };

  window.selectVacPerson = function(btn, name) {
    document.querySelectorAll('.vac-person-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const otherWrap = document.getElementById('vacOtherWrap');
    if (name === 'Other') {
      otherWrap.style.display = 'block';
      selectedPerson = '';
    } else {
      otherWrap.style.display = 'none';
      selectedPerson = name;
    }
    updateConfirmBtn();
  };
  document.getElementById('vacOtherName')?.addEventListener('input', function() {
    selectedPerson = this.value.trim();
    updateConfirmBtn();
  });

  function snapTo(idx) {
    idx = Math.max(PADDING, Math.min(PADDING + 29, idx));
    selectedIdx = idx;
    inner.style.transition = 'transform 0.18s cubic-bezier(.25,.8,.25,1)';
    inner.style.transform = `translateY(${(PADDING - idx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
    updateConfirmBtn();
  }

  inner.style.transition = 'none';
  inner.style.transform = `translateY(${(PADDING - selectedIdx) * ITEM_H + (ITEM_H / 2)}px)`;

  wrap.addEventListener('wheel', e => { e.preventDefault(); snapTo(selectedIdx + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });

  let dragStartY = 0, dragStartIdx = 0, isDragging = false;
  wrap.addEventListener('mousedown', e => { isDragging = true; dragStartY = e.clientY; dragStartIdx = selectedIdx; inner.style.transition = 'none'; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const delta = Math.round((dragStartY - e.clientY) / ITEM_H);
    const newIdx = Math.max(PADDING, Math.min(PADDING + 29, dragStartIdx + delta));
    inner.style.transform = `translateY(${(PADDING - newIdx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === newIdx));
    selectedIdx = newIdx;
  });
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; snapTo(selectedIdx); } });

  wrap.addEventListener('touchstart', e => { dragStartY = e.touches[0].clientY; dragStartIdx = selectedIdx; inner.style.transition = 'none'; }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const delta = Math.round((dragStartY - e.touches[0].clientY) / ITEM_H);
    const newIdx = Math.max(PADDING, Math.min(PADDING + 29, dragStartIdx + delta));
    inner.style.transform = `translateY(${(PADDING - newIdx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === newIdx));
    selectedIdx = newIdx;
  }, { passive: true });
  wrap.addEventListener('touchend', () => snapTo(selectedIdx));

  const keyHandler = e => {
    if (!document.getElementById('vacationPickerModal')) { document.removeEventListener('keydown', keyHandler); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); snapTo(selectedIdx - 1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); snapTo(selectedIdx + 1); }
    else if (e.key === 'Enter') { e.preventDefault(); document.getElementById('vacPickerConfirm')?.click(); }
    else if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
  };
  document.addEventListener('keydown', keyHandler);

  requestAnimationFrame(() => snapTo(selectedIdx));

  document.getElementById('vacPickerConfirm').onclick = () => {
    const person = selectedPerson || document.getElementById('vacOtherName')?.value.trim();
    const count = values[selectedIdx];
    if (!person || !count || count < 1) return;
    applyVacationDays(key, slot, saId, person, count);
    overlay.remove();
  };
}

function applyVacationDays(startKey, slot, saId, personName, numDays) {
  const [yr, mo, dy] = startKey.split('-').map(Number);
  const cursor = new Date(yr, mo - 1, dy);

  for (let i = 0; i < numDays; i++) {
    const key = dk(cursor);
    if (!schedData[key]) schedData[key] = {};
    const bdata = getSlotData(key, slot);
    if (!bdata.fields) bdata.fields = {};
    const current = bdata.fields._specialActions || [];
    if (!current.includes(saId)) {
      bdata.fields._specialActions = [...current, saId];
    }
    bdata.fields._vacationPerson = personName;
    if (slot === 'top' || slot === 'bottom') {
      schedData[key][slot] = bdata;
    } else {
      const idx = parseInt(slot.replace('extra_',''));
      if (schedData[key]?.extras?.[idx]) schedData[key].extras[idx].data = bdata;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  saveSchedDataDirect();
  renderSchedule();
  pushNotif('success', '🏖 Vacation Scheduled', `${personName} — ${numDays} day${numDays !== 1 ? 's' : ''} starting ${startKey}.`, null);
}

function applyConsecutiveNightShifts(startKey, startSlot, count) {
  // Get the source block's fields to copy to all consecutive nights
  const srcData = getBlockData(startKey, startSlot);
  const fieldsToApply = JSON.parse(JSON.stringify(srcData.fields || {}));

  // Build list of consecutive calendar dates starting from startKey
  const [yr, mo, dy] = startKey.split('-').map(Number);
  const cursor = new Date(yr, mo - 1, dy);

  for (let i = 0; i < count; i++) {
    const key = dk(cursor);

    // Apply to the 'top' slot of each day (primary crew block)
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][startSlot]) schedData[key][startSlot] = { type:'blank', fields:{} };
    schedData[key][startSlot] = {
      type: 'night',
      fields: JSON.parse(JSON.stringify(fieldsToApply))
    };

    // Move to next calendar day
    cursor.setDate(cursor.getDate() + 1);
  }

  // Mark the day after the last night shift as "rest day" — slot-specific so only
  // the foreman who worked nights is blocked, not the other foreman's row.
  const afterKey = dk(cursor); // cursor is already 1 day past the last night
  if (!schedData[afterKey]) schedData[afterKey] = {};
  const slotAfter = (schedData[afterKey] || {})[startSlot];
  const alreadyHasWork = slotAfter && slotAfter.type && slotAfter.type !== 'blank';
  if (!alreadyHasWork) {
    if (!schedData[afterKey][startSlot]) schedData[afterKey][startSlot] = { type:'blank', fields:{} };
    schedData[afterKey][startSlot].afterNightShift = true;
  }

  saveSchedData();
  renderSchedule();
  pushNotif('success', '🌙 Night Shifts Scheduled',
    `${count} consecutive night shift${count !== 1 ? 's' : ''} applied starting ${startKey}.`, null);
}

function openDayShiftPicker(startKey, startSlot) {
  document.getElementById('dayPickerModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'dayPickerModal';
  overlay.className = 'night-picker-overlay';

  const [yr, mo, dy] = startKey.split('-').map(Number);
  const startDate = new Date(yr, mo - 1, dy);
  const dateLabel = startDate.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });

  overlay.innerHTML = `
    <div class="night-picker-box">
      <div class="night-picker-title">☀️ Day Shifts</div>
      <div class="night-picker-sub">Starting ${dateLabel} — how many consecutive days?</div>
      <div class="night-scroll-wrap" id="dayScrollWrap">
        <div class="night-scroll-fade-top"></div>
        <div class="night-scroll-selector"></div>
        <div class="night-scroll-fade-bot"></div>
        <div class="night-scroll-inner" id="dayScrollInner"></div>
      </div>
      <div class="night-picker-actions">
        <button onclick="document.getElementById('dayPickerModal').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">
          Cancel
        </button>
        <button id="dayPickerConfirm"
          style="background:#1a3000;border:1px solid rgba(134,239,172,0.5);border-radius:var(--radius);padding:9px 18px;color:#86efac;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:800;cursor:pointer;">
          ☀️ Schedule Days
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const inner = document.getElementById('dayScrollInner');
  const ITEM_H = 50;
  const PADDING = 2;
  const values = [];
  for (let i = 0; i < PADDING; i++) values.push('');
  for (let i = 1; i <= 30; i++) values.push(i);
  for (let i = 0; i < PADDING; i++) values.push('');

  inner.innerHTML = values.map((v, i) => {
    const sel = v === 1 ? ' selected' : '';
    return `<div class="night-scroll-item${sel}" data-val="${v}" style="width:100%;">${v !== '' ? v + (v === 1 ? ' day' : ' days') : ''}</div>`;
  }).join('');

  let selectedIdx = PADDING;
  const wrap = document.getElementById('dayScrollWrap');

  function snapTo(idx) {
    idx = Math.max(PADDING, Math.min(PADDING + 29, idx));
    selectedIdx = idx;
    inner.style.transition = 'transform 0.18s cubic-bezier(.25,.8,.25,1)';
    inner.style.transform = `translateY(${(PADDING - idx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => {
      el.classList.toggle('selected', i === idx);
    });
    const val = values[idx];
    document.getElementById('dayPickerConfirm').textContent = `☀️ Schedule ${val} Day${val !== 1 ? 's' : ''}`;
  }

  inner.style.transition = 'none';
  inner.style.transform = `translateY(${(PADDING - selectedIdx) * ITEM_H + (ITEM_H / 2)}px)`;

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    snapTo(selectedIdx + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  let dragStartY = 0, dragStartIdx = 0, isDragging = false;
  wrap.addEventListener('mousedown', e => { isDragging = true; dragStartY = e.clientY; dragStartIdx = selectedIdx; inner.style.transition = 'none'; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const delta = Math.round((dragStartY - e.clientY) / ITEM_H);
    const newIdx = Math.max(PADDING, Math.min(PADDING + 29, dragStartIdx + delta));
    inner.style.transform = `translateY(${(PADDING - newIdx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === newIdx));
    selectedIdx = newIdx;
  });
  window.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; snapTo(selectedIdx); } });

  wrap.addEventListener('touchstart', e => { dragStartY = e.touches[0].clientY; dragStartIdx = selectedIdx; inner.style.transition = 'none'; }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const delta = Math.round((dragStartY - e.touches[0].clientY) / ITEM_H);
    const newIdx = Math.max(PADDING, Math.min(PADDING + 29, dragStartIdx + delta));
    inner.style.transform = `translateY(${(PADDING - newIdx) * ITEM_H + (ITEM_H / 2)}px)`;
    inner.querySelectorAll('.night-scroll-item').forEach((el, i) => el.classList.toggle('selected', i === newIdx));
    selectedIdx = newIdx;
  }, { passive: true });
  wrap.addEventListener('touchend', () => snapTo(selectedIdx));

  const keyHandler = e => {
    if (!document.getElementById('dayPickerModal')) { document.removeEventListener('keydown', keyHandler); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); snapTo(selectedIdx - 1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); snapTo(selectedIdx + 1); }
    else if (e.key === 'Enter') { e.preventDefault(); document.getElementById('dayPickerConfirm')?.click(); }
    else if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); }
  };
  document.addEventListener('keydown', keyHandler);
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', keyHandler));

  requestAnimationFrame(() => snapTo(selectedIdx));

  document.getElementById('dayPickerConfirm').onclick = () => {
    const count = values[selectedIdx];
    if (!count || count < 1) return;
    applyConsecutiveDayShifts(startKey, startSlot, count);
    overlay.remove();
  };
}

function applyConsecutiveDayShifts(startKey, startSlot, count) {
  const srcData = getBlockData(startKey, startSlot);
  const fieldsToApply = JSON.parse(JSON.stringify(srcData.fields || {}));

  const [yr, mo, dy] = startKey.split('-').map(Number);
  const cursor = new Date(yr, mo - 1, dy);

  for (let i = 0; i < count; i++) {
    const key = dk(cursor);
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][startSlot]) schedData[key][startSlot] = { type:'blank', fields:{} };
    schedData[key][startSlot] = {
      type: 'day',
      fields: JSON.parse(JSON.stringify(fieldsToApply))
    };
    cursor.setDate(cursor.getDate() + 1);
  }

  saveSchedData();
  renderSchedule();
  pushNotif('success', '☀️ Day Shifts Scheduled',
    `${count} consecutive day shift${count !== 1 ? 's' : ''} applied starting ${startKey}.`, null);
}

function addBlockToQueue(key, slot) {
  const blockData = getBlockData(key, slot);
  if (blockData.type === 'blank') return;
  const jobName = blockData.fields?.jobName || '';
  const jobNum  = blockData.fields?.jobNum  || '';
  schedQueue.push({ id: Date.now().toString(), addedAt: Date.now(), jobName, jobNum, blockData });
  saveSchedQueue();
  clearBlockData(key, slot);
  saveSchedData();
  renderSchedule();
  renderQueueList();
  pushNotif('success', '→ Sent to Queue', jobName || jobNum || 'Job card added to queue.', null);
}

function clearAfterNightFlag(key, slot) {
  const s = slot || 'top';
  if (schedData[key]?.[s]) {
    delete schedData[key][s].afterNightShift;
    saveSchedData();
    renderSchedule();
  }
}

function cycleBlockType(key, slot) {
  const cur = ((schedData[key]||{})[slot]||{}).type || 'blank';
  const idx = blockTypes.findIndex(t=>t.id===cur);
  setBlockType(key, slot, blockTypes[(idx+1)%blockTypes.length].id);
}

// ── Schedule Settings Modal ──

function setBlockTypeColorDirect(typeId, color, mode) {
  const t = blockTypes.find(t=>t.id===typeId);
  if (!t) return;
  if (mode === 'font') t.fontColor = color;
  else t.color = color;
  saveBlockTypes();
  renderSchedule();
  const _spv1 = document.getElementById('settingsPageView');
  if (_spv1 && _spv1.style.display !== 'none') renderSettingsScheduleColors();
}

function setBlockTypeColor(typeId, color, el, mode) {
  const t = blockTypes.find(t=>t.id===typeId);
  if (!t) return;
  if (mode === 'font') { t.fontColor = color; } else { t.color = color; }
  saveBlockTypes();
  renderSchedule();
  const _spv2 = document.getElementById('settingsPageView');
  if (_spv2 && _spv2.style.display !== 'none') renderSettingsScheduleColors();
}

function resetBlockTypes() {
  blockTypes = JSON.parse(JSON.stringify(DEFAULT_BLOCK_TYPES));
  saveBlockTypes();
  renderSchedule();
  const _spv3 = document.getElementById('settingsPageView');
  if (_spv3 && _spv3.style.display !== 'none') renderSettingsScheduleColors();
}

function removeFromRoster(type, name, btn) {
  if (type === 'operators') {
    operatorsList = operatorsList.filter(o => o !== name);
    saveOperatorsList();
  } else if (type === 'material') {
    materialList = materialList.filter(e => e !== name);
    saveMaterialList();
  } else if (type === 'plants') {
    // name is "Supplier — Location" — use the new supplier model
    const parts = name.split('—').map(s => s.trim());
    const supName = parts[0];
    const loc = parts.slice(1).join('—').trim();
    const sup = suppliersList.find(s => s.name.toLowerCase() === supName.toLowerCase());
    if (sup && loc) {
      sup.plants = sup.plants.filter(p => p !== loc);
      if (!sup.plants.length) suppliersList = suppliersList.filter(s => s !== sup);
    } else if (sup) {
      suppliersList = suppliersList.filter(s => s !== sup);
    }
    saveSuppliersList();
  } else {
    equipmentList = equipmentList.filter(e => e !== name);
    delete equipmentCategoryMap[name];
    saveEquipmentList();
  }
  btn.closest('span').remove();
}

function addToRoster(type) {
  const inputId = type === 'operators' ? 'settingsNewOp' : type === 'material' ? 'settingsNewMat' : type === 'plants' ? 'settingsNewPlant' : 'settingsNewEquip';
  const listId  = type === 'operators' ? 'settingsOpList' : type === 'material' ? 'settingsMatList' : type === 'plants' ? 'settingsPlantList' : 'settingsEquipList';
  const input = document.getElementById(inputId);
  const name = input?.value.trim();
  if (!name) return;
  const pool = type === 'operators' ? operatorsList : type === 'material' ? materialList : type === 'plants' ? plantsList : equipmentList;
  if (!pool.includes(name)) {
    pool.push(name);
    type === 'operators' ? saveOperatorsList() : type === 'material' ? saveMaterialList() : type === 'plants' ? savePlantsList() : saveEquipmentList();
    const listEl = document.getElementById(listId);
    if (listEl) {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:12px;padding:3px 10px;font-size:12px;color:var(--concrete);';
      chip.innerHTML = `${name} <button style="background:none;border:none;cursor:pointer;color:var(--concrete-dim);font-size:12px;padding:0;line-height:1;" onclick="removeFromRoster('${type}','${name.replace(/'/g,"\\'")}',this)" title="Remove">✕</button>`;
      listEl.appendChild(chip);
    }
  }
  if (input) input.value = '';
  input?.focus();
}

// Old functions kept for compatibility
function openScheduleEntryModal(dk,slot) {}
function closeScheduleEntryModal() {}
function saveScheduleEntry() {}
function selectScheduleColor() {}
function deleteScheduleEntry() {}
function scheduleDragStart() {}
function scheduleDragEnd() {}
// ── Block drag & drop — grab foreman header, drop onto No Work blocks ──
// ═══════════════════════════════════════════════════════
// SCHEDULE QUEUE
// ═══════════════════════════════════════════════════════
const SCHED_QUEUE_KEY = 'pavescope_sched_queue';
// Queue item shape: { id, addedAt, jobName, jobNum, blockData }
// blockData = full serialized block (type + fields) so nothing is lost
var schedQueue = (function(){ try { const p = JSON.parse(localStorage.getItem(SCHED_QUEUE_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();
function saveSchedQueue() { localStorage.setItem(SCHED_QUEUE_KEY, JSON.stringify(schedQueue)); _checkLocalStorageSize(); try { if(db) fbSet('sched_queue', schedQueue); } catch(e){} }

// ── Equipment Movement Log ─────────────────────────────────────────────────────
// Logs every piece of equipment involved in a lowbed move.
// Updated by: _lbVerifySend (on plan verification), Heimdall claimMove/completeMove.
const EQ_MOVE_LOG_KEY = 'dmc_eq_movement_log';
function _eqMoveLogLoad() { try { return JSON.parse(localStorage.getItem(EQ_MOVE_LOG_KEY)||'[]'); } catch(e){ return []; } }
function _eqMoveLogSave(entries) {
  localStorage.setItem(EQ_MOVE_LOG_KEY, JSON.stringify(entries));
  _checkLocalStorageSize();
  try { if(typeof fbSet==='function') fbSet('eq_move_log', entries); } catch(e){}
}

// Called in _lbVerifySend after plan is verified — creates one log entry per equipment per move.
function _eqLogAddMoveEntries(plan) {
  const entries = [];
  const planVerifiedAt = plan.verifiedAt || Date.now();
  (plan.jobs||[]).forEach(job => {
    (job.moves||[]).forEach((mv, mi) => {
      (mv.equipment||[]).forEach(eq => {
        entries.push({
          id: 'eml_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6),
          loggedAt: Date.now(),
          planVerifiedAt,
          date: job.date || '',
          jobName: job.jobName || '',
          jobNum: job.jobNum || '',
          jobLocation: job.location || '',
          equipmentName: eq.name || '',
          equipmentType: eq.type || 'other',
          driver: mv.assignedDriver || null,
          moveIndex: mi,
          moveNotes: mv.notes || '',
          status: mv.assignedDriver ? 'assigned' : 'unassigned',
          assignedAt: planVerifiedAt,
          claimedAt: mv.assignedDriver ? planVerifiedAt : null,
          completedAt: null,
          durationMinutes: null,
          gpsDeviceId: null,
          lastReportTime: null,
          lastKnownLat: null,
          lastKnownLng: null,
          lastKnownSpeedMph: null,
        });
      });
    });
  });
  if (!entries.length) return;
  // Replace any previous entries from the same plan to avoid duplicates on re-verify
  let log = _eqMoveLogLoad().filter(e => e.planVerifiedAt !== planVerifiedAt);
  log = [...entries, ...log];
  if (log.length > 3000) log = log.slice(0, 3000);
  _eqMoveLogSave(log);
}

function queueDaysAgo(addedAt) {
  const ms = Date.now() - addedAt;
  const d = Math.floor(ms / 86400000);
  return d === 0 ? 'today' : d === 1 ? '1 day' : d + ' days';
}

function longestQueueItem() {
  if (!schedQueue.length) return null;
  return schedQueue.reduce((oldest, item) => item.addedAt < oldest.addedAt ? item : oldest, schedQueue[0]);
}

// ── Build one queue card HTML — horizontal strip design ──────────────────────
function _buildQueueMiniCard(item) {
  const btype = (typeof getBlockType === 'function' && item.blockData?.type)
    ? getBlockType(item.blockData.type)
    : { color: '#7ecb8f' };
  const color    = btype.color || '#7ecb8f';
  const fullName = item.jobName || '';
  const hasEm    = fullName.includes(' \u2014 ');
  const gcName   = hasEm ? escHtml(fullName.split(' \u2014 ')[0]) : '';
  const projName = hasEm ? escHtml(fullName.split(' \u2014 ').slice(1).join(' \u2014 ')) : escHtml(fullName);
  const jobNum   = escHtml(item.jobNum || '');
  const dateStr  = item.addedAt ? new Date(item.addedAt).toLocaleDateString('en-US',{month:'numeric',day:'numeric'}) : '';
  const displayName = projName || gcName || jobNum || '—';
  return `<div class="qmc-wrap" draggable="true"
      ondragstart="queueCardDragStart(event,'${item.id}')"
      ondragend="queueCardDragEnd(event)"
      onmouseenter="showQueueMiniTooltip(event,'${item.id}')"
      onmouseleave="hideQueueMiniTooltip()"
      style="border-left-color:${color};">
    <button class="qmc-del" onclick="event.stopPropagation();removeFromQueue('${item.id}')" title="Remove">✕</button>
    <div class="qmc-jobname">${displayName}</div>
    ${jobNum ? `<div class="qmc-jobnum">#${jobNum}</div>` : ''}
    ${gcName ? `<div class="qmc-gc">${gcName}</div>` : ''}
    <div class="qmc-date">${dateStr}</div>
  </div>`;
}

function renderQueueList() {
  updateCollNavQueueBadge();
  const strip = document.getElementById('schedQueueStrip');
  const badge = document.getElementById('queueCountBadge');
  if (badge) {
    if (schedQueue.length > 0) { badge.style.display = ''; badge.textContent = schedQueue.length + ' job' + (schedQueue.length !== 1 ? 's' : ''); }
    else { badge.style.display = 'none'; }
  }
  const sorted = [...(schedQueue || [])].sort((a,b) => a.addedAt - b.addedAt);
  if (strip) {
    if (sorted.length) {
      strip.innerHTML = sorted.map(_buildQueueMiniCard).join('');
    } else {
      strip.innerHTML = '<span class="sched-queue-empty-text">Drop jobs here to queue</span>';
    }
  }
}

function removeFromQueue(id) {
  schedQueue = schedQueue.filter(i => i.id !== id);
  saveSchedQueue();
  renderQueueList();
}

// ── Queue mini-card tooltip ───────────────────────────────────────────────────
var _qmcTooltipEl = null;
var _qmcTooltipHide = null;

function showQueueMiniTooltip(e, itemId) {
  clearTimeout(_qmcTooltipHide);
  const item = (schedQueue || []).find(i => i.id === itemId);
  if (!item) return;
  const btype = (typeof getBlockType === 'function' && item.blockData?.type)
    ? getBlockType(item.blockData.type) : { color:'#888', label: item.blockData?.type || '?' };
  const fields = item.blockData?.fields || {};

  // Build field rows — skip blank/trucking-json fields for readability
  const fieldRows = BLOCK_FIELDS
    .filter(f => {
      const v = fields[f.key];
      if (!v) return false;
      if (f.key === 'material' || f.key === 'equipment' || f.key === 'operators') {
        try { const arr = JSON.parse(v); return arr && arr.length; } catch(e2) { return !!v; }
      }
      return true;
    })
    .map(f => {
      let val = fields[f.key];
      if (f.key === 'material') {
        try { val = JSON.parse(val).map(m => m.name||m).join(', '); } catch(e2) {}
      } else if (f.key === 'equipment' || f.key === 'operators') {
        try { val = JSON.parse(val).join(', '); } catch(e2) {}
      } else if (f.key === 'trucking') {
        try { const td = JSON.parse(val); val = Object.entries(td).filter(([,v2])=>v2).map(([k,v2])=>`${k}: ${v2}`).join(', '); } catch(e2) {}
      }
      if (!val) return '';
      return `<div class="qmc-tooltip-row"><span class="qmc-tooltip-label">${escHtml(f.label.replace(':',''))}</span><span class="qmc-tooltip-val">${escHtml(String(val))}</span></div>`;
    }).join('');

  const typeLabel = btype.label || item.blockData?.type || '—';
  const color = btype.color || '#888';

  if (!_qmcTooltipEl) {
    _qmcTooltipEl = document.createElement('div');
    _qmcTooltipEl.className = 'qmc-tooltip';
    document.body.appendChild(_qmcTooltipEl);
  }
  _qmcTooltipEl.innerHTML = `
    <div class="qmc-tooltip-title" style="color:${color};">${typeLabel.toUpperCase()}</div>
    ${fieldRows || '<div style="color:var(--concrete-dim);font-size:11px;">No field data recorded.</div>'}
    <div style="margin-top:6px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">In queue: ${queueDaysAgo(item.addedAt)}</div>`;

  // Position tooltip above/below the card
  const rect = e.currentTarget.getBoundingClientRect();
  const tooltipW = 220;
  let left = rect.left;
  let top  = rect.bottom + 6;
  if (left + tooltipW > window.innerWidth - 8) left = window.innerWidth - tooltipW - 8;
  if (top + 200 > window.innerHeight) top = rect.top - 210;
  _qmcTooltipEl.style.cssText = `position:fixed;left:${left}px;top:${top}px;min-width:${tooltipW}px;display:block;`;
  _qmcTooltipEl.className = 'qmc-tooltip';
}

function hideQueueMiniTooltip() {
  clearTimeout(_qmcTooltipHide);
  _qmcTooltipHide = setTimeout(() => {
    if (_qmcTooltipEl) _qmcTooltipEl.style.display = 'none';
  }, 50);
}

// Global safety net: hide any lingering tooltip when mouse is not over a triggering element
document.addEventListener('mousemove', function(e) {
  if (_qmcTooltipEl && _qmcTooltipEl.style.display !== 'none') {
    if (!e.target.closest('.qmc-wrap')) hideQueueMiniTooltip();
  }
  if (_hwSchedTipEl && _hwSchedTipEl.style.display !== 'none') {
    if (!e.target.closest('.hw-sched-block')) hwSchedTipHide();
  }
}, { passive: true });

// ── Drag FROM schedule TO queue ──────────────────────────────────────────────
function queueDragOver(e) {
  console.log('[Drag] dragover on queue zone');
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.getElementById('queueDropZone')?.classList.add('drag-over');
}

function queueDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.getElementById('queueDropZone')?.classList.remove('drag-over');
  }
}

function queueDrop(e) {
  console.log('[Drag] drop on queue zone, src:', schedBlockDragSrc);
  e.preventDefault();
  document.getElementById('queueDropZone')?.classList.remove('drag-over');
  if (!schedBlockDragSrc) return;
  const { key, slot } = schedBlockDragSrc;
  schedBlockDragSrc = null;
  const blockData = getBlockData(key, slot);
  if (blockData.type === 'blank') return; // nothing to queue
  const jobName = blockData.fields?.jobName || '';
  const jobNum  = blockData.fields?.jobNum  || '';
  // Add to queue
  schedQueue.push({ id: Date.now().toString(), addedAt: Date.now(), jobName, jobNum, blockData });
  saveSchedQueue();
  // Clear the block from schedule
  clearBlockData(key, slot);
  saveSchedData();
  renderSchedule(); // also calls renderQueueList via schedScrollOuter re-render
  renderQueueList();
}

// ── Drag FROM queue TO schedule ──────────────────────────────────────────────
var queueDragItemId = null;

function queueCardDragStart(e, itemId) {
  queueDragItemId = itemId;
  e.dataTransfer.effectAllowed = 'move';
  const card = document.getElementById('qc-' + itemId);
  if (card) setTimeout(() => card.classList.add('dragging'), 0);
  // Ensure schedule blocks accept this drag
  schedBlockDragSrc = null; // prevent schedule→schedule logic from firing
}

function queueCardDragEnd(e) {
  if (queueDragItemId) {
    const card = document.getElementById('qc-' + queueDragItemId);
    if (card) card.classList.remove('dragging');
  }
  queueDragItemId = null;
  document.querySelectorAll('.sched-block').forEach(b => b.classList.remove('drop-ready','drop-reject'));
}

// Override schedBlockDragOver/Drop to also accept queue cards
const _origSchedDragOver = schedBlockDragOver;
schedBlockDragOver = function(e, toKey, toSlot, toType) {
  if (queueDragItemId) {
    if (toType === 'blank') {
      e.preventDefault();
      e.currentTarget.classList.add('drop-ready');
      e.currentTarget.classList.remove('drop-reject');
    } else {
      e.currentTarget.classList.add('drop-reject');
      e.currentTarget.classList.remove('drop-ready');
    }
    return;
  }
  _origSchedDragOver(e, toKey, toSlot, toType);
};

const _origSchedDrop = schedBlockDrop;
schedBlockDrop = function(e, toKey, toSlot, toType) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-ready','drop-reject');
  if (queueDragItemId) {
    if (toType !== 'blank') { queueDragItemId = null; return; }
    const item = schedQueue.find(i => i.id === queueDragItemId);
    queueDragItemId = null;
    if (!item) return;
    setBlockData(toKey, toSlot, item.blockData);
    schedQueue = schedQueue.filter(i => i.id !== item.id);
    saveSchedQueue();
    saveSchedData();
    renderSchedule();
    renderQueueList();
    return;
  }
  _origSchedDrop(e, toKey, toSlot, toType);
};

// ── Watch for block clearings that might warrant a queue suggestion ────────────
// Hook into clearBlockData — if a non-blank block is cleared AND queue has items, prompt
const _origClearBlockData = clearBlockData;
clearBlockData = function(key, slot) {
  const existing = getBlockData(key, slot);
  const hadWork = existing.type && existing.type !== 'blank';
  _origClearBlockData(key, slot);
  // Only prompt if cleared from user action (not from queue drop itself) and queue has items
  if (hadWork && schedQueue.length >= 2 && !_suppressQueuePrompt) {
    const oldest = longestQueueItem();
    if (oldest) {
      setTimeout(() => showQueueSuggestion(oldest, key, slot), 150);
    }
  }
};
var _suppressQueuePrompt = false;

function showQueueSuggestion(queueItem, targetKey, targetSlot) {
  document.getElementById('queueSuggestModal')?.remove();
  const days = queueDaysAgo(queueItem.addedAt);
  const modal = document.createElement('div');
  modal.id = 'queueSuggestModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9500;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1.5px;color:var(--stripe);margin-bottom:6px;">Slot Opened</div>
      <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:var(--white);margin-bottom:16px;line-height:1.5;">
        A job was removed from the schedule.<br>
        The longest-waiting job in your queue is:
      </div>
      <div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:12px 14px;margin-bottom:20px;">
        <div style="font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;color:var(--white);">${queueItem.jobName||'(unnamed)'}</div>
        ${queueItem.jobNum ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--stripe);">#${queueItem.jobNum}</div>` : ''}
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);margin-top:4px;">⏱ In queue: ${days}</div>
      </div>
      <div style="font-family:'DM Sans',sans-serif;font-size:13px;color:var(--concrete-dim);margin-bottom:20px;">Would you like to place this job into the slot that just opened?</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('queueSuggestModal').remove();"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">
          Not Now
        </button>
        <button onclick="placeQueueJobInSlot('${queueItem.id}','${targetKey}','${targetSlot}')"
          style="background:var(--stripe);border:none;border-radius:var(--radius);padding:9px 18px;color:#000;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">
          ✓ Yes, Place It
        </button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function placeQueueJobInSlot(itemId, key, slot) {
  document.getElementById('queueSuggestModal')?.remove();
  const item = schedQueue.find(i => i.id === itemId);
  if (!item) return;
  _suppressQueuePrompt = true;
  setBlockData(key, slot, item.blockData);
  schedQueue = schedQueue.filter(i => i.id !== item.id);
  _suppressQueuePrompt = false;
  saveSchedQueue();
  saveSchedData();
  renderSchedule();
  renderQueueList();
}


// ── Date-key arithmetic ───────────────────────────────────────────────
function addDaysToKey(key, n) {
  const [y,m,d] = key.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + n);
  return dk(dt);
}
function diffKeys(keyA, keyB) {
  // returns keyB - keyA in calendar days
  const [y1,m1,d1] = keyA.split('-').map(Number);
  const [y2,m2,d2] = keyB.split('-').map(Number);
  return Math.round((new Date(y2,m2-1,d2) - new Date(y1,m1-1,d1)) / 86400000);
}

// ── Detect a consecutive run starting at key/slot ─────────────────────
// A "run" is same jobNum on consecutive calendar days in the same relative slot.
// Returns array of {key, slot} objects ordered chronologically.
function detectRun(startKey, startSlot) {
  const startData = getBlockData(startKey, startSlot);
  const jobNum = startData.fields?.jobNum?.trim();
  if (!jobNum) return [{ key: startKey, slot: startSlot }];

  // Walk backward to find the true start of the run
  let runStart = startKey;
  while (true) {
    const prev = addDaysToKey(runStart, -1);
    const prevData = getBlockData(prev, startSlot);
    if ((prevData.fields?.jobNum?.trim() || '') === jobNum) {
      runStart = prev;
    } else break;
  }

  // Walk forward to collect the full run
  const run = [];
  let cur = runStart;
  while (true) {
    const d = getBlockData(cur, startSlot);
    if ((d.fields?.jobNum?.trim() || '') === jobNum) {
      run.push({ key: cur, slot: startSlot });
      cur = addDaysToKey(cur, 1);
    } else break;
  }
  return run;
}

// ── Collect contacts from a block (comma-sep contact field) ───────────

function fmtScheduleDate(key) {
  if (!key) return key;
  const parts = key.split('-');
  if (parts.length !== 3) return key;
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}
function getBlockContacts(key, slot) {
  const f = getBlockData(key, slot).fields || {};
  const raw = (f.contact || '').trim();
  return raw ? raw.split(',').map(c => c.trim()).filter(Boolean) : [];
}
function getBlockJobName(key, slot) {
  return (getBlockData(key, slot).fields?.jobName || '').trim() || key;
}

// ── Create ghost drag image showing stacked cards ─────────────────────
function createDragGhost(run) {
  const ghost = document.createElement('div');
  ghost.style.cssText = `
    position:fixed;top:-9999px;left:-9999px;
    display:flex;flex-direction:column;gap:4px;
    background:var(--asphalt-mid);border:2px solid var(--stripe);
    border-radius:8px;padding:10px 14px;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
    font-family:'DM Sans',sans-serif;font-size:11px;color:var(--white);
    min-width:180px;max-width:240px;opacity:0.95;z-index:9999;pointer-events:none;`;

  // Header — moving badge
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-family:"DM Mono",monospace;font-size:8px;letter-spacing:1.2px;text-transform:uppercase;color:var(--stripe);margin-bottom:2px;';
  hdr.textContent = run.length > 1 ? `↕ ${run.length} SHIFTS — MOVING AS UNIT` : '↕ MOVING JOB';
  ghost.appendChild(hdr);

  run.forEach((item, i) => {
    const d = getBlockData(item.key, item.slot);
    const jobNum  = d.fields?.jobNum  || d.fields?.number || '';
    const jobName = d.fields?.jobName || d.fields?.name   || '—';

    // Parse date key (YYYY-MM-DD) into human readable
    const parts = item.key.split('-');
    const dateLabel = parts.length === 3
      ? new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]))
          .toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
      : item.key;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:1px;padding:4px 6px;background:rgba(255,255,255,0.06);border-radius:4px;border-left:2px solid var(--stripe);';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--concrete-dim);">${dateLabel}</span>
        ${jobNum ? `<span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:var(--stripe);">#${jobNum}</span>` : ''}
      </div>
      <span style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(jobName)}</span>`;
    ghost.appendChild(row);
  });

  document.body.appendChild(ghost);
  return ghost;
}

// ════════════════════════════════════════════════════════════════════════
// Cascading slide-back: find all blocks that must shift and by how many days
// Stop when we find a gap large enough to absorb the overflow.
// Returns array of moves: [{fromKey, slot, toKey}] or null if no slide needed.
// ════════════════════════════════════════════════════════════════════════
function computeSlideBack(destKey, runLen, slot) {
  // Count consecutive occupied slots starting at destKey
  let occupiedEnd = null;
  let gapStart = null;
  let scanKey = destKey;
  let openCount = 0;
  let displaced = [];

  // Walk forward from destKey: find the first gap of runLen consecutive empty slots
  // Mark everything before that gap as needing to be displaced by (runLen - openCount) days
  // We give up after 60 days to prevent infinite loops
  for (let i = 0; i < 60; i++) {
    const d = getBlockData(scanKey, slot);
    const isEmpty = d.type === 'blank' && !Object.values(d.fields||{}).some(v => v?.trim());
    if (isEmpty) {
      openCount++;
      if (openCount >= runLen) {
        // Found enough space — everything between destKey and here that was occupied needs to shift
        // by however many we needed
        break;
      }
    } else {
      // Occupied — will be displaced
      displaced.push(scanKey);
      openCount = 0;
    }
    scanKey = addDaysToKey(scanKey, 1);
  }

  if (!displaced.length) return null; // No conflict

  // How many extra days do we need?
  const shiftBy = runLen - (openCount < runLen ? openCount : runLen);
  if (shiftBy <= 0) return null;

  // Build a list of moves: each occupied day between destKey and gapStart shifts back by shiftBy
  // We need to move them in reverse order (furthest first) to avoid overwriting
  const moves = [];
  // Collect all occupied slots from destKey forward until we find a big enough gap
  let k2 = destKey;
  let consecutiveEmpty = 0;
  const toMove = [];
  for (let i = 0; i < 90; i++) {
    const d = getBlockData(k2, slot);
    const isEmpty = d.type === 'blank' && !Object.values(d.fields||{}).some(v => v?.trim());
    if (isEmpty) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= runLen) break; // big enough natural gap
    } else {
      consecutiveEmpty = 0;
      toMove.push(k2);
    }
    k2 = addDaysToKey(k2, 1);
  }

  // Sort in reverse so we don't overwrite earlier blocks
  toMove.sort((a,b) => diffKeys(a,b)).reverse();
  toMove.forEach(fromKey => {
    moves.push({ fromKey, slot, toKey: addDaysToKey(fromKey, runLen) });
  });
  return moves.length ? { moves, shiftBy: runLen } : null;
}

// ── Apply slide-back moves and fire notifications ──────────────────────
function applySlideBack(moves, onDone) {
  if (!moves || !moves.length) { onDone?.(); return; }
  // Apply in reverse-date order (already sorted in computeSlideBack)
  moves.forEach(({ fromKey, slot, toKey }) => {
    const data = getBlockData(fromKey, slot);
    setBlockData(toKey, slot, data);
    clearBlockData(fromKey, slot);
  });

  // ── Contact + admin notifications for every displaced block ─────────────
  if (isAdmin()) {
    let totalContacts = 0;
    moves.forEach(({ fromKey, toKey, slot }) => {
      const jobName  = getBlockJobName(toKey, slot);
      const contacts = getBlockContacts(toKey, slot);
      const daysShifted = diffKeys(fromKey, toKey); // positive = pushed forward
      const origDate = fmtScheduleDate(fromKey);
      const newDate  = fmtScheduleDate(toKey);
      totalContacts += contacts.length;

      if (contacts.length) {
        contacts.forEach(c => {
          pushNotif('info',
            '📅 Schedule Change — ' + escHtml(jobName),
            `<strong>Contact to notify:</strong> ${escHtml(c)}<br>` +
            `Job <em>${escHtml(jobName)}</em> moved from <strong>${origDate}</strong> → <strong>${newDate}</strong> ` +
            `(+${daysShifted} workday${daysShifted !== 1 ? 's' : ''}) due to a schedule change.`,
            null
          );
        });
      } else {
        pushNotif('info',
          '📅 Job Shifted — ' + escHtml(jobName),
          `"${escHtml(jobName)}" moved from <strong>${origDate}</strong> → <strong>${newDate}</strong> ` +
          `(+${daysShifted} workday${daysShifted !== 1 ? 's' : ''}) to accommodate an inserted job.`,
          null
        );
      }
    });

    if (totalContacts > 0) {
      pushNotif('info',
        '📬 Contacts Need to Be Notified',
        `${totalContacts} contact${totalContacts !== 1 ? 's' : ''} on affected job cards need to be informed of schedule changes. Review the notifications above.`,
        null
      );
    }
  } else {
    // Non-admin summary only
    const count = moves.length;
    pushNotif('info', '📅 Schedule Shifted',
      `${count} job${count !== 1 ? 's' : ''} were pushed forward to accommodate the change.`, null);
  }

  saveSchedData();
  renderSchedule();
  onDone?.();
}

// ── Slide-back confirmation modal ──────────────────────────────────────
function openSlideBackModal(run, destKey, slot, affectedMoves) {
  document.getElementById('slideBackModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'slideBackModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9500;display:flex;align-items:center;justify-content:center;padding:24px;';

  const shiftCount = affectedMoves.moves.length;
  const firstAffected = [...affectedMoves.moves].sort((a,b)=>diffKeys(a.fromKey,b.fromKey))[0];
  const lastAffected  = [...affectedMoves.moves].sort((a,b)=>diffKeys(b.fromKey,a.fromKey))[0];

  const affectedRows = [...affectedMoves.moves]
    .sort((a,b)=>diffKeys(a.fromKey,b.fromKey))
    .map(m => {
      const jn = getBlockJobName(m.fromKey, m.slot);
      const contacts = getBlockContacts(m.fromKey, m.slot);
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);width:80px;">${m.fromKey}</span>
        <span style="font-size:12px;flex:1;color:var(--white);">${escHtml(jn)}</span>
        ${contacts.length ? `<span style="font-size:9px;color:var(--stripe);">📬 ${contacts.length}</span>` : ''}
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:#5ab4f5;">→ ${m.toKey}</span>
      </div>`;
    }).join('');

  modal.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:26px;width:100%;max-width:520px;box-shadow:0 20px 60px rgba(0,0,0,0.7);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">⚠️ Schedule Conflict</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);letter-spacing:1px;margin-bottom:16px;">NOT ENOUGH OPEN SHIFTS AT DESTINATION</div>
      <div style="font-size:13px;color:var(--concrete);margin-bottom:14px;line-height:1.6;">
        The destination has <strong style="color:var(--white);">fewer open shifts</strong> than the
        <strong style="color:var(--stripe);">${run.length}-shift run</strong> you're moving.
        Sliding back <strong style="color:var(--white);">${shiftCount} existing job${shiftCount!==1?'s':''}</strong>
        to make room will push them forward by <strong style="color:var(--stripe);">${run.length} day${run.length!==1?'s':''}</strong>.
      </div>
      <div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:10px 12px;max-height:200px;overflow-y:auto;margin-bottom:16px;">
        <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:8px;">Jobs that will be shifted</div>
        ${affectedRows}
      </div>
      <div style="font-size:11px;color:var(--concrete-dim);line-height:1.6;margin-bottom:18px;">
        📬 Contacts on all affected job cards will receive a notification about the schedule change.
        Notifications stop once a natural gap in the schedule prevents further displacement.
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="slideBackCancel" style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:9px 18px;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Cancel Drop</button>
        <button id="slideBackConfirm" style="background:var(--stripe);border:none;border-radius:var(--radius);padding:9px 18px;color:#000;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Slide &amp; Notify →</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('slideBackCancel').onclick = () => {
    modal.remove();
    renderSchedule(); // restore view without the drop
  };
  document.getElementById('slideBackConfirm').onclick = () => {
    modal.remove();
    applySlideBack(affectedMoves.moves, () => {
      // Now place the run into destination
      run.forEach((item, i) => {
        const destK = addDaysToKey(destKey, i);
        setBlockData(destK, item.slot, getBlockData(item.key, item.slot));
      });
      // Clear original run positions (in reverse to avoid self-collision)
      [...run].reverse().forEach(item => clearBlockData(item.key, item.slot));
      saveSchedData();
      renderSchedule();
    });
  };
}

var schedBlockDragSrc = null; // { key, slot, run, ghost }

function schedBlockDragStart(e, fromKey, fromSlot) {
  console.log('[Drag] dragstart fired, src:', schedBlockDragSrc);
  const run = detectRun(fromKey, fromSlot);
  schedBlockDragSrc = { key: fromKey, slot: fromSlot, run };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', fromKey + '|' + fromSlot);

  // Create ghost image for the whole run
  const ghost = createDragGhost(run);
  schedBlockDragSrc._ghost = ghost;
  try { e.dataTransfer.setDragImage(ghost, 80, 20); } catch(err) {}

  // Fade all blocks in the run
  setTimeout(() => {
    run.forEach(item => {
      // find the sched-block for this key/slot
      document.querySelectorAll('.sched-block').forEach(b => {
        const dragHandle = b.querySelector('.sched-drag-handle');
        if (dragHandle) {
          const os = dragHandle.getAttribute('ondragstart') || '';
          if (os.includes(`'${item.key}'`) && os.includes(`'${item.slot}'`)) {
            b.style.opacity = '0.35';
            b.style.outline = '2px dashed rgba(245,197,24,0.5)';
          }
        }
      });
    });
  }, 0);
}

function schedBlockDragEnd(e) {
  // Restore all dimmed blocks
  document.querySelectorAll('.sched-block').forEach(b => {
    b.style.opacity = '';
    b.style.outline = '';
    b.classList.remove('drop-ready', 'drop-reject');
  });
  // Remove ghost element
  if (schedBlockDragSrc?._ghost) {
    schedBlockDragSrc._ghost.remove();
    schedBlockDragSrc._ghost = null;
  }
  schedBlockDragSrc = null;
}

// ── Right-click drag = copy run ──────────────────────────────────────────────
var _schedCopySrc = null;

function startCopyDrag(e, fromKey, fromSlot) {
  if (!isAdmin()) return;
  e.preventDefault();
  const run = detectRun(fromKey, fromSlot);
  _schedCopySrc = { key: fromKey, slot: fromSlot, run };

  const blockData = getBlockData(fromKey, fromSlot);
  const label = blockData.fields?.jobName || blockData.fields?.jobNum || 'Job';
  const ghost = document.createElement('div');
  ghost.id = 'schedCopyGhost';
  ghost.style.cssText = 'position:fixed;z-index:9999;background:rgba(134,239,172,0.15);border:2px dashed rgba(134,239,172,0.7);border-radius:6px;padding:6px 12px;font-family:"DM Sans",sans-serif;font-size:11px;font-weight:700;color:#86efac;pointer-events:none;white-space:nowrap;transform:translate(12px,-50%);';
  ghost.textContent = `📋 Copy: ${label} (${run.length} shift${run.length !== 1 ? 's' : ''})`;
  ghost.style.left = e.clientX + 'px';
  ghost.style.top  = e.clientY + 'px';
  document.body.appendChild(ghost);

  document.addEventListener('mousemove', _copyDragMove);
  document.addEventListener('mouseup',   _copyDragEnd);
}

function _copyDragMove(e) {
  const ghost = document.getElementById('schedCopyGhost');
  if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
  document.querySelectorAll('.sched-block.copy-target').forEach(b => b.classList.remove('copy-target'));
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const block = el?.closest('.sched-block');
  if (block && block.dataset.blockType === 'blank') block.classList.add('copy-target');
}

function _copyDragEnd(e) {
  document.removeEventListener('mousemove', _copyDragMove);
  document.removeEventListener('mouseup',   _copyDragEnd);
  document.getElementById('schedCopyGhost')?.remove();
  document.querySelectorAll('.sched-block.copy-target').forEach(b => b.classList.remove('copy-target'));

  if (!_schedCopySrc) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const block = el?.closest('.sched-block');
  if (block && block.dataset.blockType === 'blank') {
    const toKey  = block.dataset.dateKey;
    const toSlot = block.dataset.blockSlot;
    const { key: fromKey, slot: fromSlot, run } = _schedCopySrc;
    const effectiveRun = run?.length > 1 ? run : [{ key: fromKey, slot: fromSlot }];
    let copied = 0;
    for (let i = 0; i < effectiveRun.length; i++) {
      const destKey = addDaysToKey(toKey, i);
      const dest = getBlockData(destKey, toSlot);
      if (dest.type !== 'blank' && i > 0) break;
      setBlockData(destKey, toSlot, JSON.parse(JSON.stringify(getBlockData(effectiveRun[i].key, fromSlot))));
      copied++;
    }
    saveSchedData();
    renderSchedule();
    pushNotif('success', '📋 Run Copied', `${copied} shift${copied !== 1 ? 's' : ''} copied to ${toKey}.`, null);
  }
  _schedCopySrc = null;
}

function schedBlockDragOver(e, toKey, toSlot, toType) {
  if (!schedBlockDragSrc) return;
  if (schedBlockDragSrc.key === toKey && schedBlockDragSrc.slot === toSlot) return;
  e.preventDefault();
  const block = e.currentTarget;
  if (toType === 'blank') {
    e.dataTransfer.dropEffect = 'move';
    block.classList.add('drop-ready');
    block.classList.remove('drop-reject');
  } else {
    e.dataTransfer.dropEffect = 'none';
    block.classList.add('drop-reject');
    block.classList.remove('drop-ready');
  }
}

function schedBlockDragLeave(e) {
  // Only clear if leaving the block entirely (not just moving between child elements)
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drop-ready', 'drop-reject');
  }
}

function getBlockData(key, slot) {
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    return JSON.parse(JSON.stringify(schedData[key]?.extras?.[idx]?.data || { type:'blank', fields:{} }));
  }
  return JSON.parse(JSON.stringify((schedData[key]||{})[slot] || { type:'blank', fields:{} }));
}

function setBlockData(key, slot, data) {
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ type:'blank', fields:{} } };
    schedData[key].extras[idx].data = data;
  } else {
    if (!schedData[key]) schedData[key] = {};
    schedData[key][slot] = data;
  }
}

function clearBlockData(key, slot) {
  setBlockData(key, slot, { type:'blank', fields:{} });
}

function schedBlockDrop(e, toKey, toSlot, toType) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-ready', 'drop-reject');

  if (!schedBlockDragSrc) return;
  const { key: fromKey, slot: fromSlot, run } = schedBlockDragSrc;
  // Clean up ghost
  if (schedBlockDragSrc._ghost) { schedBlockDragSrc._ghost.remove(); }
  schedBlockDragSrc = null;

  // Restore opacity
  document.querySelectorAll('.sched-block').forEach(b => { b.style.opacity=''; b.style.outline=''; });

  // Only allow drop onto blank blocks
  if (toType !== 'blank') return;
  if (fromKey === toKey && fromSlot === toSlot) return;

  const effectiveRun = run && run.length > 1 ? run : [{ key: fromKey, slot: fromSlot }];
  const runLen = effectiveRun.length;

  // Check if destination has enough consecutive open slots for the run
  let openCount = 0;
  for (let i = 0; i < runLen; i++) {
    const checkKey = addDaysToKey(toKey, i);
    // Skip source run keys (they'll be vacated)
    const isSrcKey = effectiveRun.some(r => r.key === checkKey && r.slot === toSlot);
    if (isSrcKey) { openCount++; continue; }
    const d = getBlockData(checkKey, toSlot);
    const isEmpty = d.type === 'blank' && !Object.values(d.fields||{}).some(v => v?.trim?.());
    if (isEmpty) openCount++;
    else break;
  }

  if (openCount < runLen) {
    // Not enough room — compute what a slide-back would look like
    // First temporarily vacate source positions so slide computation is accurate
    const savedSrc = effectiveRun.map(r => ({ ...r, data: getBlockData(r.key, r.slot) }));
    effectiveRun.forEach(r => clearBlockData(r.key, r.slot));
    const slideResult = computeSlideBack(toKey, runLen, toSlot);
    // Restore source data
    savedSrc.forEach(s => setBlockData(s.key, s.slot, s.data));

    if (slideResult) {
      openSlideBackModal(effectiveRun, toKey, toSlot, slideResult);
    } else {
      // Can't fit even with slide — just notify user
      pushNotif('error', '❌ No Room', 'Not enough consecutive open shifts at the destination to place this job run.', null);
    }
    return;
  }

  // Enough room — place each shift of the run into consecutive destination days
  // Read all source data first (before any writes that might overlap)
  const srcDataArr = effectiveRun.map(r => ({ data: getBlockData(r.key, r.slot) }));

  // Write to destination (in forward order)
  effectiveRun.forEach((_, i) => {
    setBlockData(addDaysToKey(toKey, i), toSlot, srcDataArr[i].data);
  });

  // Clear source positions (in reverse to avoid collision if run overlaps dest)
  [...effectiveRun].reverse().forEach(r => {
    // Only clear if not already overwritten by a destination write
    const alreadyDest = effectiveRun.some((_, i) => addDaysToKey(toKey, i) === r.key && toSlot === r.slot);
    if (!alreadyDest) clearBlockData(r.key, r.slot);
  });

  saveSchedData();
  renderSchedule();
}

// ── Daily Order Generator ── (pure JS, no external libraries)

const DAILY_ORDERS_KEY = 'pavescope_daily_orders';
var dailyOrders = (function(){ try { const p = JSON.parse(localStorage.getItem(DAILY_ORDERS_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();

function saveDailyOrders() {
  localStorage.setItem(DAILY_ORDERS_KEY, JSON.stringify(dailyOrders.map(o => ({...o, blob64: undefined}))));
  _checkLocalStorageSize();
  fbSet('daily_orders', dailyOrders.map(o => ({...o, blob64: undefined})));
}

// ── Minimal DOCX builder (no dependencies) ──
function escXml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function makeRun(text, opts) {
  opts = opts || {};
  var rpr = '';
  if (opts.bold) rpr += '<w:b/><w:bCs/>';
  if (opts.underline) rpr += '<w:u w:val="single"/>';
  if (opts.size) rpr += '<w:sz w:val="'+opts.size+'"/><w:szCs w:val="'+opts.size+'"/>';
  if (opts.color) rpr += '<w:color w:val="'+opts.color+'"/>';
  rpr = rpr ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' + rpr + '</w:rPr>' : '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>';
  // Handle line breaks
  var parts = String(text||'').split('\n');
  var result = '';
  parts.forEach(function(part, i) {
    if (i > 0) result += '<w:r><w:br/></w:r>';
    result += '<w:r>' + rpr + '<w:t xml:space="preserve">' + escXml(part) + '</w:t></w:r>';
  });
  return result;
}

function makePara(runs, opts) {
  opts = opts || {};
  var ppr = '<w:pPr>';
  if (opts.spaceBefore) ppr += '<w:spacing w:before="'+opts.spaceBefore+'" w:after="'+(opts.spaceAfter||0)+'"/>';
  if (opts.colBreak) ppr += '<w:pageBreakBefore/>';
  ppr += '</w:pPr>';
  var colBreakXml = opts.colBreak ? '<w:r><w:rPr/><w:br w:type="column"/></w:r>' : '';
  return '<w:p>' + ppr + colBreakXml + (Array.isArray(runs) ? runs.join('') : runs) + '</w:p>';
}


// ── DOCX letterhead header paragraph (shared by all reports) ─────────────────
// Returns an array of w:p XML strings forming a branded header block
function makeDocxLetterhead(reportTitle) {
  // Row 1: dark background bar — "DON MARTIN CORP" big text
  var hdrBar =
    '<w:p>' +
    '<w:pPr>' +
    '<w:shd w:val="clear" w:color="auto" w:fill="1A1A1A"/>' +
    '<w:spacing w:before="80" w:after="80"/>' +
    '<w:jc w:val="center"/>' +
    '</w:pPr>' +
    makeRun('DON MARTIN CORP', {bold:true, size:32, color:'F5C518'}) +
    '</w:p>';

  // Row 2: address line in dark bg
  var addrBar =
    '<w:p>' +
    '<w:pPr>' +
    '<w:shd w:val="clear" w:color="auto" w:fill="1A1A1A"/>' +
    '<w:spacing w:before="0" w:after="80"/>' +
    '<w:jc w:val="center"/>' +
    '</w:pPr>' +
    makeRun('475 SCHOOL ST  \u00b7  MARSHFIELD, MA 02050  \u00b7  (781) 834-0071', {size:18, color:'CCCCCC'}) +
    '</w:p>';

  // Row 3: report title on white background
  var titleBar =
    '<w:p>' +
    '<w:pPr>' +
    '<w:spacing w:before="120" w:after="120"/>' +
    '<w:jc w:val="center"/>' +
    '</w:pPr>' +
    makeRun(reportTitle, {bold:true, size:28}) +
    '</w:p>';

  // Thin separator line paragraph
  var sep =
    '<w:p>' +
    '<w:pPr>' +
    '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="1A1A1A"/></w:pBdr>' +
    '<w:spacing w:before="0" w:after="120"/>' +
    '</w:pPr>' +
    '</w:p>';

  return hdrBar + addrBar + titleBar + sep;
}

// ── Detect if a plant belongs to Aggregate Industries / Amrize ────────────────
function _isAmrizePlant(plantName) {
  if (!plantName) return false;
  var lc = plantName.toLowerCase();
  // Direct string match on the full stored value ("Supplier — Location" format)
  if (lc.includes('aggregate') || lc.includes('amrize')) return true;
  // Extract the supplier name prefix (everything before " — ")
  var supplierPart = plantName.includes(' \u2014 ') ? plantName.split(' \u2014 ')[0] : plantName;
  var supplierLc = supplierPart.toLowerCase();
  if (supplierLc.includes('aggregate') || supplierLc.includes('amrize')) return true;
  // Match against suppliersList by supplier name prefix
  var owner = suppliersList.find(function(s) {
    var snl = (s.name || '').toLowerCase();
    return snl === supplierLc || s.name === supplierPart ||
      (s.plants && s.plants.some(function(pl) {
        return pl === plantName || (supplierPart + ' \u2014 ' + pl) === plantName;
      }));
  });
  return !!(owner && (owner.name.toLowerCase().includes('aggregate') || owner.name.toLowerCase().includes('amrize')));
}

// ── Supplier name extraction (everything before " — " in "Supplier — Plant" format) ──
function _getSupplierName(plant) {
  if (!plant) return '';
  return plant.includes(' \u2014 ') ? plant.split(' \u2014 ')[0].trim() : plant.trim();
}

// ── Check if two plant strings belong to the same supplier ──────────────────
function _isSameSupplier(plant1, plant2) {
  // Both empty → treat as same (no supplier either way)
  if (!plant1 && !plant2) return true;
  if (!plant1 || !plant2) return false;
  return _getSupplierName(plant1).toLowerCase() === _getSupplierName(plant2).toLowerCase();
}

// ── Shared HTML form helpers ───────────────────────────────────────────────────
function _oEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _oUl(v) { return '<span class="ul">' + _oEsc(v) + '</span>'; }
function _oSul(v) { return '<span class="ul s">' + _oEsc(v) + '</span>'; }
function _oChk(on) { return on ? '&#9746;' : '&#9744;'; }

// ── DMC Order HTML Form ────────────────────────────────────────────────────────
// secondFields: if provided, fills the right column with second-stop data (same supplier, different plant)
function buildDMCOrderHTML(fields, orderDate, foreman, secondFields) {
  var v = function(k) { return fields[k] || ''; };
  var jobLocation = v('location');
  if (!jobLocation) { try { var _jn=fields.jobName||'',_jk=fields.jobNum||'',_mj=(backlogJobs||[]).find(function(j){ return (_jk&&j.num&&j.num.toString().trim()===_jk.toString().trim())||(_jn&&j.name&&j.name.trim().toLowerCase()===_jn.trim().toLowerCase()); }); if(_mj&&_mj.location) jobLocation=_mj.location; } catch(e){} }
  var jn = v('jobName'), gc = '', proj = '';
  if (jn.indexOf(' \u2014 ') >= 0) { gc = jn.split(' \u2014 ')[0]; proj = jn.split(' \u2014 ').slice(1).join(' \u2014 '); }
  else { proj = jn; }
  var mats = parseMaterialField(v('material'));
  while (mats.length < 4) mats.push({name:'',tons:''});
  mats = mats.slice(0,4);
  var trk = {}; try { trk = JSON.parse(v('trucking')); } catch(e) {}
  var ops = v('operators') ? v('operators').split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
  var tlist = (trk.truckList && trk.truckList.length) ? trk.truckList : ops;

  // Second-stop data (right column)
  var has2 = !!(secondFields);
  var v2   = has2 ? function(k) { return secondFields[k] || ''; } : function(){ return ''; };
  var jn2  = v2('jobName'), gc2 = '', proj2 = '';
  if (has2 && jn2.indexOf(' \u2014 ') >= 0) { gc2 = jn2.split(' \u2014 ')[0]; proj2 = jn2.split(' \u2014 ').slice(1).join(' \u2014 '); }
  else { proj2 = jn2; }
  var mats2 = has2 ? parseMaterialField(v2('material')) : [];
  while (mats2.length < 4) mats2.push({name:'',tons:''});
  mats2 = mats2.slice(0,4);
  var trk2 = {}; if (has2) { try { trk2 = JSON.parse(v2('trucking')); } catch(e) {} }
  var ops2 = (has2 && v2('operators')) ? v2('operators').split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
  var tlist2 = (trk2.truckList && trk2.truckList.length) ? trk2.truckList : ops2;

  // Each <tr> holds both the filled (left) and right sides — guarantees row alignment
  function R(lH, rH) { return '<tr><td class="tc">'+lH+'</td><td class="dv"></td><td class="tc">'+rH+'</td></tr>'; }
  function S(t)       { return '<tr><td colspan="3" class="sh">'+t+'</td></tr>'; }
  function F(lbl, val){ return '<div class="fr"><span class="lb">'+lbl+'</span><span class="ul">'+_oEsc(val)+'</span></div>'; }
  function M(i, src, srcMats) {
    var m = src ? srcMats[i] : {name:'',tons:''};
    return '<div class="fr"><span class="lb">TONS:</span><span class="ul s">'+_oEsc(m.tons)+'</span><span class="ml lb">MIX TYPE:</span><span class="ul">'+_oEsc(m.name)+'</span></div>';
  }
  function T(i, src, srcList) {
    return '<div class="nr"><span class="nm">'+(i+1)+')</span><span class="ul">'+_oEsc(src?(srcList[i]||''):'')+'</span></div>';
  }

  // Column header labels when two stops are present
  var colHdrRow = has2
    ? '<tr><td class="tc" style="text-align:center;font-size:7.5pt;font-weight:bold;letter-spacing:.5px;padding:2px 0 4px;border-bottom:1px solid #ccc;">STOP 1</td><td class="dv"></td><td class="tc" style="text-align:center;font-size:7.5pt;font-weight:bold;letter-spacing:.5px;padding:2px 0 4px;border-bottom:1px solid #ccc;">STOP 2</td></tr>'
    : '';

  var rows = [
    colHdrRow,
    S('JOB INFORMATION:'),
    R(F('ORDER DATE:',          orderDate),              F('ORDER DATE:', has2 ? orderDate : '')),
    R(F('FOREMAN:',             foreman),                F('FOREMAN:', foreman)),
    R(F('DMC JOB NUMBER:',      v('jobNum')),            F('DMC JOB NUMBER:', has2 ? v2('jobNum') : '')),
    R(F('GENERAL CONTRACTOR:',  gc),                     F('GENERAL CONTRACTOR:', has2 ? gc2 : '')),
    R(F('PROJECT NAME:',        proj),                   F('PROJECT NAME:', has2 ? proj2 : '')),
    R(F('PROJECT ADDRESS:',     jobLocation||''),         F('PROJECT ADDRESS:', has2 ? v2('location')||'' : '')),
    S('MATERIALS INFORMATION:'),
    R('<div class="fr"><span class="lb">TYPE OF WORK:</span><span class="ml">MACHINE WORK: &#9746;</span><span class="ml">HAND WORK: &#9744;</span></div>',
      '<div class="fr"><span class="lb">TYPE OF WORK:</span><span class="ml">MACHINE WORK: '+(has2?'&#9746;':'&#9744;')+'</span><span class="ml">HAND WORK: &#9744;</span></div>'),
    R('<div class="fr"><span class="lb">JOB SETUP:</span><span class="ml">BY THE TON: &#9746;</span><span class="ml">BY THE SQUARE YARD: &#9744;</span></div>',
      '<div class="fr"><span class="lb">JOB SETUP:</span><span class="ml">BY THE TON: '+(has2?'&#9746;':'&#9744;')+'</span><span class="ml">BY THE SQUARE YARD: &#9744;</span></div>'),
    R(F('PLANT:',               v('plant')),             F('PLANT:', has2 ? v2('plant') : '')),
    R(F('SUPERPAVE TRAFFIC LEVEL/GYRATION:', ''),        F('SUPERPAVE TRAFFIC LEVEL/GYRATION:', '')),
    R(M(0, true, mats),  M(0, has2, mats2)),
    R(M(1, true, mats),  M(1, has2, mats2)),
    R(M(2, true, mats),  M(2, has2, mats2)),
    R(M(3, true, mats),  M(3, has2, mats2)),
    R(F('ESTIMATED TIME TO PAVE:', ''),                  F('ESTIMATED TIME TO PAVE:', '')),
    S('TRUCKING:'),
    R('<div class="fr"><span class="lb">NUMBER OF TRUCKS:</span><span class="ul s">'+_oEsc(trk.trucks||trk.numTrucks||'')+'</span><span class="ml lb">LOAD TIME:</span><span class="ul s">'+_oEsc(trk.loadTime||'')+'</span></div>',
      '<div class="fr"><span class="lb">NUMBER OF TRUCKS:</span><span class="ul s">'+_oEsc(has2?(trk2.trucks||trk2.numTrucks||''):'')+'</span><span class="ml lb">LOAD TIME:</span><span class="ul s">'+_oEsc(has2?(trk2.loadTime||''):'')+'</span></div>'),
    R(F('SPACING:', trk.spacing||''),                    F('SPACING:', has2 ? trk2.spacing||'' : '')),
    '<tr><td colspan="3" class="bl">SPECIAL NOTES / DIRECTIONS &amp; TRUCK LIST</td></tr>',
    R(T(0,true,tlist),T(0,has2,tlist2)), R(T(1,true,tlist),T(1,has2,tlist2)), R(T(2,true,tlist),T(2,has2,tlist2)),
    R(T(3,true,tlist),T(3,has2,tlist2)), R(T(4,true,tlist),T(4,has2,tlist2)),
  ].join('');

  var css='@page{size:letter portrait;margin:.55in .5in}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9pt;color:#000;background:#fff}@media print{.np{display:none!important}}.pb{position:fixed;top:10px;right:10px;z-index:999;background:#1a6b3c;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:13px;font-weight:bold;cursor:pointer}.hdr{text-align:center;padding-bottom:12px;margin-bottom:10px;border-bottom:2px solid #ccc}.cn{font-size:17pt;font-weight:900;font-family:"Arial Black",Arial,sans-serif;letter-spacing:1px;margin-top:4px}.cs{font-size:8pt;letter-spacing:3px;color:#666;margin-top:2px}table.form{width:100%;border-collapse:collapse;table-layout:fixed}col.c1,col.c2{width:47.5%}col.cdv{width:5%}td.tc{vertical-align:bottom;padding:0}td.dv{border-left:1px dashed #ccc}td.sh{font-size:9pt;font-weight:bold;text-decoration:underline;color:#1a6b3c;padding:10px 0 4px;text-transform:uppercase;vertical-align:bottom}td.bl{font-size:8.5pt;font-weight:bold;padding:8px 0 4px;border-top:1px solid #ddd;vertical-align:bottom}.fr{display:flex;align-items:flex-end;padding-bottom:6px;gap:3px}.lb{font-size:8pt;font-weight:bold;white-space:nowrap;flex-shrink:0}.ml{margin-left:7px;font-size:8pt;white-space:nowrap;flex-shrink:0}.ul{flex:1;border-bottom:1px solid #000;min-width:20px;font-size:8.5pt;padding-bottom:1px}.ul.s{flex:0 0 46px;min-width:0}.nr{display:flex;align-items:flex-end;padding-bottom:6px;gap:4px}.nm{font-size:8pt;font-weight:bold;width:16px;flex-shrink:0}body::before{content:\'\';position:fixed;top:50%;left:50%;width:280px;height:240px;transform:translate(-50%,-60%);background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 52 44\'%3E%3Cpolygon points=\'3,0 49,22 3,44\' fill=\'none\' stroke=\'%23c00\' stroke-width=\'3.5\'/%3E%3Cpolygon points=\'11,5 41,22 11,39\' fill=\'none\' stroke=\'%23c00\' stroke-width=\'2\'/%3E%3C/svg%3E") center/contain no-repeat;opacity:0.05;pointer-events:none;z-index:-1}';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DMC Daily Order</title><style>'+css+'</style></head><body>'
    +'<button class="pb np" onclick="window.print()">&#128424; Print / Save as PDF</button>'
    +'<div class="hdr">'
    +'<svg width="52" height="44" viewBox="0 0 52 44" xmlns="http://www.w3.org/2000/svg"><polygon points="3,0 49,22 3,44" fill="none" stroke="#c00" stroke-width="3.5"/><polygon points="11,5 41,22 11,39" fill="none" stroke="#c00" stroke-width="2"/></svg>'
    +'<div class="cn"><span style="color:#c00">D</span>ON<span style="color:#333">MARTIN</span><span style="color:#c00">C</span>ORP</div>'
    +'<div class="cs">DON MARTIN CORPORATION &bull; PAVING CONTRACTOR</div>'
    +'<div class="cs">781.834.0071 &bull; Est. 1986</div>'
    +'</div>'
    +'<table class="form"><colgroup><col class="c1"><col class="cdv"><col class="c2"></colgroup><tbody>'+rows+'</tbody></table>'
    +'</body></html>';
}

// ── Amrize (Aggregate Industries) Order HTML Form ─────────────────────────────
// secondFields: if provided, fills the right column with second-stop data (same supplier, different plant)
function buildAmrizeOrderHTML(fields, dateKey, foreman, secondFields) {
  var v = function(k) { return fields[k] || ''; };
  var jobLocation = v('location');
  if (!jobLocation) { try { var _jn=fields.jobName||'',_jk=fields.jobNum||'',_mj=(backlogJobs||[]).find(function(j){ return (_jk&&j.num&&j.num.toString().trim()===_jk.toString().trim())||(_jn&&j.name&&j.name.trim().toLowerCase()===_jn.trim().toLowerCase()); }); if(_mj&&_mj.location) jobLocation=_mj.location; } catch(e){} }
  var jn = v('jobName'), gc = '', proj = '';
  if (jn.indexOf(' \u2014 ') >= 0) { gc = jn.split(' \u2014 ')[0]; proj = jn.split(' \u2014 ').slice(1).join(' \u2014 '); }
  else { proj = jn; }
  var mats = parseMaterialField(v('material'));
  while (mats.length < 4) mats.push({name:'',tons:''});
  mats = mats.slice(0,4);
  var trk = {}; try { trk = JSON.parse(v('trucking')); } catch(e) {}
  var reqDate = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'});
  var pickDate = '';
  try { var p=dateKey.split('-'); pickDate=new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}); } catch(e){}

  // Second-stop data (right column)
  var has2 = !!(secondFields);
  var v2   = has2 ? function(k) { return secondFields[k] || ''; } : function(){ return ''; };
  var jn2  = v2('jobName'), gc2 = '', proj2 = '';
  if (has2 && jn2.indexOf(' \u2014 ') >= 0) { gc2 = jn2.split(' \u2014 ')[0]; proj2 = jn2.split(' \u2014 ').slice(1).join(' \u2014 '); }
  else { proj2 = jn2; }
  var mats2 = has2 ? parseMaterialField(v2('material')) : [];
  while (mats2.length < 4) mats2.push({name:'',tons:''});
  mats2 = mats2.slice(0,4);
  var trk2 = {}; if (has2) { try { trk2 = JSON.parse(v2('trucking')); } catch(e) {} }

  function R(lH, rH) { return '<tr><td class="tc">'+lH+'</td><td class="dv"></td><td class="tc">'+rH+'</td></tr>'; }
  function S(t)       { return '<tr><td colspan="3" class="sh">'+t+'</td></tr>'; }
  function F(lbl, val){ return '<div class="fr"><span class="lb">'+lbl+'</span><span class="ul">'+_oEsc(val)+'</span></div>'; }
  function M(i, src, srcMats) {
    var m = src ? srcMats[i] : {name:'',tons:''};
    return '<div class="fr"><span class="lb">Tons:</span><span class="ul s">'+_oEsc(m.tons)+'</span><span class="ml lb">Mix Type:</span><span class="ul">'+_oEsc(m.name)+'</span></div>';
  }

  // Top info: table with 2 aligned columns, 3 rows
  var topInfo = '<table class="tbl"><colgroup><col style="width:50%"><col style="width:50%"></colgroup><tbody>'
    +'<tr>'
    +'<td class="tf"><div class="tr2"><span class="tl">Date of Request:</span><span class="tv">'+_oEsc(reqDate)+'</span></div></td>'
    +'<td class="tf"><div class="tr2"><span class="tl">Date of Pick-Up:</span><span class="tv">'+_oEsc(pickDate)+'</span></div></td>'
    +'</tr><tr>'
    +'<td class="tf"><div class="tr2"><span class="tl">Customer Name:</span><span class="tv">DON MARTIN CORPORATION</span></div></td>'
    +'<td class="tf"><div class="tr2"><span class="tl">Customer Number:</span><span class="tv">DON MA</span></div></td>'
    +'</tr><tr>'
    +'<td class="tf"><div class="tr2"><span class="tl">Ordered by:</span><span class="tv">DON</span></div></td>'
    +'<td class="tf"><div class="tr2"><span class="tl">Phone Number:</span><span class="tv">781.834.0071</span></div></td>'
    +'</tr></tbody></table>';

  // Note rows: when two stops, split into two side-by-side note sections; otherwise full-width
  var noteRows = has2
    ? [1,2,3,4,5].map(function(){ return '<tr><td class="nl"></td><td class="dv"></td><td class="nl"></td></tr>'; }).join('')
    : [1,2,3,4,5].map(function(){ return '<tr><td colspan="3" class="nl"></td></tr>'; }).join('');

  // Column header when two stops present
  var colHdrRow = has2
    ? '<tr><td class="tc" style="text-align:center;font-size:7.5pt;font-weight:bold;letter-spacing:.5px;padding:2px 0 4px;border-bottom:1px solid #ccc;">STOP 1</td><td class="dv"></td><td class="tc" style="text-align:center;font-size:7.5pt;font-weight:bold;letter-spacing:.5px;padding:2px 0 4px;border-bottom:1px solid #ccc;">STOP 2</td></tr>'
    : '';

  var rows = [
    colHdrRow,
    S('A. Job Information:'),
    R(F('Foreman:',                   foreman),                         F('Foreman:', foreman)),
    R(F('Job No./Purchase Order No.:', v('jobNum')),                    F('Job No./Purchase Order No.:', has2 ? v2('jobNum') : '')),
    R(F('General Contractor:',        gc),                              F('General Contractor:', has2 ? gc2 : '')),
    R(F('Job Name:',                  proj),                            F('Job Name:', has2 ? proj2 : '')),
    R(F('Job City/State:',            jobLocation||''),                  F('Job City/State:', has2 ? v2('location')||'' : '')),
    S('B. Materials:'),
    R('<div class="fr"><span class="lb">Type of Work:</span><span class="ml">&#9744; Machine</span><span class="ml">&#9744; Hand</span></div>',
      '<div class="fr"><span class="lb">Type of Work:</span><span class="ml">&#9744; Machine</span><span class="ml">&#9744; Hand</span></div>'),
    R(F('Plant:', v('plant')),         F('Plant:', has2 ? v2('plant') : '')),
    R(M(0, true, mats),  M(0, has2, mats2)),
    R(M(1, true, mats),  M(1, has2, mats2)),
    R(M(2, true, mats),  M(2, has2, mats2)),
    R(M(3, true, mats),  M(3, has2, mats2)),
    R('<div class="fr"><span class="lb">Estimated time to pave:</span><span class="ul s"></span><span class="ml" style="font-weight:normal">hours</span></div>',
      '<div class="fr"><span class="lb">Estimated time to pave:</span><span class="ul s"></span><span class="ml" style="font-weight:normal">hours</span></div>'),
    S('C. Trucking:'),
    R('<div class="fr"><span class="lb">No. of Trucks:</span><span class="ul s">'+_oEsc(trk.trucks||trk.numTrucks||'')+'</span><span class="ml lb">Load Time:</span><span class="ul s">'+_oEsc(trk.loadTime||'')+'</span></div>',
      '<div class="fr"><span class="lb">No. of Trucks:</span><span class="ul s">'+_oEsc(has2?(trk2.trucks||trk2.numTrucks||''):'')+'</span><span class="ml lb">Load Time:</span><span class="ul s">'+_oEsc(has2?(trk2.loadTime||''):'')+'</span></div>'),
    R(F('Spacing:', trk.spacing||''), F('Spacing:', has2 ? trk2.spacing||'' : '')),
    S('Special Notes / Directions:'),
    noteRows,
  ].join('');

  var css='@page{size:letter portrait;margin:.55in .5in}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9pt;color:#000;background:#fff}@media print{.np{display:none!important}}.pb{position:fixed;top:10px;right:10px;z-index:999;background:#1a5c8a;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:13px;font-weight:bold;cursor:pointer}.hdr{text-align:center;padding-bottom:8px;margin-bottom:6px}.an{font-size:14pt;font-weight:900;font-family:"Arial Black",Arial,sans-serif;letter-spacing:2px;color:#1a5c8a}.as{font-size:7.5pt;letter-spacing:1px;color:#555;margin-top:1px}.ft{font-size:11.5pt;font-weight:bold;text-align:center;text-decoration:underline;margin-bottom:8px;letter-spacing:.4px}table.tbl{width:100%;border-collapse:collapse;border-bottom:1px solid #aaa;margin-bottom:8px}td.tf{vertical-align:bottom;padding:0}.tr2{display:flex;align-items:flex-end;padding-bottom:4px;gap:3px}.tl{font-size:8pt;font-weight:bold;white-space:nowrap;flex-shrink:0}.tv{flex:1;border-bottom:1px solid #000;font-size:8.5pt;padding-bottom:1px;min-width:20px}table.form{width:100%;border-collapse:collapse;table-layout:fixed}col.c1,col.c2{width:47.5%}col.cdv{width:5%}td.tc{vertical-align:bottom;padding:0}td.dv{border-left:1px dashed #ccc}td.sh{font-size:9pt;font-weight:bold;text-decoration:underline;padding:10px 0 4px;vertical-align:bottom}td.nl{height:19px;border-bottom:1px solid #000;padding:0}.fr{display:flex;align-items:flex-end;padding-bottom:6px;gap:3px}.lb{font-size:8pt;font-weight:bold;white-space:nowrap;flex-shrink:0}.ml{margin-left:7px;font-size:8pt;white-space:nowrap;flex-shrink:0}.ul{flex:1;border-bottom:1px solid #000;min-width:20px;font-size:8.5pt;padding-bottom:1px}.ul.s{flex:0 0 46px;min-width:0}.foot{text-align:center;font-size:7.5pt;font-weight:bold;border-top:1px solid #000;padding-top:7px;margin-top:14px}';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Amrize Daily Order</title><style>'+css+'</style></head><body>'
    +'<button class="pb np" onclick="window.print()">&#128424; Print / Save as PDF</button>'
    +'<div class="hdr">'
    +'<svg width="50" height="46" viewBox="0 0 50 46" xmlns="http://www.w3.org/2000/svg"><polygon points="25,2 48,44 2,44" fill="none" stroke="#1a5c8a" stroke-width="3"/><line x1="13" y1="32" x2="37" y2="32" stroke="#1a5c8a" stroke-width="2.5"/></svg>'
    +'<div class="an">AGGREGATE</div><div class="an" style="font-size:10.5pt">INDUSTRIES</div>'
    +'<div class="as">NORTHEAST REGION, INC.</div>'
    +'</div>'
    +'<div class="ft">BITUMINOUS CONCRETE F.O.B. ORDER FORM</div>'
    +topInfo
    +'<table class="form"><colgroup><col class="c1"><col class="cdv"><col class="c2"></colgroup><tbody>'+rows+'</tbody></table>'
    +'<div class="foot">FAX THIS ORDER TO THE PAVING OPERATIONS OFFICE AT (978) 486-9268 BY 12:00PM</div>'
    +'</body></html>';
}

function buildDocxXml(f, foreman, orderDate) {
  var v = function(k) { return f[k] || ''; };
  var jobNameFull = v('jobName');
  var gcName = '', projectName = '';
  if (jobNameFull.indexOf(' — ') >= 0) {
    gcName = jobNameFull.split(' — ')[0];
    projectName = jobNameFull.split(' — ').slice(1).join(' — ');
  } else { projectName = jobNameFull; }

  var operators = v('operators') ? v('operators').split(',').filter(Boolean) : [];
  var equipList = v('equipment') ? v('equipment').split(',').filter(Boolean) : [];
  var qcVal = v('qc'); var tackVal = v('tack'); var rubberVal = v('rubber');
  var CHECK = '&#9746;'; var UNCHECK = '&#9744;';

  function lbl(t) { return makeRun(t, {bold:true, size:18}); }
  function val(t) { return makeRun(t || '', {size:18}); }
  function head(t) { return makePara([makeRun(t, {bold:true, underline:true, size:20})], {spaceBefore:80, spaceAfter:40}); }
  function line() { var runs = Array.prototype.slice.call(arguments); return makePara(runs, {spaceAfter:20}); }

  // Stop 1 paragraphs (left column - filled)
  var s1 = [
    head('JOB INFORMATION:'),
    line(lbl('ORDER DATE: '), val(orderDate)),
    line(lbl('FOREMAN: '), val(foreman)),
    line(lbl('DMC JOB NUMBER: '), val(v('jobNum'))),
    line(lbl('GENERAL CONTRACTOR: '), val(gcName)),
    line(lbl('PROJECT NAME: '), val(projectName)),
    line(lbl('PROJECT ADDRESS: '), val(v('location')||'')),
    head('MATERIALS INFORMATION:'),
    line(lbl('TYPE OF WORK:  '), lbl('MACHINE WORK: '), val(CHECK), lbl('   HAND WORK: '), val(UNCHECK)),
    line(lbl('JOB SETUP:  '), lbl('BY THE TON: '), val(CHECK), lbl('   BY THE SQUARE YARD: '), val(UNCHECK)),
    line(lbl('PLANT: '), val(v('plant'))),
    line(lbl('MATERIAL: '), val(v('material'))),
    line(lbl('SUPERPAVE TRAFFIC LEVEL/GYRATION: ')),
    line(lbl('TONS: '), val(''), lbl('  MIX TYPE: ')),
    line(lbl('TONS: '), val(''), lbl('  MIX TYPE: ')),
    line(lbl('TONS: '), val(''), lbl('  MIX TYPE: ')),
    line(lbl('TONS: '), val(''), lbl('  MIX TYPE: ')),
    line(lbl('ESTIMATED TIME TO PAVE: ')),
    head('TRUCKING:'),
    line(lbl('NUMBER OF TRUCKS: '), lbl('   LOAD TIME: ')),
    line(lbl('SPACING: ')),
    line(lbl('QC: '), val(qcVal), lbl('   TACK: '), val(tackVal), lbl('   RUBBER: '), val(rubberVal)),
    line(lbl('EQUIPMENT: '), val(equipList.join(', '))),
    line(lbl('CONTACT: '), val(v('contact'))),
    makePara([lbl('SPECIAL NOTES/DIRECTIONS & TRUCK LIST')], {spaceBefore:60, spaceAfter:20}),
  ].concat(
    [0,1,2,3,4].map(function(i){ return line(lbl((i+1)+') '), val(operators[i]||'')); })
  ).concat([line(lbl('NOTES: '), val(v('notes')))]);

  // Stop 2 paragraphs (right column - blank)
  var s2 = [
    head('JOB INFORMATION:'),
    line(lbl('ORDER DATE: ')),
    line(lbl('FOREMAN: '), val(foreman)),
    line(lbl('DMC JOB NUMBER: ')),
    line(lbl('GENERAL CONTRACTOR: ')),
    line(lbl('PROJECT NAME: ')),
    line(lbl('PROJECT ADDRESS: ')),
    head('MATERIALS INFORMATION:'),
    line(lbl('TYPE OF WORK:  '), lbl('MACHINE WORK: '), val(UNCHECK), lbl('   HAND WORK: '), val(UNCHECK)),
    line(lbl('JOB SETUP:  '), lbl('BY THE TON: '), val(UNCHECK), lbl('   BY THE SQUARE YARD: '), val(UNCHECK)),
    line(lbl('PLANT: ')),
    line(lbl('MATERIAL: ')),
    line(lbl('SUPERPAVE TRAFFIC LEVEL/GYRATION: ')),
    line(lbl('TONS: '), lbl('  MIX TYPE: ')),
    line(lbl('TONS: '), lbl('  MIX TYPE: ')),
    line(lbl('TONS: '), lbl('  MIX TYPE: ')),
    line(lbl('TONS: '), lbl('  MIX TYPE: ')),
    line(lbl('ESTIMATED TIME TO PAVE: ')),
    head('TRUCKING:'),
    line(lbl('NUMBER OF TRUCKS: '), lbl('   LOAD TIME: ')),
    line(lbl('SPACING: ')),
    line(lbl('QC: '), lbl('   TACK: '), lbl('   RUBBER: ')),
    line(lbl('EQUIPMENT: ')),
    line(lbl('CONTACT: ')),
    makePara([lbl('SPECIAL NOTES/DIRECTIONS & TRUCK LIST')], {spaceBefore:60, spaceAfter:20}),
    line(lbl('1) ')), line(lbl('2) ')), line(lbl('3) ')), line(lbl('4) ')), line(lbl('5) ')),
    line(lbl('NOTES: ')),
  ];

  // Column break between stop1 and stop2
  var colBreakPara = '<w:p><w:pPr><w:pPr/></w:pPr><w:r><w:rPr/><w:br w:type="column"/></w:r></w:p>';

  var titlePara1 = makeDocxLetterhead('DMC PAVING — DAILY ORDER');
  var titlePara2 = makeDocxLetterhead('DMC PAVING — DAILY ORDER (COPY)');

  var body = '<w:body>'
    + '<w:sectPr>'
    + '<w:cols w:num="2" w:space="360"/>'
    + '<w:pgSz w:w="12240" w:h="15840"/>'
    + '<w:pgMar w:top="288" w:right="288" w:bottom="288" w:left="288" w:header="720" w:footer="720" w:gutter="0"/>'
    + '</w:sectPr>'
    + titlePara1
    + s1.join('')
    + colBreakPara
    + titlePara2
    + s2.join('')
    + '</w:body>';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"'
    + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + body
    + '</w:document>';
}

// ── Tiny ZIP builder (no dependencies) ──
function buildDocxBlob(xmlContent) {
  // Build a DOCX (ZIP) file manually using DataView
  var files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': xmlContent,
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  };

  var enc = new TextEncoder();
  var parts = [];

  function crc32(data) {
    var crc = 0xFFFFFFFF;
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    for (var i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) { var b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
  function u32(n) { var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }

  var centralDir = [];
  var offset = 0;

  Object.keys(files).forEach(function(name) {
    var nameBytes = enc.encode(name);
    var dataBytes = enc.encode(files[name]);
    var crc = crc32(dataBytes);
    var size = dataBytes.length;

    // Local file header
    var local = new Uint8Array([
      0x50,0x4B,0x03,0x04, // signature
      20,0, // version needed
      0,0, // flags
      0,0, // compression (stored)
      0,0,0,0, // mod time/date
    ].concat(Array.from(u32(crc)))
     .concat(Array.from(u32(size)))
     .concat(Array.from(u32(size)))
     .concat(Array.from(u16(nameBytes.length)))
     .concat([0,0]) // extra length
    );

    var entry = new Uint8Array(local.length + nameBytes.length + dataBytes.length);
    entry.set(local, 0);
    entry.set(nameBytes, local.length);
    entry.set(dataBytes, local.length + nameBytes.length);
    parts.push(entry);

    // Central directory entry
    centralDir.push({ name: nameBytes, crc: crc, size: size, offset: offset });
    offset += entry.length;
  });

  // Central directory
  var cdParts = [];
  centralDir.forEach(function(cd) {
    var cdEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02, // signature
      20,0, // version made
      20,0, // version needed
      0,0, // flags
      0,0, // compression
      0,0,0,0, // mod time/date
    ].concat(Array.from(u32(cd.crc)))
     .concat(Array.from(u32(cd.size)))
     .concat(Array.from(u32(cd.size)))
     .concat(Array.from(u16(cd.name.length)))
     .concat([0,0,0,0,0,0,0,0,0,0,0,0]) // extra/comment/disk/attrs
     .concat(Array.from(u32(cd.offset)))
    );
    var full = new Uint8Array(cdEntry.length + cd.name.length);
    full.set(cdEntry, 0);
    full.set(cd.name, cdEntry.length);
    cdParts.push(full);
  });

  var cdTotal = cdParts.reduce(function(s, p) { return s + p.length; }, 0);
  var eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06, // signature
    0,0,0,0, // disk numbers
  ].concat(Array.from(u16(centralDir.length)))
   .concat(Array.from(u16(centralDir.length)))
   .concat(Array.from(u32(cdTotal)))
   .concat(Array.from(u32(offset)))
   .concat([0,0]) // comment length
  );

  // Combine all parts
  var totalSize = parts.reduce(function(s, p) { return s + p.length; }, 0)
    + cdParts.reduce(function(s, p) { return s + p.length; }, 0)
    + eocd.length;
  var result = new Uint8Array(totalSize);
  var pos = 0;
  parts.forEach(function(p) { result.set(p, pos); pos += p.length; });
  cdParts.forEach(function(p) { result.set(p, pos); pos += p.length; });
  result.set(eocd, pos);

  return new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function downloadBlob(blob, fileName) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function generateDailyOrder(dateKey, slot, event) {
  console.log('[Order] generateDailyOrder called', dateKey, slot);
  if (event) event.stopPropagation();
  buildDailyOrder(dateKey, slot);
}


// ══════════════════════════════════════════════════════════════════════════════
// DJ APPROVAL QUEUE + FOREMAN REPORT / TACK & RUBBER GENERATION
// ══════════════════════════════════════════════════════════════════════════════

const DJ_ACCOUNT = 'dj'; // username that has approval authority (case-insensitive)

function isDJ() {
  const u = (localStorage.getItem('dmc_u') || '').toLowerCase();
  return isAdmin() || u === DJ_ACCOUNT;
}

// ── Pending approvals: schedule blocks that have no foreman report yet ────────
// A block is "pending" if it has a jobName and its dateKey <= today and 
// no foreman report has been generated for it yet.

// ── Open DJ Approval panel ──────────────────────────────────────────────────
function openDJApprovalPanel() {
  document.getElementById('djApprovalPanel')?.remove();
  const pending = getPendingApprovals();

  const overlay = document.createElement('div');
  overlay.id = 'djApprovalPanel';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:6000;display:flex;align-items:center;justify-content:center;padding:20px;';

  const pendingRows = pending.length ? pending.map((p, i) => {
    const f = p.fields;
    const dateFmt = new Date(p.dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
    const jobName = f.jobName || f.jobNum || '(no job name)';
    const matItems = (typeof parseMaterialField === 'function') ? parseMaterialField(f.material || '') : [];
    const matSummary = matItems.map(m => m.name + (m.tons ? ' '+m.tons+'T' : '')).join(', ') || '—';
    let td = {}; try { td = JSON.parse(f.trucking || '{}'); } catch(e) {}
    return `
      <div id="djrow_${i}" style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:14px 16px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1.5px;color:var(--stripe);">${dateFmt}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(jobName)}</div>
            <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">👷 ${escHtml(p.foreman)} · ${p.slot}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button onclick="djReviewBlock('${p.dateKey}','${p.slot}',${i})"
              style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;font-size:11px;color:var(--concrete-dim);padding:4px 10px;cursor:pointer;">
              ✎ Review
            </button>
            <button onclick="djApproveAndGenerate('${p.dateKey}','${p.slot}',${i})"
              style="background:var(--stripe);border:none;border-radius:3px;font-size:11px;color:#000;font-weight:700;padding:4px 12px;cursor:pointer;">
              ✓ Approve & Generate
            </button>
          </div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          ${f.plant ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">🏭 ${escHtml(f.plant)}</span>` : ''}
          ${matSummary !== '—' ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">🪨 ${escHtml(matSummary)}</span>` : ''}
          ${td.numTrucks||td.trucks ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">🚛 ${escHtml(String(td.numTrucks||td.trucks||'?'))} trucks</span>` : ''}
          ${f.tack ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">🟡 Tack: ${escHtml(String(f.tack))}</span>` : ''}
          ${f.rubber ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">⚫ Rubber: ${escHtml(String(f.rubber))}</span>` : ''}
        </div>
        <div id="djrow_extra_${i}"></div>
      </div>`;
  }).join('') : `<div style="padding:40px;text-align:center;color:var(--concrete-dim);font-size:13px;">
    <div style="font-size:32px;margin-bottom:8px;">✅</div>
    All jobs are up to date — no pending approvals.
  </div>`;

  overlay.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);width:min(820px,96vw);max-height:88vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:2px solid var(--asphalt-light);flex-shrink:0;">
        <span style="font-size:18px;">📋</span>
        <div style="flex:1;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:var(--white);">DJ Approval Queue</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);letter-spacing:.8px;">${pending.length} JOB${pending.length!==1?'S':''} PENDING APPROVAL</div>
        </div>
        <button onclick="document.getElementById('djApprovalPanel').remove()"
          style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:12px;padding:4px 10px;cursor:pointer;">✕ Close</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
        ${pendingRows}
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Review: show block details inline before approving ────────────────────
function djReviewBlock(dateKey, slot, rowIdx) {
  const bdata = (schedData[dateKey]||{})[slot] || {};
  const f = bdata.fields || {};
  const el = document.getElementById('djrow_extra_' + rowIdx);
  if (!el) return;
  if (el.dataset.open === '1') { el.innerHTML = ''; el.dataset.open = '0'; return; }
  el.dataset.open = '1';

  const matItems = (typeof parseMaterialField === 'function') ? parseMaterialField(f.material || '') : [];
  let td = {}; try { td = JSON.parse(f.trucking || '{}'); } catch(e) {}
  const truckList = (td.truckList || []);

  el.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:12px 14px;font-size:12px;display:flex;flex-direction:column;gap:6px;">
      <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:4px;">Full Block Details</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${Object.entries({ 'Plant': f.plant, 'Contact': f.contact, 'QC': f.qc, 'Tack': f.tack, 'Rubber': f.rubber, 'Equipment': f.equipment, 'Operators': f.operators, 'Notes': f.notes }).map(([k,v]) =>
          v ? `<div><span style="color:var(--concrete-dim);">${k}: </span><span style="color:var(--white);">${escHtml(String(v))}</span></div>` : ''
        ).join('')}
      </div>
      ${matItems.length ? `<div><span style="color:var(--concrete-dim);">Mix: </span>${matItems.map(m=>`<span style="color:var(--white);">${escHtml(m.name)}${m.tons?' ('+m.tons+'T)':''}</span>`).join(', ')}</div>` : ''}
      ${truckList.length ? `<div><span style="color:var(--concrete-dim);">Trucks: </span><span style="color:var(--white);">${truckList.map(t=>escHtml(t)).join(', ')}</span></div>` : ''}
    </div>`;
}

// ── Approve: mark approved, generate Foreman's Report + Tack & Rubber ────────
function djApproveAndGenerate(dateKey, slot, rowIdx) {
  const bdata = (schedData[dateKey] || {})[slot];
  if (!bdata) return;
  const f = bdata.fields || {};

  // Mark approved so it won't show again
  if (!schedData[dateKey]) schedData[dateKey] = {};
  schedData[dateKey][slot]._djApproved = true;
  saveSchedDataDirect();

  // Build and save foreman's report
  buildAndSaveForemansReport(dateKey, slot, bdata, f);

  // Build tack & rubber if applicable
  const hasTack   = f.tack   && String(f.tack).trim()   && String(f.tack).trim()   !== 'None';
  const hasRubber = f.rubber && String(f.rubber).trim() && String(f.rubber).trim() !== 'None';
  if (hasTack || hasRubber) {
    buildAndSaveTackRubber(dateKey, slot, f);
  }

  // Visual feedback
  const row = document.getElementById('djrow_' + rowIdx);
  if (row) {
    row.style.opacity = '0.5';
    row.style.pointerEvents = 'none';
    row.innerHTML += `<div style="text-align:center;padding:8px;font-size:12px;color:#7ecb8f;font-weight:600;">✅ Approved — reports generated</div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FOREMAN'S REPORT GENERATION
// Builds a DOCX matching Foremans_Report_Template.xlsx structure
// ════════════════════════════════════════════════════════════════════════════
function buildAndSaveForemansReport(dateKey, slot, bdata, f) {
  const foreman = slot === 'top' ? 'Filipe Joaquim' :
                  slot === 'bottom' ? 'Louie Medeiros' :
                  (bdata.foreman || 'Unknown');

  const parts  = dateKey.split('-');
  const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  const dateLong = dateObj.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Parse job name: "GC Name — Project Name"
  const jobNameFull = f.jobName || '';
  let gcName = '', projectName = '';
  if (jobNameFull.includes(' \u2014 ')) {
    gcName = jobNameFull.split(' \u2014 ')[0];
    projectName = jobNameFull.split(' \u2014 ').slice(1).join(' \u2014 ');
  } else { projectName = jobNameFull; }

  // Parse materials
  const matItems = (typeof parseMaterialField === 'function') ? parseMaterialField(f.material || '') : [];

  // Parse trucking
  let td = {}; try { td = JSON.parse(f.trucking || '{}'); } catch(e) {}
  const truckList  = td.truckList  || [];
  const numTrucks  = td.numTrucks  || td.trucks || '';
  const loadTime   = td.loadTime   || '';
  const spacing    = td.spacing    || '';

  // Tack & Rubber
  const tackGallons  = (f.tack   && f.tack   !== 'Others' && f.tack   !== 'None') ? f.tack   : '';
  const rubberLinFt  = (f.rubber && f.rubber !== 'Others' && f.rubber !== 'None') ? f.rubber : '';

  // Build the DOCX document using the existing makeRun/makeDocx infrastructure
  const xml = buildForemansReportDocx({
    date: dateLong, dateKey,
    foreman, gcName, projectName,
    jobNum: f.jobNum || '',
    jobLocation: f.contact || '',  // using contact as location
    plant: f.plant || '',
    startTime: '', endTime: '',
    operators: f.operators || '', equipment: f.equipment || '',
    matItems, truckList, numTrucks, loadTime, spacing,
    tackGallons, rubberLinFt,
    tack: f.tack || '', rubber: f.rubber || '',
    notes: (schedData[dateKey]?.dayNote || '') + (f.notes ? '\n' + f.notes : ''),
  });

  const blob = buildDocxBlob(xml);

  const foremanParts = foreman.trim().split(/\s+/);
  const foremanTag = foremanParts[0] + (foremanParts[1] ? '.' + foremanParts[1] : '');
  const shortDate = (parseInt(parts[1])) + '.' + parseInt(parts[2]) + '.' + parts[0].slice(-2);
  const gc   = gcName || 'NoGC';
  const proj = projectName || jobNameFull || 'NoProject';
  const fileName = (foremanTag + '. ' + shortDate + ' ' + gc + '. ' + proj + ' - Foreman Report')
    .replace(/[\/\\:*?"<>|]/g, '').substring(0, 100) + '.docx';

  const reader = new FileReader();
  reader.onloadend = function() {
    const order = {
      id: 'fr_' + Date.now().toString(),
      dateKey, slot, foreman, gcName, jobName: proj,
      jobNo: f.jobNum || '', dateOfWork: dateKey,
      fileName, createdAt: new Date().toLocaleString('en-US'),
      blob64: reader.result, type: 'foreman_report',
      djApproved: true, approvedAt: Date.now(),
      approvedBy: localStorage.getItem('dmc_u') || '',
    };
    dailyOrders.unshift(order);
    if (dailyOrders.length > 300) dailyOrders = dailyOrders.slice(0, 300);
    localStorage.setItem(DAILY_ORDERS_KEY, JSON.stringify(dailyOrders.map(o => ({...o, blob64: undefined}))));
    _checkLocalStorageSize();
    fbSet('daily_orders', dailyOrders.map(o => ({...o, blob64: undefined})));
    if (activeTab === 'reports' || activeTab === 'reportsDailyOrders') renderReports();
    // Also add to QC reports folder as a Foreman's Report type
    const qcEntry = {
      id: 'frqc_' + Date.now().toString(),
      jobName: proj, jobNo: f.jobNum || '', gcName,
      fileName, fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uploadedBy: foreman, uploadedAt: Date.now(),
      note: 'Auto-generated from DJ approval',
      reportType: 'foreman_report',
    };
    if (typeof qcReports !== 'undefined') {
      // Upload blob to storage
      const file = new File([blob], fileName, { type: qcEntry.fileType });
      if (typeof uploadFileToStorage === 'function') {
        uploadFileToStorage(file, 'foreman_reports').then(({url, path}) => {
          qcEntry.fileUrl = url;
          qcEntry.storagePath = path;
        }).catch(() => {
          // Upload failed — save entry without storage URL
        }).finally(() => {
          qcReports.unshift(qcEntry);
          saveQCReports();
        });
      } else {
        qcReports.unshift(qcEntry);
        saveQCReports();
      }
    }
  };
  reader.readAsDataURL(blob);
}

// ── Foreman's Report DOCX builder ────────────────────────────────────────────
function buildForemansReportDocx(d) {
  // Helper
  const row = (label, value, bold) =>
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${makeP(makeRun(label,{bold:true,size:18}))}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="7000" w:type="dxa"/></w:tcPr>${makeP(makeRun(value||'',{size:18}))}</w:tc></w:tr>`;

  // Section header row
  const secHdr = (label) =>
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="10000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="1F1F1F"/><w:gridSpan w:val="2"/></w:tcPr>` +
    `${makeP(makeRun(label,{bold:true,size:20,color:'F5C518'}))}</w:tc></w:tr>`;

  // Mat items grid
  const matRows = d.matItems.length ? d.matItems.map(m =>
    `<w:tr>
      <w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${makeP(makeRun(m.name||'',{size:18}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${makeP(makeRun(m.tons?m.tons+'T':'',{size:18}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${makeP(makeRun('',{size:18}))}</w:tc>
    </w:tr>`).join('') :
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="10000" w:type="dxa"/><w:gridSpan w:val="3"/></w:tcPr>${makeP(makeRun('No mix material recorded',{size:18}))}</w:tc></w:tr>`;

  // Truck rows
  const truckRows = Array.from({length: Math.max(d.truckList.length, 5)}).map((_, i) => {
    const name = d.truckList[i] || '';
    return `<w:tr>
      <w:tc><w:tcPr><w:tcW w:w="500" w:type="dxa"/></w:tcPr>${makeP(makeRun(String(i+1)+')',{size:17}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${makeP(makeRun(name,{size:17}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${makeP(makeRun('',{size:17}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${makeP(makeRun('',{size:17}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${makeP(makeRun('',{size:17}))}</w:tc>
      <w:tc><w:tcPr><w:tcW w:w="700" w:type="dxa"/></w:tcPr>${makeP(makeRun('',{size:17}))}</w:tc>
    </w:tr>`;
  }).join('');

  const tableXml = `
<w:tbl>
<w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:left w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:right w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:insideV w:val="single" w:sz="4" w:space="0" w:color="444444"/>
</w:tblBorders></w:tblPr>
${secHdr('DON MARTIN CORP — FOREMAN\'S REPORT')}
${row('Date', d.date)}
${row('General Contractor', d.gcName)}
${row('Job Name', d.projectName)}
${row('Job Number', d.jobNum)}
${row('Plant Location', d.plant)}
${row('Start Time', d.startTime)}
${row('End Time', d.endTime)}
${secHdr('CREW')}
${row('Foreman', d.foreman)}
${row('Operators', d.operators)}
${row('Equipment', d.equipment)}
${secHdr('MIX PRODUCTION')}
<w:tr>
<w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${makeP(makeRun('Mix Type',{bold:true,size:18}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${makeP(makeRun('Tons Ordered',{bold:true,size:18}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${makeP(makeRun('Tons Actual',{bold:true,size:18}))}</w:tc>
</w:tr>
${matRows}
${secHdr('TACK COAT & HOT RUBBER')}
${row('Tack Coat (DMC/Others)', d.tack||'N/A')}
${row('Tack Coat Gallons', d.tackGallons||'—')}
${row('Hot Rubber (DMC/Others)', d.rubber||'N/A')}
${row('Hot Rubber Lineal Feet', d.rubberLinFt||'—')}
${secHdr('TRUCKING')}
${row('Number of Trucks', String(d.numTrucks||''))}
${row('Load Time', d.loadTime||'')}
${row('Spacing', d.spacing||'')}
<w:tr>
<w:tc><w:tcPr><w:tcW w:w="500" w:type="dxa"/></w:tcPr>${makeP(makeRun('#',{bold:true,size:17}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${makeP(makeRun('Truck Name',{bold:true,size:17}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${makeP(makeRun('Start',{bold:true,size:17}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${makeP(makeRun('End',{bold:true,size:17}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${makeP(makeRun('Tri',{bold:true,size:17}))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="700" w:type="dxa"/></w:tcPr>${makeP(makeRun('TRL',{bold:true,size:17}))}</w:tc>
</w:tr>
${truckRows}
${secHdr('NOTES / DELAYS')}
<w:tr><w:tc><w:tcPr><w:tcW w:w="10000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>${makeP(makeRun(d.notes||'',{size:18}))}</w:tc></w:tr>
</w:tbl>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${makeDocxLetterhead("DON MARTIN CORP — FOREMAN'S REPORT")}
${tableXml}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
</w:body></w:document>`;
}

// ════════════════════════════════════════════════════════════════════════════
// TACK & RUBBER REPORT GENERATION
// Matches Tack_and_Rubber_Template.xlsx
// ════════════════════════════════════════════════════════════════════════════
function buildAndSaveTackRubber(dateKey, slot, f) {
  const parts  = dateKey.split('-');
  const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  const dateFmt = dateObj.toLocaleDateString('en-US', { month:'numeric', day:'numeric', year:'numeric' });

  const jobNameFull = f.jobName || '';
  let gcName = '', projectName = '';
  if (jobNameFull.includes(' \u2014 ')) {
    gcName = jobNameFull.split(' \u2014 ')[0];
    projectName = jobNameFull.split(' \u2014 ').slice(1).join(' \u2014 ');
  } else { projectName = jobNameFull; }

  const hasTack   = f.tack   && String(f.tack).trim()   !== '' && String(f.tack).trim()   !== 'None';
  const hasRubber = f.rubber && String(f.rubber).trim() !== '' && String(f.rubber).trim() !== 'None';

  // We build a plain DOCX matching the ticket layout
  const tr = (row, label, value, bold) => `
<w:tr><w:tc><w:tcPr><w:tcW w:w="3500" w:type="dxa"/></w:tcPr>
${makeP(makeRun(label,{bold:true,size:20}))}
</w:tc><w:tc><w:tcPr><w:tcW w:w="6500" w:type="dxa"/></w:tcPr>
${makeP(makeRun(value||'',{size:20}))}
</w:tc></w:tr>`;

  const tackSection = hasTack ? `
${tr(null,'TACK COAT','',true)}
${tr(null,'MATERIAL','TACK COAT')}
${tr(null,'GALLONS',String(f.tack||''))}
` : '';

  const rubberSection = hasRubber ? `
${tr(null,'HOT RUBBER','',true)}
${tr(null,'MATERIAL','HOT RUBBER')}
${tr(null,'LINEAL FEET',String(f.rubber||''))}
` : '';

  const tableXml = `
<w:tbl>
<w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:left w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:right w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="444444"/>
<w:insideV w:val="single" w:sz="4" w:space="0" w:color="444444"/>
</w:tblBorders></w:tblPr>
<w:tr><w:tc><w:tcPr><w:tcW w:w="10000" w:type="dxa"/><w:gridSpan w:val="2"/>
<w:shd w:val="clear" w:color="auto" w:fill="1F1F1F"/></w:tcPr>
${makeP(makeRun('475 SCHOOL ST - ALDEN CROSSING UNIT #6  ·  MARSHFIELD, MA 02050  ·  (781) 834-0071',{bold:true,size:18,color:'F5C518'}))}</w:tc></w:tr>
${tr(null,'DATE',dateFmt)}
${tr(null,'JOB #',f.jobNum||'')}
${tr(null,'JOB NAME',projectName||jobNameFull)}
${tackSection}
${rubberSection}
<w:tr><w:tc><w:tcPr><w:tcW w:w="10000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>
${makeP(makeRun('THIS IS TO CERTIFY THAT THE PRODUCTS UNDER THIS TICKET NUMBER CONFORM TO THE SPECIFICATIONS REQUIRED FOR THE MATERIAL INDICATED.',{size:17,bold:true}))}</w:tc></w:tr>
${tr(null,'ACCEPTED BY','')}
${tr(null,'RECEIVED BY','')}
${tr(null,'TITLE','')}
</w:tbl>`;

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${makeDocxLetterhead('DON MARTIN CORP — TACK & RUBBER CERTIFICATE')}
${tableXml}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
</w:body></w:document>`;

  const blob = buildDocxBlob(xml);
  const shortDate = parseInt(parts[1]) + '.' + parseInt(parts[2]) + '.' + parts[0].slice(-2);
  const fileName = ('TackRubber.' + shortDate + ' ' + (gcName||'').replace(/[\/\\:*?"<>|]/g,'') + '.' + (projectName||'').replace(/[\/\\:*?"<>|]/g,''))
    .substring(0,100) + '.docx';

  const reader = new FileReader();
  reader.onloadend = function() {
    const entry = {
      id: 'tr_' + Date.now().toString(),
      dateKey, slot, dateOfWork: dateKey,
      jobName: projectName, jobNo: f.jobNum || '', gcName,
      fileName, createdAt: new Date().toLocaleString('en-US'),
      blob64: reader.result, type: 'tack_rubber',
    };
    dailyOrders.unshift(entry);
    localStorage.setItem(DAILY_ORDERS_KEY, JSON.stringify(dailyOrders.map(o => ({...o, blob64: undefined}))));
    _checkLocalStorageSize();
    fbSet('daily_orders', dailyOrders.map(o => ({...o, blob64: undefined})));
  };
  reader.readAsDataURL(blob);
}

// ── Helper: make a Word paragraph ────────────────────────────────────────────
function makeP(innerRuns) {
  return `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${innerRuns}</w:p>`;
}

function showDailyOrderToast(orderType, fileName) {
  var old = document.getElementById('_dailyOrderToast');
  if (old) old.remove();
  var label = orderType === 'amrize' ? 'Aggregate Industries' : 'DMC';
  var color = orderType === 'amrize' ? '#3d9e6a' : '#5ab4f5';
  var bg    = orderType === 'amrize' ? 'rgba(61,158,106,0.12)' : 'rgba(90,180,245,0.12)';
  var t = document.createElement('div');
  t.id = '_dailyOrderToast';
  t.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:9999;background:#181f18;border:1px solid '+color+';border-radius:10px;padding:13px 16px 13px 14px;display:flex;align-items:flex-start;gap:12px;box-shadow:0 6px 28px rgba(0,0,0,0.55);font-family:"DM Sans",sans-serif;min-width:280px;max-width:360px;animation:toast-slide-in 0.25s ease;';
  t.innerHTML =
    '<span style="font-size:22px;line-height:1;margin-top:1px;">📋</span>' +
    '<div style="flex:1;">' +
      '<div style="font-size:13px;font-weight:800;color:'+color+';letter-spacing:0.3px;">Daily Order Saved</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:3px;line-height:1.4;">'+label+' order generated and stored in the<br><strong style="color:rgba(255,255,255,0.85);">Daily Orders</strong> directory.</div>' +
    '</div>' +
    '<button onclick="document.getElementById(\'_dailyOrderToast\')?.remove()" style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:13px;cursor:pointer;padding:0;line-height:1;margin-top:1px;" onmouseover="this.style.color=\'rgba(255,255,255,0.7)\'" onmouseout="this.style.color=\'rgba(255,255,255,0.3)\'">✕</button>';
  document.body.appendChild(t);
  setTimeout(function() {
    if (!t.parentNode) return;
    t.style.transition = 'opacity 0.4s, transform 0.4s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    setTimeout(function() { t.remove(); }, 420);
  }, 5000);
}

function _showLookaheadToast(supplier, dateRange) {
  var old = document.getElementById('_lookaheadToast');
  if (old) old.remove();
  var t = document.createElement('div');
  t.id = '_lookaheadToast';
  t.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:9999;background:#181a22;border:1px solid #7b6af5;border-radius:10px;padding:13px 16px 13px 14px;display:flex;align-items:flex-start;gap:12px;box-shadow:0 6px 28px rgba(0,0,0,0.55);font-family:"DM Sans",sans-serif;min-width:280px;max-width:380px;animation:toast-slide-in 0.25s ease;';
  t.innerHTML =
    '<span style="font-size:22px;line-height:1;margin-top:1px;">📊</span>' +
    '<div style="flex:1;">' +
      '<div style="font-size:13px;font-weight:800;color:#a89cf7;letter-spacing:0.3px;">2-Week Lookahead Saved</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:3px;line-height:1.4;"><strong style="color:rgba(255,255,255,0.85);">' + supplier + '</strong> — ' + dateRange + '<br>Stored in the <strong style="color:rgba(255,255,255,0.85);">2 Week Lookaheads</strong> directory.</div>' +
    '</div>' +
    '<button onclick="document.getElementById(\'_lookaheadToast\')?.remove()" style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:13px;cursor:pointer;padding:0;line-height:1;margin-top:1px;" onmouseover="this.style.color=\'rgba(255,255,255,0.7)\'" onmouseout="this.style.color=\'rgba(255,255,255,0.3)\'">✕</button>';
  document.body.appendChild(t);
  setTimeout(function() {
    if (!t.parentNode) return;
    t.style.transition = 'opacity 0.4s, transform 0.4s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    setTimeout(function() { t.remove(); }, 420);
  }, 5000);
}

function buildDailyOrder(dateKey, slot) {
  console.log('[Order] buildDailyOrder called, dateKey:', dateKey, 'slot:', slot);
  var bdata;
  if (slot.startsWith('extra_')) {
    var _idx = parseInt(slot.replace('extra_', ''));
    bdata = schedData[dateKey]?.extras?.[_idx]?.data || { type:'blank', fields:{} };
  } else {
    bdata = (schedData[dateKey]||{})[slot] || { type:'blank', fields:{} };
  }
  var fields = bdata.fields || {};
  console.log('[Order] fields:', JSON.stringify(fields).slice(0,200));
  console.log('[Order] plant value:', fields && fields.plant);
  console.log('[Order] calling _isAmrizePlant:', typeof _isAmrizePlant);
  var foreman = slot === 'top' ? 'Filipe Joaquim'
    : slot === 'bottom' ? 'Louie Medeiros'
    : (slot.startsWith('extra_') ? (schedData[dateKey]?.extras?.[parseInt(slot.replace('extra_',''))]?.foreman || 'Extra Crew') : 'Louie Medeiros');
  var parts = dateKey.split('-');
  var yr = parts[0], mo = parts[1], dy = parts[2];
  var dateObj = new Date(parseInt(yr), parseInt(mo)-1, parseInt(dy));
  var orderDate = dateObj.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  var v = function(k) { return fields[k] || ''; };
  var jobNameFull = v('jobName');
  var gcName = '', projectName = '';
  if (jobNameFull.indexOf(' \u2014 ') >= 0) {
    gcName = jobNameFull.split(' \u2014 ')[0];
    projectName = jobNameFull.split(' \u2014 ').slice(1).join(' \u2014 ');
  } else { projectName = jobNameFull; }

  var shortYr = yr.slice(-2);
  var d = mo + '.' + dy + '.' + shortYr;
  var gc   = gcName || 'NoGC';
  var proj = projectName || v('jobName') || 'NoProject';
  var isNight = (bdata.type || '').toLowerCase() === 'night';
  var nightSuffix = isNight ? '.Night Work' : '';
  var primaryPlant = v('plant');
  var isAmrize = _isAmrizePlant(primaryPlant);
  console.log('[Amrize] plant check:', JSON.stringify(primaryPlant), '→', isAmrize, '| hardcoded test:', _isAmrizePlant('Amrize - Dennis'));

  // ── Find second stops for this slot (extras with matching parentSlot) ──────
  // Second stops only apply to top/bottom foreman slots, not to independent extras
  var secondStops = [];
  if (slot === 'top' || slot === 'bottom') {
    var allExtras = ((schedData[dateKey]||{}).extras) || [];
    secondStops = allExtras.filter(function(ex) { return ex.parentSlot === slot; });
  }

  // Partition second stops: same supplier → right column on same sheet
  //                         different supplier → separate sheet
  var sameSupplierStops = secondStops.filter(function(ex) {
    var sPlant = (ex.data && ex.data.fields && ex.data.fields.plant) || '';
    return _isSameSupplier(primaryPlant, sPlant);
  });
  var diffSupplierStops = secondStops.filter(function(ex) {
    var sPlant = (ex.data && ex.data.fields && ex.data.fields.plant) || '';
    return !_isSameSupplier(primaryPlant, sPlant);
  });

  // Right column: first same-supplier second stop (if any)
  var secondFields = sameSupplierStops.length > 0 ? (sameSupplierStops[0].data && sameSupplierStops[0].data.fields) || null : null;

  // ── Helper: save one HTML order and create its invoice entry ────────────────
  function _saveOneOrder(html, fName, plant, flds, jNameFull, gcN, projN, delayMs) {
    var orderIsAmrize = _isAmrizePlant(plant);
    setTimeout(function() {
      var htmlBlob = new Blob([html], { type: 'text/html' });
      var reader = new FileReader();
      reader.onloadend = function() {
        var order = {
          id: (Date.now() + delayMs).toString(),
          dateKey: dateKey,
          dateOfWork: dateKey,
          foreman: foreman,
          gcName: gcN,
          jobName: projN,
          supplier: plant || '',
          fileName: fName,
          orderType: orderIsAmrize ? 'amrize' : 'dmc',
          createdAt: new Date().toLocaleString('en-US'),
          blob64: reader.result
        };
        dailyOrders.unshift(order);
        if (dailyOrders.length > 200) dailyOrders = dailyOrders.slice(0, 200);
        localStorage.setItem(DAILY_ORDERS_KEY, JSON.stringify(dailyOrders));
        _checkLocalStorageSize();
        try {
          if (typeof fbSet === 'function') {
            fbSet('daily_orders', dailyOrders.map(function(o){ return Object.assign({}, o, {blob64: undefined}); }));
          }
        } catch(e) { console.warn('[DailyOrder] Firestore sync failed:', e); }
        if (activeTab === 'reports' || activeTab === 'reportsDailyOrders') renderReports();
        showDailyOrderToast(order.orderType, order.fileName);

        // Auto-create invoice tracker entry
        (function() {
          var jobNo    = (flds && flds.jobNum)  || '';
          var supplier = (flds && flds.plant)   || '';
          var jobName  = jNameFull || projN;
          var invEntry = {
            id:         'do_' + (Date.now() + delayMs).toString(),
            dateOfWork: dateKey,
            invoiceNo:  '',
            foreman:    foreman,
            jobNo:      jobNo,
            supplier:   supplier,
            jobName:    jobName,
            gcName:     gcN,
            mixItems:   [{ mixType:'', mixPrice:'', itemTotal:'' }],
            updatedAt:  Date.now(),
            fromDailyOrder: true
          };
          var exists = invoiceList.some(function(i) {
            return i.dateOfWork === dateKey && i.foreman === foreman && i.jobNo === jobNo;
          });
          if (!exists) {
            invoiceList.unshift(invEntry);
            saveInvoiceList();
            if (activeTab === 'apMix') renderInvoiceTracker();
            pushNotif('info', '🧾 Invoice Entry Created',
              'A new entry was added to the Sales Invoice & Trucking Tracker for ' + dateKey + '.', null);
          }
        })();
      };
      reader.readAsDataURL(htmlBlob);
    }, delayMs);
  }

  // ── Build and save primary order (right col = same-supplier second stop) ────
  console.log('[Order] isAmrize result:', _isAmrizePlant(fields.plant), 'plant:', fields.plant);
  console.log('[Order] about to choose builder...');
  var html;
  if (isAmrize) {
    console.log('[Order] CHOSE AMRIZE builder');
    html = buildAmrizeOrderHTML(fields, dateKey, foreman, secondFields);
  } else {
    console.log('[Order] CHOSE DMC builder');
    html = buildDMCOrderHTML(fields, orderDate, foreman, secondFields);
  }
  var fileName = (foreman + '.' + d + '.' + gc + ' ' + proj + nightSuffix)
    .replace(/[/\\:*?"<>|]/g, '').substring(0, 100) + '.html';
  _saveOneOrder(html, fileName, primaryPlant, fields, jobNameFull, gc, proj, 0);

  // ── Build and save separate orders for different-supplier second stops ──────
  diffSupplierStops.forEach(function(ex, i) {
    var sf = (ex.data && ex.data.fields) || {};
    var sv = function(k) { return sf[k] || ''; };
    var sPlant = sv('plant');
    var sjn = sv('jobName'), sgc2 = '', sproj2 = '';
    if (sjn.indexOf(' \u2014 ') >= 0) { sgc2 = sjn.split(' \u2014 ')[0]; sproj2 = sjn.split(' \u2014 ').slice(1).join(' \u2014 '); }
    else { sproj2 = sjn; }
    var sIsAmrize = _isAmrizePlant(sPlant);
    var sHtml = sIsAmrize
      ? buildAmrizeOrderHTML(sf, dateKey, foreman, null)
      : buildDMCOrderHTML(sf, orderDate, foreman, null);
    var sFileName = (foreman + '.' + d + '.' + (sgc2||'NoGC') + ' ' + (sproj2||sv('jobName')||'NoProject') + '.2ndStop')
      .replace(/[/\\:*?"<>|]/g, '').substring(0, 100) + '.html';
    _saveOneOrder(sHtml, sFileName, sPlant, sf, sjn, sgc2||'NoGC', sproj2||sv('jobName')||'NoProject', (i + 1) * 80);
  });
}
// ── 2 Week Lookahead ──
const LOOKAHEADS_KEY = 'pavescope_lookaheads';
var lookaheads = (function(){ try { const p = JSON.parse(localStorage.getItem(LOOKAHEADS_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();
// { id, supplier, dateRange, createdAt, imageData (base64 png) }

const JOB_MIX_FORMULAS_KEY = 'pavescope_job_mix_formulas';
var jobMixFormulas = (function(){ try { const p = JSON.parse(localStorage.getItem(JOB_MIX_FORMULAS_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();
var jobMixViewMode = 'cards'; // 'cards' | 'supplier'
var jobMixSupplierCollapsed = {};

function saveJobMixFormulas() {
  const slim = jobMixFormulas.map(j => {
    const { fileData, ...rest } = j;
    return rest;
  });
  localStorage.setItem(JOB_MIX_FORMULAS_KEY, JSON.stringify(slim));
  _checkLocalStorageSize();
  try { if (db) fbSet('job_mix_formulas', slim); } catch(e) { _logFbError('saveJobMixFormulas', e); }
}


// Returns { colW, blockH } — both dimensions driven by the busiest block in the week
function getWeekMetrics(week) {
  const BASE_W = 311;
  const CHIP_W = 82;
  const CHIPS_BEFORE_EXPAND = 2;

  // Height constants (px per content unit)
  const BASE_H        = 220;  // minimum block height
  const ROW_H         = 22;   // height per sched-field row
  const HEADER_H      = 34;   // foreman header
  const TYPE_BTNS_H   = 28;   // type buttons strip
  const CHIP_ROW_H    = 24;   // height per wrapped chip row
  const CHIPS_PER_ROW = 3;    // chips that fit per row at base width
  const NOTE_LINE_H   = 16;   // per ~40-char note chunk

  let maxChips = 0;
  let maxBlockH = BASE_H;

  week.forEach(d => {
    if (!d) return;
    const key = dk(d);
    const dayData = schedData[key] || {};
    const allSlots = ['top','bottom'];
    const extras = dayData.extras || [];
    extras.forEach((_, i) => allSlots.push('extra_' + i));

    allSlots.forEach(slot => {
      let bdata;
      if (slot.startsWith('extra_')) {
        const idx = parseInt(slot.replace('extra_',''));
        bdata = extras[idx]?.data;
      } else {
        bdata = dayData[slot];
      }
      if (!bdata || !bdata.fields) return;
      const f = bdata.fields;

      // Width: driven by material chips
      try {
        const mats = JSON.parse(f.material || '[]');
        if (Array.isArray(mats)) maxChips = Math.max(maxChips, mats.length);
      } catch(e) {}

      // Height: count up every row of content
      let h = HEADER_H + TYPE_BTNS_H;

      // Fixed single-line fields (always present in BLOCK_FIELDS order)
      // jobName, jobNum, plant, qc, tack, rubber, trucking, contact, notes, location
      const singleFields = ['jobName','jobNum','plant','location','contact','qc','tack','rubber'];
      singleFields.forEach(k => { if (f[k]) h += ROW_H; else h += ROW_H * 0.6; });

      // Operators (chips, wrap to rows)
      const ops = f.operators ? f.operators.split(',').filter(Boolean).length : 0;
      h += ROW_H + Math.ceil(ops / CHIPS_PER_ROW) * CHIP_ROW_H;

      // Equipment (chips)
      const equip = f.equipment ? f.equipment.split(',').filter(Boolean).length : 0;
      h += ROW_H + Math.ceil(equip / CHIPS_PER_ROW) * CHIP_ROW_H;

      // Material (chips — can wrap more)
      let mCount = 0;
      try { const mats = JSON.parse(f.material||'[]'); mCount = Array.isArray(mats)?mats.length:0; } catch(e){}
      h += ROW_H + Math.ceil(mCount / 2) * CHIP_ROW_H;

      // Trucking (label + up to 3 meta chips)
      const hasTrucking = !!f.trucking && f.trucking !== '{}';
      h += hasTrucking ? ROW_H + CHIP_ROW_H : ROW_H;

      // Notes (multi-line)
      const noteLen = (f.notes||'').length;
      if (noteLen > 0) h += ROW_H + Math.ceil(noteLen / 40) * NOTE_LINE_H;

      maxBlockH = Math.max(maxBlockH, Math.round(h));
    });
  });

  const colW = maxChips <= CHIPS_BEFORE_EXPAND ? BASE_W : BASE_W + (maxChips - CHIPS_BEFORE_EXPAND) * CHIP_W;
  return { colW, blockH: maxBlockH };
}

// Kept for backwards compat
function getWeekColWidth(week) { return getWeekMetrics(week).colW; }

function open2WeekLookahead() {
  console.log('[DIAG] lookaheads at open:', JSON.stringify(lookaheads));
  document.getElementById('lookaheadModal')?.remove();

  if (!suppliersList.length) {
    alert('No suppliers found. Add suppliers in ⚙️ Settings → 🏭 Suppliers first.');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'lookaheadModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:7000;display:flex;align-items:center;justify-content:center;padding:24px;';
  modal.innerHTML = `
    <div class="modal" style="max-width:440px;">
      <div class="modal-title" style="margin-bottom:16px;">📋 2 Week Lookahead</div>
      <div style="font-size:13px;color:var(--concrete-dim);margin-bottom:16px;">
        Select a supplier to generate a 2-week lookahead. All plants for that supplier will be included in the report.
      </div>
      <div class="form-group">
        <label class="form-label">Supplier</label>
        <select id="lookaheadSupplierSelect" class="form-input" style="cursor:pointer;">
          <option value="">— Select a supplier —</option>
          ${suppliersList.map(s => `<option value="${s.name.replace(/"/g,'&quot;')}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="modal-actions" style="margin-top:20px;">
        <button class="btn btn-ghost" onclick="document.getElementById('lookaheadModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="confirmLookahead()">Generate Lookahead</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('lookaheadSupplierSelect')?.focus(), 60);
}

function confirmLookahead() {
  const sel = document.getElementById('lookaheadSupplierSelect');
  const supplier = sel?.value;
  if (!supplier) { sel?.focus(); return; }

  document.getElementById('lookaheadModal').remove();

  // Show confirm dialog
  const modal = document.createElement('div');
  modal.id = 'lookaheadModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:7000;display:flex;align-items:center;justify-content:center;padding:24px;';

  const today = new Date();
  today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const end = new Date(today); end.setDate(today.getDate() + 14);
  const fmt = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const dateRange = `${fmt(tomorrow)} — ${fmt(end)}`;

  modal.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div class="modal-title" style="margin-bottom:12px;">📋 Create 2 Week Lookahead</div>
      <div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:14px;margin-bottom:16px;">
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);margin-bottom:4px;">SUPPLIER</div>
        <div style="font-size:14px;font-weight:700;color:var(--white);">🏭 ${supplier}</div>
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);margin-top:10px;margin-bottom:4px;">DATE RANGE</div>
        <div style="font-size:13px;color:var(--concrete);">${dateRange}</div>
      </div>
      <div style="font-size:13px;color:var(--concrete-dim);margin-bottom:20px;">
        Jobs scheduled with <strong style="color:var(--white);">${supplier}</strong> will be highlighted. All other jobs in the 2-week window will be blacked out. Days before today and after 2 weeks are left unchanged.
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="document.getElementById('lookaheadModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="activateLookahead('${supplier.replace(/'/g,"\\'")}','${dateRange}')">✓ Yes, Generate</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

function activateLookahead(supplier, dateRange) {
  document.getElementById('lookaheadModal')?.remove();
  lookaheadActiveSupplier = supplier;
  renderSchedule();

  // After render, capture the 2-week window and save to reports
  setTimeout(() => captureLookaheadAndSave(supplier, dateRange), 400);
}

function getLookahead2WeekKeys() {
  const keys = new Set();
  const today = new Date();
  today.setHours(0,0,0,0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    keys.add(dk(d));
  }
  return keys;
}

function isBlockHighlightedForSupplier(key, slot, supplier) {
  // Get plant field value for this block
  let plant = '';
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    plant = schedData[key]?.extras?.[idx]?.data?.fields?.plant || '';
  } else {
    plant = ((schedData[key]||{})[slot]||{}).fields?.plant || '';
  }
  if (!plant.trim()) return false;
  // Check if the plant field value matches the supplier (contains the supplier name or vice versa)
  const plantLower = plant.toLowerCase();
  const supplierLower = supplier.toLowerCase();
  // Find the supplier record and check if any of its plants match the block's plant field
  const supRecord = suppliersList.find(s => s.name.toLowerCase() === supplierLower);
  if (supRecord) {
    // Check if the block's plant field matches any plant under this supplier
    return supRecord.plants.some(p => {
      const full = (supRecord.name + ' — ' + p).toLowerCase();
      return plantLower.includes(supRecord.name.toLowerCase()) || full === plantLower ||
             plantLower.includes(p.toLowerCase());
    });
  }
  // Fallback: match on supplier name anywhere in the plant field
  return plantLower.includes(supplierLower) || supplierLower.includes(plantLower.split('—')[0].trim().toLowerCase());
}

/**
 * nextLookaheadNum(supplier)
 * Returns the next sequential lookahead number for a given supplier,
 * based on how many lookaheads already exist for that supplier.
 */
function nextLookaheadNum(supplier) {
  if (!Array.isArray(lookaheads)) { lookaheads = []; }
  const supplierLower = supplier.toLowerCase();
  const existing = lookaheads.filter(l => l.supplier && l.supplier.toLowerCase() === supplierLower);
  return existing.length + 1;
}

async function captureLookaheadAndSave(supplier, dateRange) {
  if (!Array.isArray(lookaheads)) { lookaheads = []; }
  // Build HTML preview of the 2-week window
  const htmlPreview = buildLookaheadHTML(supplier, dateRange);

  // Compute the per-supplier sequence number BEFORE pushing to the array
  const num = nextLookaheadNum(supplier);

  // File name format: "2 Week Look Ahead #<N> <dateRange>"
  // sanitise dateRange for use as a filename (replace — with -, strip illegal chars)
  const safeDateRange = dateRange.replace(/\u2014/g, '-').replace(/[/\\:*?"<>|]/g, '').trim();
  const safeSupplier = supplier.replace(/[/\\:*?"<>|]/g, '').trim();
  const fileName = `${safeSupplier} — 2 Week Lookahead #${num} ${safeDateRange}.html`;

  const id = Date.now().toString();
  const lookahead = {
    id,
    supplier,
    dateRange,
    num,
    fileName,
    createdAt: new Date().toLocaleString('en-US'),
    htmlData: htmlPreview
  };

  lookaheads.unshift(lookahead);
  if (lookaheads.length > 50) lookaheads = lookaheads.slice(0, 50);
  localStorage.setItem(LOOKAHEADS_KEY, JSON.stringify(lookaheads.map(l => ({...l}))));
  _checkLocalStorageSize();

  // Show success notification
  pushNotif('success', '2 Week Lookahead Created',
    `Lookahead for ${supplier} saved to Reports → 2 Week Lookaheads.`, null);
  _showLookaheadToast(supplier, dateRange);

  if (activeTab === 'reports') renderReports();
}

function buildLookaheadHTML(supplier, dateRange) {
  console.log('[Lookahead] function called');
  const today = new Date(); today.setHours(0,0,0,0);
  const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Use draft data if in edit mode, otherwise use published schedData
  const sourceData = (schedEditMode && schedDraft) ? schedDraft : schedData;

  // Collect 14 days starting from tomorrow
  const days = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({ d, key: dk(d), isWeekend: d.getDay()===0||d.getDay()===6 });
  }

  // Extract supplier company name for matching (before the —)
  const supplierCompany = supplier.split('—')[0].trim().toLowerCase();

  function plantMatchesSupplier(plant) {
    if (!plant || !plant.trim()) return false;
    const p = plant.toLowerCase();
    return p.includes(supplierCompany) || supplierCompany.includes(p.split('—')[0].trim());
  }

  function getBlockData(key, slot) {
    if (slot.startsWith('extra_')) {
      const idx = parseInt(slot.replace('extra_',''));
      const ex = sourceData[key]?.extras?.[idx];
      return { fields: ex?.data?.fields || {}, type: ex?.data?.type || 'blank' };
    }
    const b = (sourceData[key]||{})[slot] || {};
    return { fields: b.fields || {}, type: b.type || 'blank' };
  }

  function blockCardHTML(key, slot, foremanName) {
    const { fields, type } = getBlockData(key, slot);
    const hasWork = type !== 'blank' || Object.values(fields).some(v => v && String(v).trim());
    const isSupplierMatch = plantMatchesSupplier(fields.plant || '');
    const isBlackedOut = hasWork && !isSupplierMatch;

    // Pull real block type color from the app's blockTypes list
    const btype = getBlockType(type);
    const typeColor    = btype.color    || '#ffffff';
    const typeFontColor = btype.fontColor || '#000000';

    // Card appearance
    let bg, textColor, border, headerBg, headerFontColor;
    if (isBlackedOut) {
      bg = '#2a2a2a'; textColor = '#555';
      border = '1px solid #444'; headerBg = '#1a1a1a'; headerFontColor = '#666';
    } else if (hasWork) {
      bg = typeColor; textColor = typeFontColor;
      // Supplier match: add thick green border, slightly lighten bg
      border = isSupplierMatch ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.2)';
      headerBg = 'rgba(0,0,0,0.25)'; headerFontColor = typeFontColor;
    } else {
      bg = '#f5f5f5'; textColor = '#aaa';
      border = '1px solid #e0e0e0'; headerBg = '#ebebeb'; headerFontColor = '#888';
    }

    let contentHtml = '';
    if (isBlackedOut) {
      contentHtml = `<div style="color:#555;font-size:9px;font-style:italic;padding:4px 0;">— Other supplier —</div>`;
    } else if (hasWork) {
      const jobName  = fields.jobName  || '';
      const jobNum   = fields.jobNum   || '';
      const plant    = fields.plant    || '';
      const matItems = parseMaterialField(fields.material || '');
      const notes    = fields.notes    || '';
      const fc = typeFontColor;
      const fcDim = typeFontColor + 'bb';

      const matRows = matItems.map(item =>
        `<tr>
          <td style="font-weight:700;color:${fcDim};padding:1px 4px 1px 0;white-space:nowrap;">${item.tons ? item.tons + 'T' : '🪨'}</td>
          <td style="font-weight:700;padding:1px 0;color:${fc};">${item.name}</td>
        </tr>`
      ).join('');

      contentHtml = `
        ${jobName  ? `<div style="font-weight:800;font-size:11px;color:${fc};margin-bottom:3px;line-height:1.3;">${jobName}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:9px;">
          ${jobNum    ? `<tr><td style="font-weight:700;color:${fcDim};padding:1px 4px 1px 0;white-space:nowrap;">Job #</td><td style="font-weight:700;padding:1px 0;color:${fc};">${jobNum}</td></tr>` : ''}
          ${plant     ? `<tr><td style="font-weight:700;color:${fcDim};padding:1px 4px 1px 0;white-space:nowrap;">Plant</td><td style="font-weight:700;padding:1px 0;color:#5ef0a0;">🏭 ${plant}</td></tr>` : ''}
          ${matRows}
          ${notes     ? `<tr><td style="font-weight:700;color:${fcDim};padding:1px 4px 1px 0;white-space:nowrap;">Notes</td><td style="font-weight:700;padding:1px 0;color:${fc};font-style:italic;">${notes}</td></tr>` : ''}
        </table>`;
    } else {
      contentHtml = `<div style="color:#bbb;font-size:9px;padding:4px 0;">No work scheduled</div>`;
    }

    return `
      <div style="background:${bg};border:${border};border-radius:5px;margin-bottom:5px;overflow:hidden;${isSupplierMatch && hasWork ? 'box-shadow:0 0 0 1px #22c55e40;' : ''}">
        <div style="background:${headerBg};padding:3px 7px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:9px;font-weight:800;color:${headerFontColor};letter-spacing:0.3px;">${foremanName}</span>
          ${isSupplierMatch && hasWork ? `<span style="font-size:8px;font-weight:700;color:#000000;background:rgba(34,197,94,0.15);border:2px solid #000000;border-radius:3px;padding:1px 5px;">✓ YOUR JOB</span>` : ''}
          ${!isBlackedOut && hasWork && !isSupplierMatch ? `<span style="font-size:8px;font-weight:700;color:${typeFontColor};opacity:0.7;background:rgba(0,0,0,0.2);border-radius:3px;padding:1px 5px;">${btype.label}</span>` : ''}
        </div>
        <div style="padding:5px 7px;">
          ${contentHtml}
        </div>
      </div>`;
  }

  function weekRowHTML(weekDays) {
    return `<div style="display:flex;gap:5px;margin-bottom:14px;">
      ${weekDays.map(({d, key, isWeekend}) => {
        const isToday2 = d.getTime() === today.getTime();
        const extras = sourceData[key]?.extras || [];
        const dayBg = isWeekend ? '#ede8f5' : isToday2 ? '#e8f9ee' : '#1e1e1e';
        const dayNumColor = isWeekend ? '#6b21a8' : isToday2 ? '#15803d' : '#ffffff';
        const dayNameColor = isWeekend ? '#9333ea' : isToday2 ? '#16a34a' : '#888';

        return `
          <div style="flex:1;min-width:0;border:1px solid ${isToday2?'#22c55e':isWeekend?'#c4b5fd':'#ddd'};border-radius:7px;overflow:hidden;background:#fff;${isToday2?'box-shadow:0 0 0 2px #22c55e40;':''}">
            <div style="background:${dayBg};padding:5px 6px;text-align:center;border-bottom:1px solid ${isToday2?'#22c55e':isWeekend?'#c4b5fd':'#e0e0e0'};">
              <div style="font-size:8px;font-weight:700;color:${dayNameColor};letter-spacing:0.8px;text-transform:uppercase;">${DAY_NAMES_SHORT[d.getDay()]}</div>
              <div style="font-size:16px;font-weight:900;color:${dayNumColor};line-height:1.1;">${d.getDate()}</div>
              <div style="font-size:8px;color:${dayNameColor};opacity:0.8;">${MONTHS[d.getMonth()]}</div>
              ${isToday2 ? `<div style="font-size:7px;font-weight:800;color:#15803d;letter-spacing:0.5px;margin-top:1px;">TODAY</div>` : ''}
            </div>
            <div style="padding:5px;">
              ${blockCardHTML(key, 'top', 'Filipe Joaquim')}
              ${extras.map((_,i)=>i).filter(i=>extras[i]?.parentSlot==='top').map(i=>blockCardHTML(key,`extra_${i}`,extras[i]?.foreman||'Extra Crew')).join('')}
              ${blockCardHTML(key, 'bottom', 'Louie Medeiros')}
              ${extras.map((_,i)=>i).filter(i=>extras[i]?.parentSlot==='bottom').map(i=>blockCardHTML(key,`extra_${i}`,extras[i]?.foreman||'Extra Crew')).join('')}
              ${extras.map((_,i)=>i).filter(i=>!extras[i]?.parentSlot).map(i=>blockCardHTML(key,`extra_${i}`,extras[i]?.foreman||'Extra Crew')).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
  }

  const week1 = days.slice(0, 7);
  const week2 = days.slice(7, 14);

  // ── Per-plant tonnage breakdown ──────────────────────────────────────────
  const plantTonnage = {};
  days.forEach(({ key }) => {
    const daySource = sourceData[key] || {};
    // primary slots
    ['top','bottom'].forEach(slot => {
      const { fields, type } = getBlockData(key, slot);
      if (type === 'blank' && !Object.values(fields).some(v => v && String(v).trim())) return;
      const plant = (fields.plant || '').trim(); if (!plant) return;
      if (!plantMatchesSupplier(plant)) return;
      if (!plantTonnage[plant]) plantTonnage[plant] = {};
      parseMaterialField(fields.material || '').forEach(m => {
        const tons = parseFloat(m.tons || 0); if (tons <= 0) return;
        const mat = (m.name || 'Unknown Mix').trim();
        plantTonnage[plant][mat] = (plantTonnage[plant][mat] || 0) + tons;
      });
    });
    // extra slots
    (sourceData[key]?.extras || []).forEach((_, i) => {
      const { fields, type } = getBlockData(key, `extra_${i}`);
      if (type === 'blank' && !Object.values(fields).some(v => v && String(v).trim())) return;
      const plant = (fields.plant || '').trim(); if (!plant) return;
      if (!plantMatchesSupplier(plant)) return;
      if (!plantTonnage[plant]) plantTonnage[plant] = {};
      parseMaterialField(fields.material || '').forEach(m => {
        const tons = parseFloat(m.tons || 0); if (tons <= 0) return;
        const mat = (m.name || 'Unknown Mix').trim();
        plantTonnage[plant][mat] = (plantTonnage[plant][mat] || 0) + tons;
      });
    });
  });
  console.log('[Lookahead] days count:', days.length);
  console.log('[Lookahead] schedData keys sample:', Object.keys(schedData).slice(0,3));
  console.log('[Lookahead] dk(days[0]):', days.length ? dk(days[0].d) : 'no days');
  console.log('[Lookahead] plantTonnage:', JSON.stringify(plantTonnage));

  const plantTonnageHtml = Object.keys(plantTonnage).filter(plant => Object.keys(plantTonnage[plant]).length > 0).sort().map(plant => {
    const matLines = Object.keys(plantTonnage[plant]).sort().map(mat => {
      const t = plantTonnage[plant][mat];
      return `<div style="display:flex;justify-content:space-between;padding:2px 0 2px 12px;border-left:2px solid #2a5a2a;">
        <span style="color:#aaa;font-size:10px;">${mat}</span>
        <span style="color:#7ecb8f;font-weight:700;font-size:10px;">${t.toLocaleString()}T</span>
      </div>`;
    }).join('');
    const plantTotal = Object.values(plantTonnage[plant]).reduce((s, t) => s + t, 0);
    return `<div style="margin-bottom:10px;">
      <div style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:#fff;margin-bottom:4px;">🏭 ${plant}<span style="float:right;color:#7ecb8f;">${plantTotal.toLocaleString()}T total</span></div>
      ${matLines}
    </div>`;
  }).join('');

  const tonnageSectionHtml = Object.keys(plantTonnage).length > 0
    ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #333;">
        <div style="background:#1a1a1a;border-radius:5px;padding:10px 12px;">
          <div style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:#7ecb8f;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">📊 Tonnage by Plant</div>
          ${plantTonnageHtml}
        </div>
      </div>` : '';

  console.log('[Lookahead] tonnageSectionHtml length:', tonnageSectionHtml.length);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${supplier} — ${dateRange}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 16px; background: #f2f2f2; color: #111; font-size: 12px; }
  @page { size: A4 landscape; margin: 0.5cm; }
  @media print {
    body { padding: 4px; background: #fff; margin: 0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <!-- Header -->
  <div style="background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
    <div style="font-size:13px;font-weight:900;letter-spacing:2px;white-space:nowrap;">DMC PAVING</div>
    <div style="flex:1;text-align:center;">
      <div style="font-size:18px;font-weight:900;letter-spacing:2px;line-height:1.1;">${supplier}</div>
      <div style="font-size:11px;color:#9b9488;margin-top:2px;">${dateRange}</div>
    </div>
    <div style="font-size:11px;letter-spacing:1px;color:#9b9488;white-space:nowrap;">2 WEEK LOOKAHEAD</div>
  </div>
  <!-- Key -->
  <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:9px 14px;margin-bottom:8px;font-size:10px;color:#444;">
    <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:6px;">COLOUR KEY</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px 14px;align-items:center;">
      <!-- Supplier highlight -->
      <span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:28px;height:16px;border:2px solid #22c55e;background:#0d4f7c;border-radius:3px;box-shadow:0 0 0 1px #22c55e40;"></span>
        <span style="font-weight:700;">Green border = YOUR job (${supplierCompany.toUpperCase()})</span>
      </span>
      <!-- Blocked out other supplier -->
      <span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:28px;height:16px;background:#2a2a2a;border:1px solid #444;border-radius:3px;"></span>
        <span>Different supplier</span>
      </span>
      <!-- No work -->
      <span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:28px;height:16px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:3px;"></span>
        <span>No work scheduled</span>
      </span>
      <!-- Block type colors from live app -->
      ${blockTypes.filter(t => t.id !== 'blank').map(t => `
      <span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:28px;height:16px;background:${t.color};border:1px solid rgba(255,255,255,0.2);border-radius:3px;"></span>
        <span>${t.label}</span>
      </span>`).join('')}
    </div>
    ${tonnageSectionHtml}
    <div style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:#cc0000;margin-top:8px;padding-top:6px;border-top:1px solid #333;">
      * All Tonnages are approximate and Schedule is subject to change.
    </div>
  </div>
  <!-- Week 1 -->
  <div style="font-size:10px;font-weight:800;color:#444;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px;">WEEK 1</div>
  ${weekRowHTML(week1)}
  <!-- Week 2 -->
  <div style="font-size:10px;font-weight:800;color:#444;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px;">WEEK 2</div>
  ${weekRowHTML(week2)}
  <!-- Footer -->
  <div style="margin-top:8px;font-size:8px;color:#bbb;text-align:center;border-top:1px solid #e0e0e0;padding-top:6px;">
    DMC Paving — Confidential — For supplier planning use only
  </div>
  <!-- Print button -->
  <div class="no-print" style="text-align:center;margin-top:12px;">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;border-radius:5px;padding:8px 24px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;">🖨️ Print / Save PDF</button>
  </div>
<script>
  // Auto-scale to fit one landscape page on print
  (function() {
    function scaleForPrint() {
      // A4 landscape usable area at 96dpi: ~1056px wide x 748px tall (after 0.5cm margins)
      var usableW = 1056, usableH = 748;
      var contentW = document.body.scrollWidth;
      var contentH = document.body.scrollHeight;
      var scale = Math.min(usableW / contentW, usableH / contentH, 1);
      document.body.style.zoom = scale < 1 ? scale : '';
    }
    if (window.onbeforeprint !== undefined) {
      window.onbeforeprint = scaleForPrint;
      window.onafterprint = function() { document.body.style.zoom = ''; };
    }
    window.matchMedia('print').addListener(function(mq) {
      if (mq.matches) scaleForPrint();
      else document.body.style.zoom = '';
    });
  })();
<\/script>
</body>
</html>`;
}



// ════════════════════════════════════════
//  TRUCKING MODAL
// ════════════════════════════════════════

var _truckingKey = null, _truckingSlot = null;
var _truckingRows = { dmc:[], broker:[], supplier:[] };

function parseTruckingData(key, slot) {
  let fields;
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    fields = schedData[key]?.extras?.[idx]?.data?.fields || {};
  } else {
    fields = ((schedData[key]||{})[slot]||{}).fields || {};
  }
  try { return JSON.parse(fields.trucking || '{}'); } catch(e) { return {}; }
}

function saveTruckingData(key, slot, data) {
  const val = JSON.stringify(data);
  if (slot.startsWith('extra_')) {
    const idx = parseInt(slot.replace('extra_',''));
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key].extras) schedData[key].extras = [];
    if (!schedData[key].extras[idx]) schedData[key].extras[idx] = { foreman:'', data:{ fields:{} } };
    if (!schedData[key].extras[idx].data) schedData[key].extras[idx].data = { fields:{} };
    if (!schedData[key].extras[idx].data.fields) schedData[key].extras[idx].data.fields = {};
    schedData[key].extras[idx].data.fields.trucking = val;
  } else {
    if (!schedData[key]) schedData[key] = {};
    if (!schedData[key][slot]) schedData[key][slot] = { type:'blank', fields:{} };
    if (!schedData[key][slot].fields) schedData[key][slot].fields = {};
    schedData[key][slot].fields.trucking = val;
  }
  saveSchedData();
  renderSchedule();
}


function removeTruckName(key, slot, type, name, btn) {
  const td = parseTruckingData(key, slot);
  const groupKey = type === 'dmc' ? 'dmcTrucks' : type === 'broker' ? 'brokerTrucks' : 'supplierTrucks';
  td[groupKey] = (td[groupKey] || []).filter(t => t !== name);
  saveTruckingData(key, slot, td);
}
function clearTruckingField(key, slot) {
  saveTruckingData(key, slot, {});
}

function openTruckingModal(key, slot) {
  _truckingKey = key; _truckingSlot = slot;
  const td = parseTruckingData(key, slot);
  _truckingRows.dmc      = td.dmcTrucks      || [''];
  _truckingRows.broker   = td.brokerTrucks   || [''];
  _truckingRows.supplier = td.supplierTrucks || [''];

  document.getElementById('truckingModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'truckingModal';
  modal.className = 'trucking-modal-overlay';
  modal.addEventListener('click', e => { if(e.target===modal) closeTruckingModal(); });

  modal.innerHTML = `
    <div class="trucking-modal">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">🚛 Trucking Setup</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;color:var(--concrete-dim);margin-bottom:18px;">${key} · ${slot.toUpperCase()}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:4px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">🚛 # of Trucks</label>
          <input class="form-input" id="tm-numtrucks" placeholder="e.g. 6" value="${td.trucks||td.numTrucks||''}" style="font-size:13px;" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">⏱ Load Time</label>
          <input class="form-input" id="tm-loadtime" placeholder="e.g. 6:00 AM" value="${td.loadTime||''}" style="font-size:13px;" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">📏 Spacing</label>
          <input class="form-input" id="tm-spacing" placeholder="e.g. 15 min" value="${td.spacing||''}" style="font-size:13px;" />
        </div>
      </div>

      <div class="trucking-section-label">🟡 DMC Trucks</div>
      <div id="tm-dmc-rows"></div>
      <button class="trucking-add-truck-btn" onclick="addTruckRow('dmc')">+ Add DMC Truck</button>

      <div class="trucking-section-label">🔵 Broker Trucks</div>
      <div id="tm-broker-rows"></div>
      <button class="trucking-add-truck-btn" onclick="addTruckRow('broker')">+ Add Broker Truck</button>

      <div class="trucking-section-label">🟢 Supplier Trucks</div>
      <div id="tm-supplier-rows"></div>
      <button class="trucking-add-truck-btn" onclick="addTruckRow('supplier')">+ Add Supplier Truck</button>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
        <button class="btn btn-ghost" onclick="closeTruckingModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTruckingModal()">✓ Save Trucking</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  renderTruckRows('dmc');
  renderTruckRows('broker');
  renderTruckRows('supplier');
  setTimeout(() => document.getElementById('tm-numtrucks')?.focus(), 60);
}

function renderTruckRows(group) {
  const el = document.getElementById(`tm-${group}-rows`);
  if (!el) return;
  el.innerHTML = _truckingRows[group].map((name, i) => `
    <div class="trucking-truck-row">
      <input class="trucking-truck-input" value="${escHtml(name)}"
        placeholder="Truck / company name…"
        oninput="_truckingRows['${group}'][${i}]=this.value;"
        onkeydown="if(event.key==='Enter'){addTruckRow('${group}');}" />
      <button class="trucking-truck-del" onclick="removeTruckRow('${group}',${i})" title="Remove">✕</button>
    </div>`).join('');
}

function addTruckRow(group) {
  _truckingRows[group].push('');
  renderTruckRows(group);
  // Focus last input
  const rows = document.querySelectorAll(`#tm-${group}-rows .trucking-truck-input`);
  if (rows.length) rows[rows.length-1].focus();
}

function removeTruckRow(group, idx) {
  _truckingRows[group].splice(idx, 1);
  if (!_truckingRows[group].length) _truckingRows[group] = [''];
  renderTruckRows(group);
}

function saveTruckingModal() {
  // Collect current input values (oninput may not fire for last typed chars)
  ['dmc','broker','supplier'].forEach(g => {
    document.querySelectorAll(`#tm-${g}-rows .trucking-truck-input`).forEach((inp, i) => {
      _truckingRows[g][i] = inp.value;
    });
  });
  const data = {
    trucks:        document.getElementById('tm-numtrucks')?.value.trim() || '',
    loadTime:      document.getElementById('tm-loadtime')?.value.trim()  || '',
    spacing:       document.getElementById('tm-spacing')?.value.trim()   || '',
    dmcTrucks:     _truckingRows.dmc.filter(t=>t.trim()),
    brokerTrucks:  _truckingRows.broker.filter(t=>t.trim()),
    supplierTrucks:_truckingRows.supplier.filter(t=>t.trim()),
  };
  saveTruckingData(_truckingKey, _truckingSlot, data);
  closeTruckingModal();
}

function closeTruckingModal() {
  document.getElementById('truckingModal')?.remove();
  _truckingKey = null; _truckingSlot = null;
}

// ── Trucking Tooltip ──
var _truckTipTimer = null;

function showTruckingTooltip(e, key, slot) {
  clearTimeout(_truckTipTimer);
  hideTruckingTooltip();
  const td = parseTruckingData(key, slot);
  const dmc      = (td.dmcTrucks     ||[]).filter(Boolean);
  const broker   = (td.brokerTrucks  ||[]).filter(Boolean);
  const supplier = (td.supplierTrucks||[]).filter(Boolean);
  if (!dmc.length && !broker.length && !supplier.length) return;

  const tip = document.createElement('div');
  tip.id = 'truckingTooltip';
  tip.className = 'trucking-tooltip';

  const group = (label, icon, trucks) => !trucks.length ? '' : `
    <div class="trucking-tooltip-group">
      <div class="trucking-tooltip-group-label">${icon} ${label}</div>
      ${trucks.map(t=>`<div class="trucking-tooltip-truck">• ${escHtml(t)}</div>`).join('')}
    </div>`;

  tip.innerHTML = group('DMC Trucks','🟡',dmc) + group('Broker Trucks','🔵',broker) + group('Supplier Trucks','🟢',supplier);
  document.body.appendChild(tip);

  // Position near chip
  const rect = e.currentTarget.getBoundingClientRect();
  let top = rect.bottom + 6, left = rect.left;
  const tw = tip.offsetWidth || 220;
  if (left + tw > window.innerWidth - 12) left = window.innerWidth - tw - 12;
  if (top + 200 > window.innerHeight) top = rect.top - 210;
  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
}

function hideTruckingTooltip() {
  document.getElementById('truckingTooltip')?.remove();
}


// ── Auto-fill actual trucking from projected ──────────────────────────────
function _getInvModalEditId() {
  // Find the current invoice being edited — check save button onclick
  const btn = document.querySelector('#invModal .inv-btn[onclick*="saveInvoiceEntry"]');
  if (!btn) return null;
  const m = btn.getAttribute('onclick').match(/saveInvoiceEntry\((.+?)\)/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch(e) { return null; }
}

function autoFillActualDmc() {
  const id = _getInvModalEditId();
  const inv = id ? invoiceList.find(i => i.id === id) : null;
  const pt = inv ? calcProjectedTrucking(inv) : { dmcCount:0, dmcCost:0 };
  const cEl = document.getElementById('invActDmcCount');
  const vEl = document.getElementById('invActDmcCost');
  if (cEl) cEl.value = pt.dmcCount || '';
  if (vEl) vEl.value = pt.dmcCost  ? pt.dmcCost.toFixed(2) : '';
}
function autoFillActualBrk() {
  const id = _getInvModalEditId();
  const inv = id ? invoiceList.find(i => i.id === id) : null;
  const pt = inv ? calcProjectedTrucking(inv) : { brkCount:0, brkCost:0 };
  const cEl = document.getElementById('invActBrkCount');
  const vEl = document.getElementById('invActBrkCost');
  if (cEl) cEl.value = pt.brkCount || '';
  if (vEl) vEl.value = pt.brkCost  ? pt.brkCost.toFixed(2) : '';
}
function autoFillActualSup() {
  const id = _getInvModalEditId();
  const inv = id ? invoiceList.find(i => i.id === id) : null;
  const pt = inv ? calcProjectedTrucking(inv) : { supCount:0, supCost:0 };
  const cEl = document.getElementById('invActSupCount');
  const vEl = document.getElementById('invActSupCost');
  if (cEl) cEl.value = pt.supCount || '';
  if (vEl) vEl.value = pt.supCost  ? pt.supCost.toFixed(2) : '';
}


function showReportsPreview(title, content, downloadFn, closeFn, isIframe, isPdfData, breadcrumb) {
  const pane = document.getElementById('reportsPreviewPane');
  if (!pane) return;
  // Update breadcrumb
  const bc = document.getElementById('reportsPreviewBreadcrumb');
  if (bc && breadcrumb) {
    bc.style.display = 'flex';
    bc.innerHTML = `
      <span class="reports-breadcrumb-folder">${escHtml(breadcrumb.folder||'')}</span>
      ${breadcrumb.folder ? '<span class="reports-breadcrumb-sep">›</span>' : ''}
      <span class="reports-breadcrumb-title">${escHtml(breadcrumb.title||title)}</span>
      ${breadcrumb.badge ? `<span class="reports-breadcrumb-badge" style="background:${breadcrumb.badgeColor||'var(--asphalt-light)'}22;color:${breadcrumb.badgeColor||'var(--concrete-dim)'};border:1px solid ${breadcrumb.badgeColor||'var(--asphalt-light)'}44;">${escHtml(breadcrumb.badge)}</span>` : ''}
      <div style="flex:1;"></div>
      ${downloadFn ? `<button onclick="_rpDownloadBc()" style="background:none;border:1px solid rgba(245,197,24,0.35);border-radius:3px;color:var(--stripe);font-family:'DM Mono',monospace;font-size:9px;font-weight:700;padding:4px 10px;cursor:pointer;">⬇ Download</button>` : ''}`;
    bc._rpDownloadBc = downloadFn;
    // Patch global
    window._rpDownloadBc = downloadFn || (() => {});
  }

  const dlBtn = downloadFn ? `<button class="reports-file-dl" onclick="_rpDownload()" style="color:var(--stripe);border-color:rgba(245,197,24,0.4);">⬇ Download</button>` : '';

  pane._rpDownload = downloadFn || (() => {});

  if (isIframe) {
    pane.innerHTML = `
      <div class="reports-preview-toolbar">
        <div class="reports-preview-title">${escHtml(title)}</div>
        ${dlBtn}
      </div>
      <iframe class="reports-preview-iframe" id="reportsPreviewIframe"></iframe>`;
    const iframe = document.getElementById('reportsPreviewIframe');
    if (isPdfData) {
      // PDF base64
      iframe.src = content;
    } else {
      // HTML string
      iframe.onload = null;
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open(); doc.write(content); doc.close();
    }
  } else {
    pane.innerHTML = `
      <div class="reports-preview-toolbar">
        <div class="reports-preview-title">${escHtml(title)}</div>
        ${dlBtn}
      </div>
      <div class="reports-preview-doc">${content}</div>`;
  }

  // Store download fn on pane so inline onclick can call it
  pane._rpDownload = downloadFn || (() => {});
  // Patch button
  const dlEl = pane.querySelector('.reports-file-dl');
  if (dlEl) dlEl.onclick = downloadFn || (() => {});
}


// ── Reports search ──────────────────────────────────────────────────────────
var _rSearchKbdIdx = -1;



// ── Sidebar reports search ───────────────────────────────────────────────────
var _rSidebarKbdIdx = -1;

// ── Type prefixes the user can type to filter by report type ─────────────────
const REPORT_TYPE_PREFIXES = [
  { prefixes:['daily order','daily orders','do ','da ','d.o.','daily'], type:'daily',     label:'Daily Orders' },
  { prefixes:['look ahead','lookahead','2 week','2wk','la '],           type:'lookahead', label:'2 Week Look Ahead' },
  { prefixes:['job mix','mix formula','mix code','formula','jmf ','jmf'], type:'jobmix',  label:'Job Mix Formula' },
  { prefixes:['foreman','foremans','foremen','qc report','qc ','fr '], type:'qc',        label:"Foremen's Reports" },
  { prefixes:['chat','message','msg '],                                  type:'chat',      label:'Chat History' },
];

function detectTypePrefix(q) {
  // Returns { type, remainingQuery } or null if no prefix matched
  const ql = q.toLowerCase();
  for (const entry of REPORT_TYPE_PREFIXES) {
    for (const pfx of entry.prefixes) {
      if (ql.startsWith(pfx)) {
        return { type: entry.type, label: entry.label, remaining: q.slice(pfx.length).trim() };
      }
    }
  }
  return null;
}


// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SITE SEARCH
// Same prefix logic as reports search, but covers the entire app:
//   Reports (daily, lookahead, foremen/qc), Backlog jobs, Invoices/AP,
//   Schedule blocks, Bids, Contacts
// Type prefixes narrow the result type. General query shows compiled cards.
// ══════════════════════════════════════════════════════════════════════════════

var _gSidebarKbdIdx = -1;

// ── Type prefix map ───────────────────────────────────────────────────────────
const GLOBAL_TYPE_PREFIXES = [
  { prefixes:['daily order','daily orders','daily ','do ','da '],                type:'daily',    label:'Daily Orders' },
  { prefixes:['look ahead','lookahead','2 week','la '],                           type:'lookahead',label:'2 Week Look Ahead' },
  { prefixes:['job mix','mix formula','mix code','formula','jmf '],               type:'jobmix',   label:'Job Mix Formula' },
  { prefixes:["foreman's","foremens report","foremen","fr "],                     type:'qc',       label:"Foremen's Reports" },
  { prefixes:['qc report','qc '],                                                  type:'qc',       label:'QC Reports' },
  { prefixes:['invoice','inv ','ap '],                                             type:'invoice',  label:'AR' },
  { prefixes:['job ','backlog ','project '],                                       type:'job',      label:'Backlog Jobs' },
  { prefixes:['schedule ','sched ','block '],                                      type:'schedule', label:'Schedule' },
  { prefixes:['bid ','estimate '],                                                 type:'bid',      label:'Bids' },
  { prefixes:['contact ','gc contact '],                                           type:'contact',  label:'Contacts' },
];

function detectGlobalTypePrefix(q) {
  const ql = q.toLowerCase();
  for (const entry of GLOBAL_TYPE_PREFIXES) {
    for (const pfx of entry.prefixes) {
      if (ql.startsWith(pfx)) {
        return { type: entry.type, label: entry.label, remaining: q.slice(pfx.length).trim() };
      }
    }
  }
  return null;
}

function buildGlobalSearchIndex() {
  const idx = [];

  // ── Reports ───────────────────────────────────────────────────────────────
  (dailyOrders || []).forEach(o => {
    idx.push({
      id: 'do_' + o.id, type: 'daily', icon: '📄', section: 'Reports',
      name: (o.fileName || '').replace('.docx', ''),
      meta: (o.foreman || '') + ' · ' + (o.dateOfWork || ''),
      badge: 'Daily Order', badgeColor: '#5ab4f5',
      dateSort: Date.parse(o.dateOfWork || '') || 0,
      keywords: [o.fileName, o.foreman, o.jobName, o.gcName, o.dateOfWork, o.jobNo].filter(Boolean).join(' ').toLowerCase(),
      action: `switchTab('reportsDailyOrders');setTimeout(()=>previewDailyOrder('${o.id}'),300)`,
    });
  });
  (lookaheads || []).forEach(la => {
    idx.push({
      id: 'la_' + la.id, type: 'lookahead', icon: '📊', section: 'Reports',
      name: (la.fileName || '').replace('.html', ''),
      meta: (la.supplier || '') + ' · ' + (la.dateRange || ''),
      badge: 'Look Ahead', badgeColor: '#7ecb8f',
      dateSort: Date.parse(la.createdAt || '') || 0,
      keywords: [(la.fileName || ''), la.supplier, la.dateRange, la.createdAt].filter(Boolean).join(' ').toLowerCase(),
      action: `switchTab('reportsTwoWeek');setTimeout(()=>previewLookahead('${la.id}'),300)`,
    });
  });
  (jobMixFormulas || []).forEach(jm => {
    idx.push({
      id: 'jm_' + jm.id, type: 'jobmix', icon: '🧪', section: 'Reports',
      name: jm.mixName || 'Job Mix Formula',
      meta: (jm.supplier || '') + (jm.mixCode ? ' · ' + jm.mixCode : ''),
      badge: 'Mix Formula', badgeColor: '#7ecb8f',
      dateSort: jm.uploadedAt || 0,
      keywords: [jm.supplier, jm.mixName, jm.mixCode, jm.fileName, jm.uploadedBy].filter(Boolean).join(' ').toLowerCase(),
      action: `switchTab('reportsJobMix');setTimeout(()=>previewJobMixFormula('${jm.id}'),300)`,
    });
  });
  if (typeof qcReports !== 'undefined') {
    (qcReports || []).forEach(r => {
      idx.push({
        id: 'qc_' + r.id, type: 'qc', icon: '🔬', section: 'Reports',
        name: r.fileName || r.jobName || 'QC Report',
        meta: (r.jobName || '') + (r.gcName ? ' · ' + r.gcName : ''),
        badge: "Foremen's Report", badgeColor: 'var(--orange)',
        dateSort: r.uploadedAt || 0,
        keywords: [r.fileName, r.jobName, r.gcName, r.jobNo, r.note, r.uploadedBy].filter(Boolean).join(' ').toLowerCase(),
        action: `switchTab('reportsForemens');setTimeout(()=>previewQCReport('${r.id}'),300)`,
      });
    });
  }

  // ── Backlog jobs ──────────────────────────────────────────────────────────
  (backlogJobs || []).forEach(j => {
    const gcProfile = (typeof getGCProfile === 'function') ? getGCProfile(j.gc || '') : {};
    const contacts = (gcProfile.contacts || []).map(c => c.name + ' ' + (c.role || '')).join(' ');
    idx.push({
      id: 'job_' + j.id, type: 'job', icon: '📋', section: 'Backlog',
      name: j.name || j.num || 'Job',
      meta: (j.gc || '') + (j.num ? ' · #' + j.num : '') + (j.status ? ' · ' + j.status : ''),
      badge: 'Backlog', badgeColor: '#c084f5',
      dateSort: 0,
      keywords: [j.name, j.num, j.gc, j.status, j.location, j.value, contacts].filter(Boolean).join(' ').toLowerCase(),
      action: `switchTab('backlog');setTimeout(()=>openBacklogModal('${j.id}'),300)`,
    });
  });

  // ── Invoices (AP) ─────────────────────────────────────────────────────────
  (invoiceList || []).forEach(inv => {
    idx.push({
      id: 'inv_' + inv.id, type: 'invoice', icon: '🧾', section: 'AR',
      name: inv.jobName || inv.invoiceNum || 'Invoice',
      meta: (inv.supplier || '') + (inv.invoiceNum ? ' · #' + inv.invoiceNum : '') + (inv.invoiceDate ? ' · ' + inv.invoiceDate : ''),
      badge: 'Invoice', badgeColor: '#f5c518',
      dateSort: Date.parse(inv.invoiceDate || '') || 0,
      keywords: [inv.jobName, inv.supplier, inv.invoiceNum, inv.invoiceDate, inv.gcName, inv.jobNo, inv.invoiceNotes].filter(Boolean).join(' ').toLowerCase(),
      action: `switchTab('ap');setTimeout(()=>openInvoiceModal('${inv.id}'),300)`,
    });
  });

  // ── Schedule blocks ───────────────────────────────────────────────────────
  try {
    Object.entries(schedData || {}).forEach(([dateKey, dayData]) => {
      Object.entries(dayData || {}).forEach(([slot, bdata]) => {
        if (!bdata || !bdata.fields) return;
        if (slot === 'dayNote' || slot === 'dayNoteSA') return;
        const f = bdata.fields;
        const name = f.jobName || f.jobNum || ('Schedule ' + dateKey);
        if (!name) return;
        idx.push({
          id: 'sched_' + dateKey + '_' + slot, type: 'schedule', icon: '📅', section: 'Schedule',
          name: name,
          meta: dateKey + (f.plant ? ' · ' + f.plant : ''),
          badge: 'Schedule', badgeColor: '#5ab4f5',
          dateSort: Date.parse(dateKey) || 0,
          keywords: [f.jobName, f.jobNum, f.plant, f.contact, f.operators, f.equipment, f.notes, f.gcName, dateKey].filter(Boolean).join(' ').toLowerCase(),
          action: `switchTab('schedule');setTimeout(()=>{const el=document.querySelector('[data-key="${dateKey}"]');if(el)el.scrollIntoView({behavior:'smooth',block:'center'});},400)`,
        });
      });
    });
  } catch(e) {}

  // ── Bids ──────────────────────────────────────────────────────────────────
  try {
    (bidProjects || []).forEach(b => {
      idx.push({
        id: 'bid_' + b.id, type: 'bid', icon: '📁', section: 'Bids',
        name: b.name || b.projectName || 'Bid',
        meta: (b.gc || b.client || '') + (b.status ? ' · ' + b.status : ''),
        badge: 'Bid', badgeColor: '#7ecb8f',
        dateSort: Date.parse(b.dueDate || b.createdAt || '') || 0,
        keywords: [b.name, b.projectName, b.gc, b.client, b.status, b.notes].filter(Boolean).join(' ').toLowerCase(),
        action: `switchTab('bids')`,
      });
    });
  } catch(e) {}

  // ── Contacts (from GC profiles) ───────────────────────────────────────────
  try {
    const allProfiles = (typeof getAllGCProfiles === 'function') ? getAllGCProfiles() : {};
    Object.entries(allProfiles).forEach(([gc, profile]) => {
      (profile.contacts || []).forEach((c, i) => {
        idx.push({
          id: 'contact_' + btoa(gc).slice(0,8) + '_' + i, type: 'contact', icon: '👤', section: 'Contacts',
          name: c.name || 'Contact',
          meta: gc + (c.role ? ' · ' + c.role : '') + (c.phone ? ' · ' + c.phone : ''),
          badge: 'Contact', badgeColor: '#c084f5',
          dateSort: 0,
          keywords: [c.name, c.role, c.phone, c.email, gc].filter(Boolean).join(' ').toLowerCase(),
          action: `switchTab('backlog')`,
        });
      });
    });
  } catch(e) {}

  return idx;
}

// ── Section metadata for compiled cards ──────────────────────────────────────
const _GSM = {
  daily:     { label:'Daily Orders',       icon:'📄', color:'#5ab4f5' },
  lookahead: { label:'2 Week Look Ahead',  icon:'📊', color:'#7ecb8f' },
  jobmix:    { label:'Job Mix Formula',    icon:'🧪', color:'#7ecb8f' },
  qc:        { label:"Foremen's Reports",  icon:'🔬', color:'var(--orange)' },
  invoice:   { label:'AR',                 icon:'🧾', color:'#f5c518' },
  job:       { label:'Backlog Jobs',       icon:'📋', color:'#c084f5' },
  schedule:  { label:'Schedule',           icon:'📅', color:'#5ab4f5' },
  bid:       { label:'Bids',              icon:'📁', color:'#7ecb8f' },
  contact:   { label:'Contacts',          icon:'👤', color:'#c084f5' },
};

function globalSearch(inp) {
  const raw = inp.value.trim();
  const q   = raw.toLowerCase();
  const clearBtn = document.getElementById('globalSearchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';

  const drop = document.getElementById('globalSearchDrop');
  if (!drop) return;
  if (!q) { drop.style.display = 'none'; _gSidebarKbdIdx = -1; return; }

  const idx = buildGlobalSearchIndex();
  const typeMatch = detectGlobalTypePrefix(q);

  let filteredIdx = idx;
  let displayQ = q;
  let typeLabel = null;

  if (typeMatch) {
    filteredIdx = idx.filter(r => r.type === typeMatch.type);
    displayQ = typeMatch.remaining.toLowerCase();
    typeLabel = typeMatch.label;
  }

  const tokens = displayQ.trim().split(/\s+/).filter(Boolean);
  let results = tokens.length
    ? filteredIdx.filter(item => {
        const kw = item.keywords + ' ' + item.name.toLowerCase() + ' ' + item.meta.toLowerCase();
        return tokens.every(tok => kw.includes(tok));
      })
    : filteredIdx;

  results.sort((a, b) => (b.dateSort || 0) - (a.dateSort || 0));
  const dropResults = results.slice(0, 20);

  _gSidebarKbdIdx = -1;

  if (!dropResults.length) {
    const hint = typeMatch
      ? `<div style="padding:10px 14px;font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">TYPE: <span style="color:var(--stripe);">${typeMatch.label}</span> — no matches${displayQ?' for "'+escHtml(displayQ)+'"':''}</div>`
      : `<div style="padding:12px 14px;font-size:12px;color:var(--concrete-dim);">No results for "<strong style="color:var(--white);">${escHtml(raw)}</strong>"</div>`;
    drop.innerHTML = hint;
    drop.style.display = '';
    return;
  }

  // ── Group results by section for the dropdown header ─────────────────────
  const sections = [...new Set(results.map(r => r.section))];
  const sectionPill = !typeMatch && sections.length > 1
    ? `<div style="padding:6px 12px 4px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--asphalt-light);">
        ${sections.map(s => `<span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:var(--concrete-dim);padding:2px 6px;background:rgba(255,255,255,0.05);border-radius:4px;">${s}</span>`).join('')}
        <span style="margin-left:auto;font-family:'DM Mono',monospace;font-size:8px;color:var(--concrete-dim);">${results.length} result${results.length!==1?'s':''}</span>
       </div>`
    : typeLabel
      ? `<div style="padding:6px 12px 4px;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--stripe);border-bottom:1px solid var(--asphalt-light);">📂 ${typeLabel} · ${results.length} result${results.length!==1?'s':''}</div>`
      : '';

  drop.innerHTML = sectionPill + dropResults.map((r, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.1s;"
      data-gidx="${i}"
      onmousedown="event.preventDefault();globalSearchSelect('${r.id.replace(/'/g,"\\'")}','${r.name.replace(/'/g,"\\'")}','${r.section.replace(/'/g,"\\'")}',()=>{${r.action}})"
      onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background=''">
      <span style="font-size:15px;flex-shrink:0;">${r.icon}</span>
      <div style="flex:1;min-width:0;overflow:hidden;">
        <div style="font-size:12px;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_gsHighlight(escHtml(r.name), displayQ)}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.meta)}</div>
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.5px;text-transform:uppercase;padding:1px 5px;border-radius:6px;flex-shrink:0;background:${r.badgeColor}22;color:${r.badgeColor};border:1px solid ${r.badgeColor}44;white-space:nowrap;">${r.badge}</span>
    </div>`).join('')
    + (results.length > 20 ? `<div style="padding:8px 12px;font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);border-top:1px solid var(--asphalt-light);">+${results.length-20} more — type more to narrow results</div>` : '');

  drop.style.display = '';
}

function _gsHighlight(text, q) {
  if (!q) return text;
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  let out = text;
  tokens.forEach(tok => {
    const re = new RegExp('(' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark style="background:rgba(245,197,24,0.35);color:var(--white);border-radius:2px;padding:0 1px;">$1</mark>');
  });
  return out;
}

function globalSearchSelect(id, name, section, actionFn) {
  const drop = document.getElementById('globalSearchDrop');
  const inp = document.getElementById('globalSearchInput');
  if (drop) drop.style.display = 'none';
  if (inp) inp.value = name;
  try { actionFn(); } catch(e) { console.error('globalSearch action error', e); }
}

function globalSearchClear() {
  const inp = document.getElementById('globalSearchInput');
  const drop = document.getElementById('globalSearchDrop');
  const clr = document.getElementById('globalSearchClear');
  if (inp) { inp.value = ''; inp.focus(); }
  if (drop) drop.style.display = 'none';
  if (clr) clr.style.display = 'none';
  _gSidebarKbdIdx = -1;
}

function globalSearchKeydown(e) {
  const drop = document.getElementById('globalSearchDrop');
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('[data-gidx]');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _gSidebarKbdIdx = Math.min(_gSidebarKbdIdx + 1, items.length - 1);
    items.forEach((el, i) => el.style.background = i === _gSidebarKbdIdx ? 'rgba(255,255,255,0.06)' : '');
    items[_gSidebarKbdIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _gSidebarKbdIdx = Math.max(_gSidebarKbdIdx - 1, 0);
    items.forEach((el, i) => el.style.background = i === _gSidebarKbdIdx ? 'rgba(255,255,255,0.06)' : '');
    items[_gSidebarKbdIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cur = _gSidebarKbdIdx >= 0 ? items[_gSidebarKbdIdx] : items[0];
    if (cur) cur.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
    _gSidebarKbdIdx = -1;
  }
}

function reportsSidebarSearch(inp) {
  const raw = inp.value.trim();
  const q   = raw.toLowerCase();
  const clearBtn = document.getElementById('reportsSidebarClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';

  const drop = document.getElementById('reportsSidebarDrop');
  if (!drop) return;
  if (!q) {
    drop.style.display = 'none';
    _rSidebarKbdIdx = -1;
    // Clear any compiled-results panel in main window
    _clearReportsSearchPanel();
    return;
  }

  const idx = buildReportsSearchIndex();
  const typeMatch = detectTypePrefix(q);

  let filteredIdx = idx;
  let displayQ    = q;           // query used for highlighting
  let typeLabel   = null;        // set when type prefix was detected

  if (typeMatch) {
    // Filter to only this report type
    filteredIdx = idx.filter(r => r.type === typeMatch.type);
    displayQ    = typeMatch.remaining.toLowerCase();
    typeLabel   = typeMatch.label;
  }

  // Token-based match on remaining query
  const tokens = displayQ.trim().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? filteredIdx.filter(item => {
        const kw = item.keywords + ' ' + item.name.toLowerCase() + ' ' + item.meta.toLowerCase();
        return tokens.every(tok => kw.includes(tok));
      })
    : filteredIdx; // if only a type prefix was typed, show all of that type

  results.sort((a,b) => (b.dateSort||0) - (a.dateSort||0));
  const dropResults = results.slice(0, 18);

  _rSidebarKbdIdx = -1;

  // ── Determine if this is a "general" entity search (job name/# / GC)
  //    vs a type-filtered search.
  //    General search → compile results grouped by type into main window cards.
  //    Type-filtered  → show specific list, no compilation.
  const isGeneralSearch = !typeMatch && tokens.length > 0;
  if (isGeneralSearch && results.length) {
    _showReportsSearchPanel(results, raw);
  } else {
    _clearReportsSearchPanel();
  }

  if (!dropResults.length && !isGeneralSearch) {
    const hint = typeMatch
      ? `<div style="padding:10px 14px;font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">TYPE: <span style="color:var(--stripe);">${typeMatch.label}</span> · no matches${displayQ?' for "'+escHtml(displayQ)+'"':''}</div>`
      : `<div style="padding:12px 14px;font-size:12px;color:var(--concrete-dim);">No results for "<strong style="color:var(--white);">${escHtml(raw)}</strong>"</div>`;
    drop.innerHTML = hint;
    drop.style.display = '';
    return;
  }

  if (!dropResults.length) { drop.style.display = 'none'; return; }

  const typePill = typeLabel
    ? `<div style="padding:6px 12px 4px;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--stripe);border-bottom:1px solid var(--asphalt-light);">📂 ${typeLabel}</div>`
    : '';

  drop.innerHTML = typePill + dropResults.map((r, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.1s;"
      data-idx="${i}"
      onmousedown="${r.action};reportsSidebarSelectResult('${r.id}','${escHtml(r.name.replace(/'/g,"\\\\'"))}','${escHtml(r.badge||'')}','${escHtml(r.meta||'')}')"
      onmouseover="this.style.background='var(--asphalt-light)'" onmouseout="this.style.background=''">
      <span style="font-size:14px;flex-shrink:0;">${r.icon}</span>
      <div style="flex:1;min-width:0;overflow:hidden;">
        <div style="font-size:11px;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${highlightMatch(escHtml(r.name), displayQ)}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.meta)}</div>
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.5px;text-transform:uppercase;padding:1px 5px;border-radius:6px;flex-shrink:0;background:${r.badgeColor}22;color:${r.badgeColor};border:1px solid ${r.badgeColor}44;">${r.badge}</span>
    </div>`).join('');
  drop.style.display = '';
}

// ── Compiled results panel in main window ──────────────────────────────────
function _clearReportsSearchPanel() {
  const pane = document.getElementById('reportsPreviewPane');
  if (!pane) return;
  // Only clear if it's currently showing the search panel (not a file preview)
  if (pane.dataset.mode === 'search') {
    pane.removeAttribute('data-mode');
    pane.innerHTML = `<div class="reports-preview-empty">
      <div style="font-size:36px;">👁</div>
      <div style="font-size:13px;font-weight:600;color:var(--white);">Select a file to preview</div>
      <div style="font-size:11px;text-align:center;max-width:260px;line-height:1.7;">
        Browse folders in the sidebar, or use the <strong style="color:var(--stripe);">🔍 search bar</strong> above them.<br>
        Click any report to load the preview here.
      </div>
    </div>`;
  }
}

function _showReportsSearchPanel(results, query) {
  const pane = document.getElementById('reportsPreviewPane');
  if (!pane) return;
  pane.dataset.mode = 'search';

  // Group by type
  const groups = {};
  const GROUP_META = {
    daily:     { label:'Daily Orders',        icon:'📄', color:'#5ab4f5' },
    lookahead: { label:'2 Week Look Ahead',   icon:'📊', color:'#7ecb8f' },
    jobmix:    { label:'Job Mix Formula',     icon:'🧪', color:'#7ecb8f' },
    qc:        { label:"Foremen's Reports",   icon:'🔬', color:'var(--orange)' },
    chat:      { label:'Chat History',         icon:'💬', color:'#c084f5' },
  };
  results.forEach(r => {
    if (!groups[r.type]) groups[r.type] = [];
    groups[r.type].push(r);
  });

  const total = results.length;
  const groupCards = Object.entries(groups).map(([type, items]) => {
    const gm = GROUP_META[type] || { label: type, icon:'📁', color:'var(--concrete-dim)' };
    const fileList = items.slice(0, 40).map(r => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.1s;"
        onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''"
        onmousedown="${r.action};reportsSidebarSelectResult('${r.id}','${escHtml(r.name.replace(/'/g,"\\\\'"))}','${escHtml(r.badge||'')}','${escHtml(r.meta||'')}')" >
        <span style="font-size:14px;flex-shrink:0;">${r.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${highlightMatch(escHtml(r.name), query.toLowerCase())}</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.meta)}</div>
        </div>
      </div>`).join('');
    return `
      <div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);overflow:hidden;flex-shrink:0;min-width:260px;max-width:360px;display:flex;flex-direction:column;">
        <div style="display:flex;align-items:center;gap:8px;padding:11px 14px;background:${gm.color}18;border-bottom:2px solid ${gm.color}44;">
          <span style="font-size:18px;">${gm.icon}</span>
          <div style="flex:1;">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1.5px;color:var(--white);">${gm.label}</div>
            <div style="font-family:'DM Mono',monospace;font-size:8px;color:${gm.color};letter-spacing:.8px;">${items.length} result${items.length!==1?'s':''}</div>
          </div>
        </div>
        <div style="overflow-y:auto;max-height:320px;flex:1;">${fileList}</div>
        ${items.length > 40 ? `<div style="padding:6px 12px;font-family:'DM Mono',monospace;font-size:8px;color:var(--concrete-dim);border-top:1px solid var(--asphalt-light);">+${items.length-40} more — refine search</div>` : ''}
      </div>`;
  }).join('');

  pane.innerHTML = `
    <div style="padding:14px 18px 10px;border-bottom:1px solid var(--asphalt-light);flex-shrink:0;display:flex;align-items:center;gap:10px;">
      <span style="font-size:16px;">🔍</span>
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1.5px;color:var(--white);">Search Results — "${escHtml(query)}"</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:1px;">${total} report${total!==1?'s':''} across ${Object.keys(groups).length} categor${Object.keys(groups).length!==1?'ies':'y'}</div>
      </div>
      <button onclick="_clearReportsSearchPanel();document.getElementById('reportsSidebarInput').value='';document.getElementById('reportsSidebarClear').style.display='none';"
        style="margin-left:auto;background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:11px;padding:3px 8px;cursor:pointer;">✕ Clear</button>
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px 18px;">
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;">${groupCards}</div>
    </div>`;
}

function reportsSidebarKeydown(e) {
  const drop = document.getElementById('reportsSidebarDrop');
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('[data-idx]');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _rSidebarKbdIdx = Math.min(_rSidebarKbdIdx + 1, items.length - 1);
    items.forEach((el,i) => el.style.background = i === _rSidebarKbdIdx ? 'var(--asphalt-light)' : '');
    items[_rSidebarKbdIdx]?.scrollIntoView({ block:'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _rSidebarKbdIdx = Math.max(_rSidebarKbdIdx - 1, 0);
    items.forEach((el,i) => el.style.background = i === _rSidebarKbdIdx ? 'var(--asphalt-light)' : '');
    items[_rSidebarKbdIdx]?.scrollIntoView({ block:'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const focused = _rSidebarKbdIdx >= 0 ? items[_rSidebarKbdIdx] : items[0];
    if (focused) focused.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
    _rSidebarKbdIdx = -1;
  }
}

function reportsSidebarSelectResult(id, name, badge, meta) {
  const inp = document.getElementById('reportsSidebarInput');
  if (inp) inp.value = name;
  const drop = document.getElementById('reportsSidebarDrop');
  if (drop) drop.style.display = 'none';
  // Show breadcrumb from search
  const bc = document.getElementById('reportsPreviewBreadcrumb');
  if (bc && name) {
    bc.style.display = 'flex';
    const badgeColorMap = { 'Daily Order':'#5ab4f5', 'Lookahead':'#7ecb8f', 'QC Report':'var(--orange)', 'Mix Formula':'#7ecb8f' };
    const col = badgeColorMap[badge] || 'var(--concrete-dim)';
    bc.innerHTML = `
      <span class="reports-breadcrumb-folder">${escHtml(meta||'')}</span>
      <span class="reports-breadcrumb-sep">›</span>
      <span class="reports-breadcrumb-title">${escHtml(name)}</span>
      ${badge ? `<span class="reports-breadcrumb-badge" style="background:${col}22;color:${col};border:1px solid ${col}44;">${escHtml(badge)}</span>` : ''}`;
  }
  // Highlight matching row in folder tree
  setTimeout(() => {
    document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
    document.querySelectorAll(`.reports-file-row[data-preview-id="${id}"]`).forEach(r => {
      r.classList.add('reports-file-active');
      r.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  }, 120);
}

function reportsSidebarClearSearch() {
  const inp = document.getElementById('reportsSidebarInput');
  const drop = document.getElementById('reportsSidebarDrop');
  const clearBtn = document.getElementById('reportsSidebarClear');
  if (inp) { inp.value = ''; inp.focus(); }
  if (drop) drop.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
}

function buildReportsSearchIndex() {
  const idx = [];
  (dailyOrders||[]).forEach(o => {
    let extraKw = '';
    try {
      const bdata = (schedData[o.dateKey]||{})[o.foreman === 'Filipe Joaquim' ? 'top' : 'bottom'];
      if (bdata && bdata.fields) {
        const f = bdata.fields;
        extraKw = [f.jobName, f.jobNum, f.plant, f.contact, f.location, f.notes, f.operators, f.equipment].filter(Boolean).join(' ');
      }
    } catch(e) {}
    idx.push({
      id: o.id, icon:'📄', name: (o.fileName||'').replace('.docx',''),
      meta: (o.foreman||'') + ' · ' + (o.dateOfWork||''), type:'daily',
      badge: 'Daily Order', badgeColor:'#5ab4f5',
      dateSort: Date.parse(o.dateOfWork||'') || 0,
      keywords: [o.fileName, o.foreman, o.jobName, o.gcName, o.dateOfWork, o.jobNo, extraKw].filter(Boolean).join(' ').toLowerCase(),
      action: `previewDailyOrder('${o.id}')`
    });
  });
  (lookaheads||[]).forEach(la => {
    idx.push({
      id: la.id, icon:'📊', name: (la.fileName||'').replace('.html',''),
      meta: (la.supplier||'') + ' · ' + (la.dateRange||''), type:'lookahead',
      badge: 'Lookahead', badgeColor:'#7ecb8f',
      dateSort: Date.parse(la.createdAt||'') || 0,
      keywords: [(la.fileName||''), la.supplier, la.dateRange, la.createdAt].filter(Boolean).join(' ').toLowerCase(),
      action: `previewLookahead('${la.id}')`
    });
  });
  (jobMixFormulas||[]).forEach(jm => {
    idx.push({
      id: jm.id, icon:'🧪', name: jm.mixName || 'Job Mix Formula',
      meta: (jm.supplier||'') + (jm.mixCode ? ' · ' + jm.mixCode : ''), type:'jobmix',
      badge: 'Mix Formula', badgeColor:'#7ecb8f',
      dateSort: jm.uploadedAt || 0,
      keywords: [jm.supplier, jm.mixName, jm.mixCode, jm.fileName, jm.uploadedBy].filter(Boolean).join(' ').toLowerCase(),
      action: `previewJobMixFormula('${jm.id}')`
    });
  });
  if (typeof qcReports !== 'undefined') {
    (qcReports||[]).forEach(r => {
      idx.push({
        id: r.id, icon:'🔬', name: r.fileName || r.jobName || 'QC Report',
        meta: (r.jobName||'') + (r.gcName?' · '+r.gcName:''), type:'qc',
        badge: 'QC Report', badgeColor:'var(--orange)',
        dateSort: r.uploadedAt || 0,
        keywords: [r.fileName, r.jobName, r.gcName, r.jobNo, r.note, r.uploadedBy].filter(Boolean).join(' ').toLowerCase(),
        action: `previewQCReport('${r.id}')`
      });
    });
  }
  return idx;
}

function highlightMatch(text, q) {
  if (!q) return text;
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  let out = text;
  tokens.forEach(tok => {
    const re = new RegExp('(' + tok.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    out = out.replace(re, '<mark style="background:rgba(245,197,24,0.35);color:var(--white);border-radius:2px;padding:0 1px;">$1</mark>');
  });
  return out;
}
function reportsSearchInput(inp) {
  const q = inp.value.trim().toLowerCase();
  const clearBtn = document.getElementById('reportsSearchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';

  const drop = document.getElementById('reportsSearchDrop');
  if (!drop) return;
  if (!q) { drop.style.display = 'none'; _rSearchKbdIdx = -1; return; }

  const idx = window._reportsSearchIndex || [];
  // Score-based search: each token in the query must appear somewhere in keywords/name/meta
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  const results = idx.filter(item => {
    const kw = item.keywords + ' ' + item.name.toLowerCase() + ' ' + item.meta.toLowerCase();
    return tokens.every(tok => kw.includes(tok));
  }).slice(0, 12);

  if (!results.length) {
    drop.innerHTML = `<div style="padding:12px 16px;font-size:12px;color:var(--concrete-dim);">No results for "${escHtml(q)}"</div>`;
    drop.style.display = '';
    return;
  }

  _rSearchKbdIdx = -1;
  drop.innerHTML = results.map((r, i) => `
    <div class="reports-search-result" data-action="${escHtml(r.action)}" data-idx="${i}"
      onmousedown="${r.action};document.getElementById('reportsSearchInput').value='${escHtml(r.name.replace(/'/g,"\\'"))}';reportsSearchAfterSelect('${r.id}')">
      <span style="font-size:14px;">${r.icon}</span>
      <div style="flex:1;min-width:0;">
        <div class="reports-search-result-name">${highlightMatch(escHtml(r.name), q)}</div>
        <div class="reports-search-result-meta">${escHtml(r.meta)}</div>
      </div>
      <span class="reports-search-result-badge" style="background:${r.badgeColor}22;color:${r.badgeColor};border:1px solid ${r.badgeColor}44;">${r.badge}</span>
    </div>`).join('');
  drop.style.display = '';
}

function reportsSearchKeydown(e) {
  const drop = document.getElementById('reportsSearchDrop');
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('.reports-search-result');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _rSearchKbdIdx = Math.min(_rSearchKbdIdx + 1, items.length - 1);
    items.forEach((el,i) => el.classList.toggle('kbd-focus', i === _rSearchKbdIdx));
    items[_rSearchKbdIdx]?.scrollIntoView({ block:'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _rSearchKbdIdx = Math.max(_rSearchKbdIdx - 1, 0);
    items.forEach((el,i) => el.classList.toggle('kbd-focus', i === _rSearchKbdIdx));
    items[_rSearchKbdIdx]?.scrollIntoView({ block:'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const focused = _rSearchKbdIdx >= 0 ? items[_rSearchKbdIdx] : items[0];
    if (focused) focused.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
    _rSearchKbdIdx = -1;
  }
}

function reportsSearchAfterSelect(id) {
  const drop = document.getElementById('reportsSearchDrop');
  if (drop) drop.style.display = 'none';
  // Highlight the row in the folder tree if visible
  setTimeout(() => {
    document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
    document.querySelectorAll(`.reports-file-row[data-preview-id="${id}"]`).forEach(r => {
      r.classList.add('reports-file-active');
      r.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  }, 100);
}

function reportsClearSearch() {
  const inp = document.getElementById('reportsSearchInput');
  const drop = document.getElementById('reportsSearchDrop');
  const clearBtn = document.getElementById('reportsSearchClear');
  if (inp) inp.value = '';
  if (drop) drop.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
  inp?.focus();
}


// ── Invoice file attachments ──────────────────────────────────────────────────
window._invAttachments = [];

async function invHandleFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const inp = document.getElementById('invAttInput');
  const files = Array.from(fileList);
  for (const file of files) {
    // Temporary entry with uploading state
    const tempId = Date.now() + Math.random().toString(36).slice(2);
    const entry = {
      id: tempId,
      name: file.name,
      type: file.type,
      sizeKB: Math.round(file.size / 1024),
      uploading: true,
      progress: 0,
      url: null,
      storagePath: null,
    };
    window._invAttachments.push(entry);
    invRenderAttList();
    try {
      const { url, path } = await uploadFileToStorage(
        file, 'invoices',
        pct => { entry.progress = pct; invRenderAttList(); }
      );
      entry.url = url;
      entry.storagePath = path;
      entry.uploading = false;
    } catch(e) {
      entry.uploading = false;
      entry.error = 'Upload failed';
      _logFbError('invHandleFiles', e);
    }
    invRenderAttList();
  }
  if (inp) inp.value = '';
}

function invRenderAttList() {
  const el = document.getElementById('invAttList');
  if (!el) return;
  el.innerHTML = (window._invAttachments || []).map((att, idx) => {
    const isImg  = att.type && att.type.startsWith('image/');
    const isPdf  = att.type === 'application/pdf';
    const isDocx = att.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                || att.type === 'application/msword'
                || /\.docx?$/i.test(att.name || '');
    const icon = isPdf ? '📄' : isDocx ? '📝' : '📎';
    if (att.uploading) {
      const pct = Math.round((att.progress || 0) * 100);
      return `<div class="inv-att-chip">
        <div class="inv-att-icon">${icon}</div>
        <div class="inv-att-chip-name" title="${escHtml(att.name)}">${escHtml(att.name)}</div>
        <span class="inv-att-chip-size" style="color:var(--stripe);">⬆ ${pct}%</span>
      </div>`;
    }
    if (att.error) {
      return `<div class="inv-att-chip" style="border-color:var(--red);">
        <div class="inv-att-icon">⚠️</div>
        <div class="inv-att-chip-name">${escHtml(att.name)} — ${att.error}</div>
        <button onclick="invRemoveAtt(${idx})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:13px;padding:0 3px;">✕</button>
      </div>`;
    }
    const src = att.url || att.data; // url from Storage, fallback to legacy base64
    const thumb = isImg && src
      ? `<img src="${src}" class="inv-att-thumb" onclick="invViewAtt(${idx})" title="Preview" />`
      : `<div class="inv-att-icon" style="cursor:pointer;" onclick="invViewAtt(${idx})" title="View">${icon}</div>`;
    return `<div class="inv-att-chip">
      ${thumb}
      <div class="inv-att-chip-name" title="${escHtml(att.name)}">${escHtml(att.name)}</div>
      <span class="inv-att-chip-size">${att.sizeKB}KB</span>
      <button onclick="invViewAtt(${idx})" style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:10px;padding:3px 7px;cursor:pointer;" title="View">👁 View</button>
      <button onclick="invRemoveAtt(${idx})" style="background:none;border:none;cursor:pointer;color:var(--concrete-dim);font-size:13px;padding:0 3px;" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function invRemoveAtt(idx) {
  window._invAttachments.splice(idx, 1);
  invRenderAttList();
}

function invViewAtt(idx) {
  const att = (window._invAttachments || [])[idx];
  if (!att) return;
  _openInvAttViewer(att);
}

function viewInvAttachments(invId) {
  const inv = invoiceList.find(i => i.id === invId);
  if (!inv || !(inv.attachments||[]).length) return;
  if (inv.attachments.length === 1) {
    _openInvAttViewer(inv.attachments[0]);
    return;
  }
  // Multiple: show a picker overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9400;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:20px;max-width:480px;width:100%;max-height:80vh;overflow-y:auto;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1.5px;color:var(--white);margin-bottom:14px;">📎 Attached Files</div>
      ${inv.attachments.map((att,i) => {
        const isImg = att.type && att.type.startsWith('image/');
        const isPdf = att.type === 'application/pdf';
        const isDocxPick = att.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || att.type === 'application/msword' || /\.docx?$/i.test(att.name||'');
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--asphalt-light);border-radius:var(--radius);margin-bottom:8px;cursor:pointer;transition:background 0.1s;"
          onclick="_openInvAttViewerById('${escHtml(invId)}',${i})"
          onmouseover="this.style.background='var(--asphalt-light)'" onmouseout="this.style.background=''">
          <span style="font-size:20px;">${isPdf?'📄':isImg?'🖼️':isDocxPick?'📝':'📎'}</span>
          <div style="flex:1;overflow:hidden;">
            <div style="font-size:12px;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(att.name)}</div>
            <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">${att.sizeKB}KB</div>
          </div>
          <button style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:10px;padding:4px 10px;cursor:pointer;">👁 Open</button>
        </div>`;
      }).join('')}
      <div style="text-align:right;margin-top:10px;">
        <button onclick="this.closest('[style*=fixed]').remove()" class="btn btn-ghost btn-sm">Close</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function _openInvAttViewerById(invId, idx) {
  const inv = invoiceList.find(i => i.id === invId);
  if (!inv || !inv.attachments[idx]) return;
  document.querySelector('[style*=fixed][style*=9400]')?.remove();
  _openInvAttViewer(inv.attachments[idx]);
}

function _openInvAttViewer(att) {
  document.getElementById('invAttViewer')?.remove();
  const isImg  = att.type && att.type.startsWith('image/');
  const isPdf  = att.type === 'application/pdf';
  const isDocx = att.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              || att.type === 'application/msword'
              || /\.docx?$/i.test(att.name || '');
  const fileIcon = isPdf ? '📄' : isDocx ? '📝' : isImg ? '🖼️' : '📎';

  const src = att.url || att.data || '';
  const viewer = document.createElement('div');
  viewer.id = 'invAttViewer';
  viewer.className = 'inv-att-viewer';
  viewer.innerHTML = `
    <div class="inv-att-viewer-bar">
      <span style="font-size:16px;">${fileIcon}</span>
      <div class="inv-att-viewer-title">${escHtml(att.name)}</div>
      <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">${att.sizeKB}KB</span>
      <a href="${src}" download="${escHtml(att.name)}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--stripe);border-color:rgba(245,197,24,0.4);">⬇ Download</a>
      <button onclick="document.getElementById('invAttViewer').remove()" class="btn btn-ghost btn-sm" style="color:#fff;">✕ Close</button>
    </div>
    <div class="inv-att-viewer-body">
      ${isPdf
        ? `<iframe src="${src}" style="width:100%;height:100%;min-height:70vh;border:none;border-radius:4px;background:#fff;"></iframe>`
        : isImg
          ? `<img src="${src}" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,0.6);" />`
          : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px;text-align:center;">
              <span style="font-size:56px;">${fileIcon}</span>
              <div style="font-family:'DM Sans',sans-serif;font-size:14px;font-weight:700;color:var(--white);">${escHtml(att.name)}</div>
              <div style="font-family:'DM Sans',sans-serif;font-size:12px;color:var(--concrete-dim);max-width:340px;line-height:1.6;">This file type can't be previewed in the browser.<br>Click <strong style="color:var(--stripe);">⬇ Download</strong> to open it on your computer.</div>
              <a href="${src}" download="${escHtml(att.name)}" target="_blank" class="btn btn-primary" style="margin-top:4px;">⬇ Download to Open</a>
            </div>`}
    </div>`;
  viewer.addEventListener('keydown', e => { if (e.key==='Escape') viewer.remove(); });
  document.body.appendChild(viewer);
  viewer.tabIndex = -1;
  viewer.focus();
}

function clearLookahead() {
  lookaheadActiveSupplier = null;
  renderSchedule();
}

function deleteLookahead(id) {
  if (!Array.isArray(lookaheads)) { lookaheads = []; }
  if (!confirm('Delete this lookahead?')) return;
  lookaheads = lookaheads.filter(l => l.id !== id);
  localStorage.setItem(LOOKAHEADS_KEY, JSON.stringify(lookaheads));
  _checkLocalStorageSize();
  renderReports();
}

function previewLookahead(id) {
  document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
  document.querySelectorAll(`.reports-file-row[data-preview-id="${id}"]`).forEach(r => r.classList.add('reports-file-active'));
  const la = lookaheads.find(l => l.id === id);
  if (!la) return;
  const freshHtml = buildLookaheadHTML(la.supplier, la.dateRange);
  showReportsPreview(
    '📊 ' + (la.fileName||'').replace('.html',''),
    freshHtml,
    () => downloadLookahead(id),
    null,
    true,
    false,
    { folder:'2 Week Lookaheads › ' + (la.supplier||''), title:(la.fileName||'').replace('.html',''), badge:'Lookahead', badgeColor:'#7ecb8f' }
  );
}

function downloadLookahead(id) {
  const la = lookaheads.find(l => l.id === id);
  if (!la) return;
  const blob = new Blob([la.htmlData], { type: 'text/html' });
  downloadBlob(blob, la.fileName);
}

function openJobMixFormulaModal() {
  document.getElementById('jobMixModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'jobMixModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9600;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div class="modal" style="max-width:540px;width:100%;max-height:90vh;overflow-y:auto;">
      <div class="modal-title" style="margin-bottom:6px;">🧪 Add Job Mix Formula</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:14px;">Reports → Job Mix Formula</div>

      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Supplier *</label>
        <input id="jmSupplier" class="form-input" placeholder="e.g. Aggregate Industries" style="width:100%;" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">Mix Name *</label>
          <input id="jmMixName" class="form-input" placeholder="e.g. 12.5mm Surface" style="width:100%;" />
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">Mix Code *</label>
          <input id="jmMixCode" class="form-input" placeholder="e.g. SP-12.5-1" style="width:100%;" />
        </div>
      </div>

      <div class="form-group" style="margin-bottom:6px;">
        <label class="form-label">Document (.pdf / .doc / .docx) *</label>
        <input id="jmFile" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="form-input" style="padding:8px;cursor:pointer;" />
      </div>
      <div id="jmUploadProgressWrap" style="display:none;margin-top:10px;">
        <div style="height:8px;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:99px;overflow:hidden;">
          <div id="jmUploadProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--stripe),#f7d451);"></div>
        </div>
        <div id="jmUploadProgressText" style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:4px;">Uploading 0%</div>
      </div>

      <div class="modal-actions" style="margin-top:18px;">
        <button class="btn btn-ghost" onclick="closeJobMixFormulaModal()">Cancel</button>
        <button class="btn btn-primary" id="jmSaveBtn" onclick="saveJobMixFormulaFromModal()">⬆ Upload Formula</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) closeJobMixFormulaModal(); });
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('jmSupplier')?.focus(), 60);
}

function closeJobMixFormulaModal() {
  document.getElementById('jobMixModal')?.remove();
}

async function saveJobMixFormulaFromModal() {
  const supplier = document.getElementById('jmSupplier')?.value.trim() || '';
  const mixName = document.getElementById('jmMixName')?.value.trim() || '';
  const mixCode = document.getElementById('jmMixCode')?.value.trim() || '';
  const fileInput = document.getElementById('jmFile');
  const file = fileInput?.files?.[0];

  if (!supplier) { document.getElementById('jmSupplier')?.focus(); return; }
  if (!mixName) { document.getElementById('jmMixName')?.focus(); return; }
  if (!mixCode) { document.getElementById('jmMixCode')?.focus(); return; }
  if (!file) { alert('Please select a document to upload.'); fileInput?.focus(); return; }

  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const isWord = /\.(doc|docx)$/i.test(file.name) ||
    file.type === 'application/msword' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!isPdf && !isWord) {
    alert('Only PDF or Word documents (.pdf, .doc, .docx) are supported for Job Mix Formula uploads.');
    return;
  }

  const btn = document.getElementById('jmSaveBtn');
  const progWrap = document.getElementById('jmUploadProgressWrap');
  const progBar = document.getElementById('jmUploadProgressBar');
  const progTxt = document.getElementById('jmUploadProgressText');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
  if (progWrap) progWrap.style.display = '';

  try {
    const folder = 'job_mix_formulas/' + supplier.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    console.log('[JobMix] Starting upload:', file.name, file.type, file.size, 'bytes → folder:', folder, 'storage:', !!storage);
    const { url, path } = await uploadFileToStorage(file, folder, pct => {
      const n = Math.max(0, Math.min(100, Math.round((pct || 0) * 100)));
      if (progBar) progBar.style.width = n + '%';
      if (progTxt) progTxt.textContent = 'Uploading ' + n + '%';
    });

    const entry = {
      id: 'jmf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      supplier,
      mixName,
      mixCode,
      fileName: file.name,
      fileType: file.type,
      fileSizeKB: Math.round(file.size / 1024),
      fileUrl: url,
      storagePath: path,
      uploadedAt: Date.now(),
      uploadedBy: localStorage.getItem('dmc_u') || 'Unknown'
    };

    jobMixFormulas.unshift(entry);
    saveJobMixFormulas();
    closeJobMixFormulaModal();
    if (activeTab === 'reports' || activeTab === 'reportsJobMix') renderReports();
    if (typeof pushNotif === 'function') {
      pushNotif('success', '🧪 Job Mix Formula Saved', `${supplier} · ${mixName} (${mixCode}) uploaded to Reports.`, null);
    }
  } catch (e) {
    _logFbError('saveJobMixFormulaFromModal', e);
    alert('Failed to upload Job Mix Formula file. ' + (e?.message || 'Please try again.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬆ Upload Formula'; }
  }
}

function setJobMixViewMode(mode) {
  if (mode !== 'cards' && mode !== 'supplier') return;
  jobMixViewMode = mode;
  if (window._activeReportsSubTab === 'reportsJobMix') _populateReportsMainList('reportsJobMix');
}

function toggleJobMixSupplierStack(supplier) {
  const key = '__jm_sup__' + supplier;
  jobMixSupplierCollapsed[key] = !jobMixSupplierCollapsed[key];
  if (window._activeReportsSubTab === 'reportsJobMix') _populateReportsMainList('reportsJobMix');
}

function _isPdfFile(jm) {
  return (jm.fileType === 'application/pdf' || /\.pdf$/i.test(jm.fileName || ''));
}

function previewJobMixFormula(id) {
  document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
  document.querySelectorAll(`.reports-file-row[data-preview-id="${id}"]`).forEach(r => r.classList.add('reports-file-active'));
  const jm = jobMixFormulas.find(x => x.id === id);
  if (!jm) return;

  const uploaded = jm.uploadedAt ? new Date(jm.uploadedAt).toLocaleString() : '';
  const infoHtml = `
    <div style="padding:20px;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:26px;">🧪</span>
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;color:var(--white);">${escHtml(jm.mixName || 'Job Mix Formula')}</div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);">${escHtml(jm.mixCode || '')}</div>
        </div>
      </div>
      <div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:12px 14px;display:grid;grid-template-columns:130px 1fr;gap:8px;font-family:'DM Sans',sans-serif;font-size:12px;">
        <div style="color:var(--concrete-dim);">Supplier</div><div style="color:var(--white);font-weight:700;">${escHtml(jm.supplier || '')}</div>
        <div style="color:var(--concrete-dim);">Mix Name</div><div style="color:var(--white);font-weight:700;">${escHtml(jm.mixName || '')}</div>
        <div style="color:var(--concrete-dim);">Mix Code</div><div style="color:var(--white);font-weight:700;">${escHtml(jm.mixCode || '')}</div>
        <div style="color:var(--concrete-dim);">File</div><div style="color:var(--white);font-weight:700;">${escHtml(jm.fileName || '')}</div>
        <div style="color:var(--concrete-dim);">Uploaded</div><div style="color:var(--white);">${escHtml(uploaded)}</div>
        <div style="color:var(--concrete-dim);">Uploaded By</div><div style="color:var(--white);">${escHtml(jm.uploadedBy || '')}</div>
      </div>
      ${(_isPdfFile(jm)
        ? '<iframe src="' + escHtml(jm.fileUrl) + '" style="width:100%;height:60vh;border:1px solid var(--asphalt-light);border-radius:var(--radius);background:#fff;"></iframe>'
        : '<div style="font-size:11px;color:var(--concrete-dim);line-height:1.6;">Word documents cannot be fully rendered in-browser. Use Download to open the source formula document.</div>')}
    </div>`;

  showReportsPreview(
    '🧪 ' + (jm.mixName || 'Job Mix Formula'),
    infoHtml,
    () => downloadJobMixFormula(id),
    null,
    false,
    false,
    { folder:'Job Mix Formula › ' + (jm.supplier||''), title: (jm.mixName||'') + (jm.mixCode ? ' (' + jm.mixCode + ')' : ''), badge:'Mix Formula', badgeColor:'#7ecb8f' }
  );
}

function downloadJobMixFormula(id) {
  const jm = jobMixFormulas.find(x => x.id === id);
  if (!jm) return;
  const src = jm.fileUrl || jm.fileData || '';
  if (!src) {
    alert('No file URL found for this formula.');
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: src, download: jm.fileName || 'job-mix-formula.docx', target:'_blank' });
  a.click();
}

async function deleteJobMixFormula(id) {
  const jm = jobMixFormulas.find(x => x.id === id);
  if (!jm) return;
  if (!confirm('Delete this Job Mix Formula? This cannot be undone.')) return;
  try {
    if (jm.storagePath) await deleteFileFromStorage(jm.storagePath);
  } catch(e) {
    _logFbError('deleteJobMixFormulaStorage', e);
  }
  jobMixFormulas = jobMixFormulas.filter(x => x.id !== id);
  saveJobMixFormulas();
  if (activeTab === 'reports' || activeTab === 'reportsJobMix') renderReports();
}

// Keep old stub name for safety
function scheduleDrop() {}

// ════════════════════════════════════════
//  BACKLOG SYSTEM
// ════════════════════════════════════════
const BACKLOG_KEY = 'pavescope_backlog';
var backlogJobs = (function(){ try { const p = JSON.parse(localStorage.getItem(BACKLOG_KEY)); return Array.isArray(p) ? p : []; } catch(e) { return []; } })();

// ── One-time migration: ensure every job has a jobFolder object ───────────────
(function _initJobFolders() {
  let dirty = false;
  backlogJobs.forEach(j => {
    if (!j.jobFolder) {
      j.jobFolder = { purchaseOrders:[], taxCerts:[], brokerBills:[], otherDocs:[] };
      dirty = true;
    } else {
      // Fill in any missing sub-arrays in case the object was partially created
      ['purchaseOrders','taxCerts','brokerBills','otherDocs'].forEach(k => {
        if (!Array.isArray(j.jobFolder[k])) { j.jobFolder[k] = []; dirty = true; }
      });
    }
  });
  if (dirty) localStorage.setItem(BACKLOG_KEY, JSON.stringify(backlogJobs));
  _checkLocalStorageSize();
})();

var backlogView = 'list';
var backlogGCCollapsed = {};
var backlogEditId = null;
var blContractItems = []; // working copy of items for current modal

function saveBacklog() {
  localStorage.setItem(BACKLOG_KEY, JSON.stringify(backlogJobs));
  _checkLocalStorageSize();
  fbSet('backlog', backlogJobs);
  const hv = document.getElementById('homeView');
  if (hv && hv.style.display !== 'none') try { renderHomeView(hv); } catch(e) {}
}

function renderBacklog() {
  const wrap = document.getElementById('backlogView');
  if (!wrap) return;
  const count = backlogJobs.length;

  // Build folder tiles — all jobs sorted by job number, 5 per row
  const sorted = [...backlogJobs].sort((a,b)=>{
    const na=parseFloat(a.num)||0, nb=parseFloat(b.num)||0;
    if(na!==nb) return na-nb;
    return (a.num||'').localeCompare(b.num||'');
  });

  const folderTiles = sorted.map(j => {
    const folder = j.jobFolder || {};
    const hasPO   = (folder.purchaseOrders||[]).length > 0;
    const hasTax  = (folder.taxCerts||[]).length > 0;
    const numVal  = parseFloat(j.num)||0;
    const needsCompliance = numVal > 3899;
    const missingDocs = needsCompliance && (!hasPO || !hasTax);

    // Doc count badges
    const linked = _jfLinkedCounts(j);
    const badges = [];
    if (linked.foremanReports > 0) badges.push(`<span class="jd-folder-badge" style="background:rgba(245,197,24,0.15);color:var(--stripe);">FR×${linked.foremanReports}</span>`);
    if (linked.dailyOrders > 0)    badges.push(`<span class="jd-folder-badge" style="background:rgba(90,180,245,0.12);color:#5ab4f5;">DO×${linked.dailyOrders}</span>`);
    if (hasPO)   badges.push(`<span class="jd-folder-badge" style="background:rgba(126,203,143,0.15);color:#7ecb8f;">PO</span>`);
    if (hasTax)  badges.push(`<span class="jd-folder-badge" style="background:rgba(126,203,143,0.15);color:#7ecb8f;">TAX</span>`);

    return `<div class="jd-folder" onclick="openJobFolder('${j.id}')">
      <div class="jd-folder-tab" style="background:${missingDocs?'rgba(217,79,61,0.5)':hasPO&&hasTax&&needsCompliance?'rgba(126,203,143,0.4)':'var(--asphalt-light)'};"></div>
      ${missingDocs?`<div class="jd-folder-warn" title="Missing PO or Tax Cert">⚠️</div>`:''}
      <div class="jd-folder-body">
        <div class="jd-folder-num">${escHtml(j.num||'—')}</div>
        <div class="jd-folder-gc">${escHtml(j.gc||'')}</div>
        <div class="jd-folder-name">${escHtml(j.name||'Unnamed')}</div>
        ${badges.length ? `<div class="jd-folder-badges">${badges.join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const emptyFolders = sorted.length === 0 ? `<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--concrete-dim);font-family:'DM Sans',sans-serif;font-size:13px;">No jobs in the directory yet.<br><span style="color:var(--stripe);cursor:pointer;" onclick="openBacklogModal()">+ Add your first job</span></div>` : '';

  wrap.innerHTML = `
    <div class="backlog-wrap">
      <div class="backlog-header" style="position:relative;">
        <div style="display:flex;align-items:center;gap:14px;flex:1;">
          <div class="backlog-title" style="position:absolute;left:50%;transform:translateX(-50%);pointer-events:none;">📁 JOB DIRECTORY</div>
          <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--concrete-dim);">${count} job${count!==1?'s':''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="backlog-toggle-btn" onclick="openAddGCModal()" style="padding:5px 14px;font-size:11px;">+ Add GC</button>
          <button class="backlog-toggle-btn" onclick="openBacklogModal()" style="padding:5px 14px;font-size:11px;background:var(--stripe);color:var(--asphalt);">+ Add Job</button>
        </div>
      </div>
      <div class="backlog-scroll">

        <!-- Job Folders card -->
        <div class="jd-folders-card">
          <div class="jd-folders-header">
            <div class="jd-folders-title">📁 Job Folders</div>
            <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">Click a folder to open documents &amp; reports</div>
          </div>
          <div class="jd-folders-grid">
            ${folderTiles}${emptyFolders}
          </div>
        </div>

        <!-- Backlog List card -->
        <div class="jd-backlog-card">
          <div class="jd-backlog-card-header">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1.2px;color:var(--white);">📋 Backlog List</div>
            <div style="display:flex;align-items:center;gap:4px;">
              <button class="backlog-toggle-btn ${backlogView==='list'?'active':''}" onclick="setBacklogView('list')" style="padding:4px 12px;font-size:10px;">≡ List</button>
              <button class="backlog-toggle-btn ${backlogView==='gc'?'active':''}" onclick="setBacklogView('gc')" style="padding:4px 12px;font-size:10px;">🏢 By GC</button>
            </div>
          </div>
          <div id="backlogContent" style="padding:0;">
            ${backlogView === 'list' ? renderBacklogList() : renderBacklogGC()}
          </div>
        </div>

      </div>
    </div>`;
}


/* ── Add GC Modal (uspm-style, same as plant picker) ─────────────── */
var _agcContacts=[], _agcJobs=[];
function _agcId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function _agcEsc(s){return(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

function openAddGCModal(){
  document.getElementById('addGCOverlay')?.remove();
  _agcContacts=[]; _agcJobs=[];
  const ov=document.createElement('div');
  ov.id='addGCOverlay'; ov.className='uspm-overlay';
  ov.innerHTML=`<div class="uspm-box" style="max-width:680px;">
    <div class="uspm-header">
      <div class="uspm-title">&#127970; New General Contractor</div>
      <button class="uspm-close" onclick="closeAddGCModal()">&#x2715;</button>
    </div>
    <div class="uspm-list" style="padding:0;flex:1;overflow-y:auto;">
      <div class="uspm-group-header">Company Info</div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--concrete-dim);">GC Name <span style="color:var(--stripe)">*</span></label>
          <input id="agcName" class="uspm-add-input" style="width:100%;box-sizing:border-box;" placeholder="e.g. Gilbane Building Co."/>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--concrete-dim);">Address</label>
          <input id="agcAddress" class="uspm-add-input" style="width:100%;box-sizing:border-box;" placeholder="123 Main St, Boston, MA 02101"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <input id="agcPhone" class="uspm-add-input" placeholder="Phone"/>
          <input id="agcWebsite" class="uspm-add-input" placeholder="Website"/>
        </div>
      </div>
      <div class="uspm-group-header" style="display:flex;align-items:center;justify-content:space-between;pointer-events:all;">
        <span>Contacts</span><button class="uspm-add-btn" style="font-size:10px;padding:3px 10px;" onclick="agcAddContact()">+ Add</button>
      </div>
      <div id="agcContactsList"><div class="uspm-empty">No contacts yet</div></div>
      <div class="uspm-group-header" style="display:flex;align-items:center;justify-content:space-between;pointer-events:all;">
        <span>Jobs &amp; Contract Items</span><button class="uspm-add-btn" style="font-size:10px;padding:3px 10px;" onclick="agcAddJob()">+ Add Job</button>
      </div>
      <div id="agcJobsList"><div class="uspm-empty">No jobs yet</div></div>
      <div class="uspm-group-header">Notes</div>
      <div style="padding:10px 16px;">
        <textarea id="agcNotes" class="uspm-add-input" style="width:100%;box-sizing:border-box;resize:vertical;min-height:56px;line-height:1.45;" placeholder="Notes&#x2026;"></textarea>
      </div>
    </div>
    <div class="uspm-footer">
      <button class="btn btn-ghost" onclick="closeAddGCModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAddGCModal()">&#128190; Save GC</button>
    </div>
  </div>`;
  ov.addEventListener('click',e=>{if(e.target===ov)closeAddGCModal();});
  document.body.appendChild(ov);
  setTimeout(()=>{const n=document.getElementById('agcName');if(n)n.focus();},60);
}
function closeAddGCModal(){document.getElementById('addGCOverlay')?.remove();}

function agcAddContact(){_agcContacts.push({id:_agcId(),name:'',title:'',phone:'',email:''});_agcRenderContacts();}
function agcDelContact(id){_agcContacts=_agcContacts.filter(c=>c.id!==id);_agcRenderContacts();}
function agcUC(id,f,v){const c=_agcContacts.find(c=>c.id===id);if(c)c[f]=v;}
function _agcRenderContacts(){
  const el=document.getElementById('agcContactsList');if(!el)return;
  if(!_agcContacts.length){el.innerHTML='<div class="uspm-empty">No contacts yet</div>';return;}
  el.innerHTML=_agcContacts.map(c=>`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.04);">
      <input class="uspm-add-input" value="${_agcEsc(c.name)}" placeholder="Name" oninput="agcUC('${c.id}','name',this.value)"/>
      <input class="uspm-add-input" value="${_agcEsc(c.title)}" placeholder="Title" oninput="agcUC('${c.id}','title',this.value)"/>
      <input class="uspm-add-input" value="${_agcEsc(c.phone)}" placeholder="Phone" oninput="agcUC('${c.id}','phone',this.value)"/>
      <input class="uspm-add-input" value="${_agcEsc(c.email)}" placeholder="Email" oninput="agcUC('${c.id}','email',this.value)"/>
      <button onclick="agcDelContact('${c.id}')" style="grid-column:1/-1;background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);color:var(--concrete-dim);font-size:11px;padding:4px;cursor:pointer;">Remove</button>
    </div>`).join('');
}

function agcAddJob(){_agcJobs.push({id:_agcId(),num:'',name:'',status:'pending',contractMode:'later',items:[]});_agcRenderJobs();}
function agcDelJob(id){_agcJobs=_agcJobs.filter(j=>j.id!==id);_agcRenderJobs();}
function agcUJ(id,f,v){const j=_agcJobs.find(j=>j.id===id);if(j)j[f]=v;}
function agcJobMode(id,mode){
  const j=_agcJobs.find(j=>j.id===id);if(!j)return;j.contractMode=mode;
  ['now','later'].forEach(m=>{
    const nb=document.getElementById('agc-t'+m+'-'+id);
    if(nb){nb.style.background=m===mode?'var(--stripe)':'none';nb.style.color=m===mode?'#000':'var(--concrete-dim)';}
  });
  const ns=document.getElementById('agc-cnow-'+id),ls=document.getElementById('agc-clater-'+id);
  if(ns)ns.style.display=mode==='now'?'':'none';
  if(ls)ls.style.display=mode==='later'?'':'none';
}
function agcAddItem(jid){
  const j=_agcJobs.find(j=>j.id===jid);if(!j)return;
  j.items.push({id:_agcId(),itemNo:'',desc:'',qty:'',unit:'TON',unitPrice:'',total:''});
  _agcRefreshItems(j);
}
function agcDelItem(jid,iid){
  const j=_agcJobs.find(j=>j.id===jid);if(!j)return;
  j.items=j.items.filter(i=>i.id!==iid);_agcRefreshItems(j);
}
function agcUI(jid,iid,f,v){
  const j=_agcJobs.find(j=>j.id===jid);if(!j)return;
  const item=j.items.find(i=>i.id===iid);if(!item)return;
  item[f]=v;
  const qty=parseFloat(item.qty)||0, price=parseFloat((item.unitPrice||'').replace(/[$,]/g,''))||0;
  item.total=(qty&&price)?(qty*price).toFixed(2):'';
  const cell=document.getElementById('agc-tot-'+iid);
  if(cell)cell.textContent=item.total?'$'+parseFloat(item.total).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  const tot=j.items.reduce((s,i)=>s+(parseFloat(i.total)||0),0);
  const tel=document.getElementById('agc-jtot-'+jid);
  if(tel)tel.textContent=tot>0?'Total: $'+tot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'';
}
function _agcItemsHtml(j){
  if(!j.items.length)return '<div class="uspm-empty" style="font-size:12px;padding:6px 14px;">No items — click + Add Line Item</div>';
  return j.items.map(item=>`
    <div style="display:grid;grid-template-columns:60px 1fr 55px 65px 80px 80px auto;gap:4px;padding:5px 12px;border-bottom:1px solid rgba(255,255,255,0.04);align-items:end;">
      <input class="uspm-add-input" value="${_agcEsc(item.itemNo)}" placeholder="#" oninput="agcUI('${j.id}','${item.id}','itemNo',this.value)" style="text-align:center;padding:5px 4px;"/>
      <input class="uspm-add-input" value="${_agcEsc(item.desc)}" placeholder="Description" oninput="agcUI('${j.id}','${item.id}','desc',this.value)" style="padding:5px 6px;"/>
      <input class="uspm-add-input" type="number" value="${_agcEsc(item.qty)}" placeholder="Qty" oninput="agcUI('${j.id}','${item.id}','qty',this.value)" style="text-align:right;padding:5px 4px;"/>
      <select class="uspm-add-input" style="padding:5px 4px;cursor:pointer;" onchange="agcUI('${j.id}','${item.id}','unit',this.value)">${['TON','SY','LF','SF','CY','LS','EA'].map(u=>'<option '+(item.unit===u?'selected':'')+'>'+u+'</option>').join('')}</select>
      <input class="uspm-add-input" value="${_agcEsc(item.unitPrice)}" placeholder="$0.00" oninput="agcUI('${j.id}','${item.id}','unitPrice',this.value)" style="text-align:right;padding:5px 4px;"/>
      <div id="agc-tot-${item.id}" style="background:var(--asphalt-light);border-radius:var(--radius);padding:5px 6px;font-family:'DM Mono',monospace;font-size:10px;color:var(--stripe);text-align:right;">${item.total?'$'+parseFloat(item.total).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</div>
      <button onclick="agcDelItem('${j.id}','${item.id}')" style="background:none;border:none;color:var(--concrete-dim);cursor:pointer;font-size:13px;padding:3px;">&#x2715;</button>
    </div>`).join('');
}
function _agcRefreshItems(j){
  const el=document.getElementById('agc-items-'+j.id);if(el)el.innerHTML=_agcItemsHtml(j);
  const tot=j.items.reduce((s,i)=>s+(parseFloat(i.total)||0),0);
  const tel=document.getElementById('agc-jtot-'+j.id);
  if(tel)tel.textContent=tot>0?'Total: $'+tot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'';
}
function _agcRenderJobs(){
  const el=document.getElementById('agcJobsList');if(!el)return;
  if(!_agcJobs.length){el.innerHTML='<div class="uspm-empty">No jobs yet — add a job to set contract items</div>';return;}
  el.innerHTML=_agcJobs.map(j=>{
    const isNow=j.contractMode==='now';
    return `<div style="margin:8px 12px;border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);overflow:hidden;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--asphalt-mid);border-bottom:1px solid var(--asphalt-light);">
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--stripe);font-weight:700;">${_agcEsc(j.num)||'#—'}</span>
        <span style="flex:1;font-size:12px;font-weight:700;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_agcEsc(j.name)||'New Job'}</span>
        <button onclick="agcDelJob('${j.id}')" style="background:none;border:none;color:var(--concrete-dim);cursor:pointer;font-size:13px;">&#x2715;</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 12px;">
        <input class="uspm-add-input" value="${_agcEsc(j.num)}" placeholder="Job #" oninput="agcUJ('${j.id}','num',this.value)"/>
        <input class="uspm-add-input" value="${_agcEsc(j.name)}" placeholder="Job Name" oninput="agcUJ('${j.id}','name',this.value)"/>
        <select class="uspm-add-input" style="cursor:pointer;grid-column:1/-1;" onchange="agcUJ('${j.id}','status',this.value)">
          <option value="pending" ${j.status==='pending'?'selected':''}>&#128203; Pending</option>
          <option value="active"  ${j.status==='active' ?'selected':''}>&#9654; Active</option>
          <option value="complete"${j.status==='complete'?'selected':''}>&#x2713; Complete</option>
        </select>
      </div>
      <div style="border-top:1px solid var(--asphalt-light);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:rgba(0,0,0,0.15);">
          <span style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Contract Items</span>
          <div style="display:flex;gap:3px;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:2px;">
            <button id="agc-tnow-${j.id}" onclick="agcJobMode('${j.id}','now')" style="background:${isNow?'var(--stripe)':'none'};color:${isNow?'#000':'var(--concrete-dim)'};border:none;border-radius:2px;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:700;padding:3px 10px;cursor:pointer;">Now</button>
            <button id="agc-tlater-${j.id}" onclick="agcJobMode('${j.id}','later')" style="background:${!isNow?'var(--stripe)':'none'};color:${!isNow?'#000':'var(--concrete-dim)'};border:none;border-radius:2px;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:700;padding:3px 10px;cursor:pointer;">Later</button>
          </div>
        </div>
        <div id="agc-cnow-${j.id}" style="${isNow?'':'display:none'}">
          <div id="agc-items-${j.id}">${_agcItemsHtml(j)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px 8px;">
            <button class="uspm-add-btn" style="font-size:10px;padding:4px 10px;" onclick="agcAddItem('${j.id}')">+ Line Item</button>
            <div id="agc-jtot-${j.id}" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--stripe);font-weight:700;"></div>
          </div>
        </div>
        <div id="agc-clater-${j.id}" style="${!isNow?'':'display:none'}"><div class="uspm-empty" style="font-size:12px;">Add contract items from this job's Backlog card after saving.</div></div>
      </div>
    </div>`;}).join('');
}

function saveAddGCModal(){
  const nameEl=document.getElementById('agcName');
  const name=(nameEl?.value||'').trim();
  if(!name){if(nameEl){nameEl.style.borderColor='var(--red)';nameEl.focus();setTimeout(()=>nameEl.style.borderColor='',1800);}return;}
  const allNames=[...new Set([...Object.keys(getAllGCProfiles()),...backlogJobs.map(j=>j.gc?.trim()).filter(Boolean)])];
  const dup=allNames.find(n=>n.toLowerCase()===name.toLowerCase());
  if(dup){alert('A GC named "'+dup+'" already exists.');setBacklogView('gc');closeAddGCModal();return;}
  saveGCProfile(name,{
    address:document.getElementById('agcAddress')?.value.trim()||'',
    phone:  document.getElementById('agcPhone')?.value.trim()||'',
    website:document.getElementById('agcWebsite')?.value.trim()||'',
    notes:  document.getElementById('agcNotes')?.value.trim()||'',
    contacts:_agcContacts.map(c=>({name:c.name,role:c.title,phone:c.phone,email:c.email})),
  });
  _agcJobs.forEach(j=>{
    const items=j.contractMode==='now'?JSON.parse(JSON.stringify(j.items)):[];
    const total=items.reduce((s,i)=>s+(parseFloat(i.total)||0),0);
    backlogJobs.push({
      id:_agcId(), created:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
      name:j.name.trim()||name+' Project', num:j.num.trim(), gc:name,
      location:'',notes:'',jobStatus:j.status||'pending',items,
      value:total>0?'$'+total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'',
      awardingAuthority:'',headerPlant1:'',headerPlant2:'',
      jobFolder:{ purchaseOrders:[], taxCerts:[], brokerBills:[], otherDocs:[] },
    });
  });
  if(_agcJobs.length) saveBacklog();
  closeAddGCModal(); setBacklogView('gc');
  setTimeout(()=>{const card=document.getElementById('gc_'+encodeGCKey(name));if(card)card.scrollIntoView({behavior:'smooth',block:'start'});},250);
}


document.addEventListener('DOMContentLoaded', function() {
// ── Schedule AI Assistant ──────────────────────────────────────────────────
(function(){
  'use strict';

  const PROXY_URL = () => (localStorage.getItem('dmc_claude_proxy_url') || 'https://dmc-claude-proxy-production.up.railway.app/claude').trim();
  let _panelOpen = false;
  let _chatHistory = [];
  let _isListening = false;
  let _recognition = null;

  // ── Styles ────────────────────────────────────────────────────────────────
  const _st = document.createElement('style');
  _st.textContent = `
    #_saiPanel{position:fixed;top:0;right:-440px;width:420px;height:100vh;background:#1a1a1a;
      border-left:1px solid rgba(126,203,143,0.25);z-index:9500;display:flex;flex-direction:column;
      transition:right 0.32s cubic-bezier(0.4,0,0.2,1);box-shadow:-10px 0 50px rgba(0,0,0,0.7);}
    #_saiPanel.open{right:0;}
    #_saiHdr{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid rgba(126,203,143,0.15);background:#111;flex-shrink:0;}
    #_saiTitle{font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:2px;color:#7ecb8f;flex:1;}
    #_saiStatus{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;padding:2px 8px;
      border-radius:8px;background:rgba(126,203,143,0.08);border:1px solid rgba(126,203,143,0.2);color:#7ecb8f;}
    #_saiClose{background:none;border:none;color:#9b9488;cursor:pointer;font-size:16px;padding:4px;line-height:1;}
    #_saiClose:hover{color:#fff;}
    #_saiMsgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;}
    .sai-msg{display:flex;flex-direction:column;max-width:92%;gap:3px;}
    .sai-msg.user{align-self:flex-end;align-items:flex-end;}
    .sai-msg.ai{align-self:flex-start;align-items:flex-start;}
    .sai-bubble{padding:9px 12px;border-radius:10px;font-family:'DM Mono',monospace;font-size:11px;
      line-height:1.55;white-space:pre-wrap;word-break:break-word;}
    .sai-msg.user .sai-bubble{background:rgba(90,180,245,0.13);border:1px solid rgba(90,180,245,0.28);color:#cfe8ff;}
    .sai-msg.ai .sai-bubble{background:rgba(126,203,143,0.09);border:1px solid rgba(126,203,143,0.22);color:#dff0e1;}
    .sai-bubble.thinking{background:rgba(126,203,143,0.04);color:#7ecb8f;font-style:italic;}
    .sai-ts{font-family:'DM Mono',monospace;font-size:8px;color:#555;}
    #_saiBottom{display:flex;gap:7px;padding:11px 12px;border-top:1px solid rgba(255,255,255,0.06);
      background:#111;flex-shrink:0;align-items:flex-end;}
    #_saiText{flex:1;background:#252525;border:1px solid #333;border-radius:6px;color:#f9f7f3;
      font-family:'DM Mono',monospace;font-size:11px;padding:8px 10px;resize:none;
      min-height:38px;max-height:90px;line-height:1.45;overflow-y:auto;box-sizing:border-box;}
    #_saiText:focus{outline:none;border-color:rgba(126,203,143,0.4);}
    #_saiMic{width:38px;height:38px;border-radius:50%;background:rgba(126,203,143,0.1);
      border:1px solid rgba(126,203,143,0.3);color:#7ecb8f;font-size:17px;cursor:pointer;
      flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}
    #_saiMic.listening{background:rgba(217,79,61,0.28);border-color:rgba(217,79,61,0.6);
      color:#d94f3d;animation:_saiPulse 1s ease-in-out infinite;}
    #_saiSend{width:38px;height:38px;border-radius:6px;background:rgba(126,203,143,0.13);
      border:1px solid rgba(126,203,143,0.32);color:#7ecb8f;font-size:15px;
      cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
    #_saiSend:hover{background:rgba(126,203,143,0.22);}
    #_saiStop{width:38px;height:38px;border-radius:6px;background:rgba(245,197,24,0.09);
      border:1px solid rgba(245,197,24,0.28);color:#f5c518;font-size:14px;cursor:pointer;
      flex-shrink:0;display:none;align-items:center;justify-content:center;}
    #_saiStop.on{display:flex;}
    @keyframes _saiPulse{0%,100%{box-shadow:0 0 0 0 rgba(217,79,61,0.4);}50%{box-shadow:0 0 0 8px rgba(217,79,61,0);}}
    #_saiActions{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;flex-wrap:wrap;}
    #_saiLowbedBtn{background:rgba(245,197,24,0.1);border:1px solid rgba(245,197,24,0.3);border-radius:6px;
      color:#f5c518;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.5px;padding:6px 12px;
      cursor:pointer;transition:background 0.15s;}
    #_saiLowbedBtn:hover{background:rgba(245,197,24,0.2);}
    #_saiLowbedBtn:disabled{opacity:0.45;cursor:not-allowed;}
    #_saiVerifyBtn{background:rgba(126,203,143,0.08);border:1px solid rgba(126,203,143,0.3);border-radius:6px;
      color:#7ecb8f;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.5px;padding:6px 12px;
      cursor:pointer;transition:background 0.15s;}
    #_saiVerifyBtn:hover{background:rgba(126,203,143,0.18);}
    #_saiTab{position:fixed;top:50%;right:0;transform:translateY(-50%);background:#1a1a1a;
      border:1px solid rgba(126,203,143,0.28);border-right:none;border-radius:8px 0 0 8px;
      padding:10px 6px;cursor:pointer;z-index:9499;
      transition:right 0.32s cubic-bezier(0.4,0,0.2,1);display:flex;flex-direction:column;align-items:center;gap:4px;}
    #_saiTab.hidden{right:-52px;}
    #_saiTab span:first-child{font-size:18px;}
    #_saiTab span:last-child{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;
      color:#7ecb8f;writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);}
  `;
  document.head.appendChild(_st);

  // ── Build panel ───────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = '_saiPanel';
  panel.innerHTML =
    '<div id="_saiHdr">' +
      '<div id="_saiTitle">🤖 Schedule AI</div>' +
      '<div id="_saiStatus">Ready</div>' +
      '<button id="_saiClose" onclick="window._schedAI.close()">✕</button>' +
    '</div>' +
    '<div id="_saiActions">' +
      '<button id="_saiLowbedBtn" onclick="window._schedAI.generateLowbed()" title="AI generates lowbed driver assignments from the schedule">🚛 Generate Lowbed Assignments</button>' +
      '<button id="_saiVerifyBtn" onclick="window._schedAI.verify()" title="Review and verify the pending lowbed plan">📋 Verify Moves</button>' +
    '</div>' +
    '<div id="_saiMsgs"></div>' +
    '<div id="_saiBottom">' +
      '<button id="_saiMic" title="Click to talk">🎙️</button>' +
      '<textarea id="_saiText" placeholder="Ask about the schedule…" rows="1"></textarea>' +
      '<button id="_saiStop" title="Stop speaking">⏹</button>' +
      '<button id="_saiSend" onclick="window._schedAI.send()">➤</button>' +
    '</div>';
  document.body.appendChild(panel);

  const saiTab = document.createElement('div');
  saiTab.id = '_saiTab';
  saiTab.className = 'hidden';
  saiTab.title = 'Schedule AI';
  saiTab.onclick = () => _open();
  saiTab.innerHTML = '<span>🤖</span><span>AI</span>';
  document.body.appendChild(saiTab);

  // ── Speech Recognition ────────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    _recognition = new SR();
    _recognition.lang = 'en-US';
    _recognition.continuous = false;
    _recognition.interimResults = false;
    _recognition.onresult = ev => {
      const txt = ev.results[0][0].transcript;
      _stopListen();
      sendMessage(txt);
    };
    _recognition.onerror = () => _stopListen();
    _recognition.onend   = () => _stopListen();
  }

  document.getElementById('_saiMic').onclick = () => {
    if (!SR) { _appendMsg('ai', '⚠️ Voice input not supported in this browser.'); return; }
    _isListening ? _stopListen() : _startListen();
  };

  document.getElementById('_saiText').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window._schedAI.send(); }
  });

  function _startListen() {
    _isListening = true;
    const m = document.getElementById('_saiMic');
    m.classList.add('listening'); m.textContent = '🔴';
    _setStatus('Listening…');
    try { _recognition.start(); } catch(e) { _stopListen(); }
  }
  function _stopListen() {
    _isListening = false;
    const m = document.getElementById('_saiMic');
    m.classList.remove('listening'); m.textContent = '🎙️';
    _setStatus('Ready');
    try { _recognition.stop(); } catch(e) {}
  }
  function _setStatus(t) { const s=document.getElementById('_saiStatus'); if(s) s.textContent=t; }

  function _appendMsg(role, text, thinking=false) {
    const wrap = document.getElementById('_saiMsgs'); if (!wrap) return null;
    const ts = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    const d = document.createElement('div');
    d.className = 'sai-msg '+role;
    const safe = (typeof escHtml==='function') ? escHtml(text) : text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    d.innerHTML = '<div class="sai-bubble'+(thinking?' thinking':'')+'">'+safe+'</div><div class="sai-ts">'+ts+'</div>';
    wrap.appendChild(d);
    wrap.scrollTop = wrap.scrollHeight;
    return d;
  }

  let _currentAudio = null;

  document.getElementById('_saiStop').onclick = () => {
    if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
    window.speechSynthesis?.cancel();
    document.getElementById('_saiStop').classList.remove('on');
  };

  async function _speak(text) {
    const clean = text.replace(/ACTION:\s*\{[^}]*\}/g,'').replace(/\n+/g,' ').trim();
    if (!clean) return;
    // Stop anything already playing
    if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
    window.speechSynthesis?.cancel();

    const btn = document.getElementById('_saiStop');
    btn?.classList.add('on');

    // ── Try ElevenLabs via Railway ──────────────────────────────────────────
    const base = PROXY_URL().replace(/\/claude$/, '');
    try {
      const resp = await fetch(base + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean })
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        _currentAudio = audio;
        audio.onended = audio.onerror = () => {
          btn?.classList.remove('on');
          URL.revokeObjectURL(url);
          _currentAudio = null;
        };
        audio.play();
        return;
      } else {
        const errBody = await resp.json().catch(() => ({}));
        console.warn('[TTS] ElevenLabs error', resp.status, errBody);
      }
    } catch(e) { console.warn('[TTS] Railway error:', e.message); /* fall through to browser TTS */ }

    // ── Fallback: browser SpeechSynthesis with best available voice ─────────
    if (!window.speechSynthesis) { btn?.classList.remove('on'); return; }
    const utt = new SpeechSynthesisUtterance(clean);
    // Pick the most natural-sounding available English voice
    const voices = speechSynthesis.getVoices();
    const pick = voices.find(v => /Samantha|Karen|Daniel|Evan|Nicky|Siri/i.test(v.name) && /^en/.test(v.lang))
              || voices.find(v => /(Neural|Premium|Enhanced|Natural)/i.test(v.name) && /^en/.test(v.lang))
              || voices.find(v => /^en/.test(v.lang) && v.localService);
    if (pick) utt.voice = pick;
    utt.rate = 1.0; utt.pitch = 1.0; utt.volume = 1.0;
    utt.onend  = () => btn?.classList.remove('on');
    utt.onerror= () => btn?.classList.remove('on');
    window.speechSynthesis.speak(utt);
  }

  // ── Build schedule context ────────────────────────────────────────────────
  function _buildContext() {
    const todayStr = new Date().toISOString().split('T')[0];
    const monthLabel = (typeof getMonthLabel==='function') ? getMonthLabel(schedMonthOffset) : '';
    const lines = [];
    Object.keys(schedData||{}).sort().forEach(key => {
      const day = schedData[key]||{};
      ['top','bottom'].forEach(slot => {
        const b = day[slot]; if (!b || b.type==='blank' || !b.type) return;
        const f = b.fields||{};
        const parts = [`${key}/${slot} [${b.type.toUpperCase()}]`];
        if (f.jobName)   parts.push('Job:'+f.jobName);
        if (f.jobNum)    parts.push('#'+f.jobNum);
        if (f.plant)     parts.push('Plant:'+f.plant);
        if (f.operators) parts.push('Crew:'+f.operators);
        if (f.equipment) parts.push('Equip:'+f.equipment);
        if (f.material)  { try{const m=JSON.parse(f.material);parts.push('Mat:'+m.map(x=>x.name+(x.tons?' '+x.tons+'T':'')).join(', '));}catch(e){parts.push('Mat:'+f.material);} }
        if (f.notes)     parts.push('Notes:'+f.notes);
        lines.push(parts.join(' | '));
      });
    });
    const bl = (typeof backlogJobs!=='undefined'?backlogJobs:[]).slice(0,15)
      .map(j=>'- '+(j.name||j.jobName||'')+(j.jobNum?' #'+j.jobNum:'')).join('\n');

    return `Today: ${todayStr}. Viewing: ${monthLabel}.

SCHEDULE:
${lines.length?lines.join('\n'):'(no scheduled jobs)'}

BACKLOG (first 15):
${bl||(none)}

FIELDS: jobName, jobNum, plant, material, equipment, operators, qc, tack, rubber, trucking, contact, notes
TYPES: day, night, pending, blank
SLOTS: top, bottom (two crew slots per calendar day)
DATE FORMAT: YYYY-MM-DD

Take actions by appending ACTION lines (after your plain-language reply):
ACTION: {"type":"setField","date":"YYYY-MM-DD","slot":"top","field":"jobName","value":"..."}
ACTION: {"type":"setField","date":"YYYY-MM-DD","slot":"top","field":"notes","value":"..."}
ACTION: {"type":"setType","date":"YYYY-MM-DD","slot":"top","blockType":"day"}
ACTION: {"type":"move","fromDate":"YYYY-MM-DD","fromSlot":"top","toDate":"YYYY-MM-DD","toSlot":"top"}
ACTION: {"type":"clear","date":"YYYY-MM-DD","slot":"top"}
ACTION: {"type":"queue","date":"YYYY-MM-DD","slot":"top"}

Keep replies concise (2-4 sentences). Confirm actions taken.`;
  }

  // ── Execute schedule actions ──────────────────────────────────────────────
  function _execActions(txt) {
    const re = /ACTION:\s*(\{[^}]+\})/g; let m; let ran=0;
    while ((m=re.exec(txt))!==null) {
      try { _runAction(JSON.parse(m[1])); ran++; } catch(e) { console.warn('sAI action err',e); }
    }
    if (ran>0) {
      if (typeof saveSchedData==='function') saveSchedData();
      if (typeof renderSchedule==='function') renderSchedule();
    }
  }

  function _runAction(a) {
    const k=a.date; if(!k) return;
    if (!schedData[k]) schedData[k]={};
    if (a.type==='setType') {
      const sl=a.slot||'top';
      if (!schedData[k][sl]) schedData[k][sl]={type:'blank',fields:{}};
      schedData[k][sl].type = a.blockType||'blank';
    } else if (a.type==='setField') {
      const sl=a.slot||'top';
      if (!schedData[k][sl]) schedData[k][sl]={type:'day',fields:{}};
      if (!schedData[k][sl].fields) schedData[k][sl].fields={};
      schedData[k][sl].fields[a.field]=a.value||'';
    } else if (a.type==='clear') {
      schedData[k][a.slot||'top']={type:'blank',fields:{}};
    } else if (a.type==='move') {
      const src=(schedData[a.fromDate]||{})[a.fromSlot||'top'];
      if (!src||src.type==='blank') return;
      if (!schedData[a.toDate]) schedData[a.toDate]={};
      schedData[a.toDate][a.toSlot||'top']=JSON.parse(JSON.stringify(src));
      schedData[a.fromDate][a.fromSlot||'top']={type:'blank',fields:{}};
    } else if (a.type==='queue') {
      if (typeof addBlockToQueue==='function') addBlockToQueue(k, a.slot||'top');
    }
  }

  // ── Send to Claude ────────────────────────────────────────────────────────
  async function sendMessage(userText) {
    userText = userText.trim(); if (!userText) return;
    const textEl = document.getElementById('_saiText');
    if (textEl) textEl.value = '';

    _appendMsg('user', userText);
    _chatHistory.push({role:'user', content:userText});

    const thinkDiv = _appendMsg('ai','…',true);
    _setStatus('Thinking…');

    try {
      const body = {
        model:'claude-haiku-4-5-20251001',
        max_tokens:1024,
        system:'You are an AI assistant embedded in a paving company schedule management app. You can read and modify the Master Schedule.\n\n'+_buildContext(),
        messages: _chatHistory.map(m=>({role:m.role,content:m.content})),
        stream:false
      };

      const resp = await fetch(PROXY_URL(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (!resp.ok) throw new Error('API '+resp.status);
      const data = await resp.json();
      const aiText = data.content?.[0]?.text || '(no response)';

      thinkDiv?.remove();
      _appendMsg('ai', aiText);
      _chatHistory.push({role:'assistant',content:aiText});
      if (_chatHistory.length>20) _chatHistory=_chatHistory.slice(-20);

      _execActions(aiText);
      _speak(aiText);
      _setStatus('Ready');
    } catch(err) {
      thinkDiv?.remove();
      _appendMsg('ai','⚠️ '+err.message);
      _setStatus('Error');
      setTimeout(()=>_setStatus('Ready'),3000);
    }
  }

  // ── AI access control ─────────────────────────────────────────────────────
  const _AI_ALLOWED = new Set(['dj','donmartin','christian','dsouza','dgomez',
    'dj@donmartincorp.com','donmartin@donmartincorp.com',
    'christianmcgourty@donmartincorp.com','danasouza@donmartincorp.com','dgomez1085@gmail.com']);
  function _canUseAI() {
    const u = (localStorage.getItem('dmc_u') || '').toLowerCase().trim();
    return _AI_ALLOWED.has(u);
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function _open() {
    if (!_canUseAI()) return;
    _panelOpen=true;
    panel.classList.add('open');
    saiTab.classList.add('hidden');
    const msgs=document.getElementById('_saiMsgs');
    if (msgs&&msgs.children.length===0) {
      _appendMsg('ai','Hi! I can read your schedule, answer questions, and make changes — just ask. Try "What\'s scheduled for tomorrow?" or "Move the top slot on March 28 to March 30."');
    }
    setTimeout(()=>document.getElementById('_saiText')?.focus(),340);
  }
  function _close() {
    _panelOpen=false;
    panel.classList.remove('open');
    // Only show tab when on schedule tab
    if (window.activeTab==='schedule') saiTab.classList.remove('hidden');
    window.speechSynthesis?.cancel();
    if (_isListening) _stopListen();
  }

  // ── Lowbed Assignment Generator ───────────────────────────────────────────
  // ── Build fleet icon map for chips ──────────────────────────────────────────
  const _EQ_ICONS = typeof FLEET_TYPE_ICONS!=='undefined' ? FLEET_TYPE_ICONS : {
    paver:'🟧',roller:'🔵',milling:'⚙️',excavator:'🏗️',loader:'🚜',skid_steer:'🔧',
    compactor:'🟤',dump_truck:'🚛',lowbed:'🚚',tack_truck:'🛢️',water_truck:'💧',
    generator:'⚡',trailer:'🔗',other:'📦'
  };

  // ── Verification UI ───────────────────────────────────────────────────────
  function _openLowbedVerification() {
    const plan = (() => { try { return JSON.parse(localStorage.getItem('dmc_lowbed_plan')||'null'); } catch(e){ return null; } })();
    if (!plan) { alert('No pending lowbed plan found.'); return; }
    const driverList = (typeof employees!=='undefined'?employees:[])
      .filter(e=>(e.role==='driver'||e.role==='driver_broker')&&e.status!=='inactive')
      .map(e=>e.name||((e.firstName||'')+' '+(e.lastName||'')).trim());

    document.getElementById('_lbVerifyOverlay')?.remove();
    const ov = document.createElement('div');
    ov.id = '_lbVerifyOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9800;display:flex;align-items:center;justify-content:center;padding:20px;';

    const jobsHtml = (plan.jobs||[]).map((job,ji) =>
      `<div style="border:1px solid rgba(245,197,24,0.2);border-radius:8px;overflow:hidden;margin-bottom:14px;">
        <div style="background:rgba(245,197,24,0.08);padding:10px 14px;border-bottom:1px solid rgba(245,197,24,0.15);">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;color:var(--stripe);">${job.jobName||'Unnamed Job'}${job.jobNum?' <span style="font-size:11px;opacity:0.7;">#'+job.jobNum+'</span>':''}</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">${job.date||''} ${job.location?'· '+job.location:''}</div>
          ${job.allEquipment?.length?`<div style="font-family:'DM Mono',monospace;font-size:9px;color:#5ab4f5;margin-top:3px;">All equipment: ${job.allEquipment.map(e=>(_EQ_ICONS[e.type]||'📦')+' '+e.name).join(' · ')}</div>`:''}
        </div>
        ${(job.moves||[]).map((mv,mi) =>
          `<div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div style="flex-shrink:0;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;color:var(--concrete-dim);padding-top:2px;">MOVE ${mi+1}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">
                ${(mv.equipment||[]).map(eq=>`<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(245,197,24,0.1);border:1px solid rgba(245,197,24,0.28);border-radius:10px;padding:3px 8px;font-family:'DM Mono',monospace;font-size:9px;color:var(--stripe);">${_EQ_ICONS[eq.type]||'📦'} ${eq.name}</span>`).join('')}
              </div>
              ${mv.notes?`<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);">${mv.notes}</div>`:''}
            </div>
            <div style="flex-shrink:0;display:flex;align-items:center;gap:6px;">
              <select id="_lbDrv_${ji}_${mi}" style="background:#1a1a1a;border:1px solid #444;border-radius:4px;color:var(--white);font-family:'DM Mono',monospace;font-size:10px;padding:5px 8px;">
                <option value="">— Assign driver —</option>
                ${driverList.map(d=>`<option value="${d}"${mv.assignedDriver===d?' selected':''}>${d}</option>`).join('')}
              </select>
            </div>
          </div>`
        ).join('')}
      </div>`
    ).join('');

    ov.innerHTML =
      `<div style="background:var(--asphalt-mid);border:1px solid rgba(245,197,24,0.35);border-radius:10px;width:100%;max-width:680px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.9);">
        <div style="display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--asphalt-light);flex-shrink:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:var(--stripe);flex:1;">🚛 Verify Lowbed Moves</div>
          <button onclick="document.getElementById('_lbVerifyOverlay').remove()" style="background:none;border:none;color:var(--concrete-dim);font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="background:rgba(245,197,24,0.06);padding:8px 20px;border-bottom:1px solid rgba(245,197,24,0.1);flex-shrink:0;">
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);">${plan.summary||''}</div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:16px 20px;">${jobsHtml}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-top:1px solid var(--asphalt-light);flex-shrink:0;">
          <button onclick="document.getElementById('_lbVerifyOverlay').remove()" style="background:none;border:1px solid var(--asphalt-light);border-radius:5px;color:var(--concrete-dim);font-family:'DM Mono',monospace;font-size:10px;padding:8px 16px;cursor:pointer;">Cancel</button>
          <button onclick="window._lbVerifySend()" style="background:rgba(126,203,143,0.15);border:1px solid rgba(126,203,143,0.45);border-radius:5px;color:#7ecb8f;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;padding:9px 22px;cursor:pointer;">✓ Verify & Send to Drivers</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    window._lbVerifySend = async function(adminOverride) {
      // Collect driver assignments from dropdowns
      (plan.jobs||[]).forEach((job,ji) => {
        (job.moves||[]).forEach((mv,mi) => {
          const sel = document.getElementById(`_lbDrv_${ji}_${mi}`);
          mv.assignedDriver = sel?.value || null;
          mv.status = mv.assignedDriver ? 'assigned' : 'unassigned';
        });
      });

      // ── Double-booking guard ──────────────────────────────────────────────
      if (!adminOverride) {
        const conflicts = [];
        (plan.jobs||[]).forEach(job => {
          if (!job.date) return;
          (job.moves||[]).forEach((mv, mi) => {
            (mv.equipment||[]).forEach(eq => {
              if (!eq.name) return;
              const check = (typeof _eqIsBookedOn === 'function')
                ? _eqIsBookedOn(eq.name, job.date, job.jobName)
                : { conflict: false };
              if (check.conflict) {
                conflicts.push(`• ${eq.name} (Move ${mi+1}, ${job.jobName}) — already on "${check.jobName}" on ${job.date} [${check.source}]`);
              }
            });
          });
        });
        if (conflicts.length > 0) {
          const isAdminUser = (typeof isAdmin === 'function') && isAdmin();
          const msg = `⚠️ DOUBLE-BOOKING DETECTED\n\nThe following equipment is already assigned elsewhere on the same date:\n\n${conflicts.join('\n')}\n\n${isAdminUser ? 'As an admin you can override this. Proceed anyway?' : 'Please resolve these conflicts before verifying.'}`;
          if (!isAdminUser) { alert(msg); return; }
          if (!confirm(msg)) return;
          // Admin chose to override — re-call with flag
          window._lbVerifySend(true);
          return;
        }
      }

      plan.status = 'verified';
      plan.verifiedAt = Date.now();
      plan.verifiedBy = localStorage.getItem('dmc_u')||'';
      localStorage.setItem('dmc_lowbed_plan', JSON.stringify(plan));
      _checkLocalStorageSize();
      console.log('[Lowbed] About to save verified plan. db:', typeof db, 'firebase:', typeof firebase);
      try {
        if (typeof fbSet === 'function') {
          await fbSet('lowbed_plan', plan);
          console.log('[Lowbed] Plan saved to Firestore successfully');
        }
      } catch(e) {
        console.error('[Lowbed] Firestore write failed:', e);
      }
      // Log every equipment piece in every move to the movement log
      try { _eqLogAddMoveEntries(plan); } catch(e) { console.warn('_eqLogAddMoveEntries failed:', e); }

      // Build printable HTML report
      const now = new Date();
      const rDate = now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      let tableRows = '';
      (plan.jobs||[]).forEach(job => {
        (job.moves||[]).forEach((mv,mi) => {
          tableRows += `<tr>
            <td>${job.date||''}</td>
            <td><strong>${job.jobName||''}</strong>${job.jobNum?' <span style="color:#888;font-size:10px;">#'+job.jobNum+'</span>':''}</td>
            <td>${job.location||'—'}</td>
            <td>Move ${mi+1}</td>
            <td>${(mv.equipment||[]).map(e=>(_EQ_ICONS[e.type]||'')+'&nbsp;'+e.name).join(', ')}</td>
            <td style="font-weight:700;">${mv.assignedDriver||'<span style="color:#888;">Unassigned</span>'}</td>
            <td>${mv.notes||''}</td>
          </tr>`;
        });
      });
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lowbed Dispatch</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px;}h1{font-size:20px;margin:0 0 4px;}
.sub{color:#555;font-size:11px;margin-bottom:16px;}.sum{background:#fffbe6;border-left:3px solid #f5c518;padding:8px 12px;font-size:11px;margin-bottom:14px;}
table{width:100%;border-collapse:collapse;}th{background:#1a1a1a;color:#fff;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;}
td{padding:6px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;}tr:nth-child(even) td{background:#f7f7f7;}@media print{body{margin:12px;}}</style>
</head><body><h1>🚛 Lowbed Dispatch Plan</h1><div class="sub">Generated ${rDate} — Verified by ${plan.verifiedBy||'Admin'}</div>
<div class="sum">${plan.summary||''}</div>
<table><thead><tr><th>Date</th><th>Job</th><th>Location</th><th>Move</th><th>Equipment</th><th>Driver</th><th>Notes</th></tr></thead>
<tbody>${tableRows}</tbody></table></body></html>`;

      const blob64 = 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(html)));
      const fileName = `Lowbed Dispatch – ${now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
      const order = {
        id:'lb_'+Date.now(), fileName, foreman:'Lowbed Dispatch', jobName:'Lowbed Dispatch Plan', jobNo:'',
        dateOfWork:now.toISOString().split('T')[0], createdAt:now.toLocaleString('en-US'),
        blob64, type:'lowbed_dispatch', djApproved:true, approvedAt:Date.now(), approvedBy:plan.verifiedBy
      };
      dailyOrders.unshift(order);
      if (dailyOrders.length>300) dailyOrders=dailyOrders.slice(0,300);
      localStorage.setItem('pavescope_daily_orders', JSON.stringify(dailyOrders.map(o=>({...o,blob64:undefined}))));
      _checkLocalStorageSize();
      try { if(typeof fbSet==='function') fbSet('daily_orders', dailyOrders.map(o=>({...o,blob64:undefined}))); } catch(e){}
      if (typeof renderReports==='function' && (activeTab==='reports'||activeTab==='reportsDailyOrders')) renderReports();

      // Notify each assigned driver
      const notified = new Set();
      (plan.jobs||[]).forEach(job => {
        (job.moves||[]).forEach((mv,mi) => {
          if (!mv.assignedDriver || notified.has(mv.assignedDriver+job.jobName+mi)) return;
          notified.add(mv.assignedDriver+job.jobName+mi);
          const emp = (typeof employees!=='undefined'?employees:[]).find(e=>(e.name||((e.firstName||'')+' '+(e.lastName||'')).trim())===mv.assignedDriver);
          const target = emp?.email||emp?.name||mv.assignedDriver;
          const dlNote = mv.deadline ? ` — ⚠ DEADLINE: By ${new Date(mv.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} @ ${new Date(mv.deadline).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}` : '';
          pushNotif('info','🚛 Lowbed Move Assigned',
            `Move ${mi+1} for ${job.jobName} on ${job.date}: ${(mv.equipment||[]).map(e=>e.name).join(', ')}${dlNote}`,
            null, target);
        });
      });
      // Notify unassigned moves (broadcast — any driver can claim)
      const unassigned = (plan.jobs||[]).reduce((acc,job)=>acc+(job.moves||[]).filter(m=>!m.assignedDriver).length,0);
      if (unassigned) pushNotif('info','🚛 Open Lowbed Moves',`${unassigned} move${unassigned!==1?'s':''} available to claim in Dispatch Orders.`,null,null);

      pushNotif('success','✓ Lowbed Dispatch Verified',`Plan verified and sent to drivers. Report saved to Daily Orders.`,null);
      document.getElementById('_lbVerifyOverlay')?.remove();
      _appendMsg('ai', `✓ Verified! Drivers notified. Dispatch report saved to Daily Orders.\n${unassigned ? unassigned+' unassigned move(s) are open for any driver to claim.' : 'All moves assigned.'}`);
    };
  }

  async function _generateLowbedAssignments() {
    const btn = document.getElementById('_saiLowbedBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    _open();
    _appendMsg('user', '🚛 Generate lowbed move plan from current schedule');
    const thinkDiv = _appendMsg('ai','Analyzing schedule and equipment…',true);
    _setStatus('Generating…');

    try {
      // ── Gather fleet equipment (skip self-propelled) ─────────────────────
      const fleet = (() => { try { return JSON.parse(localStorage.getItem('dmc_fleet')||'[]').filter(e=>e.active!==false); } catch(e){ return []; } })();
      const hauledTypes = new Set(['paver','roller','milling','excavator','loader','skid_steer','compactor','generator','trailer','other']);
      const equipment = fleet.filter(e=>hauledTypes.has(e.type));

      // ── Gather schedule for today + next 3 days grouped by job ───────────
      const today = new Date();
      const jobMap = {}; // jobKey → { date, jobName, jobNum, location, type, equipment }
      for (let i=0; i<4; i++) {
        const d = new Date(today); d.setDate(today.getDate()+i);
        const key = d.toISOString().split('T')[0];
        const day = schedData[key]||{};
        const slots = [day.top, day.bottom, ...(day.extras||[]).map(x=>x.data)].filter(Boolean);
        slots.forEach(b => {
          if (!b||b.type==='blank'||!b.type) return;
          const f = b.fields||{};
          if (!f.jobName&&!f.jobNum) return;
          const jKey = (f.jobNum||f.jobName||key+'_'+Math.random()).toString();
          const bjob = (typeof backlogJobs!=='undefined'?backlogJobs:[])
            .find(j=>j.num===f.jobNum||j.name===f.jobName);
          if (!jobMap[jKey]) {
            jobMap[jKey] = { date:key, jobName:f.jobName||'', jobNum:f.jobNum||'', location:bjob?.location||f.contact||'', schedEquipment:f.equipment||'', type:b.type };
          }
        });
      }
      const jobList = Object.values(jobMap);

      // Build a set of equipment names already committed to schedule dates
      const schedCommitted = {}; // eqName → [{date, jobName}]
      Object.entries(schedData).forEach(([dateKey, day]) => {
        const slots2 = [day.top, day.bottom, ...(day.extras||[]).map(x=>x.data)].filter(Boolean);
        slots2.forEach(b => {
          if (!b||!b.fields||!b.fields.equipment) return;
          b.fields.equipment.split(',').forEach(eq => {
            const en = eq.trim();
            if (!en) return;
            if (!schedCommitted[en]) schedCommitted[en] = [];
            schedCommitted[en].push({ date: dateKey, jobName: b.fields.jobName || b.fields.jobNum || 'Unknown' });
          });
        });
      });

      const eqLines = equipment.length
        ? equipment.map(e => {
            const status = e.status || 'operational';
            const isDown = status === 'down';
            const committed = schedCommitted[e.name] || [];
            const commitNote = committed.length ? `, committed-schedule:${committed.map(c=>c.date+'@'+c.jobName).join('|')}` : '';
            return `- ${e.name} (type:${e.type}${e.category?', cat:'+e.category:''}${e.location?', at:'+e.location:''}${e.assignedJobName?', assignedJob:'+e.assignedJobName:''}${commitNote}, status:${status})${isDown?' ⚠️ DOWN — DO NOT ASSIGN':''}`;
          }).join('\n')
        : '(no equipment in fleet — use schedule equipment field only)';

      const jobLines = jobList.length
        ? jobList.map(j=>`Date:${j.date} Job:"${j.jobName}"${j.jobNum?' #'+j.jobNum:''} Location:"${j.location}" ShiftType:${j.type.toUpperCase()}${j.schedEquipment?' ScheduleEquipNote:"'+j.schedEquipment+'"':''}`).join('\n')
        : '(no jobs scheduled)';

      const prompt = `You are a lowbed dispatch coordinator for a paving company. Your job is to figure out which equipment needs to go to each job site and break those hauls into individual lowbed moves.

FLEET EQUIPMENT AVAILABLE TO HAUL:
${eqLines}

JOBS SCHEDULED (today + next 3 days):
${jobLines}

CROSS-TAB AWARENESS RULES:
• Equipment marked status:down MUST be excluded — do not assign it to any move.
• Equipment with committed-schedule entries is already at those jobs on those dates — do not send it elsewhere on the same date unless the job matches.
• Equipment with assignedJob already set should stay on that job unless the schedule says otherwise.
• Never assign the same piece of equipment to two different locations on the same date.

RULES FOR FORMING MOVES:
1. Group ALL equipment needed for a job together first, then split into moves.
2. Self-propelled equipment (dump_truck, lowbed, tack_truck, water_truck) is never loaded — skip entirely.
3. MONSTER class (per-unit weightClass="monster"): must go alone on a dedicated move — nothing else, no exceptions.
4. HEAVY PAVERS (type: paver or milling, loadClass heavy_paver): max 1 per move. They CAN share with rollers and light equipment (skid_steer, compactor, generator, trailer, other). Two pavers/millers CANNOT share a move.
5. HEAVY equipment (excavator, dozer, grader): CAN share with rollers and light equipment. These are NOT required to go alone.
6. ROLLERS (medium): can pair with any heavy paver, heavy equipment, another roller, or light equipment.
7. LIGHT equipment (skid_steer, compactor, generator, trailer, other): pairs with anything except monster.
8. Always check the per-unit weightClass field — if it is "monster", that unit moves alone regardless of its type.
9. Use the schedule equipment note and job type to infer what equipment is needed if not explicitly listed.
10. [DAY] and [NIGHT] labels are the paving crew's shift — NOT lowbed categories. Ignore them for driver timing.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "summary": "brief plain-English overview of all moves",
  "jobs": [
    {
      "date": "YYYY-MM-DD",
      "jobName": "job name",
      "jobNum": "job number or empty string",
      "location": "job location",
      "allEquipment": [{"name":"Equipment Name","type":"paver"}],
      "moves": [
        {
          "moveNum": 1,
          "equipment": [{"name":"Equipment Name","type":"paver"}],
          "notes": "any special instructions for this move"
        }
      ]
    }
  ]
}`;

      const resp = await fetch(PROXY_URL(), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'claude-sonnet-4-5',
          max_tokens:3000,
          system:'You are a paving company lowbed dispatch coordinator. Return only valid JSON, no markdown.',
          messages:[{role:'user',content:prompt}],
          stream:false
        })
      });
      if (!resp.ok) throw new Error('API '+resp.status);
      const data = await resp.json();
      let raw = (data.content?.[0]?.text||'').trim();
      raw = raw.replace(/^```[a-z]*\n?/,'').replace(/\n?```$/,'').trim();
      const result = JSON.parse(raw);

      thinkDiv?.remove();

      if (!result.jobs||!result.jobs.length) {
        _appendMsg('ai','No lowbed moves needed based on the current 4-day schedule.');
        _setStatus('Ready');
        if (btn) { btn.disabled=false; btn.textContent='🚛 Generate Lowbed Assignments'; }
        return;
      }

      // ── Save plan to localStorage for admin verification ─────────────────
      const plan = Object.assign({}, result, {
        status: 'pending_verification',
        generatedAt: Date.now(),
        generatedBy: localStorage.getItem('dmc_u')||''
      });
      localStorage.setItem('dmc_lowbed_plan', JSON.stringify(plan));
      _checkLocalStorageSize();
      console.log('[Lowbed] About to save generated plan. db:', typeof db, 'firebase:', typeof firebase);
      try {
        if (typeof fbSet === 'function') {
          await fbSet('lowbed_plan', plan);
          console.log('[Lowbed] Plan saved to Firestore successfully');
        }
      } catch(e) {
        console.error('[Lowbed] Firestore write failed:', e);
      }

      // ── Notify admin accounts (not drivers) ──────────────────────────────
      const admins = (typeof employees!=='undefined'?employees:[])
        .filter(e=>e.role==='admin'||e.role==='manager'||e.role==='owner');
      const totalMoves = result.jobs.reduce((acc,j)=>acc+(j.moves||[]).length,0);
      if (admins.length) {
        admins.forEach(a => {
          const target = a.email||a.name||(a.firstName+' '+a.lastName).trim();
          pushNotif('warning','🚛 Lowbed Plan Ready to Verify',
            `${result.jobs.length} job${result.jobs.length!==1?'s':''}, ${totalMoves} move${totalMoves!==1?'s':''} pending your verification.`,
            null, target);
        });
      } else {
        // No admin list — broadcast
        pushNotif('warning','🚛 Lowbed Plan Ready to Verify',
          `${result.jobs.length} job${result.jobs.length!==1?'s':''}, ${totalMoves} move${totalMoves!==1?'s':''} pending verification.`,null,null);
      }

      // ── Chat message with Verify button ──────────────────────────────────
      const summaryText = result.summary||`Generated ${totalMoves} move${totalMoves!==1?'s':''} across ${result.jobs.length} job${result.jobs.length!==1?'s':''}.`;
      const msgDiv = _appendMsg('ai', summaryText+'\n\nAdmins have been notified to verify. You can review the plan now:');
      // Append verify button inside the message
      const verifyBtn = document.createElement('button');
      verifyBtn.textContent = '📋 Review & Verify Moves';
      verifyBtn.style.cssText = 'display:block;margin-top:10px;padding:8px 16px;background:rgba(245,197,24,0.15);border:1px solid rgba(245,197,24,0.45);border-radius:6px;color:#f5c518;font-family:\'DM Mono\',monospace;font-size:11px;cursor:pointer;width:100%;text-align:center;';
      verifyBtn.onclick = () => _openLowbedVerification();
      msgDiv?.appendChild(verifyBtn);

      _speak(summaryText+'. Admins have been notified to verify the plan.');
      _setStatus('Ready');

    } catch(err) {
      thinkDiv?.remove();
      _appendMsg('ai','⚠️ Failed to generate plan: '+err.message);
      _setStatus('Error');
      setTimeout(()=>_setStatus('Ready'),3000);
    }

    if (btn) { btn.disabled=false; btn.textContent='🚛 Generate Lowbed Assignments'; }
  }

  window._schedAI = {
    open: _open,
    close: _close,
    send: () => { if (!_canUseAI()) return; const t=document.getElementById('_saiText')?.value; if(t?.trim()) sendMessage(t); },
    generateLowbed: () => { if (!_canUseAI()) return; _generateLowbedAssignments(); },
    verify: () => { if (!_canUseAI()) return; _openLowbedVerification(); }
  };

  // Show/hide tab when switching tabs
  const _origSwitchAI = window.switchTab;
  if (typeof _origSwitchAI==='function') {
    window.switchTab = function(t) {
      _origSwitchAI.apply(this,arguments);
      const tb=document.getElementById('_saiTab');
      if (!tb) return;
      if (t==='schedule' && _canUseAI()) tb.classList.remove('hidden');
      else { tb.classList.add('hidden'); if(_panelOpen) _close(); }
    };
  }

  // Hide AI button in header for non-authorised users
  (function _applyAIVisibility() {
    const btn = document.getElementById('sched-ai-hdr-btn');
    if (btn && !_canUseAI()) btn.style.display = 'none';
  })();
})();
});
