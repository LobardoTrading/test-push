/**
 * BotsPanel — Unified Bot Control Center
 * Shows Autonomy, Lab Bots, and MasterBots in one place
 */
const BotsPanel = {
    _container: null,
    _updateInterval: null,

    init() {
        this._container = document.getElementById('botsPanel');
        if (!this._container) return;

        this.render();
        this._updateInterval = setInterval(() => this.render(), 5000);

        // Subscribe to state changes
        State.subscribe('positions', () => this.render());

        console.log('BotsPanel: Initialized');
    },

    render() {
        if (!this._container) return;

        const autonomyStatus = this._getAutonomyStatus();
        const labBots = this._getLabBots();
        const masterBots = this._getMasterBots();

        this._container.innerHTML = `
            <div class="bots-panel-content">
                <!-- Autonomy Section -->
                <div class="bots-section">
                    <div class="bots-section-header">
                        <span class="bots-section-title">🎛️ Autonomy Bot</span>
                        <span class="bots-section-status ${autonomyStatus.active ? 'active' : 'inactive'}">
                            ${autonomyStatus.active ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                    </div>
                    <div class="bots-section-body">
                        ${this._renderAutonomyInfo(autonomyStatus)}
                    </div>
                    <div class="bots-section-actions">
                        <button class="btn-bot ${autonomyStatus.active ? 'btn-stop' : 'btn-start'}"
                                onclick="BotsPanel.toggleAutonomy()">
                            ${autonomyStatus.active ? '⏹ Detener' : '▶ Iniciar'}
                        </button>
                    </div>
                </div>

                <!-- Lab Bots Section -->
                <div class="bots-section">
                    <div class="bots-section-header">
                        <span class="bots-section-title">🧪 Lab Bots</span>
                        <span class="bots-section-count">${labBots.active}/${labBots.total}</span>
                    </div>
                    <div class="bots-section-body bots-list">
                        ${this._renderLabBots(labBots.bots)}
                    </div>
                    <div class="bots-section-actions">
                        <button class="btn-bot btn-lab" onclick="Lab.open()">
                            🧪 Abrir Lab
                        </button>
                    </div>
                </div>

                <!-- MasterBots Section -->
                <div class="bots-section">
                    <div class="bots-section-header">
                        <span class="bots-section-title">🏆 MasterBots</span>
                        <span class="bots-section-count">${masterBots.length}</span>
                    </div>
                    <div class="bots-section-body bots-list">
                        ${this._renderMasterBots(masterBots)}
                    </div>
                </div>

                <!-- Quick Stats -->
                <div class="bots-stats">
                    ${this._renderQuickStats()}
                </div>
            </div>
        `;
    },

    _getAutonomyStatus() {
        if (typeof AutonomyBot === 'undefined') {
            return { active: false, mode: 'N/A', fitness: 0 };
        }
        return {
            active: AutonomyBot._running || false,
            mode: AutonomyBot._currentMode || 'conservative',
            fitness: AutonomyBot._lastFitness || 0,
            lastCheck: AutonomyBot._lastCheckTime || null
        };
    },

    _getLabBots() {
        if (typeof Lab === 'undefined' || !Lab._bots) {
            return { active: 0, total: 0, bots: [] };
        }
        const bots = Lab._bots || [];
        const active = bots.filter(b => b.active).length;
        return { active, total: bots.length, bots };
    },

    _getMasterBots() {
        if (typeof MasterBots === 'undefined' || !MasterBots._masters) {
            return [];
        }
        return MasterBots._masters || [];
    },

    _renderAutonomyInfo(status) {
        if (!status.active) {
            return `<div class="bot-info-row">Bot de autonomía desactivado</div>`;
        }
        return `
            <div class="bot-info-row">
                <span class="bot-info-label">Modo:</span>
                <span class="bot-info-value mode-${status.mode}">${status.mode}</span>
            </div>
            <div class="bot-info-row">
                <span class="bot-info-label">Fitness:</span>
                <span class="bot-info-value">${status.fitness.toFixed(1)}</span>
            </div>
        `;
    },

    _renderLabBots(bots) {
        if (!bots || bots.length === 0) {
            return '<div class="bots-empty">Sin bots creados</div>';
        }

        return bots.slice(0, 5).map(bot => `
            <div class="bot-mini-card ${bot.active ? 'active' : 'inactive'}">
                <div class="bot-mini-name">${bot.name || bot.id}</div>
                <div class="bot-mini-stats">
                    <span class="bot-mini-wr">${((bot.stats?.winRate || 0) * 100).toFixed(0)}%</span>
                    <span class="bot-mini-trades">${bot.stats?.trades || 0}t</span>
                </div>
                <div class="bot-mini-status ${bot.active ? 'on' : 'off'}">
                    ${bot.active ? '●' : '○'}
                </div>
            </div>
        `).join('');
    },

    _renderMasterBots(masters) {
        if (!masters || masters.length === 0) {
            return '<div class="bots-empty">Sin masters aún</div>';
        }

        return masters.slice(0, 3).map(m => `
            <div class="bot-mini-card master">
                <div class="bot-mini-name">🏆 ${m.name || m.id}</div>
                <div class="bot-mini-stats">
                    <span class="bot-mini-wr">${((m.winRate || 0) * 100).toFixed(0)}%</span>
                    <span class="bot-mini-pnl ${m.totalPnl >= 0 ? 'positive' : 'negative'}">
                        ${m.totalPnl >= 0 ? '+' : ''}${(m.totalPnl || 0).toFixed(2)}
                    </span>
                </div>
            </div>
        `).join('');
    },

    _renderQuickStats() {
        const state = State.get();
        const positions = state.positions || [];
        const balance = state.wallet?.balance || 10000;
        const totalPnl = state.wallet?.totalPnl || 0;

        return `
            <div class="bots-stat-item">
                <span class="bots-stat-label">Posiciones</span>
                <span class="bots-stat-value">${positions.length}/3</span>
            </div>
            <div class="bots-stat-item">
                <span class="bots-stat-label">Balance</span>
                <span class="bots-stat-value">$${balance.toFixed(0)}</span>
            </div>
            <div class="bots-stat-item">
                <span class="bots-stat-label">P&L Total</span>
                <span class="bots-stat-value ${totalPnl >= 0 ? 'positive' : 'negative'}">
                    ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}
                </span>
            </div>
        `;
    },

    toggleAutonomy() {
        if (typeof AutonomyBot === 'undefined') {
            console.warn('AutonomyBot not loaded');
            return;
        }

        if (AutonomyBot._running) {
            AutonomyBot.stop();
        } else {
            AutonomyBot.start();
        }

        setTimeout(() => this.render(), 100);
    },

    destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }
    }
};

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => BotsPanel.init());
} else {
    setTimeout(() => BotsPanel.init(), 100);
}
