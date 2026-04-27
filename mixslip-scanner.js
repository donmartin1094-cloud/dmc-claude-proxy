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

  var overlay = document.createElement('div');
  overlay.id = 'mixSlipScannerModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px;overflow-y:auto;';

  overlay.innerHTML =
    '<div id="_mssCard" style="background:#111;border:1px solid #2a2a2a;border-radius:10px;width:560px;max-width:98vw;box-shadow:0 32px 80px rgba(0,0,0,0.7);">'+
      '<div style="background:#0d0d0d;border-bottom:1px solid #1f1f1f;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-radius:10px 10px 0 0;">'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:13px;font-weight:700;letter-spacing:2px;color:#7ecb8f;">&#128203; MIX SLIP SCANNER</span>'+
        '<button onclick="_closeMixSlipScanner()" style="background:none;border:none;color:#555;font-size:20px;cursor:pointer;line-height:1;">&#10005;</button>'+
      '</div>'+
      '<div id="_mssPhaseOne" style="padding:16px 18px 16px;">'+
        '<div style="display:flex;gap:10px;margin-bottom:12px;">'+
          '<label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:#1a2a1a;border:1px solid #7ecb8f;border-radius:6px;color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">'+
            '&#128247; Take Photo'+
            '<input id="_mssCamera" type="file" accept="image/*" capture="environment" style="display:none;" onchange="_mssPhotoChosen(this,true)">'+
          '</label>'+
          '<label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#888;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">'+
            '&#128193; Upload File'+
            '<input id="_mssFile" type="file" accept="image/*,application/pdf" style="display:none;" onchange="_mssPhotoChosen(this,false)">'+
          '</label>'+
        '</div>'+
        '<div id="_mssPreview" style="display:none;margin-bottom:12px;border-radius:6px;overflow:hidden;border:1px solid #2a2a2a;"></div>'+
        '<div id="_mssScanStatus" style="display:none;font-family:\'DM Mono\',monospace;font-size:9px;padding:7px 10px;border-radius:5px;background:rgba(90,180,245,0.06);border:1px solid rgba(90,180,245,0.18);color:#5ab4f5;margin-bottom:12px;"></div>'+
        '<button onclick="_mssEnterManually()" style="width:100%;padding:9px;background:none;border:1px solid #2a2a2a;border-radius:6px;color:#555;font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;margin-top:4px;">Enter Manually (no photo)</button>'+
      '</div>'+
      '<div id="_mssPhaseTwo" style="display:none;padding:16px 18px 16px;"></div>'+
    '</div>';

  document.body.appendChild(overlay);
}

function _mssPhotoChosen(input, isCamera) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    window._mssPhotoB64 = e.target.result;
    var prev = document.getElementById('_mssPreview');
    if (prev) {
      prev.style.display = 'block';
      prev.innerHTML = '<img src="'+e.target.result+'" style="width:100%;max-height:220px;object-fit:contain;display:block;background:#0d0d0d;">';
    }
    var status = document.getElementById('_mssScanStatus');
    if (status) { status.style.display='block'; status.innerHTML='&#129302; Detecting supplier&#8230;'; }
    _mssAIScan(e.target.result.split(',')[1], file.type || 'image/jpeg');
  };
  reader.readAsDataURL(file);
}

function _mssAIScan(b64, mimeType) {
  var status = document.getElementById('_mssScanStatus');
  if (status) { status.style.display='block'; status.innerHTML='&#129302; Detecting supplier&#8230;'; }

  var pass1Prompt = 'Look at this paving delivery slip. What company name appears at the top as the supplier or plant company? Reply with ONLY the company name, nothing else. If unclear, reply "unknown".';

  fetch('https://dmc-claude-proxy-production.up.railway.app/claude', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:64, messages:[{ role:'user', content:[
      { type:'image', source:{ type:'base64', media_type:mimeType, data:b64 } },
      { type:'text', text: pass1Prompt }
    ]}]})
  }).then(function(r){ return r.json(); }).then(function(data1){
    var supplierRaw = ((data1.content&&data1.content[0]&&data1.content[0].text)||'').trim();
    var isAmrize = /amrize/i.test(supplierRaw);
    var needsReview = !supplierRaw || /^unknown$/i.test(supplierRaw.trim());

    var amrizePrompt = 'This is an Amrize (formerly Lafarge) hot mix asphalt delivery ticket.\nExtract these fields exactly as printed. Return ONLY valid JSON, no markdown:\n{"supplier":"Amrize","plant":"plant location/address as printed","time":"load time e.g. 14:32","ticketNo":"ticket number","loadNumber":"LOAD NUMBER from bottom right corner — label may say Load, Load No, Load #, or be a standalone sequential number (e.g. 1, 002). Return null if not found in bottom right corner.","truckNum":"truck number","mixType":"asphalt mix e.g. SBC 37.5 or SIC 19.0","tons":0,"date":"YYYY-MM-DD"}';
    var safeName = supplierRaw.replace(/"/g, '\\"');
    var genericPrompt = 'This is a hot mix asphalt paving delivery ticket.\nExtract these fields exactly as printed. Return ONLY valid JSON, no markdown:\n{"supplier":"'+safeName+'","plant":"plant location/address as printed","time":"load time e.g. 14:32","ticketNo":"ticket number","loadNumber":"LOAD NUMBER from bottom right corner — label may say Load, Load No, Load #, or be a standalone sequential number. Return null if not found in bottom right corner.","truckNum":"truck number","mixType":"asphalt mix designation e.g. SBC 37.5 or SIC 19.0","tons":0,"date":"YYYY-MM-DD"}';

    if (status) { status.innerHTML='&#129302; Supplier: '+(supplierRaw||'?')+' &#8212; extracting fields&#8230;'; }

    fetch('https://dmc-claude-proxy-production.up.railway.app/claude', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:512, messages:[{ role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType, data:b64 } },
        { type:'text', text: isAmrize ? amrizePrompt : genericPrompt }
      ]}]})
    }).then(function(r){ return r.json(); }).then(function(data2){
      var text = (data2.content&&data2.content[0]&&data2.content[0].text)||'';
      try {
        var p = JSON.parse(text.replace(/```json|```/g,'').trim());
        if (!p.supplier && supplierRaw && !needsReview) p.supplier = supplierRaw;
        if (status) { status.innerHTML='&#10003; Scan complete &#8212; verify and save.'; status.style.color='#7ecb8f'; }
        _mssShowConfirmForm(p, needsReview);
      } catch(e) {
        if (status) { status.innerHTML='&#9888; Could not parse &#8212; fill in manually.'; status.style.color='#f5c518'; }
        _mssShowConfirmForm({ supplier: supplierRaw }, needsReview);
      }
    }).catch(function(){
      if (status) { status.innerHTML='&#9888; Scan failed &#8212; fill in manually.'; status.style.color='#f5c518'; }
      _mssShowConfirmForm({ supplier: supplierRaw }, true);
    });
  }).catch(function(){
    if (status) { status.innerHTML='&#9888; Scan unavailable &#8212; fill in manually.'; status.style.color='#f5c518'; }
    _mssShowConfirmForm({}, true);
  });
}

function _mssShowConfirmForm(data, needsReview) {
  var phaseOne = document.getElementById('_mssPhaseOne');
  var phaseTwo = document.getElementById('_mssPhaseTwo');
  if (!phaseTwo) return;

  _slipsLoad();
  var jobs = (backlogJobs||[]).slice().sort(function(a,b){
    var ap=a.jobProgress==='active'?0:1, bp=b.jobProgress==='active'?0:1;
    return ap-bp||(a.name||'').localeCompare(b.name||'');
  });
  var jobOpts = jobs.map(function(j){
    var lbl=escHtml((j.name||'Unnamed')+(j.jobNum||j.number?' — #'+(j.jobNum||j.number):''));
    return '<option value="'+escHtml(j.id)+'">'+lbl+'</option>';
  }).join('');
  var defaultJob = jobs.find(function(j){ return j.jobProgress==='active'; }) || jobs[0];
  var defaultJobId = defaultJob ? defaultJob.id : '';

  var today = new Date().toISOString().slice(0,10);
  var d = data || {};

  var warningHtml = needsReview
    ? '<div style="padding:8px 12px;background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.3);border-radius:5px;font-family:\'DM Mono\',monospace;font-size:9px;color:#f5c518;margin-bottom:12px;">&#9888; Unknown supplier &#8212; verify all fields before saving</div>'
    : '';

  phaseTwo.innerHTML =
    warningHtml+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">'+
      _mssConfirmField('_mssSupplier','Supplier','text','e.g. Amrize',d.supplier||'')+
      _mssConfirmField('_mssPlant','Plant','text','Plant location',d.plant||'')+
      _mssConfirmField('_mssTime','Time','text','e.g. 14:32',d.time||'')+
      _mssConfirmField('_mssTicket','Slip #','text','Ticket number',d.ticketNo||'')+
      _mssConfirmField('_mssLoadNum','Load #','text','Bottom right corner',d.loadNumber||'')+
      _mssConfirmField('_mssTruck','Truck #','text','Truck number',d.truckNum||'')+
      _mssConfirmField('_mssMixType','Mix Type','text','e.g. SIC 19.0',d.mixType||'')+
      _mssConfirmField('_mssTons','Tons','number','0.00',(d.tons > 0 ? d.tons : ''))+
      '<div style="grid-column:span 2;">'+_mssConfirmField('_mssDate','Date','date','',d.date||today)+'</div>'+
    '</div>'+
    '<div style="margin-bottom:12px;">'+
      '<label style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:#555;display:block;margin-bottom:4px;">Assign to Job</label>'+
      '<select id="_mssJobSel" style="width:100%;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:5px;color:#ccc;font-family:\'DM Mono\',monospace;font-size:10px;padding:8px 10px;"><option value="">&#8212; no job &#8212;</option>'+jobOpts+'</select>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:10px;">'+
      '<button onclick="_mssSaveSlip()" style="flex:1;padding:11px;background:#1a2a1a;border:1px solid #7ecb8f;border-radius:6px;color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;" onmouseover="this.style.background=\'#7ecb8f\';this.style.color=\'#000\'" onmouseout="this.style.background=\'#1a2a1a\';this.style.color=\'#7ecb8f\'">&#128190; Save Slip</button>'+
      '<button onclick="_mssRescan()" style="padding:11px 14px;background:none;border:1px solid #2a2a2a;border-radius:6px;color:#555;font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;">&#8634; Rescan</button>'+
    '</div>'+
    '<div id="_mssTally" style="display:none;font-family:\'DM Mono\',monospace;font-size:9px;color:#7ecb8f;text-align:center;padding:5px;background:rgba(126,203,143,0.06);border-radius:4px;border:1px solid rgba(126,203,143,0.15);"></div>';

  phaseTwo.style.display = 'block';
  if (phaseOne) phaseOne.style.display = 'none';
  setTimeout(function(){ var s=document.getElementById('_mssJobSel'); if(s&&defaultJobId) s.value=defaultJobId; }, 50);
}

function _mssConfirmField(id, label, type, placeholder, val) {
  var extra = type==='number' ? ' step="0.01" min="0"' : '';
  return '<div>'+
    '<label style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:#555;display:block;margin-bottom:3px;">'+label+'</label>'+
    '<input id="'+id+'" type="'+type+'" placeholder="'+escHtml(placeholder)+'" value="'+escHtml(String(val||''))+'"'+extra+
      ' style="width:100%;box-sizing:border-box;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:4px;color:#ddd;font-family:\'DM Mono\',monospace;font-size:10px;padding:7px 9px;outline:none;">'+
  '</div>';
}

function _mssRescan() {
  var phaseOne = document.getElementById('_mssPhaseOne');
  var phaseTwo = document.getElementById('_mssPhaseTwo');
  if (phaseOne) phaseOne.style.display = 'block';
  if (phaseTwo) { phaseTwo.style.display = 'none'; phaseTwo.innerHTML = ''; }
  var prev = document.getElementById('_mssPreview');
  if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
  var status = document.getElementById('_mssScanStatus');
  if (status) { status.style.display = 'none'; status.innerHTML = ''; status.style.color = '#5ab4f5'; }
  var cam = document.getElementById('_mssCamera');
  if (cam) cam.value = '';
  var fil = document.getElementById('_mssFile');
  if (fil) fil.value = '';
  window._mssPhotoB64 = null;
}

function _mssEnterManually() {
  _mssShowConfirmForm({}, false);
}

function _mssSaveSlip() {
  var supplier = ((document.getElementById('_mssSupplier')||{}).value || '').trim();
  var plant    = ((document.getElementById('_mssPlant')   ||{}).value || '').trim();
  var time     = ((document.getElementById('_mssTime')    ||{}).value || '').trim();
  var ticket   = ((document.getElementById('_mssTicket')  ||{}).value || '').trim();
  var loadNum  = ((document.getElementById('_mssLoadNum') ||{}).value || '').trim();
  var truck    = ((document.getElementById('_mssTruck')   ||{}).value || '').trim();
  var mix      = ((document.getElementById('_mssMixType') ||{}).value || '').trim();
  var tons     = parseFloat((document.getElementById('_mssTons')||{}).value) || 0;
  var date     = ((document.getElementById('_mssDate')    ||{}).value) || new Date().toISOString().slice(0,10);
  var jobSel   = document.getElementById('_mssJobSel');
  var jobId    = jobSel ? jobSel.value : '';
  var job      = (backlogJobs||[]).find(function(j){ return j.id === jobId; });

  _slipsLoad();

  var loadNumByType = (pavingSlips.filter(function(s){ return s.jobId===jobId && s.date===date && s.mixType===mix; }).length) + 1;
  var loadNumDaily  = (pavingSlips.filter(function(s){ return s.jobId===jobId && s.date===date; }).length) + 1;

  var slip = {
    id:            'slip_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    jobId:         jobId || null,
    jobName:       job ? (job.name || '') : '',
    jobNum:        job ? (job.jobNum || job.number || '') : '',
    date:          date,
    mixType:       mix,
    tons:          tons,
    plant:         plant,
    supplier:      supplier,
    truckId:       truck,
    ticketNo:      ticket,
    loadNumber:    loadNum || ticket,
    loadNumByType: loadNumByType,
    loadNumDaily:  loadNumDaily,
    time:          time,
    photoUrl:      window._mssPhotoB64 || '',
    autoScanned:   true,
    notes:         '',
    createdAt:     Date.now()
  };

  pavingSlips.unshift(slip);
  _slipsSave();
  window._mssPhotoB64 = null;

  if (job && (!job.jobProgress || job.jobProgress === 'none')) {
    job.jobProgress = 'active';
    saveBacklog();
    try { pushNotif('info', 'Job Activated', '&#128203; ' + (job.name||'Job') + ' marked active &#8212; first slip received', job.id); } catch(e) {}
  }

  _mssSession.slips += 1;
  _mssSession.tons  += tons;

  try {
    pushNotif('success', 'Slip Saved',
      '&#10003; ' + tons.toFixed(2) + 't ' + (mix||'slip') + ' logged' + (job ? ' to ' + (job.name||'job') : ''),
      jobId||'slip');
  } catch(e) {}

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

  _mssRescan();
  setTimeout(function(){
    var status = document.getElementById('_mssScanStatus');
    if (status) {
      status.style.display = 'block';
      status.style.color = '#7ecb8f';
      status.innerHTML = '&#10003; Saved &#8212; Session: ' + _mssSession.slips + ' slip' + (_mssSession.slips!==1?'s':'') + ' &#8212; ' + _mssSession.tons.toFixed(2) + 't total';
    }
  }, 50);
}

function _closeMixSlipScanner() {
  if (_mssSession.slips > 0) {
    try {
      pushNotif('info', 'Session Complete',
        '&#128203; ' + _mssSession.slips + ' slip' + (_mssSession.slips!==1?'s':'') + ' &#8212; ' + _mssSession.tons.toFixed(2) + ' total tons logged',
        'session');
    } catch(e) {}
  }
  document.getElementById('mixSlipScannerModal')?.remove();
}
