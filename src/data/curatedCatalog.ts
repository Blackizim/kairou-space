export interface EpisodeItem {
  id: string;
  season: number;
  episode: number;
  title: string;
  overview: string;
  runtime?: number;
  released?: string;
  thumbnail?: string;
}

export interface CastMember {
  name: string;
  character?: string;
  avatar?: string;
}

export interface MediaTitle {
  id: string;
  imdbId: string;
  tmdbId: string;
  mediaType: 'movie' | 'series';
  title: string;
  originalTitle: string;
  year: string;
  runtime: string;
  runtimeMinutes: number;
  rating: string;
  ageRating: string;
  qualityBadge: '4K UHD' | '1080p FHD' | 'Ultra FHD';
  audioBadge: string;
  genres: string[];
  network: string;
  director: string;
  cast: string[];
  castProfiles?: CastMember[];
  overview: string;
  poster: string;
  backdrop: string;
  logo?: string;
  rankToday?: number;
  defaultSeason?: number;
  defaultEpisode?: number;
  seasonsCount?: number;
  episodes?: EpisodeItem[];
  originalLanguage?: string;
  country?: string;
  isAnime?: boolean;
}

export interface StudioNetwork {
  id: string;
  name: string;
  accentBg: string;
  accentText: string;
}

export const STUDIO_NETWORKS: StudioNetwork[] = [
  { id: 'Netflix', name: 'Netflix', accentBg: '#180B0C', accentText: '#E50914' },
  { id: 'Prime Video', name: 'Prime Video', accentBg: '#091826', accentText: '#00A8E1' },
  { id: 'Disney+', name: 'Disney+', accentBg: '#09162D', accentText: '#64B5F6' },
  { id: 'Apple TV+', name: 'Apple TV+', accentBg: '#141519', accentText: '#F5F5F7' },
  { id: 'HBO Max', name: 'Max', accentBg: '#100E24', accentText: '#9D8CFF' },
  { id: 'Paramount+', name: 'Paramount+', accentBg: '#0B1D3B', accentText: '#4EA1FF' },
  { id: 'Crunchyroll', name: 'Crunchyroll', accentBg: '#241206', accentText: '#FF7A18' },
  { id: 'Starz', name: 'Starz', accentBg: '#0D1318', accentText: '#38BDF8' },
];

export const CURATED_CATALOG: MediaTitle[] = [
  {
    id: 'dune-part-two',
    imdbId: 'tt15239678',
    tmdbId: '693134',
    mediaType: 'movie',
    title: 'Duna: Parte Dois',
    originalTitle: 'Dune: Part Two',
    year: '2024',
    runtime: '2h 46m',
    runtimeMinutes: 166,
    rating: '8.5',
    ageRating: '14',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ficção Científica', 'Aventura', 'Ação'],
    network: 'HBO Max',
    director: 'Denis Villeneuve',
    cast: ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson', 'Javier Bardem', 'Josh Brolin'],
    overview:
      'Paul Atreides se une a Chani e aos Fremen em uma jornada de vingança contra os conspiradores que destruíram sua família, enfrentando uma escolha entre o amor de sua vida e o destino do universo conhecido.',
    poster: 'https://images.metahub.space/poster/medium/tt15239678/img',
    backdrop: 'https://images.metahub.space/background/medium/tt15239678/img',
    logo: 'https://images.metahub.space/logo/medium/tt15239678/img',
    rankToday: 1,
  },
  {
    id: 'interstellar',
    imdbId: 'tt0816692',
    tmdbId: '157336',
    mediaType: 'movie',
    title: 'Interestelar',
    originalTitle: 'Interstellar',
    year: '2014',
    runtime: '2h 49m',
    runtimeMinutes: 169,
    rating: '8.7',
    ageRating: '12',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ficção Científica', 'Drama', 'Aventura'],
    network: 'Paramount+',
    director: 'Christopher Nolan',
    cast: ['Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Michael Caine'],
    overview:
      'Quando reservas naturais da Terra chegam ao fim, um grupo de exploradores recebe a missão mais importante da história humana: viajar além da galáxia para descobrir um novo lar.',
    poster: 'https://images.metahub.space/poster/medium/tt0816692/img',
    backdrop: 'https://images.metahub.space/background/medium/tt0816692/img',
    logo: 'https://images.metahub.space/logo/medium/tt0816692/img',
    rankToday: 2,
  },
  {
    id: 'stranger-things',
    imdbId: 'tt4574334',
    tmdbId: '66732',
    mediaType: 'series',
    title: 'Stranger Things',
    originalTitle: 'Stranger Things',
    year: '2016',
    runtime: '52m / ep',
    runtimeMinutes: 52,
    rating: '8.7',
    ageRating: '14',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ficção Científica', 'Suspense', 'Mistério'],
    network: 'Netflix',
    director: 'Irmãos Duffer',
    cast: ['Millie Bobby Brown', 'Finn Wolfhard', 'Winona Ryder', 'David Harbour'],
    overview:
      'Quando um garoto desaparece na pequena cidade de Hawkins, segredos governamentais, forças sobrenaturais e uma garota com poderes telecinéticos vêm à tona.',
    poster: 'https://images.metahub.space/poster/medium/tt4574334/img',
    backdrop: 'https://images.metahub.space/background/medium/tt4574334/img',
    logo: 'https://images.metahub.space/logo/medium/tt4574334/img',
    rankToday: 3,
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 5,
    episodes: [
      {
        id: 'st-1-1',
        season: 1,
        episode: 1,
        title: 'Capítulo Um: O Desaparecimento de Will Byers',
        overview: 'Na volta para casa, Will encontra algo aterrorizante perto de um laboratório secreto.',
      },
      {
        id: 'st-1-2',
        season: 1,
        episode: 2,
        title: 'Capítulo Dois: A Estranha da Maple Street',
        overview: 'Lucas, Mike e Dustin tentam conversar com a garota que encontraram na floresta.',
      },
      {
        id: 'st-1-3',
        season: 1,
        episode: 3,
        title: 'Capítulo Três: Caramba',
        overview: 'Preocupada, Nancy procura Barb e descobre o que Jonathan está fazendo.',
      },
    ],
  },
  {
    id: 'inception',
    imdbId: 'tt1375666',
    tmdbId: '27205',
    mediaType: 'movie',
    title: 'A Origem',
    originalTitle: 'Inception',
    year: '2010',
    runtime: '2h 28m',
    runtimeMinutes: 148,
    rating: '8.8',
    ageRating: '14',
    qualityBadge: 'Ultra FHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ação', 'Ficção Científica', 'Suspense'],
    network: 'HBO Max',
    director: 'Christopher Nolan',
    cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt', 'Elliot Page', 'Tom Hardy'],
    overview:
      'Dom Cobb é um ladrão experiente na arte de extrair segredos do subconsciente durante o estado de sono, mas sua última chance de redenção exige o impossível: plantar uma ideia.',
    poster: 'https://images.metahub.space/poster/medium/tt1375666/img',
    backdrop: 'https://images.metahub.space/background/medium/tt1375666/img',
    logo: 'https://images.metahub.space/logo/medium/tt1375666/img',
    rankToday: 4,
  },
  {
    id: 'avengers-infinity-war',
    imdbId: 'tt4154756',
    tmdbId: '299536',
    mediaType: 'movie',
    title: 'Vingadores: Guerra Infinita',
    originalTitle: 'Avengers: Infinity War',
    year: '2018',
    runtime: '2h 29m',
    runtimeMinutes: 149,
    rating: '8.4',
    ageRating: '12',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ação', 'Aventura', 'Ficção Científica'],
    network: 'Disney+',
    director: 'Anthony e Joe Russo',
    cast: ['Robert Downey Jr.', 'Chris Hemsworth', 'Mark Ruffalo', 'Chris Evans', 'Scarlett Johansson'],
    overview:
      'Homem de Ferro, Thor, Hulk e os Vingadores se unem para combater Thanos, o tirano intergaláctico decidido a coletar todas as seis Joias do Infinito.',
    poster: 'https://images.metahub.space/poster/medium/tt4154756/img',
    backdrop: 'https://images.metahub.space/background/medium/tt4154756/img',
    logo: 'https://images.metahub.space/logo/medium/tt4154756/img',
    rankToday: 5,
  },
  {
    id: 'fight-club',
    imdbId: 'tt0137523',
    tmdbId: '550',
    mediaType: 'movie',
    title: 'Clube da Luta',
    originalTitle: 'Fight Club',
    year: '1999',
    runtime: '2h 19m',
    runtimeMinutes: 139,
    rating: '8.8',
    ageRating: '18',
    qualityBadge: 'Ultra FHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Drama', 'Suspense'],
    network: 'Prime Video',
    director: 'David Fincher',
    cast: ['Brad Pitt', 'Edward Norton', 'Helena Bonham Carter', 'Jared Leto'],
    overview:
      'Um trabalhador de escritório com insônia conhece um fabricante de sabonetes carismático e juntos fundam um clube de lutas clandestino que foge completamente de controle.',
    poster: 'https://images.metahub.space/poster/medium/tt0137523/img',
    backdrop: 'https://images.metahub.space/background/medium/tt0137523/img',
    logo: 'https://images.metahub.space/logo/medium/tt0137523/img',
    rankToday: 6,
  },
  {
    id: 'breaking-bad',
    imdbId: 'tt0903747',
    tmdbId: '1396',
    mediaType: 'series',
    title: 'Breaking Bad',
    originalTitle: 'Breaking Bad',
    year: '2008',
    runtime: '49m / ep',
    runtimeMinutes: 49,
    rating: '9.5',
    ageRating: '16',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Drama', 'Crime', 'Suspense'],
    network: 'Netflix',
    director: 'Vince Gilligan',
    cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn', 'Dean Norris'],
    overview:
      'Um professor de química do ensino médio diagnosticado com câncer terminal passa a fabricar metanfetamina ao lado de um ex-aluno para garantir o futuro da família.',
    poster: 'https://images.metahub.space/poster/medium/tt0903747/img',
    backdrop: 'https://images.metahub.space/background/medium/tt0903747/img',
    logo: 'https://images.metahub.space/logo/medium/tt0903747/img',
    rankToday: 7,
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 5,
    episodes: [
      {
        id: 'bb-1-1',
        season: 1,
        episode: 1,
        title: 'Piloto',
        overview: 'Após o diagnóstico, Walter White decide usar seus conhecimentos em química no submundo.',
      },
      {
        id: 'bb-1-2',
        season: 1,
        episode: 2,
        title: 'O Gato no Saco',
        overview: 'Walter e Jesse enfrentam as consequências imediatas do primeiro negócio.',
      },
    ],
  },
  {
    id: 'deadpool-wolverine',
    imdbId: 'tt6263850',
    tmdbId: '533535',
    mediaType: 'movie',
    title: 'Deadpool & Wolverine',
    originalTitle: 'Deadpool & Wolverine',
    year: '2024',
    runtime: '2h 08m',
    runtimeMinutes: 128,
    rating: '7.6',
    ageRating: '18',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ação', 'Comédia', 'Ficção Científica'],
    network: 'Disney+',
    director: 'Shawn Levy',
    cast: ['Ryan Reynolds', 'Hugh Jackman', 'Emma Corrin', 'Matthew Macfadyen'],
    overview:
      'A Autoridade de Variância Temporal recruta Wade Wilson para uma missão que pode mudar o multiverso — e ele arrasta um Wolverine relutante para a jornada.',
    poster: 'https://images.metahub.space/poster/medium/tt6263850/img',
    backdrop: 'https://images.metahub.space/background/medium/tt6263850/img',
    logo: 'https://images.metahub.space/logo/medium/tt6263850/img',
    rankToday: 8,
  },
  {
    id: 'chicago-med',
    imdbId: 'tt4655480',
    tmdbId: '62650',
    mediaType: 'series',
    title: 'Chicago Med: Atendimento de Emergência',
    originalTitle: 'Chicago Med',
    year: '2015',
    runtime: '42m / ep',
    runtimeMinutes: 42,
    rating: '7.6',
    ageRating: '14',
    qualityBadge: '1080p FHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Drama', 'Suspense'],
    network: 'Prime Video',
    director: 'Dick Wolf',
    cast: ['S. Epatha Merkerson', 'Oliver Platt', 'Marlyne Barrett', 'Steven Weber'],
    overview:
      'A rotina intensa dos médicos e enfermeiros do pronto-socorro mais movimentado de Chicago, enfrentando casos críticos e dilemas éticos a cada plantão.',
    poster: 'https://images.metahub.space/poster/medium/tt4655480/img',
    backdrop: 'https://images.metahub.space/background/medium/tt4655480/img',
    logo: 'https://images.metahub.space/logo/medium/tt4655480/img',
    rankToday: 9,
    defaultSeason: 12,
    defaultEpisode: 2,
    seasonsCount: 12,
    episodes: [
      {
        id: 'cm-12-1',
        season: 12,
        episode: 1,
        title: 'Episódio 1',
        overview: 'Tiros em um casamento geram emergência no pronto-socorro e decisões difíceis para Goodwin.',
      },
      {
        id: 'cm-12-2',
        season: 12,
        episode: 2,
        title: 'Episódio 2',
        overview: 'A equipe enfrenta casos simultâneos sob pressão máxima no centro de trauma.',
      },
      {
        id: 'cm-12-3',
        season: 12,
        episode: 3,
        title: 'Episódio 3',
        overview: 'Frost e Charles atuam juntos para salvar um jovem vítima de queimaduras.',
      },
    ],
  },
  {
    id: 'avatar-way-of-water',
    imdbId: 'tt1630029',
    tmdbId: '76600',
    mediaType: 'movie',
    title: 'Avatar: O Caminho da Água',
    originalTitle: 'Avatar: The Way of Water',
    year: '2022',
    runtime: '3h 12m',
    runtimeMinutes: 192,
    rating: '7.6',
    ageRating: '12',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Ficção Científica', 'Aventura', 'Ação'],
    network: 'Disney+',
    director: 'James Cameron',
    cast: ['Sam Worthington', 'Zoe Saldaña', 'Sigourney Weaver', 'Stephen Lang'],
    overview:
      'Jake Sully e Neytiri precisam deixar seu lar e explorar as regiões oceânicas de Pandora quando uma antiga ameaça retorna para acabar o que começou.',
    poster: 'https://images.metahub.space/poster/medium/tt1630029/img',
    backdrop: 'https://images.metahub.space/background/medium/tt1630029/img',
    logo: 'https://images.metahub.space/logo/medium/tt1630029/img',
    rankToday: 10,
  },
  {
    id: 'home-alone-2',
    imdbId: 'tt0104431',
    tmdbId: '772',
    mediaType: 'movie',
    title: 'Esqueceram de Mim 2: Perdido em Nova York',
    originalTitle: 'Home Alone 2: Lost in New York',
    year: '1992',
    runtime: '2h 00m',
    runtimeMinutes: 120,
    rating: '6.9',
    ageRating: 'L',
    qualityBadge: 'Ultra FHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Comédia', 'Aventura', 'Família'],
    network: 'Disney+',
    director: 'Chris Columbus',
    cast: ['Macaulay Culkin', 'Joe Pesci', 'Daniel Stern', 'Catherine O’Hara'],
    overview:
      'Kevin embarca acidentalmente no avião errado durante o Natal e vai parar em Nova York, onde precisa enfrentar novamente os Bandidos Molhados.',
    poster: 'https://images.metahub.space/poster/medium/tt0104431/img',
    backdrop: 'https://images.metahub.space/background/medium/tt0104431/img',
    logo: 'https://images.metahub.space/logo/medium/tt0104431/img',
  },
  {
    id: 'severance',
    imdbId: 'tt11280740',
    tmdbId: '95396',
    mediaType: 'series',
    title: 'Ruptura',
    originalTitle: 'Severance',
    year: '2022',
    runtime: '50m / ep',
    runtimeMinutes: 50,
    rating: '8.7',
    ageRating: '16',
    qualityBadge: '4K UHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Suspense', 'Ficção Científica', 'Drama'],
    network: 'Apple TV+',
    director: 'Ben Stiller',
    cast: ['Adam Scott', 'Britt Lower', 'Zach Cherry', 'John Turturro'],
    overview:
      'Funcionários da Lumon Industries passam por um procedimento cirúrgico que separa completamente suas memórias do trabalho das memórias pessoais.',
    poster: 'https://images.metahub.space/poster/medium/tt11280740/img',
    backdrop: 'https://images.metahub.space/background/medium/tt11280740/img',
    logo: 'https://images.metahub.space/logo/medium/tt11280740/img',
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 2,
    episodes: [
      {
        id: 'sev-1-1',
        season: 1,
        episode: 1,
        title: 'Boas Novas Sobre o Inferno',
        overview: 'Mark é promovido após a saída súbita de um colega e orienta a nova integrante Helly.',
      },
      {
        id: 'sev-1-2',
        season: 1,
        episode: 2,
        title: 'Meia Volta',
        overview: 'A equipe dá as boas-vindas a Helly enquanto questionamentos sobre a empresa crescem.',
      },
    ],
  },
  {
    id: 'attack-on-titan',
    imdbId: 'tt2560140',
    tmdbId: '1429',
    mediaType: 'series',
    title: 'Attack on Titan',
    originalTitle: 'Shingeki no Kyojin',
    year: '2013',
    runtime: '24m / ep',
    runtimeMinutes: 24,
    rating: '9.1',
    ageRating: '16',
    qualityBadge: '1080p FHD',
    audioBadge: 'PT-BR · Dual Áudio',
    genres: ['Animação', 'Ação', 'Fantasia'],
    network: 'Crunchyroll',
    director: 'Tetsurō Araki',
    cast: ['Yuki Kaji', 'Yui Ishikawa', 'Marina Inoue'],
    overview:
      'Após a queda de sua cidade natal diante de titãs colossais, o jovem Eren Yeager jura erradicar os monstros e desvendar os segredos além das muralhas.',
    poster: 'https://images.metahub.space/poster/medium/tt2560140/img',
    backdrop: 'https://images.metahub.space/background/medium/tt2560140/img',
    logo: 'https://images.metahub.space/logo/medium/tt2560140/img',
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 4,
    episodes: [
      {
        id: 'aot-1-1',
        season: 1,
        episode: 1,
        title: 'Para Você, Daqui a 2000 Anos',
        overview: 'A paz centenária dentro das muralhas é quebrada pelo surgimento do Titã Colossal.',
      },
    ],
  },
];
