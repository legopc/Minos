import fs from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_DIR = path.resolve(__dirname, '../.runtime');
const STATE_PATH = path.join(RUNTIME_DIR, 'patchbox-process.json');

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export default async function globalTeardown() {
  let raw: string;
  try {
    raw = await fs.readFile(STATE_PATH, 'utf8');
  } catch {
    return;
  }

  let st: any;
  try {
    st = JSON.parse(raw);
  } catch {
    return;
  }

  if (!st || !st.spawned || !st.pid) return;

  const pid = Number(st.pid);
  if (!Number.isFinite(pid) || pid <= 0) return;

  try {
    // Detached spawn: kill the whole process group.
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }

  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
      await sleep(100);
    } catch {
      break;
    }
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ignore
  }
}
