-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cut_options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "photo_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "product_photos" (
    "product_id" UUID NOT NULL,
    "large" BYTEA NOT NULL,
    "small" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_photos_pkey" PRIMARY KEY ("product_id")
);

-- AddForeignKey
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
