CREATE TABLE "capacity_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"working_days" integer[] NOT NULL,
	"per_day_cap" integer NOT NULL,
	"weekly_ceiling" integer NOT NULL,
	"default_job_price_cents" integer NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capacity_settings" ADD CONSTRAINT "capacity_settings_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capacity_settings_owner_uq" ON "capacity_settings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "capacity_settings_owner_id_idx" ON "capacity_settings" USING btree ("owner_id");