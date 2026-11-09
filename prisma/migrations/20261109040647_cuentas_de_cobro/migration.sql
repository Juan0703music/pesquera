-- CreateEnum
CREATE TYPE "PaymentAccountKind" AS ENUM ('BRE_B', 'NEQUI', 'DAVIPLATA', 'BANCO');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('AHORROS', 'CORRIENTE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'BRE_B';

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "kind" "PaymentAccountKind" NOT NULL,
    "account_key" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "holder_document" TEXT,
    "bank_name" TEXT,
    "bank_account_type" "BankAccountType",
    "qr_payload" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);
