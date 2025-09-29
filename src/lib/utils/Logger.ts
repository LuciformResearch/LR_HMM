/**
 * Configuration de logging pour LR_TchatAgent Web
 * Centralise la configuration des logs pour l'environnement web
 * Migration depuis logging_config.py
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface LoggerConfig {
  logLevel?: LogLevel;
  logFile?: string;
  logDir?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  name: string;
  message: string;
  data?: any;
}

/**
 * Logger simple pour l'environnement web
 */
export class Logger {
  private name: string;
  private level: LogLevel;
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;

  constructor(name: string, level: LogLevel = 'INFO') {
    this.name = name;
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      'DEBUG': 0,
      'INFO': 1,
      'WARNING': 2,
      'ERROR': 3
    };
    
    return levels[level] >= levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `${timestamp} - ${this.name} - ${level} - ${message}${dataStr}`;
  }

  private addLog(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      name: this.name,
      message,
      data
    };

    this.logs.push(logEntry);
    
    // Limiter la taille des logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Afficher dans la console
    const formattedMessage = this.formatMessage(level, message, data);
    
    switch (level) {
      case 'DEBUG':
        console.debug(formattedMessage);
        break;
      case 'INFO':
        console.info(formattedMessage);
        break;
      case 'WARNING':
        console.warn(formattedMessage);
        break;
      case 'ERROR':
        console.error(formattedMessage);
        break;
    }
  }

  debug(message: string, data?: any): void {
    this.addLog('DEBUG', message, data);
  }

  info(message: string, data?: any): void {
    this.addLog('INFO', message, data);
  }

  warning(message: string, data?: any): void {
    this.addLog('WARNING', message, data);
  }

  error(message: string, data?: any): void {
    this.addLog('ERROR', message, data);
  }

  /**
   * Récupère les logs récents
   */
  getLogs(limit?: number): LogEntry[] {
    if (limit) {
      return this.logs.slice(-limit);
    }
    return [...this.logs];
  }

  /**
   * Efface les logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Exporte les logs en JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Change le niveau de log
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

/**
 * Gestionnaire global des loggers
 */
class LoggerManager {
  private loggers: Map<string, Logger> = new Map();
  private globalLevel: LogLevel = 'INFO';

  /**
   * Récupère ou crée un logger
   */
  getLogger(name: string, level?: LogLevel): Logger {
    if (!this.loggers.has(name)) {
      this.loggers.set(name, new Logger(name, level || this.globalLevel));
    }
    return this.loggers.get(name)!;
  }

  /**
   * Change le niveau global de log
   */
  setGlobalLevel(level: LogLevel): void {
    this.globalLevel = level;
    for (const logger of this.loggers.values()) {
      logger.setLevel(level);
    }
  }

  /**
   * Récupère tous les loggers
   */
  getAllLoggers(): Logger[] {
    return Array.from(this.loggers.values());
  }

  /**
   * Efface tous les logs
   */
  clearAllLogs(): void {
    for (const logger of this.loggers.values()) {
      logger.clearLogs();
    }
  }

  /**
   * Exporte tous les logs
   */
  exportAllLogs(): Record<string, LogEntry[]> {
    const result: Record<string, LogEntry[]> = {};
    for (const [name, logger] of this.loggers.entries()) {
      result[name] = logger.getLogs();
    }
    return result;
  }
}

// Instance globale du gestionnaire de loggers
const loggerManager = new LoggerManager();

/**
 * Configure le logging pour LR_TchatAgent Web
 */
export function setupLogging(config: LoggerConfig = {}): Logger {
  const { logLevel = 'INFO' } = config;
  
  loggerManager.setGlobalLevel(logLevel);
  
  const logger = loggerManager.getLogger('LR_TchatAgent', logLevel);
  logger.info(`Logging configuré - Niveau: ${logLevel}`);
  
  return logger;
}

/**
 * Récupère un logger configuré
 */
export function getLogger(name?: string): Logger {
  if (name) {
    return loggerManager.getLogger(`LR_TchatAgent.${name}`);
  }
  return loggerManager.getLogger('LR_TchatAgent');
}

/**
 * Récupère le gestionnaire de loggers
 */
export function getLoggerManager(): LoggerManager {
  return loggerManager;
}

/**
 * Configuration automatique au chargement du module
 */
if (typeof window !== 'undefined') {
  // Configuration automatique en environnement web
  setupLogging({ logLevel: 'INFO' });
}