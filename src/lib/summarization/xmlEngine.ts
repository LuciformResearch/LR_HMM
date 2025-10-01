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
  // Persona/Profiles for abstraction across channels
  profile?: 'chat_assistant_fp' | 'chat_user_fp' | 'email_recipient_fp' | 'org_voice_fp' | 'neutral_reporter';
  personaName?: string; // e.g. ShadeOS, Recipient, LuciformResearch
  addressing?: 'first_person' | 'third_person';
  allowSecondPerson?: boolean;
  namingPolicy?: 'forbid_invention' | 'allow_from_input_only' | 'allow_any';
  allowedNames?: string[];
  // If true, return a minimal XML wrapper with only <summary> (no full structured schema)
  directOutput?: boolean;
};

/**
 * Minimal shared XML engine (initially for L1). Uses @google/genai for Vertex/Studio.
 */
export async function generateStructuredXML(
  mode: XmlEngineMode,
  documents: string,
  opts: XmlEngineOpts
): Promise<{ xml: string; strategy: 'primary' | 'retry' | 'none'; }> {
  const nonVertexApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  const ai = new GoogleGenAI(
    opts.useVertex
      ? ({ vertexai: true, project: opts.project, location: opts.location } as any)
      : (nonVertexApiKey ? ({ apiKey: nonVertexApiKey } as any) : ({} as any))
  );

  const soft = opts.hintTarget ? `Objectif longueur: ${opts.hintTarget} caractères (cible douce).` : '';
  const cap = opts.hintCap ? `Ne JAMAIS dépasser ${opts.hintCap} caractères (cap dur).` : '';

  const xmlRoot = mode === 'l1' ? 'l1' : 'l2';
  const minimalSchema = mode === 'l1'
    ? `<l1 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...]]></summary>\n</l1>`
    : `<l2 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...]]></summary>\n</l2>`;
  const fullSchema = mode === 'l1'
    ? `<l1 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...${opts.minChars}-${opts.maxChars} caractères environ, factuel, sans invention...]]></summary>\n  <tags>\n    <tag>...</tag>\n  </tags>\n  <entities>\n    <persons><p>...</p></persons>\n    <orgs><o>...</o></orgs>\n    <places><pl>...</pl></places>\n    <times><t>...</t></times>\n  </entities>\n</l1>`
    : `<l2 minChars=\"${Math.max(50, opts.minChars)}\" maxChars=\"${opts.maxChars}\" version=\"1\">\n  <summary><![CDATA[...${opts.minChars}-${opts.maxChars} caractères environ, factuel, sans invention...]]></summary>\n  <tags>\n    <tag>...</tag>\n  </tags>\n  <entities>\n    <persons><p>...</p></persons>\n    <artifacts><a>...</a></artifacts>\n    <places><pl>...</pl></places>\n    <times><t>...</t></times>\n  </entities>\n</l2>`;
  const schema = opts.directOutput ? minimalSchema : fullSchema;

  // Persona/prompt preamble
  const profile = opts.profile || 'chat_assistant_fp';
  const persona = opts.personaName || (profile === 'org_voice_fp' ? 'LuciformResearch' : 'ShadeOS');
  const addressing = opts.addressing || (profile === 'neutral_reporter' ? 'third_person' : 'first_person');
  const allow2p = opts.allowSecondPerson === true ? true : false;
  const namingPolicy = opts.namingPolicy || 'allow_from_input_only';
  const names = Array.from(new Set((opts.allowedNames || []).filter(Boolean)));
  const namingLine = namingPolicy === 'forbid_invention'
    ? (names.length ? `N'utilise QUE ces noms: ${names.join(', ')}. N'en invente aucun autre.` : `N'utilise aucun nom propre si absent des Documents.`)
    : namingPolicy === 'allow_from_input_only'
      ? (names.length ? `N'utilise que des noms présents dans les Documents (p.ex. ${names.join(', ')}). N'en invente pas.` : `N'utilise que des noms présents dans les Documents; n'en invente pas.`)
      : `Tu peux utiliser des noms si le contexte l'exige.`;
  const addressLine = addressing === 'first_person'
    ? `Tu impersonnes ${persona} et écris à la première personne (${persona === 'LuciformResearch' ? 'nous' : 'je'}). ${allow2p ? '' : 'N’adresse pas de message directement à la deuxième personne.'}`
    : `Tu écris à la troisième personne, style rapport (ne pas s'adresser au lecteur).`;
  const styleHint = profile === 'chat_assistant_fp'
    ? `Imite le style déjà présent dans les messages de ${persona} (ton, rythme, tournures).`
    : profile === 'org_voice_fp'
      ? `Style interne d'organisation, clair et factuel.`
      : `Style neutre, clair et concis.`;

  const narrativeHint = mode === 'l1' && addressing === 'first_person'
    ? `Style narratif de conversation: raconte le déroulé des échanges en "je" en mentionnant l'interlocuteur par son prénom tel qu'il apparaît dans les Documents (ex.: "Lucie a dit...", "je lui ai répondu..."). Décris l'alternance des tours (ce qui a été demandé, ce que j'ai expliqué ensuite), avec des transitions naturelles. Pas de listes à puces, pas d'adresses en "tu/vous".`
    : '';
  const prompt = `Rôle: ${persona}\n${addressLine}\n${styleHint}\n${namingLine}\n${soft} ${cap}\n${narrativeHint}\nProduis STRICTEMENT un XML conforme au schéma suivant (aucun texte hors XML):\n\n${schema}\n\nDocuments:\n${documents}`;

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
