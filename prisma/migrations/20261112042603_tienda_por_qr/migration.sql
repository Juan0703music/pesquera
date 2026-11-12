-- CreateTable
CREATE TABLE "store_keys" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "secret_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_orders" (
    "message_id" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_pubkey" TEXT NOT NULL,
    "tracking_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_order_id_key" ON "online_orders"("order_id");

-- CreateIndex
CREATE INDEX "online_orders_customer_pubkey_idx" ON "online_orders"("customer_pubkey");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Una sola fila de llave.
ALTER TABLE "store_keys" ADD CONSTRAINT "store_keys_single_row" CHECK ("id" = 1);

-- Igual que todas las tablas: la API de datos de Supabase no ve nada (ver cerrar_api_de_datos_supabase).
ALTER TABLE "store_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_orders" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.store_keys, public.online_orders FROM anon, authenticated';
  END IF;
END
$$;
