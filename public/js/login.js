import { $, api, icon } from "/js/core.js";

$("#mark").innerHTML = icon("wave");
api("/store").then(({ data }) => ($("#business").textContent = data.business.name)).catch(() => {});

$("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  $("#error").hidden = true;
  button.disabled = true;
  try {
    await api("/auth/login", { method: "POST", body: { email: form.email.value, password: form.password.value } });
    const back = new URLSearchParams(location.search).get("volver");
    location.href = back && back.startsWith("/app/") ? back : "/app/pedidos";
  } catch (error) {
    $("#error").textContent = error.message;
    $("#error").hidden = false;
    button.disabled = false;
  }
});

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
