/**
 * Gestionnaire de résumés pour LR_TchatAgent Web
 * Organise les résumés par utilisateur dans le localStorage
 * Basé sur le système Python existant.
 */

import { ConversationEntry } from '@/lib/storage/LocalStorage';
import { SummarizationAgent, ConversationMessage, SummaryResult } from './SummarizationAgent';

export interface UserSummary {
  id: string;
  userId: string;
  summary: string;
  originalMessages: ConversationMessage[];
  conversationData: ConversationEntry[];
  timestamp: string;
  metadata: {
    messageCount: number;
    summaryLength: number;
    compressionRatio: number;
    qualityScore: number;
  };
}

export interface SummaryStats {
  totalUsers: number;
  totalSummaries: number;
  users: {
    [userId: string]: {
      count: number;
      latest: string | null;
      totalMessages: number;
      averageCompressionRatio: number;
    };
  };
}

export class SummaryManager {
  private static readonly SUMMARIES_KEY = 'lr_tchatagent_user_summaries';
  private summarizationAgent: SummarizationAgent;

  constructor() {
    this.summarizationAgent = new SummarizationAgent();
    console.log('📁 SummaryManager initialisé');
  }

  /**
   * Sauvegarde un résumé pour un utilisateur
   */
  async saveSummary(
    user: string,
    messages: ConversationMessage[],
    conversationData: ConversationEntry[] = [],
    language: string = 'fr'
  ): Promise<UserSummary> {
    try {
      // Générer le résumé
      const summaryResult = await this.summarizationAgent.summarizeConversation(
        messages,
        user,
        language
      );

      // Créer l'entrée de résumé
      const userSummary: UserSummary = {
        id: `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: user,
        summary: summaryResult.summary,
        originalMessages: messages,
        conversationData,
        timestamp: new Date().toISOString(),
        metadata: {
          messageCount: messages.length,
          summaryLength: summaryResult.summary.length,
          compressionRatio: summaryResult.compressionRatio,
          qualityScore: summaryResult.qualityScore
        }
      };

      // Sauvegarder dans localStorage
      this.saveSummaryToStorage(userSummary);

      console.log(`💾 Résumé sauvegardé: ${userSummary.id}`);
      console.log(`   👤 Utilisateur: ${user}`);
      console.log(`   📊 Messages originaux: ${messages.length}`);
      console.log(`   📝 Taille résumé: ${summaryResult.summary.length} caractères`);
      console.log(`   📈 Ratio compression: ${(summaryResult.compressionRatio * 100).toFixed(1)}%`);

      return userSummary;
    } catch (error) {
      console.error('❌ Erreur sauvegarde résumé:', error);
      throw error;
    }
  }

  /**
   * Sauvegarde un résumé dans le localStorage
   */
  private saveSummaryToStorage(summary: UserSummary): void {
    try {
      const summaries = this.getAllSummaries();
      summaries.push(summary);
      localStorage.setItem(this.SUMMARIES_KEY, JSON.stringify(summaries));
    } catch (error) {
      console.error('❌ Erreur sauvegarde localStorage:', error);
    }
  }

  /**
   * Récupère tous les résumés
   */
  getAllSummaries(): UserSummary[] {
    try {
      const summaries = localStorage.getItem(this.SUMMARIES_KEY);
      return summaries ? JSON.parse(summaries) : [];
    } catch (error) {
      console.error('❌ Erreur lecture résumés:', error);
      return [];
    }
  }

  /**
   * Récupère tous les résumés d'un utilisateur
   */
  getUserSummaries(user: string): UserSummary[] {
    const allSummaries = this.getAllSummaries();
    return allSummaries
      .filter(summary => summary.userId === user)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Récupère le résumé le plus récent d'un utilisateur
   */
  getLatestSummary(user: string): UserSummary | null {
    const summaries = this.getUserSummaries(user);
    return summaries.length > 0 ? summaries[0] : null;
  }

  /**
   * Récupère les résumés d'un utilisateur dans une plage de temps
   */
  getUserSummariesInRange(
    user: string,
    startDate: Date,
    endDate: Date
  ): UserSummary[] {
    const summaries = this.getUserSummaries(user);
    return summaries.filter(summary => {
      const summaryDate = new Date(summary.timestamp);
      return summaryDate >= startDate && summaryDate <= endDate;
    });
  }

  /**
   * Génère un meta-résumé pour un utilisateur (avec cache)
   */
  async generateMetaSummary(
    user: string,
    language: string = 'fr'
  ): Promise<string> {
    const summaries = this.getUserSummaries(user);
    
    if (summaries.length === 0) {
      return `Aucune conversation précédente avec ${user}.`;
    }

    if (summaries.length === 1) {
      return summaries[0].summary;
    }

    // Vérifier si on a déjà un meta-résumé récent (moins de 1 heure)
    const existingMetaSummary = this.getCachedMetaSummary(user);
    if (existingMetaSummary) {
      console.log('📋 Meta-résumé récupéré depuis le cache');
      return existingMetaSummary;
    }

    // Extraire les résumés textuels
    const summaryTexts = summaries.map(s => s.summary);
    
    // Générer le meta-résumé
    const metaSummary = await this.summarizationAgent.metaSummarize(summaryTexts, user, language);
    
    // Mettre en cache
    this.cacheMetaSummary(user, metaSummary);
    
    return metaSummary;
  }

  /**
   * Récupère un meta-résumé mis en cache
   */
  private getCachedMetaSummary(user: string): string | null {
    try {
      const cacheKey = `meta_summary_${user}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        const now = Date.now();
        const oneHour = 60 * 60 * 1000; // 1 heure en millisecondes
        
        if (now - data.timestamp < oneHour) {
          return data.summary;
        } else {
          // Cache expiré, le supprimer
          localStorage.removeItem(cacheKey);
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lecture cache meta-résumé:', error);
    }
    return null;
  }

  /**
   * Met en cache un meta-résumé
   */
  private cacheMetaSummary(user: string, summary: string): void {
    try {
      const cacheKey = `meta_summary_${user}`;
      const data = {
        summary,
        timestamp: Date.now()
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
      console.log('💾 Meta-résumé mis en cache');
    } catch (error) {
      console.warn('⚠️ Erreur mise en cache meta-résumé:', error);
    }
  }

  /**
   * Charge la mémoire d'un utilisateur pour le chat
   */
  async loadUserMemory(user: string, language: string = 'fr'): Promise<{
    recentSummary: string | null;
    metaSummary: string | null;
    conversationCount: number;
    lastConversation: Date | null;
  }> {
    const summaries = this.getUserSummaries(user);
    
    if (summaries.length === 0) {
      return {
        recentSummary: null,
        metaSummary: null,
        conversationCount: 0,
        lastConversation: null
      };
    }

    const recentSummary = summaries[0].summary;
    const metaSummary = summaries.length > 1 
      ? await this.generateMetaSummary(user, language)
      : recentSummary;
    
    const lastConversation = new Date(summaries[0].timestamp);

    return {
      recentSummary,
      metaSummary,
      conversationCount: summaries.length,
      lastConversation
    };
  }

  /**
   * Obtient les statistiques des résumés
   */
  getSummaryStats(): SummaryStats {
    const allSummaries = this.getAllSummaries();
    const users: { [userId: string]: any } = {};

    // Grouper par utilisateur
    for (const summary of allSummaries) {
      if (!users[summary.userId]) {
        users[summary.userId] = {
          count: 0,
          latest: null,
          totalMessages: 0,
          compressionRatios: []
        };
      }

      users[summary.userId].count++;
      users[summary.userId].totalMessages += summary.metadata.messageCount;
      users[summary.userId].compressionRatios.push(summary.metadata.compressionRatio);

      // Garder le plus récent
      if (!users[summary.userId].latest || 
          new Date(summary.timestamp) > new Date(users[summary.userId].latest)) {
        users[summary.userId].latest = summary.timestamp;
      }
    }

    // Calculer les moyennes
    for (const userId in users) {
      const user = users[userId];
      user.averageCompressionRatio = user.compressionRatios.length > 0
        ? user.compressionRatios.reduce((a: number, b: number) => a + b, 0) / user.compressionRatios.length
        : 0;
      delete user.compressionRatios; // Nettoyer
    }

    return {
      totalUsers: Object.keys(users).length,
      totalSummaries: allSummaries.length,
      users
    };
  }

  /**
   * Supprime les résumés d'un utilisateur
   */
  deleteUserSummaries(user: string): number {
    const allSummaries = this.getAllSummaries();
    const filteredSummaries = allSummaries.filter(summary => summary.userId !== user);
    
    localStorage.setItem(this.SUMMARIES_KEY, JSON.stringify(filteredSummaries));
    
    const deletedCount = allSummaries.length - filteredSummaries.length;
    console.log(`🗑️ ${deletedCount} résumés supprimés pour ${user}`);
    
    return deletedCount;
  }

  /**
   * Supprime tous les résumés
   */
  clearAllSummaries(): void {
    localStorage.removeItem(this.SUMMARIES_KEY);
    console.log('🧹 Tous les résumés effacés');
  }

  /**
   * Exporte tous les résumés
   */
  exportSummaries(): string {
    const summaries = this.getAllSummaries();
    const exportData = {
      summaries,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Importe des résumés
   */
  importSummaries(jsonData: string): boolean {
    try {
      const importData = JSON.parse(jsonData);
      
      if (importData.summaries && Array.isArray(importData.summaries)) {
        localStorage.setItem(this.SUMMARIES_KEY, JSON.stringify(importData.summaries));
        console.log(`✅ ${importData.summaries.length} résumés importés`);
        return true;
      } else {
        console.error('❌ Format de données invalide');
        return false;
      }
    } catch (error) {
      console.error('❌ Erreur import résumés:', error);
      return false;
    }
  }

  /**
   * Nettoie les résumés anciens (plus de X jours)
   */
  cleanupOldSummaries(daysOld: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const allSummaries = this.getAllSummaries();
    const filteredSummaries = allSummaries.filter(summary => 
      new Date(summary.timestamp) > cutoffDate
    );
    
    localStorage.setItem(this.SUMMARIES_KEY, JSON.stringify(filteredSummaries));
    
    const deletedCount = allSummaries.length - filteredSummaries.length;
    console.log(`🧹 ${deletedCount} résumés anciens supprimés (>${daysOld} jours)`);
    
    return deletedCount;
  }
}