import { $, $$, api, ApiError, esc, fmt, icon, logoImg, openDialog, showFieldErrors, themeControl, toast } from "/js/core.js";
import { bindCopy, payAccountHtml } from "/js/pay.js";

// Tienda en línea: «La pizarra del día». Lo fresco y los precios primero; el cliente recoge en la pesquera.

const CART_KEY = "marea-carrito-v2";
const LAST_KEY = "marea-ultimo-pedido";
const state = { store: null, products: new Map(), categoryOf: new Map(), cart: readJson(CART_KEY, []), filter: "", category: "", sheet: null };

/* ───────────── Utilidades ───────────── */
function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (navegación privada): el carrito vive mientras la página esté abierta.
  }
}
const isKg = (product) => product.unit === "KG";
const step = (product) => (isKg(product) ? 0.25 : 1);
const perUnit = (product) => (isKg(product) ? "kg" : "und");
const qtyText = (product, qty) => (isKg(product) ? `${fmt.num(qty)} kg` : `${fmt.num(qty)} ${qty === 1 ? "unidad" : "unidades"}`);
const lineTotal = (product, qty) => Math.round(product.price * qty);
const clamp = (product, qty) => Math.min(product.maxQty, Math.max(step(product), Math.round(qty / step(product)) * step(product)));
const timeIn = (date) => new Date(date).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: state.store.business.timeZone });

/** Icono según la categoría (para la ilustración cuando aún no hay foto). */
function artIcon(product) {
  const name = (state.categoryOf.get(product.id)?.name ?? "").toLowerCase();
  if (/maris|camar|langost|calam|pulp|jaib/.test(name + product.name.toLowerCase())) return "shrimp";
  if (/filet|lomo/.test(name + product.name.toLowerCase())) return "fillet";
  if (/pesc|pez/.test(name)) return "fish";
  return "box";
}

/** Foto del producto o, si aún no tiene, una ilustración (nunca una foto inventada). */
function art(product, size = "small") {
  if (product.photo) return `<img class="art-img" src="${product.photo[size]}" alt="${esc(product.name)}" loading="lazy" />`;
  return `<span class="art-fallback" aria-hidden="true"><svg class="art-waves" viewBox="0 0 120 40" preserveAspectRatio="none"><path d="M0 22c15 0 15-10 30-10s15 10 30 10 15-10 30-10 15 10 30 10"/><path d="M0 32c15 0 15-8 30-8s15 8 30 8 15-8 30-8 15 8 30 8"/></svg>${icon(artIcon(product))}</span>`;
}

function badges(product) {
  const list = [];
  if (!product.available) list.push(`<span class="badge badge-critical">${icon("ban")}Agotado</span>`);
  else if (product.fewLeft) list.push(`<span class="badge badge-warning">${icon("alert")}Quedan pocos</span>`);
  if (product.arrivedAt) list.push(`<span class="badge badge-fresh">${icon("wave")}Llegó hoy ${timeIn(product.arrivedAt)}</span>`);
  return list.join("");
}

const price = (product) => `<span class="price num">${fmt.cop(product.price)}<small>/${perUnit(product)}</small></span>`;

/* ───────────── Encabezado y pizarra ───────────── */
function renderHead() {
  const { business } = state.store;
  document.title = `${business.name} · Pide en línea`;
  $("#store-name").textContent = business.name;
  const logo = $("#store-logo");
  logo.hidden = !business.logo;
  if (business.logo && !logo.firstChild) logo.innerHTML = logoImg(business.logo, "", "large", business.name);
  $("#store-meta").innerHTML = [
    business.open
      ? `<span class="badge badge-good">${icon("checkCircle")}Recibiendo pedidos</span>`
      : `<span class="badge badge-critical">${icon("ban")}Hoy no estamos recibiendo pedidos en línea</span>`,
    business.address ? `<span class="shop-where">${icon("store", "icon-sm")}Recoges en ${esc(business.address)}</span>` : "",
    business.whatsapp ? `<a class="shop-where" href="https://wa.me/${business.whatsapp}" target="_blank" rel="noopener">${icon("chat", "icon-sm")}Escríbenos</a>` : "",
  ].join("");
}

function renderBoard() {
  const all = [...state.products.values()];
  const today = all.filter((product) => product.arrivedAt && product.available).sort((a, b) => new Date(b.arrivedAt) - new Date(a.arrivedAt));
  const fallback = all.filter((product) => product.available).sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
  const featured = (today.length ? today : fallback).slice(0, 6);
  $("#board-title").textContent = today.length ? "Fresco de hoy" : "Lo más pedido";
  $("#board-date").textContent = new Date(`${state.store.today}T12:00:00Z`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const note = $("#board-note");
  note.hidden = Boolean(today.length);
  note.textContent = "Hoy todavía no ha llegado mercancía nueva: esto es lo que más piden nuestros clientes.";
  $("#board-cards").innerHTML =
    featured
      .map(
        (product) => `
      <button type="button" class="board-card" data-open="${product.id}" aria-label="${esc(product.name)}, ${fmt.cop(product.price)} por ${isKg(product) ? "kilo" : "unidad"}">
        <span class="board-art">${art(product, "large")}</span>
        <span class="board-card-body">
          <span class="board-badges">${badges(product)}</span>
          <strong>${esc(product.name)}</strong>
          ${price(product)}
        </span>
      </button>`,
      )
      .join("") || '<p class="board-empty">Pronto tendremos productos aquí.</p>';

  const ordered = [...state.store.categories.flatMap((category) => category.products)].sort((a, b) => Number(b.available) - Number(a.available));
  $("#price-list").innerHTML = ordered
    .map(
      (product) => `
      <li><button type="button" data-open="${product.id}" class="${product.available ? "" : "is-out"}">
        <span class="pl-name">${esc(product.name)}${product.arrivedAt ? ` <span class="pl-fresh" title="Llegó hoy">${icon("wave", "icon-sm")}</span>` : ""}</span>
        <span class="pl-dots" aria-hidden="true"></span>
        <span class="pl-price num">${product.available ? `${fmt.cop(product.price)}<small>/${perUnit(product)}</small>` : "agotado"}</span>
      </button></li>`,
    )
    .join("");
}

/* ───────────── Repetir el último pedido ───────────── */
function renderRepeat() {
  const last = readJson(LAST_KEY, null);
  const box = $("#repeat");
  const lines = (last?.items ?? []).filter((line) => state.products.get(line.productId)?.available);
  box.hidden = lines.length === 0;
  if (!lines.length) return;
  const summary = lines
    .map((line) => {
      const product = state.products.get(line.productId);
      return `${qtyText(product, Math.min(line.qty, product.maxQty))} ${product.name}${line.cut ? ` (${line.cut.toLowerCase()})` : ""}`;
    })
    .join(" · ");
  box.innerHTML = `
    <div class="repeat-icon">${icon("refresh")}</div>
    <div class="repeat-text"><strong>¿Lo mismo de la última vez?</strong><span>${esc(summary)}</span></div>
    <button type="button" class="btn btn-primary" id="repeat-add" ${state.store.business.open ? "" : "disabled"}>${icon("plus")}Pedir lo mismo</button>`;
  $("#repeat-add").addEventListener("click", () => {
    for (const line of lines) addToCart(line.productId, line.qty, line.cut, { quiet: true });
    toast("Agregamos tu pedido anterior.", { detail: "Revisa las cantidades antes de confirmar." });
    if (matchMedia("(max-width: 900px)").matches) openDialog($("#cart-dialog"));
  });
}

/* ───────────── Catálogo ───────────── */
function matches(product) {
  const query = state.filter.trim().toLowerCase();
  const category = state.categoryOf.get(product.id);
  if (state.category && category?.id !== state.category) return false;
  if (!query) return true;
  return `${product.name} ${product.description ?? ""} ${category?.name ?? ""}`.toLowerCase().includes(query);
}

function itemCard(product) {
  return `
    <button type="button" class="item${product.available ? "" : " is-out"}" data-open="${product.id}">
      <span class="item-art">${art(product)}<span class="item-badges">${badges(product)}</span></span>
      <span class="item-body">
        <strong>${esc(product.name)}</strong>
        ${product.description ? `<span class="item-desc">${esc(product.description)}</span>` : ""}
        <span class="item-foot">${price(product)}<span class="item-cta">${product.available ? `${icon("plus", "icon-sm")}Elegir` : "Agotado"}</span></span>
      </span>
    </button>`;
}

function renderCatalog() {
  const { categories } = state.store;
  $("#chips").innerHTML = [
    `<button type="button" class="chip" data-cat="" aria-pressed="${state.category === ""}">Todo</button>`,
    ...categories.map((category) => `<button type="button" class="chip" data-cat="${category.id}" aria-pressed="${state.category === category.id}">${esc(category.name)}</button>`),
  ].join("");
  const sections = categories
    .map((category) => ({ category, products: category.products.filter(matches) }))
    .filter((section) => section.products.length);
  $("#catalog").innerHTML = sections.length
    ? sections
        .map(
          ({ category, products }) => `
        <section class="category" aria-labelledby="cat-${category.id}">
          <h2 id="cat-${category.id}">${esc(category.name)}<span class="muted">${products.length}</span></h2>
          <div class="items">${products.map(itemCard).join("")}</div>
        </section>`,
        )
        .join("")
    : `<div class="empty stack"><strong>No encontramos «${esc(state.filter)}»</strong><span>Prueba con otra palabra o escríbenos por WhatsApp: a veces llega algo que no está en la tienda.</span></div>`;
}

/* ───────────── Ficha del producto ───────────── */
function openSheet(productId) {
  const product = state.products.get(productId);
  if (!product) return;
  const open = state.store.business.open && product.available;
  state.sheet = { product, qty: clamp(product, isKg(product) ? 1 : 1), cut: product.cutOptions[0] ?? null };
  if (!product.available) state.sheet.qty = 0;
  const quick = (isKg(product) ? [0.5, 1, 2, 5, 10] : [1, 2, 5, 10]).filter((qty) => qty <= product.maxQty);
  $("#sheet-form").innerHTML = `
    <div class="sheet-art">${art(product, "large")}<button type="button" class="btn btn-icon sheet-close" data-close aria-label="Cerrar">${icon("x")}</button></div>
    <div class="modal-body stack sheet-body">
      <div>
        <div class="board-badges">${badges(product)}</div>
        <h2 id="sheet-title">${esc(product.name)}</h2>
        ${price(product)}
        ${product.description ? `<p class="sheet-desc">${esc(product.description)}</p>` : ""}
      </div>
      ${product.cutOptions.length && open ? `
        <fieldset class="cuts">
          <legend>¿Cómo lo quieres?</legend>
          ${product.cutOptions.map((cut, index) => `<label><input type="radio" name="cut" value="${esc(cut)}" ${index === 0 ? "checked" : ""} /><span>${esc(cut)}</span></label>`).join("")}
        </fieldset>` : ""}
      ${open ? `
        <div class="qty-block">
          <span class="label">Cantidad${isKg(product) ? " (kilos)" : ""}</span>
          <div class="qty">
            <button type="button" class="btn btn-icon" data-qty="-1" aria-label="Menos">${icon("minus")}</button>
            <input class="input num" name="qty" inputmode="decimal" aria-label="Cantidad en ${isKg(product) ? "kilos" : "unidades"}" value="${fmt.num(state.sheet.qty)}" />
            <span class="qty-unit">${perUnit(product)}</span>
            <button type="button" class="btn btn-icon" data-qty="1" aria-label="Más">${icon("plus")}</button>
          </div>
          <div class="quick">${quick.map((qty) => `<button type="button" class="chip" data-set="${qty}">${isKg(product) && qty === 0.5 ? "½" : fmt.num(qty)} ${perUnit(product)}</button>`).join("")}</div>
          <span class="muted qty-max">Puedes pedir hasta ${qtyText(product, product.maxQty)}.${isKg(product) ? " Se pesa al alistar: pagas lo que pese." : ""}</span>
        </div>` : `<p class="warn-box">${product.available ? "Hoy no estamos recibiendo pedidos en línea." : "Se nos acabó por hoy. Vuelve mañana o escríbenos por WhatsApp."}</p>`}
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-close>Cerrar</button>
      <div class="spacer"></div>
      ${open ? `<button type="submit" class="btn btn-primary btn-lg" id="sheet-add"></button>` : ""}
    </div>`;
  updateSheetTotal();
  openDialog($("#sheet"));
  $("#sheet-form [name=qty]")?.focus({ preventScroll: true });
}

function updateSheetTotal() {
  const { product, qty } = state.sheet;
  const button = $("#sheet-add");
  if (!button) return;
  button.innerHTML = `${icon("plus")}Agregar · ${fmt.cop(lineTotal(product, qty))}`;
  button.disabled = !(qty > 0);
}

function setSheetQty(value) {
  const { product } = state.sheet;
  state.sheet.qty = Number.isFinite(value) && value > 0 ? clamp(product, value) : 0;
  const input = $("#sheet-form [name=qty]");
  if (input && document.activeElement !== input) input.value = fmt.num(state.sheet.qty);
  updateSheetTotal();
}

/* ───────────── Carrito ───────────── */
const lineKey = (productId, cut) => `${productId}|${cut ?? ""}`;
function validLines() {
  return state.cart
    .map((line) => ({ ...line, product: state.products.get(line.productId) }))
    .filter((line) => line.product?.available && line.qty > 0);
}
function cartTotal() {
  return validLines().reduce((sum, line) => sum + lineTotal(line.product, line.qty), 0);
}
function saveCart() {
  writeJson(CART_KEY, state.cart);
}

function addToCart(productId, qty, cut, { quiet = false } = {}) {
  const product = state.products.get(productId);
  if (!product?.available) return;
  const key = lineKey(productId, cut);
  const existing = state.cart.find((line) => lineKey(line.productId, line.cut) === key);
  // Lo de todas las líneas del mismo producto no puede pasar de lo disponible.
  const others = state.cart.filter((line) => line.productId === productId && lineKey(line.productId, line.cut) !== key).reduce((sum, line) => sum + line.qty, 0);
  const room = Math.max(0, product.maxQty - others);
  const next = Math.min(room, (existing?.qty ?? 0) + qty);
  if (next <= 0) return toast(`No queda más ${product.name} disponible.`, { error: true });
  if (existing) existing.qty = next;
  else state.cart.push({ productId, qty: next, cut: cut ?? null });
  saveCart();
  renderCart({ bump: true });
  if (!quiet) toast(`${product.name} en tu pedido`, { detail: `${qtyText(product, next)}${cut ? ` · ${cut}` : ""}`, timeout: 2600 });
}

function cartHtml() {
  const lines = validLines();
  if (!lines.length) return `<div class="empty stack cart-empty">${icon("bag")}<span>Elige productos de la pizarra o del catálogo.</span></div>`;
  const total = cartTotal();
  const min = state.store.business.minOrderTotal;
  return `
    <ul class="cart-lines">${lines
      .map(
        ({ product, qty, cut, productId }) => `
      <li class="cart-line">
        <span class="cart-thumb">${art(product)}</span>
        <span class="cart-info"><strong>${esc(product.name)}</strong><span class="muted">${cut ? `${esc(cut)} · ` : ""}${fmt.cop(product.price)}/${perUnit(product)}</span>
          <span class="cart-qty">
            <button type="button" class="btn btn-sm btn-icon" data-line="${esc(lineKey(productId, cut))}" data-delta="-1" aria-label="Menos ${esc(product.name)}">${icon("minus", "icon-sm")}</button>
            <span class="num">${qtyText(product, qty)}</span>
            <button type="button" class="btn btn-sm btn-icon" data-line="${esc(lineKey(productId, cut))}" data-delta="1" aria-label="Más ${esc(product.name)}">${icon("plus", "icon-sm")}</button>
          </span>
        </span>
        <span class="cart-price num">${fmt.cop(lineTotal(product, qty))}</span>
      </li>`,
      )
      .join("")}
    </ul>
    <div class="totals"><div class="grand"><span>Total estimado</span><span class="num">${fmt.cop(total)}</span></div></div>
    ${total < min ? `<p class="warn-box">El pedido mínimo en línea es de ${fmt.cop(min)}.</p>` : ""}
    <button class="btn btn-primary btn-lg" data-checkout ${total < min || !state.store.business.open ? "disabled" : ""}>Continuar</button>`;
}

/** Total que «rueda» hasta el valor nuevo (un solo gesto, sin animación si se prefiere menos movimiento). */
function rollTotal(node, to) {
  const from = Number(node.dataset.value ?? to);
  node.dataset.value = String(to);
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return (node.textContent = fmt.cop(to));
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 420);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = fmt.cop(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderCart({ bump = false } = {}) {
  const html = cartHtml();
  $("#cart").innerHTML = html;
  $("#cart-mobile").innerHTML = html;
  const lines = validLines();
  const bar = $("#cart-bar");
  bar.hidden = lines.length === 0;
  $("#cart-bar-count").textContent = String(lines.length);
  rollTotal($("#cart-bar-total"), cartTotal());
  if (bump) {
    bar.classList.remove("bump");
    void bar.offsetWidth;
    bar.classList.add("bump");
  }
}

function changeLine(key, delta) {
  const line = state.cart.find((item) => lineKey(item.productId, item.cut) === key);
  const product = line && state.products.get(line.productId);
  if (!product) return;
  if (delta > 0) return addToCart(line.productId, step(product) * (isKg(product) ? 2 : 1), line.cut, { quiet: true });
  line.qty = Math.round((line.qty - step(product) * (isKg(product) ? 2 : 1)) * 100) / 100;
  if (line.qty <= 0) state.cart = state.cart.filter((item) => item !== line);
  saveCart();
  renderCart();
}

/* ───────────── Confirmar ───────────── */
function renderPaymentOptions() {
  const select = $("#checkout-form").paymentMethod;
  const current = select.value;
  const byMethod = state.store.payment?.byMethod ?? {};
  const options = [
    ["EFECTIVO", "Efectivo al recoger"],
    ...(byMethod.BRE_B ? [["BRE_B", "Llave Bre-B (desde cualquier banco)"]] : []),
    ["NEQUI", "Nequi"],
    ["TRANSFERENCIA", "Transferencia bancaria"],
    ["DATAFONO", "Datáfono al recoger"],
  ];
  select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  if (options.some(([value]) => value === current)) select.value = current;
}

function syncPayment() {
  const box = $("#pay-info");
  const method = $("#checkout-form").paymentMethod.value;
  const ids = state.store?.payment?.byMethod?.[method] ?? [];
  const accounts = ids.map((id) => state.store.payment.accounts.find((account) => account.id === id)).filter(Boolean);
  box.hidden = accounts.length === 0;
  if (!accounts.length) return;
  box.innerHTML = `<p class="muted">Puedes pagar a ${accounts.length === 1 ? "esta cuenta" : "cualquiera de estas cuentas"}. Al hacer el pedido verás el QR y el valor exacto después del pesaje.</p>
    ${accounts.map((account) => payAccountHtml(account, { qr: false })).join("")}`;
}

function openCheckout() {
  $("#cart-dialog").close();
  const form = $("#checkout-form");
  $("#checkout-error").hidden = true;
  showFieldErrors(form, null);
  const lines = validLines();
  const { business } = state.store;
  $("#pickup").innerHTML = `${icon("store")}<span><strong>Recoges en la pesquera</strong>${esc((business.address ?? business.name).replace(/[.\s]+$/, ""))}. Te avisamos cuando esté listo.</span>`;
  $("#checkout-summary").innerHTML = `<strong>${lines.length} ${lines.length === 1 ? "producto" : "productos"} · ${fmt.cop(cartTotal())}</strong> <span class="muted">(estimado)</span>`;
  const saved = readJson("marea-cliente", null);
  if (saved && !form["customer.name"].value) {
    form["customer.name"].value = saved.name ?? "";
    form["customer.phone"].value = saved.phone ?? "";
  }
  syncPayment();
  openDialog($("#checkout"));
  (form["customer.name"].value ? $("#place") : form["customer.name"]).focus();
}

async function placeOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#place");
  const lines = validLines();
  button.disabled = true;
  try {
    const customer = { name: form["customer.name"].value.trim(), phone: form["customer.phone"].value.trim() };
    const { data } = await api("/store/orders", {
      method: "POST",
      body: {
        customer,
        paymentMethod: form.paymentMethod.value,
        notes: form.notes.value.trim(),
        website: form.website.value,
        items: lines.map(({ productId, qty, cut }) => ({ productId, qty, ...(cut ? { note: cut } : {}) })),
      },
    });
    // Para «Pedir lo mismo» la próxima vez (solo en este celular).
    writeJson(LAST_KEY, { at: new Date().toISOString(), items: lines.map(({ productId, qty, cut }) => ({ productId, qty, cut })) });
    writeJson("marea-cliente", customer);
    state.cart = [];
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

/* ───────────── Carga y eventos ───────────── */
async function load() {
  const { data } = await api("/store");
  state.store = data;
  state.products = new Map();
  state.categoryOf = new Map();
  for (const category of data.categories) {
    for (const product of category.products) {
      state.products.set(product.id, product);
      state.categoryOf.set(product.id, category);
    }
  }
  // Lo que ya no está disponible sale del carrito; lo que pasó del máximo se ajusta.
  state.cart = state.cart.filter((line) => state.products.get(line.productId)?.available);
  for (const line of state.cart) line.qty = Math.min(line.qty, state.products.get(line.productId).maxQty);
  saveCart();
  renderHead();
  renderBoard();
  renderRepeat();
  renderCatalog();
  renderCart();
  renderPaymentOptions();
}

$("#theme").innerHTML = themeControl("toggle");
document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open]");
  if (opener) return openSheet(opener.dataset.open);
  const chip = event.target.closest("[data-cat]");
  if (chip) {
    state.category = chip.dataset.cat;
    renderCatalog();
    return $("#tools").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const line = event.target.closest("[data-line]");
  if (line) return changeLine(line.dataset.line, Number(line.dataset.delta));
  if (event.target.closest("[data-checkout]")) return openCheckout();
  const closer = event.target.closest("[data-close]");
  if (closer) closer.closest("dialog")?.close();
});
$$("[data-close]").forEach((node) => {
  if (!node.textContent.trim()) node.innerHTML = icon("x");
});
$("#search").addEventListener("input", (event) => {
  state.filter = event.target.value;
  renderCatalog();
});
$("#sheet-form").addEventListener("click", (event) => {
  const delta = event.target.closest("[data-qty]");
  if (delta) return setSheetQty(state.sheet.qty + Number(delta.dataset.qty) * (isKg(state.sheet.product) ? 0.5 : 1));
  const set = event.target.closest("[data-set]");
  if (set) setSheetQty(Number(set.dataset.set));
});
$("#sheet-form").addEventListener("input", (event) => {
  if (event.target.name === "qty") setSheetQty(Number(event.target.value.replace(",", ".")));
});
$("#sheet-form").addEventListener("change", (event) => {
  if (event.target.name === "cut") state.sheet.cut = event.target.value;
  if (event.target.name === "qty") event.target.value = fmt.num(state.sheet.qty);
});
$("#sheet-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const { product, qty, cut } = state.sheet;
  if (!(qty > 0)) return;
  $("#sheet").close();
  addToCart(product.id, qty, product.cutOptions.length ? cut : null);
});
$("#cart-bar-open").addEventListener("click", () => openDialog($("#cart-dialog")));
$("#checkout-form").addEventListener("change", (event) => event.target.name === "paymentMethod" && syncPayment());
$("#checkout-form").addEventListener("submit", placeOrder);
bindCopy($("#pay-info"));

try {
  await load();
} catch {
  $("#catalog").innerHTML = '<div class="error-box">No pudimos cargar la tienda. Revisa tu conexión y recarga la página.</div>';
}
