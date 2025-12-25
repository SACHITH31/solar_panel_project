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

  // set disabled today display
  document.getElementById('todayDisplay').value = today;
  document.getElementById('todayDisplay').title = `Today is ${today}`;

  loadData(today);
  startPolling(today);
  updateDateNavButtons(today);

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
  updateDateNavButtons(selectedDate);
}

function changeDateBy(days) {
  const dateInput = document.getElementById('datePicker');
  const current = dateInput.value || getTodayDate();

  const d = new Date(current);
  d.setDate(d.getDate() + days);

  const newDate = formatDate(d);
  dateInput.value = newDate;

  // behave like manual selection
  stopPolling();
  loadData(newDate);

  if (newDate === getTodayDate()) {
    startPolling(newDate);
  } else {
    setHistoricalStatus();
  }

  updateDateNavButtons(newDate);
}

function goToPreviousDate() {
  changeDateBy(-1);
}

function goToNextDate() {
  changeDateBy(1);
}

// enable/disable prev/next according to today
function updateDateNavButtons(selectedDate) {
  const today = getTodayDate();
  const prevBtn = document.getElementById('prevDateBtn');
  const nextBtn = document.getElementById('nextDateBtn');

  // next disabled if selected date is today or in future
  const sel = new Date(selectedDate);
  const todayDate = new Date(today);

  nextBtn.disabled = sel >= todayDate;

  // previous always enabled unless you want a lower bound
  prevBtn.disabled = false;
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

    detectedEventSet.clear();      // clear old events for previous date

    detectPowerEvents(data);
    updateLastUpdatedTime();

  });
}

// build ticks for 60‑minute intervals on x‑axis
function buildHourlyTicks(data) {
  // get first and last time from data
  let firstTime = data.getValue(0, 0);
  let lastTime = data.getValue(data.getNumberOfRows() - 1, 0);

  // normalize to Date
  const toDate = t => {
    if (t instanceof Date) return new Date(t.getTime());
    const [h, m] = String(t).split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d;
  };

  firstTime = toDate(firstTime);
  lastTime = toDate(lastTime);

  // extend to next full hour
  lastTime.setHours(lastTime.getHours() + 1, 0, 0, 0);

  const ticks = [];
  const cur = new Date(firstTime.getTime());
  cur.setMinutes(0, 0, 0);

  while (cur <= lastTime) {
    ticks.push(new Date(cur.getTime()));
    cur.setHours(cur.getHours() + 1);
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
  // find last time value (assumes column 0 is Date or "HH:MM")
let lastTime = data.getValue(data.getNumberOfRows() - 1, 0);
let viewWindowMax = null;

if (lastTime instanceof Date) {
  viewWindowMax = new Date(lastTime.getTime());
  viewWindowMax.setHours(viewWindowMax.getHours() + 1);
} else {
  // string like "10:00"
  const [h, m] = String(lastTime).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  d.setHours(d.getHours() + 1);
  viewWindowMax = d;                 // Google Charts can use Date here
}

const options = {
  title: 'SOLAR POWER GENERATION (Watts)',
  legend: 'none',
  curveType: 'function',
  lineWidth: 3,
  //adding marginBotton with 10px only just down of this title

  chartArea: {
    left: 80,
    top: 50,
    right: 20,
    bottom: 70,
    width: '85%',
    height: '75%'
  },

  // Chart title
  titleTextStyle: {
    fontSize: 18,
    bold: true
  },

  // X axis (time)
hAxis: {
  title: 'Time',
  format: 'HH:mm',
  ticks: hourlyTicks,
  gridlines: { color: '#e0e0e0', count: -1 },
  viewWindowMode: 'explicit',
  viewWindow: {
    min: hourlyTicks[0],
    max: hourlyTicks[hourlyTicks.length - 1]   // last tick, e.g., 11:00
  },
  textStyle: { fontSize: 13 },
  titleTextStyle: { fontSize: 14, italic: true }
},



  // Y axis (power)
  vAxis: {
    title: 'Generated Power (Watts)',
    viewWindow: { min: 0 },
    gridlines: { color: '#e0e0e0' },
    minorGridlines: { color: '#f5f5f5' },
    textStyle: { fontSize: 13 },             // y‑axis labels
    titleTextStyle: { fontSize: 14, italic: true }
  },

  // Red warning markers
  annotations: {
    style: 'point',
    textStyle: {
      color: 'red',
      fontSize: 16,
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
  if (detectedEventSet.size === 0) return;

  const divContainer = document.createElement('div');
  divContainer.className = 'error-event-card';
  container.appendChild(divContainer);

  const title = document.createElement('strong');
  title.textContent = '⚠ Detected Power Drop Events:';
  divContainer.appendChild(title);
  container.appendChild(document.createElement('br'));

  //creating another div for list
  const divList = document.createElement('div');
  divList.className = 'error-event-list-card';
  container.appendChild(divList);
  const ul = document.createElement('ul');
  detectedEventSet.forEach(e => {
    const li = document.createElement('li');
    li.textContent = e;
    ul.appendChild(li);
  });
  divList.appendChild(ul);
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

function formatDate(d) {
  return d.toISOString().split('T')[0];
}
