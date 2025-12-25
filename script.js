google.charts.load('current', { packages: ['corechart'] });

const SPREADSHEET_ID = '1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0';
const SHEET_PREFIX = 'EEE Block-1 Solar Data_Slave_1_';
const POLLING_INTERVAL = 120000;

let pollingTimer = null;
let isLive = false;

// prevent duplicate events forever
const detectedEventSet = new Set();

// latest DataTable for responsive redraw
let lastDataTable = null;

google.charts.setOnLoadCallback(init);

function init() {
  const today = getTodayDate();
  document.getElementById('datePicker').value = today;
  loadData(today);
  startPolling(today);

  // responsive chart: redraw on resize
  window.addEventListener('resize', () => {
    if (!lastDataTable) return;
    drawChart(lastDataTable);
  });
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
    lastDataTable = data;
    drawChart(data);
    showLiveWatt(data);
    showTotalPower(data);
    updateInverterHealth(data);
    detectPowerEvents(data);
    updateLastUpdatedTime();
  });
}

// build ticks for 60‑minute intervals on x‑axis
function buildHourlyTicks(data) {
  const ticks = [];
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const time = data.getValue(i, 0);
    if (time instanceof Date) {
      const m = time.getMinutes();
      if (m === 0) ticks.push(time);
    } else {
      const [h, m] = String(time).split(':').map(Number);
      if (m === 0) ticks.push(time);
    }
  }
  return ticks;
}

function drawChart(data) {
  // add annotation columns if not already present
  if (data.getNumberOfColumns() === 2) {
    data.addColumn({ type: 'string', role: 'annotation' });      // col 2
    data.addColumn({ type: 'string', role: 'annotationText' });  // col 3
  }

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

  const hourlyTicks = buildHourlyTicks(data);

  const options = {
    title: 'Solar Power Generation',
    legend: 'none',
    curveType: 'function',
    lineWidth: 3,

    chartArea: {
      left: 80,
      top: 40,
      right: 20,
      bottom: 60,
      width: '85%',
      height: '75%'
    },

    hAxis: {
      title: 'Time',
      format: 'HH:mm',
      ticks: hourlyTicks,
      gridlines: { color: '#e0e0e0', count: -1 },
      viewWindowMode: 'pretty',
      textStyle: { fontSize: 11 }
    },

    vAxis: {
      title: 'Generated Power (Watts)',
      viewWindow: { min: 0 },
      gridlines: { color: '#e0e0e0' },
      minorGridlines: { color: '#f5f5f5' },
      textStyle: { fontSize: 11 }
    },

    annotations: {
      style: 'point',
      textStyle: {
        color: 'red',
        fontSize: 14,
        bold: true
      }
    }
  };

  const chart = new google.visualization.LineChart(
    document.getElementById('chart_div')
  );
  chart.draw(data, options);
}

function showLiveWatt(data) {
  const lastRow = data.getNumberOfRows() - 1;
  const watt = data.getValue(lastRow, 1);
  const kwh = (watt / 1000).toFixed(2);

  const el = document.getElementById('live_watt');
  el.innerHTML = `⚡ Live Watt : <strong>${kwh} kWh</strong>`;
  el.title = `Live Watt is: ${kwh} kWh`;
  el.style.opacity = 1;
  el.style.transition = 'opacity 1s ease-in';
  el.style.cursor = 'pointer';
}

function showCO2Saved(totalKwh) {
  const CO2_FACTOR = 0.82; // kg per kWh
  const co2 = totalKwh * CO2_FACTOR;

  const el = document.getElementById('co2_saved');
  el.innerHTML = `🌱 CO₂ Saved : <strong>${co2.toFixed(0)} kg</strong>`;
  el.title = `CO₂ Saved is: ${co2.toFixed(0)} kg`;
  el.style.opacity = 1;
  el.style.transition = 'opacity 1s ease-in';
  el.style.cursor = 'pointer';
}

function showTotalPower(data) {
  let total = 0;
  for (let i = 0; i < data.getNumberOfRows(); i++) {
    total += data.getValue(i, 1);
  }

  const totalKwh = total / 1000;

  const el = document.getElementById('total_power');
  el.innerHTML = `☀️ Solar Energy Today : <strong>${totalKwh.toFixed(2)} kWh</strong>`;
  el.title = `Solar Energy Today : ${totalKwh.toFixed(2)} kWh`;
  el.style.opacity = 1;
  el.style.transition = 'opacity 1s ease-in';
  el.style.cursor = 'pointer';

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

  const el = document.getElementById('inverter-health');
  el.innerHTML = `🟢 Inverter Health : <strong>${health}%</strong>`;
  el.title = `Inverter Health is: ${health}%`;
  el.style.opacity = 1;
  el.style.transition = 'opacity 1s ease-in';
  el.style.cursor = 'pointer';
}

function detectPowerEvents(data) {
  const DROP_THRESHOLD = 15000;
  let lastPower = null;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const time = data.getValue(i, 0);
    const power = data.getValue(i, 1);

    if (lastPower && lastPower - power > DROP_THRESHOLD) {
      const dropPercent = (((lastPower - power) / lastPower) * 100).toFixed(1);
      const eventKey = `${time} - Drop ${dropPercent}%`;

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

  if (detectedEventSet.size === 0) {
    container.innerHTML =
      '✅ No power drop events detected for this period.';
    return;
  }

  const title = document.createElement('strong');
  title.textContent = '⚠ Detected Power Drop Events:';
  container.appendChild(title);
  container.appendChild(document.createElement('br'));

  const ul = document.createElement('ul');
  detectedEventSet.forEach(e => {
    const li = document.createElement('li');
    li.textContent = e;
    ul.appendChild(li);
  });
  container.appendChild(ul);
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
    `<span class="live-dot"></span><span>LIVE (auto-updating every 2 minutes)</span>`;
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
