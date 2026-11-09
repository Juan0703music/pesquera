import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import type { Role } from "../../src/generated/prisma/enums.js";
import { hashPassword } from "../../src/utils/password.js";

export const app = createApp();
export const PASSWORD = "clave-segura-123";

let counter = 0;
const passwordHash = hashPassword(PASSWORD);

/** Crea una persona del equipo con ese rol y devuelve un agente con la sesión iniciada. */
export async function staff(role: Role = "ADMIN", name = `Persona ${role}`) {
  const email = `${role.toLowerCase()}${++counter}@ejemplo.com`;
  const user = await prisma.user.create({ data: { name, email, role, passwordHash: await passwordHash } });
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login falló (${res.status}): ${JSON.stringify(res.body)}`);
  return { agent, user, email };
}

export async function category(name = `Categoría ${++counter}`) {
  return prisma.category.create({ data: { name } });
}

/** Producto con existencia inicial (kilos o unidades) registrada como entrada en el kardex. */
export async function product(options: { name?: string; unit?: "KG" | "UNIDAD"; price?: number; stock?: number; cost?: number; min?: number; inStore?: boolean } = {}) {
  const cat = await category();
  const unit = options.unit ?? "KG";
  const stockMilli = Math.round((options.stock ?? 0) * 1000);
  const created = await prisma.product.create({
    data: {
      name: options.name ?? `Producto ${++counter}`,
      unit,
      price: options.price ?? 20000,
      avgCost: options.cost ?? 0,
      stockMilli,
      minStockMilli: Math.round((options.min ?? 0) * 1000),
      inStore: options.inStore ?? true,
      categoryId: cat.id,
    },
  });
  if (stockMilli > 0) {
    await prisma.inventoryMovement.create({ data: { productId: created.id, type: "ENTRADA", qtyMilli: stockMilli, stockAfterMilli: stockMilli, unitCost: options.cost ?? null } });
  }
  return created;
}

export const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stockMilli;

export async function settings(data: Partial<{ storeOpen: boolean; deliveryFee: number; minOrderTotal: number }> = {}) {
  return prisma.setting.upsert({
    where: { id: 1 },
    create: { id: 1, businessName: "Pesquera de Prueba", storeOpen: true, deliveryFee: 5000, minOrderTotal: 0, ...data },
    update: data,
  });
}
