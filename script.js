// --- CONFIGURATION ---
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw1uaCk1OycQTD6-xwquIqUqR7NDG0dzVSngDuxzuVrHjAoHwnjZpSfwl8a7J-P5tgKtA/exec";

let globalData = [];
let allocationChart = null;
let historyChartInstance = null;
let searchTimeout;

// --- 1. THEME ENGINE ---
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const targetTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", targetTheme);
  localStorage.setItem("theme", targetTheme);
  updateThemeIcon(targetTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("theme-icon");
  if (icon) icon.innerText = theme === "dark" ? "☀️" : "🌙";
}

// --- 1. XIRR ENGINE (Newton-Raphson Method) ---
function calculateXIRR(cashFlows) {
  if (cashFlows.length < 2) return 0;
  let xirr = 0.1;
  const maxIterations = 100;
  const precision = 0.000001;
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dNpv = 0;
    for (const cf of cashFlows) {
      const t = (cf.date - cashFlows[0].date) / (1000 * 60 * 60 * 24 * 365.25);
      const step = Math.pow(1 + xirr, t);
      npv += cf.amount / step;
      dNpv -= (t * cf.amount) / Math.pow(1 + xirr, t + 1);
    }
    const newXirr = xirr - npv / dNpv;
    if (Math.abs(newXirr - xirr) < precision) return newXirr * 100;
    xirr = newXirr;
  }
  return xirr * 100;
}

// --- 2. UI HELPERS ---
function getHeatmapColor(value) {
  if (value >= 15) return "rgba(39, 174, 96, 0.3)";
  if (value >= 10) return "rgba(39, 174, 96, 0.15)";
  if (value >= 0) return "rgba(39, 174, 96, 0.05)";
  return "rgba(231, 76, 60, 0.1)";
}

// --- 3. DATA FETCHING & GROUPING ---
async function init() {
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "block";

  try {
    const response = await fetch(`${SHEET_CSV_URL}&cb=${Date.now()}`);
    const csvText = await response.text();
    const rows = csvText
      .split("\n")
      .filter((r) => r.trim() !== "")
      .slice(1);

    let localTotals = {};
    rows.forEach((row) => {
      const [dateStr, id, unitsStr] = row.split(",").map((c) => c.trim());
      if (!id || isNaN(parseFloat(unitsStr))) return;

      if (!localTotals[id]) localTotals[id] = { units: 0, transactions: [] };
      localTotals[id].units += parseFloat(unitsStr);
      localTotals[id].transactions.push({
        dateStr,
        units: parseFloat(unitsStr),
      });
    });

    let portfolioArray = [];
    for (const id in localTotals) {
      const res = await fetch(`https://api.mfapi.in/mf/${id}`);
      const json = await res.json();
      if (!json || !json.data) continue;

      const currentNav = parseFloat(json.data[0].nav);
      const prevNav = json.data[1] ? parseFloat(json.data[1].nav) : currentNav;
      let totalInvested = 0;
      let transactionHistory = [];

      localTotals[id].transactions.forEach((tx) => {
        const [d, m, y] = tx.dateStr.replaceAll("/", "-").split("-");
        const dateKey = `${d}-${m}-${y}`;
        const buyRec = json.data.find((e) => e.date === dateKey);

        if (buyRec) {
          const cost = parseFloat(buyRec.nav) * tx.units;
          totalInvested += cost;
          // Cash flow logic: Outflow (investment) is negative
          transactionHistory.push({
            date: new Date(y, m - 1, d),
            amount: -cost,
            units: tx.units,
          });
        }
      });

      portfolioArray.push({
        name: json.meta.scheme_name,
        code: id,
        units: localTotals[id].units,
        invested: totalInvested,
        currentNav: currentNav,
        prevNav: prevNav,
        transactions: transactionHistory,
        navHistory: json.data,
      });
    }

    globalData = portfolioArray;
    handleSort();
  } catch (err) {
    console.error("Calculation Error:", err);
  } finally {
    if (loading) loading.style.display = "none";
  }
}

// --- 4. SORTING & RENDERING ---
function handleSort() {
  const sortBy = document.getElementById("sort-select").value;
  globalData.sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    let aVal, bVal;
    if (sortBy === "invested") {
      aVal = a.invested;
      bVal = b.invested;
    } else if (sortBy === "returnsRs") {
      aVal = a.currentNav * a.units - a.invested;
      bVal = b.currentNav * b.units - b.invested;
    } else if (sortBy === "xirr") {
      aVal = calculateXIRR([
        ...a.transactions,
        { date: new Date(), amount: a.currentNav * a.units },
      ]);
      bVal = calculateXIRR([
        ...b.transactions,
        { date: new Date(), amount: b.currentNav * b.units },
      ]);
    }
    return bVal - aVal;
  });
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById("portfolio-body");
  let html = "",
    gInv = 0,
    gCur = 0,
    gFlows = [],
    gPrevValTotal = 0;

  globalData.forEach((f) => {
    const curVal = f.currentNav * f.units;
    const prevVal = f.prevNav * f.units;
    const retRs = curVal - f.invested;
    const absPct = (retRs / f.invested) * 100;
    const dayChangeRs = curVal - prevVal;
    const dayChangePct = ((f.currentNav - f.prevNav) / f.prevNav) * 100;
    const xirr = calculateXIRR([
      ...f.transactions,
      { date: new Date(), amount: curVal },
    ]);

    gInv += f.invested;
    gCur += curVal;
    gPrevValTotal += prevVal;
    gFlows.push(...f.transactions);

    html += `
      <tr>
        <td onclick="showHistoryChart('${f.code}')" style="cursor:pointer; color:var(--text-main); text-decoration:underline;">
            <strong>${f.name}</strong>
        </td>
        <td>${f.code}</td>
        <td>${f.units.toFixed(3)}</td>
        <td>₹${Math.round(f.invested).toLocaleString("en-IN")}</td>
        <td>₹${Math.round(curVal).toLocaleString("en-IN")}</td>
        <td class="${dayChangeRs >= 0 ? "gain" : "loss"}">${dayChangePct.toFixed(2)}%<br><small>₹${Math.round(dayChangeRs)}</small></td>
        <td class="${retRs >= 0 ? "gain" : "loss"}">₹${Math.round(retRs).toLocaleString("en-IN")}</td>
        <td class="${absPct >= 0 ? "gain" : "loss"}">${absPct.toFixed(2)}%</td>
        <td style="background-color: ${getHeatmapColor(xirr)}; font-weight:bold; text-align:right;">${xirr.toFixed(2)}%</td>
      </tr>`;
  });

  tbody.innerHTML = html;
  document.getElementById("total-invested").innerText =
    "₹" + Math.round(gInv).toLocaleString("en-IN");
  document.getElementById("total-current").innerText =
    "₹" + Math.round(gCur).toLocaleString("en-IN");

  const totalProfit = gCur - gInv;
  const pElem = document.getElementById("total-profit");
  if (pElem) {
    pElem.innerText = "₹" + Math.round(totalProfit).toLocaleString("en-IN");
    pElem.className = `stat-value ${totalProfit >= 0 ? "gain" : "loss"}`;
  }

  const dcRs = gCur - gPrevValTotal;
  const dcPct = (dcRs / gPrevValTotal) * 100;
  const dcElem = document.getElementById("total-day-change");
  if (dcElem) {
    dcElem.innerText = `₹${Math.round(dcRs).toLocaleString("en-IN")} (${dcPct.toFixed(2)}%)`;
    dcElem.className = `stat-value ${dcRs >= 0 ? "gain" : "loss"}`;
  }

  document.getElementById("total-xirr").innerText =
    calculateXIRR([...gFlows, { date: new Date(), amount: gCur }]).toFixed(2) +
    "%";
  updateCharts();
}

// --- 5. CHARTS ---
function updateCharts() {
  const allocCtx = document.getElementById("allocationChart")?.getContext("2d");
  if (allocCtx) {
    if (allocationChart) allocationChart.destroy();
    allocationChart = new Chart(allocCtx, {
      type: "doughnut",
      data: {
        labels: globalData.map((f) => f.name),
        datasets: [
          {
            data: globalData.map((f) => f.currentNav * f.units),
            backgroundColor: [
              "#007bff",
              "#28a745",
              "#ffc107",
              "#dc3545",
              "#6610f2",
              "#fd7e14",
            ],
            borderWidth: 2,
            borderColor: getComputedStyle(
              document.documentElement,
            ).getPropertyValue("--card-bg"),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "right" } },
      },
    });
  }
}

// --- 6. PERFORMANCE TIMELINE CHART ---
async function showHistoryChart(schemeCode) {
  const fund = globalData.find((f) => f.code === schemeCode);
  const section = document.getElementById("history-section");
  const canvas = document.getElementById("historyChart");
  if (!fund || !canvas || !fund.transactions) return;

  section.style.display = "block";
  document.getElementById("history-fund-name").innerText = fund.name;
  section.scrollIntoView({ behavior: "smooth" });

  try {
    const ctx = canvas.getContext("2d");
    const sortedFlows = [...fund.transactions].sort((a, b) => a.date - b.date);
    const startDate = sortedFlows[0].date;

    const timeline = fund.navHistory
      .map((d) => {
        const [day, month, year] = d.date.split("-");
        return { date: new Date(year, month - 1, day), nav: parseFloat(d.nav) };
      })
      .filter((d) => d.date >= startDate)
      .reverse();

    let labels = [],
      invData = [],
      curData = [];
    let runningUnits = 0,
      runningInv = 0;

    timeline.forEach((tp) => {
      sortedFlows.forEach((flow) => {
        if (flow.date.toDateString() === tp.date.toDateString()) {
          runningUnits += flow.units; // Subtracts if units is negative
          if (flow.units > 0) runningInv += Math.abs(flow.amount);
          else {
            const unitsBefore = runningUnits - flow.units;
            runningInv -=
              (runningInv / (unitsBefore || 1)) * Math.abs(flow.units);
          }
        }
      });
      labels.push(
        tp.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
      );
      invData.push(Math.round(runningInv));
      curData.push(Math.round(runningUnits * tp.nav));
    });

    if (historyChartInstance) historyChartInstance.destroy();
    historyChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Current Value",
            data: curData,
            borderColor: "#4299e1",
            backgroundColor: "rgba(66, 153, 225, 0.1)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
          {
            label: "Invested Value",
            data: invData,
            borderColor: "#a0aec0",

            fill: false,
            tension: 0,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: { ticks: { callback: (v) => "₹" + v.toLocaleString("en-IN") } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (i) =>
                `${i.dataset.label}: ₹${i.raw.toLocaleString("en-IN")}`,
            },
          },
        },
      },
    });
  } catch (err) {
    console.error("Chart Render Failed:", err);
  }
}

// --- 7. UTILITIES: SEARCH, ANALYZE, SUBMIT ---
async function searchMF() {
  const query = document.getElementById("mf-search").value;
  const resultsDiv = document.getElementById("search-results");
  if (query.length < 3) {
    resultsDiv.innerHTML = "";
    return;
  }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`https://api.mfapi.in/mf/search?q=${query}`);
      const data = await response.json();
      resultsDiv.innerHTML = data
        .map(
          (item) =>
            `<div class="suggestion-item" onclick="analyzeFund('${item.schemeCode}', '${item.schemeName.replace(/'/g, "\\'")}')">${item.schemeName} (${item.schemeCode})</div>`,
        )
        .join("");
    } catch (e) {
      console.error("Search failed", e);
    }
  }, 300);
}

async function analyzeFund(code, name) {
  document.getElementById("search-results").innerHTML = "";
  document.getElementById("mf-search").value = name;
  const response = await fetch(`https://api.mfapi.in/mf/${code}`);
  const json = await response.json();
  const currentNav = parseFloat(json.data[0].nav);

  const calculateReturn = (days) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - days);
    const hist = json.data.find((e) => {
      const [d, m, y] = e.date.split("-");
      return new Date(y, m - 1, d) <= targetDate;
    });
    if (!hist) return "N/A";
    const ret =
      ((currentNav - parseFloat(hist.nav)) / parseFloat(hist.nav)) * 100;
    return `<span class="${ret >= 0 ? "gain" : "loss"}">${ret.toFixed(2)}%</span>`;
  };

  document.getElementById("analysis-body").innerHTML =
    `<tr><td>${name}</td><td>${code}</td><td>${calculateReturn(1)}</td><td>${calculateReturn(30)}</td><td>${calculateReturn(365)}</td><td>${calculateReturn(1095)}</td><td>${calculateReturn(1825)}</td></tr>`;
  document.getElementById("analysis-table-container").style.display = "block";
}

async function submitData() {
  const btn = document.getElementById("submit-btn");
  const data = {
    date: document.getElementById("form-date").value,
    id: document.getElementById("form-id").value,
    units: document.getElementById("form-units").value,
  };
  if (!data.date || !data.id || !data.units) return alert("Fill all fields");
  btn.innerText = "Adding...";
  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(data),
    });
    alert("Success! The sheet has been updated.");
  } catch (e) {
    alert("Failed to add data.");
  } finally {
    btn.innerText = "Add to Sheet";
  }
}

init();
