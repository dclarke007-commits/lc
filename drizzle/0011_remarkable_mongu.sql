CREATE TYPE "public"."inquiry_source" AS ENUM('phone', 'walk-in', 'link', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "public"."pending_request_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "inquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid,
	"source" "inquiry_source" NOT NULL,
	"session_nonce" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "pending_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_request" ADD CONSTRAINT "pending_request_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_request" ADD CONSTRAINT "pending_request_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiry_owner_id_idx" ON "inquiry" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_owner_session_link_uq" ON "inquiry" USING btree ("owner_id","session_nonce") WHERE "inquiry"."source" = 'link';--> statement-breakpoint
CREATE INDEX "pending_request_owner_status_idx" ON "pending_request" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "pending_request_client_id_idx" ON "pending_request" USING btree ("client_id");