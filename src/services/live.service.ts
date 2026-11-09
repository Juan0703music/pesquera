import { EventEmitter } from "node:events";

/**
 * Avisos de cambios para las pantallas en vivo (Socket.IO los reenvía al equipo).
 * Solo avisan: PostgreSQL es la fuente de verdad y las pantallas vuelven a consultar la API.
 */
export type LiveScope = "orders" | "inventory" | "catalog" | "settings";

export interface LiveEvent {
  scope: LiveScope;
  /** Qué pasó, para mostrar avisos: «order.created», «order.status», «inventory.entry»… */
  kind: string;
  /** Datos breves para el aviso (número de pedido, cliente, producto…). */
  data?: Record<string, unknown>;
  at: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export const live = {
  emit(scope: LiveScope, kind: string, data?: Record<string, unknown>) {
    const event: LiveEvent = { scope, kind, data, at: new Date().toISOString() };
    emitter.emit("change", event);
  },
  on(listener: (event: LiveEvent) => void) {
    emitter.on("change", listener);
    return () => emitter.off("change", listener);
  },
};
