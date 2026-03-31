const express    = require('express');
const app        = express();
const PORT       = process.env.PORT || 3000;

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL  = 'https://api.anthropic.com/v1/messages';
const ONESTEPGPS_API_KEY = process.env.ONESTEPGPS_API_KEY;
const FIREBASE_API_KEY   = process.env.FIREBASE_API_KEY;
const FIRESTORE_BASE     = 'https://firestore.googleapis.com/v1/projects/dmc-estimate-assistant-bffd6/databases/(default)/documents';

const { ImapFlow }     = require('imapflow');
const nodemailer       = require('nodemailer');
const { simpleParser } = require('mailparser');

// ── Mail server settings ────────────────────────────────────────────────────
const IMAP_HOST = 'register-imap-oxcs.hostingplatform.com';
const IMAP_PORT = 993;
const SMTP_HOST = 'register-smtp-oxcs.hostingplatform.com';
const SMTP_PORT = 587;

// ── CORS ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gps-key');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

app.use(express.json({ limit: '50mb' }));

// ── Helper: create IMAP client from credentials object ──────────────────────
function makeImap(creds) {
  return new ImapFlow({
    host:    creds.host,
    port:    creds.port    || 993,
    secure:  creds.secure  !== false,
    auth:    { user: creds.auth.user, pass: creds.auth.pass },
    logger:  false,
    connectionTimeout: 20000,
    greetingTimeout:   10000,
    socketTimeout:     30000
  });
}

// ── Per-user credential lookup (env vars → Firestore) ────────────────────────
const getMailCredentials = async (username) => {
  if (!username) throw new Error('No username provided');
  const uKey = username.toUpperCase().replace(/[^A-Z0-9]/g, '_');

  // 1. Environment variables (MAIL_HOST_DJ, MAIL_USER_DJ, MAIL_PASS_DJ …)
  if (process.env['MAIL_USER_' + uKey] && process.env['MAIL_PASS_' + uKey]) {
    const host     = process.env['MAIL_HOST_' + uKey]      || IMAP_HOST;
    const port     = parseInt(process.env['MAIL_PORT_' + uKey]      || '993');
    const smtpHost = process.env['MAIL_SMTP_HOST_' + uKey] || host  || SMTP_HOST;
    const smtpPort = parseInt(process.env['MAIL_SMTP_PORT_' + uKey] || '587');
    return { host, port, secure: port === 993, smtpHost, smtpPort,
             auth: { user: process.env['MAIL_USER_' + uKey], pass: process.env['MAIL_PASS_' + uKey] } };
  }

  // 2. Firestore — collection: mail_credentials, doc: username.toLowerCase()
  if (!FIREBASE_API_KEY) throw new Error('No mail credentials configured for ' + username);
  const url = `${FIRESTORE_BASE}/mail_credentials/${username.toLowerCase()}?key=${FIREBASE_API_KEY}`;
  const r   = await fetch(url);
  if (!r.ok) throw new Error('No mail credentials configured for ' + username);
  const doc = await r.json();
  if (!doc.fields) throw new Error('No mail credentials configured for ' + username);
  const f       = doc.fields;
  const getStr  = k => f[k]?.stringValue  || '';
  const getInt  = (k, d) => parseInt(f[k]?.integerValue || f[k]?.doubleValue || d);
  const getBool = (k, d) => f[k]?.booleanValue !== undefined ? f[k].booleanValue : d;
  if (getBool('enabled', true) === false) throw new Error('Mail access disabled for ' + username);
  const host     = getStr('host')     || IMAP_HOST;
  const smtpHost = getStr('smtpHost') || host || SMTP_HOST;
  return {
    host, port: getInt('port', 993), secure: getBool('secure', true),
    smtpHost,  smtpPort: getInt('smtpPort', 587),
    auth: { user: getStr('user'), pass: getStr('pass') }
  };
};

// ── Mail: check if credentials are configured ────────────────────────────────
app.get('/mail/credentials/check', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ hasCredentials: false });
  try {
    const uKey = username.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    if (process.env['MAIL_USER_' + uKey] && process.env['MAIL_PASS_' + uKey]) {
      return res.json({ hasCredentials: true, displayName: username, source: 'env' });
    }
    if (!FIREBASE_API_KEY) return res.json({ hasCredentials: false });
    const url = `${FIRESTORE_BASE}/mail_credentials/${username.toLowerCase()}?key=${FIREBASE_API_KEY}`;
    const r   = await fetch(url);
    if (!r.ok) return res.json({ hasCredentials: false });
    const doc = await r.json();
    if (!doc.fields) return res.json({ hasCredentials: false });
    const enabled     = doc.fields.enabled?.booleanValue !== false;
    const displayName = doc.fields.displayName?.stringValue || username;
    res.json({ hasCredentials: enabled, displayName });
  } catch (e) {
    res.json({ hasCredentials: false });
  }
});

// ── Mail: save credentials (admin only) ──────────────────────────────────────
app.post('/mail/credentials/save', async (req, res) => {
  const { adminToken, username, host, port, smtpHost, smtpPort, user, pass, displayName } = req.body;
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) return res.status(403).json({ error: 'Unauthorized' });
  if (!username || !user || !pass) return res.status(400).json({ error: 'username, user, and pass are required' });
  if (!FIREBASE_API_KEY) return res.status(500).json({ error: 'Firestore not configured on server' });
  try {
    const url = `${FIRESTORE_BASE}/mail_credentials/${username.toLowerCase()}?key=${FIREBASE_API_KEY}`;
    const r   = await fetch(url, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields: {
        username:    { stringValue:  username },
        host:        { stringValue:  host     || IMAP_HOST },
        port:        { integerValue: String(port     || 993) },
        secure:      { booleanValue: (port || 993) === 993 },
        smtpHost:    { stringValue:  smtpHost || host || SMTP_HOST },
        smtpPort:    { integerValue: String(smtpPort || 587) },
        user:        { stringValue:  user },
        pass:        { stringValue:  pass },
        displayName: { stringValue:  displayName || user },
        enabled:     { booleanValue: true }
      }})
    });
    if (!r.ok) { const e = await r.json().catch(()=>({})); return res.status(500).json({ error: e.error?.message || 'Firestore write failed' }); }
    res.json({ ok: true, username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mail: test connection (admin only) ────────────────────────────────────────
app.post('/mail/test', async (req, res) => {
  const { adminToken, host, port, user, pass } = req.body;
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) return res.status(403).json({ error: 'Unauthorized' });
  if (!host || !user || !pass) return res.status(400).json({ error: 'host, user, and pass are required' });
  const client = new ImapFlow({
    host, port: port || 993, secure: (port || 993) === 993,
    auth: { user, pass }, logger: false,
    connectionTimeout: 15000, greetingTimeout: 8000, socketTimeout: 20000
  });
  try {
    await client.connect();
    const list = await client.list();
    await client.logout();
    res.json({ ok: true, folderCount: list.length });
  } catch (e) {
    try { await client.logout(); } catch (_) {}
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── Auth login ──────────────────────────────────────────────────────────────
app.post('/auth-login', (req, res) => {
  const body = req.body || {};
  const login = (body.username || body.login || '').trim();
  const password = (body.password || '').trim();
  if (!login || !password) return res.status(400).json({ error: 'Missing credentials' });

  const STOCK_PASSWORD = 'DMCWelcome2026!';
  const ACCOUNTS = {
    'dj':          'Caboverde1094!',
    'donmartin':   'DMCWelcome2026!',
    'nightmare57': 'Chevy1970',
    'Nightmare57': 'Chevy1970',
    'igiron':      'DMCWelcome2026!',
    'IGiron':      'DMCWelcome2026!',
    'ATow':        'DMCTow2025',
    'Christian':   'DMCWelcome2026!',
    'DSouza':      'Pestario86!!',
  };
  const uLower = login.toLowerCase();
  const matchKey = Object.keys(ACCOUNTS).find(k => k.toLowerCase() === uLower);
  const valid = matchKey && (ACCOUNTS[matchKey] === password || password === STOCK_PASSWORD);
  if (valid) return res.json({ ok: true, success: true, username: matchKey });
  res.status(401).json({ error: 'Invalid credentials' });
});

// ── Claude proxy ────────────────────────────────────────────────────────────
app.post('/claude', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to Railway environment variables.' });
  }
  try {
    const wantStream = req.body && req.body.stream === true;
    const body = wantStream ? req.body : Object.assign({}, req.body, { stream: false });

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json(data);
    }

    if (wantStream) {
      // Pipe SSE stream straight through — keeps connection alive during long scans
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');
      for await (const chunk of response.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'proxy_error', message: err.message });
    } else if (!res.writableEnded) {
      // Headers already sent (streaming) — must still close the connection
      res.end();
    }
  }
});

// ── Plans scan: AI summary generation with SSE streaming ────────────────────
function buildSummaryPrompt(pageExtracts, fileList) {
  return `You are an expert HMA pavement estimator for a paving contractor. Files: ${fileList}

Analyze these civil plan extractions and produce a complete quantity takeoff. 

HMA IDENTIFICATION — extract ALL items matching these criteria:

INCLUDE these materials:
- HMA, Hot Mix Asphalt, Bituminous Concrete, BC
- Superpave, dense graded, open graded
- Friction course, leveling course, binder course
- Base course, intermediate course, surface course
- Type I, Type II, Type III asphalt mixes
- 19mm, 12.5mm, 9.5mm SP or SM mixes
- SBC37.5 — this is a base layer asphalt mix, always include and flag as BASE COURSE
- Bridge mix, bridge deck asphalt, waterproofing membrane asphalt
- Asphalt sidewalks and shared use paths (include but label group as "Asphalt Sidewalk" or "Shared Use Path" separately from roadway)
- Bituminous berm, bituminous concrete berm, BC berm — calculate linear feet AND tonnage (use 0.1 SY per LF as standard conversion, then apply tons formula)
- Tack coat, prime coat between asphalt lifts
- Milling of existing asphalt — identify ALL areas requiring milling, note depth of mill, calculate SF/SY of milling area separately
- Reclaiming, pulverizing existing pavement
- Any overlay, infrared repair, or wedge/leveling course

MILLING IDENTIFICATION:
- Look for notes like "mill X inches", "cold plane X inches", "remove existing pavement"
- Calculate milling quantities in SY same as paving quantities
- Flag milling depth separately — milling depth is NOT the same as paving depth
- If milling depth matches a lift thickness, note it as a possible remove and replace

BITUMINOUS BERM:
- Look for BC berm, bituminous berm, asphalt berm on plan sheets and details
- Quantity in linear feet (LF) as stated or calculated from plan dimensions
- Convert to tons using: LF × 0.1 SY/LF × 0.056 × depth_inches
- Standard berm depth is 4 inches unless otherwise noted

DO NOT extract:
- Portland cement concrete, PCC, reinforced concrete
- Brick, pavers, cobblestone, unit masonry of any kind
- Gravel, crushed stone base (unless directly labeled as part of HMA pavement section)
- Subbase, subgrade, fill, earthwork
- Landscaping, loam, seed, topsoil
- Drainage structures, catch basins, utilities
- Signage, pavement markings (extract separately only if tied to milling/paving scope)
- Concrete sidewalks, concrete curb, concrete gutter

PAVEMENT SECTION IDENTIFICATION:
- Look specifically for TYPICAL PAVEMENT SECTION sheets or details
- Correct section = roadway/travel lane/parking — NOT concrete sidewalk, NOT brick paver detail
- If multiple typical sections exist, extract roadway section first, then asphalt sidewalk/path separately
- If you see SBC37.5 in a section, that is the base course — flag it clearly and include full depth
- Depths from roadway typical section are correct — never use sidewalk or pedestrian detail depths for roadway quantities
- Flag any conflict between typical section depths and quantity table depths in issues[]

QUANTITY CALCULATION RULES:
- Extract all dimensions from roadway plans (lengths, widths, areas)
- Extract all HMA lift depths from typical sections and cross sections
- Calculate SF = length (ft) × width (ft) for each zone/segment
- Calculate SY = SF ÷ 9
- Calculate Tons = SY × 0.056 × depth_inches for each lift
- If stated quantities exist on the plans, record them as statedQty
- Always show your calculated quantities as calcQty
- If dimensions are partially readable, flag as UNVERIFIED but still calculate
- Break quantities out by lift/layer (e.g. base course, intermediate course, surface course)
- If multiple segments or zones exist, calculate each separately then sum

${pageExtracts}

Return ONLY valid JSON (no markdown, no backticks):
{
  "projectMeta": { "projectName": "...", "contractNumber": "...", "projectAddress": "...", "awardingAuthority": "..." },
  "summary": "Detailed 3-5 paragraph scope summary covering all HMA items, lift sequence, mix types, depths, and special items.",
  "quantities": [
    {
      "group": "HMA Surface Course | HMA Intermediate | HMA Base | Other",
      "item": "item description",
      "spec": "mix designation exactly as written",
      "depth": "depth in inches as written on plans",
      "depthInches": 0.0,
      "sf": 0.0,
      "statedQty": "SY as stated on plans or null",
      "calcSY": 0.0,
      "calcTons": 0.0,
      "dimensions": "length x width or area description used to calculate",
      "unverified": false
    }
  ],
  "issues": [{ "type": "UNVERIFIED | MISSING | CONFLICT | ASSUMED", "item": "...", "detail": "..." }],
  "relevantSheets": {
    "hmaSheets": ["sheet numbers containing HMA paving scope, typical sections, pavement details"],
    "millingSheets": ["sheet numbers showing milling limits or notes"],
    "gradingSheets": ["sheet numbers for grading plans — used to confirm elevations and depths"],
    "profileSheets": ["sheet numbers for plan and profile — used to confirm lengths and grades"],
    "trafficMarkingSheets": ["sheet numbers for traffic control, pavement markings, and striping plans"],
    "bermSheets": ["sheet numbers showing bituminous berm details or locations"],
    "bridgeSheets": ["sheet numbers for bridge deck or structure paving if applicable"]
  },
  "materials": "Full pavement section bottom to top with each lift, mix, and depth.",
  "fieldSummary": "3-5 sentences for the foreman covering lifts, special items, and field notes."
}
RULES:
- Never invent dimensions. Use null if unreadable but flag it
- Show all math — include dimensions field so calculations can be verified
- Report mix designations exactly as written on plans
- Tons formula: SY × 0.056 × depth_inches
- If a quantity table exists on the plans, extract stated quantities AND independently calculate
- When in doubt whether an item is HMA — include it but mark unverified: true
- relevantSheets: include sheet number AND title where readable. If a sheet covers multiple categories, list it in all. Grading, profile, traffic/marking sheets are always relevant. If a sheet number is partially readable, note (unverified) in parentheses`;
}

app.post('/api/plans/scan', async (req, res) => {
  const { planText, jobId, fileList } = req.body || {};
  if (!planText || !jobId) {
    return res.status(400).json({ error: 'Missing required fields: planText, jobId' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  // Truncate to ~4,000 tokens (approx 16,000 characters)
  const MAX_CHARS = 16000;
  const truncated = planText.length > MAX_CHARS;
  const inputText = truncated ? planText.slice(0, MAX_CHARS) : planText;
  console.log(`[Plans] jobId=${jobId} input=${planText.length} chars${truncated ? ' → truncated to ' + MAX_CHARS : ''}`);

  const prompt = buildSummaryPrompt(inputText, fileList || 'plans.pdf');

  // SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Keep-alive ping every 10 seconds
  const pingIv = setInterval(() => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 10000);

  let fullText = '';
  let attempts = 0;
  const MAX_ATTEMPTS = 2; // 1 try + 1 automatic retry on timeout

  try {
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const ac = new AbortController();
      // 15-second timeout for initial response headers from Claude
      const timeout = setTimeout(() => ac.abort(), 15000);

      try {
        const response = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            stream: true,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
          }),
          signal: ac.signal
        });

        clearTimeout(timeout); // headers arrived, clear the 15s timeout

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          if (response.status >= 500 && attempts < MAX_ATTEMPTS) {
            console.warn(`[Plans] Attempt ${attempts} got ${response.status}, retrying…`);
            res.write(`data: ${JSON.stringify({ type: 'retry', attempt: attempts + 1 })}\n\n`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`Claude API ${response.status}: ${errText.slice(0, 200)}`);
        }

        // Parse Claude SSE stream and re-emit as simplified SSE events
        fullText = '';
        let sseBuf = '';
        for await (const chunk of response.body) {
          const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : new TextDecoder().decode(chunk);
          sseBuf += str;
          const lines = sseBuf.split('\n');
          sseBuf = lines.pop(); // keep incomplete line in buffer
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const pl = line.slice(6).trim();
            if (pl === '[DONE]') break;
            try {
              const ev = JSON.parse(pl);
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                fullText += ev.delta.text;
                if (!res.writableEnded) {
                  res.write(`data: ${JSON.stringify({ type: 'token', text: ev.delta.text })}\n\n`);
                }
              }
            } catch (e) { /* skip malformed SSE lines */ }
          }
        }
        // Flush remaining SSE buffer
        if (sseBuf.trim()) {
          for (const line of sseBuf.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const pl = line.slice(6).trim();
            if (pl === '[DONE]') break;
            try {
              const ev = JSON.parse(pl);
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                fullText += ev.delta.text;
                if (!res.writableEnded) {
                  res.write(`data: ${JSON.stringify({ type: 'token', text: ev.delta.text })}\n\n`);
                }
              }
            } catch (e) { /* skip */ }
          }
        }

        console.log(`[Plans] Stream complete: ${fullText.length} chars for job ${jobId}`);
        break; // success — exit retry loop

      } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError' && attempts < MAX_ATTEMPTS) {
          console.warn(`[Plans] Attempt ${attempts} timed out after 15s, retrying…`);
          res.write(`data: ${JSON.stringify({ type: 'retry', attempt: attempts + 1 })}\n\n`);
          continue;
        }
        throw err;
      }
    }

    // ── Save to Firestore AFTER stream completes ──
    if (fullText && FIREBASE_API_KEY) {
      try {
        const fsUrl = `${FIRESTORE_BASE}/plans/${jobId}?key=${FIREBASE_API_KEY}`;
        await fetch(fsUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              summary: { stringValue: fullText },
              generatedAt: { integerValue: String(Date.now()) },
              jobId: { stringValue: jobId }
            }
          })
        });
        console.log(`[Plans] Saved summary to Firestore for job ${jobId}`);
      } catch (fsErr) {
        console.error('[Plans] Firestore save failed:', fsErr.message);
      }
    }

    // Send completion event
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'complete', charCount: fullText.length })}\n\n`);
      res.write('data: [DONE]\n\n');
    }

  } catch (err) {
    console.error('[Plans] Scan error:', err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
  } finally {
    clearInterval(pingIv);
    if (!res.writableEnded) res.end();
  }
});

// ── Mail: list folders ──────────────────────────────────────────────────────
app.post('/mail/folders', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Missing username' });
  let client;
  try {
    const creds = await getMailCredentials(username);
    client = makeImap(creds);
    await client.connect();
    const list = await client.list();
    const folders = list.map(item => ({
      name:       item.name,
      path:       item.path,
      specialUse: item.specialUse || null,
      flags:      [...(item.flags || [])]
    }));
    await client.logout();
    res.json({ folders });
  } catch (err) {
    try { if (client) await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: list messages in a folder ────────────────────────────────────────
app.post('/mail/inbox', async (req, res) => {
  const { username, folder = 'INBOX', limit = 50 } = req.body;
  if (!username) return res.status(400).json({ error: 'Missing username' });
  let client;
  try {
    const creds = await getMailCredentials(username);
    client = makeImap(creds);
    await client.connect();
    const mb    = await client.mailboxOpen(folder);
    const total = mb.exists;
    if (total === 0) {
      await client.logout();
      return res.json({ messages: [], total: 0 });
    }
    const lim   = Math.min(parseInt(limit) || 50, total);
    const start = total - lim + 1;
    const messages = [];
    for await (const msg of client.fetch(`${start}:${total}`, {
      envelope: true,
      flags:    true,
      uid:      true
    })) {
      messages.push({
        uid:     msg.uid,
        seq:     msg.seq,
        subject: msg.envelope.subject || '(no subject)',
        from:    msg.envelope.from?.[0] || null,
        to:      msg.envelope.to || [],
        date:    msg.envelope.date,
        seen:    msg.flags?.has('\\Seen')    || false,
        flagged: msg.flags?.has('\\Flagged') || false
      });
    }
    await client.logout();
    res.json({ messages: messages.reverse(), total });
  } catch (err) {
    try { if (client) await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: fetch full message ────────────────────────────────────────────────
app.post('/mail/message', async (req, res) => {
  const { username, folder = 'INBOX', uid } = req.body;
  if (!username || !uid) return res.status(400).json({ error: 'Missing params' });
  let client;
  try {
    const creds = await getMailCredentials(username);
    client = makeImap(creds);
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: false });
    let result = null;
    for await (const msg of client.fetch(
      { uid: parseInt(uid) },
      { source: true, envelope: true, flags: true },
      { uid: true }
    )) {
      const parsed = await simpleParser(msg.source);
      result = {
        uid:         msg.uid,
        subject:     parsed.subject  || msg.envelope.subject || '(no subject)',
        from:        parsed.from?.value?.[0] || msg.envelope.from?.[0] || null,
        to:          parsed.to?.value  || msg.envelope.to  || [],
        cc:          parsed.cc?.value  || msg.envelope.cc  || [],
        date:        parsed.date || msg.envelope.date,
        html:        parsed.html || null,
        text:        parsed.text || null,
        seen:        msg.flags?.has('\\Seen')    || false,
        flagged:     msg.flags?.has('\\Flagged') || false,
        attachments: (parsed.attachments || []).map(a => ({
          filename:    a.filename    || 'attachment',
          size:        a.size        || 0,
          contentType: a.contentType || 'application/octet-stream'
        }))
      };
      await client.messageFlagsAdd({ uid: parseInt(uid) }, ['\\Seen'], { uid: true });
    }
    await client.logout();
    if (!result) return res.status(404).json({ error: 'Message not found' });
    res.json(result);
  } catch (err) {
    try { if (client) await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: download attachment ───────────────────────────────────────────────
app.post('/mail/attachment', async (req, res) => {
  const { username, folder = 'INBOX', uid, filename } = req.body;
  if (!username || !uid || !filename) return res.status(400).json({ error: 'Missing params' });
  let client;
  try {
    const creds = await getMailCredentials(username);
    client = makeImap(creds);
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: true });
    let found = false;
    for await (const msg of client.fetch(
      { uid: parseInt(uid) },
      { source: true },
      { uid: true }
    )) {
      const parsed = await simpleParser(msg.source);
      const att = (parsed.attachments || []).find(a => a.filename === filename);
      if (!att) { found = false; break; }
      found = true;
      res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', att.size || att.content.length);
      res.send(att.content);
    }
    if (!found) res.status(404).json({ error: 'Attachment not found' });
    await client.logout();
  } catch(err) {
    try { if (client) await client.logout(); } catch(e) {}
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Mail: send ──────────────────────────────────────────────────────────────
app.post('/mail/send', async (req, res) => {
  const { username, to, cc, subject, html, text, inReplyTo, references } = req.body;
  if (!username || !to || !subject) return res.status(400).json({ error: 'Missing params' });
  try {
    const creds = await getMailCredentials(username);
    const transport = nodemailer.createTransport({
      host:           creds.smtpHost || SMTP_HOST,
      port:           creds.smtpPort || SMTP_PORT,
      secure:         false,
      requireTLS:     true,
      auth:           { user: creds.auth.user, pass: creds.auth.pass },
      connectionTimeout: 15000
    });
    await transport.sendMail({
      from:       creds.auth.user,
      to,
      cc:         cc        || undefined,
      subject,
      html:       html      || undefined,
      text:       text      || undefined,
      inReplyTo:  inReplyTo || undefined,
      references: references|| undefined
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: actions (read/unread/flag/delete) ─────────────────────────────────
app.post('/mail/action', async (req, res) => {
  const { username, folder = 'INBOX', uid, action } = req.body;
  if (!username || !uid || !action) return res.status(400).json({ error: 'Missing params' });
  let client;
  try {
    const creds = await getMailCredentials(username);
    client = makeImap(creds);
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: false });
    const u = parseInt(uid);
    if (action === 'read')   await client.messageFlagsAdd(   { uid: u }, ['\\Seen'],    { uid: true });
    if (action === 'unread') await client.messageFlagsRemove({ uid: u }, ['\\Seen'],    { uid: true });
    if (action === 'flag')   await client.messageFlagsAdd(   { uid: u }, ['\\Flagged'], { uid: true });
    if (action === 'unflag') await client.messageFlagsRemove({ uid: u }, ['\\Flagged'], { uid: true });
    if (action === 'delete') {
      let moved = false;
      const allFolders = await client.list();
      for (const f of allFolders) {
        const p = (f.path || '').toLowerCase();
        if (p === 'trash' || p === 'deleted items' || p === 'deleted messages' || f.specialUse === '\\Trash') {
          try { await client.messageMove({ uid: u }, f.path, { uid: true }); moved = true; } catch(e) {}
          break;
        }
      }
      if (!moved) {
        await client.messageFlagsAdd({ uid: u }, ['\\Deleted'], { uid: true });
        await client.mailboxExpunge();
      }
    }
    await client.logout();
    res.json({ ok: true });
  } catch (err) {
    try { if (client) await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── ElevenLabs TTS proxy ─────────────────────────────────────────────────────
app.post('/tts', async (req, res) => {
  const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVEN_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured in Railway environment' });
  const { text, voice_id = 'BpjGufoPiobT79j2vtj4' } = req.body; // custom DMC voice
  if (!text) return res.status(400).json({ error: 'Missing text' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.30, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true }
      })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return res.status(r.status).json(e);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── OneStepGPS proxy ─────────────────────────────────────────────────────────
app.get('/gps/devices', async (req, res) => {
  const gpsKey = ONESTEPGPS_API_KEY || req.headers['x-gps-key'] || '';
  if (!gpsKey)
    return res.status(500).json({ error: 'ONESTEPGPS_API_KEY not configured in Railway environment' });
  try {
    // Fetch devices (required) and groups (optional — fail gracefully)
    const devRes = await fetch(
      `https://track.onestepgps.com/v3/api/public/device?latest_point=true&api-key=${gpsKey}`
    );
    const devData = await devRes.json();

    // Try to fetch groups — if it fails, proceed without group names
    let groupNameMap = {};
    try {
      const grpRes = await fetch(`https://track.onestepgps.com/v3/api/public/group?api-key=${gpsKey}`);
      if (grpRes.ok) {
        const grpData = await grpRes.json();
        const groups = grpData.result_list || grpData.groups || (Array.isArray(grpData) ? grpData : []);
        groups.forEach(g => {
          if (g.group_id != null) groupNameMap[String(g.group_id)] = g.group_name || g.name || String(g.group_id);
        });
      }
    } catch (grpErr) {
      console.warn('GPS groups fetch failed (non-fatal):', grpErr.message);
    }

    // Enrich each device with resolved group names
    const devices = (devData.result_list || []).map(dev => {
      let names = [];
      const g = dev.groups || dev.group_ids || dev.group_id;
      if (Array.isArray(g)) {
        names = g.map(x => {
          if (typeof x === 'string' || typeof x === 'number') return groupNameMap[String(x)] || String(x);
          return x.group_name || x.name || groupNameMap[String(x.group_id)] || null;
        }).filter(Boolean);
      } else if (g != null) {
        names = [groupNameMap[String(g)] || String(g)];
      }
      return Object.assign({}, dev, { _groupNames: names.length ? names : ['Ungrouped Devices'] });
    });

    res.json(Object.assign({}, devData, { result_list: devices, _groupMap: groupNameMap }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`DMC proxy running on port ${PORT}`);
});
