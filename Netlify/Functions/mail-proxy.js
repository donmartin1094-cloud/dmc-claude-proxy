const { ImapFlow }     = require('imapflow');
const nodemailer       = require('nodemailer');
const { simpleParser } = require('mailparser');

const IMAP_HOST = 'register-imap-oxcs.hostingplatform.com';
const IMAP_PORT = 993;
const SMTP_HOST = 'register-smtp-oxcs.hostingplatform.com';
const SMTP_PORT = 587;

// Tight timeouts so we stay well inside Netlify's 26s hard limit
function makeImap(user, pass) {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 8000,
    greetingTimeout: 5000,
    socketTimeout: 10000
  });
}

exports.handler = async function(event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { op, user, pass, folder, uid, action, limit, to, subject, html, text, inReplyTo, references } = body;
  if (!user || !pass) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing credentials' }) };

  try {

    // ── List folders ──────────────────────────────────────────────────────────
    if (op === 'folders') {
      const client = makeImap(user, pass);
      await client.connect();
      const folders = [];
      const list = await client.list();
      for (const item of list) {
        folders.push({ name: item.name, path: item.path, specialUse: item.specialUse || null, flags: [...(item.flags || [])] });
      }
      await client.logout();
      return { statusCode: 200, headers, body: JSON.stringify({ folders }) };
    }

    // ── List messages ─────────────────────────────────────────────────────────
    if (op === 'inbox') {
      const client = makeImap(user, pass);
      await client.connect();
      const mb    = await client.mailboxOpen(folder || 'INBOX');
      const total = mb.exists;
      if (total === 0) { await client.logout(); return { statusCode: 200, headers, body: JSON.stringify({ messages: [], total: 0 }) }; }
      const lim   = Math.min(parseInt(limit) || 50, total);
      const start = total - lim + 1;
      const messages = [];
      for await (const msg of client.fetch(`${start}:${total}`, { envelope: true, flags: true, uid: true })) {
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
      return { statusCode: 200, headers, body: JSON.stringify({ messages: messages.reverse(), total }) };
    }

    // ── Fetch full message ────────────────────────────────────────────────────
    // Limit raw source to 512 KB so large attachments don't blow the 26s Netlify timeout.
    // simpleParser handles partial MIME gracefully — body text/html comes through fine.
    if (op === 'message') {
      const client = makeImap(user, pass);
      await client.connect();
      await client.mailboxOpen(folder || 'INBOX', { readOnly: false });
      let result = null;
      for await (const msg of client.fetch(
        { uid: parseInt(uid) },
        { source: { start: 0, maxLength: 524288 }, envelope: true, flags: true },
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
          attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || 'attachment', size: a.size || 0, contentType: a.contentType || 'application/octet-stream' }))
        };
        await client.messageFlagsAdd({ uid: parseInt(uid) }, ['\\Seen'], { uid: true });
      }
      await client.logout();
      if (!result) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Message not found' }) };
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    if (op === 'send') {
      if (!to || !subject) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing params' }) };
      const transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, requireTLS: true, auth: { user, pass }, connectionTimeout: 10000 });
      await transport.sendMail({ from: user, to, cc: body.cc || undefined, subject, html: html || undefined, text: text || undefined, inReplyTo: inReplyTo || undefined, references: references || undefined });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── Actions (read/unread/flag/delete) ─────────────────────────────────────
    if (op === 'action') {
      if (!uid || !action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing params' }) };
      const client = makeImap(user, pass);
      await client.connect();
      await client.mailboxOpen(folder || 'INBOX', { readOnly: false });
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
        if (!moved) { await client.messageFlagsAdd({ uid: u }, ['\\Deleted'], { uid: true }); await client.mailboxExpunge(); }
      }
      await client.logout();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown operation: ' + op }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
