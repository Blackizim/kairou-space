import crypto from 'node:crypto';

export interface InternalExtractedStream {
  rawUrl: string;
  referer: string;
  extraHeaders?: Record<string, string>;
  format: 'hls' | 'mp4' | 'dash';
  codec: 'h264' | 'h265';
  idioma: string | null;
  qualidade: string | null;
  isPtBr: boolean;
  is4k: boolean;
  priorityBoost: number;
  providerLabel?: string;
  hasMultiQuality?: boolean;
  hasEmbeddedSubs?: boolean;
  latencyMs?: number;
  verified?: boolean;
  resolvedTitle?: string;
}

export interface InternalSubtitle {
  rawUrl: string;
  referer: string;
  extraHeaders?: Record<string, string>;
  lang: string;
  label: string;
}

export interface TargetQuery {
  kind: 'movie' | 'tv';
  tmdbId: string;
  imdbId?: string;
  title?: string;
  season?: number;
  episode?: number;
}

// ============================================================================
// 1. CIRCUIT BREAKER (45s pause after consecutive failures)
// ============================================================================
interface CircuitState {
  failCount: number;
  pausedUntil: number;
}

const circuitBreakers = new Map<string, CircuitState>();

export function isProviderAvailable(providerName: string): boolean {
  const state = circuitBreakers.get(providerName);
  if (!state) return true;
  if (Date.now() < state.pausedUntil) return false;
  return true;
}

export function recordProviderSuccess(providerName: string): void {
  const state = circuitBreakers.get(providerName);
  if (state) {
    state.failCount = 0;
    state.pausedUntil = 0;
  }
}

export function recordProviderFailure(providerName: string): void {
  let state = circuitBreakers.get(providerName);
  if (!state) {
    state = { failCount: 1, pausedUntil: 0 };
    circuitBreakers.set(providerName, state);
  } else {
    state.failCount++;
    if (state.failCount >= 3) {
      state.pausedUntil = Date.now() + 45_000; // 45 seconds pause
    }
  }
}

// ============================================================================
// 2. SCORING & RANKING SYSTEM (Pontuação exata de 5 etapas)
// ============================================================================
export function calculateStreamScore(s: {
  providerLabel?: string;
  isPtBr?: boolean;
  idioma?: string | null;
  qualidade?: string | null;
  format?: 'hls' | 'mp4' | 'dash';
  latencyMs?: number;
  hasMultiQuality?: boolean;
  hasEmbeddedSubs?: boolean;
}): number {
  let score = 0;

  // Bônus de provedor principal — Koi (+250.000 pts)
  const isKoi = s.providerLabel === 'Koi' || /koi|mbox/i.test(s.providerLabel || '');
  if (isKoi) {
    score += 250_000;
  }

  // Idioma / Região (+150.000 / +50.000 / 0 pts)
  // Português Brasil (🇧🇷) → +150.000 pts (Koi PT-BR, Arara, Iara, Jade, Coruja)
  // Inglês (🇺🇸) ou Animes dedicados em Japonês (🇯🇵) (Kitsune, Shiro, Akira, Ronin, Sora, Kuro) → +50.000 pts
  // Outros idiomas (Espanhol, Hindi, Russo, etc.) → 0 pts
  const isPt = Boolean(s.isPtBr || /pt|br|dublado|portugu[eê]s/i.test(s.idioma || ''));
  const isAnimeJp = /kitsune|shiro|akira|ronin|sora|kuro/i.test(s.providerLabel || '');
  const isEnOrJp = Boolean(isAnimeJp || /en|us|ingl[eê]s|original|legendado|ja|jap/i.test(s.idioma || ''));

  if (isPt) {
    score += 150_000;
  } else if (isEnOrJp) {
    score += 50_000;
  }

  // Resolução (altura × 10)
  // 4K (2160p) = +21.600 pts
  // 1440p = +14.400 pts
  // 1080p = +10.800 pts
  // 720p = +7.200 pts
  const qStr = s.qualidade || '';
  if (/4k|2160/i.test(qStr)) {
    score += 21_600;
  } else if (/1440/i.test(qStr)) {
    score += 14_400;
  } else if (/1080|full\s*hd/i.test(qStr)) {
    score += 10_800;
  } else if (/720|hd/i.test(qStr)) {
    score += 7_200;
  } else if (/480/i.test(qStr)) {
    score += 4_800;
  } else if (/360/i.test(qStr)) {
    score += 3_600;
  } else {
    score += 7_200;
  }

  // Formato do stream
  // HLS (.m3u8) = +6.000 pts (preferido por ser adaptativo)
  // MP4 = +4.000 pts
  // DASH (.mpd) = +2.000 pts
  if (s.format === 'hls') {
    score += 6_000;
  } else if (s.format === 'mp4') {
    score += 4_000;
  } else if (s.format === 'dash') {
    score += 2_000;
  }

  // Desempate por extras e velocidade
  // Múltiplas qualidades: +300 pts
  if (s.hasMultiQuality) score += 300;
  // Legendas embutidas: +200 pts
  if (s.hasEmbeddedSubs) score += 200;
  // Penalidade leve para servidores mais lentos (-0,25 pt por ms de latência)
  if (typeof s.latencyMs === 'number' && s.latencyMs > 0) {
    score -= Math.min(2_000, s.latencyMs * 0.25);
  }

  return score;
}

// Base URL for HLS.lol endpoints (with proxy support)
export function getHlsLolBase(): string {
  const custom = process.env.HLS_LOL_PROXY_URL?.trim();
  if (custom && custom.startsWith('http')) {
    return custom.replace(/\/+$/, '');
  }
  return 'https://stream.hls.lol';
}

const DEFAULT_FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
};

async function fetchJsonSafe<T>(url: string, headers: Record<string, string> = {}, timeoutMs = 3000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_FETCH_HEADERS, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// 3. EXTRACTORS — FONTES INTERNACIONAIS E MULTI-ÁUDIO
// ============================================================================

// 1. Koi (Mbox*) — Também traz PT-BR Dub
export async function extractKoiMbox(target: TargetQuery, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Koi';
  if (!isProviderAvailable(pName)) return [];

  const base = getHlsLolBase();
  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}`;
  const url = `${base}/mbox?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    tracks?: Array<{ id?: string; kind?: string; lang?: string; mode?: string; quality?: string; url?: string }>;
  }>(url, { 'Referer': 'https://atlantic.bz/' }, timeoutMs);

  if (!data?.tracks || !Array.isArray(data.tracks) || data.tracks.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const t of data.tracks) {
    if (!t.url || !t.url.startsWith('http')) continue;
    const langStr = t.lang || t.mode || 'Original';
    const isPt = /portug|pt|dub|bra/i.test(langStr);
    const qStr = t.quality || '1080p';
    const is4k = /4k|2160/i.test(qStr);
    const format = t.kind === 'dash' || t.url.includes('.mpd') ? 'dash' : t.url.includes('.mp4') ? 'mp4' : 'hls';

    out.push({
      rawUrl: t.url,
      referer: 'https://atlantic.bz/',
      format,
      codec: 'h264',
      idioma: isPt ? 'pt-br' : langStr.toLowerCase(),
      qualidade: qStr,
      isPtBr: isPt,
      is4k,
      priorityBoost: isPt ? 250_000 : 200_000,
      providerLabel: 'Koi',
      hasMultiQuality: true,
      hasEmbeddedSubs: true,
      latencyMs,
    });
  }

  return out;
}

// 2. Aether (HLS) & Nautilus (MP4) (Q62 / 7Movies)
export async function extractAetherNautilus(target: TargetQuery, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Aether/Nautilus';
  if (!isProviderAvailable(pName)) return [];

  const base = getHlsLolBase();
  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}`;
  const url = `${base}/q62?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    tracks?: Array<{ id?: string; kind?: string; lang?: string; quality?: string; url?: string }>;
    streams?: Array<{ url?: string; quality?: string; lang?: string }>;
  }>(url, { 'Referer': 'https://atlantic.bz/' }, timeoutMs);

  const rawList = data?.tracks || data?.streams;
  if (!rawList || !Array.isArray(rawList) || rawList.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const item of rawList) {
    if (!item.url || !item.url.startsWith('http')) continue;
    const isMp4 = item.url.includes('.mp4');
    const isHls = !isMp4;
    const providerLabel = isHls ? 'Aether' : 'Nautilus';
    const isPt = /portug|pt|dub|bra/i.test(item.lang || '');

    out.push({
      rawUrl: item.url,
      referer: 'https://atlantic.bz/',
      format: isMp4 ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isPt ? 'pt-br' : (item.lang || 'en').toLowerCase(),
      qualidade: item.quality || '1080p Full HD',
      isPtBr: isPt,
      is4k: /4k|2160/i.test(item.quality || ''),
      priorityBoost: isHls ? 60 : 40,
      providerLabel,
      latencyMs,
    });
  }

  return out;
}

// 3. Velvet (Vidbox*)
export async function extractVelvetVidbox(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Velvet';
  if (!isProviderAvailable(pName)) return [];

  const base = getHlsLolBase();
  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}`;
  const url = `${base}/vidbox?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    tracks?: Array<{ url?: string; quality?: string; lang?: string; kind?: string }>;
    streams?: Array<{ url?: string; quality?: string; lang?: string }>;
  }>(url, { 'Referer': 'https://atlantic.bz/' }, timeoutMs);

  const list = data?.tracks || data?.streams;
  if (!list || !Array.isArray(list) || list.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const s of list) {
    if (!s.url || !s.url.startsWith('http')) continue;
    const isPt = /portug|pt|dub/i.test(s.lang || '');
    out.push({
      rawUrl: s.url,
      referer: 'https://atlantic.bz/',
      format: s.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isPt ? 'pt-br' : (s.lang || 'en').toLowerCase(),
      qualidade: s.quality || '1080p Full HD',
      isPtBr: isPt,
      is4k: /4k|2160/i.test(s.quality || ''),
      priorityBoost: 48,
      providerLabel: 'Velvet',
      latencyMs,
    });
  }

  return out;
}

// 4. Solstice (Lightspeed / Theia)
export async function extractSolstice(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Solstice';
  if (!isProviderAvailable(pName)) return [];

  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&type=tv&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}&type=movie`;
  const url = `https://lightspeed.hls.lol/v1/source?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    url?: string;
    sources?: Array<{ url?: string; quality?: string; lang?: string }>;
    streamUrl?: string;
  }>(url, { 'Referer': 'https://lightspeed.hls.lol/' }, timeoutMs);

  const out: InternalExtractedStream[] = [];
  const latencyMs = Date.now() - started;

  if (data?.sources && Array.isArray(data.sources)) {
    for (const item of data.sources) {
      if (!item.url || !item.url.startsWith('http')) continue;
      out.push({
        rawUrl: item.url,
        referer: 'https://lightspeed.hls.lol/',
        format: item.url.includes('.mp4') ? 'mp4' : 'hls',
        codec: 'h264',
        idioma: (item.lang || 'en').toLowerCase(),
        qualidade: item.quality || '1080p Full HD',
        isPtBr: /pt|br/i.test(item.lang || ''),
        is4k: /4k|2160/i.test(item.quality || ''),
        priorityBoost: 46,
        providerLabel: 'Solstice',
        latencyMs,
      });
    }
  } else if (data?.url || data?.streamUrl) {
    const streamUrl = data.url || data.streamUrl!;
    out.push({
      rawUrl: streamUrl,
      referer: 'https://lightspeed.hls.lol/',
      format: streamUrl.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: 'en',
      qualidade: '1080p Full HD',
      isPtBr: false,
      is4k: false,
      priorityBoost: 46,
      providerLabel: 'Solstice',
      latencyMs,
    });
  }

  if (out.length > 0) recordProviderSuccess(pName);
  else recordProviderFailure(pName);

  return out;
}

// 5. Lyra (Shegu / Vespera*)
export async function extractLyraShegu(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Lyra';
  if (!isProviderAvailable(pName)) return [];

  const base = getHlsLolBase();
  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}`;
  const url = `${base}/shegu?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    tracks?: Array<{ url?: string; quality?: string; lang?: string }>;
    streams?: Array<{ url?: string; quality?: string; lang?: string }>;
  }>(url, { 'Referer': 'https://atlantic.bz/' }, timeoutMs);

  const list = data?.tracks || data?.streams;
  if (!list || !Array.isArray(list) || list.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const s of list) {
    if (!s.url || !s.url.startsWith('http')) continue;
    const isPt = /portug|pt|dub/i.test(s.lang || '');
    out.push({
      rawUrl: s.url,
      referer: 'https://atlantic.bz/',
      format: s.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isPt ? 'pt-br' : (s.lang || 'en').toLowerCase(),
      qualidade: s.quality || '1080p Full HD',
      isPtBr: isPt,
      is4k: /4k|2160/i.test(s.quality || ''),
      priorityBoost: 44,
      providerLabel: 'Lyra',
      latencyMs,
    });
  }

  return out;
}

// 6. Polaris (Moscow*)
export async function extractPolarisMoscow(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Polaris';
  if (!isProviderAvailable(pName)) return [];

  const base = getHlsLolBase();
  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}`;
  const url = `${base}/moscow?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    tracks?: Array<{ url?: string; quality?: string; lang?: string }>;
  }>(url, { 'Referer': 'https://atlantic.bz/' }, timeoutMs);

  if (!data?.tracks || !Array.isArray(data.tracks) || data.tracks.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const s of data.tracks) {
    if (!s.url || !s.url.startsWith('http')) continue;
    const isPt = /portug|pt|dub/i.test(s.lang || '');
    out.push({
      rawUrl: s.url,
      referer: 'https://atlantic.bz/',
      format: s.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isPt ? 'pt-br' : (s.lang || 'en').toLowerCase(),
      qualidade: s.quality || '1080p Full HD',
      isPtBr: isPt,
      is4k: /4k|2160/i.test(s.quality || ''),
      priorityBoost: 42,
      providerLabel: 'Polaris',
      latencyMs,
    });
  }

  return out;
}

// 7. Orion (Amnesty*)
export async function extractOrionAmnesty(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Orion';
  if (!isProviderAvailable(pName)) return [];

  const base = getHlsLolBase();
  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`
    : `tmdbId=${encodeURIComponent(target.tmdbId)}`;
  const url = `${base}/amnesty?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    tracks?: Array<{ url?: string; quality?: string; lang?: string }>;
  }>(url, { 'Referer': 'https://atlantic.bz/' }, timeoutMs);

  if (!data?.tracks || !Array.isArray(data.tracks) || data.tracks.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const s of data.tracks) {
    if (!s.url || !s.url.startsWith('http')) continue;
    const isPt = /portug|pt|dub/i.test(s.lang || '');
    out.push({
      rawUrl: s.url,
      referer: 'https://atlantic.bz/',
      format: s.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isPt ? 'pt-br' : (s.lang || 'en').toLowerCase(),
      qualidade: s.quality || '1080p Full HD',
      isPtBr: isPt,
      is4k: /4k|2160/i.test(s.quality || ''),
      priorityBoost: 40,
      providerLabel: 'Orion',
      latencyMs,
    });
  }

  return out;
}

// 8. Obsidian (4K / HDR) (Punkflix)
export async function extractObsidianPunkflix(target: TargetQuery, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Obsidian';
  if (!isProviderAvailable(pName)) return [];

  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const url = isSeries
    ? `https://punkflix.net/tv/${target.tmdbId}/${target.season}/${target.episode}.json`
    : `https://punkflix.net/movie/${target.tmdbId}.json`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    streams?: Array<{ url?: string; name?: string; title?: string }>;
  }>(url, { 'Referer': 'https://punkflix.net/' }, timeoutMs);

  if (!data?.streams || !Array.isArray(data.streams) || data.streams.length === 0) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const out: InternalExtractedStream[] = [];

  for (const s of data.streams) {
    if (!s.url || !s.url.startsWith('http')) continue;
    const title = `${s.name || ''} ${s.title || ''}`;
    const isPt = /dub|pt|bra/i.test(title);
    out.push({
      rawUrl: s.url,
      referer: 'https://punkflix.net/',
      format: s.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isPt ? 'pt-br' : 'en-us',
      qualidade: '4K Ultra HD',
      isPtBr: isPt,
      is4k: true,
      priorityBoost: 38,
      providerLabel: 'Obsidian (4K)',
      latencyMs,
    });
  }

  return out;
}

// 9. Vortex (Silvia / Vixsrc)
export async function extractVortexSilvia(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Vortex';
  if (!isProviderAvailable(pName)) return [];

  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const qs = isSeries
    ? `id=${encodeURIComponent(target.tmdbId)}&s=${target.season}&e=${target.episode}`
    : `id=${encodeURIComponent(target.tmdbId)}`;
  const url = `https://it.hls.lol/resolve?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    url?: string;
    sources?: Array<{ url?: string; quality?: string }>;
  }>(url, { 'Referer': 'https://it.hls.lol/' }, timeoutMs);

  const streamUrl = data?.url || data?.sources?.[0]?.url;
  if (!streamUrl || !streamUrl.startsWith('http')) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;

  return [
    {
      rawUrl: streamUrl,
      referer: 'https://it.hls.lol/',
      format: streamUrl.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: 'en-us',
      qualidade: '1080p Full HD',
      isPtBr: false,
      is4k: false,
      priorityBoost: 36,
      providerLabel: 'Vortex',
      latencyMs,
    },
  ];
}

// 10. Zephyr (HEVC) (Flikhub / Zendaya)
export async function extractZephyrFlikhub(target: TargetQuery, timeoutMs = 2600): Promise<InternalExtractedStream[]> {
  const pName = 'Zephyr';
  if (!isProviderAvailable(pName)) return [];

  const isSeries = target.kind === 'tv' && target.season && target.episode;
  const endpoint = isSeries ? 'tv' : 'movie';
  const qs = isSeries
    ? `id=${encodeURIComponent(target.tmdbId)}&s=${target.season}&e=${target.episode}`
    : `id=${encodeURIComponent(target.tmdbId)}`;
  const url = `https://proxy3.flikhub.net/${endpoint}?${qs}`;

  const started = Date.now();
  const data = await fetchJsonSafe<{
    url?: string;
    streamUrl?: string;
    sources?: Array<{ url?: string; quality?: string }>;
  }>(url, { 'Referer': 'https://flikhub.net/' }, timeoutMs);

  const streamUrl = data?.url || data?.streamUrl || data?.sources?.[0]?.url;
  if (!streamUrl || !streamUrl.startsWith('http')) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;

  return [
    {
      rawUrl: streamUrl,
      referer: 'https://flikhub.net/',
      format: streamUrl.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h265', // HEVC
      idioma: 'en-us',
      qualidade: '1080p HEVC',
      isPtBr: false,
      is4k: false,
      priorityBoost: 30,
      providerLabel: 'Zephyr (HEVC)',
      latencyMs,
    },
  ];
}

// ============================================================================
// 4. EXTRACTORS — ANIMES DEDICADOS
// ============================================================================

// AniList <-> TMDB ID conversion
export async function resolveAniListFromTmdb(tmdbId: string): Promise<number | null> {
  try {
    const data = await fetchJsonSafe<{
      found?: boolean;
      anilistId?: number;
      type?: string;
    }>(`https://anime.hls.lol/ids?tmdb=${encodeURIComponent(tmdbId)}`, {}, 1600);

    if (data?.found && typeof data.anilistId === 'number') {
      return data.anilistId;
    }
  } catch {}
  return null;
}

// 11. Kitsune Anime (JustAnime momo)
export async function extractKitsuneAnime(anilistId: number, ep: number, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Kitsune Anime';
  if (!isProviderAvailable(pName)) return [];

  const url = `https://core.justanime.to/api/watch/${anilistId}/episode/${ep}/momo`;
  const started = Date.now();

  const data = await fetchJsonSafe<{
    sub?: { sources?: Array<{ url?: string; quality?: string; isM3U8?: boolean }> };
    dub?: { sources?: Array<{ url?: string; quality?: string; isM3U8?: boolean }> };
  }>(url, {
    'Referer': 'https://justanime.to/',
    'Origin': 'https://justanime.to',
  }, timeoutMs);

  const out: InternalExtractedStream[] = [];
  const latencyMs = Date.now() - started;

  const addSources = (sources?: Array<{ url?: string; quality?: string }>, isDub = false) => {
    if (!sources || !Array.isArray(sources)) return;
    for (const s of sources) {
      if (!s.url || !s.url.startsWith('http')) continue;
      out.push({
        rawUrl: s.url,
        referer: 'https://justanime.to/',
        format: s.url.includes('.mp4') ? 'mp4' : 'hls',
        codec: 'h264',
        idioma: isDub ? 'pt-br' : 'ja',
        qualidade: s.quality || '1080p HD',
        isPtBr: isDub,
        is4k: false,
        priorityBoost: isDub ? 85 : 55,
        providerLabel: 'Kitsune Anime',
        latencyMs,
      });
    }
  };

  addSources(data?.dub?.sources, true);
  addSources(data?.sub?.sources, false);

  if (out.length > 0) recordProviderSuccess(pName);
  else recordProviderFailure(pName);

  return out;
}

// 12. Shiro Anime (JustAnime onyx)
export async function extractShiroAnime(anilistId: number, ep: number, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Shiro Anime';
  if (!isProviderAvailable(pName)) return [];

  const url = `https://core.justanime.to/api/watch/${anilistId}/episode/${ep}/onyx`;
  const started = Date.now();

  const data = await fetchJsonSafe<{
    sub?: { sources?: Array<{ url?: string; quality?: string }> };
    dub?: { sources?: Array<{ url?: string; quality?: string }> };
  }>(url, {
    'Referer': 'https://justanime.to/',
    'Origin': 'https://justanime.to',
  }, timeoutMs);

  const out: InternalExtractedStream[] = [];
  const latencyMs = Date.now() - started;

  const addSources = (sources?: Array<{ url?: string; quality?: string }>, isDub = false) => {
    if (!sources || !Array.isArray(sources)) return;
    for (const s of sources) {
      if (!s.url || !s.url.startsWith('http')) continue;
      out.push({
        rawUrl: s.url,
        referer: 'https://justanime.to/',
        format: s.url.includes('.mp4') ? 'mp4' : 'hls',
        codec: 'h264',
        idioma: isDub ? 'pt-br' : 'ja',
        qualidade: s.quality || '1080p HD',
        isPtBr: isDub,
        is4k: false,
        priorityBoost: isDub ? 84 : 54,
        providerLabel: 'Shiro Anime',
        latencyMs,
      });
    }
  };

  addSources(data?.dub?.sources, true);
  addSources(data?.sub?.sources, false);

  if (out.length > 0) recordProviderSuccess(pName);
  else recordProviderFailure(pName);

  return out;
}

// 13. Akira Anime (JustAnime revo)
export async function extractAkiraAnime(anilistId: number, ep: number, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Akira Anime';
  if (!isProviderAvailable(pName)) return [];

  const url = `https://core.justanime.to/api/watch/${anilistId}/episode/${ep}/revo`;
  const started = Date.now();

  const data = await fetchJsonSafe<{
    sub?: { sources?: Array<{ url?: string; quality?: string }> };
    dub?: { sources?: Array<{ url?: string; quality?: string }> };
  }>(url, {
    'Referer': 'https://justanime.to/',
    'Origin': 'https://justanime.to',
  }, timeoutMs);

  const out: InternalExtractedStream[] = [];
  const latencyMs = Date.now() - started;

  const addSources = (sources?: Array<{ url?: string; quality?: string }>, isDub = false) => {
    if (!sources || !Array.isArray(sources)) return;
    for (const s of sources) {
      if (!s.url || !s.url.startsWith('http')) continue;
      out.push({
        rawUrl: s.url,
        referer: 'https://justanime.to/',
        format: s.url.includes('.mp4') ? 'mp4' : 'hls',
        codec: 'h264',
        idioma: isDub ? 'pt-br' : 'ja',
        qualidade: s.quality || '1080p HD',
        isPtBr: isDub,
        is4k: false,
        priorityBoost: isDub ? 83 : 53,
        providerLabel: 'Akira Anime',
        latencyMs,
      });
    }
  };

  addSources(data?.dub?.sources, true);
  addSources(data?.sub?.sources, false);

  if (out.length > 0) recordProviderSuccess(pName);
  else recordProviderFailure(pName);

  return out;
}

// 14. Ronin Anime (zokoanime)
export async function extractRoninAnime(anilistId: number, ep: number, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Ronin Anime';
  if (!isProviderAvailable(pName)) return [];

  const url = `https://anime.hls.lol/zokoanime?anilistId=${anilistId}&episode=${ep}`;
  const started = Date.now();

  const data = await fetchJsonSafe<{
    found?: boolean;
    url?: string;
    kind?: string;
    quality?: number | string;
    audioLang?: string;
  }>(url, {}, timeoutMs);

  if (!data?.found || !data?.url || !data.url.startsWith('http')) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const isDub = /dub|pt|bra/i.test(data.audioLang || '');

  return [
    {
      rawUrl: data.url,
      referer: 'https://anime.hls.lol/',
      format: data.kind === 'mp4' || data.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isDub ? 'pt-br' : 'ja',
      qualidade: data.quality ? `${data.quality}p` : '1080p HD',
      isPtBr: isDub,
      is4k: false,
      priorityBoost: isDub ? 82 : 52,
      providerLabel: 'Ronin Anime',
      latencyMs,
    },
  ];
}

// 15. Sora Anime (animesalt)
export async function extractSoraAnime(anilistId: number, ep: number, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Sora Anime';
  if (!isProviderAvailable(pName)) return [];

  const url = `https://anime.hls.lol/animesalt?anilistId=${anilistId}&episode=${ep}`;
  const started = Date.now();

  const data = await fetchJsonSafe<{
    found?: boolean;
    url?: string;
    kind?: string;
    quality?: number | string;
    audioLang?: string;
  }>(url, {}, timeoutMs);

  if (!data?.found || !data?.url || !data.url.startsWith('http')) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const isDub = /dub|pt|bra/i.test(data.audioLang || '');

  return [
    {
      rawUrl: data.url,
      referer: 'https://anime.hls.lol/',
      format: data.kind === 'mp4' || data.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isDub ? 'pt-br' : 'ja',
      qualidade: data.quality ? `${data.quality}p` : '1080p HD',
      isPtBr: isDub,
      is4k: false,
      priorityBoost: isDub ? 81 : 51,
      providerLabel: 'Sora Anime',
      latencyMs,
    },
  ];
}

// 16. Kuro Anime (animegg)
export async function extractKuroAnime(anilistId: number, ep: number, timeoutMs = 2800): Promise<InternalExtractedStream[]> {
  const pName = 'Kuro Anime';
  if (!isProviderAvailable(pName)) return [];

  const url = `https://anime.hls.lol/animegg?anilistId=${anilistId}&episode=${ep}`;
  const started = Date.now();

  const data = await fetchJsonSafe<{
    found?: boolean;
    url?: string;
    kind?: string;
    quality?: number | string;
    audioLang?: string;
  }>(url, {}, timeoutMs);

  if (!data?.found || !data?.url || !data.url.startsWith('http')) {
    recordProviderFailure(pName);
    return [];
  }

  recordProviderSuccess(pName);
  const latencyMs = Date.now() - started;
  const isDub = /dub|pt|bra/i.test(data.audioLang || '');

  return [
    {
      rawUrl: data.url,
      referer: 'https://anime.hls.lol/',
      format: data.kind === 'mp4' || data.url.includes('.mp4') ? 'mp4' : 'hls',
      codec: 'h264',
      idioma: isDub ? 'pt-br' : 'ja',
      qualidade: data.quality ? `${data.quality}p` : '1080p HD',
      isPtBr: isDub,
      is4k: false,
      priorityBoost: isDub ? 80 : 50,
      providerLabel: 'Kuro Anime',
      latencyMs,
    },
  ];
}

// ============================================================================
// 5. LEGENDAS, INTRO/CRÉDITOS E METADADOS
// ============================================================================

// Natsuki Subs
export async function fetchNatsukiSubs(tmdbId: string, timeoutMs = 2400): Promise<InternalSubtitle[]> {
  const url = `https://natsuki.hls.lol/subs?tmdbId=${encodeURIComponent(tmdbId)}`;

  const data = await fetchJsonSafe<Array<{ url?: string; lang?: string; label?: string }>>(url, {
    'Referer': 'https://atlantic.bz/',
  }, timeoutMs);

  if (!data || !Array.isArray(data)) return [];

  return data
    .filter((s) => s.url && s.url.startsWith('http'))
    .map((s) => ({
      rawUrl: s.url!,
      referer: 'https://natsuki.hls.lol/',
      lang: s.lang || 'pt',
      label: s.label || 'Português (Natsuki)',
    }));
}

// Athena IMDb Metadata
export async function fetchAthenaImdbMeta(imdbId: string, timeoutMs = 2400): Promise<Record<string, unknown> | null> {
  if (!imdbId || !imdbId.startsWith('tt')) return null;
  return fetchJsonSafe<Record<string, unknown>>(`https://athena.hls.lol/imdb/title/${encodeURIComponent(imdbId)}`, {}, timeoutMs);
}

// TheIntroDB (Pular Abertura / Créditos)
export async function fetchTheIntroDbTimes(
  tmdbId: string,
  season?: number,
  episode?: number,
  timeoutMs = 2200
): Promise<Array<{ type: 'intro' | 'recap' | 'outro'; start: number; end: number }>> {
  try {
    const qs = season && episode ? `tmdbId=${tmdbId}&season=${season}&episode=${episode}` : `tmdbId=${tmdbId}`;
    const data = await fetchJsonSafe<{
      segments?: Array<{ type?: string; startTime?: number; endTime?: number }>;
    }>(`https://api.theintrodb.org/v3/media?${qs}`, {}, timeoutMs);

    if (data?.segments && Array.isArray(data.segments)) {
      return data.segments
        .filter((s) => typeof s.startTime === 'number' && typeof s.endTime === 'number')
        .map((s) => ({
          type: (s.type === 'recap' ? 'recap' : s.type === 'outro' ? 'outro' : 'intro') as 'intro' | 'recap' | 'outro',
          start: s.startTime!,
          end: s.endTime!,
        }));
    }
  } catch {}
  return [];
}
