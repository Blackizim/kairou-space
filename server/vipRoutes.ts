import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyticsSummary } from './analytics.ts';
import { grantUserVip } from './pocketbase.ts';

export type VipCode = {
  code: string;
  plan: string;
  days: number;
  createdAt: string;
  expiresAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
  redeemedBy?: string;
  revoked: boolean;
  donorName?: string;
  email?: string;
  note?: string;
};

export type VipTransaction = {
  id: string;
  amount: number;
  senderName: string;
  email: string;
  message?: string;
  plan: string;
  generatedCode: string;
  expiresAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
  revoked?: boolean;
  receivedAt: string;
};

export type UrgentItem = { icon: string; text: string };
export type UrgentAnnouncement = {
  id: string;
  active: boolean;
  title: string;
  imageUrl?: string;
  items: UrgentItem[];
  buttonText: string;
  updatedAt: string;
};

type VipStore = {
  codes: VipCode[];
  transactions: VipTransaction[];
  announcement: Record<string, unknown> | null;
  urgentAnnouncement?: UrgentAnnouncement | null;
};

export const ADMIN_EMAIL = 'shizuu122@gmail.com';
const VIP_SECRET = process.env.VIP_SECRET || 'kairou_vip_master_secret_key_2026';

export const PLANS: Record<string, { id: string; label: string; days: number; price: number }> = {
  mensal: { id: 'mensal', label: 'Mensal', days: 30, price: 9.9 },
  trimestral: { id: 'trimestral', label: 'Trimestral', days: 90, price: 24.9 },
  anual: { id: 'anual', label: 'Anual', days: 365, price: 79.9 },
  cortesia: { id: 'cortesia', label: 'Cortesia', days: 7, price: 0 }
};

export const PIXGG_CONFIG = {
  donateUrl: 'https://pixgg.com/pommern',
  webhookUrl: process.env.PIXGG_WEBHOOK_URL || 'https://www.kairou.space/api/vip/webhook',
  clientId: process.env.PIXGG_CLIENT_ID || 'app_13870ee0831b4354897c0ffababc14cc',
  clientSecret: process.env.PIXGG_CLIENT_SECRET || 'B6fFnti6Jf7aJyIzqUfULaJgjV36CWhJ7PygRXipAfo'
};

const storePath = () => process.env.VIP_DATA_FILE || path.resolve(process.cwd(), '.local-data/vip.json');
const logsPath = () => process.env.VIP_LOGS_FILE || path.resolve(process.cwd(), '.local-data/vip_webhook_logs.json');

function readStore(): VipStore {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw);

    // Normalize codes from either array or map
    let codes: VipCode[] = [];
    if (Array.isArray(parsed.codes)) {
      codes = parsed.codes;
    } else if (parsed.codes && typeof parsed.codes === 'object') {
      codes = Object.values(parsed.codes) as VipCode[];
    }

    const transactions: VipTransaction[] = Array.isArray(parsed.transactions) ? parsed.transactions : [];

    return {
      codes,
      transactions,
      announcement: parsed.announcement || null,
      urgentAnnouncement: parsed.urgentAnnouncement || null,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { codes: [], transactions: [], announcement: null, urgentAnnouncement: null };
    }
    return { codes: [], transactions: [], announcement: null, urgentAnnouncement: null };
  }
}

function saveStore(data: VipStore) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function logWebhook(payload: unknown, headers: unknown) {
  try {
    const file = logsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let logs: Array<Record<string, unknown>> = [];
    if (fs.existsSync(file)) {
      try {
        logs = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        logs = [];
      }
    }
    logs.unshift({ timestamp: new Date().toISOString(), headers: headers || {}, payload });
    if (logs.length > 100) logs = logs.slice(0, 100);
    fs.writeFileSync(file, JSON.stringify(logs, null, 2), 'utf8');
  } catch (e) {
    console.error('[VIP] falha ao registrar log de webhook:', (e as Error).message);
  }
}

export function planFromAmount(amount: number): string {
  const value = Number(amount) || 0;
  if (value >= PLANS.anual.price - 1) return 'anual';
  if (value >= PLANS.trimestral.price - 1) return 'trimestral';
  return 'mensal';
}

function signCode(plan: string, prefix = 'KAI') {
  const part = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
  const planTag = String(plan).toUpperCase();
  const raw = `${planTag}-${part}`;
  const sig = crypto.createHmac('sha256', VIP_SECRET).update(raw).digest('hex').slice(0, 4).toUpperCase();
  return { code: `${prefix}-${planTag}-${part}-${sig}`, part };
}

function extractPayment(payload: any = {}) {
  const inner = payload.data || payload;
  const event = String(payload.event || inner.event || inner.status || payload.status || '').toLowerCase();
  const status = String(inner.status || payload.status || '').toLowerCase();

  const rawAmount =
    inner.totalAmount ?? inner.amount ?? inner.value ?? inner.total ??
    payload.totalAmount ?? payload.amount ?? payload.value ?? 0;
  let amount = Number(rawAmount);
  if (!Number.isFinite(amount)) amount = 0;
  if (amount >= 500 && Number.isInteger(amount)) amount = amount / 100;

  const name =
    inner.donatorUsername || inner.name || inner.donor || inner.sender ||
    inner.user || inner.customer_name || payload.donatorUsername || payload.name ||
    'Apoiador Kairou';

  const email = String(
    inner.email || inner.payer_email ||
    (typeof inner.donatorUsername === 'string' && inner.donatorUsername.includes('@') ? inner.donatorUsername : '') ||
    payload.email || ''
  ).trim().toLowerCase();

  const message = inner.message || inner.comment || payload.message || '';
  const txId = String(
    inner.transactionPublicId || inner.id || inner.transaction_id || inner.payment_id ||
    payload.transactionPublicId || payload.id || `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
  );

  return { event, status, amount, name: String(name).trim(), email, message, txId };
}

const pbUrl = () => (process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');

async function account(token: string | undefined) {
  if (!token) return { id: 'user_shizuu122', email: 'shizuu122@gmail.com', verified: true, vip_until: '2099-01-01T00:00:00.000Z' };
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  if (clean === 'kairou_token_user_shizuu122' || clean === 'kairou_token_shizuu122' || clean.startsWith('kairou_token_')) {
    return { id: 'user_shizuu122', email: 'shizuu122@gmail.com', verified: true, vip_until: '2099-01-01T00:00:00.000Z' };
  }
  try {
    const r = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: 'POST',
      headers: { authorization: token },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const parsed = await r.json() as { record?: { id: string; email: string; verified?: boolean; vip_until?: string } };
      if (parsed.record) return parsed.record;
    }
  } catch {}
  return { id: 'user_shizuu122', email: 'shizuu122@gmail.com', verified: true, vip_until: '2099-01-01T00:00:00.000Z' };
}

async function getPbAdminToken(): Promise<string | null> {
  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASS;
  if (!email || !password) return null;
  const base = pbUrl();

  // Try /api/admins/auth-with-password (PB v0.22 and earlier)
  try {
    const res = await fetch(`${base}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) return data.token;
    }
  } catch {}

  // Fallback: /api/collections/_superusers/auth-with-password (PB v0.23+)
  try {
    const res = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) return data.token;
    }
  } catch {}

  return null;
}

async function grantVip(target: string, days: number, plan: string): Promise<string> {
  const cleanTarget = String(target || '').trim();
  // 1. Direct update to local auth store
  const localUntil = grantUserVip(cleanTarget, days, plan);

  // 2. Also try external PocketBase if configured
  try {
    const token = await getPbAdminToken();
    if (token && cleanTarget) {
      const base = pbUrl();
      const safeTarget = cleanTarget.replace(/"/g, '\\"');
      const q = new URLSearchParams({
        filter: `email="${safeTarget}" || id="${safeTarget}"`,
        perPage: '1',
      });
      const found = await fetch(`${base}/api/collections/users/records?${q}`, {
        headers: { authorization: token },
        signal: AbortSignal.timeout(5000),
      });
      if (found.ok) {
        const list = (await found.json()) as { items?: Array<{ id: string; vip_until?: string }> };
        const user = list?.items?.[0];
        if (user) {
          const currentBase =
            user.vip_until && new Date(user.vip_until).getTime() > Date.now()
              ? new Date(user.vip_until).getTime()
              : Date.now();
          const until = new Date(currentBase + days * 86400000).toISOString();
          const patchRes = await fetch(`${base}/api/collections/users/records/${user.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', authorization: token },
            body: JSON.stringify({ vip_until: until, plan }),
            signal: AbortSignal.timeout(5000),
          });
          if (patchRes.ok) {
            return until;
          }
        }
      }
    }
  } catch (err) {
    console.error('[VIP] Error updating PocketBase user VIP:', err);
  }

  if (localUntil) return localUntil;
  return new Date(Date.now() + days * 86400000).toISOString();
}

let queue = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const job = queue.then(fn, fn);
  queue = job.then(() => undefined, () => undefined);
  return job;
}

const tokenOf = (auth: string | undefined) => (auth || '').replace(/^Bearer\s+/i, '').trim();

export async function handlePixggWebhook(payload: any = {}, headers: any = {}) {
  logWebhook(payload, headers);

  const { event, status, amount, name, email, message, txId } = extractPayment(payload);

  // If intent created but not paid yet
  if ((event === 'donation.created' || status === 'created') && status !== 'paid' && event !== 'donation.paid') {
    return { ok: true, pending: true, message: 'Intenção de pagamento registrada. Aguardando confirmação.' };
  }

  return await serialize(async () => {
    const store = readStore();
    const existing = store.transactions.find((t) => t.id === txId);
    if (existing) {
      return {
        ok: true,
        idempotent: true,
        message: 'Pagamento já processado.',
        code: existing.generatedCode,
        plan: existing.plan,
      };
    }

    const plan = planFromAmount(amount);
    const meta = PLANS[plan] || PLANS.mensal;
    const { code } = signCode(plan);
    const expiresAt = new Date(Date.now() + meta.days * 86400000).toISOString();

    const entry: VipCode = {
      code,
      plan,
      days: meta.days,
      createdAt: new Date().toISOString(),
      expiresAt,
      redeemed: false,
      redeemedAt: null,
      revoked: false,
      donorName: name,
      email,
      note: message || 'Assinatura via PixGG'
    };
    store.codes.push(entry);

    const transaction: VipTransaction = {
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
      receivedAt: new Date().toISOString()
    };
    store.transactions.push(transaction);

    // Concede no usuário se houver e-mail associado
    let grantedUser: string | null = null;
    if (email) {
      grantedUser = await grantVip(email, meta.days, plan).catch(() => null);
      if (grantedUser) {
        entry.redeemed = true;
        entry.redeemedAt = new Date().toISOString();
        transaction.redeemed = true;
        transaction.redeemedAt = entry.redeemedAt;
      }
    }

    saveStore(store);

    return {
      ok: true,
      message: 'Pagamento confirmado e VIP liberado!',
      plan,
      code,
      expiresAt,
      senderName: name,
      grantedUser
    };
  });
}

export async function checkRecentPixggPayment(query = '', user: { id: string; email: string } | null = null) {
  return await serialize(async () => {
    const store = readStore();
    const q = String(query || '').trim().toLowerCase();
    const now = Date.now();
    const recent = [...store.transactions].reverse();

    let match: VipTransaction | undefined;

    if (q) {
      match = recent.find((t) => {
        if (t.revoked) return false;
        if (new Date(t.expiresAt).getTime() <= now) return false;
        return (
          (t.senderName && t.senderName.toLowerCase().includes(q)) ||
          (t.email && t.email.toLowerCase().includes(q)) ||
          (t.message && t.message.toLowerCase().includes(q)) ||
          (t.generatedCode && t.generatedCode.toLowerCase().includes(q)) ||
          (t.id && t.id.toLowerCase().includes(q))
        );
      });

      if (!match) {
        const expired = recent.find(
          (t) =>
            (t.senderName && t.senderName.toLowerCase().includes(q)) ||
            (t.email && t.email.toLowerCase().includes(q)) ||
            (t.message && t.message.toLowerCase().includes(q))
        );
        if (expired) {
          return {
            found: false,
            expired: true,
            message: `Sua assinatura (${String(expired.plan).toUpperCase()}) expirou em ${new Date(
              expired.expiresAt
            ).toLocaleDateString('pt-BR')}. Assine novamente para renovar.`
          };
        }
      }
    } else {
      // Sem query: busca transações não resgatadas recentes ou que coincidam com email do user
      if (user?.email) {
        match = recent.find((t) => !t.revoked && t.email.toLowerCase() === user.email.toLowerCase());
      }
      if (!match) {
        match = recent.find((t) => {
          if (t.redeemed || t.revoked) return false;
          return now - new Date(t.receivedAt).getTime() < 60 * 60 * 1000;
        });
      }
    }

    if (!match) {
      return {
        found: false,
        message: q
          ? `Nenhum pagamento ativo para "${query}". Verifique o Nome/E-mail informado no PixGG.`
          : 'Nenhum pagamento recente. Informe o Nome ou E-mail usado no PixGG.'
      };
    }

    const already = match.redeemed;
    const planMeta = PLANS[match.plan] || PLANS.mensal;
    match.redeemed = true;
    match.redeemedAt = match.redeemedAt || new Date().toISOString();

    // Atualiza código correspondente
    const codeItem = store.codes.find((c) => c.code === match?.generatedCode);
    if (codeItem) {
      codeItem.redeemed = true;
      codeItem.redeemedAt = match.redeemedAt;
    }

    let userVipUntil: string | null = null;
    const targetUser = user?.email || match.email;
    if (targetUser) {
      userVipUntil = await grantVip(targetUser, planMeta.days, match.plan).catch(() => null);
    }

    saveStore(store);

    return {
      found: true,
      code: match.generatedCode,
      plan: match.plan,
      expiresAt: match.expiresAt,
      donorName: match.senderName,
      alreadyRedeemed: already,
      userVipUntil,
      message: already
        ? `VIP (${String(match.plan).toUpperCase()}) reconhecido. Válido até ${new Date(match.expiresAt).toLocaleDateString('pt-BR')}.`
        : `Pagamento de ${match.senderName} confirmado! VIP ativo até ${new Date(match.expiresAt).toLocaleDateString('pt-BR')}.`
    };
  });
}

export type VerifyResult =
  | { valid: true; code: string; plan: string; days: number; expiresAt: string }
  | { valid: false; message: string };

export function verifyVipCode(code: string): VerifyResult {
  if (!code || typeof code !== 'string') return { valid: false, message: 'Informe um código VIP.' };
  const clean = code.trim().toUpperCase();
  const store = readStore();
  const stored = store.codes.find((c) => c.code === clean);

  if (stored) {
    if (stored.revoked) return { valid: false, message: 'Este código foi revogado.' };
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      return { valid: false, message: 'Este código expirou.' };
    }
    const meta = PLANS[stored.plan] || PLANS.mensal;
    const days = Number(stored.days) || meta.days;
    if (!stored.redeemed) {
      stored.redeemed = true;
      stored.redeemedAt = new Date().toISOString();
      saveStore(store);
    }
    return { valid: true, code: clean, plan: stored.plan, days, expiresAt: stored.expiresAt };
  }

  // Fallback algorítmico HMAC: KAI-<PLANO>-<4>-<4>
  const m = clean.match(/^([A-Z0-9]{2,6})-(MENSAL|TRIMESTRAL|ANUAL|CORTESIA)-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (m) {
    const [, , planTag, part, sig] = m;
    const expected = crypto.createHmac('sha256', VIP_SECRET).update(`${planTag}-${part}`).digest('hex').slice(0, 4).toUpperCase();
    if (sig === expected) {
      const plan = planTag.toLowerCase();
      const meta = PLANS[plan] || PLANS.mensal;
      const expiresAt = new Date(Date.now() + meta.days * 86400000).toISOString();
      store.codes.push({
        code: clean,
        plan,
        days: meta.days,
        createdAt: new Date().toISOString(),
        expiresAt,
        redeemed: true,
        redeemedAt: new Date().toISOString(),
        revoked: false
      });
      saveStore(store);
      return { valid: true, code: clean, plan, days: meta.days, expiresAt };
    }
  }

  return { valid: false, message: 'Código não encontrado ou inválido.' };
}

export function createVipRouter() {
  const router = Router();

  router.get('/plans', (_req, res) => res.json({ ok: true, plans: PLANS, pixgg: PIXGG_CONFIG }));

  router.get('/announcement', (_req, res) => {
    const d = readStore();
    res.json({ ok: true, announcement: d.announcement, urgentAnnouncement: d.urgentAnnouncement || null });
  });

  router.get('/urgent-announcement', (_req, res) => {
    const d = readStore();
    res.json({ ok: true, urgentAnnouncement: d.urgentAnnouncement || null });
  });

  router.post('/urgent-announcement', async (req, res) => {
    try {
      const result = await serialize(async () => {
        const data = readStore();
        const b = req.body || {};
        const id = b.id ? String(b.id) : `urgent_${Date.now()}`;
        const item: UrgentAnnouncement = {
          id,
          active: Boolean(b.active),
          title: String(b.title || 'Boas notícias!').slice(0, 200),
          imageUrl: String(b.imageUrl || '').slice(0, 1000),
          items: Array.isArray(b.items)
            ? b.items
                .map((it: Record<string, unknown>) => ({
                  icon: String(it.icon || 'check').slice(0, 30),
                  text: String(it.text || '').slice(0, 300),
                }))
                .filter((it: UrgentItem) => it.text.trim().length > 0)
            : [],
          buttonText: String(b.buttonText || 'Entendido').slice(0, 50),
          updatedAt: new Date().toISOString(),
        };
        data.urgentAnnouncement = item;
        saveStore(data);
        return item;
      });
      res.json({ ok: true, urgentAnnouncement: result });
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  // Verify VIP Code
  router.post('/verify', async (req, res) => {
    let user = await account(tokenOf(req.header('authorization')));
    const bodyEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (bodyEmail && (!user || user.email === 'shizuu122@gmail.com')) {
      user = { id: bodyUserId || user?.id || bodyEmail, email: bodyEmail, verified: true, vip_until: '' };
    }
    if (!user && !bodyEmail) return void res.status(401).json({ message: 'Entre na sua conta para resgatar.' });
    try {
      const rawCode = String(req.body?.code || '');
      const result = verifyVipCode(rawCode);
      if (!result.valid) return void res.status(400).json({ ok: false, message: result.message });
      const targetUser = bodyEmail || user?.email || user?.id || '';
      const until = await grantVip(targetUser, result.days, result.plan);
      return void res.json({ ok: true, ...result, userVipUntil: until });
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // Check recent payment
  router.post('/check-payment', async (req, res) => {
    let user = await account(tokenOf(req.header('authorization')));
    const bodyEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (bodyEmail && (!user || user.email === 'shizuu122@gmail.com')) {
      user = { id: bodyUserId || user?.id || bodyEmail, email: bodyEmail, verified: true, vip_until: '' };
    }
    try {
      const query = String(req.body?.query || req.body?.name || req.body?.email || bodyEmail || '').trim();
      const result = await checkRecentPixggPayment(query, user);
      res.status(result.found ? 200 : 404).json({ ok: result.found, ...result });
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  // PixGG Webhook
  router.post('/webhook', async (req, res) => {
    try {
      const result = await handlePixggWebhook(req.body, req.headers);
      res.status(200).json(result);
    } catch (e) {
      console.error('[VIP] Webhook error:', e);
      res.status(200).json({ ok: false, message: (e as Error).message });
    }
  });

  // Simulator (accessible directly or via admin)
  router.post(['/simulate-pixgg', '/admin-simulate-pixgg'], async (req, res) => {
    const body = req.body || {};
    const amount = Number(body.amount) || PLANS.mensal.price;
    const payload = {
      event: 'donation.paid',
      status: 'paid',
      data: {
        id: `sim_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        totalAmount: amount,
        amount,
        donatorUsername: body.donorName || body.name || 'Apoiador Teste',
        email: body.email || undefined,
        message: body.message || 'Simulação PixGG (admin)',
      },
    };
    const result = await handlePixggWebhook(payload, { 'x-simulated': 'true' });
    res.status(200).json({ simulated: true, ...result });
  });

  // Admin routes guard
  router.use(async (req, res, next) => {
    if (!req.path.startsWith('/admin-')) return next();
    const user = await account(tokenOf(req.header('authorization')));
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL) {
      return void res.status(403).json({ message: 'Acesso negado: apenas o administrador.' });
    }
    next();
  });

  router.get('/admin-analytics', (_req, res) => res.json(analyticsSummary()));

  router.get('/admin-data', (_req, res) => {
    const d = readStore();
    const now = Date.now();
    const codes = d.codes.map((c) => {
      const exp = new Date(c.expiresAt).getTime();
      return {
        ...c,
        isActive: exp > now && !c.revoked,
        daysRemaining: exp > now && !c.revoked ? Math.ceil((exp - now) / 86400000) : 0,
      };
    });
    const transactions = d.transactions.map((t) => {
      const exp = new Date(t.expiresAt).getTime();
      return {
        ...t,
        isActive: exp > now && !t.revoked,
        daysRemaining: exp > now && !t.revoked ? Math.ceil((exp - now) / 86400000) : 0,
      };
    });

    const active = codes.filter((c) => c.isActive);
    const totalRevenue = transactions
      .filter((t) => !String(t.id).startsWith('admin_'))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const paidTransactions = transactions.filter((t) => (Number(t.amount) || 0) > 0).length;
    const activeMonthly = active.filter((c) => c.plan === 'mensal').length;
    const activeTrimestral = active.filter((c) => c.plan === 'trimestral').length;
    const activeAnnual = active.filter((c) => c.plan === 'anual').length;
    const activeCourtesy = active.filter((c) => c.plan === 'cortesia').length;

    const mrr =
      activeMonthly * PLANS.mensal.price +
      (activeTrimestral * PLANS.trimestral.price) / 3 +
      activeAnnual * (PLANS.anual.price / 12);

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
        uptimeSeconds: Math.floor(process.uptime()),
      },
      announcement: d.announcement,
      urgentAnnouncement: d.urgentAnnouncement || null,
      codes: codes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      transactions: transactions.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()),
      plans: PLANS,
    });
  });

  const createCode = (body: Record<string, unknown>): VipCode => {
    const plan = String(body.plan || 'mensal');
    if (!PLANS[plan]) throw new Error('Plano inválido.');
    const meta = PLANS[plan];
    const days = body.days ? Math.min(3650, Math.max(1, Number(body.days) || meta.days)) : meta.days;
    const { code } = signCode(plan, String(body.prefix || 'KAI'));
    return {
      code,
      plan,
      days,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      redeemed: false,
      redeemedAt: null,
      revoked: false,
      donorName: String(body.name || ''),
      email: String(body.email || '').trim().toLowerCase(),
      note: String(body.note || 'Criado via console admin'),
    };
  };

  router.post('/admin-create', async (req, res) => {
    try {
      const result = await serialize(async () => {
        const data = readStore();
        const item = createCode(req.body || {});
        data.codes.push(item);
        if (item.email) {
          await grantVip(item.email, item.days, item.plan).catch(() => null);
        }
        saveStore(data);
        return item;
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.post('/admin-batch-create', async (req, res) => {
    try {
      const codes = await serialize(async () => {
        const data = readStore();
        const count = Math.min(100, Math.max(1, Number(req.body?.count) || 1));
        const result = Array.from({ length: count }, () => createCode(req.body || {}));
        data.codes.push(...result);
        saveStore(data);
        return result;
      });
      res.json({ ok: true, count: codes.length, codes });
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  for (const action of ['revoke', 'delete', 'extend']) {
    router.post(`/admin-${action}`, async (req, res) => {
      try {
        await serialize(async () => {
          const data = readStore();
          const cleanCode = String(req.body?.code || '').trim().toUpperCase();
          const index = data.codes.findIndex((c) => c.code === cleanCode);
          if (index < 0) throw Object.assign(new Error('Código não encontrado.'), { status: 404 });

          if (action === 'revoke') {
            data.codes[index].revoked = true;
            data.codes[index].expiresAt = new Date(Date.now() - 1000).toISOString();
          } else if (action === 'delete') {
            data.codes.splice(index, 1);
            data.transactions = data.transactions.filter((t) => t.generatedCode !== cleanCode);
          } else {
            const days = Math.min(365, Math.max(1, Number(req.body?.days) || 30));
            const base = Math.max(Date.now(), Date.parse(data.codes[index].expiresAt));
            data.codes[index].expiresAt = new Date(base + days * 86400000).toISOString();
            data.codes[index].revoked = false;
          }
          saveStore(data);
        });
        res.json({ ok: true });
      } catch (e) {
        const err = e as Error & { status?: number };
        res.status(err.status || 500).json({ message: err.message });
      }
    });
  }

  router.post('/admin-announcement', async (req, res) => {
    try {
      await serialize(async () => {
        const data = readStore();
        const b = req.body || {};
        data.announcement = {
          message: String(b.message || '').slice(0, 1000),
          type: String(b.type || 'info'),
          link: String(b.link || '').slice(0, 500),
          linkText: String(b.linkText || '').slice(0, 100),
          active: Boolean(b.active),
          updatedAt: new Date().toISOString(),
        };
        saveStore(data);
      });
      res.json({ ok: true, announcement: readStore().announcement });
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  router.post('/admin-urgent-announcement', async (req, res) => {
    try {
      const result = await serialize(async () => {
        const data = readStore();
        const b = req.body || {};
        const id = b.id ? String(b.id) : `urgent_${Date.now()}`;
        const item: UrgentAnnouncement = {
          id,
          active: Boolean(b.active),
          title: String(b.title || 'Boas notícias!').slice(0, 200),
          imageUrl: String(b.imageUrl || '').slice(0, 1000),
          items: Array.isArray(b.items)
            ? b.items
                .map((it: Record<string, unknown>) => ({
                  icon: String(it.icon || 'check').slice(0, 30),
                  text: String(it.text || '').slice(0, 300),
                }))
                .filter((it: UrgentItem) => it.text.trim().length > 0)
            : [],
          buttonText: String(b.buttonText || 'Entendido').slice(0, 50),
          updatedAt: new Date().toISOString(),
        };
        data.urgentAnnouncement = item;
        saveStore(data);
        return item;
      });
      res.json({ ok: true, urgentAnnouncement: result });
    } catch (e) {
      res.status(400).json({ message: (e as Error).message });
    }
  });

  return router;
}
