import { spawn } from 'child_process';

function getArg(args: string[], name: string, def?: string) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
}

async function main() {
  const args = process.argv.slice(2);

  // Quick toggles
  const slug = getArg(args, '--slug', '2025-06-25__orage_codé_textuel')!;
  const mode = (getArg(args, '--mode', 'l1') || 'l1').toLowerCase(); // l1 | l2
  const quick = (getArg(args, '--quick', 'false') || 'false').toLowerCase() === 'true';
  const ratioOnly = (getArg(args, '--ratio-only', 'true') || 'true').toLowerCase() === 'true';
  const targetRatio = getArg(args, '--target-ratio', ratioOnly ? '0.10' : '0.25')!;
  const fromL1 = getArg(args, '--from-l1');
  const groupSize = getArg(args, '--group-size', '5')!;
  const indices = getArg(args, '--only-indices', quick ? '0-2' : undefined);

  const base = [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/compress_memoryv2.ts',
    '--slug', slug,
    '--level', mode === 'l2' ? '2' : '1',
    '--vertexai', 'true',
    '--model', 'gemini-2.5-flash',
    '--window-chars', '4000',
    '--concurrency', '20',
    '--batch-delay-ms', '1500',
    '--engine-retry-attempts', '1',
    '--profile', 'chat_assistant_fp',
    '--persona-name', 'ShadeOS',
    '--role-map', 'assistant=ShadeOS,user=Lucie',
    '--log', 'true',
  ];

  if (ratioOnly) {
    base.push('--ratio-only', 'true', '--target-ratio', targetRatio, '--short-mode', 'accept', '--overflow-mode', 'accept');
  } else {
    base.push('--min-summary', '250', '--max-summary', '400', '--short-mode', 'regenerate', '--overflow-mode', 'regenerate');
  }

  if (mode === 'l2') {
    base.push('--group-size', groupSize);
    if (fromL1) base.push('--from-l1', fromL1);
  }

  if (indices) {
    base.push('--only-indices', indices);
  }

  console.log('Running:', ['node', ...base].join(' '));
  await new Promise<void>((resolve, reject) => {
    const cp = spawn(process.execPath, base, { stdio: 'inherit' });
    cp.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Child exited with code ${code}`));
    });
    cp.on('error', reject);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

