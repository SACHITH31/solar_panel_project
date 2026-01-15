google.charts.load("current", { packages: ["corechart"] });

const SPREADSHEET_ID = "1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0";
const SHEET_PREFIX = "EEE Block-1 Solar Data_Slave_1_";
const POLLING_INTERVAL = 120000;

// NEW: Start Date Configuration
const START_DATE_STR = "2025-11-22"; 

let pollingTimer = null;
let lastDataTable = null;
const detectedEventSet = new Set();

const METRIC_COLUMNS = [
  { label: "Frequency", index: 6 },
  { label: "PF Avg (inst)", index: 2 },
  { label: "VA Total", index: 3 },
  { label: "VL N Average", index: 4 },
  { label: "Current Total", index: 5 },
  { label: "Wh", index: 7 },
];

google.charts.setOnLoadCallback(init);

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

  // Trigger the new feature (Lifetime Stats)
  // We use a small timeout so the main dashboard loads first
  setTimeout(() => {
    generateLifetimeGraph();
  }, 1500);

  window.addEventListener("resize", () => {
    if (lastDataTable) drawChart(lastDataTable);
  });

  document.getElementById("monthViewBtn").addEventListener("click", () => {
    populateMonthViewYears();
    document.getElementById("monthViewPopup").style.display = "flex";
  });

  document
    .getElementById("mvOkBtn")
    .addEventListener("click", handleMonthViewRequest);
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
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(
      sheetName
    )}`
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

/* ---------- CHART (FIXED ANNOTATIONS) ---------- */
function drawChart(data) {
  let view = new google.visualization.DataView(data);

  if (data.getNumberOfColumns() < 11) {
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
    } else {
      data.setValue(i, annotationCol, null);
      data.setValue(i, annotationTextCol, null);
    }
    lastPower = power;
  }

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
    annotations: {
      style: "point",
      alwaysOutside: true,
      textStyle: { color: "#dc2626", fontSize: 18, bold: true },
    },
  });
}

/* ---------- FAST MONTH VIEW (EXISTING) ---------- */
async function handleMonthViewRequest() {
  const loader = document.getElementById("monthLoader");
  const mainContainer = document.getElementById("monthlyBarChartContainer");
  const energyContainer = document.getElementById("monthlyEnergyChartContainer");
  const oopsMsg = document.getElementById("oopsMessage");

  if (oopsMsg) oopsMsg.style.display = "none";
  loader.style.display = "block";
  mainContainer.style.display = "none";
  if (energyContainer) energyContainer.style.display = "none";

  const month = parseInt(document.getElementById("mvMonth").value);
  const year = parseInt(document.getElementById("mvYear").value);
  const today = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const maxDay =
    today.getMonth() + 1 === month && today.getFullYear() === year
      ? today.getDate()
      : daysInMonth;

  const dayPromises = [];

  for (let d = 1; d <= maxDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(
      d
    ).padStart(2, "0")}`;
    dayPromises.push(fetchDailyEnergyStats(dateStr, d));
  }

  const results = (await Promise.all(dayPromises))
    .filter((r) => r !== null)
    .sort((a, b) => a.dayNum - b.dayNum);

  loader.style.display = "none";

  if (results.length === 0) {
    if (oopsMsg) oopsMsg.style.display = "block";
    return;
  }

  mainContainer.style.display = "block";
  if (energyContainer) energyContainer.style.display = "block";

  drawMonthlyMaxBarChart(results, month, year);
  drawMonthlyEnergyBarChart(results, month, year);
}

// =========================================================
// 🛑 UPDATED FUNCTION: Includes Bug Fix for "Random Data"
// =========================================================
function fetchDailyEnergyStats(dateStr, dayNum) {
  const sheetName = SHEET_PREFIX + dateStr;
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName
  )}`;

  return fetch(url)
    .then((res) => {
      if (!res.ok) return null;
      return res.text();
    })
    .then((text) => {
      // 1. Basic Validity Checks
      if (!text || text.trim() === "" || text.includes("<!DOCTYPE html>")) {
         return null;
      }

      const rows = text
        .split("\n")
        .filter((row) => row.trim() !== "")
        .slice(1); // Remove header

      if (rows.length < 2) return null;

      // 2. DATA VALIDATION (THE BUG FIX)
      // Check if the file content actually matches the requested date.
      // If Google returns the "Main Sheet" by mistake, the dates won't match.
      const firstRowCols = rows[0].split(",");
      const fileDateRaw = firstRowCols[0]?.replace(/["\r]/g, ""); // Column A is Timestamp
      
      const fileDate = new Date(fileDateRaw);
      const requestedDate = new Date(dateStr);

      // Compare Year, Month, and Date
      const isSameDay = 
          fileDate.getFullYear() === requestedDate.getFullYear() &&
          fileDate.getMonth() === requestedDate.getMonth() &&
          fileDate.getDate() === requestedDate.getDate();

      if (!isSameDay) {
          // This prevents the "Random Data" bug
          return null;
      }

      // 3. GRAPH 2 LOGIC: Energy (Wh) from Column AA
      // Get First Value (Start of Day) - LOOP FORWARD
      let firstWh = NaN;
      for (let i = 0; i < rows.length; i++) {
         const cols = rows[i].split(",");
         const rawVal = cols[26]?.replace(/["\r]/g, "").trim(); // Col AA is Index 26
         
         if (rawVal && rawVal !== "") {
             const val = parseFloat(rawVal);
             if (!isNaN(val)) {
                 firstWh = val;
                 break; 
             }
         }
      }

      // Get Last Value (End of Day) - LOOP BACKWARD
      let lastWh = NaN;
      for (let i = rows.length - 1; i >= 0; i--) {
        const cols = rows[i].split(",");
        const rawVal = cols[26]?.replace(/["\r]/g, "").trim();
        
        if (rawVal && rawVal !== "") {
            const val = parseFloat(rawVal);
            if (!isNaN(val)) {
                lastWh = val;
                break; 
            }
        }
      }

      // Calculate Energy
      let energyCalcKwh = 0;
      if (!isNaN(firstWh) && !isNaN(lastWh)) {
        energyCalcKwh = (lastWh - firstWh) / 1000;
        // console.log(`📝 [${dateStr}] Verified Data. Result: ${energyCalcKwh.toFixed(4)} kWh`);
      } else {
        return null;
      }

      // 4. GRAPH 1 LOGIC: Max Power (Watts) from Column B
      let dailyMaxPower = 0;
      rows.forEach((row) => {
        const cols = row.split(",");
        const p = parseFloat(cols[1]?.replace(/["\r]/g, ""));
        if (!isNaN(p) && p > dailyMaxPower) dailyMaxPower = p;
      });

      const dDate = new Date(dateStr);
      const label = `${dDate.getDate()} ${dDate.toLocaleString("en", { month: "short" })}`;

      return {
        label: label,
        value: dailyMaxPower,
        energyKwh: energyCalcKwh,
        dayNum: dayNum || dDate.getDate(),
      };
    })
    .catch((err) => null);
}

function drawMonthlyEnergyBarChart(dataArr, month, year) {
  const chartDiv = document.getElementById("monthlyEnergyChart");
  const dt = new google.visualization.DataTable();
  dt.addColumn("string", "Date");
  dt.addColumn("number", "Total Energy (Units / kWh)");

  dt.addRows(dataArr.map((item) => [item.label, item.energyKwh]));

  const options = {
    title: `Daily Total Energy Generated (Units / kWh) - ${month}/${year}`,
    legend: "none",
    height: 450,
    colors: ["#10b981"],
    chartArea: { left: "12%", right: "8%", top: "15%", bottom: "25%", width: "80%" },
    hAxis: { title: "Date", slantedText: true, slantedTextAngle: 45, showTextEvery: 1 },
    vAxis: { title: "Units / kWh", minValue: 0, format: "#.##", viewWindow: { min: 0 } },
    bar: { groupWidth: "75%" },
  };

  new google.visualization.ColumnChart(chartDiv).draw(dt, options);
}

function drawMonthlyMaxBarChart(dataArr, month, year) {
  const container = document.getElementById("monthlyBarChartContainer");
  const chartDiv = document.getElementById("monthlyBarChart");
  const oopsMsg = document.getElementById("oopsMessage");

  if (!dataArr || dataArr.length === 0) {
    if (oopsMsg) oopsMsg.style.display = "block";
    container.style.display = "none";
    return;
  }

  oopsMsg.style.display = "none";
  container.style.display = "block";

  const dt = new google.visualization.DataTable();
  dt.addColumn("string", "Date");
  dt.addColumn("number", "Peak Watts");
  const rows = dataArr.map((item) => [item.label, item.value]);
  dt.addRows(rows);

  const options = {
    title: `Daily Peak Power Generation - ${month}/${year}`,
    legend: "none",
    height: 500,
    chartArea: { left: "10%", right: "10%", top: "15%", bottom: "20%", width: "80%", height: "65%" },
    hAxis: { title: "Date", slantedText: true, slantedTextAngle: 45, textStyle: { fontSize: 11 } },
    vAxis: { title: "Watts", minValue: 0, gridlines: { count: 6 }, format: "short" },
    bar: { groupWidth: "75%" },
    colors: ["#1a73e8"],
  };

  const chart = new google.visualization.ColumnChart(chartDiv);
  chart.draw(dt, options);
}

function populateMonthViewYears() {
  const yearSelect = document.getElementById("mvYear");
  yearSelect.innerHTML = "";
  for (let y = 2025; y <= new Date().getFullYear(); y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
  }
}

/* ---------- NEW FEATURE: LIFETIME MONTHLY DATA ---------- */

async function generateLifetimeGraph() {
  const loader = document.getElementById('lifetimeLoader');
  const statusText = document.getElementById('lifetimeStatusText');
  const chartDiv = document.getElementById('lifetimeChartDiv');

  loader.style.display = 'block';
  chartDiv.style.display = 'none';

  const startDate = new Date(START_DATE_STR);
  const today = new Date();
  
  // We need to loop from Start Date Month to Current Month
  let currentIterDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const monthList = [];

  while (currentIterDate <= today) {
    monthList.push({
      month: currentIterDate.getMonth() + 1,
      year: currentIterDate.getFullYear()
    });
    // Move to next month
    currentIterDate.setMonth(currentIterDate.getMonth() + 1);
  }

  const monthlyTotals = [];

  // Process each month sequentially
  for (const mData of monthList) {
    statusText.innerText = `Calculating data for ${mData.month}/${mData.year}...`;
    
    // Calculate start and end day for this specific month
    let startDay = 1;
    if (mData.month === (startDate.getMonth() + 1) && mData.year === startDate.getFullYear()) {
      startDay = startDate.getDate();
    }

    let endDay = new Date(mData.year, mData.month, 0).getDate();
    if (mData.month === (today.getMonth() + 1) && mData.year === today.getFullYear()) {
      endDay = today.getDate();
    }

    const dayPromises = [];
    for (let d = startDay; d <= endDay; d++) {
        const dateStr = `${mData.year}-${String(mData.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        dayPromises.push(fetchDailyEnergyStats(dateStr, d));
    }

    const dayResults = await Promise.all(dayPromises);
    
    let monthSum = 0;
    dayResults.forEach(res => {
        if(res && res.energyKwh) {
            monthSum += res.energyKwh;
        }
    });
    
    // --- DEBUG CONSOLE LOG FOR USER CONFIRMATION ---
    const monthName = new Date(mData.year, mData.month - 1).toLocaleString('default', { month: 'long' });
    // console.log(`✅ >>> TOTAL FOR ${monthName} ${mData.year}: ${monthSum.toFixed(4)} kWh <<<`);
    // console.log("---------------------------------------------------------------");
    // -----------------------------------------------

    monthlyTotals.push({
        label: `${monthName.substring(0,3)} ${mData.year}`,
        value: monthSum
    });
  }

  // All Done
  loader.style.display = 'none';
  chartDiv.style.display = 'block';
  drawLifetimeChart(monthlyTotals);
}

function drawLifetimeChart(dataArr) {
    const chartDiv = document.getElementById('lifetimeChartDiv');
    const dt = new google.visualization.DataTable();
    dt.addColumn('string', 'Month');
    dt.addColumn('number', 'Total Generated (kWh)');
    dt.addColumn({ type: 'number', role: 'annotation' }); 

    const rows = dataArr.map(item => [
        item.label, 
        item.value, 
        parseFloat(item.value.toFixed(1)) 
    ]);
    
    dt.addRows(rows);

    const options = {
        title: 'Total Energy Generated per Month (Cumulative)',
        legend: { position: 'none' },
        colors: ['#ea7f1b'],
        bar: { groupWidth: '60%' },
        vAxis: { 
            title: 'Energy (kWh)',
            minValue: 0
        },
        hAxis: {
            title: 'Month'
        },
        chartArea: { width: '85%', height: '70%' },
        animation: {
          startup: true,
          duration: 1000,
          easing: 'out',
        }
    };

    const chart = new google.visualization.ColumnChart(chartDiv);
    chart.draw(dt, options);
}

/* ---------- SUMMARY & METRICS (EXISTING) ---------- */
function showLiveWatt(data) {
  const last = data.getNumberOfRows() - 1;
  const watt = (data.getValue(last, 1) / 1000).toFixed(2);
  document.getElementById(
    "live_watt"
  ).innerHTML = `⚡ Live Watt : <strong>${watt} kWh</strong>`;
}

function showTotalPower(data) {
  let total = 0;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    total += data.getValue(i, 1);
  }
  const totalKwh = total / 1000;
  document.getElementById(
    "total_power"
  ).innerHTML = `☀️ Solar Energy Today : <strong>${totalKwh.toFixed(
    2
  )} kWh</strong>`;
  showCO2Saved(totalKwh);
}

function showCO2Saved(totalKwh) {
  document.getElementById("co2_saved").innerHTML = `🌱 CO₂ Saved : <strong>${(
    totalKwh * 0.82
  ).toFixed(0)} kg</strong>`;
}

function updateInverterHealth(data) {
  const healthEl = document.getElementById("inverter-health");
  const rowCount = data.getNumberOfRows();
  if (rowCount < 2) {
    healthEl.innerHTML = `🟢 Inverter Health : <strong>100%</strong>`;
    return;
  }

  const currentPower = data.getValue(rowCount - 1, 1);
  const previousPower = data.getValue(rowCount - 2, 1);

  if (currentPower < previousPower && previousPower > 0) {
    const dropPercentage =
      ((previousPower - currentPower) / previousPower) * 100;
    const healthScore = (100 - dropPercentage).toFixed(1);
    const color = healthScore < 50 ? "#dc2626" : "#f59e0b";
    healthEl.innerHTML = `🟡 Health : <strong style="color:${color}">${healthScore}%</strong> <small>(-${dropPercentage.toFixed(
      1
    )}%)</small>`;
  } else {
    healthEl.innerHTML = `🟢 Inverter Health : <strong>100%</strong>`;
  }
}

function updateLatestMetricsTable(data) {
  const tbody = document.querySelector("#latestMetricsTable tbody");
  tbody.innerHTML = "";
  METRIC_COLUMNS.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.label}</td><td>${getLastNonNullInColumn(
      data,
      c.index
    )}</td>`;
    tbody.appendChild(tr);
  });
}

function getLastNonNullInColumn(data, col) {
  for (let i = data.getNumberOfRows() - 1; i >= 0; i--) {
    const v = data.getValue(i, col);
    if (v !== null && v !== "") return v;
  }
  return "--";
}

/* ---------- UI HELPERS ---------- */
function showLoading() {
  if (!document.getElementById("loader")) {
    const loader = document.createElement("div");
    loader.id = "loader";
    loader.style.textAlign = "center";
    document.querySelector(".chart-card").prepend(loader);
  }
}

function hideLoading() {
  const l = document.getElementById("loader");
  if (l) l.remove();
}

function showError(msg) {
  let banner =
    document.getElementById("error-banner") || document.createElement("div");
  banner.id = "error-banner";
  banner.style.cssText =
    "background:#ffe5e5;color:#b00020;padding:12px;border-radius:8px;font-weight:600;margin-bottom:10px";
  banner.innerText = msg;
  if (!document.getElementById("error-banner"))
    document.querySelector(".dashboard-container").prepend(banner);
}

function clearError() {
  const b = document.getElementById("error-banner");
  if (b) b.remove();
}

function clearUI() {
  document.getElementById("chart_div").innerHTML = "";
  document.getElementById("events").innerHTML = "";
}

/* ---------- LIVE POLLING ---------- */
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
  const el = document.getElementById("status");
  if (el)
    el.innerHTML = `<span class="live-dot"></span><span>LIVE (auto-updating every 2 minutes)</span>`;
}

function setHistoricalStatus() {
  const el = document.getElementById("status");
  if (el) el.innerHTML = `<span>📅 Historical Data</span>`;
}

function updateLastUpdatedTime() {
  const el = document.getElementById("last_updated");
  if (el)
    el.innerHTML = `Last updated at: <strong>${new Date().toLocaleTimeString()}</strong>`;
}

/* ---------- EVENT DETECTION ---------- */
function detectPowerEvents(data) {
  let last = null;
  const DROP_THRESHOLD = 15000;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const p = data.getValue(i, 1);
    if (last && last - p > DROP_THRESHOLD)
      detectedEventSet.add(`${data.getValue(i, 0)} - Sudden Drop`);
    last = p;
  }
  displayEvents();
}

function displayEvents() {
  const eventsSection = document.getElementById("events");
  const messageContainer = document.getElementById("event-message");
  messageContainer.innerHTML = "";

  if (!detectedEventSet || detectedEventSet.size === 0) {
    eventsSection.style.backgroundColor = "#ecfdf5";
    eventsSection.style.border = "1px solid #10b981";
    messageContainer.innerHTML = `<div style="color: #065f46; font-weight: 500; text-align: center; padding: 10px;">✅ No error detections occurred for this day.</div>`;
  } else {
    eventsSection.style.backgroundColor = "#fef2f2";
    eventsSection.style.border = "1px solid #ef4444";
    const title = document.createElement("h4");
    title.style.color = "#b91c1c";
    title.innerText = "System Alerts Detected:";
    messageContainer.appendChild(title);
    const ul = document.createElement("ul");
    detectedEventSet.forEach((event) => {
      const li = document.createElement("li");
      li.style.color = "#b91c1c";
      li.innerText = event;
      ul.appendChild(li);
    });
    messageContainer.appendChild(ul);
  }
}

function closeMonthPopup() {
  document.getElementById("monthViewPopup").style.display = "none";
}

/* REPLACE THIS FUNCTION IN script.js */

async function downloadDashboardSection() {
  const btn = document.getElementById("downloadBtn");
  const btnText = document.getElementById("btnText");
  const mainArea = document.getElementById("download-area");
  const eventsArea = document.getElementById("events");
  const monthlyContainer = document.getElementById("monthlyBarChartContainer");
  const lifetimeChart = document.getElementById("lifetimeChartDiv");
  const mvMonth = document.getElementById("mvMonth");
  const mvYear = document.getElementById("mvYear");
  const dateValue = document.getElementById("datePicker").value;

  btn.disabled = true;
  btnText.innerHTML = `<span class="spinner"></span> Capturing Report...`;

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth(); // ~210mm
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const maxLineWidth = pageWidth - margin * 2;

    const isMonthlyActive = monthlyContainer && monthlyContainer.style.display !== "none";

    // --- PAGE 1: DAILY DASHBOARD ---
    if (!isMonthlyActive) {
      const eventsClone = eventsArea.cloneNode(true);
      eventsClone.style.marginTop = "20px";
      mainArea.appendChild(eventsClone);
      const canvas = await html2canvas(mainArea, { scale: 2, useCORS: true });
      mainArea.removeChild(eventsClone);
      addPdfHeader(pdf, dateValue, margin);
      const imgHeight = (maxLineWidth * canvas.height) / canvas.width;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", margin, 30, maxLineWidth, imgHeight);
    } else {
      // --- PAGE 1 (Monthly View Active) ---
      const canvasMain = await html2canvas(mainArea, { scale: 2, useCORS: true });
      addPdfHeader(pdf, dateValue, margin);
      const mainHeight = (maxLineWidth * canvasMain.height) / canvasMain.width;
      pdf.addImage(canvasMain.toDataURL("image/jpeg", 0.85), "JPEG", margin, 30, maxLineWidth, mainHeight);

      // =========================================================
      // PAGE 2: FIX - FORCE CENTER & BIG SIZE (PHONE FRIENDLY)
      // =========================================================
      
      const tempDiv = document.createElement("div");
      
      // 1. Force a huge desktop-size container (1200px)
      // 2. Use Flexbox to align everything to the Center
      tempDiv.style.cssText = `
        position: fixed; 
        left: -9999px; 
        top: 0;
        width: 1200px !important;
        background: #ffffff; 
        padding: 40px; 
        display: flex;
        flex-direction: column;
        align-items: center;  /* <--- KEY: Center Horizontally */
        justify-content: flex-start;
      `;
      document.body.appendChild(tempDiv);

      // --- Header ---
      const heading = document.createElement("div");
      heading.style.cssText = "font-size:36px; font-weight:bold; color:#1a73e8; margin-bottom:10px; text-transform:uppercase; text-align:center; width:100%;";
      heading.innerText = `${mvMonth.options[mvMonth.selectedIndex].text} ${mvYear.value} MONTHLY REPORT`;
      tempDiv.appendChild(heading);

      const subHeading = document.createElement("div");
      subHeading.style.cssText = "font-size:18px; font-style:italic; color:#666; margin-bottom:30px; text-align:center; width:100%;";
      subHeading.innerText = "Detailed daily breakdown of Power and Energy";
      tempDiv.appendChild(subHeading);

      // --- 1. Peak Power Chart ---
      const powerLabel = document.createElement("h3");
      powerLabel.innerText = "1. Daily Peak Power Generation (Watts)";
      powerLabel.style.cssText = "width:100%; text-align:left; font-size:24px; color:#333; margin-top:20px; font-weight:bold;";
      tempDiv.appendChild(powerLabel);
      
      const chart1Clone = document.getElementById("monthlyBarChart").cloneNode(true);
      
      // CRITICAL FIX: Force the DIV to be 1000px and Center it with margin auto
      chart1Clone.style.cssText = "width: 1000px !important; display: flex; flex-direction: column; align-items: center;";
      
      // CRITICAL FIX: Force the internal CANVAS to stretch
      const canvas1 = chart1Clone.querySelector('canvas');
      if(canvas1) {
          canvas1.style.cssText = "width: 100% !important; height: auto !important;";
      }
      tempDiv.appendChild(chart1Clone);

      // --- 2. Energy Units Chart ---
      const energyLabel = document.createElement("h3");
      energyLabel.innerText = "2. Daily Total Energy (Units / kWh)";
      energyLabel.style.cssText = "width:100%; text-align:left; font-size:24px; color:#333; margin-top:40px; font-weight:bold;";
      tempDiv.appendChild(energyLabel);
      
      const chart2Clone = document.getElementById("monthlyEnergyChart").cloneNode(true);
      
      // CRITICAL FIX: Force Width & Center
      chart2Clone.style.cssText = "width: 1000px !important;  display: flex; flex-direction: column; align-items: center;";
      
      const canvas2 = chart2Clone.querySelector('canvas');
      if(canvas2) {
          canvas2.style.cssText = "width: 100% !important; height: auto !important;";
      }
      tempDiv.appendChild(chart2Clone);

      const infoNote = document.createElement("div");
      infoNote.style.cssText = "margin-top:10px; font-style:italic; color:#666; font-size:16px; width:100%; text-align:center;";
      infoNote.innerText = "Note: Energy Units calculated as (Last Value - First Value) / 1000";
      tempDiv.appendChild(infoNote);

      // --- 3. System Alerts ---
      const alertsLabel = document.createElement("h3");
      alertsLabel.innerText = "3. System Performance Alerts";
      alertsLabel.style.cssText = "width:100%; text-align:center; font-size:24px; color:#333; margin-top:40px; font-weight:bold;";
      tempDiv.appendChild(alertsLabel);
      
      const eventsClone = eventsArea.cloneNode(true);
      eventsClone.style.cssText = "width:90%; margin: 0 auto; font-size:16px; border:1px solid #eee; padding:20px;";
      tempDiv.appendChild(eventsClone);

      // Wait for rendering
      await new Promise((r) => setTimeout(r, 800)); 
      
      const canvasMonthly = await html2canvas(tempDiv, { scale: 2, useCORS: true });
      const monthlyHeight = (maxLineWidth * canvasMonthly.height) / canvasMonthly.width;

      pdf.addPage();
      // Ensure it fits the page
      const finalHeight = monthlyHeight > (pageHeight - 20) ? (pageHeight - 20) : monthlyHeight;
      pdf.addImage(canvasMonthly.toDataURL("image/jpeg", 0.90), "JPEG", margin, 15, maxLineWidth, finalHeight);

      document.body.removeChild(tempDiv);
    }

    // --- PAGE 3: LIFETIME STATISTICS ---
    if (lifetimeChart && lifetimeChart.style.display !== "none") {
        pdf.addPage();
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.setTextColor(139, 92, 246);
        pdf.text("LIFETIME ENERGY GENERATION HISTORY", pageWidth / 2, 20, { align: "center" });
        
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "italic");
        pdf.setTextColor(100);
        pdf.text("Cumulative monthly energy totals since installation (Nov 2025)", pageWidth / 2, 27, { align: "center" });

        const canvasLife = await html2canvas(lifetimeChart, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
        const lifeImgHeight = (maxLineWidth * canvasLife.height) / canvasLife.width;
        
        pdf.addImage(canvasLife.toDataURL("image/jpeg", 0.90), "JPEG", margin, 35, maxLineWidth, lifeImgHeight);
    }

    // --- PAGE NUMBERS ---
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(10);
      pdf.setTextColor(150);
      pdf.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: "center" });
    }

    pdf.save(`Solar_Report_${dateValue}.pdf`);
  } catch (error) {
    console.error(error);
    alert("PDF Error. Check console.");
  } finally {
    btn.disabled = false;
    btnText.innerText = "📝Download PDF";
  }
}

// Helper to keep header code clean
function addPdfHeader(pdf, dateValue, margin) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(26, 115, 232);
  pdf.text("SOLAR PERFORMANCE & ERROR REPORT", margin, 15);
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  pdf.text(`Generated On: ${new Date().toLocaleString()}`, margin, 22);
  pdf.text(`Reported Date: ${dateValue}`, margin, 27);
}

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}
function isDateInRange(dStr) {
  const d = new Date(dStr);
  return d >= new Date("2025-11-22") && d <= new Date(getTodayDate());
}