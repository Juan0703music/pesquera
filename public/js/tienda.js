import { $, $$, api, ApiError, esc, fmt, icon, openDialog, showFieldErrors, themeControl } from "/js/core.js";

$("#theme").innerHTML = themeControl("toggle");

const CART_KEY = "marea-carrito";
const ART = ["fish", "shrimp", "fillet", "box"];
const state = { store: null, products: new Map(), cart: loadCart() };

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  } catch {
    // Sin almacenamiento (navegación privada): el carrito vive mientras la página esté abierta.
  }
}

const step = (product) => (product.unit === "KG" ? 0.5 : 1);
const qtyText = (product, qty) => `${fmt.num(qty)} ${product.unit === "KG" ? "kg" : qty === 1 ? "unidad" : "unidades"}`;

function cartLines() {
  return Object.entries(state.cart)
    .map(([id, qty]) => ({ product: state.products.get(id), qty }))
    .filter((line) => line.product && line.qty > 0);
}

function totals() {
  const subtotal = cartLines().reduce((sum, line) => sum + Math.round(line.product.price * line.qty), 0);
  return { subtotal, count: cartLines().length };
}

/* ───────────── Catálogo ───────────── */
function renderCatalog() {
  const { business, categories } = state.store;
  document.title = `${business.name} · Pide en línea`;
  $("#store-name").textContent = business.name;
  $("#store-meta").innerHTML = [
    business.open ? `<span class="badge badge-good">${icon("checkCircle")}Recibiendo pedidos</span>` : `<span class="badge badge-critical">${icon("ban")}No estamos recibiendo pedidos en línea ahora</span>`,
    business.address ? `<span class="badge">${icon("store")}${esc(business.address)}</span>` : "",
    business.deliveryFee ? `<span class="badge">${icon("truck")}Domicilio ${fmt.cop(business.deliveryFee)}</span>` : "",
    business.whatsapp ? `<a href="https://wa.me/${business.whatsapp}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>` : "",
  ].join("");
  $("#chips").innerHTML = categories.map((category) => `<a href="#cat-${category.id}">${esc(category.name)}</a>`).join("");
  $("#catalog").innerHTML = categories
    .map((category, index) => `
      <section class="category">
        <h2 id="cat-${category.id}">${esc(category.name)}</h2>
        <div class="products">${category.products.map((product) => productCard(product, ART[index % ART.length])).join("")}</div>
      </section>`)
    .join("") || '<div class="empty">Pronto tendremos productos aquí.</div>';
}

function productCard(product, art) {
  const qty = state.cart[product.id] ?? 0;
  return `
    <article class="card product${product.available ? "" : " is-out"}" data-product="${product.id}">
      <div class="product-art" aria-hidden="true">${icon(art)}</div>
      <h3>${esc(product.name)}</h3>
      <p>${esc(product.description ?? "")}</p>
      <div class="price num">${fmt.cop(product.price)} <small>/ ${product.unit === "KG" ? "kilo" : "unidad"}</small></div>
      ${!product.available
        ? `<span class="badge badge-critical">${icon("ban")}Agotado por hoy</span>`
        : qty > 0
          ? `<div class="stepper"><button class="btn btn-icon" data-dec="${product.id}" aria-label="Quitar ${step(product)} de ${esc(product.name)}">${icon("minus")}</button><output aria-live="polite">${qtyText(product, qty)}</output><button class="btn btn-icon" data-inc="${product.id}" aria-label="Agregar ${step(product)} de ${esc(product.name)}" ${qty + step(product) > product.maxQty ? "disabled" : ""}>${icon("plus")}</button></div>`
          : `<button class="btn" data-inc="${product.id}" ${state.store.business.open ? "" : "disabled"}>${icon("plus")}Agregar ${product.unit === "KG" ? "½ kg" : "1"}</button>`}
    </article>`;
}

function refreshProduct(id) {
  const node = $(`[data-product="${id}"]`);
  if (!node) return;
  const index = state.store.categories.findIndex((category) => category.products.some((product) => product.id === id));
  node.outerHTML = productCard(state.products.get(id), ART[index % ART.length]);
}

/* ───────────── Carrito ───────────── */
function cartHtml() {
  const lines = cartLines();
  const { subtotal } = totals();
  const fee = state.store.business.deliveryFee;
  if (!lines.length) return '<div class="empty">Agrega productos para hacer tu pedido.</div>';
  const min = state.store.business.minOrderTotal;
  return `
    <div class="cart-lines">${lines.map(({ product, qty }) => `
      <div class="cart-line"><strong>${esc(product.name)}</strong><span class="num">${fmt.cop(Math.round(product.price * qty))}</span><span class="muted">${qtyText(product, qty)} × ${fmt.cop(product.price)}</span><button class="btn btn-ghost btn-sm" data-remove="${product.id}">Quitar</button></div>`).join("")}
    </div>
    <div class="totals">
      <div><span>Subtotal estimado</span><span class="num">${fmt.cop(subtotal)}</span></div>
      ${fee ? `<div><span>Domicilio</span><span class="num">${fmt.cop(fee)}</span></div>` : ""}
      <div class="grand"><span>Total</span><span class="num">${fmt.cop(subtotal + fee)}</span></div>
    </div>
    ${subtotal < min ? `<p class="warn-box">El pedido mínimo en línea es de ${fmt.cop(min)}.</p>` : ""}
    <button class="btn btn-primary btn-lg" data-checkout ${subtotal < min || !state.store.business.open ? "disabled" : ""}>Continuar</button>`;
}

function renderCart() {
  const html = cartHtml();
  $("#cart").innerHTML = html;
  $("#cart-mobile").innerHTML = html;
  const { subtotal, count } = totals();
  $("#cart-bar").hidden = count === 0;
  $("#cart-bar-text").textContent = `${count} ${count === 1 ? "producto" : "productos"} · ${fmt.cop(subtotal)}`;
}

function change(id, direction) {
  const product = state.products.get(id);
  if (!product) return;
  const next = Math.max(0, Math.round(((state.cart[id] ?? 0) + direction * step(product)) * 100) / 100);
  if (next > product.maxQty) return;
  if (next === 0) delete state.cart[id];
  else state.cart[id] = next;
  saveCart();
  refreshProduct(id);
  renderCart();
}

/* ───────────── Pedido ───────────── */
function openCheckout() {
  $("#cart-dialog").close();
  const form = $("#checkout-form");
  $("#checkout-error").hidden = true;
  showFieldErrors(form, null);
  const { subtotal } = totals();
  $("#checkout-summary").innerHTML = `<strong>${totals().count} productos · ${fmt.cop(subtotal)}</strong>`;
  syncDelivery();
  openDialog($("#checkout"));
  form["customer.name"].focus();
}

function syncDelivery() {
  $("#address-field").hidden = $("#checkout-form").deliveryType.value !== "DOMICILIO";
}

async function placeOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#place");
  button.disabled = true;
  try {
    const { data } = await api("/store/orders", {
      method: "POST",
      body: {
        deliveryType: form.deliveryType.value,
        customer: { name: form["customer.name"].value.trim(), phone: form["customer.phone"].value.trim(), address: form["customer.address"].value.trim() },
        paymentMethod: form.paymentMethod.value,
        notes: form.notes.value.trim(),
        website: form.website.value,
        items: cartLines().map(({ product, qty }) => ({ productId: product.id, qty })),
      },
    });
    state.cart = {};
    saveCart();
    location.href = `/tienda/pedido#${data.id}.${data.trackingKey}`;
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#checkout-error").textContent = error instanceof ApiError ? error.message : "No pudimos enviar el pedido. Intenta de nuevo.";
      $("#checkout-error").hidden = false;
    }
    if (error instanceof ApiError && error.code === "OUT_OF_STOCK") await load();
    button.disabled = false;
  }
}

async function load() {
  const { data } = await api("/store");
  state.store = data;
  state.products = new Map(data.categories.flatMap((category) => category.products.map((product) => [product.id, product])));
  // Lo que ya no está disponible sale del carrito.
  for (const [id, qty] of Object.entries(state.cart)) {
    const product = state.products.get(id);
    if (!product || !product.available) delete state.cart[id];
    else if (qty > product.maxQty) state.cart[id] = product.maxQty;
  }
  saveCart();
  renderCatalog();
  renderCart();
}

document.addEventListener("click", (event) => {
  const inc = event.target.closest("[data-inc]");
  if (inc) return change(inc.dataset.inc, 1);
  const dec = event.target.closest("[data-dec]");
  if (dec) return change(dec.dataset.dec, -1);
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    delete state.cart[remove.dataset.remove];
    saveCart();
    refreshProduct(remove.dataset.remove);
    return renderCart();
  }
  if (event.target.closest("[data-checkout]")) openCheckout();
});
$$("[data-close]").forEach((node) => {
  if (!node.textContent.trim()) node.innerHTML = icon("x");
  node.addEventListener("click", () => node.closest("dialog").close());
});
$("#cart-bar-open").addEventListener("click", () => openDialog($("#cart-dialog")));
$("#checkout-form").addEventListener("change", syncDelivery);
$("#checkout-form").addEventListener("submit", placeOrder);

try {
  await load();
} catch {
  $("#catalog").innerHTML = '<div class="error-box">No pudimos cargar la tienda. Revisa tu conexión y recarga la página.</div>';
}
