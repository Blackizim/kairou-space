import crypto from 'node:crypto';
import { createPocketBaseRouter } from './server/pocketbase.ts';
import { createAnalyticsRouter, recordVisit } from './server/analytics.ts';
import { createVipRouter } from './server/vipRoutes.ts';
import { getSharedCache, setSharedCache } from './server/sharedCache.ts';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '.env'), override: false });
import {
  CURATED_CATALOG,
  type CastMember,
  type EpisodeItem,
  type MediaTitle,
} from './src/data/curatedCatalog.ts';
import {
  LIVE_CHANNELS,
  CHANNEL_CATEGORIES,
  type LiveChannel,
} from './src/data/liveChannels.ts';
import { allowedForProfile } from './src/utils/profileRating.ts';
import {
  convertSrtToVtt,
  detectMp4CodecFromBytes,
  detectStreamFormat,
  inferStreamFormatFromUrlOrMeta,
  isLikelyHevcStream,
  isUltraHdQuality,
  parseAniSkipResponse,
  parseH264SpsFromSegmentBytes,
  parseHlsMasterMaxDimensions,
  parseMp4TkhdDimensions,
  parseTheIntroDbV2Response,
  parseTmdbTarget,
  rewriteHlsManifestWithResolver,
  sortBrowserCompatibleFirst,
  type SkipSegment,
} from './src/utils/streamLogic.ts';
import {
  decodeAnrollBloggerSource,
  detectTitleAudioKind,
  extractAnivideoM3u8Urls,
  extractBloggerMp4Urls,
  extractSeasonHint,
  matchExactEpisode,
  pickTopAnimeCandidates,
} from './src/utils/animeMatcher.ts';

const PORT = Number(process.env.PORT ?? 3001);

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Server-side TMDB credentials (never exposed to browser)
const rawReadToken = process.env.TMDB_READ_TOKEN || '';
const rawApiKey = process.env.TMDB_API_KEY || '';
const TMDB_READ_TOKEN = rawReadToken === 'MY_TMDB_READ_TOKEN' ? '' : rawReadToken;
const TMDB_API_KEY = rawApiKey === 'MY_TMDB_API_KEY' ? '' : rawApiKey;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

const EXTRACT_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_REGISTRY_TTL_MS = 4 * 60 * 60 * 1000;
const META_CACHE_TTL_MS = 15 * 60 * 1000;

const PROXY_TOKEN_SECRET = crypto
  .createHash('sha256')
  .update(process.env.PROXY_TOKEN_SECRET || 'kairou-proxy-secret-alexhost-2026')
  .digest();

function createStatelessProxyToken(
  url: string,
  referer: string,
  extraHeaders?: Record<string, string>,
  ttlMs = STREAM_REGISTRY_TTL_MS
): string {
  try {
    const payload = JSON.stringify({
      u: url,
      r: referer,
      h: extraHeaders,
      e: Math.floor((Date.now() + ttlMs) / 1000),
    });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', PROXY_TOKEN_SECRET, iv);
    const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64url');
  } catch {
    return crypto.randomBytes(9).toString('base64url');
  }
}

function resolveStatelessProxyToken(token: string): {
  url: string;
  referer: string;
  extraHeaders?: Record<string, string>;
} | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', PROXY_TOKEN_SECRET, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const obj = JSON.parse(dec.toString('utf8'));
    if (!obj || typeof obj.u !== 'string') return null;
    if (typeof obj.e === 'number' && obj.e * 1000 < Date.now()) return null;
    return {
      url: obj.u,
      referer: typeof obj.r === 'string' ? obj.r : '',
      extraHeaders: obj.h && typeof obj.h === 'object' ? obj.h : undefined,
    };
  } catch {
    return null;
  }
}

interface StoredTarget {
  url: string;
  referer: string;
  extraHeaders?: Record<string, string>;
  format: 'hls' | 'mp4';
  expiresAt: number;
}

interface StoredSubtitle {
  url: string;
  referer: string;
  extraHeaders?: Record<string, string>;
  lang: string;
  label: string;
  expiresAt: number;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const streamRegistry = new Map<string, StoredTarget>();
const subRegistry = new Map<string, StoredSubtitle>();
const proxyTokenRegistry = new Map<
  string,
  { url: string; referer: string; extraHeaders?: Record<string, string>; expiresAt: number }
>();
const urlToProxyToken = new Map<string, { token: string; expiresAt: number }>();
const extractCache = new Map<string, CacheEntry<AnonymizedExtractResponse>>();
const metaCache = new Map<string, CacheEntry<MediaTitle>>();
const seasonCache = new Map<string, CacheEntry<EpisodeItem[]>>();
const catalogCache = new Map<string, CacheEntry<MediaTitle[]>>();
const tmdbToImdbCache = new Map<string, string>();
const malIdCache = new Map<string, number>();
const skipTimesCache = new Map<string, CacheEntry<SkipSegment[]>>();
const animeContextCache = new Map<string, CacheEntry<AnimeContext | null>>();
const animeSearchPageCache = new Map<string, CacheEntry<Array<{ url: string; title: string; audioKind: 'dublado' | 'legendado' | 'unknown' }>>>();
let lastPruneAt = 0;

function pruneExpiredMaps() {
  const now = Date.now();
  if (now - lastPruneAt < 60_000) return;
  lastPruneAt = now;

  if (proxyTokenRegistry.size > 50_000) {
    for (const [k, v] of proxyTokenRegistry) {
      if (v.expiresAt <= now) proxyTokenRegistry.delete(k);
    }
    for (const [k, v] of urlToProxyToken) {
      if (v.expiresAt <= now) urlToProxyToken.delete(k);
    }
    // If still above cap after removing expired entries, trim oldest 10k entries
    if (proxyTokenRegistry.size > 50_000) {
      let removed = 0;
      for (const k of proxyTokenRegistry.keys()) {
        proxyTokenRegistry.delete(k);
        removed++;
        if (removed >= 10_000) break;
      }
    }
  }
  if (streamRegistry.size > 4000) {
    for (const [k, v] of streamRegistry) {
      if (v.expiresAt <= now) streamRegistry.delete(k);
    }
  }
  if (subRegistry.size > 4000) {
    for (const [k, v] of subRegistry) {
      if (v.expiresAt <= now) subRegistry.delete(k);
    }
  }
}

function registerProxyToken(
  url: string,
  referer: string,
  extraHeaders?: Record<string, string>
): string {
  const mapKey = `${url}::${referer}`;
  const now = Date.now();
  const existing = urlToProxyToken.get(mapKey);
  if (existing && existing.expiresAt > now) {
    return existing.token;
  }
  pruneExpiredMaps();
  const token = createStatelessProxyToken(url, referer, extraHeaders);
  const expiresAt = now + STREAM_REGISTRY_TTL_MS;
  proxyTokenRegistry.set(token, { url, referer, extraHeaders, expiresAt });
  urlToProxyToken.set(mapKey, { token, expiresAt });
  return token;
}

function registerStream(
  url: string,
  referer: string,
  format: 'hls' | 'mp4',
  extraHeaders?: Record<string, string>
): string {
  pruneExpiredMaps();
  const token = createStatelessProxyToken(url, referer, extraHeaders);
  const id = `s_${token}`;
  streamRegistry.set(id, {
    url,
    referer,
    extraHeaders,
    format,
    expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS,
  });
  return id;
}

function registerSubtitle(
  url: string,
  referer: string,
  lang: string,
  label: string,
  extraHeaders?: Record<string, string>
): string {
  pruneExpiredMaps();
  const id = `sub_${crypto.randomBytes(7).toString('base64url')}`;
  subRegistry.set(id, {
    url,
    referer,
    extraHeaders,
    lang,
    label,
    expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS,
  });
  return id;
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  opts: {
    referer?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    redirect?: RequestRedirect;
  } = {}
): Promise<{ status: number; text: string; finalUrl: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2400);
  try {
    const headers: Record<string, string> = {
      'User-Agent': DEFAULT_UA,
      Accept: '*/*',
      ...(opts.headers ?? {}),
    };
    if (opts.referer && !headers.Referer) {
      headers.Referer = opts.referer;
      try {
        if (!headers.Origin) headers.Origin = new URL(opts.referer).origin;
      } catch {
        // ignore
      }
    }
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers,
      redirect: opts.redirect ?? 'follow',
      signal: controller.signal,
    });
    const text = opts.method === 'HEAD' ? '' : await res.text();
    return { status: res.status, text, finalUrl: res.url || url, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTmdbJson<T>(endpointPath: string, timeoutMs = 2600): Promise<T | null> {
  if (!TMDB_API_KEY && !TMDB_READ_TOKEN) return null;
  const sep = endpointPath.includes('?') ? '&' : '?';
  const url = TMDB_API_KEY
    ? `${TMDB_BASE}${endpointPath}${sep}api_key=${encodeURIComponent(TMDB_API_KEY)}`
    : `${TMDB_BASE}${endpointPath}`;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (TMDB_READ_TOKEN) headers.Authorization = `Bearer ${TMDB_READ_TOKEN}`;
    const res = await fetchWithTimeout(url, { timeoutMs, headers });
    if (res.status !== 200) return null;
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}

interface InternalExtractedStream {
  rawUrl: string;
  referer: string;
  extraHeaders?: Record<string, string>;
  format: 'hls' | 'mp4';
  codec: 'h264' | 'h265';
  idioma: string | null;
  qualidade: string | null;
  isPtBr: boolean;
  is4k: boolean;
  priorityBoost: number;
  verified?: boolean;
  latencyMs?: number;
  bitrateBps?: number;
  videoWidth?: number;
  videoHeight?: number;
  resolvedTitle?: string;
}

interface InternalSubtitle {
  rawUrl: string;
  referer: string;
  extraHeaders?: Record<string, string>;
  lang: string;
  label: string;
}

export interface AnonymizedStream {
  id: string;
  label: string;
  audio: string;
  quality: string;
  codec: 'h264' | 'h265';
  format: 'hls' | 'mp4';
  isPtBr: boolean;
  is4k: boolean;
  streamUrl: string;
}

export interface AnonymizedSubtitle {
  id: string;
  lang: string;
  label: string;
  trackUrl: string;
}

export interface AnonymizedExtractResponse {
  elapsedMs: number;
  cached: boolean;
  resolvedTitle?: string;
  streams: AnonymizedStream[];
  subtitles: AnonymizedSubtitle[];
}

function normalizeSubtitleLang(lang: string, label: string): { lang: string; label: string; rank: number } {
  const hay = `${lang} ${label}`.toLowerCase().trim();
  if (
    hay.includes('brazil') ||
    hay.includes('pt-br') ||
    hay === 'pb' ||
    hay === 'pob' ||
    hay.includes('português (br')
  ) {
    return { lang: 'pt-BR', label: 'Português (BR)', rank: 100 };
  }
  if (hay.startsWith('pt') || hay.includes('portugu')) {
    return { lang: 'pt', label: 'Português', rank: 95 };
  }
  if (hay === 'en' || hay.startsWith('en-') || hay.includes('english') || hay.includes('ingl')) {
    return { lang: 'en', label: 'Inglês', rank: 70 };
  }
  if (hay === 'es' || hay.startsWith('es-') || hay.includes('span') || hay.includes('espanh')) {
    return { lang: 'es', label: 'Espanhol', rank: 60 };
  }
  if (hay === 'fr' || hay.startsWith('fr-') || hay.includes('french') || hay.includes('franc')) {
    return { lang: 'fr', label: 'Francês', rank: 50 };
  }
  if (hay === 'de' || hay.startsWith('de-') || hay.includes('german') || hay.includes('alem')) {
    return { lang: 'de', label: 'Alemão', rank: 45 };
  }
  if (hay === 'it' || hay.startsWith('it-') || hay.includes('ital')) {
    return { lang: 'it', label: 'Italiano', rank: 40 };
  }
  return { lang: lang || 'und', label: label || lang || 'Legenda', rank: 20 };
}

function formatQualityDisplay(rawQuality: string | null): { quality: string; is4k: boolean } {
  if (!rawQuality) return { quality: '1080p Full HD', is4k: false };
  const q = rawQuality.replace(/\([^)]*\)/g, '').trim();
  const is4k = isUltraHdQuality(rawQuality);
  if (/2160|4k/i.test(rawQuality)) return { quality: '4K UHD', is4k: true };
  if (/ultra\s*fhd|studio\s*master/i.test(rawQuality)) return { quality: 'Ultra FHD · Master', is4k: true };
  if (/1080|fhd/i.test(q)) return { quality: '1080p Full HD', is4k: false };
  if (/720/i.test(q)) return { quality: '720p HD', is4k: false };
  if (/480/i.test(q)) return { quality: '480p', is4k: false };
  if (/360/i.test(q)) return { quality: '360p / 720p HD', is4k: false };
  if (q.toLowerCase() === 'auto') return { quality: 'Auto HD', is4k: false };
  return { quality: q || 'HD', is4k };
}

function formatAudioDisplay(idioma: string | null, rawQuality: string | null): { audio: string; isPtBr: boolean } {
  const hay = `${idioma ?? ''} ${rawQuality ?? ''}`.toLowerCase();
  if (/pt-br|pt_br|portuguese|português|dublado|🇧🇷|\bpt\b|dual/i.test(hay)) {
    return { audio: 'PT-BR · Dublado', isPtBr: true };
  }
  if (/en-us|english|ingl|🇺🇸/i.test(hay)) {
    return { audio: 'Inglês · Original', isPtBr: false };
  }
  if (/legendad/i.test(hay)) {
    return { audio: 'Original · Legendado', isPtBr: false };
  }
  if (/es|spanish|español/i.test(hay)) {
    return { audio: 'Espanhol', isPtBr: false };
  }
  if (/fr|french/i.test(hay)) {
    return { audio: 'Francês', isPtBr: false };
  }
  if (/hi|hindi/i.test(hay)) {
    return { audio: 'Hindi', isPtBr: false };
  }
  return { audio: 'Original / Multi', isPtBr: false };
}

type ExtractTarget =
  | {
      kind: 'movie';
      tmdbId: string;
      imdbId?: string;
      title?: string;
      originalTitle?: string;
      isAnime?: boolean;
    }
  | {
      kind: 'tv';
      tmdbId: string;
      season: number;
      episode: number;
      imdbId?: string;
      title?: string;
      originalTitle?: string;
      isAnime?: boolean;
    };

interface AnimeContext {
  isAnime: boolean;
  searchTitles: string[];
  imdbId?: string;
  malId?: number;
  absoluteEpisode?: number;
  mappedSeason?: number;
  mappedEpisode?: number;
}

async function resolveAnimeContext(target: ExtractTarget): Promise<AnimeContext | null> {
  if (target.kind !== 'tv') return null;

  const cacheKey = `tv:${target.tmdbId}:${target.season}:${target.episode}`;
  const hit = animeContextCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  const titlePool: string[] = [];
  const pushTitle = (t?: string | null) => {
    const clean = (t ?? '').trim();
    if (!clean || !/[a-z]{2}/i.test(clean)) return;
    if (!titlePool.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      titlePool.push(clean);
    }
  };

  pushTitle(target.originalTitle);
  pushTitle(target.title);

  const curated = CURATED_CATALOG.find((c) => c.tmdbId === target.tmdbId);
  if (curated) {
    pushTitle(curated.originalTitle);
    pushTitle(curated.title);
  }

  const cachedMeta = metaCache.get(`tmdb-detail:series:${target.tmdbId}`)?.value;
  if (cachedMeta) {
    pushTitle(cachedMeta.originalTitle);
    pushTitle(cachedMeta.title);
  }

  let isAnime =
    Boolean(target.isAnime) ||
    Boolean(curated && (curated.network === 'Crunchyroll' || curated.genres.some((g) => /anima/i.test(g)))) ||
    Boolean(cachedMeta && (cachedMeta.network === 'Crunchyroll' || cachedMeta.genres.some((g) => /anima/i.test(g))));

  let imdbId = target.imdbId || curated?.imdbId || cachedMeta?.imdbId;
  let malId: number | undefined;
  let anilistId: number | undefined;
  let absoluteEpisode: number | undefined;
  let mappedSeason: number | undefined;
  let mappedEpisode: number | undefined;

  let hasFullRomaji = false;
  try {
    const azRes = await fetchWithTimeout(
      `https://api.ani.zip/mappings?themoviedb_id=${encodeURIComponent(target.tmdbId)}`,
      { timeoutMs: 1400, headers: { Accept: 'application/json' } }
    );
    if (azRes.status === 200) {
      const az = JSON.parse(azRes.text) as {
        titles?: Record<string, string>;
        mappings?: { imdb_id?: string; mal_id?: number; anilist_id?: number };
        episodes?: Record<
          string,
          { seasonNumber?: number; episodeNumber?: number; absoluteEpisodeNumber?: number }
        >;
      };
      if (az.titles && Object.keys(az.titles).length > 0) {
        isAnime = true;
        const xjat = az.titles['x-jat'];
        if (xjat && xjat.length > 5 && /[a-z]{3}/i.test(xjat)) {
          pushTitle(xjat);
          hasFullRomaji = true;
        }
        pushTitle(az.titles.en);
        pushTitle(az.titles.pt);
      }
      if (az.mappings?.imdb_id) {
        imdbId = imdbId || az.mappings.imdb_id;
        tmdbToImdbCache.set(`tv:${target.tmdbId}`, az.mappings.imdb_id);
      }
      if (typeof az.mappings?.mal_id === 'number') malId = az.mappings.mal_id;
      if (typeof az.mappings?.anilist_id === 'number') anilistId = az.mappings.anilist_id;

      if (az.episodes) {
        for (const epObj of Object.values(az.episodes)) {
          // Exact season & episode match
          if (
            epObj.seasonNumber === target.season &&
            epObj.episodeNumber === target.episode &&
            typeof epObj.absoluteEpisodeNumber === 'number'
          ) {
            absoluteEpisode = epObj.absoluteEpisodeNumber;
            mappedSeason = epObj.seasonNumber;
            mappedEpisode = epObj.episodeNumber;
            break;
          }
          // Target episode matches absolute episode (e.g. One Piece ep 818)
          if (
            typeof epObj.absoluteEpisodeNumber === 'number' &&
            epObj.absoluteEpisodeNumber === target.episode
          ) {
            absoluteEpisode = epObj.absoluteEpisodeNumber;
            mappedSeason = epObj.seasonNumber;
            mappedEpisode = epObj.episodeNumber;
            break;
          }
        }
      }
    }
  } catch {
    // ignore ani.zip timeout
  }

  if (!absoluteEpisode && target.episode >= 50) {
    absoluteEpisode = target.episode;
  }

  if (!isAnime) {
    animeContextCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value: null });
    return null;
  }

  // Enrich Romaji title via AniList if ani.zip lacked a full x-jat Romaji title
  if ((!hasFullRomaji || titlePool.length < 2) && (anilistId || malId)) {
    try {
      const query = anilistId
        ? 'query($id:Int){Media(id:$id,type:ANIME){title{romaji english}}}'
        : 'query($id:Int){Media(idMal:$id,type:ANIME){title{romaji english}}}';
      const alRes = await fetchWithTimeout('https://graphql.anilist.co', {
        method: 'POST',
        timeoutMs: 900,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { id: anilistId ?? malId } }),
      });
      if (alRes.status === 200) {
        const alJson = JSON.parse(alRes.text) as {
          data?: { Media?: { title?: { romaji?: string; english?: string } } };
        };
        pushTitle(alJson.data?.Media?.title?.romaji);
        pushTitle(alJson.data?.Media?.title?.english);
      }
    } catch {
      // ignore AniList fallback error
    }
  }

  if (titlePool.length === 0) {
    return null;
  }

  const ctx: AnimeContext = {
    isAnime: true,
    searchTitles: titlePool.slice(0, 3),
    imdbId,
    malId,
    absoluteEpisode,
  };
  animeContextCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value: ctx });
  return ctx;
}

async function resolveImdbForTarget(target: ExtractTarget): Promise<string | undefined> {
  if (target.imdbId && target.imdbId.startsWith('tt')) return target.imdbId;
  const key = `${target.kind}:${target.tmdbId}`;
  const cached = tmdbToImdbCache.get(key);
  if (cached) return cached;
  const curated = CURATED_CATALOG.find((c) => c.tmdbId === target.tmdbId);
  if (curated?.imdbId) {
    tmdbToImdbCache.set(key, curated.imdbId);
    return curated.imdbId;
  }
  const pathStr =
    target.kind === 'movie'
      ? `/movie/${target.tmdbId}/external_ids`
      : `/tv/${target.tmdbId}/external_ids`;
  const data = await fetchTmdbJson<{ imdb_id?: string }>(pathStr, 1500);
  if (data?.imdb_id) {
    tmdbToImdbCache.set(key, data.imdb_id);
    return data.imdb_id;
  }
  return undefined;
}

// ============================================================================
// HIGH-SPEED ANONYMIZED EXTRACTION PIPELINES
// ============================================================================

async function extractWatchPlayPipeline(
  target: ExtractTarget,
  timeoutMs = 1700
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  const pathSuffix =
    target.kind === 'movie'
      ? `movie/${target.tmdbId}`
      : `tvshow/${target.tmdbId}/${target.season}/${target.episode}`;

  const hosts = ['https://v1.watchplay.shop', 'https://v2.watchplay.shop'];
  const out: InternalExtractedStream[] = [];
  const seen = new Set<string>();

  await Promise.allSettled(
    hosts.map(async (host, idx) => {
      const url = `${host}/${pathSuffix}`;
      const res = await fetchWithTimeout(url, {
        referer: 'https://playerflix.ink/',
        timeoutMs,
      });
      if (res.status !== 200) return;
      const m = res.text.match(/url\s*:\s*["']([^"']+)["']/);
      if (!m) return;
      const streamUrl = m[1].replace(/\\\//g, '/');
      if (!streamUrl.startsWith('http') || seen.has(streamUrl)) return;
      seen.add(streamUrl);

      const audioMatch = res.text.match(/window\.MyPlayerAudio\s*=\s*["']([^"']+)["']/);
      const isDub = !audioMatch || /dub/i.test(audioMatch[1]);
      out.push({
        rawUrl: streamUrl,
        referer: `${host}/`,
        format: streamUrl.includes('.mp4') ? 'mp4' : 'hls',
        codec: 'h264',
        idioma: isDub ? 'pt-br' : 'en-us',
        qualidade: '720p HD',
        isPtBr: isDub,
        is4k: false,
        priorityBoost: idx === 0 ? 28 : 20,
      });
    })
  );

  return { streams: out, subtitles: [] };
}

async function extractPlayerFlixPipeline(
  target: ExtractTarget,
  timeoutMs = 1800
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[]; resolvedTitle?: string }> {
  const qs =
    target.kind === 'movie'
      ? `type=movie&id=${target.tmdbId}`
      : `type=tv&id=${target.tmdbId}&season=${target.season}&episode=${target.episode}`;
  const ajaxUrl = `https://playerflix.ink/inc/Ajax.php?${qs}`;
  const refererPage =
    target.kind === 'movie'
      ? `https://playerflix.ink/filme/${target.tmdbId}`
      : `https://playerflix.ink/serie/${target.tmdbId}/${target.season}/${target.episode}`;

  try {
    const res = await fetchWithTimeout(ajaxUrl, {
      referer: refererPage,
      timeoutMs,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    });
    const json = JSON.parse(res.text) as Record<string, unknown>;
    const data = json.data as Record<string, unknown> | undefined;
    if (!json.status || !data) return { streams: [], subtitles: [] };

    const titleObj = data.title as Record<string, unknown> | undefined;
    const baseTitle = String(titleObj?.pt || titleObj?.en || '');
    const resolvedTitle =
      baseTitle && target.kind === 'tv'
        ? `${baseTitle} · T${target.season}E${target.episode}`
        : baseTitle || undefined;

    const options = Array.isArray(data.options)
      ? (data.options as Array<Record<string, unknown>>)
      : [];

    const streams: InternalExtractedStream[] = [];
    const seen = new Set<string>();

    await Promise.allSettled(
      options.map(async (opt) => {
        const embed = String(opt.embed ?? '');
        const lang = opt.lang ? String(opt.lang) : 'pt-br';

        if (embed.includes('embedplayer2.xyz/video/')) {
          const hash = String(opt.embed_id ?? embed.split('/video/')[1] ?? '');
          if (!hash) return;
          const vRes = await fetchWithTimeout(
            `https://embedplayer2.xyz/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`,
            {
              referer: embed,
              timeoutMs: 1400,
              method: 'POST',
              body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent('https://playerflix.ink/')}`,
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
              },
            }
          );
          try {
            const vData = JSON.parse(vRes.text) as Record<string, unknown>;
            const secured = typeof vData.securedLink === 'string' ? vData.securedLink : null;
            const src = typeof vData.videoSource === 'string' ? vData.videoSource : null;
            const chosen = secured?.startsWith('http') ? secured : src?.startsWith('http') ? src : null;
            if (chosen && !seen.has(chosen)) {
              seen.add(chosen);
              const isPt = /pt|br/i.test(lang);
              streams.push({
                rawUrl: chosen,
                referer: 'https://embedplayer2.xyz/',
                format: 'hls',
                codec: 'h264',
                idioma: lang,
                qualidade: '720p HD',
                isPtBr: isPt,
                is4k: false,
                priorityBoost: isPt ? 32 : 12,
                resolvedTitle,
              });
            }
          } catch {
            // ignore
          }
        }
      })
    );

    return { streams, subtitles: [], resolvedTitle };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

async function extractMultiNodePipeline(
  target: ExtractTarget,
  timeoutMs = 2200
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  const endpointBase =
    target.kind === 'movie'
      ? `https://f.rivo.st/api/source/movie/${target.tmdbId}?`
      : `https://f.rivo.st/api/source/tv/${target.tmdbId}?season=${target.season}&episode=${target.episode}&`;

  const servers = ['6', '1', '5'];
  const streams: InternalExtractedStream[] = [];
  const subtitles: InternalSubtitle[] = [];
  const seenUrls = new Set<string>();
  const seenSubs = new Set<string>();

  await Promise.allSettled(
    servers.map(async (srv) => {
      const endpoint = `${endpointBase}server=${srv}`;
      const res = await fetchWithTimeout(endpoint, {
        referer: 'https://f.rivo.st/',
        timeoutMs,
        headers: { Accept: 'application/json' },
      });
      if (res.status !== 200) return;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(res.text) as Record<string, unknown>;
      } catch {
        return;
      }

      const list =
        (Array.isArray(obj.sources) && obj.sources) ||
        (Array.isArray(obj.streams) && obj.streams) ||
        (Array.isArray(obj.data) && obj.data) ||
        [];

      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const streamUrl = String(entry.url ?? entry.file ?? entry.src ?? '');
        if (!streamUrl.startsWith('http') || seenUrls.has(streamUrl)) continue;
        seenUrls.add(streamUrl);

        const quality = entry.quality ? String(entry.quality) : entry.label ? String(entry.label) : null;
        const isMp4 = streamUrl.includes('.mp4') || entry.kind === 'mp4';
        const hevc = isLikelyHevcStream(streamUrl, quality);
        const audioMeta = formatAudioDisplay(entry.lang ? String(entry.lang) : null, quality);
        const is4k = isUltraHdQuality(quality);

        streams.push({
          rawUrl: streamUrl,
          referer: 'https://f.rivo.st/',
          format: isMp4 ? 'mp4' : 'hls',
          codec: hevc ? 'h265' : 'h264',
          idioma: audioMeta.isPtBr ? 'pt-br' : entry.lang ? String(entry.lang) : null,
          qualidade: quality,
          isPtBr: audioMeta.isPtBr,
          is4k,
          priorityBoost: srv === '5' ? 28 : srv === '6' ? 24 : srv === '1' ? 18 : 12,
        });
      }

      const subs = Array.isArray(obj.subtitles) ? obj.subtitles : [];
      for (const subItem of subs) {
        if (!subItem || typeof subItem !== 'object') continue;
        const sub = subItem as Record<string, unknown>;
        const subUrl = String(sub.url ?? sub.file ?? '');
        if (!subUrl.startsWith('http')) continue;
        const rawLang = String(sub.lang ?? '');
        const rawLabel = String(sub.label ?? rawLang);
        const norm = normalizeSubtitleLang(rawLang, rawLabel);
        const dedupeKey = `${norm.lang}::${norm.label}`;
        if (seenSubs.has(dedupeKey)) continue;
        seenSubs.add(dedupeKey);
        subtitles.push({
          rawUrl: subUrl,
          referer: 'https://f.rivo.st/',
          lang: norm.lang,
          label: norm.label,
        });
      }
    })
  );

  return { streams, subtitles };
}

// Horcrux Direct (https://stream.hls.lol/q62) — ~90-255ms FHD/4K HLS + Subtitles
async function extractHorcruxPipeline(
  target: ExtractTarget,
  timeoutMs = 1500
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  const url =
    target.kind === 'movie'
      ? `https://stream.hls.lol/q62?tmdbId=${encodeURIComponent(target.tmdbId)}`
      : `https://stream.hls.lol/q62?tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`;
  try {
    const res = await fetchWithTimeout(url, {
      referer: 'https://atlantic.bz/',
      timeoutMs,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
    });
    if (res.status !== 200) return { streams: [], subtitles: [] };
    const json = JSON.parse(res.text) as {
      releases?: Array<{
        title?: string;
        resolution?: string;
        height?: number;
        audioLocales?: string[];
        master?: string;
        dash?: string;
        subtitles?: Array<{ locale?: string; lang?: string; url: string }>;
      }>;
    };
    const streams: InternalExtractedStream[] = [];
    const subtitles: InternalSubtitle[] = [];
    for (const rel of json.releases ?? []) {
      const mUrl = rel.master || rel.dash;
      if (!mUrl || !mUrl.startsWith('http')) continue;
      const locales = (rel.audioLocales ?? []).join(' ');
      const isPt = /\b(pt|pt-br|pb|por|brazil)\b/i.test(`${locales} ${rel.title ?? ''}`);
      const is4k = (rel.height ?? 0) >= 2160 || /4k|2160|uhd/i.test(`${rel.resolution ?? ''} ${rel.title ?? ''}`);
      const quality = is4k
        ? '4K UHD'
        : rel.height
          ? `${rel.height}p`
          : rel.resolution?.includes('1080')
            ? '1080p'
            : '720p';
      streams.push({
        rawUrl: mUrl,
        referer: 'https://atlantic.bz/',
        format: mUrl.includes('.mp4') ? 'mp4' : 'hls',
        codec: 'h264',
        idioma: isPt ? 'pt-br' : rel.audioLocales?.[0] ?? 'en-us',
        qualidade: quality,
        isPtBr: isPt,
        is4k,
        priorityBoost: isPt ? 55 : 32,
      });

      // Parse embedded subtitles
      for (const sub of rel.subtitles ?? []) {
        if (sub.url && sub.url.startsWith('http')) {
          const lcode = (sub.locale || sub.lang || 'pt-BR').toLowerCase();
          const isPtSub = /\b(pt|pt-br|pb|por|brazil)\b/i.test(lcode);
          subtitles.push({
            rawUrl: sub.url,
            referer: 'https://atlantic.bz/',
            lang: isPtSub ? 'pt-br' : lcode,
            label: isPtSub ? 'Português (Brasil)' : lcode.toUpperCase(),
          });
        }
      }
    }
    return { streams, subtitles };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

// Generic Stremio Addon Parser (Veyra, King VOD, Fênix 4K, Brazuca, Pleiades, Zeus BR, SuperStream)
interface StremioStreamItem {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
  };
  subtitles?: Array<{ id?: string; lang?: string; url?: string }>;
}

async function resolveRedirectLocationFast(
  rawUrl: string,
  referer: string,
  extraHeaders?: Record<string, string>,
  timeoutMs = 1200
): Promise<{ format: 'hls' | 'mp4' }> {
  const inferred = inferStreamFormatFromUrlOrMeta(rawUrl);
  if (rawUrl.includes('.m3u8')) return { format: 'hls' };
  if (rawUrl.includes('.mp4')) return { format: 'mp4' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_UA,
        Range: 'bytes=0-63',
        ...(extraHeaders ?? {}),
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const finalUrl = (res.url || rawUrl).toLowerCase();
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    if (ct.includes('mpegurl') || finalUrl.includes('.m3u8')) {
      return { format: 'hls' };
    }
    if (
      ct.includes('video/mp4') ||
      ct.includes('video/x-matroska') ||
      finalUrl.includes('.mp4') ||
      finalUrl.includes('/movie/play/')
    ) {
      return { format: 'mp4' };
    }
    return { format: inferred };
  } catch {
    return { format: inferred };
  } finally {
    clearTimeout(timer);
  }
}

async function extractStremioAddon(
  opts: {
    baseUrl: string;
    endpointPath: string;
    referer: string;
    timeoutMs: number;
    priorityBoost: number;
    defaultPtBr?: boolean;
    resolveRedirects?: boolean;
    skipIfNotWebReadyHevc?: boolean;
  }
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  const fullUrl = `${opts.baseUrl.replace(/\/$/, '')}${opts.endpointPath}`;
  try {
    const res = await fetchWithTimeout(fullUrl, {
      referer: opts.referer,
      timeoutMs: opts.timeoutMs,
      headers: { Accept: 'application/json' },
    });
    if (res.status !== 200) return { streams: [], subtitles: [] };
    const json = JSON.parse(res.text) as { streams?: StremioStreamItem[] };
    const items = Array.isArray(json.streams) ? json.streams : [];
    if (items.length === 0) return { streams: [], subtitles: [] };

    const streams: InternalExtractedStream[] = [];
    const subtitles: InternalSubtitle[] = [];
    const seenUrls = new Set<string>();
    const seenSubs = new Set<string>();

    const candidates = items.slice(0, 32);
    await Promise.allSettled(
      candidates.map(async (st, idx) => {
        if (!st.url || !st.url.startsWith('http')) return;
        if (seenUrls.has(st.url)) return;
        seenUrls.add(st.url);

        const metaText = `${st.name ?? ''} ${st.title ?? ''} ${st.description ?? ''}`;
        const hevc = isLikelyHevcStream(st.url, metaText);
        const proxyReqHeaders = st.behaviorHints?.proxyHeaders?.request;
        const referer =
          proxyReqHeaders?.Referer || proxyReqHeaders?.referer || opts.referer;

        let format = inferStreamFormatFromUrlOrMeta(st.url, metaText);

        const is4k = /4k|2160p|uhd/i.test(metaText);
        const is1080 = /1080p|fhd/i.test(metaText);
        const is720 = /720p/i.test(metaText);
        const rawQuality = is4k ? '4K UHD' : is1080 ? '1080p Full HD' : is720 ? '720p HD' : 'HD';

        const isPt =
          opts.defaultPtBr ||
          /dublado|pt-br|portugu|🇧🇷|brazil|dual/i.test(metaText) ||
          false;
        const isLegendado = /legendad|sub/i.test(metaText) && !/dublado/i.test(metaText);

        streams.push({
          rawUrl: st.url,
          referer,
          extraHeaders: proxyReqHeaders,
          format,
          codec: hevc ? 'h265' : 'h264',
          idioma: isPt ? 'pt-br' : isLegendado ? 'legendado' : 'en-us',
          qualidade: rawQuality,
          isPtBr: isPt,
          is4k,
          priorityBoost: opts.priorityBoost - idx * 2 + (is4k ? 10 : 0),
        });

        for (const sub of st.subtitles ?? []) {
          if (!sub.url || !sub.url.startsWith('http')) continue;
          const norm = normalizeSubtitleLang(sub.lang || sub.id || 'pt-BR', sub.id || 'Português (BR)');
          const key = `${norm.lang}::${norm.label}`;
          if (seenSubs.has(key)) continue;
          seenSubs.add(key);
          subtitles.push({
            rawUrl: sub.url,
            referer: opts.referer,
            lang: norm.lang,
            label: norm.label,
          });
        }
      })
    );

    return { streams, subtitles };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

// ============================================================================
// BRAZILIAN ANIME STREAM EXTRACTION PIPELINES (AnimesFHD, AnimesDigital, AniTube, Anroll)
// ============================================================================

async function extractAnimesFhdPipeline(
  ctx: AnimeContext,
  target: ExtractTarget,
  timeoutMs = 2600
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  if (target.kind !== 'tv') return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());

  try {
    const searchResults = await Promise.allSettled(
      ctx.searchTitles.slice(0, 2).map(async (q) => {
        const res = await fetchWithTimeout(
          `https://animesfhd.net/api/series?q=${encodeURIComponent(q)}`,
          { referer: 'https://animesfhd.net/', timeoutMs: Math.min(1300, remaining()), headers: { Accept: 'application/json' } }
        );
        if (res.status !== 200) return [];
        const json = JSON.parse(res.text) as {
          series?: Array<{ id?: number | string; title?: string; alt_titles?: string }>;
        };
        return json.series ?? [];
      })
    );

    const flatSeries: Array<{ url: string; title: string; id: string }> = [];
    const seenIds = new Set<string>();
    for (const r of searchResults) {
      if (r.status !== 'fulfilled') continue;
      for (const s of r.value) {
        const idStr = String(s.id ?? '');
        if (!idStr || seenIds.has(idStr)) continue;
        seenIds.add(idStr);
        flatSeries.push({
          id: idStr,
          url: `https://animesfhd.net/api/series/${idStr}`,
          title: `${s.title ?? ''} ${s.alt_titles?.split('\n')[0] ?? ''}`.trim(),
        });
      }
    }

    const picked = pickTopAnimeCandidates(flatSeries, ctx.searchTitles, target.season, 'series', 1);
    const topPick = picked[0];
    if (!topPick) return { streams: [], subtitles: [] };

    const detRes = await fetchWithTimeout(topPick.url, {
      referer: 'https://animesfhd.net/',
      timeoutMs: Math.min(1200, remaining()),
      headers: { Accept: 'application/json' },
    });
    if (detRes.status !== 200) return { streams: [], subtitles: [] };
    const det = JSON.parse(detRes.text) as {
      versions?: Array<{ series_id?: number | string; season?: number; audio?: string }>;
      episodes?: Array<{ id?: number | string; episode_number?: number }>;
    };

    const allVersions = det.versions ?? [];
    const seasonVersions = allVersions.filter((v) => v.season === target.season);
    if (allVersions.length > 0 && seasonVersions.length === 0) {
      return { streams: [], subtitles: [] };
    }
    const targetVersions =
      seasonVersions.length > 0
        ? seasonVersions
        : [{ series_id: topPick.id, season: target.season, audio: 'legendado' }];

    // Deduplicate version series_ids (keep both dublado and legendado!)
    const versionMap = new Map<string, { seriesId: string; audio: string }>();
    for (const v of targetVersions) {
      const sid = String(v.series_id ?? '');
      if (sid && !versionMap.has(sid)) {
        versionMap.set(sid, { seriesId: sid, audio: String(v.audio ?? 'legendado') });
      }
    }

    const epIdsToFetch: Array<{ epId: string; audio: string }> = [];
    await Promise.allSettled(
      [...versionMap.values()].slice(0, 2).map(async (ver) => {
        let eps = ver.seriesId === topPick.id ? det.episodes ?? [] : [];
        if (eps.length === 0) {
          const vr = await fetchWithTimeout(`https://animesfhd.net/api/series/${ver.seriesId}`, {
            referer: 'https://animesfhd.net/',
            timeoutMs: Math.min(1100, remaining()),
            headers: { Accept: 'application/json' },
          });
          if (vr.status === 200) {
            const vj = JSON.parse(vr.text) as {
              episodes?: Array<{ id?: number | string; episode_number?: number }>;
            };
            eps = vj.episodes ?? [];
          }
        }
        const epMatch = eps.find((e) => e.episode_number === target.episode);
        if (epMatch?.id) {
          epIdsToFetch.push({ epId: String(epMatch.id), audio: ver.audio });
        }
      })
    );

    if (epIdsToFetch.length === 0) return { streams: [], subtitles: [] };

    const streams: InternalExtractedStream[] = [];
    await Promise.allSettled(
      epIdsToFetch.map(async ({ epId, audio }) => {
        const er = await fetchWithTimeout(`https://animesfhd.net/api/episodes/${epId}`, {
          referer: 'https://animesfhd.net/',
          timeoutMs: Math.min(1100, remaining()),
          headers: { Accept: 'application/json' },
        });
        if (er.status !== 200) return;
        const ej = JSON.parse(er.text) as {
          sources?: Array<{ url?: string; audio?: string }>;
        };
        for (const src of ej.sources ?? []) {
          if (!src.url || !src.url.includes('/api/v/s6')) continue;
          const absUrl = new URL(src.url, 'https://animesfhd.net').toString();
          const isDub = /dub/i.test(`${src.audio ?? ''} ${audio}`);
          streams.push({
            rawUrl: absUrl,
            referer: 'https://animesfhd.net/',
            format: 'hls',
            codec: 'h264',
            idioma: isDub ? 'pt-br' : 'legendado',
            qualidade: '1080p Full HD',
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 72 : 44,
          });
        }
      })
    );

    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

async function extractAnimesDigitalPipeline(
  ctx: AnimeContext,
  target: ExtractTarget,
  timeoutMs = 2800
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  if (target.kind !== 'tv') return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  const cacheKey = `ad:${target.tmdbId}:s${target.season}`;

  try {
    let picked = animeSearchPageCache.get(cacheKey);
    if (!picked || picked.expiresAt <= Date.now()) {
      const searchHits = await Promise.allSettled(
        ctx.searchTitles.slice(0, 2).map(async (q) => {
          const r = await fetchWithTimeout(
            `https://animesdigital.org/?s=${encodeURIComponent(q)}`,
            { referer: 'https://animesdigital.org/', timeoutMs: Math.min(1300, remaining()) }
          );
          if (r.status !== 200) return [];
          const out: Array<{ url: string; title: string }> = [];
          const regex = /<a[^>]+href="(https:\/\/animesdigital\.org\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
          for (const m of r.text.matchAll(regex)) {
            const url = m[1];
            const slugTitle = url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? '';
            const innerTitle = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            out.push({ url, title: innerTitle.length > 3 ? innerTitle : slugTitle });
          }
          return out;
        })
      );

      const allCandidates: Array<{ url: string; title: string }> = [];
      const seen = new Set<string>();
      for (const res of searchHits) {
        if (res.status !== 'fulfilled') continue;
        for (const c of res.value) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            allCandidates.push(c);
          }
        }
      }
      const chosen = pickTopAnimeCandidates(allCandidates, ctx.searchTitles, target.season, 'series', 1);
      if (chosen.length === 0) return { streams: [], subtitles: [] };
      picked = {
        expiresAt: Date.now() + 30 * 60 * 1000,
        value: chosen.map((c) => ({ url: c.url, title: c.title, audioKind: c.audioKind })),
      };
      animeSearchPageCache.set(cacheKey, picked);
    }

    const streams: InternalExtractedStream[] = [];
    const seenM3u8 = new Set<string>();

    await Promise.allSettled(
      picked.value.map(async (animePage) => {
        const ar = await fetchWithTimeout(animePage.url, {
          referer: 'https://animesdigital.org/',
          timeoutMs: Math.min(1200, remaining()),
        });
        if (ar.status !== 200) return;

        const epEntries: Array<{ url: string; text: string }> = [];
        const epRegex = /<a[^>]+href="(https:\/\/animesdigital\.org\/video\/a\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        for (const m of ar.text.matchAll(epRegex)) {
          epEntries.push({
            url: m[1],
            text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          });
        }

        const pageSeason = extractSeasonHint(animePage.title, ctx.searchTitles);
        const requireAbsoluteOnly = target.season > 1 && pageSeason !== target.season;
        const matchedEp = matchExactEpisode(epEntries, target.episode, ctx.absoluteEpisode, requireAbsoluteOnly);
        if (!matchedEp) return;

        const vr = await fetchWithTimeout(matchedEp.url, {
          referer: animePage.url,
          timeoutMs: Math.min(1200, remaining()),
        });
        if (vr.status !== 200) return;

        const m3u8Urls = extractAnivideoM3u8Urls(vr.text);
        const isDub = animePage.audioKind === 'dublado' || detectTitleAudioKind(animePage.title) === 'dublado';
        for (const mUrl of m3u8Urls) {
          if (seenM3u8.has(mUrl)) continue;
          seenM3u8.add(mUrl);
          streams.push({
            rawUrl: mUrl,
            referer: 'https://api.anivideo.net/',
            format: 'hls',
            codec: 'h264',
            idioma: isDub ? 'pt-br' : 'legendado',
            qualidade: '720p HD',
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 68 : 42,
          });
        }
      })
    );

    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

async function extractAniTubePipeline(
  ctx: AnimeContext,
  target: ExtractTarget,
  timeoutMs = 2800
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  if (target.kind !== 'tv') return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  const cacheKey = `at:${target.tmdbId}:s${target.season}`;

  try {
    let picked = animeSearchPageCache.get(cacheKey);
    if (!picked || picked.expiresAt <= Date.now()) {
      const searchHits = await Promise.allSettled(
        ctx.searchTitles.slice(0, 2).map(async (q) => {
          const r = await fetchWithTimeout(
            `https://www.anitube.zip/?s=${encodeURIComponent(q)}`,
            { referer: 'https://www.anitube.zip/', timeoutMs: Math.min(1300, remaining()) }
          );
          if (r.status !== 200) return [];
          const out: Array<{ url: string; title: string }> = [];
          const regex = /<a[^>]+href="(https:\/\/www\.anitube\.zip\/video\/\d+\/?)"[^>]*title="([^"]+)"/gi;
          for (const m of r.text.matchAll(regex)) {
            out.push({ url: m[1], title: m[2] });
          }
          return out;
        })
      );

      const allCandidates: Array<{ url: string; title: string }> = [];
      const seen = new Set<string>();
      for (const res of searchHits) {
        if (res.status !== 'fulfilled') continue;
        for (const c of res.value) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            allCandidates.push(c);
          }
        }
      }
      const chosen = pickTopAnimeCandidates(allCandidates, ctx.searchTitles, target.season, 'series', 1);
      if (chosen.length === 0) return { streams: [], subtitles: [] };
      picked = {
        expiresAt: Date.now() + 30 * 60 * 1000,
        value: chosen.map((c) => ({ url: c.url, title: c.title, audioKind: c.audioKind })),
      };
      animeSearchPageCache.set(cacheKey, picked);
    }

    const streams: InternalExtractedStream[] = [];
    const seenM3u8 = new Set<string>();

    await Promise.allSettled(
      picked.value.map(async (seriesPage) => {
        const sr = await fetchWithTimeout(seriesPage.url, {
          referer: 'https://www.anitube.zip/',
          timeoutMs: Math.min(1200, remaining()),
        });
        if (sr.status !== 200) return;

        const epEntries: Array<{ url: string; text: string }> = [];
        const epRegex = /<a[^>]+href="(https:\/\/www\.anitube\.zip\/video\/\d+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
        for (const m of sr.text.matchAll(epRegex)) {
          if (m[1] === seriesPage.url) continue;
          epEntries.push({
            url: m[1],
            text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          });
        }

        const pageSeason = extractSeasonHint(seriesPage.title, ctx.searchTitles);
        const requireAbsoluteOnly = target.season > 1 && pageSeason !== target.season;
        const matchedEp = matchExactEpisode(epEntries, target.episode, ctx.absoluteEpisode, requireAbsoluteOnly);
        if (!matchedEp) return;

        const vr = await fetchWithTimeout(matchedEp.url, {
          referer: seriesPage.url,
          timeoutMs: Math.min(1200, remaining()),
        });
        if (vr.status !== 200) return;

        const m3u8Urls = extractAnivideoM3u8Urls(vr.text);
        const isDub = seriesPage.audioKind === 'dublado' || detectTitleAudioKind(seriesPage.title) === 'dublado';
        for (const mUrl of m3u8Urls) {
          if (seenM3u8.has(mUrl)) continue;
          seenM3u8.add(mUrl);
          streams.push({
            rawUrl: mUrl,
            referer: 'https://api.anivideo.net/',
            format: 'hls',
            codec: 'h264',
            idioma: isDub ? 'pt-br' : 'legendado',
            qualidade: '720p HD',
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 66 : 40,
          });
        }
      })
    );

    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

async function extractAnrollPipeline(
  ctx: AnimeContext,
  target: ExtractTarget,
  timeoutMs = 2900
): Promise<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[] }> {
  if (target.kind !== 'tv') return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  const cacheKey = `ar:${target.tmdbId}:s${target.season}`;

  try {
    let picked = animeSearchPageCache.get(cacheKey);
    if (!picked || picked.expiresAt <= Date.now()) {
      const searchHits = await Promise.allSettled(
        ctx.searchTitles.slice(0, 2).map(async (q) => {
          const r = await fetchWithTimeout(
            `https://anroll.cc/?s=${encodeURIComponent(q)}`,
            { referer: 'https://anroll.cc/', timeoutMs: Math.min(1300, remaining()) }
          );
          if (r.status !== 200) return [];
          const out: Array<{ url: string; title: string }> = [];
          const regex = /<a[^>]+href=["'](https:\/\/anroll\.cc\/animes\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          for (const m of r.text.matchAll(regex)) {
            const url = m[1];
            if (url.endsWith('/animes/')) continue;
            const slugTitle = url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? '';
            const innerTitle = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            out.push({ url, title: innerTitle.length > 3 ? innerTitle : slugTitle });
          }
          return out;
        })
      );

      const allCandidates: Array<{ url: string; title: string }> = [];
      const seen = new Set<string>();
      for (const res of searchHits) {
        if (res.status !== 'fulfilled') continue;
        for (const c of res.value) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            allCandidates.push(c);
          }
        }
      }
      const chosen = pickTopAnimeCandidates(allCandidates, ctx.searchTitles, target.season, 'series', 1);
      if (chosen.length === 0) return { streams: [], subtitles: [] };
      picked = {
        expiresAt: Date.now() + 30 * 60 * 1000,
        value: chosen.map((c) => ({ url: c.url, title: c.title, audioKind: c.audioKind })),
      };
      animeSearchPageCache.set(cacheKey, picked);
    }

    const streams: InternalExtractedStream[] = [];
    const seenMp4 = new Set<string>();

    await Promise.allSettled(
      picked.value.map(async (animePage) => {
        const ar = await fetchWithTimeout(animePage.url, {
          referer: 'https://anroll.cc/',
          timeoutMs: Math.min(1200, remaining()),
        });
        if (ar.status !== 200) return;

        const epEntries: Array<{ url: string; text: string }> = [];
        const epRegex = /<a[^>]+href=["'](https:\/\/anroll\.cc\/episodios\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        for (const m of ar.text.matchAll(epRegex)) {
          epEntries.push({
            url: m[1],
            text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          });
        }

        const pageSeason = extractSeasonHint(animePage.title, ctx.searchTitles);
        const requireAbsoluteOnly = target.season > 1 && pageSeason !== target.season;
        const matchedEp = matchExactEpisode(epEntries, target.episode, ctx.absoluteEpisode, requireAbsoluteOnly);
        if (!matchedEp) return;

        const er = await fetchWithTimeout(matchedEp.url, {
          referer: animePage.url,
          timeoutMs: Math.min(1100, remaining()),
        });
        if (er.status !== 200) return;

        const optMatch = er.text.match(
          /data-type=["']([^"']+)["']\s+data-post=["'](\d+)["']\s+data-nume=["']([^"']+)["']/i
        );
        if (!optMatch) return;

        const dpRes = await fetchWithTimeout(
          `https://anroll.cc/wp-json/dooplayer/v2/${optMatch[2]}/${optMatch[1]}/${optMatch[3]}`,
          { referer: matchedEp.url, timeoutMs: Math.min(1000, remaining()), headers: { Accept: 'application/json' } }
        );
        if (dpRes.status !== 200) return;
        const dpJson = JSON.parse(dpRes.text) as { embed_url?: string };
        if (!dpJson.embed_url) return;

        const bloggerUrl = decodeAnrollBloggerSource(dpJson.embed_url);
        if (!bloggerUrl || !bloggerUrl.includes('blogger.com')) return;

        const br = await fetchWithTimeout(bloggerUrl, {
          referer: 'https://www.blogger.com/',
          timeoutMs: Math.min(1100, remaining()),
        });
        if (br.status !== 200) return;

        const mp4Options = extractBloggerMp4Urls(br.text);
        const isDub = animePage.audioKind === 'dublado' || detectTitleAudioKind(animePage.title) === 'dublado';
        // Keep highest quality playable MP4 option (e.g. 720p)
        for (const mp4 of mp4Options.slice(0, 1)) {
          if (seenMp4.has(mp4.url)) continue;
          seenMp4.add(mp4.url);
          streams.push({
            rawUrl: mp4.url,
            referer: 'https://www.blogger.com/',
            format: 'mp4',
            codec: 'h264',
            idioma: isDub ? 'pt-br' : 'legendado',
            qualidade: mp4.quality,
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 56 : 32,
          });
        }
      })
    );

    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}

// ============================================================================
// HOST REPUTATION & PRE-FLIGHT STREAM VERIFICATION ENGINE
// ============================================================================

interface HostHealthEntry {
  ok: number;
  fail: number;
  avgMs: number;
  lastFailAt: number;
}

const hostHealthMap = new Map<string, HostHealthEntry>();

function recordHostHealth(rawUrl: string, ok: boolean, latencyMs: number) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const prev = hostHealthMap.get(host) ?? { ok: 0, fail: 0, avgMs: latencyMs, lastFailAt: 0 };
    if (ok) {
      prev.ok += 1;
      prev.avgMs = Math.round(prev.avgMs * 0.6 + latencyMs * 0.4);
    } else {
      prev.fail += 1;
      prev.lastFailAt = Date.now();
    }
    hostHealthMap.set(host, prev);
  } catch {
    // ignore invalid host
  }
}

function getHostPenaltyBoost(rawUrl: string): number {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const h = hostHealthMap.get(host);
    if (!h) return 0;
    const total = h.ok + h.fail;
    if (total === 0) return 0;
    const failRatio = h.fail / total;
    if (failRatio > 0.65 && Date.now() - h.lastFailAt < 180_000) return -60;
    if (h.ok >= 2 && failRatio < 0.25) return 20;
    return 0;
  } catch {
    return 0;
  }
}

async function readHeadBytesWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes = 4096
): Promise<{ ok: boolean; status: number; finalUrl: string; contentType: string; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') ?? '';
    const finalUrl = res.url || url;
    if (!res.ok && res.status !== 206) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      return { ok: false, status: res.status, finalUrl, contentType, bytes: new Uint8Array(0) };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (total < maxBytes) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const remaining = maxBytes - total;
          const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
          chunks.push(slice);
          total += slice.byteLength;
          if (total >= maxBytes) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      } catch {
        // ignore partial cancel errors
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { ok: true, status: res.status, finalUrl, contentType, bytes: merged };
  } catch {
    return { ok: false, status: 0, finalUrl: url, contentType: '', bytes: new Uint8Array(0) };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyStreamCandidate(
  st: InternalExtractedStream
): Promise<InternalExtractedStream | null> {
  if (!isSafeExternalUrl(st.rawUrl)) return null;

  // FenixFlix streams use dynamic redirect tokens (/r/...) which must not be dropped by probe timeouts
  if (st.rawUrl.includes('fenixhub.online') || st.rawUrl.includes('fenixflix')) {
    return {
      ...st,
      format: 'mp4',
      codec: st.codec || 'h264',
      verified: true,
      latencyMs: 120,
    };
  }

  const t0 = Date.now();
  const baseHeaders: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    Range: 'bytes=0-16383',
    ...(st.extraHeaders ?? {}),
  };
  if (st.referer && !baseHeaders.Referer && !baseHeaders.referer) {
    baseHeaders.Referer = st.referer;
    try {
      if (!baseHeaders.Origin && !baseHeaders.origin) {
        baseHeaders.Origin = new URL(st.referer).origin;
      }
    } catch {
      // ignore
    }
  }

  // Give previously flaky hosts a stricter timeout so dead servers drop rapidly
  const hostPenalty = getHostPenaltyBoost(st.rawUrl);
  const probeTimeout = hostPenalty < 0 ? 1100 : 1550;

  const head = await readHeadBytesWithTimeout(st.rawUrl, baseHeaders, probeTimeout, 16384);
  const latencyMs = Date.now() - t0;

  if (!head.ok || head.bytes.byteLength < 8) {
    recordHostHealth(st.rawUrl, false, latencyMs);
    return null;
  }

  const ctLower = head.contentType.toLowerCase();
  const finalLower = head.finalUrl.toLowerCase();
  const textSample = new TextDecoder('utf-8', { fatal: false }).decode(head.bytes);
  const trimmedText = textSample.replace(/^\uFEFF/, '').trimStart();

  // Reject HTML / Cloudflare challenge / JSON error bodies
  if (
    trimmedText.startsWith('<!') ||
    trimmedText.startsWith('<html') ||
    trimmedText.startsWith('{')
  ) {
    recordHostHealth(st.rawUrl, false, latencyMs);
    return null;
  }

  let detectedQualidade = st.qualidade;
  let detectedIs4k = st.is4k;
  let detectedBitrateBps: number | undefined;
  let detectedWidth: number | undefined;
  let detectedHeight: number | undefined;

  // Case 1: HLS Playlist (#EXTM3U)
  if (trimmedText.startsWith('#EXTM3U') || /\n#EXTM3U/.test(trimmedText)) {
    const hlsHevc = /codecs="[^"]*(hvc1|hev1)/i.test(textSample) || st.codec === 'h265';
    const masterDims = parseHlsMasterMaxDimensions(trimmedText);
    if (masterDims) {
      detectedQualidade = masterDims.meta.quality;
      detectedIs4k = masterDims.meta.is4k;
      detectedWidth = masterDims.meta.width;
      detectedHeight = masterDims.meta.height;
      if (masterDims.bandwidth > 0) detectedBitrateBps = masterDims.bandwidth;
    }

    // Verify first variant playlist AND first media segment (up to 2 hops) + inspect real pixel dims
    const pickFirstPlayableLine = (playlistText: string, truncated: boolean): string | undefined => {
      const rawLines = playlistText.split(/\r?\n/);
      const safeLines = truncated && rawLines.length > 1 ? rawLines.slice(0, -1) : rawLines;
      return safeLines.map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    };

    const hop1Line = pickFirstPlayableLine(trimmedText, head.bytes.byteLength >= 16384);
    if (hop1Line) {
      try {
        const hop1Url = new URL(hop1Line, head.finalUrl).toString();
        const hop1Probe = await readHeadBytesWithTimeout(hop1Url, baseHeaders, 1500, 16384);
        if (!hop1Probe.ok || hop1Probe.bytes.byteLength < 8) {
          recordHostHealth(st.rawUrl, false, Date.now() - t0);
          return null;
        }
        const hop1Text = new TextDecoder('utf-8', { fatal: false })
          .decode(hop1Probe.bytes)
          .replace(/^\uFEFF/, '')
          .trimStart();
        if (hop1Text.startsWith('<!') || hop1Text.startsWith('<html') || hop1Text.startsWith('{')) {
          recordHostHealth(st.rawUrl, false, Date.now() - t0);
          return null;
        }

        // If hop1 was a variant playlist (#EXTM3U), verify its first actual media segment too!
        if (hop1Text.startsWith('#EXTM3U') || /\n#EXTM3U/.test(hop1Text)) {
          const segLine = pickFirstPlayableLine(hop1Text, hop1Probe.bytes.byteLength >= 16384);
          if (!segLine) {
            recordHostHealth(st.rawUrl, false, Date.now() - t0);
            return null;
          }
          const segUrl = new URL(segLine, hop1Probe.finalUrl).toString();
          const segProbe = await readHeadBytesWithTimeout(
            segUrl,
            { ...baseHeaders, Range: 'bytes=0-16383' },
            1350,
            16384
          );
          if (!segProbe.ok || segProbe.bytes.byteLength < 8) {
            recordHostHealth(st.rawUrl, false, Date.now() - t0);
            return null;
          }
          const segText = new TextDecoder('utf-8', { fatal: false }).decode(segProbe.bytes).trimStart();
          if (segText.startsWith('<!') || segText.startsWith('<html')) {
            recordHostHealth(st.rawUrl, false, Date.now() - t0);
            return null;
          }
          if (!masterDims) {
            const spsMeta = parseH264SpsFromSegmentBytes(segProbe.bytes);
            if (spsMeta) {
              detectedQualidade = spsMeta.quality;
              detectedIs4k = spsMeta.is4k;
              detectedWidth = spsMeta.width;
              detectedHeight = spsMeta.height;
            }
          }
        } else if (!masterDims) {
          // hop1 WAS already a direct media segment (single-bitrate playlist)
          const spsMeta = parseH264SpsFromSegmentBytes(hop1Probe.bytes);
          if (spsMeta) {
            detectedQualidade = spsMeta.quality;
            detectedIs4k = spsMeta.is4k;
            detectedWidth = spsMeta.width;
            detectedHeight = spsMeta.height;
          }
        }
      } catch {
        recordHostHealth(st.rawUrl, false, Date.now() - t0);
        return null;
      }
    }

    const totalLatency = Date.now() - t0;
    recordHostHealth(st.rawUrl, true, totalLatency);
    return {
      ...st,
      format: 'hls',
      codec: hlsHevc ? 'h265' : 'h264',
      qualidade: detectedQualidade,
      is4k: detectedIs4k,
      bitrateBps: detectedBitrateBps,
      videoWidth: detectedWidth,
      videoHeight: detectedHeight,
      verified: true,
      latencyMs: totalLatency,
      priorityBoost: st.priorityBoost + hostPenalty,
    };
  }

  // Case 2: MP4 Binary Stream (check ftyp/moov + avc1 vs hvc1/hev1 + true tkhd pixel dimensions)
  const sig = detectStreamFormat(ctLower, head.bytes);
  const looksMp4 =
    sig.formato === 'mp4' ||
    ctLower.includes('video/mp4') ||
    finalLower.includes('.mp4');

  if (looksMp4) {
    const mp4Codec = detectMp4CodecFromBytes(head.bytes);
    const resolvedCodec: 'h264' | 'h265' =
      mp4Codec !== 'unknown' ? mp4Codec : st.codec;
    const mp4Dims = parseMp4TkhdDimensions(head.bytes);
    if (mp4Dims) {
      detectedQualidade = mp4Dims.quality;
      detectedIs4k = mp4Dims.is4k;
      detectedWidth = mp4Dims.width;
      detectedHeight = mp4Dims.height;
    }
    recordHostHealth(st.rawUrl, true, latencyMs);
    return {
      ...st,
      format: 'mp4',
      codec: resolvedCodec,
      qualidade: detectedQualidade,
      is4k: detectedIs4k,
      videoWidth: detectedWidth,
      videoHeight: detectedHeight,
      verified: true,
      latencyMs,
      priorityBoost: st.priorityBoost + hostPenalty,
    };
  }

  recordHostHealth(st.rawUrl, false, latencyMs);
  return null;
}

async function verifyStreamsBatch(
  candidates: InternalExtractedStream[]
): Promise<InternalExtractedStream[]> {
  if (candidates.length === 0) return [];
  const results = await Promise.all(
    candidates.map((c) => verifyStreamCandidate(c))
  );
  return results.filter((x): x is InternalExtractedStream => x !== null);
}

// ============================================================================
// PROGRESSIVE STREAMING EXTRACTION ENGINE (SSE + FAST RACE)
// ============================================================================

interface ExtractionJob {
  id: string;
  cacheKey: string;
  startedAt: number;
  done: boolean;
  resolvedTitle?: string;
  rawStreams: InternalExtractedStream[];
  rawSubs: InternalSubtitle[];
  emitter: EventEmitter;
  lastSnapshot: AnonymizedExtractResponse;
}

const activeJobs = new Map<string, ExtractionJob>();

function buildAnonymizedSnapshot(
  rawStreams: InternalExtractedStream[],
  rawSubs: InternalSubtitle[],
  startedAt: number,
  cached: boolean,
  resolvedTitle?: string
): AnonymizedExtractResponse {
  const dedupedStreams: InternalExtractedStream[] = [];
  const seenUrl = new Set<string>();
  for (const st of rawStreams) {
    if (!seenUrl.has(st.rawUrl)) {
      seenUrl.add(st.rawUrl);
      dedupedStreams.push(st);
    }
  }

  const ranked = sortBrowserCompatibleFirst(
    dedupedStreams.map((s) => ({
      ...s,
      url: s.rawUrl,
      formato: s.format,
    }))
  );

  // Keep H.264 verified servers first; cap HEVC entries to 2 at the very bottom if H.264 exists
  const h264Only = ranked.filter((r) => r.codec !== 'h265');
  const hevcTail = ranked.filter((r) => r.codec === 'h265');
  const curatedSelection = [...h264Only, ...hevcTail].slice(0, 64);

  const anonymizedStreams: AnonymizedStream[] = curatedSelection.map((item, idx) => {
    const streamId = registerStream(item.rawUrl, item.referer, item.format, item.extraHeaders);
    const qMeta = formatQualityDisplay(item.qualidade);
    const aMeta = formatAudioDisplay(item.idioma, item.qualidade);
    const ext = item.format === 'mp4' ? 'media.mp4' : 'master.m3u8';
    return {
      id: streamId,
      label: `Servidor ${idx + 1}`,
      audio: aMeta.audio,
      quality: qMeta.quality,
      codec: item.codec,
      format: item.format,
      isPtBr: aMeta.isPtBr || item.isPtBr,
      is4k: qMeta.is4k || item.is4k,
      streamUrl: `/api/stream/${streamId}/${ext}`,
    };
  });

  const subMap = new Map<string, InternalSubtitle>();
  for (const sub of rawSubs) {
    const key = `${sub.lang}::${sub.label}`;
    if (!subMap.has(key)) subMap.set(key, sub);
  }
  const sortedSubs = [...subMap.values()].sort((a, b) => {
    const ra = normalizeSubtitleLang(a.lang, a.label).rank;
    const rb = normalizeSubtitleLang(b.lang, b.label).rank;
    return rb - ra;
  });
  const anonymizedSubtitles: AnonymizedSubtitle[] = sortedSubs.slice(0, 14).map((sub) => {
    const subId = registerSubtitle(sub.rawUrl, sub.referer, sub.lang, sub.label, sub.extraHeaders);
    return {
      id: subId,
      lang: sub.lang,
      label: sub.label,
      trackUrl: `/api/subtitle/${subId}.vtt`,
    };
  });

  return {
    elapsedMs: Date.now() - startedAt,
    cached,
    resolvedTitle,
    streams: anonymizedStreams,
    subtitles: anonymizedSubtitles,
  };
}

function launchAllPipelines(
  parsed: ExtractTarget,
  imdbPromise: Promise<string | undefined>,
  onBatch: (batch: {
    streams: InternalExtractedStream[];
    subtitles: InternalSubtitle[];
    resolvedTitle?: string;
  }) => void
): Promise<void> {
  const runAndVerify = async (
    task: Promise<{
      streams: InternalExtractedStream[];
      subtitles: InternalSubtitle[];
      resolvedTitle?: string;
    }>
  ) => {
    try {
      const res = await task;
      const verifiedStreams = await verifyStreamsBatch(res.streams);
      if (verifiedStreams.length > 0 || res.subtitles.length > 0 || res.resolvedTitle) {
        onBatch({
          streams: verifiedStreams,
          subtitles: res.subtitles,
          resolvedTitle: res.resolvedTitle,
        });
      }
    } catch {
      // ignore failed pipeline
    }
  };

  // Launch TMDB-ID pipelines at t=0ms with ZERO blocking on external_ids lookup
  const tier1Tasks: Array<Promise<void>> = [
    runAndVerify(extractWatchPlayPipeline(parsed, 1500)),
    runAndVerify(extractHorcruxPipeline(parsed, 1200)),
    runAndVerify(extractMultiNodePipeline(parsed, 2200)),
    runAndVerify(extractPlayerFlixPipeline(parsed, 1600)),
  ];

  // FenixFlix relies strictly on IMDb IDs (tt...) for both movies and series in Tier 2 below
  // Launch IMDb-based Stremio pipelines the instant imdbPromise resolves (~0-180ms)
  const tier2Task = imdbPromise.then(async (imdbId) => {
    if (!imdbId) return;
    const candidatePaths: string[] = [];
    if (parsed.kind === 'movie') {
      candidatePaths.push(`/stream/movie/${imdbId}.json`);
    } else {
      candidatePaths.push(`/stream/series/${imdbId}:${parsed.season}:${parsed.episode}.json`);
      if (parsed.episode >= 50 && parsed.season !== 1) {
        candidatePaths.push(`/stream/series/${imdbId}:1:${parsed.episode}.json`);
      }
    }

    const imdbTasks: Array<Promise<void>> = [];
    for (const epPath of candidatePaths) {
      imdbTasks.push(
        runAndVerify(
          extractStremioAddon({
            baseUrl: 'https://veyra.shardweb.app',
            endpointPath: epPath,
            referer: 'https://veyra.shardweb.app/',
            timeoutMs: 2100,
            priorityBoost: 62,
            defaultPtBr: true,
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: 'https://da5f663b4690-kingvod.baby-beamup.club',
            endpointPath: epPath,
            referer: 'https://da5f663b4690-kingvod.baby-beamup.club/',
            timeoutMs: 1700,
            priorityBoost: 54,
            defaultPtBr: true,
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: 'https://brazuca-play-stremio-y3wf.onrender.com',
            endpointPath: epPath,
            referer: 'https://brazuca-play-stremio-y3wf.onrender.com/',
            timeoutMs: 2600,
            priorityBoost: 56,
            defaultPtBr: true,
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: 'https://zeus-br.shardweb.app/v1-pnv9b-q3j-a1-mb-c0',
            endpointPath: epPath,
            referer: 'https://zeus-br.shardweb.app/',
            timeoutMs: 1400,
            priorityBoost: 40,
            defaultPtBr: true,
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: 'https://da5f663b4690-superstream.baby-beamup.club',
            endpointPath: epPath,
            referer: 'https://da5f663b4690-superstream.baby-beamup.club/',
            timeoutMs: 1400,
            priorityBoost: 16,
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: 'https://fenixflix.fenixhub.online',
            endpointPath: epPath,
            referer: 'https://fenixflix.fenixhub.online/',
            timeoutMs: 7500,
            priorityBoost: 60,
            defaultPtBr: true,
          })
        )
      );
    }

    await Promise.allSettled(imdbTasks);
  });

  // Launch anime-specific PT-BR pipelines in parallel once AnimeContext resolves (~0-250ms)
  const animeTask =
    parsed.kind === 'tv'
      ? resolveAnimeContext(parsed).then(async (ctx) => {
          if (!ctx || !ctx.isAnime) return;
          await Promise.allSettled([
            runAndVerify(extractAnimesFhdPipeline(ctx, parsed, 2800)),
            runAndVerify(extractAnimesDigitalPipeline(ctx, parsed, 2800)),
            runAndVerify(extractAniTubePipeline(ctx, parsed, 2800)),
            runAndVerify(extractAnrollPipeline(ctx, parsed, 2900)),
          ]);
        })
      : Promise.resolve();

  return Promise.allSettled([...tier1Tasks, tier2Task, animeTask]).then(() => {});
}

// ============================================================================
// TMDB API METADATA & CATALOG ENRICHMENT (PT-BR)
// ============================================================================

const TMDB_GENRE_MAP_PT: Record<number, string> = {
  28: 'Ação',
  12: 'Aventura',
  16: 'Animação',
  35: 'Comédia',
  80: 'Crime',
  99: 'Documentário',
  18: 'Drama',
  10751: 'Família',
  14: 'Fantasia',
  36: 'História',
  27: 'Terror',
  10402: 'Música',
  9648: 'Mistério',
  10749: 'Romance',
  878: 'Ficção Científica',
  53: 'Suspense',
  10752: 'Guerra',
  37: 'Faroeste',
  10759: 'Ação e Aventura',
  10765: 'Ficção e Fantasia',
};

function assignStudioNetwork(seed: string): string {
  const networks = ['Netflix', 'Prime Video', 'Disney+', 'Apple TV+', 'HBO Max', 'Paramount+', 'Crunchyroll', 'Starz'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return networks[hash % networks.length];
}

function mapProviderNameToNetwork(providerName: string): string {
  const lower = providerName.toLowerCase();
  if (lower.includes('netflix')) return 'Netflix';
  if (lower.includes('amazon') || lower.includes('prime')) return 'Prime Video';
  if (lower.includes('disney')) return 'Disney+';
  if (lower.includes('apple')) return 'Apple TV+';
  if (lower.includes('max') || lower.includes('hbo')) return 'HBO Max';
  if (lower.includes('paramount')) return 'Paramount+';
  if (lower.includes('crunchyroll')) return 'Crunchyroll';
  if (lower.includes('starz')) return 'Starz';
  return providerName;
}

function mapTmdbSummaryToMediaTitle(raw: Record<string, unknown>, forceType?: 'movie' | 'series'): MediaTitle {
  const rawType = raw.media_type === 'tv' ? 'series' : raw.media_type === 'movie' ? 'movie' : undefined;
  const type: 'movie' | 'series' = forceType ?? rawType ?? (raw.first_air_date ? 'series' : 'movie');
  const tmdbId = String(raw.id ?? '');
  const curated = CURATED_CATALOG.find((c) => c.tmdbId === tmdbId && c.mediaType === type);
  if (curated) return curated;

  const title = String(raw.title || raw.name || 'Sem título');
  const originalTitle = String(raw.original_title || raw.original_name || title);
  const dateStr = String(raw.release_date || raw.first_air_date || '2025');
  const year = dateStr.slice(0, 4) || '2025';
  const genreIds = Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : [];
  const genres = genreIds
    .map((id) => TMDB_GENRE_MAP_PT[id])
    .filter(Boolean)
    .slice(0, 3);
  if (genres.length === 0) genres.push('Cinema');

  const vote = typeof raw.vote_average === 'number' && raw.vote_average > 0 ? raw.vote_average.toFixed(1) : '7.6';
  const posterPath = typeof raw.poster_path === 'string' ? `${TMDB_IMG}/w500${raw.poster_path}` : '';
  const backdropPath = typeof raw.backdrop_path === 'string' ? `${TMDB_IMG}/w1280${raw.backdrop_path}` : posterPath;

  const isKidFriendly =
    genres.some((g) => /animação|família|kids|infantil/i.test(g)) ||
    genreIds.includes(16) ||
    genreIds.includes(10751) ||
    genreIds.includes(10762);

  return {
    id: `tmdb-${type}-${tmdbId}`,
    imdbId: '',
    tmdbId,
    mediaType: type,
    title,
    originalTitle,
    year,
    runtime: type === 'series' ? '45m / ep' : '2h 00m',
    runtimeMinutes: type === 'series' ? 45 : 120,
    rating: vote,
    ageRating: raw.adult ? '18' : isKidFriendly ? 'L' : '14',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres,
    network: assignStudioNetwork(tmdbId),
    director: 'Produção Original',
    cast: [],
    overview: String(raw.overview || 'Disponível para reprodução imediata em alta definição com áudio em português.'),
    poster: posterPath || '/src/assets/images/poster_nyc_winter_1794566231280.jpg',
    backdrop: backdropPath || '/src/assets/images/cinelume_hero_cinema_1794566229858.jpg',
    defaultSeason: 1,
    defaultEpisode: 1,
  };
}

async function fetchTmdbSeasonEpisodes(tmdbId: string, season: number): Promise<EpisodeItem[]> {
  const key = `${tmdbId}:s${season}`;
  const hit = seasonCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const data = await fetchTmdbJson<{
    episodes?: Array<{
      episode_number?: number;
      name?: string;
      overview?: string;
      air_date?: string;
      still_path?: string;
      runtime?: number;
    }>;
  }>(`/tv/${tmdbId}/season/${season}?language=pt-BR`, 2200);

  const eps: EpisodeItem[] = (data?.episodes ?? []).map((ep) => ({
    id: `${tmdbId}-s${season}-e${ep.episode_number ?? 1}`,
    season,
    episode: ep.episode_number ?? 1,
    title: ep.name || `Episódio ${ep.episode_number ?? 1}`,
    overview: ep.overview || `Temporada ${season}, Episódio ${ep.episode_number ?? 1}.`,
    released: ep.air_date,
    thumbnail: ep.still_path ? `${TMDB_IMG}/w500${ep.still_path}` : undefined,
    runtime: typeof ep.runtime === 'number' && ep.runtime > 0 ? ep.runtime : undefined,
  }));

  if (eps.length > 0) {
    seasonCache.set(key, { expiresAt: Date.now() + META_CACHE_TTL_MS, value: eps });
  }
  return eps;
}

async function fetchTmdbDetailTitle(type: 'movie' | 'series', tmdbId: string): Promise<MediaTitle | null> {
  const cacheKey = `tmdb-detail:${type}:${tmdbId}`;
  const hit = metaCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const tmdbType = type === 'series' ? 'tv' : 'movie';
  const append =
    type === 'movie'
      ? 'images,credits,external_ids,release_dates,watch/providers'
      : 'images,credits,external_ids,content_ratings,watch/providers';

  const [detail, s1Episodes] = await Promise.all([
    fetchTmdbJson<Record<string, unknown>>(
      `/${tmdbType}/${tmdbId}?language=pt-BR&append_to_response=${append}&include_image_language=pt,en,null`,
      2400
    ),
    type === 'series' ? fetchTmdbSeasonEpisodes(tmdbId, 1) : Promise.resolve([]),
  ]);

  if (!detail || !detail.id) return null;

  const curated = CURATED_CATALOG.find((c) => c.tmdbId === String(detail.id) && c.mediaType === type);
  const ext = (detail.external_ids as Record<string, unknown> | undefined) ?? {};
  const imdbId = String(ext.imdb_id || curated?.imdbId || '');
  if (imdbId) tmdbToImdbCache.set(`${type}:${detail.id}`, imdbId);

  const images = (detail.images as { logos?: Array<{ file_path?: string; iso_639_1?: string }> } | undefined) ?? {};
  const pngLogos = (images.logos ?? []).filter(
    (l) => l.file_path && !l.file_path.endsWith('.svg')
  );
  const ptLogo = pngLogos.find((l) => l.iso_639_1 === 'pt') ?? pngLogos[0] ?? images.logos?.[0];
  const logoUrl = ptLogo?.file_path ? `${TMDB_IMG}/w500${ptLogo.file_path}` : curated?.logo;

  const credits = (detail.credits as {
    cast?: Array<{ name?: string; character?: string; profile_path?: string }>;
    crew?: Array<{ name?: string; job?: string }>;
  } | undefined) ?? {};

  const castProfiles: CastMember[] = (credits.cast ?? []).slice(0, 10).map((c) => ({
    name: c.name || 'Ator',
    character: c.character,
    avatar: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : undefined,
  }));

  const directorCrew = (credits.crew ?? []).find((c) => c.job === 'Director');
  const createdBy = Array.isArray(detail.created_by)
    ? (detail.created_by as Array<{ name?: string }>)[0]?.name
    : undefined;
  const director = directorCrew?.name || createdBy || curated?.director || 'Produção Original';

  const genresRaw = Array.isArray(detail.genres)
    ? (detail.genres as Array<{ id?: number; name?: string }>).map(
        (g) => (g.id && TMDB_GENRE_MAP_PT[g.id]) || g.name || ''
      ).filter(Boolean)
    : curated?.genres ?? ['Cinema'];

  const runtimeMins =
    typeof detail.runtime === 'number' && detail.runtime > 0
      ? detail.runtime
      : Array.isArray(detail.episode_run_time) && typeof detail.episode_run_time[0] === 'number'
        ? (detail.episode_run_time[0] as number)
        : curated?.runtimeMinutes ?? (type === 'series' ? 45 : 120);

  // Extract BR watch provider or network
  const providersObj = (detail['watch/providers'] as {
    results?: { BR?: { flatrate?: Array<{ provider_name?: string }> } };
  } | undefined)?.results?.BR?.flatrate;
  const rawNetwork =
    (Array.isArray(detail.networks) && (detail.networks as Array<{ name?: string }>)[0]?.name) ||
    providersObj?.[0]?.provider_name ||
    curated?.network ||
    assignStudioNetwork(String(detail.id));

  // Certification BR
  let ageRating = curated?.ageRating ?? '14';
  if (type === 'movie') {
    const rels = (detail.release_dates as { results?: Array<{ iso_3166_1?: string; release_dates?: Array<{ certification?: string }> }> })?.results ?? [];
    const br = rels.find((r) => r.iso_3166_1 === 'BR') ?? rels.find((r) => r.iso_3166_1 === 'US');
    const cert = br?.release_dates?.find((d) => d.certification)?.certification;
    if (cert) ageRating = cert;
  } else {
    const cr = (detail.content_ratings as { results?: Array<{ iso_3166_1?: string; rating?: string }> })?.results ?? [];
    const br = cr.find((r) => r.iso_3166_1 === 'BR') ?? cr.find((r) => r.iso_3166_1 === 'US');
    if (br?.rating) ageRating = br.rating;
  }

  const title = String(detail.title || detail.name || curated?.title || 'Sem título');
  const dateStr = String(detail.release_date || detail.first_air_date || curated?.year || '2025');

  const merged: MediaTitle = {
    id: curated?.id || `tmdb-${type}-${detail.id}`,
    imdbId,
    tmdbId: String(detail.id),
    mediaType: type,
    title,
    originalTitle: String(detail.original_title || detail.original_name || title),
    year: dateStr.slice(0, 4),
    runtime:
      type === 'series'
        ? `${runtimeMins}m / ep`
        : runtimeMins >= 60
          ? `${Math.floor(runtimeMins / 60)}h ${runtimeMins % 60}m`
          : `${runtimeMins}m`,
    runtimeMinutes: runtimeMins,
    rating:
      typeof detail.vote_average === 'number' && detail.vote_average > 0
        ? detail.vote_average.toFixed(1)
        : curated?.rating ?? '7.8',
    ageRating,
    qualityBadge: curated?.qualityBadge ?? '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: genresRaw.slice(0, 3),
    network: mapProviderNameToNetwork(rawNetwork),
    director,
    cast: castProfiles.length > 0 ? castProfiles.map((c) => c.name) : curated?.cast ?? [],
    castProfiles: castProfiles.length > 0 ? castProfiles : curated?.castProfiles,
    overview: String(detail.overview || curated?.overview || 'Disponível para streaming imediato em alta definição.'),
    poster: detail.poster_path
      ? `${TMDB_IMG}/w500${detail.poster_path}`
      : curated?.poster ?? '/src/assets/images/poster_nyc_winter_1794566231280.jpg',
    backdrop: detail.backdrop_path
      ? `${TMDB_IMG}/w1280${detail.backdrop_path}`
      : curated?.backdrop ?? '/src/assets/images/cinelume_hero_cinema_1794566229858.jpg',
    logo: logoUrl,
    rankToday: curated?.rankToday,
    defaultSeason: curated?.defaultSeason ?? 1,
    defaultEpisode: curated?.defaultEpisode ?? 1,
    seasonsCount:
      typeof detail.number_of_seasons === 'number'
        ? detail.number_of_seasons
        : curated?.seasonsCount ?? 1,
    episodes: s1Episodes.length > 0 ? s1Episodes : curated?.episodes,
  };

  metaCache.set(cacheKey, { expiresAt: Date.now() + META_CACHE_TTL_MS, value: merged });
  return merged;
}

async function fetchTmdbHeroLogo(type: 'movie' | 'series', tmdbId: string): Promise<string | undefined> {
  const tmdbType = type === 'series' ? 'tv' : 'movie';
  const data = await fetchTmdbJson<{
    logos?: Array<{ file_path?: string; iso_639_1?: string }>;
  }>(`/${tmdbType}/${tmdbId}/images?include_image_language=pt,en,null`, 1800);
  const pngs = (data?.logos ?? []).filter((l) => l.file_path && !l.file_path.endsWith('.svg'));
  const pick = pngs.find((l) => l.iso_639_1 === 'pt') ?? pngs.find((l) => l.iso_639_1 === 'en') ?? pngs[0];
  return pick?.file_path ? `${TMDB_IMG}/w500${pick.file_path}` : undefined;
}

interface BrowseCatalogParams {
  mediaType: 'movie' | 'series';
  isKids: boolean;
  page: number;
  genre?: string;
  sort?: string;
}

interface BrowseCatalogResult {
  items: MediaTitle[];
  page: number;
  totalPages: number;
  hasMore: boolean;
}

const TMDB_MOVIE_GENRE_MAP: Record<string, string> = {
  'ação': '28',
  'acao': '28',
  'aventura': '12',
  'comédia': '35',
  'comedia': '35',
  'terror': '27',
  'ficção científica': '878',
  'ficcao cientifica': '878',
  'drama': '18',
  'animação': '16',
  'animacao': '16',
  'romance': '10749',
  'suspense': '53',
  'crime': '80',
  'fantasia': '14',
  'família': '10751',
  'familia': '10751',
};

const TMDB_TV_GENRE_MAP: Record<string, string> = {
  'drama': '18',
  'ação': '10759',
  'acao': '10759',
  'ação & aventura': '10759',
  'comédia': '35',
  'comedia': '35',
  'ficção científica': '10765',
  'sci-fi & fantasia': '10765',
  'suspense': '9648',
  'mistério': '9648',
  'misterio': '9648',
  'crime': '80',
  'animação': '16',
  'animacao': '16',
  'desenhos': '16',
  'documentário': '99',
  'documentario': '99',
  'kids': '10762',
  'infantil': '10762',
  'família': '10751',
  'familia': '10751',
};

async function fetchPaginatedCatalog(params: BrowseCatalogParams): Promise<BrowseCatalogResult> {
  const { mediaType, isKids, page = 1, genre = '', sort = 'popular' } = params;
  const tmdbType = mediaType === 'series' ? 'tv' : 'movie';
  const genreLower = genre.toLowerCase();

  let sortQuery = 'sort_by=popularity.desc';
  if (sort === 'rating') {
    sortQuery = mediaType === 'movie'
      ? 'sort_by=vote_average.desc&vote_count.gte=' + (isKids ? '30' : '150')
      : 'sort_by=vote_average.desc&vote_count.gte=' + (isKids ? '15' : '80');
  } else if (sort === 'new') {
    sortQuery = mediaType === 'movie'
      ? 'sort_by=primary_release_date.desc&vote_count.gte=5'
      : 'sort_by=first_air_date.desc&vote_count.gte=3';
  }

  let withGenres = '';
  let withoutGenres = '';

  if (isKids) {
    if (mediaType === 'movie') {
      const gId = TMDB_MOVIE_GENRE_MAP[genreLower];
      withGenres = gId ? `${gId},16|10751` : '16|10751';
      withoutGenres = '27,80,53,10752,18';
    } else {
      const gId = TMDB_TV_GENRE_MAP[genreLower];
      withGenres = gId ? `${gId},10762|10751|16` : '10762|10751|16';
      withoutGenres = '80,27,10768,18';
    }
  } else {
    if (mediaType === 'movie') {
      const gId = TMDB_MOVIE_GENRE_MAP[genreLower];
      if (gId) withGenres = gId;
    } else {
      const gId = TMDB_TV_GENRE_MAP[genreLower];
      if (gId) withGenres = gId;
    }
  }

  let path = `/discover/${tmdbType}?language=pt-BR&page=${page}&${sortQuery}&include_adult=false`;
  if (withGenres) path += `&with_genres=${encodeURIComponent(withGenres)}`;
  if (withoutGenres) path += `&without_genres=${encodeURIComponent(withoutGenres)}`;
  if (isKids && mediaType === 'movie') {
    path += '&certification_country=BR&certification.lte=10';
  }

  const tmdbRes = await fetchTmdbJson<{
    page?: number;
    total_pages?: number;
    total_results?: number;
    results?: Array<Record<string, unknown>>;
  }>(path, 3500);

  const rawResults = tmdbRes?.results ?? [];
  const items: MediaTitle[] = [];

  for (const r of rawResults) {
    if (!r.poster_path || !r.backdrop_path) continue;
    const mapped = mapTmdbSummaryToMediaTitle(r, mediaType);
    if (isKids) {
      mapped.ageRating = 'L';
    }
    items.push(mapped);
  }

  const totalPages = Math.min(tmdbRes?.total_pages || 1, 100);
  const hasMore = page < totalPages && items.length > 0;

  return {
    items,
    page,
    totalPages,
    hasMore,
  };
}

async function fetchLiveCatalogFeed(): Promise<MediaTitle[]> {
  const hit = catalogCache.get('tmdb:combined');
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const [
    trendDayRes,
    trendMoviesRes,
    trendTvRes,
    nowPlayingRes,
    popMoviesRes,
    popTvRes,
    topMoviesRes,
    actionMoviesRes,
  ] = await Promise.all([
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/trending/all/day?language=pt-BR', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/trending/movie/week?language=pt-BR', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/trending/tv/week?language=pt-BR', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/movie/now_playing?language=pt-BR&region=BR', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/movie/popular?language=pt-BR&page=1', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/tv/popular?language=pt-BR&page=1', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/movie/top_rated?language=pt-BR&page=1', 3200),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>('/discover/movie?language=pt-BR&with_genres=28,878&sort_by=popularity.desc', 3200),
  ]);

  const combined: MediaTitle[] = [];
  const seenKey = new Set<string>();

  const addBatch = (
    rows: Array<Record<string, unknown>> | undefined,
    forceType?: 'movie' | 'series',
    assignTop10Rank = false
  ) => {
    for (const r of rows ?? []) {
      const mType = r.media_type;
      if (!forceType && mType && mType !== 'movie' && mType !== 'tv') continue;
      if (!r.poster_path || !r.backdrop_path) continue;
      const mapped = mapTmdbSummaryToMediaTitle(r, forceType);
      const k = `${mapped.mediaType}:${mapped.tmdbId}`;
      if (!mapped.tmdbId || seenKey.has(k)) continue;
      seenKey.add(k);
      const entry: MediaTitle = { ...mapped, rankToday: undefined };
      if (assignTop10Rank && combined.length < 10) {
        entry.rankToday = combined.length + 1;
      }
      combined.push(entry);
    }
  };

  // Live TMDB Trending comes FIRST (#1..#10 + Hero Spotlight)
  addBatch(trendDayRes?.results, undefined, true);
  addBatch(trendMoviesRes?.results, 'movie', true);
  addBatch(trendTvRes?.results, 'series', true);
  addBatch(nowPlayingRes?.results, 'movie', false);
  addBatch(popMoviesRes?.results, 'movie', false);
  addBatch(popTvRes?.results, 'series', false);
  addBatch(topMoviesRes?.results, 'movie', false);
  addBatch(actionMoviesRes?.results, 'movie', false);

  // Append any remaining curated favorites not already in the live feed
  for (const c of CURATED_CATALOG) {
    const k = `${c.mediaType}:${c.tmdbId}`;
    if (!seenKey.has(k)) {
      seenKey.add(k);
      combined.push({ ...c, rankToday: undefined });
    }
  }

  // Enrich top 7 Hero Spotlight titles with crisp transparent TMDB PNG logos in parallel
  const heroSlice = combined.slice(0, 7);
  await Promise.allSettled(
    heroSlice.map(async (item) => {
      if (!item.logo && item.tmdbId) {
        const logoUrl = await fetchTmdbHeroLogo(item.mediaType, item.tmdbId);
        if (logoUrl) item.logo = logoUrl;
      }
    })
  );

  const finalFeed = combined.slice(0, 150);
  if (trendDayRes?.results?.length || trendMoviesRes?.results?.length) {
    catalogCache.set('tmdb:combined', {
      expiresAt: Date.now() + META_CACHE_TTL_MS,
      value: finalFeed,
    });
  }
  return finalFeed;
}

async function fetchLiveKidsCatalogFeed(): Promise<MediaTitle[]> {
  const hit = catalogCache.get('tmdb:kids');
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const [trendKidsRes, animMoviesRes, kidsTvRes, familyMoviesRes] = await Promise.all([
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>(
      '/discover/movie?language=pt-BR&with_genres=16,10751&without_genres=27,80,53,10752&sort_by=popularity.desc',
      3200
    ),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>(
      '/discover/movie?language=pt-BR&with_genres=16&without_genres=27,80,53,10752&sort_by=popularity.desc',
      3200
    ),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>(
      '/discover/tv?language=pt-BR&with_genres=10762,10751,16&without_genres=80,27,10768&sort_by=popularity.desc',
      3200
    ),
    fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>(
      '/discover/movie?language=pt-BR&with_genres=10751,12&without_genres=27,80,53,10752&sort_by=popularity.desc',
      3200
    ),
  ]);

  const combined: MediaTitle[] = [];
  const seenKey = new Set<string>();

  const addBatch = (
    rows: Array<Record<string, unknown>> | undefined,
    forceType?: 'movie' | 'series',
    assignTop10Rank = false
  ) => {
    for (const r of rows ?? []) {
      const mType = r.media_type;
      if (!forceType && mType && mType !== 'movie' && mType !== 'tv') continue;
      if (!r.poster_path || !r.backdrop_path) continue;
      const mapped = mapTmdbSummaryToMediaTitle(r, forceType);
      const k = `${mapped.mediaType}:${mapped.tmdbId}`;
      if (!mapped.tmdbId || seenKey.has(k)) continue;
      seenKey.add(k);
      const entry: MediaTitle = { ...mapped, ageRating: 'L', rankToday: undefined };
      if (assignTop10Rank && combined.length < 10) {
        entry.rankToday = combined.length + 1;
      }
      combined.push(entry);
    }
  };

  addBatch(trendKidsRes?.results, 'movie', true);
  addBatch(animMoviesRes?.results, 'movie', true);
  addBatch(kidsTvRes?.results, 'series', true);
  addBatch(familyMoviesRes?.results, 'movie', false);

  for (const c of CURATED_CATALOG) {
    if (allowedForProfile(c, '10', true)) {
      const k = `${c.mediaType}:${c.tmdbId}`;
      if (!seenKey.has(k)) {
        seenKey.add(k);
        combined.push({ ...c, ageRating: 'L', rankToday: undefined });
      }
    }
  }

  const heroSlice = combined.slice(0, 7);
  await Promise.allSettled(
    heroSlice.map(async (item) => {
      if (!item.logo && item.tmdbId) {
        const logoUrl = await fetchTmdbHeroLogo(item.mediaType, item.tmdbId);
        if (logoUrl) item.logo = logoUrl;
      }
    })
  );

  const finalFeed = combined.slice(0, 150);
  catalogCache.set('tmdb:kids', {
    expiresAt: Date.now() + META_CACHE_TTL_MS,
    value: finalFeed,
  });
  return finalFeed;
}

const SKIP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function resolveMalIdForTitle(searchTitle: string): Promise<number | null> {
  const normalized = searchTitle.trim().toLowerCase();
  if (!normalized) return null;
  const cached = malIdCache.get(normalized);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout('https://graphql.anilist.co', {
      method: 'POST',
      timeoutMs: 1800,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query:
          'query($s:String){Page(perPage:3){media(search:$s,type:ANIME,sort:POPULARITY_DESC){id idMal episodes title{english romaji}}}}',
        variables: { s: searchTitle.trim() },
      }),
    });
    if (res.status !== 200) return null;
    const json = JSON.parse(res.text) as {
      data?: { Page?: { media?: Array<{ idMal?: number }> } };
    };
    const firstMal = json.data?.Page?.media?.find((m) => typeof m.idMal === 'number')?.idMal;
    if (firstMal) {
      malIdCache.set(normalized, firstMal);
      return firstMal;
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchExactSkipSegments(opts: {
  tmdbId: string;
  season: number;
  episode: number;
  title: string;
  originalTitle: string;
}): Promise<SkipSegment[]> {
  const key = `${opts.tmdbId}:s${opts.season}:e${opts.episode}`;
  const hit = skipTimesCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const introDbPromise = (async (): Promise<SkipSegment[]> => {
    try {
      const r = await fetchWithTimeout(
        `https://api.theintrodb.org/v2/media?tmdb_id=${encodeURIComponent(opts.tmdbId)}&season=${opts.season}&episode=${opts.episode}`,
        { timeoutMs: 2200, headers: { Accept: 'application/json' } }
      );
      if (r.status !== 200) return [];
      return parseTheIntroDbV2Response(JSON.parse(r.text));
    } catch {
      return [];
    }
  })();

  const aniSkipPromise = (async (): Promise<SkipSegment[]> => {
    const baseName = opts.originalTitle || opts.title;
    if (!baseName) return [];
    const searchName = opts.season > 1 ? `${baseName} Season ${opts.season}` : baseName;
    let malId = await resolveMalIdForTitle(searchName);
    if (!malId && opts.season > 1) {
      malId = await resolveMalIdForTitle(baseName);
    }
    if (!malId) return [];
    try {
      const r = await fetchWithTimeout(
        `https://api.aniskip.com/v2/skip-times/${malId}/${opts.episode}?types=op&types=recap&types=ed&episodeLength=0`,
        { timeoutMs: 1800, headers: { Accept: 'application/json' } }
      );
      if (r.status !== 200) return [];
      return parseAniSkipResponse(JSON.parse(r.text));
    } catch {
      return [];
    }
  })();

  const [tvSegs, animeSegs] = await Promise.all([introDbPromise, aniSkipPromise]);
  // Merge preferring AniSkip when exact anime op/ed is present, supplemented by TheIntroDB
  const combined: SkipSegment[] = [];
  const hasType = (t: SkipSegment['type']) => combined.some((s) => s.type === t);

  for (const seg of [...tvSegs, ...animeSegs]) {
    if (seg.type === 'intro' && !hasType('intro')) combined.push(seg);
    else if (seg.type === 'recap' && !hasType('recap')) combined.push(seg);
    else if (seg.type === 'outro' && !hasType('outro')) combined.push(seg);
  }

  skipTimesCache.set(key, {
    expiresAt: Date.now() + (combined.length > 0 ? SKIP_CACHE_TTL_MS : 10 * 60 * 1000),
    value: combined,
  });
  return combined;
}

// ============================================================================
// EXPRESS APP & ROUTES
// ============================================================================

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/pb', createPocketBaseRouter());
  app.use('/api/analytics', createAnalyticsRouter());
  const vipRouter = createVipRouter();
  app.use('/api/vip', vipRouter);
  app.post('/api/vip/visit', (req, res) => {
    const ok = recordVisit(req.body || {});
    res.set('Cache-Control', 'no-store').status(ok ? 200 : 400).json({ ok });
  });
  app.get('/api/urgent-announcement', (req, res, next) => {
    req.url = '/urgent-announcement';
    vipRouter(req, res, next);
  });
  app.post('/api/urgent-announcement', (req, res, next) => {
    req.url = '/urgent-announcement';
    vipRouter(req, res, next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'Kairou Media Engine' });
  });

  app.get('/api/skip-times/:tmdbId', async (req, res) => {
    const tmdbId = String(req.params.tmdbId || '').trim();
    const season = Math.max(1, Number(req.query.season) || 1);
    const episode = Math.max(1, Number(req.query.episode) || 1);
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    const originalTitle = typeof req.query.originalTitle === 'string' ? req.query.originalTitle : '';
    if (!tmdbId) {
      res.json({ segments: [] });
      return;
    }
    const segments = await fetchExactSkipSegments({
      tmdbId,
      season,
      episode,
      title,
      originalTitle,
    });
    res.json({ segments });
  });

  app.get('/api/catalog/browse', async (req, res) => {
    try {
      const mediaType = req.query.type === 'series' || req.query.type === 'tv' ? 'series' : 'movie';
      const isKids = req.query.kids === 'true';
      const page = Math.max(1, Number(req.query.page) || 1);
      const genre = typeof req.query.genre === 'string' ? req.query.genre.trim() : '';
      const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : 'popular';

      const result = await fetchPaginatedCatalog({ mediaType, isKids, page, genre, sort });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/catalog', async (req, res) => {
    try {
      const isKids = req.query.kids === 'true';
      const items = isKids ? await fetchLiveKidsCatalogFeed() : await fetchLiveCatalogFeed();
      res.json({ items });
    } catch {
      res.json({ items: CURATED_CATALOG });
    }
  });

  // Live TV Channels API (Canais Ao Vivo PT-BR / TVPlay / NTC TV)
  app.get('/api/channels', (req, res) => {
    try {
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      let items = [...LIVE_CHANNELS];
      if (category && category !== 'todos') {
        items = items.filter((c) => c.category === category);
      }
      if (query) {
        items = items.filter(
          (c) =>
            c.name.toLowerCase().includes(query) ||
            c.slug.toLowerCase().includes(query) ||
            c.categoryLabel.toLowerCase().includes(query)
        );
      }
      res.json({
        channels: items,
        categories: CHANNEL_CATEGORIES,
        total: items.length,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/channels/:id', (req, res) => {
    const id = req.params.id;
    const channel = LIVE_CHANNELS.find((c) => c.id === id || c.slug === id);
    if (!channel) {
      res.status(404).json({ error: 'Canal não encontrado' });
      return;
    }
    res.json({ channel });
  });

  app.get('/api/channels/stream/:id', (req, res) => {
    const id = req.params.id;
    const channel = LIVE_CHANNELS.find((c) => c.id === id || c.slug === id);
    if (!channel) {
      res.status(404).json({ error: 'Canal não encontrado' });
      return;
    }
    res.json({
      ok: true,
      id: channel.id,
      name: channel.name,
      logo: channel.logo,
      streamUrl: channel.streamUrl,
      backupStreamUrl: channel.backupStreamUrl,
      category: channel.category,
      categoryLabel: channel.categoryLabel,
      quality: channel.quality,
      format: 'hls',
      isLive: true,
    });
  });

  app.get('/api/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ items: await fetchLiveCatalogFeed() });
      return;
    }

    const localMatches = CURATED_CATALOG.filter((item) =>
      `${item.title} ${item.originalTitle} ${item.genres.join(' ')}`.toLowerCase().includes(q.toLowerCase())
    );

    try {
      const tmdbRes = await fetchTmdbJson<{ results?: Array<Record<string, unknown>> }>(
        `/search/multi?language=pt-BR&include_adult=false&query=${encodeURIComponent(q)}`,
        3000
      );
      const remote: MediaTitle[] = (tmdbRes?.results ?? [])
        .filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && (r.poster_path || r.backdrop_path))
        .slice(0, 14)
        .map((r) => mapTmdbSummaryToMediaTitle(r));

      const seen = new Set(localMatches.map((i) => `${i.mediaType}:${i.tmdbId}`));
      const items = [
        ...localMatches,
        ...remote.filter((r) => !seen.has(`${r.mediaType}:${r.tmdbId}`)),
      ];
      res.json({ items });
    } catch {
      res.json({ items: localMatches });
    }
  });

  app.get('/api/title/:type/:id', async (req, res) => {
    const type: 'movie' | 'series' = req.params.type === 'series' ? 'series' : 'movie';
    const rawId = req.params.id;
    const curated = CURATED_CATALOG.find(
      (c) => c.id === rawId || c.imdbId === rawId || c.tmdbId === rawId
    );

    const tmdbMatch = rawId.match(/^tmdb-(?:movie|series)-(\d+)$/)?.[1];
    let tmdbId = curated?.tmdbId || tmdbMatch || (/^\d+$/.test(rawId) ? rawId : '');

    if (!tmdbId && /^tt\d+/i.test(rawId)) {
      try {
        const findRes = await fetchTmdbJson<{
          movie_results?: Array<{ id: number }>;
          tv_results?: Array<{ id: number }>;
        }>(`/find/${rawId}?external_source=imdb_id`, 3000);
        if (findRes?.movie_results && findRes.movie_results.length > 0) {
          tmdbId = String(findRes.movie_results[0].id);
        } else if (findRes?.tv_results && findRes.tv_results.length > 0) {
          tmdbId = String(findRes.tv_results[0].id);
        }
      } catch {}
    }

    if (tmdbId) {
      const rich = await fetchTmdbDetailTitle(type, tmdbId);
      if (rich) {
        res.json({ item: rich });
        return;
      }
    }

    if (curated) {
      res.json({ item: curated });
    } else {
      res.status(404).json({ error: 'Título não encontrado.' });
    }
  });

  app.get('/api/title/series/:id/season/:season', async (req, res) => {
    const season = Math.max(1, Number(req.params.season) || 1);
    const rawId = req.params.id;
    const curated = CURATED_CATALOG.find(
      (c) => c.id === rawId || c.imdbId === rawId || c.tmdbId === rawId
    );
    const tmdbId = curated?.tmdbId || rawId.match(/(\d+)$/)?.[1] || rawId;
    if (!/^\d+$/.test(tmdbId)) {
      res.json({ episodes: [] });
      return;
    }
    const episodes = await fetchTmdbSeasonEpisodes(tmdbId, season);
    res.json({ episodes });
  });

  // Progressive SSE Extraction Start (Sub-second initial stream!)
  app.post('/api/extract/start', async (req, res) => {
    const startedAt = Date.now();
    const {
      target: rawTarget,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime,
      refresh = false,
    } = req.body as {
      target?: string;
      imdbId?: string;
      title?: string;
      originalTitle?: string;
      isAnime?: boolean;
      refresh?: boolean;
    };

    const parsed = parseTmdbTarget(rawTarget ?? '');
    if (parsed.kind === 'invalid') {
      res.status(400).json({ error: parsed.reason });
      return;
    }

    if (parsed.kind === 'direct') {
      const streamId = registerStream(
        parsed.url,
        typeof req.body?.referer === 'string' ? req.body.referer : '',
        parsed.url.includes('.mp4') ? 'mp4' : 'hls'
      );
      const ext = parsed.url.includes('.mp4') ? 'media.mp4' : 'master.m3u8';
      const snap: AnonymizedExtractResponse = {
        elapsedMs: Date.now() - startedAt,
        cached: false,
        streams: [
          {
            id: streamId,
            label: 'Servidor 1',
            audio: 'Direto',
            quality: 'Original',
            codec: isLikelyHevcStream(parsed.url) ? 'h265' : 'h264',
            format: parsed.url.includes('.mp4') ? 'mp4' : 'hls',
            isPtBr: false,
            is4k: false,
            streamUrl: `/api/stream/${streamId}/${ext}`,
          },
        ],
        subtitles: [],
      };
      res.json({ jobId: null, done: true, snapshot: snap });
      return;
    }

    const cacheKey =
      parsed.kind === 'movie'
        ? `movie:${parsed.tmdbId}`
        : `tv:${parsed.tmdbId}:${parsed.season}:${parsed.episode}`;

    if (!refresh) {
      const cached = extractCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && cached.value.streams.length > 0) {
        res.json({
          jobId: null,
          done: true,
          snapshot: { ...cached.value, cached: true, elapsedMs: Date.now() - startedAt },
        });
        return;
      }
    }

    const extractTarget: ExtractTarget = {
      ...parsed,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime,
    };
    const imdbPromise = resolveImdbForTarget(extractTarget);

    const jobId = `job_${crypto.randomBytes(6).toString('base64url')}`;
    const job: ExtractionJob = {
      id: jobId,
      cacheKey,
      startedAt,
      done: false,
      rawStreams: [],
      rawSubs: [],
      emitter: new EventEmitter(),
      lastSnapshot: {
        elapsedMs: Date.now() - startedAt,
        cached: false,
        streams: [],
        subtitles: [],
      },
    };
    activeJobs.set(jobId, job);

    let resolveFirstWave: (() => void) | null = null;
    const firstWaveReady = new Promise<void>((resolve) => {
      resolveFirstWave = resolve;
    });
    let fallbackWaveTimer: ReturnType<typeof setTimeout> | null = null;

    // Run all pipelines in parallel at t=0ms, verifying playability before emitting!
    launchAllPipelines(extractTarget, imdbPromise, (batch) => {
      if (batch.resolvedTitle && !job.resolvedTitle) {
        job.resolvedTitle = batch.resolvedTitle;
      }
      job.rawStreams.push(...batch.streams);
      job.rawSubs.push(...batch.subtitles);
      job.lastSnapshot = buildAnonymizedSnapshot(
        job.rawStreams,
        job.rawSubs,
        job.startedAt,
        false,
        job.resolvedTitle
      );
      const hasTrue1080 = job.lastSnapshot.streams.some(
        (s) => s.codec !== 'h265' && !s.is4k && /1080p|full\s*hd/i.test(s.quality)
      );
      if (hasTrue1080) {
        if (fallbackWaveTimer) clearTimeout(fallbackWaveTimer);
        resolveFirstWave?.();
        resolveFirstWave = null;
      } else if (job.lastSnapshot.streams.some((s) => s.codec !== 'h265') && !fallbackWaveTimer) {
        fallbackWaveTimer = setTimeout(() => {
          resolveFirstWave?.();
          resolveFirstWave = null;
        }, 700);
      }
      job.emitter.emit('update', { done: false, snapshot: job.lastSnapshot });
    }).finally(() => {
      job.done = true;
      job.lastSnapshot = buildAnonymizedSnapshot(
        job.rawStreams,
        job.rawSubs,
        job.startedAt,
        false,
        job.resolvedTitle
      );
      if (job.lastSnapshot.streams.length > 0) {
        void setSharedCache(cacheKey, { streams: job.rawStreams, subtitles: job.rawSubs, resolvedTitle: job.resolvedTitle });
        extractCache.set(cacheKey, {
          expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS,
          value: job.lastSnapshot,
        });
      }
      if (fallbackWaveTimer) clearTimeout(fallbackWaveTimer);
      resolveFirstWave?.();
      resolveFirstWave = null;
      job.emitter.emit('update', { done: true, snapshot: job.lastSnapshot });
      setTimeout(() => activeJobs.delete(jobId), 45_000);
    });

    // Race up to 3200ms (or earlier as soon as verified stream arrives) so initial response returns real streams
    await Promise.race([
      firstWaveReady,
      new Promise<void>((resolve) => setTimeout(resolve, 3200)),
    ]);

    res.json({
      jobId: job.done ? null : jobId,
      done: job.done,
      snapshot: { ...job.lastSnapshot, elapsedMs: Date.now() - startedAt },
    });
  });

  // SSE stream of live anonymized extraction updates
  app.get('/api/extract/stream/:jobId', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'identity');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    const job = activeJobs.get(req.params.jobId);
    if (!job) {
      res.write(`data: ${JSON.stringify({ done: true, snapshot: null })}\n\n`);
      res.end();
      return;
    }

    let isClosed = false;
    const sendPayload = (payload: { done: boolean; snapshot: AnonymizedExtractResponse }) => {
      if (isClosed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
      if (payload.done) {
        isClosed = true;
        job.emitter.off('update', listener);
        setImmediate(() => {
          if (!res.writableEnded) {
            try { res.end(); } catch {}
          }
        });
      }
    };

    const listener = (payload: { done: boolean; snapshot: AnonymizedExtractResponse }) => {
      sendPayload(payload);
    };

    // Send latest snapshot immediately
    sendPayload({ done: job.done, snapshot: job.lastSnapshot });
    if (job.done) return;

    job.emitter.on('update', listener);
    req.on('close', () => {
      isClosed = true;
      job.emitter.off('update', listener);
    });
  });

  // Synchronous /api/extract endpoint with fast 2.4s cap across verified pipelines
  app.post('/api/extract', async (req, res) => {
    const tStart = Date.now();
    const {
      target: rawTarget,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime,
      refresh = false,
    } = req.body as {
      target?: string;
      imdbId?: string;
      title?: string;
      originalTitle?: string;
      isAnime?: boolean;
      refresh?: boolean;
    };

    const parsed = parseTmdbTarget(rawTarget ?? '');
    if (parsed.kind === 'invalid') {
      res.status(400).json({ error: parsed.reason });
      return;
    }

    if (parsed.kind === 'direct') {
      const streamId = registerStream(
        parsed.url,
        typeof req.body?.referer === 'string' ? req.body.referer : '',
        parsed.url.includes('.mp4') ? 'mp4' : 'hls'
      );
      const ext = parsed.url.includes('.mp4') ? 'media.mp4' : 'master.m3u8';
      res.json({
        elapsedMs: Date.now() - tStart,
        cached: false,
        streams: [
          {
            id: streamId,
            label: 'Servidor 1',
            audio: 'Direto',
            quality: 'Original',
            codec: isLikelyHevcStream(parsed.url) ? 'h265' : 'h264',
            format: parsed.url.includes('.mp4') ? 'mp4' : 'hls',
            isPtBr: false,
            is4k: false,
            streamUrl: `/api/stream/${streamId}/${ext}`,
          },
        ],
        subtitles: [],
      });
      return;
    }

    const cacheKey =
      parsed.kind === 'movie'
        ? `movie:${parsed.tmdbId}`
        : `tv:${parsed.tmdbId}:${parsed.season}:${parsed.episode}`;

    if (!refresh) {
      const cached = extractCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && cached.value.streams.length > 0) {
        res.json({
          jobId: null,
          done: true,
          snapshot: { ...cached.value, cached: true, elapsedMs: Date.now() - startedAt },
        });
        return;
      }
    }

    if (!refresh) {
      const hit = extractCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({
          ...hit.value,
          cached: true,
          elapsedMs: Date.now() - tStart,
        });
        return;
      }
    }

    if (!refresh) {
      const shared = await getSharedCache<{ streams: InternalExtractedStream[]; subtitles: InternalSubtitle[]; resolvedTitle?: string }>(cacheKey);
      if (shared && Array.isArray(shared.streams) && Array.isArray(shared.subtitles)) {
        const verified = await verifyStreamsBatch(shared.streams);
        if (verified.length) {
          const snapshot = buildAnonymizedSnapshot(verified, shared.subtitles, tStart, true, shared.resolvedTitle);
          res.json(snapshot);
          return;
        }
      }
    }

    const extractTarget: ExtractTarget = {
      ...parsed,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime,
    };
    const imdbPromise = resolveImdbForTarget(extractTarget);

    const rawStreams: InternalExtractedStream[] = [];
    const rawSubs: InternalSubtitle[] = [];
    let resolvedTitle: string | undefined;

    let resolveEarlyExtraction: (() => void) | null = null;
    const earlyExtractionPromise = new Promise<void>((r) => {
      resolveEarlyExtraction = r;
    });

    await Promise.race([
      launchAllPipelines(extractTarget, imdbPromise, (batch) => {
        if (batch.resolvedTitle && !resolvedTitle) resolvedTitle = batch.resolvedTitle;
        rawStreams.push(...batch.streams);
        rawSubs.push(...batch.subtitles);
        if (rawStreams.some((s) => s.codec !== 'h265')) {
          resolveEarlyExtraction?.();
          resolveEarlyExtraction = null;
        }
      }),
      earlyExtractionPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 4500)),
    ]);

    const responsePayload = buildAnonymizedSnapshot(
      rawStreams,
      rawSubs,
      tStart,
      false,
      resolvedTitle
    );

    if (responsePayload.streams.length > 0) {
      void setSharedCache(cacheKey, { streams: rawStreams, subtitles: rawSubs, resolvedTitle });
      extractCache.set(cacheKey, {
        expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS,
        value: responsePayload,
      });
    }

    res.json(responsePayload);
  });

  // Shared opaque proxy handler (forwards custom upstream proxyHeaders without exposing them!)
  async function handleOpaqueProxy(
    targetUrl: string,
    referer: string,
    extraHeaders: Record<string, string> | undefined,
    req: express.Request,
    res: express.Response
  ) {
    if (!targetUrl || !isSafeExternalUrl(targetUrl)) {
      res.status(400).send('Invalid stream target');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22000);

    try {
      const forwardHeaders: Record<string, string> = {
        'User-Agent': DEFAULT_UA,
        ...(extraHeaders ?? {}),
      };
      if (referer && !forwardHeaders.Referer && !forwardHeaders.referer) {
        forwardHeaders.Referer = referer;
        try {
          if (!forwardHeaders.Origin && !forwardHeaders.origin) {
            forwardHeaders.Origin = new URL(referer).origin;
          }
        } catch {
          // ignore
        }
      }
      if (typeof req.headers.range === 'string') {
        forwardHeaders.Range = req.headers.range;
      }

      let upstream: Response | null = null;
      let lastFetchErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          upstream = await fetch(targetUrl, {
            method: 'GET',
            headers: forwardHeaders,
            redirect: 'follow',
            signal: controller.signal,
          });
          if (
            attempt === 0 &&
            (upstream.status === 502 || upstream.status === 503 || upstream.status === 504)
          ) {
            await upstream.body?.cancel().catch(() => {});
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          break;
        } catch (err) {
          lastFetchErr = err;
          if (attempt === 0 && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
        }
      }

      if (!upstream) {
        throw lastFetchErr ?? new Error('Upstream fetch failed');
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const ctLower = contentType.toLowerCase();
      const finalLower = (upstream.url || targetUrl).toLowerCase();
      const isHlsContentType = ctLower.includes('mpegurl') || ctLower.includes('x-mpegurl');
      const isHlsUrl =
        /\.m3u8(\?|$|#)/i.test(targetUrl) ||
        /\.m3u8(\?|$|#)/i.test(finalLower) ||
        targetUrl.endsWith('/master.txt') ||
        targetUrl.includes('m3u8-proxy') ||
        targetUrl.includes('/proxy?u=');
      const isBinaryVideo =
        !isHlsContentType &&
        !isHlsUrl &&
        (ctLower.includes('video/mp4') || /\.mp4(\?|$|#)/i.test(finalLower));
      const isManifestCandidate =
        !isBinaryVideo &&
        (isHlsContentType || isHlsUrl || targetUrl.includes('.m3u8') || finalLower.includes('.m3u8'));

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send(`Upstream HTTP ${upstream.status}`);
        return;
      }

      if (isManifestCandidate) {
        const text = await upstream.text();
        if (text.trimStart().startsWith('#EXTM3U')) {
          const base = upstream.url || targetUrl;
          const rewritten = rewriteHlsManifestWithResolver(text, base, (absUrl) => {
            const tok = registerProxyToken(absUrl, referer, extraHeaders);
            return `/api/p/${tok}`;
          });
          res.status(200);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
          res.send(rewritten);
          return;
        }
        res.status(upstream.status);
        res.setHeader('Content-Type', contentType);
        res.send(text);
        return;
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      const acceptRanges = upstream.headers.get('accept-ranges');
      const contentRange = upstream.headers.get('content-range');
      const contentLength = upstream.headers.get('content-length');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      if (contentRange) res.setHeader('Content-Range', contentRange);
      if (contentLength) res.setHeader('Content-Length', contentLength);

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
      res.on('error', () => {
        controller.abort();
        nodeStream.destroy();
      });
      res.on('close', () => {
        if (!res.writableFinished) {
          controller.abort();
          nodeStream.destroy();
        }
      });
      nodeStream.on('error', () => {
        controller.abort();
        if (!res.headersSent) res.status(502).end();
        else if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).send('Stream proxy error');
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  app.get('/api/stream/:id/:file', async (req, res) => {
    let entry = streamRegistry.get(req.params.id);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (req.params.id.startsWith('s_')) {
        const resolved = resolveStatelessProxyToken(req.params.id.slice(2));
        if (resolved) {
          entry = {
            url: resolved.url,
            referer: resolved.referer,
            extraHeaders: resolved.extraHeaders,
            format: req.params.file.endsWith('.mp4') ? 'mp4' : 'hls',
            expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS,
          };
          streamRegistry.set(req.params.id, entry);
        }
      }
    }
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).send('Stream expired');
      return;
    }
    await handleOpaqueProxy(entry.url, entry.referer, entry.extraHeaders, req, res);
  });

  app.get('/api/p/:tok', async (req, res) => {
    let entry = proxyTokenRegistry.get(req.params.tok);
    if (!entry || entry.expiresAt <= Date.now()) {
      const resolved = resolveStatelessProxyToken(req.params.tok);
      if (resolved) {
        entry = {
          url: resolved.url,
          referer: resolved.referer,
          extraHeaders: resolved.extraHeaders,
          expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS,
        };
        proxyTokenRegistry.set(req.params.tok, entry);
      }
    }
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).send('Token expired');
      return;
    }
    await handleOpaqueProxy(entry.url, entry.referer, entry.extraHeaders, req, res);
  });

  app.get('/api/subtitle/:id.vtt', async (req, res) => {
    const entry = subRegistry.get(req.params.id);
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).send('Subtitle expired');
      return;
    }
    try {
      const subRes = await fetchWithTimeout(entry.url, {
        referer: entry.referer,
        headers: entry.extraHeaders,
        timeoutMs: 6000,
      });
      if (subRes.status !== 200) {
        res.status(subRes.status).send('Subtitle unavailable');
        return;
      }
      const vtt = convertSrtToVtt(subRes.text);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.send(vtt);
    } catch {
      res.status(502).send('Subtitle fetch error');
    }
  });

  // Server-rendered metadata and XML sitemaps from the original REA SEO engine.
  const seo = await import('./server/seoEngine.js');
  const maps: Record<string, () => Promise<string>> = {
    '/sitemap.xml': seo.getSitemapIndex,
    '/sitemap-static.xml': seo.getStaticSitemap,
    '/sitemap-movies.xml': seo.getMoviesSitemap,
    '/sitemap-series.xml': seo.getSeriesSitemap,
    '/sitemap-animes.xml': seo.getAnimesSitemap,
  };
  for (const [route, generate] of Object.entries(maps)) {
    app.get(route, async (_req, res, next) => {
      try { res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(await generate()); }
      catch (error) { next(error); }
    });
  }
  app.get(/^\/(filme|serie|anime|movie|tv)\/([a-zA-Z0-9_:-]+?)(?:-([^/?#]+))?\/?$/i, async (req, res, next) => {
    try { await seo.renderSeoPage(req, res, { type: req.params[0], id: req.params[1], slug: req.params[2] }); }
    catch (error) { next(error); }
  });
  app.get(/^\/(filmes|series|animes|canais|minha-lista)\/?$/i, async (req, res, next) => {
    try {
      const section = req.params[0];
      seo.renderSectionSeo(req, res, section);
    } catch (error) { next(error); }
  });

  const distPath = path.join(__dirname, 'dist');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV === 'production' || hasDist) {
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.originalUrl.startsWith('/api/')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch {
      app.use(express.static(distPath));
      app.use((req, res, next) => {
        if (req.originalUrl.startsWith('/api/')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Kairou server running on http://127.0.0.1:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Kairou server:', err);
  process.exit(1);
});
