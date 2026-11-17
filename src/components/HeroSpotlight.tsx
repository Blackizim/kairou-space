import React, { useEffect, useState } from 'react';
import { Calendar, Check, Info, Play, Plus, Star, Swords } from 'lucide-react';
import type { MediaTitle } from '../data/curatedCatalog';

interface HeroSpotlightProps {
  items: MediaTitle[];
  myListIds: string[];
  onOpenInfo: (item: MediaTitle) => void;
  onToggleMyList: (item: MediaTitle) => void;
}

export const HeroSpotlight: React.FC<HeroSpotlightProps> = ({
  items,
  myListIds,
  onOpenInfo,
  onToggleMyList,
}) => {
  const featured = items.slice(0, 7);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failedLogoIds, setFailedLogoIds] = useState<Record<string, boolean>>({});
  const [failedBgIds, setFailedBgIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (paused || featured.length <= 1) return;
    const id = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % featured.length);
    }, 7500);
    return () => clearInterval(id);
  }, [paused, featured.length]);

  const current = featured[activeIndex] ?? featured[0];
  if (!current) return null;

  const inList = myListIds.includes(current.id);
  const logoFailed = !current.logo || failedLogoIds[current.id];
  const backdropSrc = failedBgIds[current.id]
    ? '/src/assets/images/cinelume_hero_cinema_1794566229858.jpg'
    : current.backdrop;

  return (
    <section
      aria-label="Destaques em cartaz"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative w-full min-h-[74vh] max-h-[820px] flex items-end overflow-hidden bg-[#08090C]"
    >
      {/* Full-bleed Backdrop with smooth compositor transition */}
      <img
        key={current.id}
        src={backdropSrc}
        alt={current.title}
        referrerPolicy="no-referrer"
        onError={() => setFailedBgIds((p) => ({ ...p, [current.id]: true }))}
        className="absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-500 animate-vaelor-enter"
      />

      {/* Measured contrast scrims fading seamlessly into #08090C */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#08090C]/95 via-[#08090C]/45 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08090C] via-[#08090C]/25 to-black/35" />

      {/* Content Block */}
      <div className="relative z-10 w-full px-5 sm:px-10 pb-14 pt-32 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div key={`meta-${current.id}`} className="max-w-xl space-y-4 animate-vaelor-enter">
          {!logoFailed ? (
            <img
              src={current.logo}
              alt={current.title}
              referrerPolicy="no-referrer"
              onError={() => setFailedLogoIds((p) => ({ ...p, [current.id]: true }))}
              className="max-h-20 sm:max-h-28 max-w-full w-auto object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]"
            />
          ) : (
            <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight text-white uppercase leading-[0.96] text-balance">
              {current.title}
            </h1>
          )}

          {/* Unboxed typographic metadata row */}
          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm font-medium text-stone-200 tabular-nums">
            <span className="inline-flex items-center gap-1 text-white">
              <Star className="w-3.5 h-3.5 fill-white text-white" />
              {current.rating}
            </span>
            <span aria-hidden="true" className="text-stone-500">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-stone-300" />
              {current.year}
            </span>
            <span aria-hidden="true" className="text-stone-500">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5 text-stone-300" />
              {current.genres.slice(0, 2).join(', ')}
            </span>
          </div>

          <p className="text-sm sm:text-[15px] text-stone-200/90 leading-relaxed line-clamp-3">
            {current.overview}
          </p>

          {/* Primary Play (routes to Info page & auto-extracts!) + Grouped Action Pill */}
          <div className="pt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenInfo(current)}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-stone-950 font-semibold text-sm hover:bg-stone-200 active:scale-[0.98] transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4 fill-current" />
              Assistir
            </button>

            <div className="inline-flex items-center rounded-full bg-white/12 backdrop-blur-md border border-white/15 p-0.5">
              <button
                type="button"
                onClick={() => onToggleMyList(current)}
                aria-label={inList ? `Remover ${current.title} da Minha Lista` : `Adicionar ${current.title} à Minha Lista`}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors cursor-pointer"
              >
                {inList ? <Check className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4" />}
              </button>
              <span aria-hidden="true" className="w-px h-4 bg-white/15" />
              <button
                type="button"
                onClick={() => onOpenInfo(current)}
                aria-label={`Ver detalhes de ${current.title}`}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors cursor-pointer"
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom-right Carousel Dots */}
        <div className="flex items-center gap-1.5 self-start md:self-end pb-1">
          {featured.map((item, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                aria-label={`Mostrar destaque ${item.title}`}
                className={`h-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                  isActive ? 'w-5 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'
                }`}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
};
