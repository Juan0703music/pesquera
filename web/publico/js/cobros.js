import { $, $$, api, apiRaw, ApiError, connectLive, debounce, esc, icon, openDialog, showError, showFieldErrors, startShell, toast } from "/js/core.js";
import { accountSubtitle, bindCopy, prettyKey } from "/js/pay.js";

const KIND_ICON = { BRE_B: "qr", NEQUI: "phone", DAVIPLATA: "phone", BANCO: "cash" };
const HELP = {
  BRE_B: "Pagos inmediatos desde cualquier banco o billetera. La llave puede ser tu celular, tu cédula o NIT, el código de comercio, tu correo o una llave que empiece por @.",
  NEQUI: "El celular de tu cuenta Nequi. Si tu Nequi también tiene llave Bre-B, agrégala aparte como «Llave Bre-B».",
  DAVIPLATA: "El celular de tu cuenta Daviplata.",
  BANCO: "Para transferencias tradicionales. Las personas de otros bancos suelen pagar más rápido con la llave Bre-B.",
};
const KEY_LABEL = { BRE_B: "Llave Bre-B", NEQUI: "Celular de Nequi", DAVIPLATA: "Celular de Daviplata", BANCO: "Número de cuenta" };
const KEY_PLACEHOLDER = { BRE_B: "@pesquera, 300 123 4567, 900123456 o correo", NEQUI: "300 123 4567", DAVIPLATA: "300 123 4567", BANCO: "Solo números" };

let accounts = [];
let editing = null;

/* ───────────── Lista ───────────── */
function card(account) {
  const qr = account.qrSvg
    ? `<figure class="qr-box" title="QR para pagar">${account.qrSvg}</figure>`
    : `<label class="qr-drop" data-drop="${account.id}">${icon("upload")}Sube el pantallazo del QR<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" data-qr-file="${account.id}" /></label>`;
  return `
    <article class="card account-card${account.active ? "" : " is-hidden"}" data-id="${account.id}">
      <div class="card-head">
        <h2>${icon(KIND_ICON[account.kind] ?? "cash")}${esc(account.kindLabel)}</h2>
        <div class="spacer"></div>
        <label class="switch" title="${account.active ? "Los clientes la ven" : "Oculta para los clientes"}">
          <input type="checkbox" data-active="${account.id}" ${account.active ? "checked" : ""} /><span class="track" aria-hidden="true"></span>${account.active ? "Visible" : "Oculta"}
        </label>
      </div>
      <div class="account-body">
        ${qr}
        <div class="account-meta">
          <span class="pay-kind">${esc(accountSubtitle(account))}</span>
          <div class="pay-key-row"><strong class="pay-key num">${esc(prettyKey(account))}</strong></div>
          <span class="pay-holder">A nombre de <strong>${esc(account.holderName)}</strong>${account.holderDocument ? `<br>${esc(account.holderDocument)}` : ""}</span>
          ${account.hasQr ? `<span class="badge ${account.qrInteroperable ? "badge-good" : "badge-brand"}">${icon("checkCircle")}${account.qrInteroperable ? "QR interoperable (Bre-B)" : "QR cargado"}</span>` : '<span class="badge badge-warning">' + icon("alert") + "Sin QR: los clientes ven solo la llave</span>"}
        </div>
      </div>
      <div class="account-foot">
        <button class="btn btn-sm btn-soft" data-copy="${esc(account.accountKey)}">${icon("copy", "icon-sm")}Copiar</button>
        ${account.hasQr ? `<label class="btn btn-sm btn-ghost">${icon("upload", "icon-sm")}Cambiar QR<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" data-qr-file="${account.id}" /></label><button class="btn btn-sm btn-ghost" data-clear-qr="${account.id}">Quitar QR</button>` : ""}
        <div class="spacer"></div>
        <button class="btn btn-sm btn-ghost btn-icon" data-edit="${account.id}" aria-label="Editar ${esc(account.kindLabel)} ${esc(prettyKey(account))}">${icon("edit", "icon-sm")}</button>
        <button class="btn btn-sm btn-ghost btn-icon btn-danger" data-delete="${account.id}" aria-label="Eliminar ${esc(account.kindLabel)} ${esc(prettyKey(account))}">${icon("trash", "icon-sm")}</button>
      </div>
    </article>`;
}

function render() {
  $("#accounts").innerHTML = accounts.length
    ? accounts.map(card).join("")
    : `<div class="card empty stack"><strong>Todavía no tienes cuentas de cobro</strong><span>Agrega tu llave Bre-B o tu Nequi para cobrar con QR en el mostrador o enviarla por WhatsApp.</span><div><button class="btn btn-primary" data-new>${icon("plus")}Agregar la primera</button></div></div>`;
}

async function load() {
  accounts = (await api("/payment-accounts")).data;
  render();
}

/* ───────────── QR ───────────── */
async function uploadQr(id, file) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast("Sube el pantallazo en PNG, JPG o WebP.", { error: true });
  if (file.size > 8 * 1024 * 1024) return toast("La imagen pesa más de 8 MB. Toma un pantallazo en lugar de una foto grande.", { error: true });
  const drop = $(`[data-drop="${id}"]`);
  drop?.classList.add("is-busy");
  try {
    const json = await apiRaw(`/payment-accounts/${id}/qr`, { body: file });
    toast(json.data.qrInteroperable ? "QR leído: es el QR interoperable de Bre-B." : "QR leído y guardado.");
    await load();
  } catch (error) {
    showError(error);
    drop?.classList.remove("is-busy");
  }
}

/* ───────────── Formulario ───────────── */
function syncForm() {
  const form = $("#account-form");
  const kind = form.kind.value;
  $("#kind-help").textContent = HELP[kind];
  $("#key-label").textContent = KEY_LABEL[kind];
  form.accountKey.placeholder = KEY_PLACEHOLDER[kind];
  form.accountKey.inputMode = kind === "BRE_B" ? "text" : "numeric";
  $("#bank-fields").hidden = kind !== "BANCO";
}

function openForm(account) {
  editing = account ?? null;
  const form = $("#account-form");
  form.reset();
  showFieldErrors(form, null);
  $("#account-error").hidden = true;
  $("#qr-preview-img").hidden = true;
  $("#qr-preview-text").textContent = account?.hasQr
    ? "Esta cuenta ya tiene QR. Sube otro pantallazo solo si quieres cambiarlo."
    : "Sube el pantallazo del QR que te da tu banco o billetera (PNG, JPG o WebP).";
  $("#account-title").textContent = account ? `Editar ${account.kindLabel}` : "Nueva cuenta de cobro";
  if (account) {
    form.kind.value = account.kind;
    form.accountKey.value = account.accountKey;
    form.holderName.value = account.holderName;
    form.holderDocument.value = account.holderDocument ?? "";
    form.bankName.value = account.bankName ?? "";
    form.bankAccountType.value = account.bankAccountType ?? "AHORROS";
    form.active.checked = account.active;
  }
  syncForm();
  openDialog($("#account-dialog"));
  form.accountKey.focus();
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.kind.value;
  const body = {
    kind,
    accountKey: form.accountKey.value.trim(),
    holderName: form.holderName.value.trim(),
    holderDocument: form.holderDocument.value.trim(),
    active: form.active.checked,
    ...(kind === "BANCO" ? { bankName: form.bankName.value.trim(), bankAccountType: form.bankAccountType.value } : {}),
  };
  const button = $("#account-save");
  button.disabled = true;
  $("#account-error").hidden = true;
  try {
    const { data } = editing ? await api(`/payment-accounts/${editing.id}`, { method: "PUT", body }) : await api("/payment-accounts", { method: "POST", body });
    const file = form.qr.files[0];
    $("#account-dialog").close();
    toast(editing ? "Cuenta actualizada." : "Cuenta de cobro agregada.");
    if (file) await uploadQr(data.id, file);
    else await load();
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#account-error").textContent = error instanceof ApiError ? error.message : "No se pudo guardar.";
      $("#account-error").hidden = false;
    }
  } finally {
    button.disabled = false;
  }
}

/* ───────────── Arranque ───────────── */
await startShell("cobros", "admin.manage");
$("#btn-new").innerHTML = `${icon("plus")}Agregar cuenta`;
$("#btn-new").addEventListener("click", () => openForm(null));
$$("[data-close]").forEach((node) => {
  if (!node.textContent.trim()) node.innerHTML = icon("x");
  node.addEventListener("click", () => node.closest("dialog").close());
});
const form = $("#account-form");
form.addEventListener("change", (event) => {
  if (event.target.name === "kind") syncForm();
  if (event.target.name === "qr") {
    const file = event.target.files[0];
    const img = $("#qr-preview-img");
    if (img.src) URL.revokeObjectURL(img.src);
    img.hidden = !file;
    if (file) img.src = URL.createObjectURL(file);
    $("#qr-preview-text").textContent = file ? `${file.name}: se leerá el código al guardar.` : "Sube el pantallazo del QR.";
  }
});
form.addEventListener("submit", submitForm);
bindCopy($("#accounts"));

const list = $("#accounts");
list.addEventListener("click", async (event) => {
  if (event.target.closest("[data-new]")) return openForm(null);
  const edit = event.target.closest("[data-edit]");
  if (edit) return openForm(accounts.find((account) => account.id === edit.dataset.edit));
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    const account = accounts.find((item) => item.id === remove.dataset.delete);
    if (!confirm(`¿Eliminar ${account.kindLabel} ${prettyKey(account)}? Los clientes dejarán de verla.`)) return;
    try {
      await api(`/payment-accounts/${account.id}`, { method: "DELETE" });
      toast("Cuenta eliminada.");
      await load();
    } catch (error) {
      showError(error);
    }
    return;
  }
  const clear = event.target.closest("[data-clear-qr]");
  if (clear) {
    try {
      await api(`/payment-accounts/${clear.dataset.clearQr}/qr`, { method: "DELETE" });
      toast("QR quitado. Los clientes verán solo la llave.");
      await load();
    } catch (error) {
      showError(error);
    }
  }
});
list.addEventListener("change", async (event) => {
  const file = event.target.closest("[data-qr-file]");
  if (file) return uploadQr(file.dataset.qrFile, file.files[0]);
  const toggle = event.target.closest("[data-active]");
  if (toggle) {
    try {
      await api(`/payment-accounts/${toggle.dataset.active}/active`, { method: "PATCH", body: { active: toggle.checked } });
      toast(toggle.checked ? "Ahora los clientes ven esta cuenta." : "Cuenta oculta para los clientes.");
      await load();
    } catch (error) {
      showError(error);
      toggle.checked = !toggle.checked;
    }
  }
});
// Arrastrar el pantallazo sobre el recuadro del QR.
list.addEventListener("dragover", (event) => {
  const drop = event.target.closest("[data-drop]");
  if (!drop) return;
  event.preventDefault();
  drop.classList.add("is-over");
});
list.addEventListener("dragleave", (event) => event.target.closest("[data-drop]")?.classList.remove("is-over"));
list.addEventListener("drop", (event) => {
  const drop = event.target.closest("[data-drop]");
  if (!drop) return;
  event.preventDefault();
  drop.classList.remove("is-over");
  uploadQr(drop.dataset.drop, event.dataTransfer.files[0]);
});

await load().catch(showError);
connectLive((event) => event.scope === "settings" && debounce(() => load().catch(() => {}), 300)());
