google.charts.load('current', { packages: ['corechart'] });

const SPREADSHEET_ID = '1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0';
const SHEET_PREFIX = 'EEE Block-1 Solar Data_Slave_1_';

function loadData() {
  const dateValue = document.getElementById('datePicker').value;

  if (!dateValue) {
    alert('Please select a date');
    return;
  }

  const sheetName = SHEET_PREFIX + dateValue;

  const queryString = `
    SELECT A, B
    WHERE A IS NOT NULL AND B IS NOT NULL
  `;

  const url =
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}`;

  const query = new google.visualization.Query(url);
  query.setQuery(queryString);
//   console.log(query.iO)

  query.send(function (response) {
    if (response.isError()) {
      document.getElementById('chart_div').innerHTML = '';
      document.getElementById('total_power').innerHTML = '';
      alert('No data found for selected date');
      return;
    }

    const data = response.getDataTable();
    // console.log(data)

    if (!data || data.getNumberOfRows() === 0) {
      document.getElementById('chart_div').innerHTML = '';
      document.getElementById('total_power').innerHTML = '';
      alert('No data found for selected date');
      return;
    }

    drawChart(data);
    showTotalPower(data);
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

  document.getElementById('total_power').innerHTML =
    `Total Power Generated (Day): ${total.toFixed(2)} Watts`;
}
