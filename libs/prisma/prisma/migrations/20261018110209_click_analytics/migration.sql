-- CreateTable
CREATE TABLE "click_events" (
    "id" UUID NOT NULL,
    "short_link_id" UUID NOT NULL,
    "clicked_at" TIMESTAMPTZ(3) NOT NULL,
    "referrer_host" VARCHAR(255),
    "device_type" VARCHAR(16) NOT NULL,
    "browser" VARCHAR(64) NOT NULL,
    "os" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "click_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_daily_stats" (
    "short_link_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "dimension" VARCHAR(16) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "link_daily_stats_pkey" PRIMARY KEY ("short_link_id","dimension","day","value")
);

-- CreateIndex
CREATE INDEX "click_events_short_link_id_clicked_at_idx" ON "click_events"("short_link_id", "clicked_at");

-- CreateIndex
CREATE INDEX "click_events_clicked_at_idx" ON "click_events"("clicked_at");

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_daily_stats" ADD CONSTRAINT "link_daily_stats_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
