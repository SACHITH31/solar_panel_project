// var chart;

// document.getElementById("loadData").addEventListener("click", function () {
//     var date = document.getElementById("selectedDate").value;

//     if (date === "") {
//         alert("Please select a date");
//         return;
//     }

//     var sheetName = "EEE Block-1 Solar Data_Slave_1_" + date;
//     var spreadsheetId = "1AdBjvpwcuAPetNtZXWR1nWwQTdbLCpslQ6xWbcPr5M0";

//     var url =
//         "https://docs.google.com/spreadsheets/d/" +
//         spreadsheetId +
//         "/gviz/tq?tqx=out:json&sheet=" +
//         encodeURIComponent(sheetName);

//     fetch(url)
//         .then(res => res.text())
//         .then(data => {
//             var json = JSON.parse(data.substr(47).slice(0, -2));
//             var rows = json.table.rows;

//             var timeLabels = [];
//             var powerData = [];

//             rows.forEach(row => {
//                 if (row.c[0] && row.c[1]) {
//                     var dateObj = new Date(row.c[0].v);
//                     var time =
//                         dateObj.getHours().toString().padStart(2, "0") + ":" +
//                         dateObj.getMinutes().toString().padStart(2, "0") + ":" +
//                         dateObj.getSeconds().toString().padStart(2, "0");

//                     timeLabels.push(time);
//                     powerData.push(row.c[1].v);
//                 }
//             });

//             drawGraph(timeLabels, powerData);
//         })
//         .catch(err => console.log(err));
// });

// function drawGraph(timeLabels, powerData) {
//     var ctx = document.getElementById("solarChart").getContext("2d");

//     if (chart) {
//         chart.destroy();
//     }

//     chart = new Chart(ctx, {
//         type: "line",
//         data: {
//             labels: timeLabels,
//             datasets: [{
//                 label: "Watts Generated",
//                 data: powerData,
//                 borderWidth: 2,
//                 pointRadius: 0,
//                 fill: false
//             }]
//         },
//         options: {
//             responsive: true,
//             animation: false,
//             scales: {
//                 x: {
//                     title: {
//                         display: true,
//                         text: "Time"
//                     }
//                 },
//                 y: {
//                     title: {
//                         display: true,
//                         text: "Watts"
//                     }
//                 }
//             }
//         }
//     });
// }
