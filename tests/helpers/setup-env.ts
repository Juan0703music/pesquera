import { inject } from "vitest";

// Se ejecuta antes de importar la aplicación en cada archivo de pruebas.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = inject("databaseUrl");
process.env.APP_URL = "http://localhost:3100";
process.env.COOKIE_SECURE = "false";
process.env.SESSION_TTL_DAYS = "7";
process.env.TIME_ZONE = "America/Bogota";
