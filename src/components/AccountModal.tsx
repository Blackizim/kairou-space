import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ProfileEditor } from './ProfileEditor';
import { ProfileGate } from './ProfileGate';
import { signInPocketBase, savePocketProfile, deletePocketProfile } from '../utils/pocketbase';
import { isAccountVip } from '../utils/vipHelpers';

export type Profile = {
  id: string;
  name: string;
  color: string;
  borderColor?: string;
  avatar?: string;
  kids?: boolean;
  maxRating?: string;
};

export type Account = {
  email: string;
  pbId?: string;
  salt: string;
  hash: string;
  profiles: Profile[];
  vipUntil?: number;
  redeemedVipCodes?: string[];
};

const ACCOUNTS = 'kairou_accounts_v1';

export const readAccounts = (): Account[] => {
  try {
    const data = JSON.parse(localStorage.getItem(ACCOUNTS) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

const saveAccounts = (accounts: Account[]) => localStorage.setItem(ACCOUNTS, JSON.stringify(accounts));

export function updateStoredAccount(updated: Account): Account {
  const accounts = readAccounts();
  const targetEmail = (updated.email || '').trim().toLowerCase();
  const exists = accounts.some((a) => (a.email || '').trim().toLowerCase() === targetEmail);
  const next = exists
    ? accounts.map((a) => ((a.email || '').trim().toLowerCase() === targetEmail ? { ...a, ...updated } : a))
    : [...accounts, updated];
  saveAccounts(next);
  return updated;
}

export function AccountModal({
  account,
  profile,
  onAccount,
  onProfile,
  onClose,
  onOpenVip,
  initialEdit,
  initialAdd,
  initialManage,
}: {
  account: Account | null;
  profile: Profile | null;
  onAccount: (a: Account) => void;
  onProfile: (p: Profile) => void;
  onClose: () => void;
  onLogout?: () => void;
  onOpenVip?: () => void;
  initialEdit?: Profile | null;
  initialAdd?: boolean;
  initialManage?: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(Boolean(initialManage));
  const [editing, setEditing] = useState<Profile | null>(initialEdit || null);
  const [adding, setAdding] = useState(Boolean(initialAdd));

  const vipActive = isAccountVip(account);
  const allAccounts = readAccounts();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const address = email.trim().toLowerCase();
    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    try {
      const created = await signInPocketBase(address, password, mode === 'register');
      updateStoredAccount(created);
      onAccount(created);
      setSwitchingAccount(false);
    } catch (err) {
      setError((err as Error).message || 'Não foi possível entrar. Verifique os dados informados.');
    } finally {
      setBusy(false);
    }
  };

  const updateProfiles = (profiles: Profile[]) => {
    if (!account) return;
    const updated = updateStoredAccount({ ...account, profiles });
    onAccount(updated);
  };

  if (account && !switchingAccount) {
    return (
      <>
        {error && <div role="alert" className="fixed z-[1100] bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-red-950 p-3 text-white">{error}</div>}
        <ProfileGate
          profiles={account.profiles}
          active={profile}
          isVip={vipActive}
          managing={managing}
          currentAccountEmail={account.email}
          allAccounts={allAccounts}
          onManage={() => setManaging(!managing)}
          onSelect={(p) => {
            onProfile(p);
            onClose();
          }}
          onEdit={setEditing}
          onAdd={() => setAdding(true)}
          onClose={onClose}
          onSwitchAccount={(acc) => {
            onAccount(acc);
          }}
          onNewAccount={() => {
            setSwitchingAccount(true);
            setError('');
          }}
        />
        {(adding || editing) && (
          <ProfileEditor
            isNew={!editing}
            isVip={vipActive}
            initial={
              editing || {
                id: crypto.randomUUID(),
                name: `Perfil ${account.profiles.length + 1}`,
                color: '#2e7bff',
              }
            }
            canDelete={Boolean(editing) && account.profiles.length > 1}
            onRequireVip={() => {
              setAdding(false);
              setEditing(null);
              onClose();
              onOpenVip?.();
            }}
            onCancel={() => {
              setAdding(false);
              setEditing(null);
            }}
            onSave={async (next) => {
              if (!account.pbId) { setError('Entre novamente para editar seus perfis.'); return; }
              try {
                const saved = await savePocketProfile(next, account.pbId, Boolean(editing));
                updateProfiles(editing ? account.profiles.map((p) => p.id === saved.id ? saved : p) : [...account.profiles, saved]);
                if (editing && profile?.id === saved.id) onProfile(saved);
                setEditing(null); setAdding(false);
              } catch { setError('Não foi possível salvar o perfil.'); }
            }}
            onDelete={async () => {
              if (!editing || !window.confirm(`Excluir o perfil ${editing.name} e seus dados?`)) return;
              try {
                await deletePocketProfile(editing.id);
                updateProfiles(account.profiles.filter((p) => p.id !== editing.id));
                if (profile?.id === editing.id) onProfile(account.profiles.find((p) => p.id !== editing.id)!);
                setEditing(null);
              } catch { setError('Não foi possível excluir o perfil.'); }
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="rea-profile">
      <div className="modal">
        <div className="modal__backdrop" onClick={onClose} />
        <div className="modal__panel modal__panel--sm" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button type="button" className="modal__close" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
          <p className="eyebrow">Kairou</p>
          <h3 className="modal__title" id="auth-title">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h3>
          <p className="modal__sub">Seus perfis, lista e histórico em qualquer aparelho.</p>
          <div className="tabs" id="auth-tabs">
            {(['login', 'register'] as const).map((m) => <button type="button" key={m} className={mode === m ? 'is-active' : ''} onClick={() => { setMode(m); setError(''); }}>{m === 'login' ? 'Entrar' : 'Criar conta'}</button>)}
          </div>
          <form className="form" onSubmit={submit}>
            <label className="field"><span>E-mail</span><input type="email" required autoComplete="email" placeholder="voce@email.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="field"><span>Senha</span><input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="mínimo 8 caracteres" value={password} onChange={e => setPassword(e.target.value)} /></label>
            {mode === 'register' && <label className="field"><span>Confirmar senha</span><input type="password" required autoComplete="new-password" placeholder="repita a senha" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>}
            {error && <p className="form__error" role="alert">{error}</p>}
            <button type="submit" disabled={busy} className="btn btn--primary btn--block">{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
            {switchingAccount && account && (
              <button
                type="button"
                onClick={() => {
                  setSwitchingAccount(false);
                  setError('');
                }}
                className="btn btn--ghost btn--block"
                style={{ marginTop: '10px' }}
              >
                Voltar para os perfis
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
