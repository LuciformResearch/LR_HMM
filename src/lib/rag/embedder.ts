import 'dotenv/config';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAuth } from 'google-auth-library';
import { IEmbedder } from './types';

export class VertexEmbedder implements IEmbedder {
  constructor(private project?: string) {}
  async token(): Promise<string> {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever'] });
    const c = await auth.getClient();
    const t = await c.getAccessToken();
    if (!t || !t.token) throw new Error('Vertex token unavailable');
    return t.token;
  }
  async embed(texts: string[], opts?: { model?: string }): Promise<number[][]> {
    const model = opts?.model || process.env.VERTEX_EMBED_MODEL || process.env.EMBEDDING_MODEL || 'text-embedding-004';
    const token = await this.token();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;
    const out: number[][] = [];
    for (const t of texts) {
      const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: t }] } }) });
      const json: any = await resp.json();
      if (!resp.ok) throw new Error(`Vertex embed failed: ${resp.status} ${JSON.stringify(json).slice(0,200)}`);
      const values = json?.embedding?.values || json?.data?.embedding || json?.data?.[0]?.embedding;
      if (!values) throw new Error('No embedding values');
      out.push(values);
    }
    return out;
  }
}

export class StudioEmbedder implements IEmbedder {
  private client: GoogleGenerativeAI;
  constructor(apiKey?: string) { this.client = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY || ''); }
  async embed(texts: string[], opts?: { model?: string }): Promise<number[][]> {
    const modelName = opts?.model || process.env.EMBEDDING_MODEL || 'text-embedding-004';
    const model = this.client.getGenerativeModel({ model: modelName });
    const out: number[][] = [];
    for (const t of texts) {
      const r: any = await model.embedContent({ content: { parts: [{ text: t }] } });
      const values = r?.embedding?.values || r?.data?.embedding || r?.data?.[0]?.embedding;
      if (!values) throw new Error('No embedding values');
      out.push(values);
    }
    return out;
  }
}

