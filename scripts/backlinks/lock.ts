import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const staleMs = 5 * 60_000;
const waitMs = 10_000;
const retryMs = 200;

export class LockTimeout extends Error {}

function ownerAlive(contents: string) {
  try {
    const { pid } = JSON.parse(contents);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  } catch {
    return false;
  }
}

async function clearStale(file: string) {
  try {
    const old = await stat(file);
    if (Date.now() - old.mtimeMs <= staleMs || ownerAlive(await readFile(file, "utf8"))) return false;
    const current = await stat(file);
    if (current.ino !== old.ino || current.birthtimeMs !== old.birthtimeMs || current.mtimeMs !== old.mtimeMs) return false;
    await unlink(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function withBacklinksLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const file = path.join(root, "backlinks", ".lock");
  await mkdir(path.dirname(file), { recursive: true });
  const deadline = performance.now() + waitMs;
  for (;;) {
    const handle = await open(file, "wx").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined;
      throw error;
    });
    if (handle) {
      try {
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\n");
        } finally {
          await handle.close();
        }
        return await action();
      } finally {
        await unlink(file);
      }
    }
    if (await clearStale(file)) continue;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new LockTimeout("Timed out waiting for backlinks/.lock (10 seconds)");
    await delay(Math.min(remaining, retryMs));
  }
}
