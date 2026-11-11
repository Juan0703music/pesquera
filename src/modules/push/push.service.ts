import webpush from "web-push";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { can, type Permission } from "../auth/permissions.js";

/**
 * Avisos al celular y al computador (Web Push) aunque la app esté cerrada: «Pedido nuevo #123».
 *
 * Cada equipo que activa los avisos guarda aquí su dirección (endpoint) y sus llaves. El servidor firma
 * cada aviso con sus llaves VAPID: las de las variables de entorno o, si no hay, unas que crea la primera
 * vez y guarda en la base (así funciona sin configurar nada y no cambian al reiniciar).
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Pantalla que se abre al tocar el aviso. */
  url: string;
  /** Avisos con la misma etiqueta se reemplazan en vez de amontonarse. */
  tag: string;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Solo los servicios de avisos de los navegadores: el servidor nunca envía a direcciones arbitrarias. */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

/** «Android · Chrome», «Windows · Edge»… a partir del navegador. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Equipo";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return `${os} · ${browser}`;
}

let cachedKeys: Promise<{ publicKey: string; privateKey: string }> | null = null;

async function loadKeys() {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const stored = await prisma.webPushKeys.findUnique({ where: { id: 1 } });
  if (stored) return { publicKey: stored.publicKey, privateKey: stored.privateKey };
  const generated = webpush.generateVAPIDKeys();
  // Si dos procesos arrancan a la vez, gana el primero y ambos usan esas llaves.
  await prisma.webPushKeys.createMany({ data: [{ id: 1, ...generated }], skipDuplicates: true });
  const saved = await prisma.webPushKeys.findUniqueOrThrow({ where: { id: 1 } });
  return { publicKey: saved.publicKey, privateKey: saved.privateKey };
}

function keys() {
  cachedKeys ??= loadKeys().catch((error) => {
    cachedKeys = null;
    throw error;
  });
  return cachedKeys;
}

function subject() {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  return env.APP_URL.startsWith("https://") ? env.APP_URL : "https://github.com/Juan0703music/pesquera";
}

export const pushService = {
  /** Llave pública para que el navegador se suscriba. */
  async publicKey() {
    return (await keys()).publicKey;
  },

  /** Guarda (o pasa a esta persona) la suscripción de un equipo. */
  async subscribe(userId: string, input: SubscriptionInput, device: string) {
    const data = { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, device };
    await prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
  },

  async unsubscribe(userId: string, endpoint: string) {
    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  },

  async devices(userId: string) {
    return prisma.pushSubscription.findMany({ where: { userId }, select: { id: true, device: true, createdAt: true, lastSentAt: true }, orderBy: { createdAt: "asc" } });
  },

  /**
   * Envía un aviso a los equipos de las personas activas con el permiso indicado.
   * Devuelve cuántos se entregaron. Las suscripciones que ya no existen (404/410) se borran.
   */
  async send(payload: PushPayload, options: { permission: Permission; excludeUserId?: string | null; onlyUserId?: string }) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        user: { active: true },
        ...(options.onlyUserId ? { userId: options.onlyUserId } : {}),
        ...(options.excludeUserId ? { NOT: { userId: options.excludeUserId } } : {}),
      },
      include: { user: { select: { role: true } } },
    });
    const targets = subscriptions.filter((subscription) => can(subscription.user.role, options.permission));
    if (targets.length === 0) return 0;

    const { publicKey, privateKey } = await keys();
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      targets.map((subscription) =>
        webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, body, {
          vapidDetails: { subject: subject(), publicKey, privateKey },
          TTL: 6 * 60 * 60,
          urgency: "high",
          timeout: 10_000,
        }),
      ),
    );

    const gone: string[] = [];
    const delivered: string[] = [];
    results.forEach((result, index) => {
      const subscription = targets[index]!;
      if (result.status === "fulfilled") return delivered.push(subscription.id);
      const status = (result.reason as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(subscription.id);
      else logger.warn({ status, device: subscription.device }, "No se pudo entregar un aviso al celular");
    });
    if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    if (delivered.length) await prisma.pushSubscription.updateMany({ where: { id: { in: delivered } }, data: { lastSentAt: new Date() } });
    return delivered.length;
  },

  /** Pedido nuevo por atender: avisa al equipo, menos a quien lo registró. Nunca frena el pedido. */
  newOrder(order: { id: string; number: number; customerName: string; total: number; source: string; createdById: string | null }, sourceLabel: string) {
    const total = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(order.total);
    void this.send(
      { title: `Pedido nuevo #${order.number}`, body: `${order.customerName} · ${sourceLabel} · ${total}`, url: `/app/pedidos?pedido=${order.id}`, tag: `pedido-${order.id}` },
      { permission: "orders.view", excludeUserId: order.createdById },
    ).catch((error) => logger.warn({ err: error }, "Falló el envío de avisos de pedido nuevo"));
  },
};
