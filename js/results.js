// FruitWatch — results.js

const FEATURE_LAYER_URL = "https://services1.arcgis.com/PhkL97KbkzUBf4PQ/arcgis/rest/services/survey123_5e1ad6c87dc44ad991c9e2e0aadbdf7f_results/FeatureServer/0";

const SPECIES_CONFIG = [
  { name: "Apple",   field: "variety_apple",   otherField: "variety_apple_other",   color: "#E8B4C8" },
  { name: "Apricot", field: "variety_apricot", otherField: "variety_apricot_other", color: "#F0B27A" },
  { name: "Cherry",  field: "variety_cherry",  otherField: "variety_cherry_other",  color: "#C97D9A" },
  { name: "Peach",   field: "variety_peach",   otherField: "variety_peach_other",   color: "#F2A0A0" },
  { name: "Pear",    field: "variety_pear",    otherField: "variety_pear_other",    color: "#D8E0A0" },
  { name: "Plum",    field: "variety_plum",    otherField: "variety_plum_other",    color: "#8C6BA8" },
];

const colorFor = name => (SPECIES_CONFIG.find(s => s.name === name) || {}).color || "#999";

function normaliseStage(raw) {
  if (!raw) return "";
  if (raw.startsWith("A")) return "Start of Flowering";
  if (raw.startsWith("B")) return "Peak Flowering";
  if (raw.startsWith("C")) return "End of Flowering";
  return raw;
}
const CURRENT_YEAR = new Date().getFullYear();
let leafletMap = null;
let markerLayer = null;

// ---------- Fetch ----------

const CACHE_KEY = "fw_records_v2";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function parseFeatures(features) {
  return features.map(f => {
    const a = f.attributes;
    const g = f.geometry || {};
    const speciesCfg = SPECIES_CONFIG.find(s => s.name === a.fruit);
    let variety = "", rawVariety = "";
    if (speciesCfg) {
      rawVariety = a[speciesCfg.field] || "";
      variety = rawVariety === "other" ? (a[speciesCfg.otherField] || "") : rawVariety;
    }
    if (!variety || variety === "Unknown") variety = "Unknown variety";
    return {
      species:     a.fruit || "Unknown",
      variety,
      _rawVariety: rawVariety,
      date:        a._date ? new Date(a._date) : null,
      stage:       normaliseStage(a.select_flowering_stage),
      postcode:    a.postcode || "",
      x: g.x, y: g.y
    };
  }).filter(r => r.date !== null);
}

const OUT_FIELDS = [
  "_date", "fruit", "select_flowering_stage", "postcode",
  "variety_apple", "variety_apple_other",
  "variety_apricot", "variety_apricot_other",
  "variety_cherry", "variety_cherry_other",
  "variety_peach", "variety_peach_other",
  "variety_pear", "variety_pear_other",
  "variety_plum", "variety_plum_other"
].join(",");

async function fetchPage(offset, count) {
  const params = new URLSearchParams({
    where: "1=1", outFields: OUT_FIELDS,
    orderByFields: "_date DESC",
    resultRecordCount: count, resultOffset: offset, f: "json"
  });
  const res = await fetch(`${FEATURE_LAYER_URL}/query?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Query failed");
  return data;
}

async function fetchRecords() {
  // Check session cache first
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) {
        // Rehydrate dates
        data.forEach(r => { if (r.date) r.date = new Date(r.date); });
        return { records: data, complete: true };
      }
    }
  } catch(e) {}

  // Fast first load — get 500 records immediately
  const firstPage = await fetchPage(0, 500);
  const initial = parseFeatures(firstPage.features || []);
  const exceeded = firstPage.exceededTransferLimit === true;

  return { records: initial, complete: !exceeded, offset: 500 };
}

async function fetchRemaining(records, offset, onUpdate) {
  let currentOffset = offset;
  let exceeded = true;
  while (exceeded && currentOffset <= 10000) {
    const data = await fetchPage(currentOffset, 1000);
    const newRecords = parseFeatures(data.features || []);
    records = records.concat(newRecords);
    exceeded = data.exceededTransferLimit === true;
    currentOffset += 1000;
    const loadingText = document.getElementById("loadingText");
    if (loadingText) loadingText.textContent = `Loading… ${records.length.toLocaleString()} records`;
    onUpdate(records);
  }

  // Save to session cache
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: records.map(r => ({ ...r, date: r.date?.toISOString() }))
    }));
  } catch(e) {}

  return records;
}

// ---------- Utilities ----------

function formatDate(d) {
  // Adjust for timezone offset to avoid midnight UTC dates shifting a day
  const adj = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  return adj.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function formatShortDate(d) {
  const adj = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  return adj.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------- Filter UI ----------

function populateFruitSelect(records) {
  const sel = document.getElementById("filterFruit");
  [...new Set(records.map(r => r.species))].filter(Boolean).sort().forEach(f => {
    const o = document.createElement("option");
    o.value = o.textContent = f;
    sel.appendChild(o);
  });
}

function populateVarietySelect(records, fruit) {
  const sel = document.getElementById("filterVariety");
  sel.innerHTML = '<option value="">All varieties</option>';
  const source = fruit ? records.filter(r => r.species === fruit) : records;
  [...new Set(source.map(r => r.variety))].filter(v => v && v !== "Unknown variety").sort()
    .forEach(v => {
      const o = document.createElement("option");
      o.value = o.textContent = v;
      sel.appendChild(o);
    });
}

function populateYearSelect(records) {
  const sel = document.getElementById("filterYear");
  const years = [...new Set(records.map(r => r.date.getFullYear()))].sort((a, b) => b - a);
  years.forEach(y => {
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  });
}

function getFilters() {
  return {
    fruit:   document.getElementById("filterFruit").value,
    variety: document.getElementById("filterVariety").value,
    year:    document.getElementById("filterYear").value,
    stage:   document.getElementById("filterStage").value
  };
}

function applyFilters(records, filters) {
  return records.filter(r => {
    if (filters.fruit   && r.species !== filters.fruit)                         return false;
    if (filters.variety && r.variety !== filters.variety)                       return false;
    if (filters.year    && r.date.getFullYear() !== parseInt(filters.year))     return false;
    if (filters.stage   && r.stage !== filters.stage)                           return false;
    return true;
  });
}

// ---------- Map expand/collapse ----------

let expandedMap = null;
let expandedMarkerLayer = null;

function expandMap() {
  const modal = document.getElementById("mapModal");
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  if (!expandedMap) {
    expandedMap = L.map("leafletMapExpanded", { zoomControl: true, maxZoom: 12 }).setView(
      leafletMap.getCenter(), leafletMap.getZoom()
    );
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd", maxZoom: 12, minZoom: 4
    }).addTo(expandedMap);
    expandedMarkerLayer = L.markerClusterGroup({
      maxClusterRadius: 50,
      showCoverageOnHover: false,
      iconCreateFunction: cluster => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 32 : count < 100 ? 38 : 44;
        return L.divIcon({
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#2F4A3C;color:#FBF7F0;display:flex;align-items:center;justify-content:center;font-size:${count < 100 ? '0.78' : '0.68'}rem;font-weight:600;border:2px solid rgba(251,247,240,0.6);box-shadow:0 2px 8px rgba(47,74,60,0.35);">${count}</div>`,
          className: "", iconSize: [size, size], iconAnchor: [size/2, size/2]
        });
      }
    }).addTo(expandedMap);
  }

  // Copy markers from main map
  expandedMarkerLayer.clearLayers();
  markerLayer.getLayers().forEach(layer => {
    if (layer.getLatLng) {
      const m = L.marker(layer.getLatLng(), { icon: layer.options.icon });
      if (layer.getTooltip()) m.bindTooltip(layer.getTooltip().getContent(), { direction: "top", offset: [0, -4] });
      expandedMarkerLayer.addLayer(m);
    }
  });

  setTimeout(() => expandedMap.invalidateSize(), 100);
}

function collapseMap() {
  document.getElementById("mapModal").style.display = "none";
  document.body.style.overflow = "";
}

// ---------- Leaflet map ----------

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map("leafletMap", { zoomControl: true, maxZoom: 12 }).setView([54.5, -3], 5);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '© <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd", maxZoom: 12, minZoom: 4
  }).addTo(leafletMap);

  markerLayer = L.markerClusterGroup({
    maxClusterRadius: 50,
    showCoverageOnHover: false,
    iconCreateFunction: cluster => {
      const count = cluster.getChildCount();
      const size = count < 10 ? 32 : count < 100 ? 38 : 44;
      return L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#2F4A3C;color:#FBF7F0;display:flex;align-items:center;justify-content:center;font-size:${count < 100 ? '0.78' : '0.68'}rem;font-weight:600;border:2px solid rgba(251,247,240,0.6);box-shadow:0 2px 8px rgba(47,74,60,0.35);">${count}</div>`,
        className: "",
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      });
    }
  }).addTo(leafletMap);
}

function markerSvg(color, stage) {
  const size = 14;
  const half = size / 2;

  let shape;
  if (stage === "Start of Flowering") {
    // Circle — bud opening
    shape = `<circle cx="${half}" cy="${half}" r="${half - 1.5}" fill="${color}" stroke="#FBF7F0" stroke-width="1.5"/>`;
  } else if (stage === "Peak Flowering") {
    // Diamond — full open
    shape = `<polygon points="${half},1.5 ${size - 1.5},${half} ${half},${size - 1.5} 1.5,${half}" fill="${color}" stroke="#FBF7F0" stroke-width="1.5"/>`;
  } else if (stage === "End of Flowering") {
    // Triangle — closing
    shape = `<polygon points="${half},1.5 ${size - 1.5},${size - 1.5} 1.5,${size - 1.5}" fill="${color}" stroke="#FBF7F0" stroke-width="1.5"/>`;
  } else {
    // Square — unknown
    shape = `<rect x="1.5" y="1.5" width="${size - 3}" height="${size - 3}" rx="2" fill="${color}" stroke="#FBF7F0" stroke-width="1.5"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${shape}</svg>`;
}

function updateMap(filtered) {
  markerLayer.clearLayers();
  const tag = document.getElementById("mapTag");

  // Only plot records where coordinates exist, including unknown varieties
  const mappable = filtered.filter(r => r._rawVariety !== "other" && r.x && r.y);

  tag.textContent = `${mappable.length} record${mappable.length === 1 ? "" : "s"}`;

  mappable.forEach(r => {
    const color = colorFor(r.species);
    const svg   = markerSvg(color, r.stage);

    const icon = L.divIcon({
      html: svg,
      className: "",
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    const marker = L.marker([r.y, r.x], { icon });
    const varietyLabel = r.variety === "Unknown variety" ? "Unknown variety" : r.variety;
    marker.bindTooltip(
      `<strong>${r.species}</strong><br>${varietyLabel}<br>${r.stage}<br>${formatDate(r.date)}${r.postcode ? "<br>" + r.postcode : ""}`,
      { direction: "top", offset: [0, -4] }
    );
    markerLayer.addLayer(marker);
  });
}

// ---------- Rendering ----------

function renderStats(filtered) {
  document.getElementById("statTotal").textContent = filtered.length.toLocaleString();
  const yr = filtered.filter(r => r.date.getFullYear() === CURRENT_YEAR);
  document.getElementById("statYear").textContent = yr.length.toLocaleString();
  document.getElementById("statYearLabel").textContent = `${CURRENT_YEAR} records`;

  if (filtered.length) {
    // Average by day-of-year to avoid cross-year timestamp skew
    const avgDoy = filtered.reduce((s, r) => {
      const start = new Date(r.date.getFullYear(), 0, 0);
      return s + Math.floor((r.date - start) / 86400000);
    }, 0) / filtered.length;
    // Express as a date in a neutral year
    const avgDate = new Date(2000, 0, Math.round(avgDoy));
    document.getElementById("statAvgBloom").textContent = formatShortDate(avgDate);
  } else {
    document.getElementById("statAvgBloom").textContent = "—";
  }

  // Update label to reflect active filters
  const filters = getFilters();
  const labelParts = [];
  if (filters.stage)   labelParts.push(filters.stage);
  if (filters.fruit)   labelParts.push(filters.fruit);
  if (filters.year)    labelParts.push(filters.year);
  document.getElementById("statAvgBloomLabel").textContent = labelParts.length
    ? `Avg. date — ${labelParts.join(", ")}`
    : "Average date (all records)";
}

function renderBreakdown(filtered, filters, allRecords) {
  const title     = document.getElementById("breakdownTitle");
  const container = document.getElementById("breakdownBars");
  const btnBack   = document.getElementById("btnBack");
  const btnReset  = document.getElementById("btnReset");
  const groupBy   = filters.fruit ? "variety" : "species";

  title.innerHTML = filters.fruit
    ? `Varieties of ${filters.fruit} <span class="tag">filtered</span>`
    : `Records by fruit <span class="tag">filtered</span>`;

  // Show/hide nav buttons and update hint
  btnBack.style.display  = filters.variety ? "inline-flex" : "none";
  btnReset.style.display = filters.fruit   ? "inline-flex" : "none";
  const hint = document.getElementById("breakdownHint");
  if (hint) hint.textContent = filters.fruit
    ? "Click a variety to filter to it. Use ← Back to return to all fruits."
    : "Click a fruit to see its varieties.";

  const counts = {};
  filtered.forEach(r => { const k = r[groupBy]; counts[k] = (counts[k] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;

  if (!entries.length) {
    container.innerHTML = `<p style="color:#888;font-size:.9rem">No records match these filters.</p>`;
    return;
  }

  container.innerHTML = entries.map(([key, count]) => {
    const color = groupBy === "species" ? colorFor(key) : colorFor(filters.fruit);
    const pct   = Math.round((count / max) * 100);
    const hint  = groupBy === "species"
      ? "Click to filter by this fruit"
      : "Click to filter by this variety";
    return `<div class="bar-row" data-key="${key}" data-group="${groupBy}"
        style="cursor:pointer;" title="${hint}">
      <div class="bar-label" title="${key}">${key}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="bar-val">${count}</div>
    </div>`;
  }).join("");

  // Click handler on each bar
  container.querySelectorAll(".bar-row").forEach(row => {
    row.addEventListener("click", () => {
      const key   = row.dataset.key;
      const group = row.dataset.group;
      if (group === "species") {
        document.getElementById("filterFruit").value   = key;
        document.getElementById("filterVariety").value = "";
        populateVarietySelect(allRecords, key);
      } else {
        document.getElementById("filterVariety").value = key;
      }
      renderAll(allRecords);
    });
    row.addEventListener("mouseenter", () => row.style.background = "rgba(232,180,200,0.12)");
    row.addEventListener("mouseleave", () => row.style.background = "");
  });
}

function renderTable(filtered) {
  const body  = document.getElementById("recordsBody");
  const empty = document.getElementById("recordsEmpty");
  document.getElementById("recordsCountTag").textContent = `${filtered.length} matching`;

  if (!filtered.length) { body.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  body.innerHTML = filtered.slice(0, 100).map(r => `
    <tr>
      <td>${formatDate(r.date)}</td>
      <td><span class="species-tag"><span class="dot" style="background:${colorFor(r.species)}"></span>${r.species}</span></td>
      <td>${r.variety}</td>
      <td>${r.stage}</td>
    </tr>`).join("");
}

function renderFilterSummary(filters, count) {
  const parts = [];
  if (filters.fruit)   parts.push(filters.fruit);
  if (filters.variety) parts.push(`'${filters.variety}'`);
  if (filters.year)    parts.push(filters.year);
  if (filters.stage)   parts.push(filters.stage);
  document.getElementById("filterSummary").textContent = parts.length
    ? `Showing ${count} record${count === 1 ? "" : "s"} — ${parts.join(", ")}`
    : `Showing all ${count} records — no filters applied`;
}

function updateTlNote() {
  const filters = getFilters();
  const parts = [];
  if (filters.fruit)   parts.push(filters.fruit);
  if (filters.variety) parts.push(`'${filters.variety}'`);
  if (filters.year)    parts.push(filters.year);
  if (filters.stage)   parts.push(filters.stage);
  const note = document.getElementById("tlFilterNote");
  if (note) note.textContent = parts.length
    ? `Timelapse will use current filters: ${parts.join(", ")}`
    : "Timelapse will use all records — set filters above to narrow down.";
}

function renderAll(records) {
  const filters  = getFilters();
  const filtered = applyFilters(records, filters);
  renderStats(filtered);
  renderBreakdown(filtered, filters, records);
  renderTable(filtered);
  updateMap(filtered);
  renderFilterSummary(filters, filtered.length);
  updateTlNote();
}

// ---------- Timelapse ----------

let tlInterval = null;

function populateTlYearSelect(records) {
  const sel = document.getElementById("tlYear");
  const years = [...new Set(records.map(r => r.date.getFullYear()))].sort((a, b) => b - a);
  years.forEach(y => {
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  });
}

function stopTimelapse() {
  if (tlInterval) { clearInterval(tlInterval); tlInterval = null; }
  document.getElementById("tlPlay").style.display = "inline-flex";
  document.getElementById("tlStop").style.display = "none";
  document.getElementById("tlDateLabel").textContent = "";
  document.getElementById("tlSlider").style.display = "none";
}

function startTimelapse(records) {
  const year = parseInt(document.getElementById("tlYear").value);
  if (!year) return;

  stopTimelapse();

  // Use main page filters
  const { fruit, variety, stage } = getFilters();

  let yearRecords = records.filter(r => r.date.getFullYear() === year && r.x && r.y);
  if (fruit)   yearRecords = yearRecords.filter(r => r.species === fruit);
  if (variety) yearRecords = yearRecords.filter(r => r.variety === variety);
  if (stage)   yearRecords = yearRecords.filter(r => r.stage === stage);

  if (!yearRecords.length) {
    document.getElementById("tlDateLabel").textContent = "No records match current filters.";
    return;
  }

  const sorted = [...yearRecords].sort((a, b) => a.date - b.date);
  const minDay = sorted[0].date;
  const maxDay = sorted[sorted.length - 1].date;
  const totalDays = Math.ceil((maxDay - minDay) / 86400000) + 1;

  const slider = document.getElementById("tlSlider");
  slider.min = 0;
  slider.max = totalDays;
  slider.value = 0;
  slider.style.display = "block";

  document.getElementById("tlPlay").style.display = "none";
  document.getElementById("tlStop").style.display = "inline-flex";

  let day = 0;

  function renderDay(d) {
    const cutoff = new Date(minDay.getTime() + d * 86400000);
    const visible = sorted.filter(r => r.date <= cutoff);
    markerLayer.clearLayers();
    visible.forEach(r => {
      const color = colorFor(r.species);
      const icon  = L.divIcon({
        html: markerSvg(color, r.stage),
        className: "", iconSize: [14, 14], iconAnchor: [7, 7]
      });
      const marker = L.marker([r.y, r.x], { icon });
      marker.bindTooltip(
        `<strong>${r.species}</strong>${r.variety !== "Unknown variety" ? "<br>" + r.variety : ""}
         <br>${r.stage}<br>${formatDate(r.date)}${r.postcode ? "<br>" + r.postcode : ""}`,
        { direction: "top", offset: [0, -4] }
      );
      markerLayer.addLayer(marker);
    });
    document.getElementById("tlDateLabel").textContent = formatShortDate(cutoff) + ` (${visible.length} records)`;
    document.getElementById("mapTag").textContent = `${visible.length} record${visible.length === 1 ? "" : "s"}`;
    slider.value = d;
  }

  renderDay(0);

  tlInterval = setInterval(() => {
    day++;
    renderDay(day);
    if (day >= totalDays) stopTimelapse();
  }, 80); // 80ms per day = roughly 6 seconds for a full season

  // Allow manual scrubbing
  slider.addEventListener("input", () => {
    if (tlInterval) { clearInterval(tlInterval); tlInterval = null; }
    renderDay(parseInt(slider.value));
  });
}

// ---------- Year-on-year trend chart ----------

let trendChart = null;

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function doyToDate(doy) {
  // Express as date in a neutral year
  return new Date(2000, 0, Math.round(doy));
}

function renderTrendChart(records) {
  const stage = document.getElementById("chartStage").value;
  const years = [...new Set(records.map(r => r.date.getFullYear()))].sort();

  const datasets = SPECIES_CONFIG.map(sc => {
    const data = years.map(yr => {
      let subset = records.filter(r =>
        r.species === sc.name &&
        r.date.getFullYear() === yr &&
        r._rawVariety !== "other"
      );
      if (stage) subset = subset.filter(r => r.stage === stage);
      if (!subset.length) return null;
      const avgDoy = subset.reduce((s, r) => s + dayOfYear(r.date), 0) / subset.length;
      return Math.round(avgDoy);
    });

    return {
      label: sc.name,
      data,
      borderColor: sc.color,
      backgroundColor: sc.color + "33",
      pointBackgroundColor: sc.color,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.3,
      spanGaps: true
    };
  }).filter(ds => ds.data.some(d => d !== null));

  const ctx = document.getElementById("trendChart").getContext("2d");

  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels: years, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { family: "Inter, sans-serif", size: 12 }, boxWidth: 12, padding: 16 }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.raw === null) return null;
              const d = doyToDate(ctx.raw);
              const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
              return `${ctx.dataset.label}: ${dateStr}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Year", font: { family: "Inter, sans-serif" } },
          grid: { color: "rgba(47,74,60,0.06)" },
          ticks: { font: { family: "var(--mono)", size: 11 } }
        },
        y: {
          reverse: false,
          title: { display: true, text: "Average flowering date", font: { family: "Inter, sans-serif" } },
          grid: { color: "rgba(47,74,60,0.06)" },
          ticks: {
            font: { family: "var(--mono)", size: 11 },
            callback: val => doyToDate(val).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
          }
        }
      }
    }
  });
}

function showError(msg) {
  const el = document.getElementById("filterSummary");
  el.textContent = msg; el.style.color = "#c0392b";
  ["statTotal","statYear","statAvgBloom"].forEach(id =>
    document.getElementById(id).textContent = "—");
}

// ---------- Boot ----------

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  document.getElementById("filterSummary").textContent = "Loading records…";

  // Modal close handlers
  document.getElementById("mapModal").addEventListener("click", e => {
    if (e.target === document.getElementById("mapModal")) collapseMap();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") collapseMap(); });

  let result;
  try {
    result = await fetchRecords();
  } catch (err) {
    showError(`Could not load data: ${err.message}`);
    const li = document.getElementById("loadingIndicator");
    if (li) li.style.display = "none";
    return;
  }

  let records = result.records;

  // Wire up all event listeners using a reference that gets updated
  let recordsRef = records;

  function getRecords() { return recordsRef; }

  // Hide loader and render initial view immediately
  const li = document.getElementById("loadingIndicator");
  if (li) li.style.display = "none";

  populateFruitSelect(records);
  populateVarietySelect(records, "");
  populateYearSelect(records);
  populateTlYearSelect(records);
  renderTrendChart(records);
  renderAll(records);

  document.getElementById("filterFruit").addEventListener("change", e => {
    populateVarietySelect(getRecords(), e.target.value);
    renderAll(getRecords());
  });
  ["filterVariety","filterStage"].forEach(id =>
    document.getElementById(id).addEventListener("change", () => renderAll(getRecords()))
  );
  document.getElementById("filterYear").addEventListener("change", () => {
    const yr = document.getElementById("filterYear").value;
    document.getElementById("tlYear").value = yr;
    renderAll(getRecords());
  });
  document.getElementById("resetFilters").addEventListener("click", () => {
    ["filterFruit","filterVariety","filterYear","filterStage"].forEach(id =>
      document.getElementById(id).value = "");
    populateVarietySelect(getRecords(), "");
    renderAll(getRecords());
  });
  document.getElementById("btnBack").addEventListener("click", () => {
    document.getElementById("filterVariety").value = "";
    renderAll(getRecords());
  });
  document.getElementById("btnReset").addEventListener("click", () => {
    document.getElementById("filterFruit").value   = "";
    document.getElementById("filterVariety").value = "";
    populateVarietySelect(getRecords(), "");
    renderAll(getRecords());
  });
  document.getElementById("tlPlay").addEventListener("click", () => startTimelapse(getRecords()));
  document.getElementById("tlStop").addEventListener("click", () => {
    stopTimelapse();
    renderAll(getRecords());
  });
  document.getElementById("chartStage").addEventListener("change", () => renderTrendChart(getRecords()));

  // If not complete, load the rest in the background
  if (!result.complete) {
    const loadingText = document.getElementById("loadingText");
    const loadingIndicator = document.getElementById("loadingIndicator");
    if (loadingIndicator) {
      loadingIndicator.style.display = "flex";
      loadingText.textContent = `Loading more… ${records.length.toLocaleString()} records so far`;
    }

    try {
      records = await fetchRemaining(records, result.offset, updatedRecords => {
        recordsRef = updatedRecords;
        // Re-populate selects and re-render quietly in background
        populateFruitSelect(updatedRecords);
        populateVarietySelect(updatedRecords, document.getElementById("filterFruit").value);
        populateYearSelect(updatedRecords);
        renderAll(updatedRecords);
      });
      recordsRef = records;
      renderAll(records);
      renderTrendChart(records);
      populateTlYearSelect(records);
    } catch(e) {
      console.warn("Background load failed:", e);
    }
    if (loadingIndicator) loadingIndicator.style.display = "none";
  }
});
