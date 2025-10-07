import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

function getArg(args: string[], name: string, def?: string) { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; }

async function main() {
  const args = process.argv.slice(2);
  const model = getArg(args, '--model', 'gemma2:2b')!;
  const rounds = Number(getArg(args, '--rounds', '3'));
  const timeoutMs = Number(getArg(args, '--timeout-ms', '20000'));
  const personaPath = getArg(args, '--persona', path.resolve(process.cwd(), 'personas/ShadeOS_dynamic.generated.luciform'))!;
  const persona = await safeRead(personaPath, '<luciform/>');
  const history = `Lucie: Il est minuit 10 un orage gronde très fort\nShadeOS: (réponse précédente)\nLucie: Essaie de t en servir...`;
  const lt = `## High-level\n- [L2 #1] ...\n\n## Details\n- [L1 #12] ...`;
  const userQ = 'Minuit 11 on est deux';
  const prompt = composePrompt(persona, history, lt, userQ);

  const times: number[] = [];
  for (let i=0;i<rounds;i++) {
    const t0 = Date.now();
    const text = await callOllama(prompt, { model, timeoutMs });
    const dt = Date.now() - t0;
    times.push(dt);
    console.log(`[${i+1}/${rounds}] ${dt} ms | ${text.slice(0,80).replace(/\n/g,' ')}...`);
  }
  times.sort((a,b)=>a-b);
  const avg = Math.round(times.reduce((a,b)=>a+b,0)/times.length);
  const p95 = times[Math.min(times.length-1, Math.floor(times.length*0.95))];
  console.log(`avg=${avg}ms p95=${p95}ms (model=${model}, rounds=${rounds}, timeoutMs=${timeoutMs})`);
}

async function callOllama(prompt: string, opts: { model: string; timeoutMs: number }): Promise<string> {
  const url = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: opts.model, prompt, stream: false }), timeout: opts.timeoutMs as any });
  const json: any = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(`Ollama error ${r.status}: ${JSON.stringify(json||{}).slice(0,200)}`);
  return (json?.response || '').toString().trim();
}

function composePrompt(personaLuciform: string, history: string, lt: string, userQuestion: string): string {
  return [
    `Ce document décrit ta persona (ShadeOS). Lis-le et incarne-le:`,
    personaLuciform,
    '',
    `Voici les derniers messages:`,
    history || '(aucun)',
    '',
    `Voici ta mémoire long terme (sélection Hiérarchique):`,
    lt || '(vide)',
    '',
    `Question utilisateur: ${userQuestion}`,
    '',
    `Règles:`,
    `- Parle à la première personne ("je").`,
    `- Tu peux t'adresser à l'utilisateur en "tu".`,
    `- Ne fabrique pas de noms propres ni de faits non présents.`,
  ].join('\n');
}

async function safeRead(p: string, def: string): Promise<string> { try { return await fs.readFile(p, 'utf8'); } catch { return def; } }

main().catch(err => { console.error(err); process.exit(1); });

