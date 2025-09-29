/**
 * Système de logs centralisé pour le Terminal Algareth
 * Fournit des loggers spécialisés pour chaque composant
 */

import { getLogger } from './Logger';

// Loggers spécialisés pour chaque composant
export const terminalLogger = getLogger('terminal');
export const filesystemLogger = getLogger('filesystem');
export const apiLogger = getLogger('api');
export const commandLogger = getLogger('commands');

/**
 * Log une commande exécutée dans le terminal
 */
export const logCommand = (command: string, args: string[], currentPath: string) => {
  commandLogger.info('Command executed', { 
    command, 
    args, 
    currentPath,
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server'
  });
};

/**
 * Log le résultat d'une commande
 */
export const logCommandResult = (command: string, success: boolean, result?: any, error?: string) => {
  if (success) {
    commandLogger.info('Command completed successfully', { 
      command, 
      result: typeof result === 'object' ? JSON.stringify(result) : result,
      timestamp: new Date().toISOString()
    });
  } else {
    commandLogger.error('Command failed', { 
      command, 
      error: error || 'Unknown error',
      result: typeof result === 'object' ? JSON.stringify(result) : result,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Log une requête API filesystem
 */
export const logApiRequest = (endpoint: string, path: string, method: string = 'POST') => {
  apiLogger.info('API request started', { 
    endpoint, 
    path, 
    method,
    timestamp: new Date().toISOString()
  });
};

/**
 * Log le résultat d'une requête API
 */
export const logApiResponse = (
  endpoint: string, 
  path: string, 
  success: boolean, 
  duration: number, 
  result?: any, 
  error?: string
) => {
  if (success) {
    apiLogger.info('API request completed', { 
      endpoint, 
      path, 
      duration: `${duration}ms`,
      result: typeof result === 'object' ? JSON.stringify(result) : result,
      timestamp: new Date().toISOString()
    });
  } else {
    apiLogger.error('API request failed', { 
      endpoint, 
      path, 
      duration: `${duration}ms`,
      error: error || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Log une opération filesystem
 */
export const logFilesystemOperation = (
  operation: string, 
  path: string, 
  success: boolean, 
  details?: any
) => {
  if (success) {
    filesystemLogger.info('Filesystem operation completed', { 
      operation, 
      path, 
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      timestamp: new Date().toISOString()
    });
  } else {
    filesystemLogger.error('Filesystem operation failed', { 
      operation, 
      path, 
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Log une erreur de terminal
 */
export const logTerminalError = (error: string, context?: any) => {
  terminalLogger.error('Terminal error', { 
    error, 
    context: typeof context === 'object' ? JSON.stringify(context) : context,
    timestamp: new Date().toISOString()
  });
};

/**
 * Log une action utilisateur
 */
export const logUserAction = (action: string, details?: any) => {
  terminalLogger.info('User action', { 
    action, 
    details: typeof details === 'object' ? JSON.stringify(details) : details,
    timestamp: new Date().toISOString()
  });
};

/**
 * Log une session de terminal
 */
export const logTerminalSession = (action: 'start' | 'end', sessionId?: string) => {
  if (action === 'start') {
    terminalLogger.info('Terminal session started', { 
      sessionId: sessionId || `session_${Date.now()}`,
      timestamp: new Date().toISOString()
    });
  } else {
    terminalLogger.info('Terminal session ended', { 
      sessionId: sessionId || 'unknown',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Log une performance
 */
export const logPerformance = (operation: string, duration: number, details?: any) => {
  const level = duration > 1000 ? 'warning' : 'info';
  terminalLogger[level]('Performance metric', { 
    operation, 
    duration: `${duration}ms`,
    details: typeof details === 'object' ? JSON.stringify(details) : details,
    timestamp: new Date().toISOString()
  });
};

/**
 * Configuration des niveaux de log pour le terminal
 */
export const configureTerminalLogging = (level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' = 'INFO') => {
  terminalLogger.setLevel(level);
  filesystemLogger.setLevel(level);
  apiLogger.setLevel(level);
  commandLogger.setLevel(level);
  
  terminalLogger.info('Terminal logging configured', { 
    level, 
    timestamp: new Date().toISOString() 
  });
};

/**
 * Export des logs pour debugging
 */
export const exportTerminalLogs = () => {
  return {
    terminal: terminalLogger.exportLogs(),
    filesystem: filesystemLogger.exportLogs(),
    api: apiLogger.exportLogs(),
    commands: commandLogger.exportLogs(),
    timestamp: new Date().toISOString()
  };
};