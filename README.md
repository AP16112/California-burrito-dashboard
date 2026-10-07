# Business Analytics Dashboard

Web analytics dashboard built for the Software Developer Intern technical assessment. It ingests the supplied `data.xlsx`, precomputes compact analytics JSON, and serves a responsive dashboard with KPIs, filters, charts, and top item analysis.

## Run Locally

```powershell
npm.cmd run build:data
npm.cmd run dev
```

Open `http://localhost:4173`.

## Architecture

The raw Excel workbook is about 300K line-item records. Loading that directly in the browser would slow the first page load and make every filter scan unnecessarily expensive. Instead, `scripts/build_data.py` streams `data.xlsx` as OpenXML, computes line revenue as `Price * Quantity`, converts Excel date serials to ISO dates, and writes `public/data/analytics.json`.

The generated JSON dictionary-encodes repeated values such as dates, outlets, groups, and item names so the browser receives compact arrays instead of repeated strings. It keeps:

- `orders`: one row per `BillNo`, used for accurate order-level KPIs and revenue trend filtering.
- `lineCube`: aggregated line metrics by date, outlet, brand, category, order type, and settlement.
- `itemCube`: aggregated item metrics for the top-items table.
- `dimensions`: filter values discovered from the dataset.

The frontend is dependency-light: static HTML/CSS/JavaScript with Chart.js loaded from CDN. This makes deployment straightforward on Vercel as a static site.

## Dashboard Features

- KPIs: total revenue, orders, total records, quantity sold, and average order value.
- Filters: date range, outlet, category, order type, and settlement.
- Visualizations: daily revenue line chart, category revenue bar chart, and order-type doughnut chart.
- Generated insights for strongest category, best outlet, top item, delivery mix, average order, and records analyzed.
- Top items table with revenue and quantity.
- CSV export for the current filtered item-level view.
- Responsive layout for desktop and mobile.

## Trade-Offs

- The app uses precomputed analytics instead of a database because the assessment dataset is static and the dashboard is read-only. This keeps hosting simple and page interactions fast.
- Order counts are calculated from one row per `BillNo`, while category and item breakdowns use line-item aggregates. This avoids double-counting orders in the main KPIs.
- If the dataset needed frequent updates, user accounts, or ad hoc querying over many dimensions, I would move the ETL output into SQLite/PostgreSQL and expose a small API layer.

## Reasoning Log

- I first inspected the Excel workbook structure and confirmed the assessment note that one `BillNo` can span multiple line-item rows.
- Revenue is calculated at line level as `Price * Quantity`, then rolled up into order-level and category/item-level summaries.
- I chose an ETL step because the dataset is large but static. Precomputing analytics keeps the dashboard responsive and keeps deployment simple.
- I avoided counting raw rows as orders. The dashboard uses unique `BillNo` rows for order KPIs so multi-item orders are not double-counted.
- I dictionary-encoded the generated JSON to reduce repeated strings and shrink the dashboard payload.
- I kept the frontend dependency-light so the project can be hosted easily on common static deployment platforms.

## Bonus Features

- Advanced filtering across date range, outlet, category, order type, and settlement.
- Filtered CSV export for additional offline analysis.
- Generated insight cards that summarize the current dashboard view.
- Responsive desktop and mobile layout.
- Performance optimizations through precomputed aggregates, dictionary-encoded JSON, and static-host cache headers for the analytics payload.
- Deployment configuration for Vercel cache behavior.

## Deployment

1. Run `npm.cmd run build:data`.
2. Push the project to a public GitHub repository.
3. Import the repository in Vercel.
4. Use these Vercel settings:
   - Framework Preset: `Other`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: leave default or empty

Do not run `npm run build:data` on Vercel unless you also upload `data.xlsx`. The raw workbook is ignored from Git, and the committed `public/data/analytics.json` is what the deployed static dashboard reads. `npm run build` only copies the static dashboard into `dist` for Vercel.

Deployed URL: _add after deployment_
GitHub repository: _add after publishing_
