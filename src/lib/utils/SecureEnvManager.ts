/**
 * SecureEnvManager pour LR_TchatAgent Web
 * Gestionnaire d'environnement sécurisé pour le MVP de chat
 * Migration depuis secure_env_manager.py
 */

import { JsonLike, ApiKeyInfo, SecureEnvConfig } from '@/lib/types/Common';
import { getNodeModules } from '@/lib/utils/web-mocks';

const { fs, path, os } = getNodeModules();

/**
 * Supprime les commentaires inline commençant par #, pas à l'intérieur des guillemets
 */
function stripInlineComment(val: string): string {
  const s = val.trim();
  const out: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out.push(ch);
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out.push(ch);
    } else if (ch === '#' && !inSingle && !inDouble) {
      break;
    } else {
      out.push(ch);
    }
    i++;
  }
  
  return out.join('').trim();
}

/**
 * Parse une ligne en paire clé=valeur
 */
function parseLine(raw: string): [string, string] | null {
  const line = raw.trim();
  if (!line || line.startsWith('#') || !line.includes('=')) {
    return null;
  }
  
  const [key, val] = line.split('=', 2);
  const cleanKey = key.trim();
  const cleanVal = stripInlineComment(val).trim();
  
  // Supprimer les guillemets entourants
  if ((cleanVal.startsWith("'") && cleanVal.endsWith("'")) || 
      (cleanVal.startsWith('"') && cleanVal.endsWith('"'))) {
    return [cleanKey, cleanVal.slice(1, -1)];
  }
  
  return [cleanKey, cleanVal];
}

/**
 * Parse un fichier d'environnement en dictionnaire clé=valeur
 */
function parseFile(content: string): Record<string, string> {
  const data: Record<string, string> = {};
  
  for (const raw of content.split('\n')) {
    const kv = parseLine(raw);
    if (!kv) continue;
    
    const [k, v] = kv;
    if (k && !(k in data)) {
      data[k] = v;
    }
  }
  
  return data;
}

/**
 * Convertit une chaîne en booléen
 */
function asBool(v: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

/**
 * Convertit une chaîne en entier
 */
function asInt(v: string): number | null {
  try {
    return parseInt(v.trim(), 10);
  } catch {
    return null;
  }
}

/**
 * Convertit une chaîne en float
 */
function asFloat(v: string): number | null {
  try {
    return parseFloat(v.trim());
  } catch {
    return null;
  }
}

/**
 * Convertit une chaîne en JSON
 */
function asJson(v: string): JsonLike | null {
  const s = v.trim();
  if (!s) return null;
  
  if (!((s.startsWith('[') && s.endsWith(']')) || 
        (s.startsWith('{') && s.endsWith('}')))) {
    return null;
  }
  
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Normalise la configuration des clés Gemini
 */
function augmentGeminiKeys(envVars: Record<string, string>): void {
  try {
    const primary = envVars['GEMINI_API_KEY'];
    let cfgObj: any = null;
    const rawCfg = envVars['GEMINI_CONFIG'];
    
    if (rawCfg) {
      try {
        cfgObj = JSON.parse(rawCfg);
      } catch {
        cfgObj = null;
      }
    }
    
    const keysList: string[] = [];
    const rawList = envVars['GEMINI_API_KEYS'];
    
    if (rawList) {
      try {
        const parsed = JSON.parse(rawList);
        if (Array.isArray(parsed)) {
          keysList.push(...parsed.filter(k => k).map(k => String(k)));
        }
      } catch {
        // Ignore parsing errors
      }
    }
    
    const ordered: string[] = [];
    const add = (k: string | undefined) => {
      if (k && !ordered.includes(k)) {
        ordered.push(k);
      }
    };
    
    add(primary);
    keysList.forEach(add);
    
    if (ordered.length > 0) {
      envVars['GEMINI_API_KEYS'] = JSON.stringify(ordered);
      const cfg = cfgObj && typeof cfgObj === 'object' ? cfgObj : {};
      const cfgKeys = Array.from(new Set([...(cfg.api_keys || []), ...ordered]));
      cfg.api_keys = cfgKeys;
      cfg.strategy = cfg.strategy || 'round_robin';
      envVars['GEMINI_CONFIG'] = JSON.stringify(cfg);
      envVars['GEMINI_API_KEY'] = ordered[0];
      
      ordered.forEach((k, i) => {
        envVars[`GEMINI_API_KEY_${i}`] = k;
      });
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Chargeur d'environnement sécurisé pour LR_TchatAgent Web
 */
export class SecureEnvLoader {
  private projectPaths: string[];
  private userFile?: string;

  constructor(config?: SecureEnvConfig) {
    const defaults = [
      '.env.local',
      '.env',
      'config/env.local',
      'config/env',
    ];
    
    this.projectPaths = config?.projectPaths || defaults;
    this.userFile = config?.userFile;
  }

  /**
   * Charge l'environnement dans process.env depuis les fichiers projet et optionnellement utilisateur.
   * Priorité: process.env (sauf si override) < fichiers projet < fichier utilisateur (si allowHome).
   * Retourne le dictionnaire des clés appliquées.
   */
  load(options: { override?: boolean; allowHome?: boolean } = {}): Record<string, string> {
    const { override = false, allowHome = true } = options;
    const applied: Record<string, string> = {};
    const collected: Record<string, string> = {};
    
    // Niveau projet d'abord
    for (const p of this.projectPaths) {
      try {
        // En environnement web, on ne peut pas lire les fichiers directement
        // On utilise les variables d'environnement Next.js
        const envContent = this.getEnvContent(p);
        if (envContent) {
          Object.assign(collected, parseFile(envContent));
        }
      } catch {
        // Ignore file read errors
      }
    }
    
    // Niveau utilisateur
    if (allowHome && this.userFile) {
      try {
        const envContent = this.getEnvContent(this.userFile);
        if (envContent) {
          Object.assign(collected, parseFile(envContent));
        }
      } catch {
        // Ignore file read errors
      }
    }

    // Normaliser les clés Gemini si présentes
    augmentGeminiKeys(collected);

    for (const [k, v] of Object.entries(collected)) {
      if (override || !(k in process.env)) {
        process.env[k] = v;
        applied[k] = v;
      }
    }
    
    return applied;
  }

  /**
   * Retourne la carte de présence et aperçus masqués pour les clés spécifiées.
   */
  exportPresenceMap(keys: string[]): Record<string, ApiKeyInfo> {
    const out: Record<string, ApiKeyInfo> = {};
    
    for (const k of keys) {
      const val = process.env[k];
      if (val === undefined) {
        out[k] = { present: false, preview: 'absent' };
      } else {
        const preview = val.length >= 10 ? `${val.slice(0, 4)}...${val.slice(-3)}` : 'set';
        out[k] = { present: true, preview };
      }
    }
    
    return out;
  }

  /**
   * Récupère une valeur JSON depuis l'environnement
   */
  getJson(key: string): JsonLike | null {
    const v = process.env[key];
    return v ? asJson(v) : null;
  }

  /**
   * Récupère une valeur booléenne depuis l'environnement
   */
  getBool(key: string): boolean | null {
    const v = process.env[key];
    return v ? asBool(v) : null;
  }

  /**
   * Récupère une valeur entière depuis l'environnement
   */
  getInt(key: string): number | null {
    const v = process.env[key];
    return v ? asInt(v) : null;
  }

  /**
   * Récupère une valeur float depuis l'environnement
   */
  getFloat(key: string): number | null {
    const v = process.env[key];
    return v ? asFloat(v) : null;
  }

  /**
   * Récupère le contenu d'un fichier d'environnement
   * En environnement Node.js, on peut lire les fichiers directement
   */
  private getEnvContent(filePath: string): string | null {
    try {
      // Expansion du tilde pour le home directory
      const expandedPath = filePath.startsWith('~') 
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;
      
      if (fs.existsSync(expandedPath)) {
        return fs.readFileSync(expandedPath, 'utf8');
      }
    } catch (error) {
      // Ignore file read errors
    }
    return null;
  }
}

/**
 * Fonctions de commodité
 */

/**
 * Charge l'environnement du projet
 */
export function loadProjectEnvironment(options: { override?: boolean; allowHome?: boolean } = {}): Record<string, string> {
  const loader = new SecureEnvLoader();
  return loader.load(options);
}

/**
 * Charge spécifiquement le fichier ~/.shadeos_env
 */
export function loadShadeosEnv(options: { override?: boolean } = {}): Record<string, string> {
  const { override = false } = options;
  const applied: Record<string, string> = {};
  
  try {
    const shadeosPath = path.join(os.homedir(), '.shadeos_env');
    if (fs.existsSync(shadeosPath)) {
      const content = fs.readFileSync(shadeosPath, 'utf8');
      const parsed = parseFile(content);
      
      // Normaliser les clés Gemini si présentes
      augmentGeminiKeys(parsed);
      
      for (const [k, v] of Object.entries(parsed)) {
        if (override || !(k in process.env)) {
          process.env[k] = v;
          applied[k] = v;
        }
      }
      
      console.log(`✅ ~/.shadeos_env chargé: ${Object.keys(applied).length} variables`);
    } else {
      console.log('⚠️  ~/.shadeos_env non trouvé');
    }
  } catch (error) {
    console.error('❌ Erreur lors du chargement de ~/.shadeos_env:', error);
  }
  
  return applied;
}

/**
 * Récupère la clé API pour un provider spécifique
 */
export function getApiKey(provider: string): string | null {
  const keyMap: Record<string, string> = {
    'gemini': 'GEMINI_API_KEY',
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'claude': 'CLAUDE_API_KEY'
  };
  
  const keyName = keyMap[provider.toLowerCase()];
  if (!keyName) return null;
  
  const key = process.env[keyName];
  if (!key) return null;
  
  // Vérifier si c'est un placeholder
  const placeholderPatterns = [
    'your_', 'your-', 'example_', 'example-', 'placeholder', 
    'replace_', 'replace-', 'api_key_here', 'key_here'
  ];
  
  const keyLower = key.toLowerCase();
  const isPlaceholder = placeholderPatterns.some(pattern => keyLower.includes(pattern));
  
  return isPlaceholder ? null : key;
}

/**
 * Vérifie la présence des clés API sans révéler les valeurs
 */
export function checkApiKeys(): Record<string, ApiKeyInfo> {
  const providers = ['gemini', 'openai', 'anthropic', 'claude'];
  const result: Record<string, ApiKeyInfo> = {};
  
  // Clés placeholder à ignorer
  const placeholderPatterns = [
    'your_', 'your-', 'example_', 'example-', 'placeholder', 
    'replace_', 'replace-', 'api_key_here', 'key_here'
  ];
  
  for (const provider of providers) {
    const key = getApiKey(provider);
    if (key) {
      // Vérifier si c'est un placeholder
      const keyLower = key.toLowerCase();
      const isPlaceholder = placeholderPatterns.some(pattern => keyLower.includes(pattern));
      
      if (isPlaceholder) {
        result[provider] = { present: false, preview: 'placeholder' };
      } else {
        const preview = key.length >= 10 ? `${key.slice(0, 4)}...${key.slice(-3)}` : 'set';
        result[provider] = { present: true, preview };
      }
    } else {
      result[provider] = { present: false, preview: 'absent' };
    }
  }
  
  return result;
}

/**
 * Test standalone pour le navigateur
 */
export function testSecureEnvManager(): void {
  console.log('🔍 Test SecureEnvManager Web');
  
  // Test loading
  const applied = loadProjectEnvironment();
  console.log(`✅ Environnement chargé: ${Object.keys(applied).length} variables`);
  
  // Test API keys
  const apiKeys = checkApiKeys();
  console.log('\n🔑 Clés API:');
  for (const [provider, info] of Object.entries(apiKeys)) {
    if (info.present) {
      console.log(`✅ ${provider}: ${info.preview}`);
    } else {
      console.log(`❌ ${provider}: ${info.preview}`);
    }
  }
}