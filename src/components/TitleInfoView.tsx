import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  Globe,
  Languages,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Star,
} from 'lucide-react';
import type { EpisodeItem, MediaTitle } from '../data/curatedCatalog';
import type { AnonymizedExtractResponse } from '../types/player';

interface TitleInfoViewProps {
  item: MediaTitle;
  isLoadingMeta: boolean;
  selectedSeason: number;
  selectedEpisode: number;
  extractState: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: AnonymizedExtractResponse | null;
    error?: string;
  };
  inMyList: boolean;
  isWatched: boolean;
  onSelectSeasonEpisode: (season: number, episode: number, autoLaunch?: boolean) => void;
  onRefreshExtract: () => void;
  onLaunchPlayer: (preferredStreamIndex?: number) => void;
  onToggleMyList: () => void;
  onToggleWatched: () => void;
}

export const TitleInfoView: React.FC<TitleInfoViewProps> = ({
  item,
  isLoadingMeta,
  selectedSeason,
  selectedEpisode,
  extractState,
  inMyList,
  isWatched,
  onSelectSeasonEpisode,
  onRefreshExtract,
  onLaunchPlayer,
  onToggleMyList,
  onToggleWatched,
}) => {
  const [logoFailed, setLogoFailed] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({});
  const [failedEpisodeThumbs, setFailedEpisodeThumbs] = useState<Record<string, boolean>>({});
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogoFailed(false);
    setBgFailed(false);
    setSeasonDropdownOpen(false);
  }, [item.id]);

  useEffect(() => {
    if (!seasonDropdownOpen) return;
    const onPointerDown = (ev: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(ev.target as Node)) {
        setSeasonDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [seasonDropdownOpen]);

  const seasonsList = useMemo(() => {
    if (item.mediaType !== 'series') return [];
    const fromEpisodes = Array.from(new Set((item.episodes ?? []).map((e) => e.season))).sort(
      (a, b) => a - b
    );
    const total = Math.max(1, item.seasonsCount ?? 1, ...(fromEpisodes.length ? fromEpisodes : [1]));
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }, [item]);

  const seasonEpisodes: EpisodeItem[] = useMemo(() => {
    if (item.mediaType !== 'series') return [];
    const matching = (item.episodes ?? [])
      .filter((ep) => ep.season === selectedSeason)
      .sort((a, b) => a.episode - b.episode);
    if (matching.length > 0) return matching;
    return Array.from({ length: 8 }, (_, idx) => ({
      id: `${item.id}-s${selectedSeason}-e${idx + 1}`,
      season: selectedSeason,
      episode: idx + 1,
      title: `Episódio ${idx + 1}`,
      overview: `Temporada ${selectedSeason}, Episódio ${idx + 1} de ${item.title}.`,
    }));
  }, [item, selectedSeason]);

  const estimatedEnd = useMemo(() => {
    const mins = item.runtimeMinutes > 0 ? item.runtimeMinutes : 110;
    const d = new Date(Date.now() + mins * 60_000);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, [item.runtimeMinutes]);

  const streams = extractState.data?.streams ?? [];
  const ptBrCount = streams.filter((s) => s.isPtBr).length;
  const uhdCount = streams.filter((s) => s.is4k).length;
  const highestQuality =
    uhdCount > 0
      ? streams.find((s) => s.is4k)?.quality ?? item.qualityBadge
      : streams[0]?.quality ?? item.qualityBadge;

  const backdropSrc = bgFailed
    ? '/src/assets/images/cinelume_hero_cinema_1794566229858.jpg'
    : item.backdrop;

  const castList = useMemo(() => {
    if (item.castProfiles && item.castProfiles.length > 0) {
      return item.castProfiles;
    }
    return item.cast.map((name) => ({ name, character: 'Elenco Principal', avatar: undefined }));
  }, [item.castProfiles, item.cast]);

  return (
    <main className="relative min-h-screen bg-[#08090C] text-white pb-20 animate-vaelor-enter">
      {/* Full-bleed Backdrop Hero */}
      <div className="relative min-h-[76vh] flex items-end overflow-hidden">
        <img
          src={backdropSrc}
          alt={item.title}
          referrerPolicy="no-referrer"
          onError={() => setBgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#08090C] via-[#08090C]/75 to-[#08090C]/20" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08090C] via-[#08090C]/35 to-black/45" />

        <div className="relative z-10 w-full mx-auto max-w-[1440px] px-5 sm:px-10 pt-32 pb-12 flex flex-col lg:flex-row lg:items-end justify-between gap-10">
          {/* Left Content Column */}
          <div className="max-w-2xl space-y-5">
            {item.logo && !logoFailed ? (
              <img
                src={item.logo}
                alt={item.title}
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="max-h-28 sm:max-h-36 w-auto object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.9)]"
              />
            ) : (
              <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight uppercase leading-[0.95] text-balance">
                {item.title}
              </h1>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-200">{item.genres.join(' · ')}</p>
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onLaunchPlayer(0)}
                className="inline-flex items-center gap-2.5 px-7 py-3 rounded-full bg-white text-stone-950 font-semibold text-sm hover:bg-stone-200 active:scale-[0.98] transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-current" strokeWidth={1.75} />
                <span>
                  Assistir
                  {item.mediaType === 'series'
                    ? ` · T${selectedSeason}E${selectedEpisode}`
                    : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleMyList}
                aria-label={inMyList ? 'Remover da Minha Lista' : 'Adicionar à Minha Lista'}
                title={inMyList ? 'Na Minha Lista' : 'Adicionar à Minha Lista'}
                className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                  inMyList
                    ? 'bg-white text-stone-950 border-white'
                    : 'bg-white/12 text-white border-white/18 hover:bg-white/20 backdrop-blur-md'
                }`}
              >
                {inMyList ? (
                  <Check className="w-4 h-4" strokeWidth={1.85} />
                ) : (
                  <Plus className="w-4 h-4" strokeWidth={1.85} />
                )}
              </button>

              <button
                type="button"
                onClick={onToggleWatched}
                aria-label={isWatched ? 'Marcado como visto' : 'Marcar como visto'}
                title={isWatched ? 'Marcado como visto' : 'Marcar como visto'}
                className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                  isWatched
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                    : 'bg-white/12 text-white border-white/18 hover:bg-white/20 backdrop-blur-md'
                }`}
              >
                <Eye className="w-4 h-4" strokeWidth={1.75} />
              </button>

              <button
                type="button"
                onClick={onRefreshExtract}
                disabled={extractState.status === 'loading'}
                aria-label="Atualizar servidores de reprodução"
                title="Atualizar servidores"
                className="w-11 h-11 rounded-full bg-white/12 text-white border border-white/18 hover:bg-white/20 backdrop-blur-md flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  strokeWidth={1.75}
                  className={`w-4 h-4 ${extractState.status === 'loading' ? 'animate-spin' : ''}`}
                />
              </button>
            </div>

            {/* Metadata Line */}
            <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-stone-200 tabular-nums pt-1">
              <span>{item.year}</span>
              <span>{item.runtime}</span>
              <span className="px-1.5 py-0.5 rounded border border-white/25 text-[11px] font-semibold">
                {item.ageRating}
              </span>
              <span className="px-2 py-0.5 rounded border border-white/25 text-[11px] font-display font-semibold tracking-wide">
                {highestQuality}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-white">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" strokeWidth={1.75} />
                {item.rating}
              </span>
            </div>

            <p className="text-sm text-stone-200">
              <span className="text-stone-400">Direção:</span>{' '}
              <span className="font-semibold text-white">{item.director}</span>
            </p>

            <p className="text-sm sm:text-[15px] text-stone-200/90 leading-relaxed max-w-xl">
              {item.overview}
            </p>
          </div>

          {/* Right Translucent Specs Box */}
          <aside className="w-full lg:w-[320px] shrink-0 space-y-3">
            <div className="rounded-2xl bg-black/50 backdrop-blur-xl border border-white/14 divide-y divide-white/10 text-xs sm:text-[13px] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-stone-400">Duração</span>
                <span className="font-medium text-white tabular-nums">
                  {item.runtime} · Termina às {estimatedEnd}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-stone-400">Áudio</span>
                <span className="font-medium text-white">
                  {ptBrCount > 0 ? 'PT-BR / Dual Áudio' : item.audioBadge}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-stone-400">Estúdio</span>
                <span className="font-medium text-white">{item.network}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-stone-400">Qualidade Máx.</span>
                <span className="font-display font-medium tracking-wide text-white">{highestQuality}</span>
              </div>
            </div>

            {/* Quick Playback Options */}
            {streams.length > 0 && (
              <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 space-y-2">
                <p className="text-[11px] font-display font-semibold uppercase tracking-wider text-stone-400 px-1">
                  Reprodução Imediata
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar">
                  {streams.slice(0, 4).map((st, idx) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onLaunchPlayer(idx)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/12 border border-white/8 text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {st.isPtBr ? (
                          <Languages
                            className="w-4 h-4 text-emerald-300 shrink-0"
                            strokeWidth={1.75}
                          />
                        ) : (
                          <Globe
                            className="w-4 h-4 text-stone-300 shrink-0"
                            strokeWidth={1.75}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{st.label}</p>
                          <p className="text-[11px] text-stone-400 truncate">{st.audio}</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-display font-medium tracking-wide text-stone-200 shrink-0 ml-2">
                        {st.quality}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* Lower Details Section: Horizontal Episodes Strip + Cast */}
      <div className="mx-auto max-w-[1440px] px-5 sm:px-10 pt-8 space-y-12">
        {item.mediaType === 'series' && (
          <section aria-labelledby="episodes-heading" className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h2 id="episodes-heading" className="font-display text-2xl font-bold text-white">
                  Episódios
                </h2>
                {isLoadingMeta && (
                  <Loader2 className="w-4 h-4 text-stone-400 animate-spin" strokeWidth={1.75} />
                )}
              </div>

              {/* Season Dropdown Pill matching uploaded reference */}
              <div ref={dropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSeasonDropdownOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={seasonDropdownOpen}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] hover:bg-white/[0.11] border border-white/14 text-xs sm:text-sm font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span>Temporada {selectedSeason}</span>
                  <ChevronDown
                    strokeWidth={1.75}
                    className={`w-4 h-4 text-stone-300 transition-transform duration-150 ${
                      seasonDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {seasonDropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Selecionar temporada"
                    className="absolute right-0 mt-2 w-44 rounded-2xl bg-[#131722]/95 backdrop-blur-xl border border-white/14 shadow-2xl p-1.5 z-30 max-h-64 overflow-y-auto no-scrollbar animate-vaelor-enter"
                  >
                    {seasonsList.map((sNum) => {
                      const active = sNum === selectedSeason;
                      return (
                        <button
                          key={sNum}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            setSeasonDropdownOpen(false);
                            const matchingEps = (item.episodes ?? [])
                              .filter((e) => e.season === sNum)
                              .sort((a, b) => a.episode - b.episode);
                            const targetEp = matchingEps[0]?.episode ?? (sNum === selectedSeason ? selectedEpisode : 1);
                            onSelectSeasonEpisode(sNum, targetEp, false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm transition-colors cursor-pointer ${
                            active
                              ? 'bg-white/14 text-white font-semibold'
                              : 'text-stone-300 hover:bg-white/8 hover:text-white'
                          }`}
                        >
                          <span>Temporada {sNum}</span>
                          {active && (
                            <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Horizontal Widescreen Episode Cards Strip matching uploaded reference */}
            <div className="flex gap-4 overflow-x-auto overflow-y-hidden pt-2 pb-4 vaelor-episodes-scroll">
              {seasonEpisodes.map((ep) => {
                const isSelected =
                  ep.season === selectedSeason && ep.episode === selectedEpisode;
                const thumbSrc =
                  !failedEpisodeThumbs[ep.id] && ep.thumbnail ? ep.thumbnail : item.backdrop;
                const epRuntime = ep.runtime ?? item.runtimeMinutes;

                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => onSelectSeasonEpisode(ep.season, ep.episode, true)}
                    aria-label={`Reproduzir T${ep.season}E${ep.episode} — ${ep.title}`}
                    className={`group w-[268px] sm:w-[300px] shrink-0 rounded-2xl overflow-hidden bg-[#10131C] border text-left transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-white ${
                      isSelected
                        ? 'border-white/35 ring-1 ring-white/15'
                        : 'border-white/10 hover:border-white/25 hover:-translate-y-0.5'
                    }`}
                  >
                    <div className="relative aspect-video w-full bg-stone-900 overflow-hidden">
                      <img
                        src={thumbSrc}
                        alt={ep.title}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedEpisodeThumbs((p) => ({ ...p, [ep.id]: true }))
                        }
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/25" />

                      {/* Top-left E{n} badge */}
                      <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[11px] font-bold text-white tabular-nums">
                        E{ep.episode}
                      </span>

                      {/* Bottom-right duration badge */}
                      <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[11px] font-semibold text-white tabular-nums">
                        {epRuntime}m
                      </span>

                      {/* Subtle Play Overlay on Hover */}
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <span className="w-10 h-10 rounded-full bg-white text-stone-950 flex items-center justify-center shadow-lg">
                          <Play className="w-4 h-4 fill-current ml-0.5" strokeWidth={1.75} />
                        </span>
                      </span>
                    </div>

                    <div className="p-4 space-y-1.5">
                      <h3 className="text-sm font-bold text-white truncate">{ep.title}</h3>
                      <p className="text-xs text-stone-400 line-clamp-2 leading-relaxed min-h-[2.25rem]">
                        {ep.overview}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Cast Strip with TMDB Actor Photos */}
        {castList.length > 0 && (
          <section aria-labelledby="cast-heading" className="space-y-4">
            <h2 id="cast-heading" className="font-display text-2xl font-bold text-white">
              Elenco
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {castList.slice(0, 10).map((actor) => {
                const initials = actor.name
                  .split(' ')
                  .slice(0, 2)
                  .map((p) => p[0] ?? '')
                  .join('')
                  .toUpperCase();
                const showImg = actor.avatar && !failedAvatars[actor.name];
                return (
                  <div
                    key={actor.name}
                    className="flex items-center gap-3 rounded-2xl bg-white/[0.03] border border-white/8 p-3"
                  >
                    {showImg ? (
                      <img
                        src={actor.avatar}
                        alt={actor.name}
                        referrerPolicy="no-referrer"
                        onError={() => setFailedAvatars((p) => ({ ...p, [actor.name]: true }))}
                        className="w-10 h-10 rounded-full object-cover bg-stone-800 border border-white/15 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-xs font-bold text-stone-200 shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{actor.name}</p>
                      <p className="text-xs text-stone-400 truncate">
                        {actor.character || 'Elenco Principal'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
};
