/**
 * FHA counts as reported in agency sources (from Target counties tracker sheet).
 * Reads ../data_summary/summary.json (via common.js loadSummaryJson).
 */

const REPORTED_COLUMNS = [
  {
    sortKey: "fha1940",
    dataKey: "target counties__fha in 1940 in metro (35-40)",
    label: "1940 FHA in metro (1935–40)",
  },
  {
    sortKey: "fha1950",
    dataKey: "target counties__1950 FHA by SMA",
    label: "1950 FHA (SMA)",
  },
  {
    sortKey: "fha1960",
    dataKey: "target counties__1960 FHA by County",
    label: "1960 FHA (county)",
  },
  {
    sortKey: "fha1965",
    dataKey: "target counties__1965 FHA by County",
    label: "1965 FHA (county)",
  },
  {
    sortKey: "fha1970",
    dataKey: "target counties__1970 FHA 203B by SMA",
    label: "1970 FHA 203B (SMA)",
  },
  {
    sortKey: "fha1975",
    dataKey: "target counties__1975 FHA 203B by SMA",
    label: "1975 FHA 203B (SMA)",
  },
  {
    sortKey: "fhaTotalEst",
    dataKey: "target counties__Estimate Total FHA Deeds",
    label: "Est. total FHA deeds",
  },
];

const TOTAL_DATA_KEY = "target counties__Estimate Total FHA Deeds";

function formatReportedNumber(val) {
  if (val == null || val === "") return "–";
  if (typeof val === "number" && Number.isFinite(val)) {
    return val.toLocaleString();
  }
  const n = Number(val);
  if (Number.isFinite(n)) return n.toLocaleString();
  return escapeHtml(String(val));
}

function numericValueForSort(row, dataKey) {
  const v = row[dataKey];
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function reportedSortValue(row, sortKey) {
  if (sortKey === "county") {
    return String(row.county_name || "").trim().toLowerCase();
  }
  if (sortKey === "city") {
    return String(getRowCentralCity(row)).trim().toLowerCase();
  }
  if (sortKey === "st") {
    return String(getRowSt(row)).trim().toLowerCase();
  }
  const col = REPORTED_COLUMNS.find((c) => c.sortKey === sortKey);
  if (col) {
    const n = numericValueForSort(row, col.dataKey);
    return n != null ? n : null;
  }
  return "";
}

function sortReportedRows(rows, sortKey, ascending) {
  if (!sortKey) return rows.slice();
  const dir = ascending ? 1 : -1;
  const isNumeric = REPORTED_COLUMNS.some((c) => c.sortKey === sortKey);

  return rows.slice().sort((a, b) => {
    const va = reportedSortValue(a, sortKey);
    const vb = reportedSortValue(b, sortKey);

    if (isNumeric) {
      const na = va == null ? null : Number(va);
      const nb = vb == null ? null : Number(vb);
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      if (na !== nb) return na < nb ? -dir : dir;
      return 0;
    }

    const sa = String(va ?? "");
    const sb = String(vb ?? "");
    const cmp = sa.localeCompare(sb, undefined, { sensitivity: "base" });
    return cmp * dir;
  });
}

function reportedRowMatchesSearch(row, query) {
  if (!query || !String(query).trim()) return true;
  const q = String(query).trim().toLowerCase();
  const parts = [
    row.county_name,
    row.county_id,
    getRowCentralCity(row),
    getRowSt(row),
    ...REPORTED_COLUMNS.map((c) => row[c.dataKey]),
  ];
  return parts.some((p) => String(p ?? "").toLowerCase().includes(q));
}

function renderReportedTable(rows) {
  const tbody = document.getElementById("reported-tbody");
  if (!tbody) return;

  const colCount = 3 + REPORTED_COLUMNS.length;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="placeholder">No counties found</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = [
      escapeHtml(row.county_name || ""),
      escapeHtml(String(getRowCentralCity(row) || "")),
      escapeHtml(String(getRowSt(row) || "")),
      ...REPORTED_COLUMNS.map((c) => formatReportedNumber(row[c.dataKey])),
    ];
    tr.innerHTML = cells
      .map((html, i) =>
        i < 3 ? `<td>${html}</td>` : `<td class="num-cell">${html}</td>`
      )
      .join("");
    fragment.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

function sumEstimatedTotalFha(rows) {
  let sum = 0;
  let n = 0;
  rows.forEach((row) => {
    const v = numericValueForSort(row, TOTAL_DATA_KEY);
    if (v != null) {
      sum += v;
      n += 1;
    }
  });
  return { sum, n };
}

function setupReportedFilters(allRows) {
  const searchInput = document.getElementById("reported-search-input");
  let sortKey = "county";
  let sortAsc = true;

  function getFilteredRows() {
    const query = searchInput?.value ?? "";
    return allRows.filter((row) => reportedRowMatchesSearch(row, query));
  }

  function updateSortHeaderClasses() {
    document.querySelectorAll("#reported-table th[data-sort-key]").forEach((th) => {
      const k = th.getAttribute("data-sort-key");
      th.classList.remove("th-sort-asc", "th-sort-desc", "th-sort-active");
      if (sortKey === k) {
        th.classList.add("th-sort-active", sortAsc ? "th-sort-asc" : "th-sort-desc");
        th.setAttribute("aria-sort", sortAsc ? "ascending" : "descending");
      } else {
        th.setAttribute("aria-sort", "none");
      }
    });
  }

  function refreshSummary(filtered) {
    const { sum, n } = sumEstimatedTotalFha(filtered);
    const sumEl = document.getElementById("reported-sum-est-total");
    const sumNote = document.getElementById("reported-sum-note");
    if (sumEl) {
      sumEl.textContent = n > 0 ? sum.toLocaleString() : "–";
    }
    if (sumNote) {
      sumNote.textContent =
        n > 0
          ? `Sum of “Est. total FHA deeds” over ${n.toLocaleString()} counties with a value.`
          : "No numeric estimates in the current filter.";
    }
    const countEl = document.getElementById("reported-filtered-count");
    if (countEl) {
      countEl.textContent = filtered.length.toLocaleString();
    }
  }

  function refresh() {
    let rows = getFilteredRows();
    rows = sortReportedRows(rows, sortKey, sortAsc);
    renderReportedTable(rows);
    updateSortHeaderClasses();
    refreshSummary(rows);
  }

  document.querySelectorAll("#reported-table th[data-sort-key]").forEach((th) => {
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
  refresh();
}

async function initReportedPage() {
  const generatedAtEl = document.getElementById("generated-at");
  const tbody = document.getElementById("reported-tbody");
  const totalCountiesEl = document.getElementById("reported-total-counties");

  try {
    const data = await loadSummaryJson();
    setGeneratedAt(generatedAtEl, data.generated_at);

    let counties = Array.isArray(data.counties) ? data.counties : [];
    counties = filterCountyRows(counties);

    if (totalCountiesEl) {
      totalCountiesEl.textContent = counties.length.toLocaleString();
    }

    setupReportedFilters(counties);
  } catch (err) {
    console.error("Failed to load summary.json", err);
    if (tbody) {
      const colCount = 3 + REPORTED_COLUMNS.length;
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="placeholder">Could not load summary.json</td></tr>`;
    }
    if (generatedAtEl) {
      generatedAtEl.textContent = "Could not load summary";
    }
  }
}

document.addEventListener("DOMContentLoaded", initReportedPage);
