-- Per-token sign-out. See the RevokedSession model in schema.prisma for why a
-- JWT session needs a server-side revocation list at all.

-- CreateTable
CREATE TABLE "revoked_sessions" (
    "sid" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revoked_sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE INDEX "revoked_sessions_user_id_idx" ON "revoked_sessions"("user_id");

-- CreateIndex
CREATE INDEX "revoked_sessions_expires_at_idx" ON "revoked_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "revoked_sessions" ADD CONSTRAINT "revoked_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

