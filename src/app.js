const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const integer = new Intl.NumberFormat("en-IN");

const palette = ["#0f766e", "#c2410c", "#2563eb", "#b7791f", "#15803d", "#7c3aed", "#be123c", "#0369a1"];
let state;
let charts = {};

const O = { date: 0, outlet: 1, orderType: 2, settlement: 3, revenue: 4, quantity: 5, records: 6, groupMask: 7 };
const L = { date: 0, outlet: 1, brand: 2, group: 3, orderType: 4, settlement: 5, revenue: 6, quantity: 7, records: 8 };
const I = { date: 0, outlet: 1, brand: 2, group: 3, item: 4, orderType: 5, revenue: 6, quantity: 7, records: 8 };

const elements = {
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  outlet: document.getElementById("outletFilter"),
  group: document.getElementById("groupFilter"),
  orderType: document.getElementById("orderTypeFilter"),
  settlement: document.getElementById("settlementFilter"),
  revenue: document.getElementById("revenueKpi"),
  orders: document.getElementById("ordersKpi"),
  records: document.getElementById("recordsKpi"),
  quantity: document.getElementById("quantityKpi"),
  aov: document.getElementById("aovKpi"),
  topItems: document.getElementById("topItemsBody")
};

async function boot() {
  try {
    const response = await fetch("public/data/analytics.json");
    if (!response.ok) {
      throw new Error("Run npm run build:data before opening the dashboard.");
    }

    state = await response.json();
    indexDimensions();
    setupFilters();
    render();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function setupFilters() {
  elements.dateFrom.value = state.metadata.dateMin;
  elements.dateTo.value = state.metadata.dateMax;
  populateSelect(elements.outlet, state.dimensions.outlets, "All outlets");
  populateSelect(elements.group, state.dimensions.groups, "All categories");
  populateSelect(elements.orderType, state.dimensions.orderTypes, "All order types");
  populateSelect(elements.settlement, state.dimensions.settlements, "All settlements");

  [elements.dateFrom, elements.dateTo, elements.outlet, elements.group, elements.orderType, elements.settlement]
    .forEach((control) => control.addEventListener("change", render));
}

function populateSelect(select, values, allLabel) {
  select.innerHTML = "";
  select.append(new Option(allLabel, ""));
  values.forEach((value) => select.append(new Option(value, value)));
}

function getFilters() {
  return {
    from: elements.dateFrom.value || state.metadata.dateMin,
    to: elements.dateTo.value || state.metadata.dateMax,
    fromIndex: state.dateIndex[elements.dateFrom.value || state.metadata.dateMin],
    toIndex: state.dateIndex[elements.dateTo.value || state.metadata.dateMax],
    outlet: elements.outlet.value,
    outletIndex: elements.outlet.value ? state.valueIndex.outlets[elements.outlet.value] : -1,
    group: elements.group.value,
    groupIndex: elements.group.value ? state.valueIndex.groups[elements.group.value] : -1,
    orderType: elements.orderType.value,
    orderTypeIndex: elements.orderType.value ? state.valueIndex.orderTypes[elements.orderType.value] : -1,
    settlement: elements.settlement.value,
    settlementIndex: elements.settlement.value ? state.valueIndex.settlements[elements.settlement.value] : -1
  };
}

function dateMatches(dateIndex, filters) {
  return dateIndex >= filters.fromIndex && dateIndex <= filters.toIndex;
}

function orderMatches(order, filters) {
  return dateMatches(order[O.date], filters)
    && (filters.outletIndex < 0 || order[O.outlet] === filters.outletIndex)
    && (filters.orderTypeIndex < 0 || order[O.orderType] === filters.orderTypeIndex)
    && (filters.settlementIndex < 0 || order[O.settlement] === filters.settlementIndex)
    && (filters.groupIndex < 0 || (order[O.groupMask] & (1 << filters.groupIndex)));
}

function lineMatches(row, filters) {
  return dateMatches(row[L.date], filters)
    && (filters.outletIndex < 0 || row[L.outlet] === filters.outletIndex)
    && (filters.groupIndex < 0 || row[L.group] === filters.groupIndex)
    && (filters.orderTypeIndex < 0 || row[L.orderType] === filters.orderTypeIndex)
    && (filters.settlementIndex < 0 || row[L.settlement] === filters.settlementIndex);
}

function itemMatches(row, filters) {
  return dateMatches(row[I.date], filters)
    && (filters.outletIndex < 0 || row[I.outlet] === filters.outletIndex)
    && (filters.groupIndex < 0 || row[I.group] === filters.groupIndex)
    && (filters.orderTypeIndex < 0 || row[I.orderType] === filters.orderTypeIndex);
}

function render() {
  const filters = getFilters();
  const orders = state.orders.filter((order) => orderMatches(order, filters));
  const lines = state.lineCube.filter((row) => lineMatches(row, filters));
  const items = state.itemCube.filter((row) => itemMatches(row, filters));

  const revenue = sum(orders, O.revenue);
  const records = sum(orders, O.records);
  const quantity = sum(orders, O.quantity);
  const aov = orders.length ? revenue / orders.length : 0;

  elements.revenue.textContent = money.format(revenue);
  elements.orders.textContent = integer.format(orders.length);
  elements.records.textContent = integer.format(records);
  elements.quantity.textContent = integer.format(quantity);
  elements.aov.textContent = money.format(aov);

  renderTrend(orders);
  renderCategory(lines);
  renderOrderType(orders);
  renderTopItems(items);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function groupRows(rows, key, valueKey) {
  return rows.reduce((map, row) => {
    map[row[key]] = (map[row[key]] || 0) + Number(row[valueKey] || 0);
    return map;
  }, {});
}

function upsertChart(id, config) {
  if (charts[id]) {
    charts[id].destroy();
  }

  charts[id] = new Chart(document.getElementById(id), config);
}

function renderTrend(orders) {
  const grouped = groupRows(orders, O.date, O.revenue);
  const keys = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  const labels = keys.map((key) => state.dimensions.dates[key]);
  const data = keys.map((key) => Math.round(grouped[key]));

  upsertChart("trendChart", {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Revenue",
        data,
        borderColor: "#0f766e",
        backgroundColor: "rgba(15, 118, 110, 0.14)",
        fill: true,
        pointRadius: 0,
        tension: 0.25
      }]
    },
    options: chartOptions(true)
  });
}

function renderCategory(lines) {
  const grouped = groupRows(lines, L.group, L.revenue);
  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);

  upsertChart("categoryChart", {
    type: "bar",
    data: {
      labels: entries.map(([label]) => state.dimensions.groups[label]),
      datasets: [{
        label: "Revenue",
        data: entries.map(([, value]) => Math.round(value)),
        backgroundColor: palette
      }]
    },
    options: chartOptions(false)
  });
}

function renderOrderType(orders) {
  const grouped = groupRows(orders, O.orderType, O.revenue);
  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);

  upsertChart("orderTypeChart", {
    type: "doughnut",
    data: {
      labels: entries.map(([label]) => state.dimensions.orderTypes[label]),
      datasets: [{
        data: entries.map(([, value]) => Math.round(value)),
        backgroundColor: palette
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (context) => `${context.label}: ${money.format(context.raw)}` } }
      }
    }
  });
}

function renderTopItems(items) {
  const grouped = items.reduce((map, row) => {
    const key = `${row[I.item]}|${row[I.group]}`;
    if (!map[key]) {
      map[key] = {
        item: state.dimensions.items[row[I.item]],
        group: state.dimensions.groups[row[I.group]],
        revenue: 0,
        quantity: 0
      };
    }
    map[key].revenue += Number(row[I.revenue] || 0);
    map[key].quantity += Number(row[I.quantity] || 0);
    return map;
  }, {});

  elements.topItems.innerHTML = Object.values(grouped)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12)
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.item)}</td>
        <td>${escapeHtml(row.group)}</td>
        <td>${money.format(row.revenue)}</td>
        <td>${integer.format(row.quantity)}</td>
      </tr>
    `)
    .join("");
}

function chartOptions(showMoneyTooltip) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => showMoneyTooltip
            ? `${context.dataset.label}: ${money.format(context.raw)}`
            : money.format(context.raw)
        }
      }
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { callback: (value) => money.format(value) }
      }
    }
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

boot();

function indexDimensions() {
  state.dateIndex = Object.fromEntries(state.dimensions.dates.map((value, index) => [value, index]));
  state.valueIndex = Object.fromEntries(
    ["outlets", "brands", "groups", "orderTypes", "settlements", "items"]
      .map((key) => [key, Object.fromEntries(state.dimensions[key].map((value, index) => [value, index]))])
  );
}
