// mixslip-scanner.js
// Standalone Mix Slip Scanner — extracted from index.html
// Depends on: slips.js (pavingSlips, _slipsLoad, _slipsSave, _laUploadSlipModal)
//             schedule.js (backlogJobs)
//             index.html globals (escHtml, saveBacklog, pushNotif, renderTonnageTracker)

// Standalone slip scan — opens slip modal with a specific job pre-loaded
function _scanSlipForJob(jobId, jobName, jobNum) {
  window._slipScanContext = { jobId: jobId, jobName: jobName, jobNum: jobNum };
  _laUploadSlipModal(null);
  setTimeout(function(){
    var inp = document.getElementById('laSlipFileIn');
    if (inp) inp.click();
  }, 200);
}

// ── Standalone Mix Slip Scanner (home screen) ────────────────────────────────
var _mssSession = { slips: 0, tons: 0 }; // per-modal session tally

function _openMixSlipScanner() {
  _mssSession = { slips: 0, tons: 0 };
  document.getElementById('mixSlipScannerModal')?.remove();

  // Build job dropdown — all backlog jobs, active first
  _slipsLoad();
  var jobs = (backlogJobs || []).slice().sort(function(a,b){
    var ap = a.jobProgress==='active'?0:1, bp = b.jobProgress==='active'?0:1;
    return ap - bp || (a.name||'').localeCompare(b.name||'');
  });
  var jobOpts = jobs.map(function(j){
    var lbl = escHtml((j.name||'Unnamed')+(j.jobNum||j.number?' — #'+(j.jobNum||j.number):''));
    return '<option value="'+escHtml(j.id)+'">'+lbl+'</option>';
  }).join('');
  // Default to first active job
  var defaultJob = jobs.find(function(j){ return j.jobProgress==='active'; }) || jobs[0];
  var defaultJobId = defaultJob ? defaultJob.id : '';

  var today = new Date().toISOString().slice(0,10);

  var overlay = document.createElement('div');
  overlay.id = 'mixSlipScannerModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px;overflow-y:auto;';

  overlay.innerHTML =
    '<div style="background:#111;border:1px solid #2a2a2a;border-radius:10px;width:560px;max-width:98vw;box-shadow:0 32px 80px rgba(0,0,0,0.7);">'+
      // ── Header ──────────────────────────────────────────────────────────
      '<div style="background:#0d0d0d;border-bottom:1px solid #1f1f1f;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-radius:10px 10px 0 0;">'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:13px;font-weight:700;letter-spacing:2px;color:#7ecb8f;">📋 MIX SLIP SCANNER</span>'+
        '<button onclick="_closeMixSlipScanner()" style="background:none;border:none;color:#555;font-size:20px;cursor:pointer;line-height:1;">✕</button>'+
      '</div>'+
      // ── Photo capture ───────────────────────────────────────────────────
      '<div style="padding:16px 18px 0;">'+
        '<div style="display:flex;gap:10px;margin-bottom:12px;">'+
          '<label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:#1a2a1a;border:1px solid #7ecb8f;border-radius:6px;color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">'+
            '📷 Take Photo'+
            '<input id="_mssCamera" type="file" accept="image/*" capture="environment" style="display:none;" onchange="_mssPhotoChosen(this,true)">'+
          '</label>'+
          '<label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#888;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">'+
            '📁 Upload File'+
            '<input id="_mssFile" type="file" accept="image/*,application/pdf" style="display:none;" onchange="_mssPhotoChosen(this,false)">'+
          '</label>'+
        '</div>'+
        // Thumbnail + scan status
        '<div id="_mssPreview" style="display:none;margin-bottom:12px;border-radius:6px;overflow:hidden;border:1px solid #2a2a2a;"></div>'+
        '<div id="_mssScanStatus" style="display:none;font-family:\'DM Mono\',monospace;font-size:9px;padding:7px 10px;border-radius:5px;background:rgba(90,180,245,0.06);border:1px solid rgba(90,180,245,0.18);color:#5ab4f5;margin-bottom:12px;"></div>'+
        // ── Extracted fields ────────────────────────────────────────────
        '<div id="_mssFields" style="display:none;">'+
          _mssFieldsHtml(today)+
          // ── Job assignment ─────────────────────────────────────────────
          '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #1f1f1f;">'+
            '<label style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:#555;display:block;margin-bottom:4px;">Assign to Job</label>'+
            '<select id="_mssJobSel" style="width:100%;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:5px;color:#ccc;font-family:\'DM Mono\',monospace;font-size:10px;padding:8px 10px;"><option value="">— no job —</option>'+jobOpts+'</select>'+
          '</div>'+
          // ── Save + session tally ───────────────────────────────────────
          '<div style="margin-top:14px;display:flex;align-items:center;gap:10px;">'+
            '<button onclick="_mssSaveSlip()" style="flex:1;padding:11px;background:#1a2a1a;border:1px solid #7ecb8f;border-radius:6px;color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background=\'#7ecb8f\';this.style.color=\'#000\'" onmouseout="this.style.background=\'#1a2a1a\';this.style.color=\'#7ecb8f\'">💾 Save Slip</button>'+
            '<button onclick="_mssReset()" style="padding:11px 16px;background:none;border:1px solid #2a2a2a;border-radius:6px;color:#555;font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;">↺ New Scan</button>'+
          '</div>'+
          '<div id="_mssTally" style="display:none;margin-top:10px;font-family:\'DM Mono\',monospace;font-size:9px;color:#7ecb8f;text-align:center;padding:5px;background:rgba(126,203,143,0.06);border-radius:4px;border:1px solid rgba(126,203,143,0.15);"></div>'+
        '</div>'+
      '</div>'+
      '<div style="height:16px;"></div>'+
    '</div>';

  document.body.appendChild(overlay);
  // Pre-select default job
  if (defaultJobId) setTimeout(function(){ var s=document.getElementById('_mssJobSel'); if(s) s.value=defaultJobId; }, 50);
}

function _mssFieldsHtml(today) {
  var fields = [
    { id:'_mssPlant',    label:'Plant',     type:'text',   placeholder:'Plant name & location' },
    { id:'_mssLoadTime', label:'Load Time', type:'text',   placeholder:'e.g. 14:32' },
    { id:'_mssTicket',   label:'Slip #',    type:'text',   placeholder:'Ticket number' },
    { id:'_mssTruck',    label:'Truck #',   type:'text',   placeholder:'Truck number' },
    { id:'_mssDriver',   label:'Driver',    type:'text',   placeholder:'Driver name' },
    { id:'_mssMixCode',  label:'Mix Code',  type:'text',   placeholder:'Full code line e.g. SP-19.0M64-28' },
    { id:'_mssMixType',  label:'Mix Type',  type:'text',   placeholder:'e.g. 19mm SP' },
    { id:'_mssTons',     label:'Tons',      type:'number', placeholder:'Net tons', step:'0.01', min:'0' },
    { id:'_mssRap',      label:'RAP %',     type:'number', placeholder:'0', step:'0.1', min:'0', max:'100' },
    { id:'_mssDate',     label:'Date',      type:'date',   placeholder:'', val: today },
  ];
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'+
    fields.map(function(f){
      var extra = (f.step?' step="'+f.step+'"':'')+(f.min!==undefined?' min="'+f.min+'"':'')+(f.max?' max="'+f.max+'"':'');
      return '<div>'+
        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">'+
          '<label style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:#555;">'+f.label+'</label>'+
          '<span id="'+f.id+'_badge" style="display:none;font-size:8px;"></span>'+
        '</div>'+
        '<input id="'+f.id+'" type="'+f.type+'" placeholder="'+escHtml(f.placeholder||'')+'"'+extra+
          (f.val?' value="'+escHtml(f.val)+'"':'')+
          ' style="width:100%;box-sizing:border-box;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:4px;color:#ddd;font-family:\'DM Mono\',monospace;font-size:10px;padding:7px 9px;outline:none;">'+
      '</div>';
    }).join('')+
  '</div>';
}

function _mssPhotoChosen(input, isCamera) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    window._mssPhotoB64 = e.target.result;
    // Show preview
    var prev = document.getElementById('_mssPreview');
    if (prev) {
      prev.style.display = 'block';
      prev.innerHTML = '<img src="'+e.target.result+'" style="width:100%;max-height:220px;object-fit:contain;display:block;background:#0d0d0d;">';
    }
    // Show fields skeleton before scan completes
    var flds = document.getElementById('_mssFields');
    if (flds) flds.style.display = 'block';
    // AI scan
    _mssAIScan(e.target.result.split(',')[1], file.type || 'image/jpeg');
  };
  reader.readAsDataURL(file);
}

function _mssAIScan(b64, mimeType) {
  var status = document.getElementById('_mssScanStatus');
  if (status) { status.style.display='block'; status.innerHTML='🤖 Scanning slip… extracting ticket details…'; }

  var prompt = 'You are reading a hot mix asphalt paving slip / delivery ticket.\nExtract ALL of the following fields exactly as printed on the slip.\n\nReturn ONLY valid JSON, no markdown, no backticks:\n{"plant":"plant name and location exactly as printed","loadTime":"time printed on slip e.g. 14:32","ticketNo":"ticket or slip number","truckNum":"truck number or ID","driver":"driver name if printed","mixCode":"the full tonnage/mix code line exactly as printed e.g. SP-19.0M64-28 or 19mm SP Superpave","mixType":"simplified mix type e.g. 19mm SP","tons":0,"rapPct":0,"date":"YYYY-MM-DD"}\n\ntons: net tons as a number. rapPct: RAP percentage as a number or 0 if not shown. If any field is not visible or not printed on this slip, use null for that field. Never invent values.';

  fetch('https://dmc-claude-proxy-production.up.railway.app/claude', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:512, messages:[{ role:'user', content:[
      { type:'image', source:{ type:'base64', media_type:mimeType, data:b64 } },
      { type:'text',  text: prompt }
    ]}]})
  }).then(function(r){ return r.json(); }).then(function(data){
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    try {
      var p = JSON.parse(text.replace(/```json|```/g,'').trim());
      _mssPopulateFields(p);
      if (status) { status.innerHTML='✓ AI extracted ticket data — verify and adjust as needed.'; status.style.color='#7ecb8f'; }
    } catch(e) {
      if (status) { status.innerHTML='⚠ Could not parse ticket — please fill in manually.'; status.style.color='#f5c518'; }
    }
  }).catch(function(){
    if (status) { status.innerHTML='⚠ Scan unavailable — please fill in manually.'; status.style.color='#f5c518'; }
  });
}

function _mssPopulateFields(p) {
  var map = { _mssPlant:p.plant, _mssLoadTime:p.loadTime, _mssTicket:p.ticketNo, _mssTruck:p.truckNum,
              _mssDriver:p.driver, _mssMixCode:p.mixCode, _mssMixType:p.mixType,
              _mssTons:(p.tons > 0 ? p.tons : null), _mssRap:(p.rapPct > 0 ? p.rapPct : null), _mssDate:p.date };
  Object.keys(map).forEach(function(id){
    var el = document.getElementById(id);
    var badge = document.getElementById(id+'_badge');
    if (!el) return;
    var val = map[id];
    if (val !== null && val !== undefined && val !== '') {
      el.value = val;
      if (badge) { badge.style.display='inline'; badge.textContent='✓'; badge.style.color='#7ecb8f'; }
    } else {
      if (badge) { badge.style.display='inline'; badge.textContent='⚠'; badge.style.color='#f5c518'; }
    }
  });
}

function _mssSaveSlip() {
  var tons   = parseFloat((document.getElementById('_mssTons')||{}).value) || 0;
  var mix    = ((document.getElementById('_mssMixType')||{}).value || '').trim();
  var date   = ((document.getElementById('_mssDate')||{}).value) || new Date().toISOString().slice(0,10);
  var jobSel = document.getElementById('_mssJobSel');
  var jobId  = jobSel ? jobSel.value : '';
  var job    = (backlogJobs||[]).find(function(j){ return j.id === jobId; });

  _slipsLoad();
  var slip = {
    id:        'slip_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    jobId:     jobId || null,
    jobName:   job ? (job.name || '') : '',
    jobNum:    job ? (job.jobNum || job.number || '') : '',
    date:      date,
    mixType:   mix,
    mixCode:   ((document.getElementById('_mssMixCode')||{}).value  || '').trim(),
    tons:      tons,
    rapPct:    parseFloat((document.getElementById('_mssRap')||{}).value) || 0,
    plant:     ((document.getElementById('_mssPlant')||{}).value    || '').trim(),
    truckNum:  ((document.getElementById('_mssTruck')||{}).value    || '').trim(),
    ticketNo:  ((document.getElementById('_mssTicket')||{}).value   || '').trim(),
    driver:    ((document.getElementById('_mssDriver')||{}).value   || '').trim(),
    loadTime:  ((document.getElementById('_mssLoadTime')||{}).value || '').trim(),
    photoUrl:  window._mssPhotoB64 || '',
    autoScanned: true,
    notes:     '',
    createdAt: Date.now()
  };

  pavingSlips.unshift(slip);
  _slipsSave();
  window._mssPhotoB64 = null;

  // Auto-activate job
  if (job && (!job.jobProgress || job.jobProgress === 'none')) {
    job.jobProgress = 'active';
    saveBacklog();
    try { pushNotif('info', 'Job Activated', '📋 ' + (job.name||'Job') + ' marked active — first slip received', job.id); } catch(e) {}
  }

  // Update session tally
  _mssSession.slips += 1;
  _mssSession.tons  += tons;
  var tally = document.getElementById('_mssTally');
  if (tally) {
    tally.style.display = 'block';
    tally.textContent = 'Session total: ' + _mssSession.slips + ' slip' + (_mssSession.slips!==1?'s':'') + ' — ' + _mssSession.tons.toFixed(2) + ' tons';
  }

  // Success toast
  try {
    pushNotif('success', 'Slip Saved',
      '✓ ' + tons.toFixed(2) + 't ' + (mix||'slip') + ' logged' + (job ? ' to ' + (job.name||'job') : ''),
      jobId||'slip');
  } catch(e) {}

  // Refresh tonnage trackers
  try {
    if (jobId) document.querySelectorAll('[data-tonnage-job]').forEach(function(el){
      if (el.classList.contains('home-backlog-row')) return;
      var attr = el.getAttribute('data-tonnage-job');
      if (attr === jobId) {
        var fr = document.createElement('div');
        fr.innerHTML = renderTonnageTracker(jobId, slip.jobNum, slip.jobName);
        if (fr.firstElementChild) el.replaceWith(fr.firstElementChild);
      }
    });
  } catch(e) {}

  // Clear for next scan (keep job selected)
  _mssReset(true);
}

function _mssReset(keepJob) {
  window._mssPhotoB64 = null;
  var prev = document.getElementById('_mssPreview');
  if (prev) { prev.style.display='none'; prev.innerHTML=''; }
  var status = document.getElementById('_mssScanStatus');
  if (status) { status.style.display='none'; status.style.color='#5ab4f5'; }
  var flds = document.getElementById('_mssFields');
  if (flds) flds.style.display='none';
  // Reset file inputs
  var cam = document.getElementById('_mssCamera');
  if (cam) cam.value='';
  var fil = document.getElementById('_mssFile');
  if (fil) fil.value='';
}

function _closeMixSlipScanner() {
  // Session summary toast if slips were scanned
  if (_mssSession.slips > 0) {
    try {
      pushNotif('info', 'Session Complete',
        '📋 ' + _mssSession.slips + ' slip' + (_mssSession.slips!==1?'s':'') + ' — ' + _mssSession.tons.toFixed(2) + ' total tons logged',
        'session');
    } catch(e) {}
  }
  document.getElementById('mixSlipScannerModal')?.remove();
}
