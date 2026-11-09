import { $, $$, api, ApiError, esc, icon, openDialog, session, showError, showFieldErrors, startShell, toast } from "/js/core.js";

const ROLES = {
  ADMIN: ["Administrador", "Todo: pedidos, inventario, precios, ventas, tablero en vivo, personal y ajustes."],
  VENTAS: ["Ventas", "Recibe pedidos (mostrador, llamada, WhatsApp), cobra, despacha y ve las ventas del día."],
  DESPACHO: ["Despacho", "Alista, pesa, marca listo, despacha y entrega pedidos."],
  BODEGA: ["Bodega", "Registra entradas de mercancía, conteos y mermas; ve los pedidos."],
};
let users = [];
let editing = null;

function render() {
  $("#users").innerHTML = `<table class="table"><thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Desde</th><th></th></tr></thead><tbody>
    ${users.map((user) => `<tr>
      <td><strong>${esc(user.name)}</strong>${user.id === session.user.id ? ' <span class="badge badge-brand">Tú</span>' : ""}<br><span class="muted">${esc(user.email)}</span></td>
      <td>${esc(user.roleLabel)}</td>
      <td>${user.active ? `<span class="badge badge-good">${icon("checkCircle")}Activo</span>` : `<span class="badge">${icon("ban")}Inactivo</span>`}</td>
      <td class="muted">${new Date(user.createdAt).toLocaleDateString("es-CO")}</td>
      <td class="actions"><button class="btn btn-sm" data-edit="${user.id}">${icon("edit", "icon-sm")}Editar</button></td></tr>`).join("")}
  </tbody></table>`;
}

function open(user) {
  editing = user;
  const form = $("#user-form");
  form.reset();
  $("#user-error").hidden = true;
  showFieldErrors(form, null);
  $("#user-title").textContent = user ? `Editar a ${user.name}` : "Nueva persona";
  form.email.disabled = Boolean(user);
  $("#active-wrap").hidden = !user;
  $("#password-label").textContent = user ? "Nueva contraseña (opcional)" : "Contraseña (mínimo 8)";
  if (user) {
    form.name.value = user.name;
    form.email.value = user.email;
    form.role.value = user.role;
    form.active.checked = user.active;
  }
  openDialog($("#user-dialog"));
  form.name.focus();
}

async function submit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    if (editing) {
      const body = { name: form.name.value.trim(), role: form.role.value, active: form.active.checked };
      if (form.password.value) body.password = form.password.value;
      await api(`/users/${editing.id}`, { method: "PATCH", body });
    } else {
      await api("/users", { method: "POST", body: { name: form.name.value.trim(), email: form.email.value.trim(), role: form.role.value, password: form.password.value } });
    }
    $("#user-dialog").close();
    toast(editing ? "Cambios guardados. Si cambiaste rol o contraseña, debe volver a entrar." : "Persona creada. Ya puede entrar con su correo.");
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
