function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadTrendsJson() {
  const candidates = ["../data_summary/trends.json", "trends.json"];
  let lastStatus = null;
  for (const url of candidates) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      return await res.json();
    }
    lastStatus = res.status;
  }
  throw new Error(lastStatus != null ? `HTTP ${lastStatus}` : "No trends file found");
}

function formatNum(v) {
  return Number(v || 0).toLocaleString();
}

function typeTableColspan(periods) {
  return 2 + 2 * periods.length + 1;
}

function renderTypeTableThead(periods) {
  const row1 = [
    '<th rowspan="2" scope="col">County</th>',
    '<th rowspan="2" scope="col">St</th>',
  ];
  for (const p of periods) {
    row1.push(
      `<th colspan="2" scope="colgroup">${escapeHtml(p)}</th>`,
    );
  }
  row1.push('<th rowspan="2" scope="col">Total rows</th>');
  const row2 = [];
  for (let i = 0; i < periods.length; i++) {
    row2.push('<th scope="col">FHA</th>', '<th scope="col">VA</th>');
  }
  return `<tr>${row1.join("")}</tr><tr>${row2.join("")}</tr>`;
}

function applyChartTheme() {
  const Chart = window.Chart;
  if (!Chart) return;
  Chart.defaults.color = "#94a3b8";
  Chart.defaults.borderColor = "rgba(71, 85, 105, 0.35)";
  Chart.defaults.font.family = '"Plus Jakarta Sans", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
}

let trendsChartInstances = [];

function destroyTrendsCharts() {
  trendsChartInstances.forEach((ch) => {
    try {
      ch.destroy();
    } catch {
      /* ignore */
    }
  });
  trendsChartInstances = [];
}

function renderCountyCharts(root, rows, periods) {
  destroyTrendsCharts();
  const Chart = window.Chart;
  if (!Chart) {
    root.innerHTML =
      '<p class="trends-charts-placeholder">Charts need Chart.js (check your network).</p>';
    root.setAttribute("aria-busy", "false");
    return;
  }

  applyChartTheme();

  root.innerHTML = "";
  root.setAttribute("aria-busy", "false");

  rows.forEach((r, i) => {
    const counts = r.counts || {};
    const tp = r.type_counts_by_period || {};
    /* Same period labels for every county so columns align; empty periods = gap only. */
    const totals = periods.map((p) => Number(counts[p] || 0));
    const fha = periods.map((p) => Number((tp[p] && tp[p].FHA) || 0));
    const va = periods.map((p) => Number((tp[p] && tp[p].VA) || 0));
    const other = totals.map((t, j) => Math.max(0, t - fha[j] - va[j]));

    const title = [r.county_name, r.state].filter(Boolean).join(", ");
    const ariaLabel = `Mortgage counts by period for ${title}`;

    const article = document.createElement("article");
    article.className = "trends-chart-card";
    article.innerHTML = `
      <header class="trends-chart-card__head">
        <h3>${escapeHtml(title)}</h3>
        <span class="trends-chart-card__meta">${formatNum(r.rows_total)} rows total</span>
      </header>
      <div class="trends-chart-canvas-wrap">
        <canvas id="trends-chart-${i}"></canvas>
      </div>
    `;
    root.appendChild(article);

    const canvas = article.querySelector("canvas");
    if (!canvas) return;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", ariaLabel);

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: periods,
        datasets: [
          {
            label: "FHA",
            data: fha,
            backgroundColor: "rgba(34, 211, 238, 0.9)",
            borderColor: "rgba(34, 211, 238, 0.35)",
            borderWidth: 1,
            borderRadius: 5,
            borderSkipped: false,
            stack: "period",
          },
          {
            label: "VA",
            data: va,
            backgroundColor: "rgba(129, 140, 248, 0.92)",
            borderColor: "rgba(129, 140, 248, 0.4)",
            borderWidth: 1,
            borderRadius: 5,
            borderSkipped: false,
            stack: "period",
          },
          {
            label: "Other",
            data: other,
            backgroundColor: "rgba(71, 85, 105, 0.88)",
            borderColor: "rgba(100, 116, 139, 0.45)",
            borderWidth: 1,
            borderRadius: 5,
            borderSkipped: false,
            stack: "period",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 14,
              boxHeight: 14,
              padding: 18,
              usePointStyle: true,
              pointStyle: "rectRounded",
            },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            titleColor: "#f1f5f9",
            bodyColor: "#e2e8f0",
            footerColor: "#94a3b8",
            borderColor: "rgba(51, 65, 85, 0.8)",
            borderWidth: 1,
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            callbacks: {
              label(ctx) {
                const v = ctx.parsed.y;
                if (v == null) return `${ctx.dataset.label}: 0`;
                return `${ctx.dataset.label}: ${formatNum(v)}`;
              },
              footer(items) {
                if (!items.length) return "";
                const idx = items[0].dataIndex;
                const t = totals[idx];
                return `Period total: ${formatNum(t)}`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              color: "rgba(71, 85, 105, 0.2)",
            },
            ticks: {
              maxRotation: 40,
              minRotation: 0,
              font: { size: 11 },
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: "rgba(71, 85, 105, 0.2)",
            },
            ticks: {
              precision: 0,
              font: { size: 11 },
            },
          },
        },
      },
    });

    trendsChartInstances.push(chart);
  });
}

function setChartsPlaceholder(root, message) {
  destroyTrendsCharts();
  if (!root) return;
  root.innerHTML = `<p class="trends-charts-placeholder">${escapeHtml(message)}</p>`;
  root.setAttribute("aria-busy", "false");
}

async function initTrendsPage() {
  const tbody = document.getElementById("trends-tbody");
  const typeThead = document.getElementById("trends-type-thead");
  const typeTbody = document.getElementById("trends-type-tbody");
  const chartsRoot = document.getElementById("trends-charts-root");
  const meta = document.getElementById("trends-generated-at");
  if (!tbody) return;

  try {
    const data = await loadTrendsJson();
    if (data.generated_at && meta) {
      const dt = new Date(data.generated_at);
      meta.textContent = `Generated ${dt.toLocaleString()}`;
    }

    const periods = Array.isArray(data.periods) ? data.periods : [];
    const span = typeTableColspan(periods);

    const rows = Array.isArray(data.counties) ? data.counties : [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="placeholder">No trend rows found.</td></tr>';
      if (typeThead) typeThead.innerHTML = "";
      if (typeTbody) {
        typeTbody.innerHTML = `<tr><td colspan="${span}" class="placeholder">No trend rows found.</td></tr>`;
      }
      setChartsPlaceholder(chartsRoot, "No counties to chart.");
      return;
    }

    if (typeThead && periods.length) {
      typeThead.innerHTML = renderTypeTableThead(periods);
    }

    tbody.innerHTML = rows
      .map((r) => {
        const c = r.counts || {};
        return `<tr>
          <td>${escapeHtml(r.county_name || "")}</td>
          <td>${escapeHtml(r.state || "")}</td>
          <td>${formatNum(c["1935-40"])}</td>
          <td>${formatNum(c["1950"])}</td>
          <td>${formatNum(c["1960"])}</td>
          <td>${formatNum(c["1965"])}</td>
          <td>${formatNum(c["1970"])}</td>
          <td>${formatNum(c["1975"])}</td>
          <td>${formatNum(r.rows_total)}</td>
        </tr>`;
      })
      .join("");

    if (typeTbody) {
      typeTbody.innerHTML = rows
        .map((r) => {
          const tp = r.type_counts_by_period || {};
          const cells = [];
          for (const p of periods) {
            const pair = tp[p] || {};
            cells.push(`<td>${formatNum(pair.FHA)}</td>`, `<td>${formatNum(pair.VA)}</td>`);
          }
          return `<tr>
          <td>${escapeHtml(r.county_name || "")}</td>
          <td>${escapeHtml(r.state || "")}</td>
          ${cells.join("")}
          <td>${formatNum(r.rows_total)}</td>
        </tr>`;
        })
        .join("");
    }

    if (chartsRoot) {
      chartsRoot.setAttribute("aria-busy", "true");
      renderCountyCharts(chartsRoot, rows, periods);
    }
  } catch (err) {
    console.error(err);
    if (meta) meta.textContent = "Could not load trends";
    tbody.innerHTML =
      '<tr><td colspan="9" class="placeholder">Could not load trends.json. Run python scripts/build_summary.py.</td></tr>';
    if (typeThead) typeThead.innerHTML = "";
    if (typeTbody) {
      typeTbody.innerHTML =
        '<tr><td colspan="99" class="placeholder">Could not load trends.json. Run python scripts/build_summary.py.</td></tr>';
    }
    setChartsPlaceholder(
      chartsRoot,
      "Could not load data for charts. Run python scripts/build_summary.py.",
    );
  }
}

document.addEventListener("DOMContentLoaded", initTrendsPage);
