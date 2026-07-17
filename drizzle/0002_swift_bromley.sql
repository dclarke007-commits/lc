CREATE TYPE "public"."client_cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'one-time');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'provisional');--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"cadence" "client_cadence" NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_owner_id_idx" ON "client" USING btree ("owner_id");