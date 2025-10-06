export type Intent = 'synthesis' | 'detail' | 'recent' | 'auto';

export type IRagQuery = {
  text: string;
  intent?: Intent;
  timeWindow?: { from?: Date; to?: Date };
  hints?: { entities?: string[]; tags?: string[]; levels?: number[] };
  budget?: { tokens: 'small' | 'medium' | 'large' };
};

export type RagPolicy = {
  levelQuotas: Record<number, number>;
  weights: { similarity: number; level: number; recency: number; diversity: number };
  expand: { coversOnly: boolean; perGroupTopM: number };
  rerank: { stage1: boolean; stage2: boolean; topnFinal: number };
  compose: { maxHigh: number; maxLow: number; maxRaw?: number };
  topkInitial: number;
  topkDrill: number;
};

export type Candidate = {
  id: number;
  conversationId: number;
  level: number;
  index?: number | null;
  charCount?: number;
  content: string;
  covers?: number[];
  score?: number;
  recencyTs?: string | null;
};

export interface IRagIndex {
  search(
    levels: number[],
    queryEmbedding: number[],
    opts: {
      topk: number;
      scopeCovers?: number[];
      conversationId?: number;
      tagsAny?: string[];
      entitiesAny?: string[];
      timeWindow?: { from?: string; to?: string };
    }
  ): Promise<Candidate[]>;
  fetchByIds(ids: number[]): Promise<Candidate[]>;
  fetchCovers(level: number, ids: number[]): Promise<{ level: number; id: number; covers: number[] }[]>;
  getConversationIdBySlug(slug: string): Promise<number | null>;
}

export interface IEmbedder {
  embed(texts: string[], opts?: { model?: string; vertex?: boolean }): Promise<number[][]>;
}
