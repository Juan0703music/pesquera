import { beforeEach, describe, expect, it } from "vitest";

// El código se define antes de cargar la aplicación (la configuración se lee al importarla).
process.env.SETUP_CODE = "codigo-de-configuracion-de-prueba";
const { default: request } = await import("supertest");
const { app, settings } = await import("./helpers/app.js");
const { resetDatabase } = await import("./helpers/db.js");

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

const admin = { name: "Juan David", email: "juan@ejemplo.com", password: "clave-segura-123" };

describe("primera cuenta con código de configuración (SETUP_CODE)", () => {
  it("la entrada avisa que hace falta el código", async () => {
    const status = await request(app).get("/api/v1/auth/status");
    expect(status.body.data).toMatchObject({ needsSetup: true, setupCodeRequired: true });
  });

  it("sin el código o con uno equivocado nadie se queda con el sistema", async () => {
    const missing = await request(app).post("/api/v1/auth/register").send(admin);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("SETUP_CODE_INVALID");

    const wrong = await request(app).post("/api/v1/auth/register").send({ ...admin, setupCode: "otro-codigo-cualquiera" });
    expect(wrong.status).toBe(403);

    const right = await request(app).post("/api/v1/auth/register").send({ ...admin, setupCode: "codigo-de-configuracion-de-prueba" });
    expect(right.status).toBe(201);
    expect(right.body.data.profile.user.role).toBe("ADMIN");
  });

  it("después de la primera cuenta el código ya no se pide (las demás quedan pendientes de aprobación)", async () => {
    await request(app).post("/api/v1/auth/register").send({ ...admin, setupCode: "codigo-de-configuracion-de-prueba" }).expect(201);
    expect((await request(app).get("/api/v1/auth/status")).body.data.setupCodeRequired).toBe(false);
    const next = await request(app).post("/api/v1/auth/register").send({ ...admin, email: "ventas@ejemplo.com" });
    expect(next.body.data.status).toBe("PENDING");
  });
});
