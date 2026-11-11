"use strict";
const form = document.getElementById("formulario");
const input = document.getElementById("servidor");
const button = document.getElementById("conectar");
const status = document.getElementById("estado");

function say(text, kind) {
  status.textContent = text;
  status.dataset.tipo = kind || "";
}

window.mareaEscritorio.info().then((info) => {
  if (info.servidor && !input.value) input.value = info.servidor;
  input.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  let value = input.value.trim();
  if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  button.disabled = true;
  say("Probando la conexión…");
  const result = await window.mareaEscritorio.probarServidor(value);
  if (!result.ok) {
    button.disabled = false;
    say(result.error, "error");
    return;
  }
  say("¡Conectado! Abriendo el panel…", "ok");
  await window.mareaEscritorio.guardarServidor(result.server);
});
