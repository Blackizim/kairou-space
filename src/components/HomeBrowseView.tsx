import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Play,
  Radio,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Tv,
} from 'lucide-react';
import type { MediaTitle } from '../data/curatedCatalog';
import { useScrollReveal } from '../utils/useScrollReveal';
import { formatRemainingMinutes } from '../utils/streamLogic';

function ScrollRail({ children, className }: { children: React.ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener('scroll', update); };
  }, [children]);
  const move = (direction: number) => { const el = ref.current; if (el) el.scrollBy({ left: direction * el.clientWidth * .8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  return <div className="kairou-rail relative group/rail">
    <div ref={ref} className={className}>{children}</div>
    {edges.left && <button type="button" aria-label="Rolar para a esquerda" onClick={() => move(-1)} className="rail-arrow left-0"><ChevronLeft size={20}/></button>}
    {edges.right && <button type="button" aria-label="Rolar para a direita" onClick={() => move(1)} className="rail-arrow right-0"><ChevronRight size={20}/></button>}
  </div>;
}

export interface WatchProgressEntry {
  item: MediaTitle;
  currentTime: number;
  duration: number;
  season?: number;
  episode?: number;
  updatedAt: number;
}

interface HomeBrowseViewProps {
  catalog: MediaTitle[];
  continueWatching: WatchProgressEntry[];
  myListIds: string[];
  onOpenInfo: (item: MediaTitle, resume?: boolean) => void;
  onRemoveContinue: (id: string) => void;
  onGoToChannels?: () => void;
  isKids?: boolean;
}

export const HomeBrowseView: React.FC<HomeBrowseViewProps> = ({
  catalog,
  continueWatching,
  onOpenInfo,
  onRemoveContinue,
  onGoToChannels,
  isKids = false,
}) => {
  const [editContinue, setEditContinue] = useState(false);
  const [failedImg, setFailedImg] = useState<Record<string, boolean>>({});

  const revealRef = useScrollReveal<HTMLDivElement>([catalog, continueWatching]);
  const top10 = catalog.slice(0, 10);
  const top10Ids = new Set(top10.map((i) => i.id));

  const animMovies = catalog.filter((i) => i.genres.some((g) => /animação|animacao/i.test(g)));
  const kidsSeries = catalog.filter((i) => i.mediaType === 'series');
  const familyMovies = catalog.filter((i) => i.mediaType === 'movie' && i.genres.some((g) => /família|familia|aventura/i.test(g)));
  const kidsAnimes = catalog.filter((i) => i.genres.some((g) => /anime/i.test(g)) || /japão|japan|naruto|one piece|dragon|avatar|totoro|ghibli|pokemon/i.test(i.title + i.originalTitle));

  // Deduplicate rails so each row shows varied, fresh items without repeating the rows above it
  const trendingFiltered = catalog.filter((i) => !top10Ids.has(i.id));
  const rail1Items = isKids ? (animMovies.length >= 2 ? animMovies : catalog.slice(0, 20)) : (trendingFiltered.length >= 10 ? trendingFiltered : catalog).slice(0, 20);

  const rail1Ids = new Set(rail1Items.map((i) => i.id));
  const seenIds1 = new Set([...top10Ids, ...rail1Ids]);

  const seriesFiltered = catalog.filter((i) => i.mediaType === 'series' && !seenIds1.has(i.id));
  const rail2Items = isKids
    ? (kidsSeries.length >= 2 ? kidsSeries : catalog.filter((i) => i.mediaType === 'series').slice(0, 20))
    : (seriesFiltered.length >= 10 ? seriesFiltered : catalog.filter((i) => i.mediaType === 'series')).slice(0, 20);

  const rail2Ids = new Set(rail2Items.map((i) => i.id));
  const seenIds2 = new Set([...seenIds1, ...rail2Ids]);

  const moviesFiltered = catalog.filter((i) => i.mediaType === 'movie' && !seenIds2.has(i.id));
  const rail3Items = isKids
    ? (familyMovies.length >= 2 ? familyMovies : catalog.filter((i) => i.mediaType === 'movie').slice(0, 20))
    : (moviesFiltered.length >= 10 ? moviesFiltered : catalog.filter((i) => i.mediaType === 'movie')).slice(0, 20);

  const rail3Ids = new Set(rail3Items.map((i) => i.id));
  const seenIds3 = new Set([...seenIds2, ...rail3Ids]);

  const actionFiltered = catalog.filter((i) => i.genres.some((g) => /ação|ficção|aventura|action|sci-fi/i.test(g)) && !seenIds3.has(i.id));
  const rail4Items = isKids
    ? (kidsAnimes.length >= 2 ? kidsAnimes : catalog.slice(10, 30))
    : (actionFiltered.length >= 8 ? actionFiltered : catalog.filter((i) => i.genres.some((g) => /ação|ficção|aventura|action|sci-fi/i.test(g)))).slice(0, 20);

  return (
    <div ref={revealRef} className="w-full px-5 sm:px-10 pb-20 pt-8 space-y-12">
      {/* Continue Watching Rail */}
      {continueWatching.length > 0 && (
        <section aria-labelledby="continue-heading" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2
              id="continue-heading"
              className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-1.5"
            >
              Continuar Assistindo
              <ChevronRight className="w-4 h-4 text-stone-400" strokeWidth={1.75} />
            </h2>
            <button
              type="button"
              onClick={() => setEditContinue((v) => !v)}
              aria-label="Editar lista de continuar assistindo"
              className={`p-2 rounded-full transition-colors cursor-pointer ${
                editContinue
                  ? 'bg-white text-stone-950'
                  : 'text-stone-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Pencil className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>

          <ScrollRail className="flex gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain pt-2 pb-4 no-scrollbar">
            {continueWatching.map((entry) => {
              const pct =
                entry.duration > 0
                  ? Math.min(98, Math.max(4, Math.round((entry.currentTime / entry.duration) * 100)))
                  : 18;
              const imgSrc = failedImg[`cw-${entry.item.id}`]
                ? '/src/assets/images/cinelume_hero_cinema_1794566229858.jpg'
                : entry.item.backdrop;

              return (
                <article
                  key={entry.item.id}
                  className="group relative w-[270px] sm:w-[300px] shrink-0 space-y-2"
                >
                  <button
                    type="button"
                    onClick={() => onOpenInfo(entry.item, true)}
                    className="relative block w-full aspect-video rounded-xl overflow-hidden bg-stone-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <img
                      src={imgSrc}
                      alt={entry.item.title}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImg((p) => ({ ...p, [`cw-${entry.item.id}`]: true }))}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-80" />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <span className="w-11 h-11 rounded-full bg-white text-stone-950 flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 fill-current ml-0.5" strokeWidth={1.75} />
                      </span>
                    </span>
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25">
                      <div className="h-full bg-white" style={{ width: `${pct}%` }} />
                    </div>
                  </button>

                  {editContinue && (
                    <button
                      type="button"
                      onClick={() => onRemoveContinue(entry.item.id)}
                      aria-label={`Remover ${entry.item.title} do histórico`}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                  )}

                  <div className="px-0.5">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {entry.item.title}
                      {entry.season && entry.episode ? ` · T${entry.season}E${entry.episode}` : ''}
                    </h3>
                    <p className="text-xs text-stone-400 tabular-nums">
                      {formatRemainingMinutes(
                        entry.duration || entry.item.runtimeMinutes * 60,
                        entry.currentTime
                      )}
                    </p>
                  </div>
                </article>
              );
            })}
          </ScrollRail>
        </section>
      )}

      {/* Top 10 Today with Giant Hollow Outlined Numbers */}
      <section aria-labelledby="top10-heading" className="space-y-5">
        <h2 id="top10-heading" className="font-display text-lg sm:text-xl font-bold text-white">
          {isKids ? 'Top 10 da Garotada' : 'Top 10 hoje no Kairou'}
        </h2>

        <ScrollRail className="flex gap-6 sm:gap-8 overflow-x-auto overflow-y-hidden overscroll-x-contain pt-4 pb-4 pl-2 no-scrollbar">
          {top10.map((item, idx) => {
            const rank = idx + 1;
            const posterSrc = failedImg[`t10-${item.id}`]
              ? '/src/assets/images/poster_nyc_winter_1794566231280.jpg'
              : item.poster;

            return (
              <button
                key={item.id}
                data-scroll-reveal
                type="button"
                onClick={() => onOpenInfo(item)}
                className="group relative flex items-end shrink-0 pl-9 sm:pl-12 cursor-pointer focus-visible:outline-2 focus-visible:outline-white rounded-xl"
                aria-label={`#${rank} ${item.title}`}
              >
                <span
                  aria-hidden="true"
                  className="rank-outline absolute left-0 bottom-0 text-[105px] sm:text-[132px] pointer-events-none transition-transform duration-200 group-hover:scale-105 origin-bottom-left select-none"
                >
                  {rank}
                </span>
                <div className="relative z-10 w-[142px] sm:w-[190px] xl:w-[208px] aspect-[2/3] rounded-xl overflow-hidden bg-stone-900 border border-white/10 shadow-xl transition-transform duration-200 group-hover:-translate-y-1.5">
                  <img
                    src={posterSrc}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImg((p) => ({ ...p, [`t10-${item.id}`]: true }))}
                    className="w-full h-full object-cover"
                  />
                </div>
              </button>
            );
          })}
        </ScrollRail>
      </section>

      {/* Live Channels Showcase Banner (Below Top 10) */}
      {!isKids && onGoToChannels && (
        <section aria-label="Canais Ao Vivo Kairou" className="w-full">
          <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-to-r from-sky-950/40 via-[#10141E] to-[#0A0D14] border border-white/10 hover:border-sky-500/30 p-5 sm:p-8 lg:p-10 shadow-2xl transition-all duration-300">
            {/* Ambient Background Glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-blue-600/10 blur-3xl"
            />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Left Column: Copy */}
              <div className="max-w-2xl space-y-2 sm:space-y-3">
                <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight">
                  Canais de TV Ao Vivo em HD e 4K
                </h3>

                <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
                  Futebol ao vivo com Premiere, SporTV, ESPN e CazéTV, além dos principais canais abertos, Telecine, HBO e infantis. Sem travamentos e com a melhor resolução direto no player.
                </p>
              </div>

              {/* Right Column: CTA Button */}
              <div className="flex flex-col sm:flex-row lg:flex-col items-start lg:items-end gap-3 shrink-0 pt-2 lg:pt-0">
                <button
                  type="button"
                  onClick={onGoToChannels}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 sm:px-8 py-3.5 rounded-full bg-white text-stone-950 font-display font-bold text-sm hover:bg-stone-200 active:scale-[0.98] transition-all cursor-pointer shadow-lg hover:shadow-white/10"
                >
                  <Tv className="w-4 h-4 text-stone-950" />
                  <span>Assistir Canais Ao Vivo</span>
                  <ChevronRight className="w-4 h-4 text-stone-600" />
                </button>
                <span className="text-[11px] text-stone-400 font-medium pl-1 sm:pl-0">
                  Mais de 140 canais disponíveis gratuitamente
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Rail 1 */}
      <section aria-labelledby="trending-heading" className="space-y-4">
        <h2 id="trending-heading" className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-1.5">
          {isKids ? 'Filmes de Animação Incríveis' : 'Em Alta Agora'}
          <ChevronRight className="w-4 h-4 text-stone-400" strokeWidth={1.75} />
        </h2>
        <PosterRail items={rail1Items} failedImg={failedImg} setFailedImg={setFailedImg} onOpenInfo={onOpenInfo} />
      </section>

      {/* Rail 2 */}
      <section aria-labelledby="series-heading" className="space-y-4">
        <h2 id="series-heading" className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-1.5">
          {isKids ? 'Desenhos e Séries Infantis' : 'Séries em Alta'}
          <ChevronRight className="w-4 h-4 text-stone-400" strokeWidth={1.75} />
        </h2>
        <PosterRail items={rail2Items} failedImg={failedImg} setFailedImg={setFailedImg} onOpenInfo={onOpenInfo} />
      </section>

      {/* Rail 3 */}
      <section aria-labelledby="movies-heading" className="space-y-4">
        <h2 id="movies-heading" className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-1.5">
          {isKids ? 'Aventura e Magia em Família' : 'Filmes Populares'}
          <ChevronRight className="w-4 h-4 text-stone-400" strokeWidth={1.75} />
        </h2>
        <PosterRail items={rail3Items} failedImg={failedImg} setFailedImg={setFailedImg} onOpenInfo={onOpenInfo} />
      </section>

      {/* Rail 4 */}
      <section aria-labelledby="scifi-heading" className="space-y-4">
        <h2 id="scifi-heading" className="font-display text-lg sm:text-xl font-bold text-white flex items-center gap-1.5">
          {isKids ? 'Animes para Toda a Família' : 'Ação & Ficção Científica'}
          <ChevronRight className="w-4 h-4 text-stone-400" strokeWidth={1.75} />
        </h2>
        <PosterRail items={rail4Items} failedImg={failedImg} setFailedImg={setFailedImg} onOpenInfo={onOpenInfo} />
      </section>
    </div>
  );
};

interface PosterRailProps {
  items: MediaTitle[];
  failedImg: Record<string, boolean>;
  setFailedImg: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onOpenInfo: (item: MediaTitle) => void;
}

const PosterRail: React.FC<PosterRailProps> = ({
  items,
  failedImg,
  setFailedImg,
  onOpenInfo,
}) => {
  return (
    <ScrollRail className="flex gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain pt-3 pb-4 no-scrollbar">
      {items.map((item) => {
        const posterSrc = failedImg[`rail-${item.id}`]
          ? '/src/assets/images/poster_metro_hospital_1794566232848.jpg'
          : item.poster;

        return (
          <button
            key={item.id}
            data-scroll-reveal
            type="button"
            onClick={() => onOpenInfo(item)}
            className="group w-[148px] sm:w-[190px] xl:w-[208px] shrink-0 text-left space-y-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-white rounded-xl"
          >
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-stone-900 border border-white/10 transition-transform duration-200 group-hover:-translate-y-1.5 shadow-md group-hover:shadow-xl">
              <img
                src={posterSrc}
                alt={item.title}
                referrerPolicy="no-referrer"
                onError={() => setFailedImg((p) => ({ ...p, [`rail-${item.id}`]: true }))}
                className="w-full h-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-3">
                <span className="inline-flex items-center gap-1 text-[11px] font-display font-medium tracking-wide text-white/95">
                  {item.qualityBadge} · {item.rating}{' '}
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" strokeWidth={1.75} />
                </span>
              </div>
            </div>
            <p className="text-xs sm:text-sm font-medium text-stone-200 group-hover:text-white truncate">
              {item.title}
            </p>
          </button>
        );
      })}
    </ScrollRail>
  );
};
