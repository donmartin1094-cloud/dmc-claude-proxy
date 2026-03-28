const express    = require('express');
const app        = express();
const PORT       = process.env.PORT || 3000;

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL  = 'https://api.anthropic.com/v1/messages';
const ONESTEPGPS_API_KEY = process.env.ONESTEPGPS_API_KEY;

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

// ── Helper: create IMAP client ──────────────────────────────────────────────
function makeImap(user, pass) {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 20000,
    greetingTimeout: 10000,
    socketTimeout: 30000
  });
}

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
    if (!res.headersSent) res.status(500).json({ error: 'proxy_error', message: err.message });
  }
});

// ── Mail: list folders ──────────────────────────────────────────────────────
app.post('/mail/folders', async (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) return res.status(400).json({ error: 'Missing credentials' });
  const client = makeImap(user, pass);
  try {
    await client.connect();
    const folders = [];
    for await (const item of client.list()) {
      folders.push({
        name:       item.name,
        path:       item.path,
        specialUse: item.specialUse || null,
        flags:      [...(item.flags || [])]
      });
    }
    await client.logout();
    res.json({ folders });
  } catch (err) {
    try { await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: list messages in a folder ────────────────────────────────────────
app.post('/mail/inbox', async (req, res) => {
  const { user, pass, folder = 'INBOX', limit = 50 } = req.body;
  if (!user || !pass) return res.status(400).json({ error: 'Missing credentials' });
  const client = makeImap(user, pass);
  try {
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
    try { await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: fetch full message ────────────────────────────────────────────────
app.post('/mail/message', async (req, res) => {
  const { user, pass, folder = 'INBOX', uid } = req.body;
  if (!user || !pass || !uid) return res.status(400).json({ error: 'Missing params' });
  const client = makeImap(user, pass);
  try {
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
      // Mark as read
      await client.messageFlagsAdd({ uid: parseInt(uid) }, ['\\Seen'], { uid: true });
    }
    await client.logout();
    if (!result) return res.status(404).json({ error: 'Message not found' });
    res.json(result);
  } catch (err) {
    try { await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: send ──────────────────────────────────────────────────────────────
app.post('/mail/send', async (req, res) => {
  const { user, pass, to, cc, subject, html, text, inReplyTo, references } = req.body;
  if (!user || !pass || !to || !subject) return res.status(400).json({ error: 'Missing params' });
  try {
    const transport = nodemailer.createTransport({
      host:           SMTP_HOST,
      port:           SMTP_PORT,
      secure:         false,
      requireTLS:     true,
      auth:           { user, pass },
      connectionTimeout: 15000
    });
    await transport.sendMail({
      from:       user,
      to,
      cc:         cc         || undefined,
      subject,
      html:       html       || undefined,
      text:       text       || undefined,
      inReplyTo:  inReplyTo  || undefined,
      references: references || undefined
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mail: actions (read/unread/flag/delete) ─────────────────────────────────
app.post('/mail/action', async (req, res) => {
  const { user, pass, folder = 'INBOX', uid, action } = req.body;
  if (!user || !pass || !uid || !action) return res.status(400).json({ error: 'Missing params' });
  const client = makeImap(user, pass);
  try {
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: false });
    const u = parseInt(uid);
    if (action === 'read')   await client.messageFlagsAdd(   { uid: u }, ['\\Seen'],    { uid: true });
    if (action === 'unread') await client.messageFlagsRemove({ uid: u }, ['\\Seen'],    { uid: true });
    if (action === 'flag')   await client.messageFlagsAdd(   { uid: u }, ['\\Flagged'], { uid: true });
    if (action === 'unflag') await client.messageFlagsRemove({ uid: u }, ['\\Flagged'], { uid: true });
    if (action === 'delete') {
      let moved = false;
      // Try to find a Trash folder
      for await (const f of client.list()) {
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
    try { await client.logout(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ── ElevenLabs TTS proxy ─────────────────────────────────────────────────────
app.post('/tts', async (req, res) => {
  const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVEN_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured in Railway environment' });
  const { text, voice_id = 'cgSgspJ2msm6clMCkdW9' } = req.body; // default: "Jessica" (warm, clear)
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
