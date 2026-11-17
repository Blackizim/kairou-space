import React, { useEffect, useRef, useState } from 'react';
import { Film, Loader2, Search, Tv } from 'lucide-react';
import type { MediaTitle } from '../data/curatedCatalog';
import { allowedForProfile } from '../utils/profileRating';
import { filterCatalogTitles } from '../utils/streamLogic';

interface SearchModalProps {
  isOpen: boolean;
  maxRating?: string;
  kids?: boolean;
  catalog: MediaTitle[];
  onClose: () => void;
  onSelectTitle: (item: MediaTitle) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  maxRating,
  kids,
  catalog,
  onClose,
  onSelectTitle,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaTitle[]>(catalog.slice(0, 8));
  const [searching, setSearching] = useState(false);
  const [failedPoster, setFailedPoster] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem('kairou_recent_searches') || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 6) : []; }
    catch { return []; }
  });
  const rememberSearch = (value: string) => {
    const term = value.trim();
    if (!term) return;
    setRecent((previous) => {
      const next = [term, ...previous.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 6);
      try { localStorage.setItem('kairou_recent_searches', JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
      return next;
    });
  };
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => inputRef.current?.focus(), 40);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(catalog.slice(0, 8));
      setSearching(false);
      return;
    }

    const localImmediate = filterCatalogTitles(catalog, { query: trimmed });
    setResults(localImmediate);

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { items?: MediaTitle[] };
        if (!cancelled && Array.isArray(json.items)) {
          setResults(json.items.filter(item => allowedForProfile(item, maxRating, kids)));
        }
      } catch {
        // Keep local results
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, catalog, isOpen, maxRating, kids]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buscar no catálogo Kairou"
      className="fixed inset-0 z-50 bg-[#060d14]/95 backdrop-blur-md flex items-start justify-center pt-12 sm:pt-[83px] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[760px] animate-vaelor-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 h-[62px] px-4 rounded-2xl border border-white/30 bg-[#1b202a]">
          <Search className="w-5 h-5 text-[#b6c6e5] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') rememberSearch(query); }}
            placeholder="Buscar filmes, séries, gêneros..."
            className="w-full bg-transparent text-white placeholder-[#b6c6e5] text-sm sm:text-base focus:outline-none"
          />
          {searching && <Loader2 className="w-4 h-4 text-stone-400 animate-spin shrink-0" />}
          <button type="button" onClick={onClose} aria-label="Fechar busca" className="rounded border border-white/15 px-2 py-1 text-[11px] text-[#c7d3e9] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Esc</button>
        </div>

        {!query.trim() && <div className="pt-5 text-[#b6c6e5]">
          {recent.length > 0 && <><p className="text-[11px] font-bold uppercase tracking-[0.12em]">Buscas recentes</p><div className="mt-3 flex flex-wrap gap-2">{recent.map((term) => <button key={term} type="button" onClick={() => setQuery(term)} className="rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">{term}</button>)}</div></>}
          <p className="mt-5 text-[13px]">Busque por título, gênero ou ano. / abre, Esc fecha.</p>
        </div>}
        {query.trim() && <div className="max-h-[62vh] overflow-y-auto mt-3 space-y-1.5 no-scrollbar">
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-400">
              Nenhum resultado encontrado para &ldquo;{query}&rdquo;.
            </p>
          ) : (
            results.map((item) => {
              const posterSrc = failedPoster[item.id]
                ? '/src/assets/images/poster_nyc_winter_1794566231280.jpg'
                : item.poster;

              return (
                <button
                  key={`${item.imdbId}-${item.id}`}
                  type="button"
                  onClick={() => {
                    rememberSearch(query);
                    onSelectTitle(item);
                    onClose();
                  }}
                  className="w-full flex items-center gap-4 p-2.5 rounded-xl hover:bg-white/8 text-left transition-colors cursor-pointer"
                >
                  <img
                    src={posterSrc}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    onError={() => setFailedPoster((p) => ({ ...p, [item.id]: true }))}
                    className="w-12 h-18 object-cover rounded-lg bg-stone-900 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold text-white truncate">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-stone-400">
                      {item.mediaType === 'movie' ? (
                        <Film className="w-3.5 h-3.5" />
                      ) : (
                        <Tv className="w-3.5 h-3.5" />
                      )}
                      <span>{item.mediaType === 'movie' ? 'Filme' : 'Série'}</span>
                      <span>·</span>
                      <span>{item.year}</span>
                      <span>·</span>
                      <span className="truncate">{item.genres.slice(0, 2).join(', ')}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>}
      </div>
    </div>
  );
};
