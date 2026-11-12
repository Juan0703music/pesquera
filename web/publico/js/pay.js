// Cuentas de pago (llave Bre-B, Nequi, Daviplata, banco) tal como las ve quien paga:
// el QR nítido (siempre sobre blanco, para que lo lea la cámara), la llave con «Copiar» y el titular.
import { esc, fmt, icon, toast } from "/js/core.js";

const KIND_ICON = { BRE_B: "qr", NEQUI: "phone", DAVIPLATA: "phone", BANCO: "cash" };
const ACCOUNT_TYPE = { AHORROS: "Ahorros", CORRIENTE: "Corriente" };

/** «3001234567» → «300 123 4567»; las demás llaves se muestran como están. */
export function prettyKey(account) {
  if (/^3\d{9}$/.test(account.accountKey)) return account.accountKey.replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3");
  return account.accountKey;
}

/** Qué es la llave o el número, en palabras: «Llave Bre-B · Celular», «Cuenta de ahorros · Bancolombia». */
export function accountSubtitle(account) {
  if (account.kind === "BRE_B") return `Llave Bre-B${account.keyTypeLabel ? ` · ${account.keyTypeLabel}` : ""}`;
  if (account.kind === "BANCO") return `Cuenta ${ACCOUNT_TYPE[account.bankAccountType]?.toLowerCase() ?? ""} · ${account.bankName ?? ""}`;
  return `${account.kindLabel} · celular`;
}

/**
 * Tarjeta de pago. options.qr: "big" | "small" | false · options.download: enlace para guardar el QR (tienda).
 */
export function payAccountHtml(account, { qr = "big", download = false } = {}) {
  const qrHtml =
    qr && account.qrSvg
      ? `<figure class="qr-box qr-${qr}" aria-label="Código QR para pagar a ${esc(account.kindLabel)}">${account.qrSvg}</figure>`
      : "";
  return `
    <article class="pay-account" data-kind="${account.kind}">
      ${qrHtml}
      <div class="pay-info">
        <span class="pay-kind">${icon(KIND_ICON[account.kind] ?? "cash", "icon-sm")}${esc(accountSubtitle(account))}</span>
        <div class="pay-key-row">
          <strong class="pay-key num">${esc(prettyKey(account))}</strong>
          <button type="button" class="btn btn-sm btn-soft" data-copy="${esc(account.accountKey)}" aria-label="Copiar ${esc(prettyKey(account))}">${icon("copy", "icon-sm")}Copiar</button>
        </div>
        <span class="pay-holder">A nombre de <strong>${esc(account.holderName)}</strong>${account.holderDocument ? ` · ${esc(account.holderDocument)}` : ""}</span>
        ${download && account.qrSvg ? `<a class="pay-download" href="#" data-qr-guardar>${icon("download", "icon-sm")}Guardar el QR en el celular</a>` : ""}
      </div>
    </article>`;
}

/** Texto para enviar por WhatsApp con el valor y las cuentas. */
export function paymentText({ number, total, exact = true }, accounts) {
  const lines = [`Pedido #${number} — ${exact ? "Total a pagar" : "Total estimado"}: ${fmt.cop(total)}`];
  for (const account of accounts) {
    const extra = account.kind === "BANCO" ? ` (${ACCOUNT_TYPE[account.bankAccountType] ?? ""} ${account.bankName ?? ""})` : "";
    lines.push(`${account.kindLabel}: ${prettyKey(account)}${extra} — ${account.holderName}${account.holderDocument ? `, ${account.holderDocument}` : ""}`);
  }
  return lines.join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sin permiso de portapapeles (http o navegador antiguo): selección manual.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "sr-only";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Activa los botones «Copiar» dentro de `root` (una sola vez por contenedor). */
export function bindCopy(root) {
  if (root.dataset.copyBound) return;
  root.dataset.copyBound = "1";
  root.addEventListener("click", async (event) => {
    const guardarQr = event.target.closest("[data-qr-guardar]");
    if (guardarQr) {
      event.preventDefault();
      return guardarQrComoImagen(guardarQr.closest(".pay-card, .pay-account, article, li, div")?.querySelector(".qr-box svg"));
    }
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const ok = await copyText(button.dataset.copy);
    toast(ok ? "Copiado" : "No se pudo copiar: selecciónalo y cópialo a mano.", { error: !ok, timeout: 2200, detail: ok ? button.dataset.copy.split("\n")[0] : "" });
  });
}

export { copyText };

/** Convierte el QR (SVG) en una imagen PNG y la descarga: así se carga en la app del banco desde la galería. */
async function guardarQrComoImagen(svg) {
  if (!svg) return toast("No encontramos el QR.", { error: true });
  const texto = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([texto], { type: "image/svg+xml" }));
  try {
    const imagen = new Image();
    imagen.src = url;
    await imagen.decode();
    const lienzo = Object.assign(document.createElement("canvas"), { width: 900, height: 900 });
    const ctx = lienzo.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 900, 900);
    ctx.drawImage(imagen, 0, 0, 900, 900);
    const png = await new Promise((resolve) => lienzo.toBlob(resolve, "image/png"));
    const enlace = Object.assign(document.createElement("a"), { href: URL.createObjectURL(png), download: "qr-de-pago.png" });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
  } catch {
    toast("No se pudo guardar el QR: tómale un pantallazo.", { error: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}
