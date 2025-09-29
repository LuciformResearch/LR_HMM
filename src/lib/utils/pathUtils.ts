/**
 * Utilitaires pour la gestion des chemins dans le Terminal Algareth
 */

/**
 * Normalise un chemin en supprimant les .. et . redondants
 */
export const normalizePath = (basePath: string, relativePath: string): string => {
  // Si le chemin commence par /, c'est un chemin absolu
  if (relativePath.startsWith('/')) {
    // S'assurer qu'on reste dans /workspace
    const workspacePath = '/workspace';
    if (!relativePath.startsWith(workspacePath)) {
      return workspacePath;
    }
    return relativePath;
  }
  
  // Construire le chemin complet
  const fullPath = basePath.endsWith('/') 
    ? `${basePath}${relativePath}`
    : `${basePath}/${relativePath}`;
  
  // Normaliser le chemin (supprimer les .. et .)
  const parts = fullPath.split('/').filter(part => part !== '');
  const normalizedParts: string[] = [];
  
  for (const part of parts) {
    if (part === '.') {
      // Ignorer les . (répertoire courant)
      continue;
    } else if (part === '..') {
      // Remonter d'un niveau, mais pas au-delà de /workspace
      if (normalizedParts.length > 1) { // Garder au moins 'workspace'
        normalizedParts.pop();
      }
    } else if (part.includes('..') || part.includes('...')) {
      // Rejeter les chemins invalides comme "..." ou "..something"
      return workspacePath; // Retourner au workspace racine
    } else {
      // Ajouter le répertoire/fichier
      normalizedParts.push(part);
    }
  }
  
  // Reconstruire le chemin
  const normalized = '/' + normalizedParts.join('/');
  
  // S'assurer qu'on reste dans /workspace
  const workspacePath = '/workspace';
  if (!normalized.startsWith(workspacePath)) {
    return workspacePath;
  }
  
  return normalized;
};

/**
 * Valide qu'un chemin est autorisé (dans le workspace)
 */
export const validatePath = (path: string): boolean => {
  return path.startsWith('/workspace') && !path.includes('..');
};

/**
 * Formate la taille d'un fichier de manière lisible
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
};

/**
 * Formate une date de manière lisible
 */
export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return date.toLocaleTimeString();
  } else if (diffDays === 1) {
    return 'Hier';
  } else if (diffDays < 7) {
    return `${diffDays}j`;
  } else {
    return date.toLocaleDateString();
  }
};