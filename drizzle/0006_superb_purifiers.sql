CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"message_type" "message_template_type" NOT NULL,
	"draft_nonce" text NOT NULL,
	"drafted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"resulting_job_ref" uuid
);
--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_owner_id_operator_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."operator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_resulting_job_ref_job_id_fk" FOREIGN KEY ("resulting_job_ref") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_log_owner_nonce_uq" ON "message_log" USING btree ("owner_id","draft_nonce");--> statement-breakpoint
CREATE INDEX "message_log_owner_client_idx" ON "message_log" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "message_log_owner_id_idx" ON "message_log" USING btree ("owner_id");