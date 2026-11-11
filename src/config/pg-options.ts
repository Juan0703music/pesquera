import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

/**
 * Opciones de conexión a PostgreSQL, compartidas por la aplicación y los scripts (copias de seguridad).
 *
 * - Local (localhost): sin cifrado y con la sesión en UTC (la base embebida puede venir en hora de Colombia).
 * - Remota (Supabase): siempre cifrada. Con el certificado del proyecto (DATABASE_CA_CERT) se verifica
 *   el servidor («verify-full»); sin él la conexión va cifrada pero sin verificar quién responde.
 *   No se envía `-c TimeZone` porque el pooler de Supabase no acepta parámetros de arranque; Supabase
 *   ya trabaja en UTC y la aplicación lo comprueba al iniciar.
 */
export type DatabaseSsl = "auto" | "disable" | "require" | "verify-full";

export interface PgOptionsInput {
  connectionString: string;
  ssl?: DatabaseSsl;
  /** Certificado raíz en PEM, en base64 o la ruta a un archivo .crt. */
  caCert?: string;
  max?: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDatabase(connectionString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

/** Acepta el certificado pegado tal cual, en base64 (útil en variables de una sola línea) o como ruta. */
export function readCaCert(value: string): string {
  const trimmed = value.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("BEGIN CERTIFICATE")) return decoded;
  }
  return readFileSync(trimmed, "utf8");
}

/** Modo efectivo: «auto» es sin cifrado en local, verificado si hay certificado y cifrado en los demás casos. */
export function effectiveSsl(input: PgOptionsInput): Exclude<DatabaseSsl, "auto"> {
  const mode = input.ssl ?? "auto";
  if (mode !== "auto") return mode;
  if (isLocalDatabase(input.connectionString)) return "disable";
  return input.caCert ? "verify-full" : "require";
}

export function pgPoolConfig(input: PgOptionsInput): PoolConfig {
  // Los parámetros sslmode/sslrootcert de la URL se ignoran: el cifrado lo decide `ssl` (una sola regla).
  const url = new URL(input.connectionString);
  for (const param of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(param);
  const mode = effectiveSsl(input);
  const local = isLocalDatabase(input.connectionString);
  const ssl =
    mode === "disable"
      ? false
      : mode === "verify-full"
        ? { rejectUnauthorized: true, ...(input.caCert ? { ca: readCaCert(input.caCert) } : {}) }
        : { rejectUnauthorized: false };
  return {
    connectionString: url.toString(),
    ssl,
    max: input.max ?? 10,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    application_name: "marea",
    ...(local ? { options: "-c TimeZone=UTC" } : {}),
  };
}
