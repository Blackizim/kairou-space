import React from 'react';
import { ArrowLeft, Bookmark, Film, Home, Search, Tv } from 'lucide-react';
import { smileyUrl } from './ProfileGate';
import type { Profile } from './AccountModal';
import { getProfileRingColor } from '../utils/vipHelpers';
import { KairouLogo } from './KairouLogo';

export type NavSection = 'home' | 'movies' | 'shows' | 'channels' | 'mylist';

interface TopNavProps {
  activeSection: NavSection;
  showBack?: boolean;
  onBack?: () => void;
  onSelectSection: (section: NavSection) => void;
  onOpenSearch: () => void;
  onOpenAccount: () => void;
  profile?: Profile | null;
  isVip?: boolean;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeSection,
  showBack = false,
  onBack,
  onSelectSection,
  onOpenSearch,
  onOpenAccount,
  profile,
  isVip = false,
}) => {
  const isKids = Boolean(profile?.kids);
  const navItems: Array<{ id: NavSection; label: string; mobileLabel: string; icon: React.ReactNode }> = [
    { id: 'home', label: 'Início', mobileLabel: 'Início', icon: <Home className="w-3.5 h-3.5" /> },
    { id: 'movies', label: isKids ? 'Filmes Infantis' : 'Filmes', mobileLabel: 'Filmes', icon: <Film className="w-3.5 h-3.5" /> },
    { id: 'shows', label: isKids ? 'Desenhos & Séries' : 'Séries', mobileLabel: isKids ? 'Desenhos' : 'Séries', icon: <Tv className="w-3.5 h-3.5" /> },
    { id: 'mylist', label: 'Minha Lista', mobileLabel: 'Lista', icon: <Bookmark className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="fixed top-0 inset-x-0 z-40 pointer-events-none px-2 sm:px-8 py-2.5 sm:py-5">
      <div className="mx-auto max-w-[1440px] flex items-center justify-between gap-1 sm:gap-4">
        {/* Left: Back arrow (on info page) + Brand monogram */}
        <div className="flex items-center gap-1.5 sm:gap-3 pointer-events-auto shrink-0">
          {showBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar ao catálogo"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md border border-white/12 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelectSection('home')}
            aria-label="Kairou — Início"
            className={`${
              showBack ? 'hidden sm:flex' : 'flex'
            } items-center gap-1 sm:gap-2 focus-visible:outline-2 focus-visible:outline-white rounded-lg cursor-pointer shrink-0`}
          >
            <KairouLogo showWordmark={false} size="sm" />
            <span
              className={`font-display font-bold tracking-tight text-white text-base sm:text-2xl ${
                isKids ? 'hidden min-[420px]:inline' : 'inline'
              }`}
            >
              Kairou
            </span>
            {isKids && (
              <span className="inline-flex items-center rounded-md bg-gradient-to-r from-pink-500 to-cyan-400 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-white shadow-sm ml-0.5 sm:ml-1 select-none">
                KIDS
              </span>
            )}
          </button>
        </div>

        {/* Right: Floating frosted glass pill dock matching reference */}
        <nav
          aria-label="Navegação principal"
          className="pointer-events-auto flex items-center gap-0.5 sm:gap-1 rounded-full bg-black/45 backdrop-blur-xl border border-white/14 p-1 sm:p-1.5 shadow-2xl overflow-x-auto max-w-full shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => {
            const active = activeSection === item.id && !showBack;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-4 py-1.5 rounded-full text-[11px] sm:text-[13px] font-medium whitespace-nowrap shrink-0 transition-all duration-150 cursor-pointer ${
                  active
                    ? 'bg-white text-stone-950 font-semibold shadow-sm'
                    : 'text-stone-200/90 hover:text-white hover:bg-white/10'
                }`}
              >
                {active && <span className="hidden sm:inline-flex">{item.icon}</span>}
                <span className="sm:hidden">{item.mobileLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}

          <span aria-hidden="true" className="w-px h-4 bg-white/15 mx-0.5 sm:mx-1 shrink-0" />

          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Buscar filmes e séries"
            className="p-1.5 sm:p-2 rounded-full text-stone-200 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenAccount}
            aria-label={profile ? `Perfil ${profile.name}` : 'Entrar'}
            className={
              profile
                ? 'shrink-0 rounded-full p-0.5 mr-0.5 sm:mr-1 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white'
                : 'shrink-0 rounded-full bg-white/10 px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs font-semibold text-white hover:bg-white/20 cursor-pointer'
            }
          >
            {profile ? (
              <img
                src={profile.avatar || smileyUrl(profile.color)}
                alt=""
                style={{ boxShadow: `0 0 0 2px ${getProfileRingColor(profile.borderColor, isVip)}` }}
                className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg object-cover"
              />
            ) : (
              'Entrar'
            )}
          </button>
        </nav>
      </div>
    </header>
  );
};
