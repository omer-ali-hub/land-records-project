/**
 * Continental US county map: highlights ACQUIRED vs PENDING using Census GEOIDs
 * from summary.json and us-atlas TopoJSON (D3 + topojson-client).
 * County names appear only on hover (no connector lines).
 * Wheel / pinch / drag to zoom and pan.
 */
function trackerStatusCategoryForMap(statusVal) {
  if (statusVal === undefined || statusVal === null) return "No status";
  const s = String(statusVal).trim();
  if (!s || s.toLowerCase() === "nan") return "No status";
  const idx = s.indexOf(" - ");
  if (idx !== -1) return s.slice(idx + 3).trim();
  return s;
}

function geoidKey(id) {
  const n = Number(id);
  if (Number.isFinite(n)) return String(Math.floor(n)).padStart(5, "0");
  return String(id).padStart(5, "0");
}

function featureGeoid(f) {
  const raw = f.id != null ? f.id : f.properties && f.properties.GEOID;
  if (raw == null) return null;
  return geoidKey(raw);
}

/** State FIPS prefixes to exclude (AK, HI, territories, etc.) — lower 48 + DC only. */
const EXCLUDED_STATE_FIPS = new Set([
  "02",
  "15",
  "60",
  "66",
  "69",
  "72",
  "78",
  "03",
  "64",
]);

function isContinentalGeoid(geoid) {
  const g = String(geoid).padStart(5, "0");
  return !EXCLUDED_STATE_FIPS.has(g.slice(0, 2));
}

function stateFeatureFips(f) {
  const id = f.id;
  const n = Number(id);
  if (Number.isFinite(n)) return String(n).padStart(2, "0").slice(0, 2);
  return String(id).padStart(2, "0").slice(0, 2);
}

function shortCountyLabel(name) {
  return String(name || "")
    .replace(/\s+County$/i, "")
    .replace(/\s+Parish$/i, "")
    .replace(/\s+city$/i, "")
    .trim();
}

function formatCountyHoverLabel(info) {
  let t = shortCountyLabel(info.name);
  if (info.st) t = `${t}, ${info.st}`;
  if (t.length > 36) t = `${t.slice(0, 34)}…`;
  return t;
}

/** One feature per GEOID (topojson can repeat ids). */
function dedupeFeaturesByGeoid(features) {
  const seen = new Set();
  return features.filter((f) => {
    const gid = featureGeoid(f);
    if (!gid || seen.has(gid)) return false;
    seen.add(gid);
    return true;
  });
}

/**
 * Use the largest polygon ring for MultiPolygon centroids so the point stays on the
 * main landmass (avoids Farallon-style islands pulling the label off-map).
 */
function hoverLabelXY(feature, path, width, height) {
  const geom = feature.geometry;
  const pad = 8;
  const clamp = (x, y) => [
    Math.max(pad, Math.min(width - pad, x)),
    Math.max(pad, Math.min(height - pad, y)),
  ];

  if (!geom || geom.type === "Polygon") {
    const [x, y] = path.centroid(feature);
    return clamp(x, y - 4);
  }

  if (geom.type === "MultiPolygon") {
    let best = null;
    let bestArea = -1;
    for (const coords of geom.coordinates) {
      const sub = {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: coords },
      };
      const b = path.bounds(sub);
      const area = Math.abs((b[1][0] - b[0][0]) * (b[1][1] - b[0][1]));
      if (area > bestArea) {
        bestArea = area;
        best = path.centroid(sub);
      }
    }
    if (best) {
      const [x, y] = best;
      return clamp(x, y - 4);
    }
  }

  const [x, y] = path.centroid(feature);
  return clamp(x, y - 4);
}

async function renderOverviewMap(container, counties) {
  if (!container) return;

  const topo =
    typeof topojson !== "undefined"
      ? topojson
      : typeof window !== "undefined"
        ? window.topojson
        : undefined;

  if (
    typeof d3 === "undefined" ||
    !topo ||
    typeof topo.feature !== "function"
  ) {
    container.innerHTML =
      '<p class="overview-map-status">Map libraries did not load (d3/topojson). Check network or extensions blocking scripts.</p>';
    return;
  }

  container.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "overview-map-status";
  loading.textContent = "Loading map…";
  container.appendChild(loading);

  const byGeoid = new Map();
  for (const row of counties || []) {
    const cat = trackerStatusCategoryForMap(row.status);
    if (cat !== "ACQUIRED" && cat !== "PENDING") continue;
    const g = row.geoid;
    if (!g) continue;
    const gid = geoidKey(g);
    if (!isContinentalGeoid(gid)) continue;
    byGeoid.set(gid, {
      cat,
      name: row.county_name || "",
      st: row.st || row.state || "",
    });
  }

  const width = 920;
  const height = 560;

  try {
    const [usC, usS] = await Promise.all([
      d3.json(
        "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json"
      ),
      d3.json(
        "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"
      ),
    ]);

    const countiesFc = topo.feature(usC, usC.objects.counties);
    const statesFc = topo.feature(usS, usS.objects.states);

    const contCounties = countiesFc.features.filter((f) => {
      const gid = featureGeoid(f);
      return gid && isContinentalGeoid(gid);
    });
    const contStates = statesFc.features.filter(
      (f) => !EXCLUDED_STATE_FIPS.has(stateFeatureFips(f))
    );

    const projection = d3.geoAlbersUsa();
    const path = d3.geoPath(projection);
    projection.fitSize(
      [width, height],
      { type: "FeatureCollection", features: contStates }
    );

    loading.remove();

    const viewPad = 72;
    const svg = d3
      .select(container)
      .append("svg")
      .attr(
        "viewBox",
        `${-viewPad} ${-viewPad} ${width + 2 * viewPad} ${height + 2 * viewPad}`
      )
      .attr("class", "overview-map-svg")
      .attr("role", "img")
      .attr(
        "aria-label",
        "Map of continental United States with target counties by status; scroll or pinch to zoom, drag to pan, double-click to zoom in"
      );

    const labelClipPadX = 72;
    const labelClipPadY = 28;

    svg
      .append("defs")
      .append("clipPath")
      .attr("id", "overview-map-inner-clip")
      .append("rect")
      .attr("x", -labelClipPadX)
      .attr("y", -labelClipPadY)
      .attr("width", width + 2 * labelClipPadX)
      .attr("height", height + 2 * labelClipPadY);

    const zoomLayer = svg
      .append("g")
      .attr("class", "overview-map-zoom-layer");

    const g = zoomLayer.append("g").attr("class", "overview-map-layer");

    g.selectAll("path.county-base")
      .data(contCounties)
      .join("path")
      .attr("class", "county-base")
      .attr("d", path)
      .attr("vector-effect", "non-scaling-stroke");

    const hiRaw = contCounties.filter((f) => {
      const gid = featureGeoid(f);
      return gid && byGeoid.has(gid);
    });
    const hi = dedupeFeaturesByGeoid(hiRaw);

    const hoverG = g
      .append("g")
      .attr("class", "map-hover-label")
      .attr("clip-path", "url(#overview-map-inner-clip)")
      .style("visibility", "hidden");

    const hoverText = hoverG
      .append("text")
      .attr("class", "map-label map-label--hover")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("pointer-events", "none");

    g.selectAll("path.county-hi")
      .data(hi)
      .join("path")
      .attr("class", (d) => {
        const gid = featureGeoid(d);
        const cat = byGeoid.get(gid).cat;
        return `county-hi county-hi--${
          cat === "ACQUIRED" ? "acquired" : "pending"
        }`;
      })
      .attr("d", path)
      .attr("vector-effect", "non-scaling-stroke")
      .on("mouseenter", (event, d) => {
        const gid = featureGeoid(d);
        const info = byGeoid.get(gid);
        if (!info) return;
        const [cx, cy] = hoverLabelXY(d, path, width, height);
        const cls =
          info.cat === "ACQUIRED"
            ? "map-label map-label--hover map-label--acquired"
            : "map-label map-label--hover map-label--pending";
        hoverText
          .attr("class", cls)
          .attr("x", cx)
          .attr("y", cy)
          .text(formatCountyHoverLabel(info));
        hoverG.style("visibility", "visible");
      })
      .on("mouseleave", () => {
        hoverG.style("visibility", "hidden");
      });

    g.selectAll("path.state-outline")
      .data(contStates)
      .join("path")
      .attr("class", "state-outline")
      .attr("d", path)
      .attr("fill", "none")
      .attr("vector-effect", "non-scaling-stroke");

    hoverG.raise();

    const zoomBehavior = d3
      .zoom()
      .scaleExtent([1, 14])
      .on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform);
      });

    svg.call(zoomBehavior);
  } catch (err) {
    console.error("Overview map failed", err);
    loading.textContent = "Could not load map data.";
  }
}
