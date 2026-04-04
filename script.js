const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";

let globalData = [];
let totalHistoryChartInstance = null;
let historyChartInstance = null;

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
      let totalInvested = 0,
        transactions = [];

      localTotals[id].transactions.forEach((tx) => {
        const [d, m, y] = tx.dateStr.replaceAll("/", "-").split("-");
        const buyRec = json.data.find((e) => e.date === `${d}-${m}-${y}`);
        if (buyRec) {
          const cost = parseFloat(buyRec.nav) * tx.units;
          totalInvested += cost;
          transactions.push({
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
        currentNav,
        prevNav,
        transactions,
        navHistory: json.data,
      });
    }
    globalData = portfolioArray;
    renderTable();
  } catch (err) {
    console.error(err);
  }
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
    const dayChangePct = ((f.currentNav - f.prevNav) / f.prevNav) * 100;

    gInv += f.invested;
    gCur += curVal;
    gPrevTotal += prevVal;
    gFlows.push(...f.transactions);

    html += `<tr onclick="showHistoryChart('${f.code}', 'all')">
            <td><strong>${f.name}</strong></td>
            <td>${f.units.toFixed(3)}</td>
            <td>₹${Math.round(f.invested).toLocaleString("en-IN")}</td>
            <td>₹${Math.round(curVal).toLocaleString("en-IN")}</td>
            <td class="${dayChangePct >= 0 ? "gain" : "loss"}">${dayChangePct.toFixed(2)}%</td>
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
  const dayPct = (dayDiff / gPrevTotal) * 100;
  document.getElementById("total-day-change").className =
    `stat-value ${dayDiff >= 0 ? "gain" : "loss"}`;
  document.getElementById("total-day-change").innerText =
    `₹${Math.round(dayDiff).toLocaleString("en-IN")} (${dayPct.toFixed(2)}%)`;

  document.getElementById("total-xirr").innerText =
    calculateXIRR([...gFlows, { date: new Date(), amount: gCur }]).toFixed(2) +
    "%";

  renderTotalHistoryChart("all");
}

function renderTotalHistoryChart(days) {
  const canvas = document.getElementById("totalHistoryChart");
  const ctx = canvas.getContext("2d");

  const btns = document.querySelectorAll("#total-history-section .filter-btn");
  btns.forEach((b) => {
    b.classList.remove("active");
    if (
      (days === "all" && b.innerText === "ALL") ||
      (days === 90 && b.innerText === "3M") ||
      (days === 180 && b.innerText === "6M") ||
      (days === 365 && b.innerText === "1Y")
    )
      b.classList.add("active");
  });

  let allTransactions = globalData.flatMap((f) => f.transactions);
  let startDate = new Date(Math.min(...allTransactions.map((t) => t.date)));
  if (days !== "all") {
    const filterDate = new Date();
    filterDate.setDate(filterDate.getDate() - days);
    if (filterDate > startDate) startDate = filterDate;
  }

  let masterTimeline = new Map();
  globalData.forEach((fund) => {
    fund.navHistory.forEach((entry) => {
      const [d, m, y] = entry.date.split("-");
      const dateObj = new Date(y, m - 1, d);
      if (dateObj >= startDate) {
        const dateKey = dateObj.toDateString();
        if (!masterTimeline.has(dateKey))
          masterTimeline.set(dateKey, {
            date: dateObj,
            invested: 0,
            current: 0,
          });
      }
    });
  });

  const sortedDates = Array.from(masterTimeline.values()).sort(
    (a, b) => a.date - b.date,
  );
  sortedDates.forEach((point) => {
    globalData.forEach((fund) => {
      let runningUnits = 0,
        runningInv = 0;
      fund.transactions.forEach((tx) => {
        if (tx.date <= point.date) {
          runningUnits += tx.units;
          if (tx.units > 0) runningInv += Math.abs(tx.amount);
          else
            runningInv -=
              (runningInv / (runningUnits - tx.units || 1)) *
              Math.abs(tx.units);
        }
      });
      const dateStr = point.date
        .toLocaleDateString("en-GB")
        .replace(/\//g, "-");
      const navEntry = fund.navHistory.find((n) => n.date === dateStr);
      const nav = navEntry
        ? parseFloat(navEntry.nav)
        : parseFloat(fund.navHistory[0].nav);
      point.invested += runningInv;
      point.current += runningUnits * nav;
    });
  });

  if (totalHistoryChartInstance) totalHistoryChartInstance.destroy();
  totalHistoryChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: sortedDates.map((p) =>
        p.date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
      ),
      datasets: [
        {
          label: "Value",
          data: sortedDates.map((p) => Math.round(p.current)),
          borderColor: "#6366f1",
          borderWidth: 3,
          tension: 0.4,
          pointRadius: 0,
          fill: true,
          backgroundColor: "rgba(99, 102, 241, 0.05)",
        },
        {
          label: "Invested",
          data: sortedDates.map((p) => Math.round(p.invested)),
          borderColor: "#94a3b8",
          borderWidth: 2,
          tension: 0,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: { enabled: true, backgroundColor: "rgba(15, 23, 42, 0.9)" },
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(0,0,0,0.03)" } },
      },
    },
  });
}

function showHistoryChart(schemeCode, days) {
  const fund = globalData.find((f) => f.code === schemeCode);
  if (!fund) return;
  document.getElementById("history-section").style.display = "block";
  document.getElementById("history-fund-name").innerText = fund.name;
  document.getElementById("fund-filters").innerHTML = `
        <button class="filter-btn ${days == 90 ? "active" : ""}" onclick="showHistoryChart('${schemeCode}', 90)">3M</button>
        <button class="filter-btn ${days == 180 ? "active" : ""}" onclick="showHistoryChart('${schemeCode}', 180)">6M</button>
        <button class="filter-btn ${days == 365 ? "active" : ""}" onclick="showHistoryChart('${schemeCode}', 365)">1Y</button>
        <button class="filter-btn ${days == "all" ? "active" : ""}" onclick="showHistoryChart('${schemeCode}', 'all')">ALL</button>`;

  let startDate = new Date(Math.min(...fund.transactions.map((t) => t.date)));
  if (days !== "all") {
    const filterDate = new Date();
    filterDate.setDate(filterDate.getDate() - days);
    if (filterDate > startDate) startDate = filterDate;
  }

  const timeline = fund.navHistory
    .map((d) => {
      const [day, month, year] = d.date.split("-");
      return { date: new Date(year, month - 1, day), nav: parseFloat(d.nav) };
    })
    .filter((d) => d.date >= startDate)
    .reverse();

  let labels = [],
    invData = [],
    curData = [],
    rUnits = 0,
    rInv = 0;
  timeline.forEach((tp) => {
    fund.transactions.forEach((tx) => {
      if (tx.date.toDateString() === tp.date.toDateString()) {
        rUnits += tx.units;
        rInv +=
          tx.units > 0
            ? Math.abs(tx.amount)
            : -((rInv / (rUnits - tx.units)) * Math.abs(tx.units));
      }
    });
    labels.push(
      tp.date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    );
    invData.push(Math.round(rInv));
    curData.push(Math.round(rUnits * tp.nav));
  });

  if (historyChartInstance) historyChartInstance.destroy();
  historyChartInstance = new Chart(
    document.getElementById("historyChart").getContext("2d"),
    {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Value",
            data: curData,
            borderColor: "#6366f1",
            borderWidth: 3,
            tension: 0.4,
            fill: true,
            backgroundColor: "rgba(99, 102, 241, 0.1)",
            pointRadius: 0,
          },
          {
            label: "Invested",
            data: invData,
            borderColor: "#94a3b8",
            borderWidth: 2,
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
        plugins: { tooltip: { enabled: true }, legend: { display: false } },
      },
    },
  );
}

function calculateXIRR(cashFlows) {
  if (cashFlows.length < 2) return 0;
  let xirr = 0.1;
  for (let i = 0; i < 100; i++) {
    let npv = 0,
      dNpv = 0;
    for (const cf of cashFlows) {
      const t = (cf.date - cashFlows[0].date) / (1000 * 60 * 60 * 24 * 365.25);
      const step = Math.pow(1 + xirr, t);
      npv += cf.amount / step;
      dNpv -= (t * cf.amount) / Math.pow(1 + xirr, t + 1);
    }
    const newXirr = xirr - npv / dNpv;
    if (Math.abs(newXirr - xirr) < 0.000001) return newXirr * 100;
    xirr = newXirr;
  }
  return xirr * 100;
}

init();
