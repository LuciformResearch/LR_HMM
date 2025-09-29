/**
 * Gestionnaire de mémoire hiérarchique pour Algareth
 * Implémente la stratégie de compression mémoire avec résumés L1, L2, L3...
 * Basé sur le plan de compression ChatGPT analysé
 */

import { ConversationMessage } from '@/lib/summarization/SummarizationAgent';
import { SummarizationAgent } from '@/lib/summarization/SummarizationAgent';

export interface MemoryItem {
  id: string;
  type: 'raw' | 'summary';
  level?: number; // 1, 2, 3... pour les résumés
  content: string;
  characterCount: number;
  speakerRole?: 'user' | 'assistant'; // Rôle du locuteur
  topics?: string[];
  covers?: string[]; // IDs des messages couverts par ce résumé
  timestamp: string;
  metadata?: {
    originalMessageCount?: number;
    compressionRatio?: number;
    qualityScore?: number;
  };
}

export interface MemoryBudget {
  maxCharacters: number;
  currentCharacters: number;
  summaryRatio: number; // Pourcentage d'éléments qui sont des résumés
}

export interface CompressionAction {
  action: 'NONE' | 'CREATE_L1' | 'REPLACE_RAW_WITH_L1' | 'MERGE_TO_L2' | 'MERGE_TO_L3';
  summaries?: MemoryItem[];
  evictions?: string[]; // IDs des messages supprimés
  replacements?: Array<{ with: string; replaces: string[] }>;
  budget: MemoryBudget;
}

export interface ManagerOptions {
  l1Interval?: number; // messages per L1 trigger
  autoSummarize?: boolean; // trigger summaries automatically on add
  l1CharThreshold?: number; // characters since last L1 to trigger
  strictSummarization?: boolean; // pass strict to SummarizationAgent
}

export class HierarchicalMemoryManager {
  private memory: MemoryItem[] = [];
  private budgetMax: number = 10000; // 10k caractères par défaut
  private summarizationAgent: SummarizationAgent;
  private messageCounter: number = 0;
  private lastL1Timestamp: number = 0;
  private eventListeners: Map<string, Function[]> = new Map();
  private l1Interval: number = 5;
  private autoSummarize: boolean = true;
  private summaryQueue: Promise<void> = Promise.resolve();
  private l1CharThreshold?: number;

  constructor(budgetMax: number = 10000, options?: ManagerOptions) {
    this.budgetMax = budgetMax;
    this.summarizationAgent = new SummarizationAgent({
      maxSummaryLength: 200,
      consciousnessLevel: 0.7,
      strict: options?.strictSummarization ?? false,
    });
    if (options) {
      if (typeof options.l1Interval === 'number' && options.l1Interval > 0) {
        this.l1Interval = options.l1Interval;
      }
      if (typeof options.autoSummarize === 'boolean') {
        this.autoSummarize = options.autoSummarize;
      }
      if (typeof options.l1CharThreshold === 'number' && options.l1CharThreshold > 0) {
        this.l1CharThreshold = options.l1CharThreshold;
      }
    }
    console.log('🧠 HierarchicalMemoryManager initialisé avec budget:', this.budgetMax);
  }

  /**
   * Ajoute un listener d'événement
   */
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Supprime un listener d'événement
   */
  off(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Émet un événement
   */
  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  /**
   * Ajoute un nouveau message à la mémoire
   */
  addMessage(content: string, role: 'user' | 'assistant', user: string = 'user'): void {
    const messageId = `msg_${Date.now()}_${++this.messageCounter}`;
    const message: MemoryItem = {
      id: messageId,
      type: 'raw',
      content,
      characterCount: content.length,
      speakerRole: role,
      timestamp: new Date().toISOString(),
      metadata: {
        originalMessageCount: 1
      }
    };

    this.memory.push(message);
    console.log(`📝 Message ajouté: ${messageId} (${content.length} chars)`);

    // Émettre un événement pour l'ajout de message
    this.emit('message_added', {
      messageId,
      role,
      user,
      characterCount: content.length,
      totalMessages: this.memory.length
    });

    // Vérifier si on doit créer un résumé L1
    this.checkAndCreateL1(user);
    
    // Appliquer la compression si nécessaire
    this.applyBudgetCompression(user);
  }

  /**
   * Vérifie si on doit créer un résumé L1 (tous les 5 messages)
   */
  private checkAndCreateL1(user: string): void {
    const messagesSinceLastL1 = this.getMessagesSinceLastL1();
    const charsSinceLastL1 = this.getCharsSinceLastL1();
    const last = this.memory[this.memory.length - 1];
    const assistantTurn = last?.speakerRole === 'assistant';
    
    const triggerByCount = messagesSinceLastL1 >= this.l1Interval;
    const triggerByChars = this.l1CharThreshold ? charsSinceLastL1 >= this.l1CharThreshold : false;

    if (this.autoSummarize && assistantTurn && (triggerByCount || triggerByChars)) {
      console.log(`📊 ${messagesSinceLastL1} messages depuis le dernier L1, création d'un nouveau résumé...`);
      
      // Émettre un événement avant la création
      this.emit('l1_triggered', {
        user,
        messagesSinceLastL1,
        totalMessages: this.memory.length
      });
      // Sérier les résumés pour éviter la concurrence réseau
      this.enqueueSummary(() => this.createL1Summary(user));
    }
  }

  /**
   * Nombre de caractères bruts depuis le dernier L1
   */
  private getCharsSinceLastL1(): number {
    let chars = 0;
    for (let i = this.memory.length - 1; i >= 0; i--) {
      const it = this.memory[i];
      if (it.type === 'summary' && it.level === 1) break;
      if (it.type === 'raw') chars += it.characterCount;
    }
    return chars;
  }

  private enqueueSummary(work: () => Promise<void>): void {
    this.summaryQueue = this.summaryQueue.then(() => work()).catch(err => {
      console.error('❌ Erreur dans la file de résumés:', err);
    });
  }

  /**
   * Compte les messages bruts depuis le dernier résumé L1
   */
  private getMessagesSinceLastL1(): number {
    let count = 0;
    for (let i = this.memory.length - 1; i >= 0; i--) {
      if (this.memory[i].type === 'raw') {
        count++;
      } else if (this.memory[i].type === 'summary' && this.memory[i].level === 1) {
        break; // On a trouvé le dernier L1
      }
    }
    return count;
  }

  /**
   * Crée un résumé L1 des 5 derniers messages bruts
   */
  private async createL1Summary(user: string): Promise<void> {
    const rawMessages = this.memory.filter(item => item.type === 'raw');
    const last5Messages = rawMessages.slice(-5);
    
    if (last5Messages.length < 5) {
      console.log('⚠️ Pas assez de messages pour créer un L1');
      return;
    }

    try {
      // Convertir en format ConversationMessage pour le SummarizationAgent
      const conversationMessages: ConversationMessage[] = last5Messages.map(msg => ({
        role: this.memory.indexOf(msg) % 2 === 0 ? 'user' : 'assistant', // Approximation
        content: msg.content,
        timestamp: msg.timestamp
      }));

      // Générer le résumé L1
      const summaryResult = await this.summarizationAgent.summarizeConversation(
        conversationMessages,
        user,
        'fr'
      );

      // Créer l'item de résumé L1
      const l1Summary: MemoryItem = {
        id: `l1_${Date.now()}`,
        type: 'summary',
        level: 1,
        content: summaryResult.summary,
        characterCount: summaryResult.summary.length,
        topics: this.extractTopics(summaryResult.summary),
        covers: last5Messages.map(msg => msg.id),
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageCount: last5Messages.length,
          compressionRatio: summaryResult.compressionRatio,
          qualityScore: summaryResult.qualityScore
        }
      };

      // Remplacer les 5 messages bruts par le résumé L1
      this.replaceRawWithL1(last5Messages.map(msg => msg.id), l1Summary);
      
      this.lastL1Timestamp = Date.now();
      console.log(`✅ Résumé L1 créé: ${l1Summary.id} (${l1Summary.characterCount} chars)`);
      
      // Émettre un événement pour les notifications dev
      this.emit('l1_created', {
        summaryId: l1Summary.id,
        user,
        messageCount: last5Messages.length,
        characterCount: l1Summary.characterCount,
        summary: l1Summary.content,
        topics: l1Summary.topics
      });
      
    } catch (error) {
      console.error('❌ Erreur création résumé L1:', error);
    }
  }

  /**
   * Remplace des messages bruts par un résumé L1
   */
  private replaceRawWithL1(rawIds: string[], l1Summary: MemoryItem): void {
    // Calculer l'index d'insertion AVANT suppression pour conserver l'ordre
    const firstRawId = rawIds[0];
    let insertionIndex = this.memory.findIndex(item => item.id === firstRawId);
    if (insertionIndex < 0) {
      // Fallback: insérer en fin si l'ID n'est plus présent (cas limite)
      insertionIndex = this.memory.length;
    }

    // Supprimer les messages bruts
    this.memory = this.memory.filter(item => !rawIds.includes(item.id));

    // Insérer le résumé L1 à l'emplacement du premier message couvert
    this.memory.splice(insertionIndex, 0, l1Summary);
    
    console.log(`🔄 ${rawIds.length} messages bruts remplacés par résumé L1: ${l1Summary.id}`);
  }

  /**
   * Trouve l'index d'insertion pour maintenir l'ordre chronologique
   */
  private findInsertionIndex(firstRawId: string): number {
    const firstRawIndex = this.memory.findIndex(item => item.id === firstRawId);
    return firstRawIndex >= 0 ? firstRawIndex : this.memory.length;
  }

  /**
   * Applique la compression de budget
   */
  private applyBudgetCompression(user: string): void {
    const currentBudget = this.getCurrentBudget();
    
    if (currentBudget.currentCharacters > this.budgetMax) {
      console.log(`💰 Budget dépassé: ${currentBudget.currentCharacters}/${this.budgetMax} chars`);
      this.handleBudgetExceeded(user);
    }
  }

  /**
   * Gère le dépassement de budget
   */
  private handleBudgetExceeded(user: string): void {
    // Phase 1: Remplacer les plus anciens messages bruts par des L1
    while (this.getCurrentBudget().currentCharacters > this.budgetMax) {
      const oldestRawBlock = this.getOldestContiguousRawBlock();
      if (oldestRawBlock.length === 0) break;
      
      // Créer un L1 pour ce bloc si nécessaire
      this.createL1ForBlock(oldestRawBlock, user);
      
      // Si on a plus de 50% de résumés, passer à la fusion hiérarchique
      if (this.getCurrentBudget().summaryRatio > 0.5) {
        console.log('🔄 Plus de 50% de résumés, activation fusion hiérarchique...');
        break;
      }
    }
    
    // Phase 2: Fusion hiérarchique (L1 → L2, L2 → L3...)
    this.performHierarchicalMerging(user);
  }

  /**
   * Récupère le bloc de messages bruts le plus ancien et contigu
   */
  private getOldestContiguousRawBlock(): MemoryItem[] {
    const rawMessages = this.memory.filter(item => item.type === 'raw');
    if (rawMessages.length === 0) return [];
    
    // Pour la Phase 1, on prend les 5 plus anciens
    return rawMessages.slice(0, Math.min(5, rawMessages.length));
  }

  /**
   * Crée un L1 pour un bloc de messages
   */
  private async createL1ForBlock(messages: MemoryItem[], user: string): Promise<void> {
    if (messages.length === 0) return;
    
    try {
      const conversationMessages: ConversationMessage[] = messages.map(msg => ({
        role: 'user', // Approximation pour la Phase 1
        content: msg.content,
        timestamp: msg.timestamp
      }));

      const summaryResult = await this.summarizationAgent.summarizeConversation(
        conversationMessages,
        user,
        'fr'
      );

      const l1Summary: MemoryItem = {
        id: `l1_${Date.now()}`,
        type: 'summary',
        level: 1,
        content: summaryResult.summary,
        characterCount: summaryResult.summary.length,
        topics: this.extractTopics(summaryResult.summary),
        covers: messages.map(msg => msg.id),
        timestamp: new Date().toISOString(),
        metadata: {
          originalMessageCount: messages.length,
          compressionRatio: summaryResult.compressionRatio,
          qualityScore: summaryResult.qualityScore
        }
      };

      this.replaceRawWithL1(messages.map(msg => msg.id), l1Summary);
      
    } catch (error) {
      console.error('❌ Erreur création L1 pour bloc:', error);
    }
  }

  /**
   * Effectue la fusion hiérarchique (Phase 2 - pour plus tard)
   */
  private performHierarchicalMerging(user: string): void {
    // TODO: Implémenter en Phase 2
    console.log('🔄 Fusion hiérarchique (Phase 2) - à implémenter');
  }

  /**
   * Extrait les topics d'un résumé
   */
  private extractTopics(summary: string): string[] {
    const keywords = [
      'mémoire', 'conversation', 'discussion', 'problème', 'solution',
      'code', 'programmation', 'développement', 'test', 'erreur',
      'Algareth', 'personnalité', 'style', 'ton', 'réponse'
    ];
    
    return keywords.filter(keyword => 
      summary.toLowerCase().includes(keyword.toLowerCase())
    ).slice(0, 6); // Max 6 topics
  }

  /**
   * Calcule le budget actuel
   */
  getCurrentBudget(): MemoryBudget {
    const totalChars = this.memory.reduce((sum, item) => sum + item.characterCount, 0);
    const summaryCount = this.memory.filter(item => item.type === 'summary').length;
    const totalItems = this.memory.length;
    
    return {
      maxCharacters: this.budgetMax,
      currentCharacters: totalChars,
      summaryRatio: totalItems > 0 ? summaryCount / totalItems : 0
    };
  }

  /**
   * Construit le contexte pour le prompt (derniers messages + résumés pertinents)
   */
  buildContextForPrompt(query: string, maxChars: number = 5000): string {
    const recentMessages = this.getRecentMessages(8); // 8 derniers messages
    const remainingChars = maxChars - this.getCharacterCount(recentMessages);
    
    const relevantSummaries = this.getRelevantSummaries(query, remainingChars);
    
    const contextItems = [...recentMessages, ...relevantSummaries];
    
    return this.formatContextForPrompt(contextItems);
  }

  /**
   * Récupère les messages les plus récents
   */
  private getRecentMessages(count: number): MemoryItem[] {
    return this.memory.slice(-count);
  }

  /**
   * Récupère les résumés les plus pertinents pour une requête
   */
  private getRelevantSummaries(query: string, maxChars: number): MemoryItem[] {
    const summaries = this.memory.filter(item => item.type === 'summary');
    
    // Pour la Phase 1, on prend simplement les résumés les plus récents
    // TODO: Implémenter la pertinence sémantique en Phase 3
    const relevantSummaries: MemoryItem[] = [];
    let currentChars = 0;
    
    for (const summary of summaries.reverse()) { // Plus récents en premier
      if (currentChars + summary.characterCount <= maxChars) {
        relevantSummaries.push(summary);
        currentChars += summary.characterCount;
      }
    }
    
    return relevantSummaries;
  }

  /**
   * Calcule le nombre de caractères d'une liste d'items
   */
  private getCharacterCount(items: MemoryItem[]): number {
    return items.reduce((sum, item) => sum + item.characterCount, 0);
  }

  /**
   * Formate le contexte pour le prompt
   */
  private formatContextForPrompt(items: MemoryItem[]): string {
    const lines: string[] = [];
    
    for (const item of items) {
      if (item.type === 'raw') {
        lines.push(`Message: ${item.content}`);
      } else {
        lines.push(`Résumé L${item.level}: ${item.content}`);
      }
    }
    
    return lines.join('\n\n');
  }

  /**
   * Obtient les statistiques de la mémoire
   */
  getMemoryStats(): {
    totalItems: number;
    rawMessages: number;
    summaries: number;
    l1Count: number;
    totalCharacters: number;
    budget: MemoryBudget;
  } {
    const budget = this.getCurrentBudget();
    
    return {
      totalItems: this.memory.length,
      rawMessages: this.memory.filter(item => item.type === 'raw').length,
      summaries: this.memory.filter(item => item.type === 'summary').length,
      l1Count: this.memory.filter(item => item.type === 'summary' && item.level === 1).length,
      totalCharacters: budget.currentCharacters,
      budget
    };
  }

  /**
   * Exporte la mémoire pour debug
   */
  exportMemory(): MemoryItem[] {
    return [...this.memory];
  }

  /**
   * Vide la mémoire
   */
  clearMemory(): void {
    this.memory = [];
    this.messageCounter = 0;
    this.lastL1Timestamp = 0;
    console.log('🧹 Mémoire vidée');
  }
}
