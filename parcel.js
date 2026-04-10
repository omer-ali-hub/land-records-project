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

/** Normalize legacy string-only county entries. */
function normalizeParcelCountyEntry(raw) {
  if (typeof raw === "string") {
    const folder = raw;
    const countyName = folder.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      folder,
      county_name: countyName,
      rows_total: 0,
      legal_description_populated: 0,
      legal_description_pct: null,
      legal_description_column: null,
      source_files: [],
      error: null,
    };
  }
  return raw;
}

async function loadParcelJson() {
  const candidates = ["parcel_counties.json", "../data_summary/parcel_counties.json"];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      return await res.json();
    }
    lastStatus = res.status;
  }
  throw new Error(lastStatus != null ? `HTTP ${lastStatus}` : "No parcel list found");
}

function formatLegalPct(entry) {
  const p = entry.legal_description_pct;
  if (p == null || Number.isNaN(Number(p))) {
    return { text: "—", title: entry.error || "No rows or no legal description column matched." };
  }
  const rt = Number(entry.rows_total || 0);
  const pop = Number(entry.legal_description_populated || 0);
  const col = entry.legal_description_column ? String(entry.legal_description_column) : "";
  const files = Array.isArray(entry.source_files) ? entry.source_files.join(", ") : "";
  const parts = [`${formatNum(pop)} of ${formatNum(rt)} rows`, col ? `column: ${col}` : null, files ? `files: ${files}` : null].filter(
    Boolean,
  );
  return { text: `${Number(p).toFixed(1)}%`, title: parts.join(" · ") };
}

async function initParcelPage() {
  const tbody = document.getElementById("parcel-tbody");
  const metaEl = document.getElementById("parcel-generated-at");
  const countLine = document.getElementById("parcel-count-line");
  const dropboxLink = document.getElementById("dropbox-parcel-link");

  try {
    const data = await loadParcelJson();

    if (data.dropbox_folder_url && dropboxLink) {
      dropboxLink.href = data.dropbox_folder_url;
    }

    if (data.generated_at && metaEl) {
      const dt = new Date(data.generated_at);
      metaEl.textContent = `List generated ${dt.toLocaleString()}`;
    }

    const rawRows = Array.isArray(data.counties) ? data.counties : [];
    const rows = rawRows.map(normalizeParcelCountyEntry);
    const n = rows.length;
    if (countLine) {
      countLine.textContent =
        n === 0
          ? "No county folders found yet. Sync Dropbox, run the build script, or set PARCEL_DATA_DIR in scripts/build_summary.py (expected ~/Library/CloudStorage/Dropbox/parcel_data or ~/Dropbox/parcel_data)."
          : `${n} ${n === 1 ? "county" : "counties"} with parcel data (by folder name).`;
    }

    if (!tbody) return;

    if (!n) {
      tbody.innerHTML =
        '<tr><td colspan="2" class="placeholder">No folders listed. Run <code>python scripts/build_summary.py</code> after syncing your local <code>parcel_data</code> folder.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map((c) => {
        const name = escapeHtml(c.county_name || c.folder || "");
        const { text, title } = formatLegalPct(c);
        return `<tr>
          <td>${name}</td>
          <td class="parcel-pct-cell" title="${escapeHtml(title)}">${escapeHtml(text)}</td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    if (metaEl) metaEl.textContent = "Could not load parcel list";
    if (countLine) countLine.textContent = "";
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="2" class="placeholder">Could not load parcel_counties.json. Run python scripts/build_summary.py from the repo root.</td></tr>';
    }
  }
}

document.addEventListener("DOMContentLoaded", initParcelPage);
