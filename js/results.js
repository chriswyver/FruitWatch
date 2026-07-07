// FruitWatch — results.js

const FEATURE_LAYER_URL = "https://services1.arcgis.com/PhkL97KbkzUBf4PQ/arcgis/rest/services/survey123_f04dc9ec2ecf4883be13f840229b9ea5_results/FeatureServer/0";

const SPECIES_CONFIG = [
  { name: "Apple",      field: "variety_apple",     otherField: "variety_apple_other",     color: "#E8B4C8" },
  { name: "Crab-apple", field: "variety_crab_apple", otherField: "variety_crab_apple_other", color: "#9FBFA8" },
  { name: "Apricot",    field: "field_31",           otherField: "field_31_other",           color: "#F0B27A" },
  { name: "Cherry",     field: "field_32",           otherField: "field_32_other",           color: "#C97D9A" },
  { name: "Peach",      field: "field_34",           otherField: "field_34_other",           color: "#F2A0A0" },
  { name: "Pear",       field: "variety_pear",       otherField: "variety_pear_other",       color: "#D8E0A0" },
  { name: "Plum",       field: "field_36",           otherField: "field_36_other",           color: "#8C6BA8" },
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

async function fetchRecords() {
  let allFeatures = [];
  let offset = 0;
  let exceeded = true;

  while (exceeded) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      orderByFields: "date_time DESC",
      resultRecordCount: 1000,
      resultOffset: offset,
      f: "json"
    });
    const res  = await fetch(`${FEATURE_LAYER_URL}/query?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Query failed");
    allFeatures = allFeatures.concat(data.features || []);
    exceeded = data.exceededTransferLimit === true;
    offset += 1000;
    if (offset > 10000) break;
  }

  return allFeatures.map(f => {
    const a = f.attributes;
    const g = f.geometry || {};
    const speciesCfg = SPECIES_CONFIG.find(s => s.name === a.fruit);
    let variety = "";
    if (speciesCfg) variety = a[speciesCfg.field] || a[speciesCfg.otherField] || "";
    if (variety === "other") variety = "";
    if (!variety || variety === "Unknown") variety = "Unknown variety";
    return {
      species:  a.fruit || "Unknown",
      variety,
      date:     a.date_time ? new Date(a.date_time) : null,
      stage:    normaliseStage(a.flowering_stage),
      postcode: a.postcode || "",
      x: g.x, y: g.y
    };
  }).filter(r => r.date !== null);
}

// ---------- Utilities ----------

function formatDate(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function formatShortDate(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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

// ---------- Leaflet map ----------

function initMap() {
  leafletMap = L.map("leafletMap", { zoomControl: true, maxZoom: 12 }).setView([54.5, -3], 5);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '© <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 12
  }).addTo(leafletMap);
  markerLayer = L.layerGroup().addTo(leafletMap);
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
  tag.textContent = `${filtered.length} record${filtered.length === 1 ? "" : "s"}`;

  filtered.forEach(r => {
    if (!r.x || !r.y) return;
    const color = colorFor(r.species);
    const svg   = markerSvg(color, r.stage);

    const icon = L.divIcon({
      html: svg,
      className: "",
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    const marker = L.marker([r.y, r.x], { icon });
    marker.bindTooltip(
      `<strong>${r.species}</strong>${r.variety !== "Unknown variety" ? "<br>" + r.variety : ""}
       <br>${r.stage}<br>${formatDate(r.date)}${r.postcode ? "<br>" + r.postcode : ""}`,
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
      <td>${r.postcode || "—"}</td>
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

  let records;
  try {
    records = await fetchRecords();
  } catch (err) {
    showError(`Could not load data: ${err.message}`);
    return;
  }

  populateFruitSelect(records);
  populateVarietySelect(records, "");
  populateYearSelect(records);

  document.getElementById("filterFruit").addEventListener("change", e => {
    populateVarietySelect(records, e.target.value);
    renderAll(records);
  });
  ["filterVariety","filterStage"].forEach(id =>
    document.getElementById(id).addEventListener("change", () => renderAll(records))
  );
  document.getElementById("filterYear").addEventListener("change", () => {
    // Sync timelapse year to match main filter
    const yr = document.getElementById("filterYear").value;
    document.getElementById("tlYear").value = yr;
    renderAll(records);
  });
  document.getElementById("resetFilters").addEventListener("click", () => {
    ["filterFruit","filterVariety","filterYear","filterStage"].forEach(id =>
      document.getElementById(id).value = "");
    populateVarietySelect(records, "");
    renderAll(records);
  });

  // Back: clear variety, keep fruit
  document.getElementById("btnBack").addEventListener("click", () => {
    document.getElementById("filterVariety").value = "";
    renderAll(records);
  });

  // Reset: clear fruit and variety, keep year/stage
  document.getElementById("btnReset").addEventListener("click", () => {
    document.getElementById("filterFruit").value   = "";
    document.getElementById("filterVariety").value = "";
    populateVarietySelect(records, "");
    renderAll(records);
  });

  // Timelapse
  populateTlYearSelect(records);
  document.getElementById("tlPlay").addEventListener("click", () => startTimelapse(records));
  document.getElementById("tlStop").addEventListener("click", () => {
    stopTimelapse();
    renderAll(records);
  });

  renderAll(records);
});
