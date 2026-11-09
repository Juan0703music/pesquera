import { $, $$, api, connectLive, debounce, esc, fmt, icon, LABELS, startShell } from "/js/core.js";
import { Bars3D } from "/js/chart3d.js";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** Color de cada categoría: sigue a la categoría (por su orden), nunca a su posición en el ranking. */
const seriesColor = (index) => css(`--series-${(index % 8) + 1}`);
const HOUR_LABEL = (hour) => `${hour}:00`;
const dayLabel = (date, long = false) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("es-CO", long ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { weekday: "short", day: "numeric", timeZone: "UTC" });

const state = { data: null, seenActivity: new Set(), firstLoad: true };
let hoursChart;
let stockChart;
let daysChart;

/* ───────────── Cifras ───────────── */
function delta(now, before) {
  if (!before) return now ? '<span class="muted">sin ventas ayer a esta hora</span>' : '<span class="muted">igual que ayer</span>';
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return '<span class="muted">igual que ayer a esta hora</span>';
  return `<span class="${pct > 0 ? "delta-up" : "delta-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)} %</span> <span class="muted">vs. ayer a esta hora</span>`;
}

function renderKpis({ kpis }) {
  const tiles = [
    ["cash", "Ventas de hoy", fmt.cop(kpis.salesToday), delta(kpis.salesToday, kpis.salesYesterdaySameTime)],
    ["checkCircle", "Pedidos vendidos", fmt.num(kpis.ordersToday), `<span class="muted">ayer a esta hora: ${kpis.ordersYesterdaySameTime}</span>`],
    ["bag", "Ticket promedio", fmt.cop(kpis.avgTicket), '<span class="muted">por pedido</span>'],
    ["scale", "Kilos vendidos", `${fmt.num(kpis.kgSoldMilli / 1000)} kg`, '<span class="muted">pescado y mariscos</span>'],
    ["inbox", "Por despachar", fmt.num(kpis.openOrders), `<span class="muted">${kpis.onTheWay} en camino</span>`],
    ["clock", "Tiempo de despacho", kpis.avgDispatchMinutes === null ? "—" : `${kpis.avgDispatchMinutes} min`, '<span class="muted">promedio, de recibido a despachado</span>'],
    ["cash", "Cobrado hoy", fmt.cop(kpis.collectedToday), `<span class="muted">por cobrar ${fmt.cop(kpis.salesToday - kpis.collectedToday)}</span>`],
    ["alert", "Alertas de bodega", fmt.num(kpis.lowStock), `<span class="muted">valor en bodega ${fmt.copShort(kpis.inventoryValue)}</span>`],
  ];
  $("#kpis").innerHTML = tiles
    .map(([iconName, label, value, hint]) => `<div class="card stat"><div class="label">${icon(iconName, "icon-sm")}${label}</div><div class="value num">${value}</div><div class="hint">${hint}</div></div>`)
    .join("");
}

function renderPipeline({ pipeline }) {
  const icons = { RECIBIDO: "inbox", ALISTANDO: "scale", LISTO: "checkCircle", DESPACHADO: "truck", ENTREGADO: "bag", CANCELADO: "ban" };
  const names = { ...LABELS.status, ENTREGADO: "Entregados hoy", CANCELADO: "Cancelados hoy" };
  $("#pipeline").innerHTML = pipeline
    .map((row) => `<div class="pipe"><b>${row.count}</b><span>${icon(icons[row.status], "icon-sm")}${names[row.status]}</span></div>`)
    .join("");
}

function renderFeed({ activity }) {
  const statusIcon = { RECIBIDO: "inbox", ALISTANDO: "scale", LISTO: "checkCircle", DESPACHADO: "truck", ENTREGADO: "bag", CANCELADO: "ban", ENTRADA: "box", MERMA: "alert", AJUSTE: "edit" };
  $("#feed").innerHTML = activity
    .map((item) => {
      const id = `${item.kind}-${item.title}-${item.at}`;
      const fresh = !state.firstLoad && !state.seenActivity.has(id);
      state.seenActivity.add(id);
      const amount = item.kind === "order" ? fmt.cop(item.amount) : `${item.qtyMilli > 0 ? "+" : ""}${fmt.qty(item.qtyMilli, item.unit)}`;
      return `<li class="${fresh ? "fresh" : ""}"><span class="feed-icon">${icon(statusIcon[item.status] ?? "pulse", "icon-sm")}</span>
        <div><div class="feed-title">${esc(item.title)}</div><div class="feed-detail">${esc(item.detail || "")}</div></div>
        <div class="right"><div class="num">${amount}</div><time datetime="${item.at}">${fmt.time(item.at)}</time></div></li>`;
    })
    .join("") || '<li class="empty">Sin movimientos todavía.</li>';
  $("#feed-note").textContent = "se actualiza sola";
}

function rankRows(rows, valueText) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return rows.length
    ? rows.map((row) => `<div class="rank-row"><span>${esc(row.name)}</span><span class="num">${valueText(row)}</span><div class="bar"><i data-w="${((row.total / max) * 100).toFixed(1)}"></i></div></div>`).join("")
    : '<div class="empty">Todavía no hay ventas hoy.</div>';
}

function applyWidths(root) {
  // Los anchos se aplican con CSSOM (la política de seguridad no permite estilos en línea en el HTML).
  requestAnimationFrame(() => $$("[data-w]", root).forEach((node) => node.style.setProperty("--s", String(Number(node.dataset.w) / 100))));
}

function renderRanks({ topProducts, payments }) {
  $("#top").innerHTML = rankRows(topProducts, (row) => `${fmt.qty(row.qtyMilli, row.unit)} · ${fmt.cop(row.total)}`);
  $("#payments").innerHTML = rankRows(payments.map((row) => ({ ...row, name: row.label })), (row) => `${row.count} · ${fmt.cop(row.total)}`);
  applyWidths($("#top"));
  applyWidths($("#payments"));
}

/* ───────────── Leyendas y tablas ───────────── */
function renderLegends({ categories }) {
  for (const node of $$('[data-legend="categories"]')) {
    node.innerHTML = categories.map((category, index) => `<span><i class="swatch" data-sw="${index}"></i>${esc(category.name)}</span>`).join("");
    $$("[data-sw]", node).forEach((swatch) => swatch.style.setProperty("--sw", seriesColor(Number(swatch.dataset.sw))));
  }
  const stock = $("#legend-stock");
  stock.innerHTML = `
    <span><i class="swatch" data-tone="--stock-ok"></i>${icon("checkCircle", "icon-sm")}Bien</span>
    <span><i class="swatch" data-tone="--warning"></i>${icon("alert", "icon-sm")}Stock bajo</span>
    <span><i class="swatch" data-tone="--critical"></i>${icon("ban", "icon-sm")}Agotado</span>
    <span><i class="swatch" data-tone="--series-neutral"></i>Comprometido en pedidos abiertos</span>`;
  $$("[data-tone]", stock).forEach((swatch) => swatch.style.setProperty("--sw", css(swatch.dataset.tone)));
}

function table(details, head, rows) {
  details.querySelector("summary").innerHTML = `${icon("table", "icon-sm")}Ver como tabla`;
  details.querySelector(".table-wrap").innerHTML = `<table class="table"><thead><tr>${head.map((cell, i) => `<th class="${i ? "right" : ""}">${cell}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td class="${i ? "right num" : ""}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/* ───────────── Gráficas 3D ───────────── */
function hoursData(data) {
  const { categories, salesByHourCategory } = data;
  const nowHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(data.generatedAt)));
  const withSales = salesByHourCategory.map((row) => row.hour);
  const first = Math.min(6, ...withSales);
  const last = Math.max(19, Math.min(23, nowHour), ...withSales);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const lookup = new Map(salesByHourCategory.map((row) => [`${row.hour}|${row.categoryId}`, row.total]));
  const hourTotals = new Map(hours.map((hour) => [hour, categories.reduce((sum, c) => sum + (lookup.get(`${hour}|${c.id}`) ?? 0), 0)]));
  const cells = [];
  hours.forEach((hour, x) =>
    categories.forEach((category, z) => {
      const total = lookup.get(`${hour}|${category.id}`) ?? 0;
      if (total > 0) cells.push({ key: `${hour}|${category.id}`, x, z, segments: [{ value: total, color: seriesColor(z) }], label: fmt.copShort(total), meta: { hour, category, total, hourTotal: hourTotals.get(hour) } });
    }),
  );
  const peak = cells.reduce((best, cell) => (cell.meta.total > (best?.meta.total ?? 0) ? cell : best), null);
  return { cells, xLabels: hours.map(HOUR_LABEL), zLabels: categories.map((c) => c.name), xEvery: hours.length > 16 ? 2 : 1, direct: peak ? [peak.key] : [], hours, lookup, hourTotals };
}

function stockData(data) {
  const { categories, inventory } = data;
  const byCategory = categories.map((category) => inventory.filter((product) => product.categoryId === category.id));
  const width = Math.max(1, ...byCategory.map((list) => list.length));
  const tone = { OK: css("--stock-ok"), BAJO: css("--warning"), AGOTADO: css("--critical") };
  const cells = [];
  byCategory.forEach((products, z) =>
    products.forEach((product, x) => {
      const unitValue = product.stockMilli > 0 ? product.stockValue / product.stockMilli : 0;
      const committed = Math.min(product.committedMilli, product.stockMilli);
      const availableValue = Math.max(0, Math.round((product.stockMilli - committed) * unitValue));
      const committedValue = Math.round(committed * unitValue);
      const segments = product.level === "AGOTADO"
        ? [{ value: 0, color: tone.AGOTADO, marker: true }]
        : [{ value: availableValue, color: tone[product.level] }, ...(committedValue > 0 ? [{ value: committedValue, color: css("--series-neutral"), inset: 0.8 }] : [])];
      cells.push({ key: product.id, x, z, segments, label: product.level === "OK" ? "" : `${product.name}`, meta: product });
    }),
  );
  // Etiqueta directa solo para los 3 más críticos (agotados primero, luego el más lejos de su mínimo);
  // el resto se ve en el tooltip y en la tabla.
  const critical = cells
    .filter((cell) => cell.meta.level !== "OK")
    .sort((a, b) => (a.meta.level === "AGOTADO" ? -1 : 0) - (b.meta.level === "AGOTADO" ? -1 : 0) || a.meta.stockMilli / Math.max(1, a.meta.minStockMilli) - b.meta.stockMilli / Math.max(1, b.meta.minStockMilli))
    .slice(0, 3);
  return { cells, xLabels: Array(width).fill(""), zLabels: categories.map((c) => c.name), xEvery: 99, direct: critical.map((cell) => cell.key) };
}

function daysData(data) {
  const { categories, salesByDayCategory, days } = data;
  const lookup = new Map(salesByDayCategory.map((row) => [`${row.day}|${row.categoryId}`, row.total]));
  const dayTotals = new Map(days.map((day) => [day, categories.reduce((sum, c) => sum + (lookup.get(`${day}|${c.id}`) ?? 0), 0)]));
  const cells = [];
  days.forEach((day, x) =>
    categories.forEach((category, z) => {
      const total = lookup.get(`${day}|${category.id}`) ?? 0;
      if (total > 0) cells.push({ key: `${day}|${category.id}`, x, z, segments: [{ value: total, color: seriesColor(z) }], label: fmt.copShort(total), meta: { day, category, total, dayTotal: dayTotals.get(day) } });
    }),
  );
  const best = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  return { cells, xLabels: days.map((day, i) => (i === days.length - 1 ? "Hoy" : dayLabel(day))), zLabels: categories.map((c) => c.name), xEvery: 2, direct: [], lookup, dayTotals, best };
}

const tipRow = (label, value) => `<div class="tip-row"><span>${label}</span><b>${value}</b></div>`;

function setupCharts() {
  hoursChart = new Bars3D($("#viz-hours"), {
    label: "Ventas de hoy por hora y categoría en 3D. Hay una tabla con los mismos datos debajo.",
    valueFormat: fmt.copShort,
    tooltip: ({ meta }) =>
      `<strong>${HOUR_LABEL(meta.hour)} – ${HOUR_LABEL(meta.hour + 1)} · ${esc(meta.category.name)}</strong>${tipRow("Ventas", fmt.cop(meta.total))}${tipRow("Total de la hora", fmt.cop(meta.hourTotal))}${tipRow("Participación", `${Math.round((meta.total / meta.hourTotal) * 100)} %`)}`,
  });
  stockChart = new Bars3D($("#viz-stock"), {
    label: "Bodega en 3D: valor en bodega por producto, coloreado por nivel de existencia. Hay una tabla con los mismos datos debajo.",
    valueFormat: fmt.copShort,
    height: 3.4,
    view: { theta: -0.42, phi: 0.86 },
    tooltip: ({ meta: p }) =>
      `<strong>${esc(p.name)}</strong>${tipRow("Existencia", fmt.qty(p.stockMilli, p.unit))}${tipRow("Comprometido", fmt.qty(p.committedMilli, p.unit))}${tipRow("Disponible", fmt.qty(Math.max(0, p.availableMilli), p.unit))}${tipRow("Mínimo", fmt.qty(p.minStockMilli, p.unit))}${tipRow("Valor en bodega", fmt.cop(p.stockValue))}${tipRow("Nivel", LABELS.level[p.level])}`,
  });
  daysChart = new Bars3D($("#viz-days"), {
    label: "Ventas de los últimos 14 días por categoría en 3D. Hay una tabla con los mismos datos debajo.",
    valueFormat: fmt.copShort,
    view: { theta: -0.32, phi: 0.92 },
    tooltip: ({ meta }) =>
      `<strong>${dayLabel(meta.day, true)} · ${esc(meta.category.name)}</strong>${tipRow("Ventas", fmt.cop(meta.total))}${tipRow("Total del día", fmt.cop(meta.dayTotal))}`,
  });
  const hint = `${icon("pulse", "icon-sm")} Arrastra para girar · rueda para acercar · doble clic para centrar · pasa el mouse por una barra para ver el detalle`;
  $$("[data-hint]").forEach((node) => (node.innerHTML = hint));
}

function renderCharts(data) {
  const hours = hoursData(data);
  hoursChart.setData(hours);
  table(
    $("#table-hours"),
    ["Hora", ...data.categories.map((c) => esc(c.name)), "Total"],
    hours.hours.filter((hour) => hours.hourTotals.get(hour) > 0).map((hour) => [HOUR_LABEL(hour), ...data.categories.map((c) => fmt.cop(hours.lookup.get(`${hour}|${c.id}`) ?? 0)), fmt.cop(hours.hourTotals.get(hour))]),
  );

  stockChart.setData(stockData(data));
  table(
    $("#table-stock"),
    ["Producto", "Existencia", "Comprometido", "Disponible", "Mínimo", "Valor", "Nivel"],
    data.inventory.map((p) => [esc(p.name), fmt.qty(p.stockMilli, p.unit), fmt.qty(p.committedMilli, p.unit), fmt.qty(Math.max(0, p.availableMilli), p.unit), fmt.qty(p.minStockMilli, p.unit), fmt.cop(p.stockValue), LABELS.level[p.level]]),
  );

  const days = daysData(data);
  daysChart.setData(days);
  table(
    $("#table-days"),
    ["Día", ...data.categories.map((c) => esc(c.name)), "Total"],
    [...data.days].reverse().map((day) => [dayLabel(day, true), ...data.categories.map((c) => fmt.cop(days.lookup.get(`${day}|${c.id}`) ?? 0)), fmt.cop(days.dayTotals.get(day))]),
  );
}

/* ───────────── Carga y tiempo real ───────────── */
async function load() {
  try {
    const { data } = await api("/analytics/live");
    state.data = data;
    renderKpis(data);
    renderPipeline(data);
    renderFeed(data);
    renderRanks(data);
    renderLegends(data);
    renderCharts(data);
    $("#updated").textContent = `${dayLabel(data.date, true)} · actualizado a las ${new Date(data.generatedAt).toLocaleTimeString("es-CO")}`;
    state.firstLoad = false;
  } catch (error) {
    $("#updated").textContent = error.message;
  }
}
const reload = debounce(load, 400);

await startShell("en-vivo", "analytics.view");
setupCharts();
await load();

const clock = () => ($("#clock").textContent = new Date().toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
clock();
setInterval(clock, 1000);
// Además de los avisos, se refresca cada minuto (comparación con ayer «a esta hora», minutos transcurridos).
setInterval(load, 60_000);
// Las series de cada tema tienen sus propios pasos: al cambiar de tema se vuelven a leer y pintar.
window.addEventListener("marea:tema", () => state.data && (renderLegends(state.data), renderCharts(state.data)));

// Modo pantalla: el tablero ocupa todo el televisor (sin menú, cifras más grandes).
const wallButton = $("#wall");
wallButton.innerHTML = `${icon("expand")}Modo pantalla`;
wallButton.addEventListener("click", async () => {
  const entering = !document.body.classList.contains("wall");
  document.body.classList.toggle("wall", entering);
  wallButton.setAttribute("aria-pressed", String(entering));
  try {
    if (entering && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!entering && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // Sin pantalla completa (permiso o navegador): el modo pantalla igual quita el menú.
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("wall")) {
    document.body.classList.remove("wall");
    wallButton.setAttribute("aria-pressed", "false");
  }
});

connectLive(() => reload());
