// Entrada en la versión del navegador: la primera vez se crea la pesquera; después cada persona toca su nombre.
import { $, api, apiRaw, ApiError, esc, icon, logoImg, sesionGuardada, showFieldErrors, themeControl } from "/js/core.js";

const ROLE_ICON = { ADMIN: "settings", VENTAS: "cash", DESPACHO: "truck", BODEGA: "box" };
const back = () => {
  const target = new URLSearchParams(location.search).get("volver");
  return target && target.startsWith("/app/") ? target : "/app/pedidos";
};

$("#mark").innerHTML = icon("wave");
$("#theme").innerHTML = themeControl("toggle");

let people = [];
let chosen = null;

function entrar(data) {
  sesionGuardada.set(data.token);
  location.href = back();
}

function showPeople() {
  chosen = null;
  $("#pin-form").hidden = true;
  $("#people").hidden = false;
  $("#auth-title").textContent = "¿Quién va a usar Marea?";
}

async function login(person, pin) {
  try {
    const { data } = await api("/auth/login", { method: "POST", body: { userId: person.id, ...(pin ? { pin } : {}) } });
    entrar(data);
  } catch (error) {
    if (!person.hasPin) {
      $("#status-error").textContent = error.message;
      $("#status-error").hidden = false;
      return;
    }
    $("#pin-error").textContent = error.message;
    $("#pin-error").hidden = false;
    $("#pin-form").pin.select();
  }
}

$("#people").addEventListener("click", (event) => {
  const button = event.target.closest("[data-person]");
  if (!button) return;
  const person = people.find((item) => item.id === button.dataset.person);
  if (!person) return;
  if (!person.hasPin) {
    button.disabled = true;
    login(person).finally(() => (button.disabled = false));
    return;
  }
  chosen = person;
  $("#people").hidden = true;
  $("#pin-form").hidden = false;
  $("#pin-error").hidden = true;
  $("#auth-title").textContent = `Hola, ${person.name.split(" ")[0]}`;
  $("#pin-label").textContent = "Escribe tu PIN";
  $("#pin-form").reset();
  $("#pin-form").pin.focus();
});

$("#pin-back").addEventListener("click", showPeople);
$("#pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!chosen) return;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  await login(chosen, event.currentTarget.pin.value.trim());
  button.disabled = false;
});

$("#setup").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  $("#setup-error").hidden = true;
  showFieldErrors(form, null);
  button.disabled = true;
  try {
    const { data } = await api("/auth/setup", {
      method: "POST",
      body: { businessName: form.businessName.value.trim(), name: form.name.value.trim(), pin: form.pin.value.trim() },
    });
    sesionGuardada.set(data.token);
    location.href = "/app/ajustes";
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#setup-error").textContent = error instanceof ApiError ? error.message : "No se pudo crear la pesquera.";
      $("#setup-error").hidden = false;
    }
  } finally {
    button.disabled = false;
  }
});

// Otro computador: se trae todo desde una copia de seguridad.
$("#restore-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!confirm(`¿Restaurar la copia «${file.name}» en este navegador?`)) return;
  try {
    await apiRaw("/auth/restaurar", { method: "POST", body: file });
    location.reload();
  } catch (error) {
    $("#setup-error").textContent = error instanceof ApiError ? error.message : "No se pudo restaurar la copia.";
    $("#setup-error").hidden = false;
  }
});

try {
  // Si esta pestaña ya tiene una sesión vigente, entra directo.
  if (sesionGuardada.get()) {
    const me = await api("/auth/me").catch(() => null);
    if (me) location.replace(back());
    else sesionGuardada.clear();
  }
  const { data } = await api("/auth/status");
  $("#business").textContent = data.businessName ?? "";
  if (data.logo) {
    $("#auth-brand").innerHTML = `${logoImg(data.logo, "auth-logo", "large", data.businessName)}<span class="auth-brand-text"><strong>${esc(data.businessName ?? "")}</strong><span>Panel de la pesquera · Marea</span></span>`;
    $("#auth-brand").classList.add("has-logo");
  }
  if (data.needsSetup) {
    $("#auth-title").textContent = "Bienvenido a Marea";
    $("#setup").hidden = false;
    $("#setup").businessName.focus();
  } else {
    people = data.people;
    $("#people").innerHTML = people.length
      ? people
          .map(
            (person) =>
              `<button class="btn demo-user" type="button" data-person="${person.id}">${icon(ROLE_ICON[person.role] ?? "users")}<span><strong>${esc(person.name)}</strong><small>${esc(person.roleLabel)}${person.hasPin ? " · con PIN" : ""}</small></span></button>`,
          )
          .join("")
      : `<p class="muted">No hay nadie activo. Pídele al administrador que active tu cuenta.</p>`;
    showPeople();
  }
} catch (error) {
  $("#status-error").textContent = error instanceof ApiError || error instanceof Error ? error.message : "No se pudo abrir Marea.";
  $("#status-error").hidden = false;
}

// Olas: capas de senos que se desplazan despacio (se detienen si la persona prefiere menos movimiento).
const canvas = $("#waves");
const ctx = canvas.getContext("2d");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
function draw(time) {
  const ratio = Math.min(devicePixelRatio, 2);
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width !== w * ratio) {
    canvas.width = w * ratio;
    canvas.height = h * ratio;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const layers = [
    ["rgba(63,182,207,0.10)", 0.55, 26, 0.004, 0.00025],
    ["rgba(63,182,207,0.16)", 0.66, 20, 0.006, -0.00035],
    ["rgba(27,175,122,0.14)", 0.76, 16, 0.008, 0.0005],
    ["rgba(10,40,52,0.9)", 0.88, 12, 0.01, -0.0006],
  ];
  for (const [color, level, amp, freq, speed] of layers) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, h * level + Math.sin(x * freq + time * speed) * amp + Math.sin(x * freq * 2.3 + time * speed * 1.7) * amp * 0.35);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (!still) requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
