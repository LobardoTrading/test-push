/* ========================================
   EVENT FEED — System Activity Log
   TheRealShortShady v4.2.0
   
   Muestra TODO lo que pasa en el sistema:
   - Checks de bots con resultado
   - Trades abiertos/cerrados
   - Filtros que bloquearon entradas
   - Errores del sistema
   ======================================== */

const EventFeed = {

    _events: [],
    _MAX_EVENTS: 200,
    _containerEl: null,
    _visible: false,
    _PERSIST_KEY: 'tp_event_log',
    _MAX_PERSISTED: 500,
    _PERSIST_TYPES: ['trade', 'risk', 'system', 'pipeline'], // Only persist important types
    _filters: {
        pipeline: true,
        bot: true,
        trade: true,
        risk: true,
        system: true,
        error: true
    },

    init() {
        this._containerEl = document.getElementById('eventFeedContainer');
        this._loadPersisted();
        console.log('📋 EventFeed initialized');
    },

    /** Load persisted events from localStorage */
    _loadPersisted() {
        try {
            const saved = localStorage.getItem(this._PERSIST_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    // Convert timestamp strings back to Date objects for in-memory use
                    this._persistedEvents = parsed;
                }
            }
        } catch(e) {}
        if (!this._persistedEvents) this._persistedEvents = [];
    },

    /** Save event to persistent storage if it's an important type */
    _persistEvent(event) {
        if (!this._PERSIST_TYPES.includes(event.type)) return;
        if (!this._persistedEvents) this._persistedEvents = [];

        this._persistedEvents.unshift({
            type: event.type,
            icon: event.icon,
            message: event.message,
            timestamp: event.timestamp.toISOString()
        });

        if (this._persistedEvents.length > this._MAX_PERSISTED) {
            this._persistedEvents = this._persistedEvents.slice(0, this._MAX_PERSISTED);
        }

        try {
            localStorage.setItem(this._PERSIST_KEY, JSON.stringify(this._persistedEvents));
        } catch(e) {}
    },

    /** Get persisted event history (for Dashboard/reports) */
    getHistory(type = null, limit = 50) {
        const events = this._persistedEvents || [];
        const filtered = type ? events.filter(e => e.type === type) : events;
        return filtered.slice(0, limit);
    },

    /** Get stats from persisted events (for Dashboard) */
    getStats(days = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const recent = (this._persistedEvents || []).filter(e => new Date(e.timestamp) > cutoff);

        return {
            total: recent.length,
            trades: recent.filter(e => e.type === 'trade').length,
            riskBlocks: recent.filter(e => e.type === 'risk').length,
            pipelineAnalyses: recent.filter(e => e.type === 'pipeline').length,
            systemEvents: recent.filter(e => e.type === 'system').length,
        };
    },

    /** Log genérico — tipo, icono, mensaje, detalles opcionales */
    log(type, icon, message, details = {}) {
        const event = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            type,
            icon,
            message,
            details,
            timestamp: new Date()
        };

        this._events.unshift(event);
        if (this._events.length > this._MAX_EVENTS) {
            this._events = this._events.slice(0, this._MAX_EVENTS);
        }

        // Persist important events
        this._persistEvent(event);

        // Console log para debugging
        console.log(`📋 [${type}] ${icon} ${message}`);

        // Render si visible
        if (this._visible && this._containerEl) {
            this._renderEvent(event, true);
        }
    },

    // ─── Helpers específicos ─────────────────────────────

    /** Log de check de bot */
    botCheck(botName, result) {
        if (!result) {
            this.log('bot', '⚫', `${botName}: Sin resultado del análisis`);
            return;
        }
        const conf = result.confidence || 0;
        const dec = result.decision || 'NULL';
        const dir = result.direction || '?';
        const alignment = result._pipeline?.alignment;
        const alignStr = alignment !== undefined ? ` · ${(alignment * 100).toFixed(0)}% align` : '';

        const icon = dec === 'ENTER' ? '🟢' : dec === 'WAIT' ? '🟡' : '🔴';
        this.log('bot', icon, `${botName}: ${dec} ${dir} (${conf}%${alignStr})`);
    },

    /** Log de filtro que bloqueó entrada */
    botSkip(botName, reason) {
        this.log('bot', '🚫', `${botName}: bloqueado — ${reason}`);
    },

    /** Log de trade abierto */
    tradeOpen(botName, direction, symbol, price, confidence) {
        this.log('trade', '📈', 
            `${botName}: ABIERTO ${direction} ${symbol} @ $${this._fmtPrice(price)} (${confidence}%)`,
            { direction, symbol, price }
        );
    },

    /** Log de trade cerrado */
    tradeClose(botName, symbol, pnl, reason) {
        const icon = pnl > 0 ? '💰' : '💔';
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        this.log('trade', icon,
            `${botName}: CERRADO ${symbol} ${pnlStr} — ${reason}`,
            { pnl, reason }
        );
    },

    /** Log de riesgo */
    riskBlock(reason) {
        this.log('risk', '🛡️', `Risk Manager: ${reason}`);
    },

    /** Log de sistema */
    system(message) {
        this.log('system', '⚙️', message);
    },

    /** Log de error */
    error(message, err) {
        this.log('error', '❌', `${message}${err ? ': ' + err.message : ''}`);
    },

    // ─── UI ─────────────────────────────────────────────

    /** Toggle visibilidad del feed */
    toggle() {
        this._visible = !this._visible;
        const panel = document.getElementById('eventFeedPanel');
        if (panel) {
            panel.style.display = this._visible ? 'flex' : 'none';
        }
        if (this._visible) this.render();

        // Update button state
        const btn = document.getElementById('btnEventFeed');
        if (btn) btn.classList.toggle('active', this._visible);
    },

    /** Render completo del feed */
    render() {
        if (!this._containerEl) {
            this._containerEl = document.getElementById('eventFeedContainer');
        }
        if (!this._containerEl) return;

        const filtered = this._events.filter(e => this._filters[e.type] !== false);
        
        if (filtered.length === 0) {
            this._containerEl.innerHTML = '<div class="ef-empty">Sin actividad aún...</div>';
            return;
        }

        this._containerEl.innerHTML = filtered.slice(0, 80).map(e => this._eventHTML(e)).join('');
    },

    /** Render de un evento individual (prepend) */
    _renderEvent(event, prepend = false) {
        if (!this._containerEl) return;
        if (this._filters[event.type] === false) return;

        // Remove empty message if present
        const empty = this._containerEl.querySelector('.ef-empty');
        if (empty) empty.remove();

        const div = document.createElement('div');
        div.innerHTML = this._eventHTML(event);
        const el = div.firstElementChild;

        if (el) {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-10px)';

            if (prepend && this._containerEl.firstChild) {
                this._containerEl.insertBefore(el, this._containerEl.firstChild);
            } else {
                this._containerEl.appendChild(el);
            }

            // Animate in
            requestAnimationFrame(() => {
                el.style.transition = 'opacity 0.3s, transform 0.3s';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            });

            // Keep max visible events
            while (this._containerEl.children.length > 80) {
                this._containerEl.removeChild(this._containerEl.lastChild);
            }
        }
    },

    /** HTML de un evento */
    _eventHTML(e) {
        const time = e.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const typeClass = `ef-${e.type}`;
        return `<div class="ef-event ${typeClass}">` +
            `<span class="ef-time">${time}</span>` +
            `<span class="ef-icon">${e.icon}</span>` +
            `<span class="ef-msg">${this._escapeHTML(e.message)}</span>` +
            `</div>`;
    },

    /** Limpiar feed */
    clear() {
        this._events = [];
        if (this._containerEl) this._containerEl.innerHTML = '<div class="ef-empty">Feed limpiado</div>';
    },

    /** Helpers */
    _fmtPrice(p) {
        if (!p) return '?';
        return p >= 1 ? p.toFixed(2) : p.toFixed(4);
    },

    _escapeHTML(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    // ─── Inline Render for Activity Tab ─────────────────

    /** Render compact inline version for Activity tab */
    renderInline() {
        const container = document.getElementById('eventFeedInline');
        if (!container) return;

        const filtered = this._events.filter(e => this._filters[e.type] !== false);

        if (filtered.length === 0) {
            container.innerHTML = '<div class="ef-empty-inline">Sin eventos</div>';
            return;
        }

        container.innerHTML = filtered.slice(0, 30).map(e => this._eventHTMLCompact(e)).join('');
    },

    /** Compact HTML for inline events */
    _eventHTMLCompact(e) {
        const time = e.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        return `<div class="ef-event-compact ef-${e.type}">` +
            `<span class="ef-icon-sm">${e.icon}</span>` +
            `<span class="ef-msg-sm">${this._escapeHTML(e.message).slice(0, 60)}</span>` +
            `<span class="ef-time-sm">${time}</span>` +
            `</div>`;
    },

    /** Start auto-updating inline feed */
    startInlineUpdates() {
        this.renderInline();
        if (!this._inlineInterval) {
            this._inlineInterval = setInterval(() => this.renderInline(), 3000);
        }
    }
};
