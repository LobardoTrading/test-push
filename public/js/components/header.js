/* ========================================
   HEADER - Header Component
   Trading Platform PRO v3.0
   ======================================== */

const Header = {

    _equityInterval: null,

    init() {
        this.render();
        this.bindEvents();
        this.subscribeToState();
        this._startEquityUpdate();
    },

    render() {
        const header = document.getElementById('header');
        if (!header) return;

        header.innerHTML = `
            <div class="logo">
                ⚡ TheRealShortShady
                <span class="logo-version">v${CONFIG.VERSION}</span>
            </div>

            <div class="modes" id="modeButtons">
                ${Object.entries(CONFIG.MODES).map(([key, mode], i) => `
                    <button class="mode-btn ${key === State.mode ? 'active' : ''}"
                            data-mode="${key}"
                            title="${mode.desc || ''} (Atajo: ${i + 1})">
                        ${mode.name}
                    </button>
                `).join('')}
            </div>

            <div class="header-right">
                <span class="account-type paper">PAPER</span>

          <button class="header-lab-btn" onclick="Dashboard.toggle()" title="Cockpit (D)">
                    📊
                </button>

                <button class="header-lab-btn" onclick="Lab.open()" title="LAB — Bots Autónomos">
                    🧪 <span class="lab-btn-count" id="labBtnCount"></span>
                </button>

                <div class="balance-box">
                    <div class="balance-label">Balance</div>
                    <div class="balance-value" id="balanceDisplay">
                        ${Utils.formatCurrency(State.balance)}
                    </div>
                    <div class="balance-sub" id="equityDisplay">
                        Equity: ${Utils.formatCurrency(State.getEquity())}
                    </div>
                </div>

                <div class="balance-box" id="pnlBox" style="display:${State.positions.length > 0 ? 'block' : 'none'};">
                    <div class="balance-label">PnL Abierto</div>
                    <div class="balance-value" id="openPnlDisplay" style="font-size:14px;">
                        ${Utils.formatPnL(State.getOpenPnL())}
                    </div>
                </div>

                <div class="status" id="statusContainer">
                    <div class="status-dot ${State.isConnected ? 'connected' : ''}"
                         id="statusDot"></div>
                    <span id="statusText">
                        ${State.isConnected ? 'Conectado' : 'Conectando...'}
                    </span>
                </div>

                <button class="header-settings-btn" onclick="SettingsModal.open()" title="Configuración">⚙</button>
            </div>
        `;
    },

    bindEvents() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                if (mode) this.setMode(mode);
            });
        });
    },

    subscribeToState() {
        State.subscribe('balance', (balance) => {
            const el = document.getElementById('balanceDisplay');
            if (el) el.textContent = Utils.formatCurrency(balance);
        });

        State.subscribe('isConnected', (connected) => {
            const dot = document.getElementById('statusDot');
            const text = document.getElementById('statusText');
            if (dot) dot.className = `status-dot ${connected ? 'connected' : ''}`;
            if (text) text.textContent = connected ? 'Conectado' : 'Desconectado';
        });

        State.subscribe('positions', (positions) => {
            const pnlBox = document.getElementById('pnlBox');
            if (pnlBox) {
                pnlBox.style.display = positions.length > 0 ? 'block' : 'none';
            }
            this._updateEquity();
        });
    },

    setMode(mode) {
        if (!CONFIG.MODES[mode]) return;
        State.set('mode', mode);
        State.set('timeframe', CONFIG.MODES[mode].tf);
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        const tfSelect = document.getElementById('tfSelect');
        if (tfSelect) tfSelect.value = CONFIG.MODES[mode].tf;
    },

    updateMode() {
        const mode = State.mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        const tfSelect = document.getElementById('tfSelect');
        if (tfSelect) tfSelect.value = CONFIG.MODES[mode]?.tf || '15m';
    },

    _updateEquity() {
        const equityEl = document.getElementById('equityDisplay');
        const pnlEl = document.getElementById('openPnlDisplay');
        const equity = State.getEquity();
        const openPnl = State.getOpenPnL();
        if (equityEl) equityEl.textContent = `Equity: ${Utils.formatCurrency(equity)}`;
        if (pnlEl) {
            pnlEl.textContent = Utils.formatPnL(openPnl);
            pnlEl.style.color = openPnl >= 0 ? 'var(--green)' : 'var(--red)';
        }
    },

    _startEquityUpdate() {
        if (this._equityInterval) clearInterval(this._equityInterval);
        this._equityInterval = setInterval(() => {
            if (State.positions.length > 0) this._updateEquity();
        }, 1000);
    },

    updateBalance(balance) {
        const el = document.getElementById('balanceDisplay');
        if (el) el.textContent = Utils.formatCurrency(balance);
    },

    updateLabCount() {
        const el = document.getElementById('labBtnCount');
        if (!el) return;
        const bots = Lab._getBots();
        const running = bots.filter(b => b.status === 'running').length;
        el.textContent = running > 0 ? running : '';
        el.style.display = running > 0 ? 'inline' : 'none';
    }
};
