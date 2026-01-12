const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw1uaCk1OycQTD6-xwquIqUqR7NDG0dzVSngDuxzuVrHjAoHwnjZpSfwl8a7J-P5tgKtA/exec";
let globalData = [];

let allocationChart = null;

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

// --- 2. HEATMAP COLOR LOGIC ---
function getHeatmapColor(value) {
  if (value >= 15) return "rgba(39, 174, 96, 0.3)"; // Deep Green
  if (value >= 10) return "rgba(39, 174, 96, 0.15)"; // Light Green
  if (value >= 0) return "rgba(39, 174, 96, 0.05)"; // Ghost Green
  return "rgba(231, 76, 60, 0.1)"; // Light Red
}

// --- 3. DATA FETCHING & SYNC ---
async function init() {
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "block";

  let portfolioMap = {};
  try {
    const response = await fetch(SHEET_CSV_URL + `&cb=${new Date().getTime()}`);
    const csvText = await response.text();
    const rows = csvText
      .split("\n")
      .filter((r) => r.trim() !== "")
      .slice(1);

    for (const row of rows) {
      const cols = row.split(",");
      if (cols.length < 3) continue;

      let [dateStr, schemeId, unitsStr] = cols;
      const id = schemeId.trim();
      const units = parseFloat(unitsStr.trim());
      const [d, m, y] = dateStr.trim().replaceAll("/", "-").split("-");
      const txnDate = new Date(y, m - 1, d);

      const res = await fetch(`https://api.mfapi.in/mf/${id}`);
      const json = await res.json();
      const buyRec = json.data.find((e) => e.date === `${d}-${m}-${y}`);
      const currentNav = parseFloat(json.data[0].nav);

      if (buyRec) {
        const buyNav = parseFloat(buyRec.nav);
        const investedAmt = buyNav * units;

        if (!portfolioMap[id]) {
          portfolioMap[id] = {
            name: json.meta.scheme_name,
            code: id,
            units: 0,
            invested: 0,
            currentNav: currentNav,
            flows: [],
          };
        }
        portfolioMap[id].units += units;
        portfolioMap[id].invested += investedAmt;
        portfolioMap[id].flows.push({ date: txnDate, amount: -investedAmt });
      }
    }
    globalData = Object.values(portfolioMap);
    handleSort();
  } catch (err) {
    console.error("Fetch Error:", err);
  } finally {
    if (loading) loading.style.display = "none";
  }
}

// --- 4. SORTING & UI RENDERING ---
function handleSort() {
  const sortBy = document.getElementById("sort-select").value;

  globalData.sort((a, b) => {
    if (sortBy === "name") {
      return a.name.localeCompare(b.name);
    }

    let aVal, bVal;

    if (sortBy === "invested") {
      aVal = a.invested;
      bVal = b.invested;
    } else if (sortBy === "returnsRs") {
      // Current Value - Invested
      aVal = a.currentNav * a.units - a.invested;
      bVal = b.currentNav * b.units - b.invested;
    } else if (sortBy === "xirr") {
      // Re-calculate XIRR for comparison
      aVal = calculateXIRR([
        ...a.flows,
        { date: new Date(), amount: a.currentNav * a.units },
      ]);
      bVal = calculateXIRR([
        ...b.flows,
        { date: new Date(), amount: b.currentNav * b.units },
      ]);
    }

    return bVal - aVal; // Descending order (Highest first)
  });

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById("portfolio-body");
  let html = "";
  let gInv = 0,
    gCur = 0,
    gFlows = [];

  globalData.forEach((f) => {
    const curVal = f.currentNav * f.units;
    const retRs = curVal - f.invested;
    const absPct = (retRs / f.invested) * 100;
    const xirr = calculateXIRR([
      ...f.flows,
      { date: new Date(), amount: curVal },
    ]);

    gInv += f.invested;
    gCur += curVal;
    gFlows.push(...f.flows);
    const xirrBg = getHeatmapColor(xirr);

    html += `
            <tr>
                <td><strong>${f.name}</strong></td>
                <td>${f.code}</td>
                <td>${f.units.toFixed(3)}</td>
                <td>₹${f.invested.toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}</td>
                <td>₹${curVal.toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}</td>
                <td class="${
                  retRs >= 0 ? "gain" : "loss"
                }">₹${retRs.toLocaleString("en-IN", {
      maximumFractionDigits: 0,
    })}</td>
                <td class="${absPct >= 0 ? "gain" : "loss"}">${absPct.toFixed(
      2
    )}%</td>
                <td style="background-color: ${xirrBg}; font-weight:bold; border-radius:4px; text-align:right;">
                    ${xirr.toFixed(2)}%
                </td>
            </tr>`;
  });

  tbody.innerHTML = html;

  // Update Top Summary Cards
  document.getElementById("total-invested").innerText =
    "₹" + gInv.toLocaleString("en-IN");
  document.getElementById("total-current").innerText =
    "₹" + gCur.toLocaleString("en-IN");

  const totalXirr = calculateXIRR([
    ...gFlows,
    { date: new Date(), amount: gCur },
  ]);
  document.getElementById("total-xirr").innerText = totalXirr.toFixed(2) + "%";

  // Update Timestamp
  const now = new Date();
  const syncElem = document.getElementById("sync-time");
  if (syncElem)
    syncElem.innerText =
      now.toLocaleDateString() + " " + now.toLocaleTimeString();

  updateChart();
}

// --- 5. ALLOCATION CHART ---
function updateChart() {
  const canvas = document.getElementById("allocationChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const labels = globalData.map((f) => f.name);
  const values = globalData.map((f) => f.currentNav * f.units);

  if (allocationChart) {
    allocationChart.destroy();
  }

  allocationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: values,
          backgroundColor: [
            "#007bff",
            "#28a745",
            "#ffc107",
            "#dc3545",
            "#6610f2",
            "#fd7e14",
          ],
          borderWidth: 5,
          borderColor: "#ffffff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // This is key to filling the CSS height
      plugins: {
        legend: {
          display: true,
          position: window.innerWidth > 768 ? "right" : "bottom",
          labels: {
            padding: 20,
            usePointStyle: true,
            font: {
              size: 14, // Larger font for desktop
            },
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              let label = context.label || "";
              let value = context.raw || 0;
              return ` ${label}: ₹${value.toLocaleString("en-IN")}`;
            },
          },
        },
      },
      layout: {
        padding: 20,
      },
    },
  });
}

// --- 6. FORM SUBMISSION ---
async function submitData() {
  const btn = document.getElementById("submit-btn");
  const data = {
    date: document.getElementById("form-date").value,
    id: document.getElementById("form-id").value,
    units: document.getElementById("form-units").value,
  };

  if (!data.date || !data.id || !data.units) {
    alert("Please fill all fields!");
    return;
  }

  btn.innerText = "Adding...";
  btn.disabled = true;

  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(data),
    });

    alert("Success! The sheet has been updated. Refresh in 1-2 minutes.");
    document
      .querySelectorAll(".form-grid input")
      .forEach((i) => (i.value = ""));
  } catch (e) {
    alert("Submission Failed. Check SCRIPT_URL.");
  } finally {
    btn.innerText = "Add to Sheet";
    btn.disabled = false;
  }
}
// 1. Search Logic with Debouncing
let searchTimeout;
async function searchMF() {
    const query = document.getElementById('mf-search').value;
    const resultsDiv = document.getElementById('search-results');

    if (query.length < 3) { resultsDiv.innerHTML = ""; return; }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const response = await fetch(`https://api.mfapi.in/mf/search?q=${query}`);
        const data = await response.json();

        resultsDiv.innerHTML = data.map(item => `
            <div class="suggestion-item" onclick="analyzeFund('${item.schemeCode}', '${item.schemeName.replace(/'/g, "\\'")}')">
                ${item.schemeName} (${item.schemeCode})
            </div>
        `).join('');
    }, 300);
}

// 2. Analyze & Calculate Returns
async function analyzeFund(code, name) {
    document.getElementById('search-results').innerHTML = "";
    document.getElementById('mf-search').value = name;

    const response = await fetch(`https://api.mfapi.in/mf/${code}`);
    const json = await response.json();
    const navData = json.data;
    const currentNav = parseFloat(navData[0].nav);

    const calculateReturn = (days) => {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);

        // Find the closest historical NAV
        const historicalEntry = navData.find(entry => {
            const [d, m, y] = entry.date.split("-");
            return new Date(y, m - 1, d) <= targetDate;
        });

        if (!historicalEntry) return "N/A";
        const histNav = parseFloat(historicalEntry.nav);
        const ret = ((currentNav - histNav) / histNav) * 100;
        const className = ret >= 0 ? 'ret-pos' : 'ret-neg';
        return `<span class="${className}">${ret.toFixed(2)}%</span>`;
    };

    const tbody = document.getElementById('analysis-body');
    tbody.innerHTML = `
        <tr>
            <td><strong>${name}</strong></td>
            <td>${code}</td>
            <td>${calculateReturn(1)}</td>
            <td>${calculateReturn(30)}</td>
            <td>${calculateReturn(90)}</td>
            <td>${calculateReturn(180)}</td>
            <td>${calculateReturn(365)}</td>
            <td>${calculateReturn(365 * 3)}</td>
            <td>${calculateReturn(365 * 5)}</td>
        </tr>
    `;
    document.getElementById('analysis-table-container').style.display = "block";
}
// Start everything
init();
