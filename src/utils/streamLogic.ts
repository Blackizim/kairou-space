export type ParsedTarget =
  | { kind: 'direct'; url: string }
  | { kind: 'movie'; tmdbId: string }
  | { kind: 'tv'; tmdbId: string; season: number; episode: number }
  | { kind: 'invalid'; reason: string };

export function parseTmdbTarget(rawInput: unknown): ParsedTarget {
  if (typeof rawInput === 'object' && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const tmdbId = String(obj.tmdbId || obj.id || '').trim();
    if (obj.kind === 'tv' || ('season' in obj && 'episode' in obj)) {
      const season = Math.max(1, Number(obj.season) || 1);
      const episode = Math.max(1, Number(obj.episode) || 1);
      if (tmdbId) return { kind: 'tv', tmdbId, season, episode };
    }
    if (tmdbId) return { kind: 'movie', tmdbId };
  }

  const str = typeof rawInput === 'string' ? rawInput : String(rawInput ?? '');
  const trimmed = str.trim();
  if (!trimmed) {
    return { kind: 'invalid', reason: 'Informe um ID de filme, série (ex: 62650/12/2) ou URL direta.' };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'direct', url: trimmed };
  }

  const tvPrefix = trimmed.match(/^(?:tv\/)?(\d+)[\/\s:-]+[tTsS]?(\d+)[\/\sxXeE-]+(\d+)$/i);
  if (tvPrefix) {
    return {
      kind: 'tv',
      tmdbId: tvPrefix[1],
      season: Number(tvPrefix[2]),
      episode: Number(tvPrefix[3]),
    };
  }

  const movieMatch = trimmed.match(/^(?:movie\/)?(\d+)$/i);
  if (movieMatch) {
    return { kind: 'movie', tmdbId: movieMatch[1] };
  }

  return {
    kind: 'invalid',
    reason: 'Formato inválido. Use ID de filme (ex: 772), série (ex: 62650/12/2) ou URL http(s).',
  };
}

export interface StreamFormatDetection {
  formato: 'hls' | 'mp4' | 'unknown';
  manifesto: boolean;
  ftyp: boolean;
  confirmada: boolean;
}

export function detectStreamFormat(
  contentType: string | null | undefined,
  bytes: Uint8Array
): StreamFormatDetection {
  const ct = (contentType ?? '').toLowerCase();
  const sampleText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
  const trimmedText = sampleText.replace(/^\uFEFF/, '').trimStart();

  const hasExtM3u = trimmedText.startsWith('#EXTM3U') || /\n#EXTM3U/.test(trimmedText);
  if (hasExtM3u) {
    return {
      formato: 'hls',
      manifesto: true,
      ftyp: false,
      confirmada: true,
    };
  }

  let hasFtyp = false;
  const searchLimit = Math.min(bytes.length - 4, 64);
  for (let i = 0; i <= searchLimit; i++) {
    if (
      bytes[i] === 0x66 &&
      bytes[i + 1] === 0x74 &&
      bytes[i + 2] === 0x79 &&
      bytes[i + 3] === 0x70
    ) {
      hasFtyp = true;
      break;
    }
  }

  if (hasFtyp || (ct.includes('video/mp4') && bytes.length >= 16 && !trimmedText.startsWith('<'))) {
    return {
      formato: hasFtyp ? 'mp4' : 'unknown',
      manifesto: false,
      ftyp: hasFtyp,
      confirmada: hasFtyp,
    };
  }

  return {
    formato: 'unknown',
    manifesto: false,
    ftyp: false,
    confirmada: false,
  };
}

export function rewriteHlsManifestWithResolver(
  manifestText: string,
  baseUrl: string,
  resolveUrl: (absoluteUrl: string) => string
): string {
  const mapRef = (rawRef: string): string => {
    const trimmed = rawRef.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return rawRef;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      return resolveUrl(absolute);
    } catch {
      return rawRef;
    }
  };

  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_match, uriValue: string) => {
          return `URI="${mapRef(uriValue)}"`;
        });
      }
      return mapRef(trimmed);
    })
    .join('\n');
}

export function convertSrtToVtt(rawContent: string): string {
  const normalized = rawContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (normalized.startsWith('WEBVTT')) {
    return `${normalized}\n`;
  }
  const converted = normalized
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/(\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${converted}\n`;
}

export function isLikelyHevcStream(url: string, quality?: string | null): boolean {
  const hay = `${url} ${quality ?? ''}`.toLowerCase();
  return hay.includes('h265') || hay.includes('hevc') || hay.includes('x265');
}

export function isUltraHdQuality(quality?: string | null): boolean {
  if (!quality) return false;
  return /4k|2160p|uhd|ultra\s*fhd|studio\s*master/i.test(quality);
}

export interface VideoResolutionMeta {
  width: number;
  height: number;
  quality: '4K UHD' | '1080p Full HD' | '720p HD' | '480p HD';
  is4k: boolean;
  tier: 1 | 2 | 3 | 4;
}

export function classifyVideoDimensions(
  width: number,
  height: number
): VideoResolutionMeta | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 160 || height < 120) {
    return null;
  }
  if (width >= 3400 || height >= 1900) {
    return { width, height, quality: '4K UHD', is4k: true, tier: 4 };
  }
  if (width >= 1800 || height >= 1000) {
    return { width, height, quality: '1080p Full HD', is4k: false, tier: 3 };
  }
  if (width >= 1200 || height >= 680) {
    return { width, height, quality: '720p HD', is4k: false, tier: 2 };
  }
  return { width, height, quality: '480p HD', is4k: false, tier: 1 };
}

export function parseHlsMasterMaxDimensions(manifestText: string): {
  meta: VideoResolutionMeta;
  bandwidth: number;
} | null {
  const lines = manifestText.split(/\r?\n/);
  let best: { meta: VideoResolutionMeta; bandwidth: number } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    if (!resMatch) continue;
    const w = Number(resMatch[1]);
    const h = Number(resMatch[2]);
    const bw = Number(line.match(/BANDWIDTH=(\d+)/i)?.[1] ?? 0);
    const meta = classifyVideoDimensions(w, h);
    if (!meta) continue;
    if (
      !best ||
      meta.tier > best.meta.tier ||
      (meta.tier === best.meta.tier && (w * h > best.meta.width * best.meta.height || bw > best.bandwidth))
    ) {
      best = { meta, bandwidth: bw };
    }
  }
  return best;
}

export function parseMp4TkhdDimensions(bytes: Uint8Array): VideoResolutionMeta | null {
  let best: VideoResolutionMeta | null = null;
  for (let i = 0; i + 100 <= bytes.length; i++) {
    if (
      bytes[i] === 0x74 &&
      bytes[i + 1] === 0x6b &&
      bytes[i + 2] === 0x68 &&
      bytes[i + 3] === 0x64
    ) {
      const version = bytes[i + 4];
      if ((version !== 0 && version !== 1) || bytes[i + 5] !== 0 || bytes[i + 6] !== 0) {
        continue;
      }
      const wOff = version === 1 ? i + 92 : i + 80;
      if (wOff + 8 > bytes.length) continue;
      const wFixed =
        ((bytes[wOff] << 24) |
          (bytes[wOff + 1] << 16) |
          (bytes[wOff + 2] << 8) |
          bytes[wOff + 3]) >>>
        0;
      const hFixed =
        ((bytes[wOff + 4] << 24) |
          (bytes[wOff + 5] << 16) |
          (bytes[wOff + 6] << 8) |
          bytes[wOff + 7]) >>>
        0;
      const width = wFixed >>> 16;
      const height = hFixed >>> 16;
      if (width >= 320 && width <= 7680 && height >= 180 && height <= 4320) {
        const meta = classifyVideoDimensions(width, height);
        if (meta && (!best || meta.tier > best.tier || width * height > best.width * best.height)) {
          best = meta;
        }
      }
    }
  }
  return best;
}

function decodeH264SpsNal(nal: Uint8Array): VideoResolutionMeta | null {
  if (nal.length < 6 || (nal[0] & 0x1f) !== 7) return null;
  // Strip Annex-B emulation prevention bytes (0x00 0x00 0x03 -> 0x00 0x00)
  const rbsp: number[] = [];
  for (let i = 1; i < nal.length; i++) {
    if (i >= 3 && nal[i] === 0x03 && nal[i - 1] === 0x00 && nal[i - 2] === 0x00) {
      continue;
    }
    rbsp.push(nal[i]);
  }
  if (rbsp.length < 4) return null;

  let bitPos = 0;
  const totalBits = rbsp.length * 8;
  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      if (bitPos >= totalBits) return -1;
      const b = (rbsp[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
      val = (val << 1) | b;
      bitPos++;
    }
    return val;
  };
  const readUE = (): number => {
    let zeros = 0;
    while (bitPos < totalBits) {
      const bit = (rbsp[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
      bitPos++;
      if (bit === 1) break;
      zeros++;
      if (zeros > 30) return -1;
    }
    if (zeros === 0) return 0;
    const rem = readBits(zeros);
    if (rem < 0) return -1;
    return ((1 << zeros) - 1) + rem;
  };
  const readSE = (): number => {
    const u = readUE();
    if (u < 0) return 0;
    return u & 1 ? (u + 1) >> 1 : -(u >> 1);
  };

  const profileIdc = readBits(8);
  readBits(8); // constraint_set_flags + reserved_zero_2bits
  readBits(8); // level_idc
  if (readUE() < 0) return null;

  let chromaFormatIdc = 1;
  const highProfiles = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
  if (highProfiles.has(profileIdc)) {
    chromaFormatIdc = readUE();
    if (chromaFormatIdc < 0 || chromaFormatIdc > 3) return null;
    if (chromaFormatIdc === 3) readBits(1);
    if (readUE() < 0 || readUE() < 0) return null;
    readBits(1);
    const scalingPresent = readBits(1);
    if (scalingPresent === 1) {
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) {
        const listPresent = readBits(1);
        if (listPresent === 1) {
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) {
              const delta = readSE();
              nextScale = (lastScale + delta + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }

  if (readUE() < 0) return null; // log2_max_frame_num_minus4
  const pocType = readUE();
  if (pocType < 0) return null;
  if (pocType === 0) {
    if (readUE() < 0) return null;
  } else if (pocType === 1) {
    readBits(1);
    readSE();
    readSE();
    const numRef = readUE();
    for (let i = 0; i < Math.min(256, Math.max(0, numRef)); i++) readSE();
  }
  if (readUE() < 0) return null; // max_num_ref_frames
  readBits(1); // gaps_in_frame_num_value_allowed_flag

  const picWidthInMbsMinus1 = readUE();
  const picHeightInMapUnitsMinus1 = readUE();
  const frameMbsOnly = readBits(1);
  if (picWidthInMbsMinus1 < 0 || picHeightInMapUnitsMinus1 < 0 || frameMbsOnly < 0) return null;
  if (frameMbsOnly === 0) readBits(1);
  readBits(1); // direct_8x8_inference_flag

  let cropL = 0;
  let cropR = 0;
  let cropT = 0;
  let cropB = 0;
  const croppingFlag = readBits(1);
  if (croppingFlag === 1) {
    cropL = Math.max(0, readUE());
    cropR = Math.max(0, readUE());
    cropT = Math.max(0, readUE());
    cropB = Math.max(0, readUE());
  }

  const cropUnitX = chromaFormatIdc === 0 || chromaFormatIdc === 3 ? 1 : 2;
  const cropUnitY =
    (chromaFormatIdc === 0 ? 1 : chromaFormatIdc === 1 ? 2 : 1) * (2 - frameMbsOnly);

  const width = (picWidthInMbsMinus1 + 1) * 16 - (cropL + cropR) * cropUnitX;
  const height =
    (2 - frameMbsOnly) * (picHeightInMapUnitsMinus1 + 1) * 16 - (cropT + cropB) * cropUnitY;

  if (width < 320 || width > 7680 || height < 180 || height > 4320) return null;
  return classifyVideoDimensions(width, height);
}

export function parseH264SpsFromSegmentBytes(bytes: Uint8Array): VideoResolutionMeta | null {
  // Check fMP4 tkhd first if present
  const mp4Meta = parseMp4TkhdDimensions(bytes);
  if (mp4Meta) return mp4Meta;

  // Assemble elementary video payload if MPEG-TS (188-byte packets starting with 0x47)
  let scanBuf = bytes;
  if (bytes.length >= 376 && bytes[0] === 0x47 && bytes[188] === 0x47) {
    const pidPayloads = new Map<number, number[]>();
    const videoPids = new Set<number>();
    for (let off = 0; off + 188 <= bytes.length; off += 188) {
      if (bytes[off] !== 0x47) continue;
      const pusi = (bytes[off + 1] & 0x40) !== 0;
      const pid = ((bytes[off + 1] & 0x1f) << 8) | bytes[off + 2];
      if (pid === 0 || pid === 0x1fff) continue;
      const afc = (bytes[off + 3] >> 4) & 0x03;
      if (afc === 0 || afc === 2) continue;
      let pOff = off + 4;
      if (afc === 3) {
        const adaptLen = bytes[pOff];
        pOff += 1 + adaptLen;
      }
      if (pOff >= off + 188) continue;
      const chunk = bytes.subarray(pOff, off + 188);
      if (
        pusi &&
        chunk.length >= 9 &&
        chunk[0] === 0x00 &&
        chunk[1] === 0x00 &&
        chunk[2] === 0x01 &&
        chunk[3] >= 0xe0 &&
        chunk[3] <= 0xef
      ) {
        videoPids.add(pid);
        const headerDataLen = chunk[8];
        const esStart = 9 + headerDataLen;
        if (esStart < chunk.length) {
          const list = pidPayloads.get(pid) ?? [];
          for (let k = esStart; k < chunk.length; k++) list.push(chunk[k]);
          pidPayloads.set(pid, list);
        }
      } else if (videoPids.has(pid)) {
        const list = pidPayloads.get(pid) ?? [];
        for (let k = 0; k < chunk.length; k++) list.push(chunk[k]);
        pidPayloads.set(pid, list);
      }
    }
    const firstVideo = pidPayloads.values().next().value as number[] | undefined;
    if (firstVideo && firstVideo.length >= 12) {
      scanBuf = new Uint8Array(firstVideo);
    }
  }

  // Scan Annex-B start codes for NAL type 7 (SPS)
  for (let i = 0; i + 8 < scanBuf.length; i++) {
    if (scanBuf[i] === 0x00 && scanBuf[i + 1] === 0x00 && scanBuf[i + 2] === 0x01) {
      const nalStart = i + 3;
      if ((scanBuf[nalStart] & 0x1f) === 7) {
        let nalEnd = scanBuf.length;
        for (let j = nalStart + 4; j + 2 < scanBuf.length; j++) {
          if (scanBuf[j] === 0x00 && scanBuf[j + 1] === 0x00 && (scanBuf[j + 2] === 0x01 || scanBuf[j + 2] === 0x00)) {
            nalEnd = j;
            break;
          }
        }
        const meta = decodeH264SpsNal(scanBuf.subarray(nalStart, nalEnd));
        if (meta) return meta;
      }
    }
  }
  return null;
}

export function detectMp4CodecFromBytes(bytes: Uint8Array): 'h264' | 'h265' | 'unknown' {
  // Scan ISO BMFF ftyp/moov boxes as Latin-1 ASCII for codec FourCCs
  let ascii = '';
  const limit = Math.min(bytes.length, 16384);
  for (let i = 0; i < limit; i++) {
    ascii += String.fromCharCode(bytes[i]);
  }
  if (ascii.includes('hvc1') || ascii.includes('hev1')) return 'h265';
  if (ascii.includes('avc1')) return 'h264';
  return 'unknown';
}

export interface RankableStream {
  id?: string;
  url?: string;
  formato: string;
  codec?: 'h264' | 'h265';
  idioma?: string | null;
  qualidade?: string | null;
  priorityBoost?: number;
  latencyMs?: number;
  bitrateBps?: number;
  videoWidth?: number;
  videoHeight?: number;
  verified?: boolean;
}

export function sortBrowserCompatibleFirst<T extends RankableStream>(streams: T[]): T[] {
  const score = (s: T): number => {
    let pts = s.priorityBoost ?? 0;
    const hevc = s.codec === 'h265' || isLikelyHevcStream(s.url ?? '', s.qualidade);
    const is4k = isUltraHdQuality(s.qualidade);
    if (!hevc) pts += 300;
    if (s.verified) pts += 150;
    if (s.idioma && /pt|br|dub/i.test(s.idioma)) pts += 120;
    // Never auto-start in 4K: prefer 1080p or below by default while keeping 4K selectable
    if (!is4k) pts += 200;

    // Decisive resolution priority so TRUE 1080p ALWAYS beats 720p/480p regardless of HLS vs MP4!
    if (s.qualidade && /1080p|full\s*hd/i.test(s.qualidade)) pts += 90;
    else if (s.qualidade && /720p/i.test(s.qualidade)) pts += 25;
    else if (s.qualidade && /480p|360p/i.test(s.qualidade)) pts += 0;
    else pts += 40;

    // Prefer true full-width 1920px+ over anamorphic/narrow 1440x1080 encodes
    if (typeof s.videoWidth === 'number' && s.videoWidth > 0) {
      if (s.videoWidth >= 1880) pts += 25;
      else if (s.videoWidth >= 1600) pts += 10;
    }

    // Format serves only as tiebreaker within the same resolution tier
    if (s.formato === 'hls') pts += 14;
    else if (s.formato === 'mp4') pts += 6;

    // Prefer crisp higher-bitrate 1080p over heavily compressed encodes
    if (typeof s.bitrateBps === 'number' && s.bitrateBps > 0) {
      if (s.bitrateBps >= 2_500_000) pts += 18;
      else if (s.bitrateBps >= 1_400_000) pts += 10;
      else if (s.bitrateBps < 800_000) pts -= 15;
    }

    if (typeof s.latencyMs === 'number') {
      if (s.latencyMs <= 350) pts += 22;
      else if (s.latencyMs <= 750) pts += 14;
      else if (s.latencyMs <= 1300) pts += 6;
    }
    return pts;
  };
  return [...streams].sort((a, b) => score(b) - score(a));
}

export function inferStreamFormatFromUrlOrMeta(
  url: string,
  hintText?: string
): 'hls' | 'mp4' {
  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.includes('.m3u8') ||
    lowerUrl.includes('m3u8') ||
    lowerUrl.includes('/master.txt') ||
    lowerUrl.includes('playlist.m3u8')
  ) {
    return 'hls';
  }
  if (lowerUrl.includes('.mp4') || lowerUrl.includes('/video/') && !lowerUrl.includes('m3u8')) {
    return 'mp4';
  }
  // Check base64-encoded path segments like .../movie/aHR0cDov...Lm1wNA
  const parts = url.split('/');
  const tail = parts[parts.length - 1] ?? '';
  if (tail.length >= 16 && /^[A-Za-z0-9+/_=-]+$/.test(tail)) {
    try {
      const padded = tail.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(padded);
      if (decoded.toLowerCase().includes('.mp4')) return 'mp4';
      if (decoded.toLowerCase().includes('.m3u8')) return 'hls';
    } catch {
      // ignore non-base64
    }
  }
  if (hintText && /\bmp4\b/i.test(hintText)) return 'mp4';
  return 'hls';
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatRemainingMinutes(durationSec: number, currentSec: number): string {
  const rem = Math.max(0, Math.round((durationSec - currentSec) / 60));
  if (rem <= 1) return 'Quase no fim';
  const h = Math.floor(rem / 60);
  const m = rem % 60;
  if (h > 0) return `Restam ${h}h ${m}m`;
  return `Restam ${m}m`;
}

export interface FilterableMediaItem {
  title: string;
  originalTitle?: string;
  mediaType: 'movie' | 'series';
  genres: string[];
  network?: string;
}

export function filterCatalogTitles<T extends FilterableMediaItem>(
  items: T[],
  opts: {
    query?: string;
    mediaType?: 'all' | 'movie' | 'series';
    network?: string | null;
    genre?: string | null;
  }
): T[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return items.filter((item) => {
    if (opts.mediaType && opts.mediaType !== 'all' && item.mediaType !== opts.mediaType) {
      return false;
    }
    if (opts.network && item.network !== opts.network) {
      return false;
    }
    if (opts.genre && !item.genres.some((g) => g.toLowerCase() === opts.genre?.toLowerCase())) {
      return false;
    }
    if (q) {
      const hay = `${item.title} ${item.originalTitle ?? ''} ${item.genres.join(' ')} ${item.network ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface SkipSegment {
  type: 'intro' | 'recap' | 'outro';
  start: number;
  end: number | null;
}

export function parseTheIntroDbV2Response(raw: unknown): SkipSegment[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as {
    intro?: Array<{ start_ms?: number | null; end_ms?: number | null }>;
    recap?: Array<{ start_ms?: number | null; end_ms?: number | null }>;
    credits?: Array<{ start_ms?: number | null; end_ms?: number | null }>;
  };
  const out: SkipSegment[] = [];

  for (const seg of obj.intro ?? []) {
    if (typeof seg.start_ms === 'number' && typeof seg.end_ms === 'number' && seg.end_ms > seg.start_ms + 3000) {
      out.push({ type: 'intro', start: seg.start_ms / 1000, end: seg.end_ms / 1000 });
    }
  }
  for (const seg of obj.recap ?? []) {
    if (typeof seg.start_ms === 'number' && typeof seg.end_ms === 'number' && seg.end_ms > seg.start_ms + 3000) {
      out.push({ type: 'recap', start: seg.start_ms / 1000, end: seg.end_ms / 1000 });
    }
  }
  const credits = (obj.credits ?? []).filter((c) => typeof c.start_ms === 'number' && c.start_ms >= 0);
  if (credits.length > 0) {
    // Prefer end-of-episode credits (> 60s, or last credits marker without overlapping intro)
    const endCredit =
      credits.find((c) => c.end_ms === null && (c.start_ms ?? 0) > 60_000) ??
      [...credits].sort((a, b) => (b.start_ms ?? 0) - (a.start_ms ?? 0))[0];
    if (endCredit && typeof endCredit.start_ms === 'number' && endCredit.start_ms > 60_000) {
      out.push({
        type: 'outro',
        start: endCredit.start_ms / 1000,
        end: typeof endCredit.end_ms === 'number' ? endCredit.end_ms / 1000 : null,
      });
    }
  }
  return out;
}

export function parseAniSkipResponse(raw: unknown): SkipSegment[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as {
    found?: boolean;
    results?: Array<{
      skipType?: string;
      interval?: { startTime?: number; endTime?: number };
    }>;
  };
  if (!obj.found || !Array.isArray(obj.results)) return [];
  const out: SkipSegment[] = [];
  for (const item of obj.results) {
    const st = item.interval?.startTime;
    const en = item.interval?.endTime;
    if (typeof st !== 'number' || typeof en !== 'number' || en <= st + 3) continue;
    if (item.skipType === 'op' || item.skipType === 'mixed-op') {
      out.push({ type: 'intro', start: st, end: en });
    } else if (item.skipType === 'recap') {
      out.push({ type: 'recap', start: st, end: en });
    } else if (item.skipType === 'ed' || item.skipType === 'mixed-ed') {
      out.push({ type: 'outro', start: st, end: en });
    }
  }
  return out;
}

export function findActiveSkipSegment(
  segments: SkipSegment[],
  currentTimeSec: number
): SkipSegment | null {
  if (!Number.isFinite(currentTimeSec) || segments.length === 0) return null;
  for (const seg of segments) {
    if (seg.type !== 'intro' && seg.type !== 'recap') continue;
    if (seg.end === null) continue;
    if (currentTimeSec >= seg.start && currentTimeSec < seg.end - 1) {
      return seg;
    }
  }
  return null;
}

export function shouldShowNextEpisodeCard(opts: {
  isSeries: boolean;
  hasNextEpisode: boolean;
  currentTime: number;
  duration: number;
  segments: SkipSegment[];
  dismissed: boolean;
  ended?: boolean;
}): boolean {
  if (!opts.isSeries || !opts.hasNextEpisode || opts.dismissed) return false;
  if (opts.ended) return true;
  if (!Number.isFinite(opts.currentTime) || !Number.isFinite(opts.duration) || opts.duration <= 60) {
    return false;
  }
  const outro = opts.segments.find((s) => s.type === 'outro');
  if (outro && opts.currentTime >= outro.start) {
    return true;
  }
  return opts.duration - opts.currentTime <= 45;
}

export interface SimpleEpisodeRef {
  season: number;
  episode: number;
  title?: string;
  overview?: string;
  thumbnail?: string;
  runtime?: number;
}

export function resolveNextEpisode(opts: {
  season?: number;
  episode?: number;
  episodes?: SimpleEpisodeRef[];
  seasonsCount?: number;
}): SimpleEpisodeRef | null {
  if (!opts.season || !opts.episode) return null;
  const eps = opts.episodes ?? [];
  const sameSeasonSorted = eps
    .filter((e) => e.season === opts.season)
    .sort((a, b) => a.episode - b.episode);
  const nextInSeason = sameSeasonSorted.find((e) => e.episode > opts.episode!);
  if (nextInSeason) return nextInSeason;

  const maxKnownEp = sameSeasonSorted.length > 0 ? sameSeasonSorted[sameSeasonSorted.length - 1].episode : 0;
  // If episode metadata wasn't loaded for a season or there are clearly more episodes in next season
  if (maxKnownEp === 0 && opts.episode < 8) {
    return { season: opts.season, episode: opts.episode + 1, title: `Episódio ${opts.episode + 1}` };
  }

  const nextSeasonEps = eps
    .filter((e) => e.season === opts.season! + 1)
    .sort((a, b) => a.episode - b.episode);
  if (nextSeasonEps.length > 0) return nextSeasonEps[0];

  if (opts.seasonsCount && opts.season < opts.seasonsCount) {
    return { season: opts.season + 1, episode: 1, title: 'Episódio 1' };
  }
  return null;
}

