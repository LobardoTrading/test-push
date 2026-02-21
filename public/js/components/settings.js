/* ========================================
   SETTINGS MODAL
   TheRealShortShady v3.0
   ======================================== */

const SettingsModal = {

    open() {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;

        // Pre-fill current values
        const walletInput = document.getElementById('settingWalletSize');
        const maxPosInput = document.getElementById('settingMaxPositions');
        const refreshInput = document.getElementById('settingRefreshRate');

        if (walletInput) walletInput.value = State.balance.toFixed(2);
        if (maxPosInput) maxPosInput.value = State.maxPositions || CONFIG.TRADING.MAX_POSITIONS;

        // Pre-fill refresh rate
        if (refreshInput) {
            const saved = State._load(CONFIG.STORAGE.REFRESH);
            refreshInput.value = saved || '5s';
        }

        // Pre-fill Risk Manager settings
        if (typeof RiskManager !== 'undefined') {
            const cfg = RiskManager._config;
            const fields = {
                'settingMaxDailyLoss': cfg.maxDailyLossPct,
                'settingMaxDrawdown': cfg.maxDrawdownPct,
                'settingMaxConsecLosses': cfg.maxConsecutiveLosses,
                'settingCooldown': cfg.cooldownMinutes,
                'settingMaxPositionPct': cfg.maxPositionPct
            };
            for (const [id, val] of Object.entries(fields)) {
                const el = document.getElementById(id);
                if (el) el.value = val;
            }
        }

        modal.classList.add('active');
    },

    close() {
        const modal = document.getElementById('settingsModal');
        if (modal) modal.classList.remove('active');
    },

    apply() {
        const walletInput = document.getElementById('settingWalletSize');
        const maxPosInput = document.getElementById('settingMaxPositions');
        const refreshInput = document.getElementById('settingRefreshRate');

        if (walletInput) {
            const newBalance = parseFloat(walletInput.value);
            if (!isNaN(newBalance) && newBalance >= 100) {
                State.setBalance(newBalance);
                Utils.showNotification(`Wallet: $${Utils.formatNumber(newBalance)}`, 'success', 3000);
            }
        }

        if (maxPosInput) {
            const maxPos = parseInt(maxPosInput.value);
            if (maxPos >= 1 && maxPos <= 10) {
                State.maxPositions = maxPos;
                State._store('tp_maxPositions', maxPos.toString());
                State._notify('positions', State.positions);
            }
        }

        // Apply refresh rate
        if (refreshInput) {
            const selected = refreshInput.value;
            const option = CONFIG.REFRESH_OPTIONS.find(o => o.label === selected);
            if (option) {
                State._store(CONFIG.STORAGE.REFRESH, selected);
                DataService.setRefreshRate(option.prices, option.candles);
                Utils.showNotification(`Refresh: ${selected}`, 'info', 2000);
            }
        }

        // Apply Risk Manager settings
        if (typeof RiskManager !== 'undefined') {
            const riskFields = {
                'settingMaxDailyLoss': 'maxDailyLossPct',
                'settingMaxDrawdown': 'maxDrawdownPct',
                'settingMaxConsecLosses': 'maxConsecutiveLosses',
                'settingCooldown': 'cooldownMinutes',
                'settingMaxPositionPct': 'maxPositionPct'
            };
            for (const [id, key] of Object.entries(riskFields)) {
                const el = document.getElementById(id);
                if (el) {
                    const val = parseFloat(el.value);
                    if (!isNaN(val)) RiskManager.setConfig(key, val);
                }
            }
        }

        this.close();
    },

    resetWallet() {
        if (!confirm('¿Resetear wallet a $10,000 y cerrar todas las posiciones?')) return;

        State.positions = [];
        State.analysis = null;
        State.setBalance(CONFIG.TRADING.DEFAULT_BALANCE);
        State._notify('positions', State.positions);
        State._notify('analysis', null);

        const walletInput = document.getElementById('settingWalletSize');
        if (walletInput) walletInput.value = CONFIG.TRADING.DEFAULT_BALANCE;

        Utils.showNotification('Wallet reseteada a $10,000', 'success');
        this.close();

        if (typeof Positions !== 'undefined') Positions.render();
        if (typeof Analysis !== 'undefined') Analysis.clear();
        Trading.disableButtons();
    },

    clearHistory() {
        if (!confirm('¿Borrar todo el historial de trades?')) return;
        try {
            localStorage.removeItem(CONFIG.STORAGE.HISTORY || 'tp_history');
            Utils.showNotification('Historial borrado', 'success');
            if (typeof TradeLog !== 'undefined') TradeLog.render();
        } catch (e) {
            console.error(e);
        }
    }
};
