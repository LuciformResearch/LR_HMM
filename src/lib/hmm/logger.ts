export type Logger = { info: (msg: string) => void; close: () => Promise<void>; dir: string; file: string; base: string };

export async function createLogger(prefix: string, logPathArg?: string): Promise<Logger> {
  const fsDyn = await import('fs');
  const pathDyn = await import('path');
  const dir = logPathArg && !logPathArg.endsWith('.log') ? logPathArg : pathDyn.resolve(process.cwd(), 'artefacts/logs');
  await fsDyn.promises.mkdir(dir, { recursive: true });
  const runId = Date.now();
  const file = logPathArg && logPathArg.endsWith('.log') ? logPathArg : pathDyn.join(dir, `${prefix}_${runId}.log`);
  const stream = fsDyn.createWriteStream(file, { flags: 'a' });
  const write = (msg: string) => { const line = `[${new Date().toISOString()}] ${msg}`; console.log(line); stream.write(line + '\n'); };
  write(`Log ouvert: ${file}`);
  const base = file.replace(/\.log$/, '');
  return { info: write, close: async () => new Promise(res => stream.end(res)), dir, file, base };
}

