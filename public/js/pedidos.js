import {
  $, $$, api, ApiError, can, chime, connectLive, debounce, esc, fmt, icon, LABELS, openDialog, setOpenCount, showError, showFieldErrors, startShell, toast,
} from "/js/core.js";
import { bindCopy, copyText, payAccountHtml, paymentText } from "/js/pay.js";

const COLUMNS = [
  { status: "RECIBIDO", title: "Recibidos", icon: "inbox" },
  { status: "ALISTANDO", title: "Alistando", icon: "scale" },
  { status: "LISTO", title: "Listos", icon: "checkCircle" },
  { status: "DESPACHADO", title: "En camino", icon: "truck" },
];
/** Minutos a partir de los cuales un pedido abierto se marca como demorado. */
const LATE_MINUTES = 30;

const state = { orders: [], products: [], settings: null, lines: [], openId: null, lastSubmit: 0, seen: new Set(), firstLoad: true };

/* ───────────── Tablero ───────────── */
function nextAction(order) {
  if (order.status === "RECIBIDO") return { to: "ALISTANDO", label: "Alistar", icon: "scale" };
  if (order.status === "ALISTANDO") return { to: "LISTO", label: "Marcar listo", icon: "check" };
  if (order.status === "LISTO") return order.deliveryType === "DOMICILIO" ? { to: "DESPACHADO", label: "Despachar", icon: "truck" } : { to: "ENTREGADO", label: "Entregar al cliente", icon: "bag" };
  if (order.status === "DESPACHADO") return { to: "ENTREGADO", label: "Entregado", icon: "checkCircle" };
  return null;
}

function itemsSummary(order) {
  return order.items.map((item) => `${fmt.qty(item.actualQtyMilli ?? item.qtyMilli, item.unit)} ${item.productName}`).join(" · ");
}

function matchesFilters(order) {
  const query = $("#search").value.trim().toLowerCase();
  const delivery = $('input[name="filter-delivery"]:checked').value;
  if (delivery && order.deliveryType !== delivery) return false;
  if (!query) return true;
  return `#${order.number} ${order.customerName} ${order.customerPhone ?? ""} ${order.items.map((item) => item.productName).join(" ")}`.toLowerCase().includes(query);
}

function card(order) {
  const late = fmt.minutesSince(order.createdAt) > LATE_MINUTES && order.status !== "DESPACHADO";
  const action = can("orders.dispatch") ? nextAction(order) : null;
  const unweighed = order.status !== "RECIBIDO" && order.items.some((item) => item.unit === "KG" && item.actualQtyMilli === null);
  return `
    <article class="order-card${state.seen.has(order.id) || state.firstLoad ? "" : " is-new"}" data-id="${order.id}">
      <div class="order-top">
        <button class="btn-ghost order-num" data-open="${order.id}" aria-label="Ver pedido ${order.number} de ${esc(order.customerName)}">#${order.number}</button>
        <span class="badge" title="${LABELS.source[order.source]}">${icon(LABELS.sourceIcon[order.source])}${LABELS.source[order.source]}</span>
        <span class="order-time${late ? " late" : ""}" title="Recibido a las ${fmt.time(order.createdAt)}">${icon("clock", "icon-sm")}${fmt.ago(order.createdAt)}</span>
      </div>
      <div class="order-customer">${esc(order.customerName)}</div>
      <div class="order-items">${esc(itemsSummary(order))}</div>
      <div class="order-foot">
        <span class="badge">${icon(order.deliveryType === "DOMICILIO" ? "truck" : "bag")}${LABELS.delivery[order.deliveryType]}</span>
        ${order.paid ? `<span class="badge badge-good">${icon("check")}Pagado</span>` : order.paymentMethod === "CREDITO" ? '<span class="badge badge-warning">Crédito</span>' : ""}
        ${unweighed ? `<span class="badge badge-warning" title="Hay productos por kilo sin pesar">${icon("scale")}Sin pesar</span>` : ""}
        <span class="order-total num">${fmt.cop(order.total)}</span>
      </div>
      ${action ? `<button class="btn btn-sm order-next" data-advance="${order.id}" data-to="${action.to}">${icon(action.icon)}${action.label}</button>` : ""}
    </article>`;
}

function renderBoard() {
  const open = state.orders.filter((order) => COLUMNS.some((column) => column.status === order.status));
  const visible = open.filter(matchesFilters);
  $("#board").innerHTML = COLUMNS.map((column) => {
    const orders = visible.filter((order) => order.status === column.status);
    return `
      <section class="column" data-stage="${column.status}" aria-label="${column.title}">
        <div class="column-head"><span class="stage-dot" aria-hidden="true"></span>${column.title}<span class="badge count">${orders.length}</span></div>
        <div class="column-list">${orders.map(card).join("") || '<div class="empty">Nada por aquí.</div>'}</div>
      </section>`;
  }).join("");

  const closed = state.orders.filter((order) => order.status === "ENTREGADO" || order.status === "CANCELADO").filter(matchesFilters).reverse();
  $("#closed-count").textContent = `${closed.length} pedidos`;
  $("#closed").innerHTML = closed.length
    ? `<table class="table"><thead><tr><th>#</th><th>Cliente</th><th>Origen</th><th>Estado</th><th>Pago</th><th class="right">Total</th></tr></thead><tbody>
        ${closed.map((order) => `<tr data-open="${order.id}"><td class="num"><button class="btn btn-ghost btn-sm" data-open="${order.id}">#${order.number}</button></td><td>${esc(order.customerName)}</td><td>${LABELS.source[order.source]}</td>
          <td>${order.status === "CANCELADO" ? `<span class="badge badge-critical">${icon("ban")}Cancelado</span>` : `<span class="badge badge-good">${icon("checkCircle")}Entregado</span>`}</td>
          <td>${order.paid ? "Pagado" : order.status === "CANCELADO" ? "—" : `<span class="badge badge-warning">Por cobrar</span>`}</td><td class="right num">${fmt.cop(order.total)}</td></tr>`).join("")}
      </tbody></table>`
    : '<div class="empty">Todavía no se ha cerrado ningún pedido hoy.</div>';

  const counts = Object.fromEntries(COLUMNS.map((column) => [column.status, open.filter((order) => order.status === column.status).length]));
  const waiting = counts.RECIBIDO + counts.ALISTANDO + counts.LISTO;
  setOpenCount(waiting);
  $("#board-summary").textContent = `${waiting} por despachar · ${counts.DESPACHADO} en camino · ${closed.filter((order) => order.status === "ENTREGADO").length} entregados hoy`;
  for (const order of state.orders) state.seen.add(order.id);
  state.firstLoad = false;
}

async function loadBoard() {
  try {
    const { data } = await api("/orders?view=board");
    state.orders = data;
    renderBoard();
  } catch (error) {
    showError(error);
  }
}
const reloadBoard = debounce(loadBoard, 250);

async function advance(id, to, button) {
  if (button) button.disabled = true;
  try {
    const { data } = await api(`/orders/${id}/status`, { method: "POST", body: { status: to } });
    toast(`Pedido #${data.number}: ${LABELS.status[data.status].toLowerCase()}`);
    await loadBoard();
    if (state.openId === id) await openDetail(id);
  } catch (error) {
    showError(error);
    if (button) button.disabled = false;
  }
}

/* ───────────── Detalle (panel lateral) ───────────── */
async function openDetail(id) {
  const dialog = $("#detail-dialog");
  state.openId = id;
  let order;
  try {
    ({ data: order } = await api(`/orders/${id}`));
  } catch (error) {
    showError(error);
    return;
  }
  const isOpen = ["RECIBIDO", "ALISTANDO", "LISTO"].includes(order.status);
  const canWeigh = isOpen && can("orders.dispatch");
  const action = can("orders.dispatch") ? nextAction(order) : null;
  const canCancel = order.status !== "CANCELADO" && can("orders.cancel") && (isOpen || can("admin.manage"));
  const statusBadge = order.status === "CANCELADO" ? `<span class="badge badge-critical">${icon("ban")}Cancelado</span>` : `<span class="badge badge-brand">${LABELS.status[order.status]}</span>`;
  const phone = order.customerPhone;

  $("#detail").innerHTML = `
    <div class="drawer-head">
      <h2 id="detail-title">Pedido #${order.number}</h2>${statusBadge}
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-icon" data-close-detail aria-label="Cerrar">${icon("x")}</button>
    </div>
    <div class="drawer-body">
      <div class="section-title">Cliente</div>
      <div class="stack">
        <div><strong>${esc(order.customerName)}</strong>${phone ? ` · <a href="tel:+${phone}">${esc(phone.slice(2).replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3"))}</a> · <a href="https://wa.me/${phone}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
        <div class="row">
          <span class="badge">${icon(LABELS.sourceIcon[order.source])}${LABELS.source[order.source]}</span>
          <span class="badge">${icon(order.deliveryType === "DOMICILIO" ? "truck" : "bag")}${LABELS.delivery[order.deliveryType]}</span>
          <span class="muted">Recibido ${fmt.dateTime(order.createdAt)}${order.createdByName ? ` por ${esc(order.createdByName)}` : ""}</span>
        </div>
        ${order.address ? `<div>${icon("truck", "icon-sm")} ${esc(order.address)}</div>` : ""}
        ${order.notes ? `<div class="warn-box">${esc(order.notes)}</div>` : ""}
        ${order.cancelReason ? `<div class="error-box">Cancelado: ${esc(order.cancelReason)}</div>` : ""}
      </div>

      <div class="section-title">Productos${canWeigh ? " · escribe el peso real al alistar" : ""}</div>
      <form id="weigh-form">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Producto</th><th class="right">Pedido</th><th class="right">Real</th><th class="right">Valor</th></tr></thead>
          <tbody>${order.items.map((item) => `
            <tr>
              <td><strong>${esc(item.productName)}</strong><br><span class="muted">${fmt.cop(item.unitPrice)} / ${fmt.unitLabel(item.unit)}${item.note ? ` · ${esc(item.note)}` : ""}</span></td>
              <td class="right num">${fmt.qty(item.qtyMilli, item.unit)}</td>
              <td class="right">${canWeigh
                ? `<label class="sr-only" for="w-${item.id}">Peso real de ${esc(item.productName)}</label><input class="input num weigh-input" id="w-${item.id}" data-item="${item.id}" inputmode="decimal" value="${item.actualQtyMilli !== null ? fmt.num(item.actualQtyMilli / 1000) : ""}" placeholder="${fmt.num(item.qtyMilli / 1000)}" />`
                : item.actualQtyMilli !== null ? `<span class="num">${fmt.qty(item.actualQtyMilli, item.unit)}</span>` : '<span class="muted">—</span>'}</td>
              <td class="right num">${fmt.cop(item.lineTotal)}</td>
            </tr>`).join("")}
          </tbody></table></div>
        ${canWeigh ? `<div class="row"><button class="btn btn-sm" type="submit">${icon("scale")}Guardar pesos</button><span class="muted">Vacío = se despacha lo pedido.</span></div>` : ""}
      </form>
      <div class="totals">
        <div><span>Subtotal</span><span class="num">${fmt.cop(order.subtotal)}</span></div>
        ${order.deliveryFee ? `<div><span>Domicilio</span><span class="num">${fmt.cop(order.deliveryFee)}</span></div>` : ""}
        <div class="grand"><span>Total</span><span class="num">${fmt.cop(order.total)}</span></div>
      </div>

      <div class="section-title">Pago</div>
      <div class="row">
        ${order.paid ? `<span class="badge badge-good">${icon("check")}Pagado · ${LABELS.payment[order.paymentMethod]}</span>` : `<span class="badge badge-warning">${icon("clock")}Por cobrar · ${LABELS.payment[order.paymentMethod]}</span>`}
        ${can("orders.collect") && order.status !== "CANCELADO" && !order.paid ? `
          <label class="sr-only" for="collect-method">Forma de pago</label>
          <select class="input input-inline" id="collect-method">
            ${Object.entries(LABELS.payment).map(([value, label]) => `<option value="${value}" ${value === order.paymentMethod && value !== "CREDITO" ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="btn btn-sm" id="collect">${icon("cash")}Registrar pago</button>
          <button class="btn btn-sm btn-soft" id="show-pay">${icon("qr")}Cobrar con QR</button>` : ""}
      </div>

      <div class="section-title">Historial</div>
      <ol class="timeline">${order.events.map((event) => `
        <li><span class="dot${event.status === "CANCELADO" ? " cancel" : ""}"></span><div><strong>${LABELS.status[event.status]}</strong>${event.note ? ` · ${esc(event.note)}` : ""}<br><span class="muted">${fmt.dateTime(event.createdAt)}${event.userName ? ` · ${esc(event.userName)}` : ""}</span></div></li>`).join("")}
      </ol>

      <form id="cancel-form" class="stack" hidden>
        <div class="section-title">Cancelar pedido</div>
        ${isOpen ? "" : '<div class="warn-box">El pedido ya salió: al anularlo, la mercancía vuelve al inventario.</div>'}
        <label class="field"><span>Motivo</span><input class="input" name="reason" required minlength="3" maxlength="200" placeholder="El cliente ya no lo necesita" /></label>
        <div class="row"><button class="btn btn-danger" type="submit">${icon("ban")}Confirmar cancelación</button><button class="btn btn-ghost" type="button" id="cancel-back">Volver</button></div>
      </form>
    </div>
    <div class="drawer-foot">
      ${canCancel ? `<button class="btn btn-danger" id="cancel-open">${icon("ban")}${isOpen ? "Cancelar" : "Anular"}</button>` : ""}
      <div class="spacer"></div>
      ${action ? `<button class="btn btn-primary" id="detail-advance" data-to="${action.to}">${icon(action.icon)}${action.label}</button>` : ""}
    </div>`;
  openDialog(dialog);

  $("[data-close-detail]").addEventListener("click", () => dialog.close());
  $("#detail-advance")?.addEventListener("click", (event) => advance(order.id, event.currentTarget.dataset.to, event.currentTarget));
  $("#weigh-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const items = $$("[data-item]", event.currentTarget)
      .filter((input) => input.value.trim() !== "")
      .map((input) => ({ itemId: input.dataset.item, actualQty: Number(input.value.replace(",", ".")) }));
    if (!items.length) return toast("Escribe al menos un peso.", { error: true });
    if (items.some((item) => !Number.isFinite(item.actualQty) || item.actualQty <= 0)) return toast("Revisa los pesos: deben ser números mayores que cero.", { error: true });
    try {
      const { data } = await api(`/orders/${order.id}/weigh`, { method: "POST", body: { items } });
      toast(`Pesos guardados. Nuevo total: ${fmt.cop(data.total)}`);
      await Promise.all([openDetail(order.id), loadBoard()]);
    } catch (error) {
      showError(error);
    }
  });
  $("#show-pay")?.addEventListener("click", () => openPayDialog(order));
  $("#collect")?.addEventListener("click", async () => {
    try {
      const paymentMethod = $("#collect-method").value;
      await api(`/orders/${order.id}/collect`, { method: "POST", body: { paymentMethod } });
      toast(paymentMethod === "CREDITO" ? "Quedó a crédito (por cobrar)." : "Pago registrado.");
      await Promise.all([openDetail(order.id), loadBoard()]);
    } catch (error) {
      showError(error);
    }
  });
  $("#cancel-open")?.addEventListener("click", () => {
    $("#cancel-form").hidden = false;
    $("#cancel-form input").focus();
  });
  $("#cancel-back")?.addEventListener("click", () => ($("#cancel-form").hidden = true));
  $("#cancel-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = event.currentTarget.reason.value.trim();
    try {
      await api(`/orders/${order.id}/cancel`, { method: "POST", body: { reason } });
      toast(`Pedido #${order.number} cancelado.`);
      await Promise.all([openDetail(order.id), loadBoard()]);
    } catch (error) {
      if (!showFieldErrors(event.currentTarget, error)) showError(error);
    }
  });
}

/* ───────────── Cobrar con QR ───────────── */
let payAccounts = null;

/**
 * Muestra el QR y las llaves para que el cliente pague: en el mostrador lo escanea de la pantalla;
 * por teléfono o domicilio se le envían los datos por WhatsApp.
 */
async function openPayDialog(order) {
  try {
    payAccounts ??= (await api("/payment-accounts")).data;
  } catch (error) {
    return showError(error);
  }
  const exact = ["DESPACHADO", "ENTREGADO"].includes(order.status) || order.items.every((item) => item.unit !== "KG" || item.actualQtyMilli !== null);
  const text = paymentText({ number: order.number, total: order.total, exact }, payAccounts);
  const body = $("#pay-body");
  $("#pay-title").textContent = `Cobrar pedido #${order.number}`;
  body.innerHTML = payAccounts.length
    ? `<div class="amount-due"><span>${exact ? "Total a pagar" : "Total estimado"}</span><strong>${fmt.cop(order.total)}</strong>${exact ? "" : "<small>Hay productos por kilo sin pesar: el valor puede cambiar al pesarlos.</small>"}</div>
       ${payAccounts.map((account) => payAccountHtml(account, { qr: "big" })).join("")}`
    : `<div class="empty stack"><strong>No hay cuentas de cobro activas</strong><span>${can("admin.manage") ? 'Agrégalas en <a href="/app/cobros">Cuentas de cobro</a>: tu llave Bre-B, Nequi o el QR de tu banco.' : "Pídele al administrador que agregue la llave Bre-B o el Nequi de la pesquera."}</span></div>`;
  $("#pay-copy").hidden = !payAccounts.length;
  $("#pay-copy").onclick = async () => toast((await copyText(text)) ? "Datos de pago copiados: pégalos en el chat del cliente." : "No se pudo copiar.", { error: false });
  const whatsapp = $("#pay-whatsapp");
  whatsapp.hidden = !payAccounts.length || !order.customerPhone;
  if (order.customerPhone) whatsapp.href = `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(text)}`;
  openDialog($("#pay-dialog"));
}

/* ───────────── Pedido nuevo ───────────── */
const form = () => $("#order-form");

function productById(id) {
  return state.products.find((product) => product.id === id);
}

function renderProductOptions() {
  const groups = new Map();
  for (const product of state.products) {
    if (!groups.has(product.category.name)) groups.set(product.category.name, []);
    groups.get(product.category.name).push(product);
  }
  $("#line-product").innerHTML =
    '<option value="">Elige un producto…</option>' +
    [...groups.entries()]
      .map(([category, products]) => `<optgroup label="${esc(category)}">${products
        .map((product) => `<option value="${product.id}">${esc(product.name)} — ${fmt.cop(product.price)}/${fmt.unitLabel(product.unit)} · disp. ${fmt.qty(Math.max(0, product.availableMilli), product.unit)}</option>`)
        .join("")}</optgroup>`)
      .join("");
}

function renderLines() {
  const container = $("#lines");
  $("#lines-empty").hidden = state.lines.length > 0;
  container.innerHTML = state.lines.map((line, index) => {
    const product = productById(line.productId);
    const short = product && line.qty * 1000 > product.availableMilli;
    return `
      <div class="line">
        <div class="line-name"><strong>${esc(product?.name ?? "")}</strong><small>${fmt.cop(product?.price ?? 0)}/${fmt.unitLabel(product?.unit)}${line.note ? ` · ${esc(line.note)}` : ""}${short ? ` · <span class="badge badge-warning">${icon("alert")}Supera lo disponible</span>` : ""}</small></div>
        <span class="num">${fmt.num(line.qty)} ${fmt.unitLabel(product?.unit)}</span>
        <span class="num right line-total">${fmt.cop(Math.round((product?.price ?? 0) * line.qty))}</span>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove="${index}" aria-label="Quitar ${esc(product?.name ?? "")}">${icon("trash")}</button>
      </div>`;
  }).join("");
  renderFormTotals();
}

function feeValue() {
  return Number(String(form().deliveryFee.value).replace(/\D/g, "")) || 0;
}

function renderFormTotals() {
  const subtotal = state.lines.reduce((sum, line) => sum + Math.round((productById(line.productId)?.price ?? 0) * line.qty), 0);
  const isDelivery = form().deliveryType.value === "DOMICILIO";
  const fee = isDelivery ? feeValue() : 0;
  $("#form-totals").innerHTML = `
    <div><span>Subtotal estimado</span><span class="num">${fmt.cop(subtotal)}</span></div>
    ${isDelivery ? `<div><span>Domicilio</span><span class="num">${fmt.cop(fee)}</span></div>` : ""}
    <div class="grand"><span>Total</span><span class="num">${fmt.cop(subtotal + fee)}</span></div>`;
}

function syncFormVisibility() {
  const f = form();
  const delivery = f.deliveryType.value === "DOMICILIO";
  $("#address-field").hidden = !delivery;
  $("#fee-field").hidden = !delivery;
  const counter = f.source.value === "MOSTRADOR" && !delivery;
  $("#complete-now-field").hidden = !counter;
  if (!counter) f.completeNow.checked = false;
  f.paid.disabled = f.paymentMethod.value === "CREDITO";
  if (f.paid.disabled) f.paid.checked = false;
  $("#save-order").textContent = f.completeNow.checked ? "Cobrar y entregar" : "Guardar pedido";
  renderFormTotals();
}

function addLine() {
  const productId = $("#line-product").value;
  const qty = Number($("#line-qty").value.replace(",", "."));
  const product = productById(productId);
  const error = $("#line-error");
  error.hidden = true;
  if (!product) return showLineError("Elige un producto.");
  if (!Number.isFinite(qty) || qty <= 0) return showLineError("Escribe la cantidad.");
  if (product.unit === "UNIDAD" && !Number.isInteger(qty)) return showLineError(`${product.name} se vende por unidad: escribe una cantidad entera.`);
  state.lines.push({ productId, qty, note: $("#line-note").value.trim() || undefined });
  $("#line-qty").value = "";
  $("#line-note").value = "";
  $("#line-product").focus();
  renderLines();

  function showLineError(message) {
    error.textContent = message;
    error.hidden = false;
  }
}

function openOrderForm({ counter = false } = {}) {
  const f = form();
  f.reset();
  state.lines = [];
  $("#form-error").hidden = true;
  showFieldErrors(f, null);
  if (counter) {
    f.completeNow.checked = true;
    f.paid.checked = true;
  }
  f.deliveryFee.value = state.settings?.deliveryFee ?? 0;
  $("#order-dialog-title").textContent = counter ? "Venta de mostrador" : "Nuevo pedido";
  renderProductOptions();
  renderLines();
  syncFormVisibility();
  openDialog($("#order-dialog"));
  (counter ? $("#line-product") : f["customer.name"]).focus();
}

async function submitOrder(event) {
  event.preventDefault();
  const f = form();
  if (!state.lines.length) {
    $("#form-error").textContent = "Agrega al menos un producto.";
    $("#form-error").hidden = false;
    return;
  }
  const delivery = f.deliveryType.value;
  const body = {
    source: f.source.value,
    deliveryType: delivery,
    customer: {
      name: f["customer.name"].value.trim() || (f.completeNow.checked ? "Cliente de mostrador" : ""),
      phone: f["customer.phone"].value.trim(),
      address: delivery === "DOMICILIO" ? f["customer.address"].value.trim() : "",
    },
    paymentMethod: f.paymentMethod.value,
    paid: f.paid.checked,
    deliveryFee: delivery === "DOMICILIO" ? feeValue() : undefined,
    notes: f.notes.value.trim(),
    items: state.lines,
    completeNow: f.completeNow.checked,
  };
  const button = $("#save-order");
  button.disabled = true;
  state.lastSubmit = Date.now();
  try {
    const res = await api("/orders", { method: "POST", body });
    $("#order-dialog").close();
    toast(body.completeNow ? `Venta #${res.data.number} registrada: ${fmt.cop(res.data.total)}` : `Pedido #${res.data.number} recibido.`);
    if (res.warnings?.length) toast("Atención con las existencias", { detail: res.warnings.map((warning) => warning.message).join(" "), iconName: "alert", timeout: 9000 });
    await Promise.all([loadBoard(), loadProducts()]);
  } catch (error) {
    if (!showFieldErrors(f, error)) {
      $("#form-error").textContent = error instanceof ApiError ? error.message : "No se pudo guardar el pedido.";
      $("#form-error").hidden = false;
    }
  } finally {
    button.disabled = false;
  }
}

const searchCustomers = debounce(async (query) => {
  const list = $("#customer-suggest");
  if (query.length < 2) return (list.hidden = true);
  try {
    const { data } = await api(`/customers?q=${encodeURIComponent(query)}`);
    list.innerHTML = data
      .map((customer) => `<button type="button" data-customer='${esc(JSON.stringify({ name: customer.name, phone: customer.phone, address: customer.address }))}'><strong>${esc(customer.name)}</strong> <span class="muted">${esc(customer.phone.slice(2))} · ${customer.orderCount} pedidos</span></button>`)
      .join("");
    list.hidden = data.length === 0;
  } catch {
    list.hidden = true;
  }
}, 220);

async function loadProducts() {
  if (!can("orders.create")) return;
  const { data } = await api("/catalog/products");
  state.products = data;
}

/* ───────────── Arranque ───────────── */
await startShell("pedidos", "orders.view");
$$("[data-icon]").forEach((node) => node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon)));
$$("[data-close]").forEach((node) => {
  if (!node.textContent.trim()) node.innerHTML = icon("x");
  node.addEventListener("click", () => node.closest("dialog").close());
});
$("#add-line").innerHTML = `${icon("plus")}Agregar`;
$(".toolbar .search").insertAdjacentHTML("afterbegin", icon("search"));

if (can("orders.create")) {
  const newButton = $("#btn-new");
  newButton.hidden = false;
  newButton.innerHTML = `${icon("plus")}Nuevo pedido`;
  newButton.addEventListener("click", () => openOrderForm());
  const counterButton = $("#btn-counter");
  counterButton.hidden = false;
  counterButton.innerHTML = `${icon("counter")}Venta de mostrador`;
  counterButton.addEventListener("click", () => openOrderForm({ counter: true }));
  const [settings] = await Promise.all([api("/settings"), loadProducts()]);
  state.settings = settings.data;

  const f = form();
  f.addEventListener("submit", submitOrder);
  f.addEventListener("change", syncFormVisibility);
  f.deliveryFee.addEventListener("input", renderFormTotals);
  $("#add-line").addEventListener("click", addLine);
  $("#line-qty").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addLine();
    }
  });
  $("#line-product").addEventListener("change", () => {
    const product = productById($("#line-product").value);
    $("#line-qty-label").textContent = product ? (product.unit === "KG" ? "Kilos" : "Unidades") : "Cantidad";
    $("#line-qty").focus();
  });
  $("#lines").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    state.lines.splice(Number(button.dataset.remove), 1);
    renderLines();
  });
  f["customer.name"].addEventListener("input", (event) => searchCustomers(event.target.value.trim()));
  f["customer.name"].addEventListener("blur", () => setTimeout(() => ($("#customer-suggest").hidden = true), 150));
  $("#customer-suggest").addEventListener("click", (event) => {
    const button = event.target.closest("[data-customer]");
    if (!button) return;
    const customer = JSON.parse(button.dataset.customer);
    f["customer.name"].value = customer.name;
    f["customer.phone"].value = customer.phone.slice(2);
    if (customer.address) f["customer.address"].value = customer.address;
    $("#customer-suggest").hidden = true;
  });
}

$("#board").addEventListener("click", (event) => {
  const advanceButton = event.target.closest("[data-advance]");
  if (advanceButton) return advance(advanceButton.dataset.advance, advanceButton.dataset.to, advanceButton);
  const cardNode = event.target.closest(".order-card");
  if (cardNode) openDetail(cardNode.dataset.id);
});
$("#closed").addEventListener("click", (event) => {
  const row = event.target.closest("[data-open]");
  if (row) openDetail(row.dataset.open);
});
$("#detail-dialog").addEventListener("close", () => (state.openId = null));
bindCopy($("#pay-body"));
$("#search").addEventListener("input", renderBoard);
$$('input[name="filter-delivery"]').forEach((input) => input.addEventListener("change", renderBoard));

await loadBoard();
// Los minutos transcurridos se actualizan solos.
setInterval(renderBoard, 30_000);

connectLive((event) => {
  if (event.scope === "orders" || event.scope === "all") {
    reloadBoard();
    if (state.openId && event.data?.id === state.openId) openDetail(state.openId);
    if (event.kind === "order.created" && Date.now() - state.lastSubmit > 3000) {
      chime();
      toast(`Pedido nuevo #${event.data.number}`, { detail: `${event.data.customerName} · ${LABELS.source[event.data.source]} · ${fmt.cop(event.data.total)}`, iconName: "inbox" });
    }
  }
  if ((event.scope === "inventory" || event.scope === "catalog") && can("orders.create")) loadProducts().catch(() => {});
  // Cambió una cuenta de cobro: la próxima vez se vuelven a pedir.
  if (event.scope === "settings") payAccounts = null;
});
