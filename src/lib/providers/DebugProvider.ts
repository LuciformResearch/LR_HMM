/**
 * Provider de debug qui utilise Ollama au lieu de Gemini
 * Permet de tester sans consommer le quota Gemini
 */

import { UnifiedProvider } from './UnifiedProvider';

export interface DebugProviderConfig {
  fallbackToGemini?: boolean;
  ollamaModel?: string;
  ollamaTimeout?: number;
}

/**
 * Provider de debug qui utilise Ollama en priorité
 */
export class DebugProvider {
  private config: DebugProviderConfig;
  private ollamaProvider: UnifiedProvider;
  private geminiProvider?: UnifiedProvider;

  constructor(config: DebugProviderConfig = {}) {
    this.config = {
      fallbackToGemini: config.fallbackToGemini ?? true,
      ollamaModel: config.ollamaModel ?? 'qwen2.5:7b-instruct',
      ollamaTimeout: config.ollamaTimeout ?? 30000
    };

    // Provider Ollama (priorité)
    this.ollamaProvider = new UnifiedProvider({
      type: 'ollama',
      provider: 'ollama',
      model: this.config.ollamaModel!,
      customConfig: {
        timeout: this.config.ollamaTimeout
      }
    });
  }

  /**
   * Configure le provider Gemini comme fallback
   */
  setGeminiFallback(geminiApiKey: string): void {
    this.geminiProvider = new UnifiedProvider({
      type: 'custom',
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      apiKey: geminiApiKey
    });
  }

  /**
   * Génère une réponse en utilisant Ollama en priorité, Gemini en fallback
   */
  async generateResponse(prompt: string, maxTokens: number = 2000): Promise<{
    content: string;
    error: boolean;
    provider: 'ollama' | 'gemini' | 'fallback';
    metadata?: any;
  }> {
    try {
      // Essayer Ollama en premier
      console.log('🦙 Tentative avec Ollama...');
      const ollamaResponse = await this.ollamaProvider.generateResponse(prompt, maxTokens);
      
      if (!ollamaResponse.error) {
        console.log('✅ Réponse Ollama réussie');
        return {
          content: ollamaResponse.content,
          error: false,
          provider: 'ollama',
          metadata: ollamaResponse.metadata
        };
      }

      console.log('⚠️ Ollama échoué, tentative fallback...');

      // Fallback vers Gemini si configuré
      if (this.config.fallbackToGemini && this.geminiProvider) {
        console.log('🔑 Tentative avec Gemini...');
        const geminiResponse = await this.geminiProvider.generateResponse(prompt, maxTokens);
        
        if (!geminiResponse.error) {
          console.log('✅ Réponse Gemini réussie');
          return {
            content: geminiResponse.content,
            error: false,
            provider: 'gemini',
            metadata: geminiResponse.metadata
          };
        }
      }

      // Fallback final
      console.log('⚠️ Tous les providers ont échoué, utilisation du fallback');
      return {
        content: this.generateFallbackResponse(prompt),
        error: false,
        provider: 'fallback'
      };

    } catch (error) {
      console.error('❌ Erreur DebugProvider:', error);
      return {
        content: `❌ Erreur: ${error}`,
        error: true,
        provider: 'fallback'
      };
    }
  }

  /**
   * Génère une réponse de fallback simple
   */
  private generateFallbackResponse(prompt: string): string {
    // Réponse de fallback basique selon le contexte
    if (prompt.toLowerCase().includes('image') || prompt.toLowerCase().includes('créer') || prompt.toLowerCase().includes('générer')) {
      return `Je comprends que vous souhaitez créer une image. Malheureusement, les services de génération d'images ne sont pas disponibles pour le moment. Veuillez réessayer plus tard.`;
    }
    
    if (prompt.toLowerCase().includes('analyse') || prompt.toLowerCase().includes('décide')) {
      return `Analyse: Le message semble être une demande d'analyse. Type détecté: text. Actions recommandées: générer une réponse textuelle.`;
    }

    return `Je comprends votre demande. Malheureusement, je ne peux pas traiter cette requête pour le moment. Veuillez réessayer plus tard.`;
  }

  /**
   * Teste la disponibilité des providers
   */
  async testProviders(): Promise<{
    ollama: boolean;
    gemini: boolean;
    message: string;
  }> {
    const results = {
      ollama: false,
      gemini: false,
      message: ''
    };

    try {
      // Test Ollama
      const ollamaResponse = await this.ollamaProvider.generateResponse('test', 10);
      results.ollama = !ollamaResponse.error;
    } catch (error) {
      results.ollama = false;
    }

    // Test Gemini si configuré
    if (this.geminiProvider) {
      try {
        const geminiResponse = await this.geminiProvider.generateResponse('test', 10);
        results.gemini = !geminiResponse.error;
      } catch (error) {
        results.gemini = false;
      }
    }

    // Message de statut
    if (results.ollama) {
      results.message = 'Ollama disponible - mode debug actif';
    } else if (results.gemini) {
      results.message = 'Ollama indisponible, utilisation de Gemini';
    } else {
      results.message = 'Aucun provider disponible - mode fallback';
    }

    return results;
  }
}

/**
 * Instance par défaut du provider de debug
 */
export const debugProvider = new DebugProvider();