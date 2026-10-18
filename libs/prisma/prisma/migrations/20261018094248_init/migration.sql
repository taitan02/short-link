-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "original_url" VARCHAR(2048) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "short_links_code_key" ON "short_links"("code");

-- CreateIndex
CREATE INDEX "short_links_user_id_created_at_idx" ON "short_links"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
