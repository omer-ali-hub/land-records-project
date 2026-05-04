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

/** Bust browser/CDN caches so each visit fetches fresh JSON. */
function withCacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

const geoCache = new Map();

async function fetchGeoJson(relPath) {
  if (geoCache.has(relPath)) return geoCache.get(relPath);
  const url = withCacheBust(`${mapsBaseUrl()}${relPath.replace(/^\//, "")}`);
  const res = await fetch(url, { cache: "no-store" });
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

/** Choropleth fill for 0–100% Black share (1970 NHGIS “Negro” / total race counts). */
function blackShareFillColor(pct) {
  const n = Number(pct);
  if (pct == null || Number.isNaN(n)) return "rgba(148, 163, 184, 0.42)";
  const t = Math.max(0, Math.min(1, n / 100));
  const r = Math.round(248 - t * 187);
  const g = Math.round(250 - t * 221);
  const b = Math.round(252 - t * 103);
  return `rgb(${r},${g},${b})`;
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

function disposeMapInstance(m) {
  if (!m) return;
  const idx = mapsForResize.indexOf(m);
  if (idx >= 0) mapsForResize.splice(idx, 1);
  try {
    m.remove();
  } catch {
    /* ignore */
  }
}

function destroyLeafletOnCard(container) {
  const existing = container._leafletMap;
  if (!existing) return;
  disposeMapInstance(existing);
  container._leafletMap = null;
}

function initCountyBlock(container, entry, allValue, initSeq) {
  const mapEl = container.querySelector(".maps-leaflet-root");
  const select = container.querySelector("select");
  const blackShareCb = container.querySelector(".maps-black-share-cb");
  const tractLegend = container.querySelector(".maps-tract-legend");
  let map = null;
  let pointsLayer = null;
  let pointsGeojson = null;
  let tractLayerRoot = null;
  let tractGeoLoaded = null;
  const censusRel = entry.census_tract_black_share || "";
  const canvasRenderer = L.canvas({ padding: 0.5 });
  const stale = () =>
    initSeq !== undefined && Number(container.dataset.mapsInitSeq) !== initSeq;

  function applyPeriod() {
    if (!map || !pointsLayer || !pointsGeojson) return;
    fillPointsLayer(pointsLayer, pointsGeojson, select.value, allValue, canvasRenderer);
  }

  async function ensureTractLayerOnMap() {
    if (!map || !tractLayerRoot || !censusRel) return;
    if (!tractGeoLoaded) {
      const gj = await fetchGeoJson(censusRel);
      if (stale()) return;
      L.geoJSON(gj, {
        pane: "mapsTractPane",
        style(feat) {
          const p = feat.properties?.pct_black;
          return {
            fillColor: blackShareFillColor(p),
            color: "rgba(30, 41, 59, 0.45)",
            weight: 0.35,
            fillOpacity: 0.62,
          };
        },
        onEachFeature(feat, lyr) {
          const p = feat.properties?.pct_black;
          const t =
            p != null && !Number.isNaN(Number(p))
              ? `${Number(p).toFixed(1)}% Black (1970 tract)`
              : "Share n/a";
          lyr.bindTooltip(`<span>${escapeHtml(t)}</span>`, { sticky: true });
        },
      }).addTo(tractLayerRoot);
      tractGeoLoaded = true;
    }
    if (!map.hasLayer(tractLayerRoot)) tractLayerRoot.addTo(map);
    if (tractLegend) tractLegend.hidden = false;
  }

  function removeTractLayerFromMap() {
    if (map && tractLayerRoot && map.hasLayer(tractLayerRoot)) {
      map.removeLayer(tractLayerRoot);
    }
    if (tractLegend) tractLegend.hidden = true;
  }

  async function setup() {
    pointsGeojson = await fetchGeoJson(entry.geojson);
    if (stale()) return;

    let boundaryFC = null;
    if (entry.boundary) {
      try {
        boundaryFC = await fetchGeoJson(entry.boundary);
      } catch (e) {
        console.warn("Boundary load failed", e);
      }
    }
    if (stale()) return;

    map = L.map(mapEl, {
      scrollWheelZoom: true,
      maxZoom: 20,
      maxBoundsViscosity: 1.0,
    });
    mapsForResize.push(map);

    map.createPane("mapsTractPane");
    map.getPane("mapsTractPane").style.zIndex = 360;
    map.createPane("mapsMaskPane");
    map.getPane("mapsMaskPane").style.zIndex = 380;
    map.createPane("mapsBoundaryPane");
    map.getPane("mapsBoundaryPane").style.zIndex = 385;
    map.createPane("mapsPointsPane");
    map.getPane("mapsPointsPane").style.zIndex = 450;

    tractLayerRoot = L.layerGroup({ pane: "mapsTractPane" });

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
        pane: "mapsBoundaryPane",
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
          pane: "mapsMaskPane",
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
        pane: "mapsBoundaryPane",
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

    pointsLayer = L.layerGroup({ pane: "mapsPointsPane" }).addTo(map);
    applyPeriod();

    if (blackShareCb && blackShareCb.checked && censusRel) {
      await ensureTractLayerOnMap();
    }

    if (stale()) {
      disposeMapInstance(map);
      map = null;
      return;
    }

    container._leafletMap = map;

    setTimeout(() => map.invalidateSize(), 0);
  }

  select.addEventListener("change", () => {
    applyPeriod();
  });

  if (blackShareCb) {
    blackShareCb.addEventListener("change", async () => {
      if (!map) return;
      try {
        if (blackShareCb.checked) await ensureTractLayerOnMap();
        else removeTractLayerFromMap();
      } catch (e) {
        console.error(e);
        blackShareCb.checked = false;
        removeTractLayerFromMap();
      }
    });
  }

  setup().catch((e) => {
    console.error(e);
    if (map) disposeMapInstance(map);
    if (stale()) return;
    container._leafletMap = null;
    mapEl.innerHTML = `<p class="maps-inline-error">${escapeHtml(e.message || String(e))}</p>`;
  });
}

function countyPickKey(c) {
  return String(c.county_id || c.geoid || [c.county_name, c.state].filter(Boolean).join("|"));
}

async function initMapsPage() {
  const root = document.getElementById("maps-county-list");
  const meta = document.getElementById("maps-generated-at");
  if (!root) return;

  try {
    const res = await fetch(withCacheBust(`${mapsBaseUrl()}maps_index.json`), { cache: "no-store" });
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

    root.innerHTML = `
      <div class="maps-picker" role="region" aria-label="Choose a county">
        <div class="maps-county-pick-grid" id="maps-county-pick-grid" role="group" aria-label="Counties with map data"></div>
      </div>
      <div id="maps-selected-wrap" class="maps-selected-wrap">
        <p id="maps-select-hint" class="maps-page-placeholder maps-select-hint">
          Click a county name below. The map and mortgage points load only after you pick a county.
        </p>
      </div>
    `;
    root.setAttribute("aria-busy", "false");

    let selectedKey = null;
    /** Avoid tearing down Leaflet when the user clicks the same county again. */
    let lastLoadedEntryKey = null;
    /** Bumps when starting a new map load so stale async setups do not attach. */
    let mapInitSeq = 0;

    function renderPicker() {
      const grid = document.getElementById("maps-county-pick-grid");
      grid.innerHTML = "";
      for (const c of counties) {
        const key = countyPickKey(c);
        const title = [c.county_name, c.state].filter(Boolean).join(", ");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "maps-county-pick-btn";
        btn.setAttribute("aria-pressed", key === selectedKey ? "true" : "false");
        if (key === selectedKey) btn.classList.add("is-selected");
        btn.textContent = title;
        btn.addEventListener("click", () => {
          selectedKey = key;
          renderPicker();
          showCountyMap(c, periods, allValue);
        });
        grid.appendChild(btn);
      }
    }

    function showCountyMap(entry, periodsList, allPeriodsValue) {
      const wrap = document.getElementById("maps-selected-wrap");
      const entryKey = countyPickKey(entry);
      const existingCard = wrap.querySelector(".maps-county-card");
      if (existingCard && existingCard._leafletMap && lastLoadedEntryKey === entryKey) {
        return;
      }
      lastLoadedEntryKey = entryKey;

      const hint = document.getElementById("maps-select-hint");
      if (hint) hint.remove();

      let card = wrap.querySelector(".maps-county-card");
      if (!card) {
        card = document.createElement("article");
        card.className = "maps-county-card";
        wrap.appendChild(card);
      }

      destroyLeafletOnCard(card);

      const title = [entry.county_name, entry.state].filter(Boolean).join(", ");
      const opts = [
        ...periodsList.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`),
        `<option value="${escapeHtml(allPeriodsValue)}">All years</option>`,
      ].join("");
      const hasTractRace = Boolean(entry.census_tract_black_share);
      const tractHint = hasTractRace
        ? "NHGIS 1970 tract race table (Negro share of White+Negro+Other)."
        : "Tract race layer not built for this county (run build with census_data + geopandas).";

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
            <label class="maps-black-share-label ${hasTractRace ? "" : "maps-black-share-label--na"}" title="${escapeHtml(tractHint)}">
              <input type="checkbox" class="maps-black-share-cb" ${hasTractRace ? "" : "disabled"} aria-describedby="maps-tract-footnote" />
              <span>1970 Black pop. share (tract)</span>
            </label>
            <span class="maps-county-meta">${Number(entry.feature_count || 0).toLocaleString()} points</span>
          </div>
        </header>
        <p id="maps-tract-footnote" class="maps-tract-footnote">
          Tract layer draws <strong>below</strong> FHA/VA points. Source: IPUMS NHGIS 1970 tract boundaries + race counts (see codebook).
        </p>
        <div class="maps-map-shell">
          <div class="maps-leaflet-root" role="application" aria-label="Map: ${escapeHtml(title)}"></div>
          <div class="maps-tract-legend" hidden>
            <div class="maps-tract-legend__title">1970 tract Black share</div>
            <div class="maps-tract-legend__bar" aria-hidden="true"></div>
            <div class="maps-tract-legend__ticks"><span>0%</span><span>50%</span><span>100%</span></div>
          </div>
        </div>
      `;
      const seq = ++mapInitSeq;
      card.dataset.mapsInitSeq = String(seq);
      initCountyBlock(card, entry, allPeriodsValue, seq);
    }

    renderPicker();

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
