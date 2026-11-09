import { $, esc, fmt, icon, LABELS, themeControl } from "/js/core.js";
import { bindCopy, payAccountHtml } from "/js/pay.js";

$("#theme").innerHTML = themeControl("toggle");

const STEPS = ["RECIBIDO", "ALISTANDO", "LISTO", "DESPACHADO", "ENTREGADO"];
const [id, key] = location.hash.slice(1).split(".");
let timer;

async function load() {
  let order;
  try {
    const res = await fetch(`/api/v1/store/orders/${encodeURIComponent(id ?? "")}`, { headers: { "X-Order-Key": key ?? "" } });
    if (!res.ok) throw new Error();
    order = (await res.json()).data;
  } catch {
    $("#title").textContent = "No encontramos tu pedido";
    $("#subtitle").textContent = "Revisa que el enlace esté completo.";
    $("#order").innerHTML = '<a class="btn" href="/tienda">Ir a la tienda</a>';
    clearInterval(timer);
    return;
  }
  const steps = order.deliveryType === "RECOGE" ? STEPS.filter((status) => status !== "DESPACHADO") : STEPS;
  const current = steps.indexOf(order.status);
  const names = { ...LABELS.status, LISTO: order.deliveryType === "RECOGE" ? "Listo para recoger" : "Listo" };
  $("#title").textContent = `Pedido #${order.number}`;
  $("#subtitle").textContent =
    order.status === "CANCELADO"
      ? "Tu pedido fue cancelado."
      : order.status === "ENTREGADO"
        ? "¡Entregado! Gracias por tu compra."
        : order.status === "DESPACHADO"
          ? "Tu pedido va en camino."
          : order.status === "LISTO" && order.deliveryType === "RECOGE"
            ? "Tu pedido está listo: puedes pasar a recogerlo."
            : "Lo estamos preparando. Esta página se actualiza sola.";
  $("#order").innerHTML = `
    ${order.status === "CANCELADO"
      ? `<div class="error-box">${icon("ban", "icon-sm")} Cancelado${order.cancelReason ? `: ${esc(order.cancelReason)}` : ""}</div>`
      : `<ol class="steps">${steps.map((status, index) => `<li class="${index < current || order.status === "ENTREGADO" ? "done" : index === current ? "current done" : ""}">${names[status]}</li>`).join("")}</ol>`}
    <div class="section-title">Productos</div>
    <table class="table"><tbody>${order.items.map((item) => `
      <tr><td><strong>${esc(item.productName)}</strong>${item.note ? `<br><span class="muted">${esc(item.note)}</span>` : ""}</td>
      <td class="right num">${item.actualQtyMilli !== null ? `${fmt.qty(item.actualQtyMilli, item.unit)} <span class="muted">(pesado)</span>` : fmt.qty(item.qtyMilli, item.unit)}</td>
      <td class="right num">${fmt.cop(item.lineTotal)}</td></tr>`).join("")}</tbody></table>
    <div class="totals">
      <div><span>Subtotal</span><span class="num">${fmt.cop(order.subtotal)}</span></div>
      ${order.deliveryFee ? `<div><span>Domicilio</span><span class="num">${fmt.cop(order.deliveryFee)}</span></div>` : ""}
      <div class="grand"><span>Total</span><span class="num">${fmt.cop(order.total)}</span></div>
    </div>
    <p class="muted">${order.deliveryType === "DOMICILIO" ? `Domicilio${order.address ? ` · ${esc(order.address)}` : ""}` : "Recoges en la pesquera"} · Pago: ${LABELS.payment[order.paymentMethod]}${order.paid ? " (pagado)" : ""}</p>`;
  renderPayment(order);
  if (["ENTREGADO", "CANCELADO"].includes(order.status)) clearInterval(timer);
}

/** «Paga aquí»: el valor (exacto después del pesaje), las cuentas con su QR y el aviso del comprobante. */
function renderPayment(order) {
  const box = $("#payment");
  const payment = order.payment;
  box.hidden = !payment;
  if (!payment) return;
  const message = encodeURIComponent(`Hola, pagué el pedido #${order.number} por ${fmt.cop(payment.amountDue)}. Te envío el comprobante.`);
  const html = `
    <h2>Paga aquí</h2>
    <div class="amount-due">
      <span>${payment.exact ? "Total a pagar" : "Total estimado"}</span>
      <strong>${fmt.cop(payment.amountDue)}</strong>
      ${payment.exact ? "" : "<small>Lo que va por kilo se pesa al alistar: espera a que el pedido diga «Alistando» o «Listo» para pagar el valor exacto.</small>"}
    </div>
    ${payment.accounts.map((account) => payAccountHtml(account, { qr: "big", download: true })).join("")}
    ${payment.whatsapp ? `<a class="btn btn-primary btn-lg send-proof" href="https://wa.me/${payment.whatsapp}?text=${message}" target="_blank" rel="noopener">${icon("chat")}Ya pagué: enviar el comprobante</a>` : ""}`;
  // Solo se vuelve a dibujar si cambió (el seguimiento se consulta cada 10 s y no debe parpadear).
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.innerHTML = html;
  }
}

bindCopy($("#payment"));
await load();
timer = setInterval(load, 10_000);
