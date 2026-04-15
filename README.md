# GPREC Solar Power Analytics Dashboard

A web-based monitoring dashboard for the GPREC EEE solar installation. The application reads solar data from Google Sheets, converts it into useful engineering metrics, and presents it through daily, monthly, and yearly visualizations.

This project is designed for practical use inside a college environment where staff, faculty, and students need a simple way to monitor solar generation, track equipment behavior, and export reports.

## 1. Project Purpose

The main goal of this project is to turn raw inverter and solar meter data into an easy-to-understand dashboard.

The dashboard helps users answer questions such as:
- How much solar power is being generated right now?
- What was the total solar energy produced today?
- Was there any sudden drop or possible outage?
- What was the peak power generated on each day of a selected month?
- How much total energy was generated month by month across the plant lifetime?
- Can we download a PDF report for documentation or submission?

## 2. What This Project Does

The application provides three major levels of analysis:

1. Daily Dashboard
Shows the selected date's live or historical solar power trend using a time-based line chart.

2. Month View
Shows two daily column charts for a selected month:
- Daily peak power generation
- Daily total energy generation

3. Monthly Energy Generation
Shows a year-wise monthly energy generation chart so the user can review long-term performance.

## 3. Current Features

The project currently includes the following features.

### Daily monitoring
- Date picker for selecting a specific date
- Live mode for today's data with auto-refresh every 2 minutes
- Historical mode for older dates
- Line chart for solar power generation over time
- Sudden drop annotations on the graph

### Summary cards
- Live watt reading
- Solar energy generated today
- Inverter health indicator
- CO2 savings estimate

### Metrics table
- Latest inverter metrics table from selected columns
- Frequency
- PF Avg (inst)
- VA Total
- VL N Average
- Current Total
- Wh

### Event detection
- Detects sudden power drops
- Displays system alerts or a no-error state

### Month View analytics
- Month and year selector popup
- Daily peak power chart for selected month
- Daily total energy chart for selected month
- Handles partial current month automatically
- Shows loading state and no-data state

### Lifetime / yearly analytics
- Dynamic year selector from project start year to current year
- Monthly cumulative energy generation chart for selected year
- Handles partial first year and partial current year
- Shows current month even if value is zero
- Year-wise caching in local storage for faster repeat loads
- Cache versioning and expiry for safer long-term use

### Performance and UX improvements
- Retry logic for daily fetch failures
- Chunked request handling to reduce overload
- Request guards so stale responses do not overwrite newer selections
- Responsive design improvements for the monthly energy generation section
- Loader states for charts while data is being calculated

### Reporting
- Downloadable PDF report
- Includes dashboard, alerts, monthly charts, and yearly chart
- Blocks PDF download while chart data is still loading

## 4. Technology Stack

### Frontend
- HTML5
- CSS3
- JavaScript (Vanilla JS)

### Charts and reporting
- Google Charts
- html2canvas
- jsPDF

### Data source
- Google Sheets
- Google Visualization Query API

## 5. Project Structure

```text
solar_panel_project/
|-- index.html
|-- style.css
|-- script.js
|-- README.md
|-- assets/
```

### File roles

`index.html`
Contains the dashboard structure, popup layout, chart containers, and controls.

`style.css`
Contains all styling for cards, charts, buttons, loaders, responsive behavior, and visual layout.

`script.js`
Contains the full application logic:
- data loading
- chart rendering
- event detection
- monthly calculations
- lifetime chart generation
- caching
- PDF generation

## 6. Data Flow

The application flow is shown below.

```text
Google Sheets
   |
   v
Google Visualization API / CSV fetch
   |
   v
JavaScript parsing and calculations
   |
   v
Charts + cards + tables + PDF export
```

### Visual architecture diagram

```text
+-----------------------------+
|  Google Sheets Data Source  |
|  Daily solar sheet entries  |
+-------------+---------------+
              |
              v
+-----------------------------+
|  Data Access Layer          |
|  - Google Visualization API |
|  - CSV fetch for day data   |
+-------------+---------------+
              |
              v
+-----------------------------+
|  Application Logic          |
|  script.js                  |
|  - parsing                  |
|  - validation               |
|  - calculations             |
|  - caching                  |
|  - event detection          |
+------+------+---------------+
       |      |
       |      +----------------------+
       |                             |
       v                             v
+-------------------+      +----------------------+
|  UI Rendering     |      |  Reporting Layer     |
|  - line charts    |      |  - html2canvas       |
|  - bar charts     |      |  - jsPDF             |
|  - cards/tables   |      |  - PDF export        |
+-------------------+      +----------------------+
```

## 7. How the Dashboard Works

### A. Daily dashboard flow

1. User selects a date.
2. The app loads the matching Google Sheet for that date.
3. The app queries required columns using Google Visualization API.
4. The dashboard updates:
- main line chart
- summary cards
- metrics table
- event alerts

```text
User selects date
      |
      v
Load Google Sheet for that day
      |
      v
Query required columns
      |
      v
Render daily chart + cards + alerts + metrics
```

### B. Month View flow

1. User opens Month View.
2. User selects a month and year.
3. The app builds all date strings inside that month.
4. For each day, the app fetches CSV data.
5. The app calculates:
- peak power for that day
- total energy for that day
6. The app renders two column charts.

```text
Select month/year
      |
      v
Build all dates in selected month
      |
      v
Fetch each day -> validate sheet -> calculate values
      |
      v
+-----------------------------+
|  Output 1: Peak Power Chart |
|  Output 2: Energy Chart     |
+-----------------------------+
```

### C. Lifetime / yearly graph flow

1. User selects a year.
2. The app checks local cache first.
3. If valid cache exists, the chart renders quickly.
4. If cache is missing or expired, the app fetches daily data month by month.
5. The app sums energy month-wise.
6. The app renders the monthly energy chart.
7. The app stores the result in local storage for faster reuse.

```text
Select year
   |
   v
Check local cache
   |
   +------ Yes, valid ------> Render chart immediately
   |
   +------ No / expired ----> Fetch day data month by month
                               |
                               v
                        Sum monthly totals
                               |
                               v
                        Render chart + save cache
```

## 8. Engineering Calculations Used

The project uses the following formulas.

### Daily peak power

The maximum power value found in a day:

```text
P_peak = max(P1, P2, P3, ..., Pn)
```

### Daily energy generation

Energy is calculated using the difference between the final and initial cumulative Wh values.

```text
Daily Energy (kWh) = (Last_Wh - First_Wh) / 1000
```

### Total solar energy today

The daily dashboard sums the selected power values and converts to kWh for display.

```text
Total Energy Today (kWh) = Sum(Power Values) / 1000
```

### CO2 savings estimate

```text
CO2 Saved (kg) = Total kWh x 0.82
```

## 9. Important Date Logic

The project starts from:

```text
START_DATE_STR = 2025-11-22
```

This affects:
- valid dashboard date range
- available years in the yearly dropdown
- partial first-year lifetime chart logic

The current year is detected automatically from the browser date, so future years such as 2027 will appear automatically once the real current year becomes 2027.

## 10. Reliability Features Already Added

To make this application safer for production use, the following protections are already implemented.

### Data reliability
- CSV parsing now handles quoted commas safely
- Date validation checks that fetched sheet content matches the requested day
- Retry logic is used for day-level fetches

### Performance reliability
- Chunked parallel requests reduce overload
- Cached yearly totals speed up repeat usage
- Cache versioning helps invalidate older saved formats
- Cache expiry prevents saved data from staying stale forever

### UI reliability
- Request guards ensure only the latest Month View request updates the charts
- Request guards ensure only the latest yearly graph request updates the chart
- PDF download is blocked while charts are still loading
- Current month is preserved in the yearly chart even when its value is zero

## 11. User Guide

### Quick use diagram

```text
Open dashboard
   |
   +--> Choose a date -> View daily analytics
   |
   +--> Open Month View -> Select month/year -> View daily monthly charts
   |
   +--> Select year in Monthly Energy Generation -> View yearly monthly totals
   |
   +--> Click Download PDF -> Export current report
```

### Open the dashboard
Open `index.html` in a browser with internet access.

### Use the daily dashboard
1. Select a date.
2. Click `OK`.
3. Review the chart, cards, metrics, and alerts.

### Use Month View
1. Click `Month View`.
2. Select month and year.
3. Click `OK`.
4. Review:
- Daily Peak Power Generation
- Daily Total Energy Generated

### Use the monthly energy generation chart
1. Scroll to `Monthly Energy Generation`.
2. Select a year.
3. Click `OK`.
4. Review month-wise cumulative energy generation for that year.

### Download PDF
1. Wait until all charts are fully visible.
2. Click `Download PDF`.
3. The PDF will include the currently visible report sections.

## 12. Key Design Decisions

This project uses a frontend-only structure instead of a custom backend.

### Why this approach was chosen
- Simple deployment
- Easy maintenance
- Direct access to Google Sheets data
- Suitable for academic and departmental environments

### Trade-off
Because calculations happen in the browser, the first load for a full month or full year can take time depending on internet speed and spreadsheet response time.

To reduce this effect, the project now includes:
- retry logic
- request chunking
- chart loaders
- local cache for yearly totals

## 13. Limitations

The application is stable for its current use case, but these limitations still exist.

- It depends on Google Sheets availability
- It requires internet access
- Data format changes in the sheet can affect parsing
- PDF generation depends on the current visible UI state
- Very large future datasets may benefit from a backend or pre-aggregated monthly source

## 14. Suggested Future Improvements

These are optional future upgrades if the project grows.

- Backend service for precomputed monthly totals
- Admin panel for plant configuration
- Multi-plant support
- Advanced outage classification
- Better authentication if the dashboard becomes public
- Dedicated API instead of direct sheet fetching
- Automated scheduled report emails

## 15. Project Summary

This project is a complete solar analytics dashboard for GPREC EEE that converts spreadsheet-based solar data into a real monitoring and reporting system.

It already supports:
- daily monitoring
- monthly comparison
- yearly energy analysis
- event detection
- PDF export
- responsive chart viewing
- production-focused reliability improvements

In short, this project helps users move from raw solar readings to understandable engineering insights.

## 16. Optional README Enhancements

If this README will be used for project submission, demo presentation, or GitHub portfolio display, you can also attach:
- Dashboard screenshot
- Month View screenshot
- Monthly Energy Generation screenshot
- Sample exported PDF screenshot

Recommended screenshot labels:
- `Figure 1: Daily Solar Dashboard`
- `Figure 2: Month View Analysis`
- `Figure 3: Year-wise Monthly Energy Generation`
- `Figure 4: Exported PDF Report`

## 17. Institution Note

Prepared for:

**G. Pulla Reddy Engineering College (Autonomous)**  
**Department of Electrical and Electronics Engineering**
