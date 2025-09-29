import 'dotenv/config';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };

  const keyPath = getArg('--key') || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const project = getArg('--project') || process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const role = getArg('--role', 'roles/aiplatform.user');
  if (!keyPath) throw new Error('Missing --key or GOOGLE_APPLICATION_CREDENTIALS');
  if (!project) throw new Error('Missing --project or PROJECT_ID/GOOGLE_CLOUD_PROJECT');

  // Read only the client_email field without printing contents
  const raw = await fs.readFile(keyPath, 'utf8');
  let saEmail: string | undefined;
  try {
    const obj = JSON.parse(raw);
    saEmail = obj.client_email;
  } catch {
    throw new Error('Failed to parse service account JSON');
  }
  if (!saEmail || typeof saEmail !== 'string') throw new Error('No client_email in service account JSON');

  console.log(`Granting ${role} to serviceAccount:${saEmail} on project ${project} ...`);

  // gcloud IAM binding
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('gcloud', [
      'projects', 'add-iam-policy-binding', project,
      `--member=serviceAccount:${saEmail}`,
      `--role=${role}`
    ], { stdio: 'inherit' });
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`gcloud exited with ${code}`)));
    proc.on('error', reject);
  });

  console.log('✅ IAM binding applied.');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

