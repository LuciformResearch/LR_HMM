#!/usr/bin/env node
import { startMcpServer } from './server';

startMcpServer().catch((err) => {
  console.error('[lr-hmm-mcp] failed to start:', err);
  process.exit(1);
});

