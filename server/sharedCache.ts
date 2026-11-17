/** Optional Upstash-compatible REST cache. Never returns credentials or internal URLs to clients. */
const endpoint = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
async function command(args: unknown[]): Promise<unknown> {
  if (!endpoint || !token) return null;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    return (await response.json() as { result?: unknown }).result ?? null;
  } catch { return null; }
}
export async function getSharedCache<T>(key: string): Promise<T | null> {
  const result = await command(['GET', `kairou:extract:v1:${key}`]);
  if (typeof result !== 'string') return null;
  try { return JSON.parse(result) as T; } catch { return null; }
}
export async function setSharedCache(key: string, value: unknown): Promise<void> {
  await command(['SET', `kairou:extract:v1:${key}`, JSON.stringify(value), 'EX', 60]);
}
