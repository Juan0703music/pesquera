import { DEMO_USERS } from "./demo.js";
import { prisma } from "./database.js";
import { env, isProduction } from "./env.js";
import { effectiveSsl, isLocalDatabase } from "./pg-options.js";

/**
 * Revisión al arrancar. Errores: el servidor no debe arrancar así. Avisos: funciona, pero falta algo
 * para estar bien protegido en producción. Se registran en el log (Railway los muestra en «Deploy Logs»).
 */
export async function checkReadiness(): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // La aplicación guarda y compara fechas en UTC.
  const timeZone = (await prisma.$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`)[0]?.TimeZone ?? "desconocida";
  if (!["UTC", "Etc/UTC", "GMT"].includes(timeZone)) {
    errors.push(
      `La base de datos está en la zona horaria «${timeZone}» y debe estar en UTC. En Supabase → SQL Editor ejecuta: ALTER DATABASE postgres SET timezone TO 'UTC';`,
    );
  }

  if (!isProduction) return { errors, warnings };

  const ssl = effectiveSsl({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, caCert: env.DATABASE_CA_CERT });
  if (!isLocalDatabase(env.DATABASE_URL) && ssl === "disable") errors.push("La conexión a la base de datos no está cifrada (DATABASE_SSL=disable).");
  if (ssl === "require") warnings.push("La conexión a la base va cifrada pero sin verificar el servidor: agrega DATABASE_CA_CERT (certificado de Supabase).");
  if (!env.COOKIE_SECURE) warnings.push("COOKIE_SECURE debe ser true en producción (la cookie de sesión solo viaja por HTTPS).");
  if (!env.APP_URL.startsWith("https://")) warnings.push(`APP_URL debe empezar por https:// (ahora es ${env.APP_URL}).`);
  if (env.TRUST_PROXY === 0) warnings.push("TRUST_PROXY debe ser 1 detrás de Railway: si no, los límites de intentos tratan a todos como un solo visitante.");

  // Las cuentas de demostración tienen una contraseña conocida: nunca activas en producción
  // (llegarían si alguien restaura en Supabase una copia de la base de desarrollo).
  const demoEmails = DEMO_USERS.map((user) => user.email as string);
  const demoAccounts = await prisma.user.count({ where: { email: { in: demoEmails }, active: true } });
  if (demoAccounts > 0) {
    errors.push(
      `Hay ${demoAccounts} cuenta(s) de demostración activas (contraseña conocida). En Supabase → SQL Editor ejecuta: UPDATE users SET active = false WHERE email LIKE '%@pesquera.test';`,
    );
  }

  const users = await prisma.user.count();
  if (users === 0 && !env.SETUP_CODE) {
    errors.push("No hay ninguna cuenta y falta SETUP_CODE: define un código para crear la cuenta del administrador desde la pantalla de entrada.");
  } else if (users === 0) {
    warnings.push("Todavía no hay cuentas: entra a /login y crea la del administrador con el código SETUP_CODE.");
  }
  return { errors, warnings };
}
