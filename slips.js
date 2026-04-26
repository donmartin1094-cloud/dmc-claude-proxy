// ── Paving Slips — slips.js ─────────────────────────────────────────────────
// Extracted from index.html. Loaded via <script src="/slips.js"> before main script.
// All functions are globals. pavingSlips lives on window.

const SLIPS_KEY = 'dmc_paving_slips';
window.pavingSlips = window.pavingSlips || [];

// (pavingSlips declared as window.pavingSlips above)
function _slipsMigrate(arr) {
  return (Array.isArray(arr) ? arr : []).map(function(slip) {
    return Object.assign({
      loadNumber: slip.ticketNo || '',
      handwrittenNotes: '',
      manualNote: '',
      photoUrl: null,
      photoPath: null,
      driver: '',
      loadTime: '',
      mixCode: slip.mixType || ''
    }, slip);
  });
}
function _slipsLoad() { try { pavingSlips = _slipsMigrate(JSON.parse(localStorage.getItem(SLIPS_KEY) || '[]')); } catch(e) { pavingSlips = []; } }
function _slipsSave() {
  // Strip large photoUrl from localStorage copy (store only in Firebase / by URL ref)
  var slim = pavingSlips.map(function(s){ var o = Object.assign({}, s); if ((o.photoUrl||'').startsWith('data:')) delete o.photoUrl; return o; });
  localStorage.setItem(SLIPS_KEY, JSON.stringify(slim));
  _checkLocalStorageSize();
  try { if (db) fbSet('paving_slips', slim); } catch(e) {}
  if (typeof _homeFleetRerender === 'function') _homeFleetRerender();
}
function _laNormalizeMixTypes() {
  _slipsLoad();
  var codeGroups = {};
  pavingSlips.forEach(function(s) {
    if (!s.mixCode) return;
    var key = s.mixCode.trim().toLowerCase();
    if (!codeGroups[key]) codeGroups[key] = [];
    codeGroups[key].push(s);
  });
  var updatedCount = 0;
  Object.keys(codeGroups).forEach(function(key) {
    var group = codeGroups[key];
    var typeCounts = {};
    group.forEach(function(s) {
      if (!s.mixType) return;
      var t = s.mixType.trim();
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    var mostCommon = Object.keys(typeCounts).sort(function(a,b){ return typeCounts[b]-typeCounts[a]; })[0];
    if (!mostCommon) return;
    group.forEach(function(s) {
      if (s.mixType !== mostCommon) {
        var idx = pavingSlips.findIndex(function(p){ return p.id===s.id; });
        if (idx > -1) { pavingSlips[idx].mixType = mostCommon; updatedCount++; }
      }
    });
  });
  _slipsSave();
  // Refresh job folder slip tab if open
  try {
    var jfBody = document.getElementById('jfBody');
    if (jfBody && _jfActiveTab === 'slips') {
      var jfBtn = document.querySelector('.jf-tab.active');
      var jfJobId = jfBtn ? (jfBtn.getAttribute('onclick')||'').match(/'([^']+)'/)?.[1] : null;
      var jfJob = jfJobId ? (backlogJobs||[]).find(function(j){ return j.id===jfJobId; }) : null;
      if (jfJob) jfBody.innerHTML = _jfRenderTab(jfJob, 'slips');
    }
  } catch(e) {}
  try { var tc=document.getElementById('aiaTabContent'); if(tc) tc.innerHTML=_aiaRenderLA(); } catch(e) {}
  try { pushNotif('success','Mix Types Normalized', updatedCount+' slips updated across all jobs.'); } catch(e) {}
}
function _laRenderSlipPanel() {
  _slipsLoad();
  var s = _aiaState || {};
  var isAdmin = false;
  try {
    var _u = (localStorage.getItem('dmc_u') || '').toLowerCase().trim();
    var _uBase = _u.indexOf('@') > -1 ? _u.split('@')[0] : _u;
    isAdmin = (_uBase === 'dj' || _uBase === 'donmartin');
    console.log('[SlipAdmin] u:', _u, 'base:', _uBase, 'isAdmin:', isAdmin);
  } catch(e) {}

  // Match slips to this job (by backlogJobId, jobNum, or jobName)
  var jobSlips = pavingSlips.filter(function(sl) {
    if (s.backlogJobId && sl.jobId === s.backlogJobId) return true;
    if (s.dmcJobNo     && sl.jobNum === s.dmcJobNo)    return true;
    if (s.projectName  && sl.jobName && sl.jobName.toLowerCase() === s.projectName.toLowerCase()) return true;
    return false;
  });

  console.log('[SlipRow] isAdmin:', isAdmin, 'slip count:', jobSlips.length);
  // Group by date
  var byDate = {};
  jobSlips.forEach(function(sl) {
    var d = sl.date || 'Unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(sl);
  });
  var sortedDates = Object.keys(byDate).sort().reverse();

  // Helper: format date
  var fmtD = function(d) {
    try { return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); } catch(e) { return d; }
  };
  var fmtT = function(n) { return (parseFloat(n)||0).toLocaleString('en-US',{maximumFractionDigits:2}); };

  // Mix type options for the upload modal
  var mixOpts = (s.la && s.la.rows||[]).map(function(r){ return r.mixType; });
  // Add common defaults if no rows defined
  if (!mixOpts.length) mixOpts = ['SBC 37.5','SIC 19.0','SIC 12.5','SIC 9.5','FC 9.5','MC 19.0'];

  // Build day folders
  var foldersHTML = '';
  if (!sortedDates.length) {
    foldersHTML = '<div style="padding:24px 16px;text-align:center;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);line-height:1.7;">'+
      'No slips yet for this job.<br>Upload slips manually or the AI scanner<br>will auto-sort them as photos arrive.'+
    '</div>';
  } else {
    foldersHTML = sortedDates.map(function(dateKey) {
      var slips = byDate[dateKey].slice().sort(function(a,b){ var an=parseInt(a.loadNumber||a.ticketNo||'0'); var bn=parseInt(b.loadNumber||b.ticketNo||'0'); return an-bn; });
      var totalTons = slips.reduce(function(s,sl){ return s+(parseFloat(sl.tons)||0); }, 0);
      var byMix = {};
      slips.forEach(function(sl){ var m=sl.mixType||'Unknown'; byMix[m]=(byMix[m]||0)+(parseFloat(sl.tons)||0); });
      var mixSummary = Object.keys(byMix).map(function(m){ return m+': '+fmtT(byMix[m])+'T'; }).join(' &nbsp;·&nbsp; ');
      var slipRows = slips.map(function(sl) {
        var rapBadge = (parseFloat(sl.rapPct)||0) > 0
          ? '<span style="background:rgba(90,180,245,0.15);color:#5ab4f5;font-family:\'DM Mono\',monospace;font-size:8px;padding:1px 5px;border-radius:3px;white-space:nowrap;">RAP '+sl.rapPct+'%</span>'
          : '';
        var scanBadge = sl.autoScanned
          ? '<span style="background:rgba(126,203,143,0.12);color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:7px;padding:1px 4px;border-radius:3px;white-space:nowrap;">&#129302; AI</span>'
          : '';
        var thumb = sl.photoUrl
          ? '<img src="'+escHtml(sl.photoUrl)+'" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--asphalt-light);cursor:pointer;flex-shrink:0;" onclick="_laViewSlipPhoto(\''+escHtml(sl.id)+'\')" title="View slip photo">'
          : '<div style="width:36px;height:36px;border-radius:4px;border:1px dashed var(--asphalt-light);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--concrete-dim);flex-shrink:0;">&#128196;</div>';
        var hwLine = sl.handwrittenNotes
          ? '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:#c9a800;font-style:italic;margin-top:2px;">&#9999; '+escHtml(sl.handwrittenNotes)+'</div>'
          : '';
        var noteInput = '<input type="text" value="'+escHtml(sl.manualNote||'')+'" placeholder="Add manual note\u2026" '+
          'onblur="_slipSaveManualNote(\''+sl.id+'\',this.value)" onclick="event.stopPropagation()" '+
          'style="background:none;border:none;border-bottom:1px solid rgba(201,168,0,0.2);outline:none;font-family:\'DM Mono\',monospace;font-size:9px;color:#c9a800;width:100%;margin-top:2px;padding:1px 0;">';
        return '<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.04);">'+
          thumb+
          '<div style="flex:1;min-width:0;">'+
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'+
              '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--white);font-weight:700;">'+escHtml(sl.mixType||'—')+'</span>'+
              '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);">'+fmtT(sl.tons)+'T</span>'+
              rapBadge+scanBadge+
            '</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);margin-top:1px;">'+
              (isAdmin
                ? (sl.date?'<span onclick="_slipInlineEdit(\''+sl.id+'\',\'date\',\''+escHtml(sl.date)+'\',this)" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;" title="Click to edit date">'+escHtml(sl.date)+'</span>&nbsp;·&nbsp; ':'<span onclick="_slipInlineEdit(\''+sl.id+'\',\'date\',\'\',this)" style="cursor:pointer;color:rgba(217,79,61,0.7);" title="Click to set date">no date</span>&nbsp;·&nbsp; ')+'<span onclick="_slipInlineEdit(\''+sl.id+'\',\'ticketNo\',\''+escHtml(sl.ticketNo||'')+'\',this)" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;" title="Click to edit ticket #">'+(sl.ticketNo?'Ticket #'+escHtml(sl.ticketNo):'<span style="color:rgba(217,79,61,0.7);">no ticket#</span>')+'</span>'+(sl.truckNum?' &nbsp;·&nbsp; Truck '+escHtml(sl.truckNum):'')+(sl.plant?' &nbsp;·&nbsp; '+escHtml(sl.plant):'')
                : (sl.ticketNo?'Ticket #'+escHtml(sl.ticketNo):'')+(sl.truckNum?' &nbsp;·&nbsp; Truck '+escHtml(sl.truckNum):'')+(sl.plant?' &nbsp;·&nbsp; '+escHtml(sl.plant):''))+
            '</div>'+
            hwLine+
            noteInput+
          '</div>'+
          (isAdmin?'<button onclick="_laRescanSlip(\''+sl.id+'\')" '+(sl.photoUrl?'title="Re-scan this slip"':'title="No photo available to re-scan" style="opacity:0.3;cursor:default;" disabled')+' style="background:none;border:none;color:#5ab4f5;font-size:13px;cursor:pointer;padding:2px 3px;flex-shrink:0;">\ud83d\udd04</button>':'')+
          (isAdmin?'<button onclick="_laDeleteSlip(\''+sl.id+'\')" style="background:none;border:none;color:#e87373;font-size:14px;cursor:pointer;padding:2px 4px;flex-shrink:0;" title="Delete slip">&#128465;</button>':'')+
        '</div>';
      }).join('');
      return '<div style="border:1px solid var(--asphalt-light);border-radius:var(--radius);margin-bottom:8px;overflow:hidden;">'+
        '<div style="background:var(--asphalt);padding:8px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'+
          '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--white);font-weight:700;flex:1;">&#128197; '+escHtml(fmtD(dateKey))+'</span>'+
          '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--stripe);font-weight:700;">'+fmtT(totalTons)+'T</span>'+
          '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);">('+slips.length+' slip'+(slips.length!==1?'s':'')+')</span>'+
          '<button onclick="event.stopPropagation();_laUploadSlipModal(\''+escHtml(dateKey)+'\')" style="background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.3);border-radius:3px;color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:8px;padding:2px 8px;cursor:pointer;white-space:nowrap;">+ Add Slip</button>'+
        '</div>'+
        '<div>'+
          (mixSummary ? '<div style="padding:4px 12px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);background:rgba(0,0,0,0.15);border-bottom:1px solid rgba(255,255,255,0.04);">'+mixSummary+'</div>' : '')+
          slipRows+
        '</div>'+
      '</div>';
    }).join('');
  }

  // Totals bar across all slips
  var allTons = jobSlips.reduce(function(t,sl){ return t+(parseFloat(sl.tons)||0); }, 0);
  var allByMix = {};
  jobSlips.forEach(function(sl){ var m=sl.mixType||'Unknown'; allByMix[m]=(allByMix[m]||0)+(parseFloat(sl.tons)||0); });
  var totalsBar = jobSlips.length ? '<div style="background:rgba(245,197,24,0.07);border:1px solid rgba(245,197,24,0.2);border-radius:var(--radius);padding:7px 12px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'+
    '<span style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:var(--stripe);">All Slips:</span>'+
    Object.keys(allByMix).map(function(m){ return '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--white);">'+escHtml(m)+' <strong style="color:var(--stripe);">'+fmtT(allByMix[m])+'T</strong></span>'; }).join('')+
    '<button onclick="_laSyncSlipTons()" style="margin-left:auto;background:rgba(126,203,143,0.15);border:1px solid rgba(126,203,143,0.3);border-radius:3px;color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:8px;padding:3px 10px;cursor:pointer;white-space:nowrap;">&#8635; Sync to Calc</button>'+
  '</div>' : '';

  return '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);overflow:hidden;">'+
    '<div style="background:var(--asphalt-mid);padding:10px 14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--asphalt-light);">'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);">&#128196; Paving Slips</span>'+
      '<span style="background:rgba(245,197,24,0.15);color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:8px;padding:1px 7px;border-radius:10px;font-weight:700;">'+jobSlips.length+'</span>'+
      '<div style="flex:1;"></div>'+
      '<button onclick="_laResortSlips()" style="background:transparent;border:1px solid #444;border-radius:var(--radius);color:#aaa;font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;" onmouseover="this.style.borderColor=\'#7ecb8f\';this.style.color=\'#7ecb8f\'" onmouseout="this.style.borderColor=\'#444\';this.style.color=\'#aaa\'">&#8597; Sort by Load #</button>'+
      (isAdmin && jobSlips.some(function(sl){return !!sl.photoUrl;})?'<button onclick="_laRescanAllSlips()" style="background:rgba(90,180,245,0.08);border:1px solid rgba(90,180,245,0.3);border-radius:var(--radius);color:#5ab4f5;font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;">&#129302; Re-scan All</button>':'')+
      (isAdmin?'<button onclick="_laNormalizeMixTypes()" style="background:rgba(155,148,136,0.08);border:1px solid rgba(155,148,136,0.3);border-radius:var(--radius);color:#9b9488;font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;">&#128295; Normalize Mix</button>':'')+
      (isAdmin && s.backlogJobId?'<button onclick="_laDeleteAllSlipsForCurrentJob()" style="background:transparent;border:1px solid rgba(217,79,61,0.3);border-radius:var(--radius);color:rgba(217,79,61,0.7);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;">&#128465; Clear All</button>':'')+
      '<button onclick="_laUploadSlipModal(null)" style="background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.3);border-radius:var(--radius);color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:9px;padding:5px 12px;cursor:pointer;font-weight:700;">+ Add Slip</button>'+
      '<button onclick="_laScanSlipFromPhoto()" style="background:rgba(90,180,245,0.1);border:1px solid rgba(90,180,245,0.3);border-radius:var(--radius);color:#5ab4f5;font-family:\'DM Mono\',monospace;font-size:9px;padding:5px 12px;cursor:pointer;font-weight:700;">&#129302; Scan Slip</button>'+
    '</div>'+
    '<div style="padding:12px 12px 4px;">'+
      totalsBar+
      foldersHTML+
    '</div>'+
    '<div style="padding:0 12px 12px;">'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);text-align:center;margin-top:4px;">'+
        'Slips are also tracked in the job folder under Backlog &nbsp;·&nbsp; '+
        'AI scanner will auto-sort incoming photos'+
      '</div>'+
    '</div>'+
  '</div>';
}
function _laSyncSlipTons() {
  _slipsLoad();
  var s = _aiaState;
  var jobSlips = pavingSlips.filter(function(sl) {
    if (s.backlogJobId && sl.jobId === s.backlogJobId) return true;
    if (s.dmcJobNo     && sl.jobNum === s.dmcJobNo)    return true;
    if (s.projectName  && sl.jobName && sl.jobName.toLowerCase() === s.projectName.toLowerCase()) return true;
    return false;
  });
  // Aggregate by mix type
  var tonsByMix = {};
  jobSlips.forEach(function(sl){ var m=(sl.mixType||'').toLowerCase().trim(); tonsByMix[m]=(tonsByMix[m]||0)+(parseFloat(sl.tons)||0); });
  // Push into la.rows where mixType matches
  s.la.rows.forEach(function(row, i) {
    var key = (row.mixType||'').toLowerCase().trim();
    if (tonsByMix[key] !== undefined) {
      row.tons = tonsByMix[key];
      var inp = document.querySelector('[data-la-row="'+i+'"]');
      if (inp) inp.value = row.tons;
    }
  });
  // Also update fuel tons total
  var totalTons = jobSlips.reduce(function(t,sl){ return t+(parseFloat(sl.tons)||0); }, 0);
  if (totalTons > 0) {
    s.la.fuelTon = totalTons;
    var fuelInp = document.getElementById('laFuelTon');
    if (fuelInp) fuelInp.value = totalTons;
  }
  _aiaUpdateLACalc();
  // Show feedback
  var btn = event && event.target;
  if (btn) { var orig=btn.textContent; btn.textContent='✓ Synced!'; setTimeout(function(){ btn.textContent=orig; }, 1500); }
}
function _laDeleteSlip(slipId) {
  var u = (localStorage.getItem('dmc_u')||'').toLowerCase().trim();
  if (!['dj','dj@donmartincorp.com','donmartin','donmartin@donmartincorp.com'].includes(u)) return;
  _slipsLoad();
  var slip = pavingSlips.find(function(s){ return s.id===slipId; });
  if (!slip) return;
  if (!confirm('Delete ticket'+(slip.ticketNo?' #'+slip.ticketNo:'')+' \u2014 '+(slip.tons||'?')+'t '+(slip.mixType||'')+'?\nThis cannot be undone.')) return;
  if (slip.photoPath) { try { deleteFileFromStorage(slip.photoPath); } catch(e){} }
  pavingSlips = pavingSlips.filter(function(s){ return s.id !== slipId; });
  _slipsSave();
  var tc = document.getElementById('aiaTabContent');
  if (tc) tc.innerHTML = _aiaRenderLA();
  // Refresh job folder slip tab if open
  try {
    var jfBody = document.getElementById('jfBody');
    if (jfBody && _jfActiveTab === 'slips') {
      var jfBtn = document.querySelector('.jf-tab.active');
      var jfJobId = jfBtn ? (jfBtn.getAttribute('onclick')||'').match(/'([^']+)'/)?.[1] : null;
      var jfJob = jfJobId ? (backlogJobs||[]).find(function(j){ return j.id===jfJobId; }) : null;
      if (jfJob) jfBody.innerHTML = _jfRenderTab(jfJob, 'slips');
    }
  } catch(e) {}
  var t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.96);border:1px solid rgba(217,79,61,0.3);border-radius:var(--radius);padding:10px 18px;font-family:\'DM Mono\',monospace;font-size:10px;color:#e87373;z-index:10001;pointer-events:none;';
  t.textContent='\u2713 Slip #'+(slip.ticketNo||slip.id)+' deleted';
  document.body.appendChild(t); setTimeout(function(){t.remove();},3000);
}
function _laViewSlipPhoto(slipId) {
  _slipsLoad();
  var allPhotoSlips = pavingSlips.filter(function(s){ return !!s.photoUrl; });
  var idx = allPhotoSlips.findIndex(function(s){ return s.id===slipId; });
  if (idx < 0 || !allPhotoSlips.length) return;
  document.getElementById('_slipLightbox')?.remove();
  var ov = document.createElement('div');
  ov.id = '_slipLightbox';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;display:flex;flex-direction:column;';
  document.body.appendChild(ov);
  function _renderLB(i) {
    var sl = allPhotoSlips[i];
    var fmtD=function(d){try{return new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return d||'';}};
    ov.innerHTML=
      '<div style="background:#1a1a1a;border-bottom:1px solid #333;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;">'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:11px;color:#fff;font-weight:700;">'+(sl.ticketNo?'Ticket #'+escHtml(sl.ticketNo)+' \u2014 ':'')+escHtml(sl.mixType||'\u2014')+(sl.tons?' \u2014 '+sl.tons+'t':'')+'</span>'+
        '<div style="flex:1;"></div>'+
        '<button onclick="document.getElementById(\'_slipLightbox\').remove()" style="background:none;border:1px solid #555;border-radius:4px;color:#aaa;font-family:\'DM Mono\',monospace;font-size:12px;padding:3px 10px;cursor:pointer;">\u2715</button>'+
      '</div>'+
      '<div style="flex:1;display:flex;overflow:hidden;min-height:0;">'+
        '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:16px;min-width:0;">'+
          '<img src="'+escHtml(sl.photoUrl)+'" style="max-width:100%;max-height:calc(85vh - 100px);object-fit:contain;border-radius:6px;">'+
        '</div>'+
        '<div style="width:220px;flex-shrink:0;background:#111111;border-left:1px solid #333;padding:14px;overflow-y:auto;font-family:\'DM Mono\',monospace;font-size:10px;">'+
          '<div style="font-size:8px;letter-spacing:1px;text-transform:uppercase;color:#444;margin-bottom:12px;">AI EXTRACTED</div>'+
          '<div style="margin-bottom:5px;"><span style="color:#555;">Date: </span><span style="color:#ccc;">'+(sl.date?fmtD(sl.date):'—')+'</span></div>'+
          '<div style="margin-bottom:5px;"><span style="color:#555;">Load #: </span><span style="color:#ccc;">'+escHtml(sl.ticketNo||'—')+'</span></div>'+
          '<div style="margin-bottom:5px;"><span style="color:#555;">Mix: </span><span style="color:#fff;font-weight:700;">'+escHtml(sl.mixType||'—')+'</span></div>'+
          '<div style="margin-bottom:5px;"><span style="color:#555;">Tons: </span><span style="color:#f5c518;font-weight:700;">'+(sl.tons||'—')+'</span></div>'+
          '<div style="margin-bottom:5px;"><span style="color:#555;">Truck: </span><span style="color:#ccc;">'+escHtml(sl.truckNum||'—')+'</span></div>'+
          '<div style="margin-bottom:5px;"><span style="color:#555;">Plant: </span><span style="color:#ccc;">'+escHtml(sl.plant||'—')+'</span></div>'+
          (parseFloat(sl.rapPct)>0?'<div style="margin-bottom:5px;"><span style="color:#555;">RAP: </span><span style="color:#5ab4f5;">'+sl.rapPct+'%</span></div>':'')+
          (sl.handwrittenNotes?'<div style="margin-top:10px;padding-top:10px;border-top:1px solid #2a2a2a;margin-bottom:5px;"><span style="color:#555;">\u270f Notes: </span><span style="color:#c9a800;font-style:italic;">'+escHtml(sl.handwrittenNotes)+'</span></div>':'')+
          (sl.manualNote?'<div style="margin-bottom:5px;"><span style="color:#555;">\ud83d\udcdd Manual: </span><span style="color:#c9a800;font-style:italic;">'+escHtml(sl.manualNote)+'</span></div>':'')+
        '</div>'+
      '</div>'+
      '<div style="background:#1a1a1a;border-top:1px solid #333;padding:8px 16px;display:flex;align-items:center;justify-content:center;gap:20px;flex-shrink:0;">'+
        (i>0?'<button onclick="_laLightboxNav('+(i-1)+')" style="background:none;border:1px solid #444;border-radius:4px;color:#aaa;font-family:\'DM Mono\',monospace;font-size:14px;padding:4px 14px;cursor:pointer;">\u2190</button>':'<span style="width:52px;display:inline-block;"></span>')+
        '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:#555;">Slip '+(i+1)+' of '+allPhotoSlips.length+'</span>'+
        (i<allPhotoSlips.length-1?'<button onclick="_laLightboxNav('+(i+1)+')" style="background:none;border:1px solid #444;border-radius:4px;color:#aaa;font-family:\'DM Mono\',monospace;font-size:14px;padding:4px 14px;cursor:pointer;">\u2192</button>':'<span style="width:52px;display:inline-block;"></span>')+
      '</div>';
    window._laLightboxNav = function(ni){ _renderLB(ni); };
  }
  _renderLB(idx);
}
function _laDeleteAllSlipsForCurrentJob() {
  var s = _aiaState || {};
  _laDeleteAllSlips(s.backlogJobId||'', s.projectName||'');
}
function _laDeleteAllSlips(jobId, jobName) {
  var u = (localStorage.getItem('dmc_u')||'').toLowerCase().trim();
  if (!['dj','dj@donmartincorp.com','donmartin','donmartin@donmartincorp.com'].includes(u)) return;
  _slipsLoad();
  var toDelete = pavingSlips.filter(function(s){ return s.jobId===jobId; });
  if (!toDelete.length) { alert('No slips for this job.'); return; }
  if (!confirm('Delete all '+toDelete.length+' slips for '+jobName+'?\nThis cannot be undone.')) return;
  toDelete.forEach(function(s){ if(s.photoPath){try{deleteFileFromStorage(s.photoPath);}catch(e){}} });
  pavingSlips = pavingSlips.filter(function(s){ return s.jobId!==jobId; });
  _slipsSave();
  var tc = document.getElementById('aiaTabContent');
  if (tc) tc.innerHTML = _aiaRenderLA();
}
function _laDeleteAllSlipsForDate(dateKey, jobId) {
  var u = (localStorage.getItem('dmc_u')||'').toLowerCase().trim();
  var uBase = u.indexOf('@')>-1 ? u.split('@')[0] : u;
  if (uBase !== 'dj' && uBase !== 'donmartin') return;
  _slipsLoad();
  var toDelete = pavingSlips.filter(function(s){ return s.date===dateKey && (s.jobId===jobId||s.jobNum===jobId); });
  if (!toDelete.length) { alert('No slips for '+dateKey+'.'); return; }
  if (!confirm('Delete all '+toDelete.length+' slip'+(toDelete.length!==1?'s':'')+' for '+dateKey+'? This cannot be undone.')) return;
  toDelete.forEach(function(s){ if(s.photoPath){try{deleteFileFromStorage(s.photoPath);}catch(e){}} });
  pavingSlips = pavingSlips.filter(function(s){ return !(s.date===dateKey && (s.jobId===jobId||s.jobNum===jobId)); });
  _slipsSave();
  var job = (backlogJobs||[]).find(function(j){ return j.id===jobId; });
  if (job) openJobFolder(jobId);
}
function _laResortSlips() {
  var tc = document.getElementById('aiaTabContent');
  if (tc) tc.innerHTML = _aiaRenderLA();
}
var _SLIP_SCAN_PROMPT = 'This is a paving plant ticket / delivery slip. Extract the following fields if visible. Respond ONLY with a JSON object, no markdown:\n{"mixType":"","tons":0,"rapPct":0,"ticketNo":"","loadNumber":null,"truckNum":"","plant":"","date":"","handwrittenNotes":null}\nmixType: the asphalt mix designation (e.g. SBC 37.5, SIC 19.0). tons: net tons. rapPct: RAP percentage (0 if not shown). ticketNo: ticket/receipt number. loadNumber: LOAD NUMBER — this is printed in the BOTTOM RIGHT corner of the slip, separate from the ticket number. Look specifically in the bottom right area for a number labeled "Load", "Load No", "Load #", "Load Number", or a standalone sequential number in that corner (e.g. 1, 2, 3 or 001, 002, 003). Do NOT confuse with the ticket number which is usually larger and at the top. Return null if not found in the bottom right corner. truckNum: truck number or ID. plant: plant name or location. date: date in YYYY-MM-DD format. handwrittenNotes: any handwritten text visible on the slip — notes, corrections, initials, quantities written by hand. Transcribe exactly as written, or null if none visible.';
function _laRescanSlipById(slipId) {
  return new Promise(function(resolve, reject) {
    var slip = pavingSlips.find(function(s){ return s.id===slipId; });
    if (!slip || !slip.photoUrl) { reject(new Error('No photo')); return; }
    var imgSrc = slip.photoUrl.startsWith('data:')
      ? { type:'base64', media_type: slip.photoUrl.split(';')[0].split(':')[1], data: slip.photoUrl.split(',')[1] }
      : { type:'url', url: slip.photoUrl };
    var body = {
      model: 'claude-haiku-4-5-20251001', max_tokens: 512,
      messages: [{ role:'user', content: [
        { type:'image', source: imgSrc },
        { type:'text',  text: _SLIP_SCAN_PROMPT }
      ]}]
    };
    fetch('https://dmc-claude-proxy-production.up.railway.app/claude', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    }).then(function(r){ return r.json(); }).then(function(data) {
      var text = (data.content && data.content[0] && data.content[0].text) || '';
      try {
        var p = JSON.parse(text.replace(/```json|```/g,'').trim());
        if (p.date)               slip.date             = p.date;
        if (p.mixType)            { slip.mixType = p.mixType; slip.mixCode = p.mixType; }
        if (p.tons > 0)           slip.tons             = p.tons;
        if (p.ticketNo)           { slip.ticketNo = p.ticketNo; slip.loadNumber = p.ticketNo; }
        if (p.truckNum)           slip.truckNum         = p.truckNum;
        if (p.plant)              slip.plant            = p.plant;
        if (p.rapPct > 0)         slip.rapPct           = p.rapPct;
        if (p.handwrittenNotes)   slip.handwrittenNotes = p.handwrittenNotes;
        slip.autoScanned = true;
        resolve(slip);
      } catch(e) { reject(e); }
    }).catch(reject);
  });
}
function _laRescanSlip(slipId) {
  var u = (localStorage.getItem('dmc_u')||'').toLowerCase().trim();
  if (!['dj','dj@donmartincorp.com','donmartin','donmartin@donmartincorp.com'].includes(u)) return;
  _slipsLoad();
  var slip = pavingSlips.find(function(s){ return s.id===slipId; });
  if (!slip || !slip.photoUrl) { alert('No photo available to re-scan.'); return; }
  _laRescanSlipById(slipId).then(function() {
    _slipsSave();
    var tc = document.getElementById('aiaTabContent');
    if (tc) tc.innerHTML = _aiaRenderLA();
  }).catch(function(e) { alert('Re-scan failed: '+(e&&e.message||'unknown error')); });
}
function _laRescanAllSlips() {
  var u = (localStorage.getItem('dmc_u')||'').toLowerCase().trim();
  if (!['dj','dj@donmartincorp.com','donmartin','donmartin@donmartincorp.com'].includes(u)) return;
  var s = _aiaState || {};
  _slipsLoad();
  var photoSlips = pavingSlips.filter(function(sl) {
    if (!sl.photoUrl) return false;
    if (s.backlogJobId && sl.jobId === s.backlogJobId) return true;
    if (s.dmcJobNo     && sl.jobNum === s.dmcJobNo)    return true;
    if (s.projectName  && sl.jobName && sl.jobName.toLowerCase() === s.projectName.toLowerCase()) return true;
    return false;
  });
  if (!photoSlips.length) { alert('No slips with photos found for this job.'); return; }
  if (!confirm('Re-scan all '+photoSlips.length+' slips that have photos?\nThis will update extracted data but keep manual notes. Continue?')) return;
  var prog = document.createElement('div');
  prog.id = '_slipRescanProg';
  prog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;';
  prog.innerHTML = '<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px 32px;min-width:280px;text-align:center;">'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--stripe);margin-bottom:12px;">&#129302; Re-scanning slips\u2026</div>'+
    '<div id="_slipRescanStatus" style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Preparing\u2026</div>'+
  '</div>';
  document.body.appendChild(prog);
  var i=0, done=0, failed=0;
  function _next() {
    if (i >= photoSlips.length) {
      _slipsSave();
      document.getElementById('_slipRescanProg')?.remove();
      var tc = document.getElementById('aiaTabContent');
      if (tc) tc.innerHTML = _aiaRenderLA();
      var t=document.createElement('div');
      t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.96);border:1px solid rgba(126,203,143,0.35);border-radius:var(--radius);padding:10px 18px;font-family:\'DM Mono\',monospace;font-size:10px;color:#7ecb8f;z-index:10001;pointer-events:none;';
      t.textContent='\u2713 Re-scanned '+done+' slip'+(done!==1?'s':'')+(failed?' ('+failed+' failed)':'');
      document.body.appendChild(t); setTimeout(function(){t.remove();},3500);
      return;
    }
    var sl = photoSlips[i++];
    var st = document.getElementById('_slipRescanStatus');
    if (st) st.textContent = 'Re-scanning slip '+i+' of '+photoSlips.length+'\u2026';
    _laRescanSlipById(sl.id).then(function(){ done++; setTimeout(_next, 600); }).catch(function(){ failed++; setTimeout(_next, 600); });
  }
  _next();
}
function _laUploadSlipModal(prefillDate) {
  document.getElementById('laSlipModal')?.remove();
  window._laSlipHandwrittenNotes = null;
  var s = _aiaState;
  var today = new Date().toISOString().slice(0,10);
  var mixOpts = (s && s.la && s.la.rows || []).map(function(r){ return r.mixType; });
  if (!mixOpts.length) mixOpts = ['SBC 37.5','SIC 19.0','SIC 12.5','SIC 9.5','FC 9.5','MC 19.0'];
  var mixSelHTML = mixOpts.map(function(m){ return '<option value="'+escHtml(m)+'">'+escHtml(m)+'</option>'; }).join('');

  // Job context from standalone scan button
  var _ctx = window._slipScanContext || {};
  var _ctxJobBanner = (_ctx.jobId || _ctx.jobName)
    ? '<div style="padding:7px 18px;background:rgba(245,197,24,0.06);border-bottom:1px solid rgba(245,197,24,0.18);font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+
        '&#128204; Scanning for: <strong style="color:var(--stripe);">'+escHtml(_ctx.jobName||_ctx.jobId||'')+'</strong>'+((_ctx.jobNum)?'&nbsp;&nbsp;#'+escHtml(_ctx.jobNum):'')+
      '</div>'
    : '';

  var overlay = document.createElement('div');
  overlay.id = 'laSlipModal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;';

  overlay.innerHTML='<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);width:520px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6);">'+
    '<div style="background:var(--asphalt);border-bottom:1px solid var(--asphalt-light);padding:12px 18px;display:flex;align-items:center;justify-content:space-between;border-radius:var(--radius-lg) var(--radius-lg) 0 0;">'+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:2px;color:var(--stripe);">&#128196; Add Paving Slip</div>'+
      '<button onclick="document.getElementById(\'laSlipModal\').remove()" style="background:none;border:none;color:var(--concrete-dim);font-size:18px;cursor:pointer;">&#10005;</button>'+
    '</div>'+
    _ctxJobBanner+
    '<div style="padding:16px 18px;">'+
      // Photo area
      '<div id="laSlipPhotoArea" onclick="document.getElementById(\'laSlipFileIn\').click()" style="background:var(--asphalt);border:2px dashed var(--asphalt-light);border-radius:var(--radius);min-height:100px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:14px;position:relative;overflow:hidden;" title="Click to pick photo or scan">'+
        '<div id="laSlipPhotoPlaceholder" style="text-align:center;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);padding:20px;">'+
          '<div style="font-size:28px;margin-bottom:6px;">&#128247;</div>Tap to add slip photo (optional)<br><span style="font-size:8px;opacity:.7;">AI will extract ticket details automatically</span>'+
        '</div>'+
      '</div>'+
      '<input id="laSlipFileIn" type="file" accept="image/*" capture="environment" style="display:none;" onchange="_laSlipPhotoChosen(this)">'+
      // Fields
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'+
        '<div><label class="form-label">Date</label><input id="lsDate" class="form-input" type="date" value="'+(prefillDate||today)+'"/></div>'+
        '<div><label class="form-label">Mix Type</label><select id="lsMix" class="form-input"><option value="">— select —</option>'+mixSelHTML+'<option value="__custom">Custom…</option></select></div>'+
        '<div><label class="form-label">Tons</label><input id="lsTons" class="form-input" type="number" step="0.01" min="0" placeholder="0.00"/></div>'+
        '<div><label class="form-label">RAP %</label><input id="lsRap" class="form-input" type="number" step="0.1" min="0" max="100" placeholder="0"/></div>'+
        '<div><label class="form-label">Ticket #</label><input id="lsTicket" class="form-input" type="text" placeholder="e.g. 48291"/></div>'+
        '<div><label class="form-label">LOAD # <span style="color:#666;font-size:9px;">(bottom right corner)</span></label><input id="lsLoadNum" class="form-input" type="text" placeholder="e.g. 1, 2, 003"/></div>'+
        '<div><label class="form-label">Truck #</label><input id="lsTruck" class="form-input" type="text" placeholder="e.g. 08"/></div>'+
        '<div style="grid-column:span 2;"><label class="form-label">Plant / Supplier</label><input id="lsPlant" class="form-input" type="text" placeholder="e.g. Aggregate Industries — Chelmsford"/></div>'+
        '<div style="grid-column:span 2;"><label class="form-label">Notes</label><input id="lsNotes" class="form-input" type="text" placeholder="Optional notes"/></div>'+
      '</div>'+
      '<div id="laSlipScanStatus" style="display:none;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);margin-bottom:8px;padding:6px 10px;background:rgba(90,180,245,0.08);border:1px solid rgba(90,180,245,0.2);border-radius:var(--radius);"></div>'+
      '<div id="laSlipHWNotes" style="display:none;font-family:\'DM Mono\',monospace;font-size:9px;color:#c9a800;font-style:italic;margin-bottom:10px;padding:5px 10px;background:rgba(201,168,0,0.06);border:1px solid rgba(201,168,0,0.2);border-radius:var(--radius);"></div>'+
      '<div style="display:flex;gap:10px;">'+
        '<button onclick="_laSlipSave()" style="flex:1;padding:10px;background:rgba(245,197,24,0.15);border:1px solid rgba(245,197,24,0.4);border-radius:var(--radius);color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">&#10003; Save Slip</button>'+
        '<button onclick="document.getElementById(\'laSlipModal\').remove()" style="padding:10px 16px;background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:11px;cursor:pointer;">Cancel</button>'+
      '</div>'+
    '</div>'+
  '</div>';

  document.body.appendChild(overlay);
}
window._laSlipPhotoB64 = null;
function _laSlipPhotoChosen(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    window._laSlipPhotoB64 = e.target.result; // full data URL
    var area = document.getElementById('laSlipPhotoArea');
    var ph   = document.getElementById('laSlipPhotoPlaceholder');
    if (area) {
      // Show thumbnail
      var existing = area.querySelector('img');
      if (existing) existing.remove();
      var img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText='width:100%;max-height:200px;object-fit:contain;display:block;';
      area.appendChild(img);
      if (ph) ph.style.display='none';
    }
    // Auto-trigger AI scan
    _laSlipAIScan(e.target.result.split(',')[1], file.type || 'image/jpeg');
  };
  reader.readAsDataURL(file);
}
function _laSlipAIScan(b64data, mimeType) {
  var statusEl = document.getElementById('laSlipScanStatus');
  if (!statusEl) return;
  statusEl.style.display = 'block';
  statusEl.innerHTML = '&#129302; AI scanning slip… extracting ticket details…';

  var body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type:'image', source:{ type:'base64', media_type: mimeType, data: b64data } },
        { type:'text',  text: _SLIP_SCAN_PROMPT }
      ]
    }]
  };

  fetch('https://dmc-claude-proxy-production.up.railway.app/claude', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r){ return r.json(); }).then(function(data) {
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    try {
      var parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
      // Populate fields
      if (parsed.date)     { var d=document.getElementById('lsDate');   if(d && parsed.date)   d.value=parsed.date; }
      if (parsed.mixType)  { var m=document.getElementById('lsMix');    if(m) { var found=[].find.call(m.options,function(o){return o.value.toLowerCase()===parsed.mixType.toLowerCase();}); if(found)m.value=found.value; else { var o=document.createElement('option'); o.value=parsed.mixType; o.textContent=parsed.mixType; m.add(o); m.value=parsed.mixType; } } }
      if (parsed.tons>0)   { var t=document.getElementById('lsTons');   if(t) t.value=parsed.tons; }
      if (parsed.rapPct>0) { var rp=document.getElementById('lsRap');   if(rp) rp.value=parsed.rapPct; }
      if (parsed.ticketNo) { var tk=document.getElementById('lsTicket');if(tk) tk.value=parsed.ticketNo; }
      if (parsed.loadNumber) { var ln=document.getElementById('lsLoadNum');if(ln) ln.value=parsed.loadNumber; }
      if (parsed.truckNum) { var tr=document.getElementById('lsTruck'); if(tr) tr.value=parsed.truckNum; }
      if (parsed.plant)    { var pl=document.getElementById('lsPlant'); if(pl) pl.value=parsed.plant; }
      statusEl.innerHTML='&#10003; AI extracted ticket data — verify and adjust as needed.';
      statusEl.style.color='#7ecb8f';
      if (parsed.handwrittenNotes) {
        window._laSlipHandwrittenNotes = parsed.handwrittenNotes;
        var hwEl = document.getElementById('laSlipHWNotes');
        if (hwEl) { hwEl.style.display='block'; hwEl.textContent='\u270f '+parsed.handwrittenNotes; }
      }
    } catch(e) {
      statusEl.innerHTML='&#9888; Could not parse ticket — please fill in manually.';
    }
  }).catch(function() {
    statusEl.innerHTML='&#9888; Scan unavailable offline — please fill in manually.';
  });
}
function _laScanSlipFromPhoto() {
  _laUploadSlipModal(null);
  // Auto-click file input after a short delay
  setTimeout(function(){
    var inp = document.getElementById('laSlipFileIn');
    if (inp) inp.click();
  }, 200);
}
function _laSlipSave() {
  var s = _aiaState || {};
  var date    = (document.getElementById('lsDate')  ||{}).value || new Date().toISOString().slice(0,10);
  var mixType = (document.getElementById('lsMix')   ||{}).value || '';
  var tons    = parseFloat((document.getElementById('lsTons')  ||{}).value) || 0;
  var rapPct  = parseFloat((document.getElementById('lsRap')   ||{}).value) || 0;
  var ticket  = (document.getElementById('lsTicket') ||{}).value || '';
  var loadNum = (document.getElementById('lsLoadNum')||{}).value || '';
  var truck   = (document.getElementById('lsTruck')  ||{}).value || '';
  var plant   = (document.getElementById('lsPlant') ||{}).value || '';
  var notes   = (document.getElementById('lsNotes') ||{}).value || '';

  _slipsLoad();
  var _ctx = window._slipScanContext || {};
  window._slipScanContext = null;
  var _photo   = window._laSlipPhotoB64 || '';
  window._laSlipPhotoB64 = null;
  var _hwNotes = window._laSlipHandwrittenNotes || '';
  window._laSlipHandwrittenNotes = null;

  var jobId   = _ctx.jobId   || s.backlogJobId || null;
  var jobName = _ctx.jobName || s.projectName  || '';
  var jobNum  = _ctx.jobNum  || s.dmcJobNo     || '';

  document.getElementById('laSlipModal')?.remove();

  function _finishSave(photoUrl, photoPath) {
    var slip = {
      id:               'slip_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
      jobId:            jobId,
      jobName:          jobName,
      jobNum:           jobNum,
      reqId:            s.editId || null,
      date:             date,
      mixType:          mixType,
      mixCode:          mixType,
      tons:             tons,
      rapPct:           rapPct,
      plant:            plant,
      truckNum:         truck,
      ticketNo:         ticket,
      loadNumber:       loadNum || ticket,
      photoUrl:         photoUrl,
      photoPath:        photoPath,
      autoScanned:      !!_photo,
      notes:            notes,
      handwrittenNotes: _hwNotes,
      createdAt:        Date.now()
    };
    slip.mixType = _normalizeMixType(slip.mixCode, slip.mixType);
    pavingSlips.unshift(slip);
    _slipsSave();

    if (slip.jobId) {
      var _slJob = (backlogJobs||[]).find(function(j){ return j.id === slip.jobId; });
      if (_slJob && (!_slJob.jobProgress || _slJob.jobProgress === 'none')) {
        _slJob.jobProgress = 'active';
        saveBacklog();
        try { pushNotif('info', 'Job Activated', '📋 ' + (_slJob.name||'Job') + ' marked active — first slip received', _slJob.id); } catch(e) {}
      }
    }

    (function(){
      var _today = new Date().toISOString().slice(0,10);
      var _daySlips = pavingSlips.filter(function(sl){ return sl.date===_today && (sl.jobId===slip.jobId||sl.jobNum===slip.jobNum); });
      var _dayTons = _daySlips.reduce(function(t,s){ return t+(parseFloat(s.tons)||0); }, 0);
      var _toast = document.createElement('div');
      _toast.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.96);border:1px solid rgba(245,197,24,0.35);border-radius:var(--radius);padding:10px 18px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);z-index:10001;min-width:240px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.5);pointer-events:none;';
      _toast.innerHTML='&#10003; Slip saved &nbsp;&middot;&nbsp; Today: <strong>'+_dayTons.toFixed(2)+'T</strong> in '+_daySlips.length+' load'+(_daySlips.length!==1?'s':'');
      document.body.appendChild(_toast);
      setTimeout(function(){ _toast.remove(); }, 3500);
    })();

    (function(){
      var _jid = slip.jobId || slip.jobNum;
      if (!_jid) return;
      document.querySelectorAll('[data-tonnage-job]').forEach(function(el){
        var attr = el.getAttribute('data-tonnage-job');
        if (attr===slip.jobId || attr===slip.jobNum) {
          if (el.classList.contains('home-backlog-row')) return;
          var fresh = document.createElement('div');
          fresh.innerHTML = renderTonnageTracker(slip.jobId, slip.jobNum, slip.jobName);
          if (fresh.firstElementChild) el.replaceWith(fresh.firstElementChild);
        }
      });
    })();

    var tc = document.getElementById('aiaTabContent');
    if (tc) tc.innerHTML = _aiaRenderLA();
  }

  if (_photo && typeof uploadFileToStorage === 'function' && storage) {
    uploadFileToStorage(_photo, 'paving_slips/' + (jobId || 'misc'))
      .then(function(r){ _finishSave(r.url, r.path); })
      .catch(function(){ _finishSave(_photo, ''); });
  } else {
    _finishSave(_photo, '');
  }
}

function _slipsJobView(jobId, jobName) {
  _slipsLoad();
  var isAdmin = false;
  try {
    var _u = (localStorage.getItem('dmc_u') || '').toLowerCase().trim();
    var _uBase = _u.indexOf('@') > -1 ? _u.split('@')[0] : _u;
    isAdmin = (_uBase === 'dj' || _uBase === 'donmartin');
    console.log('[SlipAdmin] u:', _u, 'base:', _uBase, 'isAdmin:', isAdmin);
  } catch(e) {}
  var slips = pavingSlips.filter(function(sl){ return sl.jobId === jobId || (jobName && sl.jobName && sl.jobName.toLowerCase() === jobName.toLowerCase()); });

  document.getElementById('slipsJobModal')?.remove();
  var ov = document.createElement('div');
  ov.id = 'slipsJobModal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9998;display:flex;align-items:center;justify-content:center;';

  // Group by date
  var byDate = {};
  slips.forEach(function(sl){ var d=sl.date||'Unknown'; if(!byDate[d])byDate[d]=[]; byDate[d].push(sl); });
  var sortedDates = Object.keys(byDate).sort().reverse();

  var fmtDL = function(d){ try{return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric'});}catch(e){return d;} };

  var foldersHTML = !sortedDates.length
    ? '<div style="padding:30px;text-align:center;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);">No slips on file for this job.</div>'
    : sortedDates.map(function(dateKey){
        var daySlips = byDate[dateKey];
        var dayTons  = daySlips.reduce(function(t,s){return t+(parseFloat(s.tons)||0);},0);
        var byMix={};
        daySlips.forEach(function(sl){var m=sl.mixType||'Other';byMix[m]=(byMix[m]||0)+(parseFloat(sl.tons)||0);});
        daySlips.sort(function(a,b){ var an=parseInt(a.loadNumber||a.ticketNo||'0'); var bn=parseInt(b.loadNumber||b.ticketNo||'0'); return an-bn; });
        var slipRows = daySlips.map(function(sl){
          return '<div style="display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.04);">'+
            (sl.photoUrl?'<img src="'+escHtml(sl.photoUrl)+'" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid var(--asphalt-light);cursor:pointer;flex-shrink:0;" onclick="_laViewSlipPhoto(\''+sl.id+'\')">'
              :'<div style="width:36px;height:36px;border-radius:4px;border:1px dashed var(--asphalt-light);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">&#128196;</div>')+
            '<div style="flex:1;min-width:0;">'+
              '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--white);font-weight:700;">'+escHtml(sl.mixType||'—')+'&nbsp; <span style="color:var(--stripe);">'+((parseFloat(sl.tons)||0).toLocaleString('en-US',{maximumFractionDigits:2}))+'T</span></div>'+
              '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);margin-top:1px;">'+
                [sl.ticketNo?'#'+sl.ticketNo:'', sl.truckNum?'Truck '+sl.truckNum:'', sl.plant, sl.rapPct>0?sl.rapPct+'% RAP':'', sl.autoScanned?'&#129302; AI Scanned':''].filter(Boolean).join(' &nbsp;·&nbsp; ')+
              '</div>'+
              (sl.handwrittenNotes?'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:#c9a800;font-style:italic;margin-top:2px;">&#9999; '+escHtml(sl.handwrittenNotes)+'</div>':'')+
            '</div>'+
            (isAdmin?'<button onclick="_laDeleteSlip(\''+sl.id+'\')" style="background:none;border:none;color:#666;cursor:pointer;font-size:13px;padding:2px 4px;margin-left:4px;flex-shrink:0;" title="Delete slip">&#128465;</button>':'')+
          '</div>';
        }).join('');
        var mixSumm = Object.keys(byMix).map(function(m){return '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);">'+escHtml(m)+' <strong style="color:var(--stripe);">'+(byMix[m].toLocaleString('en-US',{maximumFractionDigits:2}))+'T</strong></span>'; }).join(' &nbsp; ');
        return '<div style="border:1px solid var(--asphalt-light);border-radius:var(--radius);margin-bottom:10px;overflow:hidden;">'+
          '<div style="background:var(--asphalt);padding:9px 14px;display:flex;align-items:center;gap:10px;">'+
            '<span style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--white);font-weight:700;flex:1;">&#128197; '+escHtml(fmtDL(dateKey))+'</span>'+
            '<span style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--stripe);font-weight:700;">'+(dayTons.toLocaleString('en-US',{maximumFractionDigits:2}))+'T total</span>'+
            '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--concrete-dim);">('+daySlips.length+' slip'+(daySlips.length!==1?'s':'')+')</span>'+
          '</div>'+
          (mixSumm?'<div style="padding:3px 14px;font-size:8px;background:rgba(0,0,0,0.15);border-bottom:1px solid rgba(255,255,255,0.04);">'+mixSumm+'</div>':'')+
          slipRows+
        '</div>';
      }).join('');

  var totalTons = slips.reduce(function(t,s){return t+(parseFloat(s.tons)||0);},0);
  ov.innerHTML='<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);width:620px;max-width:96vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,0.6);">'+
    '<div style="background:var(--asphalt);border-bottom:1px solid var(--asphalt-light);padding:12px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0;">'+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;color:var(--stripe);">&#128196; Paving Slips — '+escHtml(jobName||'Job')+'</div>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;background:rgba(245,197,24,0.15);color:var(--stripe);padding:2px 8px;border-radius:10px;">'+slips.length+' slip'+(slips.length!==1?'s':'')+'</span>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+totalTons.toLocaleString('en-US',{maximumFractionDigits:2})+' T total</span>'+
      '<div style="flex:1;"></div>'+
      '<button onclick="document.getElementById(\'slipsJobModal\').remove()" style="background:none;border:none;color:var(--concrete-dim);font-size:18px;cursor:pointer;">&#10005;</button>'+
    '</div>'+
    '<div style="flex:1;overflow-y:auto;padding:14px 16px;">'+foldersHTML+'</div>'+
  '</div>';

  document.body.appendChild(ov);
}

// ── Window exports (needed by callers in index.html) ────────────────────────
window._slipsMigrate      = _slipsMigrate;
window._laRenderSlipPanel = _laRenderSlipPanel;
