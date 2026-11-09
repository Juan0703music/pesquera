import type { Role } from "../../generated/prisma/enums.js";

/**
 * Qué puede hacer cada rol. El dueño (ADMIN) puede todo; los demás, lo de su puesto.
 * El panel usa la misma tabla para mostrar solo las pantallas y botones permitidos.
 */
export const PERMISSIONS = {
  /** Ver el tablero de pedidos. */
  "orders.view": ["ADMIN", "VENTAS", "DESPACHO", "BODEGA"],
  /** Recibir pedidos (mostrador, llamada, WhatsApp) y ventas de mostrador. */
  "orders.create": ["ADMIN", "VENTAS"],
  /** Alistar, pesar, marcar listo, despachar y entregar. */
  "orders.dispatch": ["ADMIN", "VENTAS", "DESPACHO"],
  /** Registrar el pago. */
  "orders.collect": ["ADMIN", "VENTAS"],
  /** Cancelar antes de despachar (después de despachar, solo el administrador). */
  "orders.cancel": ["ADMIN", "VENTAS"],
  /** Ver productos y existencias. */
  "inventory.view": ["ADMIN", "VENTAS", "DESPACHO", "BODEGA"],
  /** Entradas de mercancía, conteos (ajustes) y mermas. */
  "inventory.move": ["ADMIN", "BODEGA"],
  /** Crear y editar productos, categorías y precios. */
  "catalog.manage": ["ADMIN"],
  /** Ventas del día y cierre de caja. */
  "sales.view": ["ADMIN", "VENTAS"],
  /** Tablero en vivo con analíticas 3D. */
  "analytics.view": ["ADMIN"],
  /** Personal y configuración de la pesquera. */
  "admin.manage": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Lista de permisos de un rol (la recibe el panel al iniciar sesión). */
export function permissionsOf(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => can(role, permission));
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  VENTAS: "Ventas",
  DESPACHO: "Despacho",
  BODEGA: "Bodega",
};
