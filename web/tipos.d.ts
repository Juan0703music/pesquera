// Módulos que crea el empaquetador (web/construir.mjs y la configuración de pruebas).
declare module "virtual:migraciones" {
  export const MIGRACIONES: { nombre: string; sql: string }[];
}
