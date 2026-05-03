import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_DIR = path.resolve(__dirname, '../.runtime');
const STATE_PATH = path.join(RUNTIME_DIR, 'patchbox-process.json');
const DEFAULT_TEST_USERNAME = 'patchbox-test';
const DEFAULT_TEST_PASSWORD = 'patchbox-test';
const DEFAULT_TEST_PASSWORD_HASH = '$2y$12$mvryJqNJMD8rQbPI2ueYJ.kZMDa5uDv6dr4RBxa6XMSzKn8MM8Tsy';

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function isHealthy(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('/api/v1/health', baseURL));
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(baseURL: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy(baseURL)) return;
    await sleep(200);
  }
  throw new Error(`patchbox did not become healthy at ${baseURL}/api/v1/health within ${timeoutMs}ms`);
}

async function ensureDefaultTestUser(configPath: string) {
  if (
    process.env.PATCHBOX_TEST_USERNAME !== DEFAULT_TEST_USERNAME ||
    process.env.PATCHBOX_TEST_PASSWORD !== DEFAULT_TEST_PASSWORD
  ) {
    return;
  }

  const userConfig = `\n[[users]]\nusername = "${DEFAULT_TEST_USERNAME}"\npassword_hash = "${DEFAULT_TEST_PASSWORD_HASH}"\nrole = "admin"\n`;

  try {
    const config = await fs.readFile(configPath, 'utf8');
    if (config.includes(`username = "${DEFAULT_TEST_USERNAME}"`)) return;
    await fs.writeFile(configPath, `${config.trimEnd()}\n${userConfig}`);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    await fs.writeFile(configPath, userConfig.trimStart());
  }
}

function spawnPatchbox({
  port,
  repoRoot,
  configPath,
}: {
  port: number;
  repoRoot: string;
  configPath: string;
}): ChildProcess {
  const bin = process.env.PATCHBOX_BIN;

  if (bin) {
    return spawn(bin, ['--config', configPath, '--port', String(port)], {
      cwd: repoRoot,
      stdio: 'inherit',
      detached: true,
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG ?? 'info',
      },
    });
  }

  const features = (process.env.PATCHBOX_FEATURES ?? '').trim();
  const args = ['run', '-p', 'patchbox'];
  if (features) args.push('--features', features);
  args.push('--quiet', '--', '--config', configPath, '--port', String(port));

  return spawn('cargo', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    detached: true,
    env: {
      ...process.env,
      RUST_LOG: process.env.RUST_LOG ?? 'info',
    },
  });
}

export default async function globalSetup() {
  const port = Number(process.env.PATCHBOX_PORT ?? '9191');
  const baseURL = process.env.PATCHBOX_BASE_URL ?? `http://127.0.0.1:${port}`;

  await fs.mkdir(RUNTIME_DIR, { recursive: true });

  // If a developer already has patchbox running locally, don't fight it.
  if (await isHealthy(baseURL)) {
    await fs.writeFile(STATE_PATH, JSON.stringify({ spawned: false }, null, 2));
    return;
  }

  const repoRoot = path.resolve(__dirname, '../..');
  const configPath = path.join(RUNTIME_DIR, 'config.toml');

  await ensureDefaultTestUser(configPath);

  const proc = spawnPatchbox({ port, repoRoot, configPath });
  if (!proc.pid) throw new Error('failed to spawn patchbox (no pid)');

  await fs.writeFile(
    STATE_PATH,
    JSON.stringify({ spawned: true, pid: proc.pid, baseURL }, null, 2),
  );

  await waitForHealth(baseURL, 60_000);
}
