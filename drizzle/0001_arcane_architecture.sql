-- Custom Migration: Rebuilding the core schema for advanced architecture

-- Drop the old messages table to replace it with a new structure
DROP TABLE IF EXISTS "messages";

-- Create the new 'sessions' table
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Recreate the 'messages' table with the new, richer schema
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE cascade,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create the enum for trace types
DO $$ BEGIN
 CREATE TYPE "public"."trace_type" AS ENUM('orchestration', 'tool_call', 'llm_call');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create the new 'traces' table for observability
CREATE TABLE IF NOT EXISTS "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE cascade,
	"message_id" uuid REFERENCES "messages"("id") ON DELETE cascade,
	"parent_trace_id" uuid REFERENCES "traces"("id") ON DELETE cascade,
	"actor" text NOT NULL,
	"type" "trace_type" NOT NULL,
	"content" jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
