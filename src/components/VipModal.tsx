import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Crown, ExternalLink, KeyRound, Loader2, X, Zap } from 'lucide-react';
import { getPocketBaseToken, refreshPocketBase } from '../utils/pocketbase';
import type { Account } from './AccountModal';
import {
  VIP_PLANS,
  formatVipExpiration,
  isAccountVip,
  type VipPlanId,
} from '../utils/vipHelpers';

const PIXGG_URL = 'https://pixgg.com/pommern';

interface VipModalProps {
  account: Account;
  onUpdateAccount: (updated: Account) => void;
  onClose: () => void;
}

export const VipModal: React.FC<VipModalProps> = ({ account, onUpdateAccount, onClose }) => {
  const [selectedPlanId, setSelectedPlanId] = useState<VipPlanId>('trimestral');
  const [pixIdentifier, setPixIdentifier] = useState('');
  const [vipCode, setVipCode] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const pixInputRef = useRef<HTMLInputElement>(null);

  const vipActive = isAccountVip(account);
  const expirationLabel = formatVipExpiration(account.vipUntil);
  const selectedPlan = VIP_PLANS.find((p) => p.id === selectedPlanId) ?? VIP_PLANS[1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const requestVip = async (action: string, body: object) => {
    const token = getPocketBaseToken();
    const payload = {
      ...body,
      email: account?.email,
      userId: account?.pbId,
    };
    const response = await fetch(`/api/vip/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || 'Não foi possível confirmar agora.');
    }
    const refreshed = await refreshPocketBase();
    if (refreshed) {
      onUpdateAccount(refreshed);
    }
    return data;
  };

  const handleConfirmPix = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = pixIdentifier.trim();
    if (!query) {
      setFeedback({ kind: 'error', text: 'Informe seu nome ou e-mail usado no PixGG.' });
      return;
    }
    setIsChecking(true);
    setFeedback(null);
    try {
      const result = await requestVip('check-payment', { query });
      setFeedback({
        kind: 'success',
        text: result.message || 'Pagamento confirmado e VIP ativado!',
      });
      setPixIdentifier('');
      if (result.userVipUntil) {
        onUpdateAccount({
          ...account,
          vipUntil: new Date(result.userVipUntil).getTime(),
        });
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Falha ao verificar pagamento.',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = vipCode.trim().toUpperCase();
    if (!code) {
      setFeedback({ kind: 'error', text: 'Informe um código VIP para resgatar.' });
      return;
    }
    setIsRedeeming(true);
    setFeedback(null);
    try {
      const result = await requestVip('verify', { code });
      setFeedback({
        kind: 'success',
        text: result.message || 'Código VIP resgatado e VIP atualizado com sucesso!',
      });
      setVipCode('');
      if (result.userVipUntil) {
        onUpdateAccount({
          ...account,
          vipUntil: new Date(result.userVipUntil).getTime(),
        });
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Código inválido ou expirado.',
      });
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kairou-vip-title"
      onClick={onClose}
      className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-kairou-modal relative w-full max-w-[500px] rounded-[24px] border border-white/12 bg-[#111824] p-5 sm:p-6 text-white shadow-[0_32px_90px_-20px_rgba(0,0,0,0.95)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar Kairou VIP"
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300 transition-colors hover:bg-white/15 hover:text-white cursor-pointer"
        >
          <X size={18} />
        </button>

        {/* Title & Benefits */}
        <div className="pr-10">
          <h2 id="kairou-vip-title" className="flex items-center gap-2 font-display text-[22px] font-extrabold tracking-tight text-white">
            <Crown className="h-5 w-5 fill-[#fde047] text-[#fde047]" />
            <span>Kairou VIP</span>
          </h2>
          <p className="mt-1 text-[13px] text-slate-400">
            4K UHD · Zero anúncios · Servidor VIP · 5 perfis
          </p>

          {vipActive ? (
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fde047] px-3 py-1 text-xs font-extrabold text-slate-950 shadow-sm">
                <Crown className="h-3.5 w-3.5 fill-slate-950 text-slate-950" />
                VIP ativo
              </span>
              <span className="text-[13px] text-slate-400 tabular-nums">até {expirationLabel}</span>
            </div>
          ) : (
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-xs font-bold text-slate-300">
                <Crown className="h-3.5 w-3.5 text-slate-400" />
                Plano gratuito
              </span>
              <span className="text-[13px] text-slate-400">1080p · com anúncios</span>
            </div>
          )}
        </div>

        {/* 3 Plan Cards */}
        <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
          {VIP_PLANS.map((plan) => {
            const selected = plan.id === selectedPlanId;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => {
                  setSelectedPlanId(plan.id);
                  setFeedback(null);
                }}
                className={`flex flex-col items-center justify-center rounded-2xl px-2 py-4 text-center transition-all cursor-pointer ${
                  selected
                    ? 'border-2 border-[#0ea5e9] bg-[#162844] shadow-[0_0_24px_-8px_rgba(14,165,233,0.6)]'
                    : 'border border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]'
                }`}
              >
                <span className="text-[10.5px] font-bold tracking-wider text-slate-400">
                  {plan.badge}
                </span>
                <span className="mt-1 font-display text-lg sm:text-[21px] font-extrabold text-white tabular-nums">
                  {plan.priceLabel}
                </span>
                <span className="mt-1 text-[11px] font-bold text-emerald-400">
                  {plan.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Checkout & Redemption Panel */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
          <a
            id="vip-pay"
            href={PIXGG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0ea5e9] px-4 py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_-10px_rgba(14,165,233,0.75)] transition-all hover:brightness-110 active:scale-[0.99] cursor-pointer"
          >
            <Zap className="h-4 w-4 fill-current" />
            <span>
              Pagar {selectedPlan.label} ({selectedPlan.priceLabel}) no Pix
            </span>
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </a>

          <form onSubmit={handleConfirmPix} className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-200" htmlFor="vip-query">
              <CheckCircle2 className="h-3.5 w-3.5 fill-sky-400 text-[#111824]" />
              <span>Já pagou? Confirme seu Pix:</span>
            </label>
            <div className="flex gap-2">
              <input
                ref={pixInputRef}
                id="vip-query"
                type="text"
                value={pixIdentifier}
                onChange={(e) => setPixIdentifier(e.target.value)}
                placeholder="Nome ou e-mail no PixGG"
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={isChecking}
                className="shrink-0 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/12 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {isChecking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isChecking ? 'Buscando…' : 'Confirmar'}</span>
              </button>
            </div>
          </form>

          <form onSubmit={handleRedeemCode} className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-200" htmlFor="vip-code-input">
              <KeyRound className="h-3.5 w-3.5 text-sky-400" />
              <span>Resgatar código VIP:</span>
            </label>
            <div className="flex gap-2">
              <input
                id="vip-code-input"
                type="text"
                value={vipCode}
                onChange={(e) => setVipCode(e.target.value)}
                placeholder="Ex: KAI-ANUAL-XXXX-XXXX"
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-sm uppercase text-white placeholder:normal-case placeholder:text-slate-500 outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={isRedeeming}
                className="shrink-0 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/12 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {isRedeeming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isRedeeming ? 'Resgatando…' : 'Resgatar'}</span>
              </button>
            </div>
          </form>

          {feedback && (
            <p
              role={feedback.kind === 'error' ? 'alert' : 'status'}
              className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                feedback.kind === 'success'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-400/30 bg-red-500/10 text-red-200'
              }`}
            >
              {feedback.text}
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-[11.5px] text-slate-400">
          Pagamento instantâneo via{' '}
          <a
            href={PIXGG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-slate-200 underline hover:text-white"
          >
            PixGG
          </a>
          . Sem assinatura recorrente.
        </p>
      </div>
    </div>
  );
};
