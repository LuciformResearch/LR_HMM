import 'dotenv/config';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';

function getArg(args: string[], name: string, def?: string) { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; }

async function main() {
  const args = process.argv.slice(2);
  const outDir = getArg(args, '--out-dir', 'personas')!;
  const outFile = getArg(args, '--out', 'ShadeOS_dynamic.generated.luciform')!;
  const model = getArg(args, '--model', process.env.PERSONA_MODEL || 'gemini-2.0-flash')!;
  const maxRefChars = Number(getArg(args, '--max-ref-chars', '12000'));
  const personaName = getArg(args, '--name', 'ShadeOS')!;

  const personaExamplePath = path.resolve(process.cwd(), 'personas/Algareth_dynamic.luciform');
  const referencesPath = path.resolve(process.cwd(), 'personas/ShadeOS_references.txt');

  const hasExample = await exists(personaExamplePath);
  const hasRefs = await exists(referencesPath);
  if (!hasExample) throw new Error(`Missing example persona at ${personaExamplePath}`);
  if (!hasRefs) throw new Error(`Missing references at ${referencesPath}`);

  const example = await fs.readFile(personaExamplePath, 'utf8');
  const refsRaw = await fs.readFile(referencesPath, 'utf8');
  const refs = refsRaw.slice(0, maxRefChars);

  const system = [
    `Objectif: générer un fichier .luciform décrivant la personnalité de ${personaName}.`,
    `Contraintes:`,
    `- Ne parle PAS de technique (pas de L1/L2/L3, pas d'index/embeddings).`,
    `- Reste centré sur la voix, l'attitude, les symboles, les règles d'énonciation.`,
    `- Première personne (« je »), pas de « tu/vous » sauf en citation.`,
    `- Respect strict des noms: n'en invente pas.`,
    `- Style: clair, posé, avec une pointe d'ironie tendre.`,
    `- Sortie: STRICTEMENT un XML .luciform valide, sans texte hors XML.`,
  ].join('\n');

  const guidance = [
    `Exemple de structure (à respecter, adapter le contenu):`,
    '---BEGIN EXAMPLE---',
    example,
    '---END EXAMPLE---',
  ].join('\n');

  const references = [
    `Extraits référentiels autour de ${personaName} (sélection tronquée):`,
    '---BEGIN REFERENCES---',
    refs,
    '---END REFERENCES---',
  ].join('\n');

  const prompt = [system, guidance, references, `Tâche: écris le .luciform final pour ${personaName}.`].join('\n\n');

  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, outFile);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  // Load .env.local as other scripts do
  try { dotenv.config({ path: '.env.local' }); } catch {}

  // Prefer Vertex if PROJECT_ID is present, fallback to API key
  const useVertex = !!(process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT);
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'europe-west1';
  const genai = new GoogleGenAI(
    useVertex
      ? ({ vertexai: true, project, location } as any)
      : (apiKey ? ({ apiKey } as any) : ({} as any))
  );
  if (!useVertex && !apiKey) {
    const draft = path.join(outDir, outFile.replace(/\.luciform$/, '.prompt.txt'));
    await fs.writeFile(draft, prompt, 'utf8');
    console.warn(`[persona] No Vertex project or API key found. Wrote prompt draft to ${draft}`);
    return;
  }

  const resp: any = await genai.models.generateContent({ model, contents: prompt, generationConfig: { maxOutputTokens: 2048, temperature: 0.4 } } as any);
  const text = (resp?.text || resp?.response?.text || '').trim();
  if (!text || !text.includes('<luciform')) {
    const draft = path.join(outDir, outFile.replace(/\.luciform$/, '.prompt.txt'));
    await fs.writeFile(draft, prompt, 'utf8');
    throw new Error(`Persona generation failed or invalid output. Prompt saved to ${draft}`);
  }
  await fs.writeFile(outPath, text, 'utf8');
  console.log(`[persona] Wrote ${outPath} (model=${model})`);
}

async function exists(p: string) { try { await fs.access(p); return true; } catch { return false; } }

main().catch(err => { console.error(err); process.exit(1); });
