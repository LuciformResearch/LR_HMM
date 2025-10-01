export type ParsedItem = {
  index: number;
  timestamp: string | null;
  role: 'user' | 'assistant' | 'unknown';
  content: string;
  charCount: number;
  lineStart?: number;
  lineEnd?: number;
};

export type L1Summary = {
  level: number;
  covers: number[];
  charCount: number;
  summary: string;
  summaryChars: number;
  compressionRatio: number;
  qualityScore: number;
  durationMs: number;
  tags?: string[];
  entities?: any;
  signals?: any;
  extras?: any;
};

export type L2Summary = {
  level: number;
  covers: number[];
  charCount: number;
  summary: string;
  summaryChars: number;
  compressionRatio: number;
  qualityScore: number;
  durationMs: number;
  tags?: string[];
  entities?: any;
  signals?: any;
  extras?: any;
};
