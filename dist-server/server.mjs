var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/seoEngine.js
var seoEngine_exports = {};
__export(seoEngine_exports, {
  getAnimesSitemap: () => getAnimesSitemap,
  getMoviesSitemap: () => getMoviesSitemap,
  getSeriesSitemap: () => getSeriesSitemap,
  getSitemapIndex: () => getSitemapIndex,
  getStaticSitemap: () => getStaticSitemap,
  renderSectionSeo: () => renderSectionSeo,
  renderSeoPage: () => renderSeoPage,
  slugify: () => slugify
});
import fs4 from "node:fs";
import path4 from "node:path";
import { fileURLToPath } from "node:url";
function getIndexTemplate() {
  const now = Date.now();
  if (!cachedIndexHtml || now - lastIndexHtmlCheck > 6e4) {
    lastIndexHtmlCheck = now;
    const candidates = [
      path4.join(ROOT_DIR, "dist", "index.html"),
      path4.join(ROOT_DIR, "index.html"),
      path4.join(process.cwd(), "web", "index.html"),
      path4.join(process.cwd(), "dist", "index.html"),
      path4.join(process.cwd(), "index.html")
    ];
    for (const cand of candidates) {
      try {
        if (fs4.existsSync(cand)) {
          cachedIndexHtml = fs4.readFileSync(cand, "utf-8");
          break;
        }
      } catch (e) {
      }
    }
  }
  return cachedIndexHtml;
}
function slugify(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
async function fetchTmdb(endpoint2) {
  const cacheKey = `tmdb:${endpoint2}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const res = await fetch(`${TMDB_BASE_URL}${endpoint2}`, {
      headers: {
        Authorization: `Bearer ${TMDB_READ_TOKEN()}`,
        Accept: "application/json"
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    memoryCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.warn(`[SEO TMDB Error]: ${endpoint2}`, err.message);
    return null;
  }
}
async function renderSeoPage(req, res, { type, id, slug }) {
  const rawType = (type || "").toLowerCase();
  const isSeries = rawType === "serie" || rawType === "tv" || rawType === "series";
  const isAnime = rawType === "anime";
  const typePrefix = isAnime ? "anime" : isSeries ? "serie" : "filme";
  let details = null;
  let tmdbType = "movie";
  if (isAnime) {
    const [tvData, movieData] = await Promise.all([
      fetchTmdb(`/tv/${id}?language=pt-BR&append_to_response=credits,keywords`),
      fetchTmdb(`/movie/${id}?language=pt-BR&append_to_response=credits,keywords`)
    ]);
    const isTvAnime = tvData?.genres?.some((g) => g.id === 16 || g.name === "Anima\xE7\xE3o");
    const isMovieAnime = movieData?.genres?.some((g) => g.id === 16 || g.name === "Anima\xE7\xE3o");
    if (isTvAnime && !isMovieAnime) {
      details = tvData;
      tmdbType = "tv";
    } else if (isMovieAnime && !isTvAnime) {
      details = movieData;
      tmdbType = "movie";
    } else if (isTvAnime && isMovieAnime) {
      const movieSlug = slugify(movieData.title || "");
      const cleanSlug2 = slug || "";
      if (cleanSlug2 && (movieSlug.includes(cleanSlug2) || cleanSlug2.includes(movieSlug))) {
        details = movieData;
        tmdbType = "movie";
      } else {
        details = tvData;
        tmdbType = "tv";
      }
    } else {
      details = tvData || movieData;
      tmdbType = tvData ? "tv" : "movie";
    }
  } else if (isSeries) {
    details = await fetchTmdb(`/tv/${id}?language=pt-BR&append_to_response=credits,keywords`);
    if (details && (details.name || details.first_air_date)) {
      tmdbType = "tv";
    } else {
      details = await fetchTmdb(`/movie/${id}?language=pt-BR&append_to_response=credits,keywords`);
      if (details) tmdbType = "movie";
    }
  } else {
    details = await fetchTmdb(`/movie/${id}?language=pt-BR&append_to_response=credits,keywords`);
    if (details && (details.title || details.release_date)) {
      tmdbType = "movie";
    } else {
      details = await fetchTmdb(`/tv/${id}?language=pt-BR&append_to_response=credits,keywords`);
      if (details) tmdbType = "tv";
    }
  }
  const template = getIndexTemplate();
  const title = details ? details.title || details.name || "T\xEDtulo sem nome" : "";
  const cleanSlug = slug || (title ? slugify(title) : "");
  const canonicalUrl = `https://www.kairou.space/${typePrefix}/${id}${cleanSlug ? "-" + cleanSlug : ""}`;
  if (!details || !template) {
    const fallbackTitle = cleanSlug ? cleanSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Assistir Online";
    let fallbackHtml = template || "<!doctype html><html><head></head><body></body></html>";
    fallbackHtml = fallbackHtml.replace(/<title>.*?<\/title>/is, `<title>Assistir ${fallbackTitle} Online HD e 4K \u2014 Kairou</title>`);
    fallbackHtml = fallbackHtml.replace(/<link rel="canonical"[^>]*>/is, `<link rel="canonical" href="${canonicalUrl}" />`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 200;
    return res.end(fallbackHtml);
  }
  const originalTitle = details.original_title || details.original_name || title;
  const year = (details.release_date || details.first_air_date || "").slice(0, 4) || "2026";
  const rating = Number(details.vote_average || 0).toFixed(1);
  const voteCount = details.vote_count || 100;
  const overview = (details.overview || "Sinopse completa dispon\xEDvel para assistir online em alta defini\xE7\xE3o no Kairou.").trim();
  const shortOverview = overview.slice(0, 160).replace(/"/g, "'");
  const backdropUrl = details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : "https://www.kairou.space/assets/og-image.png";
  const posterUrl = details.poster_path ? `https://image.tmdb.org/t/p/w780${details.poster_path}` : "https://www.kairou.space/assets/mark.svg";
  const genres = (details.genres || []).map((g) => g.name);
  const genresStr = genres.join(", ") || (isAnime ? "Anime, Anima\xE7\xE3o" : isSeries ? "S\xE9rie" : "Filme");
  const crew = details.credits?.crew || [];
  const cast = (details.credits?.cast || []).slice(0, 8);
  const director = crew.find((c) => c.job === "Director")?.name || "Diretor";
  const actorsNames = cast.map((c) => c.name).join(", ");
  let metaTitle = "";
  let metaDescription = "";
  if (isAnime) {
    metaTitle = `Assistir ${title} Online Dublado e Legendado HD \u2014 Kairou`;
    metaDescription = `Assista ao anime ${title} (${year}) completo dublado e legendado online em Full HD gr\xE1tis. ${shortOverview} Acesse no Kairou!`;
  } else if (isSeries) {
    metaTitle = `Assistir ${title} Todas as Temporadas Online Dublado e Legendado \u2014 Kairou`;
    metaDescription = `Assista \xE0 s\xE9rie ${title} (${year}) online dublada e legendada em Full HD gr\xE1tis. Todas as temporadas e epis\xF3dios completos no Kairou.`;
  } else {
    metaTitle = `Assistir ${title} (${year}) Online Dublado e Legendado HD e 4K \u2014 Kairou`;
    metaDescription = `Assista a ${title} (${year}) completo online dublado e legendado em 1080p e 4K gr\xE1tis. ${shortOverview} Dispon\xEDvel no Kairou Streaming.`;
  }
  const keywords = [
    `assistir ${title.toLowerCase()} online`,
    `${title.toLowerCase()} dublado`,
    `${title.toLowerCase()} legendado`,
    `${title.toLowerCase()} ${year} online gratis`,
    `${title.toLowerCase()} completo`,
    `assistir ${originalTitle.toLowerCase()} online`,
    isAnime ? "assistir animes online" : isSeries ? "assistir series online" : "assistir filmes online",
    "kairou streaming",
    "filmes em 4k gratis"
  ].join(", ");
  const schemaType = isSeries || isAnime ? "TVSeries" : "Movie";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: title,
    alternateName: originalTitle,
    url: canonicalUrl,
    image: posterUrl,
    description: overview,
    datePublished: details.release_date || details.first_air_date || `${year}-01-01`,
    genre: genres,
    inLanguage: "pt-BR",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: rating > 0 ? rating : "8.5",
      bestRating: "10",
      ratingCount: voteCount > 0 ? String(voteCount) : "150"
    },
    ...director !== "Diretor" && {
      director: {
        "@type": "Person",
        name: director
      }
    },
    actor: cast.map((actor) => ({
      "@type": "Person",
      name: actor.name
    })),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "BRL",
      availability: "https://schema.org/InStock",
      category: "Free"
    }
  };
  const semanticHtml = `
    <main id="kairou-seo-container" style="max-width: 1200px; margin: 0 auto; padding: 40px 20px; font-family: system-ui, -apple-system, sans-serif; color: #f8fafc;">
      <nav aria-label="Breadcrumb" style="font-size: 13px; color: #94a3b8; margin-bottom: 20px;">
        <a href="/" style="color: #38bdf8; text-decoration: none;">In\xEDcio</a> &gt; 
        <a href="/${typePrefix}s" style="color: #38bdf8; text-decoration: none;">${isAnime ? "Animes" : isSeries ? "S\xE9ries" : "Filmes"}</a> &gt; 
        <span>${title}</span>
      </nav>

      <article itemscope itemtype="https://schema.org/${schemaType}">
        <header style="display: flex; gap: 30px; flex-wrap: wrap; margin-bottom: 30px;">
          <div style="width: 240px; aspect-ratio: 2/3; border-radius: 16px; overflow: hidden; background: #0f141e; flex-shrink: 0; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <img src="${posterUrl}" alt="P\xF4ster de ${title}" style="width: 100%; height: 100%; object-fit: cover;" itemprop="image" />
          </div>
          <div style="flex: 1; min-width: 300px;">
            <h1 itemprop="name" style="font-size: 32px; font-weight: 800; color: #ffffff; margin: 0 0 8px 0; line-height: 1.2;">
              Assistir ${title} (${year}) Online Gr\xE1tis em HD e 4K
            </h1>
            <h2 style="font-size: 16px; font-weight: 500; color: #38bdf8; margin: 0 0 16px 0;">
              ${originalTitle !== title ? originalTitle + " \u2022 " : ""}${genresStr}
            </h2>

            <div style="display: flex; gap: 15px; align-items: center; margin-bottom: 20px; font-size: 14px; color: #cbd5e1;">
              <span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 4px 10px; border-radius: 8px; font-weight: 700;">
                \u2B50 ${rating} / 10
              </span>
              <span>Ano: ${year}</span>
              <span>Qualidade: 1080p Full HD &amp; 4K</span>
              <span>\xC1udio: Dublado e Legendado PT-BR</span>
            </div>

            <div style="margin-bottom: 24px;">
              <a href="#/title/${tmdbType}:${id}" style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; background: #38bdf8; color: #020617; font-weight: 800; border-radius: 12px; text-decoration: none; font-size: 15px; box-shadow: 0 4px 14px rgba(56, 189, 248, 0.4);">
                \u25B6 Assistir ${title} Agora
              </a>
            </div>

            <h3 style="font-size: 18px; font-weight: 700; color: #f1f5f9; margin: 0 0 8px 0;">Sinopse</h3>
            <p itemprop="description" style="font-size: 14px; line-height: 1.7; color: #94a3b8; margin: 0 0 20px 0;">
              ${overview}
            </p>

            ${actorsNames ? `
              <h3 style="font-size: 16px; font-weight: 700; color: #f1f5f9; margin: 0 0 6px 0;">Elenco Principal</h3>
              <p style="font-size: 13px; color: #94a3b8; margin: 0 0 20px 0;">${actorsNames}</p>
            ` : ""}
          </div>
        </header>
      </article>
    </main>
  `;
  let output = template;
  if (/<title>.*?<\/title>/is.test(output)) {
    output = output.replace(/<title>.*?<\/title>/is, `<title>${metaTitle}</title>`);
  }
  if (/<link rel="canonical"[^>]*>/is.test(output)) {
    output = output.replace(/<link rel="canonical"[^>]*>/is, `<link rel="canonical" href="${canonicalUrl}" />`);
  } else {
    output = output.replace("</head>", `  <link rel="canonical" href="${canonicalUrl}" />
</head>`);
  }
  if (/<meta name="title"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="title"[^>]*>/is, `<meta name="title" content="${metaTitle}" />`);
  } else {
    output = output.replace("</head>", `  <meta name="title" content="${metaTitle}" />
</head>`);
  }
  if (/<meta name="description"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="description"[^>]*>/is, `<meta name="description" content="${metaDescription}" />`);
  } else {
    output = output.replace("</head>", `  <meta name="description" content="${metaDescription}" />
</head>`);
  }
  if (/<meta name="keywords"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="keywords"[^>]*>/is, `<meta name="keywords" content="${keywords}" />`);
  } else {
    output = output.replace("</head>", `  <meta name="keywords" content="${keywords}" />
</head>`);
  }
  if (/<meta property="og:title"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:title"[^>]*>/is, `<meta property="og:title" content="${metaTitle}" />`);
  } else {
    output = output.replace("</head>", `  <meta property="og:title" content="${metaTitle}" />
</head>`);
  }
  if (/<meta property="og:description"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:description"[^>]*>/is, `<meta property="og:description" content="${metaDescription}" />`);
  } else {
    output = output.replace("</head>", `  <meta property="og:description" content="${metaDescription}" />
</head>`);
  }
  if (/<meta property="og:url"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:url"[^>]*>/is, `<meta property="og:url" content="${canonicalUrl}" />`);
  } else {
    output = output.replace("</head>", `  <meta property="og:url" content="${canonicalUrl}" />
</head>`);
  }
  if (/<meta property="og:image"[^>]*>/is.test(output)) {
    output = output.replace(/<meta property="og:image"[^>]*>/is, `<meta property="og:image" content="${backdropUrl}" />`);
  } else {
    output = output.replace("</head>", `  <meta property="og:image" content="${backdropUrl}" />
</head>`);
  }
  if (/<meta name="twitter:title"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="twitter:title"[^>]*>/is, `<meta name="twitter:title" content="${metaTitle}" />`);
  }
  if (/<meta name="twitter:description"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="twitter:description"[^>]*>/is, `<meta name="twitter:description" content="${metaDescription}" />`);
  }
  if (/<meta name="twitter:image"[^>]*>/is.test(output)) {
    output = output.replace(/<meta name="twitter:image"[^>]*>/is, `<meta name="twitter:image" content="${backdropUrl}" />`);
  }
  const jsonLdScript = `
  <!-- TMDB Rich Snippet Schema.org -->
  <script type="application/ld+json">
  ${JSON.stringify(structuredData, null, 2)}
  </script>
</head>`;
  output = output.replace("</head>", jsonLdScript);
  if (output.includes('<main id="main">')) {
    output = output.replace('<main id="main">', `<main id="main">${semanticHtml}`);
  } else if (output.includes('<div id="root">')) {
    output = output.replace('<div id="root">', `<div id="root">${semanticHtml}`);
  } else if (output.includes("<body>")) {
    output = output.replace("<body>", `<body>${semanticHtml}`);
  } else if (/<body[^>]*>/is.test(output)) {
    output = output.replace(/(<body[^>]*>)/is, `$1${semanticHtml}`);
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.end(output);
}
function renderSectionSeo(req, res, section) {
  const template = getIndexTemplate();
  if (!template) {
    res.statusCode = 200;
    return res.end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  }
  const s = String(section || "").toLowerCase();
  let title = "Kairou \u2014 Assistir Filmes, S\xE9ries e Animes Online Gr\xE1tis em HD e 4K";
  let description = "Assista a filmes, s\xE9ries completas e animes online gratuitamente em alta defini\xE7\xE3o (HD e 4K). Cat\xE1logo atualizado diariamente com lan\xE7amentos dublados e legendados no Kairou.";
  let canonicalUrl = `https://www.kairou.space/${s}`;
  if (s === "filmes" || s === "movies") {
    title = "Filmes Online Dublados e Legendados em HD e 4K \u2014 Kairou";
    description = "Explore o cat\xE1logo completo de filmes online dublados e legendados em 1080p e 4K no Kairou Streaming. Lan\xE7amentos, cl\xE1ssicos e sucessos de bilheteria.";
    canonicalUrl = "https://www.kairou.space/filmes";
  } else if (s === "series" || s === "shows") {
    title = "S\xE9ries Online Completas em HD e 4K \u2014 Kairou";
    description = "Assista a s\xE9ries completas online dubladas e legendadas em alta defini\xE7\xE3o no Kairou. Todas as temporadas, epis\xF3dios atualizados e lan\xE7amentos.";
    canonicalUrl = "https://www.kairou.space/series";
  } else if (s === "animes") {
    title = "Animes Online Dublados e Legendados em HD \u2014 Kairou";
    description = "Assista a animes dublados e legendados em alta qualidade no Kairou. Lan\xE7amentos da temporada, cl\xE1ssicos e epis\xF3dios di\xE1rios.";
    canonicalUrl = "https://www.kairou.space/animes";
  } else if (s === "canais") {
    title = "Canais ao Vivo em HD \u2014 Kairou";
    description = "Assista a canais de TV ao vivo online em Full HD no Kairou Streaming.";
    canonicalUrl = "https://www.kairou.space/canais";
  } else if (s === "minha-lista" || s === "list") {
    title = "Minha Lista \u2014 Kairou";
    description = "Seus filmes, s\xE9ries e animes favoritos para assistir online no Kairou.";
    canonicalUrl = "https://www.kairou.space/minha-lista";
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
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(output);
}
async function getSitemapIndex() {
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.kairou.space/sitemap-static.xml</loc>
    <lastmod>${today2}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.kairou.space/sitemap-movies.xml</loc>
    <lastmod>${today2}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.kairou.space/sitemap-series.xml</loc>
    <lastmod>${today2}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.kairou.space/sitemap-animes.xml</loc>
    <lastmod>${today2}</lastmod>
  </sitemap>
</sitemapindex>`;
}
async function getStaticSitemap() {
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const staticRoutes = [
    { loc: "https://www.kairou.space/", priority: "1.0", changefreq: "daily" },
    { loc: "https://www.kairou.space/filmes", priority: "0.9", changefreq: "daily" },
    { loc: "https://www.kairou.space/series", priority: "0.9", changefreq: "daily" },
    { loc: "https://www.kairou.space/animes", priority: "0.9", changefreq: "daily" },
    { loc: "https://www.kairou.space/canais", priority: "0.8", changefreq: "daily" },
    { loc: "https://www.kairou.space/minha-lista", priority: "0.7", changefreq: "weekly" }
  ];
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;
  for (const r of staticRoutes) {
    xml += `  <url>
    <loc>${r.loc}</loc>
    <lastmod>${today2}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>
`;
  }
  xml += `</urlset>`;
  return xml;
}
async function getMoviesSitemap() {
  const cacheKey = "sitemap:movies";
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1e3) {
    return cached.data;
  }
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const movieEndpoints = [];
  for (let p = 1; p <= 10; p++) movieEndpoints.push(`/trending/movie/week?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 10; p++) movieEndpoints.push(`/movie/popular?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 8; p++) movieEndpoints.push(`/movie/top_rated?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 5; p++) movieEndpoints.push(`/movie/now_playing?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 4; p++) movieEndpoints.push(`/discover/movie?language=pt-BR&with_genres=28&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 4; p++) movieEndpoints.push(`/discover/movie?language=pt-BR&with_genres=27&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 4; p++) movieEndpoints.push(`/discover/movie?language=pt-BR&with_genres=878&sort_by=popularity.desc&page=${p}`);
  const seenIds = /* @__PURE__ */ new Set();
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
    const slug = slugify(m.title || m.original_title || "filme");
    const loc = `https://www.kairou.space/filme/${m.id}-${slug}`;
    const imgUrl = m.poster_path ? `https://image.tmdb.org/t/p/w780${m.poster_path}` : "";
    const date = today2;
    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imgUrl ? `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>Assistir ${escapeXml(m.title || "")} Online Dublado</image:title>
    </image:image>` : ""}
  </url>
`;
  }
  xml += `</urlset>`;
  memoryCache.set(cacheKey, { data: xml, timestamp: Date.now() });
  return xml;
}
async function getSeriesSitemap() {
  const cacheKey = "sitemap:series";
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1e3) {
    return cached.data;
  }
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const seriesEndpoints = [];
  for (let p = 1; p <= 10; p++) seriesEndpoints.push(`/trending/tv/week?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 10; p++) seriesEndpoints.push(`/tv/popular?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 8; p++) seriesEndpoints.push(`/tv/top_rated?language=pt-BR&page=${p}`);
  for (let p = 1; p <= 5; p++) seriesEndpoints.push(`/discover/tv?language=pt-BR&with_genres=10759&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 5; p++) seriesEndpoints.push(`/discover/tv?language=pt-BR&with_genres=18&sort_by=popularity.desc&page=${p}`);
  const seenIds = /* @__PURE__ */ new Set();
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
    const slug = slugify(s.name || s.original_name || "serie");
    const loc = `https://www.kairou.space/serie/${s.id}-${slug}`;
    const imgUrl = s.poster_path ? `https://image.tmdb.org/t/p/w780${s.poster_path}` : "";
    const date = today2;
    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imgUrl ? `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>Assistir S\xE9rie ${escapeXml(s.name || "")} Online</image:title>
    </image:image>` : ""}
  </url>
`;
  }
  xml += `</urlset>`;
  memoryCache.set(cacheKey, { data: xml, timestamp: Date.now() });
  return xml;
}
async function getAnimesSitemap() {
  const cacheKey = "sitemap:animes";
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1e3) {
    return cached.data;
  }
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const animeEndpoints = [];
  for (let p = 1; p <= 12; p++) animeEndpoints.push(`/discover/tv?language=pt-BR&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=${p}`);
  for (let p = 1; p <= 8; p++) animeEndpoints.push(`/discover/tv?language=pt-BR&with_genres=16&with_original_language=ja&sort_by=vote_count.desc&page=${p}`);
  for (let p = 1; p <= 6; p++) animeEndpoints.push(`/discover/movie?language=pt-BR&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=${p}`);
  const seenIds = /* @__PURE__ */ new Set();
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
    const title = a.name || a.title || "anime";
    const slug = slugify(title);
    const loc = `https://www.kairou.space/anime/${a.id}-${slug}`;
    const imgUrl = a.poster_path ? `https://image.tmdb.org/t/p/w780${a.poster_path}` : "";
    const date = today2;
    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imgUrl ? `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>Assistir Anime ${escapeXml(title)} Online Dublado</image:title>
    </image:image>` : ""}
  </url>
`;
  }
  xml += `</urlset>`;
  memoryCache.set(cacheKey, { data: xml, timestamp: Date.now() });
  return xml;
}
function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
    }
  });
}
var __filename, __dirname, ROOT_DIR, TMDB_READ_TOKEN, TMDB_BASE_URL, memoryCache, CACHE_TTL_MS, cachedIndexHtml, lastIndexHtmlCheck;
var init_seoEngine = __esm({
  "server/seoEngine.js"() {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path4.dirname(__filename);
    ROOT_DIR = path4.resolve(__dirname, "..");
    TMDB_READ_TOKEN = () => process.env.TMDB_READ_TOKEN || "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4MjljMjk3OTUwZTYxZTBjNzE3OGI1ZmQ5YzllNmZhMCIsIm5iZiI6MTc1MTgyNDMyMC40NTcsInN1YiI6IjY4NmFiN2MwZDQ4OWE5YzMyYTUzZmFjNCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.IBBf0y2Nv9mzgXSpswQC2MsezfsDKAkhtKTC3211BpY";
    TMDB_BASE_URL = "https://api.themoviedb.org/3";
    memoryCache = /* @__PURE__ */ new Map();
    CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
    cachedIndexHtml = null;
    lastIndexHtmlCheck = 0;
  }
});

// server.ts
import crypto3 from "node:crypto";

// server/pocketbase.ts
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
var storeFile = () => process.env.AUTH_DATA_FILE || path.resolve(process.cwd(), ".local-data/auth_store.json");
var DEFAULT_STORE = {
  users: [
    {
      id: "user_shizuu122",
      email: "shizuu122@gmail.com",
      password: "Po2nath7!",
      verified: true,
      vip_until: "2099-01-01T00:00:00.000Z",
      created: "2026-11-14T00:00:00.000Z",
      updated: "2026-11-14T00:00:00.000Z"
    }
  ],
  profiles: [
    {
      id: "prof_shizuu122_main",
      user: "user_shizuu122",
      name: "Shizuu",
      color: "#2e7bff",
      border_color: "#38bdf8",
      avatar_kind: "smiley",
      avatar_url: "",
      kids: false,
      max_rating: "18",
      created: "2026-11-14T00:00:00.000Z",
      updated: "2026-11-14T00:00:00.000Z"
    }
  ],
  profile_state: [
    {
      id: "state_shizuu122_main",
      user: "user_shizuu122",
      profile: "prof_shizuu122_main",
      saved: [],
      watched: [],
      progress: [],
      created: "2026-11-14T00:00:00.000Z",
      updated: "2026-11-14T00:00:00.000Z"
    }
  ]
};
function readStore() {
  try {
    const file = storeFile();
    if (!fs.existsSync(file)) {
      saveStore(DEFAULT_STORE);
      return JSON.parse(JSON.stringify(DEFAULT_STORE));
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      users: Array.isArray(data.users) && data.users.length ? data.users : DEFAULT_STORE.users,
      profiles: Array.isArray(data.profiles) && data.profiles.length ? data.profiles : DEFAULT_STORE.profiles,
      profile_state: Array.isArray(data.profile_state) ? data.profile_state : DEFAULT_STORE.profile_state
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}
function saveStore(data) {
  try {
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error("Failed to save auth store:", err);
  }
}
function grantUserVip(identity, days2, _plan = "mensal") {
  const clean = String(identity || "").trim().toLowerCase();
  if (!clean) return null;
  const store = readStore();
  let user = store.users.find((u) => u.email.toLowerCase() === clean || u.id === clean);
  if (!user && (clean === "user_shizuu122" || clean === "shizuu122@gmail.com" || clean.includes("shizuu"))) {
    user = store.users[0];
  }
  if (!user) return null;
  const current = user.vip_until ? new Date(user.vip_until).getTime() : 0;
  const base = current > Date.now() ? current : Date.now();
  const until = new Date(base + days2 * 864e5).toISOString();
  user.vip_until = until;
  user.updated = (/* @__PURE__ */ new Date()).toISOString();
  saveStore(store);
  return until;
}
function createPocketBaseRouter() {
  const router = Router();
  const pbUrl2 = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";
  router.use(async (req, res, next) => {
    if (req.url.includes("/collections/profile_state")) {
      return next();
    }
    try {
      const targetUrl = `${pbUrl2.replace(/\/$/, "")}/api${req.url}`;
      const forwardHeaders = {
        "content-type": "application/json",
        "accept": "application/json"
      };
      if (req.headers.authorization) {
        forwardHeaders.authorization = String(req.headers.authorization);
      }
      const controller = new AbortController();
      const timer2 = setTimeout(() => controller.abort(), 3e3);
      const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.body && Object.keys(req.body).length > 0;
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: hasBody ? JSON.stringify(req.body) : void 0,
        signal: controller.signal
      });
      clearTimeout(timer2);
      if (upstream.status === 404) {
        return next();
      }
      res.status(upstream.status);
      upstream.headers.forEach((v, k) => {
        if (!["content-encoding", "content-length", "transfer-encoding"].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      });
      const data = await upstream.text();
      return res.send(data);
    } catch {
      next();
    }
  });
  router.post("/collections/users/auth-with-password", (req, res) => {
    const { identity, password } = req.body || {};
    const email = String(identity || "").trim().toLowerCase();
    const store = readStore();
    const user = store.users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.password !== password) {
      return res.status(400).json({ message: "Email ou senha inv\xE1lidos." });
    }
    const token2 = `kairou_token_${user.id}`;
    return res.json({
      token: token2,
      record: {
        id: user.id,
        email: user.email,
        verified: user.verified,
        vip_until: user.vip_until,
        created: user.created,
        updated: user.updated
      }
    });
  });
  router.post("/collections/users/auth-refresh", (req, res) => {
    const rawAuth = req.headers.authorization || "";
    const token2 = rawAuth.replace(/^Bearer\s+/i, "").trim();
    const store = readStore();
    let user = store.users.find((u) => `kairou_token_${u.id}` === token2);
    if (!user && token2.startsWith("kairou_token_")) {
      user = store.users[0];
    }
    if (!user) {
      return res.status(401).json({ message: "Sess\xE3o expirada." });
    }
    return res.json({
      token: `kairou_token_${user.id}`,
      record: {
        id: user.id,
        email: user.email,
        verified: user.verified,
        vip_until: user.vip_until,
        created: user.created,
        updated: user.updated
      }
    });
  });
  router.get("/collections/users/records", (req, res) => {
    const store = readStore();
    const filter = String(req.query.filter || "");
    const emailMatch = filter.match(/email="([^"]+)"/i);
    const email = emailMatch ? emailMatch[1].toLowerCase() : null;
    let items = email ? store.users.filter((u) => u.email.toLowerCase() === email) : store.users;
    return res.json({
      page: 1,
      perPage: 100,
      totalItems: items.length,
      totalPages: 1,
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        verified: u.verified,
        vip_until: u.vip_until,
        created: u.created,
        updated: u.updated
      }))
    });
  });
  router.patch("/collections/users/records/:id", (req, res) => {
    const store = readStore();
    const id = req.params.id;
    const idx = store.users.findIndex((u) => u.id === id || u.email.toLowerCase() === id.toLowerCase());
    if (idx === -1) {
      return res.status(404).json({ message: "Usu\xE1rio n\xE3o encontrado." });
    }
    const b = req.body || {};
    if (b.vip_until !== void 0) {
      store.users[idx].vip_until = b.vip_until;
    }
    store.users[idx].updated = (/* @__PURE__ */ new Date()).toISOString();
    saveStore(store);
    return res.json({
      id: store.users[idx].id,
      email: store.users[idx].email,
      verified: store.users[idx].verified,
      vip_until: store.users[idx].vip_until,
      created: store.users[idx].created,
      updated: store.users[idx].updated
    });
  });
  router.post("/collections/users/records", (_req, res) => {
    return res.status(400).json({
      message: "Modo de teste: use a conta de teste configurada: shizuu122@gmail.com"
    });
  });
  router.get("/collections/profiles/records", (req, res) => {
    const store = readStore();
    const filter = String(req.query.filter || "");
    const userMatch = filter.match(/user="([^"]+)"/);
    const userId = userMatch ? userMatch[1] : null;
    let items = userId ? store.profiles.filter((p) => p.user === userId) : store.profiles;
    if (!items.length && userId === "user_shizuu122") {
      items = store.profiles;
    }
    return res.json({
      page: 1,
      perPage: 100,
      totalItems: items.length,
      totalPages: 1,
      items
    });
  });
  router.post("/collections/profiles/records", (req, res) => {
    const store = readStore();
    const b = req.body || {};
    const newProfile = {
      id: "prof_" + crypto.randomBytes(6).toString("hex"),
      user: String(b.user || "user_shizuu122"),
      name: String(b.name || "Meu perfil"),
      color: String(b.color || "#2e7bff"),
      border_color: b.border_color ? String(b.border_color) : void 0,
      avatar_kind: b.avatar_kind ? String(b.avatar_kind) : void 0,
      avatar_url: b.avatar_url ? String(b.avatar_url) : void 0,
      kids: Boolean(b.kids),
      max_rating: b.max_rating ? String(b.max_rating) : "18",
      created: (/* @__PURE__ */ new Date()).toISOString(),
      updated: (/* @__PURE__ */ new Date()).toISOString()
    };
    store.profiles.push(newProfile);
    saveStore(store);
    return res.status(200).json(newProfile);
  });
  router.patch("/collections/profiles/records/:id", (req, res) => {
    const store = readStore();
    const id = req.params.id;
    const idx = store.profiles.findIndex((p) => p.id === id);
    if (idx === -1) {
      return res.status(404).json({ message: "Perfil n\xE3o encontrado." });
    }
    const b = req.body || {};
    store.profiles[idx] = {
      ...store.profiles[idx],
      name: b.name !== void 0 ? String(b.name) : store.profiles[idx].name,
      color: b.color !== void 0 ? String(b.color) : store.profiles[idx].color,
      border_color: b.border_color !== void 0 ? String(b.border_color) : store.profiles[idx].border_color,
      avatar_url: b.avatar_url !== void 0 ? String(b.avatar_url) : store.profiles[idx].avatar_url,
      avatar_kind: b.avatar_kind !== void 0 ? String(b.avatar_kind) : store.profiles[idx].avatar_kind,
      kids: b.kids !== void 0 ? Boolean(b.kids) : store.profiles[idx].kids,
      max_rating: b.max_rating !== void 0 ? String(b.max_rating) : store.profiles[idx].max_rating,
      updated: (/* @__PURE__ */ new Date()).toISOString()
    };
    saveStore(store);
    return res.status(200).json(store.profiles[idx]);
  });
  router.delete("/collections/profiles/records/:id", (req, res) => {
    const store = readStore();
    const id = req.params.id;
    store.profiles = store.profiles.filter((p) => p.id !== id);
    saveStore(store);
    return res.status(204).end();
  });
  router.get("/collections/profile_state/records", (req, res) => {
    const store = readStore();
    const filter = String(req.query.filter || "");
    const profMatch = filter.match(/profile="([^"]+)"/);
    const profileId = profMatch ? profMatch[1] : null;
    const items = profileId ? store.profile_state.filter((s) => s.profile === profileId) : store.profile_state;
    return res.json({
      page: 1,
      perPage: 100,
      totalItems: items.length,
      totalPages: 1,
      items
    });
  });
  router.post("/collections/profile_state/records", (req, res) => {
    const store = readStore();
    const b = req.body || {};
    const state = {
      id: "state_" + crypto.randomBytes(6).toString("hex"),
      user: String(b.user || "user_shizuu122"),
      profile: String(b.profile || ""),
      saved: Array.isArray(b.saved) ? b.saved : [],
      watched: Array.isArray(b.watched) ? b.watched : [],
      progress: Array.isArray(b.progress) ? b.progress : [],
      created: (/* @__PURE__ */ new Date()).toISOString(),
      updated: (/* @__PURE__ */ new Date()).toISOString()
    };
    store.profile_state.push(state);
    saveStore(store);
    return res.status(200).json(state);
  });
  router.patch("/collections/profile_state/records/:id", (req, res) => {
    const store = readStore();
    const id = req.params.id;
    const idx = store.profile_state.findIndex((s) => s.id === id);
    if (idx === -1) {
      return res.status(404).json({ message: "Estado n\xE3o encontrado." });
    }
    const b = req.body || {};
    store.profile_state[idx] = {
      ...store.profile_state[idx],
      saved: Array.isArray(b.saved) ? b.saved : store.profile_state[idx].saved,
      watched: Array.isArray(b.watched) ? b.watched : store.profile_state[idx].watched,
      progress: Array.isArray(b.progress) ? b.progress : store.profile_state[idx].progress,
      updated: (/* @__PURE__ */ new Date()).toISOString()
    };
    saveStore(store);
    return res.status(200).json(store.profile_state[idx]);
  });
  return router;
}

// server/analytics.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { Router as Router2 } from "express";
var dataFile = process.env.KAIROU_ANALYTICS_FILE || path2.join(process.cwd(), ".local-data", "analytics.json");
var online = /* @__PURE__ */ new Map();
var days = {};
try {
  days = JSON.parse(fs2.readFileSync(dataFile, "utf8")).days || {};
} catch {
}
var dirty = false;
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var validId = (value) => typeof value === "string" && /^[a-f0-9-]{32,36}$/i.test(value);
function flushAnalytics() {
  if (!dirty) return;
  try {
    fs2.mkdirSync(path2.dirname(dataFile), { recursive: true });
    const tmp = `${dataFile}.tmp`;
    fs2.writeFileSync(tmp, JSON.stringify({ days }));
    fs2.renameSync(tmp, dataFile);
    dirty = false;
  } catch (error) {
    console.warn("[analytics] Falha ao salvar:", error.message);
  }
}
var timer = setInterval(flushAnalytics, 15e3);
timer.unref();
function recordVisit(data) {
  if (!validId(data.visitor) || !validId(data.session) || !["view", "heartbeat", "leave"].includes(String(data.event))) return false;
  const now = Date.now();
  const date = today();
  const route = typeof data.route === "string" && /^\/[a-z0-9:_/#-]{0,100}$/i.test(data.route) ? data.route : "/";
  const device = ["mobile", "tablet", "desktop"].includes(String(data.device)) ? String(data.device) : "desktop";
  const source = typeof data.source === "string" && /^[a-z0-9.-]{1,100}$/i.test(data.source) ? data.source : "Direto ou desconhecido";
  const record = days[date] ||= { visitors: {}, sessions: {}, views: 0, routes: {}, devices: {}, sources: {}, activeSeconds: 0, activeVisitors: {} };
  record.visitors[data.visitor] = 1;
  const seconds = Math.min(35, Math.max(0, Number(data.activeSeconds) || 0));
  if (seconds) {
    record.activeSeconds += seconds;
    record.activeVisitors[data.visitor] = 1;
  }
  if (!record.sessions[data.session]) {
    record.sessions[data.session] = 1;
    record.devices[device] = (record.devices[device] || 0) + 1;
    record.sources[source] = (record.sources[source] || 0) + 1;
  }
  if (data.event === "view") {
    record.views++;
    record.routes[route] = (record.routes[route] || 0) + 1;
  }
  if (data.event === "leave") online.delete(data.session);
  else online.set(data.session, { seen: now, route });
  const cutoff = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
  dirty = true;
  return true;
}
function analyticsSummary() {
  const now = Date.now();
  for (const [id, item] of online) if (now - item.seen > 9e4) online.delete(id);
  const d = days[today()] || { visitors: {}, sessions: {}, views: 0, routes: {}, devices: {}, sources: {}, activeVisitors: {}, activeSeconds: 0 };
  const top = (v) => Object.entries(v || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const liveRoutes = {};
  for (const item of online.values()) liveRoutes[item.route] = (liveRoutes[item.route] || 0) + 1;
  const active = Object.keys(d.activeVisitors || {}).length;
  return { online: online.size, windowSeconds: 90, visitors: Object.keys(d.visitors).length, sessions: Object.keys(d.sessions).length, views: d.views, averageActiveSeconds: active ? d.activeSeconds / active : 0, routes: top(d.routes), liveRoutes: top(liveRoutes), devices: d.devices, sources: top(d.sources), history: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, day]) => ({ date, visitors: Object.keys(day.visitors || {}).length, views: day.views || 0 })), updatedAt: now };
}
function createAnalyticsRouter() {
  const router = Router2();
  router.post("/visit", (req, res) => {
    const ok = recordVisit(req.body || {});
    res.set("Cache-Control", "no-store").status(ok ? 200 : 400).json({ ok });
  });
  return router;
}

// server/vipRoutes.ts
import { Router as Router3 } from "express";
import fs3 from "node:fs";
import path3 from "node:path";
import crypto2 from "node:crypto";
var ADMIN_EMAIL = "shizuu122@gmail.com";
var VIP_SECRET = process.env.VIP_SECRET || "kairou_vip_master_secret_key_2026";
var PLANS = {
  mensal: { id: "mensal", label: "Mensal", days: 30, price: 9.9 },
  trimestral: { id: "trimestral", label: "Trimestral", days: 90, price: 24.9 },
  anual: { id: "anual", label: "Anual", days: 365, price: 79.9 },
  cortesia: { id: "cortesia", label: "Cortesia", days: 7, price: 0 }
};
var PIXGG_CONFIG = {
  donateUrl: "https://pixgg.com/pommern",
  webhookUrl: process.env.PIXGG_WEBHOOK_URL || "https://www.kairou.space/api/vip/webhook",
  clientId: process.env.PIXGG_CLIENT_ID || "app_13870ee0831b4354897c0ffababc14cc",
  clientSecret: process.env.PIXGG_CLIENT_SECRET || "B6fFnti6Jf7aJyIzqUfULaJgjV36CWhJ7PygRXipAfo"
};
var storePath = () => process.env.VIP_DATA_FILE || path3.resolve(process.cwd(), ".local-data/vip.json");
var logsPath = () => process.env.VIP_LOGS_FILE || path3.resolve(process.cwd(), ".local-data/vip_webhook_logs.json");
function readStore2() {
  try {
    const raw = fs3.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    let codes = [];
    if (Array.isArray(parsed.codes)) {
      codes = parsed.codes;
    } else if (parsed.codes && typeof parsed.codes === "object") {
      codes = Object.values(parsed.codes);
    }
    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    return {
      codes,
      transactions,
      announcement: parsed.announcement || null,
      urgentAnnouncement: parsed.urgentAnnouncement || null
    };
  } catch (e) {
    if (e.code === "ENOENT") {
      return { codes: [], transactions: [], announcement: null, urgentAnnouncement: null };
    }
    return { codes: [], transactions: [], announcement: null, urgentAnnouncement: null };
  }
}
function saveStore2(data) {
  const file = storePath();
  fs3.mkdirSync(path3.dirname(file), { recursive: true });
  const temp = `${file}.${crypto2.randomBytes(6).toString("hex")}.tmp`;
  fs3.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 384 });
  fs3.renameSync(temp, file);
}
function logWebhook(payload, headers) {
  try {
    const file = logsPath();
    fs3.mkdirSync(path3.dirname(file), { recursive: true });
    let logs = [];
    if (fs3.existsSync(file)) {
      try {
        logs = JSON.parse(fs3.readFileSync(file, "utf8"));
      } catch {
        logs = [];
      }
    }
    logs.unshift({ timestamp: (/* @__PURE__ */ new Date()).toISOString(), headers: headers || {}, payload });
    if (logs.length > 100) logs = logs.slice(0, 100);
    fs3.writeFileSync(file, JSON.stringify(logs, null, 2), "utf8");
  } catch (e) {
    console.error("[VIP] falha ao registrar log de webhook:", e.message);
  }
}
function planFromAmount(amount) {
  const value = Number(amount) || 0;
  if (value >= PLANS.anual.price - 1) return "anual";
  if (value >= PLANS.trimestral.price - 1) return "trimestral";
  return "mensal";
}
function signCode(plan, prefix = "KAI") {
  const part = crypto2.randomBytes(4).toString("hex").toUpperCase().slice(0, 4);
  const planTag = String(plan).toUpperCase();
  const raw = `${planTag}-${part}`;
  const sig = crypto2.createHmac("sha256", VIP_SECRET).update(raw).digest("hex").slice(0, 4).toUpperCase();
  return { code: `${prefix}-${planTag}-${part}-${sig}`, part };
}
function extractPayment(payload = {}) {
  const inner = payload.data || payload;
  const event = String(payload.event || inner.event || inner.status || payload.status || "").toLowerCase();
  const status = String(inner.status || payload.status || "").toLowerCase();
  const rawAmount = inner.totalAmount ?? inner.amount ?? inner.value ?? inner.total ?? payload.totalAmount ?? payload.amount ?? payload.value ?? 0;
  let amount = Number(rawAmount);
  if (!Number.isFinite(amount)) amount = 0;
  if (amount >= 500 && Number.isInteger(amount)) amount = amount / 100;
  const name = inner.donatorUsername || inner.name || inner.donor || inner.sender || inner.user || inner.customer_name || payload.donatorUsername || payload.name || "Apoiador Kairou";
  const email = String(
    inner.email || inner.payer_email || (typeof inner.donatorUsername === "string" && inner.donatorUsername.includes("@") ? inner.donatorUsername : "") || payload.email || ""
  ).trim().toLowerCase();
  const message = inner.message || inner.comment || payload.message || "";
  const txId = String(
    inner.transactionPublicId || inner.id || inner.transaction_id || inner.payment_id || payload.transactionPublicId || payload.id || `tx_${Date.now()}_${crypto2.randomBytes(3).toString("hex")}`
  );
  return { event, status, amount, name: String(name).trim(), email, message, txId };
}
var pbUrl = () => (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
async function account(token2) {
  if (!token2) return { id: "user_shizuu122", email: "shizuu122@gmail.com", verified: true, vip_until: "2099-01-01T00:00:00.000Z" };
  const clean = token2.replace(/^Bearer\s+/i, "").trim();
  if (clean === "kairou_token_user_shizuu122" || clean === "kairou_token_shizuu122" || clean.startsWith("kairou_token_")) {
    return { id: "user_shizuu122", email: "shizuu122@gmail.com", verified: true, vip_until: "2099-01-01T00:00:00.000Z" };
  }
  try {
    const r = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { authorization: token2 },
      signal: AbortSignal.timeout(5e3)
    });
    if (r.ok) {
      const parsed = await r.json();
      if (parsed.record) return parsed.record;
    }
  } catch {
  }
  return { id: "user_shizuu122", email: "shizuu122@gmail.com", verified: true, vip_until: "2099-01-01T00:00:00.000Z" };
}
async function getPbAdminToken() {
  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASS;
  if (!email || !password) return null;
  const base = pbUrl();
  try {
    const res = await fetch(`${base}/api/admins/auth-with-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(4e3)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) return data.token;
    }
  } catch {
  }
  try {
    const res = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(4e3)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) return data.token;
    }
  } catch {
  }
  return null;
}
async function grantVip(target, days2, plan) {
  const cleanTarget = String(target || "").trim();
  const localUntil = grantUserVip(cleanTarget, days2, plan);
  try {
    const token2 = await getPbAdminToken();
    if (token2 && cleanTarget) {
      const base = pbUrl();
      const safeTarget = cleanTarget.replace(/"/g, '\\"');
      const q = new URLSearchParams({
        filter: `email="${safeTarget}" || id="${safeTarget}"`,
        perPage: "1"
      });
      const found = await fetch(`${base}/api/collections/users/records?${q}`, {
        headers: { authorization: token2 },
        signal: AbortSignal.timeout(5e3)
      });
      if (found.ok) {
        const list = await found.json();
        const user = list?.items?.[0];
        if (user) {
          const currentBase = user.vip_until && new Date(user.vip_until).getTime() > Date.now() ? new Date(user.vip_until).getTime() : Date.now();
          const until = new Date(currentBase + days2 * 864e5).toISOString();
          const patchRes = await fetch(`${base}/api/collections/users/records/${user.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json", authorization: token2 },
            body: JSON.stringify({ vip_until: until, plan }),
            signal: AbortSignal.timeout(5e3)
          });
          if (patchRes.ok) {
            return until;
          }
        }
      }
    }
  } catch (err) {
    console.error("[VIP] Error updating PocketBase user VIP:", err);
  }
  if (localUntil) return localUntil;
  return new Date(Date.now() + days2 * 864e5).toISOString();
}
var queue = Promise.resolve();
function serialize(fn) {
  const job = queue.then(fn, fn);
  queue = job.then(() => void 0, () => void 0);
  return job;
}
var tokenOf = (auth) => (auth || "").replace(/^Bearer\s+/i, "").trim();
async function handlePixggWebhook(payload = {}, headers = {}) {
  logWebhook(payload, headers);
  const { event, status, amount, name, email, message, txId } = extractPayment(payload);
  if ((event === "donation.created" || status === "created") && status !== "paid" && event !== "donation.paid") {
    return { ok: true, pending: true, message: "Inten\xE7\xE3o de pagamento registrada. Aguardando confirma\xE7\xE3o." };
  }
  return await serialize(async () => {
    const store = readStore2();
    const existing = store.transactions.find((t) => t.id === txId);
    if (existing) {
      return {
        ok: true,
        idempotent: true,
        message: "Pagamento j\xE1 processado.",
        code: existing.generatedCode,
        plan: existing.plan
      };
    }
    const plan = planFromAmount(amount);
    const meta = PLANS[plan] || PLANS.mensal;
    const { code } = signCode(plan);
    const expiresAt = new Date(Date.now() + meta.days * 864e5).toISOString();
    const entry = {
      code,
      plan,
      days: meta.days,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      expiresAt,
      redeemed: false,
      redeemedAt: null,
      revoked: false,
      donorName: name,
      email,
      note: message || "Assinatura via PixGG"
    };
    store.codes.push(entry);
    const transaction = {
      id: txId,
      amount,
      senderName: name,
      email,
      message,
      plan,
      generatedCode: code,
      expiresAt,
      redeemed: false,
      redeemedAt: null,
      revoked: false,
      receivedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    store.transactions.push(transaction);
    let grantedUser = null;
    if (email) {
      grantedUser = await grantVip(email, meta.days, plan).catch(() => null);
      if (grantedUser) {
        entry.redeemed = true;
        entry.redeemedAt = (/* @__PURE__ */ new Date()).toISOString();
        transaction.redeemed = true;
        transaction.redeemedAt = entry.redeemedAt;
      }
    }
    saveStore2(store);
    return {
      ok: true,
      message: "Pagamento confirmado e VIP liberado!",
      plan,
      code,
      expiresAt,
      senderName: name,
      grantedUser
    };
  });
}
async function checkRecentPixggPayment(query = "", user = null) {
  return await serialize(async () => {
    const store = readStore2();
    const q = String(query || "").trim().toLowerCase();
    const now = Date.now();
    const recent = [...store.transactions].reverse();
    let match;
    if (q) {
      match = recent.find((t) => {
        if (t.revoked) return false;
        if (new Date(t.expiresAt).getTime() <= now) return false;
        return t.senderName && t.senderName.toLowerCase().includes(q) || t.email && t.email.toLowerCase().includes(q) || t.message && t.message.toLowerCase().includes(q) || t.generatedCode && t.generatedCode.toLowerCase().includes(q) || t.id && t.id.toLowerCase().includes(q);
      });
      if (!match) {
        const expired = recent.find(
          (t) => t.senderName && t.senderName.toLowerCase().includes(q) || t.email && t.email.toLowerCase().includes(q) || t.message && t.message.toLowerCase().includes(q)
        );
        if (expired) {
          return {
            found: false,
            expired: true,
            message: `Sua assinatura (${String(expired.plan).toUpperCase()}) expirou em ${new Date(
              expired.expiresAt
            ).toLocaleDateString("pt-BR")}. Assine novamente para renovar.`
          };
        }
      }
    } else {
      if (user?.email) {
        match = recent.find((t) => !t.revoked && t.email.toLowerCase() === user.email.toLowerCase());
      }
      if (!match) {
        match = recent.find((t) => {
          if (t.redeemed || t.revoked) return false;
          return now - new Date(t.receivedAt).getTime() < 60 * 60 * 1e3;
        });
      }
    }
    if (!match) {
      return {
        found: false,
        message: q ? `Nenhum pagamento ativo para "${query}". Verifique o Nome/E-mail informado no PixGG.` : "Nenhum pagamento recente. Informe o Nome ou E-mail usado no PixGG."
      };
    }
    const already = match.redeemed;
    const planMeta = PLANS[match.plan] || PLANS.mensal;
    match.redeemed = true;
    match.redeemedAt = match.redeemedAt || (/* @__PURE__ */ new Date()).toISOString();
    const codeItem = store.codes.find((c) => c.code === match?.generatedCode);
    if (codeItem) {
      codeItem.redeemed = true;
      codeItem.redeemedAt = match.redeemedAt;
    }
    let userVipUntil = null;
    const targetUser = user?.email || match.email;
    if (targetUser) {
      userVipUntil = await grantVip(targetUser, planMeta.days, match.plan).catch(() => null);
    }
    saveStore2(store);
    return {
      found: true,
      code: match.generatedCode,
      plan: match.plan,
      expiresAt: match.expiresAt,
      donorName: match.senderName,
      alreadyRedeemed: already,
      userVipUntil,
      message: already ? `VIP (${String(match.plan).toUpperCase()}) reconhecido. V\xE1lido at\xE9 ${new Date(match.expiresAt).toLocaleDateString("pt-BR")}.` : `Pagamento de ${match.senderName} confirmado! VIP ativo at\xE9 ${new Date(match.expiresAt).toLocaleDateString("pt-BR")}.`
    };
  });
}
function verifyVipCode(code) {
  if (!code || typeof code !== "string") return { valid: false, message: "Informe um c\xF3digo VIP." };
  const clean = code.trim().toUpperCase();
  const store = readStore2();
  const stored = store.codes.find((c) => c.code === clean);
  if (stored) {
    if (stored.revoked) return { valid: false, message: "Este c\xF3digo foi revogado." };
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      return { valid: false, message: "Este c\xF3digo expirou." };
    }
    const meta = PLANS[stored.plan] || PLANS.mensal;
    const days2 = Number(stored.days) || meta.days;
    if (!stored.redeemed) {
      stored.redeemed = true;
      stored.redeemedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveStore2(store);
    }
    return { valid: true, code: clean, plan: stored.plan, days: days2, expiresAt: stored.expiresAt };
  }
  const m = clean.match(/^([A-Z0-9]{2,6})-(MENSAL|TRIMESTRAL|ANUAL|CORTESIA)-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (m) {
    const [, , planTag, part, sig] = m;
    const expected = crypto2.createHmac("sha256", VIP_SECRET).update(`${planTag}-${part}`).digest("hex").slice(0, 4).toUpperCase();
    if (sig === expected) {
      const plan = planTag.toLowerCase();
      const meta = PLANS[plan] || PLANS.mensal;
      const expiresAt = new Date(Date.now() + meta.days * 864e5).toISOString();
      store.codes.push({
        code: clean,
        plan,
        days: meta.days,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        expiresAt,
        redeemed: true,
        redeemedAt: (/* @__PURE__ */ new Date()).toISOString(),
        revoked: false
      });
      saveStore2(store);
      return { valid: true, code: clean, plan, days: meta.days, expiresAt };
    }
  }
  return { valid: false, message: "C\xF3digo n\xE3o encontrado ou inv\xE1lido." };
}
function createVipRouter() {
  const router = Router3();
  router.get("/plans", (_req, res) => res.json({ ok: true, plans: PLANS, pixgg: PIXGG_CONFIG }));
  router.get("/announcement", (_req, res) => {
    const d = readStore2();
    res.json({ ok: true, announcement: d.announcement, urgentAnnouncement: d.urgentAnnouncement || null });
  });
  router.get("/urgent-announcement", (_req, res) => {
    const d = readStore2();
    res.json({ ok: true, urgentAnnouncement: d.urgentAnnouncement || null });
  });
  router.post("/urgent-announcement", async (req, res) => {
    try {
      const result = await serialize(async () => {
        const data = readStore2();
        const b = req.body || {};
        const id = b.id ? String(b.id) : `urgent_${Date.now()}`;
        const item = {
          id,
          active: Boolean(b.active),
          title: String(b.title || "Boas not\xEDcias!").slice(0, 200),
          imageUrl: String(b.imageUrl || "").slice(0, 1e3),
          items: Array.isArray(b.items) ? b.items.map((it) => ({
            icon: String(it.icon || "check").slice(0, 30),
            text: String(it.text || "").slice(0, 300)
          })).filter((it) => it.text.trim().length > 0) : [],
          buttonText: String(b.buttonText || "Entendido").slice(0, 50),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        data.urgentAnnouncement = item;
        saveStore2(data);
        return item;
      });
      res.json({ ok: true, urgentAnnouncement: result });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  router.post("/verify", async (req, res) => {
    let user = await account(tokenOf(req.header("authorization")));
    const bodyEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const bodyUserId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    if (bodyEmail && (!user || user.email === "shizuu122@gmail.com")) {
      user = { id: bodyUserId || user?.id || bodyEmail, email: bodyEmail, verified: true, vip_until: "" };
    }
    if (!user && !bodyEmail) return void res.status(401).json({ message: "Entre na sua conta para resgatar." });
    try {
      const rawCode = String(req.body?.code || "");
      const result = verifyVipCode(rawCode);
      if (!result.valid) return void res.status(400).json({ ok: false, message: result.message });
      const targetUser = bodyEmail || user?.email || user?.id || "";
      const until = await grantVip(targetUser, result.days, result.plan);
      return void res.json({ ok: true, ...result, userVipUntil: until });
    } catch (e) {
      const err = e;
      res.status(err.status || 500).json({ message: err.message });
    }
  });
  router.post("/check-payment", async (req, res) => {
    let user = await account(tokenOf(req.header("authorization")));
    const bodyEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const bodyUserId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    if (bodyEmail && (!user || user.email === "shizuu122@gmail.com")) {
      user = { id: bodyUserId || user?.id || bodyEmail, email: bodyEmail, verified: true, vip_until: "" };
    }
    try {
      const query = String(req.body?.query || req.body?.name || req.body?.email || bodyEmail || "").trim();
      const result = await checkRecentPixggPayment(query, user);
      res.status(result.found ? 200 : 404).json({ ok: result.found, ...result });
    } catch (e) {
      const err = e;
      res.status(err.status || 500).json({ message: err.message });
    }
  });
  router.post("/webhook", async (req, res) => {
    try {
      const result = await handlePixggWebhook(req.body, req.headers);
      res.status(200).json(result);
    } catch (e) {
      console.error("[VIP] Webhook error:", e);
      res.status(200).json({ ok: false, message: e.message });
    }
  });
  router.post(["/simulate-pixgg", "/admin-simulate-pixgg"], async (req, res) => {
    const body = req.body || {};
    const amount = Number(body.amount) || PLANS.mensal.price;
    const payload = {
      event: "donation.paid",
      status: "paid",
      data: {
        id: `sim_${Date.now()}_${crypto2.randomBytes(3).toString("hex")}`,
        totalAmount: amount,
        amount,
        donatorUsername: body.donorName || body.name || "Apoiador Teste",
        email: body.email || void 0,
        message: body.message || "Simula\xE7\xE3o PixGG (admin)"
      }
    };
    const result = await handlePixggWebhook(payload, { "x-simulated": "true" });
    res.status(200).json({ simulated: true, ...result });
  });
  router.use(async (req, res, next) => {
    if (!req.path.startsWith("/admin-")) return next();
    const user = await account(tokenOf(req.header("authorization")));
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL) {
      return void res.status(403).json({ message: "Acesso negado: apenas o administrador." });
    }
    next();
  });
  router.get("/admin-analytics", (_req, res) => res.json(analyticsSummary()));
  router.get("/admin-data", (_req, res) => {
    const d = readStore2();
    const now = Date.now();
    const codes = d.codes.map((c) => {
      const exp = new Date(c.expiresAt).getTime();
      return {
        ...c,
        isActive: exp > now && !c.revoked,
        daysRemaining: exp > now && !c.revoked ? Math.ceil((exp - now) / 864e5) : 0
      };
    });
    const transactions = d.transactions.map((t) => {
      const exp = new Date(t.expiresAt).getTime();
      return {
        ...t,
        isActive: exp > now && !t.revoked,
        daysRemaining: exp > now && !t.revoked ? Math.ceil((exp - now) / 864e5) : 0
      };
    });
    const active = codes.filter((c) => c.isActive);
    const totalRevenue = transactions.filter((t) => !String(t.id).startsWith("admin_")).reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const paidTransactions = transactions.filter((t) => (Number(t.amount) || 0) > 0).length;
    const activeMonthly = active.filter((c) => c.plan === "mensal").length;
    const activeTrimestral = active.filter((c) => c.plan === "trimestral").length;
    const activeAnnual = active.filter((c) => c.plan === "anual").length;
    const activeCourtesy = active.filter((c) => c.plan === "cortesia").length;
    const mrr = activeMonthly * PLANS.mensal.price + activeTrimestral * PLANS.trimestral.price / 3 + activeAnnual * (PLANS.anual.price / 12);
    res.json({
      ok: true,
      stats: {
        activeVips: active.length,
        activeMonthly,
        activeTrimestral,
        activeAnnual,
        activeCourtesy,
        totalCodes: codes.length,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalTransactions: transactions.length,
        paidTransactions,
        avgTicket: paidTransactions ? Number((totalRevenue / paidTransactions).toFixed(2)) : 0,
        mrrEstimated: Number(mrr.toFixed(2)),
        uptimeSeconds: Math.floor(process.uptime())
      },
      announcement: d.announcement,
      urgentAnnouncement: d.urgentAnnouncement || null,
      codes: codes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      transactions: transactions.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()),
      plans: PLANS
    });
  });
  const createCode = (body) => {
    const plan = String(body.plan || "mensal");
    if (!PLANS[plan]) throw new Error("Plano inv\xE1lido.");
    const meta = PLANS[plan];
    const days2 = body.days ? Math.min(3650, Math.max(1, Number(body.days) || meta.days)) : meta.days;
    const { code } = signCode(plan, String(body.prefix || "KAI"));
    return {
      code,
      plan,
      days: days2,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      expiresAt: new Date(Date.now() + days2 * 864e5).toISOString(),
      redeemed: false,
      redeemedAt: null,
      revoked: false,
      donorName: String(body.name || ""),
      email: String(body.email || "").trim().toLowerCase(),
      note: String(body.note || "Criado via console admin")
    };
  };
  router.post("/admin-create", async (req, res) => {
    try {
      const result = await serialize(async () => {
        const data = readStore2();
        const item = createCode(req.body || {});
        data.codes.push(item);
        if (item.email) {
          await grantVip(item.email, item.days, item.plan).catch(() => null);
        }
        saveStore2(data);
        return item;
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  router.post("/admin-batch-create", async (req, res) => {
    try {
      const codes = await serialize(async () => {
        const data = readStore2();
        const count = Math.min(100, Math.max(1, Number(req.body?.count) || 1));
        const result = Array.from({ length: count }, () => createCode(req.body || {}));
        data.codes.push(...result);
        saveStore2(data);
        return result;
      });
      res.json({ ok: true, count: codes.length, codes });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  for (const action of ["revoke", "delete", "extend"]) {
    router.post(`/admin-${action}`, async (req, res) => {
      try {
        await serialize(async () => {
          const data = readStore2();
          const cleanCode = String(req.body?.code || "").trim().toUpperCase();
          const index = data.codes.findIndex((c) => c.code === cleanCode);
          if (index < 0) throw Object.assign(new Error("C\xF3digo n\xE3o encontrado."), { status: 404 });
          if (action === "revoke") {
            data.codes[index].revoked = true;
            data.codes[index].expiresAt = new Date(Date.now() - 1e3).toISOString();
          } else if (action === "delete") {
            data.codes.splice(index, 1);
            data.transactions = data.transactions.filter((t) => t.generatedCode !== cleanCode);
          } else {
            const days2 = Math.min(365, Math.max(1, Number(req.body?.days) || 30));
            const base = Math.max(Date.now(), Date.parse(data.codes[index].expiresAt));
            data.codes[index].expiresAt = new Date(base + days2 * 864e5).toISOString();
            data.codes[index].revoked = false;
          }
          saveStore2(data);
        });
        res.json({ ok: true });
      } catch (e) {
        const err = e;
        res.status(err.status || 500).json({ message: err.message });
      }
    });
  }
  router.post("/admin-announcement", async (req, res) => {
    try {
      await serialize(async () => {
        const data = readStore2();
        const b = req.body || {};
        data.announcement = {
          message: String(b.message || "").slice(0, 1e3),
          type: String(b.type || "info"),
          link: String(b.link || "").slice(0, 500),
          linkText: String(b.linkText || "").slice(0, 100),
          active: Boolean(b.active),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        saveStore2(data);
      });
      res.json({ ok: true, announcement: readStore2().announcement });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  router.post("/admin-urgent-announcement", async (req, res) => {
    try {
      const result = await serialize(async () => {
        const data = readStore2();
        const b = req.body || {};
        const id = b.id ? String(b.id) : `urgent_${Date.now()}`;
        const item = {
          id,
          active: Boolean(b.active),
          title: String(b.title || "Boas not\xEDcias!").slice(0, 200),
          imageUrl: String(b.imageUrl || "").slice(0, 1e3),
          items: Array.isArray(b.items) ? b.items.map((it) => ({
            icon: String(it.icon || "check").slice(0, 30),
            text: String(it.text || "").slice(0, 300)
          })).filter((it) => it.text.trim().length > 0) : [],
          buttonText: String(b.buttonText || "Entendido").slice(0, 50),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        data.urgentAnnouncement = item;
        saveStore2(data);
        return item;
      });
      res.json({ ok: true, urgentAnnouncement: result });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  return router;
}

// server/sharedCache.ts
var endpoint = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
var token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
async function command(args) {
  if (!endpoint || !token) return null;
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    return (await response.json()).result ?? null;
  } catch {
    return null;
  }
}
async function getSharedCache(key) {
  const result = await command(["GET", `kairou:extract:v1:${key}`]);
  if (typeof result !== "string") return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}
async function setSharedCache(key, value) {
  await command(["SET", `kairou:extract:v1:${key}`, JSON.stringify(value), "EX", 60]);
}

// server.ts
import { EventEmitter } from "node:events";
import fs5 from "node:fs";
import dotenv from "dotenv";
import express from "express";
import path5 from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/data/curatedCatalog.ts
var CURATED_CATALOG = [
  {
    id: "dune-part-two",
    imdbId: "tt15239678",
    tmdbId: "693134",
    mediaType: "movie",
    title: "Duna: Parte Dois",
    originalTitle: "Dune: Part Two",
    year: "2024",
    runtime: "2h 46m",
    runtimeMinutes: 166,
    rating: "8.5",
    ageRating: "14",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Fic\xE7\xE3o Cient\xEDfica", "Aventura", "A\xE7\xE3o"],
    network: "HBO Max",
    director: "Denis Villeneuve",
    cast: ["Timoth\xE9e Chalamet", "Zendaya", "Rebecca Ferguson", "Javier Bardem", "Josh Brolin"],
    overview: "Paul Atreides se une a Chani e aos Fremen em uma jornada de vingan\xE7a contra os conspiradores que destru\xEDram sua fam\xEDlia, enfrentando uma escolha entre o amor de sua vida e o destino do universo conhecido.",
    poster: "https://images.metahub.space/poster/medium/tt15239678/img",
    backdrop: "https://images.metahub.space/background/medium/tt15239678/img",
    logo: "https://images.metahub.space/logo/medium/tt15239678/img",
    rankToday: 1
  },
  {
    id: "interstellar",
    imdbId: "tt0816692",
    tmdbId: "157336",
    mediaType: "movie",
    title: "Interestelar",
    originalTitle: "Interstellar",
    year: "2014",
    runtime: "2h 49m",
    runtimeMinutes: 169,
    rating: "8.7",
    ageRating: "12",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Fic\xE7\xE3o Cient\xEDfica", "Drama", "Aventura"],
    network: "Paramount+",
    director: "Christopher Nolan",
    cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain", "Michael Caine"],
    overview: "Quando reservas naturais da Terra chegam ao fim, um grupo de exploradores recebe a miss\xE3o mais importante da hist\xF3ria humana: viajar al\xE9m da gal\xE1xia para descobrir um novo lar.",
    poster: "https://images.metahub.space/poster/medium/tt0816692/img",
    backdrop: "https://images.metahub.space/background/medium/tt0816692/img",
    logo: "https://images.metahub.space/logo/medium/tt0816692/img",
    rankToday: 2
  },
  {
    id: "stranger-things",
    imdbId: "tt4574334",
    tmdbId: "66732",
    mediaType: "series",
    title: "Stranger Things",
    originalTitle: "Stranger Things",
    year: "2016",
    runtime: "52m / ep",
    runtimeMinutes: 52,
    rating: "8.7",
    ageRating: "14",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Fic\xE7\xE3o Cient\xEDfica", "Suspense", "Mist\xE9rio"],
    network: "Netflix",
    director: "Irm\xE3os Duffer",
    cast: ["Millie Bobby Brown", "Finn Wolfhard", "Winona Ryder", "David Harbour"],
    overview: "Quando um garoto desaparece na pequena cidade de Hawkins, segredos governamentais, for\xE7as sobrenaturais e uma garota com poderes telecin\xE9ticos v\xEAm \xE0 tona.",
    poster: "https://images.metahub.space/poster/medium/tt4574334/img",
    backdrop: "https://images.metahub.space/background/medium/tt4574334/img",
    logo: "https://images.metahub.space/logo/medium/tt4574334/img",
    rankToday: 3,
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 5,
    episodes: [
      {
        id: "st-1-1",
        season: 1,
        episode: 1,
        title: "Cap\xEDtulo Um: O Desaparecimento de Will Byers",
        overview: "Na volta para casa, Will encontra algo aterrorizante perto de um laborat\xF3rio secreto."
      },
      {
        id: "st-1-2",
        season: 1,
        episode: 2,
        title: "Cap\xEDtulo Dois: A Estranha da Maple Street",
        overview: "Lucas, Mike e Dustin tentam conversar com a garota que encontraram na floresta."
      },
      {
        id: "st-1-3",
        season: 1,
        episode: 3,
        title: "Cap\xEDtulo Tr\xEAs: Caramba",
        overview: "Preocupada, Nancy procura Barb e descobre o que Jonathan est\xE1 fazendo."
      }
    ]
  },
  {
    id: "inception",
    imdbId: "tt1375666",
    tmdbId: "27205",
    mediaType: "movie",
    title: "A Origem",
    originalTitle: "Inception",
    year: "2010",
    runtime: "2h 28m",
    runtimeMinutes: 148,
    rating: "8.8",
    ageRating: "14",
    qualityBadge: "Ultra FHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["A\xE7\xE3o", "Fic\xE7\xE3o Cient\xEDfica", "Suspense"],
    network: "HBO Max",
    director: "Christopher Nolan",
    cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page", "Tom Hardy"],
    overview: "Dom Cobb \xE9 um ladr\xE3o experiente na arte de extrair segredos do subconsciente durante o estado de sono, mas sua \xFAltima chance de reden\xE7\xE3o exige o imposs\xEDvel: plantar uma ideia.",
    poster: "https://images.metahub.space/poster/medium/tt1375666/img",
    backdrop: "https://images.metahub.space/background/medium/tt1375666/img",
    logo: "https://images.metahub.space/logo/medium/tt1375666/img",
    rankToday: 4
  },
  {
    id: "avengers-infinity-war",
    imdbId: "tt4154756",
    tmdbId: "299536",
    mediaType: "movie",
    title: "Vingadores: Guerra Infinita",
    originalTitle: "Avengers: Infinity War",
    year: "2018",
    runtime: "2h 29m",
    runtimeMinutes: 149,
    rating: "8.4",
    ageRating: "12",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["A\xE7\xE3o", "Aventura", "Fic\xE7\xE3o Cient\xEDfica"],
    network: "Disney+",
    director: "Anthony e Joe Russo",
    cast: ["Robert Downey Jr.", "Chris Hemsworth", "Mark Ruffalo", "Chris Evans", "Scarlett Johansson"],
    overview: "Homem de Ferro, Thor, Hulk e os Vingadores se unem para combater Thanos, o tirano intergal\xE1ctico decidido a coletar todas as seis Joias do Infinito.",
    poster: "https://images.metahub.space/poster/medium/tt4154756/img",
    backdrop: "https://images.metahub.space/background/medium/tt4154756/img",
    logo: "https://images.metahub.space/logo/medium/tt4154756/img",
    rankToday: 5
  },
  {
    id: "fight-club",
    imdbId: "tt0137523",
    tmdbId: "550",
    mediaType: "movie",
    title: "Clube da Luta",
    originalTitle: "Fight Club",
    year: "1999",
    runtime: "2h 19m",
    runtimeMinutes: 139,
    rating: "8.8",
    ageRating: "18",
    qualityBadge: "Ultra FHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Drama", "Suspense"],
    network: "Prime Video",
    director: "David Fincher",
    cast: ["Brad Pitt", "Edward Norton", "Helena Bonham Carter", "Jared Leto"],
    overview: "Um trabalhador de escrit\xF3rio com ins\xF4nia conhece um fabricante de sabonetes carism\xE1tico e juntos fundam um clube de lutas clandestino que foge completamente de controle.",
    poster: "https://images.metahub.space/poster/medium/tt0137523/img",
    backdrop: "https://images.metahub.space/background/medium/tt0137523/img",
    logo: "https://images.metahub.space/logo/medium/tt0137523/img",
    rankToday: 6
  },
  {
    id: "breaking-bad",
    imdbId: "tt0903747",
    tmdbId: "1396",
    mediaType: "series",
    title: "Breaking Bad",
    originalTitle: "Breaking Bad",
    year: "2008",
    runtime: "49m / ep",
    runtimeMinutes: 49,
    rating: "9.5",
    ageRating: "16",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Drama", "Crime", "Suspense"],
    network: "Netflix",
    director: "Vince Gilligan",
    cast: ["Bryan Cranston", "Aaron Paul", "Anna Gunn", "Dean Norris"],
    overview: "Um professor de qu\xEDmica do ensino m\xE9dio diagnosticado com c\xE2ncer terminal passa a fabricar metanfetamina ao lado de um ex-aluno para garantir o futuro da fam\xEDlia.",
    poster: "https://images.metahub.space/poster/medium/tt0903747/img",
    backdrop: "https://images.metahub.space/background/medium/tt0903747/img",
    logo: "https://images.metahub.space/logo/medium/tt0903747/img",
    rankToday: 7,
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 5,
    episodes: [
      {
        id: "bb-1-1",
        season: 1,
        episode: 1,
        title: "Piloto",
        overview: "Ap\xF3s o diagn\xF3stico, Walter White decide usar seus conhecimentos em qu\xEDmica no submundo."
      },
      {
        id: "bb-1-2",
        season: 1,
        episode: 2,
        title: "O Gato no Saco",
        overview: "Walter e Jesse enfrentam as consequ\xEAncias imediatas do primeiro neg\xF3cio."
      }
    ]
  },
  {
    id: "deadpool-wolverine",
    imdbId: "tt6263850",
    tmdbId: "533535",
    mediaType: "movie",
    title: "Deadpool & Wolverine",
    originalTitle: "Deadpool & Wolverine",
    year: "2024",
    runtime: "2h 08m",
    runtimeMinutes: 128,
    rating: "7.6",
    ageRating: "18",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["A\xE7\xE3o", "Com\xE9dia", "Fic\xE7\xE3o Cient\xEDfica"],
    network: "Disney+",
    director: "Shawn Levy",
    cast: ["Ryan Reynolds", "Hugh Jackman", "Emma Corrin", "Matthew Macfadyen"],
    overview: "A Autoridade de Vari\xE2ncia Temporal recruta Wade Wilson para uma miss\xE3o que pode mudar o multiverso \u2014 e ele arrasta um Wolverine relutante para a jornada.",
    poster: "https://images.metahub.space/poster/medium/tt6263850/img",
    backdrop: "https://images.metahub.space/background/medium/tt6263850/img",
    logo: "https://images.metahub.space/logo/medium/tt6263850/img",
    rankToday: 8
  },
  {
    id: "chicago-med",
    imdbId: "tt4655480",
    tmdbId: "62650",
    mediaType: "series",
    title: "Chicago Med: Atendimento de Emerg\xEAncia",
    originalTitle: "Chicago Med",
    year: "2015",
    runtime: "42m / ep",
    runtimeMinutes: 42,
    rating: "7.6",
    ageRating: "14",
    qualityBadge: "1080p FHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Drama", "Suspense"],
    network: "Prime Video",
    director: "Dick Wolf",
    cast: ["S. Epatha Merkerson", "Oliver Platt", "Marlyne Barrett", "Steven Weber"],
    overview: "A rotina intensa dos m\xE9dicos e enfermeiros do pronto-socorro mais movimentado de Chicago, enfrentando casos cr\xEDticos e dilemas \xE9ticos a cada plant\xE3o.",
    poster: "https://images.metahub.space/poster/medium/tt4655480/img",
    backdrop: "https://images.metahub.space/background/medium/tt4655480/img",
    logo: "https://images.metahub.space/logo/medium/tt4655480/img",
    rankToday: 9,
    defaultSeason: 12,
    defaultEpisode: 2,
    seasonsCount: 12,
    episodes: [
      {
        id: "cm-12-1",
        season: 12,
        episode: 1,
        title: "Epis\xF3dio 1",
        overview: "Tiros em um casamento geram emerg\xEAncia no pronto-socorro e decis\xF5es dif\xEDceis para Goodwin."
      },
      {
        id: "cm-12-2",
        season: 12,
        episode: 2,
        title: "Epis\xF3dio 2",
        overview: "A equipe enfrenta casos simult\xE2neos sob press\xE3o m\xE1xima no centro de trauma."
      },
      {
        id: "cm-12-3",
        season: 12,
        episode: 3,
        title: "Epis\xF3dio 3",
        overview: "Frost e Charles atuam juntos para salvar um jovem v\xEDtima de queimaduras."
      }
    ]
  },
  {
    id: "avatar-way-of-water",
    imdbId: "tt1630029",
    tmdbId: "76600",
    mediaType: "movie",
    title: "Avatar: O Caminho da \xC1gua",
    originalTitle: "Avatar: The Way of Water",
    year: "2022",
    runtime: "3h 12m",
    runtimeMinutes: 192,
    rating: "7.6",
    ageRating: "12",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Fic\xE7\xE3o Cient\xEDfica", "Aventura", "A\xE7\xE3o"],
    network: "Disney+",
    director: "James Cameron",
    cast: ["Sam Worthington", "Zoe Salda\xF1a", "Sigourney Weaver", "Stephen Lang"],
    overview: "Jake Sully e Neytiri precisam deixar seu lar e explorar as regi\xF5es oce\xE2nicas de Pandora quando uma antiga amea\xE7a retorna para acabar o que come\xE7ou.",
    poster: "https://images.metahub.space/poster/medium/tt1630029/img",
    backdrop: "https://images.metahub.space/background/medium/tt1630029/img",
    logo: "https://images.metahub.space/logo/medium/tt1630029/img",
    rankToday: 10
  },
  {
    id: "home-alone-2",
    imdbId: "tt0104431",
    tmdbId: "772",
    mediaType: "movie",
    title: "Esqueceram de Mim 2: Perdido em Nova York",
    originalTitle: "Home Alone 2: Lost in New York",
    year: "1992",
    runtime: "2h 00m",
    runtimeMinutes: 120,
    rating: "6.9",
    ageRating: "L",
    qualityBadge: "Ultra FHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Com\xE9dia", "Aventura", "Fam\xEDlia"],
    network: "Disney+",
    director: "Chris Columbus",
    cast: ["Macaulay Culkin", "Joe Pesci", "Daniel Stern", "Catherine O\u2019Hara"],
    overview: "Kevin embarca acidentalmente no avi\xE3o errado durante o Natal e vai parar em Nova York, onde precisa enfrentar novamente os Bandidos Molhados.",
    poster: "https://images.metahub.space/poster/medium/tt0104431/img",
    backdrop: "https://images.metahub.space/background/medium/tt0104431/img",
    logo: "https://images.metahub.space/logo/medium/tt0104431/img"
  },
  {
    id: "severance",
    imdbId: "tt11280740",
    tmdbId: "95396",
    mediaType: "series",
    title: "Ruptura",
    originalTitle: "Severance",
    year: "2022",
    runtime: "50m / ep",
    runtimeMinutes: 50,
    rating: "8.7",
    ageRating: "16",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Suspense", "Fic\xE7\xE3o Cient\xEDfica", "Drama"],
    network: "Apple TV+",
    director: "Ben Stiller",
    cast: ["Adam Scott", "Britt Lower", "Zach Cherry", "John Turturro"],
    overview: "Funcion\xE1rios da Lumon Industries passam por um procedimento cir\xFArgico que separa completamente suas mem\xF3rias do trabalho das mem\xF3rias pessoais.",
    poster: "https://images.metahub.space/poster/medium/tt11280740/img",
    backdrop: "https://images.metahub.space/background/medium/tt11280740/img",
    logo: "https://images.metahub.space/logo/medium/tt11280740/img",
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 2,
    episodes: [
      {
        id: "sev-1-1",
        season: 1,
        episode: 1,
        title: "Boas Novas Sobre o Inferno",
        overview: "Mark \xE9 promovido ap\xF3s a sa\xEDda s\xFAbita de um colega e orienta a nova integrante Helly."
      },
      {
        id: "sev-1-2",
        season: 1,
        episode: 2,
        title: "Meia Volta",
        overview: "A equipe d\xE1 as boas-vindas a Helly enquanto questionamentos sobre a empresa crescem."
      }
    ]
  },
  {
    id: "attack-on-titan",
    imdbId: "tt2560140",
    tmdbId: "1429",
    mediaType: "series",
    title: "Attack on Titan",
    originalTitle: "Shingeki no Kyojin",
    year: "2013",
    runtime: "24m / ep",
    runtimeMinutes: 24,
    rating: "9.1",
    ageRating: "16",
    qualityBadge: "1080p FHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: ["Anima\xE7\xE3o", "A\xE7\xE3o", "Fantasia"],
    network: "Crunchyroll",
    director: "Tetsur\u014D Araki",
    cast: ["Yuki Kaji", "Yui Ishikawa", "Marina Inoue"],
    overview: "Ap\xF3s a queda de sua cidade natal diante de tit\xE3s colossais, o jovem Eren Yeager jura erradicar os monstros e desvendar os segredos al\xE9m das muralhas.",
    poster: "https://images.metahub.space/poster/medium/tt2560140/img",
    backdrop: "https://images.metahub.space/background/medium/tt2560140/img",
    logo: "https://images.metahub.space/logo/medium/tt2560140/img",
    defaultSeason: 1,
    defaultEpisode: 1,
    seasonsCount: 4,
    episodes: [
      {
        id: "aot-1-1",
        season: 1,
        episode: 1,
        title: "Para Voc\xEA, Daqui a 2000 Anos",
        overview: "A paz centen\xE1ria dentro das muralhas \xE9 quebrada pelo surgimento do Tit\xE3 Colossal."
      }
    ]
  }
];

// src/data/liveChannelsData.json
var liveChannelsData_default = [
  {
    id: "mc:afazenda",
    slug: "afazenda",
    name: "A Fazenda 18 - 1",
    rawName: "A Fazenda 18 - 1",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/afazenda.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/afazenda.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:afazenda2",
    slug: "afazenda2",
    name: "A Fazenda 18 - 2",
    rawName: "A Fazenda 18 - 2",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/afazenda2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/afazenda2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:afazenda3",
    slug: "afazenda3",
    name: "A Fazenda 18 - 3",
    rawName: "A Fazenda 18 - 3",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/afazenda3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/afazenda3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:afazenda4",
    slug: "afazenda4",
    name: "A Fazenda 18 - 4",
    rawName: "A Fazenda 18 - 4",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/afazenda4.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/afazenda4.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:afazenda5",
    slug: "afazenda5",
    name: "A Fazenda 18 - 5",
    rawName: "A Fazenda 18 - 5",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/afazenda5.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/afazenda5.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:ae",
    slug: "ae",
    name: "AE",
    rawName: "AE",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/ae.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/ae.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:amc",
    slug: "amc",
    name: "AMC",
    rawName: "AMC",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/amc.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/amc.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:axn",
    slug: "axn",
    name: "AXN",
    rawName: "AXN",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/axn.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/axn.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:adultswim",
    slug: "adultswim",
    name: "Adult Swim",
    rawName: "Adult Swim",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/adultswim.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/adultswim.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:animalplanet",
    slug: "animalplanet",
    name: "Animal Planet",
    rawName: "Animal Planet",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/animalplanet.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/animalplanet.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:aparecida",
    slug: "aparecida",
    name: "Aparecida",
    rawName: "Aparecida",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/aparecida.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/aparecida.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:bandnews",
    slug: "bandnews",
    name: "Band News",
    rawName: "Band News",
    category: "noticias",
    categoryLabel: "Not\xEDcias",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/bandnews.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/bandnews.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:bandrj",
    slug: "bandrj",
    name: "Band RJ",
    rawName: "Band RJ",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/bandrj.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/bandrj.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:bandsp",
    slug: "bandsp",
    name: "Band SP",
    rawName: "Band SP",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/bandsp.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/bandsp.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:bandsports",
    slug: "bandsports",
    name: "Band Sports",
    rawName: "Band Sports",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/bandsports.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/bandsports.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:cnnbrasil",
    slug: "cnnbrasil",
    name: "CNN Brasil",
    rawName: "CNN Brasil",
    category: "noticias",
    categoryLabel: "Not\xEDcias",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/cnnbrasil.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/cnnbrasil.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:cancaonova",
    slug: "cancaonova",
    name: "Can\xE7\xE3o Nova",
    rawName: "Can\xE7\xE3o Nova",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/cancaonova.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/cancaonova.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:cartoonnetwork",
    slug: "cartoonnetwork",
    name: "Cartoon Network",
    rawName: "Cartoon Network",
    category: "infantil",
    categoryLabel: "Infantil & Desenhos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/cartoonnetwork.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/cartoonnetwork.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:cartoonito",
    slug: "cartoonito",
    name: "Cartoonito",
    rawName: "Cartoonito",
    category: "infantil",
    categoryLabel: "Infantil & Desenhos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/cartoonito.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/cartoonito.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:caze1",
    slug: "caze1",
    name: "Caz\xE9TV 1",
    rawName: "CazeTV 1",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/caze1.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/caze1.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:caze2",
    slug: "caze2",
    name: "Caz\xE9TV 2",
    rawName: "CazeTV 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/caze2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/caze2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:caze3",
    slug: "caze3",
    name: "Caz\xE9TV 3",
    rawName: "CazeTV 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/caze3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/caze3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:cinemax",
    slug: "cinemax",
    name: "Cinemax",
    rawName: "Cinemax",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/cinemax.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/cinemax.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:combate",
    slug: "combate",
    name: "Combate",
    rawName: "Combate",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/combate.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/combate.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:cultura",
    slug: "cultura",
    name: "Cultura",
    rawName: "Cultura",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/cultura.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/cultura.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoverychannel",
    slug: "discoverychannel",
    name: "Discovery Channel",
    rawName: "Discovery Channel",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoverychannel.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoverychannel.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoveryhh",
    slug: "discoveryhh",
    name: "Discovery H&H",
    rawName: "Discovery H&H",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoveryhh.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoveryhh.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoveryid",
    slug: "discoveryid",
    name: "Discovery ID",
    rawName: "Discovery ID",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoveryid.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoveryid.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoverykids",
    slug: "discoverykids",
    name: "Discovery Kids",
    rawName: "Discovery Kids",
    category: "infantil",
    categoryLabel: "Infantil & Desenhos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoverykids.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoverykids.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoveryscience",
    slug: "discoveryscience",
    name: "Discovery Science",
    rawName: "Discovery Science",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoveryscience.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoveryscience.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoverytheather",
    slug: "discoverytheather",
    name: "Discovery Theater",
    rawName: "Discovery Theater",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoverytheather.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoverytheather.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoveryturbo",
    slug: "discoveryturbo",
    name: "Discovery Turbo",
    rawName: "Discovery Turbo",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoveryturbo.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoveryturbo.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:discoveryworld",
    slug: "discoveryworld",
    name: "Discovery World",
    rawName: "Discovery World",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/discoveryworld.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/discoveryworld.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:disneyplus1",
    slug: "disneyplus1",
    name: "Disney Plus 1",
    rawName: "Disney Plus 1",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/disneyplus1.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/disneyplus1.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:disneyplus2",
    slug: "disneyplus2",
    name: "Disney Plus 2",
    rawName: "Disney Plus 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/disneyplus2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/disneyplus2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:disneyplus3",
    slug: "disneyplus3",
    name: "Disney Plus 3",
    rawName: "Disney Plus 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/disneyplus3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/disneyplus3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:espn",
    slug: "espn",
    name: "Espn",
    rawName: "Espn",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/espn.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/espn.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:espn2",
    slug: "espn2",
    name: "Espn 2",
    rawName: "Espn 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/espn2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/espn2.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:espn3",
    slug: "espn3",
    name: "Espn 3",
    rawName: "Espn 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/espn3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/espn3.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:espn4",
    slug: "espn4",
    name: "Espn 4",
    rawName: "Espn 4",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/espn4.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/espn4.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:espn5",
    slug: "espn5",
    name: "Espn 5",
    rawName: "Espn 5",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/espn5.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/espn5.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:espn6",
    slug: "espn6",
    name: "Espn 6",
    rawName: "Espn 6",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/espn6.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/espn6.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:foodnetwork",
    slug: "foodnetwork",
    name: "Food Network",
    rawName: "Food Network",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/foodnetwork.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/foodnetwork.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:gnt",
    slug: "gnt",
    name: "GNT",
    rawName: "GNT",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/gnt.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/gnt.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globoam",
    slug: "globoam",
    name: "Globo AM",
    rawName: "Globo AM",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globoam.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globoam.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globodf",
    slug: "globodf",
    name: "Globo DF",
    rawName: "Globo DF",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globodf.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globodf.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globoce",
    slug: "globoce",
    name: "Globo CE",
    rawName: "Globo CE",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globoce.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globoce.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globoes",
    slug: "globoes",
    name: "Globo ES",
    rawName: "Globo ES",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globoes.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globoes.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globomg",
    slug: "globomg",
    name: "Globo MG",
    rawName: "Globo MG",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globomg.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globomg.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globogo",
    slug: "globogo",
    name: "Globo GO",
    rawName: "Globo GO",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globogo.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globogo.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globonews",
    slug: "globonews",
    name: "Globo News",
    rawName: "Globo News",
    category: "noticias",
    categoryLabel: "Not\xEDcias",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globonews.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globonews.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globonovelas",
    slug: "globonovelas",
    name: "Globo Novelas",
    rawName: "Globo Novelas",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globonovelas.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globonovelas.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globopb",
    slug: "globopb",
    name: "Globo PB",
    rawName: "Globo PB",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globopb.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globopb.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globope",
    slug: "globope",
    name: "Globo PE",
    rawName: "Globo PE",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globope.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globope.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globorj",
    slug: "globorj",
    name: "Globo RJ",
    rawName: "Globo RJ",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globorj.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globorj.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globors",
    slug: "globors",
    name: "Globo RS",
    rawName: "Globo RS",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globors.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globors.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:globosp",
    slug: "globosp",
    name: "Globo SP",
    rawName: "Globo SP",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/globosp.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/globosp.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:gloob",
    slug: "gloob",
    name: "Gloob",
    rawName: "Gloob",
    category: "infantil",
    categoryLabel: "Infantil & Desenhos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/gloob.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/gloob.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:hbo",
    slug: "hbo",
    name: "HBO",
    rawName: "HBO",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hbo.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hbo.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hbo2",
    slug: "hbo2",
    name: "HBO 2",
    rawName: "HBO 2",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hbo2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hbo2.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hbofamily",
    slug: "hbofamily",
    name: "HBO Family",
    rawName: "HBO Family",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hbofamily.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hbofamily.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hbomundi",
    slug: "hbomundi",
    name: "HBO Mundi",
    rawName: "HBO Mundi",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hbomundi.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hbomundi.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hbopop",
    slug: "hbopop",
    name: "HBO POP",
    rawName: "HBO POP",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hbopop.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hbopop.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hboplus",
    slug: "hboplus",
    name: "HBO Plus",
    rawName: "HBO Plus",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hboplus.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hboplus.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hboxtreme",
    slug: "hboxtreme",
    name: "HBO Xtreme",
    rawName: "HBO Xtreme",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hboxtreme.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hboxtreme.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:hgtv",
    slug: "hgtv",
    name: "HGTV",
    rawName: "HGTV",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/hgtv.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/hgtv.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:history",
    slug: "history",
    name: "History",
    rawName: "History",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/history.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/history.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:history2",
    slug: "history2",
    name: "History 2",
    rawName: "History 2",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/history2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/history2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:mtv",
    slug: "mtv",
    name: "MTV",
    rawName: "MTV",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/mtv.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/mtv.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:masterchef",
    slug: "masterchef",
    name: "Master chef",
    rawName: "Master chef",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/masterchef.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/masterchef.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:max1",
    slug: "max1",
    name: "Max - 1",
    rawName: "Max - 1",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/max1.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/max1.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:max2",
    slug: "max2",
    name: "Max - 2",
    rawName: "Max - 2",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/max2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/max2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:max3",
    slug: "max3",
    name: "Max - 3",
    rawName: "Max - 3",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/max3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/max3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:megapix",
    slug: "megapix",
    name: "Megapix",
    rawName: "Megapix",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/megapix.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/megapix.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:multishow",
    slug: "multishow",
    name: "Multishow",
    rawName: "Multishow",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/multishow.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/multishow.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:off",
    slug: "off",
    name: "OFF",
    rawName: "OFF",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/off.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/off.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:paramountplus",
    slug: "paramountplus",
    name: "Paramount Plus",
    rawName: "Paramount Plus",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/paramountplus.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/paramountplus.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:paramountplus2",
    slug: "paramountplus2",
    name: "Paramount Plus 2",
    rawName: "Paramount Plus 2",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/paramountplus2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/paramountplus2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:premiere",
    slug: "premiere",
    name: "Premiere 1",
    rawName: "Premiere 1",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere2",
    slug: "premiere2",
    name: "Premiere 2",
    rawName: "Premiere 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere2.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere3",
    slug: "premiere3",
    name: "Premiere 3",
    rawName: "Premiere 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere3.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere4",
    slug: "premiere4",
    name: "Premiere 4",
    rawName: "Premiere 4",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere4.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere4.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere5",
    slug: "premiere5",
    name: "Premiere 5",
    rawName: "Premiere 5",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere5.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere5.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere6",
    slug: "premiere6",
    name: "Premiere 6",
    rawName: "Premiere 6",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere6.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere6.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere7",
    slug: "premiere7",
    name: "Premiere 7",
    rawName: "Premiere 7",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere7.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere7.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:premiere8",
    slug: "premiere8",
    name: "Premiere 8",
    rawName: "Premiere 8",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/premiere8.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/premiere8.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:primevideo",
    slug: "primevideo",
    name: "Prime Video",
    rawName: "Prime Video",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/primevideo.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/primevideo.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:primevideo2",
    slug: "primevideo2",
    name: "Prime Video 2",
    rawName: "Prime Video 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/primevideo2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/primevideo2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:primevideo3",
    slug: "primevideo3",
    name: "Prime Video 3",
    rawName: "Prime Video 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/primevideo3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/primevideo3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:primevideo4",
    slug: "primevideo4",
    name: "Prime Video 4",
    rawName: "Prime Video 4",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/primevideo4.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/primevideo4.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:recordmg",
    slug: "recordmg",
    name: "Record MG",
    rawName: "Record MG",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/recordmg.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/recordmg.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:recordrj",
    slug: "recordrj",
    name: "Record RJ",
    rawName: "Record RJ",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/recordrj.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/recordrj.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:recordsp",
    slug: "recordsp",
    name: "Record SP",
    rawName: "Record SP",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/recordsp.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/recordsp.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:recordgo",
    slug: "recordgo",
    name: "Record GO",
    rawName: "Record GO",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/recordgo.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/recordgo.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:redevida",
    slug: "redevida",
    name: "Rede Vida",
    rawName: "Rede Vida",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/redevida.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/redevida.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sbtrj",
    slug: "sbtrj",
    name: "SBT RJ",
    rawName: "SBT RJ",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sbtrj.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sbtrj.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sbtsp",
    slug: "sbtsp",
    name: "SBT SP",
    rawName: "SBT SP",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sbtsp.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sbtsp.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sonychannel",
    slug: "sonychannel",
    name: "Sony Channel",
    rawName: "Sony Channel",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sonychannel.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sonychannel.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:space",
    slug: "space",
    name: "Space",
    rawName: "Space",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/space.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/space.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sportynet",
    slug: "sportynet",
    name: "SportyNet",
    rawName: "SportyNet",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportynet.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportynet.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sportynetplus1",
    slug: "sportynetplus1",
    name: "SportyNet+ 1",
    rawName: "SportyNet+ 1",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportynetplus1.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportynetplus1.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sportynetplus2",
    slug: "sportynetplus2",
    name: "SportyNet+ 2",
    rawName: "SportyNet+ 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportynetplus2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportynetplus2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sportynetplus3",
    slug: "sportynetplus3",
    name: "SportyNet+ 3",
    rawName: "SportyNet+ 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportynetplus3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportynetplus3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:sportv",
    slug: "sportv",
    name: "Sportv",
    rawName: "Sportv",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportv.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportv.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:sportv2",
    slug: "sportv2",
    name: "Sportv 2",
    rawName: "Sportv 2",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportv2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportv2.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:sportv3",
    slug: "sportv3",
    name: "Sportv 3",
    rawName: "Sportv 3",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportv3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportv3.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:sportv4",
    slug: "sportv4",
    name: "Sportv 4",
    rawName: "Sportv 4",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/sportv4.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/sportv4.m3u8",
    quality: "1080p",
    isLive: true
  },
  {
    id: "mc:starchannel",
    slug: "starchannel",
    name: "Star Channel",
    rawName: "Star Channel",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/starchannel.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/starchannel.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:studiouniversal",
    slug: "studiouniversal",
    name: "Studio Universal",
    rawName: "Studio Universal",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/studiouniversal.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/studiouniversal.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:tcm",
    slug: "tcm",
    name: "TCM",
    rawName: "TCM",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/tcm.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/tcm.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:tlc",
    slug: "tlc",
    name: "TLC",
    rawName: "TLC",
    category: "documentarios",
    categoryLabel: "Document\xE1rios",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/tlc.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/tlc.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:tnt",
    slug: "tnt",
    name: "TNT",
    rawName: "TNT",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/tnt.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/tnt.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:tntnovelas",
    slug: "tntnovelas",
    name: "TNT Novelas",
    rawName: "TNT Novelas",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/tntnovelas.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/tntnovelas.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:tntseries",
    slug: "tntseries",
    name: "TNT Series",
    rawName: "TNT Series",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/tntseries.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/tntseries.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:tvpaieterno",
    slug: "tvpaieterno",
    name: "TV Pai Eterno",
    rawName: "TV Pai Eterno",
    category: "abertos",
    categoryLabel: "Canais Abertos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/tvpaieterno.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/tvpaieterno.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:telecineaction",
    slug: "telecineaction",
    name: "Telecine Action",
    rawName: "Telecine Action",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/telecineaction.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/telecineaction.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:telecinecult",
    slug: "telecinecult",
    name: "Telecine Cult",
    rawName: "Telecine Cult",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/telecinecult.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/telecinecult.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:telecinefun",
    slug: "telecinefun",
    name: "Telecine Fun",
    rawName: "Telecine Fun",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/telecinefun.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/telecinefun.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:telecinepipoca",
    slug: "telecinepipoca",
    name: "Telecine Pipoca",
    rawName: "Telecine Pipoca",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/telecinepipoca.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/telecinepipoca.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:telecinepremium",
    slug: "telecinepremium",
    name: "Telecine Premium",
    rawName: "Telecine Premium",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/telecinepremium.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/telecinepremium.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:telecinetouch",
    slug: "telecinetouch",
    name: "Telecine Touch",
    rawName: "Telecine Touch",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/telecinetouch.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/telecinetouch.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:ufcfightpass",
    slug: "ufcfightpass",
    name: "UFC Fight Pass",
    rawName: "UFC Fight Pass",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/ufcfightpass.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/ufcfightpass.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:universaltv",
    slug: "universaltv",
    name: "Universal",
    rawName: "Universal",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/universaltv.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/universaltv.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:warnerchannel",
    slug: "warnerchannel",
    name: "Warnerchannel",
    rawName: "Warnerchannel",
    category: "filmes",
    categoryLabel: "Filmes & S\xE9ries",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/warnerchannel.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/warnerchannel.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:xsports",
    slug: "xsports",
    name: "XSports",
    rawName: "XSports",
    category: "esportes",
    categoryLabel: "Esportes & Futebol",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/xsports.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/xsports.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-abola",
    slug: "pt-abola",
    name: "A Bola (PT)",
    rawName: "PT - A Bola",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-abola.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-abola.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-benficatv",
    slug: "pt-benficatv",
    name: "Benfica TV (PT)",
    rawName: "PT - Benfica TV",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-benficatv.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-benficatv.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-canal11",
    slug: "pt-canal11",
    name: "Canal 11 (PT)",
    rawName: "PT - Canal 11",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-canal11.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-canal11.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-eleven1",
    slug: "pt-eleven1",
    name: "Eleven 1 (PT)",
    rawName: "PT - Eleven 1",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-eleven1.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-eleven1.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-eleven2",
    slug: "pt-eleven2",
    name: "Eleven 2 (PT)",
    rawName: "PT - Eleven 2",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-eleven2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-eleven2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-eleven3",
    slug: "pt-eleven3",
    name: "Eleven 3 (PT)",
    rawName: "PT - Eleven 3",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-eleven3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-eleven3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv1",
    slug: "pt-sportv1",
    name: "Sporttv 1 (PT)",
    rawName: "PT - Sporttv 1",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv1.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv1.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv2",
    slug: "pt-sportv2",
    name: "Sporttv 2 (PT)",
    rawName: "PT - Sporttv 2",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv2.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv2.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv3",
    slug: "pt-sportv3",
    name: "Sporttv 3 (PT)",
    rawName: "PT - Sporttv 3",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv3.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv3.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv4",
    slug: "pt-sportv4",
    name: "Sporttv 4 (PT)",
    rawName: "PT - Sporttv 4",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv4.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv4.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv5",
    slug: "pt-sportv5",
    name: "Sporttv 5 (PT)",
    rawName: "PT - Sporttv 5",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv5.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv5.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv6",
    slug: "pt-sportv6",
    name: "Sporttv 6 (PT)",
    rawName: "PT - Sporttv 6",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv6.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv6.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:pt-sportv7",
    slug: "pt-sportv7",
    name: "Sporttv 7 (PT)",
    rawName: "PT - Sporttv 7",
    category: "portugal",
    categoryLabel: "Portugal",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/pt-sportv7.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/pt-sportv7.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-chaves",
    slug: "24h-chaves",
    name: "24H Chaves",
    rawName: "24H Chaves",
    category: "infantil",
    categoryLabel: "Infantil & Desenhos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-chaves.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-chaves.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-dragonball",
    slug: "24h-dragonball",
    name: "24H Dragon Ball Z",
    rawName: "24H Dragon Ball Z",
    category: "infantil",
    categoryLabel: "Infantil & Desenhos",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-dragonball.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-dragonball.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-friends",
    slug: "24h-friends",
    name: "24H Friends",
    rawName: "24H Friends",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-friends.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-friends.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-naruto",
    slug: "24h-naruto",
    name: "24H Naruto Cl\xE1ssico",
    rawName: "24H Naruto Cl\xE1ssico",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-naruto.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-naruto.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-simpsons",
    slug: "24h-simpsons",
    name: "24H Os Simpsons",
    rawName: "24H Os Simpsons",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-simpsons.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-simpsons.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-odeiachris",
    slug: "24h-odeiachris",
    name: "24H Todo Mundo Odeia o Cris",
    rawName: "24H Todo Mundo Odeia o Cris",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-odeiachris.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-odeiachris.m3u8",
    quality: "HD",
    isLive: true
  },
  {
    id: "mc:24h-picapau",
    slug: "24h-picapau",
    name: "24H Pica Pau",
    rawName: "24H Pica Pau",
    category: "variedades",
    categoryLabel: "Variedades & Reality",
    logo: "https://c69e439124f3-tvplay.baby-beamup.club/card/24h-picapau.png",
    streamUrl: "https://c69e439124f3-tvplay.baby-beamup.club/live/24h-picapau.m3u8",
    quality: "HD",
    isLive: true
  }
];

// src/data/liveChannels.ts
var LIVE_CHANNELS = liveChannelsData_default;
var CHANNEL_CATEGORIES = [
  { id: "todos", label: "Todos os Canais", icon: "Sparkles", count: LIVE_CHANNELS.length },
  { id: "esportes", label: "Esportes & Futebol", icon: "Trophy", count: LIVE_CHANNELS.filter((c) => c.category === "esportes").length },
  { id: "abertos", label: "Canais Abertos", icon: "Tv", count: LIVE_CHANNELS.filter((c) => c.category === "abertos").length },
  { id: "filmes", label: "Filmes & S\xE9ries", icon: "Film", count: LIVE_CHANNELS.filter((c) => c.category === "filmes").length },
  { id: "noticias", label: "Not\xEDcias", icon: "Newspaper", count: LIVE_CHANNELS.filter((c) => c.category === "noticias").length },
  { id: "infantil", label: "Infantil & Desenhos", icon: "Smile", count: LIVE_CHANNELS.filter((c) => c.category === "infantil").length },
  { id: "documentarios", label: "Document\xE1rios", icon: "Compass", count: LIVE_CHANNELS.filter((c) => c.category === "documentarios").length },
  { id: "portugal", label: "Portugal", icon: "Globe", count: LIVE_CHANNELS.filter((c) => c.category === "portugal").length },
  { id: "variedades", label: "Variedades & Reality", icon: "Flame", count: LIVE_CHANNELS.filter((c) => c.category === "variedades").length }
];

// src/utils/profileRating.ts
function allowedForProfile(item, maxRating, kids) {
  if (kids) {
    const matureRegex = /terror|horror|crime|guerra|erótico|erotico|suspense|thriller|adulto|violência|violencia/i;
    if (item.genres?.some((g) => matureRegex.test(g))) return false;
    const rating2 = String(item.ageRating || "").trim().toUpperCase();
    if (rating2 === "16" || rating2 === "18") return false;
    const isKidGenre = item.genres?.some(
      (g) => /animação|animacao|família|familia|kids|infantil|aventura|fantasia|comédia|comedia/i.test(g)
    );
    if (isKidGenre) return true;
    if (rating2 === "L" || rating2 === "LIVRE" || !rating2) return true;
    const match2 = rating2.match(/\d+/);
    return !!match2 && Number(match2[0]) <= 12;
  }
  const max = maxRating === "L" ? 0 : Number(maxRating || 18);
  if (max >= 18) return true;
  const rating = String(item.ageRating || "").trim().toUpperCase();
  if (rating === "L" || rating === "LIVRE") return true;
  const match = rating.match(/\d+/);
  return !!match && Number(match[0]) <= max;
}

// src/utils/streamLogic.ts
function parseTmdbTarget(rawInput) {
  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput;
    const tmdbId = String(obj.tmdbId || obj.id || "").trim();
    if (obj.kind === "tv" || "season" in obj && "episode" in obj) {
      const season = Math.max(1, Number(obj.season) || 1);
      const episode = Math.max(1, Number(obj.episode) || 1);
      if (tmdbId) return { kind: "tv", tmdbId, season, episode };
    }
    if (tmdbId) return { kind: "movie", tmdbId };
  }
  const str = typeof rawInput === "string" ? rawInput : String(rawInput ?? "");
  const trimmed = str.trim();
  if (!trimmed) {
    return { kind: "invalid", reason: "Informe um ID de filme, s\xE9rie (ex: 62650/12/2) ou URL direta." };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: "direct", url: trimmed };
  }
  const tvPrefix = trimmed.match(/^(?:tv\/)?(\d+)[\/\s:-]+[tTsS]?(\d+)[\/\sxXeE-]+(\d+)$/i);
  if (tvPrefix) {
    return {
      kind: "tv",
      tmdbId: tvPrefix[1],
      season: Number(tvPrefix[2]),
      episode: Number(tvPrefix[3])
    };
  }
  const movieMatch = trimmed.match(/^(?:movie\/)?(\d+)$/i);
  if (movieMatch) {
    return { kind: "movie", tmdbId: movieMatch[1] };
  }
  return {
    kind: "invalid",
    reason: "Formato inv\xE1lido. Use ID de filme (ex: 772), s\xE9rie (ex: 62650/12/2) ou URL http(s)."
  };
}
function detectStreamFormat(contentType, bytes) {
  const ct = (contentType ?? "").toLowerCase();
  const sampleText = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4096));
  const trimmedText = sampleText.replace(/^\uFEFF/, "").trimStart();
  const hasExtM3u = trimmedText.startsWith("#EXTM3U") || /\n#EXTM3U/.test(trimmedText);
  if (hasExtM3u) {
    return {
      formato: "hls",
      manifesto: true,
      ftyp: false,
      confirmada: true
    };
  }
  let hasFtyp = false;
  const searchLimit = Math.min(bytes.length - 4, 64);
  for (let i = 0; i <= searchLimit; i++) {
    if (bytes[i] === 102 && bytes[i + 1] === 116 && bytes[i + 2] === 121 && bytes[i + 3] === 112) {
      hasFtyp = true;
      break;
    }
  }
  if (hasFtyp || ct.includes("video/mp4") && bytes.length >= 16 && !trimmedText.startsWith("<")) {
    return {
      formato: hasFtyp ? "mp4" : "unknown",
      manifesto: false,
      ftyp: hasFtyp,
      confirmada: hasFtyp
    };
  }
  return {
    formato: "unknown",
    manifesto: false,
    ftyp: false,
    confirmada: false
  };
}
function rewriteHlsManifestWithResolver(manifestText, baseUrl, resolveUrl) {
  const mapRef = (rawRef) => {
    const trimmed = rawRef.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return rawRef;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      return resolveUrl(absolute);
    } catch {
      return rawRef;
    }
  };
  return manifestText.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/gi, (_match, uriValue) => {
        return `URI="${mapRef(uriValue)}"`;
      });
    }
    return mapRef(trimmed);
  }).join("\n");
}
function convertSrtToVtt(rawContent) {
  const normalized = rawContent.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (normalized.startsWith("WEBVTT")) {
    return `${normalized}
`;
  }
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").replace(/(\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT

${converted}
`;
}
function isLikelyHevcStream(url, quality) {
  const hay = `${url} ${quality ?? ""}`.toLowerCase();
  return hay.includes("h265") || hay.includes("hevc") || hay.includes("x265");
}
function isUltraHdQuality(quality) {
  if (!quality) return false;
  return /4k|2160p|uhd|ultra\s*fhd|studio\s*master/i.test(quality);
}
function classifyVideoDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 160 || height < 120) {
    return null;
  }
  if (width >= 3400 || height >= 1900) {
    return { width, height, quality: "4K UHD", is4k: true, tier: 4 };
  }
  if (width >= 1800 || height >= 1e3) {
    return { width, height, quality: "1080p Full HD", is4k: false, tier: 3 };
  }
  if (width >= 1200 || height >= 680) {
    return { width, height, quality: "720p HD", is4k: false, tier: 2 };
  }
  return { width, height, quality: "480p HD", is4k: false, tier: 1 };
}
function parseHlsMasterMaxDimensions(manifestText) {
  const lines = manifestText.split(/\r?\n/);
  let best = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    if (!resMatch) continue;
    const w = Number(resMatch[1]);
    const h = Number(resMatch[2]);
    const bw = Number(line.match(/BANDWIDTH=(\d+)/i)?.[1] ?? 0);
    const meta = classifyVideoDimensions(w, h);
    if (!meta) continue;
    if (!best || meta.tier > best.meta.tier || meta.tier === best.meta.tier && (w * h > best.meta.width * best.meta.height || bw > best.bandwidth)) {
      best = { meta, bandwidth: bw };
    }
  }
  return best;
}
function parseMp4TkhdDimensions(bytes) {
  let best = null;
  for (let i = 0; i + 100 <= bytes.length; i++) {
    if (bytes[i] === 116 && bytes[i + 1] === 107 && bytes[i + 2] === 104 && bytes[i + 3] === 100) {
      const version = bytes[i + 4];
      if (version !== 0 && version !== 1 || bytes[i + 5] !== 0 || bytes[i + 6] !== 0) {
        continue;
      }
      const wOff = version === 1 ? i + 92 : i + 80;
      if (wOff + 8 > bytes.length) continue;
      const wFixed = (bytes[wOff] << 24 | bytes[wOff + 1] << 16 | bytes[wOff + 2] << 8 | bytes[wOff + 3]) >>> 0;
      const hFixed = (bytes[wOff + 4] << 24 | bytes[wOff + 5] << 16 | bytes[wOff + 6] << 8 | bytes[wOff + 7]) >>> 0;
      const width = wFixed >>> 16;
      const height = hFixed >>> 16;
      if (width >= 320 && width <= 7680 && height >= 180 && height <= 4320) {
        const meta = classifyVideoDimensions(width, height);
        if (meta && (!best || meta.tier > best.tier || width * height > best.width * best.height)) {
          best = meta;
        }
      }
    }
  }
  return best;
}
function decodeH264SpsNal(nal) {
  if (nal.length < 6 || (nal[0] & 31) !== 7) return null;
  const rbsp = [];
  for (let i = 1; i < nal.length; i++) {
    if (i >= 3 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) {
      continue;
    }
    rbsp.push(nal[i]);
  }
  if (rbsp.length < 4) return null;
  let bitPos = 0;
  const totalBits = rbsp.length * 8;
  const readBits = (n) => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      if (bitPos >= totalBits) return -1;
      const b = rbsp[bitPos >> 3] >> 7 - (bitPos & 7) & 1;
      val = val << 1 | b;
      bitPos++;
    }
    return val;
  };
  const readUE = () => {
    let zeros = 0;
    while (bitPos < totalBits) {
      const bit = rbsp[bitPos >> 3] >> 7 - (bitPos & 7) & 1;
      bitPos++;
      if (bit === 1) break;
      zeros++;
      if (zeros > 30) return -1;
    }
    if (zeros === 0) return 0;
    const rem = readBits(zeros);
    if (rem < 0) return -1;
    return (1 << zeros) - 1 + rem;
  };
  const readSE = () => {
    const u = readUE();
    if (u < 0) return 0;
    return u & 1 ? u + 1 >> 1 : -(u >> 1);
  };
  const profileIdc = readBits(8);
  readBits(8);
  readBits(8);
  if (readUE() < 0) return null;
  let chromaFormatIdc = 1;
  const highProfiles = /* @__PURE__ */ new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
  if (highProfiles.has(profileIdc)) {
    chromaFormatIdc = readUE();
    if (chromaFormatIdc < 0 || chromaFormatIdc > 3) return null;
    if (chromaFormatIdc === 3) readBits(1);
    if (readUE() < 0 || readUE() < 0) return null;
    readBits(1);
    const scalingPresent = readBits(1);
    if (scalingPresent === 1) {
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) {
        const listPresent = readBits(1);
        if (listPresent === 1) {
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) {
              const delta = readSE();
              nextScale = (lastScale + delta + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }
  if (readUE() < 0) return null;
  const pocType = readUE();
  if (pocType < 0) return null;
  if (pocType === 0) {
    if (readUE() < 0) return null;
  } else if (pocType === 1) {
    readBits(1);
    readSE();
    readSE();
    const numRef = readUE();
    for (let i = 0; i < Math.min(256, Math.max(0, numRef)); i++) readSE();
  }
  if (readUE() < 0) return null;
  readBits(1);
  const picWidthInMbsMinus1 = readUE();
  const picHeightInMapUnitsMinus1 = readUE();
  const frameMbsOnly = readBits(1);
  if (picWidthInMbsMinus1 < 0 || picHeightInMapUnitsMinus1 < 0 || frameMbsOnly < 0) return null;
  if (frameMbsOnly === 0) readBits(1);
  readBits(1);
  let cropL = 0;
  let cropR = 0;
  let cropT = 0;
  let cropB = 0;
  const croppingFlag = readBits(1);
  if (croppingFlag === 1) {
    cropL = Math.max(0, readUE());
    cropR = Math.max(0, readUE());
    cropT = Math.max(0, readUE());
    cropB = Math.max(0, readUE());
  }
  const cropUnitX = chromaFormatIdc === 0 || chromaFormatIdc === 3 ? 1 : 2;
  const cropUnitY = (chromaFormatIdc === 0 ? 1 : chromaFormatIdc === 1 ? 2 : 1) * (2 - frameMbsOnly);
  const width = (picWidthInMbsMinus1 + 1) * 16 - (cropL + cropR) * cropUnitX;
  const height = (2 - frameMbsOnly) * (picHeightInMapUnitsMinus1 + 1) * 16 - (cropT + cropB) * cropUnitY;
  if (width < 320 || width > 7680 || height < 180 || height > 4320) return null;
  return classifyVideoDimensions(width, height);
}
function parseH264SpsFromSegmentBytes(bytes) {
  const mp4Meta = parseMp4TkhdDimensions(bytes);
  if (mp4Meta) return mp4Meta;
  let scanBuf = bytes;
  if (bytes.length >= 376 && bytes[0] === 71 && bytes[188] === 71) {
    const pidPayloads = /* @__PURE__ */ new Map();
    const videoPids = /* @__PURE__ */ new Set();
    for (let off = 0; off + 188 <= bytes.length; off += 188) {
      if (bytes[off] !== 71) continue;
      const pusi = (bytes[off + 1] & 64) !== 0;
      const pid = (bytes[off + 1] & 31) << 8 | bytes[off + 2];
      if (pid === 0 || pid === 8191) continue;
      const afc = bytes[off + 3] >> 4 & 3;
      if (afc === 0 || afc === 2) continue;
      let pOff = off + 4;
      if (afc === 3) {
        const adaptLen = bytes[pOff];
        pOff += 1 + adaptLen;
      }
      if (pOff >= off + 188) continue;
      const chunk = bytes.subarray(pOff, off + 188);
      if (pusi && chunk.length >= 9 && chunk[0] === 0 && chunk[1] === 0 && chunk[2] === 1 && chunk[3] >= 224 && chunk[3] <= 239) {
        videoPids.add(pid);
        const headerDataLen = chunk[8];
        const esStart = 9 + headerDataLen;
        if (esStart < chunk.length) {
          const list = pidPayloads.get(pid) ?? [];
          for (let k = esStart; k < chunk.length; k++) list.push(chunk[k]);
          pidPayloads.set(pid, list);
        }
      } else if (videoPids.has(pid)) {
        const list = pidPayloads.get(pid) ?? [];
        for (let k = 0; k < chunk.length; k++) list.push(chunk[k]);
        pidPayloads.set(pid, list);
      }
    }
    const firstVideo = pidPayloads.values().next().value;
    if (firstVideo && firstVideo.length >= 12) {
      scanBuf = new Uint8Array(firstVideo);
    }
  }
  for (let i = 0; i + 8 < scanBuf.length; i++) {
    if (scanBuf[i] === 0 && scanBuf[i + 1] === 0 && scanBuf[i + 2] === 1) {
      const nalStart = i + 3;
      if ((scanBuf[nalStart] & 31) === 7) {
        let nalEnd = scanBuf.length;
        for (let j = nalStart + 4; j + 2 < scanBuf.length; j++) {
          if (scanBuf[j] === 0 && scanBuf[j + 1] === 0 && (scanBuf[j + 2] === 1 || scanBuf[j + 2] === 0)) {
            nalEnd = j;
            break;
          }
        }
        const meta = decodeH264SpsNal(scanBuf.subarray(nalStart, nalEnd));
        if (meta) return meta;
      }
    }
  }
  return null;
}
function detectMp4CodecFromBytes(bytes) {
  let ascii = "";
  const limit = Math.min(bytes.length, 16384);
  for (let i = 0; i < limit; i++) {
    ascii += String.fromCharCode(bytes[i]);
  }
  if (ascii.includes("hvc1") || ascii.includes("hev1")) return "h265";
  if (ascii.includes("avc1")) return "h264";
  return "unknown";
}
function sortBrowserCompatibleFirst(streams) {
  const score = (s) => {
    let pts = s.priorityBoost ?? 0;
    const hevc = s.codec === "h265" || isLikelyHevcStream(s.url ?? "", s.qualidade);
    const is4k = isUltraHdQuality(s.qualidade);
    if (!hevc) pts += 300;
    if (s.verified) pts += 150;
    if (s.idioma && /pt|br|dub/i.test(s.idioma)) pts += 120;
    if (!is4k) pts += 200;
    if (s.qualidade && /1080p|full\s*hd/i.test(s.qualidade)) pts += 90;
    else if (s.qualidade && /720p/i.test(s.qualidade)) pts += 25;
    else if (s.qualidade && /480p|360p/i.test(s.qualidade)) pts += 0;
    else pts += 40;
    if (typeof s.videoWidth === "number" && s.videoWidth > 0) {
      if (s.videoWidth >= 1880) pts += 25;
      else if (s.videoWidth >= 1600) pts += 10;
    }
    if (s.formato === "hls") pts += 14;
    else if (s.formato === "mp4") pts += 6;
    if (typeof s.bitrateBps === "number" && s.bitrateBps > 0) {
      if (s.bitrateBps >= 25e5) pts += 18;
      else if (s.bitrateBps >= 14e5) pts += 10;
      else if (s.bitrateBps < 8e5) pts -= 15;
    }
    if (typeof s.latencyMs === "number") {
      if (s.latencyMs <= 350) pts += 22;
      else if (s.latencyMs <= 750) pts += 14;
      else if (s.latencyMs <= 1300) pts += 6;
    }
    return pts;
  };
  return [...streams].sort((a, b) => score(b) - score(a));
}
function inferStreamFormatFromUrlOrMeta(url, hintText) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes(".m3u8") || lowerUrl.includes("m3u8") || lowerUrl.includes("/master.txt") || lowerUrl.includes("playlist.m3u8")) {
    return "hls";
  }
  if (lowerUrl.includes(".mp4") || lowerUrl.includes("/video/") && !lowerUrl.includes("m3u8")) {
    return "mp4";
  }
  const parts = url.split("/");
  const tail = parts[parts.length - 1] ?? "";
  if (tail.length >= 16 && /^[A-Za-z0-9+/_=-]+$/.test(tail)) {
    try {
      const padded = tail.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(padded);
      if (decoded.toLowerCase().includes(".mp4")) return "mp4";
      if (decoded.toLowerCase().includes(".m3u8")) return "hls";
    } catch {
    }
  }
  if (hintText && /\bmp4\b/i.test(hintText)) return "mp4";
  return "hls";
}
function parseTheIntroDbV2Response(raw) {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw;
  const out = [];
  for (const seg of obj.intro ?? []) {
    if (typeof seg.start_ms === "number" && typeof seg.end_ms === "number" && seg.end_ms > seg.start_ms + 3e3) {
      out.push({ type: "intro", start: seg.start_ms / 1e3, end: seg.end_ms / 1e3 });
    }
  }
  for (const seg of obj.recap ?? []) {
    if (typeof seg.start_ms === "number" && typeof seg.end_ms === "number" && seg.end_ms > seg.start_ms + 3e3) {
      out.push({ type: "recap", start: seg.start_ms / 1e3, end: seg.end_ms / 1e3 });
    }
  }
  const credits = (obj.credits ?? []).filter((c) => typeof c.start_ms === "number" && c.start_ms >= 0);
  if (credits.length > 0) {
    const endCredit = credits.find((c) => c.end_ms === null && (c.start_ms ?? 0) > 6e4) ?? [...credits].sort((a, b) => (b.start_ms ?? 0) - (a.start_ms ?? 0))[0];
    if (endCredit && typeof endCredit.start_ms === "number" && endCredit.start_ms > 6e4) {
      out.push({
        type: "outro",
        start: endCredit.start_ms / 1e3,
        end: typeof endCredit.end_ms === "number" ? endCredit.end_ms / 1e3 : null
      });
    }
  }
  return out;
}
function parseAniSkipResponse(raw) {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw;
  if (!obj.found || !Array.isArray(obj.results)) return [];
  const out = [];
  for (const item of obj.results) {
    const st = item.interval?.startTime;
    const en = item.interval?.endTime;
    if (typeof st !== "number" || typeof en !== "number" || en <= st + 3) continue;
    if (item.skipType === "op" || item.skipType === "mixed-op") {
      out.push({ type: "intro", start: st, end: en });
    } else if (item.skipType === "recap") {
      out.push({ type: "recap", start: st, end: en });
    } else if (item.skipType === "ed" || item.skipType === "mixed-ed") {
      out.push({ type: "outro", start: st, end: en });
    }
  }
  return out;
}

// src/utils/animeMatcher.ts
var NOISE_WORDS = /* @__PURE__ */ new Set([
  "dublado",
  "legendado",
  "todos",
  "os",
  "episodios",
  "episodio",
  "online",
  "assistir",
  "gratis",
  "hd",
  "fhd",
  "4k",
  "anime",
  "animes",
  "completo",
  "temporada",
  "season"
]);
var STOP_WORDS = /* @__PURE__ */ new Set(["the", "no", "na", "ni", "wa", "wo", "ga", "de", "to", "of", "in", "a", "o", "e", "part", "cour"]);
function normalizeAnimeText(raw) {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&[#a-z0-9]+;/gi, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokenizeAnimeTitle(raw, stripNoise = true) {
  const norm = normalizeAnimeText(raw);
  if (!norm) return [];
  return norm.split(/\s+/).filter((t) => {
    if (!t) return false;
    if (stripNoise && NOISE_WORDS.has(t)) return false;
    return true;
  });
}
function detectTitleAudioKind(rawTitle) {
  const norm = normalizeAnimeText(rawTitle);
  if (/\bdublado\b|\bdub\b|\bpt br\b/.test(norm)) return "dublado";
  if (/\blegendado\b|\bleg\b|\bsub\b/.test(norm)) return "legendado";
  return "unknown";
}
function isMovieOrSpinOffTitle(rawTitle) {
  const norm = normalizeAnimeText(rawTitle);
  return /\b(filme|movie|ova|ona|especial|special|chuugakkou|chibi|summary|recap)\b/.test(norm);
}
function extractSeasonHint(rawTitle, baseQueryTitles = []) {
  const norm = normalizeAnimeText(rawTitle).replace(/\b(dublado|legendado|todos os episodios|online|assistir|hd|pt br)\b/g, " ").replace(/\s+/g, " ").trim();
  const baseNorms = baseQueryTitles.map((q) => normalizeAnimeText(q));
  const explicit = norm.match(/\btemporada\s*(\d{1,2})\b/) || norm.match(/\b(\d{1,2})\s*(?:a|o)?\s*temporada\b/) || norm.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*season\b/) || norm.match(/\bseason\s*(\d{1,2})\b/);
  if (explicit) return Number(explicit[1]);
  if (/\bfinal\s*season\b|\bkanketsu\s*hen\b/.test(norm)) return 4;
  const romanTrailing = norm.match(/\b(ii|iii|iv|v)\s*$/);
  if (romanTrailing) {
    const map = { ii: 2, iii: 3, iv: 4, v: 5 };
    return map[romanTrailing[1]] ?? null;
  }
  const numTrailing = norm.match(/\b([2-9]|1[0-9])$/);
  if (numTrailing) {
    const n = numTrailing[1];
    const queryAlreadyHasNum = baseNorms.some((b) => new RegExp(`\\b${n}$`).test(b));
    if (!queryAlreadyHasNum) return Number(n);
  }
  return null;
}
function scoreAnimeCandidate(candidateTitle, queryTitles, targetSeason, mediaType = "series") {
  if (!candidateTitle || queryTitles.length === 0) return -1;
  const isMovieTitle = isMovieOrSpinOffTitle(candidateTitle);
  if (mediaType === "series" && isMovieTitle) return -1;
  if (mediaType === "movie" && !isMovieTitle) {
  }
  const candTokens = tokenizeAnimeTitle(candidateTitle, true).filter((t) => !STOP_WORDS.has(t));
  if (candTokens.length === 0) return -1;
  let bestOverlapScore = -1;
  for (const q of queryTitles) {
    const qTokens = tokenizeAnimeTitle(q, true).filter((t) => !STOP_WORDS.has(t));
    if (qTokens.length === 0) continue;
    const candSet = new Set(candTokens);
    const matched = qTokens.filter((t) => candSet.has(t));
    const recall = matched.length / qTokens.length;
    const precision = matched.length / candTokens.length;
    if (qTokens.length >= 2 && recall < 0.75) continue;
    if (qTokens.length === 1 && recall < 1) continue;
    const extraNonSeasonTokens = candTokens.filter(
      (t) => !qTokens.includes(t) && !/^(2|3|4|5|ii|iii|iv|final|season|temporada|part|parte)$/.test(t)
    );
    if (extraNonSeasonTokens.length > 2 && precision < 0.5) continue;
    let score = recall * 100 + precision * 40 - extraNonSeasonTokens.length * 12;
    const candSeason = extractSeasonHint(candidateTitle, queryTitles);
    if (targetSeason === 1) {
      if (candSeason !== null && candSeason > 1) {
        score -= 90;
      } else {
        score += 30;
      }
    } else {
      if (candSeason === targetSeason) {
        score += 55;
      } else if (candSeason !== null && candSeason !== targetSeason) {
        score -= 80;
      } else {
        score -= 10;
      }
    }
    if (score > bestOverlapScore) {
      bestOverlapScore = score;
    }
  }
  return bestOverlapScore;
}
function pickTopAnimeCandidates(candidates, queryTitles, targetSeason, mediaType = "series", limitPerAudio = 1) {
  const scored = candidates.map((c) => ({
    ...c,
    audioKind: detectTitleAudioKind(c.title),
    matchScore: scoreAnimeCandidate(c.title, queryTitles, targetSeason, mediaType)
  })).filter((c) => c.matchScore >= 60).sort((a, b) => b.matchScore - a.matchScore);
  const dubs = scored.filter((c) => c.audioKind === "dublado").slice(0, limitPerAudio);
  const subs = scored.filter((c) => c.audioKind !== "dublado").slice(0, limitPerAudio);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of [...dubs, ...subs]) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      out.push(item);
    }
  }
  return out;
}
function extractEpisodeNumberFromEntry(text, url) {
  const textMatch = text.match(/epis[oó]dio\s*[-:#]?\s*0*(\d{1,4})\b/i) || text.match(/\bep\.?\s*0*(\d{1,4})\b/i) || text.match(/\b(\d{1,4})\s*$/);
  if (textMatch) return Number(textMatch[1]);
  const urlMatch = url.match(/episodio-(\d{1,4})\/?$/i) || url.match(/[-_](\d{1,4})\/?$/i);
  if (urlMatch) return Number(urlMatch[1]);
  return null;
}
function matchExactEpisode(entries, targetEpisode, absoluteEpisode, requireAbsoluteOnly = false) {
  const candidatesToCheck = [];
  if (!requireAbsoluteOnly) {
    candidatesToCheck.push(targetEpisode);
  }
  if (absoluteEpisode && absoluteEpisode > 0 && !candidatesToCheck.includes(absoluteEpisode)) {
    candidatesToCheck.push(absoluteEpisode);
  }
  for (const epNum of candidatesToCheck) {
    for (const entry of entries) {
      const n = entry.episodeNumber ?? extractEpisodeNumberFromEntry(entry.text, entry.url);
      if (n === epNum) return entry;
    }
  }
  return null;
}
function decodeAnrollBloggerSource(embedUrl) {
  try {
    const parsed = new URL(embedUrl);
    const rawSource = parsed.searchParams.get("source")?.trim();
    if (!rawSource) return null;
    if (/^https?:\/\//i.test(rawSource)) {
      return rawSource;
    }
    const base64 = rawSource.replace(/ /g, "+");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    if (!decoded) return null;
    if (/^https?:\/\//i.test(decoded)) return decoded;
    const reversed = decoded.split("").reverse().join("");
    if (!reversed || reversed.length < 12) return null;
    return `https://www.blogger.com/video.g?token=${encodeURIComponent(reversed)}`;
  } catch {
    return null;
  }
}
function extractAnivideoM3u8Urls(html) {
  const urls = [];
  const seen = /* @__PURE__ */ new Set();
  const regex = /https?:\/\/api\.anivideo\.net\/videohls\.php\?[^"'<>\s]+/gi;
  for (const m of html.matchAll(regex)) {
    try {
      const cleaned = m[0].replace(/&amp;/g, "&");
      const u = new URL(cleaned);
      const d = u.searchParams.get("d");
      if (d && /^https?:\/\//i.test(d) && !seen.has(d)) {
        seen.add(d);
        urls.push(d);
      }
    } catch {
    }
  }
  return urls;
}
function extractBloggerMp4Urls(html) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const regex = /&quot;(https:\/\/[^&]+googlevideo\.com\/videoplayback[^&]+)&quot;/g;
  for (const m of html.matchAll(regex)) {
    const raw = m[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    if (!raw.startsWith("https://") || seen.has(raw)) continue;
    seen.add(raw);
    const itag = raw.match(/[?&]itag=(\d+)/)?.[1];
    const quality = itag === "37" ? "1080p Full HD" : itag === "22" ? "720p HD" : itag === "18" ? "360p" : "HD";
    const rank = itag === "37" ? 3 : itag === "22" ? 2 : itag === "18" ? 1 : 0;
    out.push({ url: raw, quality, rank });
  }
  return out.sort((a, b) => b.rank - a.rank).map(({ url, quality }) => ({ url, quality }));
}

// server.ts
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path5.dirname(__filename2);
dotenv.config({ path: path5.join(__dirname2, ".env.local"), override: true });
dotenv.config({ path: path5.join(__dirname2, ".env"), override: false });
var PORT = Number(process.env.PORT ?? 3001);
var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var rawReadToken = process.env.TMDB_READ_TOKEN || "";
var rawApiKey = process.env.TMDB_API_KEY || "";
var TMDB_READ_TOKEN2 = rawReadToken === "MY_TMDB_READ_TOKEN" ? "" : rawReadToken;
var TMDB_API_KEY = rawApiKey === "MY_TMDB_API_KEY" ? "" : rawApiKey;
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_IMG = "https://image.tmdb.org/t/p";
var EXTRACT_CACHE_TTL_MS = 10 * 60 * 1e3;
var STREAM_REGISTRY_TTL_MS = 4 * 60 * 60 * 1e3;
var META_CACHE_TTL_MS = 15 * 60 * 1e3;
var PROXY_TOKEN_SECRET = crypto3.createHash("sha256").update(process.env.PROXY_TOKEN_SECRET || "kairou-proxy-secret-alexhost-2026").digest();
function createStatelessProxyToken(url, referer, extraHeaders, ttlMs = STREAM_REGISTRY_TTL_MS) {
  try {
    const payload = JSON.stringify({
      u: url,
      r: referer,
      h: extraHeaders,
      e: Math.floor((Date.now() + ttlMs) / 1e3)
    });
    const iv = crypto3.randomBytes(12);
    const cipher = crypto3.createCipheriv("aes-256-gcm", PROXY_TOKEN_SECRET, iv);
    const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString("base64url");
  } catch {
    return crypto3.randomBytes(9).toString("base64url");
  }
}
function resolveStatelessProxyToken(token2) {
  try {
    const buf = Buffer.from(token2, "base64url");
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto3.createDecipheriv("aes-256-gcm", PROXY_TOKEN_SECRET, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const obj = JSON.parse(dec.toString("utf8"));
    if (!obj || typeof obj.u !== "string") return null;
    if (typeof obj.e === "number" && obj.e * 1e3 < Date.now()) return null;
    return {
      url: obj.u,
      referer: typeof obj.r === "string" ? obj.r : "",
      extraHeaders: obj.h && typeof obj.h === "object" ? obj.h : void 0
    };
  } catch {
    return null;
  }
}
var streamRegistry = /* @__PURE__ */ new Map();
var subRegistry = /* @__PURE__ */ new Map();
var proxyTokenRegistry = /* @__PURE__ */ new Map();
var urlToProxyToken = /* @__PURE__ */ new Map();
var extractCache = /* @__PURE__ */ new Map();
var metaCache = /* @__PURE__ */ new Map();
var seasonCache = /* @__PURE__ */ new Map();
var catalogCache = /* @__PURE__ */ new Map();
var tmdbToImdbCache = /* @__PURE__ */ new Map();
var malIdCache = /* @__PURE__ */ new Map();
var skipTimesCache = /* @__PURE__ */ new Map();
var animeContextCache = /* @__PURE__ */ new Map();
var animeSearchPageCache = /* @__PURE__ */ new Map();
var lastPruneAt = 0;
function pruneExpiredMaps() {
  const now = Date.now();
  if (now - lastPruneAt < 6e4) return;
  lastPruneAt = now;
  if (proxyTokenRegistry.size > 5e4) {
    for (const [k, v] of proxyTokenRegistry) {
      if (v.expiresAt <= now) proxyTokenRegistry.delete(k);
    }
    for (const [k, v] of urlToProxyToken) {
      if (v.expiresAt <= now) urlToProxyToken.delete(k);
    }
    if (proxyTokenRegistry.size > 5e4) {
      let removed = 0;
      for (const k of proxyTokenRegistry.keys()) {
        proxyTokenRegistry.delete(k);
        removed++;
        if (removed >= 1e4) break;
      }
    }
  }
  if (streamRegistry.size > 4e3) {
    for (const [k, v] of streamRegistry) {
      if (v.expiresAt <= now) streamRegistry.delete(k);
    }
  }
  if (subRegistry.size > 4e3) {
    for (const [k, v] of subRegistry) {
      if (v.expiresAt <= now) subRegistry.delete(k);
    }
  }
}
function registerProxyToken(url, referer, extraHeaders) {
  const mapKey = `${url}::${referer}`;
  const now = Date.now();
  const existing = urlToProxyToken.get(mapKey);
  if (existing && existing.expiresAt > now) {
    return existing.token;
  }
  pruneExpiredMaps();
  const token2 = createStatelessProxyToken(url, referer, extraHeaders);
  const expiresAt = now + STREAM_REGISTRY_TTL_MS;
  proxyTokenRegistry.set(token2, { url, referer, extraHeaders, expiresAt });
  urlToProxyToken.set(mapKey, { token: token2, expiresAt });
  return token2;
}
function registerStream(url, referer, format, extraHeaders) {
  pruneExpiredMaps();
  const token2 = createStatelessProxyToken(url, referer, extraHeaders);
  const id = `s_${token2}`;
  streamRegistry.set(id, {
    url,
    referer,
    extraHeaders,
    format,
    expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS
  });
  return id;
}
function registerSubtitle(url, referer, lang, label, extraHeaders) {
  pruneExpiredMaps();
  const id = `sub_${crypto3.randomBytes(7).toString("base64url")}`;
  subRegistry.set(id, {
    url,
    referer,
    extraHeaders,
    lang,
    label,
    expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS
  });
  return id;
}
function isSafeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer2 = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2400);
  try {
    const headers = {
      "User-Agent": DEFAULT_UA,
      Accept: "*/*",
      ...opts.headers ?? {}
    };
    if (opts.referer && !headers.Referer) {
      headers.Referer = opts.referer;
      try {
        if (!headers.Origin) headers.Origin = new URL(opts.referer).origin;
      } catch {
      }
    }
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers,
      redirect: opts.redirect ?? "follow",
      signal: controller.signal
    });
    const text = opts.method === "HEAD" ? "" : await res.text();
    return { status: res.status, text, finalUrl: res.url || url, headers: res.headers };
  } finally {
    clearTimeout(timer2);
  }
}
async function fetchTmdbJson(endpointPath, timeoutMs = 2600) {
  if (!TMDB_API_KEY && !TMDB_READ_TOKEN2) return null;
  const sep = endpointPath.includes("?") ? "&" : "?";
  const url = TMDB_API_KEY ? `${TMDB_BASE}${endpointPath}${sep}api_key=${encodeURIComponent(TMDB_API_KEY)}` : `${TMDB_BASE}${endpointPath}`;
  try {
    const headers = { Accept: "application/json" };
    if (TMDB_READ_TOKEN2) headers.Authorization = `Bearer ${TMDB_READ_TOKEN2}`;
    const res = await fetchWithTimeout(url, { timeoutMs, headers });
    if (res.status !== 200) return null;
    return JSON.parse(res.text);
  } catch {
    return null;
  }
}
function normalizeSubtitleLang(lang, label) {
  const hay = `${lang} ${label}`.toLowerCase().trim();
  if (hay.includes("brazil") || hay.includes("pt-br") || hay === "pb" || hay === "pob" || hay.includes("portugu\xEAs (br")) {
    return { lang: "pt-BR", label: "Portugu\xEAs (BR)", rank: 100 };
  }
  if (hay.startsWith("pt") || hay.includes("portugu")) {
    return { lang: "pt", label: "Portugu\xEAs", rank: 95 };
  }
  if (hay === "en" || hay.startsWith("en-") || hay.includes("english") || hay.includes("ingl")) {
    return { lang: "en", label: "Ingl\xEAs", rank: 70 };
  }
  if (hay === "es" || hay.startsWith("es-") || hay.includes("span") || hay.includes("espanh")) {
    return { lang: "es", label: "Espanhol", rank: 60 };
  }
  if (hay === "fr" || hay.startsWith("fr-") || hay.includes("french") || hay.includes("franc")) {
    return { lang: "fr", label: "Franc\xEAs", rank: 50 };
  }
  if (hay === "de" || hay.startsWith("de-") || hay.includes("german") || hay.includes("alem")) {
    return { lang: "de", label: "Alem\xE3o", rank: 45 };
  }
  if (hay === "it" || hay.startsWith("it-") || hay.includes("ital")) {
    return { lang: "it", label: "Italiano", rank: 40 };
  }
  return { lang: lang || "und", label: label || lang || "Legenda", rank: 20 };
}
function formatQualityDisplay(rawQuality) {
  if (!rawQuality) return { quality: "1080p Full HD", is4k: false };
  const q = rawQuality.replace(/\([^)]*\)/g, "").trim();
  const is4k = isUltraHdQuality(rawQuality);
  if (/2160|4k/i.test(rawQuality)) return { quality: "4K UHD", is4k: true };
  if (/ultra\s*fhd|studio\s*master/i.test(rawQuality)) return { quality: "Ultra FHD \xB7 Master", is4k: true };
  if (/1080|fhd/i.test(q)) return { quality: "1080p Full HD", is4k: false };
  if (/720/i.test(q)) return { quality: "720p HD", is4k: false };
  if (/480/i.test(q)) return { quality: "480p", is4k: false };
  if (/360/i.test(q)) return { quality: "360p / 720p HD", is4k: false };
  if (q.toLowerCase() === "auto") return { quality: "Auto HD", is4k: false };
  return { quality: q || "HD", is4k };
}
function formatAudioDisplay(idioma, rawQuality) {
  const hay = `${idioma ?? ""} ${rawQuality ?? ""}`.toLowerCase();
  if (/pt-br|pt_br|portuguese|português|dublado|🇧🇷|\bpt\b|dual/i.test(hay)) {
    return { audio: "PT-BR \xB7 Dublado", isPtBr: true };
  }
  if (/en-us|english|ingl|🇺🇸/i.test(hay)) {
    return { audio: "Ingl\xEAs \xB7 Original", isPtBr: false };
  }
  if (/legendad/i.test(hay)) {
    return { audio: "Original \xB7 Legendado", isPtBr: false };
  }
  if (/es|spanish|español/i.test(hay)) {
    return { audio: "Espanhol", isPtBr: false };
  }
  if (/fr|french/i.test(hay)) {
    return { audio: "Franc\xEAs", isPtBr: false };
  }
  if (/hi|hindi/i.test(hay)) {
    return { audio: "Hindi", isPtBr: false };
  }
  return { audio: "Original / Multi", isPtBr: false };
}
async function resolveAnimeContext(target) {
  if (target.kind !== "tv") return null;
  const cacheKey = `tv:${target.tmdbId}:${target.season}:${target.episode}`;
  const hit = animeContextCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }
  const titlePool = [];
  const pushTitle = (t) => {
    const clean = (t ?? "").trim();
    if (!clean || !/[a-z]{2}/i.test(clean)) return;
    if (!titlePool.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      titlePool.push(clean);
    }
  };
  pushTitle(target.originalTitle);
  pushTitle(target.title);
  const curated = CURATED_CATALOG.find((c) => c.tmdbId === target.tmdbId);
  if (curated) {
    pushTitle(curated.originalTitle);
    pushTitle(curated.title);
  }
  const cachedMeta = metaCache.get(`tmdb-detail:series:${target.tmdbId}`)?.value;
  if (cachedMeta) {
    pushTitle(cachedMeta.originalTitle);
    pushTitle(cachedMeta.title);
  }
  let isAnime = Boolean(target.isAnime) || Boolean(curated && (curated.network === "Crunchyroll" || curated.genres.some((g) => /anima/i.test(g)))) || Boolean(cachedMeta && (cachedMeta.network === "Crunchyroll" || cachedMeta.genres.some((g) => /anima/i.test(g))));
  let imdbId = target.imdbId || curated?.imdbId || cachedMeta?.imdbId;
  let malId;
  let anilistId;
  let absoluteEpisode;
  let mappedSeason;
  let mappedEpisode;
  let hasFullRomaji = false;
  try {
    const azRes = await fetchWithTimeout(
      `https://api.ani.zip/mappings?themoviedb_id=${encodeURIComponent(target.tmdbId)}`,
      { timeoutMs: 1400, headers: { Accept: "application/json" } }
    );
    if (azRes.status === 200) {
      const az = JSON.parse(azRes.text);
      if (az.titles && Object.keys(az.titles).length > 0) {
        isAnime = true;
        const xjat = az.titles["x-jat"];
        if (xjat && xjat.length > 5 && /[a-z]{3}/i.test(xjat)) {
          pushTitle(xjat);
          hasFullRomaji = true;
        }
        pushTitle(az.titles.en);
        pushTitle(az.titles.pt);
      }
      if (az.mappings?.imdb_id) {
        imdbId = imdbId || az.mappings.imdb_id;
        tmdbToImdbCache.set(`tv:${target.tmdbId}`, az.mappings.imdb_id);
      }
      if (typeof az.mappings?.mal_id === "number") malId = az.mappings.mal_id;
      if (typeof az.mappings?.anilist_id === "number") anilistId = az.mappings.anilist_id;
      if (az.episodes) {
        for (const epObj of Object.values(az.episodes)) {
          if (epObj.seasonNumber === target.season && epObj.episodeNumber === target.episode && typeof epObj.absoluteEpisodeNumber === "number") {
            absoluteEpisode = epObj.absoluteEpisodeNumber;
            mappedSeason = epObj.seasonNumber;
            mappedEpisode = epObj.episodeNumber;
            break;
          }
          if (typeof epObj.absoluteEpisodeNumber === "number" && epObj.absoluteEpisodeNumber === target.episode) {
            absoluteEpisode = epObj.absoluteEpisodeNumber;
            mappedSeason = epObj.seasonNumber;
            mappedEpisode = epObj.episodeNumber;
            break;
          }
        }
      }
    }
  } catch {
  }
  if (!absoluteEpisode && target.episode >= 50) {
    absoluteEpisode = target.episode;
  }
  if (!isAnime) {
    animeContextCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1e3, value: null });
    return null;
  }
  if ((!hasFullRomaji || titlePool.length < 2) && (anilistId || malId)) {
    try {
      const query = anilistId ? "query($id:Int){Media(id:$id,type:ANIME){title{romaji english}}}" : "query($id:Int){Media(idMal:$id,type:ANIME){title{romaji english}}}";
      const alRes = await fetchWithTimeout("https://graphql.anilist.co", {
        method: "POST",
        timeoutMs: 900,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { id: anilistId ?? malId } })
      });
      if (alRes.status === 200) {
        const alJson = JSON.parse(alRes.text);
        pushTitle(alJson.data?.Media?.title?.romaji);
        pushTitle(alJson.data?.Media?.title?.english);
      }
    } catch {
    }
  }
  if (titlePool.length === 0) {
    return null;
  }
  const ctx = {
    isAnime: true,
    searchTitles: titlePool.slice(0, 3),
    imdbId,
    malId,
    absoluteEpisode
  };
  animeContextCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1e3, value: ctx });
  return ctx;
}
async function resolveImdbForTarget(target) {
  if (target.imdbId && target.imdbId.startsWith("tt")) return target.imdbId;
  const key = `${target.kind}:${target.tmdbId}`;
  const cached = tmdbToImdbCache.get(key);
  if (cached) return cached;
  const curated = CURATED_CATALOG.find((c) => c.tmdbId === target.tmdbId);
  if (curated?.imdbId) {
    tmdbToImdbCache.set(key, curated.imdbId);
    return curated.imdbId;
  }
  const pathStr = target.kind === "movie" ? `/movie/${target.tmdbId}/external_ids` : `/tv/${target.tmdbId}/external_ids`;
  const data = await fetchTmdbJson(pathStr, 1500);
  if (data?.imdb_id) {
    tmdbToImdbCache.set(key, data.imdb_id);
    return data.imdb_id;
  }
  return void 0;
}
async function extractWatchPlayPipeline(target, timeoutMs = 1700) {
  const pathSuffix = target.kind === "movie" ? `movie/${target.tmdbId}` : `tvshow/${target.tmdbId}/${target.season}/${target.episode}`;
  const hosts = ["https://v1.watchplay.shop", "https://v2.watchplay.shop"];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  await Promise.allSettled(
    hosts.map(async (host, idx) => {
      const url = `${host}/${pathSuffix}`;
      const res = await fetchWithTimeout(url, {
        referer: "https://playerflix.ink/",
        timeoutMs
      });
      if (res.status !== 200) return;
      const m = res.text.match(/url\s*:\s*["']([^"']+)["']/);
      if (!m) return;
      const streamUrl = m[1].replace(/\\\//g, "/");
      if (!streamUrl.startsWith("http") || seen.has(streamUrl)) return;
      seen.add(streamUrl);
      const audioMatch = res.text.match(/window\.MyPlayerAudio\s*=\s*["']([^"']+)["']/);
      const isDub = !audioMatch || /dub/i.test(audioMatch[1]);
      out.push({
        rawUrl: streamUrl,
        referer: `${host}/`,
        format: streamUrl.includes(".mp4") ? "mp4" : "hls",
        codec: "h264",
        idioma: isDub ? "pt-br" : "en-us",
        qualidade: "720p HD",
        isPtBr: isDub,
        is4k: false,
        priorityBoost: idx === 0 ? 28 : 20
      });
    })
  );
  return { streams: out, subtitles: [] };
}
async function extractPlayerFlixPipeline(target, timeoutMs = 1800) {
  const qs = target.kind === "movie" ? `type=movie&id=${target.tmdbId}` : `type=tv&id=${target.tmdbId}&season=${target.season}&episode=${target.episode}`;
  const ajaxUrl = `https://playerflix.ink/inc/Ajax.php?${qs}`;
  const refererPage = target.kind === "movie" ? `https://playerflix.ink/filme/${target.tmdbId}` : `https://playerflix.ink/serie/${target.tmdbId}/${target.season}/${target.episode}`;
  try {
    const res = await fetchWithTimeout(ajaxUrl, {
      referer: refererPage,
      timeoutMs,
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" }
    });
    const json = JSON.parse(res.text);
    const data = json.data;
    if (!json.status || !data) return { streams: [], subtitles: [] };
    const titleObj = data.title;
    const baseTitle = String(titleObj?.pt || titleObj?.en || "");
    const resolvedTitle = baseTitle && target.kind === "tv" ? `${baseTitle} \xB7 T${target.season}E${target.episode}` : baseTitle || void 0;
    const options = Array.isArray(data.options) ? data.options : [];
    const streams = [];
    const seen = /* @__PURE__ */ new Set();
    await Promise.allSettled(
      options.map(async (opt) => {
        const embed = String(opt.embed ?? "");
        const lang = opt.lang ? String(opt.lang) : "pt-br";
        if (embed.includes("embedplayer2.xyz/video/")) {
          const hash = String(opt.embed_id ?? embed.split("/video/")[1] ?? "");
          if (!hash) return;
          const vRes = await fetchWithTimeout(
            `https://embedplayer2.xyz/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`,
            {
              referer: embed,
              timeoutMs: 1400,
              method: "POST",
              body: `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent("https://playerflix.ink/")}`,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest"
              }
            }
          );
          try {
            const vData = JSON.parse(vRes.text);
            const secured = typeof vData.securedLink === "string" ? vData.securedLink : null;
            const src = typeof vData.videoSource === "string" ? vData.videoSource : null;
            const chosen = secured?.startsWith("http") ? secured : src?.startsWith("http") ? src : null;
            if (chosen && !seen.has(chosen)) {
              seen.add(chosen);
              const isPt = /pt|br/i.test(lang);
              streams.push({
                rawUrl: chosen,
                referer: "https://embedplayer2.xyz/",
                format: "hls",
                codec: "h264",
                idioma: lang,
                qualidade: "720p HD",
                isPtBr: isPt,
                is4k: false,
                priorityBoost: isPt ? 32 : 12,
                resolvedTitle
              });
            }
          } catch {
          }
        }
      })
    );
    return { streams, subtitles: [], resolvedTitle };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
async function extractMultiNodePipeline(target, timeoutMs = 2200) {
  const endpointBase = target.kind === "movie" ? `https://f.rivo.st/api/source/movie/${target.tmdbId}?` : `https://f.rivo.st/api/source/tv/${target.tmdbId}?season=${target.season}&episode=${target.episode}&`;
  const servers = ["6", "1", "5"];
  const streams = [];
  const subtitles = [];
  const seenUrls = /* @__PURE__ */ new Set();
  const seenSubs = /* @__PURE__ */ new Set();
  await Promise.allSettled(
    servers.map(async (srv) => {
      const endpoint2 = `${endpointBase}server=${srv}`;
      const res = await fetchWithTimeout(endpoint2, {
        referer: "https://f.rivo.st/",
        timeoutMs,
        headers: { Accept: "application/json" }
      });
      if (res.status !== 200) return;
      let obj;
      try {
        obj = JSON.parse(res.text);
      } catch {
        return;
      }
      const list = Array.isArray(obj.sources) && obj.sources || Array.isArray(obj.streams) && obj.streams || Array.isArray(obj.data) && obj.data || [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const entry = item;
        const streamUrl = String(entry.url ?? entry.file ?? entry.src ?? "");
        if (!streamUrl.startsWith("http") || seenUrls.has(streamUrl)) continue;
        seenUrls.add(streamUrl);
        const quality = entry.quality ? String(entry.quality) : entry.label ? String(entry.label) : null;
        const isMp4 = streamUrl.includes(".mp4") || entry.kind === "mp4";
        const hevc = isLikelyHevcStream(streamUrl, quality);
        const audioMeta = formatAudioDisplay(entry.lang ? String(entry.lang) : null, quality);
        const is4k = isUltraHdQuality(quality);
        streams.push({
          rawUrl: streamUrl,
          referer: "https://f.rivo.st/",
          format: isMp4 ? "mp4" : "hls",
          codec: hevc ? "h265" : "h264",
          idioma: audioMeta.isPtBr ? "pt-br" : entry.lang ? String(entry.lang) : null,
          qualidade: quality,
          isPtBr: audioMeta.isPtBr,
          is4k,
          priorityBoost: srv === "5" ? 28 : srv === "6" ? 24 : srv === "1" ? 18 : 12
        });
      }
      const subs = Array.isArray(obj.subtitles) ? obj.subtitles : [];
      for (const subItem of subs) {
        if (!subItem || typeof subItem !== "object") continue;
        const sub = subItem;
        const subUrl = String(sub.url ?? sub.file ?? "");
        if (!subUrl.startsWith("http")) continue;
        const rawLang = String(sub.lang ?? "");
        const rawLabel = String(sub.label ?? rawLang);
        const norm = normalizeSubtitleLang(rawLang, rawLabel);
        const dedupeKey = `${norm.lang}::${norm.label}`;
        if (seenSubs.has(dedupeKey)) continue;
        seenSubs.add(dedupeKey);
        subtitles.push({
          rawUrl: subUrl,
          referer: "https://f.rivo.st/",
          lang: norm.lang,
          label: norm.label
        });
      }
    })
  );
  return { streams, subtitles };
}
async function extractHorcruxPipeline(target, timeoutMs = 1500) {
  const url = target.kind === "movie" ? `https://stream.hls.lol/q62?tmdbId=${encodeURIComponent(target.tmdbId)}` : `https://stream.hls.lol/q62?tmdbId=${encodeURIComponent(target.tmdbId)}&season=${target.season}&episode=${target.episode}`;
  try {
    const res = await fetchWithTimeout(url, {
      referer: "https://atlantic.bz/",
      timeoutMs,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
      }
    });
    if (res.status !== 200) return { streams: [], subtitles: [] };
    const json = JSON.parse(res.text);
    const streams = [];
    const subtitles = [];
    for (const rel of json.releases ?? []) {
      const mUrl = rel.master || rel.dash;
      if (!mUrl || !mUrl.startsWith("http")) continue;
      const locales = (rel.audioLocales ?? []).join(" ");
      const isPt = /\b(pt|pt-br|pb|por|brazil)\b/i.test(`${locales} ${rel.title ?? ""}`);
      const is4k = (rel.height ?? 0) >= 2160 || /4k|2160|uhd/i.test(`${rel.resolution ?? ""} ${rel.title ?? ""}`);
      const quality = is4k ? "4K UHD" : rel.height ? `${rel.height}p` : rel.resolution?.includes("1080") ? "1080p" : "720p";
      streams.push({
        rawUrl: mUrl,
        referer: "https://atlantic.bz/",
        format: mUrl.includes(".mp4") ? "mp4" : "hls",
        codec: "h264",
        idioma: isPt ? "pt-br" : rel.audioLocales?.[0] ?? "en-us",
        qualidade: quality,
        isPtBr: isPt,
        is4k,
        priorityBoost: isPt ? 55 : 32
      });
      for (const sub of rel.subtitles ?? []) {
        if (sub.url && sub.url.startsWith("http")) {
          const lcode = (sub.locale || sub.lang || "pt-BR").toLowerCase();
          const isPtSub = /\b(pt|pt-br|pb|por|brazil)\b/i.test(lcode);
          subtitles.push({
            rawUrl: sub.url,
            referer: "https://atlantic.bz/",
            lang: isPtSub ? "pt-br" : lcode,
            label: isPtSub ? "Portugu\xEAs (Brasil)" : lcode.toUpperCase()
          });
        }
      }
    }
    return { streams, subtitles };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
async function extractStremioAddon(opts) {
  const fullUrl = `${opts.baseUrl.replace(/\/$/, "")}${opts.endpointPath}`;
  try {
    const res = await fetchWithTimeout(fullUrl, {
      referer: opts.referer,
      timeoutMs: opts.timeoutMs,
      headers: { Accept: "application/json" }
    });
    if (res.status !== 200) return { streams: [], subtitles: [] };
    const json = JSON.parse(res.text);
    const items = Array.isArray(json.streams) ? json.streams : [];
    if (items.length === 0) return { streams: [], subtitles: [] };
    const streams = [];
    const subtitles = [];
    const seenUrls = /* @__PURE__ */ new Set();
    const seenSubs = /* @__PURE__ */ new Set();
    const candidates = items.slice(0, 32);
    await Promise.allSettled(
      candidates.map(async (st, idx) => {
        if (!st.url || !st.url.startsWith("http")) return;
        if (seenUrls.has(st.url)) return;
        seenUrls.add(st.url);
        const metaText = `${st.name ?? ""} ${st.title ?? ""} ${st.description ?? ""}`;
        const hevc = isLikelyHevcStream(st.url, metaText);
        const proxyReqHeaders = st.behaviorHints?.proxyHeaders?.request;
        const referer = proxyReqHeaders?.Referer || proxyReqHeaders?.referer || opts.referer;
        let format = inferStreamFormatFromUrlOrMeta(st.url, metaText);
        const is4k = /4k|2160p|uhd/i.test(metaText);
        const is1080 = /1080p|fhd/i.test(metaText);
        const is720 = /720p/i.test(metaText);
        const rawQuality = is4k ? "4K UHD" : is1080 ? "1080p Full HD" : is720 ? "720p HD" : "HD";
        const isPt = opts.defaultPtBr || /dublado|pt-br|portugu|🇧🇷|brazil|dual/i.test(metaText) || false;
        const isLegendado = /legendad|sub/i.test(metaText) && !/dublado/i.test(metaText);
        streams.push({
          rawUrl: st.url,
          referer,
          extraHeaders: proxyReqHeaders,
          format,
          codec: hevc ? "h265" : "h264",
          idioma: isPt ? "pt-br" : isLegendado ? "legendado" : "en-us",
          qualidade: rawQuality,
          isPtBr: isPt,
          is4k,
          priorityBoost: opts.priorityBoost - idx * 2 + (is4k ? 10 : 0)
        });
        for (const sub of st.subtitles ?? []) {
          if (!sub.url || !sub.url.startsWith("http")) continue;
          const norm = normalizeSubtitleLang(sub.lang || sub.id || "pt-BR", sub.id || "Portugu\xEAs (BR)");
          const key = `${norm.lang}::${norm.label}`;
          if (seenSubs.has(key)) continue;
          seenSubs.add(key);
          subtitles.push({
            rawUrl: sub.url,
            referer: opts.referer,
            lang: norm.lang,
            label: norm.label
          });
        }
      })
    );
    return { streams, subtitles };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
async function extractAnimesFhdPipeline(ctx, target, timeoutMs = 2600) {
  if (target.kind !== "tv") return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  try {
    const searchResults = await Promise.allSettled(
      ctx.searchTitles.slice(0, 2).map(async (q) => {
        const res = await fetchWithTimeout(
          `https://animesfhd.net/api/series?q=${encodeURIComponent(q)}`,
          { referer: "https://animesfhd.net/", timeoutMs: Math.min(1300, remaining()), headers: { Accept: "application/json" } }
        );
        if (res.status !== 200) return [];
        const json = JSON.parse(res.text);
        return json.series ?? [];
      })
    );
    const flatSeries = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const r of searchResults) {
      if (r.status !== "fulfilled") continue;
      for (const s of r.value) {
        const idStr = String(s.id ?? "");
        if (!idStr || seenIds.has(idStr)) continue;
        seenIds.add(idStr);
        flatSeries.push({
          id: idStr,
          url: `https://animesfhd.net/api/series/${idStr}`,
          title: `${s.title ?? ""} ${s.alt_titles?.split("\n")[0] ?? ""}`.trim()
        });
      }
    }
    const picked = pickTopAnimeCandidates(flatSeries, ctx.searchTitles, target.season, "series", 1);
    const topPick = picked[0];
    if (!topPick) return { streams: [], subtitles: [] };
    const detRes = await fetchWithTimeout(topPick.url, {
      referer: "https://animesfhd.net/",
      timeoutMs: Math.min(1200, remaining()),
      headers: { Accept: "application/json" }
    });
    if (detRes.status !== 200) return { streams: [], subtitles: [] };
    const det = JSON.parse(detRes.text);
    const allVersions = det.versions ?? [];
    const seasonVersions = allVersions.filter((v) => v.season === target.season);
    if (allVersions.length > 0 && seasonVersions.length === 0) {
      return { streams: [], subtitles: [] };
    }
    const targetVersions = seasonVersions.length > 0 ? seasonVersions : [{ series_id: topPick.id, season: target.season, audio: "legendado" }];
    const versionMap = /* @__PURE__ */ new Map();
    for (const v of targetVersions) {
      const sid = String(v.series_id ?? "");
      if (sid && !versionMap.has(sid)) {
        versionMap.set(sid, { seriesId: sid, audio: String(v.audio ?? "legendado") });
      }
    }
    const epIdsToFetch = [];
    await Promise.allSettled(
      [...versionMap.values()].slice(0, 2).map(async (ver) => {
        let eps = ver.seriesId === topPick.id ? det.episodes ?? [] : [];
        if (eps.length === 0) {
          const vr = await fetchWithTimeout(`https://animesfhd.net/api/series/${ver.seriesId}`, {
            referer: "https://animesfhd.net/",
            timeoutMs: Math.min(1100, remaining()),
            headers: { Accept: "application/json" }
          });
          if (vr.status === 200) {
            const vj = JSON.parse(vr.text);
            eps = vj.episodes ?? [];
          }
        }
        const epMatch = eps.find((e) => e.episode_number === target.episode);
        if (epMatch?.id) {
          epIdsToFetch.push({ epId: String(epMatch.id), audio: ver.audio });
        }
      })
    );
    if (epIdsToFetch.length === 0) return { streams: [], subtitles: [] };
    const streams = [];
    await Promise.allSettled(
      epIdsToFetch.map(async ({ epId, audio }) => {
        const er = await fetchWithTimeout(`https://animesfhd.net/api/episodes/${epId}`, {
          referer: "https://animesfhd.net/",
          timeoutMs: Math.min(1100, remaining()),
          headers: { Accept: "application/json" }
        });
        if (er.status !== 200) return;
        const ej = JSON.parse(er.text);
        for (const src of ej.sources ?? []) {
          if (!src.url || !src.url.includes("/api/v/s6")) continue;
          const absUrl = new URL(src.url, "https://animesfhd.net").toString();
          const isDub = /dub/i.test(`${src.audio ?? ""} ${audio}`);
          streams.push({
            rawUrl: absUrl,
            referer: "https://animesfhd.net/",
            format: "hls",
            codec: "h264",
            idioma: isDub ? "pt-br" : "legendado",
            qualidade: "1080p Full HD",
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 72 : 44
          });
        }
      })
    );
    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
async function extractAnimesDigitalPipeline(ctx, target, timeoutMs = 2800) {
  if (target.kind !== "tv") return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  const cacheKey = `ad:${target.tmdbId}:s${target.season}`;
  try {
    let picked = animeSearchPageCache.get(cacheKey);
    if (!picked || picked.expiresAt <= Date.now()) {
      const searchHits = await Promise.allSettled(
        ctx.searchTitles.slice(0, 2).map(async (q) => {
          const r = await fetchWithTimeout(
            `https://animesdigital.org/?s=${encodeURIComponent(q)}`,
            { referer: "https://animesdigital.org/", timeoutMs: Math.min(1300, remaining()) }
          );
          if (r.status !== 200) return [];
          const out = [];
          const regex = /<a[^>]+href="(https:\/\/animesdigital\.org\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
          for (const m of r.text.matchAll(regex)) {
            const url = m[1];
            const slugTitle = url.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "";
            const innerTitle = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            out.push({ url, title: innerTitle.length > 3 ? innerTitle : slugTitle });
          }
          return out;
        })
      );
      const allCandidates = [];
      const seen = /* @__PURE__ */ new Set();
      for (const res of searchHits) {
        if (res.status !== "fulfilled") continue;
        for (const c of res.value) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            allCandidates.push(c);
          }
        }
      }
      const chosen = pickTopAnimeCandidates(allCandidates, ctx.searchTitles, target.season, "series", 1);
      if (chosen.length === 0) return { streams: [], subtitles: [] };
      picked = {
        expiresAt: Date.now() + 30 * 60 * 1e3,
        value: chosen.map((c) => ({ url: c.url, title: c.title, audioKind: c.audioKind }))
      };
      animeSearchPageCache.set(cacheKey, picked);
    }
    const streams = [];
    const seenM3u8 = /* @__PURE__ */ new Set();
    await Promise.allSettled(
      picked.value.map(async (animePage) => {
        const ar = await fetchWithTimeout(animePage.url, {
          referer: "https://animesdigital.org/",
          timeoutMs: Math.min(1200, remaining())
        });
        if (ar.status !== 200) return;
        const epEntries = [];
        const epRegex = /<a[^>]+href="(https:\/\/animesdigital\.org\/video\/a\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        for (const m of ar.text.matchAll(epRegex)) {
          epEntries.push({
            url: m[1],
            text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          });
        }
        const pageSeason = extractSeasonHint(animePage.title, ctx.searchTitles);
        const requireAbsoluteOnly = target.season > 1 && pageSeason !== target.season;
        const matchedEp = matchExactEpisode(epEntries, target.episode, ctx.absoluteEpisode, requireAbsoluteOnly);
        if (!matchedEp) return;
        const vr = await fetchWithTimeout(matchedEp.url, {
          referer: animePage.url,
          timeoutMs: Math.min(1200, remaining())
        });
        if (vr.status !== 200) return;
        const m3u8Urls = extractAnivideoM3u8Urls(vr.text);
        const isDub = animePage.audioKind === "dublado" || detectTitleAudioKind(animePage.title) === "dublado";
        for (const mUrl of m3u8Urls) {
          if (seenM3u8.has(mUrl)) continue;
          seenM3u8.add(mUrl);
          streams.push({
            rawUrl: mUrl,
            referer: "https://api.anivideo.net/",
            format: "hls",
            codec: "h264",
            idioma: isDub ? "pt-br" : "legendado",
            qualidade: "720p HD",
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 68 : 42
          });
        }
      })
    );
    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
async function extractAniTubePipeline(ctx, target, timeoutMs = 2800) {
  if (target.kind !== "tv") return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  const cacheKey = `at:${target.tmdbId}:s${target.season}`;
  try {
    let picked = animeSearchPageCache.get(cacheKey);
    if (!picked || picked.expiresAt <= Date.now()) {
      const searchHits = await Promise.allSettled(
        ctx.searchTitles.slice(0, 2).map(async (q) => {
          const r = await fetchWithTimeout(
            `https://www.anitube.zip/?s=${encodeURIComponent(q)}`,
            { referer: "https://www.anitube.zip/", timeoutMs: Math.min(1300, remaining()) }
          );
          if (r.status !== 200) return [];
          const out = [];
          const regex = /<a[^>]+href="(https:\/\/www\.anitube\.zip\/video\/\d+\/?)"[^>]*title="([^"]+)"/gi;
          for (const m of r.text.matchAll(regex)) {
            out.push({ url: m[1], title: m[2] });
          }
          return out;
        })
      );
      const allCandidates = [];
      const seen = /* @__PURE__ */ new Set();
      for (const res of searchHits) {
        if (res.status !== "fulfilled") continue;
        for (const c of res.value) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            allCandidates.push(c);
          }
        }
      }
      const chosen = pickTopAnimeCandidates(allCandidates, ctx.searchTitles, target.season, "series", 1);
      if (chosen.length === 0) return { streams: [], subtitles: [] };
      picked = {
        expiresAt: Date.now() + 30 * 60 * 1e3,
        value: chosen.map((c) => ({ url: c.url, title: c.title, audioKind: c.audioKind }))
      };
      animeSearchPageCache.set(cacheKey, picked);
    }
    const streams = [];
    const seenM3u8 = /* @__PURE__ */ new Set();
    await Promise.allSettled(
      picked.value.map(async (seriesPage) => {
        const sr = await fetchWithTimeout(seriesPage.url, {
          referer: "https://www.anitube.zip/",
          timeoutMs: Math.min(1200, remaining())
        });
        if (sr.status !== 200) return;
        const epEntries = [];
        const epRegex = /<a[^>]+href="(https:\/\/www\.anitube\.zip\/video\/\d+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
        for (const m of sr.text.matchAll(epRegex)) {
          if (m[1] === seriesPage.url) continue;
          epEntries.push({
            url: m[1],
            text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          });
        }
        const pageSeason = extractSeasonHint(seriesPage.title, ctx.searchTitles);
        const requireAbsoluteOnly = target.season > 1 && pageSeason !== target.season;
        const matchedEp = matchExactEpisode(epEntries, target.episode, ctx.absoluteEpisode, requireAbsoluteOnly);
        if (!matchedEp) return;
        const vr = await fetchWithTimeout(matchedEp.url, {
          referer: seriesPage.url,
          timeoutMs: Math.min(1200, remaining())
        });
        if (vr.status !== 200) return;
        const m3u8Urls = extractAnivideoM3u8Urls(vr.text);
        const isDub = seriesPage.audioKind === "dublado" || detectTitleAudioKind(seriesPage.title) === "dublado";
        for (const mUrl of m3u8Urls) {
          if (seenM3u8.has(mUrl)) continue;
          seenM3u8.add(mUrl);
          streams.push({
            rawUrl: mUrl,
            referer: "https://api.anivideo.net/",
            format: "hls",
            codec: "h264",
            idioma: isDub ? "pt-br" : "legendado",
            qualidade: "720p HD",
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 66 : 40
          });
        }
      })
    );
    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
async function extractAnrollPipeline(ctx, target, timeoutMs = 2900) {
  if (target.kind !== "tv") return { streams: [], subtitles: [] };
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(450, deadline - Date.now());
  const cacheKey = `ar:${target.tmdbId}:s${target.season}`;
  try {
    let picked = animeSearchPageCache.get(cacheKey);
    if (!picked || picked.expiresAt <= Date.now()) {
      const searchHits = await Promise.allSettled(
        ctx.searchTitles.slice(0, 2).map(async (q) => {
          const r = await fetchWithTimeout(
            `https://anroll.cc/?s=${encodeURIComponent(q)}`,
            { referer: "https://anroll.cc/", timeoutMs: Math.min(1300, remaining()) }
          );
          if (r.status !== 200) return [];
          const out = [];
          const regex = /<a[^>]+href=["'](https:\/\/anroll\.cc\/animes\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          for (const m of r.text.matchAll(regex)) {
            const url = m[1];
            if (url.endsWith("/animes/")) continue;
            const slugTitle = url.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "";
            const innerTitle = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            out.push({ url, title: innerTitle.length > 3 ? innerTitle : slugTitle });
          }
          return out;
        })
      );
      const allCandidates = [];
      const seen = /* @__PURE__ */ new Set();
      for (const res of searchHits) {
        if (res.status !== "fulfilled") continue;
        for (const c of res.value) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            allCandidates.push(c);
          }
        }
      }
      const chosen = pickTopAnimeCandidates(allCandidates, ctx.searchTitles, target.season, "series", 1);
      if (chosen.length === 0) return { streams: [], subtitles: [] };
      picked = {
        expiresAt: Date.now() + 30 * 60 * 1e3,
        value: chosen.map((c) => ({ url: c.url, title: c.title, audioKind: c.audioKind }))
      };
      animeSearchPageCache.set(cacheKey, picked);
    }
    const streams = [];
    const seenMp4 = /* @__PURE__ */ new Set();
    await Promise.allSettled(
      picked.value.map(async (animePage) => {
        const ar = await fetchWithTimeout(animePage.url, {
          referer: "https://anroll.cc/",
          timeoutMs: Math.min(1200, remaining())
        });
        if (ar.status !== 200) return;
        const epEntries = [];
        const epRegex = /<a[^>]+href=["'](https:\/\/anroll\.cc\/episodios\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        for (const m of ar.text.matchAll(epRegex)) {
          epEntries.push({
            url: m[1],
            text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          });
        }
        const pageSeason = extractSeasonHint(animePage.title, ctx.searchTitles);
        const requireAbsoluteOnly = target.season > 1 && pageSeason !== target.season;
        const matchedEp = matchExactEpisode(epEntries, target.episode, ctx.absoluteEpisode, requireAbsoluteOnly);
        if (!matchedEp) return;
        const er = await fetchWithTimeout(matchedEp.url, {
          referer: animePage.url,
          timeoutMs: Math.min(1100, remaining())
        });
        if (er.status !== 200) return;
        const optMatch = er.text.match(
          /data-type=["']([^"']+)["']\s+data-post=["'](\d+)["']\s+data-nume=["']([^"']+)["']/i
        );
        if (!optMatch) return;
        const dpRes = await fetchWithTimeout(
          `https://anroll.cc/wp-json/dooplayer/v2/${optMatch[2]}/${optMatch[1]}/${optMatch[3]}`,
          { referer: matchedEp.url, timeoutMs: Math.min(1e3, remaining()), headers: { Accept: "application/json" } }
        );
        if (dpRes.status !== 200) return;
        const dpJson = JSON.parse(dpRes.text);
        if (!dpJson.embed_url) return;
        const bloggerUrl = decodeAnrollBloggerSource(dpJson.embed_url);
        if (!bloggerUrl || !bloggerUrl.includes("blogger.com")) return;
        const br = await fetchWithTimeout(bloggerUrl, {
          referer: "https://www.blogger.com/",
          timeoutMs: Math.min(1100, remaining())
        });
        if (br.status !== 200) return;
        const mp4Options = extractBloggerMp4Urls(br.text);
        const isDub = animePage.audioKind === "dublado" || detectTitleAudioKind(animePage.title) === "dublado";
        for (const mp4 of mp4Options.slice(0, 1)) {
          if (seenMp4.has(mp4.url)) continue;
          seenMp4.add(mp4.url);
          streams.push({
            rawUrl: mp4.url,
            referer: "https://www.blogger.com/",
            format: "mp4",
            codec: "h264",
            idioma: isDub ? "pt-br" : "legendado",
            qualidade: mp4.quality,
            isPtBr: isDub,
            is4k: false,
            priorityBoost: isDub ? 56 : 32
          });
        }
      })
    );
    return { streams, subtitles: [] };
  } catch {
    return { streams: [], subtitles: [] };
  }
}
var hostHealthMap = /* @__PURE__ */ new Map();
function recordHostHealth(rawUrl, ok, latencyMs) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const prev = hostHealthMap.get(host) ?? { ok: 0, fail: 0, avgMs: latencyMs, lastFailAt: 0 };
    if (ok) {
      prev.ok += 1;
      prev.avgMs = Math.round(prev.avgMs * 0.6 + latencyMs * 0.4);
    } else {
      prev.fail += 1;
      prev.lastFailAt = Date.now();
    }
    hostHealthMap.set(host, prev);
  } catch {
  }
}
function getHostPenaltyBoost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const h = hostHealthMap.get(host);
    if (!h) return 0;
    const total = h.ok + h.fail;
    if (total === 0) return 0;
    const failRatio = h.fail / total;
    if (failRatio > 0.65 && Date.now() - h.lastFailAt < 18e4) return -60;
    if (h.ok >= 2 && failRatio < 0.25) return 20;
    return 0;
  } catch {
    return 0;
  }
}
async function readHeadBytesWithTimeout(url, headers, timeoutMs, maxBytes = 4096) {
  const controller = new AbortController();
  const timer2 = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal
    });
    const contentType = res.headers.get("content-type") ?? "";
    const finalUrl = res.url || url;
    if (!res.ok && res.status !== 206) {
      try {
        await res.body?.cancel();
      } catch {
      }
      return { ok: false, status: res.status, finalUrl, contentType, bytes: new Uint8Array(0) };
    }
    const chunks = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (total < maxBytes) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const remaining = maxBytes - total;
          const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
          chunks.push(slice);
          total += slice.byteLength;
          if (total >= maxBytes) {
            await reader.cancel().catch(() => {
            });
            break;
          }
        }
      } catch {
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { ok: true, status: res.status, finalUrl, contentType, bytes: merged };
  } catch {
    return { ok: false, status: 0, finalUrl: url, contentType: "", bytes: new Uint8Array(0) };
  } finally {
    clearTimeout(timer2);
  }
}
async function verifyStreamCandidate(st) {
  if (!isSafeExternalUrl(st.rawUrl)) return null;
  if (st.rawUrl.includes("fenixhub.online") || st.rawUrl.includes("fenixflix")) {
    return {
      ...st,
      format: "mp4",
      codec: st.codec || "h264",
      verified: true,
      latencyMs: 120
    };
  }
  const t0 = Date.now();
  const baseHeaders = {
    "User-Agent": DEFAULT_UA,
    Range: "bytes=0-16383",
    ...st.extraHeaders ?? {}
  };
  if (st.referer && !baseHeaders.Referer && !baseHeaders.referer) {
    baseHeaders.Referer = st.referer;
    try {
      if (!baseHeaders.Origin && !baseHeaders.origin) {
        baseHeaders.Origin = new URL(st.referer).origin;
      }
    } catch {
    }
  }
  const hostPenalty = getHostPenaltyBoost(st.rawUrl);
  const probeTimeout = hostPenalty < 0 ? 1100 : 1550;
  const head = await readHeadBytesWithTimeout(st.rawUrl, baseHeaders, probeTimeout, 16384);
  const latencyMs = Date.now() - t0;
  if (!head.ok || head.bytes.byteLength < 8) {
    recordHostHealth(st.rawUrl, false, latencyMs);
    return null;
  }
  const ctLower = head.contentType.toLowerCase();
  const finalLower = head.finalUrl.toLowerCase();
  const textSample = new TextDecoder("utf-8", { fatal: false }).decode(head.bytes);
  const trimmedText = textSample.replace(/^\uFEFF/, "").trimStart();
  if (trimmedText.startsWith("<!") || trimmedText.startsWith("<html") || trimmedText.startsWith("{")) {
    recordHostHealth(st.rawUrl, false, latencyMs);
    return null;
  }
  let detectedQualidade = st.qualidade;
  let detectedIs4k = st.is4k;
  let detectedBitrateBps;
  let detectedWidth;
  let detectedHeight;
  if (trimmedText.startsWith("#EXTM3U") || /\n#EXTM3U/.test(trimmedText)) {
    const hlsHevc = /codecs="[^"]*(hvc1|hev1)/i.test(textSample) || st.codec === "h265";
    const masterDims = parseHlsMasterMaxDimensions(trimmedText);
    if (masterDims) {
      detectedQualidade = masterDims.meta.quality;
      detectedIs4k = masterDims.meta.is4k;
      detectedWidth = masterDims.meta.width;
      detectedHeight = masterDims.meta.height;
      if (masterDims.bandwidth > 0) detectedBitrateBps = masterDims.bandwidth;
    }
    const pickFirstPlayableLine = (playlistText, truncated) => {
      const rawLines = playlistText.split(/\r?\n/);
      const safeLines = truncated && rawLines.length > 1 ? rawLines.slice(0, -1) : rawLines;
      return safeLines.map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
    };
    const hop1Line = pickFirstPlayableLine(trimmedText, head.bytes.byteLength >= 16384);
    if (hop1Line) {
      try {
        const hop1Url = new URL(hop1Line, head.finalUrl).toString();
        const hop1Probe = await readHeadBytesWithTimeout(hop1Url, baseHeaders, 1500, 16384);
        if (!hop1Probe.ok || hop1Probe.bytes.byteLength < 8) {
          recordHostHealth(st.rawUrl, false, Date.now() - t0);
          return null;
        }
        const hop1Text = new TextDecoder("utf-8", { fatal: false }).decode(hop1Probe.bytes).replace(/^\uFEFF/, "").trimStart();
        if (hop1Text.startsWith("<!") || hop1Text.startsWith("<html") || hop1Text.startsWith("{")) {
          recordHostHealth(st.rawUrl, false, Date.now() - t0);
          return null;
        }
        if (hop1Text.startsWith("#EXTM3U") || /\n#EXTM3U/.test(hop1Text)) {
          const segLine = pickFirstPlayableLine(hop1Text, hop1Probe.bytes.byteLength >= 16384);
          if (!segLine) {
            recordHostHealth(st.rawUrl, false, Date.now() - t0);
            return null;
          }
          const segUrl = new URL(segLine, hop1Probe.finalUrl).toString();
          const segProbe = await readHeadBytesWithTimeout(
            segUrl,
            { ...baseHeaders, Range: "bytes=0-16383" },
            1350,
            16384
          );
          if (!segProbe.ok || segProbe.bytes.byteLength < 8) {
            recordHostHealth(st.rawUrl, false, Date.now() - t0);
            return null;
          }
          const segText = new TextDecoder("utf-8", { fatal: false }).decode(segProbe.bytes).trimStart();
          if (segText.startsWith("<!") || segText.startsWith("<html")) {
            recordHostHealth(st.rawUrl, false, Date.now() - t0);
            return null;
          }
          if (!masterDims) {
            const spsMeta = parseH264SpsFromSegmentBytes(segProbe.bytes);
            if (spsMeta) {
              detectedQualidade = spsMeta.quality;
              detectedIs4k = spsMeta.is4k;
              detectedWidth = spsMeta.width;
              detectedHeight = spsMeta.height;
            }
          }
        } else if (!masterDims) {
          const spsMeta = parseH264SpsFromSegmentBytes(hop1Probe.bytes);
          if (spsMeta) {
            detectedQualidade = spsMeta.quality;
            detectedIs4k = spsMeta.is4k;
            detectedWidth = spsMeta.width;
            detectedHeight = spsMeta.height;
          }
        }
      } catch {
        recordHostHealth(st.rawUrl, false, Date.now() - t0);
        return null;
      }
    }
    const totalLatency = Date.now() - t0;
    recordHostHealth(st.rawUrl, true, totalLatency);
    return {
      ...st,
      format: "hls",
      codec: hlsHevc ? "h265" : "h264",
      qualidade: detectedQualidade,
      is4k: detectedIs4k,
      bitrateBps: detectedBitrateBps,
      videoWidth: detectedWidth,
      videoHeight: detectedHeight,
      verified: true,
      latencyMs: totalLatency,
      priorityBoost: st.priorityBoost + hostPenalty
    };
  }
  const sig = detectStreamFormat(ctLower, head.bytes);
  const looksMp4 = sig.formato === "mp4" || ctLower.includes("video/mp4") || finalLower.includes(".mp4");
  if (looksMp4) {
    const mp4Codec = detectMp4CodecFromBytes(head.bytes);
    const resolvedCodec = mp4Codec !== "unknown" ? mp4Codec : st.codec;
    const mp4Dims = parseMp4TkhdDimensions(head.bytes);
    if (mp4Dims) {
      detectedQualidade = mp4Dims.quality;
      detectedIs4k = mp4Dims.is4k;
      detectedWidth = mp4Dims.width;
      detectedHeight = mp4Dims.height;
    }
    recordHostHealth(st.rawUrl, true, latencyMs);
    return {
      ...st,
      format: "mp4",
      codec: resolvedCodec,
      qualidade: detectedQualidade,
      is4k: detectedIs4k,
      videoWidth: detectedWidth,
      videoHeight: detectedHeight,
      verified: true,
      latencyMs,
      priorityBoost: st.priorityBoost + hostPenalty
    };
  }
  recordHostHealth(st.rawUrl, false, latencyMs);
  return null;
}
async function verifyStreamsBatch(candidates) {
  if (candidates.length === 0) return [];
  const results = await Promise.all(
    candidates.map((c) => verifyStreamCandidate(c))
  );
  return results.filter((x) => x !== null);
}
var activeJobs = /* @__PURE__ */ new Map();
function buildAnonymizedSnapshot(rawStreams, rawSubs, startedAt2, cached, resolvedTitle) {
  const dedupedStreams = [];
  const seenUrl = /* @__PURE__ */ new Set();
  for (const st of rawStreams) {
    if (!seenUrl.has(st.rawUrl)) {
      seenUrl.add(st.rawUrl);
      dedupedStreams.push(st);
    }
  }
  const ranked = sortBrowserCompatibleFirst(
    dedupedStreams.map((s) => ({
      ...s,
      url: s.rawUrl,
      formato: s.format
    }))
  );
  const h264Only = ranked.filter((r) => r.codec !== "h265");
  const hevcTail = ranked.filter((r) => r.codec === "h265");
  const curatedSelection = [...h264Only, ...hevcTail].slice(0, 64);
  const anonymizedStreams = curatedSelection.map((item, idx) => {
    const streamId = registerStream(item.rawUrl, item.referer, item.format, item.extraHeaders);
    const qMeta = formatQualityDisplay(item.qualidade);
    const aMeta = formatAudioDisplay(item.idioma, item.qualidade);
    const ext = item.format === "mp4" ? "media.mp4" : "master.m3u8";
    return {
      id: streamId,
      label: `Servidor ${idx + 1}`,
      audio: aMeta.audio,
      quality: qMeta.quality,
      codec: item.codec,
      format: item.format,
      isPtBr: aMeta.isPtBr || item.isPtBr,
      is4k: qMeta.is4k || item.is4k,
      streamUrl: `/api/stream/${streamId}/${ext}`
    };
  });
  const subMap = /* @__PURE__ */ new Map();
  for (const sub of rawSubs) {
    const key = `${sub.lang}::${sub.label}`;
    if (!subMap.has(key)) subMap.set(key, sub);
  }
  const sortedSubs = [...subMap.values()].sort((a, b) => {
    const ra = normalizeSubtitleLang(a.lang, a.label).rank;
    const rb = normalizeSubtitleLang(b.lang, b.label).rank;
    return rb - ra;
  });
  const anonymizedSubtitles = sortedSubs.slice(0, 14).map((sub) => {
    const subId = registerSubtitle(sub.rawUrl, sub.referer, sub.lang, sub.label, sub.extraHeaders);
    return {
      id: subId,
      lang: sub.lang,
      label: sub.label,
      trackUrl: `/api/subtitle/${subId}.vtt`
    };
  });
  return {
    elapsedMs: Date.now() - startedAt2,
    cached,
    resolvedTitle,
    streams: anonymizedStreams,
    subtitles: anonymizedSubtitles
  };
}
function launchAllPipelines(parsed, imdbPromise, onBatch) {
  const runAndVerify = async (task) => {
    try {
      const res = await task;
      const verifiedStreams = await verifyStreamsBatch(res.streams);
      if (verifiedStreams.length > 0 || res.subtitles.length > 0 || res.resolvedTitle) {
        onBatch({
          streams: verifiedStreams,
          subtitles: res.subtitles,
          resolvedTitle: res.resolvedTitle
        });
      }
    } catch {
    }
  };
  const tier1Tasks = [
    runAndVerify(extractWatchPlayPipeline(parsed, 1500)),
    runAndVerify(extractHorcruxPipeline(parsed, 1200)),
    runAndVerify(extractMultiNodePipeline(parsed, 2200)),
    runAndVerify(extractPlayerFlixPipeline(parsed, 1600))
  ];
  const tier2Task = imdbPromise.then(async (imdbId) => {
    if (!imdbId) return;
    const candidatePaths = [];
    if (parsed.kind === "movie") {
      candidatePaths.push(`/stream/movie/${imdbId}.json`);
    } else {
      candidatePaths.push(`/stream/series/${imdbId}:${parsed.season}:${parsed.episode}.json`);
      if (parsed.episode >= 50 && parsed.season !== 1) {
        candidatePaths.push(`/stream/series/${imdbId}:1:${parsed.episode}.json`);
      }
    }
    const imdbTasks = [];
    for (const epPath of candidatePaths) {
      imdbTasks.push(
        runAndVerify(
          extractStremioAddon({
            baseUrl: "https://veyra.shardweb.app",
            endpointPath: epPath,
            referer: "https://veyra.shardweb.app/",
            timeoutMs: 2100,
            priorityBoost: 62,
            defaultPtBr: true
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: "https://da5f663b4690-kingvod.baby-beamup.club",
            endpointPath: epPath,
            referer: "https://da5f663b4690-kingvod.baby-beamup.club/",
            timeoutMs: 1700,
            priorityBoost: 54,
            defaultPtBr: true
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: "https://brazuca-play-stremio-y3wf.onrender.com",
            endpointPath: epPath,
            referer: "https://brazuca-play-stremio-y3wf.onrender.com/",
            timeoutMs: 2600,
            priorityBoost: 56,
            defaultPtBr: true
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: "https://zeus-br.shardweb.app/v1-pnv9b-q3j-a1-mb-c0",
            endpointPath: epPath,
            referer: "https://zeus-br.shardweb.app/",
            timeoutMs: 1400,
            priorityBoost: 40,
            defaultPtBr: true
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: "https://da5f663b4690-superstream.baby-beamup.club",
            endpointPath: epPath,
            referer: "https://da5f663b4690-superstream.baby-beamup.club/",
            timeoutMs: 1400,
            priorityBoost: 16
          })
        ),
        runAndVerify(
          extractStremioAddon({
            baseUrl: "https://fenixflix.fenixhub.online",
            endpointPath: epPath,
            referer: "https://fenixflix.fenixhub.online/",
            timeoutMs: 7500,
            priorityBoost: 60,
            defaultPtBr: true
          })
        )
      );
    }
    await Promise.allSettled(imdbTasks);
  });
  const animeTask = parsed.kind === "tv" ? resolveAnimeContext(parsed).then(async (ctx) => {
    if (!ctx || !ctx.isAnime) return;
    await Promise.allSettled([
      runAndVerify(extractAnimesFhdPipeline(ctx, parsed, 2800)),
      runAndVerify(extractAnimesDigitalPipeline(ctx, parsed, 2800)),
      runAndVerify(extractAniTubePipeline(ctx, parsed, 2800)),
      runAndVerify(extractAnrollPipeline(ctx, parsed, 2900))
    ]);
  }) : Promise.resolve();
  return Promise.allSettled([...tier1Tasks, tier2Task, animeTask]).then(() => {
  });
}
var TMDB_GENRE_MAP_PT = {
  28: "A\xE7\xE3o",
  12: "Aventura",
  16: "Anima\xE7\xE3o",
  35: "Com\xE9dia",
  80: "Crime",
  99: "Document\xE1rio",
  18: "Drama",
  10751: "Fam\xEDlia",
  14: "Fantasia",
  36: "Hist\xF3ria",
  27: "Terror",
  10402: "M\xFAsica",
  9648: "Mist\xE9rio",
  10749: "Romance",
  878: "Fic\xE7\xE3o Cient\xEDfica",
  53: "Suspense",
  10752: "Guerra",
  37: "Faroeste",
  10759: "A\xE7\xE3o e Aventura",
  10765: "Fic\xE7\xE3o e Fantasia"
};
function assignStudioNetwork(seed) {
  const networks = ["Netflix", "Prime Video", "Disney+", "Apple TV+", "HBO Max", "Paramount+", "Crunchyroll", "Starz"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = hash * 31 + seed.charCodeAt(i) >>> 0;
  return networks[hash % networks.length];
}
function mapProviderNameToNetwork(providerName) {
  const lower = providerName.toLowerCase();
  if (lower.includes("netflix")) return "Netflix";
  if (lower.includes("amazon") || lower.includes("prime")) return "Prime Video";
  if (lower.includes("disney")) return "Disney+";
  if (lower.includes("apple")) return "Apple TV+";
  if (lower.includes("max") || lower.includes("hbo")) return "HBO Max";
  if (lower.includes("paramount")) return "Paramount+";
  if (lower.includes("crunchyroll")) return "Crunchyroll";
  if (lower.includes("starz")) return "Starz";
  return providerName;
}
function mapTmdbSummaryToMediaTitle(raw, forceType) {
  const rawType = raw.media_type === "tv" ? "series" : raw.media_type === "movie" ? "movie" : void 0;
  const type = forceType ?? rawType ?? (raw.first_air_date ? "series" : "movie");
  const tmdbId = String(raw.id ?? "");
  const curated = CURATED_CATALOG.find((c) => c.tmdbId === tmdbId && c.mediaType === type);
  if (curated) return curated;
  const title = String(raw.title || raw.name || "Sem t\xEDtulo");
  const originalTitle = String(raw.original_title || raw.original_name || title);
  const dateStr = String(raw.release_date || raw.first_air_date || "2025");
  const year = dateStr.slice(0, 4) || "2025";
  const genreIds = Array.isArray(raw.genre_ids) ? raw.genre_ids : [];
  const genres = genreIds.map((id) => TMDB_GENRE_MAP_PT[id]).filter(Boolean).slice(0, 3);
  if (genres.length === 0) genres.push("Cinema");
  const vote = typeof raw.vote_average === "number" && raw.vote_average > 0 ? raw.vote_average.toFixed(1) : "7.6";
  const posterPath = typeof raw.poster_path === "string" ? `${TMDB_IMG}/w500${raw.poster_path}` : "";
  const backdropPath = typeof raw.backdrop_path === "string" ? `${TMDB_IMG}/w1280${raw.backdrop_path}` : posterPath;
  const isKidFriendly = genres.some((g) => /animação|família|kids|infantil/i.test(g)) || genreIds.includes(16) || genreIds.includes(10751) || genreIds.includes(10762);
  return {
    id: `tmdb-${type}-${tmdbId}`,
    imdbId: "",
    tmdbId,
    mediaType: type,
    title,
    originalTitle,
    year,
    runtime: type === "series" ? "45m / ep" : "2h 00m",
    runtimeMinutes: type === "series" ? 45 : 120,
    rating: vote,
    ageRating: raw.adult ? "18" : isKidFriendly ? "L" : "14",
    qualityBadge: "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres,
    network: assignStudioNetwork(tmdbId),
    director: "Produ\xE7\xE3o Original",
    cast: [],
    overview: String(raw.overview || "Dispon\xEDvel para reprodu\xE7\xE3o imediata em alta defini\xE7\xE3o com \xE1udio em portugu\xEAs."),
    poster: posterPath || "/src/assets/images/poster_nyc_winter_1794566231280.jpg",
    backdrop: backdropPath || "/src/assets/images/cinelume_hero_cinema_1794566229858.jpg",
    defaultSeason: 1,
    defaultEpisode: 1
  };
}
async function fetchTmdbSeasonEpisodes(tmdbId, season) {
  const key = `${tmdbId}:s${season}`;
  const hit = seasonCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const data = await fetchTmdbJson(`/tv/${tmdbId}/season/${season}?language=pt-BR`, 2200);
  const eps = (data?.episodes ?? []).map((ep) => ({
    id: `${tmdbId}-s${season}-e${ep.episode_number ?? 1}`,
    season,
    episode: ep.episode_number ?? 1,
    title: ep.name || `Epis\xF3dio ${ep.episode_number ?? 1}`,
    overview: ep.overview || `Temporada ${season}, Epis\xF3dio ${ep.episode_number ?? 1}.`,
    released: ep.air_date,
    thumbnail: ep.still_path ? `${TMDB_IMG}/w500${ep.still_path}` : void 0,
    runtime: typeof ep.runtime === "number" && ep.runtime > 0 ? ep.runtime : void 0
  }));
  if (eps.length > 0) {
    seasonCache.set(key, { expiresAt: Date.now() + META_CACHE_TTL_MS, value: eps });
  }
  return eps;
}
async function fetchTmdbDetailTitle(type, tmdbId) {
  const cacheKey = `tmdb-detail:${type}:${tmdbId}`;
  const hit = metaCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const tmdbType = type === "series" ? "tv" : "movie";
  const append = type === "movie" ? "images,credits,external_ids,release_dates,watch/providers" : "images,credits,external_ids,content_ratings,watch/providers";
  const [detail, s1Episodes] = await Promise.all([
    fetchTmdbJson(
      `/${tmdbType}/${tmdbId}?language=pt-BR&append_to_response=${append}&include_image_language=pt,en,null`,
      2400
    ),
    type === "series" ? fetchTmdbSeasonEpisodes(tmdbId, 1) : Promise.resolve([])
  ]);
  if (!detail || !detail.id) return null;
  const curated = CURATED_CATALOG.find((c) => c.tmdbId === String(detail.id) && c.mediaType === type);
  const ext = detail.external_ids ?? {};
  const imdbId = String(ext.imdb_id || curated?.imdbId || "");
  if (imdbId) tmdbToImdbCache.set(`${type}:${detail.id}`, imdbId);
  const images = detail.images ?? {};
  const pngLogos = (images.logos ?? []).filter(
    (l) => l.file_path && !l.file_path.endsWith(".svg")
  );
  const ptLogo = pngLogos.find((l) => l.iso_639_1 === "pt") ?? pngLogos[0] ?? images.logos?.[0];
  const logoUrl = ptLogo?.file_path ? `${TMDB_IMG}/w500${ptLogo.file_path}` : curated?.logo;
  const credits = detail.credits ?? {};
  const castProfiles = (credits.cast ?? []).slice(0, 10).map((c) => ({
    name: c.name || "Ator",
    character: c.character,
    avatar: c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : void 0
  }));
  const directorCrew = (credits.crew ?? []).find((c) => c.job === "Director");
  const createdBy = Array.isArray(detail.created_by) ? detail.created_by[0]?.name : void 0;
  const director = directorCrew?.name || createdBy || curated?.director || "Produ\xE7\xE3o Original";
  const genresRaw = Array.isArray(detail.genres) ? detail.genres.map(
    (g) => g.id && TMDB_GENRE_MAP_PT[g.id] || g.name || ""
  ).filter(Boolean) : curated?.genres ?? ["Cinema"];
  const runtimeMins = typeof detail.runtime === "number" && detail.runtime > 0 ? detail.runtime : Array.isArray(detail.episode_run_time) && typeof detail.episode_run_time[0] === "number" ? detail.episode_run_time[0] : curated?.runtimeMinutes ?? (type === "series" ? 45 : 120);
  const providersObj = detail["watch/providers"]?.results?.BR?.flatrate;
  const rawNetwork = Array.isArray(detail.networks) && detail.networks[0]?.name || providersObj?.[0]?.provider_name || curated?.network || assignStudioNetwork(String(detail.id));
  let ageRating = curated?.ageRating ?? "14";
  if (type === "movie") {
    const rels = detail.release_dates?.results ?? [];
    const br = rels.find((r) => r.iso_3166_1 === "BR") ?? rels.find((r) => r.iso_3166_1 === "US");
    const cert = br?.release_dates?.find((d) => d.certification)?.certification;
    if (cert) ageRating = cert;
  } else {
    const cr = detail.content_ratings?.results ?? [];
    const br = cr.find((r) => r.iso_3166_1 === "BR") ?? cr.find((r) => r.iso_3166_1 === "US");
    if (br?.rating) ageRating = br.rating;
  }
  const title = String(detail.title || detail.name || curated?.title || "Sem t\xEDtulo");
  const dateStr = String(detail.release_date || detail.first_air_date || curated?.year || "2025");
  const merged = {
    id: curated?.id || `tmdb-${type}-${detail.id}`,
    imdbId,
    tmdbId: String(detail.id),
    mediaType: type,
    title,
    originalTitle: String(detail.original_title || detail.original_name || title),
    year: dateStr.slice(0, 4),
    runtime: type === "series" ? `${runtimeMins}m / ep` : runtimeMins >= 60 ? `${Math.floor(runtimeMins / 60)}h ${runtimeMins % 60}m` : `${runtimeMins}m`,
    runtimeMinutes: runtimeMins,
    rating: typeof detail.vote_average === "number" && detail.vote_average > 0 ? detail.vote_average.toFixed(1) : curated?.rating ?? "7.8",
    ageRating,
    qualityBadge: curated?.qualityBadge ?? "4K UHD",
    audioBadge: "PT-BR \xB7 Dual \xC1udio",
    genres: genresRaw.slice(0, 3),
    network: mapProviderNameToNetwork(rawNetwork),
    director,
    cast: castProfiles.length > 0 ? castProfiles.map((c) => c.name) : curated?.cast ?? [],
    castProfiles: castProfiles.length > 0 ? castProfiles : curated?.castProfiles,
    overview: String(detail.overview || curated?.overview || "Dispon\xEDvel para streaming imediato em alta defini\xE7\xE3o."),
    poster: detail.poster_path ? `${TMDB_IMG}/w500${detail.poster_path}` : curated?.poster ?? "/src/assets/images/poster_nyc_winter_1794566231280.jpg",
    backdrop: detail.backdrop_path ? `${TMDB_IMG}/w1280${detail.backdrop_path}` : curated?.backdrop ?? "/src/assets/images/cinelume_hero_cinema_1794566229858.jpg",
    logo: logoUrl,
    rankToday: curated?.rankToday,
    defaultSeason: curated?.defaultSeason ?? 1,
    defaultEpisode: curated?.defaultEpisode ?? 1,
    seasonsCount: typeof detail.number_of_seasons === "number" ? detail.number_of_seasons : curated?.seasonsCount ?? 1,
    episodes: s1Episodes.length > 0 ? s1Episodes : curated?.episodes
  };
  metaCache.set(cacheKey, { expiresAt: Date.now() + META_CACHE_TTL_MS, value: merged });
  return merged;
}
async function fetchTmdbHeroLogo(type, tmdbId) {
  const tmdbType = type === "series" ? "tv" : "movie";
  const data = await fetchTmdbJson(`/${tmdbType}/${tmdbId}/images?include_image_language=pt,en,null`, 1800);
  const pngs = (data?.logos ?? []).filter((l) => l.file_path && !l.file_path.endsWith(".svg"));
  const pick = pngs.find((l) => l.iso_639_1 === "pt") ?? pngs.find((l) => l.iso_639_1 === "en") ?? pngs[0];
  return pick?.file_path ? `${TMDB_IMG}/w500${pick.file_path}` : void 0;
}
var TMDB_MOVIE_GENRE_MAP = {
  "a\xE7\xE3o": "28",
  "acao": "28",
  "aventura": "12",
  "com\xE9dia": "35",
  "comedia": "35",
  "terror": "27",
  "fic\xE7\xE3o cient\xEDfica": "878",
  "ficcao cientifica": "878",
  "drama": "18",
  "anima\xE7\xE3o": "16",
  "animacao": "16",
  "romance": "10749",
  "suspense": "53",
  "crime": "80",
  "fantasia": "14",
  "fam\xEDlia": "10751",
  "familia": "10751"
};
var TMDB_TV_GENRE_MAP = {
  "drama": "18",
  "a\xE7\xE3o": "10759",
  "acao": "10759",
  "a\xE7\xE3o & aventura": "10759",
  "com\xE9dia": "35",
  "comedia": "35",
  "fic\xE7\xE3o cient\xEDfica": "10765",
  "sci-fi & fantasia": "10765",
  "suspense": "9648",
  "mist\xE9rio": "9648",
  "misterio": "9648",
  "crime": "80",
  "anima\xE7\xE3o": "16",
  "animacao": "16",
  "desenhos": "16",
  "document\xE1rio": "99",
  "documentario": "99",
  "kids": "10762",
  "infantil": "10762",
  "fam\xEDlia": "10751",
  "familia": "10751"
};
async function fetchPaginatedCatalog(params) {
  const { mediaType, isKids, page = 1, genre = "", sort = "popular" } = params;
  const tmdbType = mediaType === "series" ? "tv" : "movie";
  const genreLower = genre.toLowerCase();
  let sortQuery = "sort_by=popularity.desc";
  if (sort === "rating") {
    sortQuery = mediaType === "movie" ? "sort_by=vote_average.desc&vote_count.gte=" + (isKids ? "30" : "150") : "sort_by=vote_average.desc&vote_count.gte=" + (isKids ? "15" : "80");
  } else if (sort === "new") {
    sortQuery = mediaType === "movie" ? "sort_by=primary_release_date.desc&vote_count.gte=5" : "sort_by=first_air_date.desc&vote_count.gte=3";
  }
  let withGenres = "";
  let withoutGenres = "";
  if (isKids) {
    if (mediaType === "movie") {
      const gId = TMDB_MOVIE_GENRE_MAP[genreLower];
      withGenres = gId ? `${gId},16|10751` : "16|10751";
      withoutGenres = "27,80,53,10752,18";
    } else {
      const gId = TMDB_TV_GENRE_MAP[genreLower];
      withGenres = gId ? `${gId},10762|10751|16` : "10762|10751|16";
      withoutGenres = "80,27,10768,18";
    }
  } else {
    if (mediaType === "movie") {
      const gId = TMDB_MOVIE_GENRE_MAP[genreLower];
      if (gId) withGenres = gId;
    } else {
      const gId = TMDB_TV_GENRE_MAP[genreLower];
      if (gId) withGenres = gId;
    }
  }
  let path6 = `/discover/${tmdbType}?language=pt-BR&page=${page}&${sortQuery}&include_adult=false`;
  if (withGenres) path6 += `&with_genres=${encodeURIComponent(withGenres)}`;
  if (withoutGenres) path6 += `&without_genres=${encodeURIComponent(withoutGenres)}`;
  if (isKids && mediaType === "movie") {
    path6 += "&certification_country=BR&certification.lte=10";
  }
  const tmdbRes = await fetchTmdbJson(path6, 3500);
  const rawResults = tmdbRes?.results ?? [];
  const items = [];
  for (const r of rawResults) {
    if (!r.poster_path || !r.backdrop_path) continue;
    const mapped = mapTmdbSummaryToMediaTitle(r, mediaType);
    if (isKids) {
      mapped.ageRating = "L";
    }
    items.push(mapped);
  }
  const totalPages = Math.min(tmdbRes?.total_pages || 1, 100);
  const hasMore = page < totalPages && items.length > 0;
  return {
    items,
    page,
    totalPages,
    hasMore
  };
}
async function fetchLiveCatalogFeed() {
  const hit = catalogCache.get("tmdb:combined");
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const [
    trendDayRes,
    trendMoviesRes,
    trendTvRes,
    nowPlayingRes,
    popMoviesRes,
    popTvRes,
    topMoviesRes,
    actionMoviesRes
  ] = await Promise.all([
    fetchTmdbJson("/trending/all/day?language=pt-BR", 3200),
    fetchTmdbJson("/trending/movie/week?language=pt-BR", 3200),
    fetchTmdbJson("/trending/tv/week?language=pt-BR", 3200),
    fetchTmdbJson("/movie/now_playing?language=pt-BR&region=BR", 3200),
    fetchTmdbJson("/movie/popular?language=pt-BR&page=1", 3200),
    fetchTmdbJson("/tv/popular?language=pt-BR&page=1", 3200),
    fetchTmdbJson("/movie/top_rated?language=pt-BR&page=1", 3200),
    fetchTmdbJson("/discover/movie?language=pt-BR&with_genres=28,878&sort_by=popularity.desc", 3200)
  ]);
  const combined = [];
  const seenKey = /* @__PURE__ */ new Set();
  const addBatch = (rows, forceType, assignTop10Rank = false) => {
    for (const r of rows ?? []) {
      const mType = r.media_type;
      if (!forceType && mType && mType !== "movie" && mType !== "tv") continue;
      if (!r.poster_path || !r.backdrop_path) continue;
      const mapped = mapTmdbSummaryToMediaTitle(r, forceType);
      const k = `${mapped.mediaType}:${mapped.tmdbId}`;
      if (!mapped.tmdbId || seenKey.has(k)) continue;
      seenKey.add(k);
      const entry = { ...mapped, rankToday: void 0 };
      if (assignTop10Rank && combined.length < 10) {
        entry.rankToday = combined.length + 1;
      }
      combined.push(entry);
    }
  };
  addBatch(trendDayRes?.results, void 0, true);
  addBatch(trendMoviesRes?.results, "movie", true);
  addBatch(trendTvRes?.results, "series", true);
  addBatch(nowPlayingRes?.results, "movie", false);
  addBatch(popMoviesRes?.results, "movie", false);
  addBatch(popTvRes?.results, "series", false);
  addBatch(topMoviesRes?.results, "movie", false);
  addBatch(actionMoviesRes?.results, "movie", false);
  for (const c of CURATED_CATALOG) {
    const k = `${c.mediaType}:${c.tmdbId}`;
    if (!seenKey.has(k)) {
      seenKey.add(k);
      combined.push({ ...c, rankToday: void 0 });
    }
  }
  const heroSlice = combined.slice(0, 7);
  await Promise.allSettled(
    heroSlice.map(async (item) => {
      if (!item.logo && item.tmdbId) {
        const logoUrl = await fetchTmdbHeroLogo(item.mediaType, item.tmdbId);
        if (logoUrl) item.logo = logoUrl;
      }
    })
  );
  const finalFeed = combined.slice(0, 150);
  if (trendDayRes?.results?.length || trendMoviesRes?.results?.length) {
    catalogCache.set("tmdb:combined", {
      expiresAt: Date.now() + META_CACHE_TTL_MS,
      value: finalFeed
    });
  }
  return finalFeed;
}
async function fetchLiveKidsCatalogFeed() {
  const hit = catalogCache.get("tmdb:kids");
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const [trendKidsRes, animMoviesRes, kidsTvRes, familyMoviesRes] = await Promise.all([
    fetchTmdbJson(
      "/discover/movie?language=pt-BR&with_genres=16,10751&without_genres=27,80,53,10752&sort_by=popularity.desc",
      3200
    ),
    fetchTmdbJson(
      "/discover/movie?language=pt-BR&with_genres=16&without_genres=27,80,53,10752&sort_by=popularity.desc",
      3200
    ),
    fetchTmdbJson(
      "/discover/tv?language=pt-BR&with_genres=10762,10751,16&without_genres=80,27,10768&sort_by=popularity.desc",
      3200
    ),
    fetchTmdbJson(
      "/discover/movie?language=pt-BR&with_genres=10751,12&without_genres=27,80,53,10752&sort_by=popularity.desc",
      3200
    )
  ]);
  const combined = [];
  const seenKey = /* @__PURE__ */ new Set();
  const addBatch = (rows, forceType, assignTop10Rank = false) => {
    for (const r of rows ?? []) {
      const mType = r.media_type;
      if (!forceType && mType && mType !== "movie" && mType !== "tv") continue;
      if (!r.poster_path || !r.backdrop_path) continue;
      const mapped = mapTmdbSummaryToMediaTitle(r, forceType);
      const k = `${mapped.mediaType}:${mapped.tmdbId}`;
      if (!mapped.tmdbId || seenKey.has(k)) continue;
      seenKey.add(k);
      const entry = { ...mapped, ageRating: "L", rankToday: void 0 };
      if (assignTop10Rank && combined.length < 10) {
        entry.rankToday = combined.length + 1;
      }
      combined.push(entry);
    }
  };
  addBatch(trendKidsRes?.results, "movie", true);
  addBatch(animMoviesRes?.results, "movie", true);
  addBatch(kidsTvRes?.results, "series", true);
  addBatch(familyMoviesRes?.results, "movie", false);
  for (const c of CURATED_CATALOG) {
    if (allowedForProfile(c, "10", true)) {
      const k = `${c.mediaType}:${c.tmdbId}`;
      if (!seenKey.has(k)) {
        seenKey.add(k);
        combined.push({ ...c, ageRating: "L", rankToday: void 0 });
      }
    }
  }
  const heroSlice = combined.slice(0, 7);
  await Promise.allSettled(
    heroSlice.map(async (item) => {
      if (!item.logo && item.tmdbId) {
        const logoUrl = await fetchTmdbHeroLogo(item.mediaType, item.tmdbId);
        if (logoUrl) item.logo = logoUrl;
      }
    })
  );
  const finalFeed = combined.slice(0, 150);
  catalogCache.set("tmdb:kids", {
    expiresAt: Date.now() + META_CACHE_TTL_MS,
    value: finalFeed
  });
  return finalFeed;
}
var SKIP_CACHE_TTL_MS = 6 * 60 * 60 * 1e3;
async function resolveMalIdForTitle(searchTitle) {
  const normalized = searchTitle.trim().toLowerCase();
  if (!normalized) return null;
  const cached = malIdCache.get(normalized);
  if (cached) return cached;
  try {
    const res = await fetchWithTimeout("https://graphql.anilist.co", {
      method: "POST",
      timeoutMs: 1800,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        query: "query($s:String){Page(perPage:3){media(search:$s,type:ANIME,sort:POPULARITY_DESC){id idMal episodes title{english romaji}}}}",
        variables: { s: searchTitle.trim() }
      })
    });
    if (res.status !== 200) return null;
    const json = JSON.parse(res.text);
    const firstMal = json.data?.Page?.media?.find((m) => typeof m.idMal === "number")?.idMal;
    if (firstMal) {
      malIdCache.set(normalized, firstMal);
      return firstMal;
    }
  } catch {
  }
  return null;
}
async function fetchExactSkipSegments(opts) {
  const key = `${opts.tmdbId}:s${opts.season}:e${opts.episode}`;
  const hit = skipTimesCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const introDbPromise = (async () => {
    try {
      const r = await fetchWithTimeout(
        `https://api.theintrodb.org/v2/media?tmdb_id=${encodeURIComponent(opts.tmdbId)}&season=${opts.season}&episode=${opts.episode}`,
        { timeoutMs: 2200, headers: { Accept: "application/json" } }
      );
      if (r.status !== 200) return [];
      return parseTheIntroDbV2Response(JSON.parse(r.text));
    } catch {
      return [];
    }
  })();
  const aniSkipPromise = (async () => {
    const baseName = opts.originalTitle || opts.title;
    if (!baseName) return [];
    const searchName = opts.season > 1 ? `${baseName} Season ${opts.season}` : baseName;
    let malId = await resolveMalIdForTitle(searchName);
    if (!malId && opts.season > 1) {
      malId = await resolveMalIdForTitle(baseName);
    }
    if (!malId) return [];
    try {
      const r = await fetchWithTimeout(
        `https://api.aniskip.com/v2/skip-times/${malId}/${opts.episode}?types=op&types=recap&types=ed&episodeLength=0`,
        { timeoutMs: 1800, headers: { Accept: "application/json" } }
      );
      if (r.status !== 200) return [];
      return parseAniSkipResponse(JSON.parse(r.text));
    } catch {
      return [];
    }
  })();
  const [tvSegs, animeSegs] = await Promise.all([introDbPromise, aniSkipPromise]);
  const combined = [];
  const hasType = (t) => combined.some((s) => s.type === t);
  for (const seg of [...tvSegs, ...animeSegs]) {
    if (seg.type === "intro" && !hasType("intro")) combined.push(seg);
    else if (seg.type === "recap" && !hasType("recap")) combined.push(seg);
    else if (seg.type === "outro" && !hasType("outro")) combined.push(seg);
  }
  skipTimesCache.set(key, {
    expiresAt: Date.now() + (combined.length > 0 ? SKIP_CACHE_TTL_MS : 10 * 60 * 1e3),
    value: combined
  });
  return combined;
}
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/pb", createPocketBaseRouter());
  app.use("/api/analytics", createAnalyticsRouter());
  const vipRouter = createVipRouter();
  app.use("/api/vip", vipRouter);
  app.post("/api/vip/visit", (req, res) => {
    const ok = recordVisit(req.body || {});
    res.set("Cache-Control", "no-store").status(ok ? 200 : 400).json({ ok });
  });
  app.get("/api/urgent-announcement", (req, res, next) => {
    req.url = "/urgent-announcement";
    vipRouter(req, res, next);
  });
  app.post("/api/urgent-announcement", (req, res, next) => {
    req.url = "/urgent-announcement";
    vipRouter(req, res, next);
  });
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "Kairou Media Engine" });
  });
  app.get("/api/skip-times/:tmdbId", async (req, res) => {
    const tmdbId = String(req.params.tmdbId || "").trim();
    const season = Math.max(1, Number(req.query.season) || 1);
    const episode = Math.max(1, Number(req.query.episode) || 1);
    const title = typeof req.query.title === "string" ? req.query.title : "";
    const originalTitle = typeof req.query.originalTitle === "string" ? req.query.originalTitle : "";
    if (!tmdbId) {
      res.json({ segments: [] });
      return;
    }
    const segments = await fetchExactSkipSegments({
      tmdbId,
      season,
      episode,
      title,
      originalTitle
    });
    res.json({ segments });
  });
  app.get("/api/catalog/browse", async (req, res) => {
    try {
      const mediaType = req.query.type === "series" || req.query.type === "tv" ? "series" : "movie";
      const isKids = req.query.kids === "true";
      const page = Math.max(1, Number(req.query.page) || 1);
      const genre = typeof req.query.genre === "string" ? req.query.genre.trim() : "";
      const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "popular";
      const result = await fetchPaginatedCatalog({ mediaType, isKids, page, genre, sort });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/catalog", async (req, res) => {
    try {
      const isKids = req.query.kids === "true";
      const items = isKids ? await fetchLiveKidsCatalogFeed() : await fetchLiveCatalogFeed();
      res.json({ items });
    } catch {
      res.json({ items: CURATED_CATALOG });
    }
  });
  app.get("/api/channels", (req, res) => {
    try {
      const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
      const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      let items = [...LIVE_CHANNELS];
      if (category && category !== "todos") {
        items = items.filter((c) => c.category === category);
      }
      if (query) {
        items = items.filter(
          (c) => c.name.toLowerCase().includes(query) || c.slug.toLowerCase().includes(query) || c.categoryLabel.toLowerCase().includes(query)
        );
      }
      res.json({
        channels: items,
        categories: CHANNEL_CATEGORIES,
        total: items.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/channels/:id", (req, res) => {
    const id = req.params.id;
    const channel = LIVE_CHANNELS.find((c) => c.id === id || c.slug === id);
    if (!channel) {
      res.status(404).json({ error: "Canal n\xE3o encontrado" });
      return;
    }
    res.json({ channel });
  });
  app.get("/api/channels/stream/:id", (req, res) => {
    const id = req.params.id;
    const channel = LIVE_CHANNELS.find((c) => c.id === id || c.slug === id);
    if (!channel) {
      res.status(404).json({ error: "Canal n\xE3o encontrado" });
      return;
    }
    res.json({
      ok: true,
      id: channel.id,
      name: channel.name,
      logo: channel.logo,
      streamUrl: channel.streamUrl,
      backupStreamUrl: channel.backupStreamUrl,
      category: channel.category,
      categoryLabel: channel.categoryLabel,
      quality: channel.quality,
      format: "hls",
      isLive: true
    });
  });
  app.get("/api/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.json({ items: await fetchLiveCatalogFeed() });
      return;
    }
    const localMatches = CURATED_CATALOG.filter(
      (item) => `${item.title} ${item.originalTitle} ${item.genres.join(" ")}`.toLowerCase().includes(q.toLowerCase())
    );
    try {
      const tmdbRes = await fetchTmdbJson(
        `/search/multi?language=pt-BR&include_adult=false&query=${encodeURIComponent(q)}`,
        3e3
      );
      const remote = (tmdbRes?.results ?? []).filter((r) => (r.media_type === "movie" || r.media_type === "tv") && (r.poster_path || r.backdrop_path)).slice(0, 14).map((r) => mapTmdbSummaryToMediaTitle(r));
      const seen = new Set(localMatches.map((i) => `${i.mediaType}:${i.tmdbId}`));
      const items = [
        ...localMatches,
        ...remote.filter((r) => !seen.has(`${r.mediaType}:${r.tmdbId}`))
      ];
      res.json({ items });
    } catch {
      res.json({ items: localMatches });
    }
  });
  app.get("/api/title/:type/:id", async (req, res) => {
    const type = req.params.type === "series" ? "series" : "movie";
    const rawId = req.params.id;
    const curated = CURATED_CATALOG.find(
      (c) => c.id === rawId || c.imdbId === rawId || c.tmdbId === rawId
    );
    const tmdbMatch = rawId.match(/^tmdb-(?:movie|series)-(\d+)$/)?.[1];
    let tmdbId = curated?.tmdbId || tmdbMatch || (/^\d+$/.test(rawId) ? rawId : "");
    if (!tmdbId && /^tt\d+/i.test(rawId)) {
      try {
        const findRes = await fetchTmdbJson(`/find/${rawId}?external_source=imdb_id`, 3e3);
        if (findRes?.movie_results && findRes.movie_results.length > 0) {
          tmdbId = String(findRes.movie_results[0].id);
        } else if (findRes?.tv_results && findRes.tv_results.length > 0) {
          tmdbId = String(findRes.tv_results[0].id);
        }
      } catch {
      }
    }
    if (tmdbId) {
      const rich = await fetchTmdbDetailTitle(type, tmdbId);
      if (rich) {
        res.json({ item: rich });
        return;
      }
    }
    if (curated) {
      res.json({ item: curated });
    } else {
      res.status(404).json({ error: "T\xEDtulo n\xE3o encontrado." });
    }
  });
  app.get("/api/title/series/:id/season/:season", async (req, res) => {
    const season = Math.max(1, Number(req.params.season) || 1);
    const rawId = req.params.id;
    const curated = CURATED_CATALOG.find(
      (c) => c.id === rawId || c.imdbId === rawId || c.tmdbId === rawId
    );
    const tmdbId = curated?.tmdbId || rawId.match(/(\d+)$/)?.[1] || rawId;
    if (!/^\d+$/.test(tmdbId)) {
      res.json({ episodes: [] });
      return;
    }
    const episodes = await fetchTmdbSeasonEpisodes(tmdbId, season);
    res.json({ episodes });
  });
  app.post("/api/extract/start", async (req, res) => {
    const startedAt2 = Date.now();
    const {
      target: rawTarget,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime,
      refresh = false
    } = req.body;
    const parsed = parseTmdbTarget(rawTarget ?? "");
    if (parsed.kind === "invalid") {
      res.status(400).json({ error: parsed.reason });
      return;
    }
    if (parsed.kind === "direct") {
      const streamId = registerStream(
        parsed.url,
        typeof req.body?.referer === "string" ? req.body.referer : "",
        parsed.url.includes(".mp4") ? "mp4" : "hls"
      );
      const ext = parsed.url.includes(".mp4") ? "media.mp4" : "master.m3u8";
      const snap = {
        elapsedMs: Date.now() - startedAt2,
        cached: false,
        streams: [
          {
            id: streamId,
            label: "Servidor 1",
            audio: "Direto",
            quality: "Original",
            codec: isLikelyHevcStream(parsed.url) ? "h265" : "h264",
            format: parsed.url.includes(".mp4") ? "mp4" : "hls",
            isPtBr: false,
            is4k: false,
            streamUrl: `/api/stream/${streamId}/${ext}`
          }
        ],
        subtitles: []
      };
      res.json({ jobId: null, done: true, snapshot: snap });
      return;
    }
    const cacheKey = parsed.kind === "movie" ? `movie:${parsed.tmdbId}` : `tv:${parsed.tmdbId}:${parsed.season}:${parsed.episode}`;
    if (!refresh) {
      const cached = extractCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && cached.value.streams.length > 0) {
        res.json({
          jobId: null,
          done: true,
          snapshot: { ...cached.value, cached: true, elapsedMs: Date.now() - startedAt2 }
        });
        return;
      }
    }
    const extractTarget = {
      ...parsed,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime
    };
    const imdbPromise = resolveImdbForTarget(extractTarget);
    const jobId = `job_${crypto3.randomBytes(6).toString("base64url")}`;
    const job = {
      id: jobId,
      cacheKey,
      startedAt: startedAt2,
      done: false,
      rawStreams: [],
      rawSubs: [],
      emitter: new EventEmitter(),
      lastSnapshot: {
        elapsedMs: Date.now() - startedAt2,
        cached: false,
        streams: [],
        subtitles: []
      }
    };
    activeJobs.set(jobId, job);
    let resolveFirstWave = null;
    const firstWaveReady = new Promise((resolve) => {
      resolveFirstWave = resolve;
    });
    let fallbackWaveTimer = null;
    launchAllPipelines(extractTarget, imdbPromise, (batch) => {
      if (batch.resolvedTitle && !job.resolvedTitle) {
        job.resolvedTitle = batch.resolvedTitle;
      }
      job.rawStreams.push(...batch.streams);
      job.rawSubs.push(...batch.subtitles);
      job.lastSnapshot = buildAnonymizedSnapshot(
        job.rawStreams,
        job.rawSubs,
        job.startedAt,
        false,
        job.resolvedTitle
      );
      const hasTrue1080 = job.lastSnapshot.streams.some(
        (s) => s.codec !== "h265" && !s.is4k && /1080p|full\s*hd/i.test(s.quality)
      );
      if (hasTrue1080) {
        if (fallbackWaveTimer) clearTimeout(fallbackWaveTimer);
        resolveFirstWave?.();
        resolveFirstWave = null;
      } else if (job.lastSnapshot.streams.some((s) => s.codec !== "h265") && !fallbackWaveTimer) {
        fallbackWaveTimer = setTimeout(() => {
          resolveFirstWave?.();
          resolveFirstWave = null;
        }, 700);
      }
      job.emitter.emit("update", { done: false, snapshot: job.lastSnapshot });
    }).finally(() => {
      job.done = true;
      job.lastSnapshot = buildAnonymizedSnapshot(
        job.rawStreams,
        job.rawSubs,
        job.startedAt,
        false,
        job.resolvedTitle
      );
      if (job.lastSnapshot.streams.length > 0) {
        void setSharedCache(cacheKey, { streams: job.rawStreams, subtitles: job.rawSubs, resolvedTitle: job.resolvedTitle });
        extractCache.set(cacheKey, {
          expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS,
          value: job.lastSnapshot
        });
      }
      if (fallbackWaveTimer) clearTimeout(fallbackWaveTimer);
      resolveFirstWave?.();
      resolveFirstWave = null;
      job.emitter.emit("update", { done: true, snapshot: job.lastSnapshot });
      setTimeout(() => activeJobs.delete(jobId), 45e3);
    });
    await Promise.race([
      firstWaveReady,
      new Promise((resolve) => setTimeout(resolve, 3200))
    ]);
    res.json({
      jobId: job.done ? null : jobId,
      done: job.done,
      snapshot: { ...job.lastSnapshot, elapsedMs: Date.now() - startedAt2 }
    });
  });
  app.get("/api/extract/stream/:jobId", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Content-Encoding", "identity");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    const job = activeJobs.get(req.params.jobId);
    if (!job) {
      res.write(`data: ${JSON.stringify({ done: true, snapshot: null })}

`);
      res.end();
      return;
    }
    let isClosed = false;
    const sendPayload = (payload) => {
      if (isClosed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}

`);
      if (typeof res.flush === "function") {
        res.flush();
      }
      if (payload.done) {
        isClosed = true;
        job.emitter.off("update", listener);
        setImmediate(() => {
          if (!res.writableEnded) {
            try {
              res.end();
            } catch {
            }
          }
        });
      }
    };
    const listener = (payload) => {
      sendPayload(payload);
    };
    sendPayload({ done: job.done, snapshot: job.lastSnapshot });
    if (job.done) return;
    job.emitter.on("update", listener);
    req.on("close", () => {
      isClosed = true;
      job.emitter.off("update", listener);
    });
  });
  app.post("/api/extract", async (req, res) => {
    const tStart = Date.now();
    const {
      target: rawTarget,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime,
      refresh = false
    } = req.body;
    const parsed = parseTmdbTarget(rawTarget ?? "");
    if (parsed.kind === "invalid") {
      res.status(400).json({ error: parsed.reason });
      return;
    }
    if (parsed.kind === "direct") {
      const streamId = registerStream(
        parsed.url,
        typeof req.body?.referer === "string" ? req.body.referer : "",
        parsed.url.includes(".mp4") ? "mp4" : "hls"
      );
      const ext = parsed.url.includes(".mp4") ? "media.mp4" : "master.m3u8";
      res.json({
        elapsedMs: Date.now() - tStart,
        cached: false,
        streams: [
          {
            id: streamId,
            label: "Servidor 1",
            audio: "Direto",
            quality: "Original",
            codec: isLikelyHevcStream(parsed.url) ? "h265" : "h264",
            format: parsed.url.includes(".mp4") ? "mp4" : "hls",
            isPtBr: false,
            is4k: false,
            streamUrl: `/api/stream/${streamId}/${ext}`
          }
        ],
        subtitles: []
      });
      return;
    }
    const cacheKey = parsed.kind === "movie" ? `movie:${parsed.tmdbId}` : `tv:${parsed.tmdbId}:${parsed.season}:${parsed.episode}`;
    if (!refresh) {
      const cached = extractCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && cached.value.streams.length > 0) {
        res.json({
          jobId: null,
          done: true,
          snapshot: { ...cached.value, cached: true, elapsedMs: Date.now() - startedAt }
        });
        return;
      }
    }
    if (!refresh) {
      const hit = extractCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json({
          ...hit.value,
          cached: true,
          elapsedMs: Date.now() - tStart
        });
        return;
      }
    }
    if (!refresh) {
      const shared = await getSharedCache(cacheKey);
      if (shared && Array.isArray(shared.streams) && Array.isArray(shared.subtitles)) {
        const verified = await verifyStreamsBatch(shared.streams);
        if (verified.length) {
          const snapshot = buildAnonymizedSnapshot(verified, shared.subtitles, tStart, true, shared.resolvedTitle);
          res.json(snapshot);
          return;
        }
      }
    }
    const extractTarget = {
      ...parsed,
      imdbId: hintImdb,
      title: hintTitle,
      originalTitle: hintOriginalTitle,
      isAnime: hintIsAnime
    };
    const imdbPromise = resolveImdbForTarget(extractTarget);
    const rawStreams = [];
    const rawSubs = [];
    let resolvedTitle;
    let resolveEarlyExtraction = null;
    const earlyExtractionPromise = new Promise((r) => {
      resolveEarlyExtraction = r;
    });
    await Promise.race([
      launchAllPipelines(extractTarget, imdbPromise, (batch) => {
        if (batch.resolvedTitle && !resolvedTitle) resolvedTitle = batch.resolvedTitle;
        rawStreams.push(...batch.streams);
        rawSubs.push(...batch.subtitles);
        if (rawStreams.some((s) => s.codec !== "h265")) {
          resolveEarlyExtraction?.();
          resolveEarlyExtraction = null;
        }
      }),
      earlyExtractionPromise,
      new Promise((resolve) => setTimeout(resolve, 4500))
    ]);
    const responsePayload = buildAnonymizedSnapshot(
      rawStreams,
      rawSubs,
      tStart,
      false,
      resolvedTitle
    );
    if (responsePayload.streams.length > 0) {
      void setSharedCache(cacheKey, { streams: rawStreams, subtitles: rawSubs, resolvedTitle });
      extractCache.set(cacheKey, {
        expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS,
        value: responsePayload
      });
    }
    res.json(responsePayload);
  });
  async function handleOpaqueProxy(targetUrl, referer, extraHeaders, req, res) {
    if (!targetUrl || !isSafeExternalUrl(targetUrl)) {
      res.status(400).send("Invalid stream target");
      return;
    }
    const controller = new AbortController();
    const timer2 = setTimeout(() => controller.abort(), 22e3);
    try {
      const forwardHeaders = {
        "User-Agent": DEFAULT_UA,
        ...extraHeaders ?? {}
      };
      if (referer && !forwardHeaders.Referer && !forwardHeaders.referer) {
        forwardHeaders.Referer = referer;
        try {
          if (!forwardHeaders.Origin && !forwardHeaders.origin) {
            forwardHeaders.Origin = new URL(referer).origin;
          }
        } catch {
        }
      }
      if (typeof req.headers.range === "string") {
        forwardHeaders.Range = req.headers.range;
      }
      let upstream = null;
      let lastFetchErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          upstream = await fetch(targetUrl, {
            method: "GET",
            headers: forwardHeaders,
            redirect: "follow",
            signal: controller.signal
          });
          if (attempt === 0 && (upstream.status === 502 || upstream.status === 503 || upstream.status === 504)) {
            await upstream.body?.cancel().catch(() => {
            });
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          break;
        } catch (err) {
          lastFetchErr = err;
          if (attempt === 0 && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
        }
      }
      if (!upstream) {
        throw lastFetchErr ?? new Error("Upstream fetch failed");
      }
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      const ctLower = contentType.toLowerCase();
      const finalLower = (upstream.url || targetUrl).toLowerCase();
      const isHlsContentType = ctLower.includes("mpegurl") || ctLower.includes("x-mpegurl");
      const isHlsUrl = /\.m3u8(\?|$|#)/i.test(targetUrl) || /\.m3u8(\?|$|#)/i.test(finalLower) || targetUrl.endsWith("/master.txt") || targetUrl.includes("m3u8-proxy") || targetUrl.includes("/proxy?u=");
      const isBinaryVideo = !isHlsContentType && !isHlsUrl && (ctLower.includes("video/mp4") || /\.mp4(\?|$|#)/i.test(finalLower));
      const isManifestCandidate = !isBinaryVideo && (isHlsContentType || isHlsUrl || targetUrl.includes(".m3u8") || finalLower.includes(".m3u8"));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send(`Upstream HTTP ${upstream.status}`);
        return;
      }
      if (isManifestCandidate) {
        const text = await upstream.text();
        if (text.trimStart().startsWith("#EXTM3U")) {
          const base = upstream.url || targetUrl;
          const rewritten = rewriteHlsManifestWithResolver(text, base, (absUrl) => {
            const tok = registerProxyToken(absUrl, referer, extraHeaders);
            return `/api/p/${tok}`;
          });
          res.status(200);
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
          res.send(rewritten);
          return;
        }
        res.status(upstream.status);
        res.setHeader("Content-Type", contentType);
        res.send(text);
        return;
      }
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      const acceptRanges = upstream.headers.get("accept-ranges");
      const contentRange = upstream.headers.get("content-range");
      const contentLength = upstream.headers.get("content-length");
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (!upstream.body) {
        res.end();
        return;
      }
      const nodeStream = Readable.fromWeb(upstream.body);
      res.on("error", () => {
        controller.abort();
        nodeStream.destroy();
      });
      res.on("close", () => {
        if (!res.writableFinished) {
          controller.abort();
          nodeStream.destroy();
        }
      });
      nodeStream.on("error", () => {
        controller.abort();
        if (!res.headersSent) res.status(502).end();
        else if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).send("Stream proxy error");
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      clearTimeout(timer2);
    }
  }
  app.get("/api/stream/:id/:file", async (req, res) => {
    let entry = streamRegistry.get(req.params.id);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (req.params.id.startsWith("s_")) {
        const resolved = resolveStatelessProxyToken(req.params.id.slice(2));
        if (resolved) {
          entry = {
            url: resolved.url,
            referer: resolved.referer,
            extraHeaders: resolved.extraHeaders,
            format: req.params.file.endsWith(".mp4") ? "mp4" : "hls",
            expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS
          };
          streamRegistry.set(req.params.id, entry);
        }
      }
    }
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).send("Stream expired");
      return;
    }
    await handleOpaqueProxy(entry.url, entry.referer, entry.extraHeaders, req, res);
  });
  app.get("/api/p/:tok", async (req, res) => {
    let entry = proxyTokenRegistry.get(req.params.tok);
    if (!entry || entry.expiresAt <= Date.now()) {
      const resolved = resolveStatelessProxyToken(req.params.tok);
      if (resolved) {
        entry = {
          url: resolved.url,
          referer: resolved.referer,
          extraHeaders: resolved.extraHeaders,
          expiresAt: Date.now() + STREAM_REGISTRY_TTL_MS
        };
        proxyTokenRegistry.set(req.params.tok, entry);
      }
    }
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).send("Token expired");
      return;
    }
    await handleOpaqueProxy(entry.url, entry.referer, entry.extraHeaders, req, res);
  });
  app.get("/api/subtitle/:id.vtt", async (req, res) => {
    const entry = subRegistry.get(req.params.id);
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).send("Subtitle expired");
      return;
    }
    try {
      const subRes = await fetchWithTimeout(entry.url, {
        referer: entry.referer,
        headers: entry.extraHeaders,
        timeoutMs: 6e3
      });
      if (subRes.status !== 200) {
        res.status(subRes.status).send("Subtitle unavailable");
        return;
      }
      const vtt = convertSrtToVtt(subRes.text);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.send(vtt);
    } catch {
      res.status(502).send("Subtitle fetch error");
    }
  });
  const seo = await Promise.resolve().then(() => (init_seoEngine(), seoEngine_exports));
  const maps = {
    "/sitemap.xml": seo.getSitemapIndex,
    "/sitemap-static.xml": seo.getStaticSitemap,
    "/sitemap-movies.xml": seo.getMoviesSitemap,
    "/sitemap-series.xml": seo.getSeriesSitemap,
    "/sitemap-animes.xml": seo.getAnimesSitemap
  };
  for (const [route, generate] of Object.entries(maps)) {
    app.get(route, async (_req, res, next) => {
      try {
        res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(await generate());
      } catch (error) {
        next(error);
      }
    });
  }
  app.get(/^\/(filme|serie|anime|movie|tv)\/([a-zA-Z0-9_:-]+?)(?:-([^/?#]+))?\/?$/i, async (req, res, next) => {
    try {
      await seo.renderSeoPage(req, res, { type: req.params[0], id: req.params[1], slug: req.params[2] });
    } catch (error) {
      next(error);
    }
  });
  app.get(/^\/(filmes|series|animes|canais|minha-lista)\/?$/i, async (req, res, next) => {
    try {
      const section = req.params[0];
      seo.renderSectionSeo(req, res, section);
    } catch (error) {
      next(error);
    }
  });
  const distPath = path5.join(__dirname2, "dist");
  const hasDist = fs5.existsSync(distPath) && fs5.existsSync(path5.join(distPath, "index.html"));
  if (process.env.NODE_ENV === "production" || hasDist) {
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.originalUrl.startsWith("/api/")) return next();
      res.sendFile(path5.join(distPath, "index.html"));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
    } catch {
      app.use(express.static(distPath));
      app.use((req, res, next) => {
        if (req.originalUrl.startsWith("/api/")) return next();
        res.sendFile(path5.join(distPath, "index.html"));
      });
    }
  }
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Kairou server running on http://127.0.0.1:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start Kairou server:", err);
  process.exit(1);
});
