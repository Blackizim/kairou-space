import type { Account, Profile } from '../components/AccountModal';
const TOKEN_KEY = 'kairou_pb_token';
export function getPocketBaseToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function clearPocketBaseSession() { localStorage.removeItem(TOKEN_KEY); }
async function call(path: string, options: RequestInit = {}) {
  const headers: Record<string,string> = { 'Content-Type':'application/json' };
  const token = getPocketBaseToken(); if (token) headers.Authorization = token;
  const res = await fetch(`/api/pb${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Não foi possível conectar à conta.');
  return data;
}
type PbProfile = {
  id: string;
  name: string;
  color?: string;
  avatar_color?: string;
  border_color?: string;
  avatar_url?: string;
  avatar?: string;
  kids?: boolean;
  is_kids?: boolean;
  max_rating?: string;
  content_rating?: string;
};
const fromPB = (p: PbProfile): Profile => ({
  id: p.id,
  name: p.name || 'Perfil',
  color: p.color || p.avatar_color || '#2e7bff',
  borderColor: p.border_color || undefined,
  avatar: p.avatar_url || p.avatar || undefined,
  kids: Boolean(p.kids || p.is_kids),
  maxRating: p.max_rating || p.content_rating || '18',
});
const toPB = (p: Profile, user: string) => ({
  user,
  name: p.name,
  color: p.color,
  avatar_color: p.color,
  border_color: p.borderColor || '',
  avatar_kind: p.avatar ? 'media' : 'smiley',
  avatar_url: p.avatar || '',
  kids: Boolean(p.kids),
  is_kids: Boolean(p.kids),
  max_rating: p.maxRating || '18',
  content_rating: p.maxRating || '18',
});
export async function loadPocketAccount(record: { id:string; email:string; vip_until?:string }): Promise<Account> {
  const data = await call(`/collections/profiles/records?perPage=100&filter=${encodeURIComponent(`user="${record.id}"`)}`);
  const profiles = (data.items as PbProfile[]).map(fromPB);
  if (!profiles.length) {
    const p = await call('/collections/profiles/records', { method:'POST', body:JSON.stringify(toPB({id:'',name:'Meu perfil',color:'#2e7bff'}, record.id)) });
    profiles.push(fromPB(p));
  }
  return { email:record.email, salt:'', hash:'', profiles, pbId:record.id, vipUntil:record.vip_until ? Date.parse(record.vip_until) : undefined };
}
export async function signInPocketBase(email: string, password: string, register: boolean) {
  if (register) await call('/collections/users/records', { method:'POST', body:JSON.stringify({ email, password, passwordConfirm:password }) });
  const data = await call('/collections/users/auth-with-password', { method:'POST', body:JSON.stringify({identity:email,password}) });
  localStorage.setItem(TOKEN_KEY, data.token);
  try { return await loadPocketAccount(data.record); } catch(e) { clearPocketBaseSession(); throw e; }
}
export async function refreshPocketBase() {
  if (!getPocketBaseToken()) return null;
  const data = await call('/collections/users/auth-refresh', {method:'POST'});
  localStorage.setItem(TOKEN_KEY, data.token); return loadPocketAccount(data.record);
}
export async function savePocketProfile(profile: Profile, userId: string, exists: boolean): Promise<Profile> {
  const path = '/collections/profiles/records' + (exists ? `/${encodeURIComponent(profile.id)}` : '');
  return fromPB(await call(path, {method:exists?'PATCH':'POST',body:JSON.stringify(toPB(profile,userId))}));
}
export async function deletePocketProfile(id:string) { await call(`/collections/profiles/records/${encodeURIComponent(id)}`, {method:'DELETE'}); }

export type ProfileState = { saved: string[]; watched: string[]; progress: unknown[] };
export async function loadProfileState(profileId: string): Promise<ProfileState> {
  const data = await call(`/collections/profile_state/records?perPage=1&filter=${encodeURIComponent(`profile="${profileId}"`)}`);
  const record = data.items?.[0];
  return { saved:Array.isArray(record?.saved) ? record.saved : [], watched:Array.isArray(record?.watched) ? record.watched : [], progress:Array.isArray(record?.progress) ? record.progress : [] };
}
export async function saveProfileState(userId: string, profileId: string, state: ProfileState) {
  const data = await call(`/collections/profile_state/records?perPage=1&filter=${encodeURIComponent(`profile="${profileId}"`)}`);
  const id = data.items?.[0]?.id;
  await call('/collections/profile_state/records' + (id ? `/${encodeURIComponent(id)}` : ''), {method:id?'PATCH':'POST', body:JSON.stringify(id ? state : {...state,user:userId,profile:profileId})});
}
