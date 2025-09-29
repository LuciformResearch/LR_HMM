/**
 * Mocks pour les modules Node.js en mode web
 * Permet d'utiliser les mêmes classes côté web et côté serveur
 */

// Mock de fs pour le web
export const fsMock = {
  existsSync: (path: string) => {
    console.log(`[WEB MOCK] fs.existsSync(${path}) -> false`);
    return false;
  },
  readdirSync: (path: string) => {
    console.log(`[WEB MOCK] fs.readdirSync(${path}) -> []`);
    return [];
  },
  statSync: (path: string) => {
    console.log(`[WEB MOCK] fs.statSync(${path})`);
    return { isDirectory: () => false };
  },
  readFileSync: (path: string, encoding: string) => {
    console.log(`[WEB MOCK] fs.readFileSync(${path}, ${encoding}) -> ''`);
    return '';
  },
  writeFileSync: (path: string, data: string) => {
    console.log(`[WEB MOCK] fs.writeFileSync(${path}, data)`);
  },
  mkdirSync: (path: string, options?: any) => {
    console.log(`[WEB MOCK] fs.mkdirSync(${path}, ${JSON.stringify(options)})`);
  },
  rmSync: (path: string, options?: any) => {
    console.log(`[WEB MOCK] fs.rmSync(${path}, ${JSON.stringify(options)})`);
  }
};

// Mock de path pour le web
export const pathMock = {
  resolve: (...paths: string[]) => paths.join('/'),
  join: (...paths: string[]) => paths.join('/'),
  dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
  basename: (path: string) => path.split('/').pop() || '',
  extname: (path: string) => {
    const parts = path.split('.');
    return parts.length > 1 ? '.' + parts.pop() : '';
  }
};

// Mock de os pour le web
export const osMock = {
  homedir: () => '/home/web',
  platform: () => 'web',
  userInfo: () => ({ username: 'web', homedir: '/home/web' })
};

/**
 * Fonction pour obtenir les modules selon l'environnement
 */
export function getNodeModules() {
  if (typeof window !== 'undefined') {
    // Mode web : utiliser les mocks
    return {
      fs: fsMock,
      path: pathMock,
      os: osMock
    };
  } else {
    // Mode Node.js : utiliser les vrais modules
    return {
      fs: require('fs'),
      path: require('path'),
      os: require('os')
    };
  }
}