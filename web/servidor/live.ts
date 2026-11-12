/**
 * Avisos «en vivo» de la versión del navegador (reemplaza a src/services/live.service.ts).
 * Cada cambio se avisa por BroadcastChannel a todas las pestañas de Marea abiertas en este navegador
 * (por ejemplo, el tablero «En vivo 3D» en otra ventana se actualiza al registrar un pedido).
 */
export type LiveScope = "orders" | "inventory" | "catalog" | "settings" | "users";

export interface LiveEvent {
  scope: LiveScope;
  kind: string;
  data?: Record<string, unknown>;
  at: string;
}

export const CANAL_EN_VIVO = "marea-en-vivo";
const canal = typeof BroadcastChannel === "function" ? new BroadcastChannel(CANAL_EN_VIVO) : null;
const oyentes = new Set<(event: LiveEvent) => void>();

export const live = {
  emit(scope: LiveScope, kind: string, data?: Record<string, unknown>) {
    const event: LiveEvent = { scope, kind, data, at: new Date().toISOString() };
    canal?.postMessage(event);
    for (const oyente of oyentes) oyente(event);
  },
  on(listener: (event: LiveEvent) => void) {
    oyentes.add(listener);
    return () => oyentes.delete(listener);
  },
};
