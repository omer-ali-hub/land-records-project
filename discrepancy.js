/**
 * Reported (tracker sheet) vs collected FHA counts (trends.json) by period.
 */

const PERIOD_REPORTED_KEYS = {
  "1935-40": "target counties__fha in 1940 in metro (35-40)",
  "1950": "target counties__1950 FHA by SMA",
  "1960": "target counties__1960 FHA by County",
  "1965": "target counties__1965 FHA by County",
  "1970": "target counties__1970 FHA 203B by SMA",
  "1975": "target counties__1975 FHA 203B by SMA",
};

/** Agency geography type shown under the period year (matches tracker column definitions). */
const PERIOD_SCOPE_LABEL = {
  "1935-40": "METRO",
  "1950": "SMA",
  "1960": "COUNTY",
  "1965": "COUNTY",
  "1970": "SMA",
  "1975": "SMA",
};

/* Distinct hues: warm (reported / agency) vs cool blue (collected / in-hand) */
const COLOR_REPORTED_FILL = "rgba(249, 115, 22, 0.98)";
const COLOR_REPORTED_STROKE = "rgba(254, 215, 170, 0.55)";
const COLOR_COLLECTED_FILL = "rgba(59, 130, 246, 0.98)";
const COLOR_COLLECTED_STROKE = "rgba(191, 219, 254, 0.55)";
const COLOR_LINE = "rgba(148, 163, 184, 0.6)";
const COLOR_LINE_DASH = "rgba(148, 163, 184, 0.4)";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Force a fresh JSON fetch on every visit by appending a timestamp; the
 * GitHub Pages CDN otherwise caches `trends.json` for several minutes.
 * (`common.js` already declares its own copy on overview/data-acquisition.)
 */
function withCacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

async function loadTrendsJsonDiscrepancy() {
  const candidates = ["trends.json", "../data_summary/trends.json"];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(withCacheBust(url), { cache: "no-store" });
    if (res.ok) {
      return await res.json();
    }
    lastStatus = res.status;
  }
  throw new Error(lastStatus != null ? `HTTP ${lastStatus}` : "No trends file found");
}

function parseReported(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function fhaCollected(trendsRow, period) {
  const tp = trendsRow.type_counts_by_period || {};
  const pair = tp[period] || {};
  return Number(pair.FHA) || 0;
}

function summaryByCountyId(summaryCounties) {
  const map = new Map();
  for (const row of summaryCounties || []) {
    const id = String(row.county_id || "").trim();
    if (id) map.set(id, row);
  }
  return map;
}

function columnScaleMax(rows, periods, summaryMap) {
  const maxByPeriod = {};
  for (const p of periods) {
    let m = 1;
    const key = PERIOD_REPORTED_KEYS[p];
    for (const tr of rows) {
      const sr = summaryMap.get(String(tr.county_id || "").trim());
      const rep = sr && key ? parseReported(sr[key]) : null;
      const col = fhaCollected(tr, p);
      m = Math.max(m, rep ?? 0, col);
    }
    maxByPeriod[p] = m;
  }
  return maxByPeriod;
}

function formatCellNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

/**
 * Horizontal dumbbell: x by value on 0..scaleMax. Reported label above axis; collected below.
 */
function dumbbellSvg(reportedNum, collectedNum, scaleMax, periodLabel) {
  const w = 152;
  const h = 58;
  const padX = 6;
  const labelTopY = 12;
  const labelBottomY = 54;
  const cy = 30;
  const r = 5.5;
  const innerW = w - 2 * padX;
  const maxV = Math.max(Number(scaleMax) || 1, 1e-6);
  const font =
    'font-size="10" font-family="system-ui, -apple-system, sans-serif"';

  const xAt = (v) => {
    const clamped = Math.max(0, Math.min(v, maxV));
    return padX + (clamped / maxV) * innerW;
  };

  const rep = reportedNum != null && Number.isFinite(reportedNum) ? reportedNum : null;
  const col = Number(collectedNum) || 0;

  const xRep = rep != null ? xAt(rep) : null;
  const xCol = xAt(col);

  const parts = [];

  if (xRep != null) {
    parts.push(
      `<line x1="${xRep}" y1="${cy}" x2="${xCol}" y2="${cy}" stroke="${COLOR_LINE}" stroke-width="2" stroke-linecap="round" />`,
    );
  } else {
    parts.push(
      `<line x1="${padX}" y1="${cy}" x2="${xCol}" y2="${cy}" stroke="${COLOR_LINE_DASH}" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" />`,
    );
  }

  if (xRep != null) {
    parts.push(
      `<circle cx="${xRep}" cy="${cy}" r="${r}" fill="${COLOR_REPORTED_FILL}" stroke="${COLOR_REPORTED_STROKE}" stroke-width="1.2" />`,
    );
  }

  parts.push(
    `<circle cx="${xCol}" cy="${cy}" r="${r}" fill="${COLOR_COLLECTED_FILL}" stroke="${COLOR_COLLECTED_STROKE}" stroke-width="1.2" />`,
  );

  if (xRep != null) {
    parts.push(
      `<text x="${xRep}" y="${labelTopY}" text-anchor="middle" fill="#fed7aa" ${font}>${escapeHtml(
        formatCellNum(rep),
      )}</text>`,
    );
  } else {
    /* Center “no reported” so it never sits on the axis and collides with a left‑side collected dot (e.g. Tulsa 1950). */
    parts.push(
      `<text x="${w / 2}" y="${labelTopY}" text-anchor="middle" fill="#94a3b8" ${font}>—</text>`,
    );
  }

  parts.push(
    `<text x="${xCol}" y="${labelBottomY}" text-anchor="middle" fill="#bfdbfe" ${font}>${escapeHtml(
      formatCellNum(col),
    )}</text>`,
  );

  const aria = `Reported ${rep != null ? formatCellNum(rep) : "missing"}, collected ${formatCellNum(col)}, period ${periodLabel}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(aria)}">${parts.join("")}</svg>`;
}

function periodColumnLabel(p) {
  if (p === "1935-40") return "1935–40";
  return String(p);
}

function renderDiscrepancyThead(thead, periods) {
  if (!thead) return;
  const ths = periods.map((p) => {
    const scope = PERIOD_SCOPE_LABEL[p] || "";
    return `<th scope="col" class="discrepancy-period-th">
      <span class="discrepancy-th-period">${escapeHtml(periodColumnLabel(p))}</span>
      <span class="discrepancy-th-scope">${escapeHtml(scope)}</span>
    </th>`;
  });
  thead.innerHTML = `<tr>
    <th scope="col">County</th>
    <th scope="col">St</th>
    ${ths.join("")}
  </tr>`;
}

function rowMatchesDiscrepancySearch(tr, query) {
  if (!query || !String(query).trim()) return true;
  const q = String(query).trim().toLowerCase();
  const hay = [
    tr.county_name,
    tr.county_id,
    tr.state,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return hay.includes(q);
}

function renderTable(tbody, trendRows, periods, summaryMap, searchQuery) {
  if (!tbody) return 0;

  let rows = trendRows.filter((tr) => rowMatchesDiscrepancySearch(tr, searchQuery));

  rows = rows.slice().sort((a, b) => {
    const ca = String(a.county_name || "").localeCompare(String(b.county_name || ""), undefined, {
      sensitivity: "base",
    });
    if (ca !== 0) return ca;
    return String(a.state || "").localeCompare(String(b.state || ""), undefined, { sensitivity: "base" });
  });

  const colCount = 2 + periods.length;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="placeholder">No counties match the filter.</td></tr>`;
    return 0;
  }

  const scaleByPeriod = columnScaleMax(rows, periods, summaryMap);

  tbody.innerHTML = rows
    .map((tr) => {
      const id = String(tr.county_id || "").trim();
      const sr = summaryMap.get(id);
      const cells = periods.map((p) => {
        const key = PERIOD_REPORTED_KEYS[p];
        const rep = sr && key ? parseReported(sr[key]) : null;
        const col = fhaCollected(tr, p);
        const scale = scaleByPeriod[p] || 1;
        return `<td class="discrepancy-cell">${dumbbellSvg(rep, col, scale, p)}</td>`;
      });
      return `<tr>
        <td>${escapeHtml(tr.county_name || "")}</td>
        <td>${escapeHtml(String(tr.state || ""))}</td>
        ${cells.join("")}
      </tr>`;
    })
    .join("");

  return rows.length;
}

async function initDiscrepancyPage() {
  const thead = document.getElementById("discrepancy-thead");
  const tbody = document.getElementById("discrepancy-tbody");
  const meta = document.getElementById("discrepancy-generated-at");
  const searchInput = document.getElementById("discrepancy-search-input");
  const countEl = document.getElementById("discrepancy-county-count");

  if (!tbody) return;

  let periods = [];
  let trendRows = [];
  let summaryMap = new Map();

  try {
    const [trends, summary] = await Promise.all([loadTrendsJsonDiscrepancy(), loadSummaryJson()]);

    if (trends.generated_at && meta) {
      const dt = new Date(trends.generated_at);
      meta.textContent = `Trends generated ${dt.toLocaleString()}`;
    }

    periods = Array.isArray(trends.periods) ? trends.periods.filter((p) => PERIOD_REPORTED_KEYS[p]) : [];
    trendRows = Array.isArray(trends.counties) ? trends.counties : [];
    const summaryRows = filterCountyRows(Array.isArray(summary.counties) ? summary.counties : []);
    summaryMap = summaryByCountyId(summaryRows);

    renderDiscrepancyThead(thead, periods);

    const refresh = () => {
      const shown = renderTable(tbody, trendRows, periods, summaryMap, searchInput?.value ?? "");
      if (countEl) {
        countEl.textContent = `${shown.toLocaleString()} / ${trendRows.length.toLocaleString()}`;
      }
    };

    searchInput?.addEventListener("input", refresh);
    refresh();

    if (summary.generated_at && meta) {
      const ds = new Date(summary.generated_at);
      meta.textContent += ` · Summary ${ds.toLocaleDateString()}`;
    }
  } catch (err) {
    console.error(err);
    if (meta) meta.textContent = "Could not load data";
    tbody.innerHTML =
      '<tr><td colspan="99" class="placeholder">Could not load trends.json and summary.json. Run python scripts/build_summary.py.</td></tr>';
  }
}

document.addEventListener("DOMContentLoaded", initDiscrepancyPage);
