/* global L */

const CARTO_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

const FHA_SINGLE = "#2563eb";
const VA_SINGLE = "#facc15";

/** Outer ring (lat, lng) covering the globe; holes cut out county shapes for the mask. */
const WORLD_MASK_OUTER = [
  [87, -179.9],
  [87, 179.9],
  [-87, 179.9],
  [-87, -179.9],
  [87, -179.9],
];

function mapsBaseUrl() {
  let raw = (document.body.dataset.mapsBase ?? "../data_summary/").trim();
  if (raw === "") return "";
  if (!raw.endsWith("/")) raw += "/";
  return raw;
}

function colorForYear(year) {
  const t = Math.max(0, Math.min(1, (Number(year) - 1935) / (1975 - 1935)));
  const hue = 188 + t * 132;
  return `hsl(${hue} 70% 40%)`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const geoCache = new Map();

async function fetchGeoJson(relPath) {
  if (geoCache.has(relPath)) return geoCache.get(relPath);
  const res = await fetch(`${mapsBaseUrl()}${relPath.replace(/^\//, "")}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GeoJSON ${res.status}`);
  const gj = await res.json();
  geoCache.set(relPath, gj);
  return gj;
}

function ringLngLatToLatLng(ring) {
  return ring.map((c) => [c[1], c[0]]);
}

/**
 * Exterior rings (Leaflet [lat,lng]) for each county polygon part — used as holes in the world mask.
 */
function boundaryHolesLatLngs(featureCollection) {
  const holes = [];
  const feats = featureCollection.features || [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon" && g.coordinates && g.coordinates[0]) {
      holes.push(ringLngLatToLatLng(g.coordinates[0]));
    } else if (g.type === "MultiPolygon" && g.coordinates) {
      for (const poly of g.coordinates) {
        if (poly && poly[0]) holes.push(ringLngLatToLatLng(poly[0]));
      }
    }
  }
  return holes;
}

function tooltipHtml(props, allMode) {
  const y = props.year;
  const p = props.period;
  const k = props.kind;
  const parts = [`<strong>${escapeHtml(k)}</strong>`, `Year: ${y}`];
  if (allMode) parts.push(`Period: ${escapeHtml(p)}`);
  return parts.join("<br/>");
}

/**
 * Fill a layer group with point symbols for the selected period (no clustering).
 */
function fillPointsLayer(layerGroup, geojson, selectedPeriod, allValue, canvasRenderer) {
  layerGroup.clearLayers();
  const allMode = selectedPeriod === allValue;

  for (const f of geojson.features || []) {
    const props = f.properties || {};
    const p = props.period;
    if (selectedPeriod !== allValue && p !== selectedPeriod) continue;
    const kind = props.kind;
    if (kind !== "FHA" && kind !== "VA") continue;
    const [lng, lat] = f.geometry.coordinates;
    const latlng = L.latLng(lat, lng);
    const color = kind === "VA" ? VA_SINGLE : FHA_SINGLE;
    const tip = tooltipHtml(props, allMode);

    if (kind === "VA") {
      const m = L.circleMarker(latlng, {
        radius: 3,
        color: color,
        weight: 1.2,
        fill: false,
        fillOpacity: 0,
        renderer: canvasRenderer,
      });
      m.bindTooltip(tip, { sticky: true });
      layerGroup.addLayer(m);
    } else {
      const icon = L.divIcon({
        className: "maps-fha-x-wrap",
        html: `<span class="maps-fha-x" style="color:${color}">×</span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const m = L.marker(latlng, { icon });
      m.bindTooltip(tip, { sticky: true });
      layerGroup.addLayer(m);
    }
  }
}

const mapsForResize = [];

function initCountyBlock(container, entry, allValue) {
  const mapEl = container.querySelector(".maps-leaflet-root");
  const select = container.querySelector("select");
  let map = null;
  let pointsLayer = null;
  let pointsGeojson = null;
  const canvasRenderer = L.canvas({ padding: 0.5 });

  function applyPeriod() {
    if (!map || !pointsLayer || !pointsGeojson) return;
    fillPointsLayer(pointsLayer, pointsGeojson, select.value, allValue, canvasRenderer);
  }

  async function setup() {
    pointsGeojson = await fetchGeoJson(entry.geojson);

    let boundaryFC = null;
    if (entry.boundary) {
      try {
        boundaryFC = await fetchGeoJson(entry.boundary);
      } catch (e) {
        console.warn("Boundary load failed", e);
      }
    }

    map = L.map(mapEl, {
      scrollWheelZoom: true,
      maxZoom: 20,
      maxBoundsViscosity: 1.0,
    });
    mapsForResize.push(map);

    L.tileLayer(CARTO_LIGHT, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
      maxNativeZoom: 20,
    }).addTo(map);

    let countyBounds = null;
    if (boundaryFC && (boundaryFC.features || []).length) {
      const gjLayer = L.geoJSON(boundaryFC, {
        style: {
          color: "#64748b",
          weight: 2,
          fillOpacity: 0,
          opacity: 0.95,
        },
        interactive: false,
      });
      countyBounds = gjLayer.getBounds();

      const holes = boundaryHolesLatLngs(boundaryFC);
      if (holes.length) {
        const maskLatLngs = [WORLD_MASK_OUTER, ...holes];
        L.polygon(maskLatLngs, {
          stroke: false,
          fillColor: "#020617",
          fillOpacity: 0.78,
          interactive: false,
          className: "maps-county-dim-mask",
        }).addTo(map);
      }
      gjLayer.addTo(map);
    } else if (entry.bounds && entry.bounds.length === 2) {
      countyBounds = L.latLngBounds(entry.bounds[0], entry.bounds[1]);
      L.rectangle(countyBounds, {
        color: "#64748b",
        weight: 2,
        fillOpacity: 0,
        interactive: false,
      }).addTo(map);
    }

    if (countyBounds && countyBounds.isValid()) {
      map.fitBounds(countyBounds.pad(0.06));
      map.setMaxBounds(countyBounds.pad(0.2));
      const z = map.getZoom();
      map.setMinZoom(Math.max(1, z - 1));
    } else {
      map.setView([39.5, -98.35], 9);
    }

    pointsLayer = L.layerGroup().addTo(map);
    applyPeriod();

    setTimeout(() => map.invalidateSize(), 0);
  }

  select.addEventListener("change", () => {
    applyPeriod();
  });

  setup().catch((e) => {
    console.error(e);
    mapEl.innerHTML = `<p class="maps-inline-error">${escapeHtml(e.message || String(e))}</p>`;
  });
}

async function initMapsPage() {
  const root = document.getElementById("maps-county-list");
  const meta = document.getElementById("maps-generated-at");
  if (!root) return;

  try {
    const res = await fetch(`${mapsBaseUrl()}maps_index.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`maps_index ${res.status}`);
    const data = await res.json();
    if (data.generated_at && meta) {
      const dt = new Date(data.generated_at);
      meta.textContent = `Generated ${dt.toLocaleString()}`;
    }

    const periods = Array.isArray(data.periods) ? data.periods : [];
    const allValue = data.all_periods_value || "all";
    const counties = Array.isArray(data.counties) ? data.counties : [];

    if (!counties.length) {
      root.innerHTML =
        '<p class="maps-page-placeholder">No counties with map data. Run <code>python scripts/build_summary.py</code> with data on disk.</p>';
      root.setAttribute("aria-busy", "false");
      return;
    }

    root.innerHTML = "";
    root.setAttribute("aria-busy", "false");

    counties.forEach((c) => {
      const title = [c.county_name, c.state].filter(Boolean).join(", ");
      const opts = [
        ...periods.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`),
        `<option value="${escapeHtml(allValue)}">All years</option>`,
      ].join("");

      const card = document.createElement("article");
      card.className = "maps-county-card";
      card.innerHTML = `
        <header class="maps-county-card__head">
          <h3>${escapeHtml(title)}</h3>
          <div class="maps-county-card__controls">
            <label class="maps-period-label">
              <span>Period</span>
              <select class="maps-period-select" aria-label="Period for ${escapeHtml(title)}">
                ${opts}
              </select>
            </label>
            <span class="maps-county-meta">${Number(c.feature_count || 0).toLocaleString()} points</span>
          </div>
        </header>
        <div class="maps-leaflet-root" role="application" aria-label="Map: ${escapeHtml(title)}"></div>
      `;
      root.appendChild(card);
      initCountyBlock(card, c, allValue);
    });

    window.addEventListener("resize", () => {
      mapsForResize.forEach((m) => {
        try {
          m.invalidateSize();
        } catch {
          /* ignore */
        }
      });
    });
  } catch (err) {
    console.error(err);
    if (meta) meta.textContent = "Could not load maps index";
    root.innerHTML = `<p class="maps-page-placeholder">Could not load maps data. ${escapeHtml(err.message || String(err))}</p>`;
    root.setAttribute("aria-busy", "false");
  }
}

document.addEventListener("DOMContentLoaded", initMapsPage);
