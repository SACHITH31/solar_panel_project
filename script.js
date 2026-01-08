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
  // Ensure we don't duplicate columns if redrawing
  let view = new google.visualization.DataView(data);

  // Logic to add annotation columns to the underlying data if they don't exist
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

/* ---------- FAST MONTH VIEW (FIXED SPEED & GHOST DATA) ---------- */
async function handleMonthViewRequest() {
  const loader = document.getElementById("monthLoader");
  const chartContainer = document.getElementById("monthlyBarChartContainer");
  const chartDiv = document.getElementById("monthlyBarChart");
  const oopsMsg = document.getElementById("oopsMessage");

  if (oopsMsg) oopsMsg.style.display = "none";
  loader.style.display = "block";
  chartContainer.style.display = "none";
  chartDiv.innerHTML = "";

  const month = parseInt(document.getElementById("mvMonth").value);
  const year = parseInt(document.getElementById("mvYear").value);
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const maxDay =
    today.getMonth() + 1 === month && today.getFullYear() === year
      ? today.getDate()
      : daysInMonth;

  const dayPromises = [];

  for (let d = 1; d <= maxDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(
      d
    ).padStart(2, "0")}`;
    const sheetName = SHEET_PREFIX + dateStr;
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
      sheetName
    )}`;

    dayPromises.push(
      fetch(url)
        .then((res) => res.text())
        .then((text) => {
          // VALIDATION: If data doesn't contain the date, it's a redirect to Master. Skip it.
          if (!text.includes(dateStr)) return null;

          const rows = text.split("\n").slice(1);
          let dailyMax = 0;
          rows.forEach((row) => {
            const cols = row.split(",");
            const val = parseFloat(cols[1]?.replace(/"/g, ""));
            if (!isNaN(val) && val > dailyMax) dailyMax = val;
          });

          return dailyMax > 0
            ? {
                label: `${d} ${new Date(year, month - 1).toLocaleString("en", {
                  month: "short",
                })}`,
                value: dailyMax,
                dayNum: d,
              }
            : null;
        })
        .catch(() => null)
    );
  }

  const results = (await Promise.all(dayPromises))
    .filter((r) => r !== null)
    .sort((a, b) => a.dayNum - b.dayNum);
  loader.style.display = "none";

  if (results.length === 0) {
    alert(
      `No solar data recorded for ${
        document.getElementById("mvMonth").options[month - 1].text
      } ${year}.`
    );
    if (oopsMsg) oopsMsg.style.display = "block";
    return;
  }

  drawMonthlyMaxBarChart(results, month, year);
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

  // Reveal the container
  oopsMsg.style.display = "none";
  container.style.display = "block";

  // Create the DataTable manually from the array objects {label, value}
  const dt = new google.visualization.DataTable();
  dt.addColumn("string", "Date");
  dt.addColumn("number", "Peak Watts");

  // Convert the dataArr into rows Google can read
  const rows = dataArr.map((item) => [item.label, item.value]);
  dt.addRows(rows);

  const options = {
    title: `Daily Peak Power Generation - ${month}/${year}`,
    legend: "none",
    height: 500,
    // Adjust these percentages to bring the graph inward
    chartArea: {
      left: "10%", // Gives more room for the Y-axis numbers
      right: "10%", // FIX: Prevents the "8 Jan" bar from hitting the right edge
      top: "15%", // Room for the title
      bottom: "20%", // Room for rotated date labels
      width: "80%", // Restricts total width to 80% of container
      height: "65%",
    },
    hAxis: {
      title: "Date",
      slantedText: true,
      slantedTextAngle: 45,
      textStyle: { fontSize: 11 },
    },
    vAxis: {
      title: "Watts",
      minValue: 0,
      gridlines: { count: 6 },
      // This helps format large numbers so they don't take up too much horizontal space
      format: "short",
    },
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

/* ---------- SUMMARY & METRICS ---------- */
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

/* ---------- PDF DOWNLOAD (FIXED) ---------- */
async function downloadDashboardSection() {
  const btn = document.getElementById("downloadBtn");
  const btnText = document.getElementById("btnText");
  const mainArea = document.getElementById("download-area");
  const eventsArea = document.getElementById("events");
  const dateValue = document.getElementById("datePicker").value;

  btn.disabled = true;
  btnText.innerHTML = `<span class="spinner"></span> Capturing Full Report...`;

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 10;
    const maxLineWidth = pageWidth - margin * 2;

    const canvasMain = await html2canvas(mainArea, { scale: 2, useCORS: true });
    const imgMain = canvasMain.toDataURL("image/jpeg", 0.85);
    const mainHeight = (maxLineWidth * canvasMain.height) / canvasMain.width;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(26, 115, 232);
    pdf.text("SOLAR PERFORMANCE & ERROR REPORT", margin, 15);
    pdf.setFontSize(9);
    pdf.setTextColor(100);
    pdf.text(`Generated On: ${new Date().toLocaleString()}`, margin, 22);
    pdf.text(`Reported Date: ${dateValue}`, margin, 27);

    pdf.addImage(imgMain, "JPEG", margin, 28, maxLineWidth, mainHeight);

    const canvasEvents = await html2canvas(eventsArea, {
      scale: 2,
      useCORS: true,
    });
    const imgEvents = canvasEvents.toDataURL("image/jpeg", 0.85);
    const eventsHeight =
      (maxLineWidth * canvasEvents.height) / canvasEvents.width;

    if (28 + mainHeight + eventsHeight + 10 > 280) {
      pdf.addPage();
      pdf.addImage(imgEvents, "JPEG", margin, 20, maxLineWidth, eventsHeight);
    } else {
      pdf.addImage(
        imgEvents,
        "JPEG",
        margin,
        28 + mainHeight + 5,
        maxLineWidth,
        eventsHeight
      );
    }

    pdf.save(`Solar_Report_${dateValue}.pdf`);
  } catch (error) {
    console.error(error);
    alert("PDF Error. Ensure html2canvas and jspdf libraries are loaded.");
  } finally {
    btn.disabled = false;
    btnText.innerText = "📝Download PDF";
  }
}

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}
function isDateInRange(dStr) {
  const d = new Date(dStr);
  return d >= new Date("2025-11-22") && d <= new Date(getTodayDate());
}
