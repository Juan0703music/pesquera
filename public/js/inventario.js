import { $, $$, api, ApiError, can, connectLive, debounce, esc, fmt, icon, LABELS, levelBadge, openDialog, showError, showFieldErrors, startShell, toast } from "/js/core.js";

const state = { products: [], categories: [], kardexProduct: null, moveProduct: null, editing: null };
const parseNumber = (value) => Number(String(value).trim().replace(/\./g, "").replace(",", "."));
const parseDecimal = (value) => Number(String(value).trim().replace(",", "."));

/* ───────────── Tabla ───────────── */
function filtered() {
  const query = $("#search").value.trim().toLowerCase();
  const category = $("#filter-category").value;
  const level = $('input[name="filter-level"]:checked').value;
  return state.products.filter(
    (product) =>
      (!query || product.name.toLowerCase().includes(query)) &&
      (!category || product.category.id === category) &&
      (!level || product.level !== "OK"),
  );
}

function render() {
  const products = filtered();
  const showCost = can("catalog.manage");
  const active = state.products.filter((product) => product.active);
  const value = active.reduce((sum, product) => sum + product.stockValue, 0);
  const tiles = [
    ...(showCost ? [["cash", "Valor en bodega", fmt.cop(value), "al costo promedio"]] : []),
    ["box", "Productos activos", fmt.num(active.length), `${state.categories.length} categorías`],
    ["alert", "Stock bajo", fmt.num(active.filter((product) => product.level === "BAJO").length), "por debajo del mínimo"],
    ["ban", "Agotados", fmt.num(active.filter((product) => product.level === "AGOTADO").length), "sin existencia"],
  ];
  $("#stats").innerHTML = tiles
    .map(([iconName, label, val, hint]) => `<div class="card stat"><div class="label">${icon(iconName, "icon-sm")}${label}</div><div class="value num">${val}</div><div class="hint">${hint}</div></div>`)
    .join("");

  if (!products.length) {
    $("#table").innerHTML = '<div class="empty">No hay productos con ese filtro.</div>';
    return;
  }
  $("#table").innerHTML = `<table class="table">
    <thead><tr><th>Producto</th><th class="right">Existencia</th><th class="right">Comprometido</th><th class="right">Disponible</th><th class="right">Mínimo</th><th>Nivel</th><th class="right">Precio</th>${showCost ? '<th class="right">Costo prom.</th><th class="right">Valor</th>' : ""}<th></th></tr></thead>
    <tbody>${products.map((product) => `
      <tr>
        <td class="product-cell"><strong>${esc(product.name)}</strong>${product.active ? "" : ' <span class="badge">Inactivo</span>'}${product.inStore ? "" : ' <span class="badge" title="No se muestra en la tienda en línea">Solo local</span>'}<br><span class="muted">${esc(product.category.name)} · por ${product.unit === "KG" ? "kilo" : "unidad"}</span></td>
        <td class="right num"><strong>${fmt.qty(product.stockMilli, product.unit)}</strong></td>
        <td class="right num">${product.committedMilli ? fmt.qty(product.committedMilli, product.unit) : '<span class="muted">—</span>'}</td>
        <td class="right num">${product.availableMilli < 0 ? `<span class="badge badge-critical">${fmt.qty(product.availableMilli, product.unit)}</span>` : fmt.qty(product.availableMilli, product.unit)}</td>
        <td class="right num muted">${fmt.qty(product.minStockMilli, product.unit)}</td>
        <td>${levelBadge(product.level)}</td>
        <td class="right num">${fmt.cop(product.price)}<span class="muted">/${fmt.unitLabel(product.unit)}</span></td>
        ${showCost ? `<td class="right num">${product.avgCost ? fmt.cop(product.avgCost) : '<span class="muted">—</span>'}</td><td class="right num">${fmt.cop(product.stockValue)}</td>` : ""}
        <td class="actions">
          ${can("inventory.move") ? `<button class="btn btn-sm" data-move="${product.id}" data-type="ENTRADA" title="Registrar entrada de ${esc(product.name)}">${icon("plus", "icon-sm")}Entrada</button>` : ""}
          <details class="menu">
            <summary class="btn btn-sm btn-ghost" aria-label="Más acciones para ${esc(product.name)}">Más</summary>
            <div class="menu-list">
              ${can("inventory.move") ? `<button data-move="${product.id}" data-type="AJUSTE">${icon("scale", "icon-sm")}Conteo físico</button><button data-move="${product.id}" data-type="MERMA">${icon("alert", "icon-sm")}Registrar merma</button>` : ""}
              <button data-kardex="${product.id}">${icon("table", "icon-sm")}Ver kardex</button>
              ${can("catalog.manage") ? `<button data-edit="${product.id}">${icon("edit", "icon-sm")}Editar producto</button>` : ""}
            </div>
          </details>
        </td>
      </tr>`).join("")}
    </tbody></table>`;
}

async function load() {
  const [products, categories] = await Promise.all([api(`/catalog/products${$("#show-inactive").checked ? "?all=1" : ""}`), api("/catalog/categories")]);
  state.products = products.data;
  state.categories = categories.data;
  const select = $("#filter-category");
  const current = select.value;
  select.innerHTML = '<option value="">Todas las categorías</option>' + state.categories.map((category) => `<option value="${category.id}">${esc(category.name)}</option>`).join("");
  select.value = current;
  render();
}
const reload = debounce(() => load().catch(showError), 300);

/* ───────────── Kardex ───────────── */
async function loadKardex() {
  const product = state.products.find((item) => item.id === state.kardexProduct);
  $("#kardex-title").textContent = product ? `Kardex · ${product.name}` : "Movimientos recientes";
  $("#kardex-all").hidden = !product;
  const { data } = await api(`/inventory/movements?limit=${product ? 100 : 30}${product ? `&productId=${product.id}` : ""}`);
  $("#kardex").innerHTML = data.length
    ? `<table class="table"><thead><tr><th>Fecha</th>${product ? "" : "<th>Producto</th>"}<th>Movimiento</th><th class="right">Cantidad</th><th class="right">Queda</th><th>Detalle</th><th>Quién</th></tr></thead><tbody>
      ${data.map((movement) => `<tr>
        <td class="num">${fmt.dateTime(movement.createdAt)}</td>
        ${product ? "" : `<td>${esc(movement.product.name)}</td>`}
        <td>${movement.type === "MERMA" ? `<span class="badge badge-serious">${icon("alert")}Merma</span>` : movement.type === "ENTRADA" ? `<span class="badge badge-good">${icon("plus")}Entrada</span>` : `<span class="badge">${LABELS.movement[movement.type]}</span>`}</td>
        <td class="right num">${movement.qtyMilli > 0 ? "+" : ""}${fmt.qty(movement.qtyMilli, movement.product.unit)}</td>
        <td class="right num">${fmt.qty(movement.stockAfterMilli, movement.product.unit)}</td>
        <td>${esc([movement.order ? `Pedido #${movement.order.number}` : "", movement.supplier, movement.type === "ENTRADA" && movement.unitCost ? `${fmt.cop(movement.unitCost)}/${fmt.unitLabel(movement.product.unit)}` : "", movement.order ? "" : movement.note].filter(Boolean).join(" · "))}</td>
        <td class="muted">${esc(movement.user?.name ?? "")}</td></tr>`).join("")}
      </tbody></table>`
    : '<div class="empty">Sin movimientos.</div>';
  if (product) $("#kardex-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ───────────── Movimientos ───────────── */
const HELP = {
  ENTRADA: "Llegó mercancía (barco, lancha o proveedor). Si escribes el costo, se recalcula el costo promedio.",
  AJUSTE: "Pesaste o contaste lo que hay en la bodega: la existencia queda exactamente en esa cantidad.",
  MERMA: "Se perdió mercancía (se dañó, deshidratación, recorte de limpieza). Se descuenta de la existencia.",
};

function syncMoveForm() {
  const form = $("#move-form");
  const type = form.type.value;
  const product = state.moveProduct;
  const unit = product.unit === "KG" ? "kilos" : "unidades";
  $$("[data-for]", form).forEach((node) => (node.hidden = !node.dataset.for.split(" ").includes(type)));
  $("#move-help").textContent = HELP[type];
  $("#qty-label").textContent = type === "MERMA" ? `Cantidad perdida (${unit})` : `Cantidad que entra (${unit})`;
  $("#counted-label").textContent = `Cantidad contada (${unit}) · hoy dice ${fmt.qty(product.stockMilli, product.unit)}`;
  $("#cost-label").textContent = `Costo por ${product.unit === "KG" ? "kilo" : "unidad"}`;
  $("#note-label").textContent = type === "MERMA" ? "Motivo (obligatorio)" : "Nota";
}

function openMove(productId, type) {
  state.moveProduct = state.products.find((product) => product.id === productId);
  const form = $("#move-form");
  form.reset();
  form.type.value = type;
  $("#move-error").hidden = true;
  showFieldErrors(form, null);
  $("#move-title").textContent = state.moveProduct.name;
  syncMoveForm();
  openDialog($("#move-dialog"));
  (type === "AJUSTE" ? form.counted : form.qty).focus();
}

async function submitMove(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.type.value;
  const body = { type, productId: state.moveProduct.id, note: form.note.value.trim() };
  if (type === "AJUSTE") body.counted = parseDecimal(form.counted.value);
  else body.qty = parseDecimal(form.qty.value);
  if (type === "ENTRADA") {
    body.supplier = form.supplier.value.trim();
    if (form.unitCost.value.trim()) body.unitCost = parseNumber(form.unitCost.value);
  }
  if (type === "MERMA" && body.note.length < 3) return showMoveError("Escribe el motivo de la merma.");
  if ((type === "AJUSTE" ? body.counted : body.qty) === undefined || Number.isNaN(type === "AJUSTE" ? body.counted : body.qty)) return showMoveError("Escribe la cantidad.");
  try {
    await api("/inventory/movements", { method: "POST", body });
    $("#move-dialog").close();
    toast(`${LABELS.movement[type]} registrada: ${state.moveProduct.name}`);
    await load();
    await loadKardex();
  } catch (error) {
    if (!showFieldErrors(form, error)) showMoveError(error instanceof ApiError ? error.message : "No se pudo guardar.");
  }
  function showMoveError(message) {
    $("#move-error").textContent = message;
    $("#move-error").hidden = false;
  }
}

/* ───────────── Productos y categorías ───────────── */
function syncProductForm() {
  const form = $("#product-form");
  const kg = form.unit.value === "KG";
  $("#price-label").textContent = kg ? "Precio por kilo" : "Precio por unidad";
  $("#min-label").textContent = kg ? "Alerta de stock bajo (kg)" : "Alerta de stock bajo (unidades)";
}

function openProduct(productId) {
  const form = $("#product-form");
  const product = state.products.find((item) => item.id === productId) ?? null;
  state.editing = product;
  form.reset();
  $("#product-error").hidden = true;
  showFieldErrors(form, null);
  form.categoryId.innerHTML = state.categories.map((category) => `<option value="${category.id}">${esc(category.name)}</option>`).join("");
  $("#product-title").textContent = product ? `Editar ${product.name}` : "Nuevo producto";
  if (product) {
    form.name.value = product.name;
    form.categoryId.value = product.category.id;
    form.unit.value = product.unit;
    form.price.value = product.price;
    form.minStock.value = fmt.num(product.minStockMilli / 1000);
    form.description.value = product.description ?? "";
    form.active.checked = product.active;
    form.inStore.checked = product.inStore;
  }
  syncProductForm();
  openDialog($("#product-dialog"));
  form.name.focus();
}

async function submitProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    name: form.name.value.trim(),
    categoryId: form.categoryId.value,
    unit: form.unit.value,
    price: parseNumber(form.price.value),
    minStock: form.minStock.value.trim() ? parseDecimal(form.minStock.value) : 0,
    description: form.description.value.trim(),
    active: form.active.checked,
    inStore: form.inStore.checked,
  };
  try {
    if (state.editing) await api(`/catalog/products/${state.editing.id}`, { method: "PATCH", body });
    else await api("/catalog/products", { method: "POST", body });
    $("#product-dialog").close();
    toast(state.editing ? "Producto actualizado." : "Producto creado. Registra su primera entrada de mercancía.");
    await load();
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#product-error").textContent = error instanceof ApiError ? error.message : "No se pudo guardar.";
      $("#product-error").hidden = false;
    }
  }
}

async function submitCategory(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/catalog/categories", { method: "POST", body: { name: form.name.value.trim(), sortOrder: state.categories.length } });
    $("#category-dialog").close();
    toast("Categoría creada.");
    await load();
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#category-error").textContent = error instanceof ApiError ? error.message : "No se pudo crear.";
      $("#category-error").hidden = false;
    }
  }
}

/* ───────────── Arranque ───────────── */
await startShell("inventario", "inventory.view");
$(".toolbar .search").insertAdjacentHTML("afterbegin", icon("search"));
$$("[data-close]").forEach((node) => {
  if (!node.textContent.trim()) node.innerHTML = icon("x");
  node.addEventListener("click", () => node.closest("dialog").close());
});
if (can("catalog.manage")) {
  $("#btn-product").hidden = false;
  $("#btn-product").innerHTML = `${icon("plus")}Nuevo producto`;
  $("#btn-product").addEventListener("click", () => openProduct(null));
  $("#btn-category").hidden = false;
  $("#btn-category").textContent = "Nueva categoría";
  $("#btn-category").addEventListener("click", () => {
    $("#category-form").reset();
    $("#category-error").hidden = true;
    openDialog($("#category-dialog"));
  });
  $("#show-inactive-wrap").hidden = false;
}
$("#move-form").addEventListener("change", (event) => event.target.name === "type" && syncMoveForm());
$("#move-form").addEventListener("submit", submitMove);
$("#product-form").addEventListener("change", (event) => event.target.name === "unit" && syncProductForm());
$("#product-form").addEventListener("submit", submitProduct);
$("#category-form").addEventListener("submit", submitCategory);
$("#search").addEventListener("input", render);
$("#filter-category").addEventListener("change", render);
$$('input[name="filter-level"]').forEach((input) => input.addEventListener("change", render));
$("#show-inactive").addEventListener("change", () => load().catch(showError));
$("#kardex-all").addEventListener("click", () => {
  state.kardexProduct = null;
  loadKardex().catch(showError);
});
$("#table").addEventListener("click", (event) => {
  // Cierra el menú «Más» al elegir una opción.
  event.target.closest(".menu-list")?.closest("details")?.removeAttribute("open");
  const move = event.target.closest("[data-move]");
  if (move) return openMove(move.dataset.move, move.dataset.type);
  const kardex = event.target.closest("[data-kardex]");
  if (kardex) {
    state.kardexProduct = kardex.dataset.kardex;
    return loadKardex().catch(showError);
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) openProduct(edit.dataset.edit);
});

await load();
await loadKardex();
connectLive((event) => {
  if (["inventory", "catalog", "orders", "all"].includes(event.scope)) {
    reload();
    if (event.scope !== "orders") debounce(() => loadKardex().catch(() => {}), 400)();
  }
});
