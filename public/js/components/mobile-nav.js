/* ========================================
   MOBILE NAVIGATION
   Responsive navigation for mobile devices
   TheRealShortShady v7.0
   ======================================== */

const MobileNav = {
    _isMobile: false,
    _activePanel: null,

    init() {
        this._checkMobile();
        window.addEventListener('resize', () => this._checkMobile());

        // Handle escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeAll();
        });

        // Handle swipe gestures
        this._initSwipeGestures();
    },

    _checkMobile() {
        const wasMobile = this._isMobile;
        this._isMobile = window.innerWidth <= 1024;

        const nav = document.getElementById('mobileNav');
        if (nav) {
            nav.style.display = this._isMobile ? 'flex' : 'none';
        }

        // Close panels when switching modes
        if (wasMobile && !this._isMobile) {
            this.closeAll();
        }
    },

    toggle(side) {
        const sidebar = side === 'left'
            ? document.querySelector('.sidebar-left')
            : document.querySelector('.sidebar-right');
        const overlay = document.getElementById('mobileOverlay');

        if (!sidebar) return;

        const isOpen = sidebar.classList.contains('open');

        // Close all first
        this.closeAll();

        if (!isOpen) {
            sidebar.classList.add('open');
            overlay?.classList.add('active');
            this._activePanel = side;

            // Update nav buttons
            this._updateNavButtons(side === 'left' ? 'markets' : 'positions');

            // Switch to appropriate tab in sidebar
            if (side === 'right') {
                const posTab = sidebar.querySelector('[data-tab="positions"]');
                posTab?.click();
            }
        }
    },

    showChart() {
        this.closeAll();
        this._updateNavButtons('chart');
    },

    closeAll() {
        document.querySelectorAll('.sidebar-left, .sidebar-right').forEach(el => {
            el.classList.remove('open');
        });
        document.getElementById('mobileOverlay')?.classList.remove('active');
        this._activePanel = null;
        this._updateNavButtons('chart');
    },

    _updateNavButtons(active) {
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.panel === active);
        });
    },

    _initSwipeGestures() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;

        const minSwipeDistance = 80;
        const maxVerticalDistance = 100;

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;

            const diffX = touchEndX - touchStartX;
            const diffY = Math.abs(touchEndY - touchStartY);

            // Only register horizontal swipes
            if (diffY > maxVerticalDistance) return;

            if (Math.abs(diffX) >= minSwipeDistance) {
                if (diffX > 0) {
                    // Swipe right
                    if (this._activePanel === 'right') {
                        this.closeAll();
                    } else if (!this._activePanel && this._isMobile) {
                        this.toggle('left');
                    }
                } else {
                    // Swipe left
                    if (this._activePanel === 'left') {
                        this.closeAll();
                    } else if (!this._activePanel && this._isMobile) {
                        this.toggle('right');
                    }
                }
            }
        }, { passive: true });
    },

    // Check if we're in mobile mode
    isMobile() {
        return this._isMobile;
    }
};

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MobileNav.init());
} else {
    MobileNav.init();
}
