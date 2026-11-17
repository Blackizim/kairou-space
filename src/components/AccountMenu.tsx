import React, { useEffect, useState } from 'react';
import { Check, Crown, LogOut, Pencil, Plus, Users, Shield } from 'lucide-react';
import type { Account, Profile } from './AccountModal';
import { smileyUrl } from './ProfileGate';
import { getPocketBaseToken } from '../utils/pocketbase';
import { getProfileRingColor } from '../utils/vipHelpers';

interface AccountMenuProps {
  isOpen: boolean;
  account: Account;
  profile: Profile;
  isVip: boolean;
  onClose: () => void;
  onSelect: (p: Profile) => void;
  onEdit: (p: Profile) => void;
  onManage: () => void;
  onAdd: () => void;
  onOpenVip: () => void;
  onLogout: () => void;
}

export function AccountMenu({
  isOpen,
  account,
  profile,
  isVip,
  onClose,
  onSelect,
  onEdit,
  onManage,
  onAdd,
  onOpenVip,
  onLogout,
}: AccountMenuProps) {
  const [rendered, setRendered] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      return;
    }
    const timer = setTimeout(() => setRendered(false), 160);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!rendered) return null;

  const renderAvatar = (p: Profile) => (
    <img
      src={p.avatar || smileyUrl(p.color)}
      alt=""
      style={{ boxShadow: `0 0 0 2px ${getProfileRingColor(p.borderColor, isVip)}` }}
      className="h-9 w-9 shrink-0 rounded-xl object-cover"
    />
  );

  const vipPill = (
    <span className="inline-flex shrink-0 items-center rounded-[5px] bg-[#fde047] px-1.5 py-[3px] text-[10px] font-black leading-none tracking-wide text-slate-950">
      VIP
    </span>
  );

  const kidsPill = (
    <span className="inline-flex shrink-0 items-center rounded-[5px] bg-gradient-to-r from-pink-500 to-cyan-400 px-1.5 py-[3px] text-[10px] font-black leading-none tracking-wide text-white shadow-sm">
      KIDS
    </span>
  );

  return (
    <div className="fixed inset-0 z-[45]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar menu"
        className={`absolute inset-0 h-full w-full cursor-default bg-transparent transition-opacity duration-150 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        role="menu"
        aria-label="Menu da conta"
        className={`${
          isOpen ? 'animate-kairou-menu' : 'animate-kairou-menu-out pointer-events-none'
        } fixed right-3 sm:right-[max(2rem,calc((100vw-1440px)/2))] top-[74px] z-[46] w-[284px] max-w-[calc(100vw-24px)] rounded-[20px] border border-white/15 bg-[#1b2535]/95 p-3 text-white shadow-[0_24px_60px_-15px_rgba(0,0,0,.9)] backdrop-blur-2xl`}
      >
        <span
          aria-hidden="true"
          className="absolute -top-[6px] right-[19px] h-3 w-3 rotate-45 border-l border-t border-white/15 bg-[#1b2535]"
        />

        {/* Header with active profile & VIP / Email subtitle */}
        <div className="flex items-center gap-3 px-2 py-3">
          {renderAvatar(profile)}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-bold text-white">{profile.name}</p>
              {isVip && vipPill}
              {profile.kids && kidsPill}
            </div>
            <p className="truncate text-xs text-slate-400">
              {profile.kids ? 'Perfil Infantil' : isVip ? 'VIP Kairou' : account.email}
            </p>
          </div>
        </div>

        <div className="my-2 border-t border-white/10" />

        {/* Profile Switcher Rows */}
        <div className="space-y-1">
          {account.profiles.map((p) => {
            const active = p.id === profile.id;
            return (
              <div
                key={p.id}
                className={`flex items-center rounded-xl transition-colors ${
                  active ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left cursor-pointer"
                >
                  {renderAvatar(p)}
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                    {isVip && vipPill}
                    {p.kids && kidsPill}
                  </span>
                  {active && <Check size={16} className="shrink-0 text-sky-400" />}
                </button>
                <button
                  type="button"
                  aria-label={`Editar ${p.name}`}
                  onClick={() => onEdit(p)}
                  className="rounded-lg p-3 text-slate-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  <Pencil size={15} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="my-2 border-t border-white/10" />

        {/* Actions */}
        <button
          type="button"
          onClick={onManage}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer"
        >
          <Users size={17} />
          Gerenciar perfis
        </button>

        {account.profiles.length < 5 && (
          <button
            type="button"
            onClick={onAdd}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer"
          >
            <Plus size={17} />
            Adicionar perfil
          </button>
        )}

        <button
          type="button"
          onClick={onOpenVip}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#fde047] transition-colors hover:bg-amber-400/10 cursor-pointer"
        >
          <span className="flex items-center gap-3">
            <Crown size={17} className="fill-[#fde047]/20 text-[#fde047]" />
            {isVip ? 'Kairou VIP' : 'Comprar VIP'}
          </span>
          {isVip && (
            <span className="rounded-full bg-[#fde047]/15 px-2 py-0.5 text-[10px] font-bold text-[#fde047]">
              Ativo
            </span>
          )}
        </button>

        {account.email.trim().toLowerCase() === 'shizuu122@gmail.com' && (
          <button type="button" onClick={() => {
            onClose();
            const admin = (window as unknown as { KairouAdmin?: { open: (state: unknown) => void } }).KairouAdmin;
            admin?.open({ user: { email: account.email }, pb: { authStore: { token: getPocketBaseToken() } } });
          }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer">
            <Shield size={17} /> Painel administrativo
          </button>
        )}

        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:bg-white/10 cursor-pointer"
        >
          <LogOut size={17} />
          Sair
        </button>
      </div>
    </div>
  );
}
