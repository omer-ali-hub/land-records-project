/**
 * Append a `?_=<timestamp>` query string so the GitHub Pages CDN, browser
 * caches, and any service workers always re-fetch fresh JSON. The browser is
 * already given `cache: "no-store"`, but unique URLs also force the CDN edge
 * to revalidate against the origin.
 */
function withCacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

async function loadSummaryJson() {
  // GitHub Pages / docs/: same folder as the HTML. Local preview from site/: ../data_summary/
  const candidates = ["summary.json", "../data_summary/summary.json"];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(withCacheBust(url), { cache: "no-store" });
    if (res.ok) {
      return await res.json();
    }
    lastStatus = res.status;
  }
  throw new Error(
    lastStatus != null
      ? `Could not load summary (last HTTP ${lastStatus})`
      : "Could not load summary",
  );
}

async function loadWorkInProgressJson() {
  const candidates = [
    "work_in_progress.json",
    "../data_summary/work_in_progress.json",
  ];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(withCacheBust(url), { cache: "no-store" });
    if (res.ok) {
      return await res.json();
    }
    lastStatus = res.status;
  }
  throw new Error(
    lastStatus != null
      ? `Could not load work in progress (HTTP ${lastStatus})`
      : "Could not load work in progress",
  );
}

async function loadWorkInProgressHistoryJson() {
  const candidates = [
    "work_in_progress_history.json",
    "../data_summary/work_in_progress_history.json",
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(withCacheBust(url), { cache: "no-store" });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      /* try next candidate */
    }
  }
  return null;
}

function filterCountyRows(counties) {
  return counties.filter((row) => {
    const name = String(row.county_name || "").trim();
    const st = String(row.st || row.state || "").trim();
    if (!name || !st || st.toLowerCase() === "nan") return false;
    if (name.toLowerCase().startsWith("county (n=")) return false;
    return true;
  });
}

function getRowCentralCity(row) {
  return (
    row.central_city ||
    row["target counties__Central City"] ||
    row["STATUS OF DATA IN HAND__City (N=24)"] ||
    row["final sample counties__city"] ||
    ""
  );
}

function getRowSt(row) {
  if (row.st != null && String(row.st).trim() !== "") {
    return String(row.st).trim();
  }
  return String(row.state || "").trim();
}

function getRowStatusRaw(row) {
  return (
    row.status ??
    row["target counties__Status"] ??
    (row["digitization__Digitized?"] ||
      row["digitization__mortgage data"] ||
      row["flowchart__Digitized?"] ||
      "")
  );
}

function statusDisplayForFilter(row) {
  const raw = getRowStatusRaw(row);
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return String(raw).trim();
  }
  if (row.status !== undefined && row.status !== null && String(row.status).trim() !== "") {
    return String(row.status).trim();
  }
  return "";
}

function rowMatchesSearchQuery(row, query) {
  if (!query || !String(query).trim()) return true;
  const q = String(query).trim().toLowerCase();
  const fields = [
    row.county_name,
    row.county_id,
    getRowCentralCity(row),
    getRowSt(row),
    statusDisplayForFilter(row),
  ];
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
}

function populateStatusFilter(allRows) {
  const sel = document.getElementById("status-filter");
  if (!sel) return;

  const seen = new Set();
  const items = [];

  allRows.forEach((row) => {
    const s = statusDisplayForFilter(row);
    const key = s === "" ? "__EMPTY__" : s;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        value: key,
        label: s === "" ? "(no status)" : s,
      });
    }
  });

  items.sort((a, b) => {
    if (a.value === "__EMPTY__") return 1;
    if (b.value === "__EMPTY__") return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  sel.innerHTML = '<option value="">Status (any)</option>';
  items.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function getSortValue(row, key) {
  switch (key) {
    case "county":
      return String(row.county_name || "").trim().toLowerCase();
    case "city":
      return String(getRowCentralCity(row)).trim().toLowerCase();
    case "st":
      return String(getRowSt(row)).trim().toLowerCase();
    case "status":
      return String(statusDisplayForFilter(row) || "").trim().toLowerCase();
    default:
      return "";
  }
}

function sortRows(rows, key, ascending) {
  if (!key) return rows.slice();
  const dir = ascending ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const cmp = getSortValue(a, key).localeCompare(
      getSortValue(b, key),
      undefined,
      { sensitivity: "base" }
    );
    return cmp * dir;
  });
}

function setGeneratedAt(generatedAtEl, isoString) {
  if (!generatedAtEl || !isoString) return;
  const dt = new Date(isoString);
  generatedAtEl.textContent = `Generated ${dt.toLocaleString()}`;
}

function setTotals(totalsEl, totals) {
  if (!totals || !totalsEl?.num_counties) return;

  totalsEl.num_counties.textContent = totals.num_counties ?? "–";
  totalsEl.rows_total.textContent = totals.rows_total?.toLocaleString?.() ?? "–";
  totalsEl.rows_with_address.textContent =
    totals.rows_with_address?.toLocaleString?.() ?? "–";
  totalsEl.rows_geocoded.textContent =
    totals.rows_geocoded?.toLocaleString?.() ?? "–";
}

function renderTable(rows) {
  const tbody = document.getElementById("counties-tbody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="placeholder">No counties found</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const centralCity = getRowCentralCity(row);
    const st = getRowSt(row);
    const trackerStatus = getRowStatusRaw(row);

    tr.innerHTML = `
      <td>${escapeHtml(row.county_name || "")}</td>
      <td>${escapeHtml(centralCity || "")}</td>
      <td>${escapeHtml(String(st || ""))}</td>
      <td>${renderStatusBadge(trackerStatus)}</td>
      <td>${(row.rows_total ?? 0).toLocaleString()}</td>
      <td>${(row.rows_with_address ?? 0).toLocaleString()}</td>
      <td>${(row.rows_geocoded ?? 0).toLocaleString()}</td>
    `;

    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderStatusBreakdown(sectionEl, containerEl, statusCounts) {
  if (!sectionEl || !containerEl) return;
  if (!statusCounts || typeof statusCounts !== "object") {
    sectionEl.hidden = true;
    containerEl.innerHTML = "";
    return;
  }
  const entries = Object.entries(statusCounts);
  if (!entries.length) {
    sectionEl.hidden = true;
    containerEl.innerHTML = "";
    return;
  }
  sectionEl.hidden = false;
  containerEl.innerHTML = entries
    .map(
      ([label, n]) => `
    <div class="summary-card summary-card--compact">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${Number(n).toLocaleString()}</span>
    </div>`
    )
    .join("");
}

function renderStatusBadge(statusRaw) {
  const status = String(statusRaw || "").trim();
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("done")) {
    return `<span class="badge badge-success">${escapeHtml(status)}</span>`;
  }
  if (s.includes("in hand") || s.includes("processing") || s.includes("progress")) {
    return `<span class="badge badge-warning">${escapeHtml(status)}</span>`;
  }
  if (s.includes("missing") || s.includes("not started")) {
    return `<span class="badge badge-danger">${escapeHtml(status)}</span>`;
  }
  return `<span class="badge badge-muted">${escapeHtml(status)}</span>`;
}

function renderGeocodeBadge(valueRaw) {
  const v = String(valueRaw || "").trim().toLowerCase();
  if (!v) return "";
  if (v.startsWith("y")) {
    return `<span class="badge badge-success">Geocoded</span>`;
  }
  if (v.startsWith("n")) {
    return `<span class="badge badge-muted">Not geocoded</span>`;
  }
  return `<span class="badge badge-muted">${escapeHtml(valueRaw)}</span>`;
}

function setupFilters(allRows) {
  const searchInput = document.getElementById("search-input");
  const statusFilter = document.getElementById("status-filter");
  let sortKey = null;
  let sortAsc = true;

  function getFilteredRows() {
    const query = searchInput?.value ?? "";
    const statusOpt = statusFilter?.value ?? "";

    return allRows.filter((row) => {
      if (!rowMatchesSearchQuery(row, query)) {
        return false;
      }

      if (!statusOpt) return true;

      const s = statusDisplayForFilter(row);
      if (statusOpt === "__EMPTY__") {
        return s === "";
      }
      return s === statusOpt;
    });
  }

  function updateSortHeaderClasses() {
    document.querySelectorAll("th[data-sort-key]").forEach((th) => {
      const k = th.getAttribute("data-sort-key");
      th.classList.remove("th-sort-asc", "th-sort-desc", "th-sort-active");
      if (sortKey === k) {
        th.classList.add(
          "th-sort-active",
          sortAsc ? "th-sort-asc" : "th-sort-desc"
        );
        th.setAttribute("aria-sort", sortAsc ? "ascending" : "descending");
      } else {
        th.setAttribute("aria-sort", "none");
      }
    });
  }

  function refresh() {
    let rows = getFilteredRows();
    if (sortKey) {
      rows = sortRows(rows, sortKey, sortAsc);
    }
    renderTable(rows);
    updateSortHeaderClasses();
  }

  document.querySelectorAll("th[data-sort-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.getAttribute("data-sort-key");
      if (!k) return;
      if (sortKey === k) {
        sortAsc = !sortAsc;
      } else {
        sortKey = k;
        sortAsc = true;
      }
      refresh();
    });
  });

  searchInput?.addEventListener("input", refresh);
  statusFilter?.addEventListener("change", refresh);

  refresh();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

/** Map assets are heavy; load only when the map is near the viewport. */
function queueOverviewMap(counties) {
  const el = document.getElementById("overview-map");
  if (!el) return;
  if (el.dataset.mapQueued === "1") return;
  el.dataset.mapQueued = "1";

  el.innerHTML =
    '<p class="overview-map-status">Map loads when you scroll here…</p>';

  let fallbackTimer;

  const startLoad = () => {
    if (el.dataset.mapStarted === "1") return;
    if (fallbackTimer != null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    el.dataset.mapStarted = "1";
    void loadMapWhenReady(el, counties);
  };

  fallbackTimer = window.setTimeout(startLoad, 2500);

  const tryVisibleNow = () => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < vh + 200 && r.bottom > -200) {
      startLoad();
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(tryVisibleNow));

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          startLoad();
        }
      },
      { root: null, rootMargin: "200px", threshold: 0.01 }
    );
    io.observe(el);
  } else if ("requestIdleCallback" in window) {
    requestIdleCallback(startLoad, { timeout: 3000 });
  } else {
    setTimeout(startLoad, 600);
  }
}

async function loadMapWhenReady(el, counties) {
  el.innerHTML = '<p class="overview-map-status">Loading map…</p>';
  try {
    if (typeof d3 === "undefined") {
      await loadScript(
        "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"
      );
    }
    if (typeof topojson === "undefined" && !window.topojson) {
      await loadScript(
        "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"
      );
    }
    if (typeof renderOverviewMap !== "function") {
      const mapJs = new URL("overview-map.js", window.location.href).href;
      await loadScript(mapJs);
    }
    el.innerHTML = "";
    await renderOverviewMap(el, counties);
  } catch (err) {
    console.error("Overview map failed", err);
    el.innerHTML =
      '<p class="overview-map-status">Map could not be loaded.</p>';
  }
}

/**
 * Build a small SVG line chart of `% checked` per day for one source over the
 * past `windowDays` days. Returns a string (HTML) — empty if there are fewer
 * than 2 data points to draw a line.
 *
 * Each `point` is `{date: "YYYY-MM-DD", pct: number}`.
 */
function buildWipSparkline(points, windowDays) {
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 30;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));

  const filtered = (points || [])
    .filter((p) => {
      const d = new Date(`${p.date}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d >= cutoff;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (filtered.length === 0) {
    return '<p class="wip-spark-empty">No history yet — first snapshot will appear after the next run.</p>';
  }
  if (filtered.length === 1) {
    const only = filtered[0];
    const dateStr = new Date(`${only.date}T00:00:00Z`).toLocaleDateString(
      undefined,
      { timeZone: "UTC" },
    );
    return `<p class="wip-spark-empty">Only one snapshot so far (${escapeHtml(dateStr)}, ${only.pct.toFixed(1)}%). The line chart appears once a second day is recorded.</p>`;
  }

  const W = 280;
  const H = 64;
  const PAD_L = 28;
  const PAD_R = 8;
  const PAD_T = 8;
  const PAD_B = 18;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xs = filtered.map((p) => new Date(`${p.date}T00:00:00Z`).getTime());
  const xMin = cutoff.getTime();
  const xMax = today.getTime();
  const xSpan = xMax - xMin || 1;

  const yVals = filtered.map((p) => p.pct);
  let yMin = Math.min(...yVals);
  let yMax = Math.max(...yVals);
  // Pad the y range so the line isn't pinned to the edges; floor at 0 and cap at 100.
  const yPad = Math.max(2, (yMax - yMin) * 0.15);
  yMin = Math.max(0, Math.floor(yMin - yPad));
  yMax = Math.min(100, Math.ceil(yMax + yPad));
  if (yMax - yMin < 2) {
    yMax = Math.min(100, yMin + 2);
  }
  const ySpan = yMax - yMin || 1;

  const xFor = (t) => PAD_L + ((t - xMin) / xSpan) * innerW;
  const yFor = (v) => PAD_T + (1 - (v - yMin) / ySpan) * innerH;

  const points2 = filtered.map((p, i) => ({
    x: xFor(xs[i]),
    y: yFor(p.pct),
    pct: p.pct,
    date: p.date,
  }));

  const pathD = points2
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaD =
    `M${points2[0].x.toFixed(1)},${(PAD_T + innerH).toFixed(1)} ` +
    points2.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${points2[points2.length - 1].x.toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;

  const yTicks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const yTickEls = yTicks
    .map((v) => {
      const y = yFor(v);
      return `
        <line x1="${PAD_L}" x2="${PAD_L + innerW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="wip-spark-grid" />
        <text x="${(PAD_L - 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" class="wip-spark-ytick">${v}%</text>`;
    })
    .join("");

  const fmtShort = (d) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const startLabel = fmtShort(new Date(xMin));
  const endLabel = fmtShort(new Date(xMax));
  const xLabels = `
    <text x="${PAD_L.toFixed(1)}" y="${(H - 4).toFixed(1)}" class="wip-spark-xtick" text-anchor="start">${escapeHtml(startLabel)}</text>
    <text x="${(PAD_L + innerW).toFixed(1)}" y="${(H - 4).toFixed(1)}" class="wip-spark-xtick" text-anchor="end">${escapeHtml(endLabel)}</text>`;

  const last = points2[points2.length - 1];
  const dotEls = points2
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" class="wip-spark-dot"><title>${escapeHtml(p.date)}: ${p.pct.toFixed(1)}%</title></circle>`,
    )
    .join("");

  const lastLabelX = Math.min(last.x + 4, W - 4);
  const lastLabelAnchor = lastLabelX > W - 30 ? "end" : "start";

  return `
    <svg class="wip-spark-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Percent checked over the past ${days} days">
      ${yTickEls}
      <path d="${areaD}" class="wip-spark-area" />
      <path d="${pathD}" class="wip-spark-line" />
      ${dotEls}
      <text x="${lastLabelX.toFixed(1)}" y="${(last.y - 4).toFixed(1)}" text-anchor="${lastLabelAnchor}" class="wip-spark-last">${last.pct.toFixed(1)}%</text>
      ${xLabels}
    </svg>`;
}

/**
 * Build a per-source history of `% checked` from the snapshot file written by
 * `update_work_in_progress.py`. Returns a Map of source id -> array of points.
 */
function indexWipHistoryById(history) {
  const out = new Map();
  if (!history || !Array.isArray(history.snapshots)) return out;
  for (const snap of history.snapshots) {
    const date = String(snap.date || "").trim();
    if (!date) continue;
    const sources = Array.isArray(snap.sources) ? snap.sources : [];
    for (const s of sources) {
      const id = String(s.id || "").trim();
      const total = Math.max(0, Number(s.total_rows) || 0);
      const checked = Math.max(0, Math.min(Number(s.checked_rows) || 0, total));
      if (total <= 0) continue;
      const pct = (checked / total) * 100;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ date, pct });
    }
  }
  return out;
}

function buildWipCard(s, history) {
  const total = Math.max(0, Number(s.total_rows) || 0);
  const checked = Math.max(0, Math.min(Number(s.checked_rows) || 0, total));
  const pct = total > 0 ? Math.round((checked / total) * 1000) / 10 : 0;
  const barPct = total > 0 ? (checked / total) * 100 : 0;

  const art = document.createElement("article");
  art.className = "wip-card";
  const titleEsc = escapeHtml(s.label || "");
  const warn =
    Array.isArray(s.errors) && s.errors.length
      ? `<ul class="wip-warn">${s.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
      : "";

  const tabsScanned = Number(s.tabs_scanned);
  const disc = String(s.discovery_mode || "");
  let discoveryNote = "";
  if (Number.isFinite(tabsScanned) && tabsScanned > 0) {
    if (disc === "full") {
      discoveryNote = `<p class="wip-tab-note">All <strong>${tabsScanned}</strong> worksheets in this workbook were scanned.</p>`;
    } else if (disc === "manual") {
      discoveryNote = `<p class="wip-tab-note"><strong>${tabsScanned}</strong> worksheet(s) from config.</p>`;
    } else if (disc === "fallback") {
      discoveryNote = `<p class="wip-tab-note">Configured tab(s) only (<strong>${tabsScanned}</strong>) — not the full workbook yet.</p>`;
    }
  }

  const sparkPoints = history && s.id ? history.get(String(s.id).trim()) : null;
  const sparkBlock = sparkPoints
    ? `
    <div class="wip-spark" aria-label="Percent checked over the past month for ${titleEsc}">
      <div class="wip-spark-head">
        <span class="wip-spark-title">% checked, past 30 days</span>
      </div>
      ${buildWipSparkline(sparkPoints, 30)}
    </div>`
    : "";

  art.innerHTML = `
    <header class="wip-card__head">
      <h3 class="wip-card__title">${titleEsc}</h3>
    </header>
    ${discoveryNote}
    ${warn}
    <div class="wip-bars" aria-label="Progress for ${titleEsc}">
      <div class="wip-bar-block">
        <div class="wip-bar-meta">
          <span class="wip-bar-name">${escapeHtml(s.total_bar_label || "Total rows")}</span>
          <span class="wip-bar-num">${total.toLocaleString()}</span>
        </div>
        <div class="wip-bar-track" role="presentation">
          <div class="wip-bar-fill wip-bar-fill--total" style="width: 100%"></div>
        </div>
      </div>
      <div class="wip-bar-block">
        <div class="wip-bar-meta">
          <span class="wip-bar-name">${escapeHtml(s.checked_bar_label || "Checked")}</span>
          <span class="wip-bar-num">${checked.toLocaleString()} (${pct}%)</span>
        </div>
        <div class="wip-bar-track" role="presentation">
          <div class="wip-bar-fill wip-bar-fill--checked" style="width: ${barPct}%"></div>
        </div>
      </div>
    </div>
    ${sparkBlock}
  `;
  return art;
}

function renderWorkInProgress(panel, data, history) {
  const cardsRoot = panel.querySelector("#wip-cards");
  const errEl = panel.querySelector("#wip-error");
  const metaEl = panel.querySelector("#wip-generated");
  if (!cardsRoot) return;
  cardsRoot.innerHTML = "";
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (!sources.length) {
    cardsRoot.innerHTML =
      '<p class="wip-placeholder">No work-in-progress sources configured.</p>';
    panel.hidden = false;
    return;
  }
  const fallbackNames = sources
    .filter((s) => String(s.discovery_mode || "") === "fallback")
    .map((s) => String(s.label || "").trim())
    .filter(Boolean);
  if (fallbackNames.length) {
    const namesEsc = fallbackNames.map((n) => escapeHtml(n)).join(", ");
    const banner = document.createElement("div");
    banner.className = "wip-discovery-hint wip-discovery-hint--global";
    banner.innerHTML = `<p class="wip-discovery-hint__p"><strong>${namesEsc}</strong> — totals use only the tab(s) in config (full-workbook export or tab listing did not run from your machine). From the repo root run <code>python3 scripts/update_work_in_progress.py</code> (see that script for dependencies and optional API credentials), re-run, then reload.</p>`;
    cardsRoot.appendChild(banner);
  }
  const historyById = indexWipHistoryById(history);
  const frag = document.createDocumentFragment();
  for (const s of sources) {
    frag.appendChild(buildWipCard(s, historyById));
  }
  cardsRoot.appendChild(frag);
  if (data.generated_at && metaEl) {
    metaEl.textContent = `Progress totals updated ${new Date(data.generated_at).toLocaleString()}`;
  }
  panel.hidden = false;
}

/**
 * Match `tracker_status_category` from `scripts/build_summary.py` so the
 * frontend partitions counties the same way as the bundled status counts.
 * "1 - ACQUIRED" -> "ACQUIRED"; bare values pass through.
 */
function statusCategory(statusVal) {
  if (statusVal == null) return "";
  const s = String(statusVal).trim();
  if (!s || s.toLowerCase() === "nan") return "";
  const idx = s.indexOf(" - ");
  return idx >= 0 ? s.slice(idx + 3).trim() : s;
}

/**
 * Build a Set of county_id keys (lowercased "<county>, <ST>") for the WIP
 * sources, so the "ACQUIRED but not yet digitized" list can exclude any county
 * that already shows up in the work-in-progress cards. Labels look like
 * "Maricopa, AZ (Phoenix)"; we add both the bare and `<name> County` forms
 * because some `summary.json` rows use the suffix and some don't.
 */
function buildWipCountyIdSet(wipData) {
  const out = new Set();
  for (const s of (wipData?.sources || [])) {
    const label = String(s.label || "").trim();
    const m = label.match(/^([^,]+),\s*([A-Za-z]{2})\b/);
    if (!m) continue;
    const state = m[2].toUpperCase();
    const nm = m[1].trim();
    out.add(`${nm}, ${state}`.toLowerCase());
    if (!/(?:county|parish|city)$/i.test(nm)) {
      out.add(`${nm} County, ${state}`.toLowerCase());
    }
  }
  return out;
}

/**
 * Counties to emphasize in "Acquired but not yet digitized" (normalized county_id).
 */
const ACQUIRED_TODO_HIGH_PRIORITY_IDS = new Set([
  "hennepin county, mn",
  "dane county, wi",
  "shelby county, tn",
  "baltimore county, md",
  "whatcom county, wa",
  "orange county, fl",
  "mobile county, al",
]);

function isAcquiredTodoHighPriority(countyRow) {
  const cid = String(
    countyRow.county_id ||
      `${countyRow.county_name}, ${countyRow.state || countyRow.st || ""}`,
  )
    .trim()
    .toLowerCase();
  return ACQUIRED_TODO_HIGH_PRIORITY_IDS.has(cid);
}

function findAcquiredNotDigitized(summary, wipData) {
  const counties = Array.isArray(summary?.counties) ? summary.counties : [];
  const wipKeys = buildWipCountyIdSet(wipData);
  const out = [];
  for (const c of counties) {
    if (statusCategory(c.status).toUpperCase() !== "ACQUIRED") continue;
    if ((Number(c.rows_total) || 0) > 0) continue;
    const cid = String(
      c.county_id || `${c.county_name}, ${c.state || c.st || ""}`,
    )
      .trim()
      .toLowerCase();
    if (wipKeys.has(cid)) continue;
    out.push(c);
  }
  out.sort((a, b) =>
    String(a.county_name || "").localeCompare(
      String(b.county_name || ""),
      undefined,
      { sensitivity: "base" },
    ),
  );
  return out;
}

function renderAcquiredNotDigitized(summary, wipData) {
  const panel = document.getElementById("acquired-todo-panel");
  if (!panel) return;
  const grid = panel.querySelector("#acquired-todo-grid");
  const countEl = panel.querySelector("#acquired-todo-count");
  if (!grid) return;

  const list = findAcquiredNotDigitized(summary, wipData);
  if (!list.length) {
    panel.hidden = true;
    grid.innerHTML = "";
    if (countEl) countEl.textContent = "";
    return;
  }
  panel.hidden = false;
  if (countEl) {
    countEl.textContent = `${list.length} ${list.length === 1 ? "county" : "counties"}`;
  }

  // Group by state (alphabetical), counties within a state already sorted by name.
  const byState = new Map();
  for (const c of list) {
    const state = String(c.state || c.st || "").trim().toUpperCase() || "—";
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(c);
  }
  const stateGroups = [...byState.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [, counties] of stateGroups) {
    counties.sort((a, b) => {
      const pa = isAcquiredTodoHighPriority(a) ? 0 : 1;
      const pb = isAcquiredTodoHighPriority(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(a.county_name || "").localeCompare(
        String(b.county_name || ""),
        undefined,
        { sensitivity: "base" },
      );
    });
  }

  grid.innerHTML = stateGroups
    .map(([state, counties]) => {
      const stateEsc = escapeHtml(state);
      const chipsHtml = counties
        .map((c) => {
          const name = escapeHtml(c.county_name || "");
          const city = escapeHtml(getRowCentralCity(c) || "");
          const cityHtml = city
            ? `<div class="acquired-todo-city">${city}</div>`
            : "";
          const chipClass = isAcquiredTodoHighPriority(c)
            ? "acquired-todo-chip acquired-todo-chip--priority"
            : "acquired-todo-chip";
          return `
            <div class="${chipClass}">
              <div class="acquired-todo-name">${name}</div>
              ${cityHtml}
            </div>`;
        })
        .join("");
      return `
        <section class="acquired-todo-state-group" aria-label="${stateEsc}">
          <header class="acquired-todo-state-head">
            <span class="acquired-todo-state-code">${stateEsc}</span>
            <span class="acquired-todo-state-count">${counties.length}</span>
          </header>
          <div class="acquired-todo-state-chips">${chipsHtml}</div>
        </section>`;
    })
    .join("");
}

async function loadAndRenderWorkInProgress(summary) {
  const panel = document.getElementById("wip-panel");
  if (!panel) {
    if (summary) renderAcquiredNotDigitized(summary, null);
    return;
  }
  const errEl = panel.querySelector("#wip-error");
  const metaEl = panel.querySelector("#wip-generated");
  try {
    const [data, history] = await Promise.all([
      loadWorkInProgressJson(),
      loadWorkInProgressHistoryJson(),
    ]);
    renderWorkInProgress(panel, data, history);
    if (summary) renderAcquiredNotDigitized(summary, data);
  } catch (e) {
    console.error(e);
    panel.hidden = false;
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent =
        "Work-in-progress totals could not be loaded. Run python scripts/update_work_in_progress.py from the repo root (then refresh this page).";
    }
    if (metaEl) metaEl.textContent = "";
    const cardsRoot = panel.querySelector("#wip-cards");
    if (cardsRoot) cardsRoot.innerHTML = "";
  }
}

async function initOverviewPage() {
  const generatedAtEl = document.getElementById("generated-at");
  const totalsEl = {
    num_counties: document.getElementById("total-counties"),
    rows_total: document.getElementById("total-rows"),
    rows_with_address: document.getElementById("total-rows-address"),
    rows_geocoded: document.getElementById("total-rows-geocoded"),
  };

  let summary = null;
  try {
    summary = await loadSummaryJson();
    setGeneratedAt(generatedAtEl, summary.generated_at);
    setTotals(totalsEl, summary.totals);
    renderStatusBreakdown(
      document.getElementById("status-breakdown-section"),
      document.getElementById("status-breakdown"),
      summary.totals?.status_counts
    );
    queueOverviewMap(summary.counties || []);
  } catch (err) {
    console.error("Failed to load summary.json", err);
    if (generatedAtEl) {
      generatedAtEl.textContent = "Could not load summary";
    }
  }
  void loadAndRenderWorkInProgress(summary);
}

async function initCountiesPage() {
  const generatedAtEl = document.getElementById("generated-at");
  const totalsEl = {
    num_counties: document.getElementById("total-counties"),
    rows_total: document.getElementById("total-rows"),
    rows_with_address: document.getElementById("total-rows-address"),
    rows_geocoded: document.getElementById("total-rows-geocoded"),
  };
  const tbody = document.getElementById("counties-tbody");

  try {
    const data = await loadSummaryJson();
    setGeneratedAt(generatedAtEl, data.generated_at);
    setTotals(totalsEl, data.totals);
    renderStatusBreakdown(
      document.getElementById("status-breakdown-section"),
      document.getElementById("status-breakdown"),
      data.totals?.status_counts
    );

    let counties = Array.isArray(data.counties) ? data.counties : [];
    counties = filterCountyRows(counties);

    populateStatusFilter(counties);
    setupFilters(counties);
  } catch (err) {
    console.error("Failed to load summary.json", err);
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="placeholder">Could not load summary.json</td></tr>';
    }
  }
}
