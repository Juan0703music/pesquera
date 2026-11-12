// Personal (versión del navegador): nombre, rol y PIN opcional de cada persona.
import { $, $$, api, ApiError, connectLive, debounce, esc, icon, openDialog, showError, showFieldErrors, startShell, toast } from "/js/core.js";

const ROLES = {
  ADMIN: ["Administrador", "Todo: pedidos, inventario, precios, ventas, tablero en vivo, personal, ajustes y copias de seguridad."],
  VENTAS: ["Ventas", "Recibe pedidos (mostrador, llamada, WhatsApp), cobra, despacha y ve las ventas del día."],
  DESPACHO: ["Despacho", "Alista, pesa, marca listo, despacha y entrega pedidos."],
  BODEGA: ["Bodega", "Registra entradas de mercancía, conteos y mermas; ve los pedidos."],
};
let users = [];
let editing = null;

function render() {
  $("#users").innerHTML = `<table class="table"><thead><tr><th>Persona</th><th>Rol</th><th>Entrada</th><th>Estado</th><th></th></tr></thead><tbody>
    ${users
      .map(
        (user) => `<tr>
      <td><strong>${esc(user.name)}</strong>${user.isSelf ? ' <span class="badge badge-brand">Tú</span>' : ""}</td>
      <td>${esc(user.roleLabel)}</td>
      <td>${user.hasPin ? `<span class="badge">${icon("check")}Con PIN</span>` : '<span class="muted">Sin PIN</span>'}</td>
      <td>${user.active ? `<span class="badge badge-good">${icon("checkCircle")}Activo</span>` : `<span class="badge">${icon("ban")}Inactivo</span>`}</td>
      <td class="actions"><button class="btn btn-sm" data-edit="${user.id}">${icon("edit", "icon-sm")}Editar</button></td></tr>`,
      )
      .join("")}
  </tbody></table>`;
}

function open(user) {
  editing = user;
  const form = $("#user-form");
  form.reset();
  $("#user-error").hidden = true;
  showFieldErrors(form, null);
  $("#user-title").textContent = user ? `Editar a ${user.name}` : "Nueva persona";
  $("#active-wrap").hidden = !user || user.isSelf;
  $("#remove-pin-wrap").hidden = !user?.hasPin;
  $("#pin-label").textContent = user?.hasPin ? "PIN nuevo (vacío: sigue el mismo)" : "PIN para entrar (opcional, de 4 a 8 números)";
  if (user) {
    form.name.value = user.name;
    form.role.value = user.role;
    form.active.checked = user.active;
  }
  openDialog($("#user-dialog"));
  form.name.focus();
}

async function submit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const pin = form.pin.value.trim();
  try {
    if (editing) {
      const body = { name: form.name.value.trim(), role: form.role.value };
      if (!editing.isSelf) body.active = form.active.checked;
      if (pin) body.pin = pin;
      else if (form.removePin.checked) body.removePin = true;
      await api(`/users/${editing.id}`, { method: "PATCH", body });
    } else {
      await api("/users", { method: "POST", body: { name: form.name.value.trim(), role: form.role.value, pin } });
    }
    $("#user-dialog").close();
    toast(editing ? "Cambios guardados." : "Persona agregada. Ya aparece en la pantalla de entrada.");
    await load();
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#user-error").textContent = error instanceof ApiError ? error.message : "No se pudo guardar.";
      $("#user-error").hidden = false;
    }
  }
}

async function load() {
  users = (await api("/users")).data;
  render();
}

await startShell("personal", "admin.manage");
$("#btn-new").innerHTML = `${icon("plus")}Agregar persona`;
$("#btn-new").addEventListener("click", () => open(null));
$$("[data-close]").forEach((node) => {
  if (!node.textContent.trim()) node.innerHTML = icon("x");
  node.addEventListener("click", () => node.closest("dialog").close());
});
$("#roles").innerHTML = Object.values(ROLES).map(([name, text]) => `<div><strong>${name}</strong><div class="muted">${text}</div></div>`).join("");
$("#user-form").addEventListener("submit", submit);
$("#users").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit]");
  if (button) open(users.find((user) => user.id === button.dataset.edit));
});
await load().catch(showError);
const reload = debounce(() => load().catch(() => {}), 300);
connectLive((event) => (event.scope === "users" || event.scope === "all") && reload());
