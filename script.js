const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzCMQ8n2nXcF7x8Rm-7g6isvcXAFc0RrrRpae6-ZNlKXgWwW7Ihn9tlgv8d9w4AZwvslg/exec";

let globalData = [];
let totalHistoryChartInstance = null;
let historyChartInstance = null;
let currentTotalDays = "all";
let currentFundDays = "all";

// Centralized style config for absolute consistency
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
}

function resetForm() {
  document.getElementById("form-id").value = "";
  document.getElementById("form-units").value = "";
  document.getElementById("form-price").value = "";
  document.getElementById("form-date").value = "";
  document.getElementById("add-form").classList.add("hidden");
}

async function submitData() {
  const btn = document.getElementById("submit-btn");
  const rawDate = document.getElementById("form-date").value;
  const schemeId = document.getElementById("form-id").value;
  const units = document.getElementById("form-units").value;
  const price = document.getElementById("form-price").value;

  if (!rawDate || !schemeId || !units)
    return alert("Please fill Date, Scheme Code, and Units.");

  const [year, month, day] = rawDate.split("-");
  const formattedDate = `${day}/${month}/${year}`;

  const payload = {
    date: formattedDate,
    id: schemeId,
    units: parseFloat(units),
    price: price ? parseFloat(price) : 0,
  };

  btn.innerText = "Syncing...";
  btn.disabled = true;

  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      cache: "no-cache",
      body: JSON.stringify(payload),
    });
    alert("Transaction recorded!");
    resetForm();
    setTimeout(() => {
      init();
    }, 2000);
  } catch (err) {
    alert("Connection error.");
  } finally {
    btn.innerText = "Submit to Sheet";
    btn.disabled = false;
  }
}

async function init() {
  initTheme();
  try {
    const response = await fetch(`${SHEET_CSV_URL}&cb=${Date.now()}`);
    const csvText = await response.text();
    const rows = csvText
      .split("\n")
      .filter((r) => r.trim() !== "")
      .slice(1);
    let localTotals = {};

    rows.forEach((row) => {
      const cols = row.split(",").map((c) => c.trim());
      const [dateStr, id, unitsStr, priceStr, stampStr, nameStr] = cols;
      if (!id || isNaN(parseFloat(unitsStr))) return;

      if (!localTotals[id])
        localTotals[id] = { units: 0, transactions: [], fallbackName: nameStr };
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

    let portfolioArray = [];
    for (const id in localTotals) {
      const res = await fetch(`https://api.mfapi.in/mf/${id}`);
      const json = await res.json();
      const currentNav = json.data ? parseFloat(json.data[0].nav) : 0;
      const prevNav =
        json.data && json.data[1] ? parseFloat(json.data[1].nav) : currentNav;

      let netInv = 0,
        rUnits = 0,
        txs = [],
        tStamp = 0;
      localTotals[id].transactions
        .sort((a, b) => {
          const [d1, m1, y1] = a.dateStr.split(/[-/]/);
          const [d2, m2, y2] = b.dateStr.split(/[-/]/);
          return new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2);
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
        name: json.meta ? json.meta.scheme_name : localTotals[id].fallbackName,
        code: id,
        units: rUnits,
        invested: netInv,
        stampDuty: tStamp,
        currentNav,
        prevNav,
        transactions: txs,
        navHistory: json.data || [],
      });
    }
    globalData = portfolioArray;
    renderTable();
  } catch (err) {
    console.error(err);
  }
}

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

function renderTable() {
  const tbody = document.getElementById("portfolio-body");
  let html = "",
    gInv = 0,
    gCur = 0,
    gPrevTotal = 0,
    gFlows = [];

  globalData.forEach((f) => {
    const curVal = f.currentNav * f.units;
    const prevVal = f.prevNav * f.units;
    const retRs = curVal - f.invested;
    const dayPct =
      f.prevNav !== 0 ? ((f.currentNav - f.prevNav) / f.prevNav) * 100 : 0;
    gInv += f.invested;
    gCur += curVal;
    gPrevTotal += prevVal;
    gFlows.push(...f.transactions);

    html += `<tr onclick="showHistoryChart('${f.code}', 'all')">
            <td><strong>${f.name}</strong><br><span class="code-badge">${f.code}</span></td>
            <td>${f.units.toFixed(3)}</td>
            <td>₹${Math.round(f.invested).toLocaleString("en-IN")}</td>
            <td>₹${Math.round(curVal).toLocaleString("en-IN")}</td>
            <td class="${dayPct >= 0 ? "gain" : "loss"}">${dayPct.toFixed(2)}%</td>
            <td class="${retRs >= 0 ? "gain" : "loss"}">₹${Math.round(retRs).toLocaleString("en-IN")}</td>
            <td style="font-weight:800; color:#6366f1;">${calculateXIRR([...f.transactions, { date: new Date(), amount: curVal }]).toFixed(2)}%</td>
        </tr>`;
  });

  tbody.innerHTML = html;
  document.getElementById("total-invested").innerText =
    "₹" + Math.round(gInv).toLocaleString("en-IN");
  document.getElementById("total-current").innerText =
    "₹" + Math.round(gCur).toLocaleString("en-IN");
  document.getElementById("total-profit").innerText =
    "₹" + Math.round(gCur - gInv).toLocaleString("en-IN");

  const dayDiff = gCur - gPrevTotal;
  const dayTotalPct = gPrevTotal !== 0 ? (dayDiff / gPrevTotal) * 100 : 0;
  const dayEl = document.getElementById("total-day-change");
  dayEl.className = `stat-value ${dayDiff >= 0 ? "gain" : "loss"}`;
  dayEl.innerText = `₹${Math.round(dayDiff).toLocaleString("en-IN")} (${dayTotalPct.toFixed(2)}%)`;

  const periods = [
    { k: "1w", d: 7 },
    { k: "1m", d: 30 },
    { k: "3m", d: 90 },
    { k: "6m", d: 180 },
    { k: "1y", d: 365 },
    { k: "3y", d: 1095 },
  ];
  periods.forEach((p) => {
    const oldVal = getPortfolioValueAt(p.d);
    const amt = gCur - oldVal;
    const pct = oldVal > 0 ? (amt / oldVal) * 100 : 0;
    const amtEl = document.getElementById(`ret-${p.k}-amt`),
      pctEl = document.getElementById(`ret-${p.k}-pct`);
    if (amtEl) {
      const cls = amt >= 0 ? "gain" : "loss";
      amtEl.innerText =
        (amt >= 0 ? "+" : "-") +
        "₹" +
        Math.round(Math.abs(amt)).toLocaleString("en-IN");
      amtEl.className = cls;
      pctEl.innerText = (amt >= 0 ? "+" : "") + pct.toFixed(1) + "%";
      pctEl.className = cls;
    }
  });

  document.getElementById("total-xirr").innerText =
    calculateXIRR([...gFlows, { date: new Date(), amount: gCur }]).toFixed(2) +
    "%";
  renderTotalHistoryChart();
}

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
  const ds = [
    {
      label: "Value",
      data: sorted.map((p) => Math.round(p.cur)),
      borderColor: CHART_CONFIG.valueColor,
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      pointRadius: CHART_CONFIG.pointRadius,
      fill: CHART_CONFIG.fill,
      backgroundColor: CHART_CONFIG.valueBg,
    },
  ];
  if (mode === "both")
    ds.push({
      label: "Cost",
      data: sorted.map((p) => Math.round(p.inv)),
      borderColor: CHART_CONFIG.costColor,
      borderWidth: CHART_CONFIG.costWidth,
      tension: 0,
      pointRadius: 0,
      fill: false,
    });

  totalHistoryChartInstance = new Chart(
    document.getElementById("totalHistoryChart").getContext("2d"),
    {
      type: "line",
      data: {
        labels: sorted.map((p) =>
          p.date.toLocaleDateString("en-IN", {
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
      },
    },
  );
}

function showHistoryChart(code, days = "all") {
  currentFundDays = days;
  const fund = globalData.find((f) => f.code === code);
  if (!fund) return;
  document.getElementById("history-section").style.display = "block";
  document.getElementById("history-fund-name").innerText = fund.name;
  const mode = document.getElementById("fund-display-mode");
  mode.onchange = () => showHistoryChart(code, currentFundDays);

  const filterArr = [7, 30, 90, 180, 365, 1095, "all"],
    lbls = ["1W", "1M", "3M", "6M", "1Y", "3Y", "ALL"];
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
    chartStart = filterDate > firstTxDate ? filterDate : firstTxDate;
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
      tp.date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    );
    costData.push(Math.round(rI));
    valueData.push(Math.round(rU * tp.nav));
  });

  if (historyChartInstance) historyChartInstance.destroy();
  const ds = [
    {
      label: "Value",
      data: valueData,
      borderColor: CHART_CONFIG.valueColor,
      borderWidth: CHART_CONFIG.borderWidth,
      tension: CHART_CONFIG.tension,
      fill: CHART_CONFIG.fill,
      backgroundColor: CHART_CONFIG.valueBg,
      pointRadius: CHART_CONFIG.pointRadius,
    },
  ];
  if (mode.value === "both")
    ds.push({
      label: "Cost",
      data: costData,
      borderColor: CHART_CONFIG.costColor,
      borderWidth: CHART_CONFIG.costWidth,
      fill: false,
      tension: 0,
      pointRadius: 0,
    });

  historyChartInstance = new Chart(
    document.getElementById("historyChart").getContext("2d"),
    {
      type: "line",
      data: { labels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
      },
    },
  );
}

function calculateXIRR(cf) {
  if (cf.length < 2) return 0;
  let x = 0.1;
  for (let i = 0; i < 100; i++) {
    let npv = 0,
      dNpv = 0;
    for (const c of cf) {
      const t = (c.date - cf[0].date) / 31557600000;
      const s = Math.pow(1 + x, t);
      npv += c.amount / s;
      dNpv -= (t * c.amount) / Math.pow(1 + x, t + 1);
    }
    const nx = x - npv / dNpv;
    if (Math.abs(nx - x) < 0.000001) return nx * 100;
    x = nx;
  }
  return x * 100;
}

init();
