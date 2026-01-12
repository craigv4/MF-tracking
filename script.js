const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQqGiMZpcrNGa6vTUxck82cFgTbC3FSTMlQm69T5buwWl_znhJg_PozTOOO2oof3xGV55JVj-AEEvf1/pub?gid=0&single=true&output=csv";
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw1uaCk1OycQTD6-xwquIqUqR7NDG0dzVSngDuxzuVrHjAoHwnjZpSfwl8a7J-P5tgKtA/exec";
let globalData = [];

// 1. XIRR ENGINE
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

// 2. DATA FETCHING
async function init() {
  const loading = document.getElementById("loading");
  loading.style.display = "block";
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
    console.error(err);
  } finally {
    loading.style.display = "none";
  }
}

// 3. SORTING & RENDERING
function handleSort() {
  const sortBy = document.getElementById("sort-select").value;
  globalData.sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    const aVal =
      sortBy === "invested" ? a.invested : a.currentNav * a.units - a.invested;
    const bVal =
      sortBy === "invested" ? b.invested : b.currentNav * b.units - b.invested;
    return bVal - aVal;
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
                <td style="color:#007bff; font-weight:bold;">${xirr.toFixed(
                  2
                )}%</td>
            </tr>`;
  });

  tbody.innerHTML = html;
  document.getElementById("total-invested").innerText =
    "₹" + gInv.toLocaleString("en-IN");
  document.getElementById("total-current").innerText =
    "₹" + gCur.toLocaleString("en-IN");
  document.getElementById("total-xirr").innerText =
    calculateXIRR([...gFlows, { date: new Date(), amount: gCur }]).toFixed(2) +
    "%";
}

// 4. FORM SUBMISSION (Add this at the very bottom)
async function submitData() {
  const btn = document.getElementById("submit-btn");
  const data = {
    date: document.getElementById("form-date").value,
    id: document.getElementById("form-id").value,
    units: document.getElementById("form-units").value,
  };

  if (!data.date || !data.id || !data.units) {
    alert("Fill all fields!");
    return;
  }

  btn.innerText = "Adding...";
  btn.disabled = true;

  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors", // Required for Google Apps Script
      cache: "no-cache",
      body: JSON.stringify(data),
    });

    alert(
      "Data sent to Google Sheets! Note: It may take 1-2 mins to appear on dashboard."
    );
    document.getElementById("form-date").value = "";
    document.getElementById("form-id").value = "";
    document.getElementById("form-units").value = "";
  } catch (e) {
    alert("Error!");
  } finally {
    btn.innerText = "Add to Sheet";
    btn.disabled = false;
  }
}

init();
