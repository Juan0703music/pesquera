import { readFileSync } from "node:fs";
import request from "supertest";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { app, settings } from "./helpers/app.js";
import { resetDatabase } from "./helpers/db.js";

beforeEach(async () => {
  await resetDatabase();
  await settings();
});

describe("Marea como app instalada", () => {
  it("el manifiesto lleva el nombre de la pesquera, abre el panel y trae íconos normales y «maskable»", async () => {
    const res = await request(app).get("/manifest.webmanifest").expect(200);
    expect(res.headers["content-type"]).toContain("application/manifest+json");
    const manifest = JSON.parse(res.text);
    expect(manifest).toMatchObject({ name: "Pesquera de Prueba", short_name: "Pesquera de", start_url: "/app/pedidos", scope: "/", display: "standalone" });
    expect(manifest.icons.map((item: { purpose: string; sizes: string }) => `${item.sizes} ${item.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  });

  it("los íconos de 512 existen aunque la pesquera no tenga logo (la ola de Marea)", async () => {
    for (const name of ["icon-512.png", "maskable-512.png"]) {
      const res = await request(app).get(`/media/logo/${name}`).buffer(true).expect(200);
      const meta = await sharp(res.body).metadata();
      expect([meta.width, meta.height]).toEqual([512, 512]);
    }
    const badge = await request(app).get("/icons/badge-96.png").buffer(true).expect(200);
    expect((await sharp(badge.body).metadata()).hasAlpha).toBe(true);
  });

  it("el service worker se sirve como JavaScript y sin caché larga", async () => {
    const res = await request(app).get("/sw.js").expect(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).toContain('addEventListener("push"');
    await request(app).get("/sin-conexion").expect(200);
  });

  it("Android puede verificar que la app firmada es de este sitio (Digital Asset Links)", async () => {
    const res = await request(app).get("/.well-known/assetlinks.json").expect(200);
    expect(res.body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "io.github.juan0703music.marea",
          // La misma huella con que GitHub firma la app (apps/android/huella-sha256.txt).
          sha256_cert_fingerprints: [readFileSync("apps/android/huella-sha256.txt", "utf8").trim()],
        },
      },
    ]);
  });
});
