const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Netlify max function timeout — set in netlify.toml to 60s
exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  var origin = event.headers.origin || event.headers.Origin || '';
  var allowedOrigins = ['https://dmcapp.netlify.app', 'http://localhost'];
  var originAllowed = allowedOrigins.some(function(o) { return origin.startsWith(o); });
  if (origin && !originAllowed) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden' })
    };
  }

  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured. Add ANTHROPIC_API_KEY to Netlify environment variables.' })
    };
  }

  try {
    var body = JSON.parse(event.body);

    // Race the API call against a 25-second timeout.
    // Netlify synchronous functions are hard-capped at ~26s regardless of netlify.toml.
    // Keeping the internal timeout just under that cap so we can return a clean 504
    // instead of being killed mid-response by the platform.
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error('TIMEOUT: Claude did not respond within 25 seconds. This is usually caused by a large or multi-page PDF — try compressing the file or splitting it into smaller uploads.'));
      }, 25000);
    });

    var fetchPromise = fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    var response = await Promise.race([fetchPromise, timeoutPromise]);
    var data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || 'https://dmcapp.netlify.app',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(data)
    };

  } catch (err) {
    var isTimeout = err.message && err.message.startsWith('TIMEOUT');
    return {
      statusCode: isTimeout ? 504 : 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || 'https://dmcapp.netlify.app'
      },
      body: JSON.stringify({
        error: isTimeout ? 'timeout' : 'proxy_error',
        message: err.message
      })
    };
  }

};
