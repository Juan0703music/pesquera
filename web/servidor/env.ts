/**
 * Configuración de la versión del navegador (reemplaza a src/config/env.ts al empaquetar).
 * No hay variables de entorno: todo corre en este navegador y los datos se quedan en él.
 */
const origin = typeof self !== "undefined" && self.location ? self.location.origin : "http://localhost";

export const env = {
  NODE_ENV: "production" as "development" | "test" | "production",
  PORT: 0,
  APP_URL: origin,
  TRUST_PROXY: 0,
  LOG_LEVEL: "warn" as const,
  DATABASE_URL: "pglite://navegador",
  DATABASE_SSL: "disable" as const,
  DATABASE_CA_CERT: undefined as string | undefined,
  DATABASE_POOL_MAX: 1,
  SETUP_CODE: undefined as string | undefined,
  VAPID_PUBLIC_KEY: undefined as string | undefined,
  VAPID_PRIVATE_KEY: undefined as string | undefined,
  VAPID_SUBJECT: undefined as string | undefined,
  ANDROID_PACKAGE: "io.github.juan0703music.marea",
  ANDROID_CERT_SHA256: [] as string[],
  /** La sesión dura hasta que la persona sale (o 30 días sin usarla). */
  SESSION_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  TIME_ZONE: "America/Bogota",
};

export const isProduction = true;
export const isTest = false;
