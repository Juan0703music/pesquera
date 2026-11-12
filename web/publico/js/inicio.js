// Portada: prepara Marea en este navegador y lleva al panel (o a la entrada si no hay sesión).
import { motorListo, sesionGuardada, showError } from "/js/core.js";

try {
  await motorListo();
  location.replace(sesionGuardada.get() ? "/app/pedidos" : "/login");
} catch (error) {
  const main = document.querySelector("main");
  main.replaceChildren(Object.assign(document.createElement("h1"), { textContent: "No se pudo abrir Marea" }), Object.assign(document.createElement("p"), { textContent: error.message }));
  showError(error);
}
