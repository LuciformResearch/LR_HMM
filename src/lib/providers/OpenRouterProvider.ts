/**
 * Provider OpenRouter pour LR_TchatAgent Web
 * Support multi-modèle via OpenRouter API
 */

import { HttpResponse } from '@/lib/types/Provider';

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type: string;
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeout: number;
}

/**
 * Provider OpenRouter pour les appels LLM
 */
export class OpenRouterProvider {
  private apiKey: string;
  private baseUrl: string = 'https://openrouter.ai/api/v1';
  private model: string;
  private timeout: number;

  constructor(config: Partial<OpenRouterConfig> = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'google/gemini-flash-1.5';
    this.timeout = config.timeout || 30;
  }

  /**
   * Vérifie si le provider est disponible
   */
  isAvailable(): boolean {
    return !!this.apiKey && this.apiKey.length > 10;
  }

  /**
   * Génère une réponse via OpenRouter
   */
  async generateResponse(prompt: string, maxTokens: number = 2000): Promise<HttpResponse> {
    if (!this.isAvailable()) {
      return {
        content: '❌ Clé API OpenRouter manquante ou invalide',
        error: true
      };
    }

    try {
      const url = `${this.baseUrl}/chat/completions`;
      
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'LR_TchatAgent Web'
      };

      const payload = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
        top_p: 0.8
      };

      console.log('🌐 Appel OpenRouter:', url);
      console.log('📤 Model:', this.model);
      console.log('📤 Payload:', JSON.stringify(payload, null, 2));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('📥 Status:', response.status);
      console.log('📥 Headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || 'Pas de réponse';
        
        console.log('✅ Réponse OpenRouter:', content.slice(0, 100) + '...');
        
        return {
          content,
          error: false,
          metadata: {
            model: data.model,
            usage: data.usage,
            provider: 'openrouter'
          }
        };
      } else {
        const errorText = await response.text();
        const errorMsg = `Erreur OpenRouter ${response.status}: ${errorText}`;
        console.error('❌', errorMsg);
        
        return {
          content: errorMsg,
          error: true
        };
      }
    } catch (error) {
      let errorMsg: string;
      if (error instanceof Error && error.name === 'AbortError') {
        errorMsg = 'Timeout OpenRouter';
      } else {
        errorMsg = `Erreur OpenRouter: ${error}`;
      }
      
      console.error('❌', errorMsg);
      return {
        content: errorMsg,
        error: true
      };
    }
  }

  /**
   * Récupère la liste des modèles disponibles
   */
  async getAvailableModels(): Promise<OpenRouterModel[]> {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        return data.data || [];
      }
    } catch (error) {
      console.error('Erreur récupération modèles:', error);
    }

    return [];
  }

  /**
   * Teste la connexion OpenRouter
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateResponse('Test de connexion', 10);
      return !response.error;
    } catch {
      return false;
    }
  }

  /**
   * Met à jour la clé API
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Met à jour le modèle
   */
  setModel(model: string): void {
    this.model = model;
  }
}

/**
 * Factory pour créer des providers OpenRouter
 */
export class OpenRouterProviderFactory {
  /**
   * Crée un provider OpenRouter
   */
  static createProvider(apiKey: string, model?: string): OpenRouterProvider {
    return new OpenRouterProvider({
      apiKey,
      model: model || 'google/gemini-flash-1.5'
    });
  }

  /**
   * Crée un provider depuis les paramètres stockés
   */
  static createFromStorage(): OpenRouterProvider {
    const saved = localStorage.getItem('lr_tchatagent_api_keys');
    if (saved) {
      try {
        const keys = JSON.parse(saved);
        return new OpenRouterProvider({
          apiKey: keys.openrouter || '',
          model: 'google/gemini-flash-1.5'
        });
      } catch (error) {
        console.error('Erreur chargement clés API:', error);
      }
    }
    
    return new OpenRouterProvider();
  }
}