import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/database.js";
import { app, settings, staff } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

const account = (overrides: Record<string, string> = {}) => ({ name: "Yuranis Montes", email: "yuranis@ejemplo.com", password: "clave-segura-123", role: "DESPACHO", ...overrides });

describe("registro desde el inicio de sesión", () => {
  it("sin nadie registrado, la primera cuenta es el administrador y entra de una vez", async () => {
    const status = await request(app).get("/api/v1/auth/status");
    expect(status.body.data).toMatchObject({ needsSetup: true, demo: null });

    const agent = request.agent(app);
    const res = await agent.post("/api/v1/auth/register").send(account({ role: "BODEGA" }));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.profile.user).toMatchObject({ email: "yuranis@ejemplo.com", role: "ADMIN" });
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    expect((await request(app).get("/api/v1/auth/status")).body.data.needsSetup).toBe(false);
  });

  it("después, quien se registra queda pendiente y no puede entrar hasta que lo aprueben", async () => {
    const { agent: admin } = await staff("ADMIN");

    const res = await request(app).post("/api/v1/auth/register").send(account());
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ status: "PENDING" });
    expect(res.headers["set-cookie"]).toBeUndefined();

    const login = await request(app).post("/api/v1/auth/login").send({ email: "yuranis@ejemplo.com", password: "clave-segura-123" });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("ACCOUNT_PENDING");

    const me = await admin.get("/api/v1/auth/me");
    expect(me.body.data.pendingApprovals).toBe(1);
    const users = await admin.get("/api/v1/users");
    const pending = users.body.data.find((user: { email: string }) => user.email === "yuranis@ejemplo.com");
    expect(pending).toMatchObject({ role: "DESPACHO", active: false, pendingApproval: true });

    // El administrador la aprueba (y puede cambiarle el puesto).
    await admin.patch(`/api/v1/users/${pending.id}`).send({ active: true, role: "VENTAS" }).expect(200);
    const approved = await request(app).post("/api/v1/auth/login").send({ email: "yuranis@ejemplo.com", password: "clave-segura-123" });
    expect(approved.status).toBe(200);
    expect(approved.body.data.user.role).toBe("VENTAS");
  });

  it("nadie se puede registrar como administrador ni repetir un correo", async () => {
    await staff("ADMIN");
    const asAdmin = await request(app).post("/api/v1/auth/register").send(account({ role: "ADMIN" }));
    expect(asAdmin.status).toBe(400);

    await request(app).post("/api/v1/auth/register").send(account()).expect(201);
    const again = await request(app).post("/api/v1/auth/register").send(account({ name: "Otra persona" }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("el administrador rechaza una solicitud; a alguien ya aprobado no lo borra", async () => {
    const { agent: admin, user: adminUser } = await staff("ADMIN");
    await request(app).post("/api/v1/auth/register").send(account()).expect(201);
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: "yuranis@ejemplo.com" } });

    await admin.delete(`/api/v1/users/${pending.id}`).expect(204);
    expect(await prisma.user.count({ where: { email: "yuranis@ejemplo.com" } })).toBe(0);

    const notPending = await admin.delete(`/api/v1/users/${adminUser.id}`);
    expect(notPending.status).toBe(409);
  });

  it("dos registros al mismo tiempo en un sistema vacío crean un solo administrador", async () => {
    const results = await Promise.all([
      request(app).post("/api/v1/auth/register").send(account({ email: "uno@ejemplo.com" })),
      request(app).post("/api/v1/auth/register").send(account({ email: "dos@ejemplo.com" })),
    ]);
    expect(results.map((res) => res.body.data.status).sort()).toEqual(["ACTIVE", "PENDING"]);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });
});
