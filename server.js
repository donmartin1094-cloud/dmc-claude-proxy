const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Allow all origins — the API key protects the server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// 50MB limit to handle large PDFs encoded as base64
app.use(express.json({ limit: '50mb' }));

app.post('/claude', async (req, res) => {
  console.log('body keys:', Object.keys(req.body || {}), 'model:', req.body?.model);
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY to Railway environment variables.' });
  }
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
        const data = await response.json();
    if (!response.ok) console.error('Anthropic error:', JSON.stringify(data));
    res.status(response.status).json(data);

  } catch (err) {
    res.status(500).json({ error: 'proxy_error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`DMC Claude proxy running on port ${PORT}`);
  console.log('API key set:', !!process.env.ANTHROPIC_API_KEY);
  console.log('Test var:', process.env.TEST_VAR);
});
