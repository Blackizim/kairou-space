import React from 'react';
import { Baby, Check, Plus, X } from 'lucide-react';
import type { Account, Profile } from './AccountModal';
import { getProfileRingColor } from '../utils/vipHelpers';
import './ProfileGate.css';

const Pencil = () => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
export const smileyUrl = (color: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="26" fill="${color}"/><circle cx="36" cy="40" r="6" fill="#ffffff"/><circle cx="64" cy="40" r="6" fill="#ffffff"/><path d="M32 60q18 16 36 0" stroke="#ffffff" stroke-width="7" fill="none" stroke-linecap="round"/></svg>`)}`;

export function ProfileGate({
  profiles,
  active,
  isVip = false,
  managing,
  currentAccountEmail,
  allAccounts = [],
  onManage,
  onSelect,
  onEdit,
  onAdd,
  onClose,
  onSwitchAccount,
  onNewAccount,
}: {
  profiles: Profile[];
  active: Profile | null;
  isVip?: boolean;
  managing: boolean;
  currentAccountEmail?: string;
  allAccounts?: Account[];
  onManage: () => void;
  onSelect: (p: Profile) => void;
  onEdit: (p: Profile) => void;
  onAdd: () => void;
  onClose: () => void;
  onSwitchAccount?: (acc: Account) => void;
  onNewAccount?: () => void;
}) {
  return (
    <div className={`gate${managing ? ' is-managing' : ''}`} role="dialog" aria-modal="true" aria-label="Escolher perfil">
      <div className="gate__glow" aria-hidden="true" />
      <button className="gate__skip" onClick={onClose} aria-label="Continuar sem escolher perfil"><X size={18}/></button>
      <div className="gate__inner">
        <p className="gate__brand"><span className="gate__mark" aria-hidden="true"/> KAIROU</p>
        <h2 className="gate__title">{managing ? 'Gerenciar perfis' : 'Quem está assistindo?'}</h2>

        <div className="gate__profiles">
          {profiles.map(p => (
            <button
              key={p.id}
              className={`gate__profile${active?.id === p.id ? ' is-active' : ''}`}
              onClick={() => managing ? onEdit(p) : onSelect(p)}
            >
              <span
                className="gate__avatar"
                style={{ '--ring': getProfileRingColor(p.borderColor, isVip) } as React.CSSProperties}
              >
                <img src={p.avatar || smileyUrl(p.color || '#2e7bff')} alt=""/>
                {p.kids && <span className="gate__kid" aria-label="Perfil Infantil"><Baby size={12} strokeWidth={2.5}/></span>}
                {managing && <span className="gate__edit-badge" aria-label="Editar perfil"><span className="gate__edit-circle"><Pencil/></span></span>}
              </span>
              <span className="gate__name">
                <span className="gate__name-text truncate max-w-[85px]">{p.name}</span>
                {isVip && <span className="nav-vip shrink-0">VIP</span>}
              </span>
            </button>
          ))}
          {profiles.length < 5 && (
            <button className="gate__profile gate__profile--add" onClick={onAdd}>
              <span className="gate__avatar gate__avatar--add"><Plus size={20}/></span>
              <span className="gate__name">Adicionar perfil</span>
            </button>
          )}
        </div>
        {profiles.length > 0 && (
          <button className={`btn ${managing ? 'btn--primary' : 'btn--ghost'}`} onClick={onManage}>
            {managing ? <><Check size={16}/> Concluído</> : <><Pencil/><span>Gerenciar perfis</span></>}
          </button>
        )}
      </div>
    </div>
  );
}
