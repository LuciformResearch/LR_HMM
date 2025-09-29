/**
 * Utilitaire pour faire des appels API authentifiés
 */

import { clientAuthService } from '@/lib/auth/client-auth-service';

/**
 * Effectue un appel fetch avec le token d'authentification automatiquement ajouté
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = clientAuthService.getToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Effectue un appel GET authentifié
 */
export async function authenticatedGet(url: string, options: RequestInit = {}): Promise<Response> {
  return authenticatedFetch(url, {
    ...options,
    method: 'GET',
  });
}

/**
 * Effectue un appel POST authentifié
 */
export async function authenticatedPost(url: string, data?: any, options: RequestInit = {}): Promise<Response> {
  return authenticatedFetch(url, {
    ...options,
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Effectue un appel PUT authentifié
 */
export async function authenticatedPut(url: string, data?: any, options: RequestInit = {}): Promise<Response> {
  return authenticatedFetch(url, {
    ...options,
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Effectue un appel DELETE authentifié
 */
export async function authenticatedDelete(url: string, options: RequestInit = {}): Promise<Response> {
  return authenticatedFetch(url, {
    ...options,
    method: 'DELETE',
  });
}