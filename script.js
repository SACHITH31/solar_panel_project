google.charts.load("current", { packages: ["corechart"] });

const SPREADSHEET_ID = "1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0";
const SHEET_PREFIX = "EEE Block-1 Solar Data_Slave_1_";
const POLLING_INTERVAL = 120000;

let pollingTimer = null;
let isLive = false;
let lastDataTable = null;

const detectedEventSet = new Set();

const METRIC_COLUMNS = [
  { label: "PF Avg (inst) [F]", index: 2 },
  { label: "VA Total [J]", index: 3 },
  { label: "VL N Average (A) [N]", index: 4 },
  { label: "Current Total [V]", index: 5 },
  { label: "Frequency [Z]", index: 6 },
  { label: "Wh [AA]", index: 7 },
  { label: "VAh [AB]", index: 8 },
];

google.charts.setOnLoadCallback(init);

/* ---------- UI HELPERS (NON-LOGIC) ---------- */

function showLoading() {
  let loader = document.getElementById("loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "loader";
    loader.innerText = "";
    document.querySelector(".chart-card").prepend(loader);
  }
}

function hideLoading() {
  const loader = document.getElementById("loader");
  if (loader) loader.remove();
}

function showError(msg) {
  let banner = document.getElementById("error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "error-banner";
    banner.style.cssText =
      "background:#ffe5e5;color:#b00020;padding:12px;border-radius:8px;font-weight:600;margin-bottom:10px";
    document.querySelector(".dashboard-container").prepend(banner);
  }
  banner.innerText = msg;
}

function clearError() {
  const banner = document.getElementById("error-banner");
  if (banner) banner.remove();
}

/* ---------- INIT ---------- */

function init() {
  const today = getTodayDate();
  document.getElementById("datePicker").value = today;

  const todayDisplay = document.getElementById("todayDisplay");
  if (todayDisplay) {
    todayDisplay.value = today;
    todayDisplay.title = `Today is ${today}`;
  }

  loadData(today);
  startPolling(today);

  window.addEventListener("resize", () => {
    if (lastDataTable) drawChart(lastDataTable);
  });
}

/* ---------- DATE HANDLING ---------- */

function onDateSelect() {
  const selectedDate = document.getElementById("datePicker").value;
  if (!selectedDate) return;

  stopPolling();

  if (!isDateInRange(selectedDate)) {
    showError(`No data available for ${selectedDate}. Showing today's data.`);
    const today = getTodayDate();
    document.getElementById("datePicker").value = today;
    loadData(today);
    startPolling(today);
    return;
  }

  clearError();
  loadData(selectedDate);

  if (selectedDate === getTodayDate()) {
    startPolling(selectedDate);
  } else {
    setHistoricalStatus();
  }
}

/* ---------- DATA LOADING ---------- */

function loadData(dateValue) {
  clearError();
  showLoading();

  const sheetName = SHEET_PREFIX + dateValue;
  const query = new google.visualization.Query(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}`
  );

  query.setQuery(
    `SELECT A, B, F, J, N, V, Z, AA, AB WHERE A IS NOT NULL AND B IS NOT NULL`
  );

  query.send((response) => {
    hideLoading();

    if (response.isError()) {
      clearUI();
      showError(`No data available for ${dateValue}`);
      return;
    }

    const data = response.getDataTable();
    if (!data || data.getNumberOfRows() === 0) {
      clearUI();
      showError(`No data available for ${dateValue}`);
      return;
    }

    lastDataTable = data;

    drawChart(data);
    showLiveWatt(data);
    showTotalPower(data);
    updateInverterHealth(data);
    updateLatestMetricsTable(data);

    detectedEventSet.clear();
    detectPowerEvents(data);
    updateLastUpdatedTime();
  });
}

/* ---------- CHART ---------- */

function drawChart(data) {
  let cols = data.getNumberOfColumns();
  if (cols === 9) {
    data.addColumn({ type: "string", role: "annotation" });
    data.addColumn({ type: "string", role: "annotationText" });
  }

  const annotationCol = data.getNumberOfColumns() - 2;
  const annotationTextCol = data.getNumberOfColumns() - 1;

  let lastPower = null;
  const DROP_THRESHOLD = 15000;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const power = data.getValue(i, 1);
    if (lastPower && lastPower - power > DROP_THRESHOLD) {
      data.setValue(i, annotationCol, "⚠");
      data.setValue(i, annotationTextCol, "Sudden Power Drop");
    }
    lastPower = power;
  }

  const view = new google.visualization.DataView(data);
  view.setColumns([0, 1, annotationCol, annotationTextCol]);

  const chart = new google.visualization.LineChart(
    document.getElementById("chart_div")
  );

  chart.draw(view, {
    title: "SOLAR POWER GENERATION (Watts)",
    legend: "none",
    curveType: "function",
    lineWidth: 3,
    chartArea: { left: 80, top: 50, width: "85%", height: "75%" },
    hAxis: { title: "Time", format: "HH:mm" },
    vAxis: { title: "Generated Power (Watts)", viewWindow: { min: 0 } },

    // 🔴 THIS MAKES ⚠ RED & BIG
    annotations: {
      style: "point",
      alwaysOutside: true,
      textStyle: {
        color: "#dc2626",   // strong red
        fontSize: 18,
        bold: true,
      },
    },
  });
}


/* ---------- SUMMARY ---------- */

function showLiveWatt(data) {
  const last = data.getNumberOfRows() - 1;
  const watt = (data.getValue(last, 1) / 1000).toFixed(2);
  document.getElementById("live_watt").innerHTML =
    `⚡ Live Watt : <strong>${watt} kWh</strong>`;
}

function showTotalPower(data) {
  let total = 0;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    total += data.getValue(i, 1);
  }

  const totalKwh = total / 1000;
  document.getElementById("total_power").innerHTML =
    `☀️ Solar Energy Today : <strong>${totalKwh.toFixed(2)} kWh</strong>`;

  showCO2Saved(totalKwh);
}

function showCO2Saved(totalKwh) {
  const co2 = totalKwh * 0.82;
  document.getElementById("co2_saved").innerHTML =
    `🌱 CO₂ Saved : <strong>${co2.toFixed(0)} kg</strong>`;
}

function updateInverterHealth(data) {
  let last = null, maxDrop = 0;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const p = data.getValue(i, 1);
    if (last && p < last) {
      maxDrop = Math.max(maxDrop, ((last - p) / last) * 100);
    }
    last = p;
  }
  document.getElementById("inverter-health").innerHTML =
    `🟢 Inverter Health : <strong>${(100 - maxDrop).toFixed(1)}%</strong>`;
}

/* ---------- EVENTS ---------- */

function detectPowerEvents(data) {
  let last = null;
  const DROP_THRESHOLD = 15000;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const p = data.getValue(i, 1);
    const t = data.getValue(i, 0);
    if (last && last - p > DROP_THRESHOLD) {
      detectedEventSet.add(`${t} - Sudden Drop`);
    }
    last = p;
  }
  displayEvents();
}

function displayEvents() {
  const el = document.getElementById("events");
  el.innerHTML = "";
  if (!detectedEventSet.size) return;

  const ul = document.createElement("ul");
  detectedEventSet.forEach(e => {
    const li = document.createElement("li");
    li.textContent = e;
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

/* ---------- LIVE ---------- */

function startPolling(date) {
  stopPolling();
  setLiveStatus();
  pollingTimer = setInterval(() => loadData(date), POLLING_INTERVAL);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function setLiveStatus() {
  document.getElementById("status").innerHTML =
    `<span class="live-dot"></span><span>LIVE (auto-updating every 2 minutes)</span>`;
}

function setHistoricalStatus() {
  document.getElementById("status").innerHTML =
    `<span>📅 Historical Data</span>`;
}

/* ---------- UTIL ---------- */

function clearUI() {
  document.getElementById("chart_div").innerHTML = "";
  document.getElementById("events").innerHTML = "";
}

function updateLastUpdatedTime() {
  document.getElementById("last_updated").innerHTML =
    `Last updated at: <strong>${new Date().toLocaleTimeString()}</strong>`;
}

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

function isDateInRange(dateStr) {
  const d = new Date(dateStr);
  const min = new Date("2025-11-22");
  const max = new Date(getTodayDate());
  return d >= min && d <= max;
}

/* ---------- DOWNLOAD ---------- */

function downloadDashboardSection() {
  const area = document.getElementById("download-area");
  html2canvas(area, { scale: 2 }).then(canvas => {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `solar-dashboard-${document.getElementById("datePicker").value}.png`;
    link.click();
  });
}

/* ---------- METRICS ---------- */

function getLastNonNullInColumn(data, col) {
  for (let i = data.getNumberOfRows() - 1; i >= 0; i--) {
    const v = data.getValue(i, col);
    if (v !== null && v !== "") return v;
  }
  return "--";
}

function updateLatestMetricsTable(data) {
  const tbody = document.querySelector("#latestMetricsTable tbody");
  tbody.innerHTML = "";

  METRIC_COLUMNS.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.label}</td><td>${getLastNonNullInColumn(data, c.index)}</td>`;
    tbody.appendChild(tr);
  });
}
