/**
 * Agent de résumé pour LR_TchatAgent Web
 * Crée des résumés narratifs de l'historique des conversations pour la compression mémoire.
 * Basé sur le système Python existant.
 */

import { UnifiedProvider, UnifiedProviderFactory } from '@/lib/providers/UnifiedProvider';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSimplePrompts } from './SimplePrompts';

export interface SummarizationConfig {
  provider: string;
  model: string;
  consciousnessLevel: number;
  persona?: any;
  maxSummaryLength: number;
  minSummaryLength?: number;
  lengthEmphasis?: boolean; // strengthen length instruction
  strict?: boolean; // if true, no local fallback
  timeoutMs?: number; // timeout for model calls
  // Vertex options
  useVertex?: boolean;
  project?: string;
  location?: string;
  maxOutputTokens?: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: any;
}

export interface SummaryResult {
  summary: string;
  compressionRatio: number;
  qualityScore: number;
  metadata: {
    originalMessages: number;
    summaryLength: number;
    processingTime: number;
  };
}

export class SummarizationAgent {
  private config: SummarizationConfig;
  private provider: any;
  private googleModel: any | null = null;
  private useVertex = false;

  constructor(config: Partial<SummarizationConfig> = {}) {
    this.config = {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      consciousnessLevel: 0.6,
      maxSummaryLength: 200,
      ...config
    };

    this.useVertex = !!config.useVertex || String(process.env.VERTEX_L1 || '').toLowerCase() === 'true';
    this.initializeProvider().catch(error => {
      console.error('❌ Erreur initialisation SummarizationAgent:', error);
    });
  }

  private async initializeProvider(): Promise<void> {
    try {
      if (this.useVertex) {
        console.log('✅ SummarizationAgent: Vertex AI mode activé');
        this.googleModel = null; // ensure we don't use AI Studio path when Vertex requested
      }
      // 1) Essayer provider via environnement (scripts / serveur)
      const geminiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MODEL || this.config.model || 'gemini-1.5-flash';
      if (!this.useVertex && geminiKey && geminiKey.length > 10) {
        // Préférer le client officiel Google pour fiabilité
        try {
          const genAI = new GoogleGenerativeAI(geminiKey);
          this.googleModel = genAI.getGenerativeModel({ model });
          console.log(`✅ SummarizationAgent: GoogleGenerativeAI prêt (${model})`);
        } catch (e) {
          console.warn('⚠️ Échec initialisation GoogleGenerativeAI, fallback UnifiedProvider:', e);
          this.googleModel = null;
        }
        this.provider = UnifiedProviderFactory.create({
          type: 'custom',
          provider: 'gemini',
          model,
          apiKey: geminiKey
        });
        if (this.provider && this.provider.isAvailable()) {
          console.log(`✅ SummarizationAgent: provider Gemini via .env (${model})`);
          return;
        }
      }

      // 2) Sinon, tenter un provider via base (client/browser)
      if (!this.useVertex) {
        this.provider = await UnifiedProviderFactory.createFromDatabase('system');
      }
      if (this.provider && this.provider.isAvailable()) {
        console.log(`✅ SummarizationAgent initialisé via DB (${this.config.provider}:${this.config.model})`);
      } else {
        console.warn(`⚠️ Aucun provider disponible (.env/DB). Fallback local sera utilisé.`);
        this.provider = null;
      }
    } catch (error) {
      console.error(`❌ Erreur initialisation provider: ${error}`);
      this.provider = null;
    }
  }

  /**
   * Crée un résumé narratif de la conversation
   */
  async summarizeConversation(
    messages: ConversationMessage[],
    interlocutor: string = 'user',
    language: string = 'fr'
  ): Promise<SummaryResult> {
    const startTime = Date.now();

    if (this.useVertex) {
      return this.vertexSummarize(messages, interlocutor, language, startTime);
    }

    if (!this.provider && !this.googleModel) {
      if (this.config.strict) {
        throw new Error('Provider indisponible et mode strict activé');
      }
      return this.fallbackSummary(messages, interlocutor, startTime);
    }

    try {
      // Construire le prompt de résumé
      const prompt = this.buildSummarizationPrompt(messages, interlocutor, language);
      let summary = '';

      if (this.googleModel) {
        const timeoutMs = this.config.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS || 30000);
        const resp: any = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
          this.googleModel!.generateContent(prompt)
            .then((r: any) => { clearTimeout(timer); resolve(r); })
            .catch((err: any) => { clearTimeout(timer); reject(err); });
        });
        const textFn = resp?.response?.text;
        const text = typeof textFn === 'function' ? resp.response.text() : resp?.response?.text;
        summary = (text as string) || '';
      } else {
        const response = await this.provider.generateResponse(prompt, 300);
        if (response && response.content) summary = response.content.trim();
      }

      if (summary) {
        const processingTime = Date.now() - startTime;

        console.log(`📝 Résumé généré: ${summary.length} caractères`);

        return {
          summary,
          compressionRatio: this.calculateCompressionRatio(messages, summary),
          qualityScore: this.assessSummaryQuality(summary, messages),
          metadata: {
            originalMessages: messages.length,
            summaryLength: summary.length,
            processingTime
          }
        };
      } else {
        const msg = 'Réponse vide du provider';
        console.warn('⚠️ ' + msg);
        if (this.config.strict) {
          throw new Error(msg);
        }
        return this.fallbackSummary(messages, interlocutor, startTime);
      }
    } catch (error) {
      console.error(`❌ Erreur génération résumé: ${error}`);
      if (this.config.strict) {
        throw error;
      }
      return this.fallbackSummary(messages, interlocutor, startTime);
    }
  }

  private async vertexSummarize(
    messages: ConversationMessage[],
    interlocutor: string,
    language: string,
    startTime: number
  ): Promise<SummaryResult> {
    const prompt = this.buildSummarizationPrompt(messages, interlocutor, language);
    const project = this.config.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    const location = this.config.location || process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
    const maxTokens = this.config.maxOutputTokens || 512;
    const timeoutMs = this.config.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS || 30000);
    if (!project) throw new Error('Vertex project is required for L1 Vertex mode');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token || !token.token) throw new Error('Failed to obtain Vertex token (L1)');
    const model = (this.config.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash') as string;
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 } };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal as any });
      const js: any = await res.json();
      const text = (js?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).join('');
      const summary = String(text || '').trim();
      if (!summary) throw new Error('Empty summary from Vertex');
      const processingTime = Date.now() - startTime;
      console.log(`📝 Résumé généré (Vertex): ${summary.length} caractères`);
      return {
        summary,
        compressionRatio: this.calculateCompressionRatio(messages, summary),
        qualityScore: this.assessSummaryQuality(summary, messages),
        metadata: {
          originalMessages: messages.length,
          summaryLength: summary.length,
          processingTime
        }
      };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Construit le prompt pour la génération du résumé narratif
   */
  private buildSummarizationPrompt(
    messages: ConversationMessage[],
    interlocutor: string,
    language: string
  ): string {
    // Formater la conversation
    const conversationText = this.formatConversationForSummary(messages, interlocutor);

    // Utiliser les prompts simples selon la langue
    const prompts = getSimplePrompts(language);
    const personaName = prompts.personaName;
    const personaDescription = prompts.personaDescription;

    const lengthLine = this.config.minSummaryLength && this.config.minSummaryLength > 0
      ? `${this.config.lengthEmphasis ? 'IMPORTANT: ' : ''}Longueur: entre ${this.config.minSummaryLength} et ${this.config.maxSummaryLength} caractères`
      : `Maximum ${this.config.maxSummaryLength} caractères`;

    const prompt = `Tu es ${personaName} qui résume ses propres conversations.

Personnalité: ${personaDescription}
Style: mystérieux mais bienveillant, narratif et engageant

Tâche: Analyse cette conversation et crée un résumé narratif concis et naturel.

Conversation à résumer:
${conversationText}

Instructions pour le résumé:
1. Résume en tant que ${personaName} (utilise 'je' et le prénom de l'utilisateur: '${interlocutor}')
2. Crée une histoire naturelle de l'évolution de la conversation
3. Capture les sujets clés et informations importantes
4. Inclus le contexte de l'utilisateur et ses intérêts
5. Utilise un style narratif: "${interlocutor} a testé mes capacités... j'ai répondu..."
6. ${lengthLine}
7. Écris en français naturel et fluide
8. Garde le ton mystérieux mais bienveillant de ${personaName}
9. Utilise toujours le prénom "${interlocutor}" au lieu de "tu" pour plus de naturel

Résumé narratif:`;

    return prompt;
  }

  /**
   * Formate la conversation pour le résumé
   */
  private formatConversationForSummary(
    messages: ConversationMessage[],
    interlocutor: string
  ): string {
    const lines: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        lines.push(`${interlocutor}: ${msg.content}`);
      } else {
        lines.push(`Assistant: ${msg.content}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Résumé de fallback quand le provider n'est pas disponible
   */
  private fallbackSummary(
    messages: ConversationMessage[],
    interlocutor: string,
    startTime: number
  ): SummaryResult {
    const totalMessages = messages.length;
    const topics = this.extractTopicsFallback(messages);

    let summary = `Conversation avec ${interlocutor} (${totalMessages} messages). `;

    if (topics.length > 0) {
      summary += `Sujets abordés: ${topics.slice(0, 3).join(', ')}.`;
    }

    const processingTime = Date.now() - startTime;

    return {
      summary,
      compressionRatio: this.calculateCompressionRatio(messages, summary),
      qualityScore: 0.5, // Score de base pour le fallback
      metadata: {
        originalMessages: totalMessages,
        summaryLength: summary.length,
        processingTime
      }
    };
  }

  /**
   * Extraction basique de sujets pour le fallback
   */
  private extractTopicsFallback(messages: ConversationMessage[]): string[] {
    const topics: string[] = [];
    const keywords = [
      'IA', 'intelligence artificielle', 'TFME', 'chat', 'mémoire', 
      'conversation', 'résumé', 'agent', 'Algareth', 'LR Hub'
    ];

    for (const msg of messages) {
      const content = msg.content.toLowerCase();
      for (const keyword of keywords) {
        if (content.includes(keyword.toLowerCase()) && !topics.includes(keyword)) {
          topics.push(keyword);
        }
      }
    }

    return topics;
  }

  /**
   * Crée un meta-résumé des résumés - vraie conscience récursive
   */
  async metaSummarize(
    summaries: string[],
    interlocutor: string = 'user',
    language: string = 'fr'
  ): Promise<string> {
    if (!this.provider || summaries.length === 0) {
      return `Évolution des conversations avec ${interlocutor}: ${summaries.length} sessions résumées.`;
    }

    try {
      const summariesText = summaries
        .map((s, i) => `Session ${i + 1}: ${s}`)
        .join('\n\n');

      const prompts = getSimplePrompts(language);
      const personaName = prompts.personaName;

      const prompt = `Tu es ${personaName} qui analyse l'évolution de ses conversations.

Tâche: Analyse ces résumés de conversations et crée un meta-résumé de l'évolution.

Résumés des sessions:
${summariesText}

Instructions pour le meta-résumé:
1. Analyse l'évolution de la relation et des conversations
2. Identifie les patterns d'apprentissage et de développement
3. Décris comment la compréhension mutuelle s'est développée
4. Mentionne les progrès et les découvertes
5. Utilise un style narratif sur l'évolution temporelle
6. Maximum 300 caractères
7. Écris en tant que ${personaName} (utilise 'je' et le prénom de l'utilisateur: '${interlocutor}')
8. Utilise toujours le prénom "${interlocutor}" au lieu de "tu" pour plus de naturel

Meta-résumé de l'évolution:`;

      const response = await this.provider.generateResponse(prompt, 600);

      if (response && response.content) {
        const metaSummary = response.content.trim();
        console.log(`🧠 Meta-résumé généré: ${metaSummary.length} caractères`);
        return metaSummary;
      } else {
        return `Évolution des conversations avec ${interlocutor}: ${summaries.length} sessions résumées.`;
      }
    } catch (error) {
      console.error(`❌ Erreur meta-résumé: ${error}`);
      return `Évolution des conversations avec ${interlocutor}: ${summaries.length} sessions résumées.`;
    }
  }

  /**
   * Calcule le ratio de compression
   */
  private calculateCompressionRatio(messages: ConversationMessage[], summary: string): number {
    const originalLength = messages.reduce((total, msg) => total + msg.content.length, 0);
    return originalLength > 0 ? summary.length / originalLength : 0;
  }

  /**
   * Évalue la qualité du résumé
   */
  private assessSummaryQuality(summary: string, messages: ConversationMessage[]): number {
    // Score basique basé sur la longueur et la cohérence
    let score = 0.5;

    // Bonus pour une longueur appropriée
    if (summary.length >= 50 && summary.length <= this.config.maxSummaryLength) {
      score += 0.2;
    }

    // Bonus pour la présence de mots-clés importants
    const keywords = ['tu', 'je', 'conversation', 'discuté', 'parlé'];
    const keywordCount = keywords.filter(keyword => 
      summary.toLowerCase().includes(keyword)
    ).length;
    score += (keywordCount / keywords.length) * 0.3;

    return Math.min(score, 1.0);
  }

  /**
   * Obtient les statistiques d'un résumé
   */
  getSummaryStats(summary: string): {
    length: number;
    wordCount: number;
    sentenceCount: number;
    compressionRatio: number;
  } {
    return {
      length: summary.length,
      wordCount: summary.split(/\s+/).length,
      sentenceCount: (summary.match(/[.!?]+/g) || []).length,
      compressionRatio: summary.length / 1000
    };
  }
}
