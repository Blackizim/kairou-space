import liveChannelsJson from './liveChannelsData.json';

export interface LiveChannel {
  id: string;
  slug: string;
  name: string;
  rawName?: string;
  category: 'esportes' | 'abertos' | 'filmes' | 'noticias' | 'infantil' | 'documentarios' | 'portugal' | 'variedades';
  categoryLabel: string;
  logo: string;
  streamUrl: string;
  backupStreamUrl?: string;
  quality: string;
  isLive: boolean;
}

export interface ChannelCategory {
  id: string;
  label: string;
  icon: string;
  count: number;
}

export const LIVE_CHANNELS: LiveChannel[] = liveChannelsJson as LiveChannel[];

export const CHANNEL_CATEGORIES: ChannelCategory[] = [
  { id: 'todos', label: 'Todos os Canais', icon: 'Sparkles', count: LIVE_CHANNELS.length },
  { id: 'esportes', label: 'Esportes & Futebol', icon: 'Trophy', count: LIVE_CHANNELS.filter(c => c.category === 'esportes').length },
  { id: 'abertos', label: 'Canais Abertos', icon: 'Tv', count: LIVE_CHANNELS.filter(c => c.category === 'abertos').length },
  { id: 'filmes', label: 'Filmes & Séries', icon: 'Film', count: LIVE_CHANNELS.filter(c => c.category === 'filmes').length },
  { id: 'noticias', label: 'Notícias', icon: 'Newspaper', count: LIVE_CHANNELS.filter(c => c.category === 'noticias').length },
  { id: 'infantil', label: 'Infantil & Desenhos', icon: 'Smile', count: LIVE_CHANNELS.filter(c => c.category === 'infantil').length },
  { id: 'documentarios', label: 'Documentários', icon: 'Compass', count: LIVE_CHANNELS.filter(c => c.category === 'documentarios').length },
  { id: 'portugal', label: 'Portugal', icon: 'Globe', count: LIVE_CHANNELS.filter(c => c.category === 'portugal').length },
  { id: 'variedades', label: 'Variedades & Reality', icon: 'Flame', count: LIVE_CHANNELS.filter(c => c.category === 'variedades').length },
];

export function getChannelsByCategory(category: string): LiveChannel[] {
  if (!category || category === 'todos') return LIVE_CHANNELS;
  return LIVE_CHANNELS.filter(c => c.category === category);
}

export function getChannelById(id: string): LiveChannel | undefined {
  return LIVE_CHANNELS.find(c => c.id === id || c.slug === id);
}

export function searchLiveChannels(query: string): LiveChannel[] {
  const q = query.trim().toLowerCase();
  if (!q) return LIVE_CHANNELS;
  return LIVE_CHANNELS.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.slug.toLowerCase().includes(q) ||
    c.categoryLabel.toLowerCase().includes(q) ||
    c.category.toLowerCase().includes(q)
  );
}
