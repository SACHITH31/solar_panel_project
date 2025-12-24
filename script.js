google.charts.load('current', { packages: ['corechart'] });

const SPREADSHEET_ID = '1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0';
const SHEET_PREFIX = 'EEE Block-1 Solar Data_Slave_1_';
const POLLING_INTERVAL = 120000;

let pollingTimer = null;
let isLive = false;

// ✅ GLOBAL SET → prevents duplicate events forever
const detectedEventSet = new Set();

google.charts.setOnLoadCallback(init);

function init() {
  const today = getTodayDate();
  document.getElementById('datePicker').value = today;
  loadData(today);
  startPolling(today);
}

function onDateSelect() {
  const selectedDate = document.getElementById('datePicker').value;
  if (!selectedDate) {
    alert('Please select a date');
    return;
  }

  stopPolling();
  loadData(selectedDate);

  if (selectedDate === getTodayDate()) {
    startPolling(selectedDate);
  } else {
    setHistoricalStatus();
  }
}

function loadData(dateValue) {
  const sheetName = SHEET_PREFIX + dateValue;

  const query = new google.visualization.Query(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}`
  );

  query.setQuery(`SELECT A, B WHERE A IS NOT NULL AND B IS NOT NULL`);

  query.send(response => {
    if (response.isError()) {
      clearUI();
      alert('No data found');
      return;
    }

    const data = response.getDataTable();
    drawChart(data);
    showLiveWatt(data);
    showTotalPower(data);
    updateInverterHealth(data);
    detectPowerEvents(data);
    updateLastUpdatedTime();
  });
}

function drawChart(data) {
  data.addColumn({ type: 'string', role: 'annotation' });
  data.addColumn({ type: 'string', role: 'annotationText' });

  const DROP_THRESHOLD = 15000;
  let lastPower = null;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const power = data.getValue(i, 1);
    let marker = null;
    let text = null;

    if (lastPower !== null && lastPower - power > DROP_THRESHOLD) {
      marker = '⚠';
      text = 'Sudden Power Drop';
    }

    data.setValue(i, 2, marker);
    data.setValue(i, 3, text);
    lastPower = power;
  }

  new google.visualization.LineChart(
    document.getElementById('chart_div')
  ).draw(data, {
  title: 'Solar Power Generation',
  curveType: 'function',
  legend: 'none',
  lineWidth: 3,
  hAxis: { format: 'HH:mm' },
  vAxis: { minValue: 0 },

  // 🔴 MARKERS (annotations) IN RED
  annotations: {
    style: 'point',
    textStyle: {
      color: 'red',
      fontSize: 14,
      bold: true
    }
  }
});
}

function showLiveWatt(data) {
  const lastRow = data.getNumberOfRows() - 1;
  const watt = data.getValue(lastRow, 1);
  const kwh = (watt / 1000).toFixed(2);

  document.getElementById('live_watt').innerHTML =
    `⚡ Live Watt : <strong>${kwh} kWh</strong>`;
}

function showCO2Saved(totalKwh) {
  const CO2_FACTOR = 0.82; // kg per kWh
  const co2 = totalKwh * CO2_FACTOR;

  document.getElementById('co2_saved').innerHTML =
    `🌱 CO₂ Saved : <strong>${co2.toFixed(0)} kg</strong>`;
}

function showTotalPower(data) {
  let total = 0;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    total += data.getValue(i, 1);
  }

  const totalKwh = total / 1000;

  document.getElementById('total_power').innerText =
    `☀️ Solar Energy Today : ${totalKwh.toFixed(2)} kWh`;

  showCO2Saved(totalKwh);
}

function updateInverterHealth(data) {
  let lastPower = null;
  let maxDropPercent = 0;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const power = data.getValue(i, 1);
    if (lastPower && power < lastPower) {
      const dropPercent = ((lastPower - power) / lastPower) * 100;
      maxDropPercent = Math.max(maxDropPercent, dropPercent);
    }
    lastPower = power;
  }

  const health = maxDropPercent === 0 ? 100 : (100 - maxDropPercent).toFixed(1);

  document.getElementById('inverter-health').innerHTML =
    `🟢 Inverter Health : <strong>${health}%</strong>`;
}

function detectPowerEvents(data) {
  const DROP_THRESHOLD = 15000;
  let lastPower = null;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const time = data.getValue(i, 0);
    const power = data.getValue(i, 1);

    if (lastPower && lastPower - power > DROP_THRESHOLD) {
      const dropPercent = (((lastPower - power) / lastPower) * 100).toFixed(1);
      const eventKey = `${time}-${dropPercent}`;

      if (!detectedEventSet.has(eventKey)) {
        detectedEventSet.add(eventKey);
      }
    }
    lastPower = power;
  }

  displayEvents();
}

function displayEvents() {
  const container = document.getElementById('events');
  container.innerHTML = '';
  if (detectedEventSet.size === 0) return;

  container.innerHTML = '<strong>⚠ Detected Power Drop Events:</strong><br>';

  detectedEventSet.forEach(e => {
    const li = document.createElement('li');
    li.textContent = e;
    container.appendChild(li);
  });
}

function updateLastUpdatedTime() {
  document.getElementById('last_updated').innerHTML =
    `Last updated at: <strong>${new Date().toLocaleTimeString()}</strong>`;
}

function startPolling(date) {
  isLive = true;
  setLiveStatus();
  pollingTimer = setInterval(() => loadData(date), POLLING_INTERVAL);
}

function stopPolling() {
  clearInterval(pollingTimer);
}

function setLiveStatus() {
  document.getElementById('status').innerHTML =
    `<span class="live-dot"></span> LIVE (auto-updating every 2 minutes)`;
}

function setHistoricalStatus() {
  document.getElementById('status').innerText = 'Showing historical data';
}

function clearUI() {
  document.getElementById('chart_div').innerHTML = '';
  document.getElementById('events').innerHTML = '';
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}
