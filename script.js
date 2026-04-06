// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzCMQ8n2nXcF7x8Rm-7g6isvcXAFc0RrrRpae6-ZNlKXgWwW7Ihn9tlgv8d9w4AZwvslg/exec";

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let globalData = [];
let totalHistoryChartInstance = null;
let historyChartInstance = null;
let allocationChartInstance = null;
let currentTotalDays = "all";
let currentFundDays = "all";
let sortCol = null;
let sortDir = 1; // 1 = asc, -1 = desc
let searchQuery = "";

const CHART_CONFIG = {
  tension: 0.4,
  borderWidth: 3,
  pointRadius: 0,
  fill: true,
  valueColor: "#6366f1",
  valueBg: "rgba(99, 102, 241, 0.05)",
  costColor: "#94a3b8",
  costWidth: 2,
};

// ─────────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  document.getElementById("theme-icon").innerText =
    savedTheme === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const target = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", target);
  localStorage.setItem("theme", target);
  document.getElementById("theme-icon").innerText =
    target === "dark" ? "☀️" : "🌙";
  // Re-render charts to match new theme
  if (globalData.length) {
    renderTotalHistoryChart();
    renderAllocationChart();
  }
}

// ─────────────────────────────────────────────
//  TOAST NOTIFICATIONS (replaces alert())
// ─────────────────────────────────────────────
function showToast(message, type = "info") {
  const existing = document.getElementById("toast-container");
  if (!existing) {
    const div = document.createElement("div");
    div.id = "toast-container";
    document.body.appendChild(div);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  document.getElementById("toast-container").appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ─────────────────────────────────────────────
//  LOADING SKELETON
// ─────────────────────────────────────────────
function setLoading(isLoading) {
  const btn = document.querySelector(".refresh-btn");
  if (btn) {
    btn.innerText = isLoading ? "Syncing…" : "Sync Portfolio";
    btn.disabled = isLoading;
  }

  const tbody = document.getElementById("portfolio-body");
  if (isLoading) {
    tbody.innerHTML = Array(3)
      .fill(
        `<tr class="skeleton-row">
          ${Array(7).fill('<td><div class="skeleton-cell"></div></td>').join("")}
        </tr>`,
      )
      .join("");

    // Zero out stats with a pulse
    [
      "total-invested",
      "total-current",
      "total-profit",
      "total-day-change",
      "total-xirr",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("skeleton-pulse");
    });
  } else {
    [
      "total-invested",
      "total-current",
      "total-profit",
      "total-day-change",
      "total-xirr",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("skeleton-pulse");
    });
  }
}

// ─────────────────────────────────────────────
//  ROBUST CSV PARSER (handles commas in fields)
// ─────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const cols = [];
    let cur = "",
      inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

// ─────────────────────────────────────────────
//  FORM
// ─────────────────────────────────────────────
function resetForm() {
  ["form-id", "form-units", "form-price", "form-date"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );
  document.getElementById("add-form").classList.add("hidden");
}

async function submitData() {
  const btn = document.getElementById("submit-btn");
  const rawDate = document.getElementById("form-date").value;
  const schemeId = document.getElementById("form-id").value.trim();
  const units = document.getElementById("form-units").value;
  const price = document.getElementById("form-price").value;

  if (!rawDate || !schemeId || !units) {
    showToast("Please fill all details first.", "warning");
    return;
  }

  // Confirmation
  if (!confirm(`Record ${units} units of scheme ${schemeId} on ${rawDate}?`))
    return;

  const [year, month, day] = rawDate.split("-");
  const payload = {
    date: `${day}/${month}/${year}`,
    id: schemeId,
    units: parseFloat(units),
    price: price ? parseFloat(price) : 0,
  };

  btn.innerText = "Syncing…";
  btn.disabled = true;

  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      cache: "no-cache",
      body: JSON.stringify(payload),
    });
    showToast("Transaction recorded successfully!", "success");
    resetForm();
    setTimeout(() => init(), 2000);
  } catch (err) {
    showToast("Connection error. Please try again.", "error");
  } finally {
    btn.innerText = "Submit to Sheet";
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────
//  MAIN INIT  (parallel fetching via Promise.all)
// ─────────────────────────────────────────────
async function init() {
  setLoading(true);
  try {
    const response = await fetch(`${SHEET_CSV_URL}&cb=${Date.now()}`);
    const csvText = await response.text();
    const allRows = parseCSV(csvText).slice(1); // skip header

    let localTotals = {};
    allRows.forEach((cols) => {
      const [dateStr, id, unitsStr, priceStr, stampStr, nameStr] = cols;
      if (!id || isNaN(parseFloat(unitsStr))) return;
      if (!localTotals[id])
        localTotals[id] = {
          units: 0,
          transactions: [],
          fallbackName: nameStr || id,
        };
      const units = parseFloat(unitsStr),
        price = parseFloat(priceStr) || 0;
      localTotals[id].transactions.push({
        dateStr,
        units,
        price,
        value: units * price,
        stamp: parseFloat(stampStr) || 0,
      });
    });

    const ids = Object.keys(localTotals);
    if (ids.length === 0) {
      showToast("No fund data found in sheet.", "warning");
      setLoading(false);
      return;
    }

    // ✅ Parallel fetch — all funds at once
    const apiResults = await Promise.all(
      ids.map((id) =>
        fetch(`https://api.mfapi.in/mf/${id}`)
          .then((r) => r.json())
          .catch(() => null),
      ),
    );

    let portfolioArray = [];
    ids.forEach((id, idx) => {
      const json = apiResults[idx];
      if (!json) return;

      const currentNav = json.data ? parseFloat(json.data[0]?.nav) : 0;
      const prevNav =
        json.data && json.data[1] ? parseFloat(json.data[1].nav) : currentNav;

      let netInv = 0,
        rUnits = 0,
        txs = [],
        tStamp = 0;

      localTotals[id].transactions
        .sort((a, b) => {
          const toDate = (s) => {
            const [d, m, y] = s.split(/[-/]/);
            return new Date(y, m - 1, d);
          };
          return toDate(a.dateStr) - toDate(b.dateStr);
        })
        .forEach((tx) => {
          const [d, m, y] = tx.dateStr.split(/[-/]/);
          const dateObj = new Date(y, m - 1, d);
          if (tx.units > 0) {
            netInv += Math.abs(tx.value);
            rUnits += tx.units;
          } else {
            const avg = rUnits > 0 ? netInv / rUnits : 0;
            netInv -= avg * Math.abs(tx.units);
            rUnits += tx.units;
          }
          tStamp += tx.stamp;
          txs.push({ date: dateObj, amount: -tx.value, units: tx.units });
        });

      portfolioArray.push({
        name: json.meta?.scheme_name || localTotals[id].fallbackName,
        code: id,
        units: rUnits,
        invested: netInv,
        stampDuty: tStamp,
        currentNav,
        prevNav,
        transactions: txs,
        navHistory: json.data || [],
      });
    });

    globalData = portfolioArray;
    renderTable();
    renderAllocationChart();
    showToast("Portfolio synced!", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to load portfolio. Check your connection.", "error");
  } finally {
    setLoading(false);
  }
}

// ─────────────────────────────────────────────
//  SEARCH & SORT HELPERS
// ─────────────────────────────────────────────
function onSearch(val) {
  searchQuery = val.toLowerCase();
  renderTable();
}

function onSort(col) {
  if (sortCol === col) {
    sortDir *= -1;
  } else {
    sortCol = col;
    sortDir = 1;
  }
  renderTable();
}

function getSortedFiltered(data) {
  let filtered = data.filter(
    (f) =>
      !searchQuery ||
      f.name.toLowerCase().includes(searchQuery) ||
      f.code.includes(searchQuery),
  );

  if (!sortCol) return filtered;

  return filtered.sort((a, b) => {
    let va, vb;
    switch (sortCol) {
      case "name":
        va = a.name;
        vb = b.name;
        return sortDir * va.localeCompare(vb);
      case "units":
        va = a.units;
        vb = b.units;
        break;
      case "invested":
        va = a.invested;
        vb = b.invested;
        break;
      case "value":
        va = a.currentNav * a.units;
        vb = b.currentNav * b.units;
        break;
      case "dayChange":
        va =
          a.prevNav !== 0 ? ((a.currentNav - a.prevNav) / a.prevNav) * 100 : 0;
        vb =
          b.prevNav !== 0 ? ((b.currentNav - b.prevNav) / b.prevNav) * 100 : 0;
        break;
      case "returns":
        va = a.currentNav * a.units - a.invested;
        vb = b.currentNav * b.units - b.invested;
        break;
      case "xirr":
        va = safeXIRR([
          ...a.transactions,
          { date: new Date(), amount: a.currentNav * a.units },
        ]);
        vb = safeXIRR([
          ...b.transactions,
          { date: new Date(), amount: b.currentNav * b.units },
        ]);
        break;
      default:
        return 0;
    }
    return sortDir * (va - vb);
  });
}

function sortIcon(col) {
  if (sortCol !== col) return `<span class="sort-icon">⇅</span>`;
  return sortDir === 1
    ? `<span class="sort-icon active">↑</span>`
    : `<span class="sort-icon active">↓</span>`;
}

// ─────────────────────────────────────────────
//  RENDER TABLE
// ─────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById("portfolio-body");
  let gInv = 0,
    gCur = 0,
    gPrevTotal = 0,
    gFlows = [];

  const displayData = getSortedFiltered(globalData);

  const html = displayData
    .map((f) => {
      const curVal = f.currentNav * f.units;
      const prevVal = f.prevNav * f.units;
      const retRs = curVal - f.invested;
      const retPct = f.invested > 0 ? (retRs / f.invested) * 100 : 0;
      const dayRs = curVal - prevVal;
      const dayPct =
        f.prevNav !== 0 ? ((f.currentNav - f.prevNav) / f.prevNav) * 100 : 0;
      gInv += f.invested;
      gCur += curVal;
      gPrevTotal += prevVal;
      gFlows.push(...f.transactions);

      const xirr = safeXIRR([
        ...f.transactions,
        { date: new Date(), amount: curVal },
      ]);

      return `<tr onclick="showHistoryChart('${f.code}', 'all')" title="Click to view fund history">
        <td><strong>${f.name}</strong><br><span class="code-badge">${f.code}</span></td>
        <td>${f.units.toFixed(3)}</td>
        <td>₹${Math.round(f.invested).toLocaleString("en-IN")}</td>
        <td>₹${Math.round(curVal).toLocaleString("en-IN")}</td>
        <td class="${dayRs >= 0 ? "gain" : "loss"}">
          ₹${Math.round(dayRs).toLocaleString("en-IN")}
          <small style="display:block;opacity:0.7">${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%</small>
        </td>
        <td class="${retRs >= 0 ? "gain" : "loss"}">
          ₹${Math.round(retRs).toLocaleString("en-IN")}
          <small style="display:block;opacity:0.7">${retPct >= 0 ? "+" : ""}${retPct.toFixed(1)}%</small>
        </td>
        <td style="font-weight:800; color:#6366f1;">${xirr.toFixed(2)}%</td>
      </tr>`;
    })
    .join("");

  tbody.innerHTML =
    html ||
    `<tr><td colspan="7" style="text-align:center;padding:30px;opacity:0.5;">No funds match your search.</td></tr>`;

  // ── Summary stats (always from full globalData, not filtered) ──
  globalData.forEach((f) => {
    // already accumulated above if not filtered — recalc from full set
  });

  // Recalculate from full globalData for summary
  let tInv = 0,
    tCur = 0,
    tPrev = 0,
    tFlows = [];
  globalData.forEach((f) => {
    tInv += f.invested;
    tCur += f.currentNav * f.units;
    tPrev += f.prevNav * f.units;
    tFlows.push(...f.transactions);
  });

  document.getElementById("total-invested").innerText =
    "₹" + Math.round(tInv).toLocaleString("en-IN");
  document.getElementById("total-current").innerText =
    "₹" + Math.round(tCur).toLocaleString("en-IN");

  const totalProfit = tCur - tInv;
  const profitEl = document.getElementById("total-profit");
  profitEl.className = `stat-value ${totalProfit >= 0 ? "gain" : "loss"}`;
  profitEl.innerText =
    (totalProfit >= 0 ? "+" : "") +
    "₹" +
    Math.round(totalProfit).toLocaleString("en-IN");

  const dayDiff = tCur - tPrev;
  const dayTotalPct = tPrev !== 0 ? (dayDiff / tPrev) * 100 : 0;
  const dayEl = document.getElementById("total-day-change");
  dayEl.className = `stat-value ${dayDiff >= 0 ? "gain" : "loss"}`;
  dayEl.innerText = `${dayDiff >= 0 ? "+" : ""}₹${Math.round(dayDiff).toLocaleString("en-IN")} (${dayTotalPct.toFixed(2)}%)`;

  // ── Performance History: Hybrid Absolute (≤3M) + XIRR (≥6M) ───────────────
  //
  //  For every period:
  //    Gain ₹  = Ending Value − Opening Value − Fresh Buys in window + Redemptions
  //              → pure wealth added by the market, fresh SIPs stripped out
  //    % short = Gain ÷ Opening Value  (Absolute — XIRR is noisy over days/weeks)
  //    % long  = Rolling XIRR on [opening as outflow + in-period txs + current value]
  //              → annualised, accounts for exact SIP timing, same as Kuvera/Groww
  //
  //  Also computes:
  //    • Best performing period  → highlighted with accent border
  //    • Since-inception summary → total gain ₹ + overall XIRR + days invested

  const periods = [
    { k: "1w", d: 7, useXIRR: false },
    { k: "1m", d: 30, useXIRR: false },
    { k: "3m", d: 90, useXIRR: false },
    { k: "6m", d: 180, useXIRR: true },
    { k: "1y", d: 365, useXIRR: true },
    { k: "3y", d: 1095, useXIRR: true },
  ];

  // Collect computed values so we can find the best performer
  const periodResults = [];

  periods.forEach((p) => {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - p.d);

    const openingVal = getPortfolioValueAt(p.d);

    if (openingVal <= 0) {
      periodResults.push({ k: p.k, gainAmt: null, pct: null });
      return;
    }

    // Fresh buys within this window (negative amount = outflow/buy)
    const freshCapital = tFlows
      .filter((tx) => tx.date > periodStart && tx.amount < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    // Redemptions within this window (positive amount = inflow/sell)
    const redemptions = tFlows
      .filter((tx) => tx.date > periodStart && tx.amount > 0)
      .reduce((sum, tx) => sum + tx.amount, 0);

    // Pure market gain — fresh capital stripped out
    const gainAmt = tCur - openingVal - freshCapital + redemptions;

    let pct, pctLabel;
    if (p.useXIRR) {
      // Build mini cash-flow: opening as buy → in-period txs → current value
      const flows = [
        { date: periodStart, amount: -openingVal },
        ...tFlows.filter((tx) => tx.date > periodStart),
        { date: new Date(), amount: tCur },
      ];
      pct = safeXIRR(flows);
      pctLabel = "p.a.";
    } else {
      pct = openingVal > 0 ? (gainAmt / openingVal) * 100 : 0;
      pctLabel = "abs";
    }

    periodResults.push({ k: p.k, gainAmt, pct, pctLabel, useXIRR: p.useXIRR });
  });

  // Find best period (highest % among valid periods)
  const validPcts = periodResults.filter((r) => r.pct !== null);
  const bestPeriod = validPcts.length
    ? validPcts.reduce((best, r) => (r.pct > best.pct ? r : best), validPcts[0])
    : null;

  // Render each period cell
  periodResults.forEach((r) => {
    const amtEl = document.getElementById(`ret-${r.k}-amt`);
    const pctEl = document.getElementById(`ret-${r.k}-pct`);
    const cell = document.getElementById(`ret-cell-${r.k}`);
    if (!amtEl) return;

    if (r.gainAmt === null) {
      amtEl.innerText = "N/A";
      amtEl.className = "";
      pctEl.innerText = "—";
      pctEl.className = "";
      if (cell) cell.classList.remove("best-period");
      return;
    }

    const cls = r.gainAmt >= 0 ? "gain" : "loss";
    amtEl.className = cls;
    pctEl.className = cls;
    amtEl.innerText =
      (r.gainAmt >= 0 ? "+" : "-") +
      "₹" +
      Math.round(Math.abs(r.gainAmt)).toLocaleString("en-IN");
    pctEl.innerHTML = `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}% <em>${r.pctLabel}</em>`;

    // Highlight best performer
    if (cell) {
      cell.classList.toggle(
        "best-period",
        bestPeriod && r.k === bestPeriod.k && r.gainAmt > 0,
      );
    }
  });

  // ── Since Inception ──────────────────────────────────────────────────────
  const inceptionDate = tFlows.length
    ? new Date(Math.min(...tFlows.map((t) => t.date)))
    : null;

  const inceptionGain = tCur - tInv;
  const inceptionXIRR = safeXIRR([
    ...tFlows,
    { date: new Date(), amount: tCur },
  ]);
  const daysSince = inceptionDate
    ? Math.floor((new Date() - inceptionDate) / 86400000)
    : 0;

  const inceptionEl = document.getElementById("ret-inception");
  if (inceptionEl && inceptionDate) {
    const gainCls = inceptionGain >= 0 ? "gain" : "loss";
    inceptionEl.innerHTML = `
      <span class="inception-label">Since ${inceptionDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · ${daysSince} days</span>
      <span class="${gainCls} inception-gain">
        ${inceptionGain >= 0 ? "+" : "-"}₹${Math.round(Math.abs(inceptionGain)).toLocaleString("en-IN")}
      </span>
      <span class="${gainCls} inception-xirr">${inceptionXIRR >= 0 ? "+" : ""}${inceptionXIRR.toFixed(2)}% XIRR p.a.</span>
    `;
  }

  const xirrVal = safeXIRR([...tFlows, { date: new Date(), amount: tCur }]);
  document.getElementById("total-xirr").innerText = xirrVal.toFixed(2) + "%";
  renderTotalHistoryChart();
}

// ─────────────────────────────────────────────
//  PORTFOLIO VALUE AT A POINT IN TIME
// ─────────────────────────────────────────────
function getPortfolioValueAt(daysAgo) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAgo);
  let totalVal = 0;
  globalData.forEach((fund) => {
    let unitsAtTime = 0;
    fund.transactions.forEach((tx) => {
      if (tx.date <= targetDate) unitsAtTime += tx.units;
    });
    if (unitsAtTime <= 0) return;
    const histEntry = fund.navHistory.find((h) => {
      const [d, m, y] = h.date.split("-");
      return new Date(y, m - 1, d) <= targetDate;
    });
    const nav = histEntry
      ? parseFloat(histEntry.nav)
      : fund.navHistory.length > 0
        ? parseFloat(fund.navHistory[fund.navHistory.length - 1].nav)
        : 0;
    totalVal += unitsAtTime * nav;
  });
  return totalVal;
}

// ─────────────────────────────────────────────
//  TOTAL HISTORY CHART
// ─────────────────────────────────────────────
function updateTotalTime(days, btn) {
  currentTotalDays = days;
  document
    .querySelectorAll("#total-filters .filter-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderTotalHistoryChart();
}

function renderTotalHistoryChart() {
  const mode = document.getElementById("total-display-mode").value;
  let allTx = globalData.flatMap((f) => f.transactions);
  if (allTx.length === 0) return;

  let start = new Date(Math.min(...allTx.map((t) => t.date)));
  if (currentTotalDays !== "all") {
    const fDate = new Date();
    fDate.setDate(fDate.getDate() - currentTotalDays);
    if (fDate > start) start = fDate;
  }

  let master = new Map();
  globalData.forEach((f) =>
    f.navHistory.forEach((e) => {
      const [d, m, y] = e.date.split("-");
      const dObj = new Date(y, m - 1, d);
      if (dObj >= start)
        master.set(dObj.toDateString(), { date: dObj, inv: 0, cur: 0 });
    }),
  );

  const sorted = Array.from(master.values()).sort((a, b) => a.date - b.date);
  sorted.forEach((p) => {
    globalData.forEach((fund) => {
      let rU = 0,
        rI = 0;
      fund.transactions.forEach((tx) => {
        if (tx.date <= p.date) {
          if (tx.units > 0) {
            rI += Math.abs(tx.amount);
            rU += tx.units;
          } else {
            const avg = rU > 0 ? rI / rU : 0;
            rI -= avg * Math.abs(tx.units);
            rU += tx.units;
          }
        }
      });
      const dStr = p.date.toLocaleDateString("en-GB").replace(/\//g, "-");
      const navE = fund.navHistory.find((n) => n.date === dStr);
      const nav = navE
        ? parseFloat(navE.nav)
        : fund.navHistory.length > 0
          ? parseFloat(fund.navHistory[0].nav)
          : 0;
      p.inv += rI;
      p.cur += rU * nav;
    });
  });

  if (totalHistoryChartInstance) totalHistoryChartInstance.destroy();

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const tickColor = isDark ? "#94a3b8" : "#64748b";

  const profitSeries = sorted.map((p) => Math.round(p.cur - p.inv));
  const ds = [];
  if (mode === "value" || mode === "both") {
    ds.push({
      label: "Value",
      data: sorted.map((p) => Math.round(p.cur)),
      borderColor: CHART_CONFIG.valueColor,
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      pointRadius: CHART_CONFIG.pointRadius,
      fill: CHART_CONFIG.fill,
      backgroundColor: CHART_CONFIG.valueBg,
    });
  }
  if (mode === "both") {
    ds.push({
      label: "Cost",
      data: sorted.map((p) => Math.round(p.inv)),
      borderColor: CHART_CONFIG.costColor,
      borderWidth: CHART_CONFIG.costWidth,
      tension: 0,
      pointRadius: 0,
      fill: false,
    });
  }
  if (mode === "profit") {
    ds.push({
      label: "Net Gain",
      data: profitSeries,
      borderColor: "#10b981",
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      pointRadius: CHART_CONFIG.pointRadius,
      fill: false,
    });
  }

  totalHistoryChartInstance = new Chart(
    document.getElementById("totalHistoryChart").getContext("2d"),
    {
      type: "line",
      data: {
        labels: sorted.map((p) =>
          p.date.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          }),
        ),
        datasets: ds,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: tickColor, font: { weight: "700" } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ₹${ctx.parsed.y.toLocaleString("en-IN")}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              callback: (v) =>
                "₹" +
                (v >= 100000
                  ? (v / 100000).toFixed(1) + "L"
                  : v.toLocaleString("en-IN")),
            },
          },
        },
      },
    },
  );
}

// ─────────────────────────────────────────────
//  ALLOCATION PIE CHART
// ─────────────────────────────────────────────
function renderAllocationChart() {
  const canvas = document.getElementById("allocationChart");
  if (!canvas || !globalData.length) return;

  if (allocationChartInstance) allocationChartInstance.destroy();

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const tickColor = isDark ? "#94a3b8" : "#64748b";

  const palette = [
    "#6366f1",
    "#a855f7",
    "#ec4899",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#3b82f6",
    "#f43f5e",
    "#8b5cf6",
  ];

  const labels = globalData.map((f) => f.name.split(" ").slice(0, 3).join(" "));
  const values = globalData.map((f) => Math.round(f.currentNav * f.units));
  const total = values.reduce((a, b) => a + b, 0);

  allocationChartInstance = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: palette,
          borderWidth: 2,
          borderColor: isDark ? "#1e293b" : "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: tickColor,
            font: { size: 11, weight: "700" },
            padding: 14,
            boxWidth: 12,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ₹${ctx.parsed.toLocaleString("en-IN")} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
//  FUND HISTORY CHART
// ─────────────────────────────────────────────
function showHistoryChart(code, days = "all") {
  currentFundDays = days;
  const fund = globalData.find((f) => f.code === code);
  if (!fund) return;
  document.getElementById("history-section").style.display = "block";
  document.getElementById("history-fund-name").innerText = fund.name;

  const mode = document.getElementById("fund-display-mode");
  mode.onchange = () => showHistoryChart(code, currentFundDays);

  const filterArr = [7, 30, 90, 180, 365, 1095, "all"];
  const lbls = ["1W", "1M", "3M", "6M", "1Y", "3Y", "ALL"];
  document.getElementById("fund-filters").innerHTML = filterArr
    .map(
      (f, i) =>
        `<button class="filter-btn ${currentFundDays === f ? "active" : ""}" onclick="showHistoryChart('${code}', ${typeof f === "string" ? "'all'" : f})">${lbls[i]}</button>`,
    )
    .join("");

  let firstTxDate = new Date(Math.min(...fund.transactions.map((t) => t.date)));
  let chartStart = firstTxDate;
  if (days !== "all") {
    let filterDate = new Date();
    filterDate.setDate(filterDate.getDate() - days);
    if (filterDate > firstTxDate) chartStart = filterDate;
  }

  const timeline = fund.navHistory
    .map((d) => {
      const [day, month, year] = d.date.split("-");
      return { date: new Date(year, month - 1, day), nav: parseFloat(d.nav) };
    })
    .filter((d) => d.date >= chartStart)
    .sort((a, b) => a.date - b.date);

  let labels = [],
    costData = [],
    valueData = [];
  timeline.forEach((tp) => {
    let rU = 0,
      rI = 0;
    fund.transactions.forEach((tx) => {
      if (tx.date <= tp.date) {
        if (tx.units > 0) {
          rI += Math.abs(tx.amount);
          rU += tx.units;
        } else {
          const avg = rU > 0 ? rI / rU : 0;
          rI -= avg * Math.abs(tx.units);
          rU += tx.units;
        }
      }
    });
    labels.push(
      tp.date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      }),
    );
    costData.push(Math.round(rI));
    valueData.push(Math.round(rU * tp.nav));
  });
  const profitData = valueData.map((val, idx) => val - costData[idx]);

  if (historyChartInstance) historyChartInstance.destroy();

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const tickColor = isDark ? "#94a3b8" : "#64748b";

  const ds = [];
  if (mode.value === "value" || mode.value === "both") {
    ds.push({
      label: "Value",
      data: valueData,
      borderColor: CHART_CONFIG.valueColor,
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      fill: CHART_CONFIG.fill,
      backgroundColor: CHART_CONFIG.valueBg,
      pointRadius: CHART_CONFIG.pointRadius,
    });
  }
  if (mode.value === "both") {
    ds.push({
      label: "Cost",
      data: costData,
      borderColor: CHART_CONFIG.costColor,
      borderWidth: CHART_CONFIG.costWidth,
      fill: false,
      tension: 0,
      pointRadius: 0,
    });
  }
  if (mode.value === "profit") {
    ds.push({
      label: "Net Gain",
      data: profitData,
      borderColor: "#10b981",
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      pointRadius: CHART_CONFIG.pointRadius,
      fill: false,
    });
  }
  if (mode.value === "nav") {
    ds.push({
      label: "NAV",
      data: timeline.map((tp) => tp.nav),
      borderColor: "#10b981",
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      pointRadius: CHART_CONFIG.pointRadius,
      fill: false,
    });
  }

  historyChartInstance = new Chart(
    document.getElementById("historyChart").getContext("2d"),
    {
      type: "line",
      data: { labels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: tickColor, font: { weight: "700" } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y;
                const formatted =
                  val % 1 === 0 ? val.toLocaleString("en-IN") : val.toFixed(2);
                return ` ₹${formatted}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              callback: (v) => {
                if (v >= 100000) return "₹" + (v / 100000).toFixed(1) + "L";
                const formatted =
                  v % 1 === 0 ? v.toLocaleString("en-IN") : v.toFixed(2);
                return "₹" + formatted;
              },
            },
          },
        },
      },
    },
  );

  // Smooth scroll to chart
  document
    .getElementById("history-section")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function toggleChartFullscreen(sectionId, btn) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const expanded = section.classList.toggle("fullscreen-chart");
  btn.innerText = expanded ? "🗗" : "⤢";
  btn.title = expanded ? "Restore chart size" : "Enlarge chart";

  const resizeChart = () => {
    if (sectionId === "total-history-section" && totalHistoryChartInstance)
      totalHistoryChartInstance.resize();
    if (sectionId === "allocation-section" && allocationChartInstance)
      allocationChartInstance.resize();
    if (sectionId === "history-section" && historyChartInstance)
      historyChartInstance.resize();
  };

  setTimeout(resizeChart, 120);
}

// ─────────────────────────────────────────────
//  EXPORT TO CSV
// ─────────────────────────────────────────────
function exportCSV() {
  if (!globalData.length) {
    showToast("No data to export.", "warning");
    return;
  }

  const headers = [
    "Fund Name",
    "Code",
    "Units",
    "Net Invested (₹)",
    "Current Value (₹)",
    "Returns (₹)",
    "Returns (%)",
    "XIRR (%)",
  ];
  const rows = globalData.map((f) => {
    const curVal = f.currentNav * f.units;
    const retRs = curVal - f.invested;
    const retPct = f.invested > 0 ? (retRs / f.invested) * 100 : 0;
    const xirr = safeXIRR([
      ...f.transactions,
      { date: new Date(), amount: curVal },
    ]);
    return [
      `"${f.name}"`,
      f.code,
      f.units.toFixed(3),
      Math.round(f.invested),
      Math.round(curVal),
      Math.round(retRs),
      retPct.toFixed(2),
      xirr.toFixed(2),
    ];
  });

  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `portfolio_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Portfolio exported as CSV!", "success");
}

// ─────────────────────────────────────────────
//  SAFE XIRR (prevents crashes on bad data)
// ─────────────────────────────────────────────
function safeXIRR(cf) {
  try {
    if (cf.length < 2) return 0;
    const result = calculateXIRR(cf);
    if (!isFinite(result) || isNaN(result)) return 0;
    return Math.max(-100, Math.min(result, 9999)); // clamp to sane range
  } catch {
    return 0;
  }
}

function calculateXIRR(cf) {
  let x = 0.1;
  for (let i = 0; i < 200; i++) {
    let npv = 0,
      dNpv = 0;
    for (const c of cf) {
      const t = (c.date - cf[0].date) / 31557600000;
      const s = Math.pow(1 + x, t);
      npv += c.amount / s;
      dNpv -= (t * c.amount) / Math.pow(1 + x, t + 1);
    }
    if (Math.abs(dNpv) < 1e-10) break;
    const nx = x - npv / dNpv;
    if (Math.abs(nx - x) < 0.000001) return nx * 100;
    x = nx;
    if (!isFinite(x)) throw new Error("XIRR diverged");
  }
  return x * 100;
}

// ─────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────
initTheme();
init();
