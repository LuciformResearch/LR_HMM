import { z } from 'zod';

// Shared scope schema for multi-tenant filtering
export const ScopeSchema = z.object({
  namespace: z.string().min(1),
  userId: z.string().optional(),
  userIdentityId: z.string().uuid().optional(),
  orgId: z.string().optional(),
  conversationIds: z.array(z.number()).optional(),
}).strict();

export type Scope = z.infer<typeof ScopeSchema>;

// messages.append
export const AppendMessageInput = z.object({
  slug: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1),
  ts: z.string().datetime().optional(),
  meta: z.record(z.any()).optional(),
  scope: ScopeSchema.optional(),
});
export type AppendMessageInput = z.infer<typeof AppendMessageInput>;

export const AppendMessageOutput = z.object({
  ok: z.boolean(),
  conversationId: z.number().optional(),
  messageId: z.number().optional(),
});
export type AppendMessageOutput = z.infer<typeof AppendMessageOutput>;

// rag.answer
export const RagAnswerInput = z.object({
  slug: z.string().min(1),
  query: z.string().min(1),
  intent: z.enum(['auto', 'synthesis', 'detail']).optional(),
  filters: z.object({
    tags: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }).optional(),
  planPath: z.string().optional(),
  composePrompt: z.boolean().optional(),
  exportPrompt: z.boolean().optional(),
  scope: ScopeSchema.optional(),
});
export type RagAnswerInput = z.infer<typeof RagAnswerInput>;

export const RagAnswerOutput = z.object({
  ok: z.boolean(),
  picks: z.object({
    high: z.array(z.any()),
    low: z.array(z.any()),
  }).optional(),
  diagnostics: z.record(z.any()).optional(),
  quotes: z.array(z.any()).optional(),
  promptURI: z.string().optional(),
  message: z.string().optional(),
});
export type RagAnswerOutput = z.infer<typeof RagAnswerOutput>;

// Health/ping
export const PingInput = z.object({ msg: z.string().optional() }).optional();
export const PingOutput = z.object({ pong: z.boolean(), msg: z.string().optional() });

// summaries.update
export const SummariesUpdateInput = z.object({
  slug: z.string().min(1),
  strategy: z.enum(['incremental','full']).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  windowChars: z.number().int().positive().optional(),
  minFlushChars: z.number().int().positive().optional(),
  groupChars: z.number().int().positive().optional(),
  wiggle: z.number().min(0).max(1).optional(),
  ratioOnly: z.boolean().optional(),
  concurrency: z.number().int().positive().optional(),
  batchDelayMs: z.number().int().nonnegative().optional(),
});
export const SummariesUpdateOutput = z.object({ ok: z.boolean(), updated: z.object({ l1: z.number(), l2: z.number(), l3: z.number() }) });
export type SummariesUpdateInput = z.infer<typeof SummariesUpdateInput>;
export type SummariesUpdateOutput = z.infer<typeof SummariesUpdateOutput>;
