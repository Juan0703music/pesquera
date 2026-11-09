import { $, $$, api, can, connectLive, debounce, esc, fmt, icon, LABELS, showError, startShell } from "/js/core.js";

const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const shift = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function rank(rows, valueText) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return rows.length
    ? rows.map((row) => `<div class="rank-row"><span>${esc(row.name)}</span><span class="num">${valueText(row)}</span><div class="bar"><i data-w="${((row.total / max) * 100).toFixed(1)}"></i></div></div>`).join("")
    : '<div class="empty">Sin ventas.</div>';
}

async function load() {
  const date = $("#date").value || todayStr();
  try {
    const { data } = await api(`/sales/day?date=${date}`);
    const s = data.summary;
    const isToday = date === todayStr();
    $("#day-label").textContent = `${longDate(date)}${isToday ? " · se actualiza en vivo" : ""}`;
    $("#next").disabled = isToday;
    const tiles = [
      ["cash", "Ventas", fmt.cop(s.total), `${s.count} pedidos · domicilios ${fmt.cop(s.deliveryFees)}`],
      ["bag", "Ticket promedio", fmt.cop(s.avgTicket), "por pedido"],
      ["scale", "Vendido", `${fmt.num(s.kgMilli / 1000)} kg`, `${fmt.num(s.unitsMilli / 1000)} unidades`],
      ["checkCircle", "Ganancia estimada", fmt.cop(s.grossProfit), `margen ${fmt.num(s.marginPct)} % · costo ${fmt.cop(s.costOfGoods)}`],
      ["cash", "Cobrado", fmt.cop(s.collected), "efectivo, Nequi, transferencias…"],
      ["clock", "Por cobrar", fmt.cop(s.pending), "crédito y pagos pendientes"],
      ["ban", "Cancelados", fmt.num(s.cancelled), "pedidos anulados ese día"],
      ["orders", "Pedidos", fmt.num(s.count), "despachados o entregados"],
    ];
    $("#stats").innerHTML = tiles
      .map(([iconName, label, value, hint]) => `<div class="card stat"><div class="label">${icon(iconName, "icon-sm")}${label}</div><div class="value num">${value}</div><div class="hint">${hint}</div></div>`)
      .join("");

    $("#sales-count").textContent = `${data.orders.length} ventas`;
    $("#sales").innerHTML = data.orders.length
      ? `<table class="table"><thead><tr><th>Hora</th><th>#</th><th>Cliente</th><th>Origen</th><th>Pago</th><th class="right">Total</th></tr></thead><tbody>
        ${data.orders.map((order) => `<tr>
          <td class="num">${fmt.time(order.dispatchedAt)}</td><td class="num">#${order.number}</td>
          <td>${esc(order.customerName)}<br><span class="muted">${LABELS.delivery[order.deliveryType]}${order.createdByName ? ` · ${esc(order.createdByName)}` : ""}</span></td>
          <td>${LABELS.source[order.source]}</td>
          <td>${order.paid ? esc(order.paymentLabel) : `<span class="badge badge-warning">${icon("clock")}Por cobrar · ${esc(order.paymentLabel)}</span>`}</td>
          <td class="right num"><strong>${fmt.cop(order.total)}</strong></td></tr>`).join("")}
        </tbody></table>`
      : '<div class="empty">No hubo ventas este día.</div>';

    $("#closing").innerHTML = `
      <table class="table"><thead><tr><th>Forma de pago</th><th class="right">Pedidos</th><th class="right">Total</th></tr></thead><tbody>
        ${data.byPayment.map((row) => `<tr><td>${esc(row.label)}</td><td class="right num">${row.count}</td><td class="right num">${fmt.cop(row.total)}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">Sin ventas.</td></tr>'}
      </tbody></table>
      <div class="totals">
        <div><span>Cobrado</span><span class="num">${fmt.cop(s.collected)}</span></div>
        <div><span>Por cobrar</span><span class="num">${fmt.cop(s.pending)}</span></div>
        <div class="grand"><span>Total vendido</span><span class="num">${fmt.cop(s.total)}</span></div>
      </div>`;
    $("#top").innerHTML = rank(data.topProducts, (row) => `${fmt.qty(row.qtyMilli, row.unit)} · ${fmt.cop(row.total)}`);
    $("#sources").innerHTML = rank(data.bySource.map((row) => ({ ...row, name: LABELS.source[row.source] })), (row) => `${row.count} · ${fmt.cop(row.total)}`);
    requestAnimationFrame(() => $$("[data-w]").forEach((node) => node.style.setProperty("--s", String(Number(node.dataset.w) / 100))));
  } catch (error) {
    showError(error);
  }
}
const reload = debounce(load, 400);

await startShell("ventas", "sales.view");
$("#prev").innerHTML = `<span aria-hidden="true">‹</span>`;
$("#next").innerHTML = `<span aria-hidden="true">›</span>`;
$("#print").innerHTML = `${icon("print")}Imprimir cierre`;
const params = new URLSearchParams(location.search);
$("#date").value = params.get("fecha") ?? todayStr();
$("#date").max = todayStr();
const go = (date) => {
  $("#date").value = date;
  history.replaceState(null, "", date === todayStr() ? location.pathname : `?fecha=${date}`);
  load();
};
$("#date").addEventListener("change", () => go($("#date").value));
$("#prev").addEventListener("click", () => go(shift($("#date").value, -1)));
$("#next").addEventListener("click", () => go(shift($("#date").value, 1)));
$("#today").addEventListener("click", () => go(todayStr()));
$("#print").addEventListener("click", () => print());
await load();
connectLive((event) => {
  if ((event.scope === "orders" || event.scope === "all") && $("#date").value === todayStr() && can("sales.view")) reload();
});
