import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CURATED_CATALOG, type EpisodeItem, type MediaTitle } from './data/curatedCatalog';
import { CatalogGridView } from './components/CatalogGridView';
import { CinemaPlayer } from './components/CinemaPlayer';
import { HeroSpotlight } from './components/HeroSpotlight';
import { HomeBrowseView, type WatchProgressEntry } from './components/HomeBrowseView';
import { AccountMenu } from './components/AccountMenu';
import {
  AccountModal,
  readAccounts,
  updateStoredAccount,
  type Account,
  type Profile,
} from './components/AccountModal';
import { VipModal } from './components/VipModal';
import { allowedForProfile } from './utils/profileRating';
import { refreshPocketBase, clearPocketBaseSession, loadProfileState, saveProfileState } from './utils/pocketbase';
import { useAnalytics } from './utils/useAnalytics';
import { isAccountVip } from './utils/vipHelpers';
import { SearchModal } from './components/SearchModal';
import { SettingsModal } from './components/SettingsModal';
import { TitleInfoView } from './components/TitleInfoView';
import { TopNav, type NavSection } from './components/TopNav';
import { LiveChannelsView } from './components/LiveChannelsView';
import {
  UrgentAnnouncementModal,
  type UrgentAnnouncement,
} from './components/UrgentAnnouncementModal';
import { slugify } from './utils/slugify';
import {
  DEFAULT_VAELOR_SETTINGS,
  type AnonymizedExtractResponse,
  type VaelorSettings,
} from './types/player';

const STORAGE_MYLIST = 'vaelor_mylist_v1';
const STORAGE_WATCHED = 'vaelor_watched_v1';
const STORAGE_CONTINUE = 'vaelor_continue_v1';
const STORAGE_SETTINGS = 'vaelor_settings_v1';

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getInitialSection(): NavSection {
  if (typeof window === 'undefined') return 'home';
  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/filmes') || path.startsWith('/movies')) return 'movies';
  if (path.startsWith('/series') || path.startsWith('/shows')) return 'shows';
  if (path.startsWith('/canais') || path.startsWith('/channels') || path.startsWith('/tv')) return 'channels';
  if (path.startsWith('/minha-lista') || path.startsWith('/list')) return 'mylist';
  const hash = (window.location.hash || '').replace('#/', '').toLowerCase();
  if (hash.startsWith('movies') || hash.startsWith('filmes')) return 'movies';
  if (hash.startsWith('series') || hash.startsWith('shows')) return 'shows';
  if (hash.startsWith('canais') || hash.startsWith('channels')) return 'channels';
  if (hash.startsWith('list') || hash.startsWith('minha-lista')) return 'mylist';
  return 'home';
}

export default function App() {
  const [fullCatalog, setCatalog] = useState<MediaTitle[]>(CURATED_CATALOG);
  const [activeSection, setActiveSection] = useState<NavSection>(getInitialSection);

  // Selected Title -> Info View (triggers automatic background extraction)
  const [selectedTitle, setSelectedTitle] = useState<MediaTitle | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(1);

  // Player modal state
  const [playerActive, setPlayerActive] = useState(false);
  const [playerStreamIndex, setPlayerStreamIndex] = useState(0);
  const [playerResumeAtSec, setPlayerResumeAtSec] = useState(0);

  // Progressive automatic extraction state
  const [extractState, setExtractState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: AnonymizedExtractResponse | null;
    error?: string;
  }>({ status: 'idle', data: null });
  const extractAbortRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Modals
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [vipOpen, setVipOpen] = useState(false);
  const [urgentAnnouncement, setUrgentAnnouncement] = useState<UrgentAnnouncement | null>(null);
  const [accountAction, setAccountAction] = useState<{ edit?: Profile; add?: boolean; manage?: boolean }>({});
  const [account, setAccount] = useState<Account | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const isVip = isAccountVip(account);

  useEffect(() => {
    (window as unknown as { Kairou?: Record<string, unknown> }).Kairou = {
      isVip: () => isVip,
      openVip: () => setVipOpen(true),
      currentUser: () => (account ? { ...account, is_vip: isVip, vip: isVip } : null),
    };
    (window as unknown as { __KAIROU_CURRENT_EMAIL__?: string | null }).__KAIROU_CURRENT_EMAIL__ =
      account?.email || null;
  }, [isVip, account]);

  const currentRoute = useMemo(() => {
    if (selectedTitle) {
      const isAnime = Boolean(
        selectedTitle.genres?.some((g) => /anim/i.test(g)) && (selectedTitle.originalLanguage === 'ja' || /japan/i.test(selectedTitle.country || ''))
      );
      const typePrefix = isAnime ? 'anime' : (selectedTitle.mediaType === 'series' ? 'serie' : 'filme');
      const cleanSlug = slugify(selectedTitle.title);
      return `/${typePrefix}/${selectedTitle.tmdbId || selectedTitle.id}${cleanSlug ? '-' + cleanSlug : ''}`;
    }
    if (activeSection === 'movies') return '/filmes';
    if (activeSection === 'shows') return '/series';
    if (activeSection === 'channels') return '/canais';
    if (activeSection === 'mylist') return '/minha-lista';
    return '/';
  }, [selectedTitle, activeSection]);
  useAnalytics(currentRoute);

  const updateSeo = useCallback((opts: { title?: string; path?: string; push?: boolean }) => {
    if (typeof window === 'undefined') return;
    if (opts.title) document.title = opts.title;
    if (opts.path && opts.push) {
      if (window.location.pathname !== opts.path) {
        window.history.pushState(null, '', opts.path);
      }
    }
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && opts.path) {
      canonical.setAttribute('href', `https://www.kairou.space${opts.path === '/' ? '/' : opts.path}`);
    }
  }, []);

  const navigateToSection = useCallback((sec: NavSection, push = true) => {
    setSelectedTitle(null);
    setActiveSection(sec);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    let path = '/';
    let title = 'Kairou — Assistir Filmes, Séries e Animes Online Grátis em HD e 4K';
    if (sec === 'movies') {
      path = '/filmes';
      title = profile?.kids ? 'Filmes Infantis — Kairou KIDS' : 'Filmes Online Dublados e Legendados em HD e 4K — Kairou';
    } else if (sec === 'shows') {
      path = '/series';
      title = profile?.kids ? 'Desenhos & Séries — Kairou KIDS' : 'Séries Online Completas em HD e 4K — Kairou';
    } else if (sec === 'mylist') {
      path = '/minha-lista';
      title = 'Minha Lista — Kairou';
    }
    updateSeo({ title, path, push });
  }, [profile?.kids, updateSeo]);
  const catalog = useMemo(() => fullCatalog.filter(item => allowedForProfile(item, profile?.maxRating, profile?.kids)), [fullCatalog, profile]);
  const storageKey = (key: string, a = account, p = profile) => a && p ? `${key}:${encodeURIComponent(a.email)}:${p.id}` : key;
  const [syncedProfile, setSyncedProfile] = useState<string | null>(null);
  const selectProfile = (next: Profile, current = account) => {
    setSyncedProfile(null);
    if (!current) return;
    setProfile(next);
    localStorage.setItem('kairou_session_v1', JSON.stringify({ email: current.email, profileId: next.id }));
    setMyListIds(readStorageJson(storageKey(STORAGE_MYLIST, current, next), []));
    setWatchedIds(readStorageJson(storageKey(STORAGE_WATCHED, current, next), []));
    setContinueWatching(readStorageJson(storageKey(STORAGE_CONTINUE, current, next), []));
    setSelectedTitle(null); setActiveSection('home');
  };
  const logout = () => { clearPocketBaseSession(); localStorage.removeItem('kairou_session_v1'); setAccount(null); setProfile(null); setMyListIds(readStorageJson(STORAGE_MYLIST, [])); setWatchedIds(readStorageJson(STORAGE_WATCHED, [])); setContinueWatching(readStorageJson(STORAGE_CONTINUE, [])); setSelectedTitle(null); setAccountOpen(false); };

  // Persisted user state
  const [myListIds, setMyListIds] = useState<string[]>(() => readStorageJson(storageKey(STORAGE_MYLIST), []));
  const [watchedIds, setWatchedIds] = useState<string[]>(() => readStorageJson(storageKey(STORAGE_WATCHED), []));
  const [continueWatching, setContinueWatching] = useState<WatchProgressEntry[]>(() =>
    readStorageJson(storageKey(STORAGE_CONTINUE), [])
  );
  const [settings, setSettings] = useState<VaelorSettings>(() =>
    readStorageJson(STORAGE_SETTINGS, DEFAULT_VAELOR_SETTINGS)
  );

  // User requested: "toda vez q o user entrar no site pergunte qual conta ele quer usar"
  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      let activeAccount: Account | null = null;

      try {
        const pbAccount = await refreshPocketBase();
        if (pbAccount) {
          updateStoredAccount(pbAccount);
          activeAccount = pbAccount;
        }
      } catch {
        // PocketBase offline or local mode
      }

      if (!activeAccount) {
        const storedAccounts = readAccounts();
        const session = readStorageJson<{ email?: string }>('kairou_session_v1', {});
        const found =
          (session.email ? storedAccounts.find((a) => a.email.toLowerCase() === session.email?.toLowerCase()) : null) ||
          storedAccounts[0] ||
          null;
        if (found) {
          activeAccount = found;
        }
      }

      if (cancelled) return;

      if (activeAccount) {
        setAccount(activeAccount);
      } else {
        setAccount(null);
      }

      // Always ask user which account / profile to use every time they enter the site
      setProfile(null);
      setAccountAction({});
      setAccountOpen(true);
    };

    void initAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!account?.pbId || !profile?.id) { setSyncedProfile(null); return; }
    let cancelled = false;
    setSyncedProfile(null);
    loadProfileState(profile.id).then(data => {
      if (cancelled) return;
      setMyListIds(data.saved); setWatchedIds(data.watched);
      setContinueWatching(data.progress as WatchProgressEntry[]); setSyncedProfile(profile.id);
    }).catch(() => { if (!cancelled) setSyncedProfile(null); });
    return () => { cancelled = true; };
  }, [account?.pbId, profile?.id]);

  useEffect(() => {
    if (!account?.pbId || !profile?.id || syncedProfile !== profile.id) return;
    const timer = window.setTimeout(() => {
      void saveProfileState(account.pbId!, profile.id, { saved:myListIds, watched:watchedIds, progress:continueWatching }).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [account?.pbId, profile?.id, syncedProfile, myListIds, watchedIds, continueWatching]);

  // Fetch live TMDB PT-BR catalog on mount or when profile?.kids changes
  useEffect(() => {
    let cancelled = false;
    const isKids = Boolean(profile?.kids);
    fetch(`/api/catalog${isKids ? '?kids=true' : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { items?: MediaTitle[] } | null) => {
        if (!cancelled && json?.items && json.items.length > 0) {
          setCatalog(json.items);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profile?.kids]);

  useEffect(() => {
    const isKids = Boolean(profile?.kids);
    document.body.classList.toggle('is-kids-mode', isKids);
    document.documentElement.classList.toggle('is-kids-mode', isKids);
  }, [profile?.kids]);

  // Fetch and manage urgent announcement (local-first + server sync + live updates)
  useEffect(() => {
    let cancelled = false;

    const checkAndSetAnnouncement = (ua: UrgentAnnouncement | null | undefined) => {
      if (!ua || !ua.active) {
        setUrgentAnnouncement(null);
        return false;
      }
      try {
        const dismissedId = localStorage.getItem('kairou_dismissed_urgent_id');
        if (dismissedId === ua.id) return false;
      } catch {
        // ignore
      }
      setUrgentAnnouncement(ua);
      return true;
    };

    // 1. LocalStorage checked immediately (local-first resilience)
    try {
      const localRaw = localStorage.getItem('kairou_urgent_announcement');
      if (localRaw) {
        const localUa = JSON.parse(localRaw) as UrgentAnnouncement;
        checkAndSetAnnouncement(localUa);
      }
    } catch {
      // ignore
    }

    // 2. Fetch from server endpoint
    fetch('/api/vip/urgent-announcement')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ok?: boolean; urgentAnnouncement?: UrgentAnnouncement | null } | null) => {
        if (cancelled || !data?.urgentAnnouncement) return;
        checkAndSetAnnouncement(data.urgentAnnouncement);
      })
      .catch(() => {});

    // 3. Listen to live updates (when admin saves in the panel)
    const handleUrgentUpdated = (e: Event) => {
      const detail = (e as CustomEvent<UrgentAnnouncement>).detail;
      if (detail && detail.active) {
        setUrgentAnnouncement(detail);
      } else {
        setUrgentAnnouncement(null);
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'kairou_urgent_announcement') {
        try {
          const updated = e.newValue ? (JSON.parse(e.newValue) as UrgentAnnouncement) : null;
          checkAndSetAnnouncement(updated);
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('kairou:urgent-updated', handleUrgentUpdated);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      cancelled = true;
      window.removeEventListener('kairou:urgent-updated', handleUrgentUpdated);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Cleanup SSE/Abort on unmount
  useEffect(() => {
    return () => {
      extractAbortRef.current?.abort();
      eventSourceRef.current?.close();
    };
  }, []);

  // Cmd/Ctrl + K opens Search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !target?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || '')) {
        e.preventDefault();
        setSearchOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateSettings = (next: VaelorSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const toggleMyList = (item: MediaTitle) => {
    setMyListIds((prev) => {
      const exists = prev.includes(item.id);
      const next = exists ? prev.filter((id) => id !== item.id) : [item.id, ...prev];
      try {
        localStorage.setItem(storageKey(STORAGE_MYLIST), JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleWatched = (id: string) => {
    setWatchedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      try {
        localStorage.setItem(storageKey(STORAGE_WATCHED), JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const removeContinueItem = (id: string) => {
    setContinueWatching((prev) => {
      const next = prev.filter((e) => e.item.id !== id);
      try {
        localStorage.setItem(storageKey(STORAGE_CONTINUE), JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const saveContinueProgress = useCallback(
    (item: MediaTitle, currentTime: number, duration: number, s?: number, e?: number) => {
      if (!Number.isFinite(currentTime) || currentTime < 3) return;
      setContinueWatching((prev) => {
        const filtered = prev.filter((entry) => entry.item.id !== item.id);
        const updated: WatchProgressEntry = {
          item,
          currentTime,
          duration,
          season: s,
          episode: e,
          updatedAt: Date.now(),
        };
        const next = [updated, ...filtered].slice(0, 12);
        try {
          localStorage.setItem(storageKey(STORAGE_CONTINUE), JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [account, profile]
  );

  const applyPreferenceOrder = useCallback(
    (snapshot: AnonymizedExtractResponse): AnonymizedExtractResponse => {
      const streams = [...(snapshot.streams ?? [])];
      if (!settings.preferPtBr) {
        streams.sort((a, b) => Number(a.isPtBr) - Number(b.isPtBr));
      }
      return { ...snapshot, streams };
    },
    [settings.preferPtBr]
  );

  // Progressive SSE stream preparation when selecting any title or episode
  const runAutoExtraction = useCallback(
    async (item: MediaTitle, s: number, e: number, refresh = false) => {
      extractAbortRef.current?.abort();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;

      const controller = new AbortController();
      extractAbortRef.current = controller;

      const tmdb = item.tmdbId || '';
      if (!tmdb) {
        setExtractState({
          status: 'error',
          data: null,
          error: 'Identificador indisponível para este título.',
        });
        return;
      }

      const target = item.mediaType === 'series' ? `${tmdb}/${s}/${e}` : tmdb;

      setExtractState((prev) => ({
        status: 'loading',
        data: refresh ? prev.data : null,
      }));

      try {
        const isAnimeHint =
          item.network === 'Crunchyroll' ||
          item.genres.some((g) => /anima/i.test(g));
        const res = await fetch('/api/extract/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target,
            imdbId: item.imdbId,
            title: item.title,
            originalTitle: item.originalTitle,
            isAnime: isAnimeHint,
            refresh,
          }),
          signal: controller.signal,
        });
        const startJson = (await res.json()) as {
          jobId: string | null;
          done: boolean;
          snapshot: AnonymizedExtractResponse;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(startJson.error || `Erro HTTP ${res.status}`);
        }
        if (controller.signal.aborted) return;

        if (startJson.done || !startJson.jobId) {
          setExtractState({
            status: 'ready',
            data: applyPreferenceOrder(startJson.snapshot),
          });
          return;
        }

        setExtractState({
          status: 'loading',
          data: applyPreferenceOrder(startJson.snapshot),
        });

        const es = new EventSource(`/api/extract/stream/${encodeURIComponent(startJson.jobId)}`);
        eventSourceRef.current = es;

        es.onmessage = (ev) => {
          try {
            const payload = JSON.parse(ev.data) as {
              done: boolean;
              snapshot: AnonymizedExtractResponse | null;
            };
            if (payload.snapshot) {
              setExtractState({
                status: payload.done ? 'ready' : 'loading',
                data: applyPreferenceOrder(payload.snapshot),
              });
            } else if (payload.done) {
              setExtractState((curr) => ({ ...curr, status: 'ready' }));
            }
            if (payload.done) {
              es.close();
              if (eventSourceRef.current === es) eventSourceRef.current = null;
            }
          } catch {
            // ignore parse error
          }
        };

        es.onerror = async () => {
          es.close();
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          // Fast fallback if SSE closed before streams populated
          try {
            const fallbackRes = await fetch('/api/extract', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target,
                imdbId: item.imdbId,
                title: item.title,
                originalTitle: item.originalTitle,
                isAnime: isAnimeHint,
              }),
            });
            if (fallbackRes.ok) {
              const fbJson = (await fallbackRes.json()) as AnonymizedExtractResponse;
              if (fbJson.streams?.length) {
                setExtractState({
                  status: 'ready',
                  data: applyPreferenceOrder(fbJson),
                });
                return;
              }
            }
          } catch {
            // ignore
          }
          setExtractState((curr) => ({
            ...curr,
            status: curr.data?.streams?.length ? 'ready' : 'error',
          }));
        };
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setExtractState({
          status: 'error',
          data: null,
          error: err instanceof Error ? err.message : 'Indisponível no momento.',
        });
      }
    },
    [applyPreferenceOrder]
  );

  // Open Title Info View (always routes to Info Page first and prepares playback in parallel!)
  const openTitleInfo = useCallback(
    async (rawItem: MediaTitle, resume = false, pushUrl = true) => {
      const existingProgress = continueWatching.find((c) => c.item.id === rawItem.id);
      const initSeason = existingProgress?.season ?? rawItem.defaultSeason ?? 1;
      const initEpisode = existingProgress?.episode ?? rawItem.defaultEpisode ?? 1;

      setSelectedTitle(rawItem);
      setSelectedSeason(initSeason);
      setSelectedEpisode(initEpisode);
      setPlayerActive(false);
      setPlayerResumeAtSec(resume && existingProgress ? existingProgress.currentTime : 0);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Canonical SEO Title & Path matching REA / Google Search Console
      const isAnime = Boolean(
        rawItem.genres?.some((g) => /anim/i.test(g)) && (rawItem.originalLanguage === 'ja' || /japan/i.test(rawItem.country || ''))
      );
      const typePrefix = isAnime ? 'anime' : (rawItem.mediaType === 'series' ? 'serie' : 'filme');
      const cleanSlug = slugify(rawItem.title);
      const titlePath = `/${typePrefix}/${rawItem.tmdbId || rawItem.id}${cleanSlug ? '-' + cleanSlug : ''}`;
      const year = rawItem.year || '';
      let docTitle = `Assistir ${rawItem.title} (${year}) Online Dublado e Legendado HD e 4K — Kairou`;
      if (isAnime) {
        docTitle = `Assistir ${rawItem.title} Online Dublado e Legendado HD — Kairou`;
      } else if (rawItem.mediaType === 'series') {
        docTitle = `Assistir ${rawItem.title} Todas as Temporadas Online Dublado e Legendado — Kairou`;
      }
      updateSeo({ title: docTitle, path: titlePath, push: pushUrl });

      // Start preparing streams immediately
      if (rawItem.tmdbId) {
        void runAutoExtraction(rawItem, initSeason, initEpisode, false);
      }

      // Fetch rich TMDB PT-BR details (logo PNG, cast photos, imdbId, episodes)
      setIsLoadingMeta(true);
      try {
        const lookupId = rawItem.tmdbId || rawItem.imdbId || rawItem.id;
        const metaRes = await fetch(
          `/api/title/${rawItem.mediaType}/${encodeURIComponent(lookupId)}`
        );
        if (metaRes.ok) {
          const metaJson = (await metaRes.json()) as { item?: MediaTitle };
          if (metaJson.item) {
            const enriched = metaJson.item;
            setSelectedTitle((curr) =>
              curr?.id === rawItem.id
                ? { ...enriched, rankToday: curr.rankToday ?? enriched.rankToday }
                : curr
            );
            if (!rawItem.tmdbId && enriched.tmdbId) {
              void runAutoExtraction(enriched, initSeason, initEpisode, false);
            }
          }
        }
      } catch {
        // keep current item
      } finally {
        setIsLoadingMeta(false);
      }
    },
    [continueWatching, runAutoExtraction, updateSeo]
  );

  // Resolve server-rendered title URLs when a visitor opens a shared link or presses Back/Forward.
  const initialTitleLoaded = useRef(false);
  useEffect(() => {
    const handleUrlNavigation = (isInitial = false) => {
      const pathname = window.location.pathname;
      const match = pathname.match(/^\/(filme|movie|serie|tv|anime)\/([a-zA-Z0-9_:-]+?)(?:-[^/]*)?\/?$/i);
      const hashMatch = (window.location.hash || '').match(/^#\/title\/(movie|tv):([a-zA-Z0-9_:-]+)/i);

      if (match || hashMatch) {
        const rawType = match ? match[1] : hashMatch![1];
        const rawId = match ? match[2] : hashMatch![2];
        const types = /^(filme|movie)$/i.test(rawType) ? ['movie'] : /^anime$/i.test(rawType) ? ['series', 'movie'] : ['series'];
        void (async () => {
          for (const type of types) {
            try {
              const response = await fetch(`/api/title/${type}/${rawId}`);
              if (!response.ok) continue;
              const data = (await response.json()) as { item?: MediaTitle };
              if (data.item) {
                void openTitleInfo(data.item, false, false);
                return;
              }
            } catch {
              /* Try the other media type */
            }
          }
        })();
        return;
      }

      if (!isInitial) {
        const p = pathname.toLowerCase();
        if (p.startsWith('/filmes') || p.startsWith('/movies')) {
          navigateToSection('movies', false);
        } else if (p.startsWith('/series') || p.startsWith('/shows')) {
          navigateToSection('shows', false);
        } else if (p.startsWith('/minha-lista') || p.startsWith('/list')) {
          navigateToSection('mylist', false);
        } else {
          navigateToSection('home', false);
        }
      }
    };

    if (!initialTitleLoaded.current) {
      initialTitleLoaded.current = true;
      handleUrlNavigation(true);
    }

    const onPopState = () => handleUrlNavigation(false);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openTitleInfo, navigateToSection]);

  const handleSelectSeasonEpisode = async (s: number, e: number, autoLaunch = false) => {
    setSelectedSeason(s);
    setSelectedEpisode(e);
    setPlayerResumeAtSec(0);
    if (!selectedTitle) return;

    void runAutoExtraction(selectedTitle, s, e, false);
    if (autoLaunch) {
      setPlayerStreamIndex(0);
      setPlayerActive(true);
    }

    // Fetch real PT-BR episodes for chosen season if not loaded yet
    const hasSeasonEps = (selectedTitle.episodes ?? []).some((ep) => ep.season === s);
    if (!hasSeasonEps && selectedTitle.tmdbId) {
      setIsLoadingMeta(true);
      try {
        const res = await fetch(
          `/api/title/series/${encodeURIComponent(selectedTitle.tmdbId)}/season/${s}`
        );
        if (res.ok) {
          const json = (await res.json()) as { episodes?: EpisodeItem[] };
          if (json.episodes && json.episodes.length > 0) {
            setSelectedTitle((curr) => {
              if (!curr) return curr;
              const existing = curr.episodes ?? [];
              const merged = [...existing.filter((x) => x.season !== s), ...json.episodes!];
              return { ...curr, episodes: merged };
            });
          }
        }
      } catch {
        // ignore
      } finally {
        setIsLoadingMeta(false);
      }
    }
  };

  const myListItems = catalog.filter((item) => myListIds.includes(item.id));

  return (
    <div className="min-h-screen bg-[#08090C] text-stone-100 antialiased">
      {!playerActive && (
        <TopNav
          activeSection={activeSection}
          showBack={Boolean(selectedTitle)}
          onBack={() => {
            navigateToSection(activeSection, true);
          }}
          onSelectSection={(sec) => {
            navigateToSection(sec, true);
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenAccount={() => { if (account && profile) setAccountMenuOpen(v => !v); else { setAccountAction({}); setAccountOpen(true); } }}
          profile={profile}
          isVip={isVip}
        />
      )}

      {selectedTitle ? (
        <TitleInfoView
          item={selectedTitle}
          isLoadingMeta={isLoadingMeta}
          selectedSeason={selectedSeason}
          selectedEpisode={selectedEpisode}
          extractState={extractState}
          inMyList={myListIds.includes(selectedTitle.id)}
          isWatched={watchedIds.includes(selectedTitle.id)}
          onSelectSeasonEpisode={(s, e, autoLaunch) =>
            void handleSelectSeasonEpisode(s, e, autoLaunch)
          }
          onRefreshExtract={() =>
            void runAutoExtraction(selectedTitle, selectedSeason, selectedEpisode, true)
          }
          onLaunchPlayer={(idx = 0) => {
            if (!extractState.data?.streams?.length) {
              void runAutoExtraction(selectedTitle, selectedSeason, selectedEpisode, false);
            }
            setPlayerStreamIndex(idx);
            setPlayerActive(true);
          }}
          onToggleMyList={() => toggleMyList(selectedTitle)}
          onToggleWatched={() => toggleWatched(selectedTitle.id)}
        />
      ) : activeSection === 'home' ? (
        <>
          <HeroSpotlight
            items={catalog}
            myListIds={myListIds}
            onOpenInfo={(item) => void openTitleInfo(item)}
            onToggleMyList={toggleMyList}
          />
          <HomeBrowseView
            catalog={catalog}
            continueWatching={continueWatching.filter(entry => allowedForProfile(entry.item, profile?.maxRating, profile?.kids))}
            myListIds={myListIds}
            onOpenInfo={(item, resume) => void openTitleInfo(item, resume)}
            onRemoveContinue={removeContinueItem}
            onGoToChannels={() => navigateToSection('channels', true)}
            isKids={Boolean(profile?.kids)}
          />
        </>
      ) : activeSection === 'movies' ? (
        <CatalogGridView
          title={profile?.kids ? 'Filmes Infantis' : 'Filmes'}
          items={catalog}
          mediaTypeFilter="movie"
          isKids={Boolean(profile?.kids)}
          myListIds={myListIds}
          onToggleMyList={toggleMyList}
          onOpenInfo={(item) => void openTitleInfo(item)}
        />
      ) : activeSection === 'shows' ? (
        <CatalogGridView
          title={profile?.kids ? 'Desenhos & Séries' : 'Séries'}
          items={catalog}
          mediaTypeFilter="series"
          isKids={Boolean(profile?.kids)}
          myListIds={myListIds}
          onToggleMyList={toggleMyList}
          onOpenInfo={(item) => void openTitleInfo(item)}
        />
      ) : activeSection === 'channels' ? (
        <LiveChannelsView
          onBack={() => navigateToSection('home', true)}
          isVip={isVip}
        />
      ) : (
        <CatalogGridView
          title="Minha Lista"
          items={myListItems}
          mediaTypeFilter="all"
          myListIds={myListIds}
          onToggleMyList={toggleMyList}
          emptyMessage="Sua lista ainda está vazia. Clique no botão + em qualquer título para salvá-lo aqui."
          onOpenInfo={(item) => void openTitleInfo(item)}
        />
      )}

      {playerActive && selectedTitle && (
        <CinemaPlayer
          isVip={isVip}
          onRequireVip={() => setVipOpen(true)}
          key={`${selectedTitle.id}-s${selectedSeason}-e${selectedEpisode}`}
          item={selectedTitle}
          season={selectedTitle.mediaType === 'series' ? selectedSeason : undefined}
          episode={selectedTitle.mediaType === 'series' ? selectedEpisode : undefined}
          streams={extractState.data?.streams ?? []}
          subtitles={extractState.data?.subtitles ?? []}
          isPreparing={extractState.status === 'loading'}
          initialStreamIndex={playerStreamIndex}
          resumeAtSec={playerResumeAtSec}
          defaultSubtitlesOn={settings.defaultSubtitlesOn}
          autoplayNextEpisode={settings.autoplayNextEpisode}
          subtitleStyle={settings.subtitleStyle}
          onUpdateSubtitleStyle={(nextStyle) =>
            updateSettings({ ...settings, subtitleStyle: nextStyle })
          }
          onProgress={(ct, dur) =>
            saveContinueProgress(
              selectedTitle,
              ct,
              dur,
              selectedTitle.mediaType === 'series' ? selectedSeason : undefined,
              selectedTitle.mediaType === 'series' ? selectedEpisode : undefined
            )
          }
          onPlayNextEpisode={(nextS, nextE) => {
            void handleSelectSeasonEpisode(nextS, nextE, true);
          }}
          onRefreshStreams={() =>
            void runAutoExtraction(selectedTitle, selectedSeason, selectedEpisode, true)
          }
          onBack={() => setPlayerActive(false)}
        />
      )}

      <SearchModal
        isOpen={searchOpen}
        catalog={catalog}
        maxRating={profile?.maxRating}
        kids={profile?.kids}
        onClose={() => setSearchOpen(false)}
        onSelectTitle={(item) => void openTitleInfo(item)}
      />

      {account && profile && (
        <AccountMenu
          isOpen={accountMenuOpen}
          account={account}
          profile={profile}
          isVip={isVip}
          onClose={() => setAccountMenuOpen(false)}
          onSelect={(p) => {
            selectProfile(p);
            setAccountMenuOpen(false);
          }}
          onEdit={(p) => {
            setAccountAction({ edit: p });
            setAccountMenuOpen(false);
            setAccountOpen(true);
          }}
          onManage={() => {
            setAccountAction({ manage: true });
            setAccountMenuOpen(false);
            setAccountOpen(true);
          }}
          onAdd={() => {
            setAccountAction({ add: true });
            setAccountMenuOpen(false);
            setAccountOpen(true);
          }}
          onOpenVip={() => {
            setAccountMenuOpen(false);
            setVipOpen(true);
          }}
          onLogout={() => {
            setAccountMenuOpen(false);
            logout();
          }}
        />
      )}
      {accountOpen && (
        <AccountModal
          initialEdit={accountAction.edit}
          initialAdd={accountAction.add}
          initialManage={accountAction.manage}
          account={account}
          profile={profile}
          onClose={() => {
            setAccountOpen(false);
            if (!profile && account && account.profiles.length > 0) {
              selectProfile(account.profiles[0]);
            }
          }}
          onOpenVip={() => setVipOpen(true)}
          onAccount={(next) => {
            setAccount(next);
            if (!account) {
              localStorage.setItem('kairou_session_v1', JSON.stringify({ email: next.email, profileId: '' }));
              setProfile(null);
              setMyListIds([]);
              setWatchedIds([]);
              setContinueWatching([]);
            } else if (profile) {
              setProfile(next.profiles.find((p) => p.id === profile.id) || profile);
            }
          }}
          onProfile={selectProfile}
          onLogout={logout}
        />
      )}
      {vipOpen && account && (
        <VipModal
          account={account}
          onUpdateAccount={(updated) => {
            const saved = updateStoredAccount(updated);
            setAccount(saved);
          }}
          onClose={() => setVipOpen(false)}
        />
      )}
      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        onUpdateSettings={updateSettings}
        onClearHistory={() => {
          setContinueWatching([]);
          try {
            localStorage.removeItem(storageKey(STORAGE_CONTINUE));
          } catch {
            // ignore
          }
        }}
        onClose={() => setSettingsOpen(false)}
      />

      {urgentAnnouncement && profile && !accountOpen && (
        <UrgentAnnouncementModal
          announcement={urgentAnnouncement}
          onClose={() => setUrgentAnnouncement(null)}
        />
      )}

      {/* Floating Telegram bubble replacing scroll-to-top button */}
      {!selectedTitle && !playerActive && activeSection !== 'channels' && (
        <a
          href="https://t.me/+MIU924pI1MoyYTRk"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Canal do Telegram"
          title="Canal do Telegram"
          className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full bg-white/15 hover:bg-[#229ED9] hover:border-[#229ED9] backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all duration-200 cursor-pointer shadow-xl group"
        >
          <svg
            className="w-5 h-5 fill-current group-hover:scale-110 transition-transform duration-200"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
      )}
    </div>
  );
}
