-- Auth hardening. Four separate problems, one migration because they must
-- land together (see the role note at the bottom).
--
-- NOTE what is absent from this file: any rename of "auth_accounts". The
-- Prisma model was renamed AuthAccount -> Account, because
-- @auth/prisma-adapter dereferences `prisma.account` and the old name left
-- that undefined, throwing a TypeError on every OAuth sign-in. The
-- @@map("auth_accounts") keeps the table where it is, so this is a
-- client-side rename only and no data moves. If you ever see an
-- `ALTER TABLE "auth_accounts" RENAME` in a generated migration, the @@map
-- was dropped by mistake.

-- CreateEnum
CREATE TYPE "AuthAttemptKind" AS ENUM ('PASSWORD_LOGIN', 'REGISTER', 'PASSWORD_RESET', 'EMAIL_VERIFY');

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" TIMESTAMP(3),
ADD COLUMN     "sessions_valid_from" TIMESTAMP(3),
ALTER COLUMN "role" SET DEFAULT 'MEMBER';

-- DropTable
DROP TABLE "sessions";

-- CreateTable
CREATE TABLE "auth_attempts" (
    "id" TEXT NOT NULL,
    "kind" "AuthAttemptKind" NOT NULL,
    "email" TEXT,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_attempts_kind_email_created_at_idx" ON "auth_attempts"("kind", "email", "created_at");

-- CreateIndex
CREATE INDEX "auth_attempts_kind_ip_created_at_idx" ON "auth_attempts"("kind", "ip", "created_at");

-- CreateIndex
CREATE INDEX "auth_attempts_created_at_idx" ON "auth_attempts"("created_at");

-- AddForeignKey
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data steps
-- ---------------------------------------------------------------------------

-- Existing password accounts are treated as verified. Email verification did
-- not exist when they were created, so anything else would retroactively lock
-- out every current user (including the seeded demo account) the moment
-- REQUIRE_EMAIL_VERIFICATION is switched on. New accounts start unverified.
UPDATE "users"
SET "email_verified" = "created_at"
WHERE "password_hash" IS NOT NULL
  AND "email_verified" IS NULL;

-- Roles. `role` defaulted to OWNER and registerUser hardcoded OWNER, so with
-- open registration every self-registered user was an instance owner. OWNER
-- now means the single administrator allowed to write the shared Instrument
-- and Candle tables.
--
-- Demote everyone, then promote the oldest row — the account that set the
-- instance up. This is deterministic from data that already exists and
-- no-ops safely on an empty table. It is also fragile if the database is
-- ever reset, which is why AUTH_OWNER_EMAILS exists as the durable way to
-- say who the administrator is; see src/lib/env.ts.
--
-- SEQUENCING: this must ship in the same deploy as the registerUser change
-- to `role: "MEMBER"`. Applied on its own, the next sign-up re-creates the
-- hole it just closed.
UPDATE "users" SET "role" = 'MEMBER';

UPDATE "users"
SET "role" = 'OWNER'
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1);
