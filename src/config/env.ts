import { existsSync } from "node:fs";
import { z } from "zod";

// En pruebas las variables las define tests/helpers/setup-env.ts.
if (!process.env.VITEST && existsSync(".env")) process.loadEnvFile(".env");

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3100),
  APP_URL: z.url().default("http://localhost:3100"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria."),
  // Cifrado de la conexión: auto (local sin cifrar; remota cifrada y verificada si hay certificado),
  // disable, require (cifrada sin verificar) o verify-full (cifrada y verificada con DATABASE_CA_CERT).
  DATABASE_SSL: z.enum(["auto", "disable", "require", "verify-full"]).default("auto"),
  // Certificado raíz del proyecto de Supabase (Database Settings → SSL Configuration): PEM, base64 o ruta.
  DATABASE_CA_CERT: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
  // Conexiones simultáneas a la base. Con el pooler de Supabase (modo sesión), pocas: 5 alcanzan.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  // Código para crear la primera cuenta (administrador) en un servidor nuevo. Obligatorio en producción
  // mientras no exista ninguna cuenta: evita que alguien de afuera se registre primero y se quede con todo.
  SETUP_CODE: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(12, "SETUP_CODE debe tener al menos 12 caracteres.").optional()),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  COOKIE_SECURE: booleanFromString.default(false),
  TIME_ZONE: z.string().default("America/Bogota"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno inválidas:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
