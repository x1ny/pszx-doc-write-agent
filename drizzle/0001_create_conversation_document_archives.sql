CREATE TABLE "doc_agent"."conversation_document_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" varchar(160) NOT NULL,
	"thread_id" varchar(160) NOT NULL,
	"message_id" varchar(160) NOT NULL,
	"tool_call_id" varchar(160),
	"source" varchar(24) NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"content" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"document_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_document_archives_thread_message_uidx" ON "doc_agent"."conversation_document_archives" USING btree ("thread_id","message_id");--> statement-breakpoint
CREATE INDEX "conversation_document_archives_thread_created_idx" ON "doc_agent"."conversation_document_archives" USING btree ("resource_id","thread_id","created_at");