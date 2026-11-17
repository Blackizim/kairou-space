// Kairou Server-Side SEO & Prerendering Engine
// Injeta dinamicamente títulos de alto CTR, meta tags, OpenGraph,
// Schema.org JSON-LD (Movie/TVSeries) e HTML semântico com crawlability máxima para o Googlebot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TMDB_READ_TOKEN = () => process.env.TMDB_READ_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4MjljMjk3OTUwZTYxZTBjNzE3OGI1ZmQ5YzllNmZhMCIsIm5iZiI6MTc1MTgyNDMyMC40NTcsInN1YiI6IjY4NmFiN2MwZDQ4OWE5YzMyYTUzZmFjNCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.IBBf0y2Nv9mzgXSpswQC2MsezfsDKAkhtKTC3211BpY';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Cache em RAM para performance máxima (< 1ms resposta para páginas já consultadas)
const memoryCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

let cachedIndexHtml = null;
let lastIndexHtmlCheck = 0;

function getIndexTemplate() {
  const now = Date.now();
  if (!cachedIndexHtml || now - lastIndexHtmlCheck > 60000) {
    lastIndexHtmlCheck = now;
    const candidates = [
      path.join(ROOT_DIR, 'dist', 'index.html'),
      path.join(ROOT_DIR, 'index.html'),
      path.join(process.cwd(), 'web', 'index.html'),
      path.join(process.cwd(), 'dist', 'index.html'),
      path.join(process.cwd(), 'index.html')
    ];
    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand)) {
          cachedIndexHtml = fs.readFileSync(cand, 'utf-8');
          break;
        }
      } catch (e) {
        // ignore and try next
      }
    }
  }
  return cachedIndexHtml;
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchTmdb(endpoint) {
  const cacheKey = `tmdb:${endpoint}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN()}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    memoryCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.warn(`[SEO TMDB Error]: ${endpoint}`, err.message);
    return null;
  }
}

/**
 * Renderiza página com SEO Completo para Filmes, Séries e Animes
 */
export async function renderSeoPage(req, res, { type, id, slug }) {
  const rawType = (type || '').toLowerCase();
  const isSeries = rawType === 'serie' || rawType === 'tv' || rawType === 'series';
  const isAnime = rawType === 'anime';
  const typePrefix = isAnime ? 'anime' : (isSeries ? 'serie' : 'filme');

  let details = null;
  let tmdbType = 'movie';

  // Animes no TMDB podem ser tanto filmes (ex: Haikyu, Pokémon) quanto séries (ex: Tokyo Revengers)
  if (isAnime) {
    const [tvData, movieData] = await Promise.all([
      fetchTmdb(`/tv/${id}?language=pt-BR&append_to_response=credits,keywords`),
      fetchTmdb(`/movie/${id}?language=pt-BR&append_to_response=credits,keywords`)
    ]);

    const isTvAnime = tvData?.genres?.some((g) => g.id === 16 || g.name === 'Animação');
    const isMovieAnime = movieData?.genres?.some((g) => g.id === 16 || g.name === 'Animação');

    if (isTvAnime && !isMovieAnime) {
      details = tvData;
      tmdbType = 'tv';
    } else if (isMovieAnime && !isTvAnime) {
      details = movieData;
      tmdbType = 'movie';
    } else if (isTvAnime && isMovieAnime) {
      const movieSlug = slugify(movieData.title || '');
      const cleanSlug = slug || '';
      if (cleanSlug && (movieSlug.includes(cleanSlug) || cleanSlug.includes(movieSlug))) {
        details = movieData;
        tmdbType = 'movie';
      } else {
        details = tvData;
        tmdbType = 'tv';
      }
    } else {
      details = tvData || movieData;
      tmdbType = tvData ? 'tv' : 'movie';
    }
  } else if (isSeries) {
    details = await fetchTmdb(`/tv/${id}?language=pt-BR&append_to_response=credits,keywords`);
    if (details && (details.name || details.first_air_date)) {
      tmdbType = 'tv';
    } else {
      details = await fetchTmdb(`/movie/${id}?language=pt-BR&append_to_response=credits,keywords`);
      if (details) tmdbType = 'movie';
    }
  } else {
    details = await fetchTmdb(`/movie/${id}?language=pt-BR&append_to_response=credits,keywords`);
    if (details && (details.title || details.release_date)) {
      tmdbType = 'movie';
    } else {
      details = await fetchTmdb(`/tv/${id}?language=pt-BR&append_to_response=credits,keywords`);
      if (details) tmdbType = 'tv';
    }
  }

  const template = getIndexTemplate();
  const title = details ? (details.title || details.name || 'Título sem nome') : '';
  const cleanSlug = slug || (title ? slugify(title) : '');
  const canonicalUrl = `https://www.kairou.space/${typePrefix}/${id}${cleanSlug ? '-' + cleanSlug : ''}`;

  if (!details || !template) {
    const fallbackTitle = cleanSlug ? cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Assistir Online';
    let fallbackHtml = template || '<!doctype html><html><head></head><body></body></html>';
    fallbackHtml = fallbackHtml.replace(/<title>.*?<\/title>/is, `<title>Assistir ${fallbackTitle} Online HD e 4K — Kairou</title>`);
    fallbackHtml = fallbackHtml.replace(/<link rel="canonical"[^>]*>/is, `<link rel="canonical" href="${canonicalUrl}" />`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    return res.end(fallbackHtml);
  }

  const originalTitle = details.original_title || details.original_name || title;
  const year = (details.release_date || details.first_air_date || '').slice(0, 4) || '2026';

  const rating = Number(details.vote_average || 0).toFixed(1);
  const voteCount = details.vote_count || 100;
  const overview = (details.overview || 'Sinopse completa disponível para assistir online em alta definição no Kairou.').trim();
  const shortOverview = overview.slice(0, 160).replace(/"/g, "'");

  const backdropUrl = details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : 'https://www.kairou.space/assets/og-image.png';
  const posterUrl = details.poster_path ? `https://image.tmdb.org/t/p/w780${details.poster_path}` : 'https://www.kairou.space/assets/mark.svg';

  const genres = (details.genres || []).map((g) => g.name);
  const genresStr = genres.join(', ') || (isAnime ? 'Anime, Animação' : isSeries ? 'Série' : 'Filme');

  // Créditos: Diretor e Elenco
  const crew = details.credits?.crew || [];
  const cast = (details.credits?.cast || []).slice(0, 8);
  const director = crew.find((c) => c.job === 'Director')?.name || 'Diretor';
  const actorsNames = cast.map((c) => c.name).join(', ');

  // Título e Descrição de Alto CTR otimizados para o Google Brasil
  let metaTitle = '';
  let metaDescription = '';

  if (isAnime) {
    metaTitle = `Assistir ${title} Online Dublado e Legendado HD — Kairou`;
    metaDescription = `Assista ao anime ${title} (${year}) completo dublado e legendado online em Full HD grátis. ${shortOverview} Acesse no Kairou!`;
  } else if (isSeries) {
    metaTitle = `Assistir ${title} Todas as Temporadas Online Dublado e Legendado — Kairou`;
    metaDescription = `Assista à série ${title} (${year}) online dublada e legendada em Full HD grátis. Todas as temporadas e episódios completos no Kairou.`;
  } else {
    metaTitle = `Assistir ${title} (${year}) Online Dublado e Legendado HD e 4K — Kairou`;
    metaDescription = `Assista a ${title} (${year}) completo online dublado e legendado em 1080p e 4K grátis. ${shortOverview} Disponível no Kairou Streaming.`;
  }

  const keywords = [
    `assistir ${title.toLowerCase()} online`,
    `${title.toLowerCase()} dublado`,
    `${title.toLowerCase()} legendado`,
    `${title.toLowerCase()} ${year} online gratis`,
    `${title.toLowerCase()} completo`,
    `assistir ${originalTitle.toLowerCase()} online`,
    isAnime ? 'assistir animes online' : isSeries ? 'assistir series online' : 'assistir filmes online',
    'kairou streaming',
    'filmes em 4k gratis',
  ].join(', ');

  // Schema.org JSON-LD para Rich Snippets com Estrelas de Avaliação no Google
  const schemaType = isSeries || isAnime ? 'TVSeries' : 'Movie';
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    alternateName: originalTitle,
    url: canonicalUrl,
    image: posterUrl,
    description: overview,
    datePublished: details.release_date || details.first_air_date || `${year}-01-01`,
    genre: genres,
    inLanguage: 'pt-BR',
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: rating > 0 ? rating : '8.5',
      bestRating: '10',
      ratingCount: voteCount > 0 ? String(voteCount) : '150',
    },
    ...(director !== 'Diretor' && {
      director: {
        '@type': 'Person',
        name: director,
      },
    }),
    actor: cast.map((actor) => ({
      '@type': 'Person',
      name: actor.name,
    })),
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'BRL',
      availability: 'https://schema.org/InStock',
      category: 'Free',
    },
  };

  // Conteúdo Semântico Server-Side Pré-renderizado
  const semanticHtml = `
    <main id="kairou-seo-container" style="max-width: 1200px; margin: 0 auto; padding: 40px 20px; font-family: system-ui, -apple-system, sans-serif; color: #f8fafc;">
      <nav aria-label="Breadcrumb" style="font-size: 13px; color: #94a3b8; margin-bottom: 20px;">
        <a href="/" style="color: #38bdf8; text-decoration: none;">Início</a> &gt; 
        <a href="/${typePrefix}s" style="color: #38bdf8; text-decoration: none;">${isAnime ? 'Animes' : isSeries ? 'Séries' : 'Filmes'}</a> &gt; 
        <span>${title}</span>
      </nav>

      <article itemscope itemtype="https://schema.org/${schemaType}">
        <header style="display: flex; gap: 30px; flex-wrap: wrap; margin-bottom: 30px;">
          <div style="width: 240px; aspect-ratio: 2/3; border-radius: 16px; overflow: hidden; background: #0f141e; flex-shrink: 0; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <img src="${posterUrl}" alt="Pôster de ${title}" style="width: 100%; height: 100%; object-fit: cover;" itemprop="image" />
          </div>
          <div style="flex: 1; min-width: 300px;">
            <h1 itemprop="name" style="font-size: 32px; font-weight: 800; color: #ffffff; margin: 0 0 8px 0; line-height: 1.2;">
              Assistir ${title} (${year}) Online Grátis em HD e 4K
            </h1>
            <h2 style="font-size: 16px; font-weight: 500; color: #38bdf8; margin: 0 0 16px 0;">
              ${originalTitle !== title ? originalTitle + ' • ' : ''}${genresStr}
            </h2>

            <div style="display: flex; gap: 15px; align-items: center; margin-bottom: 20px; font-size: 14px; color: #cbd5e1;">
              <span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 4px 10px; border-radius: 8px; font-weight: 700;">
                ⭐ ${rating} / 10
              </span>
              <span>Ano: ${year}</span>
              <span>Qualidade: 1080p Full HD &amp; 4K</span>
              <span>Áudio: Dublado e Legendado PT-BR</span>
            </div>

            <div style="margin-bottom: 24px;">
              <a href="#/title/${tmdbType}:${id}" style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; background: #38bdf8; color: #020617; font-weight: 800; border-radius: 12px; text-decoration: none; font-size: 15px; box-shadow: 0 4px 14px rgba(56, 189, 248, 0.4);">
                ▶ Assistir ${title} Agora
              </a>
            </div>

            <h3 style="font-size: 18px; font-weight: 700; color: #f1f5f9; margin: 0 0 8px 0;">Sinopse</h3>
            <p itemprop="description" style="font-size: 14px; line-height: 1.7; color: #94a3b8; margin: 0 0 20px 0;">
              ${overview}
            </p>

            ${actorsNames ? `
              <h3 style="font-size: 16px; font-weight: 700; color: #f1f5f9; margin: 0 0 6px 0;">Elenco Principal</h3>
              <p style="font-size: 13px; color: #94a3b8; margin: 0 0 20px 0;">${actorsNames}</p>
            ` : ''}
          </div>
        </header>
      </article>
    </main>
  `;

  // Injeção de Meta Tags no Template HTML
  let output = template;

  // Substitui ou injeta Title
  if (/<title>.*?<\/title>/is.test(output)) {
    output = output.replace(/<title>.*?<\/title>/is, `<title>${metaTitle}</title>`);
  }

  // Canonical: substitui se existir, ou injeta
  if (/<link rel="canonical"[^>]*>/is.test(output)) {
    output = output.replace(/<link rel="canonical"[^>]*>/is, `<link rel="canonical" href="${canonicalUrl}" />`);
  } else {
    output = output.replace('</head>', `  <link rel="canonical" href="${canonicalUrl}" />\n</head>`);
  }

  // Meta Title
  if (/<meta name="title"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="title"[^>]*>/is, `<meta name="title" content="${metaTitle}" />`);
  } else {
    output = output.replace('</head>', `  <meta name="title" content="${metaTitle}" />\n</head>`);
  }

  // Meta Description
  if (/<meta name="description"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="description"[^>]*>/is, `<meta name="description" content="${metaDescription}" />`);
  } else {
    output = output.replace('</head>', `  <meta name="description" content="${metaDescription}" />\n</head>`);
  }

  // Keywords
  if (/<meta name="keywords"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="keywords"[^>]*>/is, `<meta name="keywords" content="${keywords}" />`);
  } else {
    output = output.replace('</head>', `  <meta name="keywords" content="${keywords}" />\n</head>`);
  }

  // OpenGraph
  if (/<meta property="og:title"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:title"[^>]*>/is, `<meta property="og:title" content="${metaTitle}" />`);
  } else {
    output = output.replace('</head>', `  <meta property="og:title" content="${metaTitle}" />\n</head>`);
  }

  if (/<meta property="og:description"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:description"[^>]*>/is, `<meta property="og:description" content="${metaDescription}" />`);
  } else {
    output = output.replace('</head>', `  <meta property="og:description" content="${metaDescription}" />\n</head>`);
  }

  if (/<meta property="og:url"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:url"[^>]*>/is, `<meta property="og:url" content="${canonicalUrl}" />`);
  } else {
    output = output.replace('</head>', `  <meta property="og:url" content="${canonicalUrl}" />\n</head>`);
  }

  if (/<meta property="og:image"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:image"[^>]*>/is, `<meta property="og:image" content="${backdropUrl}" />`);
  } else {
    output = output.replace('</head>', `  <meta property="og:image" content="${backdropUrl}" />\n</head>`);
  }

  // Twitter Card
  if (/<meta name="twitter:title"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="twitter:title"[^>]*>/is, `<meta name="twitter:title" content="${metaTitle}" />`);
  }
  if (/<meta name="twitter:description"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="twitter:description"[^>]*>/is, `<meta name="twitter:description" content="${metaDescription}" />`);
  }
  if (/<meta name="twitter:image"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="twitter:image"[^>]*>/is, `<meta name="twitter:image" content="${backdropUrl}" />`);
  }

  // Injeta JSON-LD Rich Snippet antes de </head>
  const jsonLdScript = `\n  <!-- TMDB Rich Snippet Schema.org -->\n  <script type="application/ld+json">\n  ${JSON.stringify(structuredData, null, 2)}\n  </script>\n</head>`;
  output = output.replace('</head>', jsonLdScript);

  // Injeta Conteúdo Semântico Pré-renderizado
  if (output.includes('<main id="main">')) {
    output = output.replace('<main id="main">', `<main id="main">${semanticHtml}`);
  } else if (output.includes('<div id="root">')) {
    output = output.replace('<div id="root">', `<div id="root">${semanticHtml}`);
  } else if (output.includes('<body>')) {
    output = output.replace('<body>', `<body>${semanticHtml}`);
  } else if (/<body[^>]*>/is.test(output)) {
    output = output.replace(/(<body[^>]*>)/is, `$1${semanticHtml}`);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.end(output);
}

/**
 * Renderiza página com SEO específico para seções principais (Filmes, Séries, Animes, Canais, Minha Lista)
 */
export function renderSectionSeo(req, res, section) {
  const template = getIndexTemplate();
  if (!template) {
    res.statusCode = 200;
    return res.end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  }

  const s = String(section || '').toLowerCase();
  let title = 'Kairou — Assistir Filmes, Séries e Animes Online Grátis em HD e 4K';
  let description = 'Assista a filmes, séries completas e animes online gratuitamente em alta definição (HD e 4K). Catálogo atualizado diariamente com lançamentos dublados e legendados no Kairou.';
  let canonicalUrl = `https://www.kairou.space/${s}`;

  if (s === 'filmes' || s === 'movies') {
    title = 'Filmes Online Dublados e Legendados em HD e 4K — Kairou';
    description = 'Explore o catálogo completo de filmes online dublados e legendados em 1080p e 4K no Kairou Streaming. Lançamentos, clássicos e sucessos de bilheteria.';
    canonicalUrl = 'https://www.kairou.space/filmes';
  } else if (s === 'series' || s === 'shows') {
    title = 'Séries Online Completas em HD e 4K — Kairou';
    description = 'Assista a séries completas online dubladas e legendadas em alta definição no Kairou. Todas as temporadas, episódios atualizados e lançamentos.';
    canonicalUrl = 'https://www.kairou.space/series';
  } else if (s === 'animes') {
    title = 'Animes Online Dublados e Legendados em HD — Kairou';
    description = 'Assista a animes dublados e legendados em alta qualidade no Kairou. Lançamentos da temporada, clássicos e episódios diários.';
    canonicalUrl = 'https://www.kairou.space/animes';
  } else if (s === 'canais') {
    title = 'Canais ao Vivo em HD — Kairou';
    description = 'Assista a canais de TV ao vivo online em Full HD no Kairou Streaming.';
    canonicalUrl = 'https://www.kairou.space/canais';
  } else if (s === 'minha-lista' || s === 'list') {
    title = 'Minha Lista — Kairou';
    description = 'Seus filmes, séries e animes favoritos para assistir online no Kairou.';
    canonicalUrl = 'https://www.kairou.space/minha-lista';
  }

  let output = template;
  output = output.replace(/<title>.*?<\/title>/is, `<title>${title}</title>`);
  output = output.replace(/<meta name="title"[^>]*>/is, `<meta name="title" content="${title}" />`);
  output = output.replace(/<meta name="description"[^>]*>/is, `<meta name="description" content="${description}" />`);
  output = output.replace(/<link rel="canonical"[^>]*>/is, `<link rel="canonical" href="${canonicalUrl}" />`);
  output = output.replace(/<meta property="og:title"[^>]*>/is, `<meta property="og:title" content="${title}" />`);
  output = output.replace(/<meta property="og:description"[^>]*>/is, `<meta property="og:description" content="${description}" />`);
  output = output.replace(/<meta property="og:url"[^>]*>/is, `<meta property="og:url" content="${canonicalUrl}" />`);
  output = output.replace(/<meta name="twitter:title"[^>]*>/is, `<meta name="twitter:title" content="${title}" />`);
  output = output.replace(/<meta name="twitter:description"[^>]*>/is, `<meta name="twitter:description" content="${description}" />`);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(output);
}

// ─────────────────────────────────────────────────────────────────────────────
// SITEMAPS ENGINE (Index, Filmes, Séries, Animes, Estático)
// ─────────────────────────────────────────────────────────────────────────────

export async function getSitemapIndex() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.kairou.space/sitemap-static.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.kairou.space/sitemap-movies.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.kairou.space/sitemap-series.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.kairou.space/sitemap-animes.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`;
}

export async function getStaticSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const staticRoutes = [
    { loc: 'https://www.kairou.space/', priority: '1.0', changefreq: 'daily' },
    { loc: 'https://www.kairou.space/filmes', priority: '0.9', changefreq: 'daily' },
    { loc: 'https://www.kairou.space/series', priority: '0.9', changefreq: 'daily' },
    { loc: 'https://www.kairou.space/animes', priority: '0.9', changefreq: 'daily' },
    { loc: 'https://www.kairou.space/canais', priority: '0.8', changefreq: 'daily' },
    { loc: 'https://www.kairou.space/minha-lista', priority: '0.7', changefreq: 'weekly' },
  ];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  for (const r of staticRoutes) {
    xml += `  <url>\n    <loc>${r.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>\n`;
  }
  xml += `</urlset>`;
  return xml;
}

export async function getMoviesSitemap() {
  const cacheKey = 'sitemap:movies';
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
    return cached.data;
  }

  const today = new Date().toISOString().slice(0, 10);
  const movieEndpoints = [];
  for (let p = 1; p <= 10; p++) movieEndpoints.push(`/trending/movie/week?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 10; p++) movieEndpoints.push(`/movie/popular?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 8; p++) movieEndpoints.push(`/movie/top_rated?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 5; p++) movieEndpoints.push(`/movie/now_playing?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 4; p++) movieEndpoints.push(`/discover/movie?language=pt-BR&with_genres=28&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 4; p++) movieEndpoints.push(`/discover/movie?language=pt-BR&with_genres=27&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 4; p++) movieEndpoints.push(`/discover/movie?language=pt-BR&with_genres=878&sort_by=popularity.desc&page=${p}`);

  const seenIds = new Set();
  const items = [];

  for (const ep of movieEndpoints) {
    const data = await fetchTmdb(ep);
    if (data && Array.isArray(data.results)) {
      for (const m of data.results) {
        if (!m.id || seenIds.has(m.id)) continue;
        seenIds.add(m.id);
        items.push(m);
      }
    }
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
`;

  for (const m of items) {
    const slug = slugify(m.title || m.original_title || 'filme');
    const loc = `https://www.kairou.space/filme/${m.id}-${slug}`;
    const imgUrl = m.poster_path ? `https://image.tmdb.org/t/p/w780${m.poster_path}` : '';
    const date = today;

    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imgUrl ? `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>Assistir ${escapeXml(m.title || '')} Online Dublado</image:title>
    </image:image>` : ''}
  </url>\n`;
  }

  xml += `</urlset>`;
  memoryCache.set(cacheKey, { data: xml, timestamp: Date.now() });
  return xml;
}

export async function getSeriesSitemap() {
  const cacheKey = 'sitemap:series';
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
    return cached.data;
  }

  const today = new Date().toISOString().slice(0, 10);
  const seriesEndpoints = [];
  for (let p = 1; p <= 10; p++) seriesEndpoints.push(`/trending/tv/week?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 10; p++) seriesEndpoints.push(`/tv/popular?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 8; p++) seriesEndpoints.push(`/tv/top_rated?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 5; p++) seriesEndpoints.push(`/discover/tv?language=pt-BR&with_genres=10759&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 5; p++) seriesEndpoints.push(`/discover/tv?language=pt-BR&with_genres=18&sort_by=popularity.desc&page=${p}`);

  const seenIds = new Set();
  const items = [];

  for (const ep of seriesEndpoints) {
    const data = await fetchTmdb(ep);
    if (data && Array.isArray(data.results)) {
      for (const s of data.results) {
        if (!s.id || seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        items.push(s);
      }
    }
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
`;

  for (const s of items) {
    const slug = slugify(s.name || s.original_name || 'serie');
    const loc = `https://www.kairou.space/serie/${s.id}-${slug}`;
    const imgUrl = s.poster_path ? `https://image.tmdb.org/t/p/w780${s.poster_path}` : '';
    const date = today;

    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imgUrl ? `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>Assistir Série ${escapeXml(s.name || '')} Online</image:title>
    </image:image>` : ''}
  </url>\n`;
  }

  xml += `</urlset>`;
  memoryCache.set(cacheKey, { data: xml, timestamp: Date.now() });
  return xml;
}

export async function getAnimesSitemap() {
  const cacheKey = 'sitemap:animes';
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
    return cached.data;
  }

  const today = new Date().toISOString().slice(0, 10);
  const animeEndpoints = [];
  for (let p = 1; p <= 12; p++) animeEndpoints.push(`/discover/tv?language=pt-BR&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 8; p++) animeEndpoints.push(`/discover/tv?language=pt-BR&with_genres=16&with_original_language=ja&sort_by=vote_count.desc&page=${p}`);
  for (let p = 1; p <= 6; p++) animeEndpoints.push(`/discover/movie?language=pt-BR&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=${p}`);

  const seenIds = new Set();
  const items = [];

  for (const ep of animeEndpoints) {
    const data = await fetchTmdb(ep);
    if (data && Array.isArray(data.results)) {
      for (const a of data.results) {
        if (!a.id || seenIds.has(a.id)) continue;
        seenIds.add(a.id);
        items.push(a);
      }
    }
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
`;

  for (const a of items) {
    const title = a.name || a.title || 'anime';
    const slug = slugify(title);
    const loc = `https://www.kairou.space/anime/${a.id}-${slug}`;
    const imgUrl = a.poster_path ? `https://image.tmdb.org/t/p/w780${a.poster_path}` : '';
    const date = today;

    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imgUrl ? `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>Assistir Anime ${escapeXml(title)} Online Dublado</image:title>
    </image:image>` : ''}
  </url>\n`;
  }

  xml += `</urlset>`;
  memoryCache.set(cacheKey, { data: xml, timestamp: Date.now() });
  return xml;
}

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
}
