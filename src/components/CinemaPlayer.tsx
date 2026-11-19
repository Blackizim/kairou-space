import { PlayerAd } from './PlayerAd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Crown,
  Gauge,
  Globe,
  GripVertical,
  Lock,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Search,
  Server,
  Settings,
  SkipForward,
  Subtitles,
  Tv,
  Type,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { MediaTitle } from '../data/curatedCatalog';
import type {
  AnonymizedStream,
  AnonymizedSubtitle,
  SubtitleStyleConfig,
} from '../types/player';
import {
  convertSrtToVtt,
  findActiveSkipSegment,
  formatClock,
  isUltraHdQuality,
  resolveNextEpisode,
  shouldShowNextEpisodeCard,
  type SkipSegment,
} from '../utils/streamLogic';

interface ParsedCue {
  start: number;
  end: number;
  text: string;
}

function parseVttTimestamp(ts: string): number {
  const clean = ts.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] ?? 0;
}

function parseVttCues(rawVtt: string): ParsedCue[] {
  const vtt = convertSrtToVtt(rawVtt);
  const blocks = vtt.split(/\n{2,}/);
  const cues: ParsedCue[] = [];
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const [startRaw, restRaw] = lines[timeLineIdx].split('-->');
    if (!startRaw || !restRaw) continue;
    const endRaw = restRaw.trim().split(/\s+/)[0];
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(endRaw);
    const text = lines
      .slice(timeLineIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '');
    if (text && end >= start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

function isPtSubtitle(lang: string, label: string): boolean {
  const code = lang.toLowerCase().trim();
  const lbl = label.toLowerCase().trim();
  return code.startsWith('pt') || lbl.includes('portug') || lbl.includes('brazil');
}

function SubtitleLanguageIcon({ lang, label }: { lang: string; label: string }) {
  const code = lang.toLowerCase().trim();
  const text = label.toLowerCase();
  const country = isPtSubtitle(lang, label) ? 'br' : /^(en|eng)(-|$)/.test(code) || /english|ingl[eê]s/.test(text) ? 'us' : null;
  return country ? <img src={`/flags/${country}.svg`} alt={country === 'br' ? 'Brasil' : 'Estados Unidos'} className="h-4 w-[22px] shrink-0 rounded-[3px] object-cover" /> : <Globe className="w-4 h-4 text-stone-300 shrink-0" strokeWidth={1.75} />;
}

type PopoverPanel = null | 'servers' | 'subtitles' | 'settings';
type SettingsSubPanel = 'main' | 'quality' | 'audio' | 'timer' | 'speed' | 'substyle';

interface CinemaPlayerProps {
  item: MediaTitle;
  season?: number;
  episode?: number;
  streams: AnonymizedStream[];
  subtitles: AnonymizedSubtitle[];
  isPreparing?: boolean;
  isVip?: boolean;
  onRequireVip?: () => void;
  initialStreamIndex?: number;
  resumeAtSec?: number;
  preferPtBr?: boolean;
  defaultSubtitlesOn?: boolean;
  autoplayNextEpisode?: boolean;
  subtitleStyle: SubtitleStyleConfig;
  onUpdateSubtitleStyle: (next: SubtitleStyleConfig) => void;
  onProgress: (currentTime: number, duration: number) => void;
  onPlayNextEpisode?: (season: number, episode: number) => void;
  onRefreshStreams: () => void;
  onBack: () => void;
}

export const CinemaPlayer: React.FC<CinemaPlayerProps> = ({
  item,
  season,
  episode,
  streams,
  subtitles,
  isPreparing = false,
  isVip = false,
  onRequireVip,
  initialStreamIndex = 0,
  resumeAtSec = 0,
  preferPtBr = true,
  defaultSubtitlesOn = false,
  autoplayNextEpisode = true,
  subtitleStyle,
  onUpdateSubtitleStyle,
  onProgress,
  onPlayNextEpisode,
  onRefreshStreams,
  onBack,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const triedIdsRef = useRef<Set<string>>(new Set());
  const triedDirectMp4Ref = useRef<Set<string>>(new Set());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioOnlyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimeRef = useRef<number>(resumeAtSec);
  const hlsMediaRetriesRef = useRef<number>(0);
  const hlsNetworkRetriesRef = useRef<number>(0);
  const maxSub1080LevelRef = useRef<number>(-1);
  const manualStreamOverrideRef = useRef<boolean>(initialStreamIndex > 0);
  const emptyStreamsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshedRef = useRef(false);

  const supportsHevc = useMemo(
    () =>
      typeof MediaSource === 'undefined' ||
      MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    []
  );

  const isStreamBrowserCompatible = useCallback(
    (st: AnonymizedStream) => supportsHevc || st.codec !== 'h265',
    [supportsHevc]
  );

  const pickNextAutoStream = useCallback(
    (candidateList: AnonymizedStream[], allowUntestedAny = false): { stream: AnonymizedStream; idx: number } | null => {
      const findIdx = (pred: (s: AnonymizedStream) => boolean) =>
        candidateList.findIndex((s) => !triedIdsRef.current.has(s.id) && pred(s));

      // Always prefer <= 1080p compatible streams (with TRUE 1080p first!) — never auto-start in 4K!
      const is1080 = (s: AnonymizedStream) => /1080p|full\s*hd/i.test(s.quality);
      const idx =
        (() => {
          if (preferPtBr) {
            const pt1080 = findIdx(
              (s) => isStreamBrowserCompatible(s) && !isUltraHdQuality(s.quality) && s.isPtBr && is1080(s)
            );
            if (pt1080 !== -1) return pt1080;
            const ptHls = findIdx(
              (s) => isStreamBrowserCompatible(s) && !isUltraHdQuality(s.quality) && s.isPtBr && s.format === 'hls'
            );
            if (ptHls !== -1) return ptHls;
            const ptAny = findIdx((s) => isStreamBrowserCompatible(s) && !isUltraHdQuality(s.quality) && s.isPtBr);
            if (ptAny !== -1) return ptAny;
          }

          const a = findIdx((s) => isStreamBrowserCompatible(s) && !isUltraHdQuality(s.quality) && is1080(s));
          if (a !== -1) return a;
          const b = findIdx(
            (s) => isStreamBrowserCompatible(s) && !isUltraHdQuality(s.quality) && s.format === 'hls'
          );
          if (b !== -1) return b;
          const j = findIdx((s) => isStreamBrowserCompatible(s) && !isUltraHdQuality(s.quality));
          if (j !== -1) return j;
          const k = findIdx((s) => isStreamBrowserCompatible(s) && s.format === 'hls');
          if (k !== -1) return k;
          const m = findIdx((s) => isStreamBrowserCompatible(s));
          if (m !== -1) return m;
          return allowUntestedAny ? findIdx(() => true) : -1;
        })();

      if (idx === -1) return null;
      return { stream: candidateList[idx], idx };
    },
    [isStreamBrowserCompatible, preferPtBr]
  );

  const pickInitialStream = useCallback((): { stream: AnonymizedStream | null; idx: number } => {
    if (streams.length === 0) return { stream: null, idx: 0 };
    const safeIdx = Math.min(Math.max(0, initialStreamIndex), streams.length - 1);
    const requested = streams[safeIdx];
    // Respect explicit user choice (> 0); on default launch (0), enforce <= 1080p preferring real 1080p first
    if (
      requested &&
      isStreamBrowserCompatible(requested) &&
      (initialStreamIndex > 0 || (!isUltraHdQuality(requested.quality) && /1080p|full\s*hd/i.test(requested.quality)))
    ) {
      return { stream: requested, idx: safeIdx };
    }
    const autoPick = pickNextAutoStream(streams, false);
    if (autoPick) return autoPick;
    return { stream: requested ?? streams[0], idx: safeIdx };
  }, [streams, initialStreamIndex, isStreamBrowserCompatible, pickNextAutoStream]);

  const [streamIndex, setStreamIndex] = useState(() => pickInitialStream().idx);
  const [lockedStream, setLockedStream] = useState<AnonymizedStream | null>(
    () => pickInitialStream().stream
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [levels, setLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [activeLevel, setActiveLevel] = useState(-1);
  const [currentAutoLevelIdx, setCurrentAutoLevelIdx] = useState(-1);

  // Popovers
  const [openPanel, setOpenPanel] = useState<PopoverPanel>(null);
  const [settingsSub, setSettingsSub] = useState<SettingsSubPanel>('main');

  // ProfitOn Watching Ads lifecycle (Zero ads for VIP, purge on player unmount)
  useEffect(() => {
    const win = typeof window !== 'undefined' ? (window as unknown as { KairouAds?: { loadWatchingAds: () => void; disableAds: () => void } }) : undefined;
    win?.KairouAds?.loadWatchingAds();
    return () => {
      win?.KairouAds?.disableAds();
    };
  }, []);

  // Always reset locked stream & playback state when navigating between episodes or titles
  useEffect(() => {
    setLockedStream(null);
    setStreamIndex(0);
    setErrorMsg(null);
    setHasFirstFrame(false);
    setIsBuffering(true);
    setDuration(0);
    setCurrentTime(0);
    setHasEnded(false);
    setNextEpDismissed(false);
    triedIdsRef.current.clear();
    triedDirectMp4Ref.current.clear();
    autoRefreshedRef.current = false;
  }, [item.id, season, episode]);

  // Audio tracks state (for multi-audio HLS streams)
  const [audioTracks, setAudioTracks] = useState<
    Array<{ id: number; name: string; lang?: string; isPtBr?: boolean }>
  >([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(-1);

  // Subtitles state
  const [uploadedSubs, setUploadedSubs] = useState<AnonymizedSubtitle[]>([]);
  const [activeSubId, setActiveSubId] = useState<string | null>(() => {
    if (!defaultSubtitlesOn) return null;
    const pt = subtitles.find((s) => /pt/i.test(s.lang) || /portug/i.test(s.label));
    return pt?.id ?? subtitles[0]?.id ?? null;
  });
  const [subCues, setSubCues] = useState<ParsedCue[]>([]);
  const [subOffsetSec, setSubOffsetSec] = useState(0);
  const [showSubSync, setShowSubSync] = useState(false);
  const [subSearch, setSubSearch] = useState('');

  // Sleep timer
  const [sleepMinutes, setSleepMinutes] = useState<number>(0);

  // Skip Intro & Next Episode state
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([]);
  const [hasEnded, setHasEnded] = useState(false);
  const [nextEpDismissed, setNextEpDismissed] = useState(false);

  // Cast / AirPlay / TV state (matching REA COPIA)
  const [castState, setCastState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [castToast, setCastToast] = useState<string | null>(null);
  const castToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCastToast = useCallback((msg: string) => {
    if (castToastTimerRef.current) clearTimeout(castToastTimerRef.current);
    setCastToast(msg);
    castToastTimerRef.current = setTimeout(() => {
      setCastToast(null);
    }, 3500);
  }, []);

  // Fetch exact intro/recap/outro timestamps for series and anime
  useEffect(() => {
    if (item.mediaType !== 'series' || !item.tmdbId || !season || !episode) {
      setSkipSegments([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      season: String(season),
      episode: String(episode),
      title: item.title,
    });
    if (item.originalTitle) {
      params.set('originalTitle', item.originalTitle);
    }
    fetch(`/api/skip-times/${encodeURIComponent(item.tmdbId)}?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { segments?: SkipSegment[] } | null) => {
        if (!cancelled && Array.isArray(json?.segments)) {
          setSkipSegments(json.segments);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.mediaType, item.tmdbId, item.title, item.originalTitle, season, episode]);

  // Lock active stream so SSE updates arriving in the background don't interrupt playback;
  // however, if we temporarily started buffering a <= 720p stream and a true 1080p Full HD stream arrives
  // via SSE BEFORE the first frame renders, automatically upgrade to 1080p.
  useEffect(() => {
    if (lockedStream) {
      if (emptyStreamsTimeoutRef.current) {
        clearTimeout(emptyStreamsTimeoutRef.current);
        emptyStreamsTimeoutRef.current = null;
      }
      if (
        !manualStreamOverrideRef.current &&
        !hasFirstFrame &&
        !/1080p|full\s*hd/i.test(lockedStream.quality) &&
        !isUltraHdQuality(lockedStream.quality)
      ) {
        const upgradeIdx = streams.findIndex(
          (s) =>
            !triedIdsRef.current.has(s.id) &&
            isStreamBrowserCompatible(s) &&
            !isUltraHdQuality(s.quality) &&
            /1080p|full\s*hd/i.test(s.quality)
        );
        if (upgradeIdx !== -1 && streams[upgradeIdx] && streams[upgradeIdx].id !== lockedStream.id) {
          setStreamIndex(upgradeIdx);
          setLockedStream(streams[upgradeIdx]);
          return;
        }
      }
      const idx = streams.findIndex((s) => s.id === lockedStream.id);
      if (idx !== -1 && idx !== streamIndex) {
        setStreamIndex(idx);
      }
      return;
    }

    if (streams.length > 0) {
      if (emptyStreamsTimeoutRef.current) {
        clearTimeout(emptyStreamsTimeoutRef.current);
        emptyStreamsTimeoutRef.current = null;
      }
      const nextPick = pickNextAutoStream(streams, !isPreparing);
      if (nextPick) {
        setStreamIndex(nextPick.idx);
        setLockedStream(nextPick.stream);
        setErrorMsg(null);
        return;
      }
    }

    // When streams is empty, don't fail immediately — give background extraction a 15s grace window
    if (streams.length === 0) {
      if (!isPreparing && !autoRefreshedRef.current) {
        autoRefreshedRef.current = true;
        onRefreshStreams();
      }
      if (!emptyStreamsTimeoutRef.current && !errorMsg) {
        emptyStreamsTimeoutRef.current = setTimeout(() => {
          if (streams.length === 0 && !lockedStream) {
            setIsBuffering(false);
            setErrorMsg('Nenhum servidor disponível para este título no momento. Tente recarregar.');
          }
        }, 15000);
      }
      return;
    }

    if (!isPreparing && !errorMsg) {
      setIsBuffering(false);
      setErrorMsg('Não foi possível reproduzir os servidores encontrados neste navegador.');
    }
  }, [streams, lockedStream, streamIndex, hasFirstFrame, isPreparing, errorMsg, isStreamBrowserCompatible, pickNextAutoStream, onRefreshStreams]);

  const activeStream = lockedStream;
  const allSubtitles = useMemo(
    () => [...uploadedSubs, ...subtitles],
    [uploadedSubs, subtitles]
  );

  const filteredSubtitles = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    if (!q) return allSubtitles;
    return allSubtitles.filter(
      (s) => s.label.toLowerCase().includes(q) || s.lang.toLowerCase().includes(q)
    );
  }, [allSubtitles, subSearch]);

  const activeSubObj = useMemo(
    () => allSubtitles.find((s) => s.id === activeSubId) ?? null,
    [allSubtitles, activeSubId]
  );

  // Auto-hide controls after 3.2s when playing & no popover open
  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isPlaying && !openPanel) {
      hideTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3200);
    }
  }, [isPlaying, openPanel]);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [bumpControls]);

  // Try next compatible stream automatically by ID (preferring <= 1080p); if SSE is still running, stay on loader
  const markCurrentFailedAndFallback = useCallback(
    (terminalErrorMessage: string) => {
      const currentId = lockedStream?.id ?? streams[streamIndex]?.id;
      if (currentId) {
        triedIdsRef.current.add(currentId);
      }

      const nextPick = pickNextAutoStream(streams, !isPreparing);
      if (nextPick) {
        setStreamIndex(nextPick.idx);
        setLockedStream(nextPick.stream);
        return;
      }

      if (isPreparing) {
        setLockedStream(null);
        setIsBuffering(true);
        setErrorMsg(null);
        return;
      }

      setIsBuffering(false);
      setErrorMsg(terminalErrorMessage);
    },
    [lockedStream, streams, streamIndex, pickNextAutoStream, isPreparing]
  );

  const inspectVideoFrame = useCallback(
    (v: HTMLVideoElement | null) => {
      if (!v) return;
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        if (audioOnlyTimerRef.current) {
          clearTimeout(audioOnlyTimerRef.current);
          audioOnlyTimerRef.current = null;
        }
        setIsBuffering(false);
        setHasFirstFrame(true);
        return;
      }
      // If container & audio track are ready (readyState >= 2) yet videoWidth is 0 (e.g., HEVC track dropped by browser)
      if (v.readyState >= 2 && !audioOnlyTimerRef.current) {
        audioOnlyTimerRef.current = setTimeout(() => {
          audioOnlyTimerRef.current = null;
          const cur = videoRef.current;
          if (cur && cur.readyState >= 2 && (cur.videoWidth === 0 || cur.videoHeight === 0)) {
            markCurrentFailedAndFallback(
              'Este servidor usa codec incompatível neste navegador. Escolha outro servidor.'
            );
          }
        }, 380);
      }
    },
    [markCurrentFailedAndFallback]
  );

  // Attach HLS / MP4 stream to <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStream) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (audioOnlyTimerRef.current) {
      clearTimeout(audioOnlyTimerRef.current);
      audioOnlyTimerRef.current = null;
    }

    hlsMediaRetriesRef.current = 0;
    hlsNetworkRetriesRef.current = 0;
    maxSub1080LevelRef.current = -1;

    setErrorMsg(null);
    setHasFirstFrame(false);
    setIsBuffering(true);
    setLevels([]);
    setActiveLevel(-1);
    setCurrentAutoLevelIdx(-1);
    setAudioTracks([]);
    setSelectedAudioTrack(-1);

    // Check HEVC incompatibility upfront
    if (!isStreamBrowserCompatible(activeStream)) {
      markCurrentFailedAndFallback('Este fluxo utiliza codec HEVC não suportado pelo navegador.');
      return;
    }

    let cancelled = false;
    const seekResumeIfNeeded = () => {
      const target = resumeTimeRef.current;
      if (target > 4 && Number.isFinite(video.duration) && video.duration > target + 8) {
        video.currentTime = target;
      }
    };

    const startPlayback = () => {
      if (cancelled) return;
      video.playbackRate = playbackRate;
      video.play().catch(() => {
        // Fallback if browser policy restricts unmuted autoplay
        video.muted = true;
        setIsMuted(true);
        video.play().catch(() => {
          setIsBuffering(false);
        });
      });
    };

    if (activeStream.format === 'hls' && Hls.isSupported()) {
      const startPos = resumeTimeRef.current > 4 ? resumeTimeRef.current : -1;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: startPos,
        abrEwmaDefaultEstimate: 6_000_000,
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        maxBufferLength: 30,
        manifestLoadingTimeOut: 6500,
        manifestLoadingMaxRetry: 2,
        fragLoadingTimeOut: 18000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 400,
        xhrSetup: (xhr, reqUrl) => {
          if (reqUrl.includes('master.m3u8')) {
            xhr.addEventListener('readystatechange', () => {
              if (xhr.readyState === 2) {
                const ct = (xhr.getResponseHeader('content-type') || '').toLowerCase();
                if (
                  ct.includes('video/mp4') ||
                  ct.includes('video/webm') ||
                  ct.includes('video/x-matroska')
                ) {
                  xhr.abort();
                  if (!cancelled && !triedDirectMp4Ref.current.has(activeStream.id)) {
                    triedDirectMp4Ref.current.add(activeStream.id);
                    hls.destroy();
                    hlsRef.current = null;
                    video.src = activeStream.streamUrl;
                    video.load();
                    seekResumeIfNeeded();
                    startPlayback();
                  }
                }
              }
            });
          }
        },
      });
      hlsRef.current = hls;
      hls.loadSource(activeStream.streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        if (cancelled) return;
        const parsedLevels = data.levels.map((lvl, idx) => {
          const w = lvl.width || 0;
          const h = lvl.height || 0;
          let label: string;
          if (w >= 3400 || h >= 1900) label = '4K (2160p)';
          else if (w >= 1800 || h >= 1000) label = '1080p Full HD';
          else if (w >= 1200 || h >= 680) label = '720p HD';
          else if (h > 0) label = `${h}p`;
          else if (w > 0) label = `${Math.round((w * 9) / 16)}p`;
          else label = `${Math.round((lvl.bitrate || 0) / 1000)} kbps`;
          return { index: idx, label };
        });
        setLevels(parsedLevels);
        setActiveLevel(-1);

        // Enforce <= 1080p cap by default while starting DIRECTLY on the highest crisp 1080p level
        // (even for 2.39:1 cinemascope 1920x800!). 4K levels remain manually selectable in Settings.
        let bestSub1080Idx = -1;
        let bestScore = -1;
        data.levels.forEach((lvl, idx) => {
          const w = lvl.width || 0;
          const h = lvl.height || 0;
          const is4kLvl = w >= 3400 || h >= 1900;
          if (is4kLvl) return;
          const tier = w >= 1800 || h >= 1000 ? 3 : w >= 1200 || h >= 680 ? 2 : 1;
          const area = w > 0 && h > 0 ? w * h : h > 0 ? h * h * 1.77 : 0;
          const bwKbps = Math.min(99_999, Math.round((lvl.bitrate || 0) / 1000));
          const lvlScore = tier * 1_000_000_000 + area * 10 + bwKbps;
          if (lvlScore > bestScore) {
            bestScore = lvlScore;
            bestSub1080Idx = idx;
          }
        });
        maxSub1080LevelRef.current = bestSub1080Idx;
        if (bestSub1080Idx !== -1 && !isUltraHdQuality(activeStream.quality)) {
          hls.autoLevelCapping = bestSub1080Idx;
          hls.startLevel = bestSub1080Idx;
          hls.loadLevel = bestSub1080Idx;
          hls.nextLevel = bestSub1080Idx;
          setCurrentAutoLevelIdx(bestSub1080Idx);
        }

        const parseAudioTracks = () => {
          if (!hls.audioTracks || hls.audioTracks.length === 0) return;
          const parsed = hls.audioTracks.map((t, idx) => {
            const rawName = (t.name || '').trim();
            const rawLang = (t.lang || '').trim().toLowerCase();
            const isPt = /por|pt|dub|bra/i.test(`${rawName} ${rawLang}`);
            const isEn = /eng|en|ing/i.test(`${rawName} ${rawLang}`);
            const isEs = /esp|es|spa/i.test(`${rawName} ${rawLang}`);
            const isJp = /jpn|ja|jap/i.test(`${rawName} ${rawLang}`);

            let name = rawName || (rawLang ? rawLang.toUpperCase() : `Faixa ${idx + 1}`);
            if (isPt && !/portugu[eê]s|pt/i.test(name)) name = `Português (${name})`;
            else if (isEn && !/ingl[eê]s|english/i.test(name)) name = `Inglês (${name})`;
            else if (isEs && !/espanhol|spanish/i.test(name)) name = `Espanhol (${name})`;
            else if (isJp && !/japon[eê]s|japanese/i.test(name)) name = `Japonês (${name})`;

            return {
              id: t.id ?? idx,
              name,
              lang: t.lang || '',
              isPtBr: isPt,
            };
          });
          setAudioTracks(parsed);
          setSelectedAudioTrack(hls.audioTrack);

          if (preferPtBr && parsed.length > 1) {
            const ptIdx = parsed.findIndex((p) => p.isPtBr);
            if (ptIdx !== -1 && hls.audioTrack !== parsed[ptIdx].id) {
              hls.audioTrack = parsed[ptIdx].id;
              setSelectedAudioTrack(parsed[ptIdx].id);
            }
          }
        };

        parseAudioTracks();
        seekResumeIfNeeded();
        startPlayback();
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (cancelled) return;
        if (!hls.audioTracks || hls.audioTracks.length === 0) return;
        const parsed = hls.audioTracks.map((t, idx) => {
          const rawName = (t.name || '').trim();
          const rawLang = (t.lang || '').trim().toLowerCase();
          const isPt = /por|pt|dub|bra/i.test(`${rawName} ${rawLang}`);
          const isEn = /eng|en|ing/i.test(`${rawName} ${rawLang}`);
          const isEs = /esp|es|spa/i.test(`${rawName} ${rawLang}`);
          const isJp = /jpn|ja|jap/i.test(`${rawName} ${rawLang}`);

          let name = rawName || (rawLang ? rawLang.toUpperCase() : `Faixa ${idx + 1}`);
          if (isPt && !/portugu[eê]s|pt/i.test(name)) name = `Português (${name})`;
          else if (isEn && !/ingl[eê]s|english/i.test(name)) name = `Inglês (${name})`;
          else if (isEs && !/espanhol|spanish/i.test(name)) name = `Espanhol (${name})`;
          else if (isJp && !/japon[eê]s|japanese/i.test(name)) name = `Japonês (${name})`;

          return {
            id: t.id ?? idx,
            name,
            lang: t.lang || '',
            isPtBr: isPt,
          };
        });
        setAudioTracks(parsed);
        setSelectedAudioTrack(hls.audioTrack);

        if (preferPtBr && parsed.length > 1) {
          const ptIdx = parsed.findIndex((p) => p.isPtBr);
          if (ptIdx !== -1 && hls.audioTrack !== parsed[ptIdx].id) {
            hls.audioTrack = parsed[ptIdx].id;
            setSelectedAudioTrack(parsed[ptIdx].id);
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => {
        if (!cancelled) {
          setSelectedAudioTrack(data.id);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        if (!cancelled) setCurrentAutoLevelIdx(data.level);
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (cancelled || !data.fatal) return;

        // Recover smoothly on transient media/seek discontinuities before giving up on a stream
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsMediaRetriesRef.current < 2) {
          hlsMediaRetriesRef.current += 1;
          hls.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsNetworkRetriesRef.current < 2) {
          hlsNetworkRetriesRef.current += 1;
          const pos = video.currentTime > 1 ? video.currentTime : resumeTimeRef.current > 1 ? resumeTimeRef.current : -1;
          hls.startLoad(pos);
          return;
        }

        hls.destroy();
        hlsRef.current = null;
        // If HLS manifest parsing failed because the redirect resolved to MP4, test direct <video src>
        if (
          (data.details === 'manifestParsingError' ||
            data.details === 'manifestIncompatibleCodecsError') &&
          !triedDirectMp4Ref.current.has(activeStream.id)
        ) {
          triedDirectMp4Ref.current.add(activeStream.id);
          video.src = activeStream.streamUrl;
          video.load();
          seekResumeIfNeeded();
          startPlayback();
          return;
        }
        markCurrentFailedAndFallback(
          'Não foi possível reproduzir este servidor. Tente escolher outro servidor.'
        );
      });
    } else {
      video.src = activeStream.streamUrl;
      video.load();
      seekResumeIfNeeded();
      startPlayback();
    }

    return () => {
      cancelled = true;
      if (audioOnlyTimerRef.current) {
        clearTimeout(audioOnlyTimerRef.current);
        audioOnlyTimerRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeStream?.id]);

  // Fetch & parse active subtitle track
  useEffect(() => {
    if (!activeSubObj) {
      setSubCues([]);
      return;
    }
    let cancelled = false;
    fetch(activeSubObj.trackUrl)
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (!cancelled && text) {
          setSubCues(parseVttCues(text));
        }
      })
      .catch(() => {
        if (!cancelled) setSubCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSubObj?.id, activeSubObj?.trackUrl]);

  // Sleep timer countdown
  useEffect(() => {
    if (sleepMinutes <= 0) return;
    const id = setTimeout(() => {
      videoRef.current?.pause();
      setSleepMinutes(0);
    }, sleepMinutes * 60_000);
    return () => clearTimeout(id);
  }, [sleepMinutes]);

  // Persist playback progress every 4 seconds
  useEffect(() => {
    if (!isPlaying || duration <= 0) return;
    const id = setInterval(() => {
      if (videoRef.current) {
        onProgress(videoRef.current.currentTime, videoRef.current.duration);
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isPlaying, duration, onProgress]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space' || e.key === 'k') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(10);
      } else if (e.key === 'Escape') {
        if (openPanel) {
          setOpenPanel(null);
        } else {
          handleExit();
        }
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleExit = () => {
    if (videoRef.current && videoRef.current.duration > 0) {
      onProgress(videoRef.current.currentTime, videoRef.current.duration);
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onBack();
  };

  const togglePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    bumpControls();
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const maxD = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : currentTime + 60;
    const target = Math.min(maxD, Math.max(0, v.currentTime + delta));
    resumeTimeRef.current = target;
    v.currentTime = target;
    bumpControls();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    try {
      (video as any).webkitWirelessVideoPlaybackDisabled = false;
      (video as any).disableRemotePlayback = false;
    } catch {}

    const onConnecting = () => {
      setCastState('connecting');
      showCastToast('Conectando ao dispositivo...');
    };
    const onConnect = () => {
      setCastState('connected');
      showCastToast('Conectado! Reproduzindo na TV.');
    };
    const onDisconnect = () => {
      setCastState('disconnected');
      showCastToast('Desconectado da TV.');
    };

    const remote = (video as any).remote;
    if (remote && typeof remote.addEventListener === 'function') {
      remote.addEventListener('connecting', onConnecting);
      remote.addEventListener('connect', onConnect);
      remote.addEventListener('disconnect', onDisconnect);
    }

    const onWirelessChanged = () => {
      const isWireless = Boolean((video as any).webkitCurrentPlaybackTargetIsWireless);
      setCastState(isWireless ? 'connected' : 'disconnected');
      if (isWireless) {
        showCastToast('Conectado via AirPlay! Transmitindo vídeo e áudio.');
      } else {
        showCastToast('AirPlay desconectado.');
      }
    };

    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChanged);

    return () => {
      if (remote && typeof remote.removeEventListener === 'function') {
        remote.removeEventListener('connecting', onConnecting);
        remote.removeEventListener('connect', onConnect);
        remote.removeEventListener('disconnect', onDisconnect);
      }
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChanged);
    };
  }, [showCastToast]);

  const handleCast = async () => {
    const video = videoRef.current;
    if (!video) return;

    // Se for WebKit e HLS estiver ativo, migra para a URL nativa antes de abrir o picker (AirPlay)
    if (
      typeof (video as any).webkitShowPlaybackTargetPicker === 'function' &&
      hlsRef.current &&
      activeStream?.streamUrl
    ) {
      const curTime = video.currentTime || 0;
      const wasPlaying = !video.paused;
      try {
        hlsRef.current.destroy();
        hlsRef.current = null;
      } catch {}
      const absUrl = activeStream.streamUrl.startsWith('http')
        ? activeStream.streamUrl
        : new URL(activeStream.streamUrl, window.location.href).href;
      video.removeAttribute('src');
      video.load();
      video.src = absUrl;
      video.load();
      if (curTime > 0) {
        try {
          video.currentTime = curTime;
        } catch {}
      }
      if (wasPlaying) {
        video.play().catch(() => {});
      }
    }

    try {
      // 1. WebKit AirPlay picker (iOS / macOS Safari)
      if (typeof (video as any).webkitShowPlaybackTargetPicker === 'function') {
        (video as any).webkitShowPlaybackTargetPicker();
        return;
      }

      // 2. Remote Playback API (Chrome → Chromecast / Android)
      const remote = (video as any).remote;
      if (remote && typeof remote.prompt === 'function') {
        await remote.prompt();
        return;
      }

      // 3. Fallback informativo
      showCastToast('Seu navegador não suporta transmissão direta. No iPhone/iPad, use o Safari.');
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') return; // Usuário cancelou a seleção
      console.warn('Cast error:', err);
      showCastToast('Erro ao conectar. Verifique se a TV está na mesma rede Wi-Fi.');
    }
  };

  const handleLevelSelect = (lvlIdx: number) => {
    setActiveLevel(lvlIdx);
    if (hlsRef.current) {
      if (lvlIdx >= 0) {
        // Allow manual 4K opt-in if user selects a specific resolution
        hlsRef.current.autoLevelCapping = -1;
      } else if (
        maxSub1080LevelRef.current !== -1 &&
        activeStream &&
        !isUltraHdQuality(activeStream.quality)
      ) {
        hlsRef.current.autoLevelCapping = maxSub1080LevelRef.current;
      }
      hlsRef.current.currentLevel = lvlIdx;
    }
    setSettingsSub('main');
  };

  const handleUploadSubtitle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const vtt = convertSrtToVtt(text);
    const blob = new Blob([vtt], { type: 'text/vtt' });
    const blobUrl = URL.createObjectURL(blob);
    const id = `local-${Date.now()}`;
    const sub: AnonymizedSubtitle = {
      id,
      lang: 'pt-BR',
      label: file.name.replace(/\.(srt|vtt)$/i, ''),
      trackUrl: blobUrl,
    };
    setUploadedSubs((prev) => [sub, ...prev]);
    setActiveSubId(id);
    e.target.value = '';
  };

  // Current active caption line based on video time + sync offset
  const activeCaptionText = useMemo(() => {
    if (!activeSubId || subCues.length === 0) return '';
    const adjusted = currentTime + subOffsetSec;
    const match = subCues.find((c) => adjusted >= c.start && adjusted <= c.end);
    return match?.text ?? '';
  }, [activeSubId, subCues, currentTime, subOffsetSec]);

  const activeSkip = useMemo(
    () => findActiveSkipSegment(skipSegments, currentTime),
    [skipSegments, currentTime]
  );

  const nextEp = useMemo(
    () =>
      resolveNextEpisode({
        season,
        episode,
        episodes: item.episodes,
        seasonsCount: item.seasonsCount,
      }),
    [season, episode, item.episodes, item.seasonsCount]
  );

  const showNextEpCard = useMemo(
    () =>
      shouldShowNextEpisodeCard({
        isSeries: item.mediaType === 'series',
        hasNextEpisode: Boolean(nextEp),
        currentTime,
        duration,
        segments: skipSegments,
        dismissed: nextEpDismissed,
        ended: hasEnded,
      }),
    [item.mediaType, nextEp, currentTime, duration, skipSegments, nextEpDismissed, hasEnded]
  );

  const handleSkipIntro = () => {
    if (!activeSkip || activeSkip.end === null || !videoRef.current) return;
    const target = activeSkip.end;
    resumeTimeRef.current = target;
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    videoRef.current.play().catch(() => {});
    bumpControls();
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const activeQualityLabel =
    activeLevel === -1
      ? (levels.find((l) => l.index === currentAutoLevelIdx)?.label ?? activeStream?.quality ?? 'Auto')
      : levels.find((l) => l.index === activeLevel)?.label ?? activeStream?.quality ?? 'Auto';

  const alternativeAudioStreams = useMemo(() => {
    if (!activeStream) return [];
    return streams
      .map((stream, index) => ({ stream, index }))
      .filter(
        ({ stream }) =>
          stream.id !== activeStream.id &&
          stream.isPtBr !== activeStream.isPtBr &&
          isStreamBrowserCompatible(stream)
      );
  }, [streams, activeStream, isStreamBrowserCompatible]);

  const currentAudioDisplayLabel = useMemo(() => {
    if (audioTracks.length > 1 && selectedAudioTrack !== -1) {
      const activeTrack = audioTracks.find((t) => t.id === selectedAudioTrack);
      if (activeTrack) return activeTrack.name;
    }
    return activeStream?.isPtBr ? 'PT-BR · Dublado' : activeStream?.audio || 'Original';
  }, [audioTracks, selectedAudioTrack, activeStream]);

  const subtitleFontSizeClass =
    subtitleStyle.fontSize === 'sm'
      ? 'text-sm sm:text-base'
      : subtitleStyle.fontSize === 'lg'
        ? 'text-xl sm:text-2xl'
        : 'text-base sm:text-xl';

  return (
    <div
      ref={rootRef}
      onMouseMove={bumpControls}
      onTouchStart={bumpControls}
      className="fixed inset-0 z-50 bg-black text-white select-none overflow-hidden flex items-center justify-center"
    >
      {hasFirstFrame && isPlaying && <PlayerAd isVip={isVip} />}
      {/* Hidden local subtitle file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,.vtt,text/vtt"
        onChange={handleUploadSubtitle}
        className="hidden"
      />

      {/* Video Surface */}
      <video
        ref={videoRef}
        playsInline
        {...{ airplay: 'allow', 'x-webkit-airplay': 'allow' }}
        disableRemotePlayback={false}
        crossOrigin="anonymous"
        onClick={() => {
          if (openPanel) {
            setOpenPanel(null);
          } else {
            togglePlayPause();
          }
        }}
        onPlay={() => {
          setIsPlaying(true);
          inspectVideoFrame(videoRef.current);
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onLoadedData={() => inspectVideoFrame(videoRef.current)}
        onPlaying={() => {
          setIsPlaying(true);
          inspectVideoFrame(videoRef.current);
        }}
        onCanPlay={() => inspectVideoFrame(videoRef.current)}
        onResize={() => inspectVideoFrame(videoRef.current)}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (v) {
            setCurrentTime(v.currentTime);
            if (hasEnded && v.duration > 0 && v.currentTime < v.duration - 2) {
              setHasEnded(false);
            }
            if (v.currentTime > 4) {
              resumeTimeRef.current = v.currentTime;
            }
            if (!hasFirstFrame || (v.currentTime > 0.25 && (v.videoWidth === 0 || v.videoHeight === 0))) {
              inspectVideoFrame(v);
            }
          }
        }}
        onSeeking={() => {
          if (videoRef.current && videoRef.current.currentTime > 4) {
            resumeTimeRef.current = videoRef.current.currentTime;
          }
        }}
        onSeeked={() => {
          setIsBuffering(false);
          inspectVideoFrame(videoRef.current);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setHasEnded(true);
          setNextEpDismissed(false);
          if (autoplayNextEpisode && nextEp && onPlayNextEpisode) {
            onPlayNextEpisode(nextEp.season, nextEp.episode);
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v) {
            setDuration(v.duration || 0);
            if (resumeTimeRef.current > 4 && Number.isFinite(v.duration) && v.duration > resumeTimeRef.current + 8) {
              v.currentTime = resumeTimeRef.current;
            }
          }
        }}
        onDurationChange={() => {
          if (videoRef.current) setDuration(videoRef.current.duration || 0);
        }}
        onError={() => {
          // When hls.js is active, let hls.js error handler attempt recovery retries before failing over
          if (hlsRef.current) return;
          markCurrentFailedAndFallback(
            'Falha na reprodução do vídeo. Tente selecionar outro servidor.'
          );
        }}
        className="w-full h-full object-contain bg-black"
      />

      {/* Sleek Cinematic Loading Screen when Assistir is clicked or until first real video frame renders */}
      {!errorMsg && (!activeStream || !hasFirstFrame) && (
        <div
          aria-live="polite"
          data-testid="vaelor-player-loading"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#08090C] overflow-hidden animate-vaelor-enter"
        >
          <img
            src={item.backdrop}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-25 blur-xl scale-105 pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-[#08090C]/75 to-black/95 pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center text-center px-6 space-y-6">
            <div className="h-16 w-16 rounded-full border-[3px] border-white/20 border-t-white animate-spin motion-reduce:animate-none" aria-hidden="true" />

            <div className="space-y-2 max-w-md">
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white">
                {item.title}
                {item.mediaType === 'series' && season && episode ? ` · T${season}E${episode}` : ''}
              </h2>
              <p className="text-xs sm:text-sm text-stone-300 tracking-wide">
                {!activeStream
                  ? streams.length === 0
                    ? 'Localizando os melhores servidores de transmissão...'
                    : 'Preparando sala de cinema em alta definição...'
                  : 'Sincronizando áudio e vídeo...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Subtitle Overlay */}
      {activeCaptionText && (
        <div
          aria-live="off"
          className={`pointer-events-none absolute inset-x-4 flex justify-center transition-all duration-150 ${
            showControls ? 'bottom-24' : 'bottom-10'
          }`}
        >
          <span
            style={{
              backgroundColor: `rgba(0, 0, 0, ${subtitleStyle.bgOpacity})`,
              color: subtitleStyle.textColor,
            }}
            className={`px-4 py-1.5 rounded-lg font-medium text-center max-w-2xl whitespace-pre-line leading-snug shadow-lg ${subtitleFontSizeClass}`}
          >
            {activeCaptionText}
          </span>
        </div>
      )}

      {/* Top Gradient Overlay & Header (remains z-40 so Back button stays clickable over loader) */}
      <div
        className={`absolute top-0 inset-x-0 z-40 px-5 sm:px-8 py-5 bg-gradient-to-b from-black/85 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-200 ${
          showControls || !isPlaying || !hasFirstFrame ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={handleExit}
          aria-label="Voltar para detalhes do título"
          className="w-10 h-10 rounded-full bg-white/12 hover:bg-white/22 backdrop-blur-md flex items-center justify-center text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="text-center px-4 min-w-0">
          <h1 className="font-display text-sm sm:text-base font-bold text-white truncate">
            {item.title}
            {item.mediaType === 'series' && season && episode ? ` · T${season}E${episode}` : ''}
          </h1>
          <p className="text-[11px] sm:text-xs text-stone-300 truncate">
            {item.year} · {item.genres.slice(0, 2).join(', ')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleCast}
          aria-label="Transmitir para TV"
          title={
            castState === 'connected'
              ? 'Transmitindo na TV'
              : castState === 'connecting'
              ? 'Conectando à TV...'
              : 'Transmitir para TV (AirPlay / Chromecast)'
          }
          className={`w-10 h-10 rounded-full backdrop-blur-md flex items-center justify-center transition-all cursor-pointer ${
            castState === 'connected'
              ? 'text-sky-400 bg-sky-500/20 ring-2 ring-sky-400/50 shadow-[0_0_15px_rgba(56,189,248,0.5)]'
              : castState === 'connecting'
              ? 'text-amber-400 bg-amber-500/20 ring-1 ring-amber-400/40 animate-pulse'
              : 'text-white bg-white/12 hover:bg-white/22'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M2 20h.01" />
          </svg>
        </button>
      </div>

      {/* Floating Cast / AirPlay Toast notification */}
      {castToast && (
        <div className="absolute top-20 inset-x-0 z-50 flex justify-center pointer-events-none px-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/85 backdrop-blur-xl border border-white/20 text-white text-xs sm:text-sm font-medium shadow-2xl">
            <span
              className={`w-2 h-2 rounded-full ${
                castState === 'connected' ? 'bg-sky-400' : 'bg-amber-400 animate-ping'
              }`}
            />
            <span>{castToast}</span>
          </div>
        </div>
      )}

      {/* Center -10s / Play-Pause / +10s Controls (once first frame loaded) */}
      {!errorMsg && hasFirstFrame && (
        <div
          className={`absolute inset-0 z-10 pointer-events-none flex items-center justify-center transition-opacity duration-200 ${
            showControls || !isPlaying || isBuffering ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {isBuffering ? (
            <div className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center">
              <div className="w-7 h-7 rounded-full border-2 border-white/25 border-t-white animate-spin" />
            </div>
          ) : (
            <div className="pointer-events-auto flex items-center gap-8 sm:gap-12">
              <button
                type="button"
                onClick={() => seekBy(-10)}
                aria-label="Voltar 10 segundos"
                className="relative w-12 h-12 rounded-full hover:bg-white/12 flex items-center justify-center text-white transition-transform active:scale-90 cursor-pointer"
              >
                <RotateCcw className="w-7 h-7" />
                <span className="absolute text-[9px] font-bold mt-0.5">10</span>
              </button>

              <button
                type="button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? 'Pausar vídeo' : 'Reproduzir vídeo'}
                className="w-16 h-16 rounded-full hover:bg-white/12 flex items-center justify-center text-white transition-transform active:scale-90 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-10 h-10 fill-white" />
                ) : (
                  <Play className="w-10 h-10 fill-white ml-1" />
                )}
              </button>

              <button
                type="button"
                onClick={() => seekBy(10)}
                aria-label="Avançar 10 segundos"
                className="relative w-12 h-12 rounded-full hover:bg-white/12 flex items-center justify-center text-white transition-transform active:scale-90 cursor-pointer"
              >
                <RotateCw className="w-7 h-7" />
                <span className="absolute text-[9px] font-bold mt-0.5">10</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error Recovery Overlay */}
      {errorMsg && (
        <div className="relative z-40 max-w-md mx-4 rounded-2xl bg-[#13151C]/95 backdrop-blur-xl border border-white/15 p-6 text-center space-y-4">
          <AlertTriangle className="w-9 h-9 text-amber-400 mx-auto" />
          <p className="text-sm text-stone-200 leading-relaxed">{errorMsg}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setOpenPanel('servers')}
              className="px-4 py-2 rounded-full bg-white/12 hover:bg-white/20 text-xs font-semibold text-white cursor-pointer"
            >
              Trocar Servidor
            </button>
            <button
              type="button"
              onClick={() => {
                triedIdsRef.current.clear();
                setErrorMsg(null);
                setLockedStream(null);
                setIsBuffering(true);
                onRefreshStreams();
              }}
              className="px-5 py-2 rounded-full bg-white text-stone-950 text-xs font-semibold hover:bg-stone-200 cursor-pointer"
            >
              Recarregar Fontes
            </button>
          </div>
        </div>
      )}

      {/* Glass Popovers matching Screenshots 6, 7, 8 */}
      {openPanel === 'servers' && (
        <div
          role="dialog"
          aria-label="Servidores de reprodução"
          className="absolute bottom-20 right-5 sm:right-8 z-40 w-[330px] rounded-2xl bg-[#141720]/95 backdrop-blur-xl border border-white/14 p-4 shadow-2xl space-y-3 animate-vaelor-enter"
        >
          <div className="flex items-center justify-between px-1">
            <h2 className="font-display text-base font-bold text-white">Servidores</h2>
            <button
              type="button"
              onClick={() => setOpenPanel(null)}
              aria-label="Fechar servidores"
              className="p-1 rounded-full text-stone-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-2 no-scrollbar">
            {streams.length === 0 ? (
              <p className="text-xs text-stone-400 py-4 text-center">
                Nenhum servidor encontrado para este título.
              </p>
            ) : (
              streams.map((st, idx) => {
                const selected = activeStream ? st.id === activeStream.id : false;
                const is4kStream = isUltraHdQuality(st.quality) || /4k|2160p/i.test(st.label);
                const locked = is4kStream && !isVip;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      if (locked) {
                        onRequireVip?.();
                        return;
                      }
                      manualStreamOverrideRef.current = true;
                      triedIdsRef.current.clear();
                      setErrorMsg(null);
                      setStreamIndex(idx);
                      setLockedStream(st);
                      setOpenPanel(null);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white/14 border-white/30'
                        : 'bg-white/[0.04] border-white/8 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <GripVertical className="w-4 h-4 text-stone-500 shrink-0" strokeWidth={1.75} />
                      <SubtitleLanguageIcon lang={st.isPtBr ? 'pt-BR' : ''} label={st.audio} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-white truncate">{st.label}</p>
                          {is4kStream && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-400 to-yellow-500 text-stone-950">
                              <Crown className="w-2.5 h-2.5 fill-stone-950" />
                              VIP
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-300 truncate">
                          {st.quality} · {st.audio}
                        </p>
                      </div>
                    </div>

                    {locked ? (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 shrink-0">
                        <Lock className="w-3.5 h-3.5" />
                        <span>VIP</span>
                      </span>
                    ) : selected ? (
                      <span className="w-6 h-6 rounded-full bg-[#2EE58D] text-stone-950 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {openPanel === 'subtitles' && (
        <div
          role="dialog"
          aria-label="Legendas"
          className="absolute bottom-20 right-5 sm:right-8 z-40 w-[330px] rounded-2xl bg-[#141720]/95 backdrop-blur-xl border border-white/14 p-4 shadow-2xl space-y-3 animate-vaelor-enter"
        >
          <div className="flex items-center justify-between px-1">
            <h2 className="font-display text-base font-bold text-white">Legendas</h2>
            <button
              type="button"
              onClick={() => {
                setOpenPanel('settings');
                setSettingsSub('substyle');
              }}
              className="text-xs font-medium text-stone-300 hover:text-white cursor-pointer"
            >
              Personalizar
            </button>
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setActiveSubId(null)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                activeSubId === null
                  ? 'bg-white/14 text-white'
                  : 'text-stone-300 hover:bg-white/8'
              }`}
            >
              <span>Desativado</span>
              {activeSubId === null && (
                <span className="w-5 h-5 rounded-full bg-[#2EE58D] text-stone-950 flex items-center justify-center">
                  <Check className="w-3 h-3 stroke-[3]" />
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm text-stone-200 hover:bg-white/8 cursor-pointer"
            >
              <span>Enviar arquivo (.srt / .vtt)</span>
              <Upload className="w-4 h-4 text-stone-400" />
            </button>

            <button
              type="button"
              onClick={() => setShowSubSync((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm text-stone-200 hover:bg-white/8 cursor-pointer"
            >
              <span>
                Sincronizar legenda{' '}
                {subOffsetSec !== 0 && (
                  <span className="font-display font-medium text-emerald-300 tabular-nums">
                    ({subOffsetSec > 0 ? '+' : ''}
                    {subOffsetSec.toFixed(1)}s)
                  </span>
                )}
              </span>
              <ChevronRight className="w-4 h-4 text-stone-400" />
            </button>

            {showSubSync && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setSubOffsetSec((s) => Number((s - 0.5).toFixed(1)))}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                >
                  -0.5s
                </button>
                <button
                  type="button"
                  onClick={() => setSubOffsetSec(0)}
                  className="text-stone-300 hover:text-white font-display font-medium tabular-nums cursor-pointer"
                >
                  Zerar ({subOffsetSec.toFixed(1)}s)
                </button>
                <button
                  type="button"
                  onClick={() => setSubOffsetSec((s) => Number((s + 0.5).toFixed(1)))}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                >
                  +0.5s
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
              placeholder="Buscar idioma..."
              className="w-full rounded-xl bg-white/[0.05] border border-white/12 pl-9 pr-3 py-2 text-xs text-white placeholder-stone-500 focus:outline-none focus:border-white/30"
            />
          </div>

          <div className="max-h-44 overflow-y-auto space-y-1 no-scrollbar">
            {filteredSubtitles.length === 0 ? (
              <p className="text-xs text-stone-400 py-3 text-center">
                Nenhuma legenda externa encontrada. Envie um arquivo .srt ou .vtt.
              </p>
            ) : (
              filteredSubtitles.map((sub) => {
                const selected = activeSubId === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setActiveSubId(sub.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white/14 text-white font-semibold'
                        : 'text-stone-200 hover:bg-white/8'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <SubtitleLanguageIcon lang={sub.lang} label={sub.label} />
                      <span className="truncate">{sub.label}</span>
                    </span>
                    {selected ? (
                      <span className="w-5 h-5 rounded-full bg-[#2EE58D] text-stone-950 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </span>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => setOpenPanel(null)}
            className="w-full py-2.5 rounded-xl bg-black/60 hover:bg-black/80 border border-white/12 text-xs font-bold tracking-wider uppercase text-white cursor-pointer"
          >
            FECHAR
          </button>
        </div>
      )}

      {openPanel === 'settings' && (
        <div
          role="dialog"
          aria-label="Configurações de reprodução"
          className="absolute bottom-20 right-5 sm:right-8 z-40 w-[340px] rounded-2xl bg-[#141720]/95 backdrop-blur-xl border border-white/14 p-4 shadow-2xl space-y-4 animate-vaelor-enter"
        >
          {settingsSub === 'main' && (
            <>
              {/* 2x2 Bento Quick Cards matching Attachment 2 (media_1794685753631_6851d904) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }} className="w-full">
                {/* 1. QUALITY */}
                <button
                  type="button"
                  onClick={() => setSettingsSub('quality')}
                  className="rounded-2xl bg-[#1c1f2a]/95 hover:bg-white/10 border border-white/10 p-3 text-left transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-stone-400">
                    <Tv className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>QUALITY</span>
                  </div>
                  <p className="text-sm font-bold text-white truncate mt-1">
                    {activeQualityLabel.replace(' Full HD', '').replace(' (2160p)', '') || '1080p'}
                  </p>
                </button>

                {/* 2. SERVER */}
                <button
                  type="button"
                  onClick={() => setOpenPanel('servers')}
                  className="rounded-2xl bg-[#1c1f2a]/95 hover:bg-white/10 border border-white/10 p-3 text-left transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-stone-400">
                    <Server className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>SERVER</span>
                  </div>
                  <p className="text-sm font-bold text-white truncate mt-1">
                    {activeStream?.label ?? 'Servidor 1'}
                  </p>
                </button>

                {/* 3. SUBTITLES */}
                <button
                  type="button"
                  onClick={() => setOpenPanel('subtitles')}
                  className="rounded-2xl bg-[#1c1f2a]/95 hover:bg-white/10 border border-white/10 p-3 text-left transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-stone-400">
                    <Subtitles className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>SUBTITLES</span>
                  </div>
                  <p className="text-sm font-bold text-white truncate mt-1">
                    {activeSubObj?.label ?? 'Off'}
                  </p>
                </button>

                {/* 4. AUDIO */}
                <button
                  type="button"
                  onClick={() => setSettingsSub('audio')}
                  className="rounded-2xl bg-[#1c1f2a]/95 hover:bg-white/10 border border-white/10 p-3 text-left transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-stone-400">
                    <Music className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>AUDIO</span>
                  </div>
                  <p className="text-sm font-bold text-white truncate mt-1">
                    {activeStream?.isPtBr ? 'Dublado' : (currentAudioDisplayLabel || 'Original')}
                  </p>
                </button>
              </div>

              <div className="border-t border-white/10 pt-2 space-y-1 text-sm">
                <button
                  type="button"
                  onClick={() => setSettingsSub('timer')}
                  className="w-full flex items-center justify-between px-2 py-2.5 rounded-xl hover:bg-white/8 cursor-pointer"
                >
                  <span className="flex items-center gap-3 text-stone-200">
                    <Clock className="w-4 h-4 text-stone-400" />
                    Temporizador
                  </span>
                  <span className="flex items-center gap-1 text-xs text-stone-400">
                    {sleepMinutes > 0 ? `${sleepMinutes} min` : 'Desativado'}
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </button>

                <div className="w-full flex items-center justify-between px-2 py-2.5 rounded-xl">
                  <span className="flex items-center gap-3 text-stone-200">
                    <Subtitles className="w-4 h-4 text-stone-400" />
                    Ativar Legendas
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(activeSubId)}
                    onClick={() => {
                      if (activeSubId) {
                        setActiveSubId(null);
                      } else if (allSubtitles.length > 0) {
                        const pt = allSubtitles.find((s) => /pt/i.test(s.lang));
                        setActiveSubId((pt ?? allSubtitles[0]).id);
                      } else {
                        setOpenPanel('subtitles');
                      }
                    }}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                      activeSubId ? 'bg-[#2EE58D]' : 'bg-white/25'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                        activeSubId ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSettingsSub('speed')}
                  className="w-full flex items-center justify-between px-2 py-2.5 rounded-xl hover:bg-white/8 cursor-pointer"
                >
                  <span className="flex items-center gap-3 text-stone-200">
                    <Gauge className="w-4 h-4 text-stone-400" />
                    Velocidade
                  </span>
                  <span className="flex items-center gap-1 text-xs text-stone-400 tabular-nums">
                    {playbackRate}x
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSettingsSub('substyle')}
                  className="w-full flex items-center justify-between px-2 py-2.5 rounded-xl hover:bg-white/8 cursor-pointer"
                >
                  <span className="flex items-center gap-3 text-stone-200">
                    <Type className="w-4 h-4 text-stone-400" />
                    Estilo das Legendas
                  </span>
                  <ChevronRight className="w-4 h-4 text-stone-400" />
                </button>
              </div>
            </>
          )}

          {settingsSub === 'quality' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSettingsSub('main')}
                className="flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar · Qualidade de Vídeo
              </button>
              <div className="space-y-1 max-h-56 overflow-y-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => handleLevelSelect(-1)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer ${
                    activeLevel === -1 ? 'bg-white/15 font-semibold' : 'hover:bg-white/8'
                  }`}
                >
                  <span>Automático (Adaptativo)</span>
                  {activeLevel === -1 && <Check className="w-4 h-4 text-[#2EE58D]" />}
                </button>
                {levels.map((lvl) => {
                  const is4k = lvl.label.includes('4K') || lvl.label.includes('2160');
                  const locked = is4k && !isVip;
                  return (
                    <button
                      key={lvl.index}
                      type="button"
                      onClick={() => {
                        if (locked) {
                          onRequireVip?.();
                          return;
                        }
                        handleLevelSelect(lvl.index);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer transition-colors ${
                        activeLevel === lvl.index ? 'bg-white/15 font-semibold text-white' : 'hover:bg-white/8 text-stone-300'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{lvl.label}</span>
                        {is4k && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-400 to-yellow-500 text-stone-950 shadow-sm">
                            <Crown className="w-2.5 h-2.5 fill-stone-950" />
                            VIP
                          </span>
                        )}
                      </span>
                      {locked ? (
                        <span className="flex items-center gap-1 text-xs text-amber-400 font-semibold">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Bloqueado</span>
                        </span>
                      ) : activeLevel === lvl.index ? (
                        <Check className="w-4 h-4 text-[#2EE58D]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {settingsSub === 'audio' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setSettingsSub('main')}
                className="flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar · Seleção de Áudio
              </button>

              {audioTracks.length > 1 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wider">
                    Faixas deste Servidor ({activeStream?.label ?? 'Atual'})
                  </p>
                  <div className="space-y-1 max-h-52 overflow-y-auto no-scrollbar">
                    {audioTracks.map((track) => {
                      const isSelected = selectedAudioTrack === track.id;
                      return (
                        <button
                          key={track.id}
                          type="button"
                          onClick={() => {
                            if (hlsRef.current) {
                              hlsRef.current.audioTrack = track.id;
                              setSelectedAudioTrack(track.id);
                            }
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-white/15 font-semibold text-white'
                              : 'hover:bg-white/8 text-stone-300'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span>{track.name}</span>
                            {track.isPtBr && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                                PT-BR
                              </span>
                            )}
                          </span>
                          {isSelected && <Check className="w-4 h-4 text-[#2EE58D]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/8 space-y-1">
                  <p className="text-xs font-semibold text-white">
                    {activeStream?.audio || (activeStream?.isPtBr ? 'PT-BR · Dublado' : 'Áudio Original')}
                  </p>
                  <p className="text-[11px] text-stone-400">
                    {activeStream?.isPtBr
                      ? 'Este servidor transmite com áudio em português.'
                      : 'Este servidor transmite com áudio original.'}
                  </p>
                </div>
              )}

              {alternativeAudioStreams.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-white/10">
                  <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wider">
                    {activeStream?.isPtBr
                      ? 'Servidores com Áudio Original'
                      : 'Servidores com Áudio Dublado PT-BR'}
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto no-scrollbar">
                    {alternativeAudioStreams.map((alt) => (
                      <button
                        key={alt.stream.id}
                        type="button"
                        onClick={() => {
                          manualStreamOverrideRef.current = true;
                          triedIdsRef.current.clear();
                          setErrorMsg(null);
                          setStreamIndex(alt.index);
                          setLockedStream(alt.stream);
                          setSettingsSub('main');
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs hover:bg-white/8 text-stone-300 hover:text-white cursor-pointer transition-colors"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="font-semibold text-white">{alt.stream.label}</span>
                          <span className="text-stone-400">· {alt.stream.quality}</span>
                          <span className="text-stone-400">({alt.stream.audio})</span>
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {settingsSub === 'timer' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSettingsSub('main')}
                className="flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar · Temporizador
              </button>
              {[0, 15, 30, 60, 90].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    setSleepMinutes(mins);
                    setSettingsSub('main');
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer ${
                    sleepMinutes === mins ? 'bg-white/15 font-semibold' : 'hover:bg-white/8'
                  }`}
                >
                  <span>{mins === 0 ? 'Desativado' : `Pausar em ${mins} minutos`}</span>
                  {sleepMinutes === mins && <Check className="w-4 h-4 text-[#2EE58D]" />}
                </button>
              ))}
            </div>
          )}

          {settingsSub === 'speed' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSettingsSub('main')}
                className="flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar · Velocidade
              </button>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    setPlaybackRate(rate);
                    if (videoRef.current) videoRef.current.playbackRate = rate;
                    setSettingsSub('main');
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer ${
                    playbackRate === rate ? 'bg-white/15 font-semibold' : 'hover:bg-white/8'
                  }`}
                >
                  <span>{rate === 1 ? '1x (Normal)' : `${rate}x`}</span>
                  {playbackRate === rate && <Check className="w-4 h-4 text-[#2EE58D]" />}
                </button>
              ))}
            </div>
          )}

          {settingsSub === 'substyle' && (
            <div className="space-y-3 text-xs">
              <button
                type="button"
                onClick={() => setSettingsSub('main')}
                className="flex items-center gap-2 font-semibold text-stone-300 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar · Estilo das Legendas
              </button>

              <div className="space-y-1.5">
                <p className="text-stone-400">Tamanho da Fonte</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['sm', 'md', 'lg'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() =>
                        onUpdateSubtitleStyle({ ...subtitleStyle, fontSize: sz })
                      }
                      className={`py-1.5 rounded-lg border cursor-pointer ${
                        subtitleStyle.fontSize === sz
                          ? 'bg-white text-stone-950 border-white font-semibold'
                          : 'bg-white/5 border-white/10 text-stone-300'
                      }`}
                    >
                      {sz === 'sm' ? 'Pequena' : sz === 'md' ? 'Média' : 'Grande'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-stone-400">Cor do Texto</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { hex: '#FFFFFF' as const, name: 'Branco' },
                    { hex: '#FDE047' as const, name: 'Amarelo' },
                  ].map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() =>
                        onUpdateSubtitleStyle({ ...subtitleStyle, textColor: c.hex })
                      }
                      className={`py-1.5 rounded-lg border cursor-pointer ${
                        subtitleStyle.textColor === c.hex
                          ? 'bg-white/20 border-white text-white font-semibold'
                          : 'bg-white/5 border-white/10 text-stone-300'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpenPanel(null)}
            className="w-full py-2.5 rounded-xl bg-black/60 hover:bg-black/80 border border-white/12 text-xs font-bold tracking-wider uppercase text-white cursor-pointer"
          >
            FECHAR
          </button>
        </div>
      )}

      {/* Exact Skip Intro / Skip Recap Floating Pill */}
      {!errorMsg && hasFirstFrame && activeSkip && !openPanel && (
        <button
          type="button"
          onClick={handleSkipIntro}
          data-testid="skip-intro-btn"
          className={`absolute right-5 sm:right-8 z-30 inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-white/95 hover:bg-white text-stone-950 font-display text-xs sm:text-sm font-bold shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all active:scale-95 cursor-pointer ${
            showControls || !isPlaying ? 'bottom-24' : 'bottom-8'
          }`}
        >
          <SkipForward className="w-4 h-4 fill-stone-950" />
          <span>{activeSkip.type === 'recap' ? 'Pular Resumo' : 'Pular Intro'}</span>
        </button>
      )}

      {/* Watch Next Episode Card (Outro / Credits / Last 45s / Ended) */}
      {!errorMsg && hasFirstFrame && showNextEpCard && nextEp && !openPanel && (
        <div
          data-testid="next-episode-card"
          className={`absolute right-5 sm:right-8 z-30 w-[310px] sm:w-[340px] rounded-2xl bg-[#11151F]/92 backdrop-blur-xl border border-white/15 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.65)] space-y-3 transition-all ${
            activeSkip
              ? showControls || !isPlaying
                ? 'bottom-38'
                : 'bottom-22'
              : showControls || !isPlaying
                ? 'bottom-24'
                : 'bottom-8'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                A seguir · T{nextEp.season} · E{nextEp.episode}
              </p>
              <h3 className="font-display text-sm sm:text-base font-bold text-white truncate mt-0.5">
                {nextEp.title || `Episódio ${nextEp.episode}`}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setNextEpDismissed(true)}
              aria-label="Dispensar próximo episódio"
              className="p-1 rounded-full text-stone-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onPlayNextEpisode?.(nextEp.season, nextEp.episode)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-white hover:bg-stone-200 text-stone-950 font-display text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4 fill-stone-950" />
            <span>Assistir Próximo Episódio</span>
          </button>
        </div>
      )}

      {/* Bottom Controls Overlay */}
      <div
        className={`absolute bottom-0 inset-x-0 z-20 px-4 sm:px-8 pb-4 pt-12 bg-gradient-to-t from-black/95 via-black/60 to-transparent space-y-3 transition-opacity duration-200 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Full-width Sleek Progress Seek Bar */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Progresso do vídeo"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          onClick={(e) => {
            if (!videoRef.current || duration <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            const target = ratio * duration;
            resumeTimeRef.current = target;
            videoRef.current.currentTime = target;
          }}
          className="group relative w-full h-3 flex items-center cursor-pointer"
        >
          <div className="w-full h-1 group-hover:h-1.5 bg-white/25 rounded-full overflow-hidden transition-all">
            <div className="h-full bg-white" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between gap-4">
          {/* Left Controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              className="text-white hover:text-stone-300 transition-colors cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-white" />
              ) : (
                <Play className="w-5 h-5 fill-white" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              aria-label="Voltar 10s"
              className="hidden sm:inline-flex text-stone-200 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              aria-label="Avançar 10s"
              className="hidden sm:inline-flex text-stone-200 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
                className="text-stone-200 hover:text-white transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setVolume(val);
                  if (videoRef.current) {
                    videoRef.current.volume = val;
                    videoRef.current.muted = val === 0;
                  }
                  setIsMuted(val === 0);
                }}
                aria-label="Volume"
                className="hidden sm:block w-16 accent-white h-1 cursor-pointer"
              />
            </div>

            <span className="text-xs sm:text-[13px] font-medium text-stone-200 tabular-nums">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>
          </div>

          {/* Right Controls matching Screenshot 5 */}
          <div className="flex items-center gap-3 sm:gap-5">
            <button
              type="button"
              onClick={() => setOpenPanel((p) => (p === 'servers' ? null : 'servers'))}
              aria-label="Servidores"
              title="Servidores"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                openPanel === 'servers' ? 'bg-white/20 text-white' : 'text-stone-200 hover:text-white'
              }`}
            >
              <Server className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              type="button"
              onClick={() => setOpenPanel((p) => (p === 'subtitles' ? null : 'subtitles'))}
              aria-label="Legendas"
              title="Legendas"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                openPanel === 'subtitles' || activeSubId
                  ? 'bg-white/20 text-white'
                  : 'text-stone-200 hover:text-white'
              }`}
            >
              <Subtitles className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                setSettingsSub('main');
                setOpenPanel((p) => (p === 'settings' ? null : 'settings'));
              }}
              aria-label="Configurações do Player"
              title="Configurações"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                openPanel === 'settings' ? 'bg-white/20 text-white' : 'text-stone-200 hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              title="Tela cheia"
              className="p-1.5 rounded-lg text-stone-200 hover:text-white transition-colors cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
