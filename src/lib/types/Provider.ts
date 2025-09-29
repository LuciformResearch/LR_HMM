/**
 * Types pour les providers HTTP
 */

export type ProviderType = 'local' | 'gemini' | 'openai' | 'anthropic';

export interface HttpResponse {
  content: string;
  error: boolean;
  metadata?: Record<string, any>;
}

export interface HttpProvider {
  providerType: ProviderType;
  model: string;
  timeout: number;
  generateResponse(prompt: string, maxTokens: number): Promise<HttpResponse>;
  isAvailable(): boolean;
}

export interface ProviderConfig {
  providerType: ProviderType;
  model?: string;
  timeout?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface OllamaConfig {
  host: string;
  model: string;
  timeout: number;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  timeout: number;
  baseUrl: string;
}