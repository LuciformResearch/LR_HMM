// Drizzle schema (propositional) — generated via scripts/schema_codegen.ts
// Note: this file assumes you have installed drizzle-orm and a Postgres driver.
// It is safe to import types from here in scripts; migrations are produced by drizzle-kit.

import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';

export const refTypeEnum = pgEnum('ref_type', ['message', 'summary']);
export const providerEnum = pgEnum('provider', ['vertex', 'studio']);

export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  createdDate: text('created_date'),
  totalChars: integer('total_chars'),
  totalLines: integer('total_lines'),
});

export const summaries = pgTable('summaries', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  level: integer('level').notNull(),
  idx: integer('idx'),
  covers: jsonb('covers'),
  content: text('content'),
  contentHash: text('content_hash'),
  charCount: integer('char_count'),
  topics: text('topics').array(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const embeddings = pgTable('embeddings', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  refType: providerEnum('provider').$type<'message' | 'summary'>().notNull(),
  refId: integer('ref_id').notNull(),
  provider: providerEnum('provider').$type<'vertex' | 'studio'>().notNull(),
  model: text('model').notNull(),
  dim: integer('dim').notNull(),
  // vector column is defined via raw SQL migration to carry dimension; kept out of TS schema for now
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const contexts = pgTable('contexts', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  slug: text('slug').notNull(),
  query: text('query').notNull(),
  paramsJson: jsonb('params_json'),
  itemsJson: jsonb('items_json'),
  expandedJson: jsonb('expanded_json'),
  budgetJson: jsonb('budget_json'),
  metricsJson: jsonb('metrics_json'),
});
