/* ========================================
   ANALYSIS - Analysis Panel + Intelligence + MasterBots
   TheRealShortShady v4.0
   ======================================== */

const Analysis = {

    init() {
        this.clear();
    },

    /** Normalize candles from State format (o,h,l,c,v) to long format (open,high,low,close,volume) */
    _normalizeCandles(candles) {
        if (!candles || candles.length === 0) return [];
        // Check if already normalized
        if (candles[0].close !== undefined) return candles;
        return candles.map(c => ({
            open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v, time: c.t
        }));
    },

    /** Compute indicators from candles using Indicators module */
    _computeIndicators(candles) {
        const ind = {};
        if (typeof Indicators === 'undefined' || !candles || candles.length < 14) return ind;

        const closes = candles.map(c => c.c || c.close || 0);

        // EMAs
        const ema9s = Indicators.emaSeries(closes, 9);
        const ema21s = Indicators.emaSeries(closes, 21);
        if (ema9s.length > 0) ind.ema9 = ema9s[ema9s.length - 1];
        if (ema21s.length > 0) ind.ema21 = ema21s[ema21s.length - 1];

        // EMA50
        if (closes.length >= 50) {
            const ema50s = Indicators.emaSeries(closes, 50);
            if (ema50s.length > 0) ind.ema50 = ema50s[ema50s.length - 1];
        }

        // RSI
        const rsiS = Indicators.rsiSeries(closes, 14);
        if (rsiS.length > 0) ind.rsi = rsiS[rsiS.length - 1];

        // MACD
        if (typeof Indicators.macd === 'function') {
            const macdData = Indicators.macd(closes);
            if (macdData?.series?.length > 0) {
                const last = macdData.series[macdData.series.length - 1];
                ind.macd = last.macd;
                ind.macdSignal = last.signal;
                ind.macdHistogram = last.histogram;
            }
        }

        // Bollinger Bands
        if (closes.length >= 20) {
            const slice = closes.slice(-20);
            const mean = slice.reduce((a, b) => a + b, 0) / 20;
            const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / 20);
            ind.bbUpper = mean + std * 2;
            ind.bbLower = mean - std * 2;
            ind.bbMid = mean;
        }

        // Stochastic K (simple)
        if (closes.length >= 14) {
            const period = closes.slice(-14);
            const high14 = Math.max(...period);
            const low14 = Math.min(...period);
            const current = closes[closes.length - 1];
            ind.stochK = high14 !== low14 ? ((current - low14) / (high14 - low14)) * 100 : 50;
        }

        return ind;
    },

    async render(data) {
        const container = document.getElementById('analysisPanel');
        if (!container || !data) return;

        const decisionClass = data.decision === 'ENTER' ? 'enter' :
                              data.decision === 'WAIT' ? 'wait' : 'cancel';
        const directionClass = data.direction === 'LONG' ? 'long' : 'short';
        const scoreClass = data.confidence >= 70 ? 'high' :
                           data.confidence >= 50 ? 'medium' : 'low';

        const rrRatio = data.rr_ratio || (data.tp && data.sl && data.price
            ? (Math.abs(data.tp - data.price) / Math.abs(data.sl - data.price)).toFixed(2)
            : '--');

        const tpDist = data.price ? ((Math.abs(data.tp - data.price) / data.price) * 100).toFixed(2) : '--';
        const slDist = data.price ? ((Math.abs(data.sl - data.price) / data.price) * 100).toFixed(2) : '--';

        const stats = (typeof Trading !== 'undefined' && Trading.getStats) ? Trading.getStats() : null;
        const estTime = this._estimateTime(data);

        // Prepare candles and indicators for Intelligence + MasterBots
        const rawCandles = State.candles || [];
        const normalizedCandles = this._normalizeCandles(rawCandles);
        const indicators = this._computeIndicators(rawCandles);
        const symbol = State.symbol || 'BTC';

        // Get intelligence + MasterBots data
        let intelHTML = '';
        try {
            // Intelligence
            if (typeof Intelligence !== 'undefined') {
                const intel = await Intelligence.getIntelligence(symbol, normalizedCandles);

                if (intel) {
                    intelHTML += `<div class="bots-title" style="margin-top:12px;">🧠 Intelligence</div>`;
                    intelHTML += Intelligence.renderMarketScoreHTML();

                    if (intel.recommendation) {
                        const rec = intel.recommendation;
                        intelHTML += `
                            <div class="intel-recommendation">
                                <div class="intel-rec-header">
                                    <span class="intel-rec-bias" style="color:${rec.biasColor}">${rec.bias}</span>
                                    <span class="intel-rec-conf" style="color:${rec.biasColor}">${rec.confidence}% sesgo</span>
                                </div>
                                <div class="intel-rec-reasons">${rec.reasons.join(' · ')}</div>
                            </div>
                        `;
                    }

                    if (intel.patterns && intel.patterns.length > 0) {
                        intelHTML += Intelligence.renderPatternsHTML(intel.patterns);
                    }

                    intelHTML += Intelligence.renderCorrelationHTML(symbol);
                }
            }

            // MasterBots
            if (typeof MasterBots !== 'undefined') {
                await MasterBots.analyzeAll(symbol, normalizedCandles, indicators);
                intelHTML += MasterBots.renderForAnalysis(symbol);
            }

            // Liquidity Heatmap
            if (typeof LiquidityHeatmap !== 'undefined') {
                const liqData = await LiquidityHeatmap.getLiquidityAnalysis();
                if (liqData) {
                    intelHTML += this._renderLiquidityAnalysis(liqData, data);
                }
                // Trigger heatmap update
                LiquidityHeatmap.update();
            }
        } catch (e) {
            console.error('Intelligence/MasterBots render error:', e);
        }
       // Multi-Timeframe
            if (typeof MultiTF !== 'undefined') {
                try {
                    const mtfResult = await MultiTF.analyze(symbol + 'USDT', State.timeframe);
                    if (mtfResult) {
                        intelHTML += MultiTF.renderHTML(mtfResult);

                        // Feed MTF alignment to SmartEngine for better consistency
                        if (typeof SmartEngine !== 'undefined' && mtfResult.alignment) {
                            data._mtfAlignment = mtfResult.alignment;
                        }
                    }
                } catch (e) {
                    console.error('MultiTF render error:', e);
                }
            }

        container.innerHTML = `
            <!-- Decision Box -->
            <div class="decision-box ${decisionClass}">
                <div class="decision-direction ${directionClass}">
                    ${data.direction === 'LONG' ? '▲' : '▼'} ${data.direction}
                </div>
                <div class="decision-text">
                    ${data.decision === 'ENTER' ? 'ENTRAR' :
                      data.decision === 'WAIT' ? 'ESPERAR' : 'NO OPERAR'}
                </div>
            </div>

            <!-- Confidence Bar -->
            <div class="score-box">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span class="score-label">Confianza</span>
                    <span class="score-value ${scoreClass}">${data.confidence}%</span>
                </div>
                <div style="width:100%; height:5px; background:var(--surface); border-radius:3px; overflow:hidden;">
                    <div style="width:${data.confidence}%; height:100%; border-radius:3px; transition:width 0.5s ease;
                        background:${data.confidence >= 70 ? 'var(--green)' :
                                     data.confidence >= 50 ? 'var(--yellow)' : 'var(--red)'};">
                    </div>
                </div>
            </div>

            <!-- Estimated Time -->
            <div class="detail-row" style="border-left:2px solid var(--gold);">
                <span class="detail-label">⏱ Duración estimada</span>
                <span class="detail-value" style="color:var(--gold)">${estTime.duration}</span>
            </div>
            <div class="detail-row" style="border-left:2px solid var(--gold);">
                <span class="detail-label">Cierre estimado (BsAs)</span>
                <span class="detail-value" style="color:var(--gold)">${estTime.closeAt}</span>
            </div>

            <!-- Trade Details -->
            <div class="detail-row">
                <span class="detail-label">Precio</span>
                <span class="detail-value">$${Utils.formatPrice(data.price)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Take Profit</span>
                <span class="detail-value text-green">$${Utils.formatPrice(data.tp)} <small>(${tpDist}%)</small></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Stop Loss</span>
                <span class="detail-value text-red">$${Utils.formatPrice(data.sl)} <small>(${slDist}%)</small></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Leverage</span>
                <span class="detail-value">${data.leverage}x</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">R:R Ratio</span>
                <span class="detail-value" style="color:${parseFloat(rrRatio) >= 1.5 ? 'var(--green)' :
                    parseFloat(rrRatio) >= 1 ? 'var(--yellow)' : 'var(--red)'}">
                    ${rrRatio}:1
                </span>
            </div>
            ${data.atr ? `
            <div class="detail-row">
                <span class="detail-label">ATR</span>
                <span class="detail-value">$${Utils.formatPrice(data.atr)}</span>
            </div>
            ` : ''}

            <!-- Reason -->
            <div class="reason-box">${data.reason}</div>

            <!-- API Bots Results -->
            <div class="bots-title">Bots Analistas (${data.bots?.length || 0})</div>
            ${this._renderBots(data.bots)}

            <!-- Intelligence + MasterBots -->
            ${intelHTML}

            <!-- Stats -->
            ${stats && stats.trades > 0 ? this._renderStats(stats) : ''}
        `;
    },

    _estimateTime(data) {
        const modeEstimates = {
            scalping: { min: 1, max: 5 },
            intraday: { min: 30, max: 240 },
            swing: { min: 240, max: 4320 },
            position: { min: 1440, max: 30240 }
        };
        const mode = State.mode || 'intraday';
        const est = modeEstimates[mode] || modeEstimates.intraday;
        const mid = (est.min + est.max) / 2;

        let duration;
        if (mid < 60) duration = `${Math.round(est.min)}-${Math.round(est.max)} min`;
        else if (mid < 1440) duration = `${Math.round(est.min / 60)}-${Math.round(est.max / 60)} horas`;
        else duration = `${Math.round(est.min / 1440)}-${Math.round(est.max / 1440)} días`;

        const closeDate = new Date(Date.now() + mid * 60000);
        let closeAt;
        try {
            closeAt = closeDate.toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                weekday: 'short', hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {
            closeAt = closeDate.toLocaleString('es-AR');
        }

        return { duration, closeAt };
    },

    _renderBots(bots) {
        if (!bots || !bots.length) return '<div class="text-muted">Sin datos de bots</div>';

        return bots.map(bot => {
            const signalClass = bot.signal.toLowerCase();
            return `
                <div class="bot-item">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="bot-name">
                            ${bot.name}
                            ${bot.critical ? '<span class="bot-critical">CRÍTICO</span>' : ''}
                        </span>
                        <span class="bot-result ${signalClass}">
                            <span class="bot-signal ${signalClass}"></span>
                            ${bot.score}%
                        </span>
                    </div>
                    <div style="font-size:11px; color:var(--muted); margin-top:2px; padding-left:4px;">
                        ${bot.reason || ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    _renderStats(stats) {
        const winRateColor = stats.winRate >= 60 ? 'var(--green)' :
                             stats.winRate >= 45 ? 'var(--yellow)' : 'var(--red)';
        return `
            <div class="bots-title" style="margin-top:12px;">Estadísticas</div>
            <div class="detail-row">
                <span class="detail-label">Trades</span>
                <span class="detail-value">${stats.trades} (${stats.wins}W / ${stats.losses}L)</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Win Rate</span>
                <span class="detail-value" style="color:${winRateColor}">${stats.winRate}%</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">PnL Total</span>
                <span class="detail-value" style="color:${stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">
                    ${Utils.formatPnL(stats.totalPnl)}
                </span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Profit Factor</span>
                <span class="detail-value">${stats.profitFactor}</span>
            </div>
        `;
    },

    _renderLiquidityAnalysis(liqData, tradeData) {
        if (!liqData) return '';

        const imbalanceColor = liqData.imbalanceSignal === 'BULLISH' ? 'var(--green)' :
                               liqData.imbalanceSignal === 'BEARISH' ? 'var(--red)' : 'var(--dim)';

        // Check if SL/TP align with liquidity zones
        let slWarning = '';
        let tpNote = '';

        if (tradeData.sl && liqData.supports.length > 0) {
            const nearestSupport = liqData.supports[0];
            const slDist = Math.abs(tradeData.sl - nearestSupport) / nearestSupport * 100;
            if (slDist < 0.5 && tradeData.direction === 'LONG') {
                slWarning = '<span style="color:var(--green)">SL cerca de soporte</span>';
            }
        }

        if (tradeData.tp && liqData.resistances.length > 0) {
            const nearestRes = liqData.resistances[0];
            const tpDist = Math.abs(tradeData.tp - nearestRes) / nearestRes * 100;
            if (tpDist < 1 && tradeData.direction === 'LONG') {
                tpNote = '<span style="color:var(--yellow)">TP cerca de resistencia</span>';
            }
        }

        return `
            <div class="bots-title" style="margin-top:12px;">🔥 Liquidity Analysis</div>
            <div class="detail-row">
                <span class="detail-label">Order Flow</span>
                <span class="detail-value" style="color:${imbalanceColor}">${liqData.imbalanceSignal}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Imbalance</span>
                <span class="detail-value">${(liqData.imbalance * 100).toFixed(1)}%</span>
            </div>
            ${liqData.supports.length > 0 ? `
            <div class="detail-row">
                <span class="detail-label">Soporte</span>
                <span class="detail-value" style="color:var(--green)">$${Utils.formatPrice(liqData.supports[0])}</span>
            </div>
            ` : ''}
            ${liqData.resistances.length > 0 ? `
            <div class="detail-row">
                <span class="detail-label">Resistencia</span>
                <span class="detail-value" style="color:var(--red)">$${Utils.formatPrice(liqData.resistances[0])}</span>
            </div>
            ` : ''}
            ${slWarning ? `<div class="detail-row"><span class="detail-label">Nota</span>${slWarning}</div>` : ''}
            ${tpNote ? `<div class="detail-row"><span class="detail-label">Alerta</span>${tpNote}</div>` : ''}
        `;
    },

    clear() {
        const container = document.getElementById('analysisPanel');
        if (container) {
            container.innerHTML = `
                <div class="analysis-empty">
                    ◈<br><br>
                    Seleccioná un par y presioná<br>
                    <b>Analizar</b> o <b>Ctrl+Enter</b>
                </div>
            `;
        }
    }
};
