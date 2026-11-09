/**
 * Usuarios de la pesquera de demostración (los crea `npm run db:seed`).
 * Solo en desarrollo el inicio de sesión ofrece entrar con ellos con un clic.
 */
export const DEMO_PASSWORD = "marea12345";
export const DEMO_USERS = [
  { name: "Luz Marina Pérez", email: "admin@pesquera.test", role: "ADMIN" },
  { name: "Carlos Mendoza", email: "ventas@pesquera.test", role: "VENTAS" },
  { name: "Yeison Arrieta", email: "despacho@pesquera.test", role: "DESPACHO" },
  { name: "Rafael Banquez", email: "bodega@pesquera.test", role: "BODEGA" },
] as const;
