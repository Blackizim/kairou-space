import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Play, Plus, Star } from 'lucide-react';
import type { MediaTitle } from '../data/curatedCatalog';

interface CatalogGridViewProps {
  title: string;
  subtitle?: string;
  items: MediaTitle[];
  mediaTypeFilter: 'all' | 'movie' | 'series';
  myListIds?: string[];
  onToggleMyList?: (item: MediaTitle) => void;
  emptyMessage?: string;
  onOpenInfo: (item: MediaTitle) => void;
  isKids?: boolean;
}

type SortKind = 'popular' | 'rating' | 'new';

const MOVIE_GENRES = [
  { id: '', label: 'Todos os gêneros' },
  { id: 'Ação', label: 'Ação' },
  { id: 'Aventura', label: 'Aventura' },
  { id: 'Comédia', label: 'Comédia' },
  { id: 'Terror', label: 'Terror' },
  { id: 'Ficção Científica', label: 'Ficção Científica' },
  { id: 'Drama', label: 'Drama' },
  { id: 'Animação', label: 'Animação' },
  { id: 'Romance', label: 'Romance' },
  { id: 'Suspense', label: 'Suspense' },
  { id: 'Crime', label: 'Crime' },
  { id: 'Fantasia', label: 'Fantasia' },
];

const SERIES_GENRES = [
  { id: '', label: 'Todos os gêneros' },
  { id: 'Drama', label: 'Drama' },
  { id: 'Ação', label: 'Ação & Aventura' },
  { id: 'Comédia', label: 'Comédia' },
  { id: 'Ficção Científica', label: 'Sci-Fi & Fantasia' },
  { id: 'Suspense', label: 'Mistério' },
  { id: 'Crime', label: 'Crime' },
  { id: 'Animação', label: 'Animação' },
  { id: 'Documentário', label: 'Documentário' },
];

const KIDS_MOVIE_GENRES = [
  { id: '', label: 'Todos os gêneros' },
  { id: 'Animação', label: 'Animação' },
  { id: 'Aventura', label: 'Aventura' },
  { id: 'Comédia', label: 'Comédia' },
  { id: 'Família', label: 'Família' },
  { id: 'Fantasia', label: 'Fantasia' },
];

const KIDS_SERIES_GENRES = [
  { id: '', label: 'Todos os gêneros' },
  { id: 'Animação', label: 'Desenhos Animados' },
  { id: 'Aventura', label: 'Aventura & Família' },
  { id: 'Comédia', label: 'Comédia' },
  { id: 'Kids', label: 'Infantil' },
  { id: 'Fantasia', label: 'Fantasia' },
];

const ALL_GENRES = [
  { id: '', label: 'Todos os gêneros' },
  { id: 'Ação', label: 'Ação' },
  { id: 'Comédia', label: 'Comédia' },
  { id: 'Drama', label: 'Drama' },
  { id: 'Ficção Científica', label: 'Sci-Fi' },
  { id: 'Animação', label: 'Animação' },
];

const PAGE_SIZE = 24;

export const CatalogGridView: React.FC<CatalogGridViewProps> = ({
  title,
  items,
  mediaTypeFilter,
  myListIds = [],
  onToggleMyList,
  emptyMessage = 'Nenhum título encontrado para este gênero.',
  onOpenInfo,
  isKids = false,
}) => {
  const [sort, setSort] = useState<SortKind>('popular');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [failedImg, setFailedImg] = useState<Record<string, boolean>>({});

  const isServerPaged = mediaTypeFilter === 'movie' || mediaTypeFilter === 'series';
  const [serverItems, setServerItems] = useState<MediaTitle[]>([]);
  const [serverPage, setServerPage] = useState<number>(1);
  const [serverHasMore, setServerHasMore] = useState<boolean>(true);

  const genreList = useMemo(() => {
    if (isKids) {
      if (mediaTypeFilter === 'movie') return KIDS_MOVIE_GENRES;
      if (mediaTypeFilter === 'series') return KIDS_SERIES_GENRES;
    }
    if (mediaTypeFilter === 'movie') return MOVIE_GENRES;
    if (mediaTypeFilter === 'series') return SERIES_GENRES;
    return ALL_GENRES;
  }, [mediaTypeFilter, isKids]);

  const filteredAndSorted = useMemo(() => {
    // 1. Filter by mediaType
    let result = items.filter((item) => {
      if (mediaTypeFilter === 'all') return true;
      return item.mediaType === mediaTypeFilter;
    });

    // 2. Filter by genre
    if (selectedGenre) {
      const q = selectedGenre.toLowerCase();
      result = result.filter((item) =>
        item.genres.some((g) => {
          const gl = g.toLowerCase();
          return gl.includes(q) || q.includes(gl);
        })
      );
    }

    // 3. Sort
    if (sort === 'rating') {
      result = [...result].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    } else if (sort === 'new') {
      result = [...result].sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    }

    return result;
  }, [items, mediaTypeFilter, selectedGenre, sort]);

  // Initial and on-filter change fetch for server-paged catalogs
  useEffect(() => {
    if (!isServerPaged) return;
    let cancelled = false;
    setServerPage(1);
    setServerHasMore(true);

    const url = `/api/catalog/browse?type=${mediaTypeFilter}&kids=${Boolean(isKids)}&page=1&genre=${encodeURIComponent(
      selectedGenre
    )}&sort=${sort}`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: MediaTitle[]; hasMore?: boolean } | null) => {
        if (cancelled) return;
        if (data?.items && data.items.length > 0) {
          setServerItems(data.items);
          setServerHasMore(Boolean(data.hasMore));
        } else {
          // Fallback to locally filtered items
          setServerItems(filteredAndSorted);
          setServerHasMore(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setServerItems(filteredAndSorted);
        setServerHasMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaTypeFilter, isKids, selectedGenre, sort, isServerPaged, filteredAndSorted]);

  const displayedItems = useMemo(() => {
    if (isServerPaged) {
      if (serverItems.length > 0) return serverItems;
      return filteredAndSorted;
    }
    return filteredAndSorted.slice(0, page * PAGE_SIZE);
  }, [isServerPaged, serverItems, filteredAndSorted, page]);

  const hasMore = isServerPaged
    ? serverHasMore
    : displayedItems.length < filteredAndSorted.length;

  const handleLoadMore = () => {
    if (loadingMore) return;

    if (!isServerPaged) {
      setLoadingMore(true);
      setTimeout(() => {
        setPage((prev) => prev + 1);
        setLoadingMore(false);
      }, 280);
      return;
    }

    setLoadingMore(true);
    const nextPage = serverPage + 1;
    const url = `/api/catalog/browse?type=${mediaTypeFilter}&kids=${Boolean(isKids)}&page=${nextPage}&genre=${encodeURIComponent(
      selectedGenre
    )}&sort=${sort}`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: MediaTitle[]; hasMore?: boolean } | null) => {
        if (data?.items && data.items.length > 0) {
          setServerItems((prev) => {
            const seen = new Set(prev.map((it) => it.id));
            const fresh = data.items!.filter((it) => !seen.has(it.id));
            return [...prev, ...fresh];
          });
          setServerPage(nextPage);
          setServerHasMore(Boolean(data.hasMore));
        } else {
          setServerHasMore(false);
        }
      })
      .catch(() => {
        setServerHasMore(false);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  };

  const panelName =
    mediaTypeFilter === 'movie'
      ? 'movies'
      : mediaTypeFilter === 'series'
        ? 'series'
        : 'list';

  return (
    <section className="view" data-panel={panelName} aria-label={title}>
      {/* ░░ Page Head (Exact REA layout) ░░ */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h2 className="page-title">{title}</h2>
        </div>
        <div className="segmented" data-seg={panelName}>
          <button
            type="button"
            className={sort === 'popular' ? 'is-active' : ''}
            onClick={() => {
              setSort('popular');
              setPage(1);
            }}
          >
            Populares
          </button>
          <button
            type="button"
            className={sort === 'rating' ? 'is-active' : ''}
            onClick={() => {
              setSort('rating');
              setPage(1);
            }}
          >
            Melhor nota
          </button>
          <button
            type="button"
            className={sort === 'new' ? 'is-active' : ''}
            onClick={() => {
              setSort('new');
              setPage(1);
            }}
          >
            Lançamentos
          </button>
        </div>
      </div>

      {/* ░░ Genre Chips (Exact REA layout) ░░ */}
      <div className="genre-chips-wrap">
        <div className="genre-chips" role="toolbar" aria-label={`Gêneros de ${title.toLowerCase()}`}>
          {genreList.map((g) => {
            const active = selectedGenre === g.id;
            return (
              <button
                key={g.id || 'all'}
                type="button"
                className={`genre-chip ${active ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedGenre(g.id);
                  setPage(1);
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ░░ Grid / Cards (Exact REA layout) ░░ */}
      {displayedItems.length === 0 ? (
        <p className="empty">{emptyMessage}</p>
      ) : (
        <div className="grid" id={`grid-${panelName}`}>
          {displayedItems.map((item) => {
            const isSaved = myListIds.includes(item.id);
            const poster = failedImg[item.id]
              ? '/src/assets/images/poster_nyc_winter_1794566231280.jpg'
              : item.poster;

            return (
              <article
                key={item.id}
                className="card has-poster reveal"
                onClick={() => onOpenInfo(item)}
              >
                <img
                  className="card__poster"
                  src={poster}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImg((p) => ({ ...p, [item.id]: true }))}
                />
                <div className="card__shade" aria-hidden="true" />
                <div className="card__label">
                  <span className="card__title">{item.title}</span>
                  <span className="card__sub">
                    {item.year || ''}{item.year ? ' · ' : ''}{item.mediaType === 'movie' ? 'Filme' : 'Série'}
                  </span>
                </div>
                <div className="card__hover">
                  <div className="card__quick">
                    {onToggleMyList && (
                      <button
                        type="button"
                        className={`quick-btn ${isSaved ? 'is-added' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleMyList(item);
                        }}
                        aria-label={isSaved ? 'Remover da lista' : 'Adicionar à lista'}
                        aria-pressed={isSaved}
                      >
                        {isSaved ? <Check size={13} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="quick-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInfo(item);
                      }}
                      aria-label={`Mais informações sobre ${item.title}`}
                    >
                      <ChevronDown size={14} strokeWidth={2.5} />
                    </button>
                  </div>

                  <button
                    type="button"
                    className="card__play"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenInfo(item);
                    }}
                    aria-label={`Reproduzir ${item.title}`}
                  >
                    <Play size={16} fill="currentColor" className="ml-0.5" />
                  </button>

                  <div className="card__meta">
                    <span className="score">
                      <Star size={11} fill="currentColor" />
                      {Number(item.rating || 0).toFixed(1)}
                    </span>
                    <span className="truncate">{item.genres?.[0] || (item.mediaType === 'movie' ? 'Filme' : 'Série')}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ░░ Load More (Exact REA layout) ░░ */}
      {hasMore && (
        <div className="load-more-wrap">
          <button
            type="button"
            className={`btn-load-more ${loadingMore ? 'is-loading' : ''}`}
            onClick={handleLoadMore}
          >
            <span className="btn-load-more__text">
              Carregar mais {mediaTypeFilter === 'movie' ? (isKids ? 'filmes infantis' : 'filmes') : (isKids ? 'desenhos e séries' : 'séries')}
            </span>
            <span className="btn-load-more__spinner" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};
