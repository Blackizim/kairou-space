import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

type Day = { visitors: Record<string, number>; sessions: Record<string, number>; views: number; routes: Record<string, number>; devices: Record<string, number>; sources: Record<string, number>; activeSeconds: number; activeVisitors: Record<string, number> };
const dataFile = process.env.KAIROU_ANALYTICS_FILE || path.join(process.cwd(), '.local-data', 'analytics.json');
const online = new Map<string, { seen: number; route: string }>();
let days: Record<string, Day> = {};
try { days = JSON.parse(fs.readFileSync(dataFile, 'utf8')).days || {}; } catch { /* no data yet */ }
let dirty = false;
const today = () => new Date().toISOString().slice(0, 10);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{32,36}$/i.test(value);
export function flushAnalytics() {
  if (!dirty) return;
  try { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); const tmp = `${dataFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify({ days })); fs.renameSync(tmp, dataFile); dirty = false; }
  catch (error) { console.warn('[analytics] Falha ao salvar:', (error as Error).message); }
}
const timer = setInterval(flushAnalytics, 15000); timer.unref();
export function recordVisit(data: Record<string, unknown>): boolean {
  if (!validId(data.visitor) || !validId(data.session) || !['view', 'heartbeat', 'leave'].includes(String(data.event))) return false;
  const now = Date.now(); const date = today();
  const route = typeof data.route === 'string' && /^\/[a-z0-9:_/#-]{0,100}$/i.test(data.route) ? data.route : '/';
  const device = ['mobile', 'tablet', 'desktop'].includes(String(data.device)) ? String(data.device) : 'desktop';
  const source = typeof data.source === 'string' && /^[a-z0-9.-]{1,100}$/i.test(data.source) ? data.source : 'Direto ou desconhecido';
  const record = days[date] ||= { visitors: {}, sessions: {}, views: 0, routes: {}, devices: {}, sources: {}, activeSeconds: 0, activeVisitors: {} };
  record.visitors[data.visitor] = 1;
  const seconds = Math.min(35, Math.max(0, Number(data.activeSeconds) || 0));
  if (seconds) { record.activeSeconds += seconds; record.activeVisitors[data.visitor] = 1; }
  if (!record.sessions[data.session]) { record.sessions[data.session] = 1; record.devices[device] = (record.devices[device] || 0) + 1; record.sources[source] = (record.sources[source] || 0) + 1; }
  if (data.event === 'view') { record.views++; record.routes[route] = (record.routes[route] || 0) + 1; }
  if (data.event === 'leave') online.delete(data.session); else online.set(data.session, { seen: now, route });
  const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
  dirty = true; return true;
}
export function analyticsSummary() {
  const now = Date.now(); for (const [id, item] of online) if (now - item.seen > 90000) online.delete(id);
  const d = days[today()] || { visitors: {}, sessions: {}, views: 0, routes: {}, devices: {}, sources: {}, activeVisitors: {}, activeSeconds: 0 };
  const top = (v: Record<string, number>) => Object.entries(v || {}).sort((a,b) => b[1]-a[1]).slice(0,8).map(([name,count]) => ({name,count}));
  const liveRoutes: Record<string, number> = {}; for (const item of online.values()) liveRoutes[item.route] = (liveRoutes[item.route] || 0)+1;
  const active = Object.keys(d.activeVisitors || {}).length;
  return { online: online.size, windowSeconds: 90, visitors: Object.keys(d.visitors).length, sessions: Object.keys(d.sessions).length, views: d.views, averageActiveSeconds: active ? d.activeSeconds / active : 0, routes: top(d.routes), liveRoutes: top(liveRoutes), devices: d.devices, sources: top(d.sources), history: Object.entries(days).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([date, day])=>({date, visitors:Object.keys(day.visitors || {}).length, views:day.views || 0})), updatedAt: now };
}
export function createAnalyticsRouter() {
  const router = Router();
  router.post('/visit', (req,res) => { const ok = recordVisit(req.body || {}); res.set('Cache-Control','no-store').status(ok ? 200 : 400).json({ ok }); });
  return router;
}
