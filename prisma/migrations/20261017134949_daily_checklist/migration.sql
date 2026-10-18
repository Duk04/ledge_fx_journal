-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_checks" (
    "item_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_checks_pkey" PRIMARY KEY ("item_id","date")
);

-- CreateIndex
CREATE INDEX "checklist_items_user_id_sort_order_idx" ON "checklist_items"("user_id", "sort_order");

-- CreateIndex
CREATE INDEX "daily_checks_date_idx" ON "daily_checks"("date");

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checks" ADD CONSTRAINT "daily_checks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
