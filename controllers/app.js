/* ==========================================================================
   BiddingFlow - Lightweight bootstrap entry point
   ========================================================================== */

window.__BF_APP_DEBUG__ = document.querySelector('meta[name="bf-app-debug"]')?.content === 'true';
if (!window.lucide || typeof window.lucide.createIcons !== 'function') {
    window.lucide = { __bfLucideShim: true, createIcons: () => { } };
}

const checkInitialSession = async () => {
    try {
        const response = await fetch('/api/auth/check-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ remember: localStorage.getItem('bf_remember_me') === 'true' })
        });
        if (response.ok) return await response.json();
    } catch (err) {
        console.warn('Initial session check failed:', err);
    }
    return { valid: false };
};

const isLucideReady = () => (
    typeof window.lucide?.createIcons === 'function' &&
    window.lucide.__bfLucideShim !== true
);

const loadLucideIcons = () => new Promise((resolve, reject) => {
    if (isLucideReady()) {
        resolve();
        return;
    }

    const existing = document.querySelector('script[data-bf-lucide]');
    if (existing) {
        if (existing.dataset.bfLoaded === 'true') {
            reject(new Error('Lucide script loaded without exposing createIcons'));
            return;
        }
        existing.addEventListener('load', () => {
            if (isLucideReady()) resolve();
            else reject(new Error('Lucide script loaded without exposing createIcons'));
        }, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
    }

    const script = document.createElement('script');
    script.src = '/vendor/lucide/lucide.min.js?v=1.21.0.1';
    script.async = true;
    script.dataset.bfLucide = 'true';
    const handleRuntimeError = (event) => {
        if (!String(event.filename || '').includes('/vendor/lucide/lucide.min.js')) return;
        window.removeEventListener('error', handleRuntimeError);
        reject(new Error(`Lucide runtime error: ${event.message || 'unknown error'} (${event.lineno || 0}:${event.colno || 0})`));
    };
    window.addEventListener('error', handleRuntimeError);
    script.addEventListener('load', () => {
        window.removeEventListener('error', handleRuntimeError);
        script.dataset.bfLoaded = 'true';
        if (isLucideReady()) resolve();
        else reject(new Error('Lucide script loaded without exposing createIcons'));
    }, { once: true });
    script.addEventListener('error', () => {
        window.removeEventListener('error', handleRuntimeError);
        reject(new Error(`Lucide script request failed: ${script.src}`));
    }, { once: true });
    document.head.appendChild(script);
});

window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator && window.__BF_APP_DEBUG__ === false) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => { });
    }

    const lucideReady = loadLucideIcons()
        .then(() => {
            window.lucide.createIcons();
            return true;
        })
        .catch(err => {
            console.warn('Lucide icons could not be loaded:', err);
            return false;
        });

    const initialSession = await checkInitialSession();
    if (initialSession?.valid) {
        const { bootstrapWorkspace } = await import('/controllers/workspaceBootstrap.js');
        await bootstrapWorkspace(initialSession);
    } else {
        const { bootstrapAuthShell } = await import('/controllers/auth/AuthShell.js');
        await bootstrapAuthShell(initialSession);
    }

    requestAnimationFrame(() => {
        lucideReady.then(loaded => {
            if (loaded) window.lucide.createIcons();
        });
    });
});
