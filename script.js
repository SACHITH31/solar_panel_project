google.charts.load("current", { packages: ["corechart"] });

const SPREADSHEET_ID = "1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0";
const SHEET_PREFIX = "EEE Block-1 Solar Data_Slave_1_";
const POLLING_INTERVAL = 120000;

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
  { label: "VAh", index: 8 },
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

  window.addEventListener("resize", () => {
    if (lastDataTable) drawChart(lastDataTable);
  });

  document.getElementById("monthViewBtn").addEventListener("click", () => {
    populateMonthViewYears();
    document.getElementById("monthViewPopup").style.display = "flex";
  });

  document.getElementById("mvOkBtn").addEventListener("click", async () => {
    const loader = document.getElementById("monthLoader");
    const chartContainer = document.getElementById("monthlyBarChartContainer");
    const chartDiv = document.getElementById("monthlyBarChart");

    loader.style.display = "block";
    chartContainer.style.display = "none";
    chartDiv.innerHTML = ""; 

    const month = parseInt(document.getElementById("mvMonth").value);
    const year = parseInt(document.getElementById("mvYear").value);

    const data = await fetchMonthlyMaxWatts(month, year);

    loader.style.display = "none";

    if (!data || data.length === 0) {
      alert(`No solar data recorded for ${document.getElementById("mvMonth").options[month-1].text} ${year}.`);
      return;
    }

    drawMonthlyMaxBarChart(data, month, year);
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
  query.setQuery(`SELECT A, B, F, J, N, V, Z, AA, AB WHERE A IS NOT NULL AND B IS NOT NULL`);
  
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

  const chart = new google.visualization.LineChart(document.getElementById("chart_div"));

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

/* ---------- MONTH VIEW LOGIC (BUG FIXED) ---------- */
async function fetchMonthlyMaxWatts(month, year) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;
  const maxDay = isCurrentMonth ? today.getDate() : new Date(year, month, 0).getDate();

  const requests = [];

  for (let d = 1; d <= maxDay; d++) {
    const dayStr = String(d).padStart(2, "0");
    const monthStr = String(month).padStart(2, "0");
    const dateStr = `${year}-${monthStr}-${dayStr}`;
    const sheetName = SHEET_PREFIX + dateStr;

    requests.push(
      new Promise((resolve) => {
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}`;
        const query = new google.visualization.Query(queryUrl);
        query.setQuery("SELECT B WHERE B IS NOT NULL");
        
        query.send((res) => {
          if (res.isError()) return resolve(null); // Skips if sheet doesn't exist

          const dataTable = res.getDataTable();
          if (!dataTable || dataTable.getNumberOfRows() === 0) return resolve(null);

          let dailyMax = 0;
          let hasValues = false;

          for (let i = 0; i < dataTable.getNumberOfRows(); i++) {
            const val = dataTable.getValue(i, 0);
            if (typeof val === "number" && val > 0) {
              if (val > dailyMax) dailyMax = val;
              hasValues = true;
            }
          }

          if (hasValues && dailyMax > 0) {
            resolve({
              label: `${d} ${new Date(year, month - 1, d).toLocaleString("en", { month: "short" })}`,
              value: dailyMax
            });
          } else {
            resolve(null);
          }
        });
      })
    );
  }

  const resolved = await Promise.all(requests);
  return resolved.filter(day => day !== null); // STOPS FLAT BARS BUG
}

function drawMonthlyMaxBarChart(dataArr, month, year) {
  const container = document.getElementById("monthlyBarChartContainer");
  container.style.display = "block";

  const dt = new google.visualization.DataTable();
  dt.addColumn("string", "Date");
  dt.addColumn("number", "Max Watts");

  dt.addRows(dataArr.map(d => [d.label, d.value]));

  const options = {
    title: `Daily Peak Power Generation - ${month}/${year}`,
    legend: "none",
    height: 450,
    chartArea: { left: 80, right: 30, top: 60, bottom: 80 },
    hAxis: { title: "Date", slantedText: true, slantedTextAngle: 45 },
    vAxis: { title: "Watts", minValue: 0, gridlines: { count: 6 } },
    bar: { groupWidth: "70%" },
    colors: ['#1a73e8']
  };

  const chart = new google.visualization.ColumnChart(document.getElementById("monthlyBarChart"));
  chart.draw(dt, options);
}

function populateMonthViewYears() {
  const yearSelect = document.getElementById("mvYear");
  yearSelect.innerHTML = "";
  const startYear = 2025;
  const endYear = new Date().getFullYear();
  for (let y = startYear; y <= endYear; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
  }
}

/* ---------- SUMMARY & METRICS ---------- */
function showLiveWatt(data) {
  const last = data.getNumberOfRows() - 1;
  const watt = (data.getValue(last, 1) / 1000).toFixed(2);
  document.getElementById("live_watt").innerHTML = `⚡ Live Watt : <strong>${watt} kWh</strong>`;
}

function showTotalPower(data) {
  let total = 0;
  for (let i = 0; i < data.getNumberOfRows(); i++) { total += data.getValue(i, 1); }
  const totalKwh = total / 1000;
  document.getElementById("total_power").innerHTML = `☀️ Solar Energy Today : <strong>${totalKwh.toFixed(2)} kWh</strong>`;
  showCO2Saved(totalKwh);
}

function showCO2Saved(totalKwh) {
  const co2 = totalKwh * 0.82;
  document.getElementById("co2_saved").innerHTML = `🌱 CO₂ Saved : <strong>${co2.toFixed(0)} kg</strong>`;
}

function updateInverterHealth(data) {
  const healthEl = document.getElementById("inverter-health");
  const rowCount = data.getNumberOfRows();
  
  // If there's only one row, we can't compare yet
  if (rowCount < 2) {
    healthEl.innerHTML = `🟢 Inverter Health : <strong>100%</strong>`;
    return;
  }

  // Get the two most recent power readings (Column 1 is Watts)
  const currentPower = data.getValue(rowCount - 1, 1);
  const previousPower = data.getValue(rowCount - 2, 1);

  // Logic: Only calculate health if there is a drop
  if (currentPower < previousPower && previousPower > 0) {
    // Calculate how much it dropped as a percentage
    const dropAmount = previousPower - currentPower;
    const dropPercentage = (dropAmount / previousPower) * 100;
    const healthScore = (100 - dropPercentage).toFixed(1);

    // If the drop is huge (e.g., more than 50%), let's make it Red
    const color = healthScore < 50 ? "#dc2626" : "#f59e0b"; // Red or Orange
    const statusDot = healthScore < 50 ? "🔴" : "🟡";

    healthEl.innerHTML = `${statusDot} Inverter Health : <strong style="color:${color}">${healthScore}%</strong> <small>(Drop: -${dropPercentage.toFixed(1)}%)</small>`;
  } else {
    // If power is steady or increasing, health is perfect
    healthEl.innerHTML = `🟢 Inverter Health : <strong>100%</strong>`;
  }
}

function updateLatestMetricsTable(data) {
  const tbody = document.querySelector("#latestMetricsTable tbody");
  tbody.innerHTML = "";
  METRIC_COLUMNS.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.label}</td><td>${getLastNonNullInColumn(data, c.index)}</td>`;
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
  let loader = document.getElementById("loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "loader";
    loader.style.textAlign = "center";
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
    banner.style.cssText = "background:#ffe5e5;color:#b00020;padding:12px;border-radius:8px;font-weight:600;margin-bottom:10px";
    document.querySelector(".dashboard-container").prepend(banner);
  }
  banner.innerText = msg;
}

function clearError() {
  const banner = document.getElementById("error-banner");
  if (banner) banner.remove();
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
  const statusEl = document.getElementById("status");
  if(statusEl) statusEl.innerHTML = `<span class="live-dot"></span><span>LIVE (auto-updating every 2 minutes)</span>`;
}

function setHistoricalStatus() {
  const statusEl = document.getElementById("status");
  if(statusEl) statusEl.innerHTML = `<span>📅 Historical Data</span>`;
}

function updateLastUpdatedTime() {
  const lastUpdEl = document.getElementById("last_updated");
  if(lastUpdEl) lastUpdEl.innerHTML = `Last updated at: <strong>${new Date().toLocaleTimeString()}</strong>`;
}

/* ---------- EVENT DETECTION ---------- */
function detectPowerEvents(data) {
  let last = null;
  const DROP_THRESHOLD = 15000;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const p = data.getValue(i, 1);
    const t = data.getValue(i, 0);
    if (last && last - p > DROP_THRESHOLD) detectedEventSet.add(`${t} - Sudden Drop`);
    last = p;
  }
  displayEvents();
}

/* ---------- POPUP CONTROL ---------- */
/* ---------- POPUP CONTROL ---------- */
// function displayEvents() {
//     const el = document.getElementById("events");
//     el.innerHTML = ""; // Clear current messages

//     if (detectedEventSet.size === 0) {
//         // meaningful message if no errors occurred
//         el.innerHTML = `
//             <div style="text-align: center; padding: 20px; color: #059669; background: #ecfdf5; border-radius: 8px; border: 1px solid #10b981;">
//                 <i class="fas fa-check-circle"></i> No error detections or sudden power drops occurred for this day.
//             </div>`;
//     } else {
//         // Display actual errors found in detectedEventSet
//         const ul = document.createElement("ul");
//         ul.className = "event-list";
//         detectedEventSet.forEach((e) => {
//             const li = document.createElement("li");
//             li.style.color = "#b91c1c";
//             li.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${e}`;
//             ul.appendChild(li);
//         });
//         el.appendChild(ul);
//     }
// }

function displayEvents() {
    const eventsSection = document.getElementById("events");
    const messageContainer = document.getElementById("event-message");
    
    // Clear the container first
    messageContainer.innerHTML = "";

    // 1. CHECK IF THERE ARE NO ERRORS
    if (!detectedEventSet || detectedEventSet.size === 0) {
        // Change the WHOLE section to green and remove red borders
        eventsSection.style.backgroundColor = "#ecfdf5"; // Success light green
        eventsSection.style.border = "1px solid #10b981"; // Strong green border
        eventsSection.style.boxShadow = "none";
        
        messageContainer.innerHTML = `
            <div style="color: #065f46; font-weight: 500; text-align: center; padding: 10px;">
                <i class="fas fa-check-circle"></i> No error detections or sudden power drops occurred for this day.
            </div>`;
    } 
    // 2. IF ERRORS EXIST
    else {
        // Change the WHOLE section to red
        eventsSection.style.backgroundColor = "#fef2f2"; // Error light red
        eventsSection.style.border = "1px solid #ef4444"; // Strong red border
        
        const title = document.createElement("h4");
        title.style.color = "#b91c1c";
        title.style.marginBottom = "10px";
        title.innerText = "System Alerts Detected:";
        messageContainer.appendChild(title);

        const ul = document.createElement("ul");
        ul.style.margin = "0";
        ul.style.paddingLeft = "20px";
        detectedEventSet.forEach(event => {
            const li = document.createElement("li");
            li.style.color = "#b91c1c";
            li.style.marginBottom = "5px";
            li.innerText = event;
            ul.appendChild(li);
        });
        messageContainer.appendChild(ul);
    }
}

// In your close function
function closeMonthPopup() {
    document.getElementById("monthViewPopup").style.display = "none";
}

/* ---------- RESET ON DATE CHANGE ---------- */
// Add this inside your onDateSelect() or loadData() function 
// to ensure errors don't "carry over" to the next day
function clearPreviousEvents() {
    detectedEventSet.clear();
    document.getElementById("events").innerHTML = "";
}

/* ---------- DOWNLOAD DASHBOARD AS PDF (OPTIMIZED) ---------- */
async function downloadDashboardSection() {
    const btn = document.getElementById("downloadBtn");
    const btnText = document.getElementById("btnText");
    const mainArea = document.getElementById("download-area");
    const eventsArea = document.getElementById("events"); // The missing section
    const dateValue = document.getElementById("datePicker").value;
    
    btn.disabled = true;
    btnText.innerHTML = `<span class="spinner"></span> Capturing Full Report...`;

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF("p", "mm", "a4");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const margin = 10;
        const maxLineWidth = pageWidth - (margin * 2);

        // 1. CAPTURE MAIN DASHBOARD
        const canvasMain = await html2canvas(mainArea, { scale: 2, useCORS: true });
        const imgMain = canvasMain.toDataURL("image/jpeg", 0.85);
        const mainHeight = (maxLineWidth * canvasMain.height) / canvasMain.width;

        // 2. CAPTURE EVENTS SECTION (The missing part)
        const canvasEvents = await html2canvas(eventsArea, { scale: 2, useCORS: true });
        const imgEvents = canvasEvents.toDataURL("image/jpeg", 0.85);
        const eventsHeight = (maxLineWidth * canvasEvents.height) / canvasEvents.width;

        // 3. ADD HEADER
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.setTextColor(26, 115, 232);
        pdf.text("SOLAR PERFORMANCE & ERROR REPORT", margin, 15);
        pdf.setFontSize(9);
        pdf.setTextColor(100);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, 21);
        pdf.text(`Reported Date: ${dateValue}`, margin, 26);

        // 4. ADD MAIN DASHBOARD
        pdf.addImage(imgMain, 'JPEG', margin, 28, maxLineWidth, mainHeight);

        // 5. ADD EVENTS SECTION BELOW
        // Position it right after the main dashboard
        const eventsYPosition = 28 + mainHeight + 5; 
        
        // If it's too long for the first page, we add a new page
        if (eventsYPosition + eventsHeight > 280) { 
            pdf.addPage();
            pdf.text("System Events & Errors (Continued)", margin, 15);
            pdf.addImage(imgEvents, 'JPEG', margin, 25, maxLineWidth, eventsHeight);
        } else {
            pdf.addImage(imgEvents, 'JPEG', margin, eventsYPosition, maxLineWidth, eventsHeight);
        }

        pdf.save(`Solar_Full_Report_${dateValue}.pdf`);

    } catch (error) {
        console.error("PDF Error:", error);
        alert("Download failed. Check console for details.");
    } finally {
        btn.disabled = false;
        btnText.innerText = "📝Download PDF";
    }
}
function getTodayDate() { return new Date().toISOString().split("T")[0]; }

function isDateInRange(dateStr) {
  const d = new Date(dateStr);
  const min = new Date("2025-11-22");
  const max = new Date(getTodayDate());
  return d >= min && d <= max;
}

/**
 * Updates the events section based on detected data.
 * @param {Set|Array} detectedEvents - The set of detected error strings.
 */
function updateEventsDisplay(detectedEvents) {
    const eventContainer = document.getElementById("events");
    const messageDiv = document.getElementById("event-message");

    // 1. If there are no errors, show the "All Clear" message
    if (!detectedEvents || detectedEvents.size === 0) {
        eventContainer.style.backgroundColor = "#f0fdf4"; // Success Green
        eventContainer.style.border = "1px solid #bbf7d0";
        messageDiv.innerHTML = `
            <div style="color: #166534; font-weight: 500; text-align: center;">
                ✅ No error detections or sudden power drops occurred for this day.
            </div>`;
    } 
    // 2. If errors exist, show them in the red alert style
    else {
        eventContainer.style.backgroundColor = "#fef2f2"; // Error Red
        eventContainer.style.border = "1px solid #fee2e2";
        
        let errorList = `<h4 style="color: #991b1b; margin-bottom: 8px;">System Events Detected:</h4><ul>`;
        detectedEvents.forEach(err => {
            errorList += `<li style="color: #b91c1c; margin-bottom: 4px;">${err}</li>`;
        });
        errorList += `</ul>`;
        messageDiv.innerHTML = errorList;
    }
}

// Call this inside your onDateSelect() to reset UI before loading new data
function resetDashboardUI() {
    document.getElementById("event-message").innerText = "Analyzing system data...";
}