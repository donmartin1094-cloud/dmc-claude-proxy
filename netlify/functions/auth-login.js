exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    // Accept both { username } and { login } field names (index.html sends 'login')
    const login = (body.username || body.login || '').trim();
    const password = (body.password || '').trim();

    if (!login || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing credentials' })
      };
    }

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
    const valid = matchKey && (
      ACCOUNTS[matchKey] === password ||
      password === STOCK_PASSWORD
    );

    if (valid) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, success: true, username: matchKey })
      };
    }

    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid credentials' })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
