// Minimal MCP server skeleton for LR-HMM
// Tools: ping, messages.append (stub), rag.answer (stub)

import { z } from 'zod';
import { createServer } from '@modelcontextprotocol/sdk/server';
import { AppendMessageInput, AppendMessageOutput, RagAnswerInput, RagAnswerOutput, PingInput, PingOutput, SummariesUpdateInput, SummariesUpdateOutput } from './schemas';
import { appendMessage } from '@/lib/db/messages';
import { ragAnswer } from '@/lib/rag/service';
import { Client } from 'pg';
import { buildChatBlocksFromDb, fetchConversationId, summarizeAndUpsert, prepareGroups, fetchSummaries, selectDirtyL1Indices, selectDirtyGroupIndices } from '@/lib/hmm/updateService';

export async function startMcpServer() {
  const server = createServer({ name: 'lr-hmm-mcp', version: '0.1.0' });

  // ping
  server.tool('ping', {
    description: 'Health check tool for LR-HMM MCP server',
    inputSchema: PingInput ?? z.any(),
    outputSchema: PingOutput,
    handler: async (input) => {
      return { pong: true, msg: input?.msg };
    },
  });

  // messages.append (stub wiring; to be implemented against DB/services)
  server.tool('messages.append', {
    description: 'Append a chat message to a conversation (incremental ingestion)',
    inputSchema: AppendMessageInput,
    outputSchema: AppendMessageOutput,
    handler: async (input) => {
      const { slug, role, text, ts } = input;
      const r = await appendMessage({ slug, role, text, ts });
      return { ok: true, conversationId: r.conversationId, messageId: r.messageId };
    },
  });

  // rag.answer (stub wiring; to be implemented via lib rag service)
  server.tool('rag.answer', {
    description: 'Retrieve hierarchical context and optionally compose a prompt',
    inputSchema: RagAnswerInput,
    outputSchema: RagAnswerOutput,
    handler: async (input) => {
      const query = {
        text: input.query,
        intent: input.intent || 'auto',
        timeWindow: input.filters?.from || input.filters?.to ? { from: input.filters?.from ? new Date(input.filters.from) : undefined, to: input.filters?.to ? new Date(input.filters.to) : undefined } : undefined,
        hints: { tags: input.filters?.tags, entities: input.filters?.entities },
        budget: { tokens: 'medium' as const },
      };
      const out = await ragAnswer({ slug: input.slug, query, planPath: input.planPath, useVertex: false, composePrompt: !!input.composePrompt, exportPrompt: !!input.exportPrompt });
      return { ok: true, picks: out.picks as any, diagnostics: out.diagnostics, quotes: out.quotes, promptURI: out.promptURI };
    },
  });

  // summaries.update — L1 incremental + L2/L3 grouping (append-only)
  server.tool('summaries.update', {
    description: 'Build or update hierarchical summaries (L1→Lk). Respects chat duos (user→assistant).',
    inputSchema: SummariesUpdateInput,
    outputSchema: SummariesUpdateOutput,
    handler: async (input) => {
      const windowChars = input.windowChars ?? 6000;
      const groupChars = input.groupChars ?? 10000;
      const concurrency = input.concurrency ?? 3;
      const batchDelayMs = input.batchDelayMs ?? 1500;
      const ratioOnly = input.ratioOnly ?? true;
      const wiggle = input.wiggle ?? 0.2;

      const client = new Client({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 6432),
        user: process.env.PGUSER || 'shadeos',
        password: process.env.PGPASSWORD || 'shadeos',
        database: process.env.PGDATABASE || 'shadeos_local',
      });
      await client.connect();
      try {
        const conversationId = await fetchConversationId(client, input.slug);
        // Build L1 input blocks from DB messages using duos policy (ensureAssistant)
        const blocks = await buildChatBlocksFromDb(client, conversationId, { windowChars, ensureAssistant: true, interlocutor: 'User', roleMap: {} });
        // Incremental: compute dirty L1 indices by hashing block text and comparing to meta.sourceHash
        const { dirty: dirtyL1, sourceHashes } = await selectDirtyL1Indices(client, conversationId, blocks);
        // Summarize L1 only for dirty indices
        const engine = {
          useVertex: !!process.env.PROJECT_ID,
          project: process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID,
          location: process.env.VERTEX_LOCATION || process.env.LOCATION || 'europe-west1',
          model: process.env.SUMMARY_MODEL || 'gemini-2.5-flash',
          maxOutputTokens: 2048,
          callTimeoutMs: 60_000,
          allowHeuristicFallback: true,
          generateSignals: true,
          generateExtras: true,
          log: false,
        } as any;
        const policies = {
          compressionLevel: 0.10,
          wiggle,
          underflowMode: 'accept',
          overflowMode: 'accept',
          regenerateRatioStep: 0.10,
          enforceAbsoluteRange: ratioOnly === true ? false : true,
        } as any;

        const l1 = await summarizeAndUpsert(client, conversationId, 1, blocks, engine, policies, { concurrency, batchDelayMs, onlyIndices: dirtyL1, sourceHashesByIndex: sourceHashes });

        // Fetch full L1 state to build L2 groups (never split a L1)
        const l1Full = await fetchSummaries(client, conversationId, 1);
        const l1FullAs = l1Full.map((x, i) => ({ level:1, index: x.index ?? i, covers: x.covers, sourceChars: x.summaryChars, summary: x.summary, summaryChars: x.summaryChars, compressionRatio: x.summaryChars/Math.max(1,x.summaryChars) } as any));
        const groups2 = prepareGroups(l1FullAs, groupChars);
        const dirtySetL1 = new Set<number>(dirtyL1);
        const dirtyGroups2 = selectDirtyGroupIndices(groups2, dirtySetL1);
        const l2 = await summarizeAndUpsert(client, conversationId, 2, groups2 as any, engine, policies, { concurrency, batchDelayMs, onlyIndices: dirtyGroups2 });

        // L3 grouping from full L2 state; dirty if contains any dirty L2 group index
        const l2Full = await fetchSummaries(client, conversationId, 2);
        const l2FullAs = l2Full.map((x, i) => ({ level:2, index: x.index ?? i, covers: x.covers, sourceChars: x.summaryChars, summary: x.summary, summaryChars: x.summaryChars, compressionRatio: x.summaryChars/Math.max(1,x.summaryChars) } as any));
        const groups3 = prepareGroups(l2FullAs, groupChars);
        const dirtySetL2 = new Set<number>(dirtyGroups2);
        const dirtyGroups3 = selectDirtyGroupIndices(groups3, dirtySetL2);
        const l3 = await summarizeAndUpsert(client, conversationId, 3, groups3 as any, engine, policies, { concurrency, batchDelayMs, onlyIndices: dirtyGroups3 });

        return { ok: true, updated: { l1: l1.length, l2: l2.length, l3: l3.length } };
      } finally { await client.end(); }
    },
  });

  await server.start();
  return server;
}

// Auto-start when executed directly (optional)
if (typeof require !== 'undefined' && require.main === module) {
  startMcpServer().catch((err) => {
    console.error('[lr-hmm-mcp] failed to start:', err);
    process.exit(1);
  });
}
