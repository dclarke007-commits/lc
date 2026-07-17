CREATE TYPE "public"."job_completion" AS ENUM('booked', 'completed', 'no-show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_payment" AS ENUM('paid', 'owed');--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"completion" "job_completion" DEFAULT 'booked' NOT NULL,
	"payment" "job_payment" DEFAULT 'owed' NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"price_cents" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_owner_date_idx" ON "job" USING btree ("owner_id","date");--> statement-breakpoint
CREATE INDEX "job_client_id_idx" ON "job" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_owner_idempotency_uq" ON "job" USING btree ("owner_id","idempotency_key");