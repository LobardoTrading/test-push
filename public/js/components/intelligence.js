/* ========================================
   INTELLIGENCE — Phase 4
   Correlations, Patterns, Market Score
   TheRealShortShady v4.0
   ======================================== */

const Intelligence = {

    _marketScore: null,
    _correlations: {},
    _patterns: {},
    _lastUpdate: null,
    _updating: false,

    // === MARKET SCORE ===

    async updateMarketScore() {
        if (this._updating) return this._marketScore;
        this._updating = true;

        try {
            const symbols = Object.keys(CONFIG.TOKENS);
            const changes = [];
            const volumes = [];

            for (const symbol of symbols) {
                const data = State.prices[symbol];
                if (!data) continue;
                changes.push({
                    symbol,
                    change: data.change || 0,
                    volume: data.volume || 0,
                    price: data.price || 0
                });
            }

            if (changes.length === 0) {
                this._updating = false;
                return this._marketScore;
            }

            // BTC weight is 3x
            const btcData = changes.find(c => c.symbol === 'BTC');
            const btcChange = btcData ? btcData.change : 0;

            // Calculate weighted sentiment
            const bullish = changes.filter(c => c.change > 0.5);
            const bearish = changes.filter(c => c.change < -0.5);
            const neutral = changes.filter(c => Math.abs(c.change) <= 0.5);

            const avgChange = changes.reduce((s, c) => s + c.change, 0) / changes.length;

            // Score -100 (extreme fear) to +100 (extreme greed)
            let score = 0;
            score += avgChange * 10;  // Average market change weight
            score += btcChange * 5;   // BTC extra weight
            score += (bullish.length - bearish.length) * 3; // Breadth

            // Clamp
            score = Math.max(-100, Math.min(100, Math.round(score)));

            // Determine regime
            let regime, emoji, color;
            if (score >= 50) { regime = 'EXTREME GREED'; emoji = '🟢🟢'; color = '#10b981'; }
            else if (score >= 20) { regime = 'ALCISTA'; emoji = '🟢'; color = '#10b981'; }
            else if (score >= -20) { regime = 'NEUTRAL'; emoji = '🟡'; color = '#00d4ff'; }
            else if (score >= -50) { regime = 'BAJISTA'; emoji = '🔴'; color = '#f43f5e'; }
            else { regime = 'EXTREME FEAR'; emoji = '🔴🔴'; color = '#f43f5e'; }

            // Top movers
            const sorted = [...changes].sort((a, b) => b.change - a.change);
            const topGainers = sorted.slice(0, 3);
            const topLosers = sorted.slice(-3).reverse();

            this._marketScore = {
                score,
                regime,
                emoji,
                color,
                bullishCount: bullish.length,
                bearishCount: bearish.length,
                neutralCount: neutral.length,
                avgChange: avgChange.toFixed(2),
                btcChange: btcChange.toFixed(2),
                topGainers,
                topLosers,
                totalPairs: changes.length,
                updatedAt: new Date().toISOString()
            };

            this._lastUpdate = Date.now();
        } catch (e) {
            console.error('Intelligence updateMarketScore error:', e);
        }

        this._updating = false;
        return this._marketScore;
    },

    getMarketScore() {
        return this._marketScore;
    },

    // === CORRELATIONS ===

    updateCorrelations() {
        try {
            const symbols = Object.keys(CONFIG.TOKENS);
            const btcData = State.prices['BTC'];
            if (!btcData) return;

            const btcChange = btcData.change || 0;
            const correlations = {};

            for (const symbol of symbols) {
                if (symbol === 'BTC') continue;
                const data = State.prices[symbol];
                if (!data) continue;

                const change = data.change || 0;

                // Simple correlation: how closely does this follow BTC?
                const diff = Math.abs(change - btcChange);
                let correlation;
                if (diff < 1) correlation = 'alta';
                else if (diff < 3) correlation = 'media';
                else correlation = 'baja';

                // Direction alignment
                const aligned = (change > 0 && btcChange > 0) || (change < 0 && btcChange < 0);

                // Relative strength: outperforming or underperforming BTC
                const relStrength = change - btcChange;
                let strength;
                if (relStrength > 2) strength = 'outperform';
                else if (relStrength < -2) strength = 'underperform';
                else strength = 'neutral';

                // Sector info
                const token = CONFIG.TOKENS[symbol];
                const sector = token ? (token.sector || token.category || '--') : '--';

                correlations[symbol] = {
                    symbol,
                    change: change.toFixed(2),
                    btcCorrelation: correlation,
                    aligned,
                    relativeStrength: relStrength.toFixed(2),
                    strengthLabel: strength,
                    sector,
                    updatedAt: Date.now()
                };
            }

            this._correlations = correlations;
        } catch (e) {
            console.error('Intelligence updateCorrelations error:', e);
        }
    },

    getCorrelation(symbol) {
        return this._correlations[symbol] || null;
    },

    getAllCorrelations() {
        return this._correlations;
    },

    // === PATTERN DETECTION ===

    detectPatterns(candles) {
        if (!candles || candles.length < 20) return [];

        const patterns = [];
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const volumes = candles.map(c => c.volume);

        // Double Top
        const dt = this._detectDoubleTop(highs, closes);
        if (dt) patterns.push(dt);

        // Double Bottom
        const db = this._detectDoubleBottom(lows, closes);
        if (db) patterns.push(db);

        // Head and Shoulders
        const hs = this._detectHeadShoulders(highs, closes);
        if (hs) patterns.push(hs);

        // Bull Flag
        const bf = this._detectBullFlag(closes, volumes);
        if (bf) patterns.push(bf);

        // Bear Flag
        const bearf = this._detectBearFlag(closes, volumes);
        if (bearf) patterns.push(bearf);

        // Support/Resistance levels
        const sr = this._findSupportResistance(highs, lows, closes);
        if (sr) patterns.push(sr);

        // Volume divergence
        const vd = this._detectVolumeDivergence(closes, volumes);
        if (vd) patterns.push(vd);

        // Breakout detection
        const bo = this._detectBreakout(closes, highs, lows, volumes);
        if (bo) patterns.push(bo);

        return patterns;
    },

    _detectDoubleTop(highs, closes) {
        const len = highs.length;
        if (len < 20) return null;

        const recent = highs.slice(-20);
        let peak1 = -1, peak1Idx = -1;
        let peak2 = -1, peak2Idx = -1;

        // Find two peaks
        for (let i = 2; i < recent.length - 2; i++) {
            if (recent[i] > recent[i-1] && recent[i] > recent[i-2] &&
                recent[i] > recent[i+1] && recent[i] > recent[i+2]) {
                if (peak1 === -1) { peak1 = recent[i]; peak1Idx = i; }
                else if (i - peak1Idx >= 3) { peak2 = recent[i]; peak2Idx = i; }
            }
        }

        if (peak1 > 0 && peak2 > 0) {
            const tolerance = peak1 * 0.02;
            if (Math.abs(peak1 - peak2) < tolerance && peak2Idx > peak1Idx + 3) {
                return {
                    name: 'Doble Techo',
                    emoji: '🔻',
                    type: 'bearish',
                    reliability: 'alta',
                    description: `Doble techo detectado en ~$${Utils.formatPrice(peak1)}`,
                    level: peak1
                };
            }
        }
        return null;
    },

    _detectDoubleBottom(lows, closes) {
        const len = lows.length;
        if (len < 20) return null;

        const recent = lows.slice(-20);
        let valley1 = Infinity, valley1Idx = -1;
        let valley2 = Infinity, valley2Idx = -1;

        for (let i = 2; i < recent.length - 2; i++) {
            if (recent[i] < recent[i-1] && recent[i] < recent[i-2] &&
                recent[i] < recent[i+1] && recent[i] < recent[i+2]) {
                if (valley1 === Infinity) { valley1 = recent[i]; valley1Idx = i; }
                else if (i - valley1Idx >= 3) { valley2 = recent[i]; valley2Idx = i; }
            }
        }

        if (valley1 < Infinity && valley2 < Infinity) {
            const tolerance = valley1 * 0.02;
            if (Math.abs(valley1 - valley2) < tolerance && valley2Idx > valley1Idx + 3) {
                return {
                    name: 'Doble Piso',
                    emoji: '🔺',
                    type: 'bullish',
                    reliability: 'alta',
                    description: `Doble piso detectado en ~$${Utils.formatPrice(valley1)}`,
                    level: valley1
                };
            }
        }
        return null;
    },

    _detectHeadShoulders(highs, closes) {
        const len = highs.length;
        if (len < 30) return null;

        const recent = highs.slice(-30);
        const peaks = [];

        for (let i = 2; i < recent.length - 2; i++) {
            if (recent[i] > recent[i-1] && recent[i] > recent[i-2] &&
                recent[i] > recent[i+1] && recent[i] > recent[i+2]) {
                peaks.push({ price: recent[i], idx: i });
            }
        }

        if (peaks.length >= 3) {
            const last3 = peaks.slice(-3);
            const [left, head, right] = last3;

            // Head should be highest, shoulders roughly equal
            if (head.price > left.price && head.price > right.price) {
                const shoulderTolerance = left.price * 0.03;
                if (Math.abs(left.price - right.price) < shoulderTolerance) {
                    return {
                        name: 'Hombro-Cabeza-Hombro',
                        emoji: '⛰️',
                        type: 'bearish',
                        reliability: 'muy alta',
                        description: `H-C-H: cabeza $${Utils.formatPrice(head.price)}, hombros ~$${Utils.formatPrice(left.price)}`,
                        level: head.price
                    };
                }
            }
        }
        return null;
    },

    _detectBullFlag(closes, volumes) {
        const len = closes.length;
        if (len < 15) return null;

        const recent = closes.slice(-15);

        // Strong move up (pole): first 5 candles
        const poleStart = recent[0];
        const poleEnd = recent[4];
        const poleChange = ((poleEnd - poleStart) / poleStart) * 100;

        if (poleChange < 3) return null; // Need >3% move for pole

        // Consolidation (flag): last 10 candles, small range
        const flag = recent.slice(5);
        const flagHigh = Math.max(...flag);
        const flagLow = Math.min(...flag);
        const flagRange = ((flagHigh - flagLow) / flagLow) * 100;

        if (flagRange < 3 && flagRange > 0.3) {
            // Slight downward drift is ideal
            const flagDrift = ((flag[flag.length-1] - flag[0]) / flag[0]) * 100;
            if (flagDrift < 1 && flagDrift > -3) {
                return {
                    name: 'Bull Flag',
                    emoji: '🏁',
                    type: 'bullish',
                    reliability: 'alta',
                    description: `Bull flag: subida ${poleChange.toFixed(1)}% + consolidación ${flagRange.toFixed(1)}%`,
                    level: flagHigh
                };
            }
        }
        return null;
    },

    _detectBearFlag(closes, volumes) {
        const len = closes.length;
        if (len < 15) return null;

        const recent = closes.slice(-15);
        const poleStart = recent[0];
        const poleEnd = recent[4];
        const poleChange = ((poleEnd - poleStart) / poleStart) * 100;

        if (poleChange > -3) return null;

        const flag = recent.slice(5);
        const flagHigh = Math.max(...flag);
        const flagLow = Math.min(...flag);
        const flagRange = ((flagHigh - flagLow) / flagLow) * 100;

        if (flagRange < 3 && flagRange > 0.3) {
            const flagDrift = ((flag[flag.length-1] - flag[0]) / flag[0]) * 100;
            if (flagDrift > -1 && flagDrift < 3) {
                return {
                    name: 'Bear Flag',
                    emoji: '🚩',
                    type: 'bearish',
                    reliability: 'alta',
                    description: `Bear flag: caída ${Math.abs(poleChange).toFixed(1)}% + consolidación ${flagRange.toFixed(1)}%`,
                    level: flagLow
                };
            }
        }
        return null;
    },

    _findSupportResistance(highs, lows, closes) {
        if (closes.length < 20) return null;

        const recent = closes.slice(-30);
        const recentHighs = highs.slice(-30);
        const recentLows = lows.slice(-30);
        const currentPrice = recent[recent.length - 1];

        // Find resistance: cluster of highs above current price
        const aboveLevels = recentHighs.filter(h => h > currentPrice);
        const belowLevels = recentLows.filter(l => l < currentPrice);

        let resistance = null, support = null;

        if (aboveLevels.length > 0) {
            // Sort and find most common area
            aboveLevels.sort((a, b) => a - b);
            resistance = aboveLevels[Math.floor(aboveLevels.length * 0.3)];
        }

        if (belowLevels.length > 0) {
            belowLevels.sort((a, b) => b - a);
            support = belowLevels[Math.floor(belowLevels.length * 0.3)];
        }

        if (resistance && support) {
            const distToRes = ((resistance - currentPrice) / currentPrice * 100).toFixed(2);
            const distToSup = ((currentPrice - support) / currentPrice * 100).toFixed(2);

            return {
                name: 'Soportes & Resistencias',
                emoji: '📊',
                type: 'neutral',
                reliability: 'media',
                description: `R: $${Utils.formatPrice(resistance)} (+${distToRes}%) · S: $${Utils.formatPrice(support)} (-${distToSup}%)`,
                resistance,
                support,
                level: currentPrice
            };
        }
        return null;
    },

    _detectVolumeDivergence(closes, volumes) {
        if (closes.length < 10) return null;

        const recentCloses = closes.slice(-10);
        const recentVols = volumes.slice(-10);

        const priceUp = recentCloses[recentCloses.length - 1] > recentCloses[0];
        const avgVolFirst = recentVols.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
        const avgVolLast = recentVols.slice(5).reduce((s, v) => s + v, 0) / 5;
        const volDecreasing = avgVolLast < avgVolFirst * 0.7;

        if (priceUp && volDecreasing) {
            return {
                name: 'Divergencia Volumen',
                emoji: '⚠️',
                type: 'bearish',
                reliability: 'media',
                description: 'Precio sube pero volumen cae — posible agotamiento',
                level: null
            };
        }

        if (!priceUp && volDecreasing) {
            return {
                name: 'Divergencia Volumen',
                emoji: '⚠️',
                type: 'bullish',
                reliability: 'media',
                description: 'Precio baja pero volumen cae — posible piso',
                level: null
            };
        }

        return null;
    },

    _detectBreakout(closes, highs, lows, volumes) {
        if (closes.length < 20) return null;

        const consolidation = closes.slice(-20, -1);
        const currentPrice = closes[closes.length - 1];
        const currentVol = volumes[volumes.length - 1];

        const rangeHigh = Math.max(...consolidation);
        const rangeLow = Math.min(...consolidation);
        const avgVol = volumes.slice(-20, -1).reduce((s, v) => s + v, 0) / 19;

        const highVolume = currentVol > avgVol * 1.5;

        if (currentPrice > rangeHigh && highVolume) {
            return {
                name: 'Breakout Alcista',
                emoji: '🚀',
                type: 'bullish',
                reliability: 'alta',
                description: `Rompió resistencia $${Utils.formatPrice(rangeHigh)} con volumen ${(currentVol/avgVol).toFixed(1)}x`,
                level: rangeHigh
            };
        }

        if (currentPrice < rangeLow && highVolume) {
            return {
                name: 'Breakdown Bajista',
                emoji: '💥',
                type: 'bearish',
                reliability: 'alta',
                description: `Rompió soporte $${Utils.formatPrice(rangeLow)} con volumen ${(currentVol/avgVol).toFixed(1)}x`,
                level: rangeLow
            };
        }

        return null;
    },

    // === INTELLIGENCE SUMMARY FOR BOTS & ANALYSIS ===

    async getIntelligence(symbol, candles) {
        // Update market score if stale (>30s)
        if (!this._lastUpdate || Date.now() - this._lastUpdate > 30000) {
            await this.updateMarketScore();
            this.updateCorrelations();
        }

        const result = {
            marketScore: this._marketScore,
            correlation: this._correlations[symbol] || null,
            patterns: candles ? this.detectPatterns(candles) : [],
            recommendation: null
        };

        // Generate recommendation based on all intelligence
        result.recommendation = this._generateRecommendation(symbol, result);

        return result;
    },

    _generateRecommendation(symbol, intel) {
        let bullPoints = 0;
        let bearPoints = 0;
        const reasons = [];

        // Market score influence
        if (intel.marketScore) {
            if (intel.marketScore.score > 20) { bullPoints += 2; reasons.push('Mercado alcista'); }
            else if (intel.marketScore.score < -20) { bearPoints += 2; reasons.push('Mercado bajista'); }
        }

        // Correlation influence
        if (intel.correlation) {
            if (intel.correlation.strengthLabel === 'outperform') {
                bullPoints += 1;
                reasons.push(`${symbol} outperforming BTC`);
            } else if (intel.correlation.strengthLabel === 'underperform') {
                bearPoints += 1;
                reasons.push(`${symbol} underperforming BTC`);
            }
        }

        // Pattern influence
        for (const pattern of intel.patterns) {
            if (pattern.type === 'bullish') {
                const pts = pattern.reliability === 'muy alta' ? 3 : pattern.reliability === 'alta' ? 2 : 1;
                bullPoints += pts;
                reasons.push(`${pattern.emoji} ${pattern.name}`);
            } else if (pattern.type === 'bearish') {
                const pts = pattern.reliability === 'muy alta' ? 3 : pattern.reliability === 'alta' ? 2 : 1;
                bearPoints += pts;
                reasons.push(`${pattern.emoji} ${pattern.name}`);
            }
        }

        const total = bullPoints + bearPoints;
        let bias, confidence, biasColor;

        if (total === 0) {
            bias = 'NEUTRAL';
            confidence = 0;
            biasColor = '#00d4ff';
        } else if (bullPoints > bearPoints) {
            bias = 'BULLISH';
            confidence = Math.min(100, Math.round((bullPoints / total) * 100));
            biasColor = '#10b981';
        } else {
            bias = 'BEARISH';
            confidence = Math.min(100, Math.round((bearPoints / total) * 100));
            biasColor = '#f43f5e';
        }

        return { bias, confidence, biasColor, bullPoints, bearPoints, reasons };
    },

    // === RENDER HELPERS ===

    renderMarketScoreHTML() {
        const ms = this._marketScore;
        if (!ms) return '<div class="intel-loading">Calculando...</div>';

        return `
            <div class="intel-market-score">
                <div class="intel-score-main">
                    <div class="intel-score-number" style="color:${ms.color}">${ms.score > 0 ? '+' : ''}${ms.score}</div>
                    <div class="intel-score-label" style="color:${ms.color}">${ms.emoji} ${ms.regime}</div>
                </div>
                <div class="intel-score-details">
                    <span>🟢 ${ms.bullishCount} alcistas</span>
                    <span>🔴 ${ms.bearishCount} bajistas</span>
                    <span>🟡 ${ms.neutralCount} neutral</span>
                    <span>BTC: ${ms.btcChange > 0 ? '+' : ''}${ms.btcChange}%</span>
                </div>
                <div class="intel-movers">
                    <div class="intel-movers-group">
                        <span class="intel-movers-title">Top 🚀</span>
                        ${ms.topGainers.map(g => `<span class="intel-mover green">${g.symbol} +${g.change.toFixed(1)}%</span>`).join('')}
                    </div>
                    <div class="intel-movers-group">
                        <span class="intel-movers-title">Top 💥</span>
                        ${ms.topLosers.map(l => `<span class="intel-mover red">${l.symbol} ${l.change.toFixed(1)}%</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    },

    renderPatternsHTML(patterns) {
        if (!patterns || patterns.length === 0) return '';

        return `
            <div class="intel-patterns">
                <div class="intel-section-title">Patrones Detectados</div>
                ${patterns.map(p => `
                    <div class="intel-pattern ${p.type}">
                        <span class="intel-pattern-emoji">${p.emoji}</span>
                        <div class="intel-pattern-body">
                            <div class="intel-pattern-name">${p.name} <span class="intel-pattern-rel">(${p.reliability})</span></div>
                            <div class="intel-pattern-desc">${p.description}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderCorrelationHTML(symbol) {
        const corr = this._correlations[symbol];
        if (!corr) return '';

        const alignIcon = corr.aligned ? '↗️' : '↘️';
        const strengthColor = corr.strengthLabel === 'outperform' ? 'var(--green)' : corr.strengthLabel === 'underperform' ? 'var(--red)' : 'var(--dim)';

        return `
            <div class="intel-correlation">
                <div class="intel-section-title">Correlación con BTC</div>
                <div class="intel-corr-grid">
                    <span>Correlación: <b>${corr.btcCorrelation}</b></span>
                    <span>${alignIcon} ${corr.aligned ? 'Alineado' : 'Divergente'}</span>
                    <span style="color:${strengthColor}">RS: ${corr.relativeStrength > 0 ? '+' : ''}${corr.relativeStrength}%</span>
                    <span>Sector: ${corr.sector}</span>
                </div>
            </div>
        `;
    }
};
