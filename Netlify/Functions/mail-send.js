const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://dmcapp.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { username, to, cc, subject, html, text } = JSON.parse(event.body || '{}');
    if (!username || !to || !subject) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing params' })
      };
    }

    // Get credentials from env vars
    const uKey = username.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const mailUser = process.env['MAIL_USER_' + uKey];
    const mailPass = process.env['MAIL_PASS_' + uKey];
    const smtpHost = process.env['MAIL_SMTP_HOST_' + uKey]
      || 'register-smtp-oxcs.hostingplatform.com';
    const smtpPort = parseInt(process.env['MAIL_SMTP_PORT_' + uKey] || '587');

    if (!mailUser || !mailPass) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No mail credentials for ' + username })
      };
    }

    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      requireTLS: smtpPort === 587,
      auth: { user: mailUser, pass: mailPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 20000
    });

    await transport.sendMail({
      from: mailUser,
      to, cc, subject, html, text
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message, code: err.code })
    };
  }
};
