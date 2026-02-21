/* ========================================
   APP - Main Application Entry Point
   Trading Platform PRO v4.2
   ======================================== */


const App = {

    _initialized: false,

    async init() {
        if (this._initialized) return;

        console.log(` ${CONFIG.APP_NAME} v${CONFIG.VERSION} starting...`);

        try {
            this._showLoading(true);

            const components = [
                { name: 'EventFeed', module: typeof EventFeed !== 'undefined' ? EventFeed : null },
                { name: 'RiskManager', module: typeof RiskManager !== 'undefined' ? RiskManager : null },
                { name: 'LearningEngine', module: typeof LearningEngine !== 'undefined' ? LearningEngine : null },
                { name: 'Header', module: Header },
                { name: 'Watchlist', module: Watchlist },
                { name: 'Positions', module: Positions },
                { name: 'SymbolInfo', module: SymbolInfo },
                { name: 'Chart', module: Chart },
                { name: 'Analysis', module: Analysis },
                { name: 'TradeLog', module: typeof TradeLog !== 'undefined' ? TradeLog : null },
                { name: 'Lab', module: typeof Lab !== 'undefined' ? Lab : null },
                { name: 'Dashboard', module: typeof Dashboard !== 'undefined' ? Dashboard : null },
            ];

            for (const { name, module } of components) {
                try {
                    if (module && typeof module.init === 'function') {
                        module.init();
                    }
                } catch (e) {
                    console.error(`❌ Error inicializando ${name}:`, e);
                }
            }

            DataService.start();

            // UI Enhancements v4.2
            if (typeof MarketPulse !== 'undefined') MarketPulse.init();
            if (typeof IndicatorsPro !== 'undefined') IndicatorsPro.init();
            if (typeof QuickStats !== 'undefined') QuickStats.init();

            // UI Reorganization v6.0 - New components
            if (typeof LiquidityHeatmap !== 'undefined') LiquidityHeatmap.init();
            if (typeof LearningStats !== 'undefined') LearningStats.init();
            if (typeof QuickPerformance !== 'undefined') QuickPerformance.init();
            if (typeof Scanner !== 'undefined') Scanner.init();
            if (typeof EventFeed !== 'undefined' && EventFeed.startInlineUpdates) {
                EventFeed.startInlineUpdates();
            }

            // Render mode pills
            this._renderModePills();

            // Initialize Intelligence system
            if (typeof Intelligence !== 'undefined') {
                setTimeout(async () => {
                    try {
                        await Intelligence.updateMarketScore();
                        Intelligence.updateCorrelations();
                        console.log('🧠 Intelligence initialized');
                        setInterval(async () => {
                            await Intelligence.updateMarketScore();
                            Intelligence.updateCorrelations();
                        }, 60000);
                    } catch (e) {
                        console.error('Intelligence init error:', e);
                    }
                }, 10000);
            }

            // Pre-fetch sentiment data for MasterBots
            if (typeof MasterBots !== 'undefined') {
                // FIX: Inicializar MasterBots para restaurar reports persistidos
                if (typeof MasterBots.init === 'function') {
                    MasterBots.init();
                }
                setTimeout(async () => {
                    try {
                        await MasterBots._fetchSentiment();
                        console.log('🌍 MasterBots sentiment data ready');
                    } catch (e) {
                        console.error('MasterBots init error:', e);
                    }
                }, 12000);
            }

            // Autonomy system — starts after radar has data
            if (typeof Autonomy !== 'undefined') {
                setTimeout(() => {
                    try {
                        Autonomy.init();
                    } catch (e) {
                        console.error('Autonomy init error:', e);
                    }
                }, 20000);
            }

            this._bindGlobalEvents();
            this._bindKeyboardShortcuts();
            this._bindLeftTabs();
            this._bindConnectionMonitor();

            State.subscribe('symbol', () => DataService.restart());
            State.subscribe('timeframe', () => DataService.restart());

            this._initialized = true;

            // Render new panels (v4.3 fixes)
            if (typeof Trading !== 'undefined' && Trading.renderPositionConfig) {
                Trading.renderPositionConfig();
                // Re-render on price/balance changes
                State.subscribe('prices', () => Trading.renderPositionConfig());
                State.subscribe('balance', () => Trading.renderPositionConfig());
            }
            // Risk Manager is now in Settings modal
            this._showLoading(false);

            console.log('✅ Application initialized successfully');
            Utils.showNotification(`TheRealShortShady v${CONFIG.VERSION} listo`, 'success', 3000);

        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            this._showLoading(false);
            Utils.showNotification('Error al iniciar la aplicación', 'error');
        }
    },

    _bindGlobalEvents() {
        const btnAnalyze = document.getElementById('btnAnalyze');
        if (btnAnalyze) {
            btnAnalyze.addEventListener('click', () => Trading.analyze());
        }

        const btnLong = document.getElementById('btnLong');
        if (btnLong) {
            btnLong.addEventListener('click', () => Trading.openPosition('LONG'));
        }

        const btnShort = document.getElementById('btnShort');
        if (btnShort) {
            btnShort.addEventListener('click', () => Trading.openPosition('SHORT'));
        }

        const btnWatcher = document.getElementById('btnWatcher');
        if (btnWatcher) {
            btnWatcher.addEventListener('click', () => Trading.toggleWatcher());
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                DataService.stop();
            } else {
                DataService.start();
            }
        });

        window.addEventListener('beforeunload', () => {
            State.saveImmediate();
        });

        window.addEventListener('unhandledrejection', (e) => {
            console.error('Unhandled promise rejection:', e.reason);
        });
    },

    _bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const mod = e.ctrlKey || e.metaKey;

            if (mod && e.key === 'Enter') {
                e.preventDefault();
                Trading.analyze();
            }

            if (!mod && e.key >= '1' && e.key <= '4') {
                const modes = Object.keys(CONFIG.MODES);
                const mode = modes[parseInt(e.key) - 1];
                if (mode) {
                    State.set('mode', mode);
                    const modeConfig = CONFIG.MODES[mode];
                    State.set('timeframe', modeConfig.tf);
                    Utils.showNotification(`Modo: ${modeConfig.name}`, 'info', 2000);
                    if (typeof Header !== 'undefined' && Header.updateMode) {
                        Header.updateMode();
                    }
                }
            }

            if (!mod && e.key === 'r') {
                State.set('analysis', null);
                if (typeof Analysis !== 'undefined' && Analysis.clear) {
                    Analysis.clear();
                }
            }

            if (e.key === 'Escape') {
                if (typeof SettingsModal !== 'undefined') SettingsModal.close();
                if (typeof Dashboard !== 'undefined') Dashboard.close();
            }

            // W = Toggle watcher
            if (!mod && e.key === 'w') {
                Trading.toggleWatcher();
            }

            // D = Dashboard cockpit
            if (!mod && e.key === 'd') {
                if (typeof Dashboard !== 'undefined') Dashboard.toggle();
            }
        });
    },

    _bindConnectionMonitor() {
        window.addEventListener('online', () => {
            Utils.showNotification(' Conexión restaurada', 'success', 3000);
            DataService.start();
        });

        window.addEventListener('offline', () => {
            Utils.showNotification(' Sin conexión a internet', 'error');
            DataService.stop();
            State.set('isConnected', false);
        });
    },

    _bindLeftTabs() {
        document.querySelectorAll('.left-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                // FIX: Actualizar clases y ARIA attributes para accesibilidad
                document.querySelectorAll('.left-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                document.querySelectorAll('.left-tab-content').forEach(c => c.classList.remove('active'));
                const content = document.getElementById(`tab-${target}`);
                if (content) content.classList.add('active');
                // Render specific content based on tab
                if (target === 'tradelog' && typeof TradeLog !== 'undefined') TradeLog.render();
                if (target === 'activity') {
                    if (typeof TradeLog !== 'undefined') TradeLog.render();
                    if (typeof EventFeed !== 'undefined') EventFeed.renderInline();
                }
            });
        });

        State.subscribe('positions', (positions) => {
            if (positions.length > 0) {
                const posTab = document.querySelector('.left-tab[data-tab="positions"]');
                if (posTab && !posTab.classList.contains('active')) {
                    posTab.click();
                }
            }
        });
    },

    _renderModePills() {
        const container = document.querySelector('.mode-pills');
        if (!container) return;

        const modes = CONFIG.MODES || {
            scalp: { name: 'Scalp', tf: '1m' },
            intra: { name: 'Intra', tf: '15m' },
            swing: { name: 'Swing', tf: '4h' },
            position: { name: 'Position', tf: '1d' }
        };

        const currentMode = State.mode || 'intra';

        container.innerHTML = Object.entries(modes).map(([key, mode]) => `
            <button class="mode-pill ${key === currentMode ? 'active' : ''}"
                    data-mode="${key}"
                    title="${mode.name} (${mode.tf})">
                ${mode.name}
            </button>
        `).join('');

        container.querySelectorAll('.mode-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const mode = pill.dataset.mode;
                State.set('mode', mode);
                const modeConfig = modes[mode];
                if (modeConfig) {
                    State.set('timeframe', modeConfig.tf);
                }
                container.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                Utils.showNotification(`Modo: ${modeConfig.name}`, 'info', 2000);
            });
        });
    },

    _showLoading(show) {
        let overlay = document.getElementById('app-loading');
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'app-loading';
                overlay.style.cssText = `
                    position: fixed; inset: 0; z-index: 10000;
                    background: ${CONFIG.COLORS.bg};
                    display: flex; align-items: center; justify-content: center;
                    flex-direction: column; gap: 16px;
                    transition: opacity 0.4s ease;
                `;
                overlay.innerHTML = `
                    <div style="font-size: 24px; font-weight: 700; color: #00d4ff; letter-spacing: -0.02em; font-family: 'DM Sans', sans-serif;">
                        ⚡ TheRealShortShady
                    </div>
                    <div style="color: #666; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'DM Sans', sans-serif;">
                        Cargando v${CONFIG.VERSION}
                    </div>
                    <div style="width: 100px; height: 2px; background: #111119; border-radius: 3px; overflow: hidden;">
                        <div style="width: 40%; height: 100%; background: linear-gradient(90deg, #00d4ff, #e8c06a); border-radius: 3px;
                            animation: loadPulse 1.2s ease-in-out infinite alternate;"></div>
                    </div>
                    <style>
                        @keyframes loadPulse { from { width: 20%; margin-left: 0; } to { width: 60%; margin-left: 40%; } }
                    </style>
                `;
                document.body.appendChild(overlay);
            }
        } else if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 400);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
