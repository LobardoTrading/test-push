/* ========================================
   MULTI-TIMEFRAME — Cross-TF Analysis
   Analyzes trend on higher TF, entry on current, timing on lower
   TheRealShortShady v4.1
   ======================================== */

const MultiTF = {

    // TF hierarchy: each TF maps to its higher and lower companions
    _tfMap: {
        '1m':  { higher: '5m',  lower: null,  label: '1min' },
        '3m':  { higher: '15m', lower: '1m',  label: '3min' },
        '5m':  { higher: '30m', lower: '1m',  label: '5min' },
        '15m': { higher: '1h',  lower: '5m',  label: '15min' },
        '30m': { higher: '4h',  lower: '5m',  label: '30min' },
        '1h':  { higher: '4h',  lower: '15m', label: '1hr' },
        '2h':  { higher: '1d',  lower: '30m', label: '2hr' },
        '4h':  { higher: '1d',  lower: '1h',  label: '4hr' },
        '1d':  { higher: '1w',  lower: '4h',  label: '1día' },
        '1w':  { higher: null,  lower: '1d',  label: '1sem' },
    },

    // Cache to avoid refetching
    _cache: {},
    _CACHE_TTL: 30000, // 30s

    /**
     * Run multi-timeframe analysis
     * Returns: { current, higher, lower, alignment, summary }
     */
    async analyze(symbol, currentTF) {
        const map = this._tfMap[currentTF];
        if (!map) return null;

        const tfList = [
            { tf: currentTF, role: 'current', label: map.label },
        ];

        if (map.higher) {
            const higherMap = this._tfMap[map.higher];
            tfList.push({ tf: map.higher, role: 'higher', label: higherMap?.label || map.higher });
        }

        if (map.lower) {
            const lowerMap = this._tfMap[map.lower];
            tfList.push({ tf: map.lower, role: 'lower', label: lowerMap?.label || map.lower });
        }

        // Fetch all timeframes in parallel
        const results = await Promise.allSettled(
            tfList.map(async ({ tf, role, label }) => {
                const candles = await this._fetchCandles(symbol, tf);
                if (!candles || candles.length < 21) return null;

                const analysis = this._analyzeCandles(candles, tf);
                return { tf, role, label, ...analysis };
            })
        );

        // Collect successful results
        const analyses = {};
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                analyses[r.value.role] = r.value;
            }
        }

        if (!analyses.current) return null;

        // Calculate alignment
        const alignment = this._calculateAlignment(analyses);

        return {
            timeframes: analyses,
            alignment,
            summary: this._buildSummary(analyses, alignment)
        };
    },

    /**
     * Fetch candles with cache
     */
    async _fetchCandles(symbol, tf) {
        const key = `${symbol}_${tf}`;
        const cached = this._cache[key];
        if (cached && Date.now() - cached.time < this._CACHE_TTL) {
            return cached.data;
        }

        try {
            const fullSymbol = symbol.includes('USDT') ? symbol : symbol + 'USDT';
            const candles = await API.getKlines(fullSymbol, tf, 100);
            this._cache[key] = { data: candles, time: Date.now() };
            return candles;
        } catch (e) {
            console.error(`MultiTF fetch error ${symbol}/${tf}:`, e.message);
            return null;
        }
    },

    /**
     * Analyze a set of candles — trend, momentum, key levels
     */
    _analyzeCandles(candles, tf) {
        const closes = candles.map(c => c.c);
        const highs = candles.map(c => c.h);
        const lows = candles.map(c => c.l);
        const volumes = candles.map(c => c.v || 0);
        const last = closes[closes.length - 1];

        // EMAs
        const ema9 = Indicators.ema(closes, 9);
        const ema21 = Indicators.ema(closes, 21);
        const ema50 = closes.length >= 50 ? Indicators.ema(closes, 50) : null;

        // RSI
        const rsi = Indicators.rsi(closes, 14);

        // MACD
        let macdData = null;
        if (typeof Indicators.macd === 'function') {
            const m = Indicators.macd(closes);
            if (m?.series?.length > 0) {
                macdData = m.series[m.series.length - 1];
            }
        }

        // Trend determination
        let trend = 'NEUTRAL';
        let trendStrength = 0;
        const reasons = [];

        // EMA structure
        if (ema9 > ema21) {
            trendStrength += 25;
            reasons.push('EMA9 > EMA21');
        } else if (ema9 < ema21) {
            trendStrength -= 25;
            reasons.push('EMA9 < EMA21');
        }

        if (ema50 !== null) {
            if (last > ema50) {
                trendStrength += 20;
                reasons.push('Precio > EMA50');
            } else {
                trendStrength -= 20;
                reasons.push('Precio < EMA50');
            }
        }

        // Price vs EMAs
        if (last > ema9 && last > ema21) {
            trendStrength += 15;
        } else if (last < ema9 && last < ema21) {
            trendStrength -= 15;
        }

        // RSI bias
        if (rsi > 60) {
            trendStrength += 10;
            reasons.push(`RSI ${rsi.toFixed(0)} (bull)`);
        } else if (rsi < 40) {
            trendStrength -= 10;
            reasons.push(`RSI ${rsi.toFixed(0)} (bear)`);
        } else {
            reasons.push(`RSI ${rsi.toFixed(0)} (neutral)`);
        }

        // MACD
        if (macdData) {
            if (macdData.histogram > 0) {
                trendStrength += 15;
                reasons.push('MACD positivo');
            } else {
                trendStrength -= 15;
                reasons.push('MACD negativo');
            }
            // MACD crossover
            if (macdData.macd > macdData.signal) {
                trendStrength += 10;
            } else {
                trendStrength -= 10;
            }
        }

        // Higher highs / lower lows (last 10 candles)
        if (candles.length >= 10) {
            const recent = candles.slice(-10);
            const midpoint = Math.floor(recent.length / 2);
            const firstHalf = recent.slice(0, midpoint);
            const secondHalf = recent.slice(midpoint);

            const avgHigh1 = firstHalf.reduce((s, c) => s + c.h, 0) / firstHalf.length;
            const avgHigh2 = secondHalf.reduce((s, c) => s + c.h, 0) / secondHalf.length;
            const avgLow1 = firstHalf.reduce((s, c) => s + c.l, 0) / firstHalf.length;
            const avgLow2 = secondHalf.reduce((s, c) => s + c.l, 0) / secondHalf.length;

            if (avgHigh2 > avgHigh1 && avgLow2 > avgLow1) {
                trendStrength += 10;
                reasons.push('HH + HL');
            } else if (avgHigh2 < avgHigh1 && avgLow2 < avgLow1) {
                trendStrength -= 10;
                reasons.push('LH + LL');
            }
        }

        // Volume trend
        if (volumes.length >= 10) {
            const recentVol = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
            const prevVol = volumes.slice(-10, -5).reduce((s, v) => s + v, 0) / 5;
            if (recentVol > prevVol * 1.3) {
                reasons.push('Vol creciente');
            } else if (recentVol < prevVol * 0.7) {
                reasons.push('Vol decreciente');
            }
        }

        // Clamp strength
        trendStrength = Math.max(-100, Math.min(100, trendStrength));

        if (trendStrength > 20) trend = 'BULLISH';
        else if (trendStrength < -20) trend = 'BEARISH';
        else trend = 'NEUTRAL';

        // Support / Resistance (simple: recent swing high/low)
        let support = null, resistance = null;
        if (candles.length >= 20) {
            const recent20 = candles.slice(-20);
            resistance = Math.max(...recent20.map(c => c.h));
            support = Math.min(...recent20.map(c => c.l));
        }

        // Momentum (last 3 candles direction)
        let momentum = 'FLAT';
        if (candles.length >= 3) {
            const last3 = candles.slice(-3);
            const bullCandles = last3.filter(c => c.c > c.o).length;
            if (bullCandles >= 2) momentum = 'UP';
            else if (bullCandles <= 1) momentum = 'DOWN';
        }

        return {
            trend,
            trendStrength,
            momentum,
            price: last,
            ema9, ema21, ema50,
            rsi,
            macd: macdData,
            support, resistance,
            reasons
        };
    },

    /**
     * Calculate alignment across timeframes
     */
    _calculateAlignment(analyses) {
        const { current, higher, lower } = analyses;

        let score = 0;      // -100 to 100
        let direction = 'NEUTRAL';
        const details = [];

        // Higher TF trend is most important (weight: 45%)
        if (higher) {
            if (higher.trend === 'BULLISH') {
                score += 45;
                details.push(`${higher.label} tendencia alcista (${higher.trendStrength > 0 ? '+' : ''}${higher.trendStrength})`);
            } else if (higher.trend === 'BEARISH') {
                score -= 45;
                details.push(`${higher.label} tendencia bajista (${higher.trendStrength})`);
            } else {
                details.push(`${higher.label} sin tendencia clara`);
            }
        }

        // Current TF (weight: 35%)
        if (current) {
            const w = 35;
            if (current.trend === 'BULLISH') {
                score += w;
                details.push(`${current.label} alcista (${current.trendStrength > 0 ? '+' : ''}${current.trendStrength})`);
            } else if (current.trend === 'BEARISH') {
                score -= w;
                details.push(`${current.label} bajista (${current.trendStrength})`);
            } else {
                details.push(`${current.label} lateral`);
            }
        }

        // Lower TF momentum for timing (weight: 20%)
        if (lower) {
            const w = 20;
            if (lower.momentum === 'UP' && lower.trend === 'BULLISH') {
                score += w;
                details.push(`${lower.label} momentum alcista`);
            } else if (lower.momentum === 'DOWN' && lower.trend === 'BEARISH') {
                score -= w;
                details.push(`${lower.label} momentum bajista`);
            } else if (lower.momentum === 'UP') {
                score += w * 0.5;
                details.push(`${lower.label} momentum mixto (arriba)`);
            } else if (lower.momentum === 'DOWN') {
                score -= w * 0.5;
                details.push(`${lower.label} momentum mixto (abajo)`);
            } else {
                details.push(`${lower.label} sin momentum`);
            }
        }

        // Alignment bonus: all TFs agree
        const trends = [higher?.trend, current?.trend, lower?.trend].filter(Boolean);
        const allBull = trends.every(t => t === 'BULLISH');
        const allBear = trends.every(t => t === 'BEARISH');

        if (allBull) {
            score = Math.min(100, score + 15);
            details.push('✅ Alineación total alcista');
        } else if (allBear) {
            score = Math.max(-100, score - 15);
            details.push('✅ Alineación total bajista');
        }

        // Conflict penalty: higher vs current disagree
        if (higher && current) {
            if ((higher.trend === 'BULLISH' && current.trend === 'BEARISH') ||
                (higher.trend === 'BEARISH' && current.trend === 'BULLISH')) {
                score *= 0.5; // Halve conviction
                details.push('⚠️ Conflicto entre TFs');
            }
        }

        score = Math.max(-100, Math.min(100, Math.round(score)));

        if (score > 20) direction = 'LONG';
        else if (score < -20) direction = 'SHORT';
        else direction = 'NEUTRAL';

        // Confidence
        const confidence = Math.abs(score);
        let quality;
        if (confidence >= 70) quality = 'FUERTE';
        else if (confidence >= 40) quality = 'MODERADA';
        else quality = 'DÉBIL';

        return { score, direction, confidence, quality, details };
    },

    /**
     * Build human-readable summary
     */
    _buildSummary(analyses, alignment) {
        const { higher, current, lower } = analyses;
        const parts = [];

        if (higher) {
            parts.push(`📊 ${higher.label}: ${this._trendIcon(higher.trend)} ${higher.trend} (fuerza ${higher.trendStrength})`);
        }

        if (current) {
            parts.push(`📈 ${current.label}: ${this._trendIcon(current.trend)} ${current.trend} | RSI ${current.rsi?.toFixed(0) || '—'}`);
        }

        if (lower) {
            parts.push(`⚡ ${lower.label}: Momentum ${lower.momentum} | RSI ${lower.rsi?.toFixed(0) || '—'}`);
        }

        parts.push(`🎯 Alineación: ${alignment.direction} (${alignment.quality}, score ${alignment.score})`);

        return parts.join('\n');
    },

    _trendIcon(trend) {
        if (trend === 'BULLISH') return '🟢';
        if (trend === 'BEARISH') return '🔴';
        return '🟡';
    },

    /**
     * Render HTML for analysis panel
     */
    renderHTML(result) {
        if (!result) return '';

        const { timeframes, alignment } = result;
        const { higher, current, lower } = timeframes;

        // Alignment bar color
        const alignColor = alignment.score > 20 ? '#22c55e' :
                           alignment.score < -20 ? '#ef4444' : '#eab308';
        const alignDir = alignment.direction === 'LONG' ? 'ALCISTA' :
                         alignment.direction === 'SHORT' ? 'BAJISTA' : 'NEUTRAL';
        const barLeft = ((alignment.score + 100) / 200) * 100;

        let html = `
            <div class="mtf-section">
                <div class="mtf-header">
                    <span class="mtf-title">🔀 Multi-Timeframe</span>
                    <span class="mtf-alignment" style="color:${alignColor}">${alignDir} · ${alignment.quality}</span>
                </div>

                <!-- Alignment gauge -->
                <div class="mtf-gauge">
                    <div class="mtf-gauge-labels">
                        <span style="color:#ef4444">BEAR</span>
                        <span style="color:#eab308">NEUTRAL</span>
                        <span style="color:#22c55e">BULL</span>
                    </div>
                    <div class="mtf-gauge-track">
                        <div class="mtf-gauge-center"></div>
                        <div class="mtf-gauge-needle" style="left:${barLeft}%; background:${alignColor}"></div>
                    </div>
                    <div class="mtf-gauge-score" style="color:${alignColor}">${alignment.score > 0 ? '+' : ''}${alignment.score}</div>
                </div>

                <!-- TF Cards -->
                <div class="mtf-cards">
        `;

        // Render each TF card
        const tfOrder = [higher, current, lower].filter(Boolean);
        for (const tf of tfOrder) {
            const roleLabel = tf.role === 'higher' ? '📊 Tendencia' :
                              tf.role === 'current' ? '📈 Entrada' : '⚡ Timing';
            const trendColor = tf.trend === 'BULLISH' ? '#22c55e' :
                               tf.trend === 'BEARISH' ? '#ef4444' : '#eab308';
            const momColor = tf.momentum === 'UP' ? '#22c55e' :
                             tf.momentum === 'DOWN' ? '#ef4444' : '#888';

            // Strength bar (0-100 scale, centered)
            const strengthPct = ((tf.trendStrength + 100) / 200) * 100;

            html += `
                <div class="mtf-card">
                    <div class="mtf-card-header">
                        <span class="mtf-card-role">${roleLabel}</span>
                        <span class="mtf-card-tf">${tf.label}</span>
                    </div>
                    <div class="mtf-card-trend" style="color:${trendColor}">
                        ${this._trendIcon(tf.trend)} ${tf.trend}
                    </div>
                    <div class="mtf-card-bar">
                        <div class="mtf-card-bar-track">
                            <div class="mtf-card-bar-center"></div>
                            <div class="mtf-card-bar-fill" style="left:${Math.min(50, strengthPct)}%; width:${Math.abs(strengthPct - 50)}%; background:${trendColor}"></div>
                        </div>
                    </div>
                    <div class="mtf-card-details">
                        <span>RSI <b style="color:${tf.rsi > 70 ? '#ef4444' : tf.rsi < 30 ? '#22c55e' : '#ccc'}">${tf.rsi?.toFixed(0) || '—'}</b></span>
                        <span>Mom <b style="color:${momColor}">${tf.momentum}</b></span>
                        <span>EMA ${tf.ema9 > tf.ema21 ? '<b style="color:#22c55e">Bull</b>' : '<b style="color:#ef4444">Bear</b>'}</span>
                    </div>
                    ${tf.reasons.length > 0 ? `
                        <div class="mtf-card-reasons">
                            ${tf.reasons.slice(0, 3).join(' · ')}
                        </div>
                    ` : ''}
                </div>
            `;
        }

        html += `</div>`; // close mtf-cards

        // Alignment details
        if (alignment.details.length > 0) {
            html += `
                <div class="mtf-details">
                    ${alignment.details.map(d => `<div class="mtf-detail-item">${d}</div>`).join('')}
                </div>
            `;
        }

        html += `</div>`; // close mtf-section

        return html;
    }
};
