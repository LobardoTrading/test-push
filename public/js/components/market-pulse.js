/* ========================================
   MARKET PULSE — Contextual Market Strip
   Always-visible bar that adapts to user situation
   TheRealShortShady v4.2
   ======================================== */

const MarketPulse = {

    _container: null,
    _refreshInterval: null,
    _lastFG: null,
    _lastGlobal: null,

    init() {
        this._createStrip();
        this._startRefresh();
        State.subscribe('positions', () => this._updateContext());
        State.subscribe('prices', () => this._updatePriceAction());
    },

    _createStrip() {
        const leftPanel = document.querySelector('.left-panel');
        if (!leftPanel) return;

        // Check if already exists
        if (document.getElementById('marketPulse')) return;

        const strip = document.createElement('div');
        strip.id = 'marketPulse';
        strip.className = 'market-pulse';
        strip.innerHTML = `
            <div class="pulse-row">
                <div class="pulse-section pulse-session" id="pulseSession">
                    <span class="pulse-dot"></span>
                    <span class="pulse-session-text">—</span>
                </div>
                <div class="pulse-section pulse-clock" id="pulseClock">
                    <span class="pulse-clock-text" id="pulseClockText">--:--</span>
                    <span class="pulse-clock-tz">BsAs</span>
                </div>
            </div>
            <div class="pulse-row">
                <div class="pulse-section pulse-fg" id="pulseFG" title="Fear & Greed Index">
                    <span class="pulse-fg-icon">🌡</span>
                    <span class="pulse-fg-value" id="pulseFGValue">—</span>
                    <span class="pulse-fg-label" id="pulseFGLabel"></span>
                </div>
                <div class="pulse-section pulse-btc" id="pulseBTC" title="BTC Dominance">
                    <span class="pulse-label">BTC</span>
                    <span class="pulse-btc-dom" id="pulseBTCDom">—</span>
                </div>
                <div class="pulse-section pulse-mcap" id="pulseMcap" title="Market Cap 24h">
                    <span class="pulse-label">MktCap</span>
                    <span class="pulse-mcap-val" id="pulseMcapVal">—</span>
                </div>
            </div>
            <div class="pulse-context-row" id="pulseContext">
                <span class="pulse-context-text" id="pulseContextText">Cargando...</span>
            </div>
        `;

        leftPanel.insertBefore(strip, leftPanel.firstChild);
        this._container = strip;
        this._updateClock();
        setInterval(() => this._updateClock(), 10000);
    },

    async _startRefresh() {
        // Initial load
        await this._fetchMarketData();
        this._updateContext();

        // Refresh every 2 minutes
        this._refreshInterval = setInterval(() => this._fetchMarketData(), 120000);
    },

    async _fetchMarketData() {
        try {
            // Use MasterBots cache if available
            if (typeof MasterBots !== 'undefined' && MasterBots._sentimentCache) {
                this._applyData(MasterBots._sentimentCache);
                return;
            }

            const resp = await fetch('/api/sentiment');
            if (resp.ok) {
                const data = await resp.json();
                this._applyData(data);
            }
        } catch (e) {
            // Silent fail — strip just shows "—"
        }
    },

    _applyData(data) {
        if (!data) return;

        // Fear & Greed
        if (data.fearGreed) {
            this._lastFG = data.fearGreed;
            const fg = data.fearGreed;
            const val = fg.value;
            const color = val <= 25 ? '#f43f5e' : val <= 45 ? '#f97316' : val <= 55 ? '#eab308' : val <= 75 ? '#84cc16' : '#10b981';

            const fgVal = document.getElementById('pulseFGValue');
            const fgLabel = document.getElementById('pulseFGLabel');
            if (fgVal) { fgVal.textContent = val; fgVal.style.color = color; }
            if (fgLabel) { fgLabel.textContent = fg.label; fgLabel.style.color = color; }
        }

        // Global data
        if (data.global) {
            this._lastGlobal = data.global;
            const g = data.global;

            const btcDom = document.getElementById('pulseBTCDom');
            if (btcDom) btcDom.textContent = `${(g.btcDominance || 0).toFixed(1)}%`;

            const mcap = document.getElementById('pulseMcapVal');
            if (mcap) {
                const change = g.marketCapChange24h || 0;
                const color = change >= 0 ? '#10b981' : '#f43f5e';
                mcap.innerHTML = `<span style="color:${color}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%</span>`;
            }
        }
    },

    _updateContext() {
        const el = document.getElementById('pulseContextText');
        if (!el) return;

        const positions = State.positions || [];
        const fg = this._lastFG;

        // Priority context messages
        if (positions.length > 0) {
            // Show open PnL summary
            const totalPnl = State.getOpenPnL();
            const posCount = positions.length;
            const color = totalPnl >= 0 ? '#10b981' : '#f43f5e';
            const icon = totalPnl >= 0 ? '📈' : '📉';
            el.innerHTML = `${icon} <b>${posCount}</b> pos abiertas · PnL: <span style="color:${color};font-weight:700">${Utils.formatPnL(totalPnl)}</span>`;
        } else if (fg && fg.value <= 20) {
            el.innerHTML = `🩸 <span style="color:#f43f5e">Miedo extremo</span> — Oportunidad contrarian?`;
        } else if (fg && fg.value >= 80) {
            el.innerHTML = `🚨 <span style="color:#10b981">Euforia extrema</span> — Cuidado con longs`;
        } else {
            // Default: show session + tip
            const session = this._getSession();
            el.innerHTML = `${session.icon} ${session.tip}`;
        }
    },

    _updatePriceAction() {
        // Only update context if no positions (positions PnL takes priority)
        if (State.positions.length === 0) {
            this._updateContext();
        }
    },

    _getSession() {
        const now = new Date();
        const utcH = now.getUTCHours();

        // Update session indicator
        const sessionEl = document.getElementById('pulseSession');
        let sessionName, icon, tip, dotColor;

        if (utcH >= 0 && utcH < 8) {
            sessionName = 'Asia';
            icon = '🌏';
            tip = 'Sesión Asia — Volumen bajo, movimientos lentos';
            dotColor = '#f97316';
        } else if (utcH >= 8 && utcH < 13) {
            sessionName = 'Europa';
            icon = '🌍';
            tip = 'Sesión Europa — Volumen creciente';
            dotColor = '#00d4ff';
        } else if (utcH >= 13 && utcH < 17) {
            sessionName = 'US + EU';
            icon = '🔥';
            tip = 'Overlap US-Europa — Máxima liquidez, mejores trades';
            dotColor = '#10b981';
        } else if (utcH >= 17 && utcH < 21) {
            sessionName = 'US';
            icon = '🌎';
            tip = 'Sesión US — Volumen alto, posibles movimientos fuertes';
            dotColor = '#8b5cf6';
        } else {
            sessionName = 'Cierre';
            icon = '🌙';
            tip = 'Pre-Asia — Volumen bajo, spreads amplios';
            dotColor = '#6b7280';
        }

        if (sessionEl) {
            const dot = sessionEl.querySelector('.pulse-dot');
            const text = sessionEl.querySelector('.pulse-session-text');
            if (dot) dot.style.background = dotColor;
            if (text) { text.textContent = sessionName; text.style.color = dotColor; }
        }

        return { name: sessionName, icon, tip, dotColor };
    },

    _updateClock() {
        const el = document.getElementById('pulseClockText');
        if (!el) return;
        try {
            el.textContent = new Date().toLocaleTimeString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {
            el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }
};
