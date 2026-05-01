// reports.js — Reports feature module — cache bust v2

var reportsFolderCollapsed = {};
var reportsDailyViewMode = {}; // { [foreman]: 'month' | 'year' } per foreman folder
var _invMigrationDone = false;
var _invModalBrkRows = [];
var invCalViewMode    = 'grid';  // 'grid' | 'calendar' — mobile only
var invCalMonthOffset = 0;       // 0 = current month, negative = past

// ── Reports Print / Export Utilities ─────────────────────────────────────────

function _injectReportsPrintStyles() {
  if (document.getElementById('_reportsPrintStyle')) return;
  var s = document.createElement('style');
  s.id = '_reportsPrintStyle';
  s.setAttribute('media', 'print');
  s.textContent = [
    '@page { size: letter; margin: 0.75in; }',
    'body { background: #fff !important; color: #000 !important; }',
    '.hdr-top, .sidebar, #tabBar, .rpt-no-print, .home-widget,',
    '.do-card-del, .reports-file-del, .qc-file-del, #_doMultiBar { display: none !important; }',
    '#reportsView, #qcReportsView, #frListWrap, #_doCardView, #_rpMainList { display: block !important; overflow: visible !important; height: auto !important; max-height: none !important; }',
    '.reports-file-row, .qc-file-row, .do-card, .do-foreman-row { break-inside: avoid; page-break-inside: avoid; }',
    '.do-board { display: block !important; }',
    '.do-stack { box-shadow: none !important; }',
    '.do-card { display: block !important; border: 1px solid #ccc; margin-bottom: 12pt; color: #000 !important; background: #fff !important; }',
    '.do-cards-area { height: auto !important; overflow: visible !important; }',
    '.do-tabs-row { display: none !important; }',
    '.reports-file-row { border-bottom: 1px solid #ddd; color: #000 !important; }',
    '.qc-file-row { border-bottom: 1px solid #ddd; color: #000 !important; }',
    'body::after { content: counter(page); position: fixed; bottom: 0.4in; right: 0.75in; font-size: 8pt; color: #666; }'
  ].join('\n');
  document.head.appendChild(s);
}

function exportDailyOrdersCSV() {
  var headers = ['Date', 'Job Name', 'Job Number', 'Material', 'Tonnage', 'Foreman', 'Notes'];
  var rows = [headers.map(function(h){ return '"' + h + '"'; })];
  var orders = (window.dailyOrders || []).slice().sort(function(a,b){
    return (a.dateOfWork || '') < (b.dateOfWork || '') ? 1 : -1;
  });
  orders.forEach(function(o) {
    var mats = [], tons = [];
    if (o.matItems && o.matItems.length) {
      o.matItems.forEach(function(m) {
        mats.push(m.mix || m.desc || '');
        tons.push(String(m.tons || m.quantity || ''));
      });
    }
    var fields = [
      o.dateOfWork || o.createdAt || '',
      o.jobName || o.gcName || '',
      o.jobNo || '',
      mats.join('; '),
      tons.join('; '),
      o.foreman || '',
      o.notes || ''
    ];
    rows.push(fields.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }));
  });
  var csv = rows.map(function(r){ return r.join(','); }).join('\r\n');
  var today = new Date().toISOString().slice(0, 10);
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'daily-orders-' + today + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function openSendLookaheadToForemenModal() {
  document.getElementById('_laForemenModal')?.remove();

  var foremans = [];
  try { foremans = JSON.parse(localStorage.getItem('pavescope_foremans') || '[]'); } catch(e) {}
  if (!Array.isArray(foremans)) foremans = [];

  var checkboxes = foremans.length
    ? foremans.map(function(name) {
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;font-size:12px;color:var(--white);">' +
          '<input type="checkbox" class="_laForemanCb" value="' + name.replace(/"/g, '&quot;') + '" style="cursor:pointer;" checked> ' +
          name + '</label>';
      }).join('')
    : '<div style="color:var(--concrete-dim);font-size:12px;padding:8px 0;">No foremen found in pavescope_foremans.</div>';

  var tableHtml = '';
  var listRows = document.getElementById('_rpMainListRows');
  if (listRows) {
    tableHtml = '<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;">' + listRows.innerHTML + '</table>';
  }
  var dateRange = '';
  var firstMeta = document.querySelector('#_rpMainListRows .reports-file-date');
  if (firstMeta) dateRange = firstMeta.textContent;
  if (!dateRange && window.lookaheads && lookaheads.length) dateRange = lookaheads[0].dateRange || '';

  var overlay = document.createElement('div');
  overlay.id = '_laForemenModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9600;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px;max-width:480px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.8);">' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">📤 Send 2-Week Lookahead</div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:16px;">Select foremen to email the lookahead</div>' +
      '<div style="flex:1;overflow-y:auto;margin-bottom:16px;">' + checkboxes + '</div>' +
      '<div id="_laForemenStatus" style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);min-height:16px;margin-bottom:10px;"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button onclick="document.getElementById(\'_laForemenModal\').remove()" style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:10px;padding:5px 14px;cursor:pointer;">Cancel</button>' +
        '<button onclick="_sendLookaheadToCheckedForemen()" style="background:var(--stripe);border:none;border-radius:var(--radius);padding:5px 18px;color:var(--asphalt);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;cursor:pointer;">Send</button>' +
      '</div>' +
    '</div>';
  overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.remove(); });
  overlay._tableHtml = tableHtml;
  overlay._dateRange = dateRange;
  document.body.appendChild(overlay);
}

function _sendLookaheadToCheckedForemen() {
  var overlay = document.getElementById('_laForemenModal');
  if (!overlay) return;
  var checked = Array.from(overlay.querySelectorAll('._laForemanCb:checked')).map(function(cb){ return cb.value; });
  if (!checked.length) { alert('Select at least one foreman.'); return; }

  var employees = [];
  try { employees = JSON.parse(localStorage.getItem('pavescope_employees') || '[]'); } catch(e) {}

  var proxyBase = 'https://dmc-claude-proxy-production.up.railway.app';
  try { var _stored = localStorage.getItem('dmc_claude_proxy_url'); if (_stored) proxyBase = _stored.replace('/claude', ''); } catch(e) {}

  var mailUser = localStorage.getItem('dmc_mail_user') || '';
  var mailPass = localStorage.getItem('dmc_mail_pass') || '';
  var tableHtml = overlay._tableHtml || '';
  var dateRange = overlay._dateRange || new Date().toLocaleDateString();
  var subject = '2-Week Lookahead \u2014 ' + dateRange;

  var statusEl = document.getElementById('_laForemenStatus');
  var sent = 0, failed = 0, total = checked.length;

  function _laUpdateStatus() {
    if (statusEl) statusEl.textContent = 'Sent: ' + sent + '/' + total + (failed ? '  Errors: ' + failed : '');
  }

  checked.forEach(function(name) {
    var emp = (employees || []).find(function(e){ return e.name === name; });
    var email = emp ? (emp.email || '') : '';
    if (!email) {
      failed++;
      _laUpdateStatus();
      _rptToast('\u274C No email found for ' + name, 'error');
      return;
    }
    fetch(proxyBase + '/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: mailUser, pass: mailPass, to: email, subject: subject, html: tableHtml })
    }).then(function(res) {
      if (res.ok) { sent++; _rptToast('\u2705 Sent to ' + name, 'success'); }
      else { failed++; _rptToast('\u274C Failed: ' + name, 'error'); }
      _laUpdateStatus();
      if (sent + failed === total && failed === 0) setTimeout(function(){ overlay.remove(); }, 1200);
    }).catch(function() {
      failed++;
      _rptToast('\u274C Error sending to ' + name, 'error');
      _laUpdateStatus();
    });
  });
}

function _rptToast(msg, type) {
  if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:' +
    (type === 'error' ? 'rgba(217,79,61,0.92)' : 'rgba(50,180,100,0.92)') +
    ';color:#fff;font-family:\'DM Mono\',monospace;font-size:11px;padding:10px 18px;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,0.4);pointer-events:none;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 3500);
}

// ── End Reports Print / Export Utilities ──────────────────────────────────────

function renderReports() {
  const wrap = document.getElementById('reportsView');
  if (!wrap) return;

  // Group daily orders by foreman, then by sub-folder "Daily Orders"
  const foremen = {};
  dailyOrders.forEach(o => {
    const f = o.foreman || 'Unknown';
    if (!foremen[f]) foremen[f] = [];
    foremen[f].push(o);
  });

  const foremanFolders = Object.keys(foremen).sort().map(foreman => {
    const orders = foremen[foreman].sort((a,b) => b.id - a.id);
    const isOpen = reportsFolderCollapsed[foreman] !== true;
    const rows = isOpen ? orders.map(o => `
      <div class="reports-file-row" data-preview-id="${o.id}" style="">
        <span style="font-size:14px;">📄</span>
        <div class="reports-file-name" title="${o.fileName}">${o.fileName.replace(/\.(docx|html)$/,'')}</div>
        <div class="reports-file-date">${o.createdAt}</div>
        <button class="reports-file-dl" onclick="event.stopPropagation();previewDailyOrder('${o.id}')" title="Preview">👁 Preview</button>
        <button class="reports-file-dl" onclick="event.stopPropagation();printPreviewDailyOrder('${o.id}')" title="Print Preview">🖨 Print</button>
        <button class="reports-file-dl" onclick="event.stopPropagation();downloadDailyOrder('${o.id}')" title="Download">⬇ Download</button>
        <button class="reports-file-del" onclick="event.stopPropagation();deleteDailyOrder('${o.id}')" title="Delete">✕</button>
      </div>`).join('') : '';

    return `
      <div class="reports-folder" style="margin-left:24px;">
        <div class="reports-folder-header" onclick="toggleReportsFolder('${foreman.replace(/'/g,"\\'")}')">
          <span style="font-size:14px;">👷</span>
          <div class="reports-folder-name">${foreman}</div>
          <div class="reports-folder-count">${orders.length} order${orders.length!==1?'s':''}</div>
          <span style="color:var(--concrete-dim);font-size:12px;">${isOpen?'▲':'▼'}</span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  // ── Build per-supplier sub-folders inside "2 Week Lookaheads" ──
  let lookaheadInnerHtml = '';
  if (!reportsFolderCollapsed['__lookaheads__']) {
    if (!lookaheads.length) {
      lookaheadInnerHtml = '<div style="padding:16px 20px;font-size:12px;color:var(--concrete-dim);">No lookaheads yet. Click 📋 2 Week Lookahead on the schedule.</div>';
    } else {
      // Group by supplier
      const laBySupplier = {};
      lookaheads.forEach(la => {
        const s = la.supplier || 'Unknown Supplier';
        if (!laBySupplier[s]) laBySupplier[s] = [];
        laBySupplier[s].push(la);
      });

      lookaheadInnerHtml = Object.keys(laBySupplier).sort((a,b) => a.localeCompare(b)).map(supplier => {
        const safeKey = '__la_supplier__' + supplier;
        const isSubOpen = reportsFolderCollapsed[safeKey] !== true;
        const supplierLas = laBySupplier[supplier].sort((a,b) => (b.num||0) - (a.num||0));

        const fileRows = isSubOpen ? supplierLas.map(la =>
          '<div class="reports-file-row" data-preview-id="' + la.id + '" style="">'
          + '<span style="font-size:14px;">📊</span>'
          + '<div style="flex:1;overflow:hidden;">'
          + '<div class="reports-file-name" title="' + la.fileName + '">' + la.fileName.replace('.html','') + '</div>'
          + '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">' + la.dateRange + '</div>'
          + '</div>'
          + '<div class="reports-file-date">' + la.createdAt + '</div>'
          + '<button class="reports-file-dl" onclick="event.stopPropagation();previewLookahead(\'' + la.id + '\')" title="Preview">👁 Preview</button>'
          + '<button class="reports-file-dl" onclick="event.stopPropagation();downloadLookahead(\'' + la.id + '\')" title="Download">⬇ Download</button>'
          + '<button class="reports-file-del" onclick="event.stopPropagation();deleteLookahead(\'' + la.id + '\')" title="Delete">✕</button>'
          + '</div>'
        ).join('') : '';

        return `
          <div class="reports-folder" style="margin-left:24px;">
            <div class="reports-folder-header" onclick="toggleReportsFolder('${safeKey.replace(/'/g,"\\'")}')">
              <span style="font-size:14px;">🏭</span>
              <div class="reports-folder-name">${supplier}</div>
              <div class="reports-folder-count">${supplierLas.length} lookahead${supplierLas.length!==1?'s':''}</div>
              <span style="color:var(--concrete-dim);font-size:12px;">${isSubOpen?'▲':'▼'}</span>
            </div>
            ${fileRows}
          </div>`;
      }).join('');
    }
  }

  const lookaheadFolder = `
    <div class="reports-folder">
      <div class="reports-folder-header" onclick="toggleReportsFolder('__lookaheads__')">
        <span style="font-size:16px;">📂</span>
        <div class="reports-folder-name">2 Week Lookaheads</div>
        <div class="reports-folder-count">${lookaheads.length} total</div>
        <span style="color:var(--concrete-dim);font-size:12px;">${reportsFolderCollapsed['__lookaheads__']?'▼':'▲'}</span>
      </div>
      ${lookaheadInnerHtml}
    </div>`;

  const dailyOrdersFolder = `
    <div class="reports-folder">
      <div class="reports-folder-header" onclick="toggleReportsFolder('__daily_orders__')">
        <span style="font-size:16px;">📂</span>
        <div class="reports-folder-name">Daily Orders</div>
        <div class="reports-folder-count">${dailyOrders.length} total</div>
        <span style="color:var(--concrete-dim);font-size:12px;">${reportsFolderCollapsed['__daily_orders__']?'▼':'▲'}</span>
      </div>
      ${reportsFolderCollapsed['__daily_orders__'] ? '' : foremanFolders || '<div style="padding:16px 20px;font-size:12px;color:var(--concrete-dim);">No daily orders yet. Click 📋 Daily Order on any schedule block to generate one.</div>'}
    </div>`;


  // ── Chat History folder ──────────────────────────────────────────────────
  const me = chatMe ? chatMe() : (localStorage.getItem('dmc_u') || '');
  let chatHistoryItems = '';
  const myConvs = Object.entries(chatConvs).filter(([,d]) => d.members && d.members.includes(me));
  // Group by date then by conversation
  const chatByDate = {};
  myConvs.forEach(([id, d]) => {
    (d.messages||[]).forEach(m => {
      const dateKey = new Date(m.ts).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
      if (!chatByDate[dateKey]) chatByDate[dateKey] = {};
      if (!chatByDate[dateKey][id]) chatByDate[dateKey][id] = { conv: d, msgs: [] };
      chatByDate[dateKey][id].msgs.push(m);
    });
  });

  const chatDateFolders = Object.entries(chatByDate).sort(([a],[b]) => new Date(b) - new Date(a)).map(([date, convMap]) => {
    const dateOpen = !reportsFolderCollapsed['__chat_date__' + date];
    const convFolders = Object.entries(convMap).map(([cid, { conv, msgs }]) => {
      const convName = conv.name || conv.members.filter(m=>m!==me).join(', ') || cid;
      const convOpen = !reportsFolderCollapsed['__chat_conv__' + date + cid];
      const msgRows = msgs.map(m => {
        const t = new Date(m.ts).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
        const mine = m.sender === me;
        return `<div style="padding:4px 20px;font-family:'DM Sans',sans-serif;font-size:12px;color:var(--concrete);display:flex;gap:8px;">
          <span style="color:var(--concrete-dim);min-width:48px;">${t}</span>
          <span style="color:${mine?'var(--stripe)':'var(--white)'};">${escHtml(m.sender)}:</span>
          <span style="flex:1;">${escHtml(m.text)}</span>
        </div>`;
      }).join('');
      return `<div style="margin-left:20px;">
        <div class="reports-folder-header" onclick="toggleReportsFolder('__chat_conv__${date}${cid}')" style="padding:8px 12px;">
          <span style="font-size:14px;">💬</span>
          <div class="reports-folder-name">${escHtml(convName)}</div>
          <div class="reports-folder-count">${msgs.length} msg${msgs.length!==1?'s':''}</div>
          <span style="color:var(--concrete-dim);font-size:12px;">${convOpen?'▲':'▼'}</span>
        </div>
        ${convOpen ? msgRows : ''}
      </div>`;
    }).join('');
    return `<div style="margin-left:0;">
      <div class="reports-folder-header" onclick="toggleReportsFolder('__chat_date__${date}')" style="padding:8px 12px 8px 16px;">
        <span style="font-size:14px;">📅</span>
        <div class="reports-folder-name">${date}</div>
        <div class="reports-folder-count">${Object.keys(convMap).length} conversation${Object.keys(convMap).length!==1?'s':''}</div>
        <span style="color:var(--concrete-dim);font-size:12px;">${dateOpen?'▲':'▼'}</span>
      </div>
      ${dateOpen ? convFolders : ''}
    </div>`;
  }).join('');

  const totalChatMsgs = Object.values(chatConvs).reduce((n,d)=>n+(d.messages||[]).length,0);
  const chatHistoryOpen = !reportsFolderCollapsed['__chat_history__'];
  const chatHistoryFolder = `
    <div class="reports-folder">
      <div class="reports-folder-header" onclick="toggleReportsFolder('__chat_history__')">
        <span style="font-size:16px;">💬</span>
        <div class="reports-folder-name">Chat History</div>
        <div class="reports-folder-count">${totalChatMsgs} message${totalChatMsgs!==1?'s':''}</div>
        <span style="color:var(--concrete-dim);font-size:12px;">${chatHistoryOpen?'▲':'▼'}</span>
      </div>
      ${chatHistoryOpen ? (chatDateFolders || '<div style="padding:16px 20px;font-size:12px;color:var(--concrete-dim);">No chat messages yet.</div>') : ''}
    </div>`;
  // ── end Chat History ─────────────────────────────────────────────────────

  // ── Blank Order Form Templates folder ─────────────────────────────────────
  const blankFormsOpen = !reportsFolderCollapsed['__blank_forms__'];
  const blankFormsFolder = `
    <div class="reports-folder">
      <div class="reports-folder-header" onclick="toggleReportsFolder('__blank_forms__')">
        <span style="font-size:16px;">📋</span>
        <div class="reports-folder-name">Order Form Templates</div>
        <div class="reports-folder-count">2 forms</div>
        <span style="color:var(--concrete-dim);font-size:12px;">${blankFormsOpen?'▲':'▼'}</span>
      </div>
      ${blankFormsOpen ? `
        <div class="reports-file-row" style="margin-left:4px;">
          <span style="font-size:13px;">📄</span>
          <div class="reports-file-name">DMC Daily Order — Blank Template</div>
          <div class="reports-file-date" style="color:#5ab4f5;">Non-Amrize</div>
          <button class="reports-file-dl" onclick="event.stopPropagation();previewBlankOrderForm('dmc')" title="Preview">👁</button>
          <button class="reports-file-dl" onclick="event.stopPropagation();openBlankOrderForm('dmc')" title="Open & Print">⬇</button>
        </div>
        <div class="reports-file-row" style="margin-left:4px;">
          <span style="font-size:13px;">📄</span>
          <div class="reports-file-name">Amrize Daily Order — Blank Template</div>
          <div class="reports-file-date" style="color:#7ecb8f;">Amrize/Aggregate Industries</div>
          <button class="reports-file-dl" onclick="event.stopPropagation();previewBlankOrderForm('amrize')" title="Preview">👁</button>
          <button class="reports-file-dl" onclick="event.stopPropagation();openBlankOrderForm('amrize')" title="Open & Print">⬇</button>
        </div>` : ''}
    </div>`;
  // ── end Blank Order Form Templates ────────────────────────────────────────

  // Build search index — flat list of all previewable items
  const _rSearchIndex = [];
  dailyOrders.forEach(o => {
    // Also pull fields from schedule data for richer search
    let extraKw = '';
    try {
      const bdata = (schedData[o.dateKey]||{})[o.foreman === 'Filipe Joaquim' ? 'top' : 'bottom'];
      if (bdata && bdata.fields) {
        const f = bdata.fields;
        extraKw = [f.jobName, f.jobNum, f.plant, f.contact, f.location, f.notes,
          f.operators, f.equipment].filter(Boolean).join(' ');
      }
    } catch(e) {}
    _rSearchIndex.push({
      id: o.id, type:'daily', icon:'📄',
      name: o.fileName.replace('.docx',''),
      meta: o.foreman + ' · ' + (o.dateOfWork||''),
      badge: 'Daily Order', badgeColor:'#5ab4f5',
      keywords: [o.fileName, o.foreman, o.jobName, o.gcName, o.dateOfWork, o.jobNo, extraKw].filter(Boolean).join(' ').toLowerCase(),
      action: `previewDailyOrder('${o.id}')`
    });
  });
  lookaheads.forEach(la => {
    _rSearchIndex.push({
      id: la.id, type:'lookahead', icon:'📊',
      name: (la.fileName||'').replace('.html',''),
      meta: la.supplier + ' · ' + la.dateRange,
      badge: 'Lookahead', badgeColor:'#7ecb8f',
      keywords: [(la.fileName||''), la.supplier, la.dateRange, la.createdAt].filter(Boolean).join(' ').toLowerCase(),
      action: `previewLookahead('${la.id}')`
    });
  });
  (jobMixFormulas||[]).forEach(jm => {
    _rSearchIndex.push({
      id: jm.id, type:'jobmix', icon:'🧪',
      name: jm.mixName || 'Job Mix Formula',
      meta: (jm.supplier||'') + (jm.mixCode ? ' · ' + jm.mixCode : ''),
      badge: 'Mix Formula', badgeColor:'#7ecb8f',
      keywords: [jm.supplier, jm.mixName, jm.mixCode, jm.fileName, jm.uploadedBy].filter(Boolean).join(' ').toLowerCase(),
      action: `previewJobMixFormula('${jm.id}')`
    });
  });
  if (typeof qcReports !== 'undefined') {
    qcReports.forEach(r => {
      _rSearchIndex.push({
        id: r.id, type:'qc', icon:'🔬',
        name: r.fileName || r.jobName || 'QC Report',
        meta: r.jobName + (r.gcName?' · '+r.gcName:''),
        badge: 'QC Report', badgeColor:'var(--orange)',
        keywords: [r.fileName, r.jobName, r.gcName, r.jobNo, r.note, r.uploadedBy].filter(Boolean).join(' ').toLowerCase(),
        action: `previewQCReport('${r.id}')`
      });
    });
  }
  window._reportsSearchIndex = _rSearchIndex;

  // ── Populate sidebar folder tree ──────────────────────────────────────────
  const sidebarFolderEl = document.getElementById('reportsSidebarFolders');
  if (sidebarFolderEl) {

    // ── Helper: month name ──────────────────────────────────────────────────
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmtMonthKey = (ym) => { // "2025-03" → "March 2025"
      const [y, m] = ym.split('-');
      return MONTH_NAMES[parseInt(m)-1] + ' ' + y;
    };
    const fmtMonthShort = (ym) => { // "2025-03" → "Mar 25"
      const [y, m] = ym.split('-');
      return MONTH_NAMES[parseInt(m)-1].slice(0,3) + ' ' + y.slice(2);
    };

    // ════════════════════════════════════════════════════════
    // DAILY ORDERS folder — grouped by foreman → month → files
    // ════════════════════════════════════════════════════════
    const doOpen = !reportsFolderCollapsed['__daily_orders__'];

    const doForemanFolders = !doOpen ? '' : Object.keys(foremen).sort().map(foreman => {
      const orders = foremen[foreman].sort((a,b) => (b.dateOfWork||b.id) > (a.dateOfWork||a.id) ? 1 : -1);
      const fKey = '__do_foreman__' + foreman;
      const fOpen = !reportsFolderCollapsed[fKey];
      const viewMode = reportsDailyViewMode[foreman] || 'month'; // 'month' or 'year'

      if (!fOpen) {
        return `<div class="reports-folder" style="margin-left:16px;">
          <div class="reports-folder-header" onclick="toggleReportsFolder('${fKey.replace(/'/g,"\\'")}')">
            <span style="font-size:14px;">👷</span>
            <div class="reports-folder-name">${escHtml(foreman)}</div>
            <div class="reports-folder-count">${orders.length}</div>
            <span style="color:var(--concrete-dim);font-size:12px;">▼</span>
          </div>
        </div>`;
      }

      // Group by month "YYYY-MM"
      const byMonth = {};
      orders.forEach(o => {
        const mo = (o.dateOfWork||'').substring(0,7) || (o.createdAt||'').substring(0,7) || 'Unknown';
        if (!byMonth[mo]) byMonth[mo] = [];
        byMonth[mo].push(o);
      });
      const months = Object.keys(byMonth).sort().reverse();

      // Group by year for year-list view
      const byYear = {};
      orders.forEach(o => {
        const yr = (o.dateOfWork||'').substring(0,4) || '?';
        if (!byYear[yr]) byYear[yr] = [];
        byYear[yr].push(o);
      });
      const years = Object.keys(byYear).sort().reverse();

      let innerHtml = '';
      if (viewMode === 'month') {
        innerHtml = months.map(mo => {
          const mKey = fKey + '__' + mo;
          const mOpen = !reportsFolderCollapsed[mKey];
          const mOrders = byMonth[mo];
          const fileRows = mOpen ? mOrders.map(o => `
            <div class="reports-file-row" data-preview-id="${o.id}" style="margin-left:4px;">
              <span style="font-size:13px;">📄</span>
              <div class="reports-file-name" title="${escHtml(o.fileName)}">${o.fileName.replace(/\.(docx|html)$/,'')}</div>
              <div class="reports-file-date">${o.dateOfWork||o.createdAt||''}</div>
              <button class="reports-file-dl" onclick="event.stopPropagation();previewDailyOrder('${o.id}')" title="Preview">👁</button>
              <button class="reports-file-dl" onclick="event.stopPropagation();printPreviewDailyOrder('${o.id}')" title="Print Preview">🖨</button>
              <button class="reports-file-dl" onclick="event.stopPropagation();downloadDailyOrder('${o.id}')" title="Download">⬇</button>
              <button class="reports-file-del" onclick="event.stopPropagation();deleteDailyOrder('${o.id}')" title="Delete">✕</button>
            </div>`).join('') : '';
          return `<div class="reports-folder" style="margin-left:16px;">
            <div class="reports-folder-header" onclick="toggleReportsFolder('${mKey.replace(/'/g,"\\'")}')">
              <span style="font-size:14px;">📅</span>
              <div class="reports-folder-name">${fmtMonthKey(mo)}</div>
              <div class="reports-folder-count">${mOrders.length}</div>
              <span style="color:var(--concrete-dim);font-size:12px;">${mOpen?'▲':'▼'}</span>
            </div>
            ${fileRows}
          </div>`;
        }).join('') || '<div style="padding:10px 20px;font-size:12px;color:var(--concrete-dim);">No orders for this foreman.</div>';
      } else {
        // year-list view — all orders in a flat scrollable list grouped by year
        innerHtml = years.map(yr => {
          const yrKey = fKey + '__yr__' + yr;
          const yrOpen = !reportsFolderCollapsed[yrKey];
          const yrOrders = byYear[yr].sort((a,b) => (b.dateOfWork||'') > (a.dateOfWork||'') ? 1 : -1);
          const fileRows = yrOpen ? yrOrders.map(o => `
            <div class="reports-file-row" data-preview-id="${o.id}" style="margin-left:4px;">
              <span style="font-size:13px;">📄</span>
              <div class="reports-file-name" title="${escHtml(o.fileName)}">${o.fileName.replace(/\.(docx|html)$/,'')}</div>
              <div class="reports-file-date">${(o.dateOfWork||o.createdAt||'').slice(0,10)}</div>
              <button class="reports-file-dl" onclick="event.stopPropagation();previewDailyOrder('${o.id}')" title="Preview">👁</button>
              <button class="reports-file-dl" onclick="event.stopPropagation();printPreviewDailyOrder('${o.id}')" title="Print Preview">🖨</button>
              <button class="reports-file-dl" onclick="event.stopPropagation();downloadDailyOrder('${o.id}')" title="Download">⬇</button>
              <button class="reports-file-del" onclick="event.stopPropagation();deleteDailyOrder('${o.id}')" title="Delete">✕</button>
            </div>`).join('') : '';
          return `<div class="reports-folder" style="margin-left:16px;">
            <div class="reports-folder-header" onclick="toggleReportsFolder('${yrKey.replace(/'/g,"\\'")}')">
              <span style="font-size:14px;">📆</span>
              <div class="reports-folder-name">${yr}</div>
              <div class="reports-folder-count">${yrOrders.length}</div>
              <span style="color:var(--concrete-dim);font-size:12px;">${yrOpen?'▲':'▼'}</span>
            </div>
            ${fileRows}
          </div>`;
        }).join('') || '<div style="padding:10px 20px;font-size:12px;color:var(--concrete-dim);">No orders.</div>';
      }

      // Toggle button (month ↔ year list)
      const toggleBtn = `<button onclick="event.stopPropagation();reportsDailyViewMode['${foreman.replace(/'/g,"\\'")}']='${viewMode==='month'?'year':'month'}';renderReports();"
        style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.5px;text-transform:uppercase;color:var(--concrete-dim);padding:2px 6px;cursor:pointer;flex-shrink:0;margin-left:4px;"
        title="Switch to ${viewMode==='month'?'year list':'month'} view">${viewMode==='month'?'📆 Year List':'📅 Month'}</button>`;

      return `<div class="reports-folder" style="margin-left:16px;">
        <div class="reports-folder-header" onclick="toggleReportsFolder('${fKey.replace(/'/g,"\\'")}')">
          <span style="font-size:14px;">👷</span>
          <div class="reports-folder-name">${escHtml(foreman)}</div>
          <div class="reports-folder-count">${orders.length}</div>
          ${toggleBtn}
          <span style="color:var(--concrete-dim);font-size:12px;">▲</span>
        </div>
        ${innerHtml}
      </div>`;
    }).join('') || '<div style="padding:16px 20px;font-size:12px;color:var(--concrete-dim);">No daily orders yet.</div>';

    const dailyOrdersFolderNew = `
      <div class="reports-folder">
        <div class="reports-folder-header" onclick="toggleReportsFolder('__daily_orders__')">
          <span style="font-size:16px;">📂</span>
          <div class="reports-folder-name">Daily Orders</div>
          <div class="reports-folder-count">${dailyOrders.length} total</div>
          <span style="color:var(--concrete-dim);font-size:12px;">${doOpen?'▲':'▼'}</span>
        </div>
        ${doForemanFolders}
      </div>`;

    // ════════════════════════════════════════════════════════
    // 2 WEEK LOOK AHEAD folder  (reuse lookaheadFolder as-is but rename)
    // ════════════════════════════════════════════════════════
    const twoWeekOpen = !reportsFolderCollapsed['__lookaheads__'];
    const twoWeekFolder = lookaheadFolder.replace('>2 Week Lookaheads<', '>2 Week Look Ahead<');

    // ════════════════════════════════════════════════════════
    // FOREMEN'S REPORTS folder — QC reports grouped by foreman/uploader
    // Pull from qcReports array, group by uploadedBy
    // ════════════════════════════════════════════════════════
    const frOpen = !reportsFolderCollapsed['__foremens_reports__'];
    let frInnerHtml = '';
    if (frOpen && typeof qcReports !== 'undefined') {
      const byUploader = {};
      qcReports.forEach(r => {
        const u = r.uploadedBy || r.foreman || 'Unknown';
        if (!byUploader[u]) byUploader[u] = [];
        byUploader[u].push(r);
      });
      if (!Object.keys(byUploader).length) {
        frInnerHtml = '<div style="padding:16px 20px;font-size:12px;color:var(--concrete-dim);">No foremen reports yet. Upload QC Reports from the QC tab.</div>';
      } else {
        frInnerHtml = Object.keys(byUploader).sort().map(uploader => {
          const rpts = byUploader[uploader].sort((a,b) => (b.uploadedAt||0) - (a.uploadedAt||0));
          const uKey = '__fr_uploader__' + uploader;
          const uOpen = !reportsFolderCollapsed[uKey];
          const fileRows = uOpen ? rpts.map(r => `
            <div class="reports-file-row" data-preview-id="${r.id}" style="margin-left:4px;">
              <span style="font-size:13px;">${r.fileType?.startsWith('image/')?'🖼️':'📄'}</span>
              <div class="reports-file-name" title="${escHtml(r.fileName||r.jobName||'Report')}">${escHtml(r.fileName||r.jobName||'Report')}</div>
              <div class="reports-file-date">${r.uploadedAt ? new Date(r.uploadedAt).toLocaleDateString() : ''}</div>
              <button class="reports-file-dl" onclick="event.stopPropagation();previewQCReport('${r.id}')" title="Preview">👁</button>
              <button class="reports-file-del" onclick="event.stopPropagation();deleteQCReport('${r.id}')" title="Delete">✕</button>
            </div>`).join('') : '';
          return `<div class="reports-folder" style="margin-left:16px;">
            <div class="reports-folder-header" onclick="toggleReportsFolder('${uKey.replace(/'/g,"\\'")}')">
              <span style="font-size:14px;">👷</span>
              <div class="reports-folder-name">${escHtml(uploader)}</div>
              <div class="reports-folder-count">${rpts.length}</div>
              <span style="color:var(--concrete-dim);font-size:12px;">${uOpen?'▲':'▼'}</span>
            </div>
            ${fileRows}
          </div>`;
        }).join('');
      }
    }
    const foremensReportsFolder = `
      <div class="reports-folder">
        <div class="reports-folder-header" onclick="toggleReportsFolder('__foremens_reports__')">
          <span style="font-size:16px;">📂</span>
          <div class="reports-folder-name">Foremen's Reports</div>
          <div class="reports-folder-count">${typeof qcReports !== 'undefined' ? qcReports.length : 0} total</div>
          <span style="color:var(--concrete-dim);font-size:12px;">${frOpen?'▲':'▼'}</span>
        </div>
        ${frInnerHtml}
      </div>`;

    // ════════════════════════════════════════════════════════
    // JOB MIX FORMULA folder — grouped by supplier
    // ════════════════════════════════════════════════════════
    const jmOpen = !reportsFolderCollapsed['__job_mix_formulas__'];
    let jmInnerHtml = '';
    if (jmOpen) {
      if (!jobMixFormulas.length) {
        jmInnerHtml = '<div style="padding:16px 20px;font-size:12px;color:var(--concrete-dim);">No Job Mix Formula files yet. Click + Add New in Job Mix Formula.</div>';
      } else {
        const bySupplier = {};
        jobMixFormulas.forEach(jm => {
          const s = jm.supplier || 'Unknown Supplier';
          if (!bySupplier[s]) bySupplier[s] = [];
          bySupplier[s].push(jm);
        });
        jmInnerHtml = Object.keys(bySupplier).sort((a,b)=>a.localeCompare(b)).map(supplier => {
          const sKey = '__jm_supplier__' + supplier;
          const sOpen = !reportsFolderCollapsed[sKey];
          const files = bySupplier[supplier].sort((a,b)=>(b.uploadedAt||0)-(a.uploadedAt||0));
          const rows = sOpen ? files.map(jm => `
            <div class="reports-file-row" data-preview-id="${jm.id}" style="margin-left:4px;">
              <span style="font-size:13px;">🧪</span>
              <div class="reports-file-name" title="${escHtml(jm.mixName || jm.fileName || 'Job Mix Formula')}">${escHtml(jm.mixName || jm.fileName || 'Job Mix Formula')}</div>
              <div class="reports-file-date">${escHtml(jm.mixCode || '')}</div>
              <button class="reports-file-dl" onclick="event.stopPropagation();previewJobMixFormula('${jm.id}')" title="Preview">👁</button>
              <button class="reports-file-dl" onclick="event.stopPropagation();downloadJobMixFormula('${jm.id}')" title="Download">⬇</button>
              <button class="reports-file-del" onclick="event.stopPropagation();deleteJobMixFormula('${jm.id}')" title="Delete">✕</button>
            </div>`).join('') : '';
          return `<div class="reports-folder" style="margin-left:16px;">
            <div class="reports-folder-header" onclick="toggleReportsFolder('${sKey.replace(/'/g,"\\'")}')">
              <span style="font-size:14px;">🏭</span>
              <div class="reports-folder-name">${escHtml(supplier)}</div>
              <div class="reports-folder-count">${files.length}</div>
              <span style="color:var(--concrete-dim);font-size:12px;">${sOpen?'▲':'▼'}</span>
            </div>
            ${rows}
          </div>`;
        }).join('');
      }
    }
    const jobMixFolder = `
      <div class="reports-folder">
        <div class="reports-folder-header" onclick="toggleReportsFolder('__job_mix_formulas__')">
          <span style="font-size:16px;">📂</span>
          <div class="reports-folder-name">Job Mix Formula</div>
          <div class="reports-folder-count">${jobMixFormulas.length} total</div>
          <span style="color:var(--concrete-dim);font-size:12px;">${jmOpen?'▲':'▼'}</span>
        </div>
        ${jmInnerHtml}
      </div>`;

    const _rst = window._activeReportsSubTab || 'reportsDailyOrders';
    if (_rst === 'reportsDailyOrders') {
      sidebarFolderEl.innerHTML = dailyOrdersFolderNew;
    } else if (_rst === 'reportsTwoWeek') {
      sidebarFolderEl.innerHTML = twoWeekFolder;
    } else if (_rst === 'reportsForemens') {
      sidebarFolderEl.innerHTML = foremensReportsFolder;
    } else if (_rst === 'reportsJobMix') {
      sidebarFolderEl.innerHTML = jobMixFolder;
    } else if (_rst === 'reportsBlankForms') {
      sidebarFolderEl.innerHTML = blankFormsFolder;
    } else if (_rst === 'reportsCertif') {
      sidebarFolderEl.innerHTML = _renderCertifiedsFolder();
    } else {
      // fallback: show all
      sidebarFolderEl.innerHTML = dailyOrdersFolderNew + twoWeekFolder + foremensReportsFolder + jobMixFolder + chatHistoryFolder + blankFormsFolder + _renderCertifiedsFolder();
    }
  }

  // ── Main window: thumbnail gallery + preview pane ──────────────────────
  const _rst2 = window._activeReportsSubTab; // null/undefined = show gallery

  // Count reports per type
  const _doCnt  = dailyOrders.length;
  const _laCnt  = lookaheads.length;
  const _qcCnt  = typeof qcReports !== 'undefined' ? qcReports.length : 0;
  const _jmCnt  = (jobMixFormulas||[]).length;
  const _aiaCnt = typeof aiaReqs !== 'undefined' ? aiaReqs.length : 0;
  const _chatCnt = Object.values(chatConvs||{}).reduce((n,d)=>n+(d.messages||[]).length,0);

  const _galleryHtml = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:32px 24px;overflow-y:auto;gap:32px;min-height:0;">
      <div style="text-align:center;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:3px;color:var(--white);margin-bottom:6px;">Reports</div>
        <div style="font-family:'DM Mono',monospace;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Click folder to open · Use Preview button for blank form</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:18px;justify-content:center;align-items:flex-start;max-width:960px;">
        ${[
          { icon:'📄', label:'Daily Orders',       sub:'Generated from schedule',   count:_doCnt,  tab:'reportsDailyOrders', color:'#5ab4f5',       prev:'daily'      },
          { icon:'📊', label:'2 Week Look Aheads', sub:'Lookahead planning sheets', count:_laCnt,  tab:'reportsTwoWeek',     color:'#7ecb8f',       prev:'lookahead'  },
          { icon:'👷', label:"Foremen's Reports",  sub:'Job completion reports',    count:_qcCnt,  tab:'reportsForemens',    color:'var(--orange)', prev:'foreman'    },
          { icon:'🔬', label:'QC Reports',         sub:'Quality control files',     count:_qcCnt,  tab:'reportsQC',          color:'var(--orange)', prev:'qc'         },
          { icon:'🧪', label:'Job Mix Formula',    sub:'Supplier formula docs',     count:_jmCnt,  tab:'reportsJobMix',      color:'#7ecb8f',       prev:'jobmix'     },
          { icon:'📋', label:'AIA Requisitions',   sub:'Payment applications',      count:_aiaCnt, tab:'apAia',              color:'#f5c518',       prev:'tack'       },
          { icon:'💬', label:'Chat History',       sub:'Team message archive',      count:_chatCnt,tab:'chat',               color:'#c084f5',       prev:null         },
          { icon:'📋', label:'Order Templates',    sub:'Blank DMC & Amrize forms',  count:2,       tab:'reportsBlankForms',  color:'#ff8c42',       prev:'dmc-order'  },
          { icon:'📋', label:'Certifieds',         sub:'MassDOT certified payroll', count:certifiedReports.length, tab:'reportsCertif', color:'#f5c518', prev:'certified' },
        ].map(cat => `
          <div class="_rpGallCard" style="width:148px;display:flex;flex-direction:column;gap:0;position:relative;">
            <!-- "Folder" tab top -->
            <div style="background:${cat.color}22;border:2px solid ${cat.color}55;border-radius:10px 10px 0 0;height:10px;width:60%;"></div>
            <!-- Main card body — click opens folder -->
            <div onclick="_rpCardClick('${cat.tab}','${cat.prev||''}')" style="cursor:pointer;background:var(--asphalt);border:2px solid ${cat.color}55;border-radius:0 8px 8px 8px;padding:14px 12px 10px;display:flex;flex-direction:column;gap:6px;transition:all 0.15s;"
              id="rpcard_${cat.tab}">
              <div style="font-size:24px;line-height:1;">${cat.icon}</div>
              <div style="font-size:12px;font-weight:700;color:var(--white);line-height:1.3;">${cat.label}</div>
              <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--concrete-dim);line-height:1.4;">${cat.sub}</div>
              <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;color:${cat.color};">${cat.count} file${cat.count!==1?'s':''}</div>
            </div>
            ${cat.prev ? `<button onclick="openBlankReportPreview('${cat.prev}')" style="margin-top:5px;background:none;border:1px solid ${cat.color}44;border-radius:var(--radius);padding:4px 0;width:100%;color:${cat.color};font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.8px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.background='${cat.color}18'" onmouseout="this.style.background='none'">👁 Preview Blank Form</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`;

  wrap.innerHTML = `
    <div class="reports-wrap" style="flex:1;display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div class="reports-breadcrumb" id="reportsPreviewBreadcrumb" style="display:none;"></div>
      <div class="reports-preview-pane" id="reportsPreviewPane" style="flex:1;min-height:0;display:flex;flex-direction:column;">
        <div id="reportsGallery" style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--asphalt-mid);">
          ${_galleryHtml}
        </div>
      </div>
    </div>`;

  // Show file list only when a specific sub-tab was explicitly selected
  const _aTab = window._activeReportsSubTab;
  if (_aTab && _aTab !== 'reports' && _aTab !== 'reportsDocs') {
    _populateReportsMainList(_aTab);
  }
}


function _populateReportsMainList(tabId) {
  const gallery = document.getElementById('reportsGallery');
  const pane    = document.getElementById('reportsPreviewPane');
  if (!pane) return;
  // Clean up ALL prior sub-tab containers before rendering
  document.getElementById('_rpMainList')?.remove();
  document.getElementById('_doCardView')?.remove();
  document.getElementById('frListWrap')?.remove();
  if (gallery) gallery.style.display = 'none';

  let items = [], title = '', icon = '';
  let headerExtra = '';
  var _doGroupedRows = null;
  if (tabId === 'reportsDailyOrders') {
    const doWrap = document.createElement('div');
    doWrap.id = '_doCardView';
    doWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';
    pane.appendChild(doWrap);
    _renderDailyOrderCards(doWrap);
    return;
  } else if (tabId === 'reportsTwoWeek') {
    title = '2 Week Look Aheads'; icon = '📊';
    items = (lookaheads||[]).sort((a,b)=>(b.createdAt||'')>(a.createdAt||'')?1:-1)
      .map(la=>({id:la.id,name:(la.fileName||'').replace('.html',''),icon:'📊',
        meta:(la.supplier||'')+' · '+(la.dateRange||''),
        action:"previewLookahead('"+la.id+"')",dl:"downloadLookahead('"+la.id+"')",del:"deleteLookahead('"+la.id+"')"}));
  } else if (tabId === 'reportsForemens') {
    // Foremen's Reports has its own full renderer
    const frWrap = document.createElement('div');
    frWrap.id = 'frListWrap';
    frWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';
    pane.appendChild(frWrap);
    renderForemanReports(frWrap);
    return; // skip generic item renderer
  } else if (tabId === 'reportsCertif') {
    // Certifieds has its own full renderer
    const certWrap = document.createElement('div');
    certWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow-y:auto;min-height:0;padding:16px;';
    certWrap.innerHTML = _renderCertifiedsFolder();
    pane.appendChild(certWrap);
    return; // skip generic item renderer
  } else if (tabId === 'reportsJobMix') {
    title = 'Job Mix Formula'; icon = '🧪';
    items = (jobMixFormulas||[]).sort((a,b)=>(b.uploadedAt||0)-(a.uploadedAt||0))
      .map(jm=>({
        id:jm.id,
        name:jm.mixName || 'Job Mix Formula',
        icon:'🧪',
        supplier: jm.supplier || 'Unknown Supplier',
        mixCode: jm.mixCode || '',
        fileName: jm.fileName || '',
        uploadedBy: jm.uploadedBy || '',
        uploadedAt: jm.uploadedAt || 0,
        meta:(jm.supplier||'') + (jm.mixCode ? ' · ' + jm.mixCode : ''),
        action:"previewJobMixFormula('"+jm.id+"')",
        dl:"downloadJobMixFormula('"+jm.id+"')",
        del:"deleteJobMixFormula('"+jm.id+"')"
      }));
    headerExtra =
      '<button onclick="setJobMixViewMode(\'cards\')" style="background:'+ (jobMixViewMode==='cards'?'rgba(245,197,24,0.12)':'none') +';border:1px solid '+ (jobMixViewMode==='cards'?'rgba(245,197,24,0.5)':'var(--asphalt-light)') +';border-radius:3px;color:'+ (jobMixViewMode==='cards'?'var(--stripe)':'var(--concrete-dim)') +';font-size:10px;padding:3px 8px;cursor:pointer;">▦ Cards</button>'+
      '<button onclick="setJobMixViewMode(\'supplier\')" style="background:'+ (jobMixViewMode==='supplier'?'rgba(245,197,24,0.12)':'none') +';border:1px solid '+ (jobMixViewMode==='supplier'?'rgba(245,197,24,0.5)':'var(--asphalt-light)') +';border-radius:3px;color:'+ (jobMixViewMode==='supplier'?'var(--stripe)':'var(--concrete-dim)') +';font-size:10px;padding:3px 8px;cursor:pointer;">▤ Supplier Stacks</button>'+
      '<button onclick="openJobMixFormulaModal()" style="background:var(--stripe);border:1px solid rgba(245,197,24,0.5);border-radius:3px;color:var(--asphalt);font-size:10px;font-weight:700;padding:3px 8px;cursor:pointer;">+ Add New</button>';
  }

  const listEl = document.createElement('div');
  listEl.id = '_rpMainList';
  listEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';
  let rows = items.length ? items.map(it =>
    '<div class="reports-file-row" data-preview-id="'+escHtml(it.id)+'" tabindex="0" onclick="'+it.action+'" style="padding:10px 18px;border-bottom:1px solid rgba(255,255,255,0.04);">'+
    '<span style="font-size:14px;flex-shrink:0;">'+it.icon+'</span>'+
    '<div class="reports-file-name" style="flex:1;">'+escHtml(it.name)+'</div>'+
    '<div class="reports-file-date" style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);flex-shrink:0;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(it.meta)+'</div>'+
    '<button class="reports-file-dl" onclick="event.stopPropagation();'+it.action+'" title="Preview">👁</button>'+
    (it.dl?'<button class="reports-file-dl" onclick="event.stopPropagation();'+it.dl+'" title="Download">⬇</button>':'')+
    (it.del?'<button class="reports-file-del" onclick="event.stopPropagation();'+it.del+'" title="Delete">✕</button>':'')+
    '</div>'
  ).join('') : '<div style="padding:40px;text-align:center;color:var(--concrete-dim);font-size:12px;">No '+escHtml(title)+' yet.</div>';

  if (_doGroupedRows) rows = _doGroupedRows;

  if (tabId === 'reportsJobMix' && items.length) {
    if (jobMixViewMode === 'cards') {
      rows = '<div style="padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">' + items.map(it =>
        '<div data-preview-id="'+escHtml(it.id)+'" onclick="'+it.action+'" style="cursor:pointer;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:8px;">'+
          '<div style="display:flex;align-items:center;gap:8px;">'+
            '<span style="font-size:18px;">🧪</span>'+
            '<div style="flex:1;min-width:0;">'+
              '<div style="font-size:12px;font-weight:700;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(it.name)+'</div>'+
              '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+escHtml(it.mixCode||'')+'</div>'+
            '</div>'+
          '</div>'+
          '<div style="font-size:11px;color:var(--concrete-dim);">🏭 '+escHtml(it.supplier)+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(it.fileName)+'</div>'+
          '<div style="display:flex;gap:6px;margin-top:4px;">'+
            '<button class="reports-file-dl" onclick="event.stopPropagation();'+it.action+'" style="flex:1;">👁 Preview</button>'+
            '<button class="reports-file-dl" onclick="event.stopPropagation();'+it.dl+'" style="flex:1;">⬇ Download</button>'+
            '<button class="reports-file-del" onclick="event.stopPropagation();'+it.del+'">✕</button>'+
          '</div>'+
        '</div>'
      ).join('') + '</div>';
    } else {
      const grouped = {};
      items.forEach(it => {
        if (!grouped[it.supplier]) grouped[it.supplier] = [];
        grouped[it.supplier].push(it);
      });
      rows = '<div style="padding:10px 12px;">' + Object.keys(grouped).sort((a,b)=>a.localeCompare(b)).map(supplier => {
        const sKey = '__jm_sup__' + supplier;
        const sOpen = jobMixSupplierCollapsed[sKey] !== true;
        const files = grouped[supplier];
        const inner = sOpen ? files.map(it =>
          '<div class="reports-file-row" data-preview-id="'+escHtml(it.id)+'" tabindex="0" onclick="'+it.action+'" style="margin:0 0 0 10px;">'+
            '<span style="font-size:13px;">🧪</span>'+
            '<div class="reports-file-name" style="flex:1;">'+escHtml(it.name)+'</div>'+
            '<div class="reports-file-date">'+escHtml(it.mixCode)+'</div>'+
            '<button class="reports-file-dl" onclick="event.stopPropagation();'+it.action+'">👁</button>'+
            '<button class="reports-file-dl" onclick="event.stopPropagation();'+it.dl+'">⬇</button>'+
            '<button class="reports-file-del" onclick="event.stopPropagation();'+it.del+'">✕</button>'+
          '</div>'
        ).join('') : '';
        return '<div class="reports-folder" style="margin-bottom:8px;">'+
          '<div class="reports-folder-header" onclick="toggleJobMixSupplierStack(\''+supplier.replace(/'/g,"\\'")+'\')">'+
            '<span style="font-size:14px;">🏭</span>'+
            '<div class="reports-folder-name">'+escHtml(supplier)+'</div>'+
            '<div class="reports-folder-count">'+files.length+'</div>'+
            '<span style="color:var(--concrete-dim);font-size:12px;">'+(sOpen?'▲':'▼')+'</span>'+
          '</div>'+inner+
        '</div>';
      }).join('') + '</div>';
    }
  }

  _injectReportsPrintStyles();
  var _rplPrintBtn = '<button onclick="window.print()" class="rpt-no-print" style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;letter-spacing:.4px;white-space:nowrap;">🖨 Print / Save PDF</button>';
  var _rplSendBtn = tabId === 'reportsTwoWeek' ? '<button onclick="openSendLookaheadToForemenModal()" class="rpt-no-print" style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;letter-spacing:.4px;white-space:nowrap;">📤 Send to Foremen</button>' : '';
  var _rplExtraLeft = _rplSendBtn + _rplPrintBtn;
  listEl.innerHTML =
    '<div style="padding:12px 18px 10px;border-bottom:1px solid var(--asphalt-light);flex-shrink:0;display:flex;align-items:center;gap:10px;">'+
    '<span style="font-size:18px;">'+icon+'</span>'+
    '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1.5px;color:var(--white);">'+escHtml(title)+'</div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+items.length+' REPORT'+(items.length!==1?'S':'')+'</div></div>'+
    '<div style="margin-left:auto;display:flex;align-items:center;gap:6px;">'+_rplExtraLeft+(headerExtra||'')+'<button onclick="_rpBackToGallery()" class="rpt-no-print" style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:11px;padding:3px 10px;cursor:pointer;">← All Reports</button></div>'+
    '</div>'+
    '<div style="flex:1;overflow-y:auto;" id="_rpMainListRows">'+rows+'</div>';

  pane.appendChild(listEl);
}

function _renderDailyOrderCards(wrap) {
  var orders = (dailyOrders || []).slice();
  var total = orders.length;

  // Header strip
  var hdr = document.createElement('div');
  hdr.style.cssText = 'padding:12px 18px 10px;border-bottom:1px solid var(--asphalt-light);flex-shrink:0;display:flex;align-items:center;gap:10px;background:var(--asphalt);';
  _injectReportsPrintStyles();
  hdr.innerHTML =
    '<span style="font-size:18px;">📋</span>' +
    '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1.5px;color:var(--white);">Daily Orders & Foremen Reports</div>' +
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">' + total + ' DOCUMENT' + (total !== 1 ? 'S' : '') + '</div></div>' +
    '<div style="margin-left:auto;display:flex;align-items:center;gap:6px;">' +
    '<button onclick="exportDailyOrdersCSV()" class="rpt-no-print" style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;letter-spacing:.4px;">⬇ Export CSV</button>' +
    '<button onclick="window.print()" class="rpt-no-print" style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;letter-spacing:.4px;">🖨 Print / Save PDF</button>' +
    '<button onclick="_rpBackToGallery()" class="rpt-no-print" style="background:none;border:1px solid #444;border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;">← BACK</button>' +
    '</div>';
  wrap.appendChild(hdr);

  // Multi-delete toolbar
  if (orders.length > 0) {
    var multiBar = document.createElement('div');
    multiBar.id = '_doMultiBar';
    multiBar.style.cssText = 'padding:6px 18px;background:var(--asphalt-mid);border-bottom:1px solid var(--asphalt-light);display:flex;align-items:center;gap:10px;flex-shrink:0;';
    multiBar.innerHTML =
      '<label style="display:flex;align-items:center;gap:5px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);cursor:pointer;">' +
      '<input type="checkbox" id="_doSelectAll" onchange="_doToggleSelectAll(this.checked)" style="cursor:pointer;"> Select All</label>' +
      '<button id="_doDeleteSelected" onclick="_doDeleteSelected()" style="background:none;border:1px solid rgba(217,79,61,0.4);border-radius:3px;color:rgba(217,79,61,0.8);font-family:\'DM Mono\',monospace;font-size:9px;padding:3px 10px;cursor:pointer;">🗑 Delete Selected</button>' +
      '<span id="_doSelCount" style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);"></span>';
    wrap.appendChild(multiBar);
  }

  if (!orders.length) {
    var empty = document.createElement('div');
    empty.className = 'do-empty-state';
    empty.textContent = 'No daily orders yet. Generate one from the Schedule.';
    wrap.appendChild(empty);
    return;
  }

  // Group by foreman, then by date — pair daily orders with foreman reports
  var byForeman = {};
  var foremanOrder = [];
  orders.forEach(function(o) {
    var f = o.foreman || 'Unknown';
    if (!byForeman[f]) { byForeman[f] = {}; foremanOrder.push(f); }
    var dk = o.dateOfWork || o.dateKey || 'unknown';
    if (!byForeman[f][dk]) byForeman[f][dk] = { order: null, report: null };
    if (o.type === 'foreman_report') { byForeman[f][dk].report = o; }
    else { byForeman[f][dk].order = o; }
  });
  foremanOrder = foremanOrder.filter(function(v,i,a){ return a.indexOf(v)===i; }).sort();

  var board = document.createElement('div');
  board.className = 'do-board';

  foremanOrder.forEach(function(foreman) {
    var dateMap = byForeman[foreman];
    var dates = Object.keys(dateMap).sort().reverse();
    var activeDate = dates[0];
    var fKey = 'do_stack_' + foreman.replace(/\s+/g,'_').replace(/[^a-z0-9_]/gi,'');

    function _doFmtTab(dk) {
      var dt = new Date(dk + 'T12:00:00');
      if (isNaN(dt)) return dk;
      return ['SUN','MON','TUE','WED','THU','FRI','SAT'][dt.getDay()] + ' ' + (dt.getMonth()+1) + '/' + dt.getDate();
    }

    var tabsHtml = dates.map(function(dk) {
      var isActive = dk === activeDate;
      var entry = dateMap[dk];
      var hasBoth = entry.order && entry.report;
      var badge = hasBoth ? ' ✓' : '';
      return '<div class="do-tab' + (isActive ? ' active' : '') + '" ' +
        'onclick="_doSetActiveDate(\'' + fKey + '\',\'' + escHtml(dk) + '\')">' +
        escHtml(_doFmtTab(dk)) + badge + '</div>';
    }).join('');

    var cardsHtml = dates.map(function(dk) {
      var entry = dateMap[dk];
      var order = entry.order;
      var report = entry.report;
      var isActive = dk === activeDate;

      // Comparative analysis — ordered mix vs reported
      var analysisHtml = '';
      if (order || report) {
        var orderedMix = [];
        if (order && order.matItems && order.matItems.length) {
          order.matItems.forEach(function(m) {
            if (m.mix || m.desc) orderedMix.push({ mix: m.mix || m.desc || '', tons: m.tons || m.quantity || '' });
          });
        }
        if (orderedMix.length || report) {
          analysisHtml =
            '<div style="background:rgba(245,197,24,0.05);border-top:1px solid rgba(245,197,24,0.15);padding:8px 12px;">' +
            '<div style="font-family:\'DM Mono\',monospace;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--stripe);margin-bottom:5px;">📊 Mix Comparison</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:\'DM Mono\',monospace;font-size:10px;">' +
            '<div>' +
              '<div style="font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:#5ab4f5;margin-bottom:3px;">Ordered</div>' +
              (orderedMix.length
                ? orderedMix.map(function(m){ return '<div style="color:var(--white);">' + escHtml(m.mix) + (m.tons ? ' · <strong>' + escHtml(String(m.tons)) + 'T</strong>' : '') + '</div>'; }).join('')
                : '<div style="color:var(--concrete-dim);">No mix data</div>') +
            '</div>' +
            '<div>' +
              '<div style="font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:#7ecb8f;margin-bottom:3px;">Reported</div>' +
              (report
                ? '<div style="color:#7ecb8f;">✓ Report filed<br><span style="color:var(--concrete-dim);font-size:9px;">' + escHtml(report.fileName || '') + '</span></div>'
                : '<div style="color:rgba(217,79,61,0.8);">⚠ No report filed</div>') +
            '</div>' +
            '</div>' +
            '</div>';
        }
      }

      return '<div class="do-card' + (isActive ? ' active' : '') + '" id="docard_' + fKey + '_' + escHtml(dk) + '">' +
        // Foreman header bar
        '<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--asphalt-mid);border-bottom:1px solid var(--asphalt-light);">' +
          '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;" onclick="event.stopPropagation()">' +
            '<input type="checkbox" class="_doCheckbox" value="' + (order ? escHtml(order.id) : '') + ',' + (report ? escHtml(report.id) : '') + '" onchange="_doUpdateSelCount()" style="cursor:pointer;"></label>' +
          '<div style="font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;color:var(--white);flex:1;">' + escHtml(foreman) + '</div>' +
          (order && report
            ? '<span style="font-size:8px;background:rgba(126,203,143,0.15);color:#7ecb8f;border:1px solid rgba(126,203,143,0.3);border-radius:3px;padding:1px 6px;">✓ Complete</span>'
            : order
              ? '<span style="font-size:8px;background:rgba(90,180,245,0.1);color:#5ab4f5;border:1px solid rgba(90,180,245,0.3);border-radius:3px;padding:1px 6px;">Order Only</span>'
              : '<span style="font-size:8px;background:rgba(155,148,136,0.1);color:var(--concrete-dim);border:1px solid rgba(155,148,136,0.2);border-radius:3px;padding:1px 6px;">Report Only</span>') +
        '</div>' +
        // Split body
        '<div style="display:grid;grid-template-columns:1fr 1fr;">' +
          // Left: Daily Order
          '<div style="border-right:1px solid var(--asphalt-light);padding:10px 12px;">' +
            '<div style="font-family:\'DM Mono\',monospace;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#5ab4f5;margin-bottom:7px;">📄 Daily Order</div>' +
            (order
              ? '<div style="font-size:11px;font-weight:700;color:var(--white);margin-bottom:2px;">' + escHtml(order.gcName || order.jobName || '') + '</div>' +
                (order.jobNo ? '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--stripe);">#' + escHtml(order.jobNo) + '</div>' : '') +
                '<div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;">' +
                  '<button class="do-card-action-btn" onclick="event.stopPropagation();previewDailyOrder(\'' + order.id + '\')">👁 View</button>' +
                  '<button class="do-card-action-btn" onclick="event.stopPropagation();downloadDailyOrder(\'' + order.id + '\')">⬇ Download</button>' +
                  '<button class="do-card-del" onclick="event.stopPropagation();deleteDailyOrder(\'' + order.id + '\')" title="Delete order">✕</button>' +
                '</div>'
              : '<div style="color:var(--concrete-dim);font-size:10px;padding:4px 0;">No order for this date</div>') +
          '</div>' +
          // Right: Foreman Report
          '<div style="padding:10px 12px;">' +
            '<div style="font-family:\'DM Mono\',monospace;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7ecb8f;margin-bottom:7px;">📋 Foreman\'s Report</div>' +
            (report
              ? '<div style="font-size:11px;font-weight:700;color:var(--white);margin-bottom:2px;">' + escHtml(report.jobName || report.gcName || '') + '</div>' +
                (report.jobNo ? '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--stripe);">#' + escHtml(report.jobNo) + '</div>' : '') +
                '<div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;">' +
                  '<button class="do-card-action-btn" onclick="event.stopPropagation();previewDailyOrder(\'' + report.id + '\')">👁 View</button>' +
                  '<button class="do-card-action-btn" onclick="event.stopPropagation();downloadDailyOrder(\'' + report.id + '\')">⬇ Download</button>' +
                  '<button class="do-card-del" onclick="event.stopPropagation();deleteDailyOrder(\'' + report.id + '\')" title="Delete report">✕</button>' +
                '</div>'
              : '<div style="color:var(--concrete-dim);font-size:10px;padding:4px 0;">No report filed yet</div>') +
          '</div>' +
        '</div>' +
        analysisHtml +
      '</div>';
    }).join('');

    var rowHtml =
      '<div class="do-foreman-row">' +
        '<div class="do-stack">' +
          '<div class="do-tabs-row">' + tabsHtml + '</div>' +
          '<div class="do-cards-area" id="' + fKey + '_area">' + cardsHtml + '</div>' +
        '</div>' +
      '</div>';

    board.insertAdjacentHTML('beforeend', rowHtml);
  });

  wrap.appendChild(board);
}

function _doSetActive(fKey, orderId) {
  // Switch active tab + card for a stack
  var area = document.getElementById(fKey + '_area');
  if (!area) return;
  area.querySelectorAll('.do-card').forEach(function(c) { c.classList.remove('active'); });
  area.querySelectorAll('.do-tab').forEach(function(t) { t.classList.remove('active'); });
  var card = document.getElementById('docard_' + orderId);
  var tab  = document.getElementById('dotab_' + orderId);
  if (card) card.classList.add('active');
  if (tab)  tab.classList.add('active');
}

function _doSetActiveDate(fKey, dk) {
  var area = document.getElementById(fKey + '_area');
  if (!area) return;
  area.querySelectorAll('.do-card').forEach(function(c){ c.classList.remove('active'); });
  var card = document.getElementById('docard_' + fKey + '_' + dk);
  if (card) card.classList.add('active');
  var stack = area.closest('.do-stack');
  if (stack) {
    stack.querySelectorAll('.do-tab').forEach(function(t){ t.classList.remove('active'); });
    stack.querySelectorAll('.do-tab').forEach(function(t){
      if (t.getAttribute('onclick') && t.getAttribute('onclick').indexOf("'" + dk + "'") !== -1) {
        t.classList.add('active');
      }
    });
  }
}

function _doToggleSelectAll(checked) {
  document.querySelectorAll('._doCheckbox').forEach(function(cb){ cb.checked = checked; });
  _doUpdateSelCount();
}
function _doUpdateSelCount() {
  var n = document.querySelectorAll('._doCheckbox:checked').length;
  var el = document.getElementById('_doSelCount');
  if (el) el.textContent = n > 0 ? n + ' selected' : '';
}
function _doDeleteSelected() {
  var ids = Array.from(document.querySelectorAll('._doCheckbox:checked')).map(function(cb){ return cb.value; });
  if (!ids.length) { alert('Select at least one report to delete.'); return; }
  if (!confirm('Delete ' + ids.length + ' selected report(s)? This cannot be undone.')) return;
  dailyOrders = dailyOrders.filter(function(o){ return ids.indexOf(o.id) === -1; });
  localStorage.setItem(DAILY_ORDERS_KEY, JSON.stringify(dailyOrders.map(function(o){ return Object.assign({},o,{blob64:undefined}); })));
  _checkLocalStorageSize();
  try { if (typeof fbSet === 'function') fbSet('daily_orders', dailyOrders.map(function(o){ return Object.assign({},o,{blob64:undefined}); })); } catch(e) {}
  var cv = document.getElementById('_doCardView');
  if (cv) { cv.innerHTML = ''; _renderDailyOrderCards(cv); }
  else renderReports();
}

function _doToggleExpand(fKey) {
  var area = document.getElementById(fKey + '_area');
  if (!area) return;
  var btn = area.closest('.do-stack')?.querySelector('.do-expand-btn');
  if (area.classList.contains('expanded')) {
    area.classList.remove('expanded');
    area.querySelectorAll('.do-card').forEach(function(c) { c.classList.remove('active'); });
    // Re-activate first tab
    var firstTab = area.closest('.do-stack')?.querySelector('.do-tab');
    if (firstTab) firstTab.click();
    if (btn) btn.textContent = '↗ Expand';
  } else {
    area.classList.add('expanded');
    if (btn) btn.textContent = '↙ Collapse';
  }
}


function _renderCertifiedsFolder() {
  var certView = localStorage.getItem('dmc_cert_view') || 'date';
  var sorted = certifiedReports.slice().sort(function(a,b){ return (b.weekEnding||'').localeCompare(a.weekEnding||''); });
  var incomplete = sorted.filter(function(r){ return r.status==='incomplete'; }).length;

  var rows = '';
  if (!sorted.length) {
    rows = '<div style="padding:20px;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:12px;text-align:center;">No certified payroll reports yet.<br>They auto-generate when foreman reports are filed for MassDOT projects.</div>';
  } else if (certView === 'gc') {
    var byGC = {};
    sorted.forEach(function(r){ var k=r.gcName||'No GC'; if(!byGC[k])byGC[k]=[]; byGC[k].push(r); });
    Object.keys(byGC).sort().forEach(function(gc){
      rows += '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--concrete-dim);padding:8px 0 4px;border-top:1px solid var(--asphalt-light);margin-top:6px;">'+escHtml(gc)+'</div>';
      byGC[gc].forEach(function(r){ rows += _certReportRow(r); });
    });
  } else {
    sorted.forEach(function(r){ rows += _certReportRow(r); });
  }

  return '<div class="reports-folder-item" style="border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);margin-bottom:10px;overflow:hidden;">'+
    '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--asphalt-mid);cursor:pointer;border-bottom:1px solid var(--asphalt-light);" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'+
      '<span style="font-size:16px;">📋</span>'+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;letter-spacing:1px;color:var(--white);flex:1;">Certifieds</div>'+
      (incomplete>0?'<span style="font-family:\'DM Mono\',monospace;font-size:8px;font-weight:700;padding:2px 7px;border-radius:3px;background:rgba(245,197,24,0.15);color:var(--stripe);">'+incomplete+' PENDING</span>':'')+
      '<div style="display:flex;gap:4px;">'+
        '<button onclick="event.stopPropagation();localStorage.setItem(\'dmc_cert_view\',\'date\');renderReports();" style="padding:3px 8px;border:1px solid var(--asphalt-light);border-radius:var(--radius);background:'+(certView==='date'?'rgba(245,197,24,0.15)':'none')+';color:'+(certView==='date'?'var(--stripe)':'var(--concrete-dim)')+';font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;">By Date</button>'+
        '<button onclick="event.stopPropagation();localStorage.setItem(\'dmc_cert_view\',\'gc\');renderReports();" style="padding:3px 8px;border:1px solid var(--asphalt-light);border-radius:var(--radius);background:'+(certView==='gc'?'rgba(245,197,24,0.15)':'none')+';color:'+(certView==='gc'?'var(--stripe)':'var(--concrete-dim)')+';font-family:\'DM Mono\',monospace;font-size:8px;cursor:pointer;">By GC</button>'+
        '<button onclick="event.stopPropagation();openNewCertReport()" style="padding:3px 10px;border:none;border-radius:var(--radius);background:var(--stripe);color:#000;font-family:\'DM Mono\',monospace;font-size:8px;font-weight:700;cursor:pointer;">+ New</button>'+
      '</div>'+
    '</div>'+
    '<div style="padding:12px 16px;" class="cert-folder-wrap">'+rows+'</div>'+
  '</div>';
}

function _certReportRow(r) {
  var isComplete = r.status==='complete';
  return '<div class="cert-report-row" onclick="openCertReport(\''+r.id+'\')">'+
    '<div class="cert-report-date">'+escHtml(r.weekEnding||'')+'</div>'+
    '<div style="flex:1;overflow:hidden;">'+
      '<div class="cert-report-name">'+escHtml(r.projectName||'Unnamed Project')+'</div>'+
      '<div class="cert-report-gc">'+escHtml(r.gcName||'')+' · Week ending '+escHtml(r.weekEnding||'')+'</div>'+
    '</div>'+
    '<span class="cert-status-badge '+(isComplete?'cert-status-complete':'cert-status-incomplete')+'">'+
      (isComplete?'✓ COMPLETE':'PENDING')+
    '</span>'+
    '<button onclick="event.stopPropagation();deleteCertReport(\''+r.id+'\')" style="background:none;border:none;color:var(--concrete-dim);cursor:pointer;font-size:12px;padding:2px 4px;" title="Delete">✕</button>'+
  '</div>';
}

function deleteCertReport(id) {
  if (!confirm('Delete this certified report?')) return;
  certifiedReports = certifiedReports.filter(function(r){ return r.id!==id; });
  saveCertifiedReports();
  renderReports();
}

function openNewCertReport() {
  // Manual creation — opens a picker for job + week
  var jobs2 = backlogJobs.filter(function(j){ return _isMassDOT(j.awardingAuthority); });
  var opts = jobs2.length
    ? jobs2.map(function(j){ return '<option value="'+j.id+'">'+escHtml(j.num?'#'+j.num+' — ':'')+escHtml(j.name||'')+'</option>'; }).join('')
    : '<option value="">No MassDOT jobs in Job Directory</option>';
  var today = new Date().toISOString().slice(0,10);
  document.getElementById('certNewModal')?.remove();
  var m=document.createElement('div');
  m.id='certNewModal';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:5000;display:flex;align-items:center;justify-content:center;';
  m.innerHTML='<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px;max-width:420px;width:94%;">'+
    '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1px;color:var(--white);margin-bottom:16px;">New Certified Payroll Report</div>'+
    '<div style="display:flex;flex-direction:column;gap:10px;">'+
      '<div><label class="form-label">Job (MassDOT)</label><select class="form-input" id="certNewJob">'+opts+'</select></div>'+
      '<div><label class="form-label">Week Ending Date</label><input class="form-input" type="date" id="certNewWeek" value="'+today+'"/></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">'+
      '<button class="btn btn-ghost" onclick="document.getElementById(\'certNewModal\').remove()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="_certNewSubmit()">Create</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(m);
}

function _certNewSubmit() {
  var jobId = (document.getElementById('certNewJob')||{}).value||'';
  var week  = (document.getElementById('certNewWeek')||{}).value||'';
  if (!jobId||!week){alert('Select a job and week.');return;}
  document.getElementById('certNewModal')?.remove();
  var r = _getOrCreateCertReport(jobId, week);
  if(r) openCertReport(r.id);
  renderReports();
}

var _certActiveTab = 'p1';

function openCertReport(reportId) {
  var r = certifiedReports.find(function(x){ return x.id===reportId; });
  if (!r) return;
  document.getElementById('certOverlay')?.remove();
  _certActiveTab = 'p1';
  var util = _buildCertUtilization(r.jobId, r.weekEnding);

  var ov = document.createElement('div');
  ov.id = 'certOverlay';
  ov.className = 'cert-overlay';
  ov.innerHTML =
    '<div class="cert-panel">'+
      '<div class="cert-panel-header">'+
        '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--white);">📋 CERTIFIED PAYROLL — '+escHtml(r.projectName)+'</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Week Ending: '+escHtml(r.weekEnding)+'</div>'+
        '<div style="flex:1;"></div>'+
        (r.status!=='complete'?
          '<button onclick="_certMarkComplete(\''+r.id+'\')" style="padding:6px 14px;background:rgba(126,203,143,0.15);border:1px solid rgba(126,203,143,0.3);border-radius:var(--radius);color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:9px;font-weight:700;cursor:pointer;">✓ Mark Complete</button>':
          '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:#7ecb8f;font-weight:700;">✓ COMPLETE</span>'
        )+
        '<button onclick="_certPrintPage()" style="padding:6px 14px;background:var(--stripe);color:#000;border:none;border-radius:var(--radius);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;cursor:pointer;">🖨 Print</button>'+
        '<button onclick="document.getElementById(\'certOverlay\').remove()" style="padding:6px 12px;background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;">✕</button>'+
      '</div>'+
      '<div class="cert-tabs">'+
        ['p1','p2','p3','p4'].map(function(t){
          var labels={p1:'Page 1 — Statement of Compliance',p2:'Page 2 — Workforce Utilization',p3:'Page 3 — Minority/Female Employees',p4:'Page 4 — Payroll Upload'};
          return '<button class="cert-tab'+(_certActiveTab===t?' active':'')+'" onclick="switchCertTab(\''+r.id+'\',\''+t+'\')">'+labels[t]+'</button>';
        }).join('')+
      '</div>'+
      '<div class="cert-body" id="certBody">'+
        _certRenderPage(r, _certActiveTab, util)+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);
}

function _certMarkComplete(reportId) {
  var r = certifiedReports.find(function(x){ return x.id===reportId; });
  if (!r) return;
  if (!r.page4Uploaded) { alert('Page 4 (payroll Excel) must be uploaded before marking complete.'); return; }
  r.status = 'complete';
  saveCertifiedReports();
  document.getElementById('certOverlay')?.remove();
  openCertReport(reportId);
  renderReports();
}

function switchCertTab(reportId, tab) {
  _certActiveTab = tab;
  var r = certifiedReports.find(function(x){ return x.id===reportId; });
  if (!r) return;
  var util = _buildCertUtilization(r.jobId, r.weekEnding);
  document.querySelectorAll('.cert-tab').forEach(function(b){
    var isActive = b.textContent.includes({p1:'Statement',p2:'Workforce',p3:'Minority',p4:'Payroll'}[tab]||tab);
    b.classList.toggle('active', isActive);
  });
  var body = document.getElementById('certBody');
  if (body) body.innerHTML = _certRenderPage(r, tab, util);
}

function _certRenderPage(r, tab, util) {
  if (tab==='p1') return '<div class="cert-page">'+_certPage1HTML(r)+'</div>';
  if (tab==='p2') return '<div class="cert-page" style="width:11in;padding:0.4in;">'+_certPage2HTML(r, util)+'</div>';
  if (tab==='p3') return '<div class="cert-page">'+_certPage3HTML(r, util)+'</div>';
  if (tab==='p4') return _certPage4HTML(r);
  return '';
}

function _certPage1HTML(r) {
  var blank = function(w){ return '<span style="border-bottom:1px solid #000;min-width:'+(w||100)+'px;display:inline-block;">&nbsp;</span>'; };
  return '<div style="text-align:center;font-weight:bold;font-size:12px;margin-bottom:20px;">WEEKLY PAYROLL RECORDS REPORT<br>&amp; STATEMENT OF COMPLIANCE</div>'+
    '<p style="margin-bottom:10px;font-size:10px;">In accordance with Massachusetts General Law c149, §27B, a true and accurate record must be kept of all persons employed on the public works project for which the enclosed rates have been provided. A Payroll Form is available from the Department of Labor Standards (DLS) at www.mass.gov/dols/pw and includes all the information required to be kept by law. Every Contractor or subcontractor is required to keep these records and preserve them for a period of three years from the date of completion of the contract.</p>'+
    '<p style="margin-bottom:10px;font-size:10px;">On a weekly basis, every contractor and subcontractor is required to submit a certified copy of their weekly payroll records to the awarding authority; this includes the payroll forms and the Statement of Compliance form. The certified payroll records must be submitted either by regular mail or by e-mail to the awarding authority. Once collected, the awarding authority is required to preserve those records for three years from the date of completion of the project.</p>'+
    '<p style="margin-bottom:16px;font-size:10px;">Each such contractor and subcontractor shall furnish weekly and within 15 days after completion of its portion of work, to the awarding authority directly by first-class mail or e-mail, a statement, executed by the contractor, subcontractor or by any authorized officer thereof who supervised the payment of wages, this form, accompanied by their payroll:</p>'+
    '<div style="border:1px solid #000;padding:16px 20px;">'+
      '<div style="text-align:center;font-weight:bold;margin-bottom:16px;">STATEMENT OF COMPLIANCE</div>'+
      '<div style="text-align:center;margin-bottom:20px;">'+blank(200)+' Date of Work</div>'+
      '<div style="margin-bottom:8px;">I, &nbsp;&nbsp;&nbsp;&nbsp; <strong>DONALD J MARTIN JR</strong> &nbsp;&nbsp;&nbsp; , &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>PRESIDENT</strong></div>'+
      '<div style="margin-bottom:4px;padding-left:60px;font-size:10px;color:#555;">(Name of signatory party) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (Title)</div>'+
      '<p style="margin-bottom:12px;">do hereby state:</p>'+
      '<p style="margin-bottom:6px;">That I pay or supervise the payment of the persons employed by</p>'+
      '<div style="margin-bottom:4px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<strong>DON MARTIN CORPORATION</strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; on the &nbsp;&nbsp;&nbsp;&nbsp; '+blank(200)+'</div>'+
      '<div style="font-size:10px;color:#555;padding-left:60px;margin-bottom:8px;">(Contractor, subcontractor or public body) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (Building or project)</div>'+
      '<p style="margin-bottom:12px;font-size:10px;">and that all mechanics and apprentices, teamsters, chauffeurs and laborers employed on said project have been paid in accordance with wages determined under provisions of sections twenty-six and twenty-seven of chapter one hundred and forty nine of the General Laws.</p>'+
      '<div style="margin-bottom:6px;">Signature &nbsp;&nbsp; '+blank(300)+'</div>'+
      '<div>Title &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>PRESIDENT</strong></div>'+
    '</div>'+
    '<div style="text-align:right;font-size:9px;margin-top:6px;">05/14</div>';
}

function _certPage2HTML(r, util) {
  var esc2 = function(s){ return escHtml(s||''); };
  var fmtN = function(n){ return n>0?n.toFixed(1):'0'; };
  var pct  = function(part,total){ return total>0?(part/total*100).toFixed(1)+'%':'#DIV/0!'; };
  var CAT_KEYS = ['FOREMAN','OPERATOR','MECHANIC','LABORER','TRUCK DRIVER'];
  var wk = util ? util.weekAgg : {};
  var td = util ? util.totalAgg : {};

  // Totals row
  var totEmp=0,totWkHrs=0,totWkMin=0,totWkWom=0,totTdHrs=0,totTdMin=0,totTdWom=0;
  CAT_KEYS.forEach(function(k){
    var w=wk[k]||{emp:0,totalHrs:0,minHrs:0,womenHrs:0};
    var t=td[k]||{totalHrs:0,minHrs:0,womenHrs:0};
    totEmp+=w.emp; totWkHrs+=w.totalHrs; totWkMin+=w.minHrs; totWkWom+=w.womenHrs;
    totTdHrs+=t.totalHrs; totTdMin+=t.minHrs; totTdWom+=t.womenHrs;
  });

  var catRows = CAT_KEYS.map(function(k){
    var w=wk[k]||{emp:0,totalHrs:0,minHrs:0,womenHrs:0};
    var t=td[k]||{totalHrs:0,minHrs:0,womenHrs:0};
    return '<tr>'+
      '<td style="font-weight:bold;font-size:9px;">'+k+'</td>'+
      '<td style="text-align:center;">'+w.emp+'</td>'+
      '<td style="text-align:center;">'+fmtN(w.totalHrs)+'</td>'+
      '<td style="text-align:center;border-right:none;"></td>'+
      '<td style="text-align:center;border-left:none;"></td>'+
      '<td style="text-align:center;">'+fmtN(w.minHrs)+'</td>'+
      '<td style="text-align:center;">'+fmtN(w.womenHrs)+'</td>'+
      '<td style="text-align:center;">'+pct(w.minHrs,w.totalHrs)+'</td>'+
      '<td style="text-align:center;">'+pct(w.womenHrs,w.totalHrs)+'</td>'+
      '<td style="text-align:center;">'+fmtN(t.totalHrs)+'</td>'+
      '<td style="text-align:center;">'+fmtN(t.minHrs)+'</td>'+
      '<td style="text-align:center;">'+fmtN(t.womenHrs)+'</td>'+
      '<td style="text-align:center;">'+pct(t.minHrs,t.totalHrs)+'</td>'+
      '<td style="text-align:center;">'+pct(t.womenHrs,t.totalHrs)+'</td>'+
    '</tr>';
  }).join('');

  return '<div style="text-align:center;font-weight:bold;font-size:10px;margin-bottom:2px;">COMMONWEALTH OF MASSACHUSETTS</div>'+
    '<div style="text-align:center;font-weight:bold;font-size:10px;margin-bottom:10px;">CONTRACTOR\'S WEEKLY WORK FORCE UTILIZATION REPORT</div>'+
    '<table class="no-border" style="margin-bottom:6px;font-size:9px;">'+
      '<tr><td style="width:40%;font-weight:bold;">PROJECT NAME:</td><td style="border-bottom:1px solid #000;flex:1;">'+esc2(r.projectName)+'</td><td style="font-weight:bold;padding-left:10px;">CONTRACT NO.:</td><td style="border-bottom:1px solid #000;">'+esc2(r.contractNum)+'</td><td style="font-weight:bold;padding-left:10px;">MINORITY HIRING GOAL:</td><td style="border-bottom:1px solid #000;">'+esc2(r.minorityHiringGoal)+'</td></tr>'+
      '<tr><td style="font-weight:bold;">NAME OF GENERAL CONTRACTOR:</td><td style="border-bottom:1px solid #000;">'+esc2(r.gcName)+'</td><td></td><td></td><td style="font-weight:bold;padding-left:10px;">Tel No.:</td><td style="border-bottom:1px solid #000;"></td></tr>'+
      '<tr><td style="font-weight:bold;">NAME OF CONTRACTOR FILING REPORT</td><td colspan="2" style="border-bottom:1px solid #000;">DON MARTIN CORP. 475 SCHOOL ST, MARSHFIELD MA 02050</td><td></td><td style="font-weight:bold;padding-left:10px;">Tel. No.:</td><td style="border-bottom:1px solid #000;">781.834.0071</td></tr>'+
      '<tr><td style="font-weight:bold;">WEEK ENDING</td><td style="border-bottom:1px solid #000;">'+esc2(r.weekEnding)+'</td><td style="font-weight:bold;">Report No.:</td><td style="border-bottom:1px solid #000;">'+esc2(r.reportNum)+'</td><td style="font-weight:bold;padding-left:10px;">Date Work Began:</td><td style="border-bottom:1px solid #000;">'+esc2(r.dateWorkBegan)+'</td></tr>'+
      '<tr><td style="font-weight:bold;">Date Work Completed:</td><td style="border-bottom:1px solid #000;">'+esc2(r.dateWorkCompleted)+'</td><td style="font-weight:bold;">Report By:</td><td style="border-bottom:1px solid #000;">Donald J Martin JR</td><td style="font-weight:bold;padding-left:10px;">Title:</td><td style="border-bottom:1px solid #000;">President</td></tr>'+
    '</table>'+
    '<table style="font-size:8px;margin-bottom:8px;">'+
      '<thead>'+
        '<tr>'+
          '<th rowspan="3" style="width:90px;">JOB CATEGORY</th>'+
          '<th rowspan="3" style="width:35px;">Total # Emp</th>'+
          '<th rowspan="3" style="width:50px;">Total Weekly Work Force Hours</th>'+
          '<th colspan="2" style="width:60px;"># of</th>'+
          '<th colspan="2">Total Weekly Work Force Hours</th>'+
          '<th colspan="2">Weekly % Work Force Hours</th>'+
          '<th rowspan="3">Total Work Force Hours To Date</th>'+
          '<th colspan="2">Total Work Force Hours To Date</th>'+
          '<th colspan="2">% Workhours to Date</th>'+
        '</tr>'+
        '<tr>'+
          '<th>Min.</th><th>Women</th>'+
          '<th>Min.</th><th>Women</th>'+
          '<th>Min.</th><th>Women</th>'+
          '<th>Min.</th><th>Women</th>'+
          '<th>Min.</th><th>Women</th>'+
        '</tr>'+
      '</thead>'+
      '<tbody>'+catRows+
        '<tr style="font-weight:bold;border-top:2px solid #000;">'+
          '<td>TOTAL</td>'+
          '<td style="text-align:center;">'+totEmp+'</td>'+
          '<td style="text-align:center;">'+fmtN(totWkHrs)+'</td>'+
          '<td style="text-align:center;border-right:none;"></td><td style="text-align:center;border-left:none;"></td>'+
          '<td style="text-align:center;">'+fmtN(totWkMin)+'</td>'+
          '<td style="text-align:center;">'+fmtN(totWkWom)+'</td>'+
          '<td style="text-align:center;">'+pct(totWkMin,totWkHrs)+'</td>'+
          '<td style="text-align:center;">'+pct(totWkWom,totWkHrs)+'</td>'+
          '<td style="text-align:center;">'+fmtN(totTdHrs)+'</td>'+
          '<td style="text-align:center;">'+fmtN(totTdMin)+'</td>'+
          '<td style="text-align:center;">'+fmtN(totTdWom)+'</td>'+
          '<td style="text-align:center;">'+pct(totTdMin,totTdHrs)+'</td>'+
          '<td style="text-align:center;">'+pct(totTdWom,totTdHrs)+'</td>'+
        '</tr>'+
      '</tbody>'+
    '</table>'+
    '<p style="font-size:9px;margin-bottom:2px;">The willful falsification of the above statements may subject the Contractor or Subcontractor to civil or criminal prosecution.</p>'+
    '<p style="font-size:9px;">Report is due close of business Tuesday for the previous week.</p>';
}

function _certPage3HTML(r, util) {
  var allEmp = util ? util.allEmpList : [];
  var rows = allEmp.length ? allEmp.map(function(emp){
    return '<tr>'+
      '<td style="font-size:9px;">'+escHtml(emp.cat)+'</td>'+
      '<td style="font-size:9px;">'+escHtml(emp.name)+'</td>'+
      '<td style="text-align:center;font-size:9px;">'+emp.hrs.toFixed(1)+'</td>'+
      '<td></td>'+
      '<td style="font-size:9px;">'+escHtml(emp.race||'')+'</td>'+
    '</tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:#999;padding:12px;font-size:10px;">No employee data found for this week — file foreman reports for this project to populate automatically.</td></tr>';

  return '<div style="text-align:center;font-weight:bold;font-size:11px;margin-bottom:12px;">MINORITY/FEMALE EMPLOYEES REPORTED FOR WEEK</div>'+
    '<table>'+
      '<thead><tr>'+
        '<th style="width:100px;font-size:9px;">JOB CATEGORY</th>'+
        '<th style="font-size:9px;">EMPLOYEES NAME</th>'+
        '<th style="width:60px;font-size:9px;">HOURS</th>'+
        '<th style="width:140px;font-size:9px;">SOCIAL SECURITY NUMBER</th>'+
        '<th style="font-size:9px;">RACE</th>'+
      '</tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
    '</table>';
}

function _certPage4HTML(r) {
  if (r.page4Uploaded && r.page4File) {
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:30px;">'+
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px 24px;display:flex;align-items:center;gap:12px;max-width:400px;width:100%;">'+
        '<span style="font-size:24px;">📊</span>'+
        '<div style="flex:1;">'+
          '<div style="font-family:\'DM Sans\',sans-serif;font-size:13px;font-weight:600;color:var(--white);">'+escHtml(r.page4File.name||'Payroll File')+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Uploaded '+new Date(r.page4File.uploadedAt||'').toLocaleDateString()+'</div>'+
        '</div>'+
        '<button onclick="_certDeletePage4(\''+r.id+'\')" style="background:none;border:none;color:var(--concrete-dim);cursor:pointer;font-size:14px;">✕</button>'+
      '</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:#7ecb8f;font-weight:700;">✓ Page 4 on file — report can be marked complete</div>'+
    '</div>';
  }
  return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:40px;">'+
    '<div style="font-size:48px;">📊</div>'+
    '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1px;color:var(--white);">Upload Weekly Payroll Detail</div>'+
    '<div style="font-family:\'DM Sans\',sans-serif;font-size:13px;color:var(--concrete-dim);text-align:center;max-width:400px;">Import the Excel payroll file for this week. Once uploaded, the report can be marked complete.</div>'+
    '<label style="padding:12px 24px;background:rgba(245,197,24,0.1);border:1px dashed rgba(245,197,24,0.4);border-radius:var(--radius-lg);color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px;">'+
      '📎 UPLOAD EXCEL FILE'+
      '<input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="_certUploadPage4(\''+r.id+'\',this)">'+
    '</label>'+
  '</div>';
}

function _certUploadPage4(reportId, input) {
  var file = input.files[0];
  if (!file) return;
  var r = certifiedReports.find(function(x){ return x.id===reportId; });
  if (!r) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    r.page4Uploaded = true;
    r.page4File = { name: file.name, size: file.size, uploadedAt: new Date().toISOString(), dataUrl: ev.target.result };
    saveCertifiedReports();
    var body = document.getElementById('certBody');
    if (body) body.innerHTML = _certRenderPage(r, 'p4', null);
  };
  reader.readAsDataURL(file);
}

function _certDeletePage4(reportId) {
  var r = certifiedReports.find(function(x){ return x.id===reportId; });
  if (!r) return;
  r.page4Uploaded = false; r.page4File = null;
  saveCertifiedReports();
  var body = document.getElementById('certBody');
  if (body) body.innerHTML = _certRenderPage(r, 'p4', null);
}

function _certPrintPage() {
  var body = document.getElementById('certBody');
  if (!body) return;
  var inner = body.innerHTML;
  _openWin('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+
    'body{font-family:Times New Roman,serif;font-size:11px;color:#000;background:#fff;padding:0.5in 0.6in;margin:0;}'+
    'table{border-collapse:collapse;width:100%;}td,th{border:1px solid #000;padding:2px 4px;font-size:9px;}'+
    '.no-border td{border:none;}'+
    '@page{size:letter;margin:0.5in;}'+
    '</style></head><body>'+inner+'</body></html>',
    { w:1100, h:800, print:true, delay:350 });
}


// ── Reports gallery card click: show blank doc preview OR file list ────────
function _rpCardClick(tabId, previewType) {
  // For AIA, Chat — navigate away
  if (tabId === 'apAia' || tabId === 'chat') {
    switchTab(tabId);
    return;
  }
  // For file-list tabs: show list in main window
  if (tabId === 'reportsDailyOrders' || tabId === 'reportsTwoWeek' || tabId === 'reportsForemens' || tabId === 'reportsQC' || tabId === 'reportsJobMix' || tabId === 'reportsBlankForms') {
    window._activeReportsSubTab = tabId;
    // Update sidebar sub-tab highlight
    switchTab(tabId);
    return;
  }
  // Fallback
  switchTab(tabId);
}

function _rpBackToGallery() {
  document.getElementById('_rpMainList')?.remove();
  document.getElementById('_doCardView')?.remove();
  document.getElementById('frListWrap')?.remove();
  const bc = document.getElementById('reportsPreviewBreadcrumb');
  if (bc) bc.style.display = 'none';
  const g = document.getElementById('reportsGallery');
  if (g) g.style.display = 'flex';
  window._activeReportsSubTab = null;
  ['tabReportsDailyOrders','tabReportsTwoWeek','tabReportsForemens','tabReportsQC','tabReportsJobMix'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.style.background='var(--asphalt-mid)'; b.style.borderColor='var(--asphalt-light)'; b.style.color='var(--concrete-dim)'; }
  });
}


// ── Reports gallery: blank document preview HTML (GLOBAL scope) ──────────────
function _makeBlankDocPreview(type) {
  var base = 'font-family:Arial,sans-serif;background:#fff;color:#222;';
  var hdr  = '<div style="background:#1a1a1a;padding:8px 10px;display:flex;align-items:center;gap:6px;"><div style="font-size:9px;font-weight:900;letter-spacing:2px;color:#f5c518;">DMC PAVING</div></div>';
  var row  = function(label) { return '<tr><td style="padding:2px 3px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px 3px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px 3px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px 3px;border:1px solid #eee;">&nbsp;</td></tr>'; };
  var hr   = '<hr style="border:none;border-top:1px solid #ccc;margin:4px 0">';
  if (type === 'daily') return hdr +
    '<div style="' + base + 'padding:8px;font-size:8px;line-height:1.6;">' +
    '<b>DAILY ORDER</b><br>Date: ___________<br>Foreman: ___________<br>Job: ___________<br>Plant: ___________' + hr +
    '<b>Material</b><br>Mix Type: ___ Tons: ___' + hr +
    '<b>Trucking</b><br># Trucks: ___ Load Time: ___<br>Spacing: ___' + hr +
    '<b>Crew</b><br>Operators: ___________<br>Equipment: ___________' + hr +
    '<b>Notes:</b><br>___________</div>';
  if (type === 'lookahead') return hdr +
    '<div style="' + base + 'padding:8px;font-size:8px;line-height:1.6;">' +
    '<b>2 WEEK LOOK AHEAD</b><br>Week of: ___________<br>Supplier: ___________' + hr +
    '<table style="width:100%;font-size:7px;border-collapse:collapse;">' +
    '<tr style="background:#f5c518;"><th style="padding:2px 3px;border:1px solid #ccc;">Date</th><th style="padding:2px 3px;border:1px solid #ccc;">Job</th><th style="padding:2px 3px;border:1px solid #ccc;">Mix</th><th style="padding:2px 3px;border:1px solid #ccc;">Tons</th></tr>' +
    row() + row() + row() + row() + row() +
    '</table></div>';
  if (type === 'foreman') return hdr +
    '<div style="' + base + 'padding:8px;font-size:8px;line-height:1.6;">' +
    '<b>FOREMAN\'S REPORT</b><br>Date: ___________<br>GC: ___________<br>Job Name: ___________<br>Plant: ___________' + hr +
    '<b>Crew</b><br>Foreman: _____ Operators: _____' + hr +
    '<b>Mix Production</b><br>' +
    '<table style="width:100%;font-size:7px;border-collapse:collapse;">' +
    '<tr style="background:#f0f0f0;"><th style="padding:2px;border:1px solid #ccc;">Mix</th><th style="padding:2px;border:1px solid #ccc;">Ordered</th><th style="padding:2px;border:1px solid #ccc;">Actual</th></tr>' +
    '<tr><td style="padding:2px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px;border:1px solid #eee;">&nbsp;</td></tr>' +
    '<tr><td style="padding:2px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px;border:1px solid #eee;">&nbsp;</td><td style="padding:2px;border:1px solid #eee;">&nbsp;</td></tr>' +
    '</table>' + hr + '<b>Tack/Rubber:</b> ___ Gal: ___ Lin Ft: ___</div>';
  if (type === 'tack') return
    '<div style="background:#fff;padding:10px;font-family:Arial,sans-serif;font-size:8px;line-height:1.8;">' +
    '<div style="font-weight:900;font-size:9px;letter-spacing:1px;margin-bottom:6px;">DMC PAVING<br>475 SCHOOL ST · MARSHFIELD, MA · (781) 834-0071</div>' +
    '<hr style="border:none;border-top:2px solid #1a1a1a;margin:4px 0">' +
    '<b>DATE:</b> _____________  <b>JOB #:</b> _____________<br>' +
    '<b>JOB NAME:</b> _______________________________<br><br>' +
    '<b>MATERIAL:</b> TACK COAT<br><b>GALLONS:</b> _______________<br>' +
    '<b>MATERIAL:</b> HOT RUBBER<br><b>LINEAL FEET:</b> _______________<br><br>' +
    '<i style="font-size:7px;">THIS IS TO CERTIFY THAT THE PRODUCTS UNDER THIS TICKET NUMBER CONFORM TO THE SPECIFICATIONS REQUIRED FOR THE MATERIAL INDICATED.</i><br><br>' +
    '<b>ACCEPTED BY:</b> _______________<br><b>RECEIVED BY:</b> _______________  <b>TITLE:</b> ___</div>';
  if (type === 'qc') return hdr +
    '<div style="' + base + 'padding:8px;font-size:8px;line-height:1.6;">' +
    '<b>QC REPORT</b><br>Job: ___________<br>GC: ___________<br>Uploaded by: ___________' + hr +
    '<i style="font-size:7px;color:#888;">Attach QC documentation here</i></div>';
  if (type === 'dmc-order') {
    var col2 = function(){ return '<div><div style="color:#1a6b3c;font-weight:bold;font-size:6px;text-decoration:underline;margin-bottom:2px;">JOB INFORMATION:</div>'+'<div style="border-bottom:1px solid #000;height:7px;margin-bottom:2px;"></div>'.repeat(4)+'<div style="color:#1a6b3c;font-weight:bold;font-size:6px;text-decoration:underline;margin:2px 0;">MATERIALS:</div>'+'<div style="border-bottom:1px solid #000;height:7px;margin-bottom:2px;"></div>'.repeat(4)+'<div style="color:#1a6b3c;font-weight:bold;font-size:6px;text-decoration:underline;margin:2px 0;">TRUCKING:</div>'+'<div style="border-bottom:1px solid #000;height:7px;margin-bottom:2px;"></div>'.repeat(3)+'</div>'; };
    return '<div style="background:#fff;padding:7px;font-family:Arial,sans-serif;">'
      +'<div style="text-align:center;padding-bottom:5px;border-bottom:2px solid #ccc;margin-bottom:5px;">'
      +'<div style="font-size:9px;font-weight:900;letter-spacing:1px;"><span style="color:#c00">D</span>ON<span style="color:#333">MARTIN</span><span style="color:#c00">C</span>ORP</div>'
      +'<div style="font-size:6px;letter-spacing:2px;color:#666;">DMC</div></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">'+col2()+col2()+'</div></div>';
  }
  if (type === 'amrize-order') {
    var acol = function(){ return '<div><div style="font-weight:bold;font-size:6px;text-decoration:underline;margin-bottom:2px;">A. Job Information:</div>'+'<div style="border-bottom:1px solid #000;height:7px;margin-bottom:2px;"></div>'.repeat(3)+'<div style="font-weight:bold;font-size:6px;text-decoration:underline;margin:2px 0;">B. Materials:</div>'+'<div style="border-bottom:1px solid #000;height:7px;margin-bottom:2px;"></div>'.repeat(3)+'<div style="font-weight:bold;font-size:6px;text-decoration:underline;margin:2px 0;">C. Trucking:</div>'+'<div style="border-bottom:1px solid #000;height:7px;margin-bottom:2px;"></div>'.repeat(2)+'</div>'; };
    return '<div style="background:#fff;padding:7px;font-family:Arial,sans-serif;">'
      +'<div style="text-align:center;padding-bottom:4px;margin-bottom:4px;">'
      +'<div style="font-size:9px;font-weight:900;letter-spacing:1px;color:#1a5c8a;">AGGREGATE INDUSTRIES</div>'
      +'<div style="font-size:5.5px;color:#555;">NORTHEAST REGION, INC.</div>'
      +'<div style="font-size:6.5px;font-weight:bold;text-decoration:underline;margin-top:2px;">BITUMINOUS CONCRETE F.O.B. ORDER FORM</div></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-bottom:4px;border-bottom:1px solid #aaa;padding-bottom:3px;">'
      +'<div style="font-size:5.5px;">Date of Request: <span style="border-bottom:1px solid #000;display:inline-block;width:30px;"></span></div>'
      +'<div style="font-size:5.5px;">Date of Pick-Up: <span style="border-bottom:1px solid #000;display:inline-block;width:30px;"></span></div>'
      +'<div style="font-size:5.5px;"><b>Customer: DON MARTIN CORP</b></div>'
      +'<div style="font-size:5.5px;"><b>Customer #: DON MA</b></div></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">'+acol()+acol()+'</div>'
      +'<div style="text-align:center;font-size:5px;font-weight:bold;border-top:1px solid #000;padding-top:2px;margin-top:3px;">FAX THIS ORDER TO THE PAVING OPERATIONS OFFICE AT (978) 486-9268 BY 12:00PM</div>'
      +'</div>';
  }
  if (type === 'certified') {
    var blRow = function(label,val){ return '<tr><td style="border:1px solid #ccc;padding:3px 6px;font-size:9px;background:#f9f9f9;font-weight:bold;width:35%;">'+label+'</td><td style="border:1px solid #ccc;padding:3px 6px;font-size:9px;">'+(val||'&nbsp;')+'</td></tr>'; };
    var utilRow = function(cat){ return '<tr><td style="border:1px solid #ccc;padding:3px;font-size:8px;">'+cat+'</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td><td style="border:1px solid #ccc;padding:3px;font-size:8px;">&nbsp;</td></tr>'; };
    return '<div style="font-family:Arial,sans-serif;padding:30px 40px;color:#111;">'
      // Page 1 - Statement
      +'<div style="text-align:center;margin-bottom:16px;">'
      +'<div style="font-size:16px;font-weight:900;letter-spacing:1px;">DON MARTIN CORPORATION</div>'
      +'<div style="font-size:11px;">475 School St, Marshfield, MA 02050 · (781) 834-0071</div>'
      +'<div style="font-size:13px;font-weight:bold;margin-top:10px;text-decoration:underline;">STATEMENT OF COMPLIANCE — CERTIFIED PAYROLL</div>'
      +'</div>'
      +'<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">'
      +blRow('Project Name','')
      +blRow('Project Location','')
      +blRow('Awarding Authority','Massachusetts Department of Transportation')
      +blRow('Week Ending','')
      +blRow('Contractor','Don Martin Corporation')
      +blRow('License No.','')
      +'</table>'
      +'<div style="font-size:9px;line-height:1.7;margin-bottom:12px;">'
      +'The undersigned contractor hereby states: (a) That the payroll is correct and complete; that the wage rates contained therein are not less than those required by applicable law or the applicable contract; ...'
      +'</div>'
      +'<div style="display:flex;gap:40px;margin-top:20px;">'
      +'<div style="flex:1;border-top:1px solid #000;padding-top:4px;font-size:9px;">Authorized Signature</div>'
      +'<div style="flex:1;border-top:1px solid #000;padding-top:4px;font-size:9px;">Title</div>'
      +'<div style="flex:1;border-top:1px solid #000;padding-top:4px;font-size:9px;">Date</div>'
      +'</div>'
      +'<hr style="border:none;border-top:2px dashed #aaa;margin:30px 0;">'
      // Page 2 - Utilization
      +'<div style="font-size:13px;font-weight:bold;text-align:center;margin-bottom:12px;text-decoration:underline;">WORKFORCE UTILIZATION REPORT</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:8px;">'
      +'<tr style="background:#eee;"><th style="border:1px solid #ccc;padding:4px;">Category</th><th style="border:1px solid #ccc;padding:4px;">Total Employees</th><th style="border:1px solid #ccc;padding:4px;">Minority</th><th style="border:1px solid #ccc;padding:4px;">Female</th><th style="border:1px solid #ccc;padding:4px;">Hrs This Week</th><th style="border:1px solid #ccc;padding:4px;">Min Hrs Wk</th><th style="border:1px solid #ccc;padding:4px;">Female Hrs Wk</th><th style="border:1px solid #ccc;padding:4px;">Hrs to Date</th><th style="border:1px solid #ccc;padding:4px;">Min Hrs YTD</th><th style="border:1px solid #ccc;padding:4px;">Female Hrs YTD</th></tr>'
      +utilRow('FOREMAN')+utilRow('OPERATOR')+utilRow('MECHANIC')+utilRow('LABORER')+utilRow('TRUCK DRIVER')
      +'</table>'
      +'<hr style="border:none;border-top:2px dashed #aaa;margin:30px 0;">'
      // Page 3
      +'<div style="font-size:13px;font-weight:bold;text-align:center;margin-bottom:12px;text-decoration:underline;">WORKFORCE REPORTED THIS WEEK</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:8px;">'
      +'<tr style="background:#eee;"><th style="border:1px solid #ccc;padding:4px;">Employee Name</th><th style="border:1px solid #ccc;padding:4px;">Category</th><th style="border:1px solid #ccc;padding:4px;">Race/Ethnicity</th><th style="border:1px solid #ccc;padding:4px;">Minority</th><th style="border:1px solid #ccc;padding:4px;">Female</th><th style="border:1px solid #ccc;padding:4px;">Hours</th></tr>'
      +'<tr><td style="border:1px solid #eee;padding:3px;">&nbsp;</td><td style="border:1px solid #eee;padding:3px;">&nbsp;</td><td style="border:1px solid #eee;padding:3px;">&nbsp;</td><td style="border:1px solid #eee;padding:3px;">&nbsp;</td><td style="border:1px solid #eee;padding:3px;">&nbsp;</td><td style="border:1px solid #eee;padding:3px;">&nbsp;</td></tr>'.repeat(8)
      +'</table>'
      +'</div>';
  }
  return hdr + '<div style="' + base + 'padding:8px;font-size:8px;"><i>Document preview</i></div>';
}


// ── Reports gallery: blank report full-screen preview ───────────────────────────
function openBlankReportPreview(previewType) {
  document.getElementById('_rpBlankPreviewOverlay')?.remove();

  // Route document types that have real form builders to those builders
  if (previewType === 'daily') {
    document.getElementById('_rpBlankPreviewOverlay')?.remove();
    var dg = document.createElement('div');
    dg.id = '_rpBlankPreviewOverlay';
    dg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:5500;display:flex;align-items:center;justify-content:center;';
    dg.innerHTML = '<div style="background:var(--asphalt-mid);border:2px solid var(--asphalt-light);border-radius:10px;padding:28px 32px;min-width:320px;text-align:center;">' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:2px;color:var(--stripe);margin-bottom:6px;">Daily Order Preview</div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);margin-bottom:20px;">Choose form type to preview</div>' +
      '<div style="display:flex;gap:12px;justify-content:center;margin-bottom:16px;">' +
        '<button onclick="document.getElementById(\'_rpBlankPreviewOverlay\').remove();previewBlankOrderForm(\'dmc\')" style="flex:1;padding:14px 10px;background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.4);border-radius:var(--radius);color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:11px;cursor:pointer;font-weight:700;">🟡 DMC Order Form</button>' +
        '<button onclick="document.getElementById(\'_rpBlankPreviewOverlay\').remove();previewBlankOrderForm(\'amrize\')" style="flex:1;padding:14px 10px;background:rgba(26,92,138,0.15);border:1px solid rgba(26,92,138,0.4);border-radius:var(--radius);color:#5ab4f5;font-family:\'DM Mono\',monospace;font-size:11px;cursor:pointer;font-weight:700;">🔵 Amrize Form</button>' +
      '</div>' +
      '<button onclick="document.getElementById(\'_rpBlankPreviewOverlay\').remove()" style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:6px 18px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;">Cancel</button>' +
    '</div>';
    document.body.appendChild(dg);
    return;
  }
  if (previewType === 'tack') {
    // Intercept _openWin to capture AIA form HTML instead of opening new window
    var _origOpenWin = window._openWin;
    var _capturedHtml = null;
    var _prevState = _aiaState;
    _aiaState = { lineItems:[], hasLA:false, la:{basePriceQuoted:0,periodPrice:0,fuelVariance:0,fuelTon:0,rows:[]}, jobCost:{tonsBudget:0,laborBudget:0,materialBudget:0,truckingBudget:0,subBudget:0,tonsThisReq:0,laborActual:0,materialActual:0,truckingActual:0,rentalActual:0,subActual:0}, changeOrders:0, retainagePct:0, dmcJobNo:'', status:'draft', backlogJobId:null, editId:null };
    window._openWin = function(h){ _capturedHtml = h; };
    try { _aiaPrint(null); } catch(e) {}
    window._openWin = _origOpenWin;
    _aiaState = _prevState;
    if (_capturedHtml) {
      document.getElementById('_rpBlankPreviewOverlay')?.remove();
      const ov = document.createElement('div');
      ov.id = '_rpBlankPreviewOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:5500;display:flex;flex-direction:column;overflow:hidden;';
      ov.innerHTML = '<div style="flex-shrink:0;background:var(--asphalt-mid);border-bottom:1px solid var(--asphalt-light);padding:10px 20px;display:flex;align-items:center;gap:12px;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;color:var(--stripe);">BLANK FORM PREVIEW</div><div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);letter-spacing:1px;text-transform:uppercase;">AIA Requisition</div><div style="flex:1;"></div><button onclick="document.getElementById(\'_rpBlankPreviewOverlay\').remove()" style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:5px 14px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;letter-spacing:.5px;">✕ Close</button></div><div style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:24px;background:#555;"><iframe style="width:8.5in;min-height:11in;border:none;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,0.6);" id="_rpBlankIframe"></iframe></div>';
      document.body.appendChild(ov);
      setTimeout(function(){ var f=document.getElementById('_rpBlankIframe'); if(f){ f.contentDocument.open(); f.contentDocument.write(_capturedHtml); f.contentDocument.close(); } }, 50);
    }
    return;
  }
  if (previewType === 'dmc-order') { previewBlankOrderForm('dmc'); return; }
  if (previewType === 'amrize-order') { previewBlankOrderForm('amrize'); return; }

  const typeLabels = {
    'lookahead':"2-Week Lookahead",'foreman':"Foreman's Report",
    'qc':'QC Report','jobmix':'Job Mix Formula','tack':'AIA Requisition',
    'certified':'Certified Payroll'
  };
  const label = typeLabels[previewType] || previewType;

  // Build preview HTML — use real blank builders where available
  var previewHtml = '';
  if (previewType === 'lookahead') {
    // Build a real blank lookahead with today as the start date
    try {
      var today = new Date();
      var blankLa = { supplier:'', num:1, dateRange:'', createdAt:'', htmlContent: null };
      previewHtml = buildLookaheadHTML({}, today, null);
    } catch(e) {
      previewHtml = '<div style="padding:40px;font-family:Arial,sans-serif;text-align:center;color:#888;">Lookahead preview not available — generate one from the Schedule tab first.</div>';
    }
  } else if (previewType === 'foreman') {
    try {
      previewHtml = buildForemanReportHTML({});
    } catch(e) {
      previewHtml = _makeBlankDocPreview('foreman');
    }
  } else {
    previewHtml = _makeBlankDocPreview(previewType);
  }

  const ov = document.createElement('div');
  ov.id = '_rpBlankPreviewOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:5500;display:flex;flex-direction:column;overflow:hidden;';

  const isIframe = (previewType === 'lookahead' || previewType === 'foreman');
  const contentHtml = isIframe
    ? `<iframe style="width:8.5in;min-height:11in;border:none;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,0.6);" id="_rpBlankIframe"></iframe>`
    : `<div style="background:#fff;min-width:8.5in;max-width:8.5in;min-height:11in;box-shadow:0 8px 40px rgba(0,0,0,0.6);">${previewHtml}</div>`;

  ov.innerHTML = `
    <div style="flex-shrink:0;background:var(--asphalt-mid);border-bottom:1px solid var(--asphalt-light);padding:10px 20px;display:flex;align-items:center;gap:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:var(--stripe);">BLANK FORM PREVIEW</div>
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--concrete-dim);letter-spacing:1px;text-transform:uppercase;">${label}</div>
      <div style="flex:1;"></div>
      <button onclick="document.getElementById('_rpBlankPreviewOverlay').remove()"
        style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:5px 14px;color:var(--concrete-dim);font-family:'DM Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:.5px;">✕ Close</button>
    </div>
    <div style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:24px;background:#555;">
      ${contentHtml}
    </div>`;
  document.body.appendChild(ov);
  if (isIframe) {
    setTimeout(function() {
      var iframe = document.getElementById('_rpBlankIframe');
      if (iframe) iframe.srcdoc = previewHtml;
    }, 30);
  }
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

var QC_REPORTS_KEY = 'pavescope_qc_reports';
// Shape: [{ id, jobName, jobNo, gcName, fileName, fileType, fileData(base64), uploadedBy, uploadedAt, note }]
var qcReports = JSON.parse(localStorage.getItem(QC_REPORTS_KEY) || '[]');
var qcView = 'list'; // 'list' or 'gc'
var qcFolderState = {}; // { key: bool collapsed }

function saveQCReports() {
  // Strip any legacy base64 fileData — files now in Firebase Storage
  const slim = qcReports.map(r => {
    const { fileData, ...rest } = r;
    return rest;
  });
  localStorage.setItem(QC_REPORTS_KEY, JSON.stringify(slim));
  _checkLocalStorageSize();
  try { if (db) fbSet('qc_reports', slim); } catch(e) { _logFbError('saveQCReports', e); }
}

function renderQCReports() {
  const wrap = document.getElementById('qcReportsView');
  if (!wrap) return;
  _injectReportsPrintStyles();
  const canManage = canManageQC();

  const content = qcView === 'gc' ? renderQCByGC() : renderQCList();

  wrap.innerHTML = `
    <div class="qc-wrap">
      <div class="qc-header">
        <div class="qc-title">🔬 QC Reports</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button onclick="window.print()" class="rpt-no-print" style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:'DM Mono',monospace;font-size:9px;padding:4px 10px;cursor:pointer;letter-spacing:.4px;white-space:nowrap;">🖨 Print / Save PDF</button>
          ${canManage ? `<button class="btn btn-primary btn-sm" onclick="openQCJobModal()" style="white-space:nowrap;">+ New QC Job</button>` : ''}
          <div class="qc-view-toggle">
            <button class="qc-toggle-btn ${qcView==='list'?'active':''}" onclick="setQCView('list')">≡ List</button>
            <button class="qc-toggle-btn ${qcView==='gc'?'active':''}" onclick="setQCView('gc')">🏢 By GC</button>
          </div>
        </div>
      </div>
      <div class="qc-scroll">
        ${content}
      </div>
    </div>`;
}

function setQCView(v) { qcView = v; renderQCReports(); }

function renderQCList() {
  if (!qcReports.length) return '<div style="padding:24px;text-align:center;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:13px;">No QC Reports uploaded yet.</div>';
  // Group by job
  const byJob = {};
  [...qcReports].sort((a,b) => b.uploadedAt - a.uploadedAt).forEach(r => {
    const k = r.jobName || r.jobNo || 'Unassigned';
    if (!byJob[k]) byJob[k] = [];
    byJob[k].push(r);
  });
  return Object.keys(byJob).sort().map(job => {
    const files = byJob[job];
    const isOpen = qcFolderState[job] !== true;
    const rows = isOpen ? files.map(r => qcFileRow(r)).join('') : '';
    return `<div class="qc-job-section">
      <div class="qc-job-header" onclick="qcToggleFolder('${escHtml(job)}')">
        <span style="font-size:15px;">📁</span>
        <div class="qc-job-name">${escHtml(job)}</div>
        <div class="qc-job-count">${files.length} file${files.length!==1?'s':''}</div>
        <span style="color:var(--concrete-dim);font-size:11px;">${isOpen?'▲':'▼'}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');
}

function renderQCByGC() {
  if (!qcReports.length) return '<div style="padding:24px;text-align:center;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:13px;">No QC Reports uploaded yet.</div>';
  const byGC = {};
  qcReports.forEach(r => {
    const gc = r.gcName || (r.jobName ? r.jobName.split(' — ')[0] : 'Unknown GC');
    if (!byGC[gc]) byGC[gc] = {};
    const job = r.jobName || r.jobNo || 'Unassigned';
    if (!byGC[gc][job]) byGC[gc][job] = [];
    byGC[gc][job].push(r);
  });
  return Object.keys(byGC).sort().map(gc => {
    const gcKey = '__gc__' + gc;
    const isOpen = qcFolderState[gcKey] !== true;
    const jobSections = isOpen ? Object.keys(byGC[gc]).sort().map(job => {
      const jobKey = '__gc_job__' + gc + job;
      const isJobOpen = qcFolderState[jobKey] !== true;
      const files = byGC[gc][job];
      const rows = isJobOpen ? files.map(r => qcFileRow(r)).join('') : '';
      return `<div class="qc-job-section" style="margin:0 0 0 20px;border-radius:0;border-left:none;border-right:none;border-top:none;">
        <div class="qc-job-header" style="padding:8px 14px 8px 30px;" onclick="qcToggleFolder('${escHtml(jobKey)}')">
          <span style="font-size:13px;">📂</span>
          <div class="qc-job-name" style="font-size:12px;">${escHtml(job)}</div>
          <div class="qc-job-count">${files.length} file${files.length!==1?'s':''}</div>
          <span style="color:var(--concrete-dim);font-size:11px;">${isJobOpen?'▲':'▼'}</span>
        </div>${rows}
      </div>`;
    }).join('') : '';
    const total = Object.values(byGC[gc]).reduce((s,a)=>s+a.length,0);
    return `<div class="qc-gc-card">
      <div class="qc-gc-header" onclick="qcToggleFolder('${escHtml(gcKey)}')">
        <span style="font-size:16px;">🏢</span>
        <div class="qc-gc-name">${escHtml(gc)}</div>
        <div class="qc-job-count" style="margin-right:4px;">${total} file${total!==1?'s':''}</div>
        <span style="color:var(--concrete-dim);font-size:11px;">${isOpen?'▲':'▼'}</span>
      </div>${jobSections}
    </div>`;
  }).join('');
}

function qcFileRow(r) {
  const canManage = canManageQC();
  const icon = r.fileType?.startsWith('image') ? '🖼️' : '📄';
  return `<div class="qc-file-row">
    <span style="font-size:13px;">${icon}</span>
    <div class="qc-file-name" onclick="previewQCReport('${r.id}')" title="${escHtml(r.fileName)}">${escHtml(r.fileName)}</div>
    ${r.note ? `<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;" title="${escHtml(r.note)}">${escHtml(r.note)}</div>` : ''}
    <div class="qc-file-date">${new Date(r.uploadedAt).toLocaleDateString()}</div>
    <button class="qc-file-btn" onclick="previewQCReport('${r.id}')">👁 Preview</button>
    <button class="qc-file-btn" onclick="downloadQCReport('${r.id}')">⬇ DL</button>
    ${canManage ? `<button class="qc-file-del" onclick="deleteQCReport('${r.id}')" title="Delete">✕</button>` : ''}
  </div>`;
}

function qcToggleFolder(key) {
  qcFolderState[key] = !qcFolderState[key];
  renderQCReports();
}

// ── Upload handling ──────────────────────────────────────────────────────────
function qcHandleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  qcHandleFiles(e.dataTransfer.files);
}

function qcHandleFiles(files) {
  if (!canManageQC()) return;
  const arr = Array.from(files);
  if (!arr.length) return;
  // If no job info drafted yet, go through step 1 first, carrying files through
  if (!_qcJobDraft.jobName) {
    _qcJobDraft._pendingFiles = arr;
    openQCJobModal();
  } else {
    openQCUploadModal(arr);
  }
}

// ── QC Job modal — Step 1: Job Info ─────────────────────────────────────────
// Shared state for the two-step flow
var _qcJobDraft = { jobName:'', jobNo:'', gcName:'', location:'', notes:'' };

function openQCJobModal(prefillJobId) {
  document.getElementById('qcJobModal')?.remove();
  // Build backlog job picker options
  const blOpts = backlogJobs.length
    ? backlogJobs.map((j,i) => `<option value="${i}">${escHtml(j.num ? j.num+' — '+j.name : j.name)}${j.gc?' ('+escHtml(j.gc)+')':''}</option>`).join('')
    : '';

  // Prefill from prefill job if provided
  let pf = _qcJobDraft;
  if (prefillJobId) {
    const blj = backlogJobs.find(j => j.id === prefillJobId);
    if (blj) pf = { jobName: (blj.gc && blj.name ? blj.gc + ' — ' + blj.name : blj.name||''), jobNo: blj.num||'', gcName: blj.gc||'', location: blj.location||'', notes: '' };
  }

  const overlay = document.createElement('div');
  overlay.id = 'qcJobModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9500;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">🔬 New QC Job</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:18px;">Step 1 of 2 — Job Information</div>

      ${blOpts ? `
      <div style="margin-bottom:16px;padding:12px 14px;background:rgba(245,197,24,0.06);border:1px solid rgba(245,197,24,0.2);border-radius:var(--radius);">
        <label style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--stripe);display:block;margin-bottom:6px;">📋 Populate from Backlog Job</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="qcBlPicker" class="form-input" style="flex:1;cursor:pointer;" onchange="qcFillFromBacklog(this)">
            <option value="">— Select a backlog job —</option>
            ${blOpts}
          </select>
          <button onclick="qcFillFromBacklog(document.getElementById('qcBlPicker'))" class="btn btn-ghost btn-sm">Fill</button>
        </div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div style="grid-column:1/-1;">
          <label class="form-label">Job Name *</label>
          <input class="form-input" id="qcModalJobName" placeholder="e.g. Granite State — Route 3" value="${escHtml(pf.jobName)}" style="width:100%;" />
        </div>
        <div>
          <label class="form-label">Job #</label>
          <input class="form-input" id="qcModalJobNo" placeholder="e.g. 2025-042" value="${escHtml(pf.jobNo)}" style="width:100%;" />
        </div>
        <div>
          <label class="form-label">GC / Client</label>
          <input class="form-input" id="qcModalGcName" placeholder="e.g. Granite State Paving" value="${escHtml(pf.gcName)}" style="width:100%;" />
        </div>
        <div style="grid-column:1/-1;">
          <label class="form-label">Location / Address</label>
          <input class="form-input" id="qcModalLocation" placeholder="e.g. Route 3, Concord NH" value="${escHtml(pf.location||'')}" style="width:100%;" />
        </div>
        <div style="grid-column:1/-1;">
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="qcModalNotes" rows="2" placeholder="Additional notes…" style="width:100%;resize:vertical;">${escHtml(pf.notes||'')}</textarea>
        </div>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
        <button onclick="document.getElementById('qcJobModal').remove()" class="btn btn-ghost btn-sm">Cancel</button>
        <button onclick="qcJobModalNext()" class="btn btn-primary btn-sm">Next — Upload Files →</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function qcFillFromBacklog(sel) {
  const idx = parseInt(sel.value);
  if (isNaN(idx) || idx < 0 || idx >= backlogJobs.length) return;
  const blj = backlogJobs[idx];
  const jobName = (blj.gc && blj.name) ? blj.gc + ' — ' + blj.name : (blj.name||'');
  const inp = n => document.getElementById(n);
  if (inp('qcModalJobName')) inp('qcModalJobName').value = jobName;
  if (inp('qcModalJobNo'))   inp('qcModalJobNo').value   = blj.num||'';
  if (inp('qcModalGcName'))  inp('qcModalGcName').value  = blj.gc||'';
  if (inp('qcModalLocation'))inp('qcModalLocation').value = blj.location||'';
  // Flash confirmation
  sel.style.borderColor = 'var(--stripe)';
  setTimeout(() => sel.style.borderColor = '', 600);
}

function qcJobModalNext() {
  const jobName = document.getElementById('qcModalJobName')?.value.trim();
  if (!jobName) { document.getElementById('qcModalJobName')?.focus(); return; }
  // Save draft
  _qcJobDraft = {
    jobName,
    jobNo:    document.getElementById('qcModalJobNo')?.value.trim()    || '',
    gcName:   document.getElementById('qcModalGcName')?.value.trim()   || '',
    location: document.getElementById('qcModalLocation')?.value.trim() || '',
    notes:    document.getElementById('qcModalNotes')?.value.trim()    || '',
  };
  document.getElementById('qcJobModal')?.remove();
  openQCUploadModal([]);  // open step 2 with no pre-selected files
}

// ── QC Job modal — Step 2: File Upload ───────────────────────────────────────
function openQCUploadModal(files) {
  document.getElementById('qcUploadModal')?.remove();
  const hasFiles = files && files.length > 0;
  const d = _qcJobDraft;

  const modal = document.createElement('div');
  modal.id = 'qcUploadModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9500;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:24px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.8);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--white);margin-bottom:4px;">📎 Upload QC Report</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:14px;">Step 2 of 2 — Attach Files</div>

      <!-- Job summary card -->
      <div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--white);">${escHtml(d.jobName)}</div>
          <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:2px;">${[d.jobNo, d.gcName, d.location].filter(Boolean).join(' · ')}</div>
          ${d.notes ? `<div style="font-size:10px;color:var(--concrete-dim);margin-top:3px;">${escHtml(d.notes)}</div>` : ''}
        </div>
        <button onclick="document.getElementById('qcUploadModal').remove();openQCJobModal()" class="btn btn-ghost btn-sm" style="flex-shrink:0;font-size:10px;">✎ Edit</button>
      </div>

      <!-- File drop zone -->
      <div id="qcStep2DropZone" style="border:2px dashed var(--asphalt-light);border-radius:var(--radius);padding:20px;text-align:center;cursor:pointer;transition:all 0.15s;margin-bottom:10px;position:relative;"
        ondragover="event.preventDefault();this.style.borderColor='var(--stripe)';this.style.background='rgba(245,197,24,0.04)'"
        ondragleave="this.style.borderColor='var(--asphalt-light)';this.style.background=''"
        ondrop="event.preventDefault();this.style.borderColor='var(--asphalt-light)';this.style.background='';qcStep2HandleDrop(event)">
        <input type="file" id="qcStep2FileInput" multiple accept=".pdf,.doc,.docx,image/*"
          style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;"
          onchange="qcStep2HandleFiles(this.files)" />
        <div style="font-size:28px;margin-bottom:6px;">📎</div>
        <div style="font-size:12px;color:var(--concrete-dim);">Drop files here or <strong style="color:var(--stripe);">click to browse</strong></div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);margin-top:4px;">PDF · Word · Images</div>
      </div>

      <!-- Per-file note input list -->
      <div id="qcStep2FileList" style="margin-bottom:12px;"></div>

      <div style="margin-bottom:14px;">
        <label class="form-label">Report Note (applies to all files)</label>
        <input class="form-input" id="qcStep2Note" placeholder="e.g. Day 1 surface cores, Station 0+00 to 5+00" style="width:100%;" />
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('qcUploadModal').remove()" class="btn btn-ghost btn-sm">Cancel</button>
        <button onclick="qcDoUpload()" class="btn btn-primary btn-sm" id="qcStep2UploadBtn" disabled style="opacity:0.4;">⬆ Upload</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal._files = [];
  document.body.appendChild(modal);

  // If files were passed in (from drag-drop on old zone), load them
  if (hasFiles) qcStep2HandleFiles(files);
}

function qcStep2HandleDrop(e) {
  qcStep2HandleFiles(e.dataTransfer.files);
}

function qcStep2HandleFiles(fileList) {
  const modal = document.getElementById('qcUploadModal');
  if (!modal) return;
  const arr = Array.from(fileList);
  if (!arr.length) return;
  // Append to existing
  modal._files = [...(modal._files||[]), ...arr];
  _renderQcStep2FileList(modal._files);
  const btn = document.getElementById('qcStep2UploadBtn');
  if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  // Reset input
  const inp = document.getElementById('qcStep2FileInput');
  if (inp) inp.value = '';
}

function _renderQcStep2FileList(files) {
  const el = document.getElementById('qcStep2FileList');
  if (!el) return;
  if (!files.length) { el.innerHTML = ''; return; }
  el.innerHTML = files.map((f, i) => {
    const isPdf  = f.type === 'application/pdf';
    const isImg  = f.type && f.type.startsWith('image/');
    const isDocx = /\.docx?$/i.test(f.name);
    const icon   = isPdf ? '📄' : isImg ? '🖼️' : isDocx ? '📝' : '📎';
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);margin-bottom:6px;">
      <span style="font-size:16px;flex-shrink:0;">${icon}</span>
      <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--white);" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
      <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--concrete-dim);flex-shrink:0;">${Math.round(f.size/1024)}KB</span>
      <button onclick="qcStep2RemoveFile(${i})" style="background:none;border:none;color:var(--concrete-dim);cursor:pointer;font-size:13px;padding:0 2px;flex-shrink:0;" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function qcStep2RemoveFile(idx) {
  const modal = document.getElementById('qcUploadModal');
  if (!modal) return;
  modal._files.splice(idx, 1);
  _renderQcStep2FileList(modal._files);
  const btn = document.getElementById('qcStep2UploadBtn');
  if (btn) { btn.disabled = !modal._files.length; btn.style.opacity = modal._files.length ? '' : '0.4'; }
}

async function qcDoUpload() {
  const modal = document.getElementById('qcUploadModal');
  if (!modal) return;
  const files = modal._files || [];
  if (!files.length) { alert('Please select at least one file to upload.'); return; }
  const d = _qcJobDraft;
  const jobName = d.jobName || '';
  const jobNo   = d.jobNo   || '';
  const gcName  = d.gcName  || (jobName.includes(' — ') ? jobName.split(' — ')[0].trim() : '');
  const note    = document.getElementById('qcStep2Note')?.value.trim() || d.notes || '';
  const location= d.location || '';
  const uploader = localStorage.getItem('dmc_u') || 'Unknown';
  // Show uploading state
  const uploadBtn = document.getElementById('qcStep2UploadBtn');
  if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '⬆ Uploading…'; }

  let completed = 0;
  const results = [];
  for (const file of files) {
    try {
      const { url, path } = await uploadFileToStorage(
        file, `qc_reports/${jobName.replace(/[^a-z0-9]/gi,'_')}`,
        pct => { if (uploadBtn) uploadBtn.textContent = `⬆ ${Math.round(pct*100)}%`; }
      );
      results.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2,6),
        jobName, jobNo, gcName, note, location,
        fileName: file.name,
        fileType: file.type,
        sizeKB: Math.round(file.size/1024),
        fileUrl: url,
        storagePath: path,
        uploadedBy: uploader,
        uploadedAt: Date.now()
      });
    } catch(e) {
      _logFbError('qcDoUpload', e);
      alert(`Failed to upload ${file.name}: ${e.message}`);
    }
    completed++;
  }
  if (results.length) {
    results.forEach(r => qcReports.unshift(r));
    saveQCReports();
    modal.remove();
    _qcJobDraft = { jobName:'', jobNo:'', gcName:'', location:'', notes:'' };
    renderQCReports();
    pushNotif('success', '🔬 QC Report Uploaded', `${results.length} file${results.length!==1?'s':''} added to QC Reports for ${escHtml(jobName)}.`, null);
  } else if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.textContent = '⬆ Upload';
  }
}

function previewQCReport(id) {
  document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
  document.querySelectorAll(`.reports-file-row[data-preview-id="${id}"]`).forEach(r => r.classList.add('reports-file-active'));
  const r = qcReports.find(r => r.id === id);
  if (!r) return;
  const title = '🔬 ' + (r.fileName || r.jobName || 'QC Report');
  const src = r.fileUrl || r.fileData || '';
  const _qcBreadcrumb = { folder:'QC Reports › ' + (r.jobName||''), title: r.fileName || r.jobName || 'QC Report', badge:'QC Report', badgeColor:'var(--orange)' };
  if (r.fileType && r.fileType.startsWith('image/')) {
    showReportsPreview(
      title,
      `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px;background:#222;">
         <img src="${src}" alt="${escHtml(r.fileName||'')}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;" />
       </div>`,
      () => downloadQCReport(id),
      null,
      false
    );
  } else {
    // PDF — use iframe with base64 src
    showReportsPreview(title, r.fileData, () => downloadQCReport(id), null, true, true);
  }
}

function downloadQCReport(id) {
  const r = qcReports.find(x => x.id === id);
  if (!r) return;
  const a = Object.assign(document.createElement('a'), { href: r.fileUrl || r.fileData || '', download: r.fileName, target:'_blank' });
  a.click();
}

function deleteQCReport(id) {
  if (!canManageQC()) return;
  if (!confirm('Delete this QC Report? This cannot be undone.')) return;
  qcReports = qcReports.filter(x => x.id !== id);
  saveQCReports();
  renderQCReports();
}

// ═══════════════════════════════════════════════════════════════════════════
// FOREMAN'S REPORTS
// ═══════════════════════════════════════════════════════════════════════════

var FOREMAN_REPORTS_KEY = 'pavescope_foreman_reports';
var foremanReports = JSON.parse(localStorage.getItem(FOREMAN_REPORTS_KEY) || '[]');
var _frSortBy = 'date'; // 'date' | 'foreman'

function saveForemanReports() {
  localStorage.setItem(FOREMAN_REPORTS_KEY, JSON.stringify(foremanReports));
  _checkLocalStorageSize();
  try { if (db) fbSet('foreman_reports', foremanReports); } catch(e) {}
}

// ── Repository list rendering ────────────────────────────────────────────────
function renderForemanReports(containerEl) {
  if (!containerEl) return;
  _injectReportsPrintStyles();
  var sorted = foremanReports.slice().sort(function(a, b) {
    if (_frSortBy === 'foreman') {
      var fc = (a.foreman||'').localeCompare(b.foreman||'');
      if (fc !== 0) return fc;
      return (b.date||'').localeCompare(a.date||'');
    }
    return (b.date||'').localeCompare(a.date||'');
  });

  var sortBar =
    '<div style="display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid var(--asphalt-light);flex-shrink:0;background:var(--asphalt-mid);">'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--concrete-dim);">Sort:</span>'+
      '<button onclick="_frSortBy=\'date\';renderForemanReports(document.getElementById(\'frListWrap\'))" '+
        'style="background:'+(_frSortBy==='date'?'rgba(245,197,24,0.12)':'none')+';border:1px solid '+(_frSortBy==='date'?'rgba(245,197,24,0.5)':'var(--asphalt-light)')+';border-radius:3px;color:'+(_frSortBy==='date'?'var(--stripe)':'var(--concrete-dim)')+';font-family:\'DM Mono\',monospace;font-size:9px;padding:3px 10px;cursor:pointer;">📅 Date</button>'+
      '<button onclick="_frSortBy=\'foreman\';renderForemanReports(document.getElementById(\'frListWrap\'))" '+
        'style="background:'+(_frSortBy==='foreman'?'rgba(245,197,24,0.12)':'none')+';border:1px solid '+(_frSortBy==='foreman'?'rgba(245,197,24,0.5)':'var(--asphalt-light)')+';border-radius:3px;color:'+(_frSortBy==='foreman'?'var(--stripe)':'var(--concrete-dim)')+';font-family:\'DM Mono\',monospace;font-size:9px;padding:3px 10px;cursor:pointer;">👷 Foreman</button>'+
      '<div style="flex:1;"></div>'+
      '<button onclick="window.print()" class="rpt-no-print" style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:9px;padding:4px 10px;cursor:pointer;letter-spacing:.4px;">🖨 Print / Save PDF</button>'+
      '<button onclick="openForemanReportForm(null)" style="background:var(--stripe);border:none;border-radius:var(--radius);padding:4px 14px;color:var(--asphalt);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;letter-spacing:.6px;cursor:pointer;">+ New Report</button>'+
    '</div>';

  var rows = sorted.length ? sorted.map(function(r) {
    var dt = r.date ? new Date(r.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}) : '—';
    var totalTons = 0;
    (r.workItems||[]).forEach(function(w) {
      totalTons += (parseFloat(w.denseGraded)||0)+(parseFloat(w.blackBase)||0)+(parseFloat(w.binder)||0)+(parseFloat(w.top)||0);
    });
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;background:var(--asphalt);transition:background 0.1s;" '+
      'onmouseover="this.style.background=\'var(--asphalt-light)\'" onmouseout="this.style.background=\'var(--asphalt)\'" onclick="openForemanReportForm(\''+r.id+'\')">'+
      '<span style="font-size:16px;">👷</span>'+
      '<div style="flex:1;min-width:0;">'+
        '<div style="font-size:12px;font-weight:700;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(r.foreman||'—')+' — '+escHtml(r.jobLocation||r.gcName||'—')+'</div>'+
        '<div style="font-size:10px;color:var(--concrete-dim);margin-top:2px;">'+escHtml(dt)+(r.gcName?' · '+escHtml(r.gcName):'')+( totalTons > 0 ? ' · '+totalTons.toFixed(1)+' tons' : '')+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:6px;flex-shrink:0;">'+
        '<button onclick="event.stopPropagation();printForemanReport(\''+r.id+'\')" style="background:none;border:1px solid var(--asphalt-light);border-radius:3px;color:var(--concrete-dim);font-size:10px;padding:3px 8px;cursor:pointer;">🖨 Print</button>'+
        '<button onclick="event.stopPropagation();deleteForemanReport(\''+r.id+'\')" style="background:none;border:none;color:var(--concrete-dim);font-size:13px;cursor:pointer;padding:0 4px;" title="Delete">✕</button>'+
      '</div>'+
    '</div>';
  }).join('') : '<div style="padding:40px;text-align:center;color:var(--concrete-dim);font-size:12px;">No Foremen\'s Reports yet — click <strong style="color:var(--stripe);">+ New Report</strong> to create one.</div>';

  containerEl.innerHTML = sortBar + '<div style="flex:1;overflow-y:auto;">' + rows + '</div>';
}

function deleteForemanReport(id) {
  if (!confirm('Delete this Foreman\'s Report?')) return;
  foremanReports = foremanReports.filter(function(r){ return r.id !== id; });
  saveForemanReports();
  var el = document.getElementById('frListWrap');
  if (el) renderForemanReports(el);
}

// ── Form (create / edit) ─────────────────────────────────────────────────────
function openForemanReportForm(id) {
  var existing = id ? foremanReports.find(function(r){ return r.id === id; }) : null;

  // Pre-populate from schedule if new report
  var prefill = {};
  if (!existing) {
    // Try to find today's schedule block for a hint
    var today = new Date().toISOString().slice(0,10);
    prefill.date = today;
  }

  var r = existing || prefill;

  // Build labor rows HTML
  function laborRow(role, data) {
    data = data || {};
    return '<div style="display:grid;grid-template-columns:120px 1fr 70px 70px 70px 70px;gap:4px;margin-bottom:3px;align-items:center;">'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);">'+escHtml(role)+'</div>'+
      '<input class="form-input" style="font-size:11px;padding:4px 8px;" placeholder="Name" value="'+escHtml(data.name||'')+'"/>'+
      '<input class="form-input" style="font-size:11px;padding:4px 8px;text-align:center;" type="number" step="0.5" min="0" placeholder="Mach" value="'+(data.machineHours!=null?data.machineHours:'')+'"/>'+
      '<input class="form-input" style="font-size:11px;padding:4px 8px;text-align:center;" type="number" step="0.5" min="0" placeholder="Hand" value="'+(data.handHours!=null?data.handHours:'')+'"/>'+
      '<input class="form-input" style="font-size:11px;padding:4px 8px;text-align:center;" type="number" step="0.5" min="0" placeholder="Total" value="'+(data.totalHours!=null?data.totalHours:'')+'"/>'+
      '<input class="form-input" style="font-size:11px;padding:4px 8px;text-align:center;" type="number" step="0.5" min="0" placeholder="Delay" value="'+(data.delayHours!=null?data.delayHours:'')+'"/>'+
    '</div>';
  }

  // Work rows
  var workTypes = [
    {key:'machinePave',  label:'Machine Pave'},
    {key:'levelingCourse',label:'Leveling Course'},
    {key:'trenchPave',   label:'Trench Pave'},
    {key:'handPave',     label:'Hand Pave'},
    {key:'sidewalks',    label:'Sidewalks'},
    {key:'patch',        label:'Patch'},
    {key:'berm',         label:'Berm'},
  ];
  var workMap = {};
  (r.workItems||[]).forEach(function(w){ workMap[w.workType] = w; });

  function workRow(wt) {
    var d = workMap[wt.key] || {};
    var isBerm = wt.key === 'berm';
    return '<tr>'+
      '<td style="padding:4px 8px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);white-space:nowrap;">'+escHtml(wt.label)+'</td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-wt="'+wt.key+'" data-col="denseGraded" style="font-size:10px;padding:3px 5px;text-align:right;" type="number" step="0.01" min="0" value="'+(d.denseGraded||'')+'"/></td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-wt="'+wt.key+'" data-col="blackBase"   style="font-size:10px;padding:3px 5px;text-align:right;" type="number" step="0.01" min="0" value="'+(d.blackBase||'')+'"/></td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-wt="'+wt.key+'" data-col="binder"      style="font-size:10px;padding:3px 5px;text-align:right;" type="number" step="0.01" min="0" value="'+(d.binder||'')+'"/></td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-wt="'+wt.key+'" data-col="top"         style="font-size:10px;padding:3px 5px;text-align:right;" type="number" step="0.01" min="0" value="'+(d.top||'')+'"/></td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-wt="'+wt.key+'" data-col="squareYards" style="font-size:10px;padding:3px 5px;text-align:right;" type="number" step="0.01" min="0" value="'+(d.squareYards||'')+'"/></td>'+
      (isBerm ? '<td style="padding:2px 4px;"><input class="form-input" data-wt="berm" data-col="linFt" style="font-size:10px;padding:3px 5px;text-align:right;" type="number" step="0.1" min="0" placeholder="lin ft" value="'+(d.linFt||'')+'"/></td>' : '<td></td>')+
    '</tr>';
  }

  // Equipment
  var eq = r.equipment || {};
  function eqRow(label, key, hasCount) {
    var d = hasCount ? (eq[key]||{}) : null;
    if (hasCount) {
      return '<div style="display:grid;grid-template-columns:130px 60px 80px;gap:4px;margin-bottom:3px;align-items:center;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+escHtml(label)+'</div>'+
        '<input class="form-input" data-eq="'+key+'" data-f="noUsed" style="font-size:10px;padding:3px 6px;text-align:center;" type="number" min="0" placeholder="# Used" value="'+(d.noUsed||'')+'"/>'+
        '<input class="form-input" data-eq="'+key+'" data-f="hours"  style="font-size:10px;padding:3px 6px;text-align:center;" type="number" step="0.5" min="0" placeholder="Hours" value="'+(d.hours||'')+'"/>'+
      '</div>';
    }
    return '<div style="display:grid;grid-template-columns:130px 80px;gap:4px;margin-bottom:3px;align-items:center;">'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+escHtml(label)+'</div>'+
      '<input class="form-input" data-eq="'+key+'" data-f="hours" style="font-size:10px;padding:3px 6px;text-align:center;" type="number" step="0.5" min="0" placeholder="Hours" value="'+(eq[key]!=null?eq[key]:'')+'"/>'+
    '</div>';
  }

  // Truck rows
  var trucks = r.trucks || [];
  while (trucks.length < 18) trucks.push({});
  var truckRows = trucks.slice(0,18).map(function(t, i) {
    return '<tr>'+
      '<td style="padding:2px 4px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);text-align:center;">'+(i+1)+'</td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-truck="'+i+'" data-f="name"   style="font-size:10px;padding:2px 5px;" placeholder="Driver name" value="'+escHtml(t.name||'')+'"/></td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-truck="'+i+'" data-f="start"  style="font-size:10px;padding:2px 5px;" type="time" value="'+(t.start||'')+'"/></td>'+
      '<td style="padding:2px 4px;"><input class="form-input" data-truck="'+i+'" data-f="ending" style="font-size:10px;padding:2px 5px;" type="time" value="'+(t.ending||'')+'"/></td>'+
      '<td style="padding:2px 4px;text-align:center;"><input type="checkbox" data-truck="'+i+'" data-f="trailer" '+(t.trailer?'checked':'')+' style="width:14px;height:14px;cursor:pointer;"/></td>'+
      '<td style="padding:2px 4px;text-align:center;"><input type="checkbox" data-truck="'+i+'" data-f="triaxle" '+(t.triaxle?'checked':'')+' style="width:14px;height:14px;cursor:pointer;"/></td>'+
    '</tr>';
  }).join('');

  // Build labor arrays from existing data
  var laborForeman  = (r.labor||[]).find(function(l){ return l.role==='foreman'; }) || {};
  var laborOps      = (r.labor||[]).filter(function(l){ return l.role==='operator'; });
  var laborLabs     = (r.labor||[]).filter(function(l){ return l.role==='laborer'; });
  var laborRakers   = (r.labor||[]).filter(function(l){ return l.role==='raker'; });
  while (laborOps.length    < 5) laborOps.push({});
  while (laborLabs.length   < 6) laborLabs.push({});
  while (laborRakers.length < 4) laborRakers.push({});

  var overlay = document.createElement('div');
  overlay.id  = 'foremanReportOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9300;display:flex;flex-direction:column;overflow:hidden;';
  overlay.innerHTML =
    // Header bar
    '<div style="flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 20px;background:var(--asphalt-mid);border-bottom:2px solid var(--asphalt-light);">'+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;color:var(--white);">👷 '+(existing?'Edit':'New')+' Foreman\'s Report</div>'+
      '<div style="flex:1;"></div>'+
      '<button onclick="saveForemanReportForm(\''+( existing?existing.id:'' )+'\')" style="background:var(--stripe);border:none;border-radius:var(--radius);padding:6px 20px;color:var(--asphalt);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;letter-spacing:.8px;cursor:pointer;">💾 Save Report</button>'+
      '<button onclick="document.getElementById(\'foremanReportOverlay\').remove()" style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:6px 12px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;">✕ Cancel</button>'+
    '</div>'+

    // Scrollable body
    '<div style="flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:20px;">'+

      // ── Section 1: Job Info ──
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:12px;border-bottom:1px solid var(--asphalt-light);padding-bottom:6px;">Job Information</div>'+
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">'+
          '<div><label class="form-label">Date</label><input class="form-input" id="frDate" type="date" value="'+(r.date||new Date().toISOString().slice(0,10))+'"/></div>'+
          '<div><label class="form-label">Starting Time</label><input class="form-input" id="frStartTime" type="time" value="'+(r.startingTime||'')+'"/></div>'+
          '<div><label class="form-label">Ending Time</label><input class="form-input" id="frEndTime" type="time" value="'+(r.endingTime||'')+'"/></div>'+
          '<div style="grid-column:1/3;"><label class="form-label">Job Location</label><input class="form-input" id="frJobLocation" placeholder="e.g. 100 Main St, Plymouth MA" value="'+escHtml(r.jobLocation||'')+'"/></div>'+
          '<div><label class="form-label">Job Number</label><input class="form-input" id="frJobNumber" placeholder="e.g. 2025-047" value="'+escHtml(r.jobNumber||'')+'"/></div>'+
          '<div style="grid-column:1/2;"><label class="form-label">General Contractor</label><input class="form-input" id="frGCName" placeholder="e.g. Gilbane" value="'+escHtml(r.gcName||'')+'"/></div>'+
          '<div><label class="form-label">Plant Location</label><input class="form-input" id="frPlantLocation" placeholder="e.g. Brockton" value="'+escHtml(r.plantLocation||'')+'"/></div>'+
          '<div><label class="form-label">Foreman</label><input class="form-input" id="frForeman" placeholder="Foreman name" value="'+escHtml(r.foreman||'')+'"/></div>'+
        '</div>'+
      '</div>'+

      // ── Section 2: Labor ──
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:12px;border-bottom:1px solid var(--asphalt-light);padding-bottom:6px;">Labor</div>'+
        '<div style="display:grid;grid-template-columns:120px 1fr 70px 70px 70px 70px;gap:4px;margin-bottom:6px;padding:0 0 4px;border-bottom:1px solid var(--asphalt-light);">'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);">Role</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);">Name</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);text-align:center;">Mach Hrs</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);text-align:center;">Hand Hrs</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);text-align:center;">Total Hrs</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);text-align:center;">Delay Hrs</div>'+
        '</div>'+
        '<div id="frLaborRows">'+
          laborRow('Foreman', laborForeman)+
          laborOps.map(function(op){ return laborRow('Operator', op); }).join('')+
          laborLabs.map(function(lb){ return laborRow('Laborer', lb); }).join('')+
          laborRakers.map(function(rk){ return laborRow('Raker', rk); }).join('')+
        '</div>'+
      '</div>'+

      // ── Section 3: Work Performed ──
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:12px;border-bottom:1px solid var(--asphalt-light);padding-bottom:6px;">Description of Work Performed <span style="font-size:8px;color:var(--concrete-dim);text-transform:none;letter-spacing:0;">— record actual placed quantities (tons)</span></div>'+
        '<div style="overflow-x:auto;">'+
          '<table style="width:100%;border-collapse:collapse;">'+
            '<thead><tr style="border-bottom:1px solid var(--asphalt-light);">'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:left;white-space:nowrap;">Work Type</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:right;">Dense Graded</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:right;">Black Base</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:right;">Binder</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:right;">Top</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:right;">Sq Yds</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:right;">Lin Ft</th>'+
            '</tr></thead>'+
            '<tbody id="frWorkBody">'+workTypes.map(workRow).join('')+'</tbody>'+
          '</table>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:repeat(3,auto);gap:10px 20px;margin-top:12px;padding-top:10px;border-top:1px solid var(--asphalt-light);">'+
          '<div><label class="form-label">Tack Cost (gal)</label><input class="form-input" id="frTackGal" type="number" step="0.1" min="0" style="width:100px;" value="'+(r.tackCostGal||'')+'"/></div>'+
          '<div><label class="form-label">Hot Rubber (lin ft)</label><input class="form-input" id="frHotRubberLft" type="number" step="0.1" min="0" style="width:100px;" value="'+(r.hotRubberLft||'')+'"/></div>'+
          '<div><label class="form-label">Hot Rubber (ft)</label><input class="form-input" id="frHotRubberFt" type="number" step="0.1" min="0" style="width:100px;" value="'+(r.hotRubberFt||'')+'"/></div>'+
        '</div>'+
      '</div>'+

      // ── Section 4: Equipment ──
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:12px;border-bottom:1px solid var(--asphalt-light);padding-bottom:6px;">Equipment</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;" id="frEquipmentGrid">'+
          '<div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);margin-bottom:6px;display:grid;grid-template-columns:130px 60px 80px;gap:4px;"><span>Equipment</span><span style="text-align:center;"># Used</span><span style="text-align:center;">Hours</span></div>'+
            eqRow('Paver',  'paver',  true)+
            eqRow('Roller', 'roller', true)+
            eqRow('Misc',   'misc1',  true)+
            eqRow('Misc',   'misc2',  true)+
          '</div>'+
          '<div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);margin-bottom:6px;display:grid;grid-template-columns:130px 80px;gap:4px;"><span>Equipment</span><span style="text-align:center;">Hours</span></div>'+
            eqRow('Bobcat',         'bobcat',       false)+
            eqRow('Tack Machine',   'tackMachine',  false)+
            eqRow('Rubber Machine', 'rubberMachine',false)+
            eqRow('Compressor',     'compressor',   false)+
            eqRow('Truck & Tools',  'truckTools',   false)+
            eqRow('Berm Machine',   'bermMachine',  false)+
            eqRow('Grader',         'grader',       false)+
          '</div>'+
        '</div>'+
      '</div>'+

      // ── Section 5: Truck Times ──
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:12px;border-bottom:1px solid var(--asphalt-light);padding-bottom:6px;">Truck Times</div>'+
        '<div style="overflow-x:auto;">'+
          '<table style="width:100%;border-collapse:collapse;">'+
            '<thead><tr style="border-bottom:1px solid var(--asphalt-light);">'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:center;width:30px;">#</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:left;">Driver Name</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:center;">Start</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:center;">Ending</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:center;">Trailer</th>'+
              '<th style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:4px 8px;text-align:center;">Triaxle</th>'+
            '</tr></thead>'+
            '<tbody>'+truckRows+'</tbody>'+
          '</table>'+
        '</div>'+
      '</div>'+

      // ── Section 6: Delay Notes + Signature ──
      '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius-lg);padding:16px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:12px;border-bottom:1px solid var(--asphalt-light);padding-bottom:6px;">Delay Notes &amp; Signature</div>'+
        '<div style="margin-bottom:12px;">'+
          '<label class="form-label">Reason for Delay (weather, other contractor, etc.)</label>'+
          '<textarea class="form-input" id="frDelayNotes" rows="3" style="resize:vertical;font-size:12px;line-height:1.5;">'+escHtml(r.delayNotes||'')+'</textarea>'+
        '</div>'+
        '<div><label class="form-label">Foreman Signature</label><input class="form-input" id="frSignature" placeholder="Type foreman name as signature" value="'+escHtml(r.foremanSignature||'')+'"/></div>'+
      '</div>'+

    '</div>'; // end scrollable body

  document.getElementById('foremanReportOverlay')?.remove();
  document.body.appendChild(overlay);
  overlay.addEventListener('keydown', function(e){ if(e.key==='Escape') overlay.remove(); });
}

function saveForemanReportForm(existingId) {
  var overlay = document.getElementById('foremanReportOverlay');
  if (!overlay) return;

  // ── Job info ──
  var date         = (overlay.querySelector('#frDate')         ||{}).value || '';
  var startingTime = (overlay.querySelector('#frStartTime')    ||{}).value || '';
  var endingTime   = (overlay.querySelector('#frEndTime')      ||{}).value || '';
  var jobLocation  = (overlay.querySelector('#frJobLocation')  ||{}).value.trim() || '';
  var jobNumber    = (overlay.querySelector('#frJobNumber')    ||{}).value.trim() || '';
  var gcName       = (overlay.querySelector('#frGCName')       ||{}).value.trim() || '';
  var plantLocation= (overlay.querySelector('#frPlantLocation')||{}).value.trim() || '';
  var foreman      = (overlay.querySelector('#frForeman')      ||{}).value.trim() || '';
  if (!date) { alert('Date is required.'); return; }

  // ── Labor ──
  var labor = [];
  var roles = ['foreman','operator','operator','operator','operator','operator','laborer','laborer','laborer','laborer','laborer','laborer','raker','raker','raker','raker'];
  var laborRowEls = overlay.querySelectorAll('#frLaborRows > div');
  laborRowEls.forEach(function(row, i) {
    var inputs = row.querySelectorAll('input');
    var name = (inputs[0]||{}).value || '';
    if (!name) return;
    labor.push({
      role:         roles[i] || 'laborer',
      name:         name,
      machineHours: parseFloat((inputs[1]||{}).value)||0,
      handHours:    parseFloat((inputs[2]||{}).value)||0,
      totalHours:   parseFloat((inputs[3]||{}).value)||0,
      delayHours:   parseFloat((inputs[4]||{}).value)||0,
    });
  });

  // ── Work items ──
  var workItems = [];
  var workTypes = ['machinePave','levelingCourse','trenchPave','handPave','sidewalks','patch','berm'];
  workTypes.forEach(function(wt) {
    var dg = parseFloat((overlay.querySelector('[data-wt="'+wt+'"][data-col="denseGraded"]')||{}).value)||0;
    var bb = parseFloat((overlay.querySelector('[data-wt="'+wt+'"][data-col="blackBase"]')||{}).value)||0;
    var bi = parseFloat((overlay.querySelector('[data-wt="'+wt+'"][data-col="binder"]')||{}).value)||0;
    var tp = parseFloat((overlay.querySelector('[data-wt="'+wt+'"][data-col="top"]')||{}).value)||0;
    var sy = parseFloat((overlay.querySelector('[data-wt="'+wt+'"][data-col="squareYards"]')||{}).value)||0;
    var lf = wt === 'berm' ? (parseFloat((overlay.querySelector('[data-wt="berm"][data-col="linFt"]')||{}).value)||0) : 0;
    if (dg||bb||bi||tp||sy||lf) {
      workItems.push({ workType:wt, denseGraded:dg, blackBase:bb, binder:bi, top:tp, squareYards:sy, linFt:lf });
    }
  });

  // ── Misc ──
  var tackCostGal   = parseFloat((overlay.querySelector('#frTackGal')      ||{}).value)||0;
  var hotRubberLft  = parseFloat((overlay.querySelector('#frHotRubberLft') ||{}).value)||0;
  var hotRubberFt   = parseFloat((overlay.querySelector('#frHotRubberFt')  ||{}).value)||0;

  // ── Equipment ──
  var equipment = {};
  var eqCountKeys = ['paver','roller','misc1','misc2'];
  var eqHourKeys  = ['bobcat','tackMachine','rubberMachine','compressor','truckTools','bermMachine','grader'];
  eqCountKeys.forEach(function(k) {
    var nu = parseFloat((overlay.querySelector('[data-eq="'+k+'"][data-f="noUsed"]')||{}).value)||0;
    var hr = parseFloat((overlay.querySelector('[data-eq="'+k+'"][data-f="hours"]') ||{}).value)||0;
    if (nu||hr) equipment[k] = { noUsed: nu, hours: hr };
  });
  eqHourKeys.forEach(function(k) {
    var hr = parseFloat((overlay.querySelector('[data-eq="'+k+'"][data-f="hours"]')||{}).value)||0;
    if (hr) equipment[k] = hr;
  });

  // ── Trucks ──
  var trucks = [];
  for (var i = 0; i < 18; i++) {
    var nm  = (overlay.querySelector('[data-truck="'+i+'"][data-f="name"]')   ||{}).value || '';
    var st  = (overlay.querySelector('[data-truck="'+i+'"][data-f="start"]')  ||{}).value || '';
    var en  = (overlay.querySelector('[data-truck="'+i+'"][data-f="ending"]') ||{}).value || '';
    var tr  = (overlay.querySelector('[data-truck="'+i+'"][data-f="trailer"]')||{}).checked || false;
    var ta  = (overlay.querySelector('[data-truck="'+i+'"][data-f="triaxle"]')||{}).checked || false;
    if (nm||st||en) trucks.push({ name:nm, start:st, ending:en, trailer:tr, triaxle:ta });
    else trucks.push({});
  }

  // ── Notes + sig ──
  var delayNotes       = (overlay.querySelector('#frDelayNotes') ||{}).value || '';
  var foremanSignature = (overlay.querySelector('#frSignature')  ||{}).value || '';

  var report = {
    id:               existingId || ('fr_' + Date.now()),
    date, startingTime, endingTime, jobLocation, jobNumber, gcName, plantLocation, foreman,
    labor, workItems, tackCostGal, hotRubberLft, hotRubberFt,
    equipment, trucks, delayNotes, foremanSignature,
    createdAt: existingId ? undefined : Date.now(),
    updatedAt: Date.now(),
  };
  if (!existingId) report.createdAt = Date.now();

  if (existingId) {
    var idx = foremanReports.findIndex(function(r){ return r.id === existingId; });
    if (idx >= 0) foremanReports[idx] = report;
    else foremanReports.push(report);
  } else {
    foremanReports.push(report);
  }
  saveForemanReports();

  // Auto-create certified payroll entry for MassDOT projects
  try {
    var savedFR = report;
    var _frJobNum = (savedFR.jobNumber||savedFR.jobNum||'').trim().toLowerCase();
    var _frJobLoc = (savedFR.jobLocation||savedFR.jobName||'').trim().toLowerCase();
    var _matchBL  = backlogJobs.find(function(bj){
      var bn=(bj.num||'').trim().toLowerCase(), bn2=(bj.name||'').trim().toLowerCase();
      var gc=(bj.gc||'').trim().toLowerCase();
      var full=gc&&bn2?gc+' \u2014 '+bn2:bn2;
      return (_frJobNum&&bn===_frJobNum)||(full&&_frJobLoc===full)||(bn2&&_frJobLoc===bn2);
    });
    if (_matchBL && _isMassDOT(_matchBL.awardingAuthority)) {
      var _we = _weekEnding(savedFR.date||new Date().toISOString().slice(0,10));
      _getOrCreateCertReport(_matchBL.id, _we);
    }
  } catch(_certErr) { console.warn('certified report auto-create error', _certErr); }

  overlay.remove();

  // Refresh list if visible
  var el = document.getElementById('frListWrap');
  if (el) renderForemanReports(el);
}

// ── Print / PDF ──────────────────────────────────────────────────────────────
function printForemanReport(id) {
  var r = foremanReports.find(function(x){ return x.id === id; });
  if (!r) return;

  var workTypeLabels = {machinePave:'Machine Pave',levelingCourse:'Leveling Course',trenchPave:'Trench Pave',handPave:'Hand Pave',sidewalks:'Sidewalks',patch:'Patch',berm:'Berm'};
  var fmtNum = function(v){ return v ? parseFloat(v).toString() : ''; };
  var fmtTime = function(t){ if(!t) return ''; var p=t.split(':'); var h=parseInt(p[0]),m=p[1],ap=h>=12?'PM':'AM'; h=h%12||12; return h+':'+m+' '+ap; };
  var dt = r.date ? new Date(r.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '';

  var laborRows = '';
  var roles = ['foreman','operator','operator','operator','operator','operator','laborer','laborer','laborer','laborer','laborer','laborer','raker','raker','raker','raker'];
  var roleLabels = {foreman:'Foreman',operator:'Operator',laborer:'Laborer',raker:'Raker'};
  var allLaborSlots = [];
  ['foreman','operator','laborer','raker'].forEach(function(role){
    var entries = (r.labor||[]).filter(function(l){ return l.role===role; });
    var count = role==='foreman'?1:role==='operator'?5:role==='laborer'?6:4;
    for(var i=0;i<count;i++) allLaborSlots.push({role:role,data:entries[i]||null});
  });
  laborRows = allLaborSlots.map(function(slot){
    var d = slot.data||{};
    return '<tr><td class="lbl">'+roleLabels[slot.role]+'</td><td>'+(d.name||'')+'</td><td class="num">'+(d.machineHours||'')+'</td><td class="num">'+(d.handHours||'')+'</td><td class="num">'+(d.totalHours||'')+'</td><td class="num">'+(d.delayHours||'')+'</td></tr>';
  }).join('');

  var workMap = {};
  (r.workItems||[]).forEach(function(w){ workMap[w.workType]=w; });
  var workRows = ['machinePave','levelingCourse','trenchPave','handPave','sidewalks','patch','berm'].map(function(wt){
    var d=workMap[wt]||{};
    return '<tr><td class="lbl">'+workTypeLabels[wt]+'</td><td class="num">'+fmtNum(d.denseGraded)+'</td><td class="num">'+fmtNum(d.blackBase)+'</td><td class="num">'+fmtNum(d.binder)+'</td><td class="num">'+fmtNum(d.top)+'</td><td class="num">'+fmtNum(d.squareYards)+'</td><td class="num">'+(wt==='berm'?fmtNum(d.linFt):'')+'</td></tr>';
  }).join('');

  var eq = r.equipment||{};
  var truckRows = (r.trucks||[]).filter(function(t){return t.name||t.start||t.ending;}).map(function(t,i){
    return '<tr><td class="num">'+(i+1)+'</td><td>'+escHtml(t.name||'')+'</td><td class="num">'+fmtTime(t.start)+'</td><td class="num">'+fmtTime(t.ending)+'</td><td class="num">'+(t.trailer?'✓':'')+'</td><td class="num">'+(t.triaxle?'✓':'')+'</td></tr>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Foreman Report — '+escHtml(r.foreman||'')+'</title><style>'+
    '*{margin:0;padding:0;box-sizing:border-box;}'+
    'body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#111;background:#fff;}'+
    '@page{size:letter portrait;margin:0.5in;}'+
    '.page{width:100%;max-width:7.5in;}'+
    '.logo-hdr{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1a1a2e;padding-bottom:6px;margin-bottom:10px;}'+
    '.logo-name{font-family:Arial Black,sans-serif;font-size:18pt;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#1a1a2e;}'+
    '.logo-sub{font-size:8pt;color:#555;letter-spacing:1px;text-transform:uppercase;}'+
    '.report-title{font-size:12pt;font-weight:700;color:#1a1a2e;text-align:right;}'+
    '.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 16px;margin-bottom:10px;}'+
    '.info-row{display:flex;gap:4px;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:2px;}'+
    '.info-lbl{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#666;white-space:nowrap;min-width:80px;}'+
    '.info-val{font-size:9pt;color:#111;}'+
    'section{margin-bottom:10px;}'+
    '.sec-title{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:#1a1a2e;color:#fff;padding:2px 6px;margin-bottom:4px;}'+
    'table{width:100%;border-collapse:collapse;font-size:8pt;}'+
    'th{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:#f0f0f0;border:1px solid #ccc;padding:2px 4px;text-align:center;}'+
    'td{border:1px solid #ddd;padding:2px 4px;vertical-align:middle;}'+
    'td.lbl{font-weight:600;background:#fafafa;white-space:nowrap;}'+
    'td.num{text-align:center;}'+
    '.sig-line{border-top:1px solid #111;margin-top:24px;padding-top:4px;font-size:8pt;color:#555;}'+
    '.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;}'+
    '.delay-box{border:1px solid #ddd;min-height:48px;padding:4px;font-size:8pt;color:#333;}'+
  '</style></head><body><div class="page">'+

    // Logo header
    '<div class="logo-hdr">'+
      '<div><div class="logo-name">Don Martin Corporation</div><div class="logo-sub">475 School Street, Ste 6 · Marshfield, MA 02050 · (781) 834-0071</div></div>'+
      '<div class="report-title">Daily Work Report</div>'+
    '</div>'+

    // Job info
    '<div class="info-grid">'+
      '<div class="info-row"><span class="info-lbl">Date:</span><span class="info-val">'+escHtml(dt)+'</span></div>'+
      '<div class="info-row"><span class="info-lbl">Start:</span><span class="info-val">'+escHtml(fmtTime(r.startingTime))+'</span></div>'+
      '<div class="info-row"><span class="info-lbl">End:</span><span class="info-val">'+escHtml(fmtTime(r.endingTime))+'</span></div>'+
      '<div class="info-row" style="grid-column:1/3;"><span class="info-lbl">Job Location:</span><span class="info-val">'+escHtml(r.jobLocation||'')+'</span></div>'+
      '<div class="info-row"><span class="info-lbl">Job #:</span><span class="info-val">'+escHtml(r.jobNumber||'')+'</span></div>'+
      '<div class="info-row" style="grid-column:1/3;"><span class="info-lbl">General Contractor:</span><span class="info-val">'+escHtml(r.gcName||'')+'</span></div>'+
      '<div class="info-row"><span class="info-lbl">Plant Location:</span><span class="info-val">'+escHtml(r.plantLocation||'')+'</span></div>'+
      '<div class="info-row"><span class="info-lbl">Foreman:</span><span class="info-val">'+escHtml(r.foreman||'')+'</span></div>'+
    '</div>'+

    // Labor
    '<section><div class="sec-title">Labor</div>'+
    '<table><thead><tr><th>Role</th><th>Name</th><th>Mach Hrs</th><th>Hand Hrs</th><th>Total Hrs</th><th>Delay Hrs</th></tr></thead><tbody>'+laborRows+'</tbody></table></section>'+

    // Work performed
    '<section><div class="sec-title">Description of Work Performed — Actual Placed Quantities (Tons)</div>'+
    '<table><thead><tr><th>Work Type</th><th>Dense Graded</th><th>Black Base</th><th>Binder</th><th>Top</th><th>Sq Yds</th><th>Lin Ft (Berm)</th></tr></thead><tbody>'+workRows+'</tbody></table>'+
    '<div style="display:flex;gap:24px;margin-top:6px;font-size:8pt;">'+
      '<span><strong>Tack Cost:</strong> '+(r.tackCostGal||0)+' gal</span>'+
      '<span><strong>Hot Rubber:</strong> '+(r.hotRubberLft||0)+' lin ft · '+(r.hotRubberFt||0)+' ft</span>'+
    '</div></section>'+

    // Equipment + Trucks side by side
    '<div class="two-col">'+
      '<section><div class="sec-title">Equipment</div>'+
      '<table><thead><tr><th>Equipment</th><th># Used</th><th>Hours</th></tr></thead><tbody>'+
        [['Paver','paver',true],['Roller','roller',true],['Misc','misc1',true],['Misc','misc2',true]].map(function(e){
          var d=e[2]?(eq[e[1]]||{}):null;
          return '<tr><td class="lbl">'+e[0]+'</td><td class="num">'+(d?d.noUsed||'':'')+'</td><td class="num">'+(d?d.hours||'':eq[e[1]]||'')+'</td></tr>';
        }).join('')+
        [['Bobcat','bobcat'],['Tack Machine','tackMachine'],['Rubber Machine','rubberMachine'],['Compressor','compressor'],['Truck & Tools','truckTools'],['Berm Machine','bermMachine'],['Grader','grader']].map(function(e){
          return '<tr><td class="lbl">'+e[0]+'</td><td class="num">—</td><td class="num">'+(eq[e[1]]||'')+'</td></tr>';
        }).join('')+
      '</tbody></table></section>'+

      '<section><div class="sec-title">Truck Times</div>'+
      '<table><thead><tr><th>#</th><th>Name</th><th>Start</th><th>End</th><th>Trl</th><th>Tri</th></tr></thead><tbody>'+
        (truckRows || '<tr><td colspan="6" style="text-align:center;color:#999;">No trucks recorded</td></tr>')+
      '</tbody></table></section>'+
    '</div>'+

    // Delay notes + signature
    '<div class="two-col" style="margin-top:10px;">'+
      '<section><div class="sec-title">Delay Notes</div><div class="delay-box">'+escHtml(r.delayNotes||'')+'</div></section>'+
      '<section><div style="margin-top:32px;"><div class="sig-line">Foreman Signature: '+escHtml(r.foremanSignature||'')+'</div></div></section>'+
    '</div>'+

  '</div></body></html>';

  _openWin(html, { print:true, delay:350 });
}

var CERTIFIED_REPORTS_KEY = 'dmc_certified_reports';
var certifiedReports = JSON.parse(localStorage.getItem(CERTIFIED_REPORTS_KEY) || '[]');

function saveCertifiedReports() {
  localStorage.setItem(CERTIFIED_REPORTS_KEY, JSON.stringify(certifiedReports));
  _checkLocalStorageSize();
  try { if (db) fbSet('certifiedReports', certifiedReports); } catch(e) {}
}

// Detect if an awarding authority is MassDOT
function _isMassDOT(authorityIdOrName) {
  if (!authorityIdOrName) return false;
  var name = '';
  var found = awardingAuthorities.find(function(a){ return a.id===authorityIdOrName || a.name===authorityIdOrName; });
  name = found ? found.name : (authorityIdOrName||'');
  return /massdot|mass\.?\s*dot|massachusetts.*dept.*transport|department.*transport/i.test(name);
}

// Get ISO week ending (Sunday) for a given date string YYYY-MM-DD
function _weekEnding(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  var day = d.getDay(); // 0=Sun
  var diff = 6 - day; // days until Sunday (if already Sunday, diff=6 — go to next Sunday? No, use same week)
  // Actually use Saturday as week-ending consistent with payroll convention, but form says "WEEK ENDING"
  // Use Sunday as last day: if today is Sunday diff=0, else go forward
  if (day === 0) diff = 0;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0,10);
}

// Get or create a certified report for a job+weekEnding
function _getOrCreateCertReport(backlogJobId, weekEndingDate) {
  var existing = certifiedReports.find(function(r){ return r.jobId===backlogJobId && r.weekEnding===weekEndingDate; });
  if (existing) return existing;
  var job = backlogJobs.find(function(j){ return j.id===backlogJobId; });
  if (!job) return null;
  var aa = awardingAuthorities.find(function(a){ return a.id===job.awardingAuthority||a.name===job.awardingAuthority; });
  var report = {
    id: 'cr_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    createdAt: new Date().toISOString(),
    status: 'incomplete',
    jobId: backlogJobId,
    projectName: job.name || '',
    contractNum: job.contractNum || job.num || '',
    gcName: job.gc || '',
    awardingAuthorityName: aa ? aa.name : (job.awardingAuthority||''),
    minorityHiringGoal: '',
    weekEnding: weekEndingDate,
    reportNum: '',
    dateWorkBegan: '',
    dateWorkCompleted: '',
    reportingDate: new Date().toISOString().slice(0,10),
    isFinalReport: false,
    danaNotified: false,
    page4Uploaded: false,
    page4File: null,
    // Utilization rows — computed on render from foreman reports
    utilizationCache: null,
  };
  certifiedReports.push(report);
  saveCertifiedReports();
  // Notify Dana
  _certNotifyDana(report);
  return report;
}

function _certNotifyDana(report) {
  if (report.danaNotified) return;
  report.danaNotified = true;
  // Push notification visible in the app — Dana will see it on login
  pushNotif('warning', '📋 Certified Payroll Due',
    'Certified payroll report needed for "' + (report.projectName||'MassDOT Project') + '" week ending ' + report.weekEnding + '. Assign to Dana.',
    null
  );
  // Save a persistent flag in a separate list for Dana's dashboard
  var danaPending = JSON.parse(localStorage.getItem('dmc_dana_certif_pending') || '[]');
  danaPending.push({ reportId: report.id, projectName: report.projectName, weekEnding: report.weekEnding, notifiedAt: new Date().toISOString() });
  localStorage.setItem('dmc_dana_certif_pending', JSON.stringify(danaPending));
  _checkLocalStorageSize();
}

// Build utilization data from foreman reports for a given job + week
function _buildCertUtilization(backlogJobId, weekEnding) {
  var job = backlogJobs.find(function(j){ return j.id===backlogJobId; });
  if (!job) return null;
  var jobNum = (job.num||'').trim().toLowerCase();
  var jobName = (job.name||'').trim().toLowerCase();
  var gcName  = (job.gc||'').trim().toLowerCase();
  var fullName = gcName && jobName ? gcName + ' \u2014 ' + jobName : jobName;

  function matchesJob(fr) {
    var fn = (fr.jobNumber||fr.jobNum||'').trim().toLowerCase();
    var fm = (fr.jobLocation||fr.jobName||'').trim().toLowerCase();
    return (jobNum && fn===jobNum) || (fullName && fm===fullName) || (jobName && fm===jobName);
  }

  // Week range: Monday through Sunday
  var wEnd = new Date(weekEnding + 'T23:59:59');
  var wStart = new Date(wEnd);
  wStart.setDate(wStart.getDate() - 6);

  function inWeek(dateStr) {
    var d = new Date(dateStr + 'T12:00:00');
    return d >= wStart && d <= wEnd;
  }

  // Map employee names to their profile
  function getEmpProfile(name) {
    var n = (name||'').trim().toLowerCase();
    return employees.find(function(e){ return (e.name||'').trim().toLowerCase()===n; }) || null;
  }

  // Category map
  function getCat(emp, laborRole) {
    if (emp && emp.certJobCategory) return emp.certJobCategory;
    var r = (emp && emp.role) || (laborRole||'');
    if (/foreman|superintendent/i.test(r)) return 'FOREMAN';
    if (/operator/i.test(r)) return 'OPERATOR';
    if (/mechanic/i.test(r)) return 'MECHANIC';
    if (/driver/i.test(r)) return 'TRUCK DRIVER';
    return 'LABORER';
  }

  var CAT_KEYS = ['FOREMAN','OPERATOR','MECHANIC','LABORER','TRUCK DRIVER'];
  var weekRows = {}; // name -> {cat, totalHrs, isMin, isFem, race}
  var toDateRows = {}; // same but all time

  var allFR = (typeof foremanReports!=='undefined' ? foremanReports : []).filter(matchesJob);

  allFR.forEach(function(fr) {
    var isThisWeek = inWeek(fr.date||'');
    (fr.labor||[]).forEach(function(lb) {
      var emp = getEmpProfile(lb.name);
      var cat = getCat(emp, lb.role);
      var hrs = parseFloat(lb.totalHours||0) || (parseFloat(lb.machineHours||0)+parseFloat(lb.handHours||0));
      var isMin = emp ? !!emp.isMinority : false;
      var isFem = emp ? !!emp.isFemale  : false;
      var race  = emp ? (emp.race||'') : '';
      // All-time accumulation
      if (!toDateRows[lb.name]) toDateRows[lb.name]={cat,hrs:0,isMin,isFem,race,name:lb.name};
      toDateRows[lb.name].hrs += hrs;
      // Weekly
      if (isThisWeek) {
        if (!weekRows[lb.name]) weekRows[lb.name]={cat,hrs:0,isMin,isFem,race,name:lb.name};
        weekRows[lb.name].hrs += hrs;
      }
    });
    // Drivers from trucks array
    (fr.trucks||[]).forEach(function(tk) {
      var emp = getEmpProfile(tk.name);
      var cat = 'TRUCK DRIVER';
      var hrs = 0;
      if (tk.start && tk.ending) {
        var s=tk.start.split(':'), en=tk.ending.split(':');
        hrs = (parseInt(en[0])*60+parseInt(en[1]||0) - (parseInt(s[0])*60+parseInt(s[1]||0)))/60;
        if (hrs<0) hrs+=24;
      }
      var isMin = emp?!!emp.isMinority:false;
      var isFem = emp?!!emp.isFemale:false;
      var race  = emp?(emp.race||''):'';
      if (!toDateRows[tk.name]) toDateRows[tk.name]={cat,hrs:0,isMin,isFem,race,name:tk.name};
      toDateRows[tk.name].hrs+=hrs;
      if (inWeek(fr.date||'')) {
        if (!weekRows[tk.name]) weekRows[tk.name]={cat,hrs:0,isMin,isFem,race,name:tk.name};
        weekRows[tk.name].hrs+=hrs;
      }
    });
  });

  // Aggregate by category
  function aggByCat(rows) {
    var agg = {};
    CAT_KEYS.forEach(function(k){ agg[k]={emp:0,totalHrs:0,minHrs:0,womenHrs:0}; });
    Object.values(rows).forEach(function(r){
      var k=r.cat; if(!agg[k]) agg[k]={emp:0,totalHrs:0,minHrs:0,womenHrs:0};
      agg[k].emp++;
      agg[k].totalHrs+=r.hrs;
      if(r.isMin) agg[k].minHrs+=r.hrs;
      if(r.isFem) agg[k].womenHrs+=r.hrs;
    });
    return agg;
  }

  var weekAgg  = aggByCat(weekRows);
  var totalAgg = aggByCat(toDateRows);

  // Build minority employee list for page 3 (weekly, all min or female)
  var minEmpList = Object.values(weekRows)
    .filter(function(r){ return r.isMin||r.isFem; })
    .sort(function(a,b){ return a.cat.localeCompare(b.cat)||a.name.localeCompare(b.name); });

  // All employees on job this week (for utilization %)
  var allEmpList = Object.values(weekRows)
    .sort(function(a,b){ return a.cat.localeCompare(b.cat)||a.name.localeCompare(b.name); });

  return {
    weekAgg: weekAgg,
    totalAgg: totalAgg,
    minEmpList: minEmpList,
    allEmpList: allEmpList,
    weekEnding: weekEnding,
  };
}


function toggleReportsFolder(key) {
  reportsFolderCollapsed[key] = !reportsFolderCollapsed[key];
  renderReports();
}

function _injectDailyOrderBackBtn() {
  var toolbar = document.querySelector('#reportsPreviewPane .reports-preview-toolbar');
  if (!toolbar || toolbar.querySelector('._do-back-btn')) return;
  var btn = document.createElement('button');
  btn.className = '_do-back-btn';
  btn.title = 'Back to Daily Orders directory';
  btn.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.15);border-radius:3px;color:rgba(255,255,255,0.55);font-family:"DM Sans",sans-serif;font-size:9px;font-weight:700;padding:3px 9px;cursor:pointer;white-space:nowrap;transition:all 0.12s;margin-right:6px;';
  btn.textContent = '← Back';
  btn.onmouseover = function() { this.style.background='rgba(255,255,255,0.08)'; this.style.color='rgba(255,255,255,0.9)'; };
  btn.onmouseout  = function() { this.style.background='none'; this.style.color='rgba(255,255,255,0.55)'; };
  btn.onclick = function() { switchTab('reportsDailyOrders'); };
  toolbar.insertBefore(btn, toolbar.firstChild);
}

function previewDailyOrder(id) {
  // Mark active in file list
  document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
  document.querySelectorAll(`.reports-file-row[data-preview-id="${id}"]`).forEach(r => r.classList.add('reports-file-active'));
  const stored = JSON.parse(localStorage.getItem(DAILY_ORDERS_KEY) || '[]');
  const order = stored.find(o => o.id === id) || dailyOrders.find(o => o.id === id);
  if (!order) return;

  // If we have a stored HTML blob, show it directly in the iframe preview
  const blob64 = order.blob64;
  if (blob64 && blob64.startsWith('data:text/html')) {
    const bytes = atob(blob64.split(',')[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const html = new TextDecoder().decode(arr);
    const title = '📋 ' + order.fileName.replace(/\.(docx|html)$/, '');
    showReportsPreview(title, html, () => downloadDailyOrder(id), null, true, false,
      { folder: 'Daily Orders', title, badge: order.orderType === 'amrize' ? 'Amrize' : 'DMC',
        badgeColor: order.orderType === 'amrize' ? '#7ecb8f' : '#5ab4f5' });
    _injectDailyOrderBackBtn();
    return;
  }

  // Legacy fallback: reconstruct preview from schedule data
  const bdata = (schedData[order.dateKey] || {})[order.foreman === 'Filipe Joaquim' ? 'top' : 'bottom'] || { type:'blank', fields:{} };
  const f = bdata.fields || {};
  const v = (k) => f[k] || '';

  const orderDate = (() => {
    const parts = order.dateKey.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    return d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  })();

  const operators = v('operators') ? v('operators').split(',').filter(Boolean) : [];
  const equipList = v('equipment') ? v('equipment').split(',').filter(Boolean) : [];

  const chk = (val) => `<span class="do-checkbox">${val ? '☒' : '☐'}</span>`;
  const field = (label, val, full) => `
    <div class="do-field-row" ${full ? 'style="grid-column:1/-1"' : ''}>
      <span class="do-field-label" style="min-width:130px;flex-shrink:0;">${label}</span>
      <span class="do-field-val">${val || ''}</span>
    </div>`;

  const col = (stop, filled) => `
    <div class="do-preview-col">
      <div style="display:flex;align-items:center;gap:10px;padding-bottom:8px;border-bottom:2px solid #1a1a1a;margin-bottom:10px;">
        <img src="data:image/png;base64,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rza77R/j38KtXguDaa1CptuJPO/cf+jcV72E8R+G8TpRzCn/AOBxOKpk+LhvTme2CNQc55qauU0PxPoevWv2zSryG5h7SQy+YPzFdSGUjIINfUYTMcNiIc+HkmcbpOnuWqKKTK16BItFFJlaAFopMilyD0oAKKMgdaMg9KACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9D+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACkPSlpDyMUAZOBkMp4rx74ufEEfDrwjcazj7Rcyjy4IPWSvWH/dc54iBJr8qPjf4+PjjxvcCKb/AEGx/d2//tR/+2vSvxbxu8QVwxkFWdD/AHip7kP/AJP/ALdPo+GMleY4xL/l3Dc8mllvby6uL++n+0z3NU5UBapc47UZycmv8t62Jq1arrVHds/oKlBQVkexfAT4mf8ACufFYS/P/Etvv+Pj5fM6f6uSv1cgePJf2z+dfiA0Ctc/aq/RT9mr4iDxV4e/4RfVI83GmCMR8f8ALLP7sf8AbKv7S+jJ4j8k3wxjn8fv03/6VD/24/LePMj2x9Bf4z6e1HQPDuvL/wATmxt73Z/z8RJL/OuS1f4T/DTV9P8AsV/o1t5f/TvD5f8A6KxXqQIpciv7fPyw+eNQ/Zz+GN1p32Kxs5rInrPBNIZfw83za5yT9lnwQbbFlqF+P+/X/wAar6qooA+Gbj9lTUbXTt2m6vDcXfbz4THH+sk1cnqP7NvxM06xxZeVcH0gmz/6N8mv0SooA/K7V/g18TdIGb7Rrn/th+8/9FedXEaxo+t6Df8A2LXILm2/67w+XX7EUUAfjfRX6hXnw58B6vDcG/0awP2oSCc+TH5pz/00rgNQ/Zo+G2owBbKG504jvBNn/wBG+dQB+flFfXesfssoonOianmLH7iCeHH/AJEi/wDjVeZat+zV8TdOUGys7fUM9oJv/jvk0AeI0Voax4P8R6DYfb9c065tv+u8MkVZ9ABRRRQAUUUUAFFFFAGho/jDxHoNh9g0PUbm2/64TSRV6Np3x2+KWnrApvftQtvKyLiGPv8A+Rq8pooA+oNI/ao8Rw3X/E8062uf+uHmR/8Ax+u00j9qbwvJYE61p1xbnsIXjk/X9zXxXRRYD9KNG+Lfwx1W4NlZaxbtJ6T74v8A0biuon0vwb4001fNhtNRtD3wksVflfVezmvtNuvt1lXnVstwuIhyYiivuLUpU9mfoxrnwB+F+tt58mlRRn/p332//orFeQat+yDoU9sf7L1e7t5/783lyV4toPxs+IugxfZ/t01z+88z9/8AvP8A0b++r1XTf2n/ABH/AMxvR7a5P/TB5I//AI9XxOaeFHC+afx8vh8vc/8ASLHp4fOcdQ/gVTznVv2X/iBaPOmiz2lzZ4yhG+OR/wAP9X/5Frkpovj98OjH5P8AattBHH2/0i3giH/f6KvtPRP2iPhvq7yRTPNp8qhPlni5Of8Arl5o/OvZdI1jSNdtvtel3MN1HjrDL5or4DH/AEe8rhP2mSY6vhZ/3Kmn/wAl/wCTHqUuMK+2JpQqfI/NjSv2nvippKzia4i1DHQzwjP/AJC8mvUtK/bBmCH+3dHa3/d8PG+/97/1zlEP/o2vqrxD8LvBvi2Lb4g0yJzj7/8Ay0/7+f6yvn7xR+yP4a1H/TfC+pS2foD/AKRH/wDHf/ItfJ4ngfxSyLXJ80+tUv8Ap58f/k3/AMkenTzHh/Ff7xh/Zvy/r9D0Hw/+0p8NtbCQXV4bKeRc+TcjZ/5E/wBUT/21New6Zrujaxai80y6huIJejo/mR1+ZHif4BfErwvmW4sTeW4AP+ijzBz/ALH+tP4Q15JDNqnh3UsWc82nT2ol/wCmcsFeB/xMBxdkdT2HEeU7dffh/wDJcx2f6oYDFrny/En7YwRMRyMe4q2MgfKc1+S/hb47/Erw8RaW98byADA+1EyD/v5/rfzmr6F8MftaaRc/6F4ssprUgR/v4B5kXT95J9B7GSv0/hf6RnCebclPEVPYVP7+3/gR4OO4PzLC9Of0Pt8iGcUjfuIRzivN/C/xR8IeLFJ0bUYpTj/V5/ef9+/9ZXpxPm8ggiv2zBZtgsfT9pg6ynD+4z5qpRqU3yVFYuDpS0gIoyB1r1jEWiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9H+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACgjPFJkVh3t7a6ZaPe3biCGMdegrGvXjSi5S2Q0rux89/tCfEZfAfhQWOlf8hPU/Mt7f/Y/56SfhX5gQDz58np0r0v4ueOj4+8Z3GqWhJgjJt7f/rlCf/av+srz0/uLfd6da/y88b+PnxNn9WVD/d6fuQ/Wf/bx+7cI5T9Rwd3/ABKglFA55or8N12PsRl0MgV2Hg3xbqfgzXIPFGiSf8e3M8H/AD3i/wCWkdclkXB4HSm/ZsHINe7k2a18vxlLG4epyVKbOLFYWniKDoV+p+0Wj6rp+s6dBrln/qLmOORP+21dYAASfWvgv9lX4iwSKPh9e9E8x7TmMf8AXSP8/wB5X3WQpyhNf6weHnGOE4lyTD5nhnd29/8Auzt7x/O2bZbUwWLqYdmrRSDpS198eaFFFFABRRRQAUUUUAFFFFABXlWv/C3wH4phC6rpUPL+ZmNPKkz/ANdIua9VooA+Wtc/Zg8HXkU40W4uNNJ7f6yP+k3/AJGrwrXf2ZvH2m86X5Oo/Pn9xN5Un/kWv0aooA/H/XfDniLw7c/Ytb06a3H73/X1n1+yFeIap8HfhprwBOmRW4a3+z5gHlY/CP8AdfpQB+b1FfWniL9lS/258IakOAP3N9x/5Ei/+NV85eI/hz4+8Ic61p1zbf8ATf8A1kf/AH8ioA5iiiigAooooAKKKKACiiigAqfTbu+0i6+3aHPNbXh/5bwfupagooA9e8L/AB2+Ivhwiy886jjp9uPmf+RP9bX0N4f/AGofCN4P+Kngl00+p/exf0l/8hV8N0UAfrHo+s6Hr1v9r0y5iuh6wTeYKwtf8FeFPFNsbPxBZRXMZzxNFkfva/MHTbu+0i6+26JPNbXH/PeD93LXvvh79pPxlp0G3xTDFqHuP3cv/kLNcGPyrC4yn7PE0lUh5jpV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i/8AC6/+F/iH7D532ixufMMEx/1o/wCmdf59ePng1/YmIee5PT/2Sp/Eh/JP/wCQP1/g7ij6yvqWJfvmP8OvH3iDwF4jGq6Z/wAei8zwf8s5q/VrQdY0PxXoKa3pk3n291yrivxit8kE19Mfs3/FIeHPEMnhHXMR2epyDyMr/wAvP+r/APItc/0d/Fipk+M/sPMan+z1P4f9yf8A9sPjXh9V6f1zD/HDc/T5eABS1HERtqTIr/Q5O6ufjwUUUUwCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//1f7+KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKQ9KWigCj5I+93NQ4IOT0xUpwT5PevF/i58R/wDhXPhW41eCP7TP/q4If+ekteBnub4TKcvq5hi3yQprnNsPh6leoqdM+Of2mfiOPEviz/hE7Cb/AESw/wBf/wBdf/tX/wAXXzGW289aS+uL+71Ce/vp/tM911NOVMjBr/JvjviyvxBnGIzOt9t6eh/RGR5bDA4SFMKBRRXw6R7Re0m1vdZ1CDTbL/X3MkdvB/22r9V/CHw80TRPh0ngObFyhjljnyNm/wA/mT/0ZXyl+yt4D/tTWX8Z3oBj0v5IM84lm/1n/kPH/fdfogjwxgnGMV/oD9G7w2oUcnq5xmVL36/uQ/69/wD2x+Lcb506mM+qU9qZ+J3inw5feF/EV/4fvTxaySJ/qfKz/wBNKyQMcV9n/tVeARDcweO7GHMU37u7+v8Ayzk/9p/98V8YEnr6V/JvivwhV4d4ixGAa/d3vD/B9k/RuGcyWOwEKnVCUUUV+Xn0YUUUU0AUUUVrGTUlJbiaurM/T39n74ht408GR219Nm/sMW8/PX/nnJ/21HNfQIYY9Af51+Rnwk8c/wDCBeM7bWpCRA5FvcY/55TH/wBpf6yv1zBW5hLQHIbBr/UDwF8QVxNw9GnXf+0ULQn6fZmfgHFeTPA492/hzNkdBS0g6Utfux8uFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQBw/i/wvovjTRZ9B16ASQSenDof74r83fH/AMP9U+H+rjRdbH+hn/j3nP8Aq56/VqvOfHvgmw+IHh+48PXmATkwTd4ZBQB+WtFX/EfhzVPC+sT+F9aOZ7aqFABRRRQAUUUUAFFFFABRRRQAV1/w/wDiDqnw/wBT/tTQ/wDjz/5eIP8AlnPXIUUAfrJo+s6V4j0aPVdFn+0QXPMbiuO+JXw+sPiB4ZuNGnOJJB8j/wBySvlH9nrx/wD8I7q//CHa4f3GpyZtsQ4/e/6qvveD5gT615Oa5bhMywdXBYhc9Oa5Jm1KrOnU9rTZ+JOvaHqeh6lPpmqQ/Zri2/18Aql1h5r7j/ae+H0D2Ufj3SIP38X7u7/24q+HbmITtm2r/K7xL4HxHCef1Muf8O/PTn/cP37h/NaeZYOEn8z9RfgV8Rj8RvC4kvji/tv3c/H/AH7f8a97SZRmT8K/Lb9nTxq3hb4hW8V6f9E1P/Rz/wBdf+Wf/wAb/wCB1+pMYSaHaT1r+/8AwN40lxHw1SqV6l69P3J/ofj3E+WvA49018DNYdKKQcDFLX7QfOBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/W/v4ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooyKQkYzQBktcIk+COQOtflh+0J8RofiB4r+waXMLiwsf9HgA/jl/5aSV9j/tBfEt/A3g97fS2/0+/wA28Bz0HR5P+2XWvzGggHn/AGiv4s+lH4h8kKfDGHf9+p/7ZD/27/wE/TOAclu3mGI/7cCiiiv4XufrgsDfuvpV/SLK91e5g0+x/wCPi7kjt4P+21Z/kV9cfsr+AhqmvTeNL4ArpZ8uDP8Az1m/1n/kPH/fdfovhzwnU4jz/DZZh9p25/8AB9s8HiLMoYHB1K/U+zPAnhGx8D+FbDQLPA+zRgenP8b/AK16OFEkWBVf/Uw+u3+tWBKMdO2a/wBYMrwNDL8HSwWHVqdNckD+eqtSdSo6jOO8XeHLLxT4dvPD+pjMFzH5ZFfjz4l0Gfwv4in8P6mf39s/l/Wv2yxnrzXwT+1V8Pxb3MHjuxh/dTfu7v8A9pyf+0/++K/mv6S3h+81ymnnmGX72h8f+D/7U+04Izf6ri/q7ekz4vooPHWiv87mj9vCiiikAUUUU0wAL9ng3571+hf7NHjseKfDs3hjUR/pFiIvLHX91nMY/wC2VfnqDmD2Ndn8MvGt74A8VWmvhx5A4uP9uL/lpX7N4M8d4jhriKlXv+4qe5U/wd/+3T5binKFmGAnBL94tj9o1+6KRtv8VYWn39pqdil3av8AaIZfTnNZQ8U6afFP/CEF/wDTPsn23H/TLzPL/nX+p9CvGtSVWm7pn4C4tOzO0ooorYQUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAHz18cfhl/wmmgf23YQk6nZcjyx+8ni/55596/PSv2Qr82/jp4Es/BXiv7bo0H2aDU/9Ig/66/8ALWOgDxOiiigAooooAKKKKACiiigAooooAK/SP4O+PG8eeEBe3v8Ax/2v+j3HPcfx1+ble3fs++L28O+P7ewvDiz1T/R/+2v/ACyoQXPunXdMs9W0640q95gureWJ/wDttX4/a5oUvhfxFP4f1M/v4n+z1+1lzGpwW7cfnX5nftT+GzofjtdZgg/d6lBn/trD+7/9F7K/lD6U/CyxeQ083pr95Qn/AOST/wDtj73gLHOni54fpUPm6Ka/s9QgmsZ/s89tX7D+C9Zt/FvhzT/EVkf3dxBHIPm39a/HGA/8vJr9HP2UtTvLv4eyadMP+QbPLAn4/vP/AGevyv6KnEFSjnWIyf8A5d1Ic/8A2/A+g8Q8EpUKVX+Q+uxRQORmiv8AQM/IgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9f+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKQ9KWigCl1YYqm0+yGRuwGau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/njH/wB8Cj+z7H/nhH/3wKv0UB7SXcz/AOzrEf8ALCL/AL4FWkhhhHyKBU1FAnJvdhRRRQSf/9D+/fA60YFLRQAYFJgDpS0UAFFFFABRRRQAUUUUAJgUYFLRQAmBRgUtFACYFGBS0UAGAetGAOlFFABRRRQAUUUUAFFFFACYFLgHrRRQAmBRgUtFACYHSgADpS0UAFFFFABRRRQAUUUUAIQD1owKWigBMCjApaKADApMClooATApcCiigBCqnqKMClooAMAdKKKKAEwKMLS0UAJgUEA9RS0UAJhaMClooATAHSjApaKACiiigAooooATApcCiigBNq9MUYFLRQAYFJtX0paKACkKqeozS0UAFFFFABRRRQAYB60UUUAGB1pMClooATAowKWigAooooAKKKKACk2qeSKWigAwKTApaKACiiigAooooAKTap5IpaKADApCqnkilooATavpRgUtFACYFGBS0UAFFFFABRRRQAUUUUAIFUcgUuBRRQAmAO1LgDpRRQAUYB60UUAFFFFABRRRQAUUUUAFFFFACYFGBS0UAJgUYFLRQAUUUUAFFFFABRRRQAUYFFFACYHWjAPWlooAMCkKqeSKWigApMClooAKKKKACiiigBMLRgUtFACYFLgUUUAJgDpS4B60UUAJtUdqMClooAQKo6CjApaKACiiigAooooAKKKKACiiigAooooA/9H+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKTIoyKAFooooAKKTIoyKAFooyKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9L+/iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKK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" alt="DMC Paving" style="height:50px;width:auto;object-fit:contain;flex-shrink:0;" />
        <div style="flex:1;">
          <div style="font-weight:900;font-size:13px;letter-spacing:1px;color:#1a1a1a;line-height:1.2;">DMC PAVING — DAILY ORDER${stop===2?' (COPY)':''}</div>
          <div style="font-size:9px;color:#888;letter-spacing:0.5px;margin-top:2px;">WORK ORDER FORM</div>
        </div>
      </div>
      <div class="do-section-head">JOB INFORMATION:</div>
      ${field('ORDER DATE:', filled ? orderDate : '')}
      ${field('FOREMAN:', order.foreman)}
      ${field('DMC JOB NUMBER:', filled ? v('jobNum') : '')}
      ${field('GENERAL CONTRACTOR:', filled ? order.gcName : '')}
      ${field('PROJECT NAME:', filled ? order.jobName : '')}
      ${field('PROJECT ADDRESS:', filled ? v('location') : '')}
      <div class="do-section-head">MATERIALS INFORMATION:</div>
      <div class="do-field-row">
        <span class="do-field-label" style="min-width:130px;">TYPE OF WORK:</span>
        <span style="font-size:11px;">${chk(filled)} MACHINE WORK &nbsp; ${chk(false)} HAND WORK</span>
      </div>
      <div class="do-field-row">
        <span class="do-field-label" style="min-width:130px;">JOB SETUP:</span>
        <span style="font-size:11px;">${chk(filled)} BY THE TON &nbsp; ${chk(false)} BY THE SQUARE YARD</span>
      </div>
      ${field('PLANT:', filled ? v('plant') : '')}
      ${field('MATERIAL:', filled ? v('material') : '')}
      ${field('SUPERPAVE LEVEL:', '')}
      ${field('TONS:', '')}
      ${field('MIX TYPE:', '')}
      ${field('TONS:', '')}
      ${field('MIX TYPE:', '')}
      ${field('EST. TIME TO PAVE:', '')}
      <div class="do-section-head">TRUCKING:</div>
      ${field('# OF TRUCKS:', '')}
      ${field('LOAD TIME:', '')}
      ${field('SPACING:', '')}
      ${field('QC:', filled ? v('qc') : '')}
      ${field('TACK:', filled ? v('tack') : '')}
      ${field('RUBBER:', filled ? v('rubber') : '')}
      ${field('EQUIPMENT:', filled ? equipList.join(', ') : '')}
      ${field('CONTACT:', filled ? v('contact') : '')}
      <div class="do-field-label" style="margin:6px 0 4px;">SPECIAL NOTES / TRUCK LIST:</div>
      ${(filled ? [...operators,'','','','',''] : ['','','','','']).slice(0,5).map((op,i) =>
        `<div class="do-field-row"><span class="do-field-label">${i+1})</span><span class="do-field-val">${op}</span></div>`
      ).join('')}
      ${field('NOTES:', filled ? v('notes') : '')}
    </div>`;

  showReportsPreview(
    '📋 ' + order.fileName.replace('.docx',''),
    `<div style="background:#fff;min-height:100%;padding:0;"><div class="do-preview-doc">${col(1, true)}${col(2, false)}</div></div>`,
    () => downloadDailyOrder('${id}'),
    null,
    false  // not iframe
  );
  _injectDailyOrderBackBtn();
}

function printPreviewDailyOrder(id) {
  const order = dailyOrders.find(o => o.id === id);
  if (!order) return;
  const stored = JSON.parse(localStorage.getItem(DAILY_ORDERS_KEY) || '[]');
  const full = stored.find(o => o.id === id);
  const blob64 = full?.blob64 || order.blob64;
  if (!blob64) { alert('File data not available. Please regenerate the daily order.'); return; }
  if (blob64.startsWith('data:text/html')) {
    const bytes = atob(blob64.split(',')[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const html = new TextDecoder().decode(arr);
    _openWin(html, { w:860, h:720, print:true, delay:400 });
  }
}

function downloadDailyOrder(id) {
  const order = dailyOrders.find(o => o.id === id);
  if (!order) return;
  const stored = JSON.parse(localStorage.getItem(DAILY_ORDERS_KEY) || '[]');
  const full = stored.find(o => o.id === id);
  const blob64 = full?.blob64 || order.blob64;
  if (!blob64) { alert('File data not available. Please regenerate the daily order.'); return; }

  // HTML-based orders: download as a local file
  if (blob64.startsWith('data:text/html')) {
    const bytes = atob(blob64.split(',')[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: 'text/html' });
    downloadBlob(blob, order.fileName);
    return;
  }

  // Legacy DOCX
  const byteStr = atob(blob64.split(',')[1]);
  const arr = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  downloadBlob(blob, order.fileName);
}

function deleteDailyOrder(id) {
  if (!confirm('Delete this daily order?')) return;
  dailyOrders = dailyOrders.filter(function(o){ return o.id !== id; });
  // Record delete time to prevent onSnapshot restoration
  localStorage.setItem('_doLastDelete', Date.now().toString());
  _checkLocalStorageSize();
  localStorage.setItem(DAILY_ORDERS_KEY, JSON.stringify(
    dailyOrders.map(function(o){ return Object.assign({}, o, {blob64: undefined}); })
  ));
  _checkLocalStorageSize();
  try {
    if (db) fbSet('daily_orders', dailyOrders.map(function(o){ return Object.assign({}, o, {blob64: undefined}); }));
  } catch(e) {}
  var cv = document.getElementById('_doCardView');
  if (cv) { cv.innerHTML = ''; _renderDailyOrderCards(cv); }
  else renderReports();
}

function previewBlankOrderForm(type) {
  var today = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  var html = type === 'amrize' ? buildAmrizeOrderHTML({}, '', '') : buildDMCOrderHTML({}, today, '');
  var title = type === 'amrize' ? 'Amrize Daily Order — Blank Template' : 'DMC Daily Order — Blank Template';
  document.querySelectorAll('.reports-file-row').forEach(r => r.classList.remove('reports-file-active'));
  showReportsPreview(title, html, function() { openBlankOrderForm(type); }, null, true, false,
    {folder:'Order Form Templates', title:title, badge: type === 'amrize' ? 'Amrize' : 'DMC', badgeColor: type === 'amrize' ? '#7ecb8f' : '#5ab4f5'});
}

function _crewConfirmBuildReport(dateKey, block, overrideLocation) {
  var jobLoc = overrideLocation || block.jobLocation || '';
  // Try to enrich from backlog
  var backlogMatch = (backlogJobs || []).find(function(j) {
    return j.jobName && jobLoc && j.jobName.toLowerCase().includes(jobLoc.toLowerCase());
  });
  var gcN = block.gcName || (backlogMatch ? backlogMatch.gcName || '' : '');
  var plantLoc = block.plantLocation || (backlogMatch ? backlogMatch.plant || '' : '');

  // Pull labor from employees tagged to this foreman or all active laborers/foremen
  var labor = [];
  var addLabor = function(role, name) {
    labor.push({ role: role, name: name || '', machineHours: '', handHours: '', totalHours: '', delayHours: '' });
  };
  addLabor('Foreman', block.foreman);

  // Pull any GPS/fleet truck data from today (from equipmentFleet if status was updated today)
  var truckData = [];
  equipmentFleet.filter(function(e) {
    return e.active !== false && (e.type === 'dump_truck' || e.type === 'tack_truck') && e.statusUpdatedAt;
  }).forEach(function(e) {
    var updDate = (e.statusUpdatedAt || '').slice(0, 10);
    if (updDate === dateKey) truckData.push({ name: e.name || e.id, start: '', ending: '', trailer: false, triaxle: false });
  });
  // Pad trucks to 18 slots
  while (truckData.length < 18) truckData.push({});

  return {
    id: 'fr_auto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    date:            dateKey,
    startingTime:    '',
    endingTime:      '',
    jobLocation:     jobLoc,
    jobNumber:       block.jobNumber || '',
    gcName:          gcN,
    plantLocation:   plantLoc,
    foreman:         block.foreman || '',
    labor:           labor,
    workItems:       [],
    tackCostGal:     0,
    hotRubberLft:    0,
    hotRubberFt:     0,
    equipment:       {},
    trucks:          truckData,
    delayNotes:      'Auto-generated from schedule confirmation — please fill in production details.',
    foremanSignature:'',
    autoGenerated:   true,
    createdAt:       Date.now(),
    updatedAt:       Date.now()
  };
}

// ── Smart location search ──────────────────────────────────────────────────────
function _crewConfirmLocationSearch(query) {
  var q = (query || '').toLowerCase().trim();
  var results = [];
  var seen = {};
  var add = function(label, sub) {
    var key = label.toLowerCase();
    if (!seen[key] && label) { seen[key] = true; results.push({ label: label, sub: sub || '' }); }
  };
  // From backlog
  (backlogJobs || []).forEach(function(j) {
    if (j.jobName && (!q || j.jobName.toLowerCase().includes(q))) add(j.jobName, j.gcName || '');
  });
  // From schedule (all dates)
  Object.keys(schedData).forEach(function(dk) {
    var d = schedData[dk] || {};
    [d.top, d.bottom].concat((d.extras || []).map(function(e){ return e && e.data; })).forEach(function(bl) {
      if (!bl) return;
      var f = bl.fields || {};
      var loc = f.jobName || f.location || '';
      if (loc && (!q || loc.toLowerCase().includes(q))) add(loc, f.gcName || '');
    });
  });
  // From existing Foreman Reports
  foremanReports.forEach(function(r) {
    if (r.jobLocation && (!q || r.jobLocation.toLowerCase().includes(q))) add(r.jobLocation, r.gcName || '');
  });
  // From jobs list
  (jobs || []).forEach(function(j) {
    var loc = j.jobLocation || j.jobName || '';
    if (loc && (!q || loc.toLowerCase().includes(q))) add(loc, j.gcName || '');
  });
  return results.slice(0, 10);
}

// ── Main confirmation popup ───────────────────────────────────────────────────
function _crewConfirmShow(dateKey, shift) {
  var sessionKey = dateKey + '_' + shift;
  if (_crewConfirmAlreadyDone(sessionKey)) return;

  var blocks = _crewConfirmGetScheduleBlocks(dateKey);
  if (!blocks.length) return; // Nothing scheduled

  // Filter: evening = all non-night; morning = night-only
  var relevant = blocks.filter(function(b) {
    return shift === 'morning' ? b.isNight : true;
  });
  if (!relevant.length) return;

  // Only show if at least one crew is missing a report
  var missing = relevant.filter(function(b) { return !_crewConfirmReportExists(dateKey, b.foreman); });
  if (!missing.length) { _crewConfirmMark(sessionKey); return; }

  _crewConfirmShown[sessionKey] = true;

  var dateLabel = new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  var shiftLabel = shift === 'morning' ? 'last night\'s night crews' : 'today\'s crews';

  var crewRows = missing.map(function(b, i) {
    var locLine = [b.jobLocation, b.gcName].filter(Boolean).join(' — ');
    return '<div style="background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:10px 14px;margin-bottom:8px;" id="_ccBlock_'+i+'">'+
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">'+
        '<span style="font-family:\'DM Sans\',sans-serif;font-size:12px;font-weight:700;color:var(--white);">👷 '+escHtml(b.foreman)+'</span>'+
        '<span style="flex:1;"></span>'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+escHtml(b.type)+'</span>'+
      '</div>'+
      (locLine ? '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);margin-bottom:10px;">📍 '+escHtml(locLine)+'</div>' : '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);margin-bottom:10px;">📍 No location scheduled</div>')+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--concrete-dim);margin-bottom:6px;">Were they at this location?</div>'+
      '<div style="display:flex;gap:8px;">'+
        '<button onclick="_ccHandleYes('+i+',\''+dateKey+'\',\''+sessionKey+'\')" '+
          'style="flex:1;padding:8px;background:rgba(61,158,106,0.12);border:1px solid rgba(61,158,106,0.4);border-radius:var(--radius);color:#7ecb8f;font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">✓ Yes</button>'+
        '<button onclick="_ccHandleNo('+i+',\''+dateKey+'\',\''+sessionKey+'\')" '+
          'style="flex:1;padding:8px;background:rgba(217,79,61,0.08);border:1px solid rgba(217,79,61,0.4);border-radius:var(--radius);color:var(--red);font-family:\'DM Mono\',monospace;font-size:11px;font-weight:700;cursor:pointer;">✗ No</button>'+
      '</div>'+
    '</div>';
  }).join('');

  var overlay = document.createElement('div');
  overlay.id = '_crewConfirmOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9500;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div style="background:var(--asphalt-mid);border:2px solid rgba(245,197,24,0.4);border-radius:var(--radius-lg);width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">'+
      '<div style="display:flex;align-items:flex-start;padding:18px 22px 14px;border-bottom:1px solid var(--asphalt-light);flex-shrink:0;">'+
        '<div>'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:2px;color:var(--stripe);">📋 Crew Location Check</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--concrete-dim);margin-top:2px;">Confirming '+escHtml(shiftLabel)+' — '+escHtml(dateLabel)+'</div>'+
        '</div>'+
        '<span style="flex:1;"></span>'+
        '<button onclick="_crewConfirmDismiss(\''+sessionKey+'\')" style="background:none;border:none;color:var(--concrete-dim);font-size:18px;cursor:pointer;padding:0;line-height:1;">✕</button>'+
      '</div>'+
      '<div id="_ccCrewBlocks" style="flex:1;overflow-y:auto;padding:16px 22px;">'+crewRows+'</div>'+
      '<div style="padding:12px 22px;border-top:1px solid var(--asphalt-light);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;">'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Confirm to auto-draft Foreman\'s Reports</span>'+
        '<button onclick="_crewConfirmDismiss(\''+sessionKey+'\')" style="background:none;border:1px solid var(--asphalt-light);border-radius:var(--radius);padding:6px 14px;color:var(--concrete-dim);font-family:\'DM Mono\',monospace;font-size:10px;cursor:pointer;">Remind me later</button>'+
      '</div>'+
    '</div>';

  // Store missing blocks on the overlay so handlers can access them
  overlay._ccMissingBlocks = missing;
  overlay._ccDateKey = dateKey;
  document.body.appendChild(overlay);
}

function _crewConfirmDismiss(sessionKey) {
  var ov = document.getElementById('_crewConfirmOverlay');
  if (ov) ov.remove();
  // Don't mark as done — just session-suppress so it can re-appear on next reload
}

// YES handler — auto-generate Foreman's Report and open form
function _ccHandleYes(blockIdx, dateKey, sessionKey) {
  var ov = document.getElementById('_crewConfirmOverlay');
  var block = ov && ov._ccMissingBlocks ? ov._ccMissingBlocks[blockIdx] : null;
  if (!block) return;

  // Mark this block row as done
  var blockEl = document.getElementById('_ccBlock_' + blockIdx);
  if (blockEl) {
    blockEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">'+
      '<span style="color:#7ecb8f;font-size:14px;">✓</span>'+
      '<span style="font-family:\'DM Sans\',sans-serif;font-size:11px;color:#7ecb8f;">Report drafted for '+escHtml(block.foreman)+'</span>'+
    '</div>';
  }

  // Build and save draft report
  var report = _crewConfirmBuildReport(dateKey, block, null);
  foremanReports.push(report);
  saveForemanReports();
  pushNotif('success', 'Report Drafted', 'Foreman\'s Report auto-created for '+block.foreman+' — '+block.jobLocation+'. Open Foremen\'s Reports to fill in production details.');

  // Open the report form for review/completion
  setTimeout(function() { openForemanReportForm(report.id); }, 400);

  _ccCheckAllDone(ov, sessionKey);
}

// NO handler — show smart location search
function _ccHandleNo(blockIdx, dateKey, sessionKey) {
  var ov = document.getElementById('_crewConfirmOverlay');
  var block = ov && ov._ccMissingBlocks ? ov._ccMissingBlocks[blockIdx] : null;
  if (!block) return;

  var blockEl = document.getElementById('_ccBlock_' + blockIdx);
  if (!blockEl) return;

  blockEl.innerHTML =
    '<div>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+
        '<span style="font-family:\'DM Sans\',sans-serif;font-size:12px;font-weight:700;color:var(--white);">👷 '+escHtml(block.foreman)+'</span>'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--red);margin-left:4px;">— Not at scheduled location</span>'+
      '</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--concrete-dim);margin-bottom:6px;">Where were they? (search job name, address, or location)</div>'+
      '<div style="position:relative;">'+
        '<input class="form-input" id="_ccSearch_'+blockIdx+'" autocomplete="off" placeholder="Start typing to search..." '+
          'oninput="_ccSearchInput('+blockIdx+')" '+
          'style="font-size:12px;padding:8px 12px;width:100%;"/>'+
        '<div id="_ccDropdown_'+blockIdx+'" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:var(--radius);z-index:100;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.5);"></div>'+
      '</div>'+
      '<div id="_ccSelectedLoc_'+blockIdx+'" style="display:none;margin-top:8px;">'+
        '<div style="display:flex;align-items:center;gap:8px;">'+
          '<div id="_ccSelectedText_'+blockIdx+'" style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);flex:1;"></div>'+
          '<button onclick="_ccConfirmAltLocation('+blockIdx+',\''+dateKey+'\',\''+sessionKey+'\')" '+
            'style="background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.5);border-radius:var(--radius);padding:5px 14px;color:var(--stripe);font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;cursor:pointer;">Confirm & Draft Report</button>'+
        '</div>'+
      '</div>'+
    '</div>';
}

function _ccSearchInput(blockIdx) {
  var inp = document.getElementById('_ccSearch_' + blockIdx);
  var dd = document.getElementById('_ccDropdown_' + blockIdx);
  if (!inp || !dd) return;
  var q = inp.value.trim();
  var results = _crewConfirmLocationSearch(q);
  if (!results.length) { dd.style.display = 'none'; return; }
  dd.style.display = '';
  dd.innerHTML = results.map(function(r) {
    return '<div onclick="_ccSelectLocation('+blockIdx+',\''+escHtml(r.label).replace(/'/g,"\\'")+'\')" '+
      'style="padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);" '+
      'onmouseover="this.style.background=\'var(--asphalt-light)\'" onmouseout="this.style.background=\'\'">'+
      '<div style="font-family:\'DM Sans\',sans-serif;font-size:11px;font-weight:600;color:var(--white);">'+escHtml(r.label)+'</div>'+
      (r.sub ? '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">'+escHtml(r.sub)+'</div>' : '')+
    '</div>';
  }).join('');
}

function _ccSelectLocation(blockIdx, label) {
  var inp = document.getElementById('_ccSearch_' + blockIdx);
  var dd = document.getElementById('_ccDropdown_' + blockIdx);
  var selDiv = document.getElementById('_ccSelectedLoc_' + blockIdx);
  var selTxt = document.getElementById('_ccSelectedText_' + blockIdx);
  if (inp) inp.value = label;
  if (dd) dd.style.display = 'none';
  if (selTxt) selTxt.textContent = '📍 ' + label;
  if (selDiv) selDiv.style.display = '';
  // Store on input element for retrieval
  if (inp) inp.dataset.selected = label;
}

function _ccConfirmAltLocation(blockIdx, dateKey, sessionKey) {
  var ov = document.getElementById('_crewConfirmOverlay');
  var block = ov && ov._ccMissingBlocks ? ov._ccMissingBlocks[blockIdx] : null;
  var inp = document.getElementById('_ccSearch_' + blockIdx);
  if (!block || !inp) return;

  var loc = inp.dataset.selected || inp.value.trim();
  if (!loc) { inp.focus(); return; }

  var blockEl = document.getElementById('_ccBlock_' + blockIdx);
  if (blockEl) {
    blockEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">'+
      '<span style="color:var(--stripe);font-size:14px;">✓</span>'+
      '<span style="font-family:\'DM Sans\',sans-serif;font-size:11px;color:var(--stripe);">Report drafted for '+escHtml(block.foreman)+' at '+escHtml(loc)+'</span>'+
    '</div>';
  }

  var report = _crewConfirmBuildReport(dateKey, block, loc);
  foremanReports.push(report);
  saveForemanReports();
  pushNotif('info', 'Report Drafted', 'Foreman\'s Report for '+block.foreman+' at '+loc+' — please fill in production details.');

  setTimeout(function() { openForemanReportForm(report.id); }, 400);

  _ccCheckAllDone(ov, sessionKey);
}

// ═══════════════════════════════════════════════════════
// INVOICE TRACKER — Weekly Grid UI
// ═══════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────────────
var invoiceActiveMonth = null; // 'YYYY-MM' or ['YYYY-01','YYYY-02','YYYY-03'] for Q1
var invoiceActiveWeek  = null; // 'YYYY-MM-DD' Monday of selected week, or null = all weeks
var invSearchQuery = '';
var _invSearchDebounceTimer = null;
var _invMixCount = 1;

// ── Format helpers ────────────────────────────────────────────────────────────
function invFmt(n) {
  var v = parseFloat(n);
  if (isNaN(v)) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function invFmtTons(n) {
  var v = parseFloat((n || '').toString().replace(/,/g, ''));
  if (isNaN(v)) return n || '';
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function invFmtDate(dateStr) {
  if (!dateStr) return '—';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Week range helpers ─────────────────────────────────────────────────────────
function invWeekRange(offset) {
  var today = new Date();
  var dow = today.getDay();
  var diffToMon = (dow === 0) ? -6 : 1 - dow;
  var mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + (offset * 7));
  mon.setHours(0, 0, 0, 0);
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(mon);
    d.setDate(mon.getDate() + i);
    var yr = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var dy = String(d.getDate()).padStart(2, '0');
    days.push({
      key:   yr + '-' + mo + '-' + dy,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }),
      dow:   d.getDay()
    });
  }
  return days; // days[0]=Mon … days[6]=Sun
}

function invWeekLabel(offset) {
  var days = invWeekRange(offset);
  var mp = days[0].key.split('-');
  var fp = days[4].key.split('-');
  var mon = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
  var fri = new Date(parseInt(fp[0]), parseInt(fp[1]) - 1, parseInt(fp[2]));
  return mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' – '
    + fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Month/week navigation helpers ────────────────────────────────────────────
function _invCurrentMonth() {
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function _invDefaultMonth() {
  var now = new Date();
  var yr = now.getFullYear();
  var mo = now.getMonth() + 1;
  if (mo <= 3) return [yr + '-01', yr + '-02', yr + '-03'];
  return yr + '-' + String(mo).padStart(2, '0');
}

function _invMonthDayKeys(monthStr) {
  var p = monthStr.split('-');
  var yr = parseInt(p[0]);
  var mo = parseInt(p[1]) - 1;
  var d = new Date(yr, mo, 1);
  var keys = [];
  while (d.getMonth() === mo) {
    keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

function _invActiveDayKeys() {
  var months = Array.isArray(invoiceActiveMonth) ? invoiceActiveMonth : [invoiceActiveMonth || _invCurrentMonth()];
  var keys = [];
  months.forEach(function(m) { keys = keys.concat(_invMonthDayKeys(m)); });
  return keys;
}

function _invMondayOf(dateKey) {
  var p = dateKey.split('-');
  var d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  var dow = d.getDay();
  d.setDate(d.getDate() + ((dow === 0) ? -6 : 1 - dow));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _invWeekFromMonday(mondayKey) {
  var p = mondayKey.split('-');
  var mon = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(mon);
    d.setDate(mon.getDate() + i);
    var yr = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var dy = String(d.getDate()).padStart(2, '0');
    days.push({
      key:   yr + '-' + mo + '-' + dy,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }),
      dow:   d.getDay()
    });
  }
  return days;
}

function _invWeeksWithData() {
  var dayKeys = _invActiveDayKeys();
  var dayKeySet = {};
  dayKeys.forEach(function(k) { dayKeySet[k] = true; });
  var dateDates = {};
  invoiceList.forEach(function(inv) {
    if (dayKeySet[inv.dateOfWork]) dateDates[inv.dateOfWork] = true;
  });
  _invGetSubsForPeriod(dayKeys).forEach(function(sub) {
    if (dayKeySet[sub.date]) dateDates[sub.date] = true;
  });
  var mondaySeen = {};
  Object.keys(dateDates).forEach(function(dk) { mondaySeen[_invMondayOf(dk)] = true; });
  return Object.keys(mondaySeen).sort();
}

function invSetMonth(mStr) {
  if (mStr === 'q1') {
    var yr = new Date().getFullYear();
    invoiceActiveMonth = [yr + '-01', yr + '-02', yr + '-03'];
  } else {
    invoiceActiveMonth = mStr;
  }
  invoiceActiveWeek = null;
  renderInvoiceTracker();
}

function invSetWeek(mondayKey) {
  invoiceActiveWeek = mondayKey || null;
  renderInvoiceTracker();
}

function _invActiveLabel() {
  var yr = new Date().getFullYear();
  if (invoiceActiveWeek) {
    var wd = _invWeekFromMonday(invoiceActiveWeek);
    var mp = wd[0].key.split('-'), fp = wd[4].key.split('-');
    var mD = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
    var fD = new Date(parseInt(fp[0]), parseInt(fp[1]) - 1, parseInt(fp[2]));
    return 'Week of ' + mD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' – ' + fD.toLocaleDateString('en-US', { day: 'numeric' });
  }
  if (Array.isArray(invoiceActiveMonth)) return 'Jan – Mar ' + yr;
  var p = (invoiceActiveMonth || _invCurrentMonth()).split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function _invRenderMonthTabs(canEdit) {
  var yr = new Date().getFullYear();
  var isQ1 = Array.isArray(invoiceActiveMonth);
  var MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MNUMS  = ['04',  '05',  '06',  '07',  '08',  '09',  '10',  '11',  '12'];
  var html = '<div class="inv2-month-tabs">';
  html += '<button class="inv2-month-tab' + (isQ1 ? ' inv2-tab-active' : '') + '" onclick="invSetMonth(\'q1\')">Jan – Mar</button>';
  MONTHS.forEach(function(mName, i) {
    var mStr = yr + '-' + MNUMS[i];
    var active = !isQ1 && invoiceActiveMonth === mStr;
    html += '<button class="inv2-month-tab' + (active ? ' inv2-tab-active' : '') + '" onclick="invSetMonth(\'' + mStr + '\')">' + mName + '</button>';
  });
  if (canEdit) {
    html += '<button class="inv-btn" style="margin-left:auto;flex-shrink:0;" onclick="openInvoiceModal(null)">+ Add Invoice</button>';
  }
  html += '</div>';
  return html;
}

function _invRenderWeekTabs() {
  var weeks = _invWeeksWithData();
  var html = '<div class="inv2-week-tabs">';
  html += '<button class="inv2-week-tab' + (!invoiceActiveWeek ? ' inv2-tab-active' : '') + '" onclick="invSetWeek(null)">All Weeks</button>';
  if (weeks.length === 0) {
    html += '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);padding:0 8px;">No invoices this '
      + (Array.isArray(invoiceActiveMonth) ? 'quarter' : 'month') + '</span>';
  } else {
    weeks.forEach(function(mondayKey) {
      var wd = _invWeekFromMonday(mondayKey);
      var mp = wd[0].key.split('-'), fp = wd[4].key.split('-');
      var mD = new Date(parseInt(mp[0]), parseInt(mp[1]) - 1, parseInt(mp[2]));
      var fD = new Date(parseInt(fp[0]), parseInt(fp[1]) - 1, parseInt(fp[2]));
      var lbl = mD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ' – ' + fD.toLocaleDateString('en-US', { day: 'numeric' });
      html += '<button class="inv2-week-tab' + (invoiceActiveWeek === mondayKey ? ' inv2-tab-active' : '') + '" onclick="invSetWeek(\'' + mondayKey + '\')">' + lbl + '</button>';
    });
  }
  html += '</div>';
  return html;
}

function _invRenderWeekGrid(activeDays, rows, todayKey, subItems) {
  var roster = (typeof foremanRoster !== 'undefined' && Array.isArray(foremanRoster)) ? foremanRoster : [];
  var foremanSeen = {};
  rows.forEach(function(inv) { foremanSeen[inv.foreman || '(No Foreman)'] = true; });
  var foremans = Object.keys(foremanSeen).sort(function(a, b) {
    var ai = roster.indexOf(a), bi = roster.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });
  var isMobile = window.innerWidth <= 768;
  var colMin   = isMobile ? '72px'  : '260px';
  var lblWidth = isMobile ? '52px'  : '140px';
  var gridCols = lblWidth + ' ' + activeDays.map(function() { return 'minmax(' + colMin + ',1fr)'; }).join(' ');
  var hdr = '<div class="inv2-corner-cell"></div>'
    + activeDays.map(function(day) {
        return '<div class="inv2-day-head' + (day.key === todayKey ? ' inv2-today' : '') + '">' + day.label + '</div>';
      }).join('');
  var dataRows = foremans.map(function(foreman) {
    var row = '<div class="inv2-foreman-cell"><span>' + escHtml(foreman) + '</span></div>';
    row += activeDays.map(function(day) {
      var cellInvs = rows.filter(function(inv) {
        return (inv.foreman || '(No Foreman)') === foreman && inv.dateOfWork === day.key;
      });
      return '<div class="inv2-day-cell' + (cellInvs.length === 0 ? ' inv2-cell-empty' : '') + '">'
        + cellInvs.map(function(inv) { return _invRenderCard(inv); }).join('')
        + '</div>';
    }).join('');
    return row;
  }).join('');
  var _SUB_ORDER_W = ['Milling', 'Grading', 'QC', 'Tack', 'Rubber', 'Lowbed'];
  var subByType = {};
  (subItems || []).forEach(function(sub) {
    if (!subByType[sub.type]) subByType[sub.type] = {};
    if (!subByType[sub.type][sub.date]) subByType[sub.type][sub.date] = [];
    subByType[sub.type][sub.date].push(sub);
  });
  var subRows = '';
  if (subItems && subItems.length > 0) {
    subRows += '<div class="inv2-sub-divider">Subcontractors</div>';
    _SUB_ORDER_W.forEach(function(typeName) {
      if (!subByType[typeName]) return;
      var row = '<div class="inv2-foreman-cell inv2-sub-type-lbl"><span>' + escHtml(typeName) + '</span></div>';
      row += activeDays.map(function(day) {
        var daySubs = (subByType[typeName][day.key]) || [];
        return '<div class="inv2-day-cell' + (daySubs.length === 0 ? ' inv2-cell-empty' : '') + '">'
          + daySubs.map(function(sub) { return _invRenderSubCard(sub); }).join('')
          + '</div>';
      }).join('');
      subRows += row;
    });
  }
  return '<div class="inv2-grid" style="grid-template-columns:' + gridCols + ';">'
    + hdr + dataRows + subRows + '</div>';
}

// ── Migration: promote flat brkCount/brkCost to brkRows array ─────────────────
function _invMigrateBrokerRows() {
  var changed = false;
  invoiceList.forEach(function(inv) {
    if (!inv.actualTrucking) return;
    if (!inv.actualTrucking.brkRows) {
      var count = inv.actualTrucking.brkCount || 0;
      var cost  = inv.actualTrucking.brkCost  || 0;
      inv.actualTrucking.brkRows = (count > 0 || cost > 0)
        ? [{ name: 'Broker', count: count, cost: cost }]
        : [];
      changed = true;
    }
  });
  if (changed) saveInvoiceList();
}

// ── Billed total: sum of mix item totals + supplier truck cost ─────────────────
function invCardBilledTotal(inv) {
  var mix = (inv.mixItems || []).reduce(function(s, m) {
    return s + (parseFloat(m.itemTotal) || 0);
  }, 0);
  return mix + (((inv.actualTrucking || {}).supCost) || 0);
}

// ── Search ─────────────────────────────────────────────────────────────────────
function invSetSearch(val) {
  invSearchQuery = val;
  clearTimeout(_invSearchDebounceTimer);
  _invSearchDebounceTimer = setTimeout(function() {
    renderInvoiceTracker();
    var inp = document.querySelector('.inv2-search-input');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }, 300);
}

// ── Inline edit helpers ────────────────────────────────────────────────────────
function invInlineEdit(id, field, value) {
  var inv = invoiceList.find(function(i) { return i.id === id; });
  if (!inv) return;
  inv[field] = value;
  inv.updatedAt = Date.now();
  saveInvoiceList();
  if (field === 'dateOfWork') renderInvoiceTracker();
  else _invRefreshBilled(id);
}

function invMixInlineEdit(invId, mixIdx, field, value) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv || !inv.mixItems[mixIdx]) return;
  inv.mixItems[mixIdx][field] = value;
  if (field === 'tonQty' || field === 'mixPrice') {
    var t = parseFloat(inv.mixItems[mixIdx].tonQty) || 0;
    var p = parseFloat(inv.mixItems[mixIdx].mixPrice) || 0;
    if (t > 0 && p > 0) inv.mixItems[mixIdx].itemTotal = (t * p).toFixed(2);
  }
  inv.updatedAt = Date.now();
  saveInvoiceList();
  _invRefreshBilled(invId);
}

function invTruckInlineEdit(id, field, value) {
  var inv = invoiceList.find(function(i) { return i.id === id; });
  if (!inv) return;
  if (!inv.actualTrucking) inv.actualTrucking = {};
  inv.actualTrucking[field] = parseFloat(value) || 0;
  inv.updatedAt = Date.now();
  saveInvoiceList();
  _invRefreshBilled(id);
}

// ── Broker row inline edit helpers ─────────────────────────────────────────────
function invBrkRowInlineEdit(invId, rowIdx, field, value) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv || !inv.actualTrucking) return;
  var rows = inv.actualTrucking.brkRows || [];
  if (!rows[rowIdx]) return;
  rows[rowIdx][field] = (field === 'name') ? value : (parseFloat(value) || 0);
  inv.actualTrucking.brkRows  = rows;
  inv.actualTrucking.brkCount = rows.reduce(function(s, r) { return s + (r.count || 0); }, 0);
  inv.actualTrucking.brkCost  = rows.reduce(function(s, r) { return s + (r.cost  || 0); }, 0);
  inv.updatedAt = Date.now();
  saveInvoiceList();
  _invRefreshBilled(invId);
}

function invAddBrkRow(invId) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv) return;
  if (!inv.actualTrucking) inv.actualTrucking = {};
  if (!Array.isArray(inv.actualTrucking.brkRows)) inv.actualTrucking.brkRows = [];
  inv.actualTrucking.brkRows.push({ name: '', count: 0, cost: 0 });
  inv.updatedAt = Date.now();
  saveInvoiceList();
  var card = document.getElementById('inv2-card-' + invId);
  if (card) card.outerHTML = _invRenderCard(inv);
}

function invRemoveBrkRow(invId, rowIdx) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv || !inv.actualTrucking || !Array.isArray(inv.actualTrucking.brkRows)) return;
  inv.actualTrucking.brkRows.splice(rowIdx, 1);
  inv.actualTrucking.brkCount = inv.actualTrucking.brkRows.reduce(function(s, r) { return s + (r.count || 0); }, 0);
  inv.actualTrucking.brkCost  = inv.actualTrucking.brkRows.reduce(function(s, r) { return s + (r.cost  || 0); }, 0);
  inv.updatedAt = Date.now();
  saveInvoiceList();
  _invRefreshBilled(invId);
  var card = document.getElementById('inv2-card-' + invId);
  if (card) card.outerHTML = _invRenderCard(inv);
}

function invBrkActivateEdit(el) {
  if (el.querySelector('input,select')) return;
  var invId  = el.dataset.inv;
  var rowIdx = parseInt(el.dataset.brkidx);
  var field  = el.dataset.field;
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv || !inv.actualTrucking || !inv.actualTrucking.brkRows) return;
  var row = inv.actualTrucking.brkRows[rowIdx];
  if (!row) return;
  var rawVal = row[field];
  var saved = false;
  var ctl;
  if (field === 'name') {
    var brokers = typeof truckingBrokersList !== 'undefined' ? truckingBrokersList : [];
    if (brokers.length) {
      ctl = document.createElement('select');
      ctl.className = 'inv2-inline-input';
      ctl.style.width = '100%';
      ctl.innerHTML = '<option value="">— select —</option>'
        + brokers.map(function(b) {
            return '<option value="' + escHtml(b) + '"' + (b === rawVal ? ' selected' : '') + '>' + escHtml(b) + '</option>';
          }).join('');
    } else {
      ctl = document.createElement('input');
      ctl.className = 'inv2-inline-input';
      ctl.type = 'text';
      ctl.value = rawVal || '';
    }
  } else {
    ctl = document.createElement('input');
    ctl.className = 'inv2-inline-input';
    ctl.type = 'number';
    ctl.step = '0.01';
    ctl.min = '0';
    ctl.value = rawVal || '';
  }
  el.innerHTML = '';
  el.appendChild(ctl);
  ctl.focus();
  if (ctl.select && field !== 'name') ctl.select();
  function doSave() {
    if (saved) return;
    saved = true;
    var val = ctl.value.trim();
    invBrkRowInlineEdit(invId, rowIdx, field, val);
    var updInv = invoiceList.find(function(i) { return i.id === invId; });
    var updRow = (updInv && updInv.actualTrucking && updInv.actualTrucking.brkRows || [])[rowIdx];
    if (updRow) {
      if (field === 'name')        el.textContent = updRow.name || '—';
      else if (field === 'count')  el.textContent = updRow.count || '—';
      else                         el.textContent = updRow.cost && parseFloat(updRow.cost) ? invFmt(parseFloat(updRow.cost)) : '—';
    } else {
      el.textContent = val || '—';
    }
  }
  ctl.onblur = doSave;
  ctl.onkeydown = function(e) {
    if (e.key === 'Enter') { e.preventDefault(); ctl.blur(); }
    if (e.key === 'Escape') {
      saved = true; ctl.onblur = null; ctl.blur();
      el.textContent = (rawVal !== undefined && rawVal !== null && rawVal !== '') ? String(rawVal) : '—';
    }
  };
  if (field === 'name') ctl.onchange = doSave;
}

// ── Live DOM refresh helpers ───────────────────────────────────────────────────
function _invRefreshBilled(invId) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv) return;
  var total = invCardBilledTotal(inv);
  var billedEl = document.querySelector('[data-billed-for="' + invId + '"]');
  if (billedEl) billedEl.textContent = invFmt(total);
  var diffEl = document.querySelector('[data-billed-diff-for="' + invId + '"]');
  if (diffEl) {
    var appAmt = inv.approvedAmount
      ? parseFloat((inv.approvedAmount + '').replace(/[^0-9.\-]/g, '')) || 0
      : null;
    if (appAmt !== null && Math.abs(appAmt - total) > 0.005) {
      var diff = appAmt - total;
      diffEl.textContent = (diff > 0 ? '▲ ' : '▼ ') + invFmt(Math.abs(diff));
      diffEl.style.color = diff > 0 ? '#7ecb8f' : 'var(--red)';
      diffEl.style.display = '';
    } else {
      diffEl.style.display = 'none';
    }
  }
}

// ── Inline editing activation ──────────────────────────────────────────────────
function invActivateEdit(el) {
  if (el.querySelector('input,textarea')) return;

  var invId   = el.dataset.inv;
  var field   = el.dataset.field;
  var mi      = (el.dataset.mi !== undefined && el.dataset.mi !== '') ? el.dataset.mi : null;
  var isTruck = el.dataset.truck === '1';
  var isArea  = el.dataset.area === '1';
  var isNum   = el.dataset.num === '1';

  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv) return;

  var rawVal;
  if (isTruck) {
    rawVal = (inv.actualTrucking || {})[field];
  } else if (mi !== null) {
    rawVal = ((inv.mixItems || [])[parseInt(mi)] || {})[field];
  } else {
    rawVal = inv[field];
  }
  if (rawVal === undefined || rawVal === null) rawVal = '';
  if (isNum && typeof rawVal === 'string') rawVal = rawVal.replace(/[^0-9.\-]/g, '');

  var inp = isArea ? document.createElement('textarea') : document.createElement('input');
  inp.className = 'inv2-inline-input';
  if (!isArea) {
    inp.type = isNum ? 'number' : 'text';
    if (isNum) { inp.step = '0.01'; inp.min = '0'; }
  } else {
    inp.rows = 2;
  }
  inp.value = rawVal;
  el.innerHTML = '';
  el.appendChild(inp);
  inp.focus();
  if (inp.select) inp.select();

  var saved = false;

  function _dispFromInv(updInv) {
    var stored;
    if (isTruck)          stored = (updInv.actualTrucking || {})[field];
    else if (mi !== null) stored = ((updInv.mixItems || [])[parseInt(mi)] || {})[field];
    else                  stored = updInv[field];
    if (stored === undefined || stored === null || stored === '') return '—';
    var countFields = { dmcCount: 1, brkCount: 1, supCount: 1, tonQty: 1 };
    if (isNum && !countFields[field]) return invFmt(parseFloat(stored) || 0);
    return String(stored);
  }

  function doSave() {
    if (saved) return;
    saved = true;
    var val = inp.value.trim();
    if (isTruck)          invTruckInlineEdit(invId, field, val);
    else if (mi !== null) invMixInlineEdit(invId, parseInt(mi), field, val);
    else                  invInlineEdit(invId, field, val);
    var updInv = invoiceList.find(function(i) { return i.id === invId; });
    el.textContent = updInv ? _dispFromInv(updInv) : (val || '—');
  }

  inp.onblur = doSave;
  inp.onkeydown = function(e) {
    if (e.key === 'Enter' && !isArea) { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      saved = true;
      inp.onblur = null;
      var origInv = invoiceList.find(function(i) { return i.id === invId; });
      el.textContent = origInv ? _dispFromInv(origInv) : '—';
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      inp.blur();
      var card = el.closest('.inv2-card');
      if (!card) return;
      var all = Array.from(card.querySelectorAll('.inv2-editable'));
      var idx = all.indexOf(el);
      var next = all[(idx + 1) % all.length];
      if (next && next !== el) setTimeout(function() { next.click(); }, 30);
    }
  };
}

// ── Mix row HTML builder (card render + add/remove) ───────────────────────────
function _invMixRowsHtml(inv) {
  var canEdit = (typeof isAdmin === 'function' && isAdmin())
             || (typeof canEditTab === 'function' && canEditTab('ap'));
  return (inv.mixItems || []).map(function(m, mi) {
    var rowTotal = (m.itemTotal && parseFloat(m.itemTotal)) ? invFmt(parseFloat(m.itemTotal)) : '—';
    return '<div class="inv2-mix-row" data-mix-row="' + inv.id + '-' + mi + '">'
      + '<span class="inv2-editable inv-field inv2-mix-type" data-inv="' + inv.id + '" data-field="mixType" data-mi="' + mi + '" onclick="invActivateEdit(this)" title="Click to edit">' + escHtml(m.mixType || '—') + '</span>'
      + '<span class="inv2-editable inv-field inv2-mix-num" data-inv="' + inv.id + '" data-field="tonQty" data-mi="' + mi + '" data-num="1" onclick="invActivateEdit(this)" title="Click to edit">' + (m.tonQty || '—') + '</span>'
      + '<span class="inv2-editable inv-field inv2-mix-num" data-inv="' + inv.id + '" data-field="mixPrice" data-mi="' + mi + '" data-num="1" onclick="invActivateEdit(this)" title="Click to edit">' + (m.mixPrice && parseFloat(m.mixPrice) ? invFmt(parseFloat(m.mixPrice)) : '—') + '</span>'
      + '<span class="inv2-editable inv-field inv2-mix-num inv2-mix-total-cell" data-inv="' + inv.id + '" data-field="itemTotal" data-mi="' + mi + '" data-num="1" onclick="invActivateEdit(this)" title="Click to edit">' + rowTotal + '</span>'
      + (canEdit && inv.mixItems.length > 1
          ? '<button class="inv2-mix-del" onclick="event.stopPropagation();invRemoveMixRowFromCard(\'' + inv.id + '\',' + mi + ')" title="Remove">✕</button>'
          : '<span></span>')
      + '</div>';
  }).join('');
}

function invAddMixRowToCard(invId) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv) return;
  inv.mixItems.push({ mixType: '', tonQty: '', mixPrice: '', itemTotal: '' });
  inv.updatedAt = Date.now();
  saveInvoiceList();
  var mb = document.querySelector('[data-mix-body="' + invId + '"]');
  if (mb) mb.innerHTML = _invMixRowsHtml(inv);
  _invRefreshBilled(invId);
}

function invRemoveMixRowFromCard(invId, mi) {
  var inv = invoiceList.find(function(i) { return i.id === invId; });
  if (!inv || inv.mixItems.length <= 1) return;
  inv.mixItems.splice(mi, 1);
  inv.updatedAt = Date.now();
  saveInvoiceList();
  var mb = document.querySelector('[data-mix-body="' + invId + '"]');
  if (mb) mb.innerHTML = _invMixRowsHtml(inv);
  _invRefreshBilled(invId);
}

// ── Status toggles (printed / approved) ───────────────────────────────────────
function invToggleStatus(id, field) {
  var inv = invoiceList.find(function(i) { return i.id === id; });
  if (!inv) return;
  inv[field] = !inv[field];
  inv.updatedAt = Date.now();
  saveInvoiceList();
  renderInvoiceTracker();
}

// ── Delete invoice ─────────────────────────────────────────────────────────────
function deleteInvoice(id) {
  if (!confirm('Delete this invoice entry?')) return;
  invoiceList = invoiceList.filter(function(i) { return i.id !== id; });
  saveInvoiceList();
  renderInvoiceTracker();
}

// ── Single card renderer ───────────────────────────────────────────────────────
function _invRenderCard(inv) {
  var at       = inv.actualTrucking || {};
  var billed   = invCardBilledTotal(inv);
  var attCount = (inv.attachments || []).length;
  var canEdit  = (typeof isAdmin === 'function' && isAdmin())
              || (typeof canEditTab === 'function' && canEditTab('ap'));
  var appRaw   = inv.approvedAmount
    ? parseFloat((inv.approvedAmount + '').replace(/[^0-9.\-]/g, '')) || 0
    : null;
  var differs  = appRaw !== null && Math.abs(appRaw - billed) > 0.005;
  var diff     = differs ? (appRaw - billed) : null;

  function edSpan(field, val, cls) {
    return '<span class="inv2-editable' + (cls ? ' ' + cls : '') + '" data-inv="' + inv.id + '" data-field="' + field + '" onclick="invActivateEdit(this)" title="Click to edit">' + escHtml(val || '—') + '</span>';
  }
  function edTruckCount(field, val) {
    return '<span class="inv2-editable inv-field inv2-truck-count" data-inv="' + inv.id + '" data-field="' + field + '" data-truck="1" data-num="1" onclick="invActivateEdit(this)" title="Click to edit">' + (val || '—') + '</span>';
  }
  function edTruckCost(field, val) {
    return '<span class="inv2-editable inv-field inv2-truck-cost" data-inv="' + inv.id + '" data-field="' + field + '" data-truck="1" data-num="1" onclick="invActivateEdit(this)" title="Click to edit">' + (val && parseFloat(val) ? invFmt(parseFloat(val)) : '—') + '</span>';
  }

  return '<div class="inv2-card" id="inv2-card-' + inv.id + '">'

    // ── HEADER — Line 1: GC name (bold); Line 2: Job # · Project name ────────
    + '<div class="inv2-card-header">'
    +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;margin-bottom:3px;">'
    +     '<div style="flex:1;min-width:0;">'
    +       '<div style="font-family:\'DM Sans\',sans-serif;font-size:11px;font-weight:700;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
    +         edSpan('gcName', inv.gcName)
    +       '</div>'
    +       '<div style="display:flex;align-items:baseline;gap:3px;flex-wrap:nowrap;margin-top:2px;overflow:hidden;">'
    +         '<span style="font-family:\'DM Mono\',monospace;font-size:10px;font-weight:700;color:#8B1A1A;flex-shrink:0;">' + edSpan('jobNo', inv.jobNo) + '</span>'
    +         '<span style="color:var(--concrete-dim);font-size:10px;flex-shrink:0;">·</span>'
    +         '<span class="inv2-project-name" style="margin-bottom:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + edSpan('jobName', inv.jobName) + '</span>'
    +       '</div>'
    +     '</div>'
    +     (canEdit
            ? '<div class="inv2-header-acts">'
                + '<button class="inv2-icon-btn" onclick="event.stopPropagation();openInvoiceModal(\'' + inv.id + '\')" title="Edit in modal">✏️</button>'
                + '<button class="inv2-icon-btn inv2-del-btn" onclick="event.stopPropagation();deleteInvoice(\'' + inv.id + '\')" title="Delete">✕</button>'
                + '</div>'
            : '')
    +   '</div>'
    +   '<div class="inv2-supplier-name">' + edSpan('supplier', inv.supplier) + '</div>'
    +   '<div class="inv2-inv-meta">'
    +     '<span class="inv2-inv-badge">' + edSpan('invoiceNo', inv.invoiceNo || 'INV #') + '</span>'
    +     '<div class="inv2-status-btns">'
    +       '<button class="inv2-status-btn' + (inv.printed ? ' inv2-status-printed' : '') + '" onclick="event.stopPropagation();invToggleStatus(\'' + inv.id + '\',\'printed\')">' + (inv.printed ? '✔ Printed' : '🖨 Print') + '</button>'
    +       '<button class="inv2-status-btn' + (inv.approved ? ' inv2-status-approved' : '') + '" onclick="event.stopPropagation();invToggleStatus(\'' + inv.id + '\',\'approved\')">' + (inv.approved ? '✔ Approved' : '✅ Approve') + '</button>'
    +     '</div>'
    +   '</div>'
    + '</div>'

    // ── SPACER ───────────────────────────────────────────────────────────────
    + '<div style="height:4px;"></div>'

    // ── TRUCKING (before mix) ────────────────────────────────────────────────
    + '<div class="inv2-trucking">'
    +   '<div class="inv2-truck-hdr">Trucking</div>'
    +   '<div class="inv2-truck-row"><span class="inv2-truck-icon">🟡</span><span class="inv2-truck-lbl">DMC</span>' + edTruckCount('dmcCount', at.dmcCount) + edTruckCost('dmcCost', at.dmcCost) + '</div>'
    +   (function() {
          var brkRows = at.brkRows || [];
          var rowsHtml = brkRows.length
            ? brkRows.map(function(br, i) {
                return '<div class="inv2-truck-row">'
                  + '<span class="inv2-truck-icon">🔵</span>'
                  + '<span class="inv2-editable inv-field inv2-truck-lbl" data-inv="' + inv.id + '" data-brkidx="' + i + '" data-field="name" onclick="invBrkActivateEdit(this)" title="Click to change broker">' + escHtml(br.name || '—') + '</span>'
                  + '<span class="inv2-editable inv-field inv2-truck-count" data-inv="' + inv.id + '" data-brkidx="' + i + '" data-field="count" onclick="invBrkActivateEdit(this)" title="Click to edit">' + (br.count || '—') + '</span>'
                  + '<span class="inv2-editable inv-field inv2-truck-cost" data-inv="' + inv.id + '" data-brkidx="' + i + '" data-field="cost" onclick="invBrkActivateEdit(this)" title="Click to edit">' + (br.cost && parseFloat(br.cost) ? invFmt(parseFloat(br.cost)) : '—') + '</span>'
                  + (canEdit ? '<button style="background:none;border:none;cursor:pointer;color:var(--concrete-dim);font-size:11px;padding:0 3px;line-height:1;" onclick="event.stopPropagation();invRemoveBrkRow(\'' + inv.id + '\',' + i + ')" title="Remove">✕</button>' : '')
                  + '</div>';
              }).join('')
            : '<div class="inv2-truck-row"><span class="inv2-truck-icon">🔵</span><span class="inv2-truck-lbl" style="color:var(--concrete-dim);font-style:italic;">No broker trucks</span></div>';
          var addBtn = canEdit
            ? '<button style="font-size:10px;padding:1px 6px;margin:1px 0 3px;background:none;border:1px dashed rgba(126,203,143,0.3);border-radius:3px;color:var(--concrete-dim);cursor:pointer;width:100%;" onclick="event.stopPropagation();invAddBrkRow(\'' + inv.id + '\')">+ Broker</button>'
            : '';
          return rowsHtml + addBtn;
        }())
    +   '<div class="inv2-truck-row"><span class="inv2-truck-icon">🟢</span><span class="inv2-truck-lbl">Supplier</span>' + edTruckCount('supCount', at.supCount) + edTruckCost('supCost', at.supCost) + '</div>'
    + '</div>'

    // ── SPACER ───────────────────────────────────────────────────────────────
    + '<div style="height:4px;"></div>'

    // ── MIX SECTION ─────────────────────────────────────────────────────────
    + '<div class="inv2-mix-section">'
    +   '<div class="inv2-mix-header">'
    +     '<span>Mix Type</span><span style="text-align:right;">Tons</span><span style="text-align:right;">$/ton</span><span style="text-align:right;">Total</span><span></span>'
    +   '</div>'
    +   '<div data-mix-body="' + inv.id + '">' + _invMixRowsHtml(inv) + '</div>'
    +   (canEdit ? '<button class="inv2-add-mix" onclick="event.stopPropagation();invAddMixRowToCard(\'' + inv.id + '\')">+ Add Mix Type</button>' : '')
    + '</div>'

    // ── BILLING (standalone, full width) ────────────────────────────────────
    +   '<div class="inv2-billing" style="width:auto;">'
    +     '<div class="inv2-billed-row">'
    +       '<span class="inv2-billing-lbl">Billed</span>'
    +       '<span class="inv2-billed-amt' + (differs ? ' inv2-billed-differ' : '') + '" data-billed-for="' + inv.id + '">' + invFmt(billed) + '</span>'
    +     '</div>'
    +     '<div class="inv2-approved-row">'
    +       '<span class="inv2-billing-lbl">Approved</span>'
    +       '<span class="inv2-editable inv-field inv2-approved-amt" data-inv="' + inv.id + '" data-field="approvedAmount" data-num="1" onclick="invActivateEdit(this)" title="Click to edit">'
    +         (appRaw !== null ? invFmt(appRaw) : '—')
    +       '</span>'
    +     '</div>'
    +     '<div class="inv2-diff-row" data-billed-diff-for="' + inv.id + '" style="'
    +         (diff !== null ? 'color:' + (diff > 0 ? '#7ecb8f' : 'var(--red)') + ';' : 'display:none;') + '">'
    +       (diff !== null ? (diff > 0 ? '▲ ' : '▼ ') + invFmt(Math.abs(diff)) : '')
    +     '</div>'
    +     '<div class="inv2-notes-wrap">'
    +       '<span class="inv2-editable inv-field inv2-notes" data-inv="' + inv.id + '" data-field="invoiceNotes" data-area="1" onclick="invActivateEdit(this)" title="Click to add notes">'
    +         escHtml(inv.invoiceNotes || 'Notes…')
    +       '</span>'
    +     '</div>'
    +     '<div class="inv2-att-row">'
    +       '<button class="inv2-att-btn" onclick="event.stopPropagation();' + (attCount ? 'viewInvAttachments(\'' + inv.id + '\')' : 'openInvoiceModal(\'' + inv.id + '\')') + '" title="' + (attCount ? attCount + ' file' + (attCount > 1 ? 's' : '') : 'Attach files') + '">'
    +         '📎' + (attCount ? ' ' + attCount : '')
    +       '</button>'
    +     '</div>'
    +   '</div>'

  + '</div>'; // .inv2-card
}

// ── Subcontractor period collector (Part 3a) ───────────────────────────────────
function _invGetSubsForPeriod(dayKeys) {
  var results = [];
  var keySet  = {};
  dayKeys.forEach(function(k) { keySet[k] = true; });
  var sched = (typeof schedData !== 'undefined') ? schedData : {};
  var sas   = (typeof specialActions !== 'undefined') ? specialActions : [];

  // Day-level SA chips: Milling and sub Grading
  dayKeys.forEach(function(dateKey) {
    var dn    = sched[dateKey] || {};
    var saIds = dn.dayNoteSA || [];
    var locs  = dn.dayNoteSALocations || {};
    saIds.forEach(function(sid) {
      var sa = sas.find(function(s) { return s.id === sid; });
      if (!sa) return;
      var rawLoc = locs[sid];
      var locStr = (rawLoc && typeof rawLoc === 'object') ? (rawLoc.location || '') : (rawLoc || '');
      var subCo  = (rawLoc && typeof rawLoc === 'object') ? (rawLoc.subCompany || '') : '';

      if ((typeof _saIsMillingAction === 'function') && _saIsMillingAction(sa)) {
        if (subCo) {
          results.push({ date: dateKey, type: 'Milling', subCompany: subCo, jobRef: locStr,
            estCost: 0, actualCost: 0, invoiceNo: '', id: 'mill_' + dateKey + '_' + sid });
        }
        return;
      }
      if ((typeof _saIsSubGrader === 'function') && _saIsSubGrader(sa.label)) {
        results.push({ date: dateKey, type: 'Grading', subCompany: sa.label, jobRef: locStr,
          estCost: 0, actualCost: 0, invoiceNo: '', id: 'grad_' + dateKey + '_' + sid });
      }
    });
  });

  // Block-level fields: QC, Tack, Rubber (Others only)
  var QTR_MAP = { qc: 'QC', tack: 'Tack', rubber: 'Rubber' };
  dayKeys.forEach(function(dateKey) {
    var day = sched[dateKey] || {};
    var slots = ['top', 'bottom'];
    if (Array.isArray(day.extras)) {
      day.extras.forEach(function(ex, xi) { slots.push('extra_' + xi); });
    }
    slots.forEach(function(slot) {
      var bdata = null;
      if (slot === 'top' || slot === 'bottom') {
        bdata = day[slot];
      } else {
        var xi = parseInt(slot.replace('extra_', ''));
        bdata = (day.extras && day.extras[xi]) ? day.extras[xi].data : null;
      }
      if (!bdata || !bdata.fields) return;
      var f = bdata.fields;
      var jobRef = f.jobName || (f.jobNum ? '#' + f.jobNum : '') || '';
      Object.keys(QTR_MAP).forEach(function(fk) {
        var val = f[fk];
        if (typeof _isQTROthers === 'function' ? _isQTROthers(val) : (val === 'Others' || (val && val.type === 'Others'))) {
          var sub = (val && typeof val === 'object') ? val : { type: 'Others', subCompany: '', cost: 0, invoiceNo: '' };
          results.push({ date: dateKey, type: QTR_MAP[fk], subCompany: sub.subCompany || '',
            jobRef: jobRef, estCost: sub.cost || 0, actualCost: sub.cost || 0,
            invoiceNo: sub.invoiceNo || '', id: fk + '_' + dateKey + '_' + slot,
            _fk: fk, _slot: slot });
        }
      });
    });
  });

  // Lowbed plan moves
  try {
    var plan = JSON.parse(localStorage.getItem('dmc_lowbed_plan') || 'null');
    if (plan && Array.isArray(plan.jobs)) {
      plan.jobs.forEach(function(job) {
        if (!keySet[job.date]) return;
        (job.moves || []).forEach(function(mv, mi) {
          if (!mv.serviceType && !mv.towingCompany) return;
          results.push({ date: job.date, type: 'Lowbed',
            subCompany: mv.towingCompany || '', _serviceType: mv.serviceType || '',
            jobRef: (job.jobName || '') + (job.jobNum ? ' #' + job.jobNum : ''),
            estCost: mv.estCost || 0, actualCost: mv.actualCost || 0,
            invoiceNo: mv.towingInvoiceNo || '', id: 'lb_' + job.date + '_' + mi,
            _lbDate: job.date, _lbMoveIdx: mi });
        });
      });
    }
  } catch(e) {}

  return results;
}

// ── Sub card renderer (Part 3c) ────────────────────────────────────────────────
var _SUB_ICONS = { Milling: '⛏️', Grading: '🏗️', QC: '✅', Tack: '🟡', Rubber: '🔴', Lowbed: '🚛' };

function _invRenderSubCard(sub) {
  var canEdit = (typeof isAdmin === 'function' && isAdmin())
             || (typeof canEditTab === 'function' && canEditTab('ap'));
  var icon = _SUB_ICONS[sub.type] || '🔧';
  var html = '<div class="inv2-card" style="border-color:rgba(90,180,245,0.35);">';
  html += '<div class="inv2-truck-row">'
    + '<span class="inv2-truck-icon">' + icon + '</span>'
    + '<span style="flex:1;font-family:\'DM Sans\',sans-serif;font-size:11px;font-weight:700;color:var(--white);">' + escHtml(sub.subCompany || '—') + '</span>'
    + '</div>';
  if (sub._serviceType) {
    html += '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);margin-bottom:2px;">' + escHtml(sub._serviceType) + '</div>';
  }
  if (sub.jobRef) {
    html += '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);margin-bottom:4px;">' + escHtml(sub.jobRef) + '</div>';
  }
  html += '<div class="inv2-truck-row">'
    + '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Est:</span>'
    + '<span style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--stripe);margin-left:4px;">' + (sub.estCost ? invFmt(sub.estCost) : '—') + '</span>'
    + '</div>';
  if (canEdit) {
    html += '<div class="inv2-truck-row" style="margin-top:4px;">'
      + '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Actual:</span>'
      + '<input type="number" min="0" step="1" value="' + (sub.actualCost || '') + '" placeholder="0"'
      + ' data-subid="' + escHtml(sub.id) + '" onchange="invSubCostUpdate(this)"'
      + ' style="width:66px;background:rgba(0,0,0,0.25);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--white);font-family:\'DM Mono\',monospace;font-size:10px;padding:2px 5px;margin-left:4px;" />'
      + '</div>';
    html += '<div class="inv2-truck-row" style="margin-top:2px;">'
      + '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Inv #:</span>'
      + '<input type="text" value="' + escHtml(sub.invoiceNo || '') + '" placeholder="—"'
      + ' data-subid="' + escHtml(sub.id) + '" onchange="invSubInvNoUpdate(this)"'
      + ' style="flex:1;background:rgba(0,0,0,0.25);border:1px solid var(--asphalt-light);border-radius:3px;color:var(--white);font-family:\'DM Mono\',monospace;font-size:10px;padding:2px 5px;margin-left:4px;" />'
      + '</div>';
  } else {
    if (sub.actualCost) {
      html += '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:#7ecb8f;">Actual: ' + invFmt(sub.actualCost) + '</div>';
    }
    if (sub.invoiceNo) {
      html += '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);">Inv #: ' + escHtml(sub.invoiceNo) + '</div>';
    }
  }
  html += '</div>';
  return html;
}

// Sub inline edit save helpers
function invSubCostUpdate(el) {
  var id = el.dataset.subid || '';
  var val = parseFloat(el.value) || 0;
  var sched = (typeof schedData !== 'undefined') ? schedData : null;
  if (id.startsWith('lb_')) {
    try {
      var parts = id.split('_'); // lb_YYYY-MM-DD_moveIdx
      var lbDate = parts[1]; var mi = parseInt(parts[2]);
      var plan = JSON.parse(localStorage.getItem('dmc_lowbed_plan') || 'null');
      if (plan) {
        var job = (plan.jobs || []).find(function(j) { return j.date === lbDate; });
        if (job && job.moves && job.moves[mi]) {
          job.moves[mi].actualCost = val;
          localStorage.setItem('dmc_lowbed_plan', JSON.stringify(plan));
          if (typeof fbSet === 'function') try { fbSet('lowbed_plan', plan); } catch(e) {}
        }
      }
    } catch(e) {}
    return;
  }
  // QTR sub: id = 'fk_YYYY-MM-DD_slot'
  var m = id.match(/^(qc|tack|rubber)_(\d{4}-\d{2}-\d{2})_(.+)$/);
  if (m && sched) {
    var fk = m[1], dk = m[2], sl = m[3];
    var bdata = _invSubGetBlockData(sched, dk, sl);
    if (bdata && bdata.fields && bdata.fields[fk] && typeof bdata.fields[fk] === 'object') {
      bdata.fields[fk].cost = val;
      if (typeof saveSchedData === 'function') saveSchedData();
    }
  }
}

function invSubInvNoUpdate(el) {
  var id = el.dataset.subid || '';
  var val = el.value.trim();
  var sched = (typeof schedData !== 'undefined') ? schedData : null;
  if (id.startsWith('lb_')) {
    try {
      var parts = id.split('_');
      var lbDate = parts[1]; var mi = parseInt(parts[2]);
      var plan = JSON.parse(localStorage.getItem('dmc_lowbed_plan') || 'null');
      if (plan) {
        var job = (plan.jobs || []).find(function(j) { return j.date === lbDate; });
        if (job && job.moves && job.moves[mi]) {
          job.moves[mi].towingInvoiceNo = val;
          localStorage.setItem('dmc_lowbed_plan', JSON.stringify(plan));
          if (typeof fbSet === 'function') try { fbSet('lowbed_plan', plan); } catch(e) {}
        }
      }
    } catch(e) {}
    return;
  }
  var m = id.match(/^(qc|tack|rubber)_(\d{4}-\d{2}-\d{2})_(.+)$/);
  if (m && sched) {
    var fk = m[1], dk = m[2], sl = m[3];
    var bdata = _invSubGetBlockData(sched, dk, sl);
    if (bdata && bdata.fields && bdata.fields[fk] && typeof bdata.fields[fk] === 'object') {
      bdata.fields[fk].invoiceNo = val;
      if (typeof saveSchedData === 'function') saveSchedData();
    }
  }
}

function _invSubGetBlockData(sched, dateKey, slot) {
  var day = sched[dateKey] || {};
  if (slot === 'top' || slot === 'bottom') return day[slot];
  var xi = parseInt(slot.replace('extra_', ''));
  return (day.extras && day.extras[xi]) ? day.extras[xi].data : null;
}

// ── Main render ────────────────────────────────────────────────────────────────
function renderInvoiceTracker() {
  if (!_invMigrationDone) { _invMigrateBrokerRows(); _invMigrationDone = true; }
  var wrap = document.getElementById('invoiceView');
  if (!wrap) return;

  if (!invoiceActiveMonth) invoiceActiveMonth = _invDefaultMonth();

  var n = new Date();
  var todayKey = n.getFullYear() + '-'
    + String(n.getMonth() + 1).padStart(2, '0') + '-'
    + String(n.getDate()).padStart(2, '0');

  var activeDayKeys;
  if (invoiceActiveWeek) {
    activeDayKeys = _invWeekFromMonday(invoiceActiveWeek).map(function(d) { return d.key; });
  } else {
    activeDayKeys = _invActiveDayKeys();
  }
  var dayKeySet = {};
  activeDayKeys.forEach(function(k) { dayKeySet[k] = true; });

  var rows = invoiceList.filter(function(inv) {
    if (!dayKeySet[inv.dateOfWork]) return false;
    if (!invSearchQuery) return true;
    var q = invSearchQuery.toLowerCase();
    return (inv.dateOfWork || '').toLowerCase().indexOf(q) >= 0
        || (inv.jobNo     || '').toLowerCase().indexOf(q) >= 0
        || (inv.foreman   || '').toLowerCase().indexOf(q) >= 0
        || (inv.supplier  || '').toLowerCase().indexOf(q) >= 0
        || (inv.jobName   || '').toLowerCase().indexOf(q) >= 0
        || (inv.invoiceNo || '').toLowerCase().indexOf(q) >= 0;
  });

  var canEdit = (typeof isAdmin === 'function' && isAdmin())
             || (typeof canEditTab === 'function' && canEditTab('ap'));

  var periodBilled = rows.reduce(function(s, inv) { return s + invCardBilledTotal(inv); }, 0);
  var periodApproved = 0, hasApproved = false;
  rows.forEach(function(inv) {
    var a = inv.approvedAmount
      ? parseFloat((inv.approvedAmount + '').replace(/[^0-9.\-]/g, '')) || 0
      : null;
    if (a !== null) { periodApproved += a; hasApproved = true; }
  });

  var isMobCal = (invCalViewMode === 'calendar' && window.innerWidth <= 768);
  var gridHtml;
  if (isMobCal) {
    gridHtml = _invCalMonthGrid(invCalMonthOffset);
  } else if (invoiceActiveWeek) {
    var wkAllDays = _invWeekFromMonday(invoiceActiveWeek);
    var wkKeySet  = {};
    rows.forEach(function(inv) { wkKeySet[inv.dateOfWork] = true; });
    var wkSubs = _invGetSubsForPeriod(wkAllDays.map(function(d) { return d.key; }));
    wkSubs.forEach(function(sub) { wkKeySet[sub.date] = true; });
    var wkDays = wkAllDays.slice(0, 5);
    if (wkKeySet[wkAllDays[5].key]) wkDays.push(wkAllDays[5]);
    if (wkKeySet[wkAllDays[6].key]) wkDays.push(wkAllDays[6]);
    if (rows.length === 0 && wkSubs.length === 0) {
      gridHtml = '<div style="padding:48px;text-align:center;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:13px;">No invoices for this week.</div>';
    } else {
      gridHtml = _invRenderWeekGrid(wkDays, rows, todayKey, wkSubs);
    }
  } else {
    var weeks = _invWeeksWithData();
    if (weeks.length === 0) {
      gridHtml = '<div style="padding:48px;text-align:center;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:13px;">No invoices this '
        + (Array.isArray(invoiceActiveMonth) ? 'quarter' : 'month') + '.'
        + (canEdit ? '<br><button class="inv-btn" style="margin-top:16px;" onclick="openInvoiceModal(null)">+ Add Invoice</button>' : '')
        + '</div>';
    } else {
      var allWeeksHtml = '';
      weeks.forEach(function(mondayKey) {
        var wkDays2    = _invWeekFromMonday(mondayKey);
        var wkDayKeys2 = wkDays2.map(function(d) { return d.key; });
        var wkDaySet2  = {};
        wkDayKeys2.forEach(function(k) { wkDaySet2[k] = true; });
        var wkRows2    = rows.filter(function(inv) { return wkDaySet2[inv.dateOfWork]; });
        var wkSubs2    = _invGetSubsForPeriod(wkDayKeys2);
        var wkData2    = {};
        wkRows2.forEach(function(inv) { wkData2[inv.dateOfWork] = true; });
        wkSubs2.forEach(function(sub) { wkData2[sub.date] = true; });
        var wkActive2  = wkDays2.slice(0, 5);
        if (wkData2[wkDays2[5].key]) wkActive2.push(wkDays2[5]);
        if (wkData2[wkDays2[6].key]) wkActive2.push(wkDays2[6]);
        var wmp = wkDays2[0].key.split('-'), wfp = wkDays2[4].key.split('-');
        var wMon = new Date(parseInt(wmp[0]), parseInt(wmp[1]) - 1, parseInt(wmp[2]));
        var wFri = new Date(parseInt(wfp[0]), parseInt(wfp[1]) - 1, parseInt(wfp[2]));
        var wkLabel = wMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          + ' – ' + wFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        allWeeksHtml += '<div class="inv2-week-separator">Week of ' + wkLabel + '</div>';
        allWeeksHtml += _invRenderWeekGrid(wkActive2, wkRows2, todayKey, wkSubs2);
      });
      gridHtml = allWeeksHtml;
    }
  }

  var totalBar = rows.length
    ? '<div class="inv2-total-bar">'
    +   '<span class="inv2-total-lbl">' + escHtml(_invActiveLabel()) + ' &mdash; ' + rows.length + ' invoice' + (rows.length !== 1 ? 's' : '') + '</span>'
    +   '<div style="display:flex;gap:20px;align-items:baseline;">'
    +     '<div><span style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Billed</span>'
    +       '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;color:var(--stripe);">' + invFmt(periodBilled) + '</div></div>'
    +     (hasApproved
            ? '<div><span style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Approved</span>'
                + '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;color:#7ecb8f;">' + invFmt(periodApproved) + '</div></div>'
            : '')
    +   '</div>'
    + '</div>'
    : '';

  var _invGridScrollEl = wrap.querySelector('.inv2-grid-scroll');
  var _invGridScrollTop = _invGridScrollEl ? _invGridScrollEl.scrollTop : 0;
  wrap.innerHTML = '<div class="inv2-wrap">'
    + '<div class="inv2-header">'
    +   '<div class="inv2-title-row">'
    +     '<div class="inv-title">🧾 Sales Invoice &amp; Trucking Tracker</div>'
    +     '<div class="inv-sub">Monthly view &mdash; foremen &times; days</div>'
    +     '<div class="inv2-search-bar">'
    +       '<input class="inv2-search-input" type="text" placeholder="Search by date, job #, foreman, or supplier…" value="' + escHtml(invSearchQuery) + '" oninput="invSetSearch(this.value)" />'
    +       (invSearchQuery ? '<button class="inv-btn-ghost" onclick="invSetSearch(\'\')" style="padding:5px 10px;font-size:11px;">✕ Clear</button>' : '')
    +     '</div>'
    +   '</div>'
    +   _invRenderMonthTabs(canEdit)
    +   (window.innerWidth <= 768
        ? '<div class="inv2-view-toggle">'
          + '<button class="inv2-view-btn' + (invCalViewMode === 'calendar' ? ' active' : '') + '" onclick="invCalViewMode=\'calendar\';renderInvoiceTracker();">📅 Calendar</button>'
          + '<button class="inv2-view-btn' + (invCalViewMode === 'grid' ? ' active' : '') + '" onclick="invCalViewMode=\'grid\';renderInvoiceTracker();">▦ Grid</button>'
          + '</div>'
        : '')
    +   (!isMobCal ? _invRenderWeekTabs() : '')
    + '</div>'
    + (!isMobCal && invSearchQuery ? '<div style="padding:4px 24px 2px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);">🔍 ' + rows.length + ' result' + (rows.length !== 1 ? 's' : '') + '</div>' : '')
    + '<div class="inv2-grid-scroll">' + gridHtml + '</div>'
    + totalBar
    + '</div>';
  var _invGridScrollNew = wrap.querySelector('.inv2-grid-scroll');
  if (_invGridScrollNew) _invGridScrollNew.scrollTop = _invGridScrollTop;
  setTimeout(function() {
    var activeTab = document.querySelector('.inv2-month-tab.inv2-tab-active');
    if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, 50);
}

// ── Invoice Calendar Month Grid ────────────────────────────────────────────────

function _invCalMonthGrid(monthOffset) {
  var now = new Date();
  now.setHours(0,0,0,0);
  var todayKey = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  var base = new Date(now.getFullYear(), now.getMonth() + (monthOffset || 0), 1);
  var yr = base.getFullYear();
  var mo = base.getMonth();
  var daysInMonth = new Date(yr, mo + 1, 0).getDate();
  var firstDow = new Date(yr, mo, 1).getDay();
  var roster = (typeof foremanRoster !== 'undefined' && Array.isArray(foremanRoster)) ? foremanRoster : [];
  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var fmColors = ['#f5c518', '#5ab4f5', '#3d9e6a'];

  function _init(name) {
    var parts = (name || '').trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
      : ((parts[0] || '?')[0] || '?').toUpperCase();
  }

  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var hdrHtml = DOW.map(function(d) {
    return '<div class="mob-cal-day-hdr">' + d + '</div>';
  }).join('');

  var cells = [];

  // Leading cells from previous month
  var prevDays = new Date(yr, mo, 0).getDate();
  for (var i = 0; i < firstDow; i++) {
    var pday = prevDays - firstDow + 1 + i;
    cells.push('<div class="mob-cal-day-cell mob-cal-outside-month"><span class="mob-cal-day-num">' + pday + '</span></div>');
  }

  // Current month cells
  for (var d = 1; d <= daysInMonth; d++) {
    var date = new Date(yr, mo, d);
    var dow = date.getDay();
    var key = yr + '-' + String(mo+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isWknd = dow === 0 || dow === 6;
    var isHolD = (typeof holidays !== 'undefined') && holidays.has(key);
    var isTodayCell = key === todayKey;

    var dayInvs = invoiceList.filter(function(inv) { return inv.dateOfWork === key; });
    var byForeman = {};
    dayInvs.forEach(function(inv) {
      var fm = inv.foreman || '(No Foreman)';
      if (!byForeman[fm]) byForeman[fm] = [];
      byForeman[fm].push(inv);
    });
    var hasAnyInv = dayInvs.length > 0;

    var rowsHtml = '';
    var rowCount = 0;

    // Render roster foremen first (in order), then any extras
    var rendered = {};
    roster.forEach(function(fm, fIdx) {
      if (!byForeman[fm]) return;
      var invs = byForeman[fm];
      var color = fmColors[fIdx] || fmColors[fmColors.length - 1];
      var jobNo = invs[0].jobNo ? '#' + invs[0].jobNo : '';
      var badge = invs.length > 1
        ? '<span style="font-size:7px;background:rgba(245,197,24,0.3);border-radius:2px;padding:0 2px;margin-left:2px;">\xd72</span>'
        : '';
      var mt = rowCount === 0 ? '12px' : '1px';
      rowsHtml += '<div class="mob-cal-foreman-row" style="margin-top:' + mt + ';border-left:3px solid ' + color + ';background:' + color + '22;color:var(--white);" onclick="_invOpenDaySheet(\'' + key + '\',\'' + fm.replace(/'/g, '') + '\')">'
        + escHtml(_init(fm) + ' ' + jobNo) + badge
        + '</div>';
      rendered[fm] = true;
      rowCount++;
    });
    Object.keys(byForeman).forEach(function(fm) {
      if (rendered[fm]) return;
      var invs = byForeman[fm];
      var color = fmColors[2];
      var jobNo = invs[0].jobNo ? '#' + invs[0].jobNo : '';
      var badge = invs.length > 1
        ? '<span style="font-size:7px;background:rgba(245,197,24,0.3);border-radius:2px;padding:0 2px;margin-left:2px;">\xd72</span>'
        : '';
      var mt = rowCount === 0 ? '12px' : '1px';
      rowsHtml += '<div class="mob-cal-foreman-row" style="margin-top:' + mt + ';border-left:3px solid ' + color + ';background:' + color + '22;color:var(--white);" onclick="_invOpenDaySheet(\'' + key + '\',\'' + fm.replace(/'/g, '') + '\')">'
        + escHtml(_init(fm) + ' ' + jobNo) + badge
        + '</div>';
      rowCount++;
    });

    // Sub icons row
    var daySubs = _invGetSubsForPeriod([key]);
    var subIcons = daySubs.map(function(s) { return (_SUB_ICONS && _SUB_ICONS[s.type]) || '🔧'; }).join('');
    var subRow = subIcons ? '<div class="inv2-cal-sub-row">' + subIcons + '</div>' : '';

    var holLbl = isHolD
      ? '<span style="position:absolute;bottom:2px;left:3px;font-family:\'DM Mono\',monospace;font-size:6px;color:var(--red);pointer-events:none;">HOL</span>'
      : '';

    var cellClass = 'mob-cal-day-cell';
    var cellStyle = '';
    if (!hasAnyInv && (isWknd || isHolD)) cellClass += ' mob-cal-lilac';
    if (isTodayCell) cellStyle = 'outline:2px solid var(--stripe);outline-offset:-2px;z-index:1;';

    cells.push('<div class="' + cellClass + '" style="' + cellStyle + '">'
      + '<span class="mob-cal-day-num">' + d + '</span>'
      + rowsHtml
      + subRow
      + holLbl
      + '</div>');
  }

  // Trailing cells to fill 42-cell grid
  var needed = 42 - cells.length;
  for (var n = 1; n <= needed; n++) {
    cells.push('<div class="mob-cal-day-cell mob-cal-outside-month"><span class="mob-cal-day-num">' + n + '</span></div>');
  }

  var navHtml = '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px 4px;font-family:\'DM Mono\',monospace;">'
    + '<button onclick="_invCalNav(-1)" style="background:none;border:none;color:var(--concrete);font-size:18px;cursor:pointer;padding:2px 8px;">&#9664;</button>'
    + '<span style="font-size:11px;font-weight:700;color:var(--white);letter-spacing:1px;">' + MONTH_NAMES[mo] + ' ' + yr + '</span>'
    + '<button onclick="_invCalNav(1)" style="background:none;border:none;color:var(--concrete);font-size:18px;cursor:pointer;padding:2px 8px;">&#9654;</button>'
    + '</div>';

  return navHtml + '<div class="mob-cal-overall-grid">' + hdrHtml + cells.join('') + '</div>';
}

function _invCalNav(dir) {
  invCalMonthOffset += dir;
  renderInvoiceTracker();
}

// ── Invoice Day Sheet ──────────────────────────────────────────────────────────

function _invOpenDaySheet(dateKey, foremanName) {
  var existing = document.getElementById('invDaySheet');
  if (existing) existing.remove();

  var dayInvs = invoiceList.filter(function(inv) {
    return inv.dateOfWork === dateKey && (inv.foreman || '(No Foreman)') === foremanName;
  });
  if (!dayInvs.length) return;

  var canEdit = (typeof isAdmin === 'function' && isAdmin())
             || (typeof canEditTab === 'function' && canEditTab('ap'));

  var dp = dateKey.split('-');
  var dt = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
  var dateLabel = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  // Stop toggle (only if 2+ invoices for this foreman on this day)
  var stopToggleHtml = '';
  if (dayInvs.length > 1) {
    stopToggleHtml = '<div class="inv2-stop-toggle">'
      + '<button class="inv2-stop-btn active" id="invStopBtn0" onclick="_invSetDaySheetStop(0)">First Stop</button>'
      + '<button class="inv2-stop-btn" id="invStopBtn1" onclick="_invSetDaySheetStop(1)">Second Stop</button>'
      + '</div>';
  }

  // Pre-render all stop cards (show/hide via display)
  var cardsHtml = dayInvs.map(function(inv, i) {
    var editBtn = canEdit
      ? '<button class="inv2-edit-btn" onclick="_closeInvDaySheet();openInvoiceModal(\'' + inv.id + '\')">&#9998; Edit Invoice</button>'
      : '';
    return '<div id="invStop' + i + '"' + (i > 0 ? ' style="display:none;"' : '') + '>'
      + _invRenderCard(inv)
      + editBtn
      + '</div>';
  }).join('');

  // Sub section
  var daySubs = _invGetSubsForPeriod([dateKey]);
  var subColors = { Milling: '#3b82f6', Grading: '#f5c518', QC: '#3d9e6a', Tack: '#e8813a', Rubber: '#555555', Lowbed: '#8b5cf6' };
  var subsHtml = '';
  if (daySubs.length > 0) {
    subsHtml = '<div style="padding:6px 0 2px;font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Subcontractors</div>'
      + '<div class="inv2-sub-chips">'
      + daySubs.map(function(s) {
          var ic = (_SUB_ICONS && _SUB_ICONS[s.type]) || '🔧';
          var col = subColors[s.type] || '#888';
          return '<span class="sa-chip" style="background:' + col + '33;border-color:' + col + ';color:var(--white);">'
            + ic + ' ' + escHtml(s.subCompany || '') + (s.jobRef ? ' — ' + escHtml(s.jobRef) : '')
            + '</span>';
        }).join('')
      + '</div>';
  }

  // Add invoice button
  var fmSafe = foremanName.replace(/'/g, '');
  var addBtn = canEdit
    ? '<button class="inv-btn" style="width:100%;margin-top:8px;" onclick="_closeInvDaySheet();openInvoiceModal(null,{dateOfWork:\'' + dateKey + '\',foreman:\'' + fmSafe + '\'})">+ Add Invoice for this day</button>'
    : '';

  var sheetHtml = '<div class="inv-modal-overlay" id="invDaySheet" onclick="if(event.target===this)_closeInvDaySheet();">'
    + '<div class="inv-modal">'
    +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;gap:8px;">'
    +     '<div>'
    +       '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1px;color:var(--white);">' + escHtml(dateLabel) + '</div>'
    +       '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--stripe);margin-top:2px;">' + escHtml(foremanName) + '</div>'
    +     '</div>'
    +     '<button onclick="_closeInvDaySheet()" style="background:none;border:none;color:var(--concrete);font-size:20px;cursor:pointer;padding:0 4px;flex-shrink:0;">✕</button>'
    +   '</div>'
    +   stopToggleHtml
    +   cardsHtml
    +   subsHtml
    +   addBtn
    + '</div>'
    + '</div>';

  document.body.insertAdjacentHTML('beforeend', sheetHtml);
}

function _invSetDaySheetStop(idx) {
  for (var i = 0; i < 4; i++) {
    var card = document.getElementById('invStop' + i);
    if (card) card.style.display = (i === idx) ? '' : 'none';
    var btn = document.getElementById('invStopBtn' + i);
    if (btn) btn.className = 'inv2-stop-btn' + (i === idx ? ' active' : '');
  }
}

function _closeInvDaySheet() {
  var el = document.getElementById('invDaySheet');
  if (el) el.remove();
}


// ── Modal (initial creation only — all editing is inline on cards) ─────────────
function openInvoiceModal(id, prefill) {
  var isEdit  = !!id;
  var inv     = isEdit ? invoiceList.find(function(i) { return i.id === id; }) : null;
  var p       = prefill || {};
  var mixItems = (inv && inv.mixItems)
    ? inv.mixItems
    : (p.mixItems && p.mixItems.length ? p.mixItems : [{ mixType: '', mixPrice: '', itemTotal: '' }]);

  var supplierOptions = (typeof suppliersList !== 'undefined' ? suppliersList : []).map(function(s) {
    return '<option value="' + escHtml(s.name) + '">';
  }).join('');
  var mixOptions = (typeof mixTypesList !== 'undefined' ? mixTypesList : []).map(function(m) {
    return '<option value="' + escHtml(m.desc) + '">' + escHtml(m.displayName || m.desc) + '</option>';
  }).join('');

  function mixRowHtml(m, i) {
    return '<div class="inv-mix-row" id="invMixRow-' + i + '">'
      + '<div><label class="inv-form-label">Mix Type</label>'
      +   '<input class="inv-input" id="invMixType-' + i + '" list="invMixList" placeholder="e.g. 12.5mm Surface" value="' + escHtml(m.mixType || '') + '" style="width:100%;" />'
      +   '<datalist id="invMixList">' + mixOptions + '</datalist></div>'
      + '<div><label class="inv-form-label">Tonnage (tons)</label>'
      +   '<input class="inv-input" id="invTonQty-' + i + '" type="number" step="0.01" placeholder="0.00" value="' + escHtml(m.tonQty || '') + '" style="width:100%;" oninput="invCalcTotal(' + i + ')" /></div>'
      + '<div><label class="inv-form-label">Price / Ton ($)</label>'
      +   '<input class="inv-input" id="invMixPrice-' + i + '" type="number" step="0.01" placeholder="0.00" value="' + escHtml(m.mixPrice || '') + '" style="width:100%;" oninput="invCalcTotal(' + i + ')" /></div>'
      + '<div><label class="inv-form-label">Item Total ($)</label>'
      +   '<input class="inv-input" id="invItemTotal-' + i + '" type="number" step="0.01" placeholder="0.00" value="' + escHtml(m.itemTotal || '') + '" style="width:100%;background:rgba(126,203,143,0.06);" /></div>'
      + (i > 0 ? '<button onclick="removeInvMixRow(' + i + ')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:16px;padding:0 4px;align-self:center;margin-top:14px;">✕</button>' : '<div></div>')
      + '</div>';
  }

  var at = (inv && inv.actualTrucking) || {};

  // Init modal broker rows from existing invoice or from schedule prefill
  _invModalBrkRows = [];
  if (isEdit && Array.isArray(at.brkRows)) {
    _invModalBrkRows = at.brkRows.map(function(r) { return { name: r.name || '', count: r.count || 0, cost: r.cost || 0 }; });
  } else if (!isEdit && p.dateOfWork) {
    try {
      var _ms = typeof foremanRoster !== 'undefined' ? foremanRoster : [];
      var _pSlot = (p.foreman && _ms[1] && p.foreman === _ms[1]) ? 'bottom' : 'top';
      var _pDay  = (typeof schedData !== 'undefined' ? schedData[p.dateOfWork] : null) || {};
      var _pTd   = JSON.parse(((_pDay[_pSlot] || {}).fields || {}).trucking || '{}');
      (_pTd.brokerTrucks || []).filter(function(t) { return t.trim(); }).forEach(function(name) {
        _invModalBrkRows.push({ name: name, count: 0, cost: 0 });
      });
    } catch(e) {}
  }

  var overlay = document.createElement('div');
  overlay.id = 'invModal';
  overlay.className = 'inv-modal-overlay';
  overlay.innerHTML = '<div class="inv-modal">'
    + '<div class="inv-modal-title">' + (isEdit ? 'Edit' : 'New') + ' Invoice Entry</div>'
    + '<div class="inv-form-grid">'
    +   '<div><label class="inv-form-label">Date of Work *</label>'
    +     '<input class="inv-input" id="invDate" type="date" value="' + ((inv && inv.dateOfWork) || p.dateOfWork || '') + '" style="width:100%;" /></div>'
    +   '<div><label class="inv-form-label">Invoice #</label>'
    +     '<input class="inv-input" id="invNo" value="' + escHtml((inv && inv.invoiceNo) || '') + '" placeholder="e.g. INV-20241" style="width:100%;" /></div>'
    +   '<div><label class="inv-form-label">Foreman</label>'
    +     '<input class="inv-input" id="invForeman" value="' + escHtml((inv && inv.foreman) || p.foreman || '') + '" placeholder="Foreman name" style="width:100%;" /></div>'
    +   '<div><label class="inv-form-label">Job #</label>'
    +     '<input class="inv-input" id="invJobNo" value="' + escHtml((inv && inv.jobNo) || p.jobNo || '') + '" placeholder="e.g. 2024-001" style="width:100%;" /></div>'
    +   '<div class="inv-form-full"><label class="inv-form-label">Job Name</label>'
    +     '<input class="inv-input" id="invJobName" value="' + escHtml((inv && inv.jobName) || p.jobName || '') + '" placeholder="e.g. Granite State — Route 3" style="width:100%;" /></div>'
    +   '<div class="inv-form-full"><label class="inv-form-label">Supplier</label>'
    +     '<input class="inv-input" id="invSupplier" list="invSupplierList" value="' + escHtml((inv && inv.supplier) || p.supplier || '') + '" placeholder="Select or type supplier" style="width:100%;" />'
    +     '<datalist id="invSupplierList">' + supplierOptions + '</datalist></div>'
    + '</div>'
    + '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:8px;">Mix Types on this Invoice</div>'
    + '<div id="invMixRows">' + mixItems.map(function(m, i) { return mixRowHtml(m, i); }).join('') + '</div>'
    + '<button onclick="addInvMixRow()" class="inv-btn-ghost" style="width:100%;margin-bottom:16px;font-size:11px;">+ Add Mix Type</button>'
    + '<div style="margin-top:16px;">'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--asphalt-light);">🚛 Actual Trucking Costs</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px;">'
    +     '<div><label class="inv-form-label">DMC Trucks (actual #)</label><input class="inv-input" id="invActDmcCount" type="number" min="0" step="1" placeholder="0" value="' + (at.dmcCount || p.truckCount || '') + '" style="width:100%;" /></div>'
    +     '<div><label class="inv-form-label">DMC Truck Cost ($)</label><input class="inv-input" id="invActDmcCost" type="number" min="0" step="0.01" placeholder="0.00" value="' + (at.dmcCost || '') + '" style="width:100%;" /></div>'
    +     '<div style="display:flex;align-items:flex-end;"><button onclick="autoFillActualDmc()" class="inv-btn-ghost" style="font-size:10px;padding:5px 8px;width:100%;">↙ Use Projected</button></div>'
    +     '<div style="grid-column:1/-1;">'
    +       '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
    +         '<span style="font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--concrete-dim);">Broker Trucks</span>'
    +         '<button onclick="invAddModalBrkRow()" class="inv-btn-ghost" style="font-size:10px;padding:2px 8px;">+ Add</button>'
    +         '<button onclick="autoFillActualBrk()" class="inv-btn-ghost" style="font-size:10px;padding:2px 8px;">↙ Use Projected</button>'
    +       '</div>'
    +       '<div id="invModalBrkRows"></div>'
    +     '</div>'
    +     '<div><label class="inv-form-label">Supplier Trucks (actual #)</label><input class="inv-input" id="invActSupCount" type="number" min="0" step="1" placeholder="0" value="' + (at.supCount || '') + '" style="width:100%;" /></div>'
    +     '<div><label class="inv-form-label">Supplier Truck Cost ($)</label><input class="inv-input" id="invActSupCost" type="number" min="0" step="0.01" placeholder="0.00" value="' + (at.supCost || '') + '" style="width:100%;" /></div>'
    +     '<div style="display:flex;align-items:flex-end;"><button onclick="autoFillActualSup()" class="inv-btn-ghost" style="font-size:10px;padding:5px 8px;width:100%;">↙ Use Projected</button></div>'
    +   '</div>'
    + '</div>'
    + '<div style="margin-top:16px;">'
    +   '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--stripe);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--asphalt-light);">📎 Attached Invoice Files</div>'
    +   '<div class="inv-att-zone" id="invAttZone"'
    +     ' ondragover="event.preventDefault();this.classList.add(\'drag-over\')"'
    +     ' ondragleave="this.classList.remove(\'drag-over\')"'
    +     ' ondrop="event.preventDefault();this.classList.remove(\'drag-over\');invHandleFiles(event.dataTransfer.files)">'
    +     '<input type="file" id="invAttInput" multiple accept=".pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" onchange="invHandleFiles(this.files)" />'
    +     '<div style="font-size:13px;color:var(--concrete-dim);">📂 Drop files here or <strong style="color:var(--stripe);">click to browse</strong></div>'
    +     '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);margin-top:4px;">PDF · Word (.docx) · Images</div>'
    +   '</div>'
    +   '<div id="invAttList"></div>'
    + '</div>'
    + '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">'
    +   '<button onclick="document.getElementById(\'invModal\').remove()" class="inv-btn-ghost">Cancel</button>'
    +   '<button onclick="saveInvoiceEntry(' + (isEdit ? JSON.stringify(id) : 'null') + ')" class="inv-btn">Save Invoice</button>'
    + '</div>'
    + '</div>';

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay._mixCount = mixItems.length;
  window._invAttachments = ((inv && inv.attachments) || []).map(function(a) { return Object.assign({}, a); });
  if (typeof invRenderAttList === 'function') invRenderAttList();
  renderInvModalBrkRows();
}

function renderInvModalBrkRows() {
  var el = document.getElementById('invModalBrkRows');
  if (!el) return;
  var brokers = typeof truckingBrokersList !== 'undefined' ? truckingBrokersList : [];
  if (!_invModalBrkRows.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--concrete-dim);padding:4px 0;font-style:italic;">No broker trucks — click + Add to add one.</div>';
    return;
  }
  el.innerHTML = _invModalBrkRows.map(function(row, i) {
    var nameField;
    if (brokers.length) {
      var opts = '<option value="">— select broker —</option>'
        + brokers.map(function(b) {
            return '<option value="' + escHtml(b) + '"' + (b === row.name ? ' selected' : '') + '>' + escHtml(b) + '</option>';
          }).join('');
      nameField = '<select class="inv-input" oninput="_invModalBrkRows[' + i + '].name=this.value" style="font-size:12px;">' + opts + '</select>';
    } else {
      nameField = '<input class="inv-input" placeholder="Broker name" value="' + escHtml(row.name || '') + '" oninput="_invModalBrkRows[' + i + '].name=this.value" style="font-size:12px;" />';
    }
    return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:6px;margin-bottom:4px;">'
      + nameField
      + '<input class="inv-input" type="number" min="0" step="1" placeholder="# trucks" value="' + (row.count || '') + '" oninput="_invModalBrkRows[' + i + '].count=parseFloat(this.value)||0" style="font-size:12px;" />'
      + '<input class="inv-input" type="number" min="0" step="0.01" placeholder="$cost" value="' + (row.cost || '') + '" oninput="_invModalBrkRows[' + i + '].cost=parseFloat(this.value)||0" style="font-size:12px;" />'
      + '<button onclick="_invModalBrkRows.splice(' + i + ',1);renderInvModalBrkRows();" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;padding:0 4px;align-self:center;">✕</button>'
      + '</div>';
  }).join('');
}

function invAddModalBrkRow() {
  _invModalBrkRows.push({ name: '', count: 0, cost: 0 });
  renderInvModalBrkRows();
}

function addInvMixRow() {
  var wrap = document.getElementById('invMixRows');
  if (!wrap) return;
  _invMixCount = wrap.querySelectorAll('.inv-mix-row').length;
  var mixOptions = (typeof mixTypesList !== 'undefined' ? mixTypesList : []).map(function(m) {
    return '<option value="' + escHtml(m.desc) + '">' + escHtml(m.displayName || m.desc) + '</option>';
  }).join('');
  var div = document.createElement('div');
  div.innerHTML = '<div class="inv-mix-row" id="invMixRow-' + _invMixCount + '">'
    + '<div><label class="inv-form-label">Mix Type</label>'
    +   '<input class="inv-input" id="invMixType-' + _invMixCount + '" list="invMixList' + _invMixCount + '" placeholder="e.g. 12.5mm Surface" style="width:100%;" />'
    +   '<datalist id="invMixList' + _invMixCount + '">' + mixOptions + '</datalist></div>'
    + '<div><label class="inv-form-label">Tonnage (tons)</label>'
    +   '<input class="inv-input" id="invTonQty-' + _invMixCount + '" type="number" step="0.01" placeholder="0.00" style="width:100%;" oninput="invCalcTotal(' + _invMixCount + ')" /></div>'
    + '<div><label class="inv-form-label">Price / Ton ($)</label>'
    +   '<input class="inv-input" id="invMixPrice-' + _invMixCount + '" type="number" step="0.01" placeholder="0.00" style="width:100%;" oninput="invCalcTotal(' + _invMixCount + ')" /></div>'
    + '<div><label class="inv-form-label">Item Total ($)</label>'
    +   '<input class="inv-input" id="invItemTotal-' + _invMixCount + '" type="number" step="0.01" placeholder="0.00" style="width:100%;background:rgba(126,203,143,0.06);" /></div>'
    + '<button onclick="this.closest(\'.inv-mix-row\').remove()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:16px;padding:0 4px;align-self:center;margin-top:14px;">✕</button>'
    + '</div>';
  wrap.appendChild(div.firstElementChild);
}

function removeInvMixRow(i) {
  var el = document.getElementById('invMixRow-' + i);
  if (el) el.remove();
}

function invCalcTotal(i) {
  var tEl = document.getElementById('invTonQty-' + i);
  var pEl = document.getElementById('invMixPrice-' + i);
  var rEl = document.getElementById('invItemTotal-' + i);
  var t = tEl ? (parseFloat(tEl.value) || 0) : 0;
  var p = pEl ? (parseFloat(pEl.value) || 0) : 0;
  if (rEl && t > 0 && p > 0) rEl.value = (t * p).toFixed(2);
}

function saveInvoiceEntry(editId) {
  var dateEl = document.getElementById('invDate');
  var date   = dateEl && dateEl.value;
  if (!date) { alert('Date of Work is required.'); return; }

  var mixRowEls = document.getElementById('invMixRows');
  var mixRows   = mixRowEls ? mixRowEls.querySelectorAll('.inv-mix-row') : [];
  var mixItems  = [];
  Array.from(mixRows).forEach(function(row) {
    var typeEl  = row.querySelector('[id^=invMixType-]');
    var tonEl   = row.querySelector('[id^=invTonQty-]');
    var priceEl = row.querySelector('[id^=invMixPrice-]');
    var totEl   = row.querySelector('[id^=invItemTotal-]');
    var mixType  = typeEl  ? typeEl.value.trim()  : '';
    var tonQty   = tonEl   ? tonEl.value.trim()   : '';
    var mixPrice = priceEl ? priceEl.value.trim() : '';
    var tN = parseFloat(tonQty) || 0, pN = parseFloat(mixPrice) || 0;
    var itemTotal = (tN > 0 && pN > 0) ? (tN * pN).toFixed(2) : (totEl ? totEl.value.trim() : '');
    if (mixType || itemTotal) mixItems.push({ mixType: mixType, tonQty: tonQty, mixPrice: mixPrice, itemTotal: itemTotal });
  });
  if (!mixItems.length) { alert('Add at least one mix type entry.'); return; }

  function gv(elId) { var el = document.getElementById(elId); return el ? el.value.trim() : ''; }
  function gn(elId) { var el = document.getElementById(elId); return el ? (parseFloat(el.value) || 0) : 0; }

  var jn       = gv('invJobName');
  var existing = editId ? invoiceList.find(function(i) { return i.id === editId; }) : null;
  var entry    = {
    id:          editId || Date.now().toString(),
    dateOfWork:  date,
    invoiceNo:   gv('invNo'),
    foreman:     gv('invForeman'),
    jobNo:       gv('invJobNo'),
    jobName:     jn,
    gcName:      jn.indexOf(' — ') >= 0 ? jn.split(' — ')[0].trim() : '',
    supplier:    gv('invSupplier'),
    mixItems:    mixItems,
    actualTrucking: {
      dmcCount: gn('invActDmcCount'), dmcCost: gn('invActDmcCost'),
      brkRows:  _invModalBrkRows.slice(),
      brkCount: _invModalBrkRows.reduce(function(s, r) { return s + (r.count || 0); }, 0),
      brkCost:  _invModalBrkRows.reduce(function(s, r) { return s + (r.cost  || 0); }, 0),
      supCount: gn('invActSupCount'), supCost: gn('invActSupCost')
    },
    updatedAt:      Date.now(),
    attachments:    window._invAttachments || [],
    approvedAmount: existing ? (existing.approvedAmount || '') : '',
    invoiceNotes:   existing ? (existing.invoiceNotes   || '') : ''
  };

  if (editId) {
    var idx = -1;
    for (var k = 0; k < invoiceList.length; k++) { if (invoiceList[k].id === editId) { idx = k; break; } }
    if (idx >= 0) invoiceList[idx] = entry; else invoiceList.push(entry);
  } else {
    invoiceList.push(entry);
  }

  saveInvoiceList();
  var modal = document.getElementById('invModal');
  if (modal) modal.remove();
  renderInvoiceTracker();
}

var _invResizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(_invResizeTimer);
  _invResizeTimer = setTimeout(function() {
    if (typeof renderInvoiceTracker === 'function') {
      renderInvoiceTracker();
    }
  }, 200);
});

// ═══════════════════════════════════════════════════════════════════════════
// AR HOME — KPI DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

var _arKpiFilter = {};   // { gcName, jobId, jobNum }
var _arKpiMonth  = '';   // '' = all year, 'YYYY-MM' = specific month
var _arKpiCharts = [];   // Chart.js instances to destroy before re-render

var _ARKPI_PALETTE = ['#a78bfa','#5ab4f5','#f5c518','#7ecb8f','#f06292','#e8814a','#4dd0e1','#ffb74d','#c084f5','#f9a8d4'];

function _openARKPIs(params) {
  _arKpiFilter = params || {};
  _arKpiMonth  = '';
  if (typeof switchTab === 'function') switchTab('ap');
}

function arKpiSetMonth(m) {
  _arKpiMonth = m;
  if (typeof renderArOverview === 'function') renderArOverview();
}

function arKpiClearFilter() {
  _arKpiFilter = {};
  if (typeof renderArOverview === 'function') renderArOverview();
}

function _arKpiGoToGC(gcName) {
  _arKpiFilter = { gcName: gcName };
  if (typeof setBacklogView === 'function') setBacklogView('gc');
  if (typeof switchTab === 'function') switchTab('backlog');
}

function _arKpiMtLabel(raw) {
  if (!raw) return 'Unknown';
  if (typeof matDisplayName === 'function') {
    var resolved = matDisplayName(raw);
    if (resolved && resolved !== raw) return resolved;
  }
  var mxList = (typeof mixTypesList !== 'undefined') ? mixTypesList : [];
  var r = (raw + '').toLowerCase().trim();
  var m = mxList.filter(function(x){ return (x.desc||'').toLowerCase().trim() === r; })[0];
  if (m && m.displayName) return m.displayName;
  m = mxList.filter(function(x){ return (x.displayName||'').toLowerCase().trim() === r; })[0];
  if (m && m.displayName) return m.displayName;
  return raw;
}

function _arKpiFilteredInvoices() {
  var invs = (invoiceList || []).slice();
  var curYr = new Date().getFullYear();
  if (_arKpiMonth) {
    invs = invs.filter(function(inv) { return (inv.dateOfWork || '').substring(0, 7) === _arKpiMonth; });
  } else {
    invs = invs.filter(function(inv) { return (inv.dateOfWork || '').substring(0, 4) === String(curYr); });
  }
  if (_arKpiFilter.gcName) {
    invs = invs.filter(function(inv) { return (inv.gcName || '') === _arKpiFilter.gcName; });
  }
  if (_arKpiFilter.jobNum) {
    invs = invs.filter(function(inv) { return (inv.jobNo || '') === _arKpiFilter.jobNum; });
  }
  return invs;
}

function _buildARKPIDashboardHtml() {
  var invs = _arKpiFilteredInvoices();
  var curYr = new Date().getFullYear();
  var esc = typeof escHtml === 'function' ? escHtml : function(s){ return s||''; };
  var fmtD = function(v) { return '$'+(parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); };
  var fmtPct = function(v, t) { return t > 0 ? (v/t*100).toFixed(1)+'%' : '—'; };
  var thS = 'font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--concrete-dim);padding:5px 8px;text-align:left;white-space:nowrap;';

  // ── Month picker ─────────────────────────────────────────────────────────
  var monthsSet = {};
  (invoiceList || []).forEach(function(inv) {
    if (inv.dateOfWork) monthsSet[inv.dateOfWork.substring(0,7)] = true;
  });
  for (var mo = 1; mo <= 12; mo++) {
    monthsSet[curYr + '-' + String(mo).padStart(2,'0')] = true;
  }
  var monthKeys = Object.keys(monthsSet).sort().reverse();
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var monthOptHtml = monthKeys.map(function(mk) {
    var p = mk.split('-');
    return '<option value="'+mk+'"'+((_arKpiMonth===mk)?' selected':'')+'>'+MN[parseInt(p[1])-1]+' '+p[0]+'</option>';
  }).join('');

  // ── Filter chip ──────────────────────────────────────────────────────────
  var filterLabel = '';
  if (_arKpiFilter.gcName) filterLabel = '🏢 '+esc(_arKpiFilter.gcName);
  else if (_arKpiFilter.jobNum) filterLabel = 'Job #'+esc(_arKpiFilter.jobNum);
  var filterChipHtml = filterLabel
    ? '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.35);border-radius:20px;padding:3px 12px;">'
    +   '<span style="font-size:11px;color:#a78bfa;font-family:\'DM Sans\',sans-serif;">'+filterLabel+'</span>'
    +   '<button onclick="arKpiClearFilter()" style="background:none;border:none;cursor:pointer;color:#a78bfa;font-size:12px;padding:0 0 0 4px;line-height:1;">✕ Clear</button>'
    + '</div>'
    : '';

  var filterBarHtml = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">'
    + '<select onchange="arKpiSetMonth(this.value)" style="font-family:\'DM Mono\',monospace;font-size:10px;background:var(--asphalt);border:1px solid var(--asphalt-light);border-radius:4px;color:var(--white);padding:5px 10px;cursor:pointer;">'
    +   '<option value=""'+(!_arKpiMonth?' selected':'')+'>All Year '+curYr+'</option>'
    +   monthOptHtml
    + '</select>'
    + filterChipHtml
    + '</div>';

  // ── No-data state ────────────────────────────────────────────────────────
  if (!invs.length) {
    return '<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:12px;padding:16px 18px;">'
      + '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:2px;color:var(--white);margin-bottom:12px;">📊 AR / SALES KPI DASHBOARD</div>'
      + filterBarHtml
      + '<div style="text-align:center;padding:24px;color:var(--concrete-dim);font-family:\'DM Sans\',sans-serif;font-size:13px;">No invoice data for this period.</div>'
      + '</div>';
  }

  // ── Revenue KPIs by GC ───────────────────────────────────────────────────
  var byGC = {};
  invs.forEach(function(inv) {
    var gc = inv.gcName || 'Unknown';
    if (!byGC[gc]) byGC[gc] = { billed:0, outstanding:0, shifts:0 };
    var total = (inv.mixItems||[]).reduce(function(s,m){ return s+(parseFloat(m.itemTotal)||0); },0);
    byGC[gc].billed += total;
    var appAmt = parseFloat(((inv.approvedAmount||'')+'').replace(/[^0-9.\-]/g,''))||0;
    if (!appAmt) byGC[gc].outstanding += total;
    byGC[gc].shifts++;
  });
  var gcNames = Object.keys(byGC).sort(function(a,b){ return byGC[b].billed - byGC[a].billed; });
  var grandBilled = gcNames.reduce(function(s,g){ return s+byGC[g].billed; },0);

  var topGCs = gcNames.slice(0,6);
  var gcPieLabels=[], gcPieData=[], gcPieColors=[];
  topGCs.forEach(function(gc,i){ gcPieLabels.push(gc); gcPieData.push(byGC[gc].billed); gcPieColors.push(_ARKPI_PALETTE[i%_ARKPI_PALETTE.length]); });
  var gcOtherBilled = gcNames.slice(6).reduce(function(s,g){ return s+byGC[g].billed; },0);
  if (gcOtherBilled > 0){ gcPieLabels.push('Other'); gcPieData.push(gcOtherBilled); gcPieColors.push('#555'); }

  var gcLegendHtml = gcPieLabels.map(function(gc,i) {
    var safeGc = gc.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var isTop = i < topGCs.length;
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
      +'<div style="width:9px;height:9px;border-radius:50%;flex-shrink:0;background:'+gcPieColors[i]+'"></div>'
      +'<div style="font-size:10px;color:var(--white);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
      +(isTop ? '<span style="cursor:pointer;border-bottom:1px dotted rgba(245,197,24,0.35);" onclick="event.stopPropagation();_arKpiGoToGC(\''+safeGc+'\')">'+esc(gc)+'</span>' : esc(gc))
      +'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);white-space:nowrap;">'+fmtD(gcPieData[i])+' · '+fmtPct(gcPieData[i],grandBilled)+'</div>'
      +'</div>';
  }).join('');

  var gcTableRows = gcNames.map(function(gc) {
    var d = byGC[gc];
    var safeGc = gc.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">'
      +'<td style="padding:6px 8px;font-size:11px;cursor:pointer;" onclick="_arKpiGoToGC(\''+safeGc+'\')">'
      +'<span style="color:var(--stripe);border-bottom:1px dotted rgba(245,197,24,0.4);">'+esc(gc)+'</span></td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;color:var(--white);">'+fmtD(d.billed)+'</td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;color:#8B1A1A;font-weight:700;">'+(d.outstanding>0?fmtD(d.outstanding):'—')+'</td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:center;color:var(--concrete-dim);">'+d.shifts+'</td>'
      +'</tr>';
  }).join('');

  var gcTableHtml = gcNames.length
    ? '<div style="overflow-x:auto;margin-top:10px;">'
    +'<table style="width:100%;border-collapse:collapse;">'
    +'<thead><tr style="border-bottom:1px solid var(--asphalt-light);">'
    +'<th style="'+thS+'">GC</th><th style="'+thS+'text-align:right;">Billed</th>'
    +'<th style="'+thS+'text-align:right;">Outstanding</th><th style="'+thS+'text-align:center;">Shifts</th>'
    +'</tr></thead><tbody>'+gcTableRows+'</tbody></table></div>'
    : '';

  // ── Sales KPIs by Mix / Supplier ─────────────────────────────────────────
  var byMix={}, bySupplier={};
  invs.forEach(function(inv) {
    var sup = inv.supplier || 'Unknown';
    (inv.mixItems||[]).forEach(function(m) {
      var mt = m.mixType || 'Unknown';
      var total = parseFloat(m.itemTotal)||0;
      var tons  = parseFloat(m.tonQty)||0;
      if (!byMix[mt]) byMix[mt]={tons:0,billed:0,loads:0};
      byMix[mt].tons+=tons; byMix[mt].billed+=total; byMix[mt].loads++;
      if (!bySupplier[sup]) bySupplier[sup]=0;
      bySupplier[sup]+=total;
    });
  });

  var mixNames = Object.keys(byMix).sort(function(a,b){ return byMix[b].tons-byMix[a].tons; });
  var totalTons = mixNames.reduce(function(s,m){ return s+byMix[m].tons; },0);
  var mixPieLabels=[], mixPieData=[], mixPieColors=[];
  mixNames.forEach(function(mt,i){
    mixPieLabels.push(_arKpiMtLabel(mt));
    mixPieData.push(byMix[mt].tons);
    mixPieColors.push(_ARKPI_PALETTE[i%_ARKPI_PALETTE.length]);
  });

  var mixLegendHtml = mixPieLabels.map(function(lbl,i) {
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
      +'<div style="width:9px;height:9px;border-radius:50%;flex-shrink:0;background:'+mixPieColors[i]+'"></div>'
      +'<div style="font-size:10px;color:var(--white);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(lbl)+'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);white-space:nowrap;">'+(mixPieData[i]||0).toFixed(1)+' T · '+fmtPct(mixPieData[i],totalTons)+'</div>'
      +'</div>';
  }).join('');

  var supNames = Object.keys(bySupplier).sort(function(a,b){ return bySupplier[b]-bySupplier[a]; });
  var totalSupBilled = supNames.reduce(function(s,n){ return s+bySupplier[n]; },0);
  var topSups = supNames.slice(0,6);
  var supPieLabels=[], supPieData=[], supPieColors=[];
  topSups.forEach(function(sup,i){ supPieLabels.push(sup); supPieData.push(bySupplier[sup]); supPieColors.push(_ARKPI_PALETTE[(i+3)%_ARKPI_PALETTE.length]); });
  var supOtherAmt = supNames.slice(6).reduce(function(s,n){ return s+bySupplier[n]; },0);
  if (supOtherAmt>0){ supPieLabels.push('Other'); supPieData.push(supOtherAmt); supPieColors.push('#555'); }

  var supLegendHtml = supPieLabels.map(function(sup,i) {
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
      +'<div style="width:9px;height:9px;border-radius:50%;flex-shrink:0;background:'+supPieColors[i]+'"></div>'
      +'<div style="font-size:10px;color:var(--white);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(sup)+'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--concrete-dim);white-space:nowrap;">'+fmtD(supPieData[i])+' · '+fmtPct(supPieData[i],totalSupBilled)+'</div>'
      +'</div>';
  }).join('');

  var mixTableRows = mixNames.map(function(mt) {
    var d = byMix[mt];
    var avgPT = d.tons>0 ? fmtD(d.billed/d.tons) : '—';
    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">'
      +'<td style="padding:6px 8px;font-size:11px;color:var(--white);">'+esc(_arKpiMtLabel(mt))+'</td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;color:var(--stripe);">'+(d.tons>0?d.tons.toFixed(1)+' T':'—')+'</td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;color:var(--white);">'+(d.billed>0?fmtD(d.billed):'—')+'</td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;color:var(--concrete-dim);">'+avgPT+'</td>'
      +'<td style="padding:6px 8px;font-family:\'DM Mono\',monospace;font-size:10px;text-align:center;color:var(--concrete-dim);">'+d.loads+'</td>'
      +'</tr>';
  }).join('');

  var mixTableHtml = mixNames.length
    ? '<div style="overflow-x:auto;margin-top:10px;">'
    +'<table style="width:100%;border-collapse:collapse;">'
    +'<thead><tr style="border-bottom:1px solid var(--asphalt-light);">'
    +'<th style="'+thS+'">Mix Type</th><th style="'+thS+'text-align:right;">Tons</th>'
    +'<th style="'+thS+'text-align:right;">Billed</th><th style="'+thS+'text-align:right;">Avg $/Ton</th>'
    +'<th style="'+thS+'text-align:center;">Loads</th>'
    +'</tr></thead><tbody>'+mixTableRows+'</tbody></table></div>'
    : '';

  // ── Section header ────────────────────────────────────────────────────────
  var secHdr = '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:2px;color:var(--white);margin-bottom:12px;">📊 AR / SALES KPI DASHBOARD</div>';

  // ── Left column ───────────────────────────────────────────────────────────
  var leftCol = '<div style="flex:1;min-width:0;min-height:0;">'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--asphalt-light);">💰 REVENUE BY GC</div>'
    +'<div style="display:flex;justify-content:center;max-height:220px;"><canvas id="arKpiGCPie" style="max-height:220px;max-width:220px;"></canvas></div>'
    +'<div style="margin-top:8px;">'+gcLegendHtml+'</div>'
    +gcTableHtml
    +'</div>';

  // ── Divider ───────────────────────────────────────────────────────────────
  var divider = '<div style="width:1px;background:var(--asphalt-light);flex-shrink:0;margin:0 18px;"></div>';

  // ── Right column ──────────────────────────────────────────────────────────
  var rightCol = '<div style="flex:1;min-width:0;min-height:0;">'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--concrete-dim);margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--asphalt-light);">🪨 TONS BY MIX TYPE</div>'
    +'<div style="display:flex;justify-content:center;max-height:200px;"><canvas id="arKpiMixPie" style="max-height:200px;max-width:200px;"></canvas></div>'
    +'<div style="margin-top:8px;">'+mixLegendHtml+'</div>'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--concrete-dim);margin:14px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--asphalt-light);">🏭 SPEND BY SUPPLIER</div>'
    +'<div style="display:flex;justify-content:center;max-height:200px;"><canvas id="arKpiSupPie" style="max-height:200px;max-width:200px;"></canvas></div>'
    +'<div style="margin-top:8px;">'+supLegendHtml+'</div>'
    +mixTableHtml
    +'</div>';

  var colsHtml = '<div style="display:flex;gap:0;align-items:flex-start;">'
    +leftCol+divider+rightCol
    +'</div>';

  return '<div style="background:var(--asphalt-mid);border:1px solid var(--asphalt-light);border-radius:12px;padding:16px 18px;">'
    +secHdr+filterBarHtml+colsHtml
    +'</div>';
}

function _mountARKPICharts() {
  _arKpiCharts.forEach(function(c){ try { c.destroy(); } catch(e){} });
  _arKpiCharts = [];

  if (typeof Chart === 'undefined') return;
  var invs = _arKpiFilteredInvoices();
  if (!invs.length) return;

  var fmtD = function(v){ return '$'+(parseFloat(v)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); };
  var chartCfg = function(labels, data, colors, tooltipFmt) {
    return {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' }] },
      options: {
        responsive: true, maintainAspectRatio: true, cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function(ctx){ return ctx.label+': '+tooltipFmt(ctx.parsed); } } }
        }
      }
    };
  };

  // GC pie
  var gcEl = document.getElementById('arKpiGCPie');
  if (gcEl) {
    var byGC = {};
    invs.forEach(function(inv){
      var gc=inv.gcName||'Unknown';
      if (!byGC[gc]) byGC[gc]=0;
      byGC[gc]+=(inv.mixItems||[]).reduce(function(s,m){ return s+(parseFloat(m.itemTotal)||0); },0);
    });
    var gNames = Object.keys(byGC).sort(function(a,b){ return byGC[b]-byGC[a]; });
    var gTop=gNames.slice(0,6), gOther=gNames.slice(6).reduce(function(s,g){ return s+byGC[g]; },0);
    var gL=gTop.slice(), gD=gTop.map(function(g){ return byGC[g]; }), gC=gTop.map(function(g,i){ return _ARKPI_PALETTE[i%_ARKPI_PALETTE.length]; });
    if (gOther>0){ gL.push('Other'); gD.push(gOther); gC.push('#555'); }
    _arKpiCharts.push(new Chart(gcEl, chartCfg(gL, gD, gC, fmtD)));
  }

  // Mix pie
  var mixEl = document.getElementById('arKpiMixPie');
  if (mixEl) {
    var byMix = {};
    invs.forEach(function(inv){
      (inv.mixItems||[]).forEach(function(m){
        var mt=m.mixType||'Unknown';
        if (!byMix[mt]) byMix[mt]=0;
        byMix[mt]+=parseFloat(m.tonQty)||0;
      });
    });
    var mNames=Object.keys(byMix).sort(function(a,b){ return byMix[b]-byMix[a]; });
    var mL=mNames.map(function(mt){ return _arKpiMtLabel(mt); });
    var mD=mNames.map(function(mt){ return byMix[mt]; });
    var mC=mNames.map(function(mt,i){ return _ARKPI_PALETTE[i%_ARKPI_PALETTE.length]; });
    _arKpiCharts.push(new Chart(mixEl, chartCfg(mL, mD, mC, function(v){ return (parseFloat(v)||0).toFixed(1)+' T'; })));
  }

  // Supplier pie
  var supEl = document.getElementById('arKpiSupPie');
  if (supEl) {
    var byS = {};
    invs.forEach(function(inv){
      var sup=inv.supplier||'Unknown';
      (inv.mixItems||[]).forEach(function(m){
        if (!byS[sup]) byS[sup]=0;
        byS[sup]+=parseFloat(m.itemTotal)||0;
      });
    });
    var sNames=Object.keys(byS).sort(function(a,b){ return byS[b]-byS[a]; });
    var sTop=sNames.slice(0,6), sOther=sNames.slice(6).reduce(function(s,n){ return s+byS[n]; },0);
    var sL=sTop.slice(), sD=sTop.map(function(s){ return byS[s]; }), sC=sTop.map(function(s,i){ return _ARKPI_PALETTE[(i+3)%_ARKPI_PALETTE.length]; });
    if (sOther>0){ sL.push('Other'); sD.push(sOther); sC.push('#555'); }
    _arKpiCharts.push(new Chart(supEl, chartCfg(sL, sD, sC, fmtD)));
  }
}
