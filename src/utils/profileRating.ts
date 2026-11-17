import type { MediaTitle } from '../data/curatedCatalog';

export function allowedForProfile(item: MediaTitle, maxRating?: string, kids?: boolean): boolean {
  if (kids) {
    const matureRegex = /terror|horror|crime|guerra|erótico|erotico|suspense|thriller|adulto|violência|violencia/i;
    if (item.genres?.some((g) => matureRegex.test(g))) return false;
    const rating = String(item.ageRating || '').trim().toUpperCase();
    if (rating === '16' || rating === '18') return false;

    const isKidGenre = item.genres?.some((g) =>
      /animação|animacao|família|familia|kids|infantil|aventura|fantasia|comédia|comedia/i.test(g)
    );
    if (isKidGenre) return true;
    if (rating === 'L' || rating === 'LIVRE' || !rating) return true;
    const match = rating.match(/\d+/);
    return !!match && Number(match[0]) <= 12;
  }

  const max = maxRating === 'L' ? 0 : Number(maxRating || 18);
  if (max >= 18) return true;
  const rating = String(item.ageRating || '').trim().toUpperCase();
  if (rating === 'L' || rating === 'LIVRE') return true;
  const match = rating.match(/\d+/);
  return !!match && Number(match[0]) <= max;
}
