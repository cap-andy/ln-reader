import { promises as fs } from "fs";

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

// Per-file lock: serializes read-modify-write sequences against the same
// file so two concurrent requests can't race and clobber each other's
// write. Each key gets its own chain of promises; callers just
// `await withFileLock(file, async () => { ...read, mutate, write... })`
// and everything queued on that file runs one at a time.
const locks = new Map();

export function withFileLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn); // run fn regardless of whether prev settled ok
  locks.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}
