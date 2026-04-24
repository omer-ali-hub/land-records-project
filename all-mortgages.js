/* global L */

const FHA_COLOR = "#2563eb";
const VA_COLOR = "#facc15";
const CONVENTIONAL_COLOR = "#94a3b8";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNum(v) {
  return Number(v || 0).toLocaleString();
}

function mapsBaseUrl() {
  let raw = (document.body.dataset.mapsBase ?? "../data_summary/").trim();
  if (raw === "") return "";
  if (!raw.endsWith("/")) raw += "/";
  return raw;
}

/**
 * Bust browser/CDN caches: GitHub Pages caches JSON for ~10 minutes by default,
 * so we append a unique timestamp to force a fresh fetch on every page load.
 */
function withCacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

async function loadAllMortgagesJson() {
  const candidates = ["all_mortgages.json", "../data_summary/all_mortgages.json"];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(withCacheBust(url), { cache: "no-store" });
    if (res.ok) return await res.json();
    lastStatus = res.status;
  }
  throw new Error(lastStatus != null ? `HTTP ${lastStatus}` : "No all_mortgages file found");
}

function applyChartTheme() {
  const Chart = window.Chart;
  if (!Chart) return;
  Chart.defaults.color = "#94a3b8";
  Chart.defaults.borderColor = "rgba(71, 85, 105, 0.35)";
  Chart.defaults.font.family = '"Plus Jakarta Sans", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
}

let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach((ch) => {
    try {
      ch.destroy();
    } catch {
      /* ignore */
    }
  });
  chartInstances = [];
}

function setPlaceholder(root, message) {
  destroyCharts();
  root.innerHTML = `<p class="trends-charts-placeholder">${escapeHtml(message)}</p>`;
  root.setAttribute("aria-busy", "false");
}

function renderCharts(root, counties) {
  destroyCharts();
  const Chart = window.Chart;
  if (!Chart) {
    setPlaceholder(root, "Charts need Chart.js (check your network).");
    return;
  }
  applyChartTheme();
  root.innerHTML = "";
  root.setAttribute("aria-busy", "false");

  counties.forEach((c, i) => {
    const rows = (Array.isArray(c.yearly_counts) ? c.yearly_counts : []).filter(
      (r) => Number(r.year) >= 1929 && Number(r.year) <= 1976,
    );
    const labels = rows.map((r) => String(r.year));
    const fha = rows.map((r) => Number(r.FHA || 0));
    const va = rows.map((r) => Number(r.VA || 0));
    const conventional = rows.map((r) => Number(r.Conventional || 0));
    const totals = rows.map((r) => Number(r.Total || 0));

    const title = [c.county_name, c.state].filter(Boolean).join(", ");
    const article = document.createElement("article");
    article.className = "trends-chart-card";
    article.innerHTML = `
      <header class="trends-chart-card__head">
        <h3>${escapeHtml(title)}</h3>
        <span class="trends-chart-card__meta">${formatNum((c.totals || {}).Total)} mortgages</span>
      </header>
      <div class="trends-chart-canvas-wrap">
        <canvas id="all-mortgages-chart-${i}"></canvas>
      </div>
    `;
    root.appendChild(article);

    const canvas = article.querySelector("canvas");
    if (!canvas) return;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `All mortgages by year for ${title}`);

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "FHA", data: fha, backgroundColor: "rgba(37, 99, 235, 0.92)", borderColor: "rgba(37, 99, 235, 0.35)", borderWidth: 1, borderRadius: 4, borderSkipped: false, stack: "year" },
          { label: "VA", data: va, backgroundColor: "rgba(250, 204, 21, 0.92)", borderColor: "rgba(250, 204, 21, 0.4)", borderWidth: 1, borderRadius: 4, borderSkipped: false, stack: "year" },
          { label: "Conventional", data: conventional, backgroundColor: "rgba(100, 116, 139, 0.9)", borderColor: "rgba(148, 163, 184, 0.5)", borderWidth: 1, borderRadius: 4, borderSkipped: false, stack: "year" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 14, boxHeight: 14, padding: 18, usePointStyle: true, pointStyle: "rectRounded" } },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)", titleColor: "#f1f5f9", bodyColor: "#e2e8f0", footerColor: "#94a3b8",
            borderColor: "rgba(51, 65, 85, 0.8)", borderWidth: 1, padding: 12, cornerRadius: 10,
            callbacks: {
              label(ctx) { const v = ctx.parsed.y; return `${ctx.dataset.label}: ${formatNum(v == null ? 0 : v)}`; },
              footer(items) { if (!items.length) return ""; return `Year total: ${formatNum(totals[items[0].dataIndex])}`; },
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { color: "rgba(71, 85, 105, 0.2)" }, ticks: { autoSkip: true, maxTicksLimit: 24, maxRotation: 0, minRotation: 0, font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, grid: { color: "rgba(71, 85, 105, 0.2)" }, ticks: { precision: 0, font: { size: 11 } } },
        },
      },
    });
    chartInstances.push(chart);
  });
}

async function fetchGeoJson(relPath) {
  const url = withCacheBust(`${mapsBaseUrl()}${relPath.replace(/^\//, "")}`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GeoJSON ${res.status}`);
  return await res.json();
}

function tooltipHtml(props) {
  return `<strong>${escapeHtml(props.kind || "")}</strong><br/>Year: ${escapeHtml(props.year || "")}`;
}

function addYearPoints(layer, featureCollection, year) {
  layer.clearLayers();
  for (const f of featureCollection.features || []) {
    const p = f.properties || {};
    if (Number(p.year) !== Number(year)) continue;
    const [lng, lat] = f.geometry.coordinates || [];
    if (lat == null || lng == null) continue;
    const latlng = L.latLng(lat, lng);

    if (p.kind === "FHA") {
      const icon = L.divIcon({
        className: "maps-fha-x-wrap",
        html: `<span class="maps-fha-x" style="color:${FHA_COLOR}">×</span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const m = L.marker(latlng, { icon });
      m.bindTooltip(tooltipHtml(p), { sticky: true });
      layer.addLayer(m);
    } else if (p.kind === "VA") {
      const m = L.circleMarker(latlng, {
        radius: 3,
        color: VA_COLOR,
        weight: 1.2,
        fill: false,
        fillOpacity: 0,
      });
      m.bindTooltip(tooltipHtml(p), { sticky: true });
      layer.addLayer(m);
    } else if (p.kind === "Conventional") {
      const m = L.circleMarker(latlng, {
        radius: 1,
        color: CONVENTIONAL_COLOR,
        weight: 1,
        fillColor: CONVENTIONAL_COLOR,
        fillOpacity: 0.85,
      });
      m.bindTooltip(tooltipHtml(p), { sticky: true });
      layer.addLayer(m);
    }
  }
}

async function renderMaps(root, counties) {
  root.innerHTML = "";
  root.setAttribute("aria-busy", "false");

  for (const c of counties) {
    const title = [c.county_name, c.state].filter(Boolean).join(", ");
    const card = document.createElement("article");
    card.className = "maps-county-card all-mortgages-map-card";
    card.innerHTML = `
      <header class="maps-county-card__head">
        <h3>${escapeHtml(title)}</h3>
        <span class="maps-county-meta">${formatNum(c.map_feature_count || 0)} mapped points</span>
      </header>
      <div class="all-mortgages-map-legend" role="group" aria-label="Mortgage type symbols">
        <span class="all-mortgages-legend-item">
          <span class="all-mortgages-legend-swatch all-mortgages-legend-swatch--fha" aria-hidden="true">×</span>
          <span>FHA</span>
        </span>
        <span class="all-mortgages-legend-item">
          <span class="all-mortgages-legend-swatch all-mortgages-legend-swatch--va" aria-hidden="true"></span>
          <span>VA</span>
        </span>
        <span class="all-mortgages-legend-item">
          <span class="all-mortgages-legend-swatch all-mortgages-legend-swatch--conventional" aria-hidden="true"></span>
          <span>Conventional</span>
        </span>
      </div>
      <div class="maps-leaflet-root all-mortgages-map-root"></div>
      <div class="all-mortgages-slider-wrap">
        <label for="all-mortgages-year-${escapeHtml(c.county_id || c.county_name || "x")}">Year: <strong class="all-mortgages-year-label">1929</strong></label>
        <input class="all-mortgages-year-slider" type="range" min="1929" max="1976" step="1" value="1929" />
      </div>
      <p class="all-mortgages-map-note"></p>
    `;
    root.appendChild(card);

    const mapEl = card.querySelector(".all-mortgages-map-root");
    const slider = card.querySelector(".all-mortgages-year-slider");
    const yearLabel = card.querySelector(".all-mortgages-year-label");
    const note = card.querySelector(".all-mortgages-map-note");

    if (!c.map_geojson || !(c.map_feature_count > 0)) {
      slider.disabled = true;
      note.textContent = c.has_lat_lon
        ? "No mapped points in 1929-1976 after filtering."
        : "No lat/lon columns in this source dataset, so map points are unavailable.";
      mapEl.innerHTML = '<p class="maps-inline-error">No geocoded points available for this county.</p>';
      continue;
    }

    try {
      const points = await fetchGeoJson(c.map_geojson);
      const map = L.map(mapEl, { scrollWheelZoom: true, maxZoom: 20 });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
      }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      const gj = L.geoJSON(points);
      const b = gj.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.08));
      else map.setView([40.3, -75.9], 10);

      const renderYear = (y) => {
        yearLabel.textContent = String(y);
        addYearPoints(layer, points, y);
      };
      renderYear(1929);

      slider.addEventListener("input", () => renderYear(Number(slider.value)));
      note.textContent = "Use the slider to show points for one year at a time.";
      setTimeout(() => map.invalidateSize(), 0);
    } catch (e) {
      slider.disabled = true;
      note.textContent = "Could not load map GeoJSON.";
      mapEl.innerHTML = `<p class="maps-inline-error">${escapeHtml(e.message || String(e))}</p>`;
    }
  }
}

async function initAllMortgagesPage() {
  const chartsRoot = document.getElementById("all-mortgages-charts-root");
  const mapsRoot = document.getElementById("all-mortgages-maps-root");
  const meta = document.getElementById("all-mortgages-generated-at");
  if (!chartsRoot) return;
  try {
    const data = await loadAllMortgagesJson();
    if (data.generated_at && meta) {
      const dt = new Date(data.generated_at);
      meta.textContent = `Generated ${dt.toLocaleString()}`;
    }
    const counties = Array.isArray(data.counties) ? data.counties : [];
    if (!counties.length) {
      setPlaceholder(chartsRoot, "No counties with all-mortgage data yet.");
      if (mapsRoot) {
        mapsRoot.innerHTML = '<p class="maps-page-placeholder">No map counties yet.</p>';
        mapsRoot.setAttribute("aria-busy", "false");
      }
      return;
    }
    renderCharts(chartsRoot, counties);
    if (mapsRoot) await renderMaps(mapsRoot, counties);
  } catch (err) {
    console.error(err);
    if (meta) meta.textContent = "Could not load all mortgages";
    setPlaceholder(chartsRoot, "Could not load all_mortgages.json. Run python scripts/build_summary.py.");
    if (mapsRoot) {
      mapsRoot.innerHTML = '<p class="maps-page-placeholder">Could not load map data.</p>';
      mapsRoot.setAttribute("aria-busy", "false");
    }
  }
}

document.addEventListener("DOMContentLoaded", initAllMortgagesPage);
