import { GoogleGenAI } from '@google/genai';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import { generateStructuredXML } from '@/lib/summarization/xmlEngine';
import { runPool } from '@/lib/hmm/runPool';
import { evaluateUnderflow } from '@/lib/hmm/policies';
import { buildChatDoc } from '@/lib/hmm/adapters/chatAdapter';
import { ParsedItem, L1Summary, L2Summary } from '@/lib/hmm/types';
import { computeL2Bounds } from '@/lib/hmm/bounds';
import { evaluateOverflow } from '@/lib/hmm/policies';

export type L1WindowOptions = {
  windowChars: number;
  ensureAssistant: boolean;
  maxL1: number;
  targetRatio?: number; // estimate summary length = charCount * ratio (capped)
};

export type L1EngineOptions = {
  useVertex: boolean;
  project?: string;
  location?: string;
  model: string;
  callTimeoutMs: number;
  maxOutputTokens: number;
  minSummary: number; // minimum summary chars (0 to disable)
  maxSummary: number; // absolute cap per summary
  targetRatio?: number; // optional ratio-based limit per block
  structuredXml: boolean; // produce structured XML or minimal directOutput wrapper
  allowHeuristicFallback: boolean;
  profile?: any;
  personaName: string;
  interlocutor: string;
  roleMap: Record<string,string>;
  shortMode: 'accept' | 'regenerate' | 'error';
};

type Block = { items: ParsedItem[]; charCount: number };

function toConvMessages(block: ParsedItem[]) {
  return block.map(m => ({
    role: m.role === 'unknown' ? 'user' : m.role,
    content: m.content,
    timestamp: new Date().toISOString(),
  }));
}

export class HierarchicalMemoryCompressor {
  async windowL1(items: ParsedItem[], opts: L1WindowOptions): Promise<Block[]> {
    const blocks: Block[] = [];
    let current: ParsedItem[] = [];
    let currentChars = 0;
    let produced = 0;

    const canFinalize = () => current.length > 0 && (!opts.ensureAssistant || current[current.length - 1].role === 'assistant');

    const finalize = () => {
      blocks.push({ items: [...current], charCount: currentChars });
      current = [];
      currentChars = 0;
    };

    for (const m of items) {
      const nextChars = currentChars + m.charCount;
      if (current.length > 0 && nextChars > opts.windowChars && canFinalize()) {
        finalize();
        produced += 1;
        if (produced >= opts.maxL1) break;
      }
      current.push(m);
      currentChars += m.charCount;
    }
    if (produced < opts.maxL1 && canFinalize() && current.length > 0) finalize();
    return blocks;
  }

  async summarizeL1Blocks(blocks: Block[], engine: L1EngineOptions, concurrency: number): Promise<L1Summary[]> {
    const genAI = new GoogleGenAI(engine.useVertex ? { vertexai: true, project: engine.project, location: engine.location } as any : {} as any);

    const results = await runPool(blocks, async (block, idx) => {
      // Determine target length per block
      let limit = engine.maxSummary;
      if (engine.targetRatio) {
        const est = Math.floor(block.charCount * engine.targetRatio);
        limit = Math.min(engine.maxSummary, Math.max(100, est));
      }

      // Build docs and allowed names via adapter
      const { docs, allowedNames } = buildChatDoc(block.items, { roleMap: engine.roleMap, interlocutor: engine.interlocutor, personaName: engine.personaName });

      // Choose XML mode
      if (engine.structuredXml) {
        // Structured XML with tags/entities. Fallback heuristic if XML is missing
        const xmlRes = await generateStructuredXML('l1', docs, {
          useVertex: engine.useVertex,
          project: engine.project,
          location: engine.location,
          model: engine.model,
          maxOutputTokens: Math.max(engine.maxOutputTokens, 768),
          callTimeoutMs: engine.callTimeoutMs,
          minChars: engine.minSummary > 0 ? engine.minSummary : 100,
          maxChars: limit,
          profile: engine.profile,
          personaName: engine.personaName,
          addressing: 'first_person',
          allowSecondPerson: false,
          namingPolicy: 'allow_from_input_only',
          allowedNames,
        });
        let xml = xmlRes.xml;
        if (!xml || !xml.includes('<l1')) {
          if (!engine.allowHeuristicFallback) throw new Error('L1 XML generation failed (no <l1> root)');
          const pickSent = (t: string) => (t.split(/(?<=[\.!?])\s+/)[0] || t).trim();
          const stitched = block.items.map(m => pickSent(m.content)).join(' ');
          const fallback = stitched.slice(0, limit);
          xml = `<l1><summary><![CDATA[${fallback}]]></summary><tags></tags><entities></entities></l1>`;
        }
        const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 100000 });
        const parsed = parser.parse();
        const root: any = parsed.document?.root;
        if (!root || root.name !== 'l1') throw new Error('L1 XML parse failed');
        const collectText = (node: any): string => {
          if (!node) return '';
          if (node.type === 'text' || node.type === 'cdata') return node.content || '';
          return (node.children || []).map(collectText).join('');
        };
        const getText = (name: string) => { const el = root.findElement(name); return el ? collectText(el).trim() : ''; };
        const summaryTextXml = getText('summary');

        let summaryText = summaryTextXml || '';
        const under = evaluateUnderflow(summaryText.length, engine.minSummary, engine.shortMode);
        if (under.decision === 'regenerate') {
          const xmlRes2 = await generateStructuredXML('l1', docs, {
            useVertex: engine.useVertex, project: engine.project, location: engine.location, model: engine.model,
            maxOutputTokens: Math.max(engine.maxOutputTokens, 1024), callTimeoutMs: engine.callTimeoutMs,
            minChars: Math.max(engine.minSummary, 100), maxChars: limit, profile: engine.profile, personaName: engine.personaName,
          });
          const xml2 = xmlRes2.xml || '';
          if (xml2.includes('<l1')) {
            const p2 = new LuciformXMLParser(xml2, { mode: 'luciform-permissive', maxTextLength: 100000 }).parse();
            const r2: any = p2.document?.root;
            const get2 = (name: string) => { const el = r2?.findElement?.(name); return el ? collectText(el).trim() : ''; };
            const s2 = r2 ? get2('summary') : '';
            if (s2 && s2.length >= engine.minSummary) summaryText = s2;
          }
        } else if (under.decision === 'error') {
          throw new Error(under.message);
        }

        // collect tags/entities
        const tagsEl: any = root.findElement('tags');
        const xmlTags: string[] = (tagsEl?.findAllElements('tag') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean).slice(0, 12);
        const entsEl: any = root.findElement('entities');
        const persons = (entsEl?.findAllElements('p') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);
        const orgs = (entsEl?.findAllElements('o') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);
        const places = (entsEl?.findAllElements('pl') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);
        const times = (entsEl?.findAllElements('t') || []).map((x: any) => x.getTextContent().trim()).filter(Boolean);

        const base: L1Summary = {
          level: 1,
          covers: block.items.map(m => m.index),
          charCount: block.charCount,
          summary: summaryText,
          summaryChars: summaryText.length,
          compressionRatio: summaryText.length / Math.max(1, block.charCount),
          qualityScore: 0.7,
          durationMs: 0,
          tags: xmlTags,
          entities: { persons, orgs, places, times }
        } as any;
        return base;
      }

      // Direct-output non-structured: still go through xmlEngine (minimal XML wrapper)
      const { docs: plainDocs, allowedNames: allowedNames2 } = buildChatDoc(block.items, { roleMap: engine.roleMap, interlocutor: engine.interlocutor, personaName: engine.personaName });
      const xmlRes = await generateStructuredXML('l1', plainDocs, {
        useVertex: engine.useVertex,
        project: engine.project,
        location: engine.location,
        model: engine.model,
        maxOutputTokens: Math.max(engine.maxOutputTokens, 768),
        callTimeoutMs: engine.callTimeoutMs,
        minChars: engine.minSummary > 0 ? engine.minSummary : 100,
        maxChars: limit,
        profile: engine.profile,
        personaName: engine.personaName,
        addressing: 'first_person',
        allowSecondPerson: false,
        namingPolicy: 'allow_from_input_only',
        allowedNames: allowedNames2,
        directOutput: true,
      });
      const xml = xmlRes.xml || '';
      const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 100000 });
      const parsedDirect = parser.parse();
      const rootDirect: any = parsedDirect.document?.root;
      if (!rootDirect || rootDirect.name !== 'l1') throw new Error('L1 direct-output XML parse failed');
      const collectText2 = (node: any): string => { if (!node) return ''; if (node.type === 'text' || node.type === 'cdata') return node.content || ''; return (node.children || []).map(collectText2).join(''); };
      const getText2 = (name: string) => { const el = rootDirect.findElement(name); return el ? collectText2(el).trim() : ''; };
      const text = getText2('summary');
      if (!text) throw new Error('Empty summary');

      let summaryText = text;
      const under = evaluateUnderflow(summaryText.length, engine.minSummary, engine.shortMode);
      if (under.decision === 'regenerate') {
        // Non-XML retry: prompt-based regeneration
        const prompt2 = this.buildPrompt(block.items, engine.interlocutor, engine.minSummary, limit) + `\n\nIMPORTANT: Assure-toi que le texte atteint au minimum ${engine.minSummary} caractères sans couper la dernière phrase.`;
        const resp2: any = await genAI.models.generateContent({
          model: engine.model,
          contents: prompt2,
          generationConfig: { maxOutputTokens: Math.max(engine.maxOutputTokens, 1024), temperature: 0.2 }
        } as any);
        const text2 = (resp2?.text || resp2?.response?.text || '').trim();
        if (text2 && text2.length >= engine.minSummary) summaryText = text2;
      } else if (under.decision === 'error') {
        throw new Error(under.message);
      }

      const base: L1Summary = {
        level: 1,
        covers: block.items.map(m => m.index),
        charCount: block.charCount,
        summary: summaryText,
        summaryChars: summaryText.length,
        compressionRatio: summaryText.length / Math.max(1, block.charCount),
        qualityScore: 0.7,
        durationMs: 0,
      } as any;
      return base;
    }, Math.max(1, concurrency));

    return results;
  }

  buildPrompt(messages: ParsedItem[], interloc: string, minLen: number | undefined, maxLen: number) {
    const lines: string[] = [];
    const assistantSamples: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant') assistantSamples.push(msg.content);
      const who = msg.role === 'assistant' ? 'Assistant' : interloc;
      lines.push(`${who}: ${msg.content}`);
    }
    const conversationText = lines.join('\n');
    const styleHint = assistantSamples.length > 0
      ? `Imite le style déjà présent dans les messages de l'assistant (ton, rythme, tournures).`
      : `Style par défaut: neutre, clair, concis, chaleureux.`;
    const personaName = 'ShadeOS';
    const lengthLine = minLen && minLen > 0 ? `IMPORTANT: Longueur entre ${minLen} et ${maxLen} caractères.` : `Maximum ${maxLen} caractères.`;
    return `Tu es ${personaName}, le même agent qui s'exprime dans cette conversation.\n${styleHint}\nParle à la première personne ("je"). Réfère-toi à l'utilisateur par son prénom "${interloc}" en narration.\n\nTâche: Analyse la conversation et crée un résumé narratif fidèle et naturel.\n\nConversation à résumer:\n${conversationText}\n\nContraintes:\n- ${lengthLine}\n- Utilise le même langage que dans la discussion\n- Préserve les faits, pas d'invention\n- Ton cohérent avec les messages de l'assistant déjà présents\n\nRésumé narratif (en "je"):`;
  }

  // --- L2 ---
  groupL1(l1: L1Summary[], groupSize: number): L1Summary[][] {
    const out: L1Summary[][] = [];
    for (let i = 0; i < l1.length; i += groupSize) out.push(l1.slice(i, i + groupSize));
    return out;
  }

  async summarizeL2Groups(
    groups: L1Summary[][],
    engine: {
      useVertex: boolean; project?: string; location?: string; model: string; callTimeoutMs: number; maxOutputTokens: number;
      l2Multiplier: number; l2Wiggle: number; hardMin: number; l2SoftTarget: number;
      overflowMode: 'accept'|'regenerate'; overflowMaxRatio: number; softRatioStep: number;
      allowHeuristicFallback: boolean;
    },
    concurrency: number,
    logger?: { info: (msg: string) => void }
  ): Promise<L2Summary[]> {
    const toDocs = (g: L1Summary[]) => g.map((s, i) => `---\n[L1 #${i+1} | ${s.summaryChars} chars]\n${s.summary}`).join('\n');
    const extractFromXml = (xml: string) => {
      const parser = new LuciformXMLParser(xml, { mode: 'luciform-permissive', maxTextLength: 200000 });
      const parsed = parser.parse();
      const root: any = parsed.document?.root;
      if (!root) return { summary: '', tags: [], persons: [], artifacts: [], places: [], times: [], signalsRaw: '', omissions: [], extrasText: '' } as any;
      const collectText = (node: any): string => {
        if (!node) return '';
        if (node.type === 'text' || node.type === 'cdata') return node.content || '';
        return (node.children || []).map(collectText).join('');
      };
      const getTextFrom = (name: string) => { const el = root.findElement(name); return el ? collectText(el).trim() : ''; };
      const summary = getTextFrom('summary');
      const tagsEl: any = root.findElement('tags');
      const tags: string[] = (tagsEl?.findAllElements('tag') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
      const entitiesEl: any = root.findElement('entities');
      const persons = (entitiesEl?.findAllElements('p') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
      const artifacts = (entitiesEl?.findAllElements('a') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
      const places = (entitiesEl?.findAllElements('pl') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
      const times = (entitiesEl?.findAllElements('t') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
      const signalsRaw = getTextFrom('signals');
      const extrasEl = root.findElement('extras');
      const omissions = (extrasEl?.findAllElements('omission') || []).map((t: any) => t.getTextContent().trim()).filter(Boolean);
      const extrasText = extrasEl ? collectText(extrasEl).trim() : '';
      return { summary, tags, persons, artifacts, places, times, signalsRaw, omissions, extrasText };
    };

    const results = await runPool(groups as any, async (g: L1Summary[], gi: number) => {
      const sumChars = g.reduce((a, x) => a + (x.summaryChars || 0), 0);
      const avgChars = Math.max(1, Math.floor(sumChars / Math.max(1, g.length)));
      const { min: gMin, max: gMax, target, cap, softTarget } = computeL2Bounds(avgChars, {
        multiplier: engine.l2Multiplier, wiggle: engine.l2Wiggle, hardMin: engine.hardMin, capRatio: 2.0, softTargetRatio: engine.l2SoftTarget
      });
      logger?.info?.(`L2 bounds: size=${g.length} avgL1=${avgChars} target=${target} cap=${cap} bounds=[${gMin},${gMax}] softTarget=${softTarget}`);

      // generate with xml engine
      const docs = toDocs(g);
      const gen = await generateStructuredXML('l2', docs, {
        useVertex: engine.useVertex,
        project: engine.project,
        location: engine.location,
        model: engine.model,
        maxOutputTokens: engine.maxOutputTokens,
        callTimeoutMs: engine.callTimeoutMs,
        minChars: gMin,
        maxChars: gMax,
        hintTarget: softTarget,
        hintCap: cap,
      });
      let xmlOut = gen.xml;
      if (!xmlOut || !xmlOut.includes('<l2')) {
        logger?.info?.(`LLM XML missing or invalid. strategy=${gen.strategy}`);
        if (!engine.allowHeuristicFallback) throw new Error('L2 XML generation failed (no <l2> root). Heuristic fallback disabled.');
        const pickSent = (t: string) => (t.split(/(?<=[\.!?])\s+/)[0] || t).trim();
        const stitched = g.map(s => pickSent(s.summary)).join(' ');
        const fallbackSummary = stitched.slice(0, gMax);
        xmlOut = `<l2><summary><![CDATA[${fallbackSummary}]]></summary><tags></tags><entities></entities><signals><![CDATA[{}]]></signals></l2>`;
        logger?.info?.(`Heuristic fallback used: stitched-first-sentences length=${fallbackSummary.length}`);
      }

      let { summary, tags, persons, artifacts, places, times, signalsRaw, omissions, extrasText } = extractFromXml(xmlOut);
      const len = summary.length;
      if (len < gMin) throw new Error(`L2 too short: len=${len} < min=${gMin} (avgL1=${avgChars})`);
      if (len > gMax) {
        const ev = evaluateOverflow(len, avgChars, gMax, engine.overflowMode, engine.overflowMaxRatio, engine.l2SoftTarget, engine.softRatioStep);
        logger?.info?.(ev.message);
        if (ev.decision === 'regenerate') {
          const newSoft = ev.newSoftTargetRatio || engine.l2SoftTarget;
          const docs2 = toDocs(g);
          const hint2 = Math.max(50, Math.floor(avgChars * newSoft));
          const gen2 = await generateStructuredXML('l2', docs2, { useVertex: engine.useVertex, project: engine.project, location: engine.location, model: engine.model, maxOutputTokens: engine.maxOutputTokens, callTimeoutMs: engine.callTimeoutMs, minChars: gMin, maxChars: gMax, hintTarget: hint2, hintCap: cap });
          if (gen2.xml && gen2.xml.includes('<l2')) {
            const e2 = extractFromXml(gen2.xml);
            const len2 = e2.summary.length;
            const ratio2 = len2 / Math.max(1, avgChars);
            if (len2 <= gMax && len2 >= gMin) {
              summary = e2.summary; tags = e2.tags; persons = e2.persons; artifacts = e2.artifacts; places = e2.places; times = e2.times; signalsRaw = e2.signalsRaw; omissions = e2.omissions; extrasText = e2.extrasText;
            } else if (ratio2 <= engine.overflowMaxRatio) {
              summary = e2.summary; tags = e2.tags; persons = e2.persons; artifacts = e2.artifacts; places = e2.places; times = e2.times; signalsRaw = e2.signalsRaw; omissions = e2.omissions; extrasText = e2.extrasText;
            } else {
              throw new Error(`L2 overflow after retry (len=${len2} > ${gMax}, ratio=${ratio2.toFixed(2)})`);
            }
          } else {
            throw new Error('L2 XML retry generation failed');
          }
        } else if (ev.decision !== 'accept') {
          throw new Error(ev.message);
        }
      }

      const compressionRatio = summary.length / Math.max(1, sumChars);
      const result: L2Summary = {
        level: 2,
        covers: g.flatMap(x => (x as any).covers || []),
        charCount: sumChars,
        summary,
        summaryChars: summary.length,
        compressionRatio,
        qualityScore: 0.0,
        durationMs: 0,
        tags,
        entities: { persons, artifacts, places, times },
        signals: signalsRaw,
        extras: omissions && (omissions as any).length ? { omissions } : (extrasText ? { text: extrasText } : undefined)
      } as any;
      return result;
    }, Math.max(1, concurrency));

    return results as any;
  }
}
