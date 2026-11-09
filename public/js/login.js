import { $, $$, api, ApiError, esc, icon, showFieldErrors, themeControl } from "/js/core.js";

const ROLE_ICON = { ADMIN: "settings", VENTAS: "cash", DESPACHO: "truck", BODEGA: "box" };
const back = () => {
  const target = new URLSearchParams(location.search).get("volver");
  return target && target.startsWith("/app/") ? target : "/app/pedidos";
};

$("#mark").innerHTML = icon("wave");
$("#theme").innerHTML = themeControl("toggle");

function setMode(mode) {
  $(`input[name="mode"][value="${mode}"]`).checked = true;
  $("#login").hidden = mode !== "login";
  $("#register").hidden = mode !== "register";
  $("#register-done").hidden = true;
  $("#auth-title").textContent = mode === "login" ? "Entrar al panel" : $("#setup-note").hidden ? "Crear cuenta" : "Configura tu pesquera";
  (mode === "login" ? $("#login").email : $("#register").name).focus();
}

$$('input[name="mode"]').forEach((input) => input.addEventListener("change", () => setMode(input.value)));
$$("[data-show-password]").forEach((box) =>
  box.addEventListener("change", () => (box.closest("form").password.type = box.checked ? "text" : "password")),
);

async function login(email, password, errorBox) {
  errorBox.hidden = true;
  try {
    await api("/auth/login", { method: "POST", body: { email, password } });
    location.href = back();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
}

$("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  await login(form.email.value.trim(), form.password.value, $("#login-error"));
  button.disabled = false;
});

$("#register").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#register-submit");
  $("#register-error").hidden = true;
  showFieldErrors(form, null);
  button.disabled = true;
  try {
    const { data } = await api("/auth/register", {
      method: "POST",
      body: { name: form.name.value.trim(), email: form.email.value.trim(), password: form.password.value, role: form.role.value },
    });
    if (data.status === "ACTIVE") {
      // Primera cuenta: es el administrador y ya tiene la sesión abierta.
      location.href = "/app/ajustes";
      return;
    }
    form.hidden = true;
    $("#tabs").hidden = true;
    $("#auth-title").textContent = "¡Cuenta creada!";
    $("#register-done").hidden = false;
    $("#register-done").innerHTML = `<div class="stack"><p>${icon("checkCircle")} <strong>${esc(form.name.value.trim())}</strong>, tu solicitud quedó registrada.</p>
      <p class="muted">El administrador de la pesquera debe aprobarla en «Personal». Cuando lo haga, entra con tu correo <strong>${esc(form.email.value.trim())}</strong> y tu contraseña.</p>
      <button class="btn" type="button" id="go-login">Volver a entrar</button></div>`;
    $("#go-login").addEventListener("click", () => {
      $("#tabs").hidden = false;
      $("#login").email.value = form.email.value.trim();
      form.reset();
      form.hidden = false;
      setMode("login");
    });
  } catch (error) {
    if (!showFieldErrors(form, error)) {
      $("#register-error").textContent = error instanceof ApiError ? error.message : "No se pudo crear la cuenta.";
      $("#register-error").hidden = false;
    }
  } finally {
    button.disabled = false;
  }
});

try {
  const { data } = await api("/auth/status");
  $("#business").textContent = data.businessName ?? "";
  if (data.needsSetup) {
    // Sistema nuevo: solo se puede crear la cuenta del administrador.
    $("#setup-note").hidden = false;
    $("#role-field").hidden = true;
    $("#register-help").hidden = true;
    $("#register-submit").textContent = "Crear cuenta de administrador";
    $("#tabs").hidden = true;
    setMode("register");
  }
  if (data.demo) {
    $("#demo").hidden = false;
    $("#demo-users").innerHTML = data.demo.users
      .map((user) => `<button class="btn demo-user" type="button" data-email="${esc(user.email)}">${icon(ROLE_ICON[user.role] ?? "users")}<span><strong>${esc(user.roleLabel)}</strong><small>${esc(user.name)}</small></span></button>`)
      .join("");
    $("#demo-users").addEventListener("click", (event) => {
      const button = event.target.closest("[data-email]");
      if (!button) return;
      $$("#demo-users button").forEach((node) => (node.disabled = true));
      login(button.dataset.email, data.demo.password, $("#login-error")).finally(() => $$("#demo-users button").forEach((node) => (node.disabled = false)));
    });
  }
} catch {
  // Sin estado (servidor caído): el formulario de entrada sigue disponible y mostrará el error al enviarlo.
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
