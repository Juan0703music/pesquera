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
  // Avisos al celular (Web Push). Opcionales: si no se definen, el servidor crea sus llaves la primera vez
  // y las guarda en la base. Si se definen, deben ir las dos.
  VAPID_PUBLIC_KEY: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(80).optional()),
  VAPID_PRIVATE_KEY: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(40).optional()),
  // Contacto para los servicios de avisos (mailto: o https:). Por defecto, APP_URL si es https.
  VAPID_SUBJECT: z.preprocess((value) => (value === "" ? undefined : value), z.string().regex(/^(mailto:|https:\/\/)/, "VAPID_SUBJECT debe empezar por mailto: o https://").optional()),
  // App de Android (Trusted Web Activity): paquete y huella SHA-256 de la llave con que se firma.
  // La huella es pública (va en /.well-known/assetlinks.json); varias se separan con comas.
  ANDROID_PACKAGE: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).default("io.github.juan0703music.marea"),
  // Vacía o sin definir: la de apps/android/huella-sha256.txt (lo comprueba tests/pwa.test.ts).
  ANDROID_CERT_SHA256: z
    .preprocess((value) => (value === "" ? undefined : value), z.string().default("1C:72:9A:1F:08:0C:C8:66:4F:65:61:8E:E0:DA:19:6F:47:C2:6D:D8:20:8F:AD:97:6E:66:9E:6C:85:FD:15:00"))
    .transform((value) => value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, "ANDROID_CERT_SHA256 debe ser una huella SHA-256 (AA:BB:…)."))),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  COOKIE_SECURE: booleanFromString.default(false),
  TIME_ZONE: z.string().default("America/Bogota"),
});

const parsed = EnvSchema.refine((value) => Boolean(value.VAPID_PUBLIC_KEY) === Boolean(value.VAPID_PRIVATE_KEY), {
  message: "Define VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY juntas (o ninguna: el servidor crea sus llaves).",
  path: ["VAPID_PRIVATE_KEY"],
}).safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno inválidas:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
