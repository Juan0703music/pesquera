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
