const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw1uaCk1OycQTD6-xwquIqUqR7NDG0dzVSngDuxzuVrHjAoHwnjZpSfwl8a7J-P5tgKtA/exec";

let globalData = [];
let allocationChart = null;
let growthChart = null;
let searchTimeout;

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

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const targetTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", targetTheme);
  localStorage.setItem("theme", targetTheme);
  const icon = document.getElementById("theme-icon");
  if (icon) icon.innerText = targetTheme === "dark" ? "☀️" : "🌙";
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

    // 1. RAW SUMMING (The Console Logic)
    // We sum everything locally first so no units are lost.
    let localTotals = {};
    rows.forEach((row) => {
      const [dateStr, id, unitsStr] = row.split(",").map((c) => c.trim());
      if (!id || isNaN(parseFloat(unitsStr))) return;

      if (!localTotals[id]) {
        localTotals[id] = { units: 0, transactions: [] };
      }
      localTotals[id].units += parseFloat(unitsStr);
      localTotals[id].transactions.push({
        dateStr,
        units: parseFloat(unitsStr),
      });
    });

    // 2. API ENRICHMENT
    // Now we fetch data only ONCE per unique ID.
    let portfolioArray = [];
    const uniqueIds = Object.keys(localTotals);

    for (const id of uniqueIds) {
      const res = await fetch(`https://api.mfapi.in/mf/${id}`);
      const json = await res.json();

      const currentNav = parseFloat(json.data[0].nav);
      const prevNav = json.data[1] ? parseFloat(json.data[1].nav) : currentNav;

      let totalInvested = 0;
      let flows = [];

      // Calculate invested amount for each transaction in this group
      localTotals[id].transactions.forEach((tx) => {
        const [d, m, y] = tx.dateStr.replaceAll("/", "-").split("-");
        const dateKey = `${d}-${m}-${y}`;
        const buyRec = json.data.find((e) => e.date === dateKey);

        if (buyRec) {
          const cost = parseFloat(buyRec.nav) * tx.units;
          totalInvested += cost;
          flows.push({ date: new Date(y, m - 1, d), amount: -cost });
        }
      });

      portfolioArray.push({
        name: json.meta.scheme_name,
        code: id,
        units: localTotals[id].units, // This now matches your console exactly
        invested: totalInvested,
        currentNav: currentNav,
        prevNav: prevNav,
        flows: flows,
      });
    }

    globalData = portfolioArray;
    handleSort(); // Triggers renderTable()
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
        ...a.flows,
        { date: new Date(), amount: a.currentNav * a.units },
      ]);
      bVal = calculateXIRR([
        ...b.flows,
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
      ...f.flows,
      { date: new Date(), amount: curVal },
    ]);

    gInv += f.invested;
    gCur += curVal;
    gPrevValTotal += prevVal;
    gFlows.push(...f.flows);

    html += `
    <tr>
        <td><strong>${f.name}</strong></td>
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

  const totalDayChangeRs = gCur - gPrevValTotal;
  const totalDayChangePct = (totalDayChangeRs / gPrevValTotal) * 100;
  const dayChangeElem = document.getElementById("total-day-change");
  if (dayChangeElem) {
    dayChangeElem.className = `stat-value ${totalDayChangeRs >= 0 ? "gain" : "loss"}`;
    dayChangeElem.innerText = `₹${Math.round(totalDayChangeRs).toLocaleString("en-IN")} (${totalDayChangePct.toFixed(2)}%)`;
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

// --- 6. SEARCH & ANALYSIS ---
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
          (item) => `
        <div class="suggestion-item" onclick="analyzeFund('${item.schemeCode}', '${item.schemeName.replace(/'/g, "\\'")}')">
          ${item.schemeName} (${item.schemeCode})
        </div>`,
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

  document.getElementById("analysis-body").innerHTML = `
    <tr>
      <td>${name}</td><td>${code}</td>
      <td>${calculateReturn(1)}</td><td>${calculateReturn(30)}</td>
      <td>${calculateReturn(365)}</td><td>${calculateReturn(1095)}</td>
      <td>${calculateReturn(1825)}</td>
    </tr>`;
  document.getElementById("analysis-table-container").style.display = "block";
}

// --- 7. SUBMISSION ---
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
