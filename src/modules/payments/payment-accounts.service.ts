import jsqrModule from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";
import { prisma } from "../../config/database.js";
import type { PaymentAccount } from "../../generated/prisma/client.js";
import type { PaymentAccountKind, PaymentMethod } from "../../generated/prisma/enums.js";
import { live } from "../../services/live.service.js";
import { AppError, notFound } from "../../utils/errors.js";
import type { PaymentAccountInput } from "./payment-accounts.schemas.js";

/**
 * Cuentas donde la pesquera recibe pagos: llaves Bre-B, Nequi, Daviplata y cuentas bancarias.
 *
 * El QR no lo inventa Marea: el administrador sube el pantallazo del QR para recibir pagos que le da su
 * banco o billetera; aquí se lee el código que contiene y se vuelve a dibujar nítido. Así el cliente
 * escanea exactamente el código que emitió el banco (lo leen Nequi, Daviplata y las apps bancarias).
 * La imagen subida no se guarda.
 */

export const KIND_LABELS: Record<PaymentAccountKind, string> = {
  BRE_B: "Llave Bre-B",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  BANCO: "Cuenta bancaria",
};

/** Cuentas que se le muestran al cliente según cómo dijo que va a pagar (Bre-B sirve desde cualquier banco). */
export const ACCOUNTS_FOR_METHOD: Partial<Record<PaymentMethod, PaymentAccountKind[]>> = {
  BRE_B: ["BRE_B"],
  NEQUI: ["NEQUI", "BRE_B"],
  TRANSFERENCIA: ["BANCO", "DAVIPLATA", "BRE_B"],
};
export const TRANSFER_METHODS = Object.keys(ACCOUNTS_FOR_METHOD) as PaymentMethod[];

const KIND_ORDER: PaymentAccountKind[] = ["BRE_B", "NEQUI", "DAVIPLATA", "BANCO"];

export type BreBKeyType = "CELULAR" | "DOCUMENTO" | "CORREO" | "ALIAS";
export const BRE_B_KEY_LABELS: Record<BreBKeyType, string> = {
  CELULAR: "Celular",
  DOCUMENTO: "Documento o código de comercio",
  CORREO: "Correo",
  ALIAS: "Llave alfanumérica",
};

/**
 * Tipo de llave Bre-B y su forma normalizada. Las llaves pueden ser el celular, el número de documento
 * (cédula o NIT) o el código de comercio, el correo, o una llave alfanumérica que empieza por @.
 */
export function parseBreBKey(raw: string): { type: BreBKeyType; key: string } | null {
  const value = raw.trim();
  if (/^@[a-z0-9._-]{2,30}$/i.test(value)) return { type: "ALIAS", key: value };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 80) return { type: "CORREO", key: value.toLowerCase() };
  const digits = value.replace(/[\s.+-]/g, "");
  const national = digits.startsWith("57") && digits.length === 12 ? digits.slice(2) : digits;
  if (/^3\d{9}$/.test(national)) return { type: "CELULAR", key: national };
  if (/^\d{5,15}$/.test(digits)) return { type: "DOCUMENTO", key: digits };
  return null;
}

/** Lo que se muestra de una cuenta (al administrador, al personal y al cliente). */
async function present(account: PaymentAccount) {
  const keyType = account.kind === "BRE_B" ? parseBreBKey(account.accountKey)?.type ?? null : null;
  const qrSvg = account.qrPayload
    ? await QRCode.toString(account.qrPayload, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
    : null;
  return {
    id: account.id,
    kind: account.kind,
    kindLabel: KIND_LABELS[account.kind],
    accountKey: account.accountKey,
    keyType,
    keyTypeLabel: keyType ? BRE_B_KEY_LABELS[keyType] : null,
    holderName: account.holderName,
    holderDocument: account.holderDocument,
    bankName: account.bankName,
    bankAccountType: account.bankAccountType,
    active: account.active,
    sortOrder: account.sortOrder,
    hasQr: account.qrPayload !== null,
    /** El QR es el estándar interoperable (EMVCo) que usan Bre-B y los bancos. */
    qrInteroperable: account.qrPayload?.startsWith("000201") ?? false,
    qrSvg,
  };
}
export type PresentedAccount = Awaited<ReturnType<typeof present>>;

const sortAccounts = (accounts: PaymentAccount[]) =>
  accounts.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());

/** Cuentas de esos tipos, en el orden de los tipos (paga con Nequi → primero Nequi, luego la llave Bre-B). */
function forKinds(accounts: PresentedAccount[], kinds: PaymentAccountKind[]) {
  return accounts.filter((account) => kinds.includes(account.kind)).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
}

// jsQR es CommonJS: según el cargador, la función llega como default o como default.default.
type ReadQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { data: string } | null;
const jsQR = ((jsqrModule as unknown as { default?: ReadQr }).default ?? jsqrModule) as unknown as ReadQr;

/** Lee el código QR de una imagen (pantallazo o foto). Prueba varios tamaños porque jsQR es sensible a la escala. */
export async function readQr(input: Buffer): Promise<string | null> {
  for (const size of [1600, 1000, 2400, 700]) {
    try {
      const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: "attemptBoth" });
      if (found?.data) return found.data;
    } catch {
      throw new AppError(415, "INVALID_IMAGE", "No pudimos abrir esa imagen. Sube un pantallazo en PNG, JPG o WebP.");
    }
  }
  return null;
}

async function findAccount(id: string) {
  const account = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!account) throw notFound("Esa cuenta de cobro no existe.");
  return account;
}

function dataFor(input: PaymentAccountInput) {
  return {
    kind: input.kind,
    accountKey: input.accountKey,
    holderName: input.holderName,
    holderDocument: input.holderDocument ?? null,
    bankName: input.kind === "BANCO" ? input.bankName : null,
    bankAccountType: input.kind === "BANCO" ? input.bankAccountType : null,
    active: input.active,
  };
}

export const paymentAccountsService = {
  async list({ activeOnly }: { activeOnly: boolean }) {
    const accounts = sortAccounts(await prisma.paymentAccount.findMany({ where: activeOnly ? { active: true } : {} }));
    return Promise.all(accounts.map(present));
  },

  async create(input: PaymentAccountInput) {
    const account = await prisma.paymentAccount.create({ data: { ...dataFor(input), sortOrder: await prisma.paymentAccount.count() } });
    live.emit("settings", "payment-account.created");
    return present(account);
  },

  async update(id: string, input: PaymentAccountInput) {
    await findAccount(id);
    const account = await prisma.paymentAccount.update({ where: { id }, data: dataFor(input) });
    live.emit("settings", "payment-account.updated");
    return present(account);
  },

  async setActive(id: string, active: boolean) {
    await findAccount(id);
    const account = await prisma.paymentAccount.update({ where: { id }, data: { active } });
    live.emit("settings", "payment-account.updated");
    return present(account);
  },

  async remove(id: string) {
    await findAccount(id);
    await prisma.paymentAccount.delete({ where: { id } });
    live.emit("settings", "payment-account.deleted");
  },

  /** Lee el QR del pantallazo y guarda su contenido. Error claro si la imagen no tiene un QR legible. */
  async setQr(id: string, image: Buffer) {
    await findAccount(id);
    const payload = await readQr(image);
    if (!payload) {
      throw new AppError(
        422,
        "QR_NOT_FOUND",
        "No encontramos un código QR en esa imagen. Sube el pantallazo del QR para recibir pagos que te da tu banco o billetera (que se vea completo y nítido).",
      );
    }
    if (payload.length > 1000) throw new AppError(422, "QR_TOO_LONG", "Ese código QR no parece de cobro. Sube el QR para recibir pagos.");
    const account = await prisma.paymentAccount.update({ where: { id }, data: { qrPayload: payload } });
    live.emit("settings", "payment-account.updated");
    return present(account);
  },

  async clearQr(id: string) {
    await findAccount(id);
    const account = await prisma.paymentAccount.update({ where: { id }, data: { qrPayload: null } });
    live.emit("settings", "payment-account.updated");
    return present(account);
  },

  /**
   * Para la tienda: las cuentas activas y, por cada forma de pago por transferencia, cuáles mostrar.
   * Una forma de pago sin cuentas activas no aparece en este mapa (se paga al recibir, como antes).
   */
  async forStore() {
    const accounts = await this.list({ activeOnly: true });
    const byMethod: Partial<Record<PaymentMethod, string[]>> = {};
    for (const method of TRANSFER_METHODS) {
      const kinds = ACCOUNTS_FOR_METHOD[method]!;
      const ids = forKinds(accounts, kinds).map((account) => account.id);
      if (ids.length) byMethod[method] = ids;
    }
    return { accounts, byMethod };
  },

  /** Cuentas activas para pagar con `method` (vacío si se paga en efectivo, datáfono o crédito). */
  async forMethod(method: PaymentMethod) {
    const kinds = ACCOUNTS_FOR_METHOD[method];
    if (!kinds) return [];
    return forKinds(await this.list({ activeOnly: true }), kinds);
  },

  /** QR en PNG para que el cliente lo guarde y lo cargue en su app desde el mismo celular. */
  async qrPng(id: string) {
    const account = await prisma.paymentAccount.findUnique({ where: { id } });
    if (!account || !account.active || !account.qrPayload) throw notFound("Esa cuenta no tiene QR de pago.", "PAYMENT_QR_NOT_FOUND");
    return QRCode.toBuffer(account.qrPayload, { type: "png", width: 900, margin: 4, errorCorrectionLevel: "M" });
  },
};
