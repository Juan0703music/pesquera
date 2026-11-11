"use strict";
const status = document.getElementById("estado");

window.mareaEscritorio.info().then((info) => {
  if (info.servidor) return;
  // Solo pasa con un instalador de ensayo: no trae la dirección de la nube.
  document.getElementById("titulo").textContent = "Instalador de prueba";
  document.getElementById("mensaje").textContent =
    "Este instalador no está conectado a la nube de la pesquera. Descarga el instalador oficial (Marea-Setup) desde la página de descargas y vuelve a instalar.";
  document.getElementById("acciones").hidden = true;
});

let checking = false;
async function check(manual) {
  if (checking) return;
  checking = true;
  if (manual) status.textContent = "Probando…";
  const result = await window.mareaEscritorio.comprobarConexion();
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
