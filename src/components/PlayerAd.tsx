import React from 'react';

/** Ads are opt-in: no third-party code loads unless a placement is explicitly configured. */
export function PlayerAd({ isVip }: { isVip: boolean }) {
  const configured = import.meta.env.VITE_PLAYER_AD_URL as string | undefined;
  let source: URL;
  try { source = new URL(configured || ''); } catch { return null; }
  if (isVip || source.protocol !== 'https:') return null;
  return <aside aria-label="Publicidade" className="absolute bottom-24 right-4 z-20 w-[min(300px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/15 bg-black/80 p-1 shadow-lg"><div className="px-2 py-1 text-[10px] uppercase tracking-wide text-white/70">Publicidade</div><iframe title="Publicidade" src={source.href} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="strict-origin-when-cross-origin" className="h-[250px] w-full border-0" /></aside>;
}
