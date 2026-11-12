import { $, api, apiRaw, ApiError, icon, logoImg, showError, showFieldErrors, startShell, toast } from "/js/core.js";
import "/js/copias.js";

const local = (phone) => (phone ? phone.slice(2).replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3") : "");
const money = (value) => Number(String(value).replace(/\D/g, "")) || 0;

await startShell("ajustes", "admin.manage");

/* ───────────── Logo ───────────── */
let logo = null;
function renderLogo() {
  $("#logo-preview").innerHTML = logo ? logoImg(logo, "", "large") : `<span class="logo-empty">${icon("upload")}<span>Sin logo</span></span>`;
  $("#logo-preview").classList.toggle("is-round", Boolean(logo?.round));
  $("#logo-remove").hidden = !logo;
  if (logo) $("#logo-round").checked = logo.round;
}
$("#logo-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast("Sube el logo en PNG, JPG o WebP.", { error: true });
  if (file.size > 10 * 1024 * 1024) return toast("El logo pesa más de 10 MB.", { error: true });
  try {
    const json = await apiRaw(`/settings/logo?round=${$("#logo-round").checked}`, { body: file });
    logo = json.data.logo;
    renderLogo();
    await startShell("ajustes", "admin.manage"); // el menú muestra el logo nuevo de una vez
    toast("Logo guardado. Ya se ve en el panel y en la entrada.");
  } catch (error) {
    showError(error);
  }
});
$("#logo-round").addEventListener("change", async (event) => {
  if (!logo) return;
  try {
    logo = (await api("/settings/logo", { method: "PATCH", body: { round: event.target.checked } })).data.logo;
    renderLogo();
  } catch (error) {
    showError(error);
  }
});
$("#logo-remove").addEventListener("click", async () => {
  if (!confirm("¿Quitar el logo? Se volverá a ver la ola de Marea.")) return;
  try {
    await api("/settings/logo", { method: "DELETE" });
    logo = null;
    renderLogo();
    await startShell("ajustes", "admin.manage");
    toast("Logo quitado.");
  } catch (error) {
    showError(error);
  }
});
const form = $("#settings-form");
try {
  const { data } = await api("/settings");
  form.businessName.value = data.businessName;
  form.address.value = data.address ?? "";
  form.phone.value = local(data.phone);
  form.whatsapp.value = local(data.whatsapp);
  // La tienda en línea no existe en esta versión: se conservan los valores guardados.
  form.dataset.storeOpen = String(data.storeOpen);
  form.dataset.minOrderTotal = String(data.minOrderTotal);
  logo = data.logo;
  renderLogo();
} catch (error) {
  showError(error);
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#settings-error").hidden = true;
  try {
    await api("/settings", {
      method: "PUT",
      body: {
        businessName: form.businessName.value.trim(), address: form.address.value, phone: form.phone.value, whatsapp: form.whatsapp.value,
        storeOpen: form.dataset.storeOpen === "true", minOrderTotal: money(form.dataset.minOrderTotal ?? "0"),
      },
    });
    toast("Ajustes guardados.");
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#settings-error").textContent = error instanceof ApiError ? error.message : "No se pudo guardar.";
      $("#settings-error").hidden = false;
    }
  }
});
