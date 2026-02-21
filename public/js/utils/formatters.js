/* ========================================
   UTILS - Utility Functions
   Trading Platform PRO v2.0
   ======================================== */

const Utils = {

    // ==========================================
    //  FORMATTING
    // ==========================================

    /** Format number with commas */
    formatNumber(num, decimals = 2) {
        if (num === null || num === undefined || isNaN(num)) return '--';
        return num.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    /** Format price based on magnitude */
    formatPrice(price) {
        if (!price || isNaN(price)) return '--';
        if (price >= 10000) return this.formatNumber(price, 2);
        if (price >= 1000) return this.formatNumber(price, 2);
        if (price >= 1) return this.formatNumber(price, 4);
        if (price >= 0.01) return this.formatNumber(price, 5);
        return this.formatNumber(price, 6);
    },

    /** Format currency */
    formatCurrency(amount) {
        if (amount === null || amount === undefined || isNaN(amount)) return '--';
        return '$' + this.formatNumber(amount, 2);
    },

    /** Format percentage */
    formatPercent(value, showSign = true) {
        if (value === null || value === undefined || isNaN(value)) return '--';
        const sign = showSign && value > 0 ? '+' : '';
        return `${sign}${this.formatNumber(value, 2)}%`;
    },

    /** Format PnL with color class hint */
    formatPnL(pnl) {
        if (isNaN(pnl)) return '--';
        const sign = pnl >= 0 ? '+' : '';
        return `${sign}$${this.formatNumber(pnl, 2)}`;
    },

    /** Format volume (K, M, B) */
    formatVolume(vol) {
        if (!vol || isNaN(vol)) return '--';
        if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
        if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
        if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
        return vol.toFixed(0);
    },

    /** Format leverage */
    formatLeverage(lev) {
        if (!lev) return '--';
        return `${lev}x`;
    },

    /** Format time ago */
    formatTimeAgo(timestamp) {
        const diff = Date.now() - new Date(timestamp).getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        if (seconds > 5) return `${seconds}s ago`;
        return 'ahora';
    },

    /** Format duration from ms */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    },

    /** Format datetime for AR locale */
    formatDateTime(date) {
        return new Date(date).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /** Format datetime full */
    formatDateTimeFull(date) {
        return new Date(date).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },

    // ==========================================
    //  NOTIFICATION SYSTEM (Toast)
    // ==========================================

    /** Container de toasts (se crea una sola vez) */
    _toastContainer: null,

    /** Inicializar el container de toasts */
    _initToastContainer() {
        if (this._toastContainer) return;
        this._toastContainer = document.createElement('div');
        this._toastContainer.id = 'toast-container';
        this._toastContainer.style.cssText = `
            position: fixed;
            top: 70px;
            right: 16px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
            max-width: 420px;
        `;
        document.body.appendChild(this._toastContainer);
    },

    /** Show toast notification */
    _notifQueue: [],
    _notifActive: 0,
    _MAX_VISIBLE: 3,
    _notifThrottleMs: 300,  // Min time between showing notifications
    _lastNotifTime: 0,

    showNotification(message, type = 'info', duration = 5000) {
        // Deduplicate: skip if same message is already queued or visible
        if (this._notifQueue.some(n => n.message === message)) return;

        this._notifQueue.push({ message, type, duration });
        this._processNotifQueue();
    },

    _processNotifQueue() {
        if (this._notifQueue.length === 0) return;
        if (this._notifActive >= this._MAX_VISIBLE) return;

        // Throttle: don't show faster than 300ms apart
        const now = Date.now();
        if (now - this._lastNotifTime < this._notifThrottleMs) {
            setTimeout(() => this._processNotifQueue(), this._notifThrottleMs);
            return;
        }

        const notif = this._notifQueue.shift();
        this._lastNotifTime = now;
        this._notifActive++;
        this._showToast(notif.message, notif.type, notif.duration);
    },

    _showToast(message, type, duration) {
        this._initToastContainer();

        const toast = document.createElement('div');
        toast.style.cssText = `
            padding: 12px 18px;
            border-radius: 10px;
            font-size: 13px;
            line-height: 1.5;
            color: #e8e6e3;
            pointer-events: auto;
            cursor: pointer;
            opacity: 0;
            transform: translateX(100px);
            transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1);
            border-left: 3px solid;
            backdrop-filter: blur(16px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'DM Sans', sans-serif;
            word-break: break-word;
            position: relative;
        `;

        // Colores por tipo
        const styles = {
            success: { bg: 'rgba(16, 185, 129, 0.10)', border: '#10b981', icon: '✓' },
            error:   { bg: 'rgba(244, 63, 94, 0.10)',  border: '#f43f5e', icon: '✕' },
            warning: { bg: 'rgba(240, 198, 72, 0.10)',  border: '#f0c648', icon: '!' },
            info:    { bg: 'rgba(0, 212, 255, 0.10)',  border: '#00d4ff', icon: '◈' },
        };
        const s = styles[type] || styles.info;
        toast.style.background = s.bg;
        toast.style.borderLeftColor = s.border;

        // Progress bar
        const progressBar = document.createElement('div');
        progressBar.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            height: 2px;
            background: ${s.border};
            border-radius: 0 0 0 10px;
            transition: width linear;
            width: 100%;
        `;

        toast.innerHTML = `<span>${message}</span>`;
        toast.appendChild(progressBar);

        // Click para cerrar
        toast.addEventListener('click', () => this._removeToast(toast));

        this._toastContainer.appendChild(toast);

        // Animar entrada
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
            // Iniciar countdown visual
            progressBar.style.width = '0%';
            progressBar.style.transitionDuration = `${duration}ms`;
        });

        // Auto-remove
        const timer = setTimeout(() => this._removeToast(toast), duration);

        // Pausar timer on hover
        toast.addEventListener('mouseenter', () => {
            clearTimeout(timer);
            progressBar.style.transitionPlayState = 'paused';
        });
        toast.addEventListener('mouseleave', () => {
            const remaining = 2000;
            progressBar.style.transitionDuration = `${remaining}ms`;
            progressBar.style.transitionPlayState = 'running';
            setTimeout(() => this._removeToast(toast), remaining);
        });

        // Sonido sutil para trades (max 1 beep per second to avoid audio overload)
        if ((type === 'success' || type === 'error') && Date.now() - (this._lastBeepTime || 0) > 1000) {
            this._playBeep(type === 'success' ? 800 : 400, 80);
            this._lastBeepTime = Date.now();
        }
    },

    /** Remover toast con animación */
    _removeToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.marginTop = `-${toast.offsetHeight + 8}px`;
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            this._notifActive = Math.max(0, this._notifActive - 1);
            // Show next queued notification
            this._processNotifQueue();
        }, 350);
    },

    /** Beep sutil usando Web Audio API */
    _playBeep(frequency = 800, duration = 80) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';
            gain.gain.value = 0.08;
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration / 1000);
        } catch (e) {
            // Audio no disponible, silenciar
        }
    },

    // ==========================================
    //  UTILITIES
    // ==========================================

    /** Generate unique ID */
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },

    /** Debounce function */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    },

    /** Throttle function */
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /** Clamp value between min and max */
    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    },

    /** Calculate percentage change */
    percentChange(oldValue, newValue) {
        if (oldValue === 0) return 0;
        return ((newValue - oldValue) / oldValue) * 100;
    },

    /** Linear interpolation */
    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    /** Map value from one range to another */
    mapRange(value, inMin, inMax, outMin, outMax) {
        return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
    },

    /** Get CSS variable value */
    getCSSVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },

    /** Set CSS variable */
    setCSSVar(name, value) {
        document.documentElement.style.setProperty(name, value);
    },

    /** Copy to clipboard */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showNotification('◈ Copiado al portapapeles', 'success', 2000);
            return true;
        } catch (e) {
            console.error('Copy failed:', e);
            return false;
        }
    },

    /** Safe JSON parse */
    safeJsonParse(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    },

    /** Check if market is likely open (crypto = 24/7, but useful for volume patterns) */
    isHighVolumeHour() {
        const hour = new Date().getUTCHours();
        // Horarios de mayor volumen crypto (UTC): Asia open, Europe open, US open
        return (hour >= 0 && hour <= 3) || (hour >= 7 && hour <= 9) || (hour >= 13 && hour <= 16);
    }
};
