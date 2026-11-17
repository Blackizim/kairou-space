import devtoolsDetector, { addListener, launch, setDetectDelay } from 'devtools-detector';

const PUNISHMENT_URL = 'https://www.youtube.com/watch?v=nco1u4DBnjE&pp=0gcJCVgCo7VqN5tD';

let isPunishing = false;

/**
 * Checks whether the current user is authorized to use Developer Tools.
 * Only the account with email matching 'shizuu122@gmail' is permitted.
 */
export function isAuthorizedDevUser(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    // 1. Check runtime memory on window
    const win = window as unknown as { __KAIROU_CURRENT_EMAIL__?: string };
    if (win.__KAIROU_CURRENT_EMAIL__) {
      const email = String(win.__KAIROU_CURRENT_EMAIL__).trim().toLowerCase();
      if (email.includes('shizuu122@gmail')) return true;
    }

    // 2. Check active session stored in localStorage
    const sessionRaw = localStorage.getItem('kairou_session_v1');
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw) as { email?: string };
      const email = String(session?.email || '').trim().toLowerCase();
      if (email.includes('shizuu122@gmail')) return true;
    }

    // 3. Check all accounts stored in localStorage
    const accountsRaw = localStorage.getItem('kairou_accounts_v1');
    if (accountsRaw) {
      const accounts = JSON.parse(accountsRaw) as Array<{ email?: string }>;
      if (Array.isArray(accounts)) {
        for (const a of accounts) {
          const email = String(a?.email || '').trim().toLowerCase();
          if (email.includes('shizuu122@gmail')) return true;
        }
      }
    }

    // 4. Check PocketBase auth stored in localStorage
    const pbAuth = localStorage.getItem('pocketbase_auth');
    if (pbAuth) {
      const pb = JSON.parse(pbAuth) as {
        record?: { email?: string };
        model?: { email?: string };
      };
      const email = String(pb?.record?.email || pb?.model?.email || '').trim().toLowerCase();
      if (email.includes('shizuu122@gmail')) return true;
    }
  } catch {
    // Safe fallback if localStorage is restricted
  }

  return false;
}

/**
 * Closes / blanks the application and redirects the user immediately to the Galaxy Brain meme video.
 */
export function triggerDevToolsPunishment() {
  if (isPunishing) return;
  if (isAuthorizedDevUser()) return;

  isPunishing = true;

  try {
    // Pause any playing media immediately
    document.querySelectorAll('video, audio').forEach((el) => {
      try {
        (el as HTMLMediaElement).pause();
      } catch {}
    });

    // Replace entire document so no source, DOM tree or assets remain accessible
    if (document.documentElement) {
      document.documentElement.innerHTML = `
        <head>
          <title>Galaxy Brain</title>
          <meta http-equiv="refresh" content="0; url=${PUNISHMENT_URL}">
        </head>
        <body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
          <p style="font-size:16px;color:#888;">Carregando...</p>
        </body>
      `;
    }
  } catch {}

  // Attempt window.close() (works if opened via script/popout)
  try {
    window.close();
  } catch {}

  // Hard navigate / replace current URL to YouTube Galaxy Brain loop
  try {
    window.location.replace(PUNISHMENT_URL);
  } catch {
    window.location.href = PUNISHMENT_URL;
  }
}

/**
 * Initializes multi-layered DevTools protection:
 * 1. Keyboard shortcuts interception (F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Cmd+Option+I/J/C/K, Cmd+Option+U)
 * 2. devtools-detector package (Console toString / regex / getter heuristics)
 * 3. Timing-based debugger execution checks
 */
export function initDevToolsShield() {
  if (typeof window === 'undefined') return;

  // If already authorized at initialization, do nothing
  if (isAuthorizedDevUser()) return;

  // 1. Hotkey detection
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (isAuthorizedDevUser()) return;

      const key = e.key;
      const keyCode = e.keyCode || e.which;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const isAlt = e.altKey;

      // F12
      if (key === 'F12' || keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        triggerDevToolsPunishment();
        return;
      }

      // Ctrl+Shift+I / Cmd+Option+I (Inspect)
      // Ctrl+Shift+J / Cmd+Option+J (Console)
      // Ctrl+Shift+C / Cmd+Option+C (Inspect Element)
      // Ctrl+Shift+K / Cmd+Option+K (Firefox Web Console)
      if (
        (isCtrlOrCmd && isShift && /^[ijck]$/i.test(key)) ||
        (e.metaKey && isAlt && /^[ijck]$/i.test(key))
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        triggerDevToolsPunishment();
        return;
      }

      // Ctrl+U / Cmd+Option+U (View Source)
      if (
        (isCtrlOrCmd && /^[u]$/i.test(key)) ||
        (e.metaKey && isAlt && /^[u]$/i.test(key))
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        triggerDevToolsPunishment();
        return;
      }
    },
    { capture: true }
  );

  // 2. devtools-detector heuristics
  try {
    setDetectDelay(350);
    addListener((isOpen) => {
      if (isOpen && !isAuthorizedDevUser()) {
        triggerDevToolsPunishment();
      }
    });
    launch();
  } catch (err) {
    console.warn('[shield] devtools-detector init:', err);
  }

  // 3. Periodic debugger execution check
  const debugInterval = setInterval(() => {
    if (isAuthorizedDevUser()) {
      clearInterval(debugInterval);
      return;
    }
    const t0 = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    const t1 = performance.now();
    if (t1 - t0 > 100) {
      triggerDevToolsPunishment();
    }
  }, 1000);
}
