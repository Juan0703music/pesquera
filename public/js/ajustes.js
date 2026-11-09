import { $, api, ApiError, showError, showFieldErrors, startShell, toast } from "/js/core.js";

const local = (phone) => (phone ? phone.slice(2).replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3") : "");
const money = (value) => Number(String(value).replace(/\D/g, "")) || 0;

await startShell("ajustes", "admin.manage");
const form = $("#settings-form");
try {
  const { data } = await api("/settings");
  form.businessName.value = data.businessName;
  form.address.value = data.address ?? "";
  form.phone.value = local(data.phone);
  form.whatsapp.value = local(data.whatsapp);
  form.storeOpen.checked = data.storeOpen;
  form.minOrderTotal.value = data.minOrderTotal;
  $("#store-url").textContent = `${location.origin}/tienda`;
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
        storeOpen: form.storeOpen.checked, minOrderTotal: money(form.minOrderTotal.value),
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
