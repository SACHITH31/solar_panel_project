google.charts.load('current', { packages: ['corechart'] });

const SPREADSHEET_ID = '1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0';
const SHEET_PREFIX = 'EEE Block-1 Solar Data_Slave_1_';
const POLLING_INTERVAL = 120000; // 2 minutes

let pollingTimer = null;
let currentDateLoaded = null;

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
    document.getElementById('status').innerText = 'Showing historical data';
  }
}

function loadData(dateValue) {
  currentDateLoaded = dateValue;

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
      document.getElementById('chart_div').innerHTML = '';
      document.getElementById('total_power').innerHTML = '';
      document.getElementById('status').innerText = '';
      alert('No data found for selected date');
      return;
    }

    const data = response.getDataTable();

    if (!data || data.getNumberOfRows() === 0) {
      document.getElementById('chart_div').innerHTML = '';
      document.getElementById('total_power').innerHTML = '';
      document.getElementById('status').innerText = '';
      alert('No data found for selected date');
      return;
    }

    drawChart(data);
    showTotalPower(data);
    console.log(`Data loaded for date: ${dateValue}`);
    console.log(POLLING_INTERVAL ? 'Polling is active' : 'Polling is inactive');
  });
}

function drawChart(data) {
  const options = {
    title: 'Solar Power Generation',
    hAxis: {
      title: 'Time',
      format: 'HH:mm'
    },
    vAxis: {
      title: 'Generated Power (Watts)',
      minValue: 0
    },
    legend: 'none'
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

function startPolling(dateValue) {
  document.getElementById('status').innerText = 'Live data (auto-updates every 2 minutes)';

  pollingTimer = setInterval(() => {
    loadData(dateValue);
  }, POLLING_INTERVAL);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function getTodayDate() {
  const today = new Date();
  return today.toISOString().split('T')[0];
}
