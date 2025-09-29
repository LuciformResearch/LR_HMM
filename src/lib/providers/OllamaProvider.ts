/**
 * Provider Ollama pour LLM local
 * Utilise Ollama comme alternative locale à Gemini pour le debug
 */

import { HttpResponse } from '@/lib/types/Provider';

export interface OllamaProviderConfig {
  baseUrl?: string;
  model: string;
  timeout?: number;
  debugMode?: boolean;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Provider Ollama pour les LLM locaux
 */
export class OllamaProvider {
  private config: OllamaProviderConfig;
  private baseUrl: string;
  private debugMode: boolean;

  constructor(config: OllamaProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.debugMode = config.debugMode || false;
  }

  /**
   * Vérifie si Ollama est disponible
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout || 5000)
      });
      return response.ok;
    } catch (error) {
      console.warn('⚠️ Ollama non disponible:', error);
      return false;
    }
  }

  /**
   * Liste les modèles disponibles
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error('❌ Erreur liste modèles Ollama:', error);
      return [];
    }
  }

  /**
   * Génère une réponse via Ollama
   */
  async generateResponse(prompt: string, maxTokens: number = 2000): Promise<HttpResponse> {
    try {
      const request: OllamaGenerateRequest = {
        model: this.config.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.8,
          max_tokens: maxTokens
        }
      };

      console.log('🦙 Appel Ollama:', `${this.baseUrl}/api/generate`);
      console.log('📤 Model:', this.config.model);

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.timeout || 30000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data: OllamaGenerateResponse = await response.json();
      const content = data.response || 'Pas de réponse';

      // Afficher la réponse complète en mode debug, tronquée sinon
      if (this.debugMode) {
        console.log('✅ Réponse Ollama (debug):', content);
      } else {
        console.log('✅ Réponse Ollama:', content.slice(0, 100) + '...');
      }

      return {
        content,
        error: false,
        metadata: {
          model: this.config.model,
          provider: 'ollama',
          duration: data.total_duration,
          tokens: data.eval_count
        }
      };

    } catch (error) {
      console.error('❌ Erreur Ollama:', error);
      return {
        content: `❌ Erreur Ollama: ${error}`,
        error: true,
        metadata: {
          model: this.config.model,
          provider: 'ollama'
        }
      };
    }
  }

  /**
   * Teste la connectivité avec Ollama
   */
  async testConnection(): Promise<{ success: boolean; message: string; models?: string[] }> {
    try {
      const available = await this.isAvailable();
      if (!available) {
        return {
          success: false,
          message: 'Ollama non disponible - vérifiez que le service est démarré'
        };
      }

      const models = await this.listModels();
      const hasModel = models.includes(this.config.model);

      if (!hasModel) {
        return {
          success: false,
          message: `Modèle ${this.config.model} non trouvé. Modèles disponibles: ${models.join(', ')}`,
          models
        };
      }

      // Test rapide
      const testResponse = await this.generateResponse('Hello', 10);
      
      return {
        success: !testResponse.error,
        message: testResponse.error ? `Erreur test: ${testResponse.content}` : 'Ollama fonctionne correctement',
        models
      };

    } catch (error) {
      return {
        success: false,
        message: `Erreur test Ollama: ${error}`
      };
    }
  }
}

/**
 * Instance par défaut d'Ollama
 */
export const ollamaProvider = new OllamaProvider({
  model: 'qwen2.5:7b-instruct',
  timeout: 30000,
  debugMode: false
});