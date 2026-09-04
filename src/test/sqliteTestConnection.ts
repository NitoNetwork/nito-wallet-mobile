import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Exercise the real SQL and production write queue without an Expo device. */
export const sqliteTestConnection = (path: string) => {
  const process = spawn(globalThis.process.platform === 'win32' ? 'python' : 'python3', [
    fileURLToPath(new URL('./sqliteBridge.py', import.meta.url)), path,
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let id = 0;
  let failure: Error | null = null;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: process.stdout });
  lines.on('line', (line) => {
    const result = JSON.parse(line) as { id: number; error?: string; result: unknown };
    const request = pending.get(result.id);
    pending.delete(result.id);
    if (result.error) request?.reject(new Error(result.error));
    else request?.resolve(result.result);
  });
  const fail = (error: Error) => { failure = error; pending.forEach((request) => request.reject(error)); pending.clear(); };
  process.on('error', fail);
  process.on('exit', () => fail(new Error('SQLite test connection closed')));
  process.stderr.on('data', (data: Buffer) => fail(new Error(data.toString())));
  const request = (operation: string, sql = '', params: unknown[] = []) => new Promise<unknown>((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const key = ++id;
    pending.set(key, { resolve, reject });
    process.stdin.write(JSON.stringify({ id: key, operation, sql, params }) + '\n');
  });
  const runAsync = (sql: string, ...params: unknown[]) => request('run', sql, params);
  return {
    execAsync: (sql: string) => request('exec', sql),
    getAllAsync: (sql: string, ...params: unknown[]) => request('read', sql, params),
    getFirstAsync: async (sql: string, ...params: unknown[]) => (await request('read', sql, params) as unknown[])[0] ?? null,
    runAsync,
    prepareAsync: async (sql: string) => ({ executeAsync: (...params: unknown[]) => runAsync(sql, ...params), finalizeAsync: async () => undefined }),
    close: async () => {
      if (!failure) await request('close');
      else process.kill();
      lines.close();
      process.stdin.end();
    },
  };
};
