CREATE TYPE "public"."message_template_type" AS ENUM('booking_confirmation', 'rebooking_nudge', 'win_back', 'payment_reminder');--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" "message_template_type" NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_owner_type_uq" ON "message_template" USING btree ("owner_id","type");--> statement-breakpoint
CREATE INDEX "message_template_owner_id_idx" ON "message_template" USING btree ("owner_id");