import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Cloud,
  Compass,
  Film,
  Flame,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  Newspaper,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Smile,
  Sparkles,
  Trophy,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CHANNEL_CATEGORIES,
  LIVE_CHANNELS,
  type LiveChannel,
} from '../data/liveChannels';

interface LiveChannelsViewProps {
  onBack: () => void;
  isVip?: boolean;
}

export const LiveChannelsView: React.FC<LiveChannelsViewProps> = ({ onBack, isVip = false }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeChannel, setActiveChannel] = useState<LiveChannel | null>(null);

  // Player playback states
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ resolution?: string; codec?: string }>({});
  const [showControls, setShowControls] = useState<boolean>(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 4000);
  }, []);

  // Filter channels by category & search query
  const filteredChannels = useMemo(() => {
    let list = LIVE_CHANNELS;
    if (selectedCategory && selectedCategory !== 'todos') {
      list = list.filter((c) => c.category === selectedCategory);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.categoryLabel.toLowerCase().includes(q)
      );
    }
    return list;
  }, [selectedCategory, searchQuery]);

  // Featured channels for showcase
  const featuredChannels = useMemo(() => {
    const slugs = [
      'sportv',
      'premiere',
      'caze1',
      'espn',
      'globonews',
      'telecinepremium',
      'hbo',
      'globosp',
      'pt-benficatv',
      'cartoonnetwork',
    ];
    return LIVE_CHANNELS.filter((c) => slugs.includes(c.slug));
  }, []);

  // ProfitOn Watching Ads lifecycle for Live Channels (Loads ads during playback, purges when closed, VIPs immune)
  useEffect(() => {
    const win =
      typeof window !== 'undefined'
        ? (window as unknown as {
            KairouAds?: { loadWatchingAds: () => void; disableAds: () => void };
          })
        : undefined;

    if (activeChannel) {
      win?.KairouAds?.loadWatchingAds();
    } else {
      win?.KairouAds?.disableAds();
    }

    return () => {
      win?.KairouAds?.disableAds();
    };
  }, [activeChannel]);

  // Initialize Hls.js on channel switch
  useEffect(() => {
    if (!activeChannel) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setPlayerError(null);
    setIsBuffering(true);
    resetControlsTimer();

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const streamUrl = activeChannel.streamUrl;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        fragLoadingTimeOut: 12000,
        manifestLoadingTimeOut: 10000,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setIsBuffering(false);
        if (data.levels && data.levels.length > 0) {
          const l = data.levels[0];
          setStreamInfo({
            resolution: l.height ? `${l.height}p` : '1080p FHD',
            codec: l.codecSet || 'H.264',
          });
        }
        video.play().catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setPlayerError('Sinal temporariamente indisponível para este canal.');
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsBuffering(false);
        video.play().catch(() => setIsPlaying(false));
      });
    } else {
      setPlayerError('Seu navegador não suporta reprodução HLS ao vivo.');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [activeChannel, resetControlsTimer]);

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
    }
    resetControlsTimer();
  };

  const toggleMute = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    resetControlsTimer();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = Number.parseFloat(e.target.value);
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    setVolume(val);
    if (val === 0) {
      v.muted = true;
      setIsMuted(true);
    } else if (v.muted) {
      v.muted = false;
      setIsMuted(false);
    }
    resetControlsTimer();
  };

  const handleClosePlayer = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const v = videoRef.current;
    if (v) {
      try { v.pause(); } catch {}
      v.removeAttribute('src');
      v.load();
    }
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    setActiveChannel(null);
  };

  const toggleFullscreen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const container = playerContainerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const isFs = Boolean(
      document.fullscreenElement ||
      (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
      (document as unknown as { mozFullScreenElement?: Element }).mozFullScreenElement ||
      (document as unknown as { msFullscreenElement?: Element }).msFullscreenElement
    );

    if (isFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen) {
        (document as unknown as { webkitExitFullscreen: () => void }).webkitExitFullscreen();
      }
      setIsFullscreen(false);
      return;
    }

    // Try container requestFullscreen first (Desktop / Android Chrome)
    if (container.requestFullscreen) {
      container
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {
          // Fallback to video element on mobile/iOS
          if (video && (video as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen) {
            (video as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
          }
        });
    } else if ((container as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen) {
      (container as unknown as { webkitRequestFullscreen: () => void }).webkitRequestFullscreen();
      setIsFullscreen(true);
    } else if (video && (video as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen) {
      (video as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    }
    resetControlsTimer();
  };

  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'esportes':
        return <Trophy className="w-4 h-4" />;
      case 'abertos':
        return <Tv className="w-4 h-4" />;
      case 'filmes':
        return <Film className="w-4 h-4" />;
      case 'noticias':
        return <Newspaper className="w-4 h-4" />;
      case 'infantil':
        return <Smile className="w-4 h-4" />;
      case 'documentarios':
        return <Compass className="w-4 h-4" />;
      case 'portugal':
        return <Globe className="w-4 h-4" />;
      case 'variedades':
        return <Flame className="w-4 h-4" />;
      default:
        return <Sparkles className="w-4 h-4" />;
    }
  };

  return (
    <main className="min-h-screen bg-[#08090C] text-white pt-20 sm:pt-24 pb-24 px-4 sm:px-8 lg:px-12 max-w-[1520px] mx-auto animate-vaelor-enter">
      {/* Top Header Row matching TitleInfoView & HomeBrowseView */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-white/8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-medium text-stone-300 transition-colors cursor-pointer border border-white/10"
              aria-label="Voltar para início"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Início</span>
            </button>
            <span className="text-stone-500 text-xs">·</span>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-400/20 text-sky-400 text-xs font-semibold">
              <Cloud className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-mono text-[10px] tracking-wider uppercase">Ao Vivo</span>
            </div>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            Canais Ao Vivo
          </h1>
          <p className="text-xs sm:text-sm text-stone-400 mt-1 max-w-2xl">
            Transmissões contínuas em alta definição sem travamentos. Futebol ao vivo, canais abertos, filmes, séries e infantis.
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar canal por nome..."
            className="w-full bg-white/[0.04] border border-white/10 rounded-full pl-9 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-white transition-colors cursor-pointer"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Embedded Cinema Player when activeChannel is chosen */}
      {activeChannel && (
        <section aria-label="Player de TV Ao Vivo" className="my-8 space-y-3">
          {/* Mobile external close/switch bar for 100% touch reliability */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-stone-300">Assistindo agora:</span>
              <span className="text-xs font-bold text-white bg-white/10 px-2 py-0.5 rounded-md">
                {activeChannel.name}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClosePlayer}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-stone-200 hover:text-white border border-white/15 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Fechar Player</span>
            </button>
          </div>

          <div
            ref={playerContainerRef}
            onClick={() => {
              // Tapping the player on mobile/desktop toggles controls, NEVER pauses the stream!
              setShowControls((prev) => !prev);
              resetControlsTimer();
            }}
            className="relative aspect-video w-full max-h-[72vh] rounded-2xl sm:rounded-3xl overflow-hidden bg-black border border-white/10 shadow-2xl flex items-center justify-center cursor-pointer select-none"
          >
            <video
              ref={videoRef}
              className="w-full h-full object-contain pointer-events-none"
              playsInline
              webkit-playsinline="true"
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => setIsBuffering(false)}
            />

            {/* Buffering Indicator */}
            {isBuffering && (
              <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex flex-col items-center justify-center gap-3 pointer-events-none z-10">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
                <span className="text-xs font-semibold text-stone-300">Conectando ao sinal ao vivo...</span>
              </div>
            )}

            {/* Error Overlay */}
            {playerError && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30 space-y-3"
              >
                <AlertCircle className="w-10 h-10 text-red-400" />
                <h2 className="font-display font-bold text-lg text-white">Falha na transmissão</h2>
                <p className="text-xs text-stone-300 max-w-md">{playerError}</p>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const c = activeChannel;
                      setActiveChannel(null);
                      setTimeout(() => setActiveChannel(c), 100);
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-stone-950 font-semibold text-xs hover:bg-stone-200 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reconectar
                  </button>
                  <button
                    type="button"
                    onClick={handleClosePlayer}
                    className="px-5 py-2.5 rounded-full bg-white/10 text-white font-medium text-xs hover:bg-white/20 transition-colors cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}

            {/* Top Bar Overlay */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute top-0 inset-x-0 p-4 sm:p-6 bg-gradient-to-b from-black/85 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-200 z-20 ${
                showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 p-1.5 flex items-center justify-center border border-white/10 shrink-0">
                  <img
                    src={activeChannel.logo}
                    alt={activeChannel.name}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/assets/mark-small.svg';
                    }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-base text-white">
                      {activeChannel.name}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-400/30">
                      <Cloud className="w-3 h-3 text-sky-400" />
                      Ao Vivo
                    </span>
                  </div>
                  <p className="text-xs text-stone-400">
                    {activeChannel.categoryLabel} · {streamInfo.resolution || activeChannel.quality}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClosePlayer}
                className="w-9 h-9 rounded-full bg-black/60 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white cursor-pointer transition-colors shrink-0"
                title="Fechar Player"
                aria-label="Fechar player"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom Controls Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute bottom-0 inset-x-0 p-4 sm:p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-200 z-20 ${
                showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                  className="w-10 h-10 rounded-full bg-white text-stone-950 hover:bg-stone-200 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Desmutar' : 'Mutar'}
                    className="p-2 text-stone-300 hover:text-white transition-colors cursor-pointer"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    aria-label="Controle de volume"
                    className="w-16 sm:w-28 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-white/10 text-xs text-stone-300 font-mono">
                  <Cloud className="w-3.5 h-3.5 text-sky-400" />
                  <span>TRANSMISSÃO DIRETA</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                  className="p-2 text-stone-300 hover:text-white transition-colors cursor-pointer"
                  title="Tela cheia"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Zap Rail: Horizontal quick channel switcher */}
          <div className="px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/8 flex items-center gap-3 overflow-x-auto no-scrollbar">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-sky-400" />
              Trocar canal:
            </span>
            <div className="flex items-center gap-2">
              {LIVE_CHANNELS.slice(0, 24).map((ch) => {
                const isSelected = activeChannel.id === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setActiveChannel(ch)}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 border cursor-pointer ${
                      isSelected
                        ? 'bg-white text-stone-950 font-bold border-white shadow-sm'
                        : 'bg-white/5 hover:bg-white/10 text-stone-300 border-white/10'
                    }`}
                  >
                    <img
                      src={ch.logo}
                      alt={ch.name}
                      className="w-3.5 h-3.5 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/assets/mark-small.svg';
                      }}
                    />
                    <span>{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Featured / Em Alta Row when on "todos" */}
      {!searchQuery && selectedCategory === 'todos' && !activeChannel && (
        <section aria-labelledby="featured-channels-heading" className="my-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2
              id="featured-channels-heading"
              className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-sky-400" />
              <span>Canais Mais Assistidos</span>
            </h2>
            <span className="text-xs text-stone-400">Ao vivo</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
            {featuredChannels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  setActiveChannel(ch);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="group text-left p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/8 hover:border-white/20 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl cursor-pointer flex flex-col justify-between relative overflow-hidden"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 p-2 flex items-center justify-center">
                    <img
                      src={ch.logo}
                      alt={ch.name}
                      className="w-full h-full object-contain filter group-hover:brightness-110 transition-transform group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/assets/mark-small.svg';
                      }}
                    />
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-400/20">
                    <Cloud className="w-2.5 h-2.5 text-sky-400" />
                    Ao Vivo
                  </span>
                </div>

                <div>
                  <h3 className="font-display font-bold text-sm text-white group-hover:text-sky-300 transition-colors truncate">
                    {ch.name}
                  </h3>
                  <p className="text-[11px] text-stone-400 truncate mt-0.5">
                    {ch.categoryLabel}
                  </p>
                </div>

                <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-8 h-8 rounded-full bg-white text-stone-950 flex items-center justify-center shadow-lg">
                    <Play className="w-3.5 h-3.5 fill-stone-950 ml-0.5" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Category Pills Navigation (Matching Kairou TopNav / Filter Style) */}
      <nav aria-label="Categorias de Canais" className="my-6">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
          {CHANNEL_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer border ${
                  isSelected
                    ? 'bg-white text-stone-950 font-bold border-white shadow-sm'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] text-stone-300 border-white/10'
                }`}
              >
                <span>{getCategoryIcon(cat.id)}</span>
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isSelected ? 'bg-stone-200 text-stone-950' : 'bg-white/10 text-stone-400'
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Channel Count Subtitle */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-stone-400 font-medium">
          {filteredChannels.length} {filteredChannels.length === 1 ? 'canal disponível' : 'canais disponíveis'}
        </span>
      </div>

      {/* Empty State */}
      {filteredChannels.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.02] rounded-3xl border border-white/8">
          <Tv className="w-12 h-12 text-stone-500 mx-auto mb-3" />
          <h3 className="font-display font-bold text-lg text-white">Nenhum canal encontrado</h3>
          <p className="text-xs text-stone-400 mt-1 max-w-sm mx-auto">
            Não encontramos canais para a pesquisa selecionada. Tente outro termo ou limpe os filtros.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('todos');
            }}
            className="mt-4 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Limpar Filtros
          </button>
        </div>
      ) : (
        /* Channel Cards Grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {filteredChannels.map((ch) => {
            const isCurrent = activeChannel?.id === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  setActiveChannel(ch);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`group text-left p-3.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border transition-all duration-200 hover:-translate-y-1 hover:shadow-xl cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                  isCurrent
                    ? 'border-sky-400 ring-1 ring-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.2)]'
                    : 'border-white/8 hover:border-white/20'
                }`}
              >
                {/* Logo & Badges */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-white/5 border border-white/8 p-2 flex items-center justify-center shrink-0">
                    <img
                      src={ch.logo}
                      alt={ch.name}
                      className="w-full h-full object-contain filter group-hover:brightness-110 transition-transform group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/assets/mark-small.svg';
                      }}
                    />
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-400/20">
                      <Cloud className="w-2.5 h-2.5 text-sky-400" />
                      Ao Vivo
                    </span>
                    <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-white/5 text-stone-400 border border-white/5">
                      {ch.quality}
                    </span>
                  </div>
                </div>

                {/* Name & Category */}
                <div>
                  <h3 className="font-display font-bold text-xs sm:text-sm text-white group-hover:text-sky-300 transition-colors truncate">
                    {ch.name}
                  </h3>
                  <p className="text-[10px] text-stone-400 truncate mt-0.5">
                    {ch.categoryLabel}
                  </p>
                </div>

                {/* Hover Play Button */}
                <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-7 h-7 rounded-full bg-white text-stone-950 flex items-center justify-center shadow-lg">
                    <Play className="w-3.5 h-3.5 fill-stone-950 ml-0.5" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
};
