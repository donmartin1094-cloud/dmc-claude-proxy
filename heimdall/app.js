const { useState, useRef, useEffect } = React;
const _HD_FB_KEY = "AIzaSyA-km_fS86PCEXDpliAObRVJU34svg45Ds";
const _HD_FS_BASE = "https://firestore.googleapis.com/v1/projects/dmc-estimate-assistant-bffd6/databases/(default)/documents/app_data";
async function hdFsGet(docName) {
  try {
    const res = await fetch(`${_HD_FS_BASE}/${docName}?key=${_HD_FB_KEY}`);
    if (!res.ok) return null;
    const doc = await res.json();
    const raw = doc.fields?.data?.stringValue;
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
async function hdFsSet(docName, value) {
  try {
    const body = {
      fields: {
        data: { stringValue: JSON.stringify(value) },
        updatedAt: { integerValue: String(Date.now()) }
      }
    };
    await fetch(
      `${_HD_FS_BASE}/${docName}?key=${_HD_FB_KEY}&updateMask.fieldPaths=data&updateMask.fieldPaths=updatedAt`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
  } catch (e) {
    console.warn("hdFsSet failed:", e.message);
  }
}
const TABS = ["Dashboard", "Master Schedule", "Equipment", "Dispatch Sheets", "Daily Schedule", "Field Intel", "Conflicts", "Export"];
const RAILWAY_BASE = (() => {
  const stored = localStorage.getItem("dmc_claude_proxy_url") || "";
  return stored ? stored.replace(/\/claude$/, "") : "https://dmc-claude-proxy-production.up.railway.app";
})();
async function fetchGPSDevices() {
  const gpsKey = localStorage.getItem("HEIMDALL_API_KEY") || "";
  if (gpsKey) {
    try {
      const [devRes, grpRes] = await Promise.all([
        fetch(`https://track.onestepgps.com/v3/api/public/device?latest_point=true&api-key=${gpsKey}`),
        fetch(`https://track.onestepgps.com/v3/api/public/group?api-key=${gpsKey}`).catch(() => null)
      ]);
      if (devRes.ok) {
        const devData = await devRes.json();
        let groupNameMap = {};
        if (grpRes && grpRes.ok) {
          try {
            const grpData = await grpRes.json();
            const groups = grpData.result_list || grpData.groups || (Array.isArray(grpData) ? grpData : []);
            groups.forEach((g) => {
              if (g.group_id != null) groupNameMap[String(g.group_id)] = g.group_name || g.name || String(g.group_id);
            });
          } catch (e) {
          }
        }
        const devices = (devData.result_list || []).map((dev) => {
          let names = [];
          const g = dev.groups || dev.group_ids || dev.group_id;
          if (Array.isArray(g)) {
            names = g.map((x) => {
              if (typeof x === "string" || typeof x === "number") return groupNameMap[String(x)] || String(x);
              return x.group_name || x.name || groupNameMap[String(x.group_id)] || null;
            }).filter(Boolean);
          } else if (g != null) {
            names = [groupNameMap[String(g)] || String(g)];
          }
          return Object.assign({}, dev, { _groupNames: names.length ? names : ["Ungrouped Devices"] });
        });
        return Object.assign({}, devData, { result_list: devices, _groupMap: groupNameMap });
      } else {
        console.warn("[GPS] Direct API returned", devRes.status);
      }
    } catch (e) {
      console.warn("[GPS] Direct API error:", e.message);
    }
  }
  try {
    const r = await fetch("/.netlify/functions/gps-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: gpsKey })
    });
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.result_list)) return d;
    } else {
      console.warn("[GPS] Netlify proxy returned", r.status);
    }
  } catch (e) {
    console.warn("[GPS] Netlify proxy error:", e.message);
  }
  try {
    const r2 = await fetch(`${RAILWAY_BASE}/gps/devices`, {
      headers: gpsKey ? { "x-gps-key": gpsKey } : {}
    });
    if (r2.ok) {
      const d2 = await r2.json();
      if (d2 && Array.isArray(d2.result_list)) return d2;
    } else {
      console.warn("[GPS] Railway proxy returned", r2.status);
    }
  } catch (e) {
    console.warn("[GPS] Railway proxy error:", e.message);
  }
  throw new Error("GPS fetch failed \u2014 all endpoints unavailable");
}
async function callClaude(messages, maxTokens = 4096) {
  const res = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: maxTokens,
      messages
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Claude API error");
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content[0].text;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function fileToPreviewURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
async function geocodeAddress(address) {
  if (!address) return null;
  const cacheKey = "hd_geo_" + address.trim().toLowerCase().replace(/\s+/g, "_");
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
    }
  }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "DMCApp/1.0" } }
    );
    const data = await res.json();
    if (!data.length) return null;
    const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    localStorage.setItem(cacheKey, JSON.stringify(result));
    return result;
  } catch (e) {
    return null;
  }
}
async function getPhotoGPS(file) {
  try {
    if (!window.exifr) return null;
    const gps = await window.exifr.gps(file);
    if (!gps || !gps.latitude || !gps.longitude) return null;
    return { lat: gps.latitude, lon: gps.longitude };
  } catch (e) {
    return null;
  }
}
async function checkPhotoLocation(file, jobAddress) {
  const photoGps = await getPhotoGPS(file);
  if (!photoGps) return { noGps: true, distanceMiles: null, onSite: null };
  if (!jobAddress) return { noGps: false, distanceMiles: null, onSite: null };
  const jobGps = await geocodeAddress(jobAddress);
  if (!jobGps) return { noGps: false, distanceMiles: null, onSite: null };
  const distanceMiles = haversineMiles(photoGps.lat, photoGps.lon, jobGps.lat, jobGps.lon);
  return { noGps: false, distanceMiles, onSite: distanceMiles <= 0.5, photoGps, jobGps };
}
const mockEquipment = [
  { id: "EQ-101", name: "CAT 349 Excavator", gpsStatus: "At Yard", location: "Main Yard", lastMove: "2026-03-20", available: true },
  { id: "EQ-102", name: "Komatsu D65 Dozer", gpsStatus: "On Job", location: "Job #2241 - Hwy 74 Widening", lastMove: "2026-03-22", available: false },
  { id: "EQ-103", name: "CAT 140 Grader", gpsStatus: "At Yard", location: "Main Yard", lastMove: "2026-03-18", available: true },
  { id: "EQ-104", name: "Volvo EC300 Excavator", gpsStatus: "On Job", location: "Job #2238 - Runway Ext.", lastMove: "2026-03-15", available: false },
  { id: "EQ-105", name: "CAT 745 Articulated Truck", gpsStatus: "At Yard", location: "Main Yard", lastMove: "2026-03-23", available: true }
];
const mockJobs = [
  { id: "JOB-2244", name: "I-485 Loop Grading", startDate: "2026-03-27", site: "Charlotte, NC", address: "I-485 & Lawyers Rd, Charlotte, NC", equipmentNeeded: ["EQ-101", "EQ-103"], status: "Needs Move" },
  { id: "JOB-2245", name: "Union County Rd Widening", startDate: "2026-03-28", site: "Monroe, NC", address: "Hwy 74 & Rocky River Rd, Monroe, NC", equipmentNeeded: ["EQ-105"], status: "Needs Move" },
  { id: "JOB-2241", name: "Hwy 74 Widening", startDate: "2026-03-10", site: "Gastonia, NC", address: "Hwy 74 W, Gastonia, NC", equipmentNeeded: ["EQ-102"], status: "Active" },
  { id: "JOB-2246", name: "Cabarrus Grading Pkg", startDate: "2026-03-30", site: "Concord, NC", address: "George W Liles Pkwy, Concord, NC", equipmentNeeded: ["EQ-104"], status: "Conflict" }
];
const mockDrivers = [
  { id: "DRV-01", name: "Mike Harrell", truck: "Peterbilt 389 - TR-11", available: true, phone: "704-555-0181" },
  { id: "DRV-02", name: "Tony Vasquez", truck: "Kenworth W900 - TR-14", available: true, phone: "704-555-0194" },
  { id: "DRV-03", name: "Josh Bennett", truck: "Freightliner Cascadia - TR-07", available: false, phone: "704-555-0162" },
  { id: "DRV-04", name: "Dale Pruitt", truck: "Peterbilt 567 - TR-19", available: true, phone: "704-555-0177" }
];
const mockMoveHistory = [
  { date: "2026-03-22", eq: "EQ-102", driver: "Mike Harrell", from: "Main Yard", to: "Job #2241", miles: 28, duration: "1h 05m" },
  { date: "2026-03-18", eq: "EQ-103", driver: "Tony Vasquez", from: "Job #2237", to: "Main Yard", miles: 34, duration: "1h 20m" },
  { date: "2026-03-15", eq: "EQ-104", driver: "Dale Pruitt", from: "Main Yard", to: "Job #2238", miles: 12, duration: "0h 40m" },
  { date: "2026-03-10", eq: "EQ-101", driver: "Josh Bennett", from: "Job #2236", to: "Main Yard", miles: 19, duration: "0h 55m" }
];
const autoDispatches = [
  { id: "DISP-001", jobId: "JOB-2244", jobName: "I-485 Loop Grading", eqId: "EQ-101", eqName: "CAT 349 Excavator", driverId: "DRV-01", driverName: "Mike Harrell", truck: "TR-11", from: "Main Yard", to: "Charlotte, NC", address: "I-485 & Lawyers Rd, Charlotte, NC", date: "2026-03-26", time: "06:00", miles: 22, permit: "Required", status: "Pending" },
  { id: "DISP-002", jobId: "JOB-2244", jobName: "I-485 Loop Grading", eqId: "EQ-103", eqName: "CAT 140 Grader", driverId: "DRV-02", driverName: "Tony Vasquez", truck: "TR-14", from: "Main Yard", to: "Charlotte, NC", address: "I-485 & Lawyers Rd, Charlotte, NC", date: "2026-03-26", time: "07:30", miles: 22, permit: "Required", status: "Pending" },
  { id: "DISP-003", jobId: "JOB-2245", jobName: "Union County Rd Widening", eqId: "EQ-105", eqName: "CAT 745 Art. Truck", driverId: "DRV-04", driverName: "Dale Pruitt", truck: "TR-19", from: "Main Yard", to: "Monroe, NC", address: "Hwy 74 & Rocky River Rd, Monroe, NC", date: "2026-03-27", time: "06:00", miles: 31, permit: "Not Required", status: "Pending" }
];
const conflicts = [
  { id: "CON-001", severity: "High", type: "Equipment Not Returned", desc: "EQ-104 (Volvo EC300) needed at Job #2246 by 3/30 but currently committed to Job #2238 with no scheduled return.", affectedJob: "JOB-2246", resolution: "Coordinate early release from Job #2238 or source alternate excavator." },
  { id: "CON-002", severity: "Medium", type: "Driver Unavailable", desc: "Josh Bennett (TR-07) is unavailable 3/26-3/27 \u2014 no coverage for backup hauls during peak move window.", affectedJob: "General", resolution: "Assign Dale Pruitt as backup after DISP-003 completes." }
];
const statusColor = (s) => {
  if (s === "Active") return "bg-green-100 text-green-800";
  if (s === "Needs Move") return "bg-yellow-100 text-yellow-800";
  if (s === "Conflict") return "bg-red-100 text-red-800";
  if (s === "Pending") return "bg-blue-100 text-blue-800";
  if (s === "Approved") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-700";
};
const severityColor = (s) => s === "High" ? "bg-red-100 text-red-800 border-red-200" : "bg-yellow-100 text-yellow-800 border-yellow-200";
function AnalysisCard({ result, headerColor = "bg-gray-800", onPushToPricing, onDelete }) {
  const [expanded, setExpanded] = useState(true);
  return /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-lg border shadow-sm overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: `${headerColor} text-white px-3 py-2 flex justify-between items-center` }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "font-bold text-sm" }, result.jobId || "General", " \xB7 ", result.fileName || result.photoCount + " photos"), /* @__PURE__ */ React.createElement("div", { className: "text-xs opacity-70" }, result.date, result.planRef ? ` \xB7 Plan: ${result.planRef}` : "")), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 items-center" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setExpanded((e) => !e), className: "text-xs opacity-60 hover:opacity-100" }, expanded ? "\u25B2" : "\u25BC"), /* @__PURE__ */ React.createElement("button", { onClick: onDelete, className: "text-xs opacity-40 hover:opacity-100", title: "Remove" }, "\u2715"))), expanded && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "p-3 analysis-output text-gray-700" }, result.analysis), onPushToPricing && /* @__PURE__ */ React.createElement("div", { className: "px-3 pb-3 border-t pt-2 flex gap-2" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onPushToPricing(result),
      className: "bg-yellow-400 text-black font-semibold text-xs px-3 py-1.5 rounded hover:bg-yellow-300 transition-colors"
    },
    "\u2197 Push Estimates to Pricing Sheet"
  ))));
}
function EquipmentMap({ devices, getDeviceName, getDeviceEquipNum, getDeviceStatus, getDeviceAddress, getDeviceUpdated, jobSites = [] }) {
  const mapRef = React.useRef(null);
  const leafletRef = React.useRef(null);
  const markersRef = React.useRef([]);
  const jobMarkersRef = React.useRef([]);
  const geocacheRef = React.useRef({});
  React.useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const map = L.map(mapRef.current, {
      center: [35.5, -80.8],
      zoom: 9,
      zoomControl: true,
      attributionControl: false
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(map);
    leafletRef.current = map;
    requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);
  React.useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const validDevices = devices.filter((d) => {
      const pt = d.latest_device_point;
      return pt && pt.lat && pt.lng;
    });
    if (!validDevices.length) return;
    const bounds = [];
    validDevices.forEach((dev) => {
      const pt = dev.latest_device_point;
      const lat = parseFloat(pt.lat), lng = parseFloat(pt.lng);
      const st = getDeviceStatus(dev);
      const isMoving = st.label && st.label.startsWith("Moving");
      const name = getDeviceName(dev);
      const num = getDeviceEquipNum(dev);
      const addr = getDeviceAddress(dev);
      const updated = getDeviceUpdated(dev);
      const spd = parseFloat(pt.speed) || 0;
      const icon = L.divIcon({
        className: "",
        html: `<div class="eq-marker-pin${isMoving ? " moving" : ""}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -10]
      });
      const popupHtml = `<div class="eq-popup" style="padding:10px 12px;min-width:180px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:2px;color:#f5c518;margin-bottom:4px;">
          ${num ? num + " \xB7 " : ""}${name}
        </div>
        <div style="font-size:9px;color:${isMoving ? "#5ab4f5" : "#7ecb8f"};margin-bottom:4px;">
          \u25CF ${st.label}${spd > 2 ? "" : ""}
        </div>
        ${addr ? `<div style="font-size:9px;color:#9b9488;margin-bottom:2px;">${addr}</div>` : ""}
        ${updated ? `<div style="font-size:8px;color:#9b9488;">Updated: ${updated}</div>` : ""}
      </div>`;
      const marker = L.marker([lat, lng], { icon }).addTo(map).bindPopup(popupHtml, { className: "eq-popup-wrap", maxWidth: 240 });
      markersRef.current.push(marker);
      bounds.push([lat, lng]);
    });
    if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [devices]);
  React.useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    jobMarkersRef.current.forEach((m) => m.remove());
    jobMarkersRef.current = [];
    if (!jobSites || jobSites.length === 0) return;
    jobSites.forEach(async (site) => {
      const loc = (site.location || "").trim();
      if (!loc) return;
      let coords = geocacheRef.current[loc];
      if (!coords) {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc)}&format=json&limit=1`);
          const data = await r.json();
          if (data && data[0]) {
            coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            geocacheRef.current[loc] = coords;
          }
        } catch (e) {
          return;
        }
      }
      if (!coords) return;
      const icon = L.divIcon({
        className: "",
        html: `<div class="job-site-pin"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -12]
      });
      const eqList = (site.onSiteEquipment || []).map((e) => e.name || e.type).filter(Boolean);
      const popupHtml = `<div class="eq-popup" style="padding:10px 12px;min-width:190px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:#a78bfa;margin-bottom:4px;">
          \u{1F4CD} ${site.jobName || site.jobNum || "Job Site"}
        </div>
        ${site.jobNum && site.jobName ? `<div style="font-size:9px;color:#9b9488;margin-bottom:4px;">${site.jobNum}</div>` : ""}
        <div style="font-size:9px;color:#c4b5fd;margin-bottom:5px;">${loc}</div>
        ${eqList.length ? `<div style="font-size:8px;color:#9b9488;margin-bottom:3px;letter-spacing:0.5px;text-transform:uppercase;">Equipment on site:</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;">
          ${eqList.map((e) => `<span style="background:rgba(167,139,250,0.15);border:1px solid rgba(167,139,250,0.3);border-radius:3px;padding:1px 5px;font-size:8px;color:#c4b5fd;">${e}</span>`).join("")}
        </div>` : ""}
      </div>`;
      const marker = L.marker([coords.lat, coords.lng], { icon }).addTo(map).bindPopup(popupHtml, { className: "eq-popup-wrap", maxWidth: 240 });
      jobMarkersRef.current.push(marker);
    });
  }, [jobSites]);
  return /* @__PURE__ */ React.createElement("div", { ref: mapRef, style: {
    width: "100%",
    height: "578px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--asphalt-light)",
    overflow: "hidden",
    position: "relative"
  } });
}
function DailyHaulWidget({ driverKey }) {
  const STORAGE_KEY = "dmc_haul_assignment";
  const TICKETS_KEY = "dmc_haul_tickets";
  const TONS_PER_LOAD = 22.5;
  const readAssign = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  };
  const writeAssign = (obj) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
    }
  };
  const readTickets = () => {
    try {
      return JSON.parse(localStorage.getItem(TICKETS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  };
  const writeTickets = (arr) => {
    try {
      localStorage.setItem(TICKETS_KEY, JSON.stringify(arr));
    } catch (e) {
    }
  };
  const todayStr = () => {
    const d = /* @__PURE__ */ new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const nowTime = () => {
    const d = /* @__PURE__ */ new Date();
    let h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  };
  const BLANK = { foreman: "", jobNum: "", gcName: "", projectName: "", plantName: "", plantLocation: "", loadTime: "", projectedTonnage: "" };
  const SAMPLE = { foreman: "Mike Carreiro", jobNum: "DMC-2026-047", gcName: "Gilbane Building Company", projectName: "Route 9 Corridor Repaving \u2014 Phase 2", plantName: "P.J. Keating Asphalt Plant", plantLocation: "174 Peckham St, Raynham, MA 02767", loadTime: "6:30 AM", projectedTonnage: "247.5" };
  const TICKET_BLANK = { ticketNum: "", timeLoaded: "", mixType: "", actualTonnage: "", truckNum: "", mixTemp: "", notes: "", slipPhoto: null };
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(BLANK);
  const [saved, setSaved] = React.useState(() => {
    const r = readAssign()[driverKey];
    return r && Object.values(r).some((v) => v) ? r : SAMPLE;
  });
  const [tickets, setTickets] = React.useState(() => readTickets().filter((t) => t.driverKey === driverKey && t.date === todayStr()));
  const [showForm, setShowForm] = React.useState(false);
  const [ticketDraft, setTicketDraft] = React.useState(TICKET_BLANK);
  const [viewSlip, setViewSlip] = React.useState(null);
  const slipPhotoRef = React.useRef(null);
  const projLoads = saved.projectedTonnage ? Math.round(parseFloat(saved.projectedTonnage) / TONS_PER_LOAD) : null;
  const loadsLogged = tickets.length;
  const startEdit = () => {
    setDraft({ ...BLANK, ...saved });
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    const all = readAssign();
    all[driverKey] = { ...draft };
    writeAssign(all);
    setSaved({ ...draft });
    setEditing(false);
  };
  const openTicketForm = () => {
    setTicketDraft({ ...TICKET_BLANK, timeLoaded: nowTime(), loadNum: tickets.length + 1 });
    setShowForm(true);
  };
  const submitTicket = () => {
    const newTicket = {
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      driverKey,
      date: todayStr(),
      loadNum: tickets.length + 1,
      jobNum: saved.jobNum || "",
      jobName: saved.projectName || "",
      ...ticketDraft,
      timestamp: Date.now()
    };
    const all = readTickets();
    all.push(newTicket);
    writeTickets(all);
    if (newTicket.jobNum && newTicket.slipPhoto) {
      try {
        const jobSlips = JSON.parse(localStorage.getItem("dmc_mix_slips") || "{}");
        if (!jobSlips[newTicket.jobNum]) jobSlips[newTicket.jobNum] = [];
        jobSlips[newTicket.jobNum].push({ ticketId: newTicket.id, loadNum: newTicket.loadNum, photo: newTicket.slipPhoto, timestamp: newTicket.timestamp, driver: driverKey });
        localStorage.setItem("dmc_mix_slips", JSON.stringify(jobSlips));
      } catch (e) {
      }
    }
    const todayTickets = all.filter((t) => t.driverKey === driverKey && t.date === todayStr());
    setTickets(todayTickets);
    setShowForm(false);
    setTicketDraft(TICKET_BLANK);
  };
  const FIELDS = [
    { key: "foreman", label: "Foreman" },
    { key: "jobNum", label: "Job #" },
    { key: "gcName", label: "GC Name" },
    { key: "projectName", label: "Project Name" },
    { key: "plantName", label: "Plant Name" },
    { key: "plantLocation", label: "Plant Location" },
    { key: "loadTime", label: "Load Time" },
    { key: "projectedTonnage", label: "Projected Tonnage" }
  ];
  const hasData = FIELDS.some((f) => saved[f.key]);
  const INPUT_STYLE = { width: "100%", boxSizing: "border-box", background: "var(--asphalt)", border: "1px solid var(--asphalt-light)", borderRadius: "5px", color: "var(--white)", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "5px 8px", outline: "none" };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, viewSlip && /* @__PURE__ */ React.createElement("div", { onClick: () => setViewSlip(null), style: { position: "fixed", inset: 0, zIndex: 9900, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("img", { src: viewSlip, style: { maxWidth: "92vw", maxHeight: "88vh", borderRadius: "8px", boxShadow: "0 0 40px rgba(0,0,0,0.8)" } }), /* @__PURE__ */ React.createElement("button", { onClick: () => setViewSlip(null), style: { position: "absolute", top: "16px", right: "16px", background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px", color: "#fff", fontSize: "16px", padding: "6px 12px", cursor: "pointer" } }, "\u2715")), showForm && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 9800, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "min(480px,100%)", background: "#1e1e1e", borderRadius: "12px", border: "1px solid rgba(126,203,143,0.3)", boxShadow: "0 20px 60px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", maxHeight: "92vh", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid rgba(126,203,143,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", letterSpacing: "2px", color: "#7ecb8f" } }, "\u{1F9FE} Load Ticket \u2014 Load ", tickets.length + 1), saved.jobNum && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.6)", marginTop: "2px" } }, saved.projectName || saved.jobNum)), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowForm(false), style: { background: "none", border: "1px solid rgba(155,148,136,0.3)", borderRadius: "5px", color: "var(--concrete-dim)", fontSize: "14px", padding: "4px 8px", cursor: "pointer" } }, "\u2715")), /* @__PURE__ */ React.createElement("div", { style: { overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" } }, [
    { key: "ticketNum", label: "Ticket #", type: "text", ph: "Plant ticket number" },
    { key: "timeLoaded", label: "Time Loaded", type: "text", ph: "e.g. 7:15 AM" },
    { key: "mixType", label: "Mix Type / Design", type: "text", ph: "e.g. 9.5mm Superpave" },
    { key: "actualTonnage", label: "Actual Tonnage", type: "number", ph: "tons" },
    { key: "truckNum", label: "Truck #", type: "text", ph: "e.g. T-14" },
    { key: "mixTemp", label: "Mix Temp (\xB0F)", type: "number", ph: "\xB0F" }
  ].map((f) => /* @__PURE__ */ React.createElement("div", { key: f.key }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "3px" } }, f.label), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: f.type,
      value: ticketDraft[f.key] || "",
      placeholder: f.ph,
      onChange: (e) => setTicketDraft((d) => ({ ...d, [f.key]: e.target.value })),
      style: INPUT_STYLE
    }
  ))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "3px" } }, "Notes"), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: ticketDraft.notes || "",
      onChange: (e) => setTicketDraft((d) => ({ ...d, notes: e.target.value })),
      placeholder: "Any notes about this load\u2026",
      rows: 2,
      style: { ...INPUT_STYLE, resize: "vertical", lineHeight: "1.4" }
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" } }, "Mix Slip Photo"), ticketDraft.slipPhoto ? /* @__PURE__ */ React.createElement("div", { style: { position: "relative", display: "inline-block" } }, /* @__PURE__ */ React.createElement(
    "img",
    {
      src: ticketDraft.slipPhoto,
      onClick: () => setViewSlip(ticketDraft.slipPhoto),
      style: { width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "6px", border: "1px solid rgba(126,203,143,0.3)", cursor: "zoom-in", display: "block" }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setTicketDraft((d) => ({ ...d, slipPhoto: null })),
      style: { position: "absolute", top: "6px", right: "6px", background: "rgba(0,0,0,0.65)", border: "1px solid rgba(217,79,61,0.5)", borderRadius: "4px", color: "var(--red)", fontSize: "11px", padding: "3px 7px", cursor: "pointer" }
    },
    "\u2715"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => slipPhotoRef.current?.click(),
      style: { position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.65)", border: "1px solid rgba(90,180,245,0.5)", borderRadius: "4px", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "9px", padding: "3px 8px", cursor: "pointer" }
    },
    "Replace"
  )) : /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => slipPhotoRef.current?.click(),
      style: { width: "100%", padding: "20px", background: "rgba(126,203,143,0.05)", border: "2px dashed rgba(126,203,143,0.3)", borderRadius: "8px", color: "#7ecb8f", fontFamily: "'DM Mono',monospace", fontSize: "10px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: "24px" } }, "\u{1F4F8}"),
    /* @__PURE__ */ React.createElement("span", null, "Tap to capture or upload mix slip"),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: "8px", opacity: 0.5 } }, "camera \xB7 gallery \xB7 files")
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: slipPhotoRef,
      type: "file",
      accept: "image/*",
      capture: "environment",
      style: { display: "none" },
      onChange: (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => setTicketDraft((d) => ({ ...d, slipPhoto: ev.target.result }));
        reader.readAsDataURL(file);
        e.target.value = "";
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 18px", borderTop: "1px solid rgba(126,203,143,0.15)", display: "flex", gap: "8px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowForm(false),
      style: { flex: 1, padding: "9px", background: "none", border: "1px solid var(--asphalt-light)", borderRadius: "6px", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "10px", cursor: "pointer" }
    },
    "Cancel"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: submitTicket,
      style: { flex: 2, padding: "9px", background: "rgba(126,203,143,0.15)", border: "1px solid rgba(126,203,143,0.45)", borderRadius: "6px", color: "#7ecb8f", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, cursor: "pointer" }
    },
    "\u2713 Submit Load Ticket"
  )))), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--asphalt-mid)", borderRadius: "8px", border: "1px solid rgba(90,180,245,0.25)", overflow: "hidden", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { onClick: () => setOpen((v) => !v), style: { padding: "10px 12px", borderBottom: open ? "1px solid rgba(90,180,245,0.2)" : "none", flexShrink: 0, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: "7px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "#5ab4f5" } }, "\u{1F69B} Daily Haul Assignment"), loadsLogged > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.25)", borderRadius: "8px", padding: "1px 6px" } }, loadsLogged, " logged"), !hasData && loadsLogged === 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.4)", background: "rgba(155,148,136,0.08)", border: "1px solid rgba(155,148,136,0.15)", borderRadius: "8px", padding: "1px 6px" } }, "Not set"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.4)" } }, open ? "\u25B2" : "\u25BE")), open && /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px" } }, editing ? (
    /* ── Edit assignment form ── */
    /* @__PURE__ */ React.createElement("div", null, FIELDS.map((f) => /* @__PURE__ */ React.createElement("div", { key: f.key, style: { marginBottom: "7px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "3px" } }, f.label), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: f.key === "projectedTonnage" ? "number" : "text",
        value: draft[f.key],
        onChange: (e) => setDraft((d) => ({ ...d, [f.key]: e.target.value })),
        onClick: (e) => e.stopPropagation(),
        placeholder: f.key === "loadTime" ? "e.g. 7:00 AM" : f.key === "projectedTonnage" ? "tons" : "",
        style: INPUT_STYLE
      }
    ))), draft.projectedTonnage && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.6)", marginBottom: "10px", background: "rgba(90,180,245,0.05)", border: "1px solid rgba(90,180,245,0.15)", borderRadius: "5px", padding: "5px 8px" } }, "Projected loads: ", /* @__PURE__ */ React.createElement("strong", { style: { color: "#5ab4f5" } }, Math.round(parseFloat(draft.projectedTonnage) / TONS_PER_LOAD)), " ", /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.5 } }, "@ ", TONS_PER_LOAD, "t avg")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          cancelEdit();
        },
        style: { flex: 1, padding: "5px", background: "none", border: "1px solid var(--asphalt-light)", borderRadius: "5px", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "9px", cursor: "pointer" }
      },
      "Cancel"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          saveEdit();
        },
        style: { flex: 2, padding: "5px", background: "rgba(90,180,245,0.12)", border: "1px solid rgba(90,180,245,0.4)", borderRadius: "5px", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, cursor: "pointer" }
      },
      "\u{1F4BE} Save Assignment"
    )))
  ) : (
    /* ── View ── */
    /* @__PURE__ */ React.createElement("div", null, hasData && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "5px", marginBottom: "10px" } }, FIELDS.map((f) => saved[f.key] ? /* @__PURE__ */ React.createElement("div", { key: f.key, style: { display: "flex", alignItems: "baseline", gap: "6px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", letterSpacing: "1px", textTransform: "uppercase", minWidth: "90px", flexShrink: 0 } }, f.label), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "var(--white)", flex: 1 } }, saved[f.key], f.key === "projectedTonnage" ? " t" : "")) : null), projLoads !== null && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "6px", background: "rgba(90,180,245,0.08)", border: "1px solid rgba(90,180,245,0.22)", borderRadius: "6px", padding: "7px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.6)", textTransform: "uppercase", letterSpacing: "1px" } }, "Projected Loads"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.4)" } }, loadsLogged, "/", projLoads), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "22px", letterSpacing: "2px", color: "#5ab4f5" } }, projLoads)), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          openTicketForm();
        },
        title: "Log a load ticket",
        style: { width: "30px", height: "30px", borderRadius: "50%", background: "rgba(126,203,143,0.18)", border: "2px solid rgba(126,203,143,0.55)", color: "#7ecb8f", fontSize: "18px", lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700 }
      },
      "+"
    ))), tickets.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.5)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" } }, "Today's Load Log"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } }, tickets.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: t.id, style: { background: "rgba(126,203,143,0.05)", border: "1px solid rgba(126,203,143,0.18)", borderRadius: "6px", padding: "7px 9px", display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "16px", color: "#7ecb8f", lineHeight: 1, flexShrink: 0 } }, "#", t.loadNum), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--white)", display: "flex", gap: "8px", flexWrap: "wrap" } }, t.timeLoaded && /* @__PURE__ */ React.createElement("span", null, "\u23F1 ", t.timeLoaded), t.actualTonnage && /* @__PURE__ */ React.createElement("span", null, "\u2696 ", t.actualTonnage, "t"), t.mixType && /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" } }, t.mixType)), t.ticketNum && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.5)", marginTop: "2px" } }, "Ticket #", t.ticketNum, t.truckNum ? " \xB7 Truck " + t.truckNum : "")), t.slipPhoto && /* @__PURE__ */ React.createElement(
      "img",
      {
        src: t.slipPhoto,
        onClick: () => setViewSlip(t.slipPhoto),
        style: { width: "38px", height: "38px", objectFit: "cover", borderRadius: "4px", border: "1px solid rgba(126,203,143,0.25)", cursor: "zoom-in", flexShrink: 0 }
      }
    ))))), !hasData && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.4)", textAlign: "center", padding: "12px 0" } }, "No haul assignment set for today."), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          startEdit();
        },
        style: { width: "100%", padding: "5px 0", background: "rgba(245,197,24,0.08)", border: "1px solid rgba(245,197,24,0.3)", borderRadius: "5px", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, cursor: "pointer" }
      },
      "\u270F\uFE0F ",
      hasData ? "Edit Assignment" : "Set Assignment"
    ))
  ))));
}
function FleetWidget({ onFleetChange, defaultOpen = false }) {
  const [items, setItems] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false);
    } catch (e) {
      return [];
    }
  });
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState(null);
  const [noteVal, setNoteVal] = React.useState("");
  const [saving, setSaving] = React.useState(null);
  const [open, setOpen] = React.useState(defaultOpen);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [groupBy, setGroupBy] = React.useState("none");
  const [sortBy, setSortBy] = React.useState("name");
  const TYPE_ICONS = {
    paver: "\u{1F6E3}\uFE0F",
    roller: "\u{1F6DE}",
    milling: "\u26CF\uFE0F",
    excavator: "\u{1F9BE}",
    loader: "\u{1F504}",
    skid_steer: "\u{1F7E1}",
    compactor: "\u2699\uFE0F",
    dump_truck: "\u{1F69A}",
    lowbed: "\u{1F69B}",
    tack_truck: "\u{1F6E2}\uFE0F",
    tack_wagon: "\u{1F6E2}\uFE0F",
    rubber_machine: "\u{1F7E0}",
    water_truck: "\u{1F4A7}",
    mtv: "\u{1F501}",
    grader: "\u{1F3D7}\uFE0F",
    generator: "\u26A1",
    trailer: "\u{1F517}",
    other: "\u{1F4E6}"
  };
  const statusInfo = (s) => {
    if (s === "down") return { label: "DOWN", color: "#d94f3d", bg: "rgba(217,79,61,0.14)" };
    if (s === "limping") return { label: "LIMPING", color: "#e8813a", bg: "rgba(232,129,58,0.14)" };
    if (s === "maintenance") return { label: "MAINT.", color: "#a05af0", bg: "rgba(160,90,240,0.14)" };
    return { label: "OPERATIONAL", color: "#7ecb8f", bg: "rgba(61,158,106,0.12)" };
  };
  const saveItem = (id, patch) => {
    setSaving(id);
    try {
      const all = JSON.parse(localStorage.getItem("dmc_fleet") || "[]");
      const idx = all.findIndex((e) => e.id === id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...patch };
        localStorage.setItem("dmc_fleet", JSON.stringify(all));
        const active = all.filter((e) => e.active !== false);
        setItems(active);
        if (onFleetChange) onFleetChange(active);
      }
    } catch (e) {
    }
    setTimeout(() => setSaving(null), 600);
  };
  const STATUS_OPTS = [
    { value: "operational", label: "Operational", color: "#7ecb8f" },
    { value: "limping", label: "Limping", color: "#e8813a" },
    { value: "maintenance", label: "Maintenance", color: "#a05af0" },
    { value: "down", label: "Down", color: "#d94f3d" }
  ];
  const downCount = items.filter((e) => e.status === "down").length;
  const limpCount = items.filter((e) => e.status === "limping").length;
  const maintCount = items.filter((e) => e.status === "maintenance").length;
  const STATUS_ORDER = { down: 0, limping: 1, maintenance: 2, operational: 3 };
  const q = search.trim().toLowerCase();
  let filtered = items;
  if (statusFilter !== "all") {
    filtered = statusFilter === "operational" ? filtered.filter((e) => !["down", "limping", "maintenance"].includes(e.status)) : filtered.filter((e) => e.status === statusFilter);
  }
  if (q) filtered = filtered.filter(
    (e) => (e.name || "").toLowerCase().includes(q) || (e.id || "").toLowerCase().includes(q) || (e.assignedJobName || "").toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q)
  );
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "status") return (STATUS_ORDER[a.status || "operational"] || 3) - (STATUS_ORDER[b.status || "operational"] || 3);
    if (sortBy === "location") return (a.assignedJobName || "zzz").localeCompare(b.assignedJobName || "zzz");
    return (a.name || a.id || "").localeCompare(b.name || b.id || "");
  });
  let groupedEntries = null;
  if (groupBy !== "none") {
    const map = {};
    filtered.forEach((eq) => {
      let g;
      if (groupBy === "location") g = eq.assignedJobName ? "\u{1F4CD} " + eq.assignedJobName : "\u{1F3ED} At Shop / Yard";
      else if (groupBy === "category") g = eq.category ? eq.category.toUpperCase() : "UNCATEGORIZED";
      else g = statusInfo(eq.status).label;
      if (!map[g]) map[g] = [];
      map[g].push(eq);
    });
    groupedEntries = Object.entries(map);
  }
  return /* @__PURE__ */ React.createElement("div", { style: { background: "var(--asphalt-mid)", borderRadius: "8px", border: "1px solid var(--asphalt-light)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: open ? "calc(100vh - 180px)" : "auto" } }, /* @__PURE__ */ React.createElement("div", { onClick: () => setOpen((v) => !v), style: { padding: "10px 12px", borderBottom: open ? "1px solid var(--asphalt-light)" : "none", flexShrink: 0, cursor: "pointer", userSelect: "none" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "var(--stripe)" } }, "\u{1F527} Fleet Status"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.25)", borderRadius: "8px", padding: "1px 6px" } }, items.length, " units"), downCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#d94f3d", background: "rgba(217,79,61,0.1)", border: "1px solid rgba(217,79,61,0.25)", borderRadius: "8px", padding: "1px 6px" } }, downCount, " DOWN"), limpCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#e8813a", background: "rgba(232,129,58,0.1)", border: "1px solid rgba(232,129,58,0.25)", borderRadius: "8px", padding: "1px 6px" } }, limpCount, " LIMPING"), maintCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#a05af0", background: "rgba(160,90,240,0.1)", border: "1px solid rgba(160,90,240,0.25)", borderRadius: "8px", padding: "1px 6px" } }, maintCount, " MAINT."), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.4)" } }, open ? "\u25B2" : "\u25BE"))), open && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { padding: "7px 12px", borderBottom: "1px solid var(--asphalt-light)", flexShrink: 0, display: "flex", flexDirection: "column", gap: "6px" }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Search equipment\u2026",
      value: search,
      onChange: (e) => setSearch(e.target.value),
      style: {
        width: "100%",
        boxSizing: "border-box",
        background: "var(--asphalt)",
        border: "1px solid var(--asphalt-light)",
        borderRadius: "5px",
        color: "var(--white)",
        fontFamily: "'DM Mono',monospace",
        fontSize: "10px",
        padding: "5px 8px",
        outline: "none"
      }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "3px", flexWrap: "wrap" } }, [
    { k: "all", label: "All", color: "var(--concrete-dim)", active: "var(--stripe)", bg: "rgba(245,197,24,0.1)", border: "rgba(245,197,24,0.4)" },
    { k: "operational", label: "OK", color: "var(--concrete-dim)", active: "#7ecb8f", bg: "rgba(126,203,143,0.1)", border: "rgba(126,203,143,0.4)" },
    { k: "limping", label: "Limping", color: "var(--concrete-dim)", active: "#e8813a", bg: "rgba(232,129,58,0.1)", border: "rgba(232,129,58,0.4)" },
    { k: "maintenance", label: "Maint.", color: "var(--concrete-dim)", active: "#a05af0", bg: "rgba(160,90,240,0.1)", border: "rgba(160,90,240,0.4)" },
    { k: "down", label: "Down", color: "var(--concrete-dim)", active: "#d94f3d", bg: "rgba(217,79,61,0.1)", border: "rgba(217,79,61,0.4)" }
  ].map((p) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: p.k,
      onClick: () => setStatusFilter(p.k),
      style: {
        fontFamily: "'DM Mono',monospace",
        fontSize: "8px",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: "10px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        background: statusFilter === p.k ? p.bg : "var(--asphalt)",
        border: "1px solid " + (statusFilter === p.k ? p.border : "var(--asphalt-light)"),
        color: statusFilter === p.k ? p.active : p.color
      }
    },
    p.label
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", letterSpacing: "1px", textTransform: "uppercase", flexShrink: 0 } }, "Sort"), [{ k: "name", label: "Name" }, { k: "status", label: "Status" }, { k: "location", label: "Location" }].map((s) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: s.k,
      onClick: () => setSortBy(s.k),
      style: {
        fontFamily: "'DM Mono',monospace",
        fontSize: "8px",
        padding: "2px 7px",
        borderRadius: "4px",
        cursor: "pointer",
        background: sortBy === s.k ? "var(--asphalt-light)" : "var(--asphalt)",
        border: "1px solid " + (sortBy === s.k ? "var(--stripe)" : "var(--asphalt-light)"),
        color: sortBy === s.k ? "var(--stripe)" : "var(--concrete-dim)",
        fontWeight: sortBy === s.k ? 700 : 400
      }
    },
    s.label
  )), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", letterSpacing: "1px", textTransform: "uppercase", flexShrink: 0, marginLeft: "4px" } }, "Group"), [{ k: "none", label: "None" }, { k: "location", label: "Job" }, { k: "category", label: "Type" }, { k: "status", label: "Status" }].map((g) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: g.k,
      onClick: () => setGroupBy(g.k),
      style: {
        fontFamily: "'DM Mono',monospace",
        fontSize: "8px",
        padding: "2px 7px",
        borderRadius: "4px",
        cursor: "pointer",
        background: groupBy === g.k ? "var(--asphalt-light)" : "var(--asphalt)",
        border: "1px solid " + (groupBy === g.k ? "rgba(90,180,245,0.5)" : "var(--asphalt-light)"),
        color: groupBy === g.k ? "#5ab4f5" : "var(--concrete-dim)",
        fontWeight: groupBy === g.k ? 700 : 400
      }
    },
    g.label
  )))), (() => {
    const EqRow = ({ eq }) => {
      const st = statusInfo(eq.status);
      const isOpen = expanded === eq.id;
      return /* @__PURE__ */ React.createElement("div", { style: { borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: () => {
            if (isOpen) setExpanded(null);
            else {
              setExpanded(eq.id);
              setNoteVal(eq.notes || "");
            }
          },
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            cursor: "pointer",
            background: isOpen ? "rgba(245,197,24,0.04)" : "transparent",
            transition: "background 0.12s"
          }
        },
        /* @__PURE__ */ React.createElement("span", { style: { fontSize: "14px", flexShrink: 0 } }, TYPE_ICONS[eq.type] || "\u{1F4E6}"),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "var(--white)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, eq.name || eq.id), eq.assignedJobName && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "\u{1F4CD} ", eq.assignedJobName), eq.notes && !isOpen && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, eq.notes)),
        /* @__PURE__ */ React.createElement("span", { style: {
          fontFamily: "'DM Mono',monospace",
          fontSize: "7px",
          fontWeight: 700,
          padding: "2px 6px",
          borderRadius: "8px",
          background: st.bg,
          color: st.color,
          border: "1px solid " + st.color + "44",
          flexShrink: 0,
          whiteSpace: "nowrap"
        } }, st.label),
        /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.4)", flexShrink: 0 } }, isOpen ? "\u25B2" : "\u25BE")
      ), isOpen && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 12px 12px", background: "rgba(245,197,24,0.03)", borderTop: "1px solid rgba(245,197,24,0.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" } }, "Status"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "10px" } }, STATUS_OPTS.map((opt) => {
        const active = (eq.status || "operational") === opt.value;
        return /* @__PURE__ */ React.createElement(
          "button",
          {
            key: opt.value,
            onClick: (e) => {
              e.stopPropagation();
              saveItem(eq.id, { status: opt.value });
            },
            style: {
              fontFamily: "'DM Mono',monospace",
              fontSize: "8px",
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "10px",
              cursor: "pointer",
              background: active ? opt.color + "22" : "var(--asphalt)",
              border: "1px solid " + (active ? opt.color : "var(--asphalt-light)"),
              color: active ? opt.color : "var(--concrete-dim)",
              transition: "all 0.12s"
            }
          },
          opt.label
        );
      })), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" } }, "Notes"), /* @__PURE__ */ React.createElement(
        "textarea",
        {
          value: noteVal,
          onChange: (e) => setNoteVal(e.target.value),
          onClick: (e) => e.stopPropagation(),
          placeholder: "Add a note about this unit\u2026",
          rows: 2,
          style: {
            width: "100%",
            boxSizing: "border-box",
            background: "var(--asphalt)",
            border: "1px solid var(--asphalt-light)",
            borderRadius: "5px",
            color: "var(--white)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "10px",
            padding: "6px 8px",
            resize: "vertical",
            outline: "none",
            lineHeight: "1.4"
          }
        }
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: (e) => {
            e.stopPropagation();
            saveItem(eq.id, { notes: noteVal });
          },
          style: {
            marginTop: "6px",
            width: "100%",
            padding: "5px 0",
            background: "rgba(245,197,24,0.1)",
            border: "1px solid rgba(245,197,24,0.35)",
            borderRadius: "5px",
            color: "var(--stripe)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "9px",
            fontWeight: 700,
            cursor: "pointer",
            opacity: saving === eq.id ? 0.6 : 1
          }
        },
        saving === eq.id ? "\u2713 Saved" : "\u{1F4BE} Save Note"
      )));
    };
    if (filtered.length === 0) return /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.4)", textAlign: "center", padding: "24px 0" } }, items.length === 0 ? "No fleet data \u2014 add equipment in the main app." : "No matches.");
    if (groupedEntries) return /* @__PURE__ */ React.createElement("div", { style: { overflowY: "auto", flex: 1 } }, groupedEntries.map(([label, eqs]) => /* @__PURE__ */ React.createElement("div", { key: label }, /* @__PURE__ */ React.createElement("div", { style: {
      padding: "5px 12px 3px",
      background: "rgba(255,255,255,0.03)",
      borderBottom: "1px solid var(--asphalt-light)",
      fontFamily: "'DM Mono',monospace",
      fontSize: "8px",
      color: "rgba(155,148,136,0.5)",
      letterSpacing: "1px",
      textTransform: "uppercase",
      display: "flex",
      justifyContent: "space-between"
    } }, /* @__PURE__ */ React.createElement("span", null, label), /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.3)" } }, eqs.length)), eqs.map((eq) => /* @__PURE__ */ React.createElement(EqRow, { key: eq.id, eq })))));
    return /* @__PURE__ */ React.createElement("div", { style: { overflowY: "auto", flex: 1 } }, filtered.map((eq) => /* @__PURE__ */ React.createElement(EqRow, { key: eq.id, eq })));
  })()));
}
function FleetTab({ gpsDevices, getDeviceName, getDeviceAddress, getDeviceStatus }) {
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [groupBy, setGroupBy] = React.useState("location");
  const [search, setSearch] = React.useState("");
  const fleet = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false);
    } catch (e) {
      return [];
    }
  }, []);
  const TYPE_ICONS = {
    paver: "\u{1F6E3}\uFE0F",
    roller: "\u{1F6DE}",
    milling: "\u26CF\uFE0F",
    excavator: "\u{1F9BE}",
    loader: "\u{1F504}",
    skid_steer: "\u{1F7E1}",
    compactor: "\u2699\uFE0F",
    dump_truck: "\u{1F69A}",
    lowbed: "\u{1F69B}",
    tack_truck: "\u{1F6E2}\uFE0F",
    tack_wagon: "\u{1F6E2}\uFE0F",
    rubber_machine: "\u{1F7E0}",
    water_truck: "\u{1F4A7}",
    mtv: "\u{1F501}",
    grader: "\u{1F3D7}\uFE0F",
    generator: "\u26A1",
    trailer: "\u{1F517}",
    other: "\u{1F4E6}"
  };
  const statusInfo = (s) => {
    if (s === "down") return { label: "DOWN", color: "#d94f3d", bg: "rgba(217,79,61,0.12)" };
    if (s === "limping") return { label: "LIMPING", color: "#e8813a", bg: "rgba(232,129,58,0.12)" };
    if (s === "maintenance") return { label: "MAINT.", color: "#a05af0", bg: "rgba(160,90,240,0.12)" };
    return { label: "OPERATIONAL", color: "#7ecb8f", bg: "rgba(61,158,106,0.10)" };
  };
  const downCount = fleet.filter((e) => e.status === "down").length;
  const limpCount = fleet.filter((e) => e.status === "limping").length;
  const maintCount = fleet.filter((e) => e.status === "maintenance").length;
  const okCount = fleet.filter((e) => !e.status || !["down", "limping", "maintenance"].includes(e.status)).length;
  let filtered = statusFilter === "all" ? fleet : statusFilter === "operational" ? fleet.filter((e) => !e.status || !["down", "limping", "maintenance"].includes(e.status)) : fleet.filter((e) => e.status === statusFilter);
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((e) => (e.name || "").toLowerCase().includes(q) || (e.id || "").toLowerCase().includes(q) || (e.assignedJobName || "").toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q));
  }
  const grouped = {};
  filtered.forEach((eq) => {
    let g;
    if (groupBy === "location") g = eq.assignedJobName ? "\u{1F4CD} " + eq.assignedJobName : "\u{1F3ED} AT SHOP / YARD";
    else if (groupBy === "category") g = eq.category ? eq.category.toUpperCase() : "UNCATEGORIZED";
    else g = statusInfo(eq.status).label;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(eq);
  });
  const getGpsMatch = (eq) => {
    if (!gpsDevices || !gpsDevices.length) return null;
    const n = (eq.name || "").toLowerCase();
    return gpsDevices.find((d) => {
      const dn = getDeviceName(d).toLowerCase();
      return dn === n || dn.includes(n) || n.includes(dn.split(" ")[0]);
    }) || null;
  };
  const Pill = ({ k, label, count, dot, activeColor, activeBg }) => /* @__PURE__ */ React.createElement("button", { onClick: () => setStatusFilter(k), style: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "4px 11px",
    borderRadius: "20px",
    border: "1px solid " + (statusFilter === k ? activeColor : "var(--asphalt-light)"),
    background: statusFilter === k ? activeBg : "var(--asphalt)",
    color: statusFilter === k ? activeColor : "var(--concrete-dim)",
    fontFamily: "'DM Mono',monospace",
    fontSize: "10px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap"
  } }, dot && /* @__PURE__ */ React.createElement("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: dot, flexShrink: 0 } }), label, count != null ? ` (${count})` : "");
  const GbBtn = ({ k, label }) => /* @__PURE__ */ React.createElement("button", { onClick: () => setGroupBy(k), style: {
    flex: 1,
    background: groupBy === k ? "var(--asphalt-light)" : "none",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "4px 10px",
    cursor: "pointer",
    fontWeight: groupBy === k ? 700 : 400,
    color: groupBy === k ? "var(--concrete)" : "var(--concrete-dim)",
    fontFamily: "'DM Mono',monospace",
    fontSize: "9px"
  } }, label);
  const EquipCard = ({ eq }) => {
    const st = statusInfo(eq.status);
    const gps = getGpsMatch(eq);
    const addr = gps ? getDeviceAddress(gps) : null;
    const gpsSt = gps ? getDeviceStatus(gps) : null;
    const [hovered, setHovered] = React.useState(false);
    const handleClick = () => {
      try {
        if (window.parent && window.parent.openEquipmentDetail) {
          window.parent.openEquipmentDetail(eq.id);
        }
      } catch (e) {
      }
    };
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: handleClick,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        style: {
          background: hovered ? "var(--asphalt-light)" : "var(--asphalt)",
          border: "1px solid " + (hovered ? "var(--stripe)" : "var(--asphalt-light)"),
          borderRadius: "var(--radius)",
          padding: "10px 12px",
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          cursor: "pointer",
          transition: "background 0.15s,border-color 0.15s",
          boxShadow: hovered ? "0 0 0 1px rgba(245,197,24,0.25)" : "none"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: "20px", flexShrink: 0, marginTop: "2px" } }, TYPE_ICONS[eq.type] || "\u{1F4E6}"),
      /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "1px", color: "var(--white)" } }, eq.name || eq.id), eq.id && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--stripe)", background: "rgba(245,197,24,0.08)", border: "1px solid rgba(245,197,24,0.2)", borderRadius: "4px", padding: "1px 6px" } }, eq.id), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", background: st.bg, color: st.color, border: "1px solid " + st.color + "44" } }, st.label)), eq.assignedJobName && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f", marginBottom: "2px" } }, "\u{1F4CD} ", eq.assignedJobName), addr && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, gpsSt && gpsSt.label.startsWith("Moving") ? "\u{1F535}" : "\u{1F17F}\uFE0F", " ", addr), eq.notes && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, eq.notes), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--stripe)", marginTop: "4px", opacity: hovered ? 1 : 0, transition: "opacity 0.15s" } }, "TAP TO OPEN DETAIL \u2192"))
    );
  };
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", background: "var(--asphalt-mid)" } }, /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, padding: "14px 22px", borderBottom: "2px solid var(--asphalt-light)", background: "var(--asphalt-mid)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "22px", letterSpacing: "2px", color: "var(--stripe)" } }, "\u{1F527} Equipment Fleet"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.3)", borderRadius: "10px", padding: "2px 8px" } }, fleet.length, " units"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Search...",
      value: search,
      onChange: (e) => setSearch(e.target.value),
      style: { fontSize: "11px", padding: "5px 10px", width: "140px", background: "var(--asphalt)", border: "1px solid var(--asphalt-light)", borderRadius: "var(--radius)", color: "var(--white)", fontFamily: "'DM Mono',monospace", outline: "none" }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "2px", background: "var(--asphalt)", border: "1px solid var(--asphalt-light)", borderRadius: "var(--radius)", padding: "2px" } }, /* @__PURE__ */ React.createElement(GbBtn, { k: "location", label: "By Location" }), /* @__PURE__ */ React.createElement(GbBtn, { k: "category", label: "By Category" }), /* @__PURE__ */ React.createElement(GbBtn, { k: "status", label: "By Status" }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, /* @__PURE__ */ React.createElement(Pill, { k: "all", label: "All", count: fleet.length, dot: "", activeColor: "var(--concrete)", activeBg: "var(--asphalt-light)" }), /* @__PURE__ */ React.createElement(Pill, { k: "down", label: "Down", count: downCount, dot: "#d94f3d", activeColor: "var(--red)", activeBg: "rgba(217,79,61,0.15)" }), /* @__PURE__ */ React.createElement(Pill, { k: "limping", label: "Limping", count: limpCount, dot: "#e8813a", activeColor: "var(--orange)", activeBg: "rgba(232,129,58,0.12)" }), /* @__PURE__ */ React.createElement(Pill, { k: "maintenance", label: "Maint.", count: maintCount, dot: "#a05af0", activeColor: "#a05af0", activeBg: "rgba(160,90,240,0.12)" }), /* @__PURE__ */ React.createElement(Pill, { k: "operational", label: "Operational", count: okCount, dot: "#3d9e6a", activeColor: "#3d9e6a", activeBg: "rgba(61,158,106,0.10)" }))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "18px 22px" } }, fleet.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "60px", fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "var(--concrete-dim)" } }, "No equipment in fleet yet.") : Object.entries(grouped).length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "40px", fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "var(--concrete-dim)" } }, "No equipment matches your filter.") : Object.entries(grouped).map(([groupLabel, items]) => /* @__PURE__ */ React.createElement("div", { key: groupLabel, style: { marginBottom: "24px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "13px", letterSpacing: "2px", color: "var(--stripe)", marginBottom: "10px", paddingBottom: "6px", borderBottom: "1px solid var(--asphalt-light)" } }, groupLabel, " ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "var(--concrete-dim)", letterSpacing: 0, fontWeight: 400 } }, "(", items.length, ")")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "8px" } }, items.map((eq) => /* @__PURE__ */ React.createElement(EquipCard, { key: eq.id || eq.name, eq })))))));
}
function App() {
  const [tab, setTab] = useState("Dashboard");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("HEIMDALL_API_KEY") || "");
  const [gpsConnected, setGpsConnected] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const isDriverUser = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      const driverList = ["nightmare57", "ericsylvia57@gmail.com", "blydon", "billydon@donmartincorp.com", "igiron", "igiron@donmartincorp.com", "atowing", "atowing@andystowing.com", "yonton", "hyonton@donmartincorp.com", "ttengburg", "ttengburg@donmartincorp.com", "field2", "field3", "field4", "field5"];
      if (driverList.includes(u)) return true;
      const accounts = JSON.parse(localStorage.getItem("pavescope_accounts") || "[]");
      const acct = accounts.find((a) => (a.username || "").toLowerCase() === u || (a.email || "").toLowerCase() === u);
      return acct ? acct.role === "driver" : false;
    } catch (e) {
      return false;
    }
  })();
  const _driverTypeInfo = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      if (["nightmare57", "ericsylvia57@gmail.com"].includes(u)) return ["lowbed", "mixtruck"];
      if (["blydon", "billydon@donmartincorp.com"].includes(u)) return ["lowbed"];
      if (["igiron", "igiron@donmartincorp.com"].includes(u)) return ["lowbed", "mixtruck"];
      if (["atowing", "atowing@andystowing.com"].includes(u)) return ["lowbed", "towing"];
      if (["yonton", "hyonton@donmartincorp.com", "ttengburg", "ttengburg@donmartincorp.com", "field2", "field3", "field4", "field5"].includes(u)) return ["mixtruck"];
      const accounts = JSON.parse(localStorage.getItem("pavescope_accounts") || "[]");
      const acct = accounts.find((a) => (a.username || "").toLowerCase() === u || (a.email || "").toLowerCase() === u);
      if (acct && Array.isArray(acct.driverTypes) && acct.driverTypes.length > 0) return acct.driverTypes;
      return [];
    } catch (e) {
      return [];
    }
  })();
  const isLowbedDriver = _driverTypeInfo.includes("lowbed");
  const isMixTruckDriver = _driverTypeInfo.includes("mixtruck");
  const isTowingDriver = _driverTypeInfo.includes("towing");
  const isDesktopUser = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      return ["nightmare57", "ericsylvia57@gmail.com", "igiron", "igiron@donmartincorp.com", "dj", "dj@donmartincorp.com", "donmartin", "donmartin@donmartincorp.com", "atow"].includes(u);
    } catch (e) {
      return false;
    }
  })();
  const isIgiron = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      return ["igiron", "igiron@donmartincorp.com"].includes(u);
    } catch (e) {
      return false;
    }
  })();
  const isAdminUser = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      return ["dj", "dj@donmartincorp.com", "donmartin", "donmartin@donmartincorp.com"].includes(u);
    } catch (e) {
      return false;
    }
  })();
  const isForeman = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      const accounts = JSON.parse(localStorage.getItem("pavescope_accounts") || "[]");
      const acct = accounts.find((a) => (a.username || "").toLowerCase() === u || (a.email || "").toLowerCase() === u);
      return acct ? acct.role === "foreman" : false;
    } catch (e) {
      return false;
    }
  })();
  const isMechanic = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      const accounts = JSON.parse(localStorage.getItem("pavescope_accounts") || "[]");
      const acct = accounts.find((a) => (a.username || "").toLowerCase() === u || (a.email || "").toLowerCase() === u);
      return acct ? acct.role === "mechanic" : false;
    } catch (e) {
      return false;
    }
  })();
  const CORE_LOWBED_DRIVERS = [
    { label: "Ingrid Giron", value: "Ingrid Giron" },
    { label: "Bill Lydon", value: "Bill Lydon" },
    { label: "Eric Sylvia", value: "Eric Sylvia" }
  ];
  const isNightmare57 = (() => {
    try {
      const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
      return ["nightmare57", "ericsylvia57@gmail.com"].includes(u);
    } catch (e) {
      return false;
    }
  })();
  const isATow = (() => {
    try {
      return (localStorage.getItem("dmc_u") || "").toLowerCase() === "atow";
    } catch (e) {
      return false;
    }
  })();
  const [hdMobile, setHdMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setHdMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  const [hdDevicesOpen, setHdDevicesOpen] = useState(false);
  const [hdHaulOpen, setHdHaulOpen] = useState(false);
  const [gpsDevices, setGpsDevices] = useState([]);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsHibernated, setGpsHibernated] = useState(false);
  const [hiddenDeviceIds, setHiddenDeviceIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("hd_hidden_devices") || "[]"));
    } catch (e) {
      return /* @__PURE__ */ new Set();
    }
  });
  const [showHiddenMgr, setShowHiddenMgr] = useState(false);
  const [deviceJobMap, setDeviceJobMap] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [equipNameMap, setEquipNameMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_equip_names") || "{}");
    } catch (e) {
      return {};
    }
  });
  const [showNameEditor, setShowNameEditor] = useState(false);
  localStorage.removeItem("dmc_lowbed_plan");
  const [lowbedPlan, setLowbedPlan] = useState({ status: "empty", jobs: [] });
  const [selectedJob, setSelectedJob] = useState(null);
  const [dispatches, setDispatches] = useState(autoDispatches);
  const [conflictModal, setConflictModal] = useState(null);
  const [showOverridden, setShowOverridden] = useState(false);
  const detectPlanConflicts = (plan) => {
    const base = [...conflicts];
    if (!plan || !plan.jobs) return base;
    const detected = [];
    const allMoves = [];
    plan.jobs.forEach((job, ji) => {
      (job.moves || []).forEach((move, mi) => {
        if (move.overridden) return;
        allMoves.push({ jobName: job.jobName, jobNum: job.jobNum, jobIdx: ji, moveIdx: mi, move, date: job.date });
      });
    });
    const eqMap = {};
    allMoves.forEach((entry) => {
      (entry.move.equipment || []).forEach((eq) => {
        const key = eq.name + "|" + entry.date;
        if (!eqMap[key]) eqMap[key] = [];
        eqMap[key].push(entry);
      });
    });
    Object.entries(eqMap).forEach(([key, entries]) => {
      if (entries.length > 1) {
        const parts = key.split("|");
        const eqName = parts[0];
        const date = parts[1];
        detected.push({
          id: "EQ-" + eqName.replace(/\s/g, "-") + "-" + date,
          severity: "High",
          type: "Equipment Double-Booked",
          desc: eqName + " is assigned to multiple moves on " + date + ": " + entries.map((e) => e.jobName + " (move " + (e.moveIdx + 1) + ")").join(" and ") + ".",
          affectedJob: entries[0].jobName,
          resolution: "Reassign equipment to a different unit for one of the moves.",
          _planConflict: true,
          _primaryMove: { jobIdx: entries[0].jobIdx, moveIdx: entries[0].moveIdx, date, eqName }
        });
      }
    });
    const drvMap = {};
    allMoves.forEach((entry) => {
      if (!entry.move.assignedDriver) return;
      const key = entry.move.assignedDriver + "|" + entry.date;
      if (!drvMap[key]) drvMap[key] = [];
      drvMap[key].push(entry);
    });
    Object.entries(drvMap).forEach(([key, entries]) => {
      if (entries.length > 1) {
        const parts = key.split("|");
        const driverName = parts[0];
        const date = parts[1];
        detected.push({
          id: "DRV-" + driverName.replace(/\s/g, "-") + "-" + date,
          severity: "High",
          type: "Driver Double-Booked",
          desc: driverName + " is assigned to multiple moves on " + date + ": " + entries.map((e) => e.jobName + " (move " + (e.moveIdx + 1) + ")").join(" and ") + ".",
          affectedJob: entries[0].jobName,
          resolution: "Reassign one of the moves to a different driver.",
          _planConflict: true,
          _primaryMove: { jobIdx: entries[0].jobIdx, moveIdx: entries[0].moveIdx, date, driverName }
        });
      }
    });
    return [...detected, ...base];
  };
  const [planConflicts, setPlanConflicts] = useState(() => {
    try {
      return detectPlanConflicts(JSON.parse(localStorage.getItem("dmc_lowbed_plan") || "null"));
    } catch (e) {
      return [...conflicts];
    }
  });
  const savePlanAndRefresh = (newPlan) => {
    localStorage.setItem("dmc_lowbed_plan", JSON.stringify(newPlan));
    setLowbedPlan(newPlan);
    setPlanConflicts(detectPlanConflicts(newPlan));
    hdFsSet("lowbed_plan", newPlan);
  };
  const deferMove = (conflict) => {
    if (!conflict._planConflict || !lowbedPlan) return;
    const pm = conflict._primaryMove;
    const plan = JSON.parse(JSON.stringify(lowbedPlan));
    const job = plan.jobs[pm.jobIdx];
    if (!job) return;
    const d = /* @__PURE__ */ new Date(job.date + "T12:00:00");
    d.setDate(d.getDate() + 1);
    const nextDate = d.toISOString().split("T")[0];
    if (!window.confirm('Move "' + job.jobName + '" to ' + nextDate + "?")) return;
    job.date = nextDate;
    savePlanAndRefresh(plan);
  };
  const overrideConflict = (conflict) => {
    const note = window.prompt("Enter a short override note (required):", "");
    if (note === null) return;
    if (conflict._planConflict && conflict._primaryMove && lowbedPlan) {
      const plan = JSON.parse(JSON.stringify(lowbedPlan));
      const pm = conflict._primaryMove;
      const job = plan.jobs[pm.jobIdx];
      if (job && job.moves[pm.moveIdx]) {
        job.moves[pm.moveIdx].overridden = true;
        job.moves[pm.moveIdx].overrideNote = note || "(no note)";
        savePlanAndRefresh(plan);
      }
    } else {
      localStorage.setItem("conflict_override_" + conflict.id, "true");
      localStorage.setItem("conflict_override_note_" + conflict.id, note || "(no note)");
      setPlanConflicts(detectPlanConflicts(lowbedPlan));
    }
  };
  const getAvailableEquipment = (conflict) => {
    if (!lowbedPlan || !conflict._primaryMove) return [];
    const pm = conflict._primaryMove;
    const eqType = (() => {
      const job = lowbedPlan.jobs[pm.jobIdx];
      if (!job) return null;
      const move = job.moves[pm.moveIdx];
      const eq = (move.equipment || []).find((e) => e.name === pm.eqName);
      return eq ? eq.type : null;
    })();
    if (!eqType) return [];
    const assignedNames = /* @__PURE__ */ new Set();
    lowbedPlan.jobs.forEach((job, ji) => {
      if (job.date !== pm.date) return;
      (job.moves || []).forEach((move, mi) => {
        if (ji === pm.jobIdx && mi === pm.moveIdx) return;
        (move.equipment || []).forEach((e) => assignedNames.add(e.name));
      });
    });
    const candidates = [];
    lowbedPlan.jobs.forEach((job) => {
      (job.allEquipment || []).forEach((eq) => {
        if (eq.type === eqType && !assignedNames.has(eq.name) && !candidates.find((c) => c.name === eq.name))
          candidates.push(eq);
      });
    });
    fleetItems.forEach((item) => {
      const t = (item.type || item.category || "").toLowerCase().replace(/\s/g, "_");
      if (t === eqType && !assignedNames.has(item.name) && !candidates.find((c) => c.name === item.name))
        candidates.push({ type: eqType, name: item.name });
    });
    return candidates;
  };
  const getAvailableDrivers = (conflict) => {
    if (!lowbedPlan || !conflict._primaryMove) return [];
    const pm = conflict._primaryMove;
    const assignedDrivers = /* @__PURE__ */ new Set();
    lowbedPlan.jobs.forEach((job, ji) => {
      if (job.date !== pm.date) return;
      (job.moves || []).forEach((move, mi) => {
        if (ji === pm.jobIdx && mi === pm.moveIdx) return;
        if (move.assignedDriver) assignedDrivers.add(move.assignedDriver);
      });
    });
    const allDrivers = /* @__PURE__ */ new Set(["Mike Harrell", "Tony Vasquez", "Dale Pruitt", "Josh Bennett", "Eric Sylvia", "Bill Lydon", "Ingrid Giron"]);
    (lowbedPlan.jobs || []).forEach((job) => {
      (job.moves || []).forEach((move) => {
        if (move.assignedDriver) allDrivers.add(move.assignedDriver);
      });
    });
    return [...allDrivers].filter((d) => !assignedDrivers.has(d));
  };
  const reassignEquipment = (conflict, newEq) => {
    if (!lowbedPlan || !conflict._primaryMove) return;
    const pm = conflict._primaryMove;
    const plan = JSON.parse(JSON.stringify(lowbedPlan));
    const move = plan.jobs[pm.jobIdx] && plan.jobs[pm.jobIdx].moves[pm.moveIdx];
    if (!move) return;
    move.equipment = (move.equipment || []).map((e) => e.name === pm.eqName ? { ...e, name: newEq.name, type: newEq.type } : e);
    setConflictModal(null);
    savePlanAndRefresh(plan);
  };
  const reassignDriver = (conflict, newDriver) => {
    if (!lowbedPlan || !conflict._primaryMove) return;
    const pm = conflict._primaryMove;
    const plan = JSON.parse(JSON.stringify(lowbedPlan));
    const move = plan.jobs[pm.jobIdx] && plan.jobs[pm.jobIdx].moves[pm.moveIdx];
    if (!move) return;
    move.assignedDriver = newDriver;
    setConflictModal(null);
    savePlanAndRefresh(plan);
  };
  const [realJobs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pavescope_backlog") || "[]");
    } catch (e) {
      return [];
    }
  });
  const jobList = realJobs.length > 0 ? realJobs : mockJobs.map((j) => ({ id: j.id, num: j.id, name: j.name }));
  const [schedData] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pavescope_sched_v2") || "{}");
    } catch (e) {
      return {};
    }
  });
  const [schedMonthOffset, setSchedMonthOffset] = useState(0);
  const [cleanoutSet, setCleanoutSet] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("dmc_cleanout_sent") || "[]"));
    } catch (e) {
      return /* @__PURE__ */ new Set();
    }
  });
  const sendCleanOut = (jobKey, jobLabel) => {
    const newSet = /* @__PURE__ */ new Set([...cleanoutSet, jobKey]);
    setCleanoutSet(newSet);
    localStorage.setItem("dmc_cleanout_sent", JSON.stringify([...newSet]));
    const existing = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_cleanout_jobs") || "[]");
      } catch (e) {
        return [];
      }
    })();
    existing.push({ jobKey, jobLabel, timestamp: Date.now(), dismissed: false });
    localStorage.setItem("dmc_cleanout_jobs", JSON.stringify(existing));
  };
  const foremanRoster = (() => {
    try {
      const s = JSON.parse(localStorage.getItem("pavescope_settings") || "{}");
      return Array.isArray(s.foremanRoster) ? s.foremanRoster : s.foremanRoster ? [s.foremanRoster] : ["Foreman"];
    } catch (e) {
      return [];
    }
  })();
  const [mixSlips, setMixSlips] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_mix_slips") || "[]");
    } catch (e) {
      return [];
    }
  });
  const saveMixSlip = (slip) => {
    const updated = [slip, ...mixSlips];
    setMixSlips(updated);
    localStorage.setItem("hd_mix_slips", JSON.stringify(updated));
    hdFsSet("mix_slips", updated);
  };
  const [mixSlipForm, setMixSlipForm] = useState(null);
  const [mixSlipDraft, setMixSlipDraft] = useState({
    loadTime: "",
    slipNumber: "",
    mixType: "",
    quantity: "",
    truckNumber: "",
    notes: ""
  });
  const [planFile, setPlanFile] = useState(null);
  const [planJob, setPlanJob] = useState("");
  const [planAnalyzing, setPlanAnalyzing] = useState(false);
  const planFileRef = useRef();
  const [planResults, setPlanResults] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_plans") || "[]");
    } catch (e) {
      return [];
    }
  });
  const [intelPhotos, setIntelPhotos] = useState([]);
  const [intelFiMedia, setIntelFiMedia] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_fi_media") || "[]");
    } catch (e) {
      return [];
    }
  });
  const [intelFolderJob, setIntelFolderJob] = useState(null);
  const [geoEnabled, setGeoEnabled] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_geo_enabled") ?? "true");
    } catch (e) {
      return true;
    }
  });
  const toggleGeo = () => {
    const next = !geoEnabled;
    setGeoEnabled(next);
    localStorage.setItem("hd_geo_enabled", JSON.stringify(next));
    setIntelPhotos([]);
    if (intelFileRef.current) intelFileRef.current.value = "";
  };
  const [intelJob, setIntelJob] = useState("");
  const [intelPlanIdx, setIntelPlanIdx] = useState("");
  const [intelAnalyzing, setIntelAnalyzing] = useState(false);
  const intelFileRef = useRef();
  const workPhotoFileRef = useRef();
  const [intelResults, setIntelResults] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_intel") || "[]");
    } catch (e) {
      return [];
    }
  });
  const [workPhotos, setWorkPhotos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_work_photos") || "[]");
    } catch (e) {
      return [];
    }
  });
  const [workPhotoFolders, setWorkPhotoFolders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_work_photo_folders") || "[]");
    } catch (e) {
      return [];
    }
  });
  const [showWorkPhotos, setShowWorkPhotos] = useState(false);
  const [wpNamingQueue, setWpNamingQueue] = useState([]);
  const [wpNamingIdx, setWpNamingIdx] = useState(0);
  const [wpActiveSub, setWpActiveSub] = useState("All");
  const [wpNewFolder, setWpNewFolder] = useState("");
  const [wpShowNewFolder, setWpShowNewFolder] = useState(false);
  const [autoReports, setAutoReports] = useState([]);
  const [quickSending, setQuickSending] = useState(false);
  const quickSendRef = useRef();
  const [fleetItems, setFleetItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false);
    } catch (e) {
      return [];
    }
  });
  const [lowbedGroups, setLowbedGroups] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
    } catch (e) {
      return [];
    }
  });
  const saveLowbedGroups = (groups) => {
    setLowbedGroups(groups);
    localStorage.setItem("dmc_lowbed_groups", JSON.stringify(groups));
    hdFsSet("lowbed_groups", groups);
  };
  const [pickerDeviceId, setPickerDeviceId] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [expandedMoves, setExpandedMoves] = useState(/* @__PURE__ */ new Set());
  const [showManualMove, setShowManualMove] = useState(false);
  const [manualMoveMode, setManualMoveMode] = useState(null);
  const [eqPhotos, setEqPhotos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hd_eq_photos") || "{}");
    } catch (e) {
      return {};
    }
  });
  const [chipModal, setChipModal] = useState(null);
  const chipPhotoRef = useRef();
  const [manualDate, setManualDate] = useState(() => (/* @__PURE__ */ new Date()).toISOString().split("T")[0]);
  const [manualDriver, setManualDriver] = useState("");
  const [manualFrom, setManualFrom] = useState("");
  const [manualTo, setManualTo] = useState("");
  const [manualToLocked, setManualToLocked] = useState(false);
  const [manualDeadline, setManualDeadline] = useState("");
  const [manualItems, setManualItems] = useState([]);
  const [manualEqOpen, setManualEqOpen] = useState({});
  const [manualNotes, setManualNotes] = useState("");
  const EQ_ICONS = {
    paver: "\u{1F7E7}",
    roller: "\u{1F535}",
    milling: "\u2699\uFE0F",
    excavator: "\u{1F3D7}\uFE0F",
    loader: "\u{1F69C}",
    skid_steer: "\u{1F527}",
    compactor: "\u{1F7E4}",
    dump_truck: "\u{1F69B}",
    lowbed: "\u{1F69A}",
    tack_truck: "\u{1F6E2}\uFE0F",
    water_truck: "\u{1F4A7}",
    generator: "\u26A1",
    tow_truck: "\u{1FA9D}",
    wrecker: "\u{1F529}",
    rollback: "\u{1F6FB}",
    mecalac: "\u{1F9AF}",
    trailer: "\u{1F517}",
    other: "\u{1F4E6}"
  };
  const LOWBED_RULES = {
    paver: { loadClass: "heavy", maxPerLoad: 1, canPairWith: ["roller", "skid_steer", "mecalac", "compactor", "generator"] },
    milling: { loadClass: "monster" },
    excavator: { loadClass: "monster" },
    mecalac: { loadClass: "medium", maxPerLoad: 2, canPairWith: ["mecalac", "roller", "skid_steer", "paver", "compactor", "generator", "trailer", "other"] },
    roller: { loadClass: "medium", canPairWith: ["roller", "skid_steer", "compactor", "generator", "trailer"] },
    loader: { loadClass: "medium", canPairWith: ["skid_steer", "trailer"] },
    skid_steer: { loadClass: "light", canPairWith: ["skid_steer", "roller", "loader", "compactor", "generator", "trailer"] },
    compactor: { loadClass: "light", canPairWith: ["compactor", "roller", "skid_steer", "generator", "trailer"] },
    generator: { loadClass: "light", canPairWith: ["generator", "skid_steer", "compactor", "trailer"] },
    trailer: { loadClass: "light", canPairWith: ["trailer", "skid_steer", "generator", "compactor", "roller"] },
    other: { loadClass: "light", canPairWith: ["other", "trailer", "generator", "skid_steer", "roller"] },
    dump_truck: { loadClass: "skip" },
    lowbed: { loadClass: "skip" },
    tack_truck: { loadClass: "skip" },
    water_truck: { loadClass: "skip" }
  };
  const ATOW_RATES = {
    high_flat_trailer: { label: "High Flat Trailer", rate: 160, unit: "hr", minHours: 2 },
    tractor_only: { label: "Tractor Only", rate: 135, unit: "hr", minHours: 2 },
    step_deck: { label: "Step Deck Trailer", rate: 160, unit: "hr", minHours: 2 },
    landoll_40ton: { label: "40-Ton Landoll", rate: 185, unit: "hr", minHours: 2 },
    lowbed_55ton: { label: "55-Ton Lowbed", rate: 185, unit: "hr", minHours: 2 },
    stretch_trailer: { label: "Stretch Trailer", rate: 185, unit: "hr", minHours: 2 },
    ramp_heavy: { label: "Heavy-Duty Ramp Truck (30k)", rate: 150, unit: "hr", minHours: 2 },
    ramp_medium: { label: "Medium-Duty Ramp Truck (10k)", rate: 130, unit: "hr", minHours: 2 },
    pilot_car: { label: "Pilot Car", rate: 100, unit: "hr", minHours: 4 },
    rotator_50ton: { label: "50-Ton Rotator", rate: 500, unit: "hr", minHours: 2 },
    towing_heavy: { label: "Heavy-Duty Towing", rate: 225, unit: "hr", minHours: 2 },
    towing_heavy_driveline: { label: "Heavy-Duty Towing + Driveline", rate: 250, unit: "hr", minHours: 2 },
    towing_medium: { label: "Medium-Duty Towing", rate: 175, unit: "hr", minHours: 2 },
    towing_medium_driveline: { label: "Medium-Duty Towing + Driveline", rate: 200, unit: "hr", minHours: 2 },
    light_duty_ramp: { label: "Light-Duty Ramp Truck", rate: 100, unit: "flat", minHours: 0, mileageRate: 4 },
    roadside: { label: "Roadside Assistance", rate: 75, unit: "flat", minHours: 0 }
  };
  const calcRentalCost = (serviceKey, hours, mileage = 0) => {
    const svc = ATOW_RATES[serviceKey];
    if (!svc) return 0;
    if (svc.unit === "flat") return svc.rate + mileage * (svc.mileageRate || 0);
    return Math.max(hours, svc.minHours) * svc.rate;
  };
  const getEquipmentStatus = (eqId, groups) => {
    const activeMoves = groups.filter(
      (m) => m.manual && m.status !== "cancelled" && m.status !== "cleared" && m.items && m.items.find((i) => i.id === eqId)
    );
    if (!activeMoves.length) return { status: "available", label: "At Garage", color: "#4a7a4a" };
    const inTransit = activeMoves.find((m) => m.status === "in_progress");
    if (inTransit) return { status: "in_transit", label: "In Transit \u2192 " + (inTransit.to || "Unknown"), color: "#c9a800", moveId: inTransit.id, jobGroupId: inTransit.jobGroupId };
    const pending = activeMoves.find((m) => m.status === "pending" || !m.status);
    if (pending) return { status: "assigned", label: "Assigned \u2014 pending move", color: "#7ab3f0", moveId: pending.id, jobGroupId: pending.jobGroupId };
    const complete = activeMoves.find((m) => m.status === "complete");
    if (complete) return { status: "on_site", label: "On Site at job", color: "#9b6fd6", moveId: complete.id, jobGroupId: complete.jobGroupId };
    return { status: "available", label: "At Garage", color: "#4a7a4a" };
  };
  const checkCompat = (newType, existingItems) => {
    if (!existingItems.length) return { ok: true };
    const nr = LOWBED_RULES[newType] || { loadClass: "light", canPairWith: [] };
    if (nr.loadClass === "monster") return { ok: false, reason: "This equipment requires the full lowbed alone \u2014 remove existing items first." };
    if (nr.loadClass === "skip") return { ok: false, reason: "Self-propelled equipment does not go on a lowbed." };
    for (const item of existingItems) {
      const er = LOWBED_RULES[item.type] || { loadClass: "light", canPairWith: [] };
      if (er.loadClass === "monster") return { ok: false, reason: item.name + " requires the full lowbed alone \u2014 cannot add more." };
      if (er.loadClass === "heavy") {
        const paverFriendly = ["roller", "skid_steer", "mecalac", "compactor", "generator"];
        if (!paverFriendly.includes(newType)) return { ok: false, reason: "Cannot add " + newType + " to a load with a paver." };
        continue;
      }
    }
    if (nr.loadClass === "heavy") {
      const hasHeavy = existingItems.some((i) => (LOWBED_RULES[i.type] || {}).loadClass === "heavy");
      const hasMonster = existingItems.some((i) => (LOWBED_RULES[i.type] || {}).loadClass === "monster");
      if (hasHeavy) return { ok: false, reason: "Two pavers cannot share a load \u2014 start a separate move." };
      if (hasMonster) return { ok: false, reason: "Cannot add a paver to this load." };
      return { ok: true };
    }
    for (const item of existingItems) {
      const er = LOWBED_RULES[item.type] || {};
      if (er.loadClass === "heavy") continue;
      if ((nr.canPairWith || []).length > 0 && !(nr.canPairWith || []).includes(item.type))
        return { ok: false, reason: nr.loadClass + " equipment is not compatible with " + item.type + " on the same load." };
    }
    return { ok: true };
  };
  const addToGroup = (deviceId, eqItem) => {
    const groups = JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
    let grp = groups.find((g) => g.deviceId === deviceId);
    if (!grp) {
      grp = { deviceId, items: [], createdAt: Date.now() };
      groups.push(grp);
    }
    if (grp.items.find((i) => i.id === eqItem.id)) return;
    const compat = checkCompat(eqItem.type, grp.items);
    if (!compat.ok) {
      alert("\u26A0\uFE0F Compatibility: " + compat.reason);
      return;
    }
    grp.items.push({ id: eqItem.id, name: eqItem.name, type: eqItem.type });
    saveLowbedGroups(groups);
  };
  const removeFromGroup = (deviceId, eqId) => {
    const groups = JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
    const grp = groups.find((g) => g.deviceId === deviceId);
    if (!grp) return;
    grp.items = grp.items.filter((i) => i.id !== eqId);
    saveLowbedGroups(groups);
  };
  const clearGroup = (deviceId) => {
    const groups = JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
    saveLowbedGroups(groups.filter((g) => g.deviceId !== deviceId));
  };
  const saveManualMove = () => {
    if (!manualDriver.trim() || !manualItems.length) {
      alert("Add a driver name and at least one piece of equipment.");
      return;
    }
    const groups = JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
    const ts = Date.now();
    const newId = "mm_" + ts;
    const existingGroupMove = manualMoveMode === "job" ? groups.find((g) => g.manual && g.to === manualTo && g.jobGroupId) : null;
    const resolvedJobGroupId = existingGroupMove ? existingGroupMove.jobGroupId : manualMoveMode === "job" ? "job_" + ts : "single_" + newId;
    const _isRentalSave = /atow|andy/i.test(manualDriver);
    groups.push({ id: newId, jobGroupId: resolvedJobGroupId, manual: true, date: manualDate, driverName: manualDriver, from: manualFrom, to: manualTo, deadline: manualDeadline, notes: manualNotes, items: manualItems, status: "pending", createdAt: ts, isRental: _isRentalSave, rentalService: null, rentalHours: 2, rentalMileage: 0, estimatedCost: 0, actualHours: null, actualCost: null });
    saveLowbedGroups(groups);
    setManualItems([]);
    setManualDriver("");
    setManualFrom("");
    setManualTo("");
    setManualDeadline("");
    setManualNotes("");
    setManualEqOpen({});
    setManualToLocked(false);
    setShowManualMove(false);
  };
  const saveEqPhoto = (chipId, dataUrl) => {
    const updated = { ...eqPhotos, [chipId]: dataUrl };
    setEqPhotos(updated);
    localStorage.setItem("hd_eq_photos", JSON.stringify(updated));
  };
  const removeEqPhoto = (chipId) => {
    const updated = { ...eqPhotos };
    delete updated[chipId];
    setEqPhotos(updated);
    localStorage.setItem("hd_eq_photos", JSON.stringify(updated));
  };
  const renameChip = (deviceId, chipId, newName) => {
    const groups = JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
    const grp = groups.find((g) => g.deviceId === deviceId);
    if (!grp) return;
    const item = grp.items.find((i) => i.id === chipId);
    if (item) item.name = newName;
    saveLowbedGroups(groups);
    setChipModal((m) => m ? { ...m, chip: { ...m.chip, name: newName }, editName: newName } : null);
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eqId = params.get("eq");
    if (!eqId) return;
    const fleet = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_fleet") || "[]");
      } catch (e) {
        return [];
      }
    })();
    const rec = fleet.find((e) => e.id === eqId);
    if (rec) {
      setChipModal({ deviceId: null, chip: { id: rec.id, name: rec.name, type: rec.type }, editName: rec.name });
    }
  }, []);
  useEffect(() => {
    hdFsGet("fieldIntelAuto").then((data) => {
      if (Array.isArray(data)) setAutoReports(data);
    });
  }, []);
  useEffect(() => {
    const accounts = (() => {
      try {
        return JSON.parse(localStorage.getItem("pavescope_accounts") || "[]");
      } catch (e) {
        return [];
      }
    })();
    const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
    const acct = accounts.find((a) => (a.username || "").toLowerCase() === u || (a.email || "").toLowerCase() === u);
    const role = acct ? acct.role : null;
    const driverTypes = acct && Array.isArray(acct.driverTypes) ? acct.driverTypes : [];
    const isLowbedDriverRole = role === "lowbed_driver" || driverTypes && driverTypes.includes("lowbed");
    const isRentalLowbedDriverRole = role === "rental_lowbed_driver" || driverTypes && driverTypes.includes("rental_lowbed");
    const isForemanRole = role === "foreman";
    const isMechanicRole = role === "mechanic";
    const isAdmin = ["dj", "dj@donmartincorp.com", "donmartin", "donmartin@donmartincorp.com"].includes(u);
    if (!(isAdmin || isLowbedDriverRole || isRentalLowbedDriverRole || isForemanRole || isMechanicRole)) return;
    const backfillJobGroupIds = (moves) => {
      const toGroupMap = {};
      return moves.map((move) => {
        if (move.jobGroupId) return move;
        const key = move.to || move.id;
        if (!toGroupMap[key]) {
          toGroupMap[key] = move.manual ? "job_" + key : "single_" + move.id;
        }
        return { ...move, jobGroupId: toGroupMap[key] };
      });
    };
    hdFsGet("lowbed_groups").then((remote) => {
      const localRaw = (() => {
        try {
          return JSON.parse(localStorage.getItem("dmc_lowbed_groups") || "[]");
        } catch (e) {
          return [];
        }
      })();
      const remoteArr = Array.isArray(remote) ? remote : [];
      const countItems = (arr) => arr.reduce((n, g) => n + (g.items ? g.items.length : 0), 0);
      const winner = countItems(remoteArr) >= countItems(localRaw) ? remoteArr : localRaw;
      setLowbedGroups(backfillJobGroupIds(winner));
      localStorage.setItem("dmc_lowbed_groups", JSON.stringify(winner));
      if (countItems(localRaw) > countItems(remoteArr)) hdFsSet("lowbed_groups", winner);
    });
    hdFsGet("hd_equip_names").then((remote) => {
      if (remote && typeof remote === "object" && !Array.isArray(remote)) {
        setEquipNameMap(remote);
        localStorage.setItem("hd_equip_names", JSON.stringify(remote));
      }
    });
    hdFsGet("hd_hidden_devices").then((remote) => {
      if (Array.isArray(remote)) {
        setHiddenDeviceIds(new Set(remote));
        localStorage.setItem("hd_hidden_devices", JSON.stringify(remote));
      }
    });
    let lastLowbedAt = 0;
    let lastNamesAt = 0;
    let lastHiddenAt = 0;
    const poll = setInterval(async () => {
      try {
        const [lgRes, nmRes, hdRes] = await Promise.all([
          fetch(`${_HD_FS_BASE}/lowbed_groups?key=${_HD_FB_KEY}`),
          fetch(`${_HD_FS_BASE}/hd_equip_names?key=${_HD_FB_KEY}`),
          fetch(`${_HD_FS_BASE}/hd_hidden_devices?key=${_HD_FB_KEY}`)
        ]);
        if (lgRes.ok) {
          const doc = await lgRes.json();
          const at = parseInt(doc.fields?.updatedAt?.integerValue || "0");
          if (at > lastLowbedAt) {
            lastLowbedAt = at;
            const raw = doc.fields?.data?.stringValue;
            if (raw) {
              const groups = JSON.parse(raw);
              setLowbedGroups(backfillJobGroupIds(groups));
              localStorage.setItem("dmc_lowbed_groups", JSON.stringify(groups));
            }
          }
        }
        if (nmRes.ok) {
          const doc = await nmRes.json();
          const at = parseInt(doc.fields?.updatedAt?.integerValue || "0");
          if (at > lastNamesAt) {
            lastNamesAt = at;
            const raw = doc.fields?.data?.stringValue;
            if (raw) {
              const map = JSON.parse(raw);
              setEquipNameMap(map);
              localStorage.setItem("hd_equip_names", JSON.stringify(map));
            }
          }
        }
        if (hdRes.ok) {
          const doc = await hdRes.json();
          const at = parseInt(doc.fields?.updatedAt?.integerValue || "0");
          if (at > lastHiddenAt) {
            lastHiddenAt = at;
            const raw = doc.fields?.data?.stringValue;
            if (raw) {
              const arr = JSON.parse(raw);
              setHiddenDeviceIds(new Set(arr));
              localStorage.setItem("hd_hidden_devices", JSON.stringify(arr));
            }
          }
        }
      } catch (e) {
      }
    }, 3e3);
    return () => clearInterval(poll);
  }, []);
  useEffect(() => {
    const readFleet = () => {
      try {
        const items = JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false);
        setFleetItems(items);
      } catch (e) {
      }
    };
    const onStorage = (e) => {
      if (e.key === "dmc_fleet") readFleet();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", readFleet);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", readFleet);
    };
  }, []);
  useEffect(() => {
    const loadGPS = () => {
      setGpsLoading(true);
      fetchGPSDevices().then((data) => {
        const list = data.result_list || [];
        setGpsDevices(list);
        setGpsConnected(true);
        setGpsHibernated(list.length === 0);
        setLastRefresh(/* @__PURE__ */ new Date());
        matchDevicesToJobs(list);
        try {
          localStorage.setItem("dmc_gps_cache", JSON.stringify({ ts: Date.now(), devices: list }));
        } catch (e) {
        }
      }).catch(() => {
        if (!isDriverUser) setGpsConnected(false);
        setGpsHibernated(false);
      }).finally(() => setGpsLoading(false));
    };
    loadGPS();
    const interval = setInterval(loadGPS, 5 * 60 * 1e3);
    return () => clearInterval(interval);
  }, []);
  const isDeviceStale = (device) => {
    const pt = device.latest_device_point;
    if (!pt || !pt.dt_tracker) return false;
    try {
      return Date.now() - new Date(pt.dt_tracker).getTime() > 864e5;
    } catch (e) {
      return false;
    }
  };
  const matchDevicesToJobs = async (devices) => {
    const jobs = realJobs.length > 0 ? realJobs : [];
    if (!jobs.length || !devices.length) return;
    const geoCache = [];
    for (const job of jobs) {
      const addr = job.location || job.address || (job.gc && job.name ? `${job.name}` : null);
      if (!addr) continue;
      const coords = await geocodeAddress(addr);
      if (coords) geoCache.push({ coords, job });
    }
    const map = {};
    devices.forEach((dev) => {
      const pt = dev.latest_device_point;
      if (!pt || !pt.lat || !pt.lng) return;
      const dLat = parseFloat(pt.lat), dLon = parseFloat(pt.lng);
      let bestJob = null, bestDist = Infinity;
      geoCache.forEach(({ coords, job }) => {
        const dist = haversineMiles(dLat, dLon, coords.lat, coords.lon);
        if (dist < bestDist) {
          bestDist = dist;
          bestJob = job;
        }
      });
      if (bestDist <= 0.5 && bestJob) {
        map[dev.device_id] = {
          jobId: bestJob.id,
          jobNum: bestJob.num || "",
          jobName: bestJob.name || "",
          distMiles: bestDist.toFixed(2)
        };
      }
    });
    setDeviceJobMap(map);
  };
  const getDeviceGroupLabels = (device) => {
    const entry = equipNameMap[device.device_id];
    if (entry && entry.customName) {
      const n = entry.customName.toLowerCase();
      if (n.includes("paver")) return ["Pavers"];
      if (n.includes("roller") || n.includes("compacto")) return ["Rollers & Compactors"];
      if (n.includes("grader")) return ["Motor Graders"];
      if (n.includes("excavator")) return ["Excavators"];
      if (n.includes("loader") && !n.includes("low")) return ["Loaders"];
      if (n.includes("skid") || n.includes("steer")) return ["Skid Steers"];
      if (n.includes("mill") || n.includes("planer") || n.includes("cold")) return ["Milling Machines"];
      if (n.includes("lowbed") || n.includes("trailer") || n.includes("float")) return ["Lowbeds & Trailers"];
      if (n.includes("dump")) return ["Dump Trucks"];
      if (n.includes("water")) return ["Water Trucks"];
      if (n.includes("tack")) return ["Tack Trucks"];
      if (n.includes("generator")) return ["Generators"];
      if (n.includes("truck") || n.includes("pickup")) return ["Trucks & Vehicles"];
      return ["Assigned Equipment"];
    }
    if (device._groupNames && device._groupNames.length && !device._groupNames.every((g) => g === "Ungrouped Devices")) {
      return device._groupNames;
    }
    return ["Unassigned Devices"];
  };
  const [collapsedGroups, setCollapsedGroups] = React.useState({});
  const toggleGroup = (label) => setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  const saveEquipNameMap = (map) => {
    setEquipNameMap(map);
    localStorage.setItem("hd_equip_names", JSON.stringify(map));
    hdFsSet("hd_equip_names", map);
  };
  const hideDevice = (deviceId, deviceName) => {
    if (!confirm(`Remove "${deviceName}" from Heimdall?

This unit will be hidden from the portal. You can restore it from the hidden devices list in the Dashboard header.`)) return;
    const updated = /* @__PURE__ */ new Set([...hiddenDeviceIds, deviceId]);
    setHiddenDeviceIds(updated);
    const arr = [...updated];
    localStorage.setItem("hd_hidden_devices", JSON.stringify(arr));
    hdFsSet("hd_hidden_devices", arr);
  };
  const restoreDevice = (deviceId) => {
    const updated = /* @__PURE__ */ new Set([...hiddenDeviceIds]);
    updated.delete(deviceId);
    setHiddenDeviceIds(updated);
    const arr = [...updated];
    localStorage.setItem("hd_hidden_devices", JSON.stringify(arr));
    hdFsSet("hd_hidden_devices", arr);
  };
  const getDeviceName = (device) => {
    const m = equipNameMap[device.device_id];
    return m && m.customName ? m.customName : device.display_name || device.device_id;
  };
  const getDeviceEquipNum = (device) => {
    const m = equipNameMap[device.device_id];
    return m && m.equipNum ? m.equipNum : "";
  };
  const getDeviceStatus = (device) => {
    const pt = device.latest_device_point;
    if (!pt) return { label: "Unknown", color: "bg-gray-100 text-gray-500" };
    const spd = parseFloat(pt.speed) || 0;
    if (spd > 2) return { label: `Moving ${Math.round(spd)} mph`, color: "bg-blue-100 text-blue-700" };
    if (pt.drive_status === "stop") return { label: "Stopped", color: "bg-green-100 text-green-700" };
    return { label: "Idle", color: "bg-yellow-100 text-yellow-700" };
  };
  const getDeviceAddress = (device) => {
    const pt = device.latest_device_point;
    if (!pt) return "";
    return pt.formatted_address || (pt.lat && pt.lng ? pt.lat.toFixed(5) + ", " + pt.lng.toFixed(5) : "");
  };
  const getDeviceUpdated = (device) => {
    const pt = device.latest_device_point;
    if (!pt || !pt.dt_tracker) return "";
    try {
      const d = new Date(pt.dt_tracker);
      return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  };
  const handleQuickSend = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setQuickSending(true);
    try {
      let lat = null, lon = null;
      if (geoEnabled) {
        const gps = await getPhotoGPS(file);
        if (gps) {
          lat = gps.lat;
          lon = gps.lon;
        }
      }
      const b64 = await fileToBase64(file);
      const res = await fetch("/.netlify/functions/auto-field-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: b64, mimeType: file.type || "image/jpeg", lat, lon })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload failed");
      const fresh = await hdFsGet("fieldIntelAuto");
      if (Array.isArray(fresh)) setAutoReports(fresh);
      alert(`\u2705 ${result.jobName || "Miscellaneous"} \xB7 ${result.summary?.slice(0, 120) || "Analysis complete"}`);
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setQuickSending(false);
      if (quickSendRef.current) quickSendRef.current.value = "";
    }
  };
  const handleGPSConnect = () => {
    const key = apiKey.trim();
    if (!key) return;
    localStorage.setItem("HEIMDALL_API_KEY", key);
    setSyncing(true);
    setGpsLoading(true);
    fetchGPSDevices().then((data) => {
      const list = data.result_list || [];
      setGpsDevices(list);
      setGpsConnected(true);
      setGpsHibernated(list.length === 0);
      setLastRefresh(/* @__PURE__ */ new Date());
      matchDevicesToJobs(list);
      try {
        localStorage.setItem("dmc_gps_cache", JSON.stringify({ ts: Date.now(), devices: list }));
      } catch (e) {
      }
    }).catch(() => {
      setGpsConnected(false);
      setGpsHibernated(false);
    }).finally(() => {
      setSyncing(false);
      setGpsLoading(false);
    });
  };
  const approveDispatch = (id) => setDispatches((d) => d.map((x) => x.id === id ? { ...x, status: "Approved" } : x));
  const handlePlanUpload = (e) => {
    const f = e.target.files[0];
    if (f && f.type === "application/pdf") setPlanFile(f);
  };
  const analyzePlan = async () => {
    if (!planFile) return;
    setPlanAnalyzing(true);
    try {
      const b64 = await fileToBase64(planFile);
      const job = jobList.find((j) => j.id === planJob);
      const jobLabel = job ? `${job.num || job.id} \u2014 ${job.name}${job.location ? " (" + job.location + ")" : job.address ? " (" + job.address + ")" : ""}` : planJob || "Unspecified job";
      const analysis = await callClaude([{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: b64 }
          },
          {
            type: "text",
            text: `You are analyzing a civil construction plan for a paving and grading contractor. Job: ${jobLabel}.

Extract ALL of the following from this plan. Be precise with every number \u2014 these drive material ordering.

TOTAL PAVING AREA
\u2014 Total square footage and square yardage of all paving/surface treatment areas

SECTIONS / PHASES
\u2014 List each named section, phase, or area with its individual square footage

PAVEMENT DEPTH SPECIFICATION
\u2014 Depth per layer in inches (surface course, binder course, base course)
\u2014 Call out if multiple depths exist for different sections

MIX TYPES SPECIFIED
\u2014 Surface mix designation (e.g. S9.5B, I19B, B25)
\u2014 Any RAP or special mix notes

ESTIMATED TONNAGE
\u2014 Calculate tons per section using: (sq ft \xD7 depth in inches \xD7 110 lbs) \xF7 (12 \xD7 2000)
\u2014 Show the math for each section
\u2014 Provide total estimated tons

QUANTITY TABLES
\u2014 Reproduce any existing quantity/takeoff tables from the plan exactly

PROJECT INFO
\u2014 Project name, location, owner, engineer if shown on the plan

FLAGS
\u2014 Note any areas where measurements are unclear or assumptions were made`
          }
        ]
      }]);
      const result = {
        jobId: planJob || null,
        jobNum: job ? job.num || job.id : null,
        jobName: job ? job.name : planJob || null,
        fileName: planFile.name,
        date: (/* @__PURE__ */ new Date()).toLocaleDateString(),
        analysis
      };
      const updated = [result, ...planResults];
      setPlanResults(updated);
      localStorage.setItem("hd_plans", JSON.stringify(updated.slice(0, 30)));
      setPlanFile(null);
      if (planFileRef.current) planFileRef.current.value = "";
    } catch (e) {
      alert("Analysis failed: " + e.message);
    }
    setPlanAnalyzing(false);
  };
  const deletePlanResult = (i) => {
    const updated = planResults.filter((_, idx) => idx !== i);
    setPlanResults(updated);
    localStorage.setItem("hd_plans", JSON.stringify(updated));
  };
  const handlePhotoUpload = async (e, jobAddress) => {
    const files = Array.from(e.target.files);
    const processed = await Promise.all(files.map(async (f) => {
      const isVideo = f.type.startsWith("video/");
      const preview = await fileToPreviewURL(f);
      const data = isVideo ? null : await fileToBase64(f);
      const geo = isVideo || !geoEnabled ? { noGps: !geoEnabled, onSite: geoEnabled ? null : true } : await checkPhotoLocation(f, jobAddress || null);
      return { name: f.name, type: f.type || "image/jpeg", data, preview, isVideo, geo };
    }));
    setIntelPhotos((prev) => [...prev, ...processed]);
  };
  const saveMediaMetadata = (photos, job) => {
    const newEntries = photos.map((p) => ({
      id: "fimed_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      jobId: job ? job.id : null,
      jobNum: job ? job.num || job.id : null,
      jobName: job ? job.name : null,
      fileName: p.name,
      fileType: p.isVideo ? "video" : "image",
      date: (/* @__PURE__ */ new Date()).toLocaleDateString(),
      thumbUrl: p.isVideo ? null : p.preview
      // store preview for images only
    }));
    const updated = [...intelFiMedia, ...newEntries];
    setIntelFiMedia(updated);
    const forLS = updated.map((m) => ({ ...m, thumbUrl: null }));
    localStorage.setItem("hd_fi_media", JSON.stringify(forLS.slice(-200)));
  };
  const removePhoto = (i) => setIntelPhotos((prev) => prev.filter((_, idx) => idx !== i));
  const saveWorkPhotoList = (photos) => {
    setWorkPhotos(photos);
    const forLS = photos.map((p) => ({ ...p, dataUrl: null }));
    localStorage.setItem("hd_work_photos", JSON.stringify(forLS.slice(-500)));
  };
  const saveWorkPhotoFolderList = (folders) => {
    setWorkPhotoFolders(folders);
    localStorage.setItem("hd_work_photo_folders", JSON.stringify(folders));
  };
  const handleWorkPhotoSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const queued = await Promise.all(files.map(async (f) => {
      const preview = await fileToPreviewURL(f);
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = (ev) => res(ev.target.result);
        r.readAsDataURL(f);
      });
      return { id: "wp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), fileName: f.name, displayName: f.name.replace(/\.[^.]+$/, ""), preview, dataUrl, subFolder: "" };
    }));
    setWpNamingQueue(queued);
    setWpNamingIdx(0);
    if (workPhotoFileRef.current) workPhotoFileRef.current.value = "";
  };
  const commitWpPhoto = (photo) => {
    const updated = [photo, ...workPhotos];
    saveWorkPhotoList(updated);
    const nextIdx = wpNamingIdx + 1;
    if (nextIdx < wpNamingQueue.length) {
      setWpNamingIdx(nextIdx);
    } else {
      setWpNamingQueue([]);
      setWpNamingIdx(0);
    }
  };
  const deleteWorkPhoto = (id) => {
    saveWorkPhotoList(workPhotos.filter((p) => p.id !== id));
  };
  const createWorkSubFolder = () => {
    const name = wpNewFolder.trim();
    if (!name || workPhotoFolders.includes(name)) return;
    saveWorkPhotoFolderList([...workPhotoFolders, name]);
    setWpNewFolder("");
    setWpShowNewFolder(false);
  };
  const analyzeIntel = async () => {
    if (!intelPhotos.length) return;
    setIntelAnalyzing(true);
    try {
      const job = jobList.find((j) => j.id === intelJob);
      const jobLabel = job ? `${job.num || job.id} \u2014 ${job.name}${job.location ? " (" + job.location + ")" : job.address ? " (" + job.address + ")" : ""}` : intelJob || "Unspecified job";
      const analyzablePhotos = intelPhotos.filter((p) => !p.isVideo && p.geo?.onSite !== false);
      const offSiteCount = intelPhotos.filter((p) => !p.isVideo && p.geo?.onSite === false).length;
      saveMediaMetadata(analyzablePhotos, job);
      const planRef = intelPlanIdx !== "" ? planResults[parseInt(intelPlanIdx)] : null;
      const imageContent = analyzablePhotos.map((p) => ({
        type: "image",
        source: { type: "base64", media_type: p.type, data: p.data }
      }));
      const textPrompt = `You are analyzing field photos from a paving and grading construction site. These photos were captured using Meta Ray-Ban smart glasses or a jobsite phone camera. Job: ${jobLabel}.
${offSiteCount > 0 ? `Note: ${offSiteCount} photo(s) were excluded because GPS data placed them more than 0.5 miles from this job site.
` : ""}${planRef ? `
Civil plan analysis to cross-reference:
---
${planRef.analysis}
---
` : ""}
From these ${analyzablePhotos.length} photo(s), provide a detailed field intelligence report covering:

SITE CONDITION ASSESSMENT
\u2014 Current state of the surface (subbase, existing pavement, graded base, etc.)
\u2014 Visible defects, soft spots, or conditions affecting paving sequence

VISIBLE AREA ESTIMATE
\u2014 Approximate square footage visible across all photos
\u2014 Confidence level in estimate
${planRef ? `\u2014 Comparison to plan: do visible conditions match the plan scope? Note any additions or reductions.
` : ""}
SURFACE AREA REFINEMENT
\u2014 Best estimate of total paving area based on site conditions and visible cues
\u2014 Any scope changes implied by what you see vs what was designed

MATERIAL QUANTITY ESTIMATE
\u2014 Estimated total tonnage needed at standard depths (call out depth assumed)
\u2014 Flag any areas that may require additional base material or remediation before paving
${planRef ? `\u2014 Adjusted tonnage vs plan estimate: explain any difference
` : ""}
EQUIPMENT STAGING & ACCESS
\u2014 Paver approach direction and mat width recommendations
\u2014 Truck queuing space and any pinch points
\u2014 Roller pattern considerations based on site layout

PHASING RECOMMENDATION
\u2014 Suggested paving sequence (e.g. mainline before turn lanes, high areas first, etc.)
\u2014 Any sections that should be paved separately due to logistics or mix spec differences

MIX RECOMMENDATION
\u2014 Appropriate surface course mix type based on visible conditions and apparent traffic loading
\u2014 Any notes on tack coat, joint treatment, or special areas

Be specific, practical, and flag any uncertainties clearly.`;
      const analysis = await callClaude([{
        role: "user",
        content: [...imageContent, { type: "text", text: textPrompt }]
      }]);
      const result = {
        jobId: intelJob || null,
        jobNum: job ? job.num || job.id : null,
        jobName: job ? job.name : intelJob || null,
        date: (/* @__PURE__ */ new Date()).toLocaleDateString(),
        photoCount: analyzablePhotos.length,
        planRef: planRef ? `${planRef.fileName}` : null,
        analysis
      };
      const updated = [result, ...intelResults];
      setIntelResults(updated);
      localStorage.setItem("hd_intel", JSON.stringify(updated.slice(0, 30)));
      setIntelPhotos([]);
      if (intelFileRef.current) intelFileRef.current.value = "";
    } catch (e) {
      alert("Analysis failed: " + e.message);
    }
    setIntelAnalyzing(false);
  };
  const deleteIntelResult = (i) => {
    const updated = intelResults.filter((_, idx) => idx !== i);
    setIntelResults(updated);
    localStorage.setItem("hd_intel", JSON.stringify(updated));
  };
  const pushToPricing = (result) => {
    window.parent.postMessage({
      type: "heimdall_push_pricing",
      analysis: result.analysis,
      jobId: result.jobId,
      jobName: result.jobName
    }, "*");
    window.parent.postMessage({ type: "heimdall_switch_tab", tab: "projectPricing" }, "*");
    alert("Estimates sent to Pricing Sheet. Switch to the Project Pricing tab to review.");
  };
  const exportCSV = (rows, filename) => {
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };
  const exportDispatches = () => exportCSV(
    [
      ["Dispatch ID", "Job", "Equipment", "Driver", "Truck", "From", "To", "Address", "Date", "Time", "Miles", "Permit", "Status"],
      ...dispatches.map((d) => [d.id, d.jobName, d.eqName, d.driverName, d.truck, d.from, d.to, d.address, d.date, d.time, d.miles, d.permit, d.status])
    ],
    "dispatch_schedule.csv"
  );
  const exportHistory = () => exportCSV(
    [
      ["Date", "Equipment", "Driver", "From", "To", "Miles", "Duration"],
      ...mockMoveHistory.map((m) => [m.date, m.eq, m.driver, m.from, m.to, m.miles, m.duration])
    ],
    "move_history.csv"
  );
  const exportConflicts = () => exportCSV(
    [
      ["ID", "Severity", "Type", "Description", "Affected Job", "Resolution"],
      ...conflicts.map((c) => [c.id, c.severity, c.type, `"${c.desc}"`, c.affectedJob, `"${c.resolution}"`])
    ],
    "conflict_report.csv"
  );
  const NameEditorModal = () => {
    if (!showNameEditor) return null;
    const [localMap, setLocalMap] = React.useState(() => JSON.parse(JSON.stringify(equipNameMap)));
    const isMob = window.innerWidth < 600;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => {
          if (e.target === e.currentTarget) setShowNameEditor(false);
        },
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 9e3,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          alignItems: isMob ? "flex-end" : "center",
          justifyContent: "center",
          padding: isMob ? "0" : "16px"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: {
        background: "var(--asphalt-mid)",
        border: "2px solid var(--stripe)",
        borderRadius: isMob ? "16px 16px 0 0" : "var(--radius-lg)",
        width: isMob ? "100%" : "min(520px,100%)",
        maxHeight: isMob ? "90vh" : "80vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)"
      } }, /* @__PURE__ */ React.createElement("div", { style: { padding: isMob ? "14px 16px" : "16px 20px", borderBottom: "1px solid var(--asphalt-light)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: isMob ? "17px" : "20px", letterSpacing: "3px", color: "var(--stripe)" } }, "\u270F\uFE0F Name Equipment"), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setShowNameEditor(false),
          style: {
            background: "none",
            border: "1px solid var(--asphalt-light)",
            borderRadius: "var(--radius)",
            color: "var(--concrete-dim)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "13px",
            padding: isMob ? "8px 18px" : "5px 12px",
            cursor: "pointer",
            minHeight: isMob ? "44px" : "auto",
            touchAction: "manipulation"
          }
        },
        "\u2715 Close"
      )), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 14px", background: "rgba(90,180,245,0.06)", borderBottom: "1px solid var(--asphalt-light)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "var(--concrete-dim)" } }, "Map each GPS device to your equipment name & number. Saves across all Heimdall views.")), /* @__PURE__ */ React.createElement("div", { style: { overflowY: "auto", flex: 1, WebkitOverflowScrolling: "touch" } }, gpsDevices.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "24px", textAlign: "center", fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "var(--concrete-dim)" } }, "No GPS devices loaded yet."), gpsDevices.map((dev) => {
        const entry = localMap[dev.device_id] || {};
        const addr = getDeviceAddress(dev);
        const st = getDeviceStatus(dev);
        return /* @__PURE__ */ React.createElement("div", { key: dev.device_id, style: { padding: isMob ? "12px 14px" : "10px 16px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--white)" } }, dev.display_name || dev.device_id), "\xA0\xB7\xA0", /* @__PURE__ */ React.createElement("span", { style: { color: st.label.startsWith("Moving") ? "#5ab4f5" : "#7ecb8f" } }, st.label), addr && /* @__PURE__ */ React.createElement("span", null, " \xB7 ", addr)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: isMob ? "column" : "row", gap: "6px", marginTop: "6px" } }, /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "text",
            placeholder: "Equipment name (e.g. CAT 140 Grader)",
            value: entry.customName || "",
            onChange: (e) => setLocalMap((m) => ({ ...m, [dev.device_id]: { ...m[dev.device_id] || {}, customName: e.target.value } })),
            style: {
              flex: 2,
              background: "var(--asphalt)",
              border: "1px solid var(--asphalt-light)",
              borderRadius: "var(--radius)",
              color: "var(--white)",
              fontFamily: "'DM Mono',monospace",
              fontSize: "16px",
              /* 16px prevents iOS auto-zoom on focus */
              padding: isMob ? "10px 12px" : "6px 8px"
            }
          }
        ), /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "text",
            placeholder: "Equip # (e.g. EQ-14)",
            value: entry.equipNum || "",
            onChange: (e) => setLocalMap((m) => ({ ...m, [dev.device_id]: { ...m[dev.device_id] || {}, equipNum: e.target.value } })),
            style: {
              flex: 1,
              background: "var(--asphalt)",
              border: "1px solid var(--asphalt-light)",
              borderRadius: "var(--radius)",
              color: "var(--white)",
              fontFamily: "'DM Mono',monospace",
              fontSize: "16px",
              /* 16px prevents iOS auto-zoom on focus */
              padding: isMob ? "10px 12px" : "6px 8px"
            }
          }
        )));
      })), /* @__PURE__ */ React.createElement("div", { style: { padding: isMob ? "12px 14px 20px" : "12px 16px", borderTop: "1px solid var(--asphalt-light)", display: "flex", gap: "8px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setShowNameEditor(false),
          style: {
            flex: 1,
            background: "none",
            border: "1px solid var(--asphalt-light)",
            borderRadius: "var(--radius)",
            color: "var(--concrete-dim)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "13px",
            padding: isMob ? "12px" : "7px 16px",
            cursor: "pointer",
            minHeight: isMob ? "48px" : "auto",
            touchAction: "manipulation"
          }
        },
        "Cancel"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            saveEquipNameMap(localMap);
            setShowNameEditor(false);
          },
          style: {
            flex: 2,
            background: "rgba(245,197,24,0.15)",
            border: "1px solid rgba(245,197,24,0.5)",
            borderRadius: "var(--radius)",
            color: "var(--stripe)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "13px",
            fontWeight: 700,
            padding: isMob ? "12px" : "7px 20px",
            cursor: "pointer",
            minHeight: isMob ? "48px" : "auto",
            touchAction: "manipulation"
          }
        },
        "\u{1F4BE} Save Names"
      )))
    );
  };
  return /* @__PURE__ */ React.createElement("div", { className: "min-h-screen bg-gray-50 font-sans" }, /* @__PURE__ */ React.createElement(NameEditorModal, null), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--asphalt-mid)", borderBottom: "2px solid var(--stripe)", position: "sticky", top: 0, zIndex: 1500, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "16px", padding: hdMobile ? "8px 14px 0" : "14px 24px 0" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 0", minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "hd-brand-title", style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "52px", letterSpacing: "6px", color: "var(--white)", lineHeight: 1, userSelect: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "Don Martin Corporation"), /* @__PURE__ */ React.createElement("div", { className: "hd-brand-sub", style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--stripe)", marginTop: "3px", whiteSpace: "nowrap" } }, "\u2699 Heimdall \xA0\xB7\xA0 Lowbed Dispatch \xA0\xB7\xA0 Field Intelligence")), !hdMobile && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "11px", letterSpacing: "3px", color: "var(--concrete-dim)" } }, "LIVE STATUS"), /* @__PURE__ */ React.createElement("span", { style: { background: gpsConnected ? "rgba(61,158,106,0.15)" : "rgba(155,148,136,0.1)", color: gpsConnected ? "#7ecb8f" : "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 8px", borderRadius: "10px", border: `1px solid ${gpsConnected ? "rgba(61,158,106,0.3)" : "rgba(155,148,136,0.2)"}`, whiteSpace: "nowrap" } }, "\u25CF ", gpsConnected ? gpsHibernated ? "Fleet Hibernated" : `GPS Live \xB7 ${gpsLoading ? "\u2026" : gpsDevices.length} units` : "GPS Offline")), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 0", display: hdMobile ? "none" : "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px", minWidth: 0 } }, !gpsConnected && !isDriverUser && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      style: { background: "var(--asphalt)", border: "1px solid var(--asphalt-light)", borderRadius: "var(--radius)", color: "var(--white)", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "5px 10px", width: "150px" },
      placeholder: "OneStepGPS API key\u2026",
      value: apiKey,
      onChange: (e) => setApiKey(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && handleGPSConnect()
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleGPSConnect,
      style: { background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.4)", borderRadius: "var(--radius)", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }
    },
    syncing ? "\u23F3" : "\u{1F6F0} Connect"
  )), isDesktopUser && (() => {
    const _fleet = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false);
      } catch (e) {
        return [];
      }
    })();
    const assignedGpsCount = gpsDevices.filter((dev) => {
      const dn = getDeviceName(dev).toLowerCase();
      return _fleet.some((eq) => {
        const n = (eq.name || "").toLowerCase();
        if (!n) return false;
        return dn === n || dn.includes(n) || n.includes(dn.split(" ")[0]);
      });
    }).length;
    const kpis = [
      { label: "Equipment", val: assignedGpsCount, color: "#5ab4f5", bg: "rgba(90,180,245,0.10)", border: "rgba(90,180,245,0.28)" },
      { label: "Jobs", val: mockJobs.length, color: "#f5c518", bg: "rgba(245,197,24,0.08)", border: "rgba(245,197,24,0.28)" },
      { label: "Dispatches", val: dispatches.length, color: "#7ecb8f", bg: "rgba(126,203,143,0.10)", border: "rgba(126,203,143,0.28)" },
      { label: "Conflicts", val: planConflicts.length, color: "#d94f3d", bg: "rgba(217,79,61,0.10)", border: "rgba(217,79,61,0.28)" }
    ];
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, kpis.map((k) => /* @__PURE__ */ React.createElement("div", { key: k.label, style: { background: k.bg, border: "1px solid " + k.border, borderRadius: "6px", padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: "7px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "20px", color: k.color, lineHeight: 1 } }, k.val), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)", letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" } }, k.label))));
  })())), hdMobile && isDesktopUser && (() => {
    const _fleet = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false);
      } catch (e) {
        return [];
      }
    })();
    const assignedGpsCount = gpsDevices.filter((dev) => {
      const dn = getDeviceName(dev).toLowerCase();
      return _fleet.some((eq) => {
        const n = (eq.name || "").toLowerCase();
        if (!n) return false;
        return dn === n || dn.includes(n) || n.includes(dn.split(" ")[0]);
      });
    }).length;
    const kpis = [
      { label: "Equipment", val: assignedGpsCount, color: "#5ab4f5", bg: "rgba(90,180,245,0.10)", border: "rgba(90,180,245,0.28)" },
      { label: "Jobs", val: mockJobs.length, color: "#f5c518", bg: "rgba(245,197,24,0.08)", border: "rgba(245,197,24,0.28)" },
      { label: "Dispatches", val: dispatches.length, color: "#7ecb8f", bg: "rgba(126,203,143,0.10)", border: "rgba(126,203,143,0.28)" },
      { label: "Conflicts", val: planConflicts.length, color: "#d94f3d", bg: "rgba(217,79,61,0.10)", border: "rgba(217,79,61,0.28)" }
    ];
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px", padding: "6px 14px 0", justifyContent: "space-between" } }, kpis.map((k) => /* @__PURE__ */ React.createElement("div", { key: k.label, style: { background: k.bg, border: "1px solid " + k.border, borderRadius: "6px", padding: "4px 8px", display: "flex", alignItems: "center", gap: "5px", flex: "1 1 0" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", color: k.color, lineHeight: 1 } }, k.val), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "var(--concrete-dim)", letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" } }, k.label))));
  })(), /* @__PURE__ */ React.createElement("div", { className: "scrollbar-hide", style: { display: "flex", overflowX: "auto", background: "var(--asphalt-mid)", padding: "0 4px", marginTop: "6px" } }, TABS.filter((t) => !(isATow && t === "Master Schedule")).map((t) => {
    const _activeCount = t === "Conflicts" ? planConflicts.filter((c) => {
      if (c._planConflict) {
        if (!lowbedPlan || !c._primaryMove) return true;
        const _j = lowbedPlan.jobs[c._primaryMove.jobIdx];
        const _m = _j && _j.moves[c._primaryMove.moveIdx];
        return !(_m && _m.overridden);
      }
      try {
        return !JSON.parse(localStorage.getItem("conflict_override_" + c.id) || "false");
      } catch (e) {
        return true;
      }
    }).length : 0;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t,
        onClick: () => setTab(t),
        style: { padding: "8px 12px", fontSize: "11px", fontFamily: "'DM Mono',monospace", fontWeight: 700, whiteSpace: "nowrap", background: "transparent", border: "none", borderBottom: tab === t ? "2px solid var(--stripe)" : "2px solid transparent", color: tab === t ? "var(--stripe)" : "var(--concrete-dim)", cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.5px", outline: "none", position: "relative" }
      },
      t,
      t === "Conflicts" && _activeCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: "3px", right: "1px", background: "var(--red)", color: "#fff", borderRadius: "999px", fontSize: "9px", fontWeight: 800, minWidth: "14px", height: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px", lineHeight: 1 } }, _activeCount)
    );
  }))), /* @__PURE__ */ React.createElement("div", { className: tab === "Dashboard" ? "" : "p-4 space-y-4 max-w-2xl mx-auto" }, tab === "Dashboard" && isDriverUser && !isDesktopUser && isLowbedDriver && (() => {
    const driverUsername = (localStorage.getItem("dmc_u") || "").toLowerCase();
    const DRIVER_NAMES = { "nightmare57": "Eric", "eric": "Eric", "blydon": "Bill Lydon", "bill lydon": "Bill Lydon", "igiron": "Ingrid", "ingrid": "Ingrid", "atowing": "Andy's Towing", "andy's towing": "Andy's Towing", "yonton": "Henry", "henry": "Henry", "ttengburg": "Tommy", "tommy": "Tommy", "field2": "Field 2", "field3": "Field 3", "field4": "Field 4", "field5": "Field 5" };
    const driverDisplay = DRIVER_NAMES[driverUsername] || driverUsername;
    const cleanoutAlerts = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_cleanout_jobs") || "[]").filter((a) => !a.dismissed);
      } catch (e) {
        return [];
      }
    })();
    const dismissCleanout = (idx) => {
      try {
        const all = JSON.parse(localStorage.getItem("dmc_cleanout_jobs") || "[]");
        all[idx] = { ...all[idx], dismissed: true };
        localStorage.setItem("dmc_cleanout_jobs", JSON.stringify(all));
      } catch (e) {
      }
    };
    const allMoves = [];
    (lowbedPlan && lowbedPlan.jobs || []).forEach((job, ji) => {
      (job.moves || []).forEach((mv, mi) => {
        allMoves.push({ job, move: mv, moveIdx: mi + 1, jobIdx: ji });
      });
    });
    const myMoves = allMoves.filter((m) => (m.move.assignedDriver || "").toLowerCase() === driverDisplay.toLowerCase());
    const unassignedMoves = allMoves.filter((m) => !m.move.assignedDriver && m.move.status !== "complete");
    const otherMoves = allMoves.filter((m) => m.move.assignedDriver && (m.move.assignedDriver || "").toLowerCase() !== driverDisplay.toLowerCase() && m.move.status !== "complete");
    const moveCard = (item, showClaim) => /* @__PURE__ */ React.createElement("div", { key: item.jobIdx + "_" + item.moveIdx, style: { background: "rgba(90,180,245,0.06)", borderRadius: "8px", border: "1px solid rgba(90,180,245,0.2)", padding: "10px 12px", marginBottom: "8px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "11px", fontWeight: 700, color: "#5ab4f5" } }, "Move ", item.moveIdx, " \u2014 ", item.job.jobName || item.job.jobNum || "Job"), item.job.date && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.7)", marginTop: "2px" } }, item.job.date, item.job.location ? " \xB7 " + item.job.location : "")), /* @__PURE__ */ React.createElement("div", { style: {
      fontFamily: "'DM Mono',monospace",
      fontSize: "9px",
      fontWeight: 700,
      color: item.move.status === "complete" ? "#7ecb8f" : item.move.assignedDriver ? "#e8a94c" : "rgba(155,148,136,0.5)",
      background: item.move.status === "complete" ? "rgba(126,203,143,0.1)" : item.move.assignedDriver ? "rgba(232,169,76,0.1)" : "rgba(155,148,136,0.08)",
      border: "1px solid " + (item.move.status === "complete" ? "rgba(126,203,143,0.3)" : item.move.assignedDriver ? "rgba(232,169,76,0.3)" : "rgba(155,148,136,0.2)"),
      borderRadius: "10px",
      padding: "2px 8px",
      whiteSpace: "nowrap"
    } }, item.move.status === "complete" ? "\u2713 Complete" : item.move.assignedDriver ? "\u23F3 " + item.move.assignedDriver : "Open")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: item.move.deadline ? "7px" : "0" } }, (item.move.equipment || []).map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: ei, style: { background: "rgba(245,197,24,0.1)", border: "1px solid rgba(245,197,24,0.25)", borderRadius: "4px", padding: "2px 7px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--stripe)" } }, EQ_ICONS[eq.type] || "\u{1F4E6}", " ", eq.name || eq.type)), (item.move.towingEquipment || []).map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: "t" + ei, style: { background: "rgba(232,169,76,0.1)", border: "1px solid rgba(232,169,76,0.35)", borderRadius: "4px", padding: "2px 7px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#e8a94c" } }, EQ_ICONS[eq.type] || "\u{1FA9D}", " ", eq.name || eq.type))), item.move.deadline && /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px", background: "#fff", border: "2px solid #c0392b", borderRadius: "6px", padding: "4px 10px", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "#c0392b" } }, "\u26A0 DEADLINE: By ", new Date(item.move.deadline).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }), " @ ", new Date(item.move.deadline).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })), showClaim && !isTowingDriver && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          const plan2 = JSON.parse(JSON.stringify(lowbedPlan));
          if (!plan2) return;
          plan2.jobs[item.jobIdx].moves[item.moveIdx - 1].assignedDriver = driverDisplay;
          plan2.jobs[item.jobIdx].moves[item.moveIdx - 1].status = "assigned";
          plan2.jobs[item.jobIdx].moves[item.moveIdx - 1].claimedAt = Date.now();
          savePlanAndRefresh(plan2);
        },
        style: { marginTop: "8px", width: "100%", padding: "6px", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.35)", borderRadius: "5px", color: "#7ecb8f", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, cursor: "pointer" }
      },
      "\u270B Claim This Move"
    ), showClaim && isTowingDriver && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          document.getElementById("_andysDlg")?.remove();
          let trucks = [{ type: "tow_truck", name: "" }];
          const render2 = () => {
            const d2 = document.getElementById("_andysDlg");
            if (!d2) return;
            d2.querySelector("#_andysTruckRows").innerHTML = trucks.map((t, ti) => `
                        <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
                          <select onchange="window._andysUpdateTruck(${ti},'type',this.value)"
                            style="flex:1;background:#1a1a1a;border:1px solid #555;border-radius:4px;color:#f9f7f3;font-family:'DM Mono',monospace;font-size:11px;padding:6px;">
                            <option value="tow_truck"${t.type === "tow_truck" ? " selected" : ""}>\u{1FA9D} Flatbed Tow</option>
                            <option value="wrecker"${t.type === "wrecker" ? " selected" : ""}>\u{1F529} Wrecker</option>
                            <option value="rollback"${t.type === "rollback" ? " selected" : ""}>\u{1F6FB} Rollback</option>
                          </select>
                          <input onchange="window._andysUpdateTruck(${ti},'name',this.value)" type="text" placeholder="Truck name / plate..." value="${t.name}"
                            style="flex:2;background:#1a1a1a;border:1px solid #555;border-radius:4px;color:#f9f7f3;font-family:'DM Mono',monospace;font-size:11px;padding:6px;">
                          ${trucks.length > 1 ? `<button onclick="window._andysRemoveTruck(${ti})" style="background:none;border:1px solid #555;border-radius:4px;color:#9b9488;padding:4px 8px;cursor:pointer;font-size:11px;">\u2715</button>` : ""}
                        </div>`).join("");
          };
          window._andysUpdateTruck = (ti, field, val) => {
            trucks[ti][field] = val;
          };
          window._andysRemoveTruck = (ti) => {
            trucks.splice(ti, 1);
            render2();
          };
          window._andysAddTruck = () => {
            trucks.push({ type: "tow_truck", name: "" });
            render2();
          };
          window._andysConfirm = () => {
            const plan2 = (() => {
              try {
                return JSON.parse(localStorage.getItem("dmc_lowbed_plan") || "null");
              } catch (e) {
                return null;
              }
            })();
            if (!plan2) return;
            const mv2 = plan2.jobs[item.jobIdx].moves[item.moveIdx - 1];
            mv2.assignedDriver = "Andy's Towing";
            mv2.status = "assigned";
            mv2.claimedAt = Date.now();
            mv2.isExternalVendor = true;
            mv2.towingEquipment = trucks.filter((t) => t.name.trim()).map((t) => ({ type: t.type, name: t.name.trim() }));
            localStorage.setItem("dmc_lowbed_plan", JSON.stringify(plan2));
            setLowbedPlan({ ...plan2 });
            document.getElementById("_andysDlg")?.remove();
          };
          const dlg = document.createElement("div");
          dlg.id = "_andysDlg";
          dlg.style.cssText = "position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);";
          dlg.innerHTML = `<div style="background:#252525;border:2px solid #e8a94c;border-radius:10px;padding:24px 28px;min-width:min(400px,92vw);max-width:min(480px,95vw);box-shadow:0 20px 60px rgba(0,0,0,0.8);">
                      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:#e8a94c;margin-bottom:4px;">\u{1FA9D} Claim Move \u2014 Andy's Towing</div>
                      <div style="font-family:'DM Mono',monospace;font-size:10px;color:#9b9488;margin-bottom:16px;">Add which trucks you're bringing for this move</div>
                      <div style="font-family:'DM Mono',monospace;font-size:9px;color:#9b9488;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Towing Fleet for This Move</div>
                      <div id="_andysTruckRows"></div>
                      <button onclick="window._andysAddTruck()" style="width:100%;padding:7px;background:rgba(232,169,76,0.08);border:1px dashed rgba(232,169,76,0.4);border-radius:5px;color:#e8a94c;font-family:'DM Mono',monospace;font-size:10px;cursor:pointer;margin-bottom:16px;">+ Add Truck</button>
                      <div style="display:flex;gap:10px;">
                        <button onclick="document.getElementById('_andysDlg').remove()" style="flex:1;padding:9px;background:none;border:1px solid #555;border-radius:5px;color:#9b9488;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;">Cancel</button>
                        <button onclick="window._andysConfirm()" style="flex:2;padding:9px;background:rgba(232,169,76,0.15);border:1px solid rgba(232,169,76,0.5);border-radius:5px;color:#e8a94c;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;font-weight:700;">\u2713 Confirm &amp; Claim Move</button>
                      </div>
                    </div>`;
          document.body.appendChild(dlg);
          render2();
        },
        style: { marginTop: "8px", width: "100%", padding: "6px", background: "rgba(232,169,76,0.1)", border: "1px solid rgba(232,169,76,0.4)", borderRadius: "5px", color: "#e8a94c", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, cursor: "pointer" }
      },
      "\u{1FA9D} Claim Move + Add Trucks"
    ));
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "16px", maxWidth: "680px", margin: "0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { background: isTowingDriver ? "rgba(232,169,76,0.06)" : "rgba(90,180,245,0.06)", border: "1px solid " + (isTowingDriver ? "rgba(232,169,76,0.25)" : "rgba(90,180,245,0.2)"), borderRadius: "10px", padding: "14px 18px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "20px", letterSpacing: "2px", color: isTowingDriver ? "#e8a94c" : "#5ab4f5" } }, isTowingDriver ? "\u{1FA9D} ANDY'S TOWING" : "\u{1F69B} DRIVER DASHBOARD"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.7)", marginTop: "2px" } }, isTowingDriver ? /* @__PURE__ */ React.createElement("span", null, "External Vendor \xB7 ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--white)" } }, "Equipment Hauling & Towing")) : /* @__PURE__ */ React.createElement("span", null, "Logged in as ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--white)" } }, driverDisplay), " \xB7 Lowbed Driver"))), lowbedPlan && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.25)", borderRadius: "8px", padding: "4px 10px" } }, "\u25CF Plan Active")), (() => {
      const livDevs = gpsDevices;
      const cached = livDevs.length === 0 ? (() => {
        try {
          const c = JSON.parse(localStorage.getItem("dmc_gps_cache") || "{}");
          return Array.isArray(c.devices) ? c.devices : [];
        } catch (e) {
          return [];
        }
      })() : [];
      const devs = livDevs.length > 0 ? livDevs : cached;
      const fromCache = livDevs.length === 0 && devs.length > 0;
      if (devs.length === 0) return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "16px", fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.5)", display: "flex", alignItems: "center", gap: "8px" } }, gpsLoading ? "\u{1F4E1} Loading live GPS\u2026" : "\u{1F4E1} GPS unavailable \u2014 tap to retry", !gpsLoading && /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setGpsLoading(true);
            fetchGPSDevices().then((d) => {
              const l = d.result_list || [];
              setGpsDevices(l);
              try {
                localStorage.setItem("dmc_gps_cache", JSON.stringify({ ts: Date.now(), devices: l }));
              } catch (e) {
              }
            }).catch(() => {
            }).finally(() => setGpsLoading(false));
          },
          style: { background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.3)", borderRadius: "4px", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "9px", padding: "2px 8px", cursor: "pointer" }
        },
        "\u21BA"
      ));
      return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#5ab4f5", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, "\u{1F4E1} Live Equipment GPS", /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.25)", borderRadius: "10px", padding: "1px 7px", fontSize: "9px" } }, devs.length, " units"), fromCache && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.4)" } }, "\xB7 cached"), gpsLoading && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.4)" } }, "\xB7 refreshing\u2026")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } }, devs.slice(0, 15).map((dev) => {
        const nm = getDeviceName(dev);
        const addr = getDeviceAddress(dev);
        const st = getDeviceStatus(dev);
        const isMoving = st && st.label && st.label.startsWith("Moving");
        const isStopped = st && (st.label === "Stopped" || st.label === "Idle");
        return /* @__PURE__ */ React.createElement("div", { key: dev.device_id, style: { background: "rgba(90,180,245,0.04)", border: "1px solid rgba(90,180,245,0.14)", borderRadius: "6px", padding: "7px 12px", display: "flex", alignItems: "center", gap: "10px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "#5ab4f5", minWidth: "130px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, nm), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, addr || "Location unknown"), /* @__PURE__ */ React.createElement("span", { style: {
          fontFamily: "'DM Mono',monospace",
          fontSize: "8px",
          padding: "2px 8px",
          borderRadius: "10px",
          whiteSpace: "nowrap",
          flexShrink: 0,
          background: isMoving ? "rgba(90,180,245,0.15)" : isStopped ? "rgba(126,203,143,0.12)" : "rgba(155,148,136,0.1)",
          color: isMoving ? "#5ab4f5" : isStopped ? "#7ecb8f" : "var(--concrete-dim)",
          border: "1px solid " + (isMoving ? "rgba(90,180,245,0.3)" : isStopped ? "rgba(126,203,143,0.3)" : "rgba(155,148,136,0.2)")
        } }, isMoving ? "\u25CF " + st.label : isStopped ? "\u25CE " + st.label : "\u2014 " + (st && st.label ? st.label : "Unknown")));
      }), devs.length > 15 && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.4)", textAlign: "center", paddingTop: "4px" } }, "+", devs.length - 15, " more units")));
    })(), (() => {
      const schedRaw = (() => {
        try {
          return JSON.parse(localStorage.getItem("pavescope_sched_v2") || "{}");
        } catch (e) {
          return {};
        }
      })();
      const TYPE_COLOR = { day: "#0d4f7c", night: "#1a0a4a", pending: "#5c4000", blank: "transparent" };
      const TYPE_BADGE = { day: "DAY", night: "NIGHT", pending: "PENDING", blank: "" };
      const days7 = [];
      const today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });
        const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const data = schedRaw[key] || {};
        const blocks = [];
        if (data.top && data.top.type && data.top.type !== "blank") blocks.push(data.top);
        if (data.bot && data.bot.type && data.bot.type !== "blank") blocks.push(data.bot);
        (data.extras || []).forEach((ex) => {
          if (ex.data && ex.data.type !== "blank") blocks.push(ex.data);
        });
        days7.push({ key, dayLabel, dateLabel, blocks, isToday: i === 0 });
      }
      return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#7ecb8f", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" } }, "\u{1F4C5} 7-Day Schedule"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "6px", WebkitOverflowScrolling: "touch" } }, days7.map((day) => /* @__PURE__ */ React.createElement("div", { key: day.key, style: { flex: "0 0 130px", background: day.isToday ? "rgba(90,180,245,0.08)" : "rgba(255,255,255,0.03)", border: "1px solid " + (day.isToday ? "rgba(90,180,245,0.35)" : "rgba(255,255,255,0.08)"), borderRadius: "8px", overflow: "hidden", minHeight: "100px" } }, /* @__PURE__ */ React.createElement("div", { style: { background: day.isToday ? "rgba(90,180,245,0.18)" : "rgba(255,255,255,0.05)", padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "13px", letterSpacing: "1px", color: day.isToday ? "#5ab4f5" : "var(--concrete-dim)" } }, day.dayLabel), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.7)" } }, day.dateLabel)), /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 8px", display: "flex", flexDirection: "column", gap: "4px" } }, day.blocks.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.3)", textAlign: "center", padding: "10px 0" } }, "No work") : day.blocks.map((bl, bi) => /* @__PURE__ */ React.createElement("div", { key: bi, style: { background: TYPE_COLOR[bl.type] || "rgba(255,255,255,0.04)", borderRadius: "4px", padding: "4px 6px", border: "1px solid rgba(255,255,255,0.1)" } }, TYPE_BADGE[bl.type] && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(255,255,255,0.5)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "2px" } }, TYPE_BADGE[bl.type]), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, color: "#f9f7f3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, bl.fields?.jobName || bl.fields?.jobNum || "\u2014"), bl.fields?.jobNum && bl.fields?.jobName && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, bl.fields.jobNum), bl.fields?.location && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "\u{1F4CD} ", bl.fields.location))))))));
    })(), cleanoutAlerts.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" } }, cleanoutAlerts.map((alert2, ai) => /* @__PURE__ */ React.createElement("div", { key: ai, style: { background: "rgba(245,197,24,0.12)", border: "2px solid rgba(245,197,24,0.5)", borderRadius: "10px", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "var(--stripe)", marginBottom: "3px" } }, "\u{1F514} CLEAN OUT AUTHORIZED"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(245,197,24,0.8)" } }, /* @__PURE__ */ React.createElement("strong", null, alert2.jobLabel), " \u2014 equipment can be pulled from this job to other sites or back to shop.")), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          dismissCleanout(ai);
          setCleanoutSet(new Set(cleanoutSet));
        },
        style: { flexShrink: 0, background: "rgba(245,197,24,0.15)", border: "1px solid rgba(245,197,24,0.4)", borderRadius: "5px", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, padding: "4px 10px", cursor: "pointer" }
      },
      "\u2713 Got It"
    )))), !lowbedPlan || !lowbedPlan.jobs || lowbedPlan.jobs.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "40px 20px", fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "rgba(155,148,136,0.5)" } }, "No active lowbed plan. Check back after dispatch generates the weekly moves.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "20px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#7ecb8f", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" } }, "My Assigned Moves", /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(126,203,143,0.12)", border: "1px solid rgba(126,203,143,0.3)", borderRadius: "10px", padding: "1px 7px", fontSize: "9px" } }, myMoves.length)), myMoves.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.4)", padding: "12px 0" } }, "No moves assigned to you yet.") : myMoves.map((item) => moveCard(item, false))), unassignedMoves.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "20px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#e8a94c", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" } }, "Open Moves \u2014 Available to Claim", /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(232,169,76,0.12)", border: "1px solid rgba(232,169,76,0.3)", borderRadius: "10px", padding: "1px 7px", fontSize: "9px" } }, unassignedMoves.length)), unassignedMoves.map((item) => moveCard(item, true))), otherMoves.length > 0 && /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.6)", letterSpacing: "1px", textTransform: "uppercase", cursor: "pointer", marginBottom: "8px", listStyle: "none", display: "flex", alignItems: "center", gap: "8px" } }, "Other Active Moves", /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(155,148,136,0.08)", border: "1px solid rgba(155,148,136,0.2)", borderRadius: "10px", padding: "1px 7px", fontSize: "9px" } }, otherMoves.length)), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "8px" } }, otherMoves.map((item) => moveCard(item, false))))), lowbedPlan && lowbedPlan.jobs && lowbedPlan.jobs.length > 0 && (() => {
      return /* @__PURE__ */ React.createElement("div", { style: { marginTop: "14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "#a78bfa", marginBottom: "10px" } }, "\u{1F69A} LOWBED MOVES"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "14px" } }, lowbedPlan.jobs.map((job, ji) => {
        const moves = job.moves || [];
        const onSiteNames = /* @__PURE__ */ new Set();
        moves.forEach((mv) => {
          if (mv.status === "complete") (mv.equipment || []).forEach((eq) => eq.name && onSiteNames.add(eq.name));
        });
        const allEq = job.allEquipment || [];
        const jobKey = String(job.jobNum || job.jobName || ji);
        const cleanoutSent = cleanoutSet.has(jobKey);
        return /* @__PURE__ */ React.createElement("div", { key: ji, style: { display: "flex", alignItems: "stretch", gap: "6px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 34%", minWidth: 0, background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.28)", borderRadius: "8px", padding: "8px 10px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, color: "#a78bfa", marginBottom: "5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, job.jobName || job.jobNum || "Job " + (ji + 1)), allEq.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.4)" } }, "No equipment assigned") : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } }, allEq.map((eq, ei) => {
          const arrived = onSiteNames.has(eq.name);
          return /* @__PURE__ */ React.createElement("span", { key: ei, style: { background: arrived ? "rgba(126,203,143,0.13)" : "rgba(167,139,250,0.09)", border: arrived ? "1px solid rgba(126,203,143,0.35)" : "1px solid rgba(167,139,250,0.22)", borderRadius: "3px", padding: "1px 5px", fontFamily: "'DM Mono',monospace", fontSize: "7px", color: arrived ? "#7ecb8f" : "rgba(167,139,250,0.8)" } }, arrived ? "\u2713" : "\u23F3", " ", eq.name || eq.type);
        }))), cleanoutSent && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "7px", padding: "4px 6px", background: "rgba(126,203,143,0.12)", border: "1px solid rgba(126,203,143,0.3)", borderRadius: "5px", fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f", textAlign: "center" } }, "\u2705 Clean Out Authorized")), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: "12px", display: "flex", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "12px", borderTop: "1.5px dashed rgba(167,139,250,0.4)" } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: "5px", alignContent: "flex-start" } }, moves.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: "12px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.4)" } }, "No moves planned") : moves.map((mv, mi) => {
          const done = mv.status === "complete";
          return /* @__PURE__ */ React.createElement("div", { key: mi, style: { flex: "1 1 95px", maxWidth: "140px", boxSizing: "border-box", background: done ? "rgba(126,203,143,0.05)" : "rgba(90,180,245,0.06)", border: "1px solid " + (done ? "rgba(126,203,143,0.2)" : "rgba(90,180,245,0.16)"), borderRadius: "6px", padding: "6px 7px", opacity: done ? 0.7 : 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, color: done ? "rgba(126,203,143,0.8)" : "#5ab4f5", textDecoration: done ? "line-through" : "none", marginBottom: "2px" } }, "Move ", mi + 1), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: mv.assignedDriver ? done ? "rgba(126,203,143,0.7)" : "#7ecb8f" : "rgba(155,148,136,0.5)", textDecoration: done ? "line-through" : "none", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, mv.assignedDriver || "\u26A0 Unassigned"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } }, (mv.equipment || []).map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: ei, style: { display: "block", background: done ? "rgba(126,203,143,0.1)" : "rgba(90,180,245,0.11)", border: "1px solid " + (done ? "rgba(126,203,143,0.25)" : "rgba(90,180,245,0.2)"), borderRadius: "3px", padding: "1px 4px", fontFamily: "'DM Mono',monospace", fontSize: "7px", color: done ? "rgba(126,203,143,0.8)" : "#c0d8f0", textDecoration: done ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, EQ_ICONS[eq.type] || "\u{1F4E6}", " ", eq.name || eq.type))), mv.deadline && !done && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "4px" } }, /* @__PURE__ */ React.createElement("span", { style: { background: "#fff", border: "2px solid #c0392b", borderRadius: "3px", padding: "1px 5px", fontFamily: "'DM Mono',monospace", fontSize: "7px", fontWeight: 700, color: "#c0392b" } }, "\u26A0 ", new Date(mv.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" }))));
        })));
      })));
    })());
  })(), tab === "Dashboard" && isDriverUser && !isDesktopUser && !isLowbedDriver && !isMixTruckDriver && /* @__PURE__ */ React.createElement("div", { style: { padding: "16px", maxWidth: "680px", margin: "0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(90,180,245,0.06)", border: "1px solid rgba(90,180,245,0.2)", borderRadius: "10px", padding: "14px 18px", marginBottom: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "20px", letterSpacing: "2px", color: "#5ab4f5" } }, "\u{1F69B} DRIVER DASHBOARD"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.7)", marginTop: "2px" } }, "Logged in as ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--white)" } }, (localStorage.getItem("dmc_u") || "").toLowerCase()))), gpsDevices.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#5ab4f5", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" } }, "\u{1F4E1} Live Equipment GPS ", /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.25)", borderRadius: "10px", padding: "1px 7px", fontSize: "9px" } }, gpsDevices.length, " units")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } }, gpsDevices.slice(0, 15).map((dev) => {
    const nm = getDeviceName(dev);
    const addr = getDeviceAddress(dev);
    const st = getDeviceStatus(dev);
    const isMoving = st && st.label && st.label.startsWith("Moving");
    return /* @__PURE__ */ React.createElement("div", { key: dev.device_id, style: { background: "rgba(90,180,245,0.04)", border: "1px solid rgba(90,180,245,0.14)", borderRadius: "6px", padding: "7px 12px", display: "flex", alignItems: "center", gap: "10px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "#5ab4f5", minWidth: "130px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, nm), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, addr || "Location unknown"), /* @__PURE__ */ React.createElement("span", { style: {
      fontFamily: "'DM Mono',monospace",
      fontSize: "8px",
      padding: "2px 8px",
      borderRadius: "10px",
      whiteSpace: "nowrap",
      flexShrink: 0,
      background: isMoving ? "rgba(90,180,245,0.15)" : "rgba(126,203,143,0.12)",
      color: isMoving ? "#5ab4f5" : "#7ecb8f",
      border: "1px solid " + (isMoving ? "rgba(90,180,245,0.3)" : "rgba(126,203,143,0.3)")
    } }, st && st.label ? (isMoving ? "\u25CF " : "\u25CE ") + st.label : "\u2014 Unknown"));
  }))), gpsDevices.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.5)", marginBottom: "16px" } }, gpsLoading ? "\u{1F4E1} Loading live GPS\u2026" : "\u{1F4E1} GPS unavailable")), tab === "Master Schedule" && (() => {
    const _defaultBT2 = [
      { id: "day", color: "#0d4f7c", fontColor: "#000000" },
      { id: "night", color: "#1a0a4a", fontColor: "#c8b8ff" },
      { id: "pending", color: "#5c4000", fontColor: "#f5c518" },
      { id: "blank", color: "#1e1e1e", fontColor: "rgba(155,148,136,0.3)" }
    ];
    const _bt2 = (() => {
      try {
        return JSON.parse(localStorage.getItem("pavescope_blocktypes") || "null") || _defaultBT2;
      } catch (e) {
        return _defaultBT2;
      }
    })();
    const _btC2 = (type) => {
      const b = _bt2.find((x) => x.id === type);
      return b ? { bg: b.color, font: b.fontColor } : { bg: "#1e1e1e", font: "rgba(155,148,136,0.3)" };
    };
    const now = /* @__PURE__ */ new Date();
    const baseYear = now.getFullYear();
    const baseMonth = now.getMonth();
    const dispDate = new Date(baseYear, baseMonth + schedMonthOffset, 1);
    const dYear = dispDate.getFullYear();
    const dMonth = dispDate.getMonth();
    const monthLabel = dispDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const firstDow = dispDate.getDay();
    const daysInMonth = new Date(dYear, dMonth + 1, 0).getDate();
    const today2 = /* @__PURE__ */ new Date();
    today2.setHours(0, 0, 0, 0);
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(dYear, dMonth, d));
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return /* @__PURE__ */ React.createElement("div", { style: { background: "var(--asphalt)", minHeight: "calc(100vh - 120px)", padding: "14px" } }, /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(90,180,245,0.10)", border: "1px solid rgba(90,180,245,0.25)", borderRadius: "8px", padding: "6px 14px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "#5ab4f5", letterSpacing: "0.5px" } }, "\u{1F441} VIEW ONLY"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.6)" } }, "Schedule editing is managed by office staff")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setSchedMonthOffset((o) => o - 1),
        style: { background: "rgba(255,255,255,0.05)", border: "1px solid var(--asphalt-light)", borderRadius: "6px", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "12px", padding: "5px 14px", cursor: "pointer" }
      },
      "\u2190"
    ), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "20px", letterSpacing: "3px", color: "var(--white)" } }, monthLabel.toUpperCase()), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setSchedMonthOffset((o) => o + 1),
        style: { background: "rgba(255,255,255,0.05)", border: "1px solid var(--asphalt-light)", borderRadius: "6px", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "12px", padding: "5px 14px", cursor: "pointer" }
      },
      "\u2192"
    )), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--asphalt-light)", borderRadius: "10px", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", background: "var(--asphalt-mid)", borderBottom: "1px solid var(--asphalt-light)" } }, DAY_ABBR.map((d) => /* @__PURE__ */ React.createElement("div", { key: d, style: { padding: "6px 4px", textAlign: "center", fontFamily: "'Bebas Neue',sans-serif", fontSize: "11px", letterSpacing: "2px", color: "var(--concrete-dim)" } }, d))), weeks.map((week, wi) => /* @__PURE__ */ React.createElement("div", { key: wi, style: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: wi < weeks.length - 1 ? "1px solid var(--asphalt-light)" : "none" } }, week.map((date, di) => {
      if (!date) return /* @__PURE__ */ React.createElement("div", { key: di, style: { background: "rgba(0,0,0,0.15)", borderRight: di < 6 ? "1px solid var(--asphalt-light)" : "none" } });
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isToday3 = date.getTime() === today2.getTime();
      const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
      const sd = schedData[key] || {};
      const topB = sd.top || { type: isWeekend ? "blank" : "blank", fields: {} };
      const botB = sd.bot || { type: "blank", fields: {} };
      const extras = (sd.extras || []).map((e) => e.data).filter(Boolean);
      const allBlocks = [topB, botB, ...extras].filter((b) => b.type !== "blank" || b.fields && (b.fields.jobName || b.fields.jobNum));
      const topC = _btC2(topB.type);
      const botC = _btC2(botB.type);
      return /* @__PURE__ */ React.createElement("div", { key: di, style: { borderRight: di < 6 ? "1px solid var(--asphalt-light)" : "none", background: isToday3 ? "rgba(245,197,24,0.05)" : isWeekend ? "rgba(0,0,0,0.1)" : "transparent", minHeight: "90px", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: isToday3 ? "var(--stripe)" : isWeekend ? "rgba(155,148,136,0.4)" : "var(--concrete-dim)", background: isToday3 ? "rgba(245,197,24,0.15)" : "transparent", borderRadius: "3px", padding: isToday3 ? "0 4px" : "0" } }, date.getDate())), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "3px 4px", display: "flex", flexDirection: "column", gap: "2px" } }, topB.type !== "blank" && /* @__PURE__ */ React.createElement("div", { style: { background: topC.bg, borderRadius: "3px", padding: "2px 5px", border: "1px solid rgba(255,255,255,0.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, color: topC.font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, topB.fields?.jobName || topB.fields?.jobNum || "\u2014"), topB.fields?.location && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: topC.font === "#000000" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "\u{1F4CD}", topB.fields.location)), botB.type !== "blank" && /* @__PURE__ */ React.createElement("div", { style: { background: botC.bg, borderRadius: "3px", padding: "2px 5px", border: "1px solid rgba(255,255,255,0.08)", opacity: 0.9 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, color: botC.font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, botB.fields?.jobName || botB.fields?.jobNum || "\u2014"), botB.fields?.location && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: botC.font === "#000000" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "\u{1F4CD}", botB.fields.location)), extras.map((ex, ei) => {
        const ec = _btC2(ex.type);
        return ex.type !== "blank" ? /* @__PURE__ */ React.createElement("div", { key: ei, style: { background: ec.bg, borderRadius: "3px", padding: "2px 5px", border: "1px solid rgba(255,255,255,0.08)", opacity: 0.85 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, color: ec.font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, ex.fields?.jobName || ex.fields?.jobNum || "\u2014")) : null;
      })));
    })))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "12px", marginTop: "10px", flexWrap: "wrap" } }, _bt2.filter((b) => b.id !== "blank").map((b) => /* @__PURE__ */ React.createElement("div", { key: b.id, style: { display: "flex", alignItems: "center", gap: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "10px", height: "10px", borderRadius: "2px", background: b.color, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", textTransform: "capitalize" } }, b.id === "day" ? "Day Work" : b.id === "night" ? "Night Work" : "Pending")))));
  })(), tab === "Equipment" && /* @__PURE__ */ React.createElement(
    FleetTab,
    {
      gpsDevices,
      getDeviceName,
      getDeviceAddress,
      getDeviceStatus
    }
  ), tab === "Dashboard" && (isDesktopUser || !isDriverUser && !isMixTruckDriver) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", minHeight: "calc(100vh - 120px)", background: "var(--asphalt)" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: isAdminUser || isNightmare57 || hdMobile ? "1 1 100%" : isATow ? "0 0 50%" : isDesktopUser ? "1 1 65%" : "1 1 54%", minWidth: "300px", borderRight: "1px solid var(--asphalt-light)", overflowY: "auto", order: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "var(--asphalt-mid)", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "15px", letterSpacing: "2px", color: "var(--stripe)" } }, "\u{1F4E1} Equipment Locations"), gpsDevices.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.3)", borderRadius: "10px", padding: "2px 8px" } }, "\u25CF ", gpsDevices.length, " live")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setGpsLoading(true);
        fetchGPSDevices().then((d) => {
          const list = d.result_list || [];
          setGpsDevices(list);
          setGpsConnected(true);
          setGpsHibernated(list.length === 0);
          setLastRefresh(/* @__PURE__ */ new Date());
          matchDevicesToJobs(list);
        }).catch(() => {
        }).finally(() => setGpsLoading(false));
      },
      style: { background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.3)", borderRadius: "var(--radius)", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "9px", padding: "4px 8px", cursor: "pointer" }
    },
    gpsLoading ? "\u23F3" : "\u21BA Refresh"
  ), isAdminUser && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowNameEditor(true),
      style: { background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.35)", borderRadius: "var(--radius)", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, padding: "4px 10px", cursor: "pointer" }
    },
    "\u270F\uFE0F Name Equipment"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (isAdminUser) {
          setManualMoveMode(null);
          setShowManualMove("pick");
        } else {
          setManualMoveMode("single");
          setShowManualMove(true);
        }
      },
      style: { background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.35)", borderRadius: "var(--radius)", color: "#7ecb8f", fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, padding: "4px 10px", cursor: "pointer" }
    },
    "\u{1F69B} Manual Move"
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: hdMobile ? "column" : "row", alignItems: "stretch" } }, /* @__PURE__ */ React.createElement("div", { style: hdMobile ? { width: "100%", minWidth: 0 } : { flex: "0 0 50%", width: "50%", minWidth: 0 } }, gpsLoading && /* @__PURE__ */ React.createElement("div", { style: { height: "400px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "var(--concrete-dim)" } }, "\u{1F4E1} Fetching live GPS positions\u2026"), !gpsLoading && gpsDevices.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { height: "400px", padding: "28px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: "36px", marginBottom: "10px" } }, "\u2744\uFE0F"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "22px", letterSpacing: "3px", color: "var(--concrete-dim)", marginBottom: "6px" } }, "Fleet Hibernated"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.7)", maxWidth: "260px", lineHeight: "1.6" } }, "OneStepGPS returned no active devices. Equipment may be powered down or off-season."), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "14px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", padding: "3px 10px", borderRadius: "10px", background: "rgba(155,148,136,0.08)", border: "1px solid rgba(155,148,136,0.2)", color: "var(--concrete-dim)" } }, "\u25CF 0 devices active"))), !gpsLoading && gpsDevices.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 10px 0" } }, /* @__PURE__ */ React.createElement(
    EquipmentMap,
    {
      devices: gpsDevices,
      getDeviceName,
      getDeviceEquipNum,
      getDeviceStatus,
      getDeviceAddress,
      getDeviceUpdated,
      jobSites: (() => {
        if (!lowbedPlan || !lowbedPlan.jobs) return [];
        return lowbedPlan.jobs.filter((job) => {
          return (job.moves || []).some((mv) => mv.status === "complete");
        }).map((job) => {
          const onSiteNames = /* @__PURE__ */ new Set();
          (job.moves || []).forEach((mv) => {
            if (mv.status === "complete") (mv.equipment || []).forEach((eq) => eq.name && onSiteNames.add(eq.name));
          });
          const onSiteEquipment = (job.allEquipment || []).filter((eq) => onSiteNames.has(eq.name));
          return { jobName: job.jobName, jobNum: job.jobNum, location: job.location || "", onSiteEquipment };
        });
      })()
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: hdMobile ? { width: "100%", minWidth: 0, borderTop: "1px solid var(--asphalt-light)", overflowY: "auto", padding: "12px", boxSizing: "border-box" } : { flex: "0 0 50%", width: "50%", minWidth: 0, borderLeft: "1px solid var(--asphalt-light)", overflowY: "auto", padding: "12px", boxSizing: "border-box" } }, isAdminUser && /* @__PURE__ */ React.createElement(FleetWidget, { defaultOpen: true, onFleetChange: (active) => setFleetItems(active) }), isAdminUser && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--asphalt-light)", marginTop: "10px", paddingTop: "10px" } }), /* @__PURE__ */ React.createElement(React.Fragment, null, (() => {
    const manualMoves = lowbedGroups.filter((g) => g.manual === true && !g.deviceId).map((g) => ({ ...g, status: g.status || "pending" }));
    const total = manualMoves.length;
    const completed = manualMoves.filter((g) => g.status === "complete").length;
    const inProgress = manualMoves.filter((g) => g.status === "in_progress").length;
    const pending = manualMoves.filter((g) => g.status === "pending").length;
    const _curRoleCS = (() => {
      try {
        const u = (localStorage.getItem("dmc_u") || "").toLowerCase();
        return (JSON.parse(localStorage.getItem("pavescope_accounts") || "[]").find((a) => (a.username || "").toLowerCase() === u || (a.email || "").toLowerCase() === u) || {}).role || "";
      } catch (e) {
        return "";
      }
    })();
    const canChangeStatus = isLowbedDriver || _curRoleCS === "rental_lowbed_driver";
    const _DNAMES = { "nightmare57": "Eric Sylvia", "ericsylvia57@gmail.com": "Eric Sylvia", "blydon": "Bill Lydon", "billydon@donmartincorp.com": "Bill Lydon", "igiron": "Ingrid Giron", "igiron@donmartincorp.com": "Ingrid Giron" };
    const _myUN = (localStorage.getItem("dmc_u") || "").toLowerCase();
    const _myFullName = _DNAMES[_myUN] || _myUN;
    const resolveLoc = (val) => {
      if (!val) return "\u2014";
      if (val === "__garage__") return "Garage";
      const job = jobList.find((j) => String(j.id) === String(val) || String(j.num) === String(val));
      if (job) return (job.num || job.id) + (job.name ? " \u2014 " + job.name : "");
      if (/^\d{10,}$/.test(String(val))) return "Job " + String(val);
      return val;
    };
    const statusInfo = (s) => {
      if (s === "complete") return { label: "Complete", color: "#7ecb8f", bg: "rgba(126,203,143,0.12)", border: "rgba(126,203,143,0.3)" };
      if (s === "in_progress") return { label: "In Progress", color: "#5ab4f5", bg: "rgba(90,180,245,0.12)", border: "rgba(90,180,245,0.3)" };
      if (s === "cancelled") return { label: "Cancelled", color: "#d94f3d", bg: "rgba(217,79,61,0.12)", border: "rgba(217,79,61,0.3)" };
      return { label: "Pending", color: "#f5c518", bg: "rgba(245,197,24,0.12)", border: "rgba(245,197,24,0.3)" };
    };
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "#a78bfa", flexShrink: 0 } }, "\u{1F69A} LOWBED MOVES"), isAdminUser && completed > 0 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          if (!window.confirm("Clear all " + completed + " completed move" + (completed !== 1 ? "s" : "") + "? This cannot be undone.")) return;
          saveLowbedGroups(lowbedGroups.filter((g) => !(g.manual === true && !g.deviceId && (g.status || "pending") === "complete")));
        },
        style: { marginLeft: "auto", background: "rgba(217,79,61,0.08)", border: "1px solid rgba(217,79,61,0.3)", borderRadius: "4px", color: "rgba(217,79,61,0.7)", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 8px", cursor: "pointer" }
      },
      "\u{1F5D1} Clear Completed"
    )), total > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "10px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 7px", borderRadius: "8px", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "rgba(167,139,250,0.8)" } }, "Total: ", total), completed > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 7px", borderRadius: "8px", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.3)", color: "#7ecb8f" } }, "\u2713 ", completed, " Done"), inProgress > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 7px", borderRadius: "8px", background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.3)", color: "#5ab4f5" } }, "\u26A1 ", inProgress, " Active"), pending > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 7px", borderRadius: "8px", background: "rgba(245,197,24,0.1)", border: "1px solid rgba(245,197,24,0.3)", color: "#f5c518" } }, "\u23F3 ", pending, " Pending"), isAdminUser && (() => {
      const rentalMoves = manualMoves.filter((m) => m.isRental);
      const rentalEst = rentalMoves.reduce((s, m) => s + (m.estimatedCost || 0), 0);
      const rentalActual = rentalMoves.filter((m) => m.actualCost != null).reduce((s, m) => s + (m.actualCost || 0), 0);
      const hasActual = rentalMoves.some((m) => m.actualCost != null);
      const fmt = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return /* @__PURE__ */ React.createElement(React.Fragment, null, rentalEst > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 7px", borderRadius: "8px", background: "#2a2000", border: "1px solid #c9a800", color: "#f0d060", fontWeight: 700 } }, "\u{1F4B0} Rental Est: ", fmt(rentalEst)), hasActual && rentalActual > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 7px", borderRadius: "8px", background: "#2a2000", border: "1px solid #c9a800", color: "#f0d060", fontWeight: 700 } }, "\u{1F4B0} Rental Actual: ", fmt(rentalActual)));
    })()), total === 0 ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "28px", opacity: 0.35 } }, "\u{1F69B}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.5)", textAlign: "center" } }, "No active lowbed moves")) : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: hdMobile ? "1fr" : "repeat(2,1fr)", gap: "12px", padding: "4px 0 12px" } }, (() => {
      const groupedItems = [];
      const seenJobGroups = /* @__PURE__ */ new Set();
      manualMoves.forEach((move) => {
        const jgid = move.jobGroupId && move.jobGroupId.startsWith("job_") ? move.jobGroupId : move.to && move.to !== "__garage__" && move.manual ? "job_" + move.to : null;
        if (jgid) {
          if (!seenJobGroups.has(jgid)) {
            seenJobGroups.add(jgid);
            groupedItems.push({ type: "job_group", jobGroupId: jgid, moves: manualMoves.filter((m) => {
              const mjgid = m.jobGroupId && m.jobGroupId.startsWith("job_") ? m.jobGroupId : m.to && m.to !== "__garage__" && m.manual ? "job_" + m.to : null;
              return mjgid === jgid;
            }) });
          }
        } else {
          groupedItems.push({ type: "single", move });
        }
      });
      const moveSt = (grp) => {
        const s = grp.status || "pending";
        if (s === "complete") return { bg: "#0d1a0d", bdr: "1px solid #2a5a2a", tc: "#4a7a4a", op: 0.7, strike: true, badge: "\u2713 Complete", bBg: "rgba(42,90,42,0.3)", bBorder: "#2a5a2a", bColor: "#4a7a4a" };
        if (s === "in_progress") return { bg: "#3a2e00", bdr: "1px solid #c9a800", tc: "#f0d060", op: 1, strike: false, badge: "\u26A1 In Progress", bBg: "rgba(201,168,0,0.15)", bBorder: "#c9a800", bColor: "#f0d060" };
        if (s === "cancelled") return { bg: "rgba(50,10,10,0.7)", bdr: "1px solid rgba(217,79,61,0.3)", tc: "rgba(217,79,61,0.6)", op: 0.6, strike: false, badge: "\u2715 Cancelled", bBg: "rgba(217,79,61,0.1)", bBorder: "rgba(217,79,61,0.3)", bColor: "rgba(217,79,61,0.7)" };
        if (s === "cleared") return { bg: "#0d0d0d", bdr: "1px solid rgba(155,111,214,0.25)", tc: "rgba(155,111,214,0.5)", op: 0.5, strike: true, badge: "\u{1F9F9} Cleared", bBg: "rgba(155,111,214,0.08)", bBorder: "rgba(155,111,214,0.3)", bColor: "rgba(155,111,214,0.6)" };
        return { bg: "#1a2a3e", bdr: "1px solid #4a6fa6", tc: "#7ab3f0", op: 1, strike: false, badge: "\u23F3 Pending", bBg: "rgba(74,111,166,0.15)", bBorder: "#4a6fa6", bColor: "#7ab3f0" };
      };
      const renderMoveContent = (grp, moveNum, totalMoves) => {
        const ms = moveSt(grp);
        const fl = resolveLoc(grp.from);
        const tl = resolveLoc(grp.to);
        const upd = (patch) => saveLowbedGroups(lowbedGroups.map((g) => g.id === grp.id ? { ...g, ...patch } : g));
        const del = () => {
          if (!window.confirm("Delete this move? This cannot be undone.")) return;
          saveLowbedGroups(lowbedGroups.filter((g) => g.id !== grp.id));
        };
        return /* @__PURE__ */ React.createElement(React.Fragment, null, totalMoves > 1 && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", marginBottom: "4px", letterSpacing: "1px" } }, "MOVE ", moveNum, " OF ", totalMoves), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: "5px", marginBottom: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: ms.tc, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, fl, " \u2192 ", tl), grp.date && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", marginTop: "1px" } }, grp.date)), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, display: "flex", gap: "4px", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", padding: "1px 5px", borderRadius: "8px", background: ms.bBg, border: "1px solid " + ms.bBorder, color: ms.bColor, whiteSpace: "nowrap" } }, ms.badge), isAdminUser && /* @__PURE__ */ React.createElement("button", { onClick: del, style: { background: "none", border: "none", color: "rgba(217,79,61,0.5)", fontSize: "11px", cursor: "pointer", padding: "0", lineHeight: 1 } }, "\u{1F5D1}"))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", marginBottom: "2px", letterSpacing: "1px" } }, "DRIVER"), isAdminUser ? /* @__PURE__ */ React.createElement("select", { value: grp.driverName || "", onChange: (e) => {
          const n = e.target.value;
          const rd = /atow|andy/i.test(n);
          upd({ driverName: n, ...rd && !grp.isRental ? { isRental: true, rentalService: grp.rentalService || null, rentalHours: grp.rentalHours || 2, rentalMileage: grp.rentalMileage || 0, estimatedCost: grp.estimatedCost || 0, actualHours: grp.actualHours || null, actualCost: grp.actualCost || null } : {} });
        }, style: { width: "100%", background: "rgba(10,10,25,0.8)", border: "1px solid rgba(90,180,245,0.2)", borderRadius: "3px", color: grp.driverName ? "#7ecb8f" : "rgba(245,197,24,0.8)", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "3px 5px", cursor: "pointer", outline: "none" } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u26A0 Unassigned"), CORE_LOWBED_DRIVERS.map((d) => /* @__PURE__ */ React.createElement("option", { key: d.value, value: d.value }, d.label))) : canChangeStatus ? (() => {
          const unc = !grp.driverName || grp.driverName.toLowerCase() === "various";
          const mine = grp.driverName && grp.driverName.toLowerCase() === _myFullName.toLowerCase();
          return unc ? /* @__PURE__ */ React.createElement("button", { onClick: () => upd({ driverName: _myFullName }), style: { background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.3)", borderRadius: "3px", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 8px", cursor: "pointer", fontWeight: 700 } }, "\u270B Claim") : mine ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "4px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f" } }, grp.driverName), /* @__PURE__ */ React.createElement("button", { onClick: () => upd({ driverName: "" }), style: { background: "none", border: "1px solid rgba(217,79,61,0.25)", borderRadius: "3px", color: "rgba(217,79,61,0.65)", fontFamily: "'DM Mono',monospace", fontSize: "7px", padding: "0 4px", cursor: "pointer" } }, "Unclaim")) : /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f" } }, grp.driverName);
        })() : /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: grp.driverName ? ms.tc : "rgba(245,197,24,0.7)" } }, grp.driverName || "\u26A0 Unassigned")), (grp.items || []).length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", marginBottom: "3px", letterSpacing: "1px" } }, "EQUIPMENT (", (grp.items || []).length, ")"), (grp.items || []).map((it) => /* @__PURE__ */ React.createElement("div", { key: it.id, style: { display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "9px", flexShrink: 0 } }, EQ_ICONS[it.type] || "\u{1F4E6}"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: it.delivered ? "rgba(126,203,143,0.6)" : ms.tc, textDecoration: it.delivered || ms.strike ? "line-through" : "none", flex: 1, opacity: it.delivered ? 0.6 : 1 } }, it.name || it.type), (isAdminUser || isForeman) && /* @__PURE__ */ React.createElement("button", { onClick: () => {
          const ni = (grp.items || []).map((i) => i.id === it.id ? { ...i, delivered: !i.delivered } : i);
          upd({ items: ni });
        }, style: { flexShrink: 0, background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "2px", color: it.delivered ? "#7ecb8f" : "rgba(155,148,136,0.35)", fontFamily: "'DM Mono',monospace", fontSize: "6px", padding: "0 3px", cursor: "pointer" } }, it.delivered ? "\u2713" : "+")))), canChangeStatus ? /* @__PURE__ */ React.createElement("select", { value: grp.status || "pending", onChange: (e) => upd({ status: e.target.value }), style: { width: "100%", background: "rgba(10,10,25,0.8)", border: "1px solid " + ms.bBorder, borderRadius: "3px", color: ms.bColor, fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "3px 5px", cursor: "pointer", outline: "none", marginTop: "3px" } }, /* @__PURE__ */ React.createElement("option", { value: "pending" }, "Pending"), /* @__PURE__ */ React.createElement("option", { value: "in_progress" }, "In Progress"), /* @__PURE__ */ React.createElement("option", { value: "complete" }, "Complete")) : isAdminUser && grp.status !== "cancelled" ? /* @__PURE__ */ React.createElement("button", { onClick: () => upd({ status: "cancelled" }), style: { background: "rgba(217,79,61,0.07)", border: "1px solid rgba(217,79,61,0.25)", borderRadius: "3px", color: "rgba(217,79,61,0.65)", fontFamily: "'DM Mono',monospace", fontSize: "7px", padding: "2px 8px", cursor: "pointer", marginTop: "3px" } }, "Cancel Move") : null, (grp.notes || grp.deadline) && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "5px", paddingTop: "5px", borderTop: "1px solid rgba(255,255,255,0.05)" } }, grp.notes && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", fontStyle: "italic" } }, "\u{1F4DD} ", grp.notes), grp.deadline && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "#c0392b", fontWeight: 700 } }, "\u26A0 Due ", new Date(grp.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))), isAdminUser && grp.isRental && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(201,168,0,0.25)", display: "flex", flexDirection: "column", gap: "6px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "#f0d060", fontWeight: 700, letterSpacing: "1px" } }, "\u{1F4B0} RENTAL COST \u2014 ANDY'S TOWING"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", marginBottom: "2px" } }, "SERVICE"), /* @__PURE__ */ React.createElement("select", { value: grp.rentalService || "", onChange: (e) => {
          const k = e.target.value;
          const c = calcRentalCost(k, grp.rentalHours || 2, grp.rentalMileage || 0);
          upd({ rentalService: k, estimatedCost: c });
        }, style: { width: "100%", background: "rgba(42,32,0,0.9)", border: "1px solid rgba(201,168,0,0.3)", borderRadius: "3px", color: grp.rentalService ? "#f0d060" : "rgba(155,148,136,0.5)", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "3px 5px", cursor: "pointer", outline: "none" } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 Select service \u2014"), Object.entries(ATOW_RATES).map(([k, v]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, v.label, " \u2014 $", v.unit === "flat" ? v.rate + " flat" : v.rate + "/hr" + (v.minHours > 0 ? " (" + v.minHours + "h min)" : ""))))), grp.rentalService && ATOW_RATES[grp.rentalService] && ATOW_RATES[grp.rentalService].unit === "hr" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", marginBottom: "2px" } }, "EST. HOURS (min ", ATOW_RATES[grp.rentalService].minHours, "h)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: ATOW_RATES[grp.rentalService].minHours, step: "0.5", value: grp.rentalHours || 2, onChange: (e) => {
          const h = parseFloat(e.target.value) || 2;
          upd({ rentalHours: h, estimatedCost: calcRentalCost(grp.rentalService, h, grp.rentalMileage || 0) });
        }, style: { width: "80px", background: "rgba(42,32,0,0.9)", border: "1px solid rgba(201,168,0,0.3)", borderRadius: "3px", color: "#f0d060", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "3px 6px", outline: "none" } })), grp.rentalService === "light_duty_ramp" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", marginBottom: "2px" } }, "MILEAGE"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", value: grp.rentalMileage || 0, onChange: (e) => {
          const mi = parseFloat(e.target.value) || 0;
          upd({ rentalMileage: mi, estimatedCost: calcRentalCost(grp.rentalService, grp.rentalHours || 2, mi) });
        }, style: { width: "80px", background: "rgba(42,32,0,0.9)", border: "1px solid rgba(201,168,0,0.3)", borderRadius: "3px", color: "#f0d060", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "3px 6px", outline: "none" } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)" } }, "ESTIMATED"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "#f0d060", fontWeight: 700 } }, "$", (grp.estimatedCost || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", marginBottom: "2px" } }, "ACTUAL HOURS (post-completion)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", step: "0.5", value: grp.actualHours != null ? grp.actualHours : "", placeholder: "\u2014", onChange: (e) => {
          const ah = e.target.value === "" ? null : parseFloat(e.target.value) || 0;
          const ac = ah != null && grp.rentalService ? calcRentalCost(grp.rentalService, ah, grp.rentalMileage || 0) : null;
          upd({ actualHours: ah, actualCost: ac });
        }, style: { width: "80px", background: "rgba(42,32,0,0.9)", border: "1px solid rgba(201,168,0,0.3)", borderRadius: "3px", color: "#f0d060", fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "3px 6px", outline: "none" } }), grp.actualCost != null && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "#f0d060", fontWeight: 700 } }, "Actual: $", grp.actualCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })))), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "6px", color: "rgba(155,148,136,0.3)", lineHeight: "1.6" } }, "* Rates billed portal to portal\xA0\xA0* 2-hr minimum. Pilot car 4-hr min.")));
      };
      return groupedItems.map((item) => {
        if (item.type === "job_group") {
          const { jobGroupId, moves: jMoves } = item;
          const destId = jMoves[0].to;
          const toLabel = resolveLoc(destId);
          const jDate = jMoves.map((m) => m.date).filter(Boolean).sort()[0];
          const totalEq = jMoves.reduce((s, m) => s + (m.items || []).length, 0);
          const jPend = jMoves.filter((m) => (m.status || "pending") === "pending").length;
          const jInP = jMoves.filter((m) => m.status === "in_progress").length;
          const jDone = jMoves.filter((m) => m.status === "complete").length;
          const allPieces = jMoves.flatMap((m) => m.items || []);
          const arrivedPieces = jMoves.filter((m) => m.status === "complete").flatMap((m) => m.items || []);
          const pendingPcs = allPieces.filter((p) => !arrivedPieces.find((a) => a.id === p.id));
          const EQ_TYPES = [
            { key: "paver", icon: "\u{1F69C}", s: "Paver", p: "Pavers" },
            { key: "roller", icon: "\u{1F504}", s: "Roller", p: "Rollers" },
            { key: "skid_steer", icon: "\u{1F527}", s: "Skid Steer", p: "Skid Steers" },
            { key: "excavator", icon: "\u26CF", s: "Excavator", p: "Excavators" },
            { key: "milling", icon: "\u{1F3D7}", s: "Milling Machine", p: "Machines" },
            { key: "mecalac", icon: "\u{1F9BE}", s: "Mecalac", p: "Mecalacs" },
            { key: "compactor", icon: "\u{1F528}", s: "Compactor", p: "Compactors" },
            { key: "loader", icon: "\u{1FAA3}", s: "Loader", p: "Loaders" },
            { key: "other", icon: "\u{1F4E6}", s: "Other", p: "Other" }
          ];
          const isExpGroup = expandedMoves.has(jobGroupId);
          const toggleGrp = () => setExpandedMoves((prev) => {
            const n = new Set(prev);
            if (n.has(jobGroupId)) n.delete(jobGroupId);
            else n.add(jobGroupId);
            return n;
          });
          const isCleared = jMoves.every((m) => m.status === "cleared");
          return /* @__PURE__ */ React.createElement("div", { key: jobGroupId, style: { background: "#2a1a3e", border: "1px solid #7b4fa6", borderLeft: "3px solid #9b6fd6", borderRadius: "8px", overflow: "hidden", boxSizing: "border-box", opacity: isCleared ? 0.5 : 1 } }, /* @__PURE__ */ React.createElement("div", { onClick: toggleGrp, style: { padding: "12px", cursor: "pointer", userSelect: "none" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#d8c8ff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, toLabel)), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, display: "flex", alignItems: "center", gap: "5px" } }, isCleared && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", padding: "1px 5px", borderRadius: "3px", background: "rgba(155,111,214,0.12)", border: "1px solid rgba(155,111,214,0.3)", color: "rgba(155,111,214,0.8)" } }, "\u{1F9F9} Cleared"), isAdminUser && /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
            e.stopPropagation();
            if (!window.confirm("Delete all " + jMoves.length + " move" + (jMoves.length !== 1 ? "s" : "") + ' for "' + toLabel + '"? This cannot be undone.')) return;
            saveLowbedGroups(lowbedGroups.filter((g) => g.jobGroupId !== jobGroupId));
          }, style: { background: "none", border: "none", color: "rgba(217,79,61,0.5)", fontSize: "12px", cursor: "pointer", padding: "0", lineHeight: 1 } }, "\u{1F5D1}"), /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.4)", fontSize: "9px", display: "inline-block", transform: isExpGroup ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" } }, "\u25BC"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap", alignItems: "center", marginBottom: "5px" } }, jDate && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)" } }, jDate), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(167,139,250,0.6)" } }, jMoves.length, " load", jMoves.length !== 1 ? "s" : "", " \xB7 ", totalEq, " pcs")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } }, jPend > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "6px", padding: "1px 4px", borderRadius: "3px", background: "rgba(74,111,166,0.15)", border: "1px solid #4a6fa6", color: "#7ab3f0" } }, "\u23F3 ", jPend, " pending"), jInP > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "6px", padding: "1px 4px", borderRadius: "3px", background: "rgba(201,168,0,0.12)", border: "1px solid #c9a800", color: "#f0d060" } }, "\u26A1 ", jInP, " active"), jDone > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "6px", padding: "1px 4px", borderRadius: "3px", background: "rgba(42,90,42,0.2)", border: "1px solid #2a5a2a", color: "#4a7a4a" } }, "\u2713 ", jDone, " done")), allPieces.length > 0 && (() => {
            const _visMoves = jMoves.filter((m) => m.status !== "cancelled");
            const _visPieces = _visMoves.flatMap((m) => m.items || []);
            const _onSitePcs = jMoves.filter((m) => m.status === "complete").flatMap((m) => m.items || []);
            return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "5px" } }, EQ_TYPES.map((et) => {
              const tp = _visPieces.filter((p) => p.type === et.key);
              if (!tp.length) return null;
              const ta = _onSitePcs.filter((p) => p.type === et.key).length;
              const color = ta === tp.length ? "#4a7a4a" : ta > 0 ? "#c9a800" : "#4a6fa6";
              const bg = ta === tp.length ? "rgba(74,122,74,0.15)" : ta > 0 ? "rgba(201,168,0,0.12)" : "rgba(74,111,166,0.12)";
              const border = ta === tp.length ? "#2a5a2a" : ta > 0 ? "#7a6000" : "#3a5a8a";
              return /* @__PURE__ */ React.createElement("span", { key: et.key, style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 5px", borderRadius: "3px", background: bg, border: "1px solid " + border, color, whiteSpace: "nowrap" } }, et.icon, " ", et.s, " x", tp.length);
            }), _visPieces.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", padding: "2px 6px", borderRadius: "3px", background: _onSitePcs.length === _visPieces.length ? "rgba(74,122,74,0.2)" : "rgba(74,111,166,0.12)", border: "1px solid " + (_onSitePcs.length === _visPieces.length ? "#2a5a2a" : "#3a5a8a"), color: _onSitePcs.length === _visPieces.length ? "#7ecb8f" : "#7ab3f0", fontWeight: 700 } }, _onSitePcs.length, " / ", _visPieces.length, " On Site"));
          })(), isAdminUser && jMoves.some((m) => m.isRental) && (() => {
            const gEst = jMoves.reduce((s, m) => s + (m.estimatedCost || 0), 0);
            const gActual = jMoves.filter((m) => m.actualCost != null).reduce((s, m) => s + (m.actualCost || 0), 0);
            const hasActual = jMoves.some((m) => m.actualCost != null);
            const fmt = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" } }, gEst > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", padding: "2px 8px", borderRadius: "4px", background: "#2a2000", border: "1px solid #c9a800", color: "#f0d060", fontWeight: 700 } }, "\u{1F4B0} Est: ", fmt(gEst)), hasActual && gActual > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", padding: "2px 8px", borderRadius: "4px", background: "#2a2000", border: "1px solid #c9a800", color: "#f0d060", fontWeight: 700 } }, "\u{1F4B0} Actual: ", fmt(gActual)));
          })()), isExpGroup && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(123,79,166,0.35)" } }, allPieces.length > 0 && (() => {
            const _visMvs = jMoves.filter((m) => m.status !== "cancelled");
            const _visPcs = _visMvs.flatMap((m) => m.items || []);
            const _donePcs = jMoves.filter((m) => m.status === "complete").flatMap((m) => m.items || []);
            return /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px 8px", borderBottom: "1px solid rgba(123,79,166,0.2)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", letterSpacing: "2px", marginBottom: "8px" } }, "EQUIPMENT TRACKER"), EQ_TYPES.map((et) => {
              const tp = _visPcs.filter((p) => p.type === et.key);
              if (!tp.length) return null;
              const ta = _donePcs.filter((p) => p.type === et.key).length;
              const pct = tp.length ? ta / tp.length : 0;
              const barC = pct === 1 ? "#7ecb8f" : pct > 0 ? "#c9a800" : "#4a6fa6";
              return /* @__PURE__ */ React.createElement("div", { key: et.key, style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", width: "72px", flexShrink: 0, letterSpacing: "0.3px" } }, et.p.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { width: "80px", height: "4px", borderRadius: "2px", background: "#2a2a2a", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", borderRadius: "2px", background: barC, width: pct * 100 + "%", transition: "width 0.3s" } })), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", whiteSpace: "nowrap" } }, ta, " of ", tp.length, " on site"));
            }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "7px" } }, _visMvs.flatMap((m, mi) => (m.items || []).map((it, ii) => {
              const st = m.status || "pending";
              const dotC = st === "complete" ? "#7ecb8f" : st === "in_progress" ? "#c9a800" : st === "cleared" ? "#444" : "#666";
              const stLbl = st === "complete" ? "On Site \u2713" : st === "in_progress" ? "In Transit" : st === "cleared" ? "Cleared" : "Pending";
              return /* @__PURE__ */ React.createElement("div", { key: (it.id || it.name) + "-" + mi + "-" + ii, style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px", opacity: st === "cleared" ? 0.45 : 1 } }, /* @__PURE__ */ React.createElement("span", { style: { color: dotC, fontSize: "7px", flexShrink: 0 } }, "\u25CF"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0b8b0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.name || it.type), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: dotC, background: dotC + "18", border: "1px solid " + dotC + "44", borderRadius: "3px", padding: "0 4px", whiteSpace: "nowrap", flexShrink: 0 } }, stLbl), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.4)", whiteSpace: "nowrap", flexShrink: 0 } }, "Move ", mi + 1, m.driverName ? " \u2014 " + m.driverName : ""));
            }))));
          })(), jMoves.map((m, mIdx) => {
            const ms2 = moveSt(m);
            return /* @__PURE__ */ React.createElement("div", { key: m.id, style: { borderTop: mIdx > 0 ? "1px dashed #4a3a5a" : "none", padding: "10px 12px", background: ms2.bg, opacity: ms2.op } }, renderMoveContent(m, mIdx + 1, jMoves.length));
          }), isAdminUser && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 12px", borderTop: "1px dashed #4a3a5a" } }, /* @__PURE__ */ React.createElement(
            "button",
            {
              onClick: () => {
                setManualTo(destId);
                setManualToLocked(true);
                setManualMoveMode("job");
                setShowManualMove(true);
              },
              style: { width: "100%", background: "transparent", border: "1px dashed #7b4fa6", borderRadius: "5px", color: "#9b6fd6", fontFamily: "'DM Mono',monospace", fontSize: "9px", padding: "7px 12px", cursor: "pointer", fontWeight: 700 }
            },
            "\uFF0B Add Move to This Job"
          )), isAdminUser && jMoves.every((m) => m.status === "complete") && !isCleared && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 12px", borderTop: "1px dashed #4a3a5a" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
            if (!window.confirm('Mark all equipment from "' + toLabel + '" as returned to garage?\n\nThis will make them available for new moves.')) return;
            const _cu = (localStorage.getItem("dmc_u") || "").toLowerCase();
            const _now = Date.now();
            saveLowbedGroups(lowbedGroups.map(
              (g) => g.jobGroupId === jobGroupId ? { ...g, status: "cleared", clearedAt: _now, clearedBy: _cu } : g
            ));
          }, style: { width: "100%", background: "transparent", border: "1px solid #9b6fd6", borderRadius: "5px", color: "#9b6fd6", fontFamily: "'DM Mono',monospace", fontSize: "9px", padding: "7px 12px", cursor: "pointer", fontWeight: 700 } }, "\u{1F9F9} Clean Out \u2014 Release equipment for reassignment"))));
        }
        const grp = item.move;
        const ms = moveSt(grp);
        return /* @__PURE__ */ React.createElement("div", { key: grp.id, style: { background: "#1a1a2e", border: "1px solid #4a4a6a", borderRadius: "8px", padding: "12px", boxSizing: "border-box", opacity: ms.op } }, renderMoveContent(grp, 1, 1));
      });
    })()));
  })()))), !isDriverUser && hiddenDeviceIds.size > 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 14px", borderBottom: "1px solid var(--asphalt-light)", background: "rgba(217,79,61,0.05)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(217,79,61,0.8)", fontWeight: 700 } }, "\u{1F648} ", hiddenDeviceIds.size, " unit", hiddenDeviceIds.size !== 1 ? "s" : "", " hidden"), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowHiddenMgr((v) => !v),
      style: {
        background: "none",
        border: "1px solid rgba(217,79,61,0.3)",
        borderRadius: "4px",
        color: "rgba(217,79,61,0.7)",
        fontFamily: "'DM Mono',monospace",
        fontSize: "9px",
        padding: "2px 8px",
        cursor: "pointer"
      }
    },
    showHiddenMgr ? "Hide list \u25B2" : "Restore \u25BE"
  )), showHiddenMgr && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px" } }, [...hiddenDeviceIds].map((id) => {
    const dev = gpsDevices.find((d) => d.device_id === id);
    const name = dev ? getDeviceName(dev) : id;
    return /* @__PURE__ */ React.createElement("div", { key: id, style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      background: "rgba(217,79,61,0.1)",
      border: "1px solid rgba(217,79,61,0.25)",
      borderRadius: "12px",
      padding: "3px 8px 3px 10px"
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete)" } }, name), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => restoreDevice(id),
        title: "Restore this unit",
        style: {
          background: "none",
          border: "none",
          color: "#7ecb8f",
          fontFamily: "'DM Mono',monospace",
          fontSize: "9px",
          fontWeight: 700,
          cursor: "pointer",
          padding: "0",
          lineHeight: 1
        }
      },
      "\u21A9 restore"
    ));
  }))), hdMobile && isIgiron && /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: () => setHdHaulOpen((v) => !v),
      style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--asphalt-light)", cursor: "pointer", userSelect: "none", background: "var(--asphalt)" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "#a78bfa" } }, "\u{1F4CB} Daily Haul Assignment"),
    /* @__PURE__ */ React.createElement("span", { style: { color: "var(--concrete-dim)", fontSize: "10px" } }, hdHaulOpen ? "\u25BC" : "\u25B6")
  ), hdMobile && isIgiron && hdHaulOpen && /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 14px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement(DailyHaulWidget, { driverKey: "igiron" })), hdMobile && isATow && (() => {
    const _rL = (val) => {
      if (!val) return "\u2014";
      if (val === "__garage__") return "Garage";
      const job = jobList.find((j) => String(j.id) === String(val) || String(j.num) === String(val));
      if (job) return (job.num || job.id) + (job.name ? " \u2014 " + job.name : "");
      if (/^\d{10,}$/.test(String(val))) return "Job " + String(val);
      return val;
    };
    const _si2 = (s) => {
      if (s === "complete") return { label: "Complete", color: "#7ecb8f", bg: "rgba(126,203,143,0.12)", border: "rgba(126,203,143,0.3)" };
      if (s === "in_progress") return { label: "In Progress", color: "#5ab4f5", bg: "rgba(90,180,245,0.12)", border: "rgba(90,180,245,0.3)" };
      if (s === "cancelled") return { label: "Cancelled", color: "#d94f3d", bg: "rgba(217,79,61,0.12)", border: "rgba(217,79,61,0.3)" };
      return { label: "Pending", color: "#f5c518", bg: "rgba(245,197,24,0.12)", border: "rgba(245,197,24,0.3)" };
    };
    const atowMoves2 = lowbedGroups.filter((g) => g.manual === true && !g.deviceId && (g.driverName === "ATow" || g.driverName === "Andy's Towing"));
    return /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--asphalt-light)", padding: "12px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "#a78bfa", marginBottom: "10px" } }, "\u{1F69A} YOUR ASSIGNED MOVES"), atowMoves2.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0", gap: "6px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "24px", opacity: 0.35 } }, "\u{1F69B}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.5)", textAlign: "center" } }, "No moves currently assigned to Andy's Towing")) : atowMoves2.map((grp) => {
      const si = _si2(grp.status || "pending");
      const isExp = expandedMoves.has(grp.id);
      const toggleExp = () => setExpandedMoves((prev) => {
        const n = new Set(prev);
        n.has(grp.id) ? n.delete(grp.id) : n.add(grp.id);
        return n;
      });
      return /* @__PURE__ */ React.createElement("div", { key: grp.id, style: { background: "rgba(20,20,35,0.8)", border: "1px solid rgba(90,180,245,0.15)", borderRadius: "7px", overflow: "hidden", marginBottom: "6px" } }, /* @__PURE__ */ React.createElement("div", { onClick: toggleExp, style: { display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px", cursor: "pointer", userSelect: "none" } }, grp.date && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.55)", flexShrink: 0 } }, grp.date), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0d8f0", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, _rL(grp.from), " \u2192 ", _rL(grp.to)), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, padding: "1px 6px", borderRadius: "8px", background: si.bg, border: "1px solid " + si.border, fontFamily: "'DM Mono',monospace", fontSize: "7px", fontWeight: 700, color: si.color } }, si.label), /* @__PURE__ */ React.createElement("span", { style: { flexShrink: 0, color: "rgba(155,148,136,0.4)", fontSize: "9px", display: "inline-block", transform: isExp ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" } }, "\u25BC")), isExp && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(90,180,245,0.1)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#c0d8f0" } }, _rL(grp.from), " \u2192 ", _rL(grp.to)), (grp.items || []).map((it) => /* @__PURE__ */ React.createElement("div", { key: it.id, style: { display: "flex", alignItems: "center", gap: "5px", padding: "2px 4px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "10px" } }, EQ_ICONS[it.type] || "\u{1F4E6}"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0d8f0" } }, it.name || it.type))), grp.notes && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)", fontStyle: "italic" } }, "\u{1F4DD} ", grp.notes), grp.deadline && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0392b", fontWeight: 700 } }, "\u26A0 Due ", new Date(grp.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" }))));
    }));
  })(), hdMobile && !isATow && gpsDevices.length > 0 && /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: () => setHdDevicesOpen((v) => !v),
      style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--asphalt-light)", cursor: "pointer", userSelect: "none", background: "var(--asphalt)" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "var(--stripe)" } }, "\u{1F4E1} Unassigned Devices"),
    /* @__PURE__ */ React.createElement("span", { style: { color: "var(--concrete-dim)", fontSize: "10px" } }, hdDevicesOpen ? "\u25BC" : "\u25B6")
  ), !gpsLoading && gpsDevices.length > 0 && (!hdMobile || hdDevicesOpen) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "14px", padding: "7px 14px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "5px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "8px", height: "8px", borderRadius: "50%", background: "#7ecb8f", border: "2px solid #f5c518", flexShrink: 0 } }), " Stopped / Idle"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "5px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "8px", height: "8px", borderRadius: "50%", background: "#5ab4f5", border: "2px solid #5ab4f5", flexShrink: 0 } }), " Moving"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "5px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "8px", height: "8px", borderRadius: "50%", background: "var(--red)", border: "2px solid var(--red)", flexShrink: 0 } }), " Inactive 24h+"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "5px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, /* @__PURE__ */ React.createElement("div", { style: { width: "8px", height: "8px", borderRadius: "2px", background: "#a78bfa", border: "2px solid #c4b5fd", flexShrink: 0, transform: "rotate(45deg)" } }), " Job Site"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", marginLeft: "auto" } }, lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} \xB7 auto-refresh 5m` : "Tap a pin for details")), !isATow && (!hdMobile || hdDevicesOpen) && (() => {
    const visibleDevices = gpsDevices.filter((d) => !hiddenDeviceIds.has(d.device_id));
    const groupMap = {};
    visibleDevices.forEach((dev) => {
      getDeviceGroupLabels(dev).forEach((label) => {
        if (!groupMap[label]) groupMap[label] = [];
        groupMap[label].push(dev);
      });
    });
    const groupEntries = Object.entries(groupMap).sort((a, b) => {
      if (a[0] === "Unassigned Devices") return 1;
      if (b[0] === "Unassigned Devices") return -1;
      return a[0].localeCompare(b[0]);
    });
    return groupEntries.map(([groupLabel, devices]) => {
      const isCollapsed = collapsedGroups[groupLabel];
      const staleCount = devices.filter(isDeviceStale).length;
      const movingCount = devices.filter((d) => getDeviceStatus(d).label.startsWith("Moving")).length;
      return /* @__PURE__ */ React.createElement("div", { key: groupLabel }, /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: () => toggleGroup(groupLabel),
          style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 14px", background: "var(--asphalt)", borderBottom: "1px solid var(--asphalt-light)", cursor: "pointer", userSelect: "none" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "13px", letterSpacing: "2px", color: "var(--stripe)" } }, groupLabel), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", background: "rgba(155,148,136,0.1)", border: "1px solid rgba(155,148,136,0.2)", borderRadius: "10px", padding: "1px 7px" } }, devices.length, " units"), movingCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#5ab4f5", background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.25)", borderRadius: "10px", padding: "1px 7px" } }, "\u25CF ", movingCount, " moving"), staleCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--red)", background: "rgba(217,79,61,0.1)", border: "1px solid rgba(217,79,61,0.25)", borderRadius: "10px", padding: "1px 7px" } }, "\u26A0 ", staleCount, " inactive")),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--concrete-dim)", fontSize: "10px" } }, isCollapsed ? "\u25B6" : "\u25BC")
      ), !isCollapsed && devices.map((dev) => {
        const st = getDeviceStatus(dev);
        const addr = getDeviceAddress(dev);
        const updated = getDeviceUpdated(dev);
        const num = getDeviceEquipNum(dev);
        const isMoving = st.label.startsWith("Moving");
        const stale = isDeviceStale(dev);
        const jobMatch = deviceJobMap[dev.device_id];
        const devGrp = lowbedGroups.find((g) => g.deviceId === dev.device_id);
        const devChips = devGrp ? devGrp.items : [];
        return /* @__PURE__ */ React.createElement("div", { key: dev.device_id, style: { borderBottom: "1px solid var(--asphalt-light)", background: stale ? "rgba(217,79,61,0.04)" : "transparent" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 8px 22px", gap: "8px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "9px", flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: {
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          flexShrink: 0,
          background: stale ? "var(--red)" : isMoving ? "#5ab4f5" : "#7ecb8f",
          boxShadow: stale ? "0 0 5px rgba(217,79,61,0.5)" : isMoving ? "0 0 5px rgba(90,180,245,0.5)" : "0 0 5px rgba(126,203,143,0.5)"
        } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "var(--white)", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } }, num && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--stripe)" } }, num), getDeviceName(dev), stale && /* @__PURE__ */ React.createElement("span", { style: { fontSize: "8px", fontWeight: 700, padding: "1px 5px", borderRadius: "8px", background: "rgba(217,79,61,0.15)", color: "var(--red)", border: "1px solid rgba(217,79,61,0.3)" } }, "\u26A0 Inactive 24h+")), jobMatch && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#7ecb8f", marginTop: "1px" } }, "\u{1F4CD} On site: ", jobMatch.jobNum ? jobMatch.jobNum + " \xB7 " : "", jobMatch.jobName, " (", jobMatch.distMiles, " mi)"), addr && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, addr), updated && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: stale ? "rgba(217,79,61,0.6)" : "rgba(155,148,136,0.6)" } }, "Last seen: ", updated))), devChips.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center", flexShrink: 0, maxWidth: "40%" } }, devChips.map((chip) => /* @__PURE__ */ React.createElement(
          "button",
          {
            key: chip.id,
            onClick: () => {
              try {
                window.parent.openEquipmentDetail(chip.id);
              } catch (e) {
              }
            },
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: "rgba(245,197,24,0.1)",
              border: "1px solid rgba(245,197,24,0.35)",
              borderRadius: "10px",
              padding: "2px 7px 2px 4px",
              cursor: "pointer",
              fontFamily: "'DM Mono',monospace",
              fontSize: "9px",
              fontWeight: 700,
              color: "var(--stripe)",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
              transition: "background 0.12s"
            },
            onMouseEnter: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.2)",
            onMouseLeave: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.1)"
          },
          /* @__PURE__ */ React.createElement("span", { style: { fontSize: "11px" } }, EQ_ICONS[chip.type] || "\u{1F4E6}"),
          chip.name
        )), isAdminUser && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              try {
                setFleetItems(JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false));
              } catch (e) {
              }
              setPickerDeviceId(dev.device_id);
              setPickerSearch("");
            },
            style: {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "20px",
              height: "20px",
              background: "rgba(245,197,24,0.06)",
              border: "1px dashed rgba(245,197,24,0.3)",
              borderRadius: "10px",
              color: "var(--stripe)",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              lineHeight: 1,
              flexShrink: 0
            },
            title: "Add more equipment"
          },
          "+"
        )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("span", { style: {
          fontFamily: "'DM Mono',monospace",
          fontSize: "9px",
          fontWeight: 700,
          padding: "3px 8px",
          borderRadius: "10px",
          background: stale ? "rgba(217,79,61,0.12)" : isMoving ? "rgba(90,180,245,0.12)" : "rgba(126,203,143,0.12)",
          color: stale ? "var(--red)" : isMoving ? "#5ab4f5" : "#7ecb8f",
          border: `1px solid ${stale ? "rgba(217,79,61,0.3)" : isMoving ? "rgba(90,180,245,0.3)" : "rgba(126,203,143,0.3)"}`
        } }, stale ? "No Signal" : st.label), isAdminUser && devChips.length === 0 && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              try {
                setFleetItems(JSON.parse(localStorage.getItem("dmc_fleet") || "[]").filter((e) => e.active !== false));
              } catch (e) {
              }
              setPickerDeviceId(dev.device_id);
              setPickerSearch("");
            },
            style: {
              background: "rgba(245,197,24,0.12)",
              border: "1px solid rgba(245,197,24,0.35)",
              borderRadius: "4px",
              color: "var(--stripe)",
              fontFamily: "'DM Mono',monospace",
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 8px",
              cursor: "pointer",
              lineHeight: 1
            },
            title: "Add equipment to this lowbed"
          },
          "+"
        ), isAdminUser && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => hideDevice(dev.device_id, getDeviceName(dev)),
            title: "Remove this GPS unit from Heimdall",
            style: {
              background: "rgba(217,79,61,0.08)",
              border: "1px solid rgba(217,79,61,0.3)",
              borderRadius: "4px",
              color: "rgba(217,79,61,0.7)",
              fontFamily: "'DM Mono',monospace",
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 7px",
              cursor: "pointer",
              lineHeight: 1,
              transition: "all 0.15s"
            },
            onMouseEnter: (e) => {
              e.currentTarget.style.background = "rgba(217,79,61,0.2)";
              e.currentTarget.style.color = "var(--red)";
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.background = "rgba(217,79,61,0.08)";
              e.currentTarget.style.color = "rgba(217,79,61,0.7)";
            }
          },
          "\u{1F5D1}"
        ))));
      }));
    });
  })())), isDesktopUser && !isAdminUser && !isNightmare57 && !isATow && !hdMobile && (() => {
    return /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 35%", maxWidth: "35%", minWidth: "240px", overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "14px", boxSizing: "border-box", order: 2 } }, (planResults.length > 0 || intelResults.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "text-center" }, /* @__PURE__ */ React.createElement("div", { className: "text-xl font-bold text-yellow-700" }, planResults.length), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-600" }, "Plans analyzed")), /* @__PURE__ */ React.createElement("div", { className: "text-center" }, /* @__PURE__ */ React.createElement("div", { className: "text-xl font-bold text-yellow-700" }, intelResults.length), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-600" }, "Field intel reports")), /* @__PURE__ */ React.createElement("div", { className: "flex-1 flex items-center justify-end gap-2" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setTab("Field Intel"), className: "text-xs text-yellow-700 font-semibold border border-yellow-300 px-2 py-1 rounded hover:bg-yellow-100" }, "View Field Intel"))), isIgiron && /* @__PURE__ */ React.createElement(DailyHaulWidget, { driverKey: "igiron" }));
  })(), isATow && !hdMobile && (() => {
    const _resolveLoc = (val) => {
      if (!val) return "\u2014";
      if (val === "__garage__") return "Garage";
      const job = jobList.find((j) => String(j.id) === String(val) || String(j.num) === String(val));
      if (job) return (job.num || job.id) + (job.name ? " \u2014 " + job.name : "");
      if (/^\d{10,}$/.test(String(val))) return "Job " + String(val);
      return val;
    };
    const _si = (s) => {
      if (s === "complete") return { label: "Complete", color: "#7ecb8f", bg: "rgba(126,203,143,0.12)", border: "rgba(126,203,143,0.3)" };
      if (s === "in_progress") return { label: "In Progress", color: "#5ab4f5", bg: "rgba(90,180,245,0.12)", border: "rgba(90,180,245,0.3)" };
      if (s === "cancelled") return { label: "Cancelled", color: "#d94f3d", bg: "rgba(217,79,61,0.12)", border: "rgba(217,79,61,0.3)" };
      return { label: "Pending", color: "#f5c518", bg: "rgba(245,197,24,0.12)", border: "rgba(245,197,24,0.3)" };
    };
    const atowMoves = lowbedGroups.filter((g) => g.manual === true && !g.deviceId && (g.driverName === "ATow" || g.driverName === "Andy's Towing"));
    return /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 50%", maxWidth: "50%", minWidth: "260px", overflowY: "auto", padding: "14px", boxSizing: "border-box", order: 2 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "14px", letterSpacing: "2px", color: "#a78bfa", marginBottom: "12px" } }, "\u{1F69A} YOUR ASSIGNED MOVES"), atowMoves.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "28px", opacity: 0.35 } }, "\u{1F69B}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.5)", textAlign: "center" } }, "No moves currently assigned to Andy's Towing")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, atowMoves.map((grp) => {
      const isExp = expandedMoves.has(grp.id);
      const si = _si(grp.status || "pending");
      const eqCount = (grp.items || []).length;
      const toggleExp = () => setExpandedMoves((prev) => {
        const n = new Set(prev);
        n.has(grp.id) ? n.delete(grp.id) : n.add(grp.id);
        return n;
      });
      return /* @__PURE__ */ React.createElement("div", { key: grp.id, style: { background: "rgba(20,20,35,0.8)", border: "1px solid rgba(90,180,245,0.15)", borderRadius: "7px", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { onClick: toggleExp, style: { display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px", cursor: "pointer", userSelect: "none" } }, grp.date && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.55)", flexShrink: 0, minWidth: "58px" } }, grp.date), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0d8f0", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, _resolveLoc(grp.from), " \u2192 ", _resolveLoc(grp.to)), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.45)", flexShrink: 0 } }, eqCount, " pc", eqCount !== 1 ? "s" : ""), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, padding: "1px 6px", borderRadius: "8px", background: si.bg, border: "1px solid " + si.border, fontFamily: "'DM Mono',monospace", fontSize: "7px", fontWeight: 700, color: si.color, whiteSpace: "nowrap" } }, si.label), /* @__PURE__ */ React.createElement("span", { style: { flexShrink: 0, color: "rgba(155,148,136,0.4)", fontSize: "9px", display: "inline-block", transform: isExp ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" } }, "\u25BC")), isExp && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(90,180,245,0.1)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.45)" } }, "ROUTE"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#c0d8f0" } }, _resolveLoc(grp.from), " \u2192 ", _resolveLoc(grp.to)), grp.date && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.4)", marginLeft: "auto" } }, grp.date)), (grp.items || []).length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "3px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.45)", marginBottom: "2px" } }, "EQUIPMENT (", eqCount, ")"), (grp.items || []).map((it) => /* @__PURE__ */ React.createElement("div", { key: it.id, style: { display: "flex", alignItems: "center", gap: "6px", padding: "3px 6px", borderRadius: "4px", background: "rgba(255,255,255,0.03)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "10px" } }, EQ_ICONS[it.type] || "\u{1F4E6}"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0d8f0", flex: 1 } }, it.name || it.type), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.35)" } }, it.type)))), grp.notes && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)", fontStyle: "italic" } }, "\u{1F4DD} ", grp.notes), grp.deadline && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0392b", fontWeight: 700 } }, "\u26A0 Due ", new Date(grp.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))));
    })));
  })(), !isDesktopUser && /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 42%", minWidth: "260px", overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", boxSizing: "border-box", order: 2 } }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-3" }, [
    { label: "Equipment Units", val: gpsDevices.length, sub: gpsLoading ? "Loading GPS\u2026" : gpsHibernated ? "\u2744\uFE0F Fleet hibernated" : `${gpsDevices.filter((d) => isDeviceStale(d)).length} inactive 24h+ \xB7 ${gpsDevices.filter((d) => {
      const s = getDeviceStatus(d);
      return s.label.startsWith("Moving");
    }).length} moving`, color: "bg-blue-50 border-blue-200" },
    { label: "Active Jobs", val: mockJobs.length, sub: `${mockJobs.filter((j) => j.status === "Needs Move").length} need moves`, color: "bg-yellow-50 border-yellow-200" },
    { label: "Dispatches Ready", val: dispatches.length, sub: `${dispatches.filter((d) => d.status === "Approved").length} approved`, color: "bg-green-50 border-green-200" },
    { label: "Conflicts", val: conflicts.length, sub: `${conflicts.filter((c) => c.severity === "High").length} high priority`, color: "bg-red-50 border-red-200" }
  ].map((c) => /* @__PURE__ */ React.createElement("div", { key: c.label, className: `rounded-lg border p-3 ${c.color}` }, /* @__PURE__ */ React.createElement("div", { className: "text-2xl font-bold text-gray-800" }, c.val), /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-600" }, c.label), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500" }, c.sub)))), (planResults.length > 0 || intelResults.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "text-center" }, /* @__PURE__ */ React.createElement("div", { className: "text-xl font-bold text-yellow-700" }, planResults.length), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-600" }, "Plans analyzed")), /* @__PURE__ */ React.createElement("div", { className: "text-center" }, /* @__PURE__ */ React.createElement("div", { className: "text-xl font-bold text-yellow-700" }, intelResults.length), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-600" }, "Field intel reports")), /* @__PURE__ */ React.createElement("div", { className: "flex-1 flex items-center justify-end gap-2" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setTab("Field Intel"), className: "text-xs text-yellow-700 font-semibold border border-yellow-300 px-2 py-1 rounded hover:bg-yellow-100" }, "View Field Intel"))), lowbedPlan && lowbedPlan.jobs && lowbedPlan.jobs.length > 0 && (() => {
    const inProgress = [];
    lowbedPlan.jobs.forEach((job, ji) => {
      (job.moves || []).forEach((mv, mi) => {
        if (mv.status !== "complete") {
          inProgress.push({ job, moveIdx: mi + 1, move: mv });
        }
      });
    });
    const jobStatuses = lowbedPlan.jobs.map((job) => {
      const onSiteNames = /* @__PURE__ */ new Set();
      (job.moves || []).forEach((mv) => {
        if (mv.status === "complete") {
          (mv.equipment || []).forEach((eq) => eq.name && onSiteNames.add(eq.name));
        }
      });
      const byType = {};
      (job.allEquipment || []).forEach((eq) => {
        const t = eq.type || "other";
        if (!byType[t]) byType[t] = [];
        byType[t].push({ ...eq, onSite: onSiteNames.has(eq.name) });
      });
      return { job, byType };
    });
    return /* @__PURE__ */ React.createElement("div", { style: { background: "#1a1a2e", borderRadius: "10px", border: "1px solid rgba(90,180,245,0.25)", padding: "12px", marginBottom: "4px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "15px", letterSpacing: "2px", color: "#5ab4f5", marginBottom: "10px" } }, "\u{1F69A} LOWBED MOVES"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "10px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "0 0 48%", minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f", letterSpacing: "1px", marginBottom: "7px", textTransform: "uppercase" } }, "Moves In Progress"), inProgress.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.6)", textAlign: "center", padding: "16px 0" } }, "All moves complete \u2713") : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, inProgress.map((item, idx) => /* @__PURE__ */ React.createElement("div", { key: idx, style: { background: "rgba(90,180,245,0.06)", borderRadius: "6px", border: "1px solid rgba(90,180,245,0.15)", padding: "7px 9px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#5ab4f5", fontWeight: "bold" } }, item.job.jobName || item.job.jobNum || "Job", " \xB7 Move ", item.moveIdx), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: item.move.assignedDriver ? "#7ecb8f" : "rgba(155,148,136,0.7)", whiteSpace: "nowrap", marginLeft: "6px" } }, item.move.assignedDriver || "\u26A0 Unassigned")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: item.move.deadline ? "5px" : "0" } }, (item.move.equipment || []).map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: ei, style: { background: "rgba(90,180,245,0.12)", border: "1px solid rgba(90,180,245,0.2)", borderRadius: "3px", padding: "1px 5px", fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "#c0d8f0" } }, EQ_ICONS[eq.type] || "\u{1F4E6}", " ", eq.name || eq.type))), item.move.deadline && /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: "4px", background: "#fff", border: "2px solid #c0392b", borderRadius: "5px", padding: "2px 7px", fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700, color: "#c0392b" } }, "\u26A0 By ", new Date(item.move.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), " ", new Date(item.move.deadline).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })))))), /* @__PURE__ */ React.createElement("div", { style: { width: "1px", background: "rgba(90,180,245,0.18)", flexShrink: 0, margin: "0 2px" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#e8a94c", letterSpacing: "1px", marginBottom: "7px", textTransform: "uppercase" } }, "Jobs \u2014 Equipment Status"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, jobStatuses.map(({ job, byType }, ji) => /* @__PURE__ */ React.createElement("div", { key: ji, style: { background: "rgba(232,169,76,0.05)", borderRadius: "6px", border: "1px solid rgba(232,169,76,0.15)", padding: "7px 9px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#e8a94c", fontWeight: "bold", marginBottom: "5px" } }, job.jobName || job.jobNum || "Job " + (ji + 1)), Object.keys(byType).length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.5)" } }, "No equipment assigned") : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, Object.entries(byType).map(([type, items]) => /* @__PURE__ */ React.createElement("div", { key: type }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)", marginBottom: "2px", textTransform: "capitalize" } }, EQ_ICONS[type] || "\u{1F4E6}", " ", type.replace(/_/g, " ")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "3px" } }, items.map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: ei, style: {
      background: eq.onSite ? "rgba(126,203,143,0.12)" : "rgba(90,180,245,0.1)",
      border: eq.onSite ? "1px solid rgba(126,203,143,0.3)" : "1px solid rgba(90,180,245,0.2)",
      borderRadius: "3px",
      padding: "1px 5px",
      fontFamily: "'DM Mono',monospace",
      fontSize: "8px",
      color: eq.onSite ? "#7ecb8f" : "#5ab4f5"
    } }, eq.onSite ? "\u2713" : "\u23F3", " ", eq.name || eq.type))))))))))));
  })(), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-lg border p-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-sm text-gray-700 mb-2" }, "Jobs \u2014 Tap for Aerial View"), /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, mockJobs.map((job) => /* @__PURE__ */ React.createElement("div", { key: job.id, className: "border rounded-lg overflow-hidden" }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer active:bg-gray-100 transition-colors",
      onClick: () => setSelectedJob(selectedJob === job.id ? null : job.id)
    },
    /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-bold text-gray-800" }, job.id, " \xB7 ", job.name), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500" }, job.address), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, "Start: ", job.startDate)),
    /* @__PURE__ */ React.createElement("div", { className: "flex flex-col items-end gap-1" }, /* @__PURE__ */ React.createElement("span", { className: `text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(job.status)}` }, job.status), /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-400" }, selectedJob === job.id ? "\u25B2" : "\u25BC"))
  ), selectedJob === job.id && /* @__PURE__ */ React.createElement("div", { className: "p-2 bg-white" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mb-1.5" }, "Equipment needed: ", job.equipmentNeeded.map((eqId) => {
    const dev = gpsDevices.find((d) => (equipNameMap[d.device_id] || {}).equipNum === eqId);
    if (dev) return (equipNameMap[dev.device_id] || {}).customName || dev.display_name || eqId;
    return eqId;
  }).join(", "))))))), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-lg border p-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-sm text-gray-700 mb-2" }, "Recent Move History"), mockMoveHistory.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "flex items-start justify-between py-1.5 border-b last:border-0 gap-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-800" }, m.eq, " \xB7 ", m.driver), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500" }, m.from, " \u2192 ", m.to)), /* @__PURE__ */ React.createElement("div", { className: "text-right shrink-0" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-medium text-gray-700" }, m.miles, " mi"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, m.date, " \xB7 ", m.duration))))))), tab === "Dashboard" && isDriverUser && !isDesktopUser && isMixTruckDriver && (() => {
    const driverUsername = (localStorage.getItem("dmc_u") || "").toLowerCase();
    const MT_NAMES = { "field2": "Field 2", "field3": "Field 3", "field4": "Field 4", "field5": "Field 5", "igiron": "Ingrid" };
    const driverDisplay = MT_NAMES[driverUsername] || driverUsername;
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const getWeekDays = () => {
      const today = /* @__PURE__ */ new Date();
      const dow = today.getDay();
      const mon = new Date(today);
      mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mon);
        d.setDate(mon.getDate() + i);
        return d.toISOString().split("T")[0];
      });
    };
    const weekDays = getWeekDays();
    const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayBlocks = weekDays.map((dateKey) => {
      const day = schedData[dateKey] || {};
      const slots = [];
      ["top", "bottom"].forEach((s) => {
        if (day[s] && day[s].type && day[s].type !== "blank" && (day[s].fields?.jobName || day[s].fields?.jobNum)) slots.push(day[s]);
      });
      (day.extras || []).forEach((e) => {
        if (e.data && e.data.type && e.data.type !== "blank" && (e.data.fields?.jobName || e.data.fields?.jobNum)) slots.push(e.data);
      });
      return { dateKey, slots };
    });
    const todaySlips = mixSlips.filter((s) => s.date === todayStr && s.driverUsername === driverUsername);
    const slipChip = (label, val) => val ? /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.7)", background: "rgba(255,255,255,0.04)", borderRadius: "3px", padding: "1px 5px", border: "1px solid rgba(255,255,255,0.08)" } }, label, ": ", val) : null;
    return /* @__PURE__ */ React.createElement("div", { style: { padding: "16px", maxWidth: "700px", margin: "0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(126,203,143,0.06)", border: "1px solid rgba(126,203,143,0.2)", borderRadius: "10px", padding: "14px 18px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "20px", letterSpacing: "2px", color: "#7ecb8f" } }, "\u{1F69B} MIX TRUCK DASHBOARD"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.7)", marginTop: "2px" } }, "Logged in as ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--white)" } }, driverDisplay), " \xB7 Mix Truck Driver")), todaySlips.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.25)", borderRadius: "8px", padding: "4px 10px", textAlign: "center" } }, todaySlips.length, " slip", todaySlips.length !== 1 ? "s" : "", /* @__PURE__ */ React.createElement("br", null), "today")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "4px", marginBottom: "14px", overflowX: "auto", paddingBottom: "4px" } }, weekDays.map((dk, i) => {
      const isToday = dk === todayStr;
      const hasJobs = dayBlocks[i].slots.length > 0;
      return /* @__PURE__ */ React.createElement("div", { key: dk, style: {
        flexShrink: 0,
        textAlign: "center",
        padding: "5px 8px",
        borderRadius: "6px",
        minWidth: "44px",
        background: isToday ? "rgba(126,203,143,0.15)" : "rgba(255,255,255,0.03)",
        border: isToday ? "1px solid rgba(126,203,143,0.4)" : "1px solid rgba(255,255,255,0.07)"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: isToday ? "#7ecb8f" : "rgba(155,148,136,0.5)", fontWeight: 700 } }, DAY_LABELS[i]), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: isToday ? "var(--white)" : "rgba(155,148,136,0.6)", marginTop: "1px" } }, (/* @__PURE__ */ new Date(dk + "T12:00:00")).getDate()), hasJobs && /* @__PURE__ */ React.createElement("div", { style: { width: "5px", height: "5px", borderRadius: "50%", background: isToday ? "#7ecb8f" : "rgba(245,197,24,0.4)", margin: "3px auto 0" } }));
    })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, dayBlocks.map(({ dateKey, slots }, di) => {
      const isToday = dateKey === todayStr;
      const isPast = dateKey < todayStr;
      const dayLabel = DAY_LABELS[di] + " " + (/* @__PURE__ */ new Date(dateKey + "T12:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const daySlips = mixSlips.filter((s) => s.date === dateKey && s.driverUsername === driverUsername);
      if (slots.length === 0 && !isToday) return null;
      return /* @__PURE__ */ React.createElement("div", { key: dateKey, style: { borderRadius: "8px", border: isToday ? "1px solid rgba(126,203,143,0.35)" : "1px solid rgba(255,255,255,0.08)", overflow: "hidden", opacity: isPast ? 0.7 : 1 } }, /* @__PURE__ */ React.createElement("div", { style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        background: isToday ? "rgba(126,203,143,0.1)" : "rgba(255,255,255,0.04)"
      } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, isToday && /* @__PURE__ */ React.createElement("span", { style: { background: "#7ecb8f", color: "#000", borderRadius: "4px", padding: "1px 7px", fontFamily: "'DM Mono',monospace", fontSize: "8px", fontWeight: 700 } }, "TODAY"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: isToday ? "#7ecb8f" : "var(--white)" } }, dayLabel)), daySlips.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f" } }, "\u2713 ", daySlips.length, " slip", daySlips.length !== 1 ? "s" : "", " filed")), slots.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.4)" } }, "No jobs scheduled") : slots.map((block, bi) => {
        const f = block.fields || {};
        const operators = (f.operators || "").split(",").map((s) => s.trim()).filter(Boolean);
        const otherTrucks = operators.filter((n) => n.toLowerCase() !== driverDisplay.toLowerCase());
        const foreman = f.contact || (foremanRoster[block.slot === "bottom" ? 1 : 0] || "");
        const matLabel = (() => {
          try {
            const m = JSON.parse(f.material || "[]");
            return Array.isArray(m) ? m.map((x) => x.name).join(", ") : f.material;
          } catch (e) {
            return f.material || "";
          }
        })();
        return /* @__PURE__ */ React.createElement("div", { key: bi, style: { padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "7px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "11px", fontWeight: 700, color: "var(--white)" } }, f.jobName || "\u2014", f.jobNum ? /* @__PURE__ */ React.createElement("span", { style: { color: "var(--stripe)", marginLeft: "6px", fontSize: "10px" } }, "#", f.jobNum) : null), f.contact && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.6)", marginTop: "2px" } }, "\u{1F464} Foreman: ", foreman)), /* @__PURE__ */ React.createElement("span", { style: {
          fontFamily: "'DM Mono',monospace",
          fontSize: "8px",
          fontWeight: 700,
          padding: "2px 7px",
          borderRadius: "8px",
          background: block.type === "night" ? "rgba(90,100,180,0.15)" : "rgba(245,197,24,0.1)",
          color: block.type === "night" ? "#9090f0" : "var(--stripe)",
          border: block.type === "night" ? "1px solid rgba(90,100,180,0.3)" : "1px solid rgba(245,197,24,0.25)",
          whiteSpace: "nowrap",
          flexShrink: 0,
          marginLeft: "8px"
        } }, block.type === "night" ? "\u{1F319} Night" : "\u2600\uFE0F Day")), f.loadTime && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", padding: "7px 10px", background: "rgba(245,197,24,0.1)", border: "2px solid rgba(245,197,24,0.5)", borderRadius: "6px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "16px" } }, "\u23F0"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", letterSpacing: "1.5px", color: "rgba(245,197,24,0.7)", fontWeight: 700 } }, "PLANT LOAD TIME"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "22px", letterSpacing: "2px", color: "var(--stripe)", lineHeight: 1 } }, f.loadTime))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px", marginBottom: "8px" } }, f.plant && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.8)" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.5)" } }, "Plant: "), f.plant), matLabel && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.8)" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.5)" } }, "Mix: "), matLabel), f.trucking && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(155,148,136,0.8)", gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.5)" } }, "Trucking: "), f.trucking)), otherTrucks.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "8px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.5)", marginBottom: "4px" } }, "OTHER TRUCKS ON THIS RUN"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" } }, otherTrucks.map((n, ni) => /* @__PURE__ */ React.createElement("span", { key: ni, style: { background: "rgba(90,180,245,0.08)", border: "1px solid rgba(90,180,245,0.2)", borderRadius: "8px", padding: "2px 8px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#5ab4f5" } }, "\u{1F69B} ", n)))), daySlips.filter((s) => (s.jobName || "") === (f.jobName || "")).length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "8px", padding: "6px 8px", background: "rgba(126,203,143,0.05)", border: "1px solid rgba(126,203,143,0.15)", borderRadius: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(126,203,143,0.7)", marginBottom: "4px" } }, "FILED SLIPS"), daySlips.filter((s) => (s.jobName || "") === (f.jobName || "")).map((slip, si) => /* @__PURE__ */ React.createElement("div", { key: si, style: { display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "2px" } }, slipChip("Slip#", slip.slipNumber), slipChip("Load", slip.loadTime), slipChip("Qty", slip.quantity ? slip.quantity + " tons" : ""), slipChip("Mix", slip.mixType), slipChip("Truck", slip.truckNumber)))), isToday && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              setMixSlipDraft({ loadTime: "", slipNumber: "", mixType: matLabel || "", quantity: "", truckNumber: "", notes: "" });
              setMixSlipForm({ dateKey, jobName: f.jobName || "", jobNum: f.jobNum || "", plant: f.plant || "", material: matLabel || "", contact: f.contact || "", operators: f.operators || "" });
            },
            style: {
              width: "100%",
              padding: "8px",
              background: "rgba(126,203,143,0.12)",
              border: "1px solid rgba(126,203,143,0.4)",
              borderRadius: "6px",
              color: "#7ecb8f",
              fontFamily: "'DM Mono',monospace",
              fontSize: "10px",
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.5px"
            }
          },
          "\u{1F4CB} File Mix Slip \u2014 ",
          f.jobName || "This Job"
        ));
      }));
    }).filter(Boolean), dayBlocks.every((d) => d.slots.length === 0) && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "40px 20px", fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "rgba(155,148,136,0.4)" } }, "No jobs scheduled this week. Check back with dispatch.")));
  })(), mixSlipForm && (() => {
    const inp = { width: "100%", background: "#252525", border: "1px solid #333", borderRadius: "5px", color: "var(--white)", fontFamily: "'DM Mono',monospace", fontSize: "11px", padding: "7px 10px", boxSizing: "border-box" };
    const lbl = { fontFamily: "'DM Mono',monospace", fontSize: "9px", letterSpacing: "1px", color: "rgba(155,148,136,0.6)", marginBottom: "4px" };
    const driverUsername = (localStorage.getItem("dmc_u") || "").toLowerCase();
    const MT_NAMES2 = { "field2": "Field 2", "field3": "Field 3", "field4": "Field 4", "field5": "Field 5", "igiron": "Ingrid" };
    const driverDisplay2 = MT_NAMES2[driverUsername] || driverUsername;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setMixSlipForm(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9700, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "var(--asphalt-mid)", border: "1px solid rgba(126,203,143,0.35)", borderRadius: "10px", width: "100%", maxWidth: "480px", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.85)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid var(--asphalt-light)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", letterSpacing: "2px", color: "#7ecb8f" } }, "\u{1F4CB} File Mix Slip"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.6)", marginTop: "2px" } }, mixSlipForm.jobName, mixSlipForm.jobNum ? " #" + mixSlipForm.jobNum : "", " \xB7 ", (/* @__PURE__ */ new Date(mixSlipForm.dateKey + "T12:00:00")).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" } }, (mixSlipForm.plant || mixSlipForm.material) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, mixSlipForm.plant && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(245,197,24,0.08)", border: "1px solid rgba(245,197,24,0.2)", borderRadius: "6px", padding: "3px 9px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--stripe)" } }, "\u{1F3ED} ", mixSlipForm.plant), mixSlipForm.material && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(90,180,245,0.08)", border: "1px solid rgba(90,180,245,0.2)", borderRadius: "6px", padding: "3px 9px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#5ab4f5" } }, "\u{1F535} ", mixSlipForm.material)), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "LOAD TIME"), /* @__PURE__ */ React.createElement("input", { type: "time", value: mixSlipDraft.loadTime, onChange: (e) => setMixSlipDraft((d) => ({ ...d, loadTime: e.target.value })), style: { ...inp, colorScheme: "dark" } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "SLIP #"), /* @__PURE__ */ React.createElement("input", { value: mixSlipDraft.slipNumber, onChange: (e) => setMixSlipDraft((d) => ({ ...d, slipNumber: e.target.value })), placeholder: "e.g. 10042", style: inp }))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "MIX TYPE"), /* @__PURE__ */ React.createElement("input", { value: mixSlipDraft.mixType, onChange: (e) => setMixSlipDraft((d) => ({ ...d, mixType: e.target.value })), placeholder: "e.g. SP3, HMA, RHMA", style: inp })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "QUANTITY (TONS)"), /* @__PURE__ */ React.createElement("input", { type: "number", value: mixSlipDraft.quantity, onChange: (e) => setMixSlipDraft((d) => ({ ...d, quantity: e.target.value })), placeholder: "0.00", min: "0", step: "0.01", style: inp }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "TRUCK #"), /* @__PURE__ */ React.createElement("input", { value: mixSlipDraft.truckNumber, onChange: (e) => setMixSlipDraft((d) => ({ ...d, truckNumber: e.target.value })), placeholder: "Truck number or ID", style: inp })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "NOTES"), /* @__PURE__ */ React.createElement("textarea", { value: mixSlipDraft.notes, onChange: (e) => setMixSlipDraft((d) => ({ ...d, notes: e.target.value })), rows: 2, placeholder: "Any issues, delays, or notes\u2026", style: { ...inp, resize: "vertical" } }))),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "12px 18px", borderTop: "1px solid var(--asphalt-light)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setMixSlipForm(null), style: { background: "none", border: "1px solid var(--asphalt-light)", borderRadius: "5px", color: "rgba(155,148,136,0.7)", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "7px 16px", cursor: "pointer" } }, "Cancel"), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              if (!mixSlipDraft.loadTime && !mixSlipDraft.slipNumber) {
                alert("Add at least a load time or slip number.");
                return;
              }
              saveMixSlip({
                id: "ms_" + Date.now(),
                driverUsername,
                driverName: driverDisplay2,
                date: mixSlipForm.dateKey,
                jobName: mixSlipForm.jobName,
                jobNum: mixSlipForm.jobNum,
                plant: mixSlipForm.plant,
                loadTime: mixSlipDraft.loadTime,
                slipNumber: mixSlipDraft.slipNumber,
                mixType: mixSlipDraft.mixType,
                quantity: mixSlipDraft.quantity,
                truckNumber: mixSlipDraft.truckNumber,
                notes: mixSlipDraft.notes,
                submittedAt: Date.now()
              });
              setMixSlipForm(null);
            },
            style: { background: "rgba(126,203,143,0.12)", border: "1px solid rgba(126,203,143,0.45)", borderRadius: "5px", color: "#7ecb8f", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, padding: "7px 20px", cursor: "pointer" }
          },
          "\u2713 Submit Slip"
        ))
      )
    );
  })(), tab === "Dispatch Sheets" && (() => {
    const EQ_ICONS_HD = {
      paver: "\u{1F7E7}",
      roller: "\u{1F535}",
      milling: "\u2699\uFE0F",
      excavator: "\u{1F3D7}\uFE0F",
      loader: "\u{1F69C}",
      skid_steer: "\u{1F527}",
      compactor: "\u{1F7E4}",
      dump_truck: "\u{1F69B}",
      lowbed: "\u{1F69A}",
      tack_truck: "\u{1F6E2}\uFE0F",
      water_truck: "\u{1F4A7}",
      generator: "\u26A1",
      trailer: "\u{1F517}",
      tow_truck: "\u{1FA9D}",
      wrecker: "\u{1F529}",
      rollback: "\u{1F6FB}",
      other: "\u{1F4E6}"
    };
    const plan = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_lowbed_plan") || "null");
      } catch (e) {
        return null;
      }
    })();
    if (!plan || !plan.jobs || !plan.jobs.length) {
      return /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "48px 24px", color: "var(--concrete-dim)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: "40px", marginBottom: "12px" } }, "\u{1F69B}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", letterSpacing: "2px", color: "var(--concrete-dim)", marginBottom: "6px" } }, "No Lowbed Plan Active"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px" } }, "Generate a lowbed plan from the Schedule AI panel in the main app to see dispatch orders here."));
    }
    const openAndysDlg = (ji, mi) => {
      document.getElementById("_andysDlg")?.remove();
      let trucks = [{ type: "tow_truck", name: "" }];
      const truckTypeLabels = { tow_truck: "\u{1FA9D} Flatbed Tow", wrecker: "\u{1F529} Wrecker", rollback: "\u{1F6FB} Rollback" };
      const render = () => {
        const d = document.getElementById("_andysDlg");
        if (!d) return;
        d.querySelector("#_andysTruckRows").innerHTML = trucks.map((t, ti) => `
                <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
                  <select onchange="window._andysUpdateTruck(${ti},'type',this.value)"
                    style="flex:1;background:#1a1a1a;border:1px solid #555;border-radius:4px;color:#f9f7f3;font-family:'DM Mono',monospace;font-size:11px;padding:6px;">
                    <option value="tow_truck"${t.type === "tow_truck" ? " selected" : ""}>\u{1FA9D} Flatbed Tow</option>
                    <option value="wrecker"${t.type === "wrecker" ? " selected" : ""}>\u{1F529} Wrecker</option>
                    <option value="rollback"${t.type === "rollback" ? " selected" : ""}>\u{1F6FB} Rollback</option>
                  </select>
                  <input onchange="window._andysUpdateTruck(${ti},'name',this.value)" type="text" placeholder="Truck name / plate..." value="${t.name}"
                    style="flex:2;background:#1a1a1a;border:1px solid #555;border-radius:4px;color:#f9f7f3;font-family:'DM Mono',monospace;font-size:11px;padding:6px;">
                  ${trucks.length > 1 ? `<button onclick="window._andysRemoveTruck(${ti})" style="background:none;border:1px solid #555;border-radius:4px;color:#9b9488;padding:4px 8px;cursor:pointer;font-size:11px;">\u2715</button>` : ""}
                </div>`).join("");
      };
      window._andysUpdateTruck = (ti, field, val) => {
        trucks[ti][field] = val;
      };
      window._andysRemoveTruck = (ti) => {
        trucks.splice(ti, 1);
        render();
      };
      window._andysAddTruck = () => {
        trucks.push({ type: "tow_truck", name: "" });
        render();
      };
      window._andysConfirm = () => {
        const updated = JSON.parse(JSON.stringify(JSON.parse(localStorage.getItem("dmc_lowbed_plan") || "null") || plan));
        const mv2 = updated.jobs[ji].moves[mi];
        mv2.assignedDriver = "Andy's Towing";
        mv2.status = "assigned";
        mv2.claimedAt = Date.now();
        mv2.isExternalVendor = true;
        mv2.towingEquipment = trucks.filter((t) => t.name.trim()).map((t) => ({ type: t.type, name: t.name.trim() }));
        localStorage.setItem("dmc_lowbed_plan", JSON.stringify(updated));
        setLowbedPlan(updated);
        document.getElementById("_andysDlg")?.remove();
      };
      const dlg = document.createElement("div");
      dlg.id = "_andysDlg";
      dlg.style.cssText = "position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);";
      dlg.innerHTML = `<div style="background:#252525;border:2px solid #e8a94c;border-radius:10px;padding:24px 28px;min-width:min(400px,92vw);max-width:min(480px,95vw);box-shadow:0 20px 60px rgba(0,0,0,0.8);">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:#e8a94c;margin-bottom:4px;">\u{1FA9D} Assign to Andy's Towing</div>
              <div style="font-family:'DM Mono',monospace;font-size:10px;color:#9b9488;margin-bottom:16px;">Add their towing trucks for this move (optional)</div>
              <div style="font-family:'DM Mono',monospace;font-size:9px;color:#9b9488;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Towing Fleet for This Move</div>
              <div id="_andysTruckRows"></div>
              <button onclick="window._andysAddTruck()" style="width:100%;padding:7px;background:rgba(232,169,76,0.08);border:1px dashed rgba(232,169,76,0.4);border-radius:5px;color:#e8a94c;font-family:'DM Mono',monospace;font-size:10px;cursor:pointer;margin-bottom:16px;">+ Add Truck</button>
              <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('_andysDlg').remove()" style="flex:1;padding:9px;background:none;border:1px solid #555;border-radius:5px;color:#9b9488;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;">Cancel</button>
                <button onclick="window._andysConfirm()" style="flex:2;padding:9px;background:rgba(232,169,76,0.15);border:1px solid rgba(232,169,76,0.5);border-radius:5px;color:#e8a94c;font-family:'DM Mono',monospace;font-size:11px;cursor:pointer;font-weight:700;">\u2713 Confirm Assignment</button>
              </div>
            </div>`;
      document.body.appendChild(dlg);
      render();
    };
    const claimMove = (jobIdx, moveIdx) => {
      const driverName = prompt("Enter your name to claim this move:");
      if (!driverName?.trim()) return;
      const updated = JSON.parse(JSON.stringify(plan));
      const mv = updated.jobs[jobIdx].moves[moveIdx];
      mv.assignedDriver = driverName.trim();
      mv.status = "assigned";
      mv.claimedAt = Date.now();
      localStorage.setItem("dmc_lowbed_plan", JSON.stringify(updated));
      setLowbedPlan(updated);
      try {
        const job = updated.jobs[jobIdx];
        const eqLog = JSON.parse(localStorage.getItem("dmc_eq_movement_log") || "[]");
        const updated2 = eqLog.map(
          (e) => e.moveIndex === moveIdx && (job.jobNum && e.jobNum === job.jobNum || job.jobName && e.jobName === job.jobName) && e.status !== "complete" ? { ...e, driver: driverName.trim(), claimedAt: mv.claimedAt, status: "assigned" } : e
        );
        localStorage.setItem("dmc_eq_movement_log", JSON.stringify(updated2));
      } catch (ex) {
      }
    };
    const completeMove = async (jobIdx, moveIdx) => {
      const updated = JSON.parse(JSON.stringify(plan));
      const mv = updated.jobs[jobIdx].moves[moveIdx];
      mv.status = "complete";
      mv.completedAt = Date.now();
      localStorage.setItem("dmc_lowbed_plan", JSON.stringify(updated));
      setLowbedPlan(updated);
      try {
        const job = updated.jobs[jobIdx];
        const eqLog = JSON.parse(localStorage.getItem("dmc_eq_movement_log") || "[]");
        const completedAt = mv.completedAt;
        let gpsDevices2 = [];
        try {
          const base = (localStorage.getItem("dmc_claude_proxy_url") || "https://dmc-claude-proxy-production.up.railway.app/claude").replace(/\/claude$/, "");
          const r = await fetch(`${base}/gps/devices`);
          if (r.ok) {
            const d = await r.json();
            gpsDevices2 = d.result_list || [];
          }
        } catch (gpsErr) {
        }
        const equipNameMap2 = JSON.parse(localStorage.getItem("hd_equip_names") || "{}");
        const updatedLog = eqLog.map((e) => {
          if (!(e.moveIndex === moveIdx && (job.jobNum && e.jobNum === job.jobNum || job.jobName && e.jobName === job.jobName) && e.status !== "complete")) return e;
          const startTime = e.claimedAt || e.assignedAt || updated.verifiedAt || completedAt;
          const durationMinutes = Math.round((completedAt - startTime) / 6e4);
          let gpsData = {};
          const devId = Object.keys(equipNameMap2).find((id) => {
            const info = equipNameMap2[id];
            return info && (info.equipName === e.equipmentName || info.equipNum === e.equipmentName);
          });
          if (devId) {
            const dev = gpsDevices2.find((d) => d.device_id === devId);
            if (dev?.latest_device_point) {
              const pt = dev.latest_device_point;
              gpsData = {
                gpsDeviceId: devId,
                lastReportTime: pt.dt_tracker || null,
                lastKnownLat: parseFloat(pt.lat) || null,
                lastKnownLng: parseFloat(pt.lng) || null,
                lastKnownSpeedMph: pt.speed_mph != null ? Math.round(pt.speed_mph) : pt.speed != null ? Math.round(pt.speed * 0.621371) : null
              };
            }
          }
          return {
            ...e,
            status: "complete",
            completedAt,
            durationMinutes: durationMinutes > 0 ? durationMinutes : null,
            driver: mv.assignedDriver || e.driver,
            ...gpsData
          };
        });
        localStorage.setItem("dmc_eq_movement_log", JSON.stringify(updatedLog));
      } catch (ex) {
        console.warn("Failed to update eq move log on complete:", ex);
      }
    };
    const printDispatchReport = () => {
      const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "\u2014";
      const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "\u2014";
      const fmtDur = (mins) => {
        if (!mins || mins <= 0) return "";
        const h = Math.floor(mins / 60), m = mins % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
      };
      const eqLabel = (eq) => (EQ_ICONS_HD[eq.type] || "\u{1F4E6}") + " " + (eq.name || eq.type);
      const totalMov = plan.jobs.reduce((a, j) => a + (j.moves || []).length, 0);
      const doneMov = plan.jobs.reduce((a, j) => a + (j.moves || []).filter((m) => m.status === "complete").length, 0);
      const genDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const genTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      const jobsHtml = plan.jobs.map((job, ji) => {
        const jTotal = (job.moves || []).length;
        const jDone = (job.moves || []).filter((m) => m.status === "complete").length;
        const movesHtml = (job.moves || []).map((mv, mi) => {
          const isDone = mv.status === "complete";
          const isAssigned = mv.assignedDriver && !isDone;
          const statusLabel = isDone ? "COMPLETE" : isAssigned ? "IN PROGRESS" : "UNASSIGNED";
          const statusColor2 = isDone ? "#1a6b3c" : isAssigned ? "#b87800" : "#c0392b";
          const eqChips = (mv.equipment || []).map(eqLabel).join(", ") || "\u2014";
          const towChips = (mv.towingEquipment || []).map(eqLabel).join(", ");
          const deadlineStr = mv.deadline ? `${fmtDate(mv.deadline)} @ ${fmtTime(mv.deadline)}` : "";
          const completedStr = isDone ? `${fmtDate(mv.completedAt)} @ ${fmtTime(mv.completedAt)}${mv.durationMinutes ? " &nbsp;(Duration: " + fmtDur(mv.durationMinutes) + ")" : ""}` : "";
          const vendorBadge = mv.isExternalVendor ? ' <span style="background:#fff3cd;border:1px solid #e8a94c;border-radius:3px;padding:1px 6px;font-size:7pt;color:#b87800;font-weight:bold;">EXTERNAL VENDOR</span>' : "";
          return `
                  <div class="move-block" style="page-break-inside:avoid;border:1px solid #ddd;border-radius:4px;margin-bottom:10px;overflow:hidden;">
                    <div class="move-hdr" style="display:flex;justify-content:space-between;align-items:center;background:#f5f5f5;border-bottom:1px solid #ddd;padding:6px 10px;">
                      <span style="font-size:9pt;font-weight:900;letter-spacing:1px;color:#333;">MOVE ${mi + 1}</span>
                      <span style="font-size:8pt;font-weight:bold;color:${statusColor2};letter-spacing:.5px;">${statusLabel}</span>
                    </div>
                    <table style="width:100%;border-collapse:collapse;font-size:8.5pt;">
                      <tr><td class="lbl">Equipment:</td><td class="val">${eqChips}</td></tr>
                      ${towChips ? `<tr><td class="lbl">Towing Fleet:</td><td class="val" style="color:#b87800;">${towChips}</td></tr>` : ""}
                      <tr><td class="lbl">Driver:</td><td class="val">${mv.assignedDriver ? mv.assignedDriver + vendorBadge : '<span style="color:#c0392b;font-style:italic;">Unassigned</span>'}</td></tr>
                      ${mv.from || mv.to ? `<tr><td class="lbl">Route:</td><td class="val">${mv.from || "?"} &rarr; ${mv.to || "?"}</td></tr>` : ""}
                      ${deadlineStr ? `<tr><td class="lbl">Deadline:</td><td class="val" style="color:#c0392b;font-weight:bold;">${deadlineStr}</td></tr>` : ""}
                      ${completedStr ? `<tr><td class="lbl">Completed:</td><td class="val" style="color:#1a6b3c;font-weight:bold;">${completedStr}</td></tr>` : ""}
                      ${mv.notes ? `<tr><td class="lbl">Notes:</td><td class="val" style="font-style:italic;">${mv.notes}</td></tr>` : ""}
                    </table>
                    ${isDone ? `
                    <div style="border-top:1px solid #ddd;padding:8px 10px;display:flex;gap:40px;">
                      <div style="font-size:8pt;">Driver Signature: <span style="display:inline-block;width:140px;border-bottom:1px solid #000;">&nbsp;</span></div>
                      <div style="font-size:8pt;">Date: <span style="display:inline-block;width:80px;border-bottom:1px solid #000;">&nbsp;</span></div>
                    </div>` : ""}
                  </div>`;
        }).join("");
        const allEq = (job.allEquipment || []).map(eqLabel).join(" &nbsp;\xB7&nbsp; ");
        return `
                <div class="job-block" style="page-break-inside:avoid;margin-bottom:24px;">
                  <div style="background:#1a1a2e;color:#fff;padding:8px 12px;border-radius:4px 4px 0 0;display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                      <div style="font-size:13pt;font-weight:900;letter-spacing:1px;">${job.jobName || "Unnamed Job"}${job.jobNum ? ` <span style="font-size:9pt;opacity:0.65;">#${job.jobNum}</span>` : ""}</div>
                      ${job.date || job.location ? `<div style="font-size:7.5pt;opacity:0.7;margin-top:2px;">${[job.date, job.location].filter(Boolean).join(" &nbsp;\xB7&nbsp; ")}</div>` : ""}
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                      <div style="font-size:8pt;font-weight:bold;">${jDone}/${jTotal} Moves Complete</div>
                      ${allEq ? `<div style="font-size:7pt;opacity:0.6;max-width:180px;text-align:right;margin-top:2px;">${allEq}</div>` : ""}
                    </div>
                  </div>
                  <div style="padding:10px 0 0;">${movesHtml}</div>
                </div>`;
      }).join("");
      const css = `
              @page { size: letter portrait; margin: .5in .5in; }
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; background: #fff; }
              @media print { .np { display: none !important; } }
              .pb { position: fixed; top: 10px; right: 10px; z-index: 999; background: #1a1a2e; color: #fff; border: none; border-radius: 6px; padding: 9px 18px; font-size: 13px; font-weight: bold; cursor: pointer; }
              .hdr { text-align: center; padding-bottom: 12px; margin-bottom: 14px; border-bottom: 2px solid #ccc; }
              .co-name { font-size: 17pt; font-weight: 900; font-family: "Arial Black", Arial, sans-serif; letter-spacing: 1px; margin-top: 4px; }
              .co-sub { font-size: 8pt; letter-spacing: 3px; color: #666; margin-top: 2px; }
              .doc-title { font-size: 13pt; font-weight: 900; letter-spacing: 2px; text-decoration: underline; text-align: center; margin-bottom: 10px; }
              .summary-bar { display: flex; gap: 24px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 7px 12px; margin-bottom: 16px; font-size: 8.5pt; }
              .summary-bar span { font-weight: bold; }
              .lbl { font-weight: bold; padding: 5px 10px; width: 110px; vertical-align: top; white-space: nowrap; color: #444; border-bottom: 1px solid #eee; }
              .val { padding: 5px 10px; vertical-align: top; border-bottom: 1px solid #eee; }
              .footer { margin-top: 20px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 7.5pt; color: #666; display: flex; justify-content: space-between; }
              body::before { content: ''; position: fixed; top: 50%; left: 50%; width: 280px; height: 240px; transform: translate(-50%,-60%); background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 52 44'%3E%3Cpolygon points='3,0 49,22 3,44' fill='none' stroke='%23c00' stroke-width='3.5'/%3E%3Cpolygon points='11,5 41,22 11,39' fill='none' stroke='%23c00' stroke-width='2'/%3E%3C/svg%3E") center/contain no-repeat; opacity: 0.04; pointer-events: none; z-index: -1; }`;
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DMC Lowbed Dispatch Report</title><style>${css}</style></head><body>
              <button class="pb np" onclick="window.print()">&#128424; Print / Save as PDF</button>
              <div class="hdr">
                <svg width="52" height="44" viewBox="0 0 52 44" xmlns="http://www.w3.org/2000/svg"><polygon points="3,0 49,22 3,44" fill="none" stroke="#c00" stroke-width="3.5"/><polygon points="11,5 41,22 11,39" fill="none" stroke="#c00" stroke-width="2"/></svg>
                <div class="co-name"><span style="color:#c00">D</span>ON<span style="color:#333">MARTIN</span><span style="color:#c00">C</span>ORP</div>
                <div class="co-sub">DON MARTIN CORPORATION &bull; PAVING CONTRACTOR</div>
                <div class="co-sub">781.834.0071 &bull; Est. 1986</div>
              </div>
              <div class="doc-title">LOWBED DISPATCH REPORT</div>
              <div class="summary-bar">
                <div>Plan Status: <span style="color:${plan.status === "verified" ? "#1a6b3c" : "#b87800"}">${plan.status === "verified" ? "\u2713 VERIFIED" : "\u23F3 PENDING"}</span></div>
                <div>Jobs: <span>${plan.jobs.length}</span></div>
                <div>Total Moves: <span>${totalMov}</span></div>
                <div>Completed: <span style="color:${doneMov === totalMov ? "#1a6b3c" : "#b87800"}">${doneMov} / ${totalMov}</span></div>
                <div style="margin-left:auto;color:#888;">Generated: ${genDate} @ ${genTime}</div>
              </div>
              ${jobsHtml}
              <div class="footer">
                <div>DON MARTIN CORPORATION &bull; Lowbed Dispatch</div>
                <div>Generated ${genDate} &bull; Heimdall Dispatch System</div>
              </div>
            </body></html>`;
      const win = window.open("", "_blank", "width=900,height=700");
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "11px", color: "var(--concrete-dim)", display: "flex", alignItems: "center", gap: "10px" } }, /* @__PURE__ */ React.createElement("span", null, plan.status === "verified" ? "\u2705 Plan Verified" : "\u23F3 Pending Verification", " \xB7 ", plan.jobs.length, " job", plan.jobs.length !== 1 ? "s" : "", " \xB7 ", plan.jobs.reduce((a, j) => a + (j.moves || []).length, 0), " total moves")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          const p = JSON.parse(localStorage.getItem("dmc_lowbed_plan") || "null");
          setLowbedPlan(p);
        },
        style: { background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.3)", borderRadius: "6px", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "5px 12px", cursor: "pointer" }
      },
      "\u21BB Refresh"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: printDispatchReport,
        style: { background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.4)", borderRadius: "6px", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "5px 12px", cursor: "pointer", fontWeight: 700 }
      },
      "\u{1F5A8} Print Report"
    ))), plan.jobs.map((job, ji) => {
      const totalMoves = (job.moves || []).length;
      const doneMoves = (job.moves || []).filter((m) => m.status === "complete").length;
      return /* @__PURE__ */ React.createElement("div", { key: ji, style: { background: "var(--asphalt-mid)", border: "1px solid rgba(245,197,24,0.25)", borderRadius: "10px", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(245,197,24,0.08)", borderBottom: "2px solid rgba(245,197,24,0.3)", padding: "10px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "17px", letterSpacing: "2px", color: "var(--stripe)" } }, job.jobName || "Unnamed Job", job.jobNum && /* @__PURE__ */ React.createElement("span", { style: { fontSize: "11px", opacity: 0.65, marginLeft: "6px" } }, "#", job.jobNum)), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", marginTop: "1px" } }, job.date, job.location && " \xB7 " + job.location)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { background: doneMoves === totalMoves ? "rgba(126,203,143,0.15)" : "rgba(90,180,245,0.1)", border: "1px solid " + (doneMoves === totalMoves ? "rgba(126,203,143,0.4)" : "rgba(90,180,245,0.3)"), borderRadius: "20px", padding: "3px 10px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: doneMoves === totalMoves ? "#7ecb8f" : "#5ab4f5" } }, doneMoves, "/", totalMoves, " done"))), job.allEquipment?.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 14px", borderBottom: "1px solid var(--asphalt-light)", background: "rgba(245,197,24,0.03)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "5px" } }, "All Equipment for This Job"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } }, job.allEquipment.map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: ei, style: { display: "inline-flex", alignItems: "center", gap: "3px", background: "rgba(90,180,245,0.08)", border: "1px solid rgba(90,180,245,0.25)", borderRadius: "10px", padding: "3px 8px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#5ab4f5" } }, EQ_ICONS_HD[eq.type] || "\u{1F4E6}", " ", eq.name)))), (job.moves || []).map((mv, mi) => {
        const isDone = mv.status === "complete";
        const isAssigned = mv.assignedDriver && !isDone;
        return /* @__PURE__ */ React.createElement("div", { key: mi, style: { padding: "10px 14px", borderBottom: "1px solid var(--asphalt-light)", opacity: isDone ? 0.6 : 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "7px", gap: "8px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "13px", letterSpacing: "1.5px", color: "var(--concrete-dim)" } }, "MOVE ", mi + 1), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } }, isDone && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(126,203,143,0.15)", border: "1px solid rgba(126,203,143,0.4)", borderRadius: "20px", padding: "2px 9px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ecb8f" } }, "\u2713 Complete"), isAssigned && /* @__PURE__ */ React.createElement("span", { style: { background: mv.isExternalVendor ? "rgba(232,169,76,0.12)" : "rgba(245,197,24,0.1)", border: "1px solid " + (mv.isExternalVendor ? "rgba(232,169,76,0.45)" : "rgba(245,197,24,0.35)"), borderRadius: "20px", padding: "2px 9px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: mv.isExternalVendor ? "#e8a94c" : "var(--stripe)" } }, mv.isExternalVendor ? "\u{1FA9D}" : "\u{1F69B}", " ", mv.assignedDriver), !mv.assignedDriver && !isDone && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(255,100,100,0.1)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "20px", padding: "2px 9px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#ff6464" } }, "Unassigned"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "6px" } }, (mv.equipment || []).map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: ei, style: { display: "inline-flex", alignItems: "center", gap: "3px", background: "rgba(245,197,24,0.1)", border: "1px solid rgba(245,197,24,0.28)", borderRadius: "10px", padding: "3px 8px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--stripe)" } }, EQ_ICONS_HD[eq.type] || "\u{1F4E6}", " ", eq.name)), (mv.towingEquipment || []).map((eq, ei) => /* @__PURE__ */ React.createElement("span", { key: "t" + ei, style: { display: "inline-flex", alignItems: "center", gap: "3px", background: "rgba(232,169,76,0.1)", border: "1px solid rgba(232,169,76,0.35)", borderRadius: "10px", padding: "3px 8px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#e8a94c" } }, EQ_ICONS_HD[eq.type] || "\u{1FA9D}", " ", eq.name))), mv.notes && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", marginBottom: "8px" } }, mv.notes), !isDone && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, !mv.assignedDriver && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => claimMove(ji, mi),
            style: { flex: 1, minWidth: "100px", padding: "7px", background: "rgba(90,180,245,0.1)", border: "1px solid rgba(90,180,245,0.35)", borderRadius: "5px", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "10px", cursor: "pointer", fontWeight: 700 }
          },
          "\u270B Claim Move"
        ), !mv.assignedDriver && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => openAndysDlg(ji, mi),
            style: { flex: 1, minWidth: "100px", padding: "7px", background: "rgba(232,169,76,0.08)", border: "1px solid rgba(232,169,76,0.4)", borderRadius: "5px", color: "#e8a94c", fontFamily: "'DM Mono',monospace", fontSize: "10px", cursor: "pointer", fontWeight: 700 }
          },
          "\u{1FA9D} Andy's Towing"
        ), (mv.assignedDriver || plan.status === "verified") && /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => completeMove(ji, mi),
            style: { flex: 1, minWidth: "100px", padding: "7px", background: "rgba(126,203,143,0.1)", border: "1px solid rgba(126,203,143,0.35)", borderRadius: "5px", color: "#7ecb8f", fontFamily: "'DM Mono',monospace", fontSize: "10px", cursor: "pointer", fontWeight: 700 }
          },
          "\u2713 Mark Complete"
        )));
      }));
    }));
  })(), tab === "Daily Schedule" && /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, ["2026-03-26", "2026-03-27"].map((day) => /* @__PURE__ */ React.createElement("div", { key: day, className: "bg-white rounded-lg border overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "bg-yellow-400 px-3 py-2 font-bold text-sm text-black" }, (/* @__PURE__ */ new Date(day + "T12:00:00")).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })), dispatches.filter((d) => d.date === day).map((d) => /* @__PURE__ */ React.createElement("div", { key: d.id, className: "px-3 py-2 border-b last:border-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-3 items-start mb-2" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-bold text-yellow-600 mt-0.5 w-10 shrink-0" }, d.time), /* @__PURE__ */ React.createElement("div", { className: "text-xs flex-1" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-gray-800" }, d.driverName, " hauls ", d.eqId), /* @__PURE__ */ React.createElement("div", { className: "text-gray-500" }, d.from, " \u2192 ", d.to, " \xB7 ", d.miles, " mi"), /* @__PURE__ */ React.createElement("div", { className: "text-gray-500" }, "Job: ", d.jobName), /* @__PURE__ */ React.createElement("div", { className: `inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(d.status)}` }, d.status))))), dispatches.filter((d) => d.date === day).length === 0 && /* @__PURE__ */ React.createElement("div", { className: "px-3 py-4 text-xs text-gray-400 text-center" }, "No moves scheduled this day"))), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-lg border p-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-sm text-gray-700 mb-2" }, "Driver Availability"), mockDrivers.map((dr) => /* @__PURE__ */ React.createElement("div", { key: dr.id, className: "flex justify-between items-center py-1.5 border-b last:border-0 text-xs" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-gray-800" }, dr.name), /* @__PURE__ */ React.createElement("div", { className: "text-gray-500" }, dr.truck, " \xB7 ", dr.phone)), /* @__PURE__ */ React.createElement("span", { className: `px-2 py-0.5 rounded-full font-medium ${dr.available ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}` }, dr.available ? "Available" : "On Haul"))))), tab === "Field Intel" && (() => {
    const jobsWithMedia = jobList.filter(
      (j2) => intelFiMedia.some((m) => m.jobNum === (j2.num || j2.id) || m.jobId === j2.id)
    );
    const jobsWithReports = jobList.filter(
      (j2) => intelResults.some((r) => r.jobNum === (j2.num || j2.id) || r.jobId === j2.id)
    );
    const activeJobIds = /* @__PURE__ */ new Set([
      ...jobsWithMedia.map((j2) => j2.id),
      ...jobsWithReports.map((j2) => j2.id)
    ]);
    const allJobsList = [
      ...jobList.filter((j2) => activeJobIds.has(j2.id)),
      ...jobList.filter((j2) => !activeJobIds.has(j2.id))
    ];
    if (!intelFolderJob) return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("div", { className: "text-sm font-semibold text-gray-600" }, "Field Intel \u2014 Job Folders"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, intelFiMedia.length, " files \xB7 ", intelResults.length, " reports \xB7 ", autoReports.length, " auto")), !isDriverUser && /* @__PURE__ */ React.createElement("div", { className: "bg-yellow-50 border border-yellow-300 rounded-lg p-3 flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-sm font-bold text-gray-800" }, "\u{1F4F1} Quick Send Photo"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mt-0.5" }, geoEnabled ? "\u{1F4CD} GPS ON \u2014 auto-sorts to nearest job folder" : "\u{1F4CD} GPS OFF \u2014 sends to Miscellaneous")), /* @__PURE__ */ React.createElement("label", { className: `shrink-0 px-3 py-2 rounded text-xs font-bold cursor-pointer transition-colors ${quickSending ? "bg-gray-200 text-gray-400" : "bg-yellow-400 text-black hover:bg-yellow-300"}` }, quickSending ? "\u23F3 Sending\u2026" : "\u{1F4F7} Select", /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", className: "hidden", ref: quickSendRef, onChange: handleQuickSend, disabled: quickSending }))), /* @__PURE__ */ React.createElement("div", { className: "flex justify-end mb-1" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setShowWorkPhotos(true),
        className: "rounded-lg border-2 border-blue-300 bg-blue-50 p-3 cursor-pointer hover:shadow-md hover:border-blue-400 transition-all w-36 text-right"
      },
      /* @__PURE__ */ React.createElement("div", { className: "text-lg mb-1" }, "\u{1F4F8}"),
      /* @__PURE__ */ React.createElement("div", { className: "text-xs font-bold text-blue-800" }, "Work Photos"),
      /* @__PURE__ */ React.createElement("div", { className: "text-xs text-blue-600 mt-0.5" }, workPhotos.length, " photo", workPhotos.length !== 1 ? "s" : ""),
      workPhotoFolders.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "text-xs text-blue-500 mt-0.5" }, workPhotoFolders.length, " sub-folder", workPhotoFolders.length !== 1 ? "s" : "")
    )), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-3" }, allJobsList.map((j2) => {
      const jNum2 = j2.num || j2.id;
      const mediaCount = intelFiMedia.filter((m) => m.jobNum === jNum2 || m.jobId === j2.id).length;
      const reportCount = intelResults.filter((r) => r.jobNum === jNum2 || r.jobId === j2.id).length;
      const planCount = planResults.filter((p) => p.jobNum === jNum2 || p.jobId === j2.id).length;
      const autoCount = autoReports.filter((r) => r.jobNum === jNum2 || j2.name && (r.jobName || "").toLowerCase() === j2.name.toLowerCase()).length;
      const hasActivity = mediaCount > 0 || reportCount > 0 || planCount > 0 || autoCount > 0;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: j2.id,
          onClick: () => {
            setIntelFolderJob(j2);
            setIntelJob(j2.id);
          },
          className: `rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md ${hasActivity ? "bg-yellow-50 border-yellow-200" : "bg-white border-gray-200 hover:border-yellow-300"}`
        },
        /* @__PURE__ */ React.createElement("div", { className: "text-lg mb-1" }, hasActivity ? "\u{1F4C2}" : "\u{1F4C1}"),
        /* @__PURE__ */ React.createElement("div", { className: "text-xs font-bold text-gray-800 leading-tight" }, j2.num ? `#${j2.num}` : j2.id),
        /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-600 mt-0.5 leading-tight truncate" }, j2.name),
        /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-2 flex-wrap" }, mediaCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium" }, "\u{1F4F7} ", mediaCount), reportCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium" }, "\u{1F50D} ", reportCount), planCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium" }, "\u{1F4D0} ", planCount), autoCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium" }, "\u{1F4F1} ", autoCount), !hasActivity && /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-400" }, "No data yet"))
      );
    })), (() => {
      const miscReports = autoReports.filter((r) => !r.jobNum && !r.jobName);
      if (!miscReports.length) return null;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: () => setIntelFolderJob({ id: "__misc__", name: "Miscellaneous", num: "" }),
          className: "rounded-lg border p-3 cursor-pointer bg-gray-50 border-gray-300 hover:border-yellow-300 transition-all"
        },
        /* @__PURE__ */ React.createElement("div", { className: "text-lg mb-1" }, "\u{1F4C1}"),
        /* @__PURE__ */ React.createElement("div", { className: "text-xs font-bold text-gray-700" }, "Miscellaneous"),
        /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mt-0.5" }, "Unmatched / GPS off"),
        /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium" }, "\u{1F4F1} ", miscReports.length))
      );
    })(), /* @__PURE__ */ React.createElement("div", { className: "bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500 space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-gray-700" }, "\u{1F4A1} Getting photos from Meta Ray-Ban glasses:"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, "Manual:"), " Capture \u2192 Meta View app \u2192 open job folder above \u2192 upload \u2192 analyze"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, "Auto (iOS Shortcut):"), " Save photo to camera roll \u2192 shortcut auto-sends to Claude \u2192 report appears here instantly under \u{1F4F1}"), /* @__PURE__ */ React.createElement("div", { className: "text-gray-400" }, "Auto reports are matched by GPS to the nearest job site within 0.5 mi.")));
    if (showWorkPhotos) {
      const currentPhoto = wpNamingQueue[wpNamingIdx];
      const subFolders = ["All", ...workPhotoFolders];
      const displayPhotos = wpActiveSub === "All" ? workPhotos : workPhotos.filter((p) => p.subFolder === wpActiveSub);
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, currentPhoto && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60" }, /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-xl shadow-2xl p-5 w-80 max-w-full space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-bold text-gray-800 text-sm" }, "\u{1F4F8} Name This Photo"), currentPhoto.preview && /* @__PURE__ */ React.createElement("img", { src: currentPhoto.preview, alt: "", className: "w-full h-32 object-cover rounded border" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mb-1" }, "Display Name"), /* @__PURE__ */ React.createElement(
        "input",
        {
          autoFocus: true,
          className: "w-full border rounded px-2 py-1.5 text-xs outline-none focus:border-blue-400",
          value: currentPhoto.displayName,
          onChange: (e) => {
            const q = [...wpNamingQueue];
            q[wpNamingIdx] = { ...q[wpNamingIdx], displayName: e.target.value };
            setWpNamingQueue(q);
          }
        }
      )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mb-1" }, "Sub-folder (optional)"), /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "w-full border rounded px-2 py-1.5 text-xs outline-none focus:border-blue-400",
          value: currentPhoto.subFolder,
          onChange: (e) => {
            const q = [...wpNamingQueue];
            q[wpNamingIdx] = { ...q[wpNamingIdx], subFolder: e.target.value === "__new__" ? "" : e.target.value };
            setWpNamingQueue(q);
            if (e.target.value === "__new__") setWpShowNewFolder(true);
          }
        },
        /* @__PURE__ */ React.createElement("option", { value: "" }, "No sub-folder"),
        workPhotoFolders.map((f) => /* @__PURE__ */ React.createElement("option", { key: f, value: f }, f)),
        /* @__PURE__ */ React.createElement("option", { value: "__new__" }, "+ New sub-folder\u2026")
      ), wpShowNewFolder && /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-1.5" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "flex-1 border rounded px-2 py-1 text-xs outline-none focus:border-blue-400",
          placeholder: "Sub-folder name\u2026",
          value: wpNewFolder,
          onChange: (e) => setWpNewFolder(e.target.value),
          onKeyDown: (e) => e.key === "Enter" && createWorkSubFolder()
        }
      ), /* @__PURE__ */ React.createElement("button", { onClick: createWorkSubFolder, className: "bg-blue-500 text-white text-xs px-2 py-1 rounded hover:bg-blue-600" }, "Add"))), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, wpNamingIdx + 1, " of ", wpNamingQueue.length), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setWpNamingQueue([]);
            setWpNamingIdx(0);
            setWpShowNewFolder(false);
          },
          className: "flex-1 border rounded py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        },
        "Cancel"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => commitWpPhoto({ id: currentPhoto.id, fileName: currentPhoto.fileName, displayName: currentPhoto.displayName || currentPhoto.fileName, subFolder: currentPhoto.subFolder || "", dataUrl: currentPhoto.dataUrl, preview: currentPhoto.preview, uploadedAt: Date.now() }),
          className: "flex-1 bg-blue-500 text-white rounded py-1.5 text-xs font-bold hover:bg-blue-600"
        },
        "Save \u2192"
      )))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setShowWorkPhotos(false);
            setWpActiveSub("All");
          },
          className: "text-xs text-gray-500 hover:text-gray-700 font-semibold flex items-center gap-1"
        },
        "\u2190 All Jobs"
      ), /* @__PURE__ */ React.createElement("div", { className: "text-sm font-bold text-gray-800" }, "\u{1F4F8} Work Photos"), /* @__PURE__ */ React.createElement("label", { className: "bg-blue-500 text-white text-xs px-3 py-1.5 rounded cursor-pointer hover:bg-blue-600 font-bold" }, "+ Upload", /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", multiple: true, className: "hidden", ref: workPhotoFileRef, onChange: handleWorkPhotoSelect }))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 overflow-x-auto pb-1" }, subFolders.map((sf) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: sf,
          onClick: () => setWpActiveSub(sf),
          className: `shrink-0 text-xs px-3 py-1 rounded-full border font-medium transition-colors ${wpActiveSub === sf ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`
        },
        sf,
        sf !== "All" && /* @__PURE__ */ React.createElement("span", { className: "ml-1 opacity-60" }, "(", workPhotos.filter((p) => p.subFolder === sf).length, ")")
      )), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setWpShowNewFolder((v) => !v),
          className: "shrink-0 text-xs px-3 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
        },
        "+ Sub-folder"
      )), wpShowNewFolder && !currentPhoto && /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          autoFocus: true,
          className: "flex-1 border rounded px-2 py-1.5 text-xs outline-none focus:border-blue-400",
          placeholder: "New sub-folder name\u2026",
          value: wpNewFolder,
          onChange: (e) => setWpNewFolder(e.target.value),
          onKeyDown: (e) => e.key === "Enter" && createWorkSubFolder()
        }
      ), /* @__PURE__ */ React.createElement("button", { onClick: createWorkSubFolder, className: "bg-blue-500 text-white text-xs px-3 py-1 rounded hover:bg-blue-600" }, "Create"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        setWpShowNewFolder(false);
        setWpNewFolder("");
      }, className: "border text-xs px-3 py-1 rounded text-gray-500 hover:bg-gray-50" }, "Cancel")), displayPhotos.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "text-center text-gray-400 text-xs py-12 border-2 border-dashed border-gray-200 rounded-lg" }, wpActiveSub === "All" ? "No work photos yet \u2014 tap + Upload to add" : `No photos in "${wpActiveSub}"`) : /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-3 gap-2" }, displayPhotos.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "relative group rounded-lg overflow-hidden bg-gray-100 aspect-square border border-gray-200" }, p.preview || p.dataUrl ? /* @__PURE__ */ React.createElement("img", { src: p.preview || p.dataUrl, alt: p.displayName, className: "w-full h-full object-cover" }) : /* @__PURE__ */ React.createElement("div", { className: "w-full h-full flex items-center justify-center text-2xl" }, "\u{1F4F7}"), /* @__PURE__ */ React.createElement("div", { className: "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "text-white text-xs font-medium leading-tight truncate" }, p.displayName), p.subFolder && /* @__PURE__ */ React.createElement("div", { className: "text-white/60 text-xs leading-tight truncate" }, p.subFolder)), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => deleteWorkPhoto(p.id),
          className: "absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs items-center justify-center hidden group-hover:flex leading-none"
        },
        "\u2715"
      )))), workPhotoFolders.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "border-t pt-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-500 mb-2" }, "Sub-folders"), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, workPhotoFolders.map((f) => /* @__PURE__ */ React.createElement("div", { key: f, className: "flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-700" }, f), /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-400" }, "(", workPhotos.filter((p) => p.subFolder === f).length, ")"), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => saveWorkPhotoFolderList(workPhotoFolders.filter((x) => x !== f)),
          className: "text-gray-400 hover:text-red-500 text-xs leading-none ml-0.5"
        },
        "\u2715"
      ))))));
    }
    const j = intelFolderJob;
    const isMisc = j.id === "__misc__";
    const jNum = j.num || j.id;
    const folderMedia = isMisc ? [] : intelFiMedia.filter((m) => m.jobNum === jNum || m.jobId === j.id);
    const folderReports = isMisc ? [] : intelResults.filter((r) => r.jobNum === jNum || r.jobId === j.id);
    const folderPlans = isMisc ? [] : planResults.filter((p) => p.jobNum === jNum || p.jobId === j.id);
    const folderAuto = isMisc ? autoReports.filter((r) => !r.jobNum && !r.jobName) : autoReports.filter((r) => r.jobNum === jNum || j.name && (r.jobName || "").toLowerCase() === j.name.toLowerCase());
    return /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          setIntelFolderJob(null);
          setIntelJob("");
          setIntelPhotos([]);
        },
        className: "text-xs text-gray-500 hover:text-gray-700 font-semibold flex items-center gap-1"
      },
      "\u2190 All Jobs"
    ), /* @__PURE__ */ React.createElement("div", { className: "text-gray-300" }, "|"), /* @__PURE__ */ React.createElement("div", { className: "text-sm font-bold text-gray-800" }, "\u{1F4C2} ", j.num ? `#${j.num}` : j.id, " \xB7 ", j.name)), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-lg border p-3" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold text-sm text-gray-700 mb-2" }, "\u{1F4F7} Field Media Log ", /* @__PURE__ */ React.createElement("span", { className: "font-normal text-gray-400" }, "(", folderMedia.length, " files)")), folderMedia.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2 mb-3" }, folderMedia.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "text-center" }, /* @__PURE__ */ React.createElement("div", { className: "w-16 h-14 bg-gray-100 rounded border flex items-center justify-center text-xl" }, m.fileType === "video" ? "\u{1F3A5}" : "\u{1F4F7}"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mt-0.5 w-16 truncate" }, m.fileName), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, m.date)))), /* @__PURE__ */ React.createElement("div", { className: "border-t pt-3 space-y-2" }, planResults.length > 0 && /* @__PURE__ */ React.createElement(
      "select",
      {
        value: intelPlanIdx,
        onChange: (e) => setIntelPlanIdx(e.target.value),
        className: "w-full border rounded px-2 py-1.5 text-xs outline-none focus:border-blue-400"
      },
      /* @__PURE__ */ React.createElement("option", { value: "" }, "Cross-reference with a plan (optional)\u2026"),
      planResults.map((r, i) => /* @__PURE__ */ React.createElement("option", { key: i, value: i }, r.jobName || r.jobNum || "Unknown", " \xB7 ", r.fileName, " (", r.date, ")"))
    ), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-700" }, "\u{1F4CD} GPS Location Verification"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400 mt-0.5" }, geoEnabled ? "Only photos taken within 0.5 mi of this job site are analyzed" : "Off \u2014 all photos accepted regardless of location")), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: toggleGeo,
        className: `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${geoEnabled ? "bg-green-500" : "bg-gray-300"}`
      },
      /* @__PURE__ */ React.createElement("span", { className: `pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${geoEnabled ? "translate-x-5" : "translate-x-0"}` })
    )), /* @__PURE__ */ React.createElement("label", { className: "block border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-yellow-400 transition-colors" }, /* @__PURE__ */ React.createElement("div", { className: "text-2xl mb-0.5" }, "\u{1F4F7}"), /* @__PURE__ */ React.createElement("div", { className: "text-xs font-medium text-gray-600" }, "Add site photos / videos"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, geoEnabled ? "GPS verified \xB7 off-site photos blocked" : "GPS verification off \xB7 all photos accepted"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "file",
        accept: "image/*,video/*",
        multiple: true,
        className: "hidden",
        ref: intelFileRef,
        onChange: (e) => handlePhotoUpload(e, j.address || j.location || j.name)
      }
    )), intelPhotos.length > 0 && (() => {
      const images = intelPhotos.filter((p) => !p.isVideo);
      const videos = intelPhotos.filter((p) => p.isVideo);
      const onSite = images.filter((p) => p.geo?.onSite === true);
      const offSite = images.filter((p) => p.geo?.onSite === false);
      const noGps = images.filter((p) => p.geo?.noGps);
      const unknown = images.filter((p) => !p.geo?.noGps && p.geo?.onSite === null);
      const hasOffSite = offSite.length > 0;
      const analyzable = images.filter((p) => p.geo?.onSite !== false);
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-1.5 text-xs" }, geoEnabled && onSite.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium" }, "\u2705 ", onSite.length, " on-site"), geoEnabled && offSite.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium" }, "\u{1F6AB} ", offSite.length, " off-site"), geoEnabled && noGps.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium" }, "\u{1F4CD} ", noGps.length, " no GPS"), geoEnabled && unknown.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium" }, "\u23F3 ", unknown.length, " checking\u2026"), !geoEnabled && images.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium" }, "\u{1F4CD} GPS off \xB7 ", images.length, " photo", images.length !== 1 ? "s" : "", " accepted"), videos.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium" }, "\u{1F3A5} ", videos.length, " video")), /* @__PURE__ */ React.createElement("div", { className: "flex gap-1.5 overflow-x-auto pb-1" }, intelPhotos.map((p, i) => {
        const geo = p.geo || {};
        let badgeBg = "bg-gray-500", badgeText = "\u{1F4CD}", badgeTip = "No GPS data";
        if (p.isVideo) {
          badgeBg = "bg-blue-600";
          badgeText = "\u{1F3A5}";
          badgeTip = "Video \u2014 logged only";
        } else if (geo.noGps) {
          badgeBg = "bg-gray-400";
          badgeText = "\u{1F4CD}";
          badgeTip = "No GPS in file";
        } else if (geo.onSite === true) {
          badgeBg = "bg-green-500";
          badgeText = "\u2705";
          badgeTip = `On-site \xB7 ${geo.distanceMiles?.toFixed(2)} mi from job`;
        } else if (geo.onSite === false) {
          badgeBg = "bg-red-500";
          badgeText = "\u{1F6AB}";
          badgeTip = `Off-site \xB7 ${geo.distanceMiles?.toFixed(1)} mi from job`;
        } else {
          badgeBg = "bg-yellow-400";
          badgeText = "\u23F3";
          badgeTip = "Checking location\u2026";
        }
        return /* @__PURE__ */ React.createElement("div", { key: i, className: "relative shrink-0", title: badgeTip }, p.isVideo ? /* @__PURE__ */ React.createElement("div", { className: "w-16 h-14 bg-gray-800 rounded flex items-center justify-center text-xl" }, "\u{1F3A5}") : /* @__PURE__ */ React.createElement("img", { src: p.preview, alt: p.name, className: `w-16 h-14 object-cover rounded border-2 ${geo.onSite === false ? "border-red-400 opacity-60" : geo.onSite === true ? "border-green-400" : "border-gray-200"}` }), /* @__PURE__ */ React.createElement("div", { className: `absolute bottom-0.5 left-0.5 ${badgeBg} rounded text-white text-xs px-0.5 leading-tight` }, badgeText), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => removePhoto(i),
            className: "absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center leading-none"
          },
          "\u2715"
        ));
      })), geoEnabled && hasOffSite && /* @__PURE__ */ React.createElement("div", { className: "bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700" }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, "\u{1F6AB} ", offSite.length, " photo", offSite.length !== 1 ? "s" : "", " taken more than 0.5 mi from this job site"), " \u2014 ", offSite.map((p) => p.name).join(", "), /* @__PURE__ */ React.createElement("br", null), "Off-site photos are excluded from analysis. Remove them or proceed with on-site photos only."), geoEnabled && noGps.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-600" }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, "\u{1F4CD} ", noGps.length, " photo", noGps.length !== 1 ? "s" : "", " have no GPS data"), " \u2014 included in analysis but location unverified. Make sure Location is enabled in Meta View app settings."), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500" }, analyzable.length, " photo", analyzable.length !== 1 ? "s" : "", " will be analyzed", videos.length > 0 ? ` \xB7 ${videos.length} video${videos.length !== 1 ? "s" : ""} logged only` : "", intelPlanIdx !== "" ? " \xB7 cross-referencing with plan" : ""), !isDriverUser && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: analyzeIntel,
          disabled: intelAnalyzing || analyzable.length === 0,
          className: "w-full bg-yellow-400 text-black font-bold text-sm py-2 rounded hover:bg-yellow-300 disabled:opacity-50 transition-colors"
        },
        intelAnalyzing ? "\u23F3 Analyzing site\u2026" : `\u{1F50D} Generate Field Intel Report (${analyzable.length} photo${analyzable.length !== 1 ? "s" : ""})`
      ), intelAnalyzing && /* @__PURE__ */ React.createElement("div", { className: "bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700 text-center" }, "\u23F3 Claude is analyzing your site photos", intelPlanIdx !== "" ? ", cross-referencing with the civil plan," : "", " generating surface area estimates, phasing, and mix quantities\u2026")));
    })())), folderReports.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-500 uppercase tracking-wide" }, "Field Intel Reports (", folderReports.length, ")"), folderReports.map((r, i) => /* @__PURE__ */ React.createElement(
      AnalysisCard,
      {
        key: i,
        result: r,
        headerColor: "bg-blue-900",
        onPushToPricing: pushToPricing,
        onDelete: () => deleteIntelResult(intelResults.indexOf(r))
      }
    ))), folderPlans.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-500 uppercase tracking-wide" }, "Civil Plan Analyses (", folderPlans.length, ")"), folderPlans.map((r, i) => /* @__PURE__ */ React.createElement(
      AnalysisCard,
      {
        key: i,
        result: r,
        headerColor: "bg-gray-800",
        onPushToPricing: pushToPricing,
        onDelete: () => deletePlanResult(planResults.indexOf(r))
      }
    ))), folderAuto.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-semibold text-gray-500 uppercase tracking-wide" }, "\u{1F4F1} Auto-Captured Reports (", folderAuto.length, ")"), folderAuto.map((r, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "bg-white rounded-lg border border-emerald-200 p-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center mb-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-bold text-gray-800" }, "\u{1F4F1} Auto Report \xB7 ", r.withinRange ? "\u2705 On-site" : r.distanceMiles != null ? `\u26A0 ${r.distanceMiles} mi` : "\u{1F4CD} No GPS"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, r.date)), r.note && /* @__PURE__ */ React.createElement("div", { className: "text-xs text-blue-600 mb-1" }, "\u{1F4DD} ", r.note), /* @__PURE__ */ React.createElement("pre", { className: "text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto font-sans" }, r.analysis)))), folderReports.length === 0 && folderPlans.length === 0 && folderAuto.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-center text-sm text-gray-400 py-4" }, "No reports yet for this job. Upload photos above and run analysis."));
  })(), tab === "Conflicts" && (() => {
    const activeConflicts = planConflicts.filter((c) => {
      if (c._planConflict) {
        if (!lowbedPlan || !c._primaryMove) return true;
        const _cj = lowbedPlan.jobs[c._primaryMove.jobIdx];
        if (!_cj) return true;
        const _cm = _cj.moves[c._primaryMove.moveIdx];
        return !(_cm && _cm.overridden);
      }
      try {
        return !JSON.parse(localStorage.getItem("conflict_override_" + c.id) || "false");
      } catch (e) {
        return true;
      }
    });
    const overriddenConflicts = planConflicts.filter((c) => !activeConflicts.includes(c));
    const isEquipConflict = (c) => c.type === "Equipment Double-Booked" || c.type === "Equipment Not Returned" || c.type.toLowerCase().includes("equipment");
    const isDriverConflict = (c) => c.type === "Driver Double-Booked" || c.type === "Driver Unavailable" || c.type.toLowerCase().includes("driver");
    return /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-sm font-semibold text-gray-600" }, activeConflicts.length, " Active Conflict", activeConflicts.length !== 1 ? "s" : "", " Detected"), activeConflicts.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "rounded-lg border border-green-200 bg-green-50 p-4 text-center text-sm text-green-700" }, "No active conflicts detected."), activeConflicts.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.id, className: `rounded-lg border p-3 ${severityColor(c.severity)}` }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-start mb-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-bold" }, c.id, " \xB7 ", c.type), /* @__PURE__ */ React.createElement("span", { className: `text-xs px-2 py-0.5 rounded-full font-bold border ${severityColor(c.severity)}` }, c.severity)), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-700 mb-2 leading-relaxed" }, c.desc), /* @__PURE__ */ React.createElement("div", { className: "bg-white bg-opacity-70 rounded p-2 text-xs mb-2" }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, "Suggested Fix: "), c.resolution), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-500 mb-2" }, "Affected Job: ", c.affectedJob), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" } }, isEquipConflict(c) && c._planConflict && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          const opts = getAvailableEquipment(c);
          setConflictModal({ type: "reassignEquip", conflict: c, options: opts });
        },
        style: { background: "#5ab4f5", color: "#000", border: "none", borderRadius: "4px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono',monospace" }
      },
      "\u{1F504} Reassign Equipment"
    ), isDriverConflict(c) && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          if (!c._planConflict) {
            window.alert("Driver reassignment is only available for plan-detected conflicts.");
            return;
          }
          const opts = getAvailableDrivers(c);
          setConflictModal({ type: "reassignDriver", conflict: c, options: opts });
        },
        style: { background: "#7ecb8f", color: "#000", border: "none", borderRadius: "4px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono',monospace" }
      },
      "\u{1F464} Reassign Driver"
    ), c._planConflict && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => deferMove(c),
        style: { background: "var(--stripe)", color: "#000", border: "none", borderRadius: "4px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono',monospace" }
      },
      "\u{1F4C5} Defer 1 Day"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => overrideConflict(c),
        style: { background: "var(--orange)", color: "#fff", border: "none", borderRadius: "4px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono',monospace" }
      },
      "\u26A0 Override"
    )))), overriddenConflicts.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "12px" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setShowOverridden((s) => !s),
        style: { background: "transparent", border: "1px solid var(--asphalt-light)", borderRadius: "4px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, color: "var(--concrete-dim)", cursor: "pointer", fontFamily: "'DM Mono',monospace", width: "100%", textAlign: "left" }
      },
      showOverridden ? "\u25BE" : "\u25B8",
      " ",
      overriddenConflicts.length,
      " Overridden Conflict",
      overriddenConflicts.length !== 1 ? "s" : ""
    ), showOverridden && /* @__PURE__ */ React.createElement("div", { className: "space-y-2 mt-2" }, overriddenConflicts.map((c) => {
      let note = "(no note)";
      if (c._planConflict && c._primaryMove && lowbedPlan) {
        const _oj = lowbedPlan.jobs[c._primaryMove.jobIdx];
        const _om = _oj && _oj.moves[c._primaryMove.moveIdx];
        if (_om) note = _om.overrideNote || note;
      } else {
        try {
          note = localStorage.getItem("conflict_override_note_" + c.id) || note;
        } catch (e) {
        }
      }
      return /* @__PURE__ */ React.createElement("div", { key: c.id, style: { border: "1px solid var(--asphalt-light)", borderRadius: "6px", padding: "10px", opacity: 0.65 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: "4px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "11px", fontWeight: 700 } }, c.id, " \xB7 ", c.type), /* @__PURE__ */ React.createElement("span", { style: { fontSize: "10px", background: "var(--asphalt-light)", borderRadius: "3px", padding: "1px 6px", color: "var(--concrete-dim)" } }, "Overridden")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: "11px", color: "var(--concrete-dim)", marginBottom: "3px" } }, c.desc), /* @__PURE__ */ React.createElement("div", { style: { fontSize: "10px", color: "var(--orange)" } }, "Note: ", note));
    }))));
  })(), conflictModal && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { background: "var(--asphalt-mid)", border: "1px solid var(--stripe)", borderRadius: "10px", padding: "20px", maxWidth: "360px", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: "14px", marginBottom: "4px", fontFamily: "'DM Mono',monospace", color: "var(--stripe)" } }, conflictModal.type === "reassignEquip" ? "\u{1F504} Reassign Equipment" : "\u{1F464} Reassign Driver"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: "11px", color: "var(--concrete-dim)", marginBottom: "12px" } }, conflictModal.type === "reassignEquip" ? "Select a replacement not assigned during this window:" : "Select an available driver not assigned during this window:"), /* @__PURE__ */ React.createElement("div", { style: { overflowY: "auto", flex: 1, marginBottom: "12px" } }, conflictModal.options.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: "12px", color: "var(--concrete-dim)", textAlign: "center", padding: "12px" } }, "No available ", conflictModal.type === "reassignEquip" ? "equipment" : "drivers", " found for this window."), conflictModal.options.map((opt, i) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: i,
      onClick: () => {
        if (conflictModal.type === "reassignEquip") {
          reassignEquipment(conflictModal.conflict, opt);
        } else {
          reassignDriver(conflictModal.conflict, opt);
        }
      },
      style: { display: "block", width: "100%", textAlign: "left", background: "var(--asphalt-light)", border: "1px solid var(--asphalt-light)", borderRadius: "5px", padding: "8px 10px", marginBottom: "6px", color: "var(--white)", fontSize: "12px", cursor: "pointer", fontFamily: "'DM Mono',monospace" }
    },
    conflictModal.type === "reassignEquip" ? opt.name + " (" + opt.type + ")" : opt
  ))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setConflictModal(null),
      style: { background: "transparent", border: "1px solid var(--asphalt-light)", borderRadius: "4px", padding: "7px", fontSize: "12px", color: "var(--concrete-dim)", cursor: "pointer", fontFamily: "'DM Mono',monospace" }
    },
    "Cancel"
  ))), tab === "Export" && (() => {
    const [schedCapturing, setSchedCapturing] = React.useState(false);
    const exportDispatchPDF = () => {
      const plan = (() => {
        try {
          return JSON.parse(localStorage.getItem("dmc_lowbed_plan") || "null");
        } catch (e) {
          return null;
        }
      })();
      const today = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      let rows = "";
      if (plan && plan.jobs && plan.jobs.length) {
        plan.jobs.forEach((job) => {
          rows += `<tr><td colspan="6" style="background:#f0f0f0;font-weight:bold;padding:8px 6px;border-top:2px solid #333;">${job.name || job.id || "Unnamed Job"}</td></tr>`;
          (job.moves || []).forEach((move, idx) => {
            rows += `<tr><td style="padding:6px;border:1px solid #ccc;text-align:center;">${idx + 1}</td><td style="padding:6px;border:1px solid #ccc;">${move.equipment || "\u2014"}</td><td style="padding:6px;border:1px solid #ccc;">${move.from || "\u2014"}</td><td style="padding:6px;border:1px solid #ccc;">${move.to || "\u2014"}</td><td style="padding:6px;border:1px solid #ccc;">${move.assignedDriver || move.driver || "\u2014"}</td><td style="padding:6px;border:1px solid #ccc;">${move.status || "\u2014"}</td></tr>`;
          });
        });
      } else {
        rows = '<tr><td colspan="6" style="padding:12px;text-align:center;color:#666;">No lowbed plan data found in localStorage.</td></tr>';
      }
      const printHTML = `<div style="font-family:'Courier New',monospace;color:#000;background:#fff;padding:24px;"><div style="text-align:center;margin-bottom:20px;border-bottom:3px solid #000;padding-bottom:16px;"><div style="font-size:28px;font-weight:900;letter-spacing:4px;">DMC CONSTRUCTION</div><div style="font-size:14px;letter-spacing:2px;margin-top:4px;">DISPATCH SHEET</div><div style="font-size:12px;color:#444;margin-top:6px;">` + today + '</div></div><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#222;color:#fff;"><th style="padding:8px 6px;border:1px solid #333;width:40px;">#</th><th style="padding:8px 6px;border:1px solid #333;">Equipment</th><th style="padding:8px 6px;border:1px solid #333;">From</th><th style="padding:8px 6px;border:1px solid #333;">To</th><th style="padding:8px 6px;border:1px solid #333;">Driver</th><th style="padding:8px 6px;border:1px solid #333;">Status</th></tr></thead><tbody>' + rows + '</tbody></table><div style="margin-top:20px;font-size:10px;color:#888;text-align:right;">Generated by Heimdall \xB7 ' + today + "</div></div>";
      const old = document.getElementById("__dmc_print_root__");
      if (old) old.parentNode.removeChild(old);
      const wrapper = document.createElement("div");
      wrapper.id = "__dmc_print_root__";
      wrapper.innerHTML = printHTML;
      document.body.appendChild(wrapper);
      const styleId = "__dmc_print_style__";
      let styleEl = document.getElementById(styleId);
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = styleId;
        styleEl.media = "print";
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = "@media print { body > *:not(#__dmc_print_root__) { display: none !important; } #__dmc_print_root__ { display: block !important; } }";
      window.print();
      setTimeout(() => {
        const el = document.getElementById("__dmc_print_root__");
        if (el) el.parentNode.removeChild(el);
      }, 2e3);
    };
    const exportMovementCSV = () => {
      const raw = (() => {
        try {
          return JSON.parse(localStorage.getItem("dmc_eq_movement_log") || "[]");
        } catch (e) {
          return [];
        }
      })();
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const headers = ["Date", "Equipment", "From Job", "To Job", "Driver", "Status", "Notes"];
      const csvRows = raw.map((r) => [r.date || r.timestamp || "", r.equipment || r.equipmentName || "", r.fromJob || r.from || "", r.toJob || r.to || "", r.driver || r.assignedDriver || "", r.status || "", r.notes || ""].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","));
      const csv = [headers.join(","), ...csvRows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "equipment-log-" + dateStr + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    };
    const captureSchedulePNG = async (setCapturing) => {
      setCapturing(true);
      try {
        if (!window.html2canvas) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const target = document.querySelector("[data-schedule-tab]") || document.body;
        const canvas = await window.html2canvas(target, { useCORS: true, scale: 2 });
        const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const url = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = "schedule-" + dateStr + ".png";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 500);
      } catch (e) {
        alert("Capture failed: " + e.message);
      } finally {
        setCapturing(false);
      }
    };
    const exportGPSCSV = () => {
      if (!gpsDevices || gpsDevices.length === 0) {
        alert("No GPS data loaded \u2014 visit Dashboard first.");
        return;
      }
      const headers = ["Device Name", "Address", "Speed", "Status", "Last Updated"];
      const csvRows = gpsDevices.map((dev) => {
        const name = getDeviceName ? getDeviceName(dev) : dev.display_name || dev.device_id || "";
        const addr = getDeviceAddress ? getDeviceAddress(dev) : dev.latest_device_point && dev.latest_device_point.formatted_address || "";
        const spd = dev.latest_device_point && dev.latest_device_point.speed != null ? Math.round(dev.latest_device_point.speed) + " mph" : "0 mph";
        const st = getDeviceStatus ? getDeviceStatus(dev) : { label: "" };
        const updated = dev.latest_device_point && (dev.latest_device_point.dt_tracker || dev.latest_device_point.dt_server) || "";
        return [name, addr, spd, st.label, updated].map((v) => '"' + String(v || "").replace(/"/g, '""') + '"').join(",");
      });
      const csv = [headers.join(","), ...csvRows].join("\n");
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gps-snapshot-" + timestamp + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    };
    const cardStyle = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "20px", fontFamily: "'DM Mono',monospace", display: "flex", flexDirection: "column", gap: "10px" };
    const titleStyle = { fontSize: "14px", fontWeight: "700", color: "var(--chalk, #f9f7f3)", letterSpacing: "0.5px" };
    const descStyle = { fontSize: "11px", color: "var(--concrete-dim, #9b9488)", lineHeight: "1.5" };
    const btnStyle = { marginTop: "auto", background: "rgba(245,197,24,0.15)", border: "1px solid rgba(245,197,24,0.4)", borderRadius: "6px", color: "#f5c518", fontFamily: "'DM Mono',monospace", fontSize: "11px", fontWeight: "700", letterSpacing: "1px", padding: "9px 14px", cursor: "pointer", textTransform: "uppercase", transition: "background 0.15s" };
    return /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: titleStyle }, "\u{1F4CB} Dispatch Sheet"), /* @__PURE__ */ React.createElement("div", { style: descStyle }, "Print current lowbed plan as a formatted sheet."), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: btnStyle,
        onMouseEnter: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.28)",
        onMouseLeave: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.15)",
        onClick: exportDispatchPDF
      },
      "Print Dispatch Sheet"
    )), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: titleStyle }, "\u{1F69B} Movement Log"), /* @__PURE__ */ React.createElement("div", { style: descStyle }, "Download full equipment movement history."), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: btnStyle,
        onMouseEnter: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.28)",
        onMouseLeave: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.15)",
        onClick: exportMovementCSV
      },
      "Download CSV"
    )), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: titleStyle }, "\u{1F4F8} Schedule Snapshot"), /* @__PURE__ */ React.createElement("div", { style: descStyle }, "Capture the daily schedule as an image."), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: Object.assign({}, btnStyle, { opacity: schedCapturing ? 0.6 : 1, cursor: schedCapturing ? "not-allowed" : "pointer" }),
        onMouseEnter: (e) => {
          if (!schedCapturing) e.currentTarget.style.background = "rgba(245,197,24,0.28)";
        },
        onMouseLeave: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.15)",
        onClick: () => {
          if (!schedCapturing) captureSchedulePNG(setSchedCapturing);
        },
        disabled: schedCapturing
      },
      schedCapturing ? "\u23F3 Capturing\u2026" : "Capture Schedule"
    )), /* @__PURE__ */ React.createElement("div", { style: cardStyle }, /* @__PURE__ */ React.createElement("div", { style: titleStyle }, "\u{1F4E1} GPS Report"), /* @__PURE__ */ React.createElement("div", { style: descStyle }, "Export current device locations and status."), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: btnStyle,
        onMouseEnter: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.28)",
        onMouseLeave: (e) => e.currentTarget.style.background = "rgba(245,197,24,0.15)",
        onClick: exportGPSCSV
      },
      "Export GPS Report"
    )));
  })()), pickerDeviceId && isAdminUser && (() => {
    const devName = (() => {
      const d = gpsDevices.find((x) => x.device_id === pickerDeviceId);
      return d ? getDeviceName(d) : pickerDeviceId;
    })();
    const grp = lowbedGroups.find((g) => g.deviceId === pickerDeviceId);
    const existingIds = (grp ? grp.items : []).map((i) => i.id);
    const searchLower = pickerSearch.toLowerCase();
    const visible = fleetItems.filter(
      (eq) => !existingIds.includes(eq.id) && (!searchLower || eq.name.toLowerCase().includes(searchLower) || (eq.type || "").toLowerCase().includes(searchLower) || (eq.category || "").toLowerCase().includes(searchLower))
    );
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setPickerDeviceId(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9600, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "var(--asphalt-mid)", border: "1px solid rgba(245,197,24,0.3)", borderRadius: "10px", width: "100%", maxWidth: "460px", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: "1px solid var(--asphalt-light)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", letterSpacing: "2px", color: "var(--stripe)", flex: 1 } }, "\u{1F69A} ", devName, " \u2014 Add Equipment"), /* @__PURE__ */ React.createElement("button", { onClick: () => setPickerDeviceId(null), style: { background: "none", border: "none", color: "var(--concrete-dim)", fontSize: "16px", cursor: "pointer" } }, "\u2715")),
        grp && grp.items.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 16px", background: "rgba(245,197,24,0.05)", borderBottom: "1px solid rgba(245,197,24,0.1)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", letterSpacing: "1px", color: "var(--concrete-dim)", marginBottom: "5px" } }, "CURRENT LOAD"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } }, grp.items.map(
          (chip) => /* @__PURE__ */ React.createElement("span", { key: chip.id, style: { display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.3)", borderRadius: "10px", padding: "3px 8px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--stripe)" } }, EQ_ICONS[chip.type] || "\u{1F4E6}", " ", chip.name, /* @__PURE__ */ React.createElement("button", { onClick: () => removeFromGroup(pickerDeviceId, chip.id), style: { background: "none", border: "none", color: "rgba(245,197,24,0.5)", cursor: "pointer", fontSize: "10px", lineHeight: 1, padding: "0 0 0 2px" } }, "\u2715"))
        ))),
        /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 16px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
          "input",
          {
            value: pickerSearch,
            onChange: (e) => setPickerSearch(e.target.value),
            placeholder: "Search equipment\u2026",
            style: { width: "100%", background: "#252525", border: "1px solid #333", borderRadius: "5px", color: "var(--white)", fontFamily: "'DM Mono',monospace", fontSize: "11px", padding: "7px 10px", boxSizing: "border-box" },
            autoFocus: true
          }
        )),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "0 8px 10px" } }, visible.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: "20px", textAlign: "center", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "10px" } }, fleetItems.length === 0 ? "No equipment in fleet. Add equipment in the main app first." : "No matches.") : visible.map((eq) => {
          const rule = LOWBED_RULES[eq.type] || { loadClass: "light" };
          const grpItems = grp ? grp.items : [];
          const compat = checkCompat(eq.type, grpItems);
          return /* @__PURE__ */ React.createElement(
            "div",
            {
              key: eq.id,
              onClick: () => {
                if (!compat.ok) {
                  alert("\u26A0\uFE0F " + compat.reason);
                  return;
                }
                addToGroup(pickerDeviceId, eq);
              },
              style: {
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 10px",
                borderRadius: "6px",
                cursor: compat.ok ? "pointer" : "not-allowed",
                opacity: compat.ok ? 1 : 0.45,
                background: "transparent",
                transition: "background 0.1s"
              },
              onMouseEnter: (e) => {
                if (compat.ok) e.currentTarget.style.background = "rgba(245,197,24,0.06)";
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.background = "transparent";
              }
            },
            /* @__PURE__ */ React.createElement("span", { style: { fontSize: "18px", flexShrink: 0 } }, EQ_ICONS[eq.type] || "\u{1F4E6}"),
            /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "var(--white)" } }, eq.name), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)" } }, eq.type, eq.category ? " \xB7 " + eq.category : "", eq.make ? " \xB7 " + eq.make : "")),
            /* @__PURE__ */ React.createElement("span", { style: {
              fontFamily: "'DM Mono',monospace",
              fontSize: "8px",
              padding: "2px 7px",
              borderRadius: "8px",
              flexShrink: 0,
              background: compat.ok ? "rgba(126,203,143,0.1)" : "rgba(217,79,61,0.1)",
              color: compat.ok ? "#7ecb8f" : "var(--red)",
              border: `1px solid ${compat.ok ? "rgba(126,203,143,0.3)" : "rgba(217,79,61,0.3)"}`
            } }, compat.ok ? rule.loadClass : "\u26A0 incompatible")
          );
        })),
        /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 16px", borderTop: "1px solid var(--asphalt-light)", display: "flex", justifyContent: "flex-end", flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => setPickerDeviceId(null),
            style: { background: "rgba(245,197,24,0.1)", border: "1px solid rgba(245,197,24,0.4)", borderRadius: "5px", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, padding: "7px 18px", cursor: "pointer" }
          },
          "Done"
        ))
      )
    );
  })(), showManualMove === "pick" && /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: () => setShowManualMove(false),
      style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9600, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: { background: "var(--asphalt-mid)", border: "1px solid rgba(245,197,24,0.3)", borderRadius: "10px", width: "100%", maxWidth: "380px", boxShadow: "0 20px 60px rgba(0,0,0,0.8)", overflow: "hidden" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", letterSpacing: "2px", color: "var(--stripe)" } }, "\u{1F69B} Manual Lowbed Move"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", marginTop: "4px" } }, "What are you setting up?")),
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "16px 20px" } }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setManualMoveMode("single");
            setShowManualMove(true);
          },
          style: { display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "rgba(126,203,143,0.06)", border: "1px solid rgba(126,203,143,0.25)", borderRadius: "8px", cursor: "pointer", textAlign: "left" }
        },
        /* @__PURE__ */ React.createElement("span", { style: { fontSize: "22px" } }, "\u{1F69A}"),
        /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "15px", letterSpacing: "1px", color: "#7ecb8f" } }, "Single Move"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, "One lowbed trip \u2014 equipment compatibility rules apply"))
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setManualMoveMode("job");
            setShowManualMove(true);
          },
          style: { display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "rgba(245,197,24,0.06)", border: "1px solid rgba(245,197,24,0.25)", borderRadius: "8px", cursor: "pointer", textAlign: "left" }
        },
        /* @__PURE__ */ React.createElement("span", { style: { fontSize: "22px" } }, "\u{1F3D7}\uFE0F"),
        /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "15px", letterSpacing: "1px", color: "var(--stripe)" } }, "Job Setup"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, "Group all equipment for a job \u2014 no pairing restrictions"))
      )),
      /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 20px 16px", borderTop: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setShowManualMove(false), style: { width: "100%", background: "none", border: "1px solid var(--asphalt-light)", borderRadius: "5px", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "7px 16px", cursor: "pointer" } }, "Cancel"))
    )
  ), showManualMove === true && (() => {
    const locationOpts = [
      { value: "__garage__", label: "\u{1F3E0} Garage" },
      ...jobList.map((j) => ({ value: j.id, label: (j.num || j.id) + (j.name ? " \u2014 " + j.name : "") }))
    ];
    const locStyle = { width: "100%", background: "#252525", border: "1px solid #333", borderRadius: "5px", color: "var(--white)", fontFamily: "'DM Mono',monospace", fontSize: "11px", padding: "7px 10px", boxSizing: "border-box" };
    const labelStyle = { fontFamily: "'DM Mono',monospace", fontSize: "9px", letterSpacing: "1px", color: "var(--concrete-dim)", marginBottom: "4px" };
    const EQ_TYPE_LABELS = {
      paver: "Pavers",
      roller: "Rollers",
      milling: "Milling Machines",
      excavator: "Excavators",
      loader: "Loaders",
      skid_steer: "Skid Steers",
      compactor: "Compactors",
      dump_truck: "Dump Trucks",
      lowbed: "Lowbeds",
      tack_truck: "Tack Trucks",
      tack_wagon: "Tack Wagons",
      rubber_machine: "Rubber Machines",
      water_truck: "Water Trucks",
      mtv: "Material Transfer Vehicles",
      grader: "Graders",
      generator: "Generators",
      trailer: "Trailers",
      other: "Other"
    };
    const available = fleetItems.filter((eq) => !manualItems.find((i) => i.id === eq.id));
    const byType = {};
    available.forEach((eq) => {
      const t = eq.type || "other";
      if (!byType[t]) byType[t] = [];
      byType[t].push(eq);
    });
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => {
          setShowManualMove(false);
          setManualToLocked(false);
        },
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9600, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "var(--asphalt-mid)", border: "1px solid rgba(245,197,24,0.3)", borderRadius: "10px", width: "100%", maxWidth: "520px", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: "1px solid var(--asphalt-light)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'Bebas Neue',sans-serif", fontSize: "18px", letterSpacing: "2px", color: "var(--stripe)", flex: 1 } }, "\u{1F69B} ", manualMoveMode === "job" ? "Job Setup \u2014 All Equipment" : "Manual Lowbed Move"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
          setShowManualMove(false);
          setManualToLocked(false);
        }, style: { background: "none", border: "none", color: "var(--concrete-dim)", fontSize: "16px", cursor: "pointer" } }, "\u2715")),
        /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "14px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "DATE"), /* @__PURE__ */ React.createElement("input", { type: "date", value: manualDate, onChange: (e) => setManualDate(e.target.value), style: locStyle })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "DRIVER"), /* @__PURE__ */ React.createElement("input", { value: manualDriver, onChange: (e) => setManualDriver(e.target.value), placeholder: "Driver name", style: locStyle }))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "FROM"), /* @__PURE__ */ React.createElement("select", { value: manualFrom, onChange: (e) => setManualFrom(e.target.value), style: locStyle }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 Select location \u2014"), locationOpts.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "TO", manualToLocked && /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(155,148,136,0.5)", fontWeight: 400 } }, " \u2014 locked")), manualToLocked ? /* @__PURE__ */ React.createElement("div", { style: { ...locStyle, color: "#9b6fd6", opacity: 0.9, cursor: "not-allowed" } }, locationOpts.find((o) => o.value === manualTo)?.label || manualTo) : /* @__PURE__ */ React.createElement("select", { value: manualTo, onChange: (e) => setManualTo(e.target.value), style: locStyle }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 Select location \u2014"), locationOpts.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label))))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "DEADLINE \u2014 MOVE MUST BE COMPLETE BY"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "datetime-local",
            value: manualDeadline,
            onChange: (e) => setManualDeadline(e.target.value),
            style: { ...locStyle, flex: 1, colorScheme: "dark" }
          }
        ), manualDeadline && /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px", background: "#fff", border: "2px solid #c0392b", borderRadius: "6px", padding: "4px 10px", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "#c0392b", whiteSpace: "nowrap", flexShrink: 0 } }, "\u26A0 By ", new Date(manualDeadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), " ", new Date(manualDeadline).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "EQUIPMENT TO HAUL"), manualItems.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "10px", padding: "8px", background: "rgba(245,197,24,0.04)", border: "1px solid rgba(245,197,24,0.15)", borderRadius: "6px" } }, manualItems.map(
          (item) => /* @__PURE__ */ React.createElement("span", { key: item.id, style: { display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.35)", borderRadius: "10px", padding: "3px 8px", fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--stripe)" } }, EQ_ICONS[item.type] || "\u{1F4E6}", " ", item.name, /* @__PURE__ */ React.createElement("button", { onClick: () => setManualItems(manualItems.filter((i) => i.id !== item.id)), style: { background: "none", border: "none", color: "rgba(245,197,24,0.5)", cursor: "pointer", fontSize: "10px", lineHeight: 1, padding: "0 0 0 2px" } }, "\u2715"))
        )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, Object.entries(byType).map(([type, items]) => {
          const isOpen = !!manualEqOpen[type];
          return /* @__PURE__ */ React.createElement("div", { key: type, style: { borderRadius: "6px", border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(
            "button",
            {
              onClick: () => setManualEqOpen((o) => ({ ...o, [type]: !o[type] })),
              style: { width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "none", cursor: "pointer", textAlign: "left" }
            },
            /* @__PURE__ */ React.createElement("span", { style: { fontSize: "14px" } }, EQ_ICONS[type] || "\u{1F4E6}"),
            /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, color: "var(--white)", flex: 1 } }, EQ_TYPE_LABELS[type] || type),
            /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, items.length),
            /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "var(--concrete-dim)", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" } }, "\u25BE")
          ), isOpen && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "2px", padding: "4px 6px 6px" } }, items.map((eq) => {
            const compat = manualMoveMode === "job" ? { ok: true } : checkCompat(eq.type, manualItems);
            const avail = getEquipmentStatus(eq.id, lowbedGroups);
            const blocked = !compat.ok || avail.status === "in_transit" || avail.status === "on_site";
            const handleClick = () => {
              if (!compat.ok) {
                alert("\u26A0\uFE0F " + compat.reason);
                return;
              }
              if (avail.status === "in_transit") {
                alert("\u{1F69B} " + eq.name + " is currently in transit. It cannot be assigned to another move.");
                return;
              }
              if (avail.status === "on_site") {
                alert("\u{1F4CD} " + eq.name + " is on site. Press Clean Out on the job card first to reassign it.");
                return;
              }
              if (avail.status === "assigned") {
                if (!window.confirm(eq.name + " is already assigned to another pending move. Add it anyway?")) return;
              }
              setManualItems([...manualItems, { id: eq.id, name: eq.name, type: eq.type }]);
            };
            const rowBg = avail.status === "assigned" ? "rgba(122,179,240,0.05)" : avail.status === "in_transit" ? "rgba(201,168,0,0.06)" : avail.status === "on_site" ? "rgba(155,111,214,0.06)" : "rgba(255,255,255,0.02)";
            const rowBorder = avail.status === "available" ? "rgba(255,255,255,0.04)" : avail.color + "44";
            return /* @__PURE__ */ React.createElement(
              "div",
              {
                key: eq.id,
                onClick: handleClick,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "5px 8px",
                  borderRadius: "4px",
                  cursor: blocked ? "not-allowed" : "pointer",
                  opacity: !compat.ok || avail.status === "in_transit" || avail.status === "on_site" ? 0.55 : 1,
                  background: rowBg,
                  border: "1px solid " + rowBorder
                },
                onMouseEnter: (e) => {
                  if (!blocked) e.currentTarget.style.background = "rgba(245,197,24,0.07)";
                },
                onMouseLeave: (e) => {
                  e.currentTarget.style.background = rowBg;
                }
              },
              /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "var(--white)" } }, eq.name), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: avail.color, marginTop: "1px" } }, avail.status === "available" ? "\u25CF At Garage" : avail.status === "assigned" ? "\u26A0 Assigned to pending move" : avail.status === "in_transit" ? "\u{1F69B} In Transit" : avail.status === "on_site" ? "\u{1F4CD} On Site at job" : "\u25CF " + avail.label)),
              !compat.ok ? /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--red)" } }, "\u26A0 incompatible") : blocked ? /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: avail.color } }, "\u{1F6AB}") : avail.status === "assigned" ? /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "#7ab3f0" } }, "+ Add") : /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "rgba(126,203,143,0.6)" } }, "+ Add")
            );
          })));
        }), Object.keys(byType).length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "10px", color: "rgba(155,148,136,0.4)", padding: "10px 0", textAlign: "center" } }, "All equipment already added"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: labelStyle }, "NOTES"), /* @__PURE__ */ React.createElement(
          "textarea",
          {
            value: manualNotes,
            onChange: (e) => setManualNotes(e.target.value),
            rows: 2,
            placeholder: "Special instructions\u2026",
            style: { ...locStyle, resize: "vertical" }
          }
        ))),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "12px 18px", borderTop: "1px solid var(--asphalt-light)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
          setShowManualMove(false);
          setManualToLocked(false);
        }, style: { background: "none", border: "1px solid var(--asphalt-light)", borderRadius: "5px", color: "var(--concrete-dim)", fontFamily: "'DM Mono',monospace", fontSize: "10px", padding: "7px 16px", cursor: "pointer" } }, "Cancel"), /* @__PURE__ */ React.createElement("button", { onClick: saveManualMove, style: { background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.5)", borderRadius: "5px", color: "var(--stripe)", fontFamily: "'DM Mono',monospace", fontSize: "10px", fontWeight: 700, padding: "7px 20px", cursor: "pointer" } }, "Save Move"))
      )
    );
  })(), chipModal && (() => {
    const { deviceId, chip, editName } = chipModal;
    const photo = eqPhotos[chip.id];
    const fleetAll = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_fleet") || "[]");
      } catch (e) {
        return [];
      }
    })();
    const fleetRec = fleetAll.find((e) => e.id === chip.id) || {};
    const gpsDevId = Object.keys(equipNameMap).find((did) => {
      const m = equipNameMap[did];
      return m && (m.customName === chip.name || m.equipNum === chip.id || m.equipNum === fleetRec.id);
    });
    const gpsDev = gpsDevId ? gpsDevices.find((d) => d.device_id === gpsDevId) : null;
    const gpsStatus = gpsDev ? getDeviceStatus(gpsDev) : null;
    const gpsAddr = gpsDev ? getDeviceAddress(gpsDev) : "";
    const gpsSeen = gpsDev ? getDeviceUpdated(gpsDev) : "";
    const gpsStale = gpsDev ? isDeviceStale(gpsDev) : false;
    const statusColors = { down: "var(--red)", limping: "var(--orange)", operational: "#7ecb8f" };
    const statusBgs = { down: "rgba(217,79,61,0.12)", limping: "rgba(232,129,58,0.1)", operational: "rgba(126,203,143,0.1)" };
    const fleetStatus = fleetRec.status || "operational";
    const fleetStatusLabel = fleetStatus === "operational" ? "Operational" : fleetStatus === "limping" ? "Limping" : "DOWN";
    const moveLogs = (() => {
      try {
        return JSON.parse(localStorage.getItem("dmc_eq_movement_log") || "[]");
      } catch (e) {
        return [];
      }
    })().filter((e) => e.equipmentName === chip.name || e.equipmentId === chip.id).sort((a, b) => (b.assignedAt || b.createdAt || 0) - (a.assignedAt || a.createdAt || 0));
    const qrUrl = `${location.origin}${location.pathname}?eq=${encodeURIComponent(chip.id)}`;
    const fmtDate = (ts) => {
      if (!ts) return "\u2014";
      try {
        return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      } catch (e) {
        return "\u2014";
      }
    };
    const fmtDur = (min) => {
      if (!min) return null;
      const h = Math.floor(min / 60), m = min % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9600, display: "flex", alignItems: "stretch", justifyContent: "flex-end" },
        onClick: (e) => {
          if (e.target === e.currentTarget) setChipModal(null);
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: {
        width: "min(480px,100vw)",
        background: "#1e1e1e",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.7)",
        overflowY: "auto"
      } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", background: "var(--asphalt)", flexShrink: 0, minHeight: "220px", display: "flex", alignItems: "center", justifyContent: "center" } }, photo ? /* @__PURE__ */ React.createElement("img", { src: photo, alt: chip.name, style: { width: "100%", height: "260px", objectFit: "cover", display: "block" } }) : /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "40px 20px", opacity: 0.5 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: "52px", marginBottom: "6px" } }, EQ_ICONS[chip.type] || "\u{1F4E6}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", letterSpacing: "1px" } }, "NO PHOTO")), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "10px", right: "10px", display: "flex", gap: "5px" } }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => chipPhotoRef.current?.click(),
          style: {
            background: "rgba(0,0,0,0.65)",
            border: "1px solid rgba(90,180,245,0.5)",
            borderRadius: "6px",
            color: "#5ab4f5",
            fontFamily: "'DM Mono',monospace",
            fontSize: "9px",
            padding: "5px 9px",
            cursor: "pointer"
          }
        },
        photo ? "\u{1F4F7} Replace" : "\u{1F4F7} Add Photo"
      ), photo && /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => removeEqPhoto(chip.id),
          style: {
            background: "rgba(0,0,0,0.65)",
            border: "1px solid rgba(217,79,61,0.4)",
            borderRadius: "6px",
            color: "var(--red)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "9px",
            padding: "5px 9px",
            cursor: "pointer"
          }
        },
        "\u2715"
      )), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setChipModal(null),
          style: {
            position: "absolute",
            top: "10px",
            left: "10px",
            background: "rgba(0,0,0,0.65)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "6px",
            color: "var(--white)",
            fontSize: "14px",
            padding: "5px 9px",
            cursor: "pointer",
            lineHeight: 1
          }
        },
        "\u2190"
      ), /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        bottom: "10px",
        left: "12px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "rgba(0,0,0,0.65)",
        borderRadius: "20px",
        padding: "4px 10px"
      } }, /* @__PURE__ */ React.createElement("span", { style: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flexShrink: 0,
        background: statusColors[fleetStatus] || "#7ecb8f",
        boxShadow: `0 0 6px ${statusColors[fleetStatus] || "#7ecb8f"}`
      } }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", fontWeight: 700, color: statusColors[fleetStatus] || "#7ecb8f" } }, fleetStatusLabel)), /* @__PURE__ */ React.createElement(
        "input",
        {
          ref: chipPhotoRef,
          type: "file",
          accept: "image/*",
          style: { display: "none" },
          onChange: (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => saveEqPhoto(chip.id, ev.target.result);
            reader.readAsDataURL(file);
            e.target.value = "";
          }
        }
      )), /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 18px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", letterSpacing: "1.5px", color: "var(--concrete-dim)", marginBottom: "3px", textTransform: "uppercase" } }, (FLEET_TYPES || []).find && ((FLEET_TYPES || []).find((t) => t.key === chip.type) || { label: chip.type || "Equipment" }).label), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          value: editName,
          onChange: (e) => setChipModal((m) => ({ ...m, editName: e.target.value })),
          onBlur: () => {
            if (editName.trim() && editName !== chip.name) renameChip(deviceId, chip.id, editName.trim());
          },
          onKeyDown: (e) => {
            if (e.key === "Enter") renameChip(deviceId, chip.id, editName.trim() || chip.name);
          },
          style: {
            flex: 1,
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(245,197,24,0.3)",
            fontFamily: "'Bebas Neue',sans-serif",
            fontSize: "28px",
            letterSpacing: "2px",
            color: "var(--stripe)",
            padding: "0 0 2px",
            outline: "none"
          }
        }
      )), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", display: "flex", flexWrap: "wrap", gap: "10px" } }, /* @__PURE__ */ React.createElement("span", null, chip.id), fleetRec.year && /* @__PURE__ */ React.createElement("span", null, "\xB7 ", fleetRec.year), fleetRec.make && /* @__PURE__ */ React.createElement("span", null, "\xB7 ", fleetRec.make, " ", fleetRec.model || "")), fleetRec.statusNote && /* @__PURE__ */ React.createElement("div", { style: {
        marginTop: "8px",
        background: statusBgs[fleetStatus],
        border: `1px solid ${statusColors[fleetStatus]}44`,
        borderRadius: "5px",
        padding: "6px 10px",
        fontFamily: "'DM Sans',sans-serif",
        fontSize: "11px",
        color: statusColors[fleetStatus]
      } }, fleetRec.statusNote)), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid var(--asphalt-light)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", letterSpacing: "1.5px", color: "var(--concrete-dim)", marginBottom: "10px", textTransform: "uppercase" } }, "\u{1F4E1} Live Location"), gpsDev ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, /* @__PURE__ */ React.createElement("span", { style: {
        fontFamily: "'DM Mono',monospace",
        fontSize: "10px",
        fontWeight: 700,
        color: gpsStale ? "var(--red)" : gpsStatus?.label.startsWith("Moving") ? "#5ab4f5" : "#7ecb8f"
      } }, gpsStale ? "\u26A0 No Signal 24h+" : gpsStatus?.label || "Unknown")), gpsAddr && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, "\u{1F4CD} ", gpsAddr), gpsSeen && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "rgba(155,148,136,0.6)" } }, "Last seen: ", gpsSeen), fleetRec.assignedJobName && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--stripe)", marginTop: "2px" } }, "\u{1F3D7} Assigned: ", fleetRec.assignedJobName)) : /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)" } }, fleetRec.assignedJobName ? /* @__PURE__ */ React.createElement(React.Fragment, null, "\u{1F3D7} On job: ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--stripe)" } }, fleetRec.assignedJobName)) : "No GPS device linked \u2014 link in Equipment Name Editor")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "14px 18px", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", letterSpacing: "1.5px", color: "var(--concrete-dim)", marginBottom: "10px", textTransform: "uppercase" } }, "\u{1F69B} Movement Log (", moveLogs.length, ")"), moveLogs.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--concrete-dim)", textAlign: "center", padding: "20px 0" } }, "No movement records yet") : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, moveLogs.map((log, i) => {
        const isComplete = log.status === "complete";
        const isAssigned = log.status === "assigned";
        const statusCol = isComplete ? "#7ecb8f" : isAssigned ? "var(--stripe)" : "var(--concrete-dim)";
        const dur = fmtDur(log.durationMinutes);
        return /* @__PURE__ */ React.createElement("div", { key: i, style: { background: "var(--asphalt)", border: "1px solid var(--asphalt-light)", borderRadius: "7px", padding: "9px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "4px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "9px", color: "var(--white)", fontWeight: 700, lineHeight: 1.3 } }, log.from || "Shop", " \u2192 ", log.to || log.jobName || "\u2014"), /* @__PURE__ */ React.createElement("span", { style: {
          flexShrink: 0,
          fontFamily: "'DM Mono',monospace",
          fontSize: "7px",
          fontWeight: 700,
          color: statusCol,
          background: `${statusCol}18`,
          border: `1px solid ${statusCol}44`,
          borderRadius: "8px",
          padding: "2px 6px"
        } }, isComplete ? "\u2713 DONE" : isAssigned ? "ASSIGNED" : "OPEN")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)" } }, /* @__PURE__ */ React.createElement("span", null, fmtDate(log.assignedAt || log.createdAt)), log.driver && /* @__PURE__ */ React.createElement("span", null, "\u{1F9D1} ", log.driver), dur && /* @__PURE__ */ React.createElement("span", null, "\u23F1 ", dur), log.lastKnownSpeedMph != null && /* @__PURE__ */ React.createElement("span", null, "\u{1F4E1} ", log.lastKnownSpeedMph, " mph at completion")), log.lastKnownLat && /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "'DM Mono',monospace", fontSize: "7px", color: "rgba(155,148,136,0.5)", marginTop: "3px" } }, "GPS: ", log.lastKnownLat.toFixed(5), ", ", log.lastKnownLng?.toFixed(5)));
      }))), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, padding: "12px 18px", borderTop: "1px solid var(--asphalt-light)", display: "flex", flexDirection: "column", gap: "7px", background: "#1a1a1a" } }, /* @__PURE__ */ React.createElement("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "var(--asphalt)",
        border: "1px solid var(--asphalt-light)",
        borderRadius: "6px",
        padding: "7px 10px"
      } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)", letterSpacing: "1px", flexShrink: 0 } }, "QR LINK"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "'DM Mono',monospace", fontSize: "8px", color: "var(--concrete-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, qrUrl), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => navigator.clipboard?.writeText(qrUrl).catch(() => {
          }),
          style: { background: "none", border: "none", color: "#5ab4f5", fontFamily: "'DM Mono',monospace", fontSize: "8px", cursor: "pointer", flexShrink: 0, padding: 0 }
        },
        "Copy"
      )), deviceId && isAdminUser && /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            removeFromGroup(deviceId, chip.id);
            setChipModal(null);
          },
          style: {
            width: "100%",
            padding: "9px",
            background: "rgba(217,79,61,0.07)",
            border: "1px solid rgba(217,79,61,0.3)",
            borderRadius: "6px",
            color: "var(--red)",
            fontFamily: "'DM Mono',monospace",
            fontSize: "10px",
            cursor: "pointer",
            fontWeight: 700
          }
        },
        "\u{1F5D1} Remove from load"
      )))
    );
  })());
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/* @__PURE__ */ React.createElement(App, null));
