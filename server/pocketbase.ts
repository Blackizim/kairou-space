import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type UserRecord = {
  id: string;
  email: string;
  password?: string;
  verified: boolean;
  vip_until?: string;
  created: string;
  updated: string;
};

export type ProfileRecord = {
  id: string;
  user: string;
  name: string;
  color: string;
  border_color?: string;
  avatar_kind?: string;
  avatar_url?: string;
  kids?: boolean;
  max_rating?: string;
  created: string;
  updated: string;
};

export type ProfileStateRecord = {
  id: string;
  user: string;
  profile: string;
  saved: string[];
  watched: string[];
  progress: unknown[];
  created: string;
  updated: string;
};

type LocalStore = {
  users: UserRecord[];
  profiles: ProfileRecord[];
  profile_state: ProfileStateRecord[];
};

const storeFile = () => process.env.AUTH_DATA_FILE || path.resolve(process.cwd(), '.local-data/auth_store.json');

const DEFAULT_STORE: LocalStore = {
  users: [
    {
      id: 'user_shizuu122',
      email: 'shizuu122@gmail.com',
      password: 'Po2nath7!',
      verified: true,
      vip_until: '2099-01-01T00:00:00.000Z',
      created: '2026-11-14T00:00:00.000Z',
      updated: '2026-11-14T00:00:00.000Z',
    },
  ],
  profiles: [
    {
      id: 'prof_shizuu122_main',
      user: 'user_shizuu122',
      name: 'Shizuu',
      color: '#2e7bff',
      border_color: '#38bdf8',
      avatar_kind: 'smiley',
      avatar_url: '',
      kids: false,
      max_rating: '18',
      created: '2026-11-14T00:00:00.000Z',
      updated: '2026-11-14T00:00:00.000Z',
    },
  ],
  profile_state: [
    {
      id: 'state_shizuu122_main',
      user: 'user_shizuu122',
      profile: 'prof_shizuu122_main',
      saved: [],
      watched: [],
      progress: [],
      created: '2026-11-14T00:00:00.000Z',
      updated: '2026-11-14T00:00:00.000Z',
    },
  ],
};

function readStore(): LocalStore {
  try {
    const file = storeFile();
    if (!fs.existsSync(file)) {
      saveStore(DEFAULT_STORE);
      return JSON.parse(JSON.stringify(DEFAULT_STORE));
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      users: Array.isArray(data.users) && data.users.length ? data.users : DEFAULT_STORE.users,
      profiles: Array.isArray(data.profiles) && data.profiles.length ? data.profiles : DEFAULT_STORE.profiles,
      profile_state: Array.isArray(data.profile_state) ? data.profile_state : DEFAULT_STORE.profile_state,
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function saveStore(data: LocalStore) {
  try {
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Failed to save auth store:', err);
  }
}

export function grantUserVip(identity: string, days: number, _plan = 'mensal'): string | null {
  const clean = String(identity || '').trim().toLowerCase();
  if (!clean) return null;
  const store = readStore();
  let user = store.users.find((u) => u.email.toLowerCase() === clean || u.id === clean);
  if (!user && (clean === 'user_shizuu122' || clean === 'shizuu122@gmail.com' || clean.includes('shizuu'))) {
    user = store.users[0];
  }
  if (!user) return null;

  const current = user.vip_until ? new Date(user.vip_until).getTime() : 0;
  const base = current > Date.now() ? current : Date.now();
  const until = new Date(base + days * 86400000).toISOString();

  user.vip_until = until;
  user.updated = new Date().toISOString();
  saveStore(store);
  return until;
}

export function createPocketBaseRouter() {
  const router = Router();
  const pbUrl = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';

  // Transparent upstream proxy to live PocketBase (active on VPS with all 850 accounts)
  router.use(async (req, res, next) => {
    try {
      const targetUrl = `${pbUrl.replace(/\/$/, '')}/api${req.url}`;
      const forwardHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'accept': 'application/json',
      };
      if (req.headers.authorization) {
        forwardHeaders.authorization = String(req.headers.authorization);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length > 0;
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: hasBody ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      res.status(upstream.status);
      upstream.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      });
      const data = await upstream.text();
      return res.send(data);
    } catch {
      // PocketBase not reachable locally -> proceed to local fallback store
      next();
    }
  });

  // 1. Auth with password
  router.post('/collections/users/auth-with-password', (req, res) => {
    const { identity, password } = req.body || {};
    const email = String(identity || '').trim().toLowerCase();
    const store = readStore();
    const user = store.users.find((u) => u.email.toLowerCase() === email);

    if (!user || user.password !== password) {
      return res.status(400).json({ message: 'Email ou senha inválidos.' });
    }

    const token = `kairou_token_${user.id}`;
    return res.json({
      token,
      record: {
        id: user.id,
        email: user.email,
        verified: user.verified,
        vip_until: user.vip_until,
        created: user.created,
        updated: user.updated,
      },
    });
  });

  // 2. Auth refresh
  router.post('/collections/users/auth-refresh', (req, res) => {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.replace(/^Bearer\s+/i, '').trim();
    const store = readStore();

    let user = store.users.find((u) => `kairou_token_${u.id}` === token);
    if (!user && token.startsWith('kairou_token_')) {
      user = store.users[0];
    }

    if (!user) {
      return res.status(401).json({ message: 'Sessão expirada.' });
    }

    return res.json({
      token: `kairou_token_${user.id}`,
      record: {
        id: user.id,
        email: user.email,
        verified: user.verified,
        vip_until: user.vip_until,
        created: user.created,
        updated: user.updated,
      },
    });
  });

  // 3. User registration & management
  router.get('/collections/users/records', (req, res) => {
    const store = readStore();
    const filter = String(req.query.filter || '');
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
        updated: u.updated,
      })),
    });
  });

  router.patch('/collections/users/records/:id', (req, res) => {
    const store = readStore();
    const id = req.params.id;
    const idx = store.users.findIndex((u) => u.id === id || u.email.toLowerCase() === id.toLowerCase());
    if (idx === -1) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    const b = req.body || {};
    if (b.vip_until !== undefined) {
      store.users[idx].vip_until = b.vip_until;
    }
    store.users[idx].updated = new Date().toISOString();
    saveStore(store);
    return res.json({
      id: store.users[idx].id,
      email: store.users[idx].email,
      verified: store.users[idx].verified,
      vip_until: store.users[idx].vip_until,
      created: store.users[idx].created,
      updated: store.users[idx].updated,
    });
  });

  router.post('/collections/users/records', (_req, res) => {
    return res.status(400).json({
      message: 'Modo de teste: use a conta de teste configurada: shizuu122@gmail.com',
    });
  });

  // 4. Profiles
  router.get('/collections/profiles/records', (req, res) => {
    const store = readStore();
    const filter = String(req.query.filter || '');
    const userMatch = filter.match(/user="([^"]+)"/);
    const userId = userMatch ? userMatch[1] : null;

    let items = userId ? store.profiles.filter((p) => p.user === userId) : store.profiles;
    if (!items.length && userId === 'user_shizuu122') {
      items = store.profiles;
    }

    return res.json({
      page: 1,
      perPage: 100,
      totalItems: items.length,
      totalPages: 1,
      items,
    });
  });

  router.post('/collections/profiles/records', (req, res) => {
    const store = readStore();
    const b = req.body || {};
    const newProfile: ProfileRecord = {
      id: 'prof_' + crypto.randomBytes(6).toString('hex'),
      user: String(b.user || 'user_shizuu122'),
      name: String(b.name || 'Meu perfil'),
      color: String(b.color || '#2e7bff'),
      border_color: b.border_color ? String(b.border_color) : undefined,
      avatar_kind: b.avatar_kind ? String(b.avatar_kind) : undefined,
      avatar_url: b.avatar_url ? String(b.avatar_url) : undefined,
      kids: Boolean(b.kids),
      max_rating: b.max_rating ? String(b.max_rating) : '18',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    store.profiles.push(newProfile);
    saveStore(store);
    return res.status(200).json(newProfile);
  });

  router.patch('/collections/profiles/records/:id', (req, res) => {
    const store = readStore();
    const id = req.params.id;
    const idx = store.profiles.findIndex((p) => p.id === id);
    if (idx === -1) {
      return res.status(404).json({ message: 'Perfil não encontrado.' });
    }
    const b = req.body || {};
    store.profiles[idx] = {
      ...store.profiles[idx],
      name: b.name !== undefined ? String(b.name) : store.profiles[idx].name,
      color: b.color !== undefined ? String(b.color) : store.profiles[idx].color,
      border_color: b.border_color !== undefined ? String(b.border_color) : store.profiles[idx].border_color,
      avatar_url: b.avatar_url !== undefined ? String(b.avatar_url) : store.profiles[idx].avatar_url,
      avatar_kind: b.avatar_kind !== undefined ? String(b.avatar_kind) : store.profiles[idx].avatar_kind,
      kids: b.kids !== undefined ? Boolean(b.kids) : store.profiles[idx].kids,
      max_rating: b.max_rating !== undefined ? String(b.max_rating) : store.profiles[idx].max_rating,
      updated: new Date().toISOString(),
    };
    saveStore(store);
    return res.status(200).json(store.profiles[idx]);
  });

  router.delete('/collections/profiles/records/:id', (req, res) => {
    const store = readStore();
    const id = req.params.id;
    store.profiles = store.profiles.filter((p) => p.id !== id);
    saveStore(store);
    return res.status(204).end();
  });

  // 5. Profile state
  router.get('/collections/profile_state/records', (req, res) => {
    const store = readStore();
    const filter = String(req.query.filter || '');
    const profMatch = filter.match(/profile="([^"]+)"/);
    const profileId = profMatch ? profMatch[1] : null;

    const items = profileId
      ? store.profile_state.filter((s) => s.profile === profileId)
      : store.profile_state;

    return res.json({
      page: 1,
      perPage: 100,
      totalItems: items.length,
      totalPages: 1,
      items,
    });
  });

  router.post('/collections/profile_state/records', (req, res) => {
    const store = readStore();
    const b = req.body || {};
    const state: ProfileStateRecord = {
      id: 'state_' + crypto.randomBytes(6).toString('hex'),
      user: String(b.user || 'user_shizuu122'),
      profile: String(b.profile || ''),
      saved: Array.isArray(b.saved) ? b.saved : [],
      watched: Array.isArray(b.watched) ? b.watched : [],
      progress: Array.isArray(b.progress) ? b.progress : [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    store.profile_state.push(state);
    saveStore(store);
    return res.status(200).json(state);
  });

  router.patch('/collections/profile_state/records/:id', (req, res) => {
    const store = readStore();
    const id = req.params.id;
    const idx = store.profile_state.findIndex((s) => s.id === id);
    if (idx === -1) {
      return res.status(404).json({ message: 'Estado não encontrado.' });
    }
    const b = req.body || {};
    store.profile_state[idx] = {
      ...store.profile_state[idx],
      saved: Array.isArray(b.saved) ? b.saved : store.profile_state[idx].saved,
      watched: Array.isArray(b.watched) ? b.watched : store.profile_state[idx].watched,
      progress: Array.isArray(b.progress) ? b.progress : store.profile_state[idx].progress,
      updated: new Date().toISOString(),
    };
    saveStore(store);
    return res.status(200).json(store.profile_state[idx]);
  });

  return router;
}
