import React, { useState } from 'react';
import { Bell, Check, Info, Star, VolumeX, X, Zap } from 'lucide-react';

export interface UrgentItem {
  icon: 'check' | '4k' | 'ad' | 'bolt' | 'star' | 'bell' | 'info' | string;
  text: string;
}

export interface UrgentAnnouncement {
  id: string;
  active: boolean;
  title: string;
  imageUrl?: string;
  items: UrgentItem[];
  buttonText: string;
  updatedAt: string;
}

interface UrgentAnnouncementModalProps {
  announcement: UrgentAnnouncement;
  onClose: () => void;
}

export const UrgentAnnouncementModal: React.FC<UrgentAnnouncementModalProps> = ({
  announcement,
  onClose,
}) => {
  const [isFilling, setIsFilling] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const defaultBanner = '/urgent-banner.gif';

  const bannerSrc = announcement.imageUrl?.trim() || defaultBanner;

  const handleDismiss = () => {
    try {
      localStorage.setItem('kairou_dismissed_urgent_id', announcement.id);
    } catch {
      // ignore
    }
    setIsClosing(true);
    setTimeout(onClose, 220);
  };

  const handleGotIt = () => {
    if (isFilling || isClosing) return;
    setIsFilling(true);

    try {
      localStorage.setItem('kairou_dismissed_urgent_id', announcement.id);
    } catch {
      // ignore
    }

    // Left-to-right fill animation completes, then smoothly dismisses
    setTimeout(() => {
      setIsClosing(true);
      setTimeout(onClose, 220);
    }, 400);
  };

  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'check':
        return <Check className="w-4 h-4 text-white" strokeWidth={2.4} />;
      case '4k':
        return <span className="text-[11px] font-black tracking-tight text-white">4K</span>;
      case 'ad':
        return <VolumeX className="w-4 h-4 text-white" strokeWidth={2} />;
      case 'bolt':
        return <Zap className="w-4 h-4 text-amber-300 fill-amber-300" strokeWidth={2} />;
      case 'star':
        return <Star className="w-4 h-4 text-amber-300 fill-amber-300" strokeWidth={2} />;
      case 'bell':
        return <Bell className="w-4 h-4 text-sky-300" strokeWidth={2} />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-white" strokeWidth={2} />;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="urgent-title"
      className={`fixed inset-0 z-[1300] flex flex-col justify-end sm:items-center sm:justify-center p-0 sm:p-6 transition-opacity duration-200 ${
        isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Dark frosted backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-md cursor-default"
        onClick={handleDismiss}
        aria-hidden="true"
      />

      {/* Ambient Purple/Magenta backlight glow (matching screenshot) */}
      <div
        className="absolute w-[360px] sm:w-[480px] h-[360px] sm:h-[480px] rounded-full pointer-events-none max-sm:bottom-20"
        style={{
          background:
            'radial-gradient(circle, rgba(168, 85, 247, 0.42) 0%, rgba(139, 92, 246, 0.22) 45%, transparent 70%)',
          filter: 'blur(55px)',
        }}
        aria-hidden="true"
      />

      {/* Announcement Card (Bottom-sheet on mobile matching screenshot, centered card on PC) */}
      <div
        className={`relative w-full sm:max-w-[420px] rounded-t-[32px] sm:rounded-3xl rounded-b-none sm:rounded-b-3xl overflow-hidden bg-[#160f22]/98 sm:bg-[#161224]/95 border-t sm:border border-white/14 shadow-[0_-16px_50px_rgba(0,0,0,0.85)] sm:shadow-[0_24px_70px_rgba(0,0,0,0.85)] text-white backdrop-blur-2xl transition-all duration-300 ${
          isClosing
            ? 'max-sm:translate-y-full sm:scale-95 sm:translate-y-3'
            : 'translate-y-0 sm:scale-100'
        }`}
      >
        {/* Top Banner Artwork */}
        <div className="relative h-[210px] sm:h-[185px] w-full overflow-hidden bg-purple-950/40">
          <img
            src={bannerSrc}
            alt=""
            className="w-full h-full object-cover select-none"
            loading="eager"
            decoding="sync"
          />
          {/* Smooth bottom gradient overlay to blend into card body */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#160f22] via-[#160f22]/40 to-transparent pointer-events-none" />

          {/* Close (X) button top-right */}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Fechar anúncio"
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/60 hover:bg-black/85 text-white/80 hover:text-white flex items-center justify-center border border-white/15 transition-colors cursor-pointer z-10"
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 pb-6 pt-1 sm:pt-1 space-y-4 max-sm:pb-[max(2rem,env(safe-area-inset-bottom))]">
          <h3
            id="urgent-title"
            className="text-2xl sm:text-2xl font-bold tracking-tight text-white"
          >
            {announcement.title || 'Good news!'}
          </h3>

          {/* Bullet points list with rounded squircle icon badges */}
          <div className="space-y-3.5 pt-1">
            {(announcement.items || []).map((item, idx) => (
              <div key={idx} className="flex items-center gap-3.5 text-stone-200">
                <span className="w-8 h-8 rounded-xl bg-white/[0.08] border border-white/10 flex items-center justify-center shrink-0 shadow-inner">
                  {renderIcon(item.icon)}
                </span>
                <span className="text-[14px] sm:text-[14.5px] font-normal text-stone-200/95 leading-snug">
                  {item.text}
                </span>
              </div>
            ))}
          </div>

          {/* Bottom Button with Left-to-Right White Swipe Animation */}
          <div className="pt-3">
            <button
              type="button"
              onClick={handleGotIt}
              disabled={isFilling || isClosing}
              className="relative w-full h-12 rounded-2xl bg-white/[0.09] hover:bg-white/[0.14] border border-white/12 text-[15px] font-semibold overflow-hidden transition-colors cursor-pointer select-none"
            >
              {/* White fill bar expanding smoothly from left to right */}
              <span
                className="absolute inset-y-0 left-0 bg-white transition-[width] duration-350 ease-out pointer-events-none"
                style={{ width: isFilling ? '100%' : '0%' }}
                aria-hidden="true"
              />
              <span
                className={`relative z-10 transition-colors duration-200 font-semibold tracking-wide ${
                  isFilling ? 'text-black' : 'text-white'
                }`}
              >
                {announcement.buttonText || 'Entendido'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
