-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "has_logo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logo_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "business_logo" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "image" BYTEA NOT NULL,
    "round" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_logo_pkey" PRIMARY KEY ("id")
);

-- Escrito a mano: una sola fila de logo.
ALTER TABLE "business_logo" ADD CONSTRAINT "business_logo_single_row" CHECK ("id" = 1);
