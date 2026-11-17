import { useEffect } from 'react';

export function useAnalytics(route: string) {
  useEffect(() => {
    let visitor: string; let session: string; let source: string;
    try {
      visitor = localStorage.getItem('kairou.visitor.v1') || crypto.randomUUID(); localStorage.setItem('kairou.visitor.v1', visitor);
      session = sessionStorage.getItem('kairou.session.v1') || crypto.randomUUID(); sessionStorage.setItem('kairou.session.v1', session);
      source = sessionStorage.getItem('kairou.source.v1') || '';
      if (!source) { try { const ref = new URL(document.referrer); source = ref.hostname === location.hostname ? '' : ref.hostname; } catch { /* direct */ } sessionStorage.setItem('kairou.source.v1', source); }
    } catch { return; }
    let activeSince: number | null = document.hidden ? null : Date.now();
    const send = (event: 'view' | 'heartbeat' | 'leave', beacon = false) => {
      const now = Date.now(); const activeSeconds = activeSince === null ? 0 : Math.min(35, Math.max(0, (now - activeSince) / 1000)); activeSince = document.hidden || event === 'leave' ? null : now;
      const payload = JSON.stringify({ visitor, session, event, route, device: matchMedia('(max-width: 640px)').matches ? 'mobile' : matchMedia('(max-width: 1024px)').matches ? 'tablet' : 'desktop', source, activeSeconds });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/analytics/visit', new Blob([payload], { type: 'application/json' }));
      else void fetch('/api/analytics/visit', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:payload, keepalive:true }).catch(() => {});
    };
    const visibility = () => { if (document.hidden) send('heartbeat', true); else { activeSince = Date.now(); send('heartbeat'); } };
    const leave = () => send('leave', true);
    send('view'); document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave);
    const interval = window.setInterval(() => { if (!document.hidden) send('heartbeat'); }, 30000);
    return () => { send('heartbeat', true); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); };
  }, [route]);
}
