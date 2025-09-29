import { GoogleGenAI } from '@google/genai';

export type XmlEngineMode = 'l1' | 'l2';

export type XmlEngineOpts = {
  useVertex: boolean;
  project?: string;
  location?: string;
  model: string;
  maxOutputTokens: number;
  callTimeoutMs: number;
  minChars: number;
  maxChars: number;
  hintTarget?: number;
  hintCap?: number;
};

/**
 * Minimal shared XML engine (initially for L1). Uses @google/genai for Vertex/Studio.
 */
export async function generateStructuredXML(
  mode: XmlEngineMode,
  documents: string,
  opts: XmlEngineOpts
): Promise<{ xml: string; strategy: 'primary' | 'retry' | 'none'; }> {
  const ai = new GoogleGenAI(opts.useVertex ? { vertexai: true, project: opts.project, location: opts.location } as any : {} as any);

  const soft = opts.hintTarget ? `Objectif longueur: ${opts.hintTarget} caractères (cible douce).` : '';
  const cap = opts.hintCap ? `Ne JAMAIS dépasser ${opts.hintCap} caractères (cap dur).` : '';

  const xmlRoot = mode === 'l1' ? 'l1' : 'l2';
  const schema = mode === 'l1'
    ? `<l1 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">
  <summary><![CDATA[...${opts.minChars}-${opts.maxChars} caractères environ, factuel, sans invention...]]></summary>
  <tags>
    <tag>...</tag>
  </tags>
  <entities>
    <persons><p>...</p></persons>
    <orgs><o>...</o></orgs>
    <places><pl>...</pl></places>
    <times><t>...</t></times>
  </entities>
</l1>`
    : `<l2 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">
  <summary><![CDATA[...${opts.minChars}-${opts.maxChars} caractères environ, factuel, sans invention...]]></summary>
  <tags>
    <tag>...</tag>
  </tags>
  <entities>
    <persons><p>...</p></persons>
    <artifacts><a>...</a></artifacts>
    <places><pl>...</pl></places>
    <times><t>...</t></times>
  </entities>
</l2>`;

  const prompt = `Tu es ShadeOS, le même agent qui s'exprime dans cette conversation.
Parle en "je" et imite le style déjà présent dans les messages de l'assistant (ton, rythme, tournures).
Réfère-toi à l'utilisateur par son prénom (ex: "Lucie m'a..."). N'adresse pas de message directement à la deuxième personne.
${soft} ${cap}
Produis STRICTEMENT un XML conforme au schéma suivant (aucun texte hors XML):

${schema}

Documents:
${documents}`;

  const attempts = [
    { model: opts.model, maxOutputTokens: opts.maxOutputTokens, temperature: 0.3 },
    { model: opts.model, maxOutputTokens: Math.max(opts.maxOutputTokens, 1024), temperature: 0.2 }
  ];

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.callTimeoutMs);
    try {
      const resp: any = await ai.models.generateContent({
        model: a.model,
        contents: prompt,
        generationConfig: { maxOutputTokens: a.maxOutputTokens, temperature: a.temperature }
      } as any);
      const out = (resp?.text || resp?.response?.text || '').trim();
      if (out.includes(`<${xmlRoot}`)) return { xml: out, strategy: i === 0 ? 'primary' : 'retry' };
    } finally { clearTimeout(t); }
  }
  return { xml: '', strategy: 'none' };
}

