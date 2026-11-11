/**
 * Íconos y nombre de las apps de Marea (Windows y Android).
 *
 *   node apps/iconos/generar.mjs https://tu-marea.up.railway.app
 *
 * Toma del servidor el logo de la pesquera (/media/logo/icon-512.png y maskable-512.png) y su nombre
 * (/manifest.webmanifest). Así el logo nunca se guarda en el repositorio: se descarga al construir.
 * Sin dirección, usa la ola de Marea y el nombre «Marea» (lo que queda en el repositorio).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const apps = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = (process.argv[2] ?? "").trim().replace(/\/+$/, "");

function wave(radius) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fd6e8"/><stop offset=".55" stop-color="#0b8fb0"/><stop offset="1" stop-color="#0b5f7a"/></linearGradient></defs>
    <rect width="64" height="64" rx="${radius}" fill="url(#g)"/>
    <g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round">
      <path d="M12 26c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"/><path d="M12 36c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"/><path d="M12 46c5 0 6-5 10-5s6 5 10 5 6-5 10-5 6 5 10 5"/>
    </g></svg>`);
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let icon; // logo cuadrado con fondo transparente (o la ola)
let maskable; // logo dentro de la zona segura, con fondo
let name = "Marea";
if (server) {
  if (!/^https:\/\//.test(server)) throw new Error("La dirección del servidor debe empezar por https://");
  icon = await download(`${server}/media/logo/icon-512.png`);
  maskable = await download(`${server}/media/logo/maskable-512.png`);
  const manifest = JSON.parse((await download(`${server}/manifest.webmanifest`)).toString("utf8"));
  name = String(manifest.short_name || manifest.name || "Marea").trim() || "Marea";
} else {
  icon = await sharp(wave(15)).png().toBuffer();
  maskable = await sharp(wave(0)).png().toBuffer();
}

const write = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const png = (input, size) => sharp(input).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const circle = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

// ── Windows ──
const desktop = path.join(apps, "escritorio");
write(path.join(desktop, "instalador", "icon.png"), await png(icon, 512));
write(path.join(desktop, "recursos", "icono.png"), await png(icon, 256));
write(path.join(desktop, "servidor.json"), `${JSON.stringify({ url: server }, null, 2)}\n`);

// ── Android ──
const res = path.join(apps, "android", "app", "src", "main", "res");
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(densities)) {
  const legacy = Math.round(48 * scale);
  const layer = Math.round(108 * scale);
  // Android 7 (sin íconos adaptables): cuadrado con fondo y versión redonda.
  write(path.join(res, `mipmap-${density}`, "ic_launcher.png"), await png(maskable, legacy));
  write(
    path.join(res, `mipmap-${density}`, "ic_launcher_round.png"),
    await sharp(await png(maskable, legacy)).composite([{ input: circle(legacy), blend: "dest-in" }]).png().toBuffer(),
  );
  // Android 8 o superior: capa del logo (58 % del lienzo de 108 dp, dentro de la zona segura) sobre fondo blanco.
  const inner = Math.round(layer * 0.58);
  write(
    path.join(res, `mipmap-${density}`, "ic_launcher_foreground.png"),
    await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await png(icon, inner), gravity: "center" }])
      .png()
      .toBuffer(),
  );
}
// Pantalla de bienvenida mientras abre (128 dp).
write(path.join(res, "drawable-xxhdpi", "splash.png"), await png(icon, 384));

const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "\\'").replace(/"/g, '\\"');
write(
  path.join(res, "values", "marca.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<!-- Lo reescribe apps/iconos/generar.mjs con el nombre de la pesquera al construir la app. -->\n<resources>\n    <string name="app_name">${xml(name)}</string>\n</resources>\n`,
);

console.log(`Íconos listos para «${name}» (${server || "sin servidor: ola de Marea"}).`);
