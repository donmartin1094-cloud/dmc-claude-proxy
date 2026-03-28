// Proxies OneStepGPS device requests server-side (avoids browser CORS restrictions)
exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let apiKey = '';
  try {
    const body = JSON.parse(event.body || '{}');
    apiKey = body.apiKey || '';
  } catch(e) {}

  // Fall back to Railway env var if no key provided by client
  if (!apiKey) apiKey = process.env.ONESTEPGPS_API_KEY || '';
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'No OneStepGPS API key available' }) };
  }

  try {
    // Fetch devices
    const devRes = await fetch(
      `https://track.onestepgps.com/v3/api/public/device?latest_point=true&api-key=${apiKey}`
    );
    if (!devRes.ok) {
      return { statusCode: devRes.status, headers: CORS, body: JSON.stringify({ error: `OneStepGPS error ${devRes.status}` }) };
    }
    const devData = await devRes.json();

    // Fetch groups (non-fatal)
    let groupNameMap = {};
    try {
      const grpRes = await fetch(`https://track.onestepgps.com/v3/api/public/group?api-key=${apiKey}`);
      if (grpRes.ok) {
        const grpData = await grpRes.json();
        const groups = grpData.result_list || grpData.groups || (Array.isArray(grpData) ? grpData : []);
        groups.forEach(g => {
          if (g.group_id != null) groupNameMap[String(g.group_id)] = g.group_name || g.name || String(g.group_id);
        });
      }
    } catch(e) {}

    // Enrich devices with resolved group names
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

    const result = Object.assign({}, devData, { result_list: devices, _groupMap: groupNameMap });
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch(err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
