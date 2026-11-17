/**
 * ads.js - Sistema de Anúncios ProfitOn Oficial do Kairou (Migrado do kai2)
 *
 * Regras Estritas:
 * 1. Anúncios rodam SOMENTE quando o usuário está assistindo (dentro do player ativo).
 * 2. Fora do player: o site permanece 100% limpo, sem banners, sem popups, sem popunders.
 * 3. Usuários VIP são 100% imunes (zero anúncios, zero popunders em todo o site).
 * 4. Error Shield integrado: suprime erros comuns e inofensivos de ad networks no console.
 */

(function () {
  'use strict';

  const PROFITON_CONFIG = {
    shuffleboxSrc: 'https://zk.xoanonpacking.com/sbl3cqVvEjZvSYM7/158176',
    shuffleboxZone: '158176',
    popsSrc: 'https://dq.purinsproved.com/rntVAiwady9dRymk/158174',
    popsZone: '158174',
    smartlinkUrl: 'https://vu.rabbinshoodlum.com/i7KIyHtsHii7u0B/158175'
  };

  const AD_CONSENT_KEY = 'kairou_ad_consent';

  function isVipActive() {
    try {
      // Se modo de teste de anúncios estiver ativo (via URL ?ads=1 ou localStorage), não bloqueia
      if (
        window.__kairou_force_ads === true ||
        localStorage.getItem('kairou_force_ads') === 'true' ||
        new URLSearchParams(window.location.search).get('ads') === '1'
      ) {
        return false;
      }
      if (typeof window.Kairou?.isVip === 'function') {
        return Boolean(window.Kairou.isVip());
      }
      const user = window.Kairou?.currentUser?.();
      if (!user) return false;
      if (user.is_vip || user.vip) return true;
      if (user.vip_until && new Date(user.vip_until) > new Date()) return true;
      return false;
    } catch {
      return false;
    }
  }

  function createSafeDummyWindow() {
    return {
      closed: true,
      focus: () => {},
      blur: () => {},
      close: () => {},
      postMessage: () => {},
      location: { href: 'about:blank', replace: () => {} }
    };
  }

  /**
   * Instala escudo contra erros inofensivos de ad networks externas
   */
  function installAdErrorShield() {
    if (typeof window.LP !== 'function') window.LP = function() {};
    if (typeof window.WR !== 'function') window.WR = function() {};
    if (window.__kairou_ad_error_shield) return;
    window.__kairou_ad_error_shield = true;

    window.addEventListener(
      'error',
      (event) => {
        try {
          const msg = String(event.message || '');
          const filename = String(event.filename || '');
          if (
            msg.includes('WR is not a function') ||
            msg.includes('LP is not a function') ||
            msg.includes('Node cannot be found') ||
            msg.includes('removeChild') ||
            filename.includes('purinsproved') ||
            filename.includes('xoanonpacking') ||
            filename.includes('rabbinshoodlum') ||
            filename.includes('158174') ||
            filename.includes('158176')
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        } catch {}
      },
      true
    );

    window.addEventListener('unhandledrejection', (event) => {
      try {
        const reason = String(event.reason?.message || event.reason || '');
        if (
          reason.includes('158174') ||
          reason.includes('158176') ||
          reason.includes('purinsproved') ||
          reason.includes('xoanonpacking') ||
          reason.includes('WR is not a function') ||
          reason.includes('LP is not a function') ||
          reason.includes('Node cannot be found')
        ) {
          event.preventDefault();
        }
      } catch {}
    });
  }

  /**
   * Protege contra popups invasivos FORA do player.
   * Permite links legítimos (PixGG, Telegram, etc.) e libera popunders quando o player estiver ATIVO.
   */
  function protectAgainstRoguePopups() {
    installAdErrorShield();
    if (window.__kairou_popup_shield) return;
    window.__kairou_popup_shield = true;

    const originalOpen = window.open;
    window.open = function (url, target, features) {
      try {
        const urlStr = String(url || '').toLowerCase();

        // Sempre permite links legítimos da plataforma e comunidade
        if (
          urlStr.includes('pixgg.com') ||
          urlStr.includes('t.me') ||
          urlStr.includes('telegram') ||
          (urlStr.startsWith(window.location.origin) && !urlStr.includes('ad'))
        ) {
          return originalOpen.apply(this, arguments);
        }

        // Se usuário for VIP (e não estiver testando anúncios): bloqueia popunder
        if (isVipActive()) {
          return createSafeDummyWindow();
        }

        // Se o player estiver ATIVO, permite popunder do ProfitOn
        if (window.__kairou_player_active) {
          return originalOpen.apply(this, arguments);
        }

        // Fora do player: bloqueia popunders indesejados
        return createSafeDummyWindow();
      } catch (e) {
        return createSafeDummyWindow();
      }
    };
  }

  /**
   * Remove completamente scripts e elementos de anúncios do DOM
   */
  function purgeAllAds() {
    try {
      const shb = document.getElementById('profiton-shufflebox-script');
      if (shb) shb.remove();

      const pops = document.getElementById('profiton-pops-script');
      if (pops) pops.remove();

      // Remove wrappers e iframes injetados pelas redes
      const rogueElements = document.querySelectorAll(
        '[data-shb], [id*="profiton"], [class*="shb-"], [id*="shb_"], iframe[src*="purinsproved"], iframe[src*="xoanonpacking"], iframe[src*="rabbinshoodlum"]'
      );
      rogueElements.forEach((el) => {
        try {
          el.remove();
        } catch {}
      });
    } catch {}
  }

  /**
   * Carrega anúncios DENTRO DO PLAYER (chamado ao abrir/iniciar o player)
   */
  function loadWatchingAds() {
    window.__kairou_player_active = true;

    // Usuários VIP têm imunidade total contra anúncios (exceto se forçando teste com ?ads=1)
    if (isVipActive()) {
      window.__kairou_ads_active = false;
      purgeAllAds();
      return;
    }

    window.__kairou_ads_active = true;

    try {
      localStorage.setItem(AD_CONSENT_KEY, 'with_ads');
    } catch {}

    // Injeta script Shufflebox se ainda não existir
    if (PROFITON_CONFIG.shuffleboxSrc && !document.getElementById('profiton-shufflebox-script')) {
      const s = document.createElement('script');
      s.id = 'profiton-shufflebox-script';
      s.setAttribute('data-cfasync', 'false');
      s.async = true;
      s.type = 'text/javascript';
      s.src = PROFITON_CONFIG.shuffleboxSrc;
      document.head.appendChild(s);
    }

    // Injeta script Pops se ainda não existir
    if (PROFITON_CONFIG.popsSrc && !document.getElementById('profiton-pops-script')) {
      const p = document.createElement('script');
      p.id = 'profiton-pops-script';
      p.setAttribute('data-cfasync', 'false');
      p.async = true;
      p.type = 'text/javascript';
      p.src = PROFITON_CONFIG.popsSrc;
      document.head.appendChild(p);
    }
  }

  /**
   * Desativa completamente anúncios (chamado ao fechar o player)
   */
  function disableAds() {
    window.__kairou_player_active = false;
    window.__kairou_ads_active = false;
    purgeAllAds();
    return true;
  }

  /**
   * Inicialização ao carregar a página
   */
  function initAdConsent() {
    window.__kairou_player_active = false;
    window.__kairou_ads_active = false;
    protectAgainstRoguePopups();
    purgeAllAds();
  }

  /**
   * Detector de AdBlocker (estilo kai2 / Zunderflix)
   */
  async function detectAdblocker() {
    if (typeof window === 'undefined') return false;
    if (isVipActive()) return false;

    let domBlocked = false;
    try {
      const bait = document.createElement('div');
      bait.className = 'pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links ad-banner adsbox adsbygoogle';
      bait.style.cssText = 'position: absolute !important; left: -9999px !important; top: -9999px !important; width: 1px !important; height: 1px !important;';
      document.body.appendChild(bait);

      const styles = window.getComputedStyle(bait);
      if (
        bait.offsetParent === null ||
        bait.offsetHeight === 0 ||
        bait.offsetLeft === 0 ||
        styles.display === 'none' ||
        styles.visibility === 'hidden'
      ) {
        domBlocked = true;
      }
      bait.remove();
    } catch (_) {}

    if (domBlocked) return true;

    try {
      const testUrl = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
      await fetch(testUrl, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
      return false;
    } catch (err) {
      return true;
    }
  }

  const DISMISS_KEY = 'kairou_adblock_dismissed_until';

  function openAdblockModal() {
    const modal = document.getElementById('adblock-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeAdblockModal() {
    const modal = document.getElementById('adblock-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function initAdblockModal() {
    const modal = document.getElementById('adblock-modal');
    if (!modal) return;

    // Fechar ao clicar no backdrop ou botão X
    modal.querySelectorAll('[data-close-adblock]').forEach((el) => {
      el.addEventListener('click', closeAdblockModal);
    });

    // 1. Botão VIP
    const btnVip = document.getElementById('adblock-btn-vip');
    if (btnVip) {
      btnVip.addEventListener('click', () => {
        closeAdblockModal();
        if (typeof window.Kairou?.openVip === 'function') {
          window.Kairou.openVip();
        } else {
          const vipModal = document.getElementById('vip');
          if (vipModal) vipModal.hidden = false;
        }
      });
    }

    // 2. Botão Já Desativei (Recheck)
    const btnRecheck = document.getElementById('adblock-btn-recheck');
    const recheckIcon = document.getElementById('adblock-recheck-icon');
    const recheckText = document.getElementById('adblock-recheck-text');
    const feedback = document.getElementById('adblock-feedback');

    let checking = false;
    if (btnRecheck) {
      btnRecheck.addEventListener('click', async () => {
        if (checking) return;
        checking = true;
        btnRecheck.disabled = true;
        if (recheckIcon) {
          recheckIcon.style.display = 'inline-block';
          recheckIcon.classList.add('fa-spin');
        }
        if (recheckText) recheckText.textContent = 'Verificando...';
        if (feedback) feedback.hidden = true;

        try {
          const isBlocked = await detectAdblocker();
          if (!isBlocked) {
            if (feedback) {
              feedback.className = 'adblock-modal__feedback adblock-modal__feedback--success';
              feedback.textContent = 'Obrigado por desativar! Aproveite o Kairou ❤️';
              feedback.hidden = false;
            }
            setTimeout(() => {
              closeAdblockModal();
            }, 1200);
          } else {
            if (feedback) {
              feedback.className = 'adblock-modal__feedback adblock-modal__feedback--warning';
              feedback.textContent = 'O bloqueador ainda parece ativo. Recarregue a página ou desative para kairou.space.';
              feedback.hidden = false;
            }
          }
        } catch (_) {
          closeAdblockModal();
        } finally {
          checking = false;
          btnRecheck.disabled = false;
          if (recheckIcon) {
            recheckIcon.style.display = 'none';
            recheckIcon.classList.remove('fa-spin');
          }
          if (recheckText) recheckText.textContent = 'Já desativei';
        }
      });
    }

    // 3. Botão Continuar mesmo assim (Cooldown de 1 hora)
    const btnContinue = document.getElementById('adblock-btn-continue');
    if (btnContinue) {
      btnContinue.addEventListener('click', () => {
        try {
          sessionStorage.setItem(DISMISS_KEY, String(Date.now() + 60 * 60 * 1000));
        } catch (_) {}
        closeAdblockModal();
      });
    }

    // Gatilho de detecção após 3.5 segundos de carregamento da página
    setTimeout(async () => {
      try {
        if (isVipActive()) return;
        const dismissed = sessionStorage.getItem(DISMISS_KEY);
        if (dismissed && Number(dismissed) > Date.now()) return;
        const isBlocked = await detectAdblocker();
        if (isBlocked) {
          openAdblockModal();
        }
      } catch (_) {}
    }, 3500);
  }

  function openProfitOnSmartlink() {
    if (PROFITON_CONFIG.smartlinkUrl) {
      window.open(PROFITON_CONFIG.smartlinkUrl, '_blank');
    }
  }

  // Executa proteção e inicia listener do modal
  initAdConsent();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdblockModal);
  } else {
    initAdblockModal();
  }

  // Exporta API globalmente
  window.KairouAds = {
    PROFITON_CONFIG,
    initAdConsent,
    loadWatchingAds,
    disableAds,
    purgeAllAds,
    openProfitOnSmartlink,
    isVipActive,
    detectAdblocker,
    openAdblockModal,
    closeAdblockModal
  };
  window.KairouAdblock = {
    detect: detectAdblocker,
    open: openAdblockModal,
    close: closeAdblockModal
  };
})();
