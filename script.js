google.charts.load('current', { packages: ['corechart'] });

const SPREADSHEET_ID = '1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0';
const SHEET_PREFIX = 'EEE Block-1 Solar Data_Slave_1_';
const POLLING_INTERVAL = 120000;

let pollingTimer = null;
let isLive = false;

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

  const queryString = `
    SELECT A, B
    WHERE A IS NOT NULL AND B IS NOT NULL
  `;

  const url =
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}`;

  const query = new google.visualization.Query(url);
  query.setQuery(queryString);

  query.send(function (response) {
    if (response.isError()) {
      clearUI();
      alert('No data found for selected date');
      return;
    }

    const data = response.getDataTable();

    if (!data || data.getNumberOfRows() === 0) {
      clearUI();
      alert('No data found for selected date');
      return;
    }

    drawChart(data);
    showTotalPower(data);
    detectPowerEvents(data);
    updateLastUpdatedTime(dateValue);
  });
}

function drawChart(data) {

  // Add annotation columns
  data.addColumn({ type: 'string', role: 'annotation' });
  data.addColumn({ type: 'string', role: 'annotationText' });

  const DROP_THRESHOLD = 15000;
  let lastPower = null;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const power = data.getValue(i, 1);
    const time = data.getValue(i, 0);

    let marker = null;
    let message = null;

    if (lastPower !== null && lastPower - power > DROP_THRESHOLD) {
      marker = '⚠';
      message =
        power < 1000
          ? 'Possible Power Outage / Inverter Shutdown'
          : 'Possible Cloud or Load Fluctuation';
    }

    data.setValue(i, 2, marker);
    data.setValue(i, 3, message);

    lastPower = power;
  }

  const options = {
    title: 'Solar Power Generation',
    curveType: 'function',
    lineWidth: 3,
    legend: 'none',

    hAxis: {
      title: 'Time',
      format: 'HH:mm'
    },

    vAxis: {
      title: 'Generated Power (Watts)',
      minValue: 0
    },

    annotations: {
      style: 'point',
      textStyle: {
        fontSize: 12,
        color: 'red',
        bold: true,
        auraColor: 'white',
        cursor: 'pointer'
      }
    },

    chartArea: {
      left: 70,
      right: 20,
      top: 50,
      bottom: 80
    }
  };

  const chart = new google.visualization.LineChart(
    document.getElementById('chart_div')
  );

  chart.draw(data, options);
}


function showTotalPower(data) {
  let total = 0;

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const value = data.getValue(i, 1);
    if (!isNaN(value)) {
      total += value;
    }
  }

  document.getElementById('total_power').innerText =
    `Total Power Generated (Day): ${total.toFixed(2)} Watts`;
}

function detectPowerEvents(data) {
  const DROP_THRESHOLD = 15000;
  let lastPower = null;
  let events = [];

  for (let i = 0; i < data.getNumberOfRows(); i++) {
    const time = data.getValue(i, 0);
    const power = data.getValue(i, 1);

    if (lastPower !== null) {
      const drop = lastPower - power;

      if (drop > DROP_THRESHOLD) {
        let reason = 'Possible Grid / Inverter Issue';

        if (power < 1000) {
          reason = 'Possible Power Outage or Inverter Shutdown';
        } else {
          reason = 'Possible Heavy Cloud or Load Fluctuation';
        }

        events.push(`${time.toLocaleTimeString()} – ${reason}`);
      }
    }

    lastPower = power;
  }

  displayEvents(events);
}

function displayEvents(events) {
  const container = document.getElementById('events');
  container.style.fontSize = '14px';
  container.style.marginTop = '20px';
  container.style.color = '#b00020';

  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '<strong>⚠ Detected Power Drop Events:</strong><br>';

  events.forEach(e => {
    const eventElement = document.createElement('li');
    eventElement.style.marginTop = '6px';
    eventElement.textContent = e;
    container.appendChild(eventElement)
  });

  container.innerHTML = html + container.innerHTML;
}

function updateLastUpdatedTime(selectedDate) {
  const time = new Date().toLocaleTimeString();

  document.getElementById('last_updated').innerHTML =
    `Last updated at: <strong font-size:16px;>${time}</strong>`;
     // creating the new input element with the today's date which is kept disabled
     const dateInput = document.createElement('input');
     dateInput.id = 'today_date_display';
     dateInput.type = 'date';
     dateInput.value = new Date().toISOString().split('T')[0];
     dateInput.disabled = true;
     dateInput.style.marginLeft = '6px';
     dateInput.style.fontSize = '16px';
     dateInput.className = 'static-date';
     const span = document.createElement('span');
     span.className = 'date-label';
     span.style = 'color: rgba(228, 15, 15, 1); margin-left: 50px; font-weight: 600; margin-right: 6px;';
     span.innerText = 'TODAY\'S DATE:';
     document.getElementById('last_updated').appendChild(span);
     document.getElementById('last_updated').appendChild(dateInput);
}


function startPolling(dateValue) {
  isLive = true;
  setLiveStatus();

  pollingTimer = setInterval(() => {
    loadData(dateValue);
  }, POLLING_INTERVAL);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  isLive = false;
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
  document.getElementById('total_power').innerText = '';
  document.getElementById('last_updated').innerText = '';
  document.getElementById('status').innerText = '';
  const events = document.getElementById('events');
  if (events) events.innerHTML = '';
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}
