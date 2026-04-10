async function loadSummaryJson() {
  // GitHub Pages / docs/: same folder as the HTML. Local preview from site/: ../data_summary/
  const candidates = ["summary.json", "../data_summary/summary.json"];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(url, { cache: "no-store" });
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

async function initOverviewPage() {
  const generatedAtEl = document.getElementById("generated-at");
  const totalsEl = {
    num_counties: document.getElementById("total-counties"),
    rows_total: document.getElementById("total-rows"),
    rows_with_address: document.getElementById("total-rows-address"),
    rows_geocoded: document.getElementById("total-rows-geocoded"),
  };

  try {
    const data = await loadSummaryJson();
    setGeneratedAt(generatedAtEl, data.generated_at);
    setTotals(totalsEl, data.totals);
    renderStatusBreakdown(
      document.getElementById("status-breakdown-section"),
      document.getElementById("status-breakdown"),
      data.totals?.status_counts
    );
    queueOverviewMap(data.counties || []);
  } catch (err) {
    console.error("Failed to load summary.json", err);
    if (generatedAtEl) {
      generatedAtEl.textContent = "Could not load summary";
    }
  }
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
