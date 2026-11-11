"use strict";
const params = new URLSearchParams(location.search);
const server = params.get("servidor") || "";
const status = document.getElementById("estado");
document.getElementById("servidor").textContent = server.replace(/^https?:\/\//, "");

let checking = false;
async function check(manual) {
  if (checking || !server) return;
  checking = true;
  if (manual) status.textContent = "Probando…";
  const result = await window.mareaEscritorio.probarServidor(server);
  checking = false;
  if (result.ok) {
    status.textContent = "¡Volvió la conexión!";
    window.mareaEscritorio.reintentar();
  } else if (manual) {
    status.textContent = "Todavía sin respuesta. Seguimos intentando.";
  }
}

document.getElementById("reintentar").addEventListener("click", () => check(true));
window.addEventListener("online", () => check(false));
setInterval(() => check(false), 5000);
