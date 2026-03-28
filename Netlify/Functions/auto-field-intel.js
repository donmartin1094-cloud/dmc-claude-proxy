const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const FIELD_INTEL_SECRET = process.env.FIELD_INTEL_SECRET;
const FIREBASE_API_KEY   = 'AIzaSyA-km_fS86PCEXDpliAObRVJU34svg45Ds';
const PROJECT_ID         = 'dmc-estimate-assistant-bffd6';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/app_data`;

// ─── Firestore REST helpers ───────────────────────────────────────────────────

async function fsGet(docName) {
  try {
    const res = await fetch(`${FS_BASE}/${docName}?key=${FIREBASE_API_KEY}`);
    if (!res.ok) return null;
    const doc = await res.json();
    const raw = doc.fields?.data?.stringValue;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

async function fsPatch(docName, value) {
  await fetch(`${FS_BASE}/${docName}?key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        data:      { stringValue: JSON.stringify(value) },
        updatedAt: { integerValue: String(Date.now()) }
      }
    })
  });
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function geocodeAddress(address) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'DMCApp/1.0' } }
    );
    const data = await res.json();
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch(e) { return null; }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  const origin  = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || 'https://dmcapp.netlify.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // ── Parse body ──
  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // ── Auth ── (web app origin bypasses secret; iOS Shortcut must supply secret)
  const fromAllowedOrigin = ['https://dmcapp.netlify.app', 'http://localhost'].some(o => origin.startsWith(o));
  if (!fromAllowedOrigin && (!FIELD_INTEL_SECRET || body.secret !== FIELD_INTEL_SECRET))
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized — check FIELD_INTEL_SECRET' }) };

  if (!ANTHROPIC_API_KEY)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  const { photo, mimeType = 'image/jpeg', lat, lon, note } = body;
  if (!photo)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No photo provided' }) };

  try {
    // ── 1. Load backlog jobs ──
    const jobs = await fsGet('backlog') || [];

    // ── 2. Geocode & match nearest job ──
    let geoCache     = await fsGet('geoCache') || {};
    let cacheUpdated = false;
    let bestJob      = null;
    let bestDist     = Infinity;

    if (lat && lon && jobs.length) {
      for (const job of jobs) {
        const addr = job.location || job.address || job.name;
        if (!addr) continue;
        const key = addr.trim().toLowerCase();
        if (!geoCache[key]) {
          const coords = await geocodeAddress(addr);
          if (coords) { geoCache[key] = coords; cacheUpdated = true; }
        }
        if (!geoCache[key]) continue;
        const dist = haversineMiles(lat, lon, geoCache[key].lat, geoCache[key].lon);
        if (dist < bestDist) { bestDist = dist; bestJob = job; }
      }
    }

    if (cacheUpdated) await fsPatch('geoCache', geoCache);

    const distMiles   = bestDist < Infinity ? parseFloat(bestDist.toFixed(3)) : null;
    const withinRange = distMiles !== null && distMiles <= 0.5;
    const jobLabel    = bestJob
      ? `${bestJob.num || bestJob.id} — ${bestJob.name}${bestJob.location ? ' (' + bestJob.location + ')' : ''}`
      : 'Unknown job (no GPS match)';

    // ── 3. Claude analysis ──
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: photo }
            },
            {
              type: 'text',
              text: `Auto-captured field photo from Meta Ray-Ban smart glasses.
Job: ${jobLabel}
GPS distance from matched job site: ${distMiles !== null ? distMiles + ' miles' : 'unavailable'}
${withinRange ? '✓ Photo confirmed on-site' : distMiles !== null ? '⚠ Photo taken off-site — assess anyway' : '⚠ No GPS match available'}
${note ? 'Field note: ' + note : ''}

Provide a concise field intelligence assessment with these sections:

SITE CONDITION
What the photo shows — surface type, current state, visible defects or conditions.

SURFACE AREA ESTIMATE
Approximate square footage visible. Confidence level.

MATERIAL NOTES
Surface condition assessment. Recommended mix type. Depth callout if determinable.

STAGING OBSERVATION
Equipment access, laydown area, pinch points, anything that affects paving sequence.

ACTION ITEMS
Immediate flags, follow-up needed, or scope observations.

Keep each section to 2-3 sentences. Be specific and practical.`
            }
          ]
        }]
      })
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) throw new Error(claudeData.error?.message || 'Claude API error');
    const analysis = claudeData.content[0].text;

    // ── 4. Save to Firestore ──
    const existing = await fsGet('fieldIntelAuto') || [];
    const report = {
      id:           'auto_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      jobId:        bestJob?.id   || null,
      jobNum:       bestJob?.num  || null,
      jobName:      bestJob?.name || null,
      date:         new Date().toLocaleDateString('en-US'),
      timestamp:    Date.now(),
      distanceMiles: distMiles,
      withinRange,
      lat:          lat  || null,
      lon:          lon  || null,
      photoCount:   1,
      auto:         true,
      note:         note || null,
      analysis
    };

    await fsPatch('fieldIntelAuto', [report, ...existing].slice(0, 300));

    // ── 5. Respond ──
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok:           true,
        jobName:      bestJob?.name || 'Unknown',
        jobNum:       bestJob?.num  || null,
        distanceMiles: distMiles,
        withinRange,
        summary:      analysis.split('\n').find(l => l.trim()) || ''
      })
    };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
