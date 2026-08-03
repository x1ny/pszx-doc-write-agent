CREATE SCHEMA "doc_agent";
--> statement-breakpoint
CREATE TABLE "doc_agent"."conversation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar(160) NOT NULL,
	"thread_id" varchar(160) NOT NULL,
	"filename" text NOT NULL,
	"content" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_documents_version_positive_check" CHECK ("doc_agent"."conversation_documents"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_documents_resource_thread_uidx" ON "doc_agent"."conversation_documents" USING btree ("resource_id","thread_id");--> statement-breakpoint
CREATE INDEX "conversation_documents_resource_updated_idx" ON "doc_agent"."conversation_documents" USING btree ("resource_id","updated_at");