CREATE TYPE "public"."token_capability" AS ENUM('book-client', 'book-public');--> statement-breakpoint
CREATE TABLE "token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid,
	"token_value" text NOT NULL,
	"capability" "token_capability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "token_value_uq" ON "token" USING btree ("token_value");--> statement-breakpoint
CREATE INDEX "token_owner_id_idx" ON "token" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_owner_client_capability_uq" ON "token" USING btree ("owner_id","client_id","capability");