/* ========================================
   SIGNAL PIPELINE — Unified Decision Brain
   TheRealShortShady v4.2.0
   
   Centraliza TODA la lógica de análisis:
   1. Analiza ambas direcciones (LONG + SHORT)
   2. Normaliza señales de bots
   3. Aplica SmartEngine anti flip-flop
   4. Filtra por régimen de mercado
   5. Metadata para transparencia total
   ======================================== */


const SignalPipeline = {

    _cache: {},       // Cache de resultados recientes
    _CACHE_TTL: 25000, // 25 segundos de vida del cache (prevents redundant API calls)

    /** Normaliza cualquier formato de señal a green/red/yellow/neutral */
    normalize(signal) {
        if (!signal) return 'neutral';
        const s = String(signal).toLowerCase().trim();
        if (['green', 'go', 'bullish', 'lean_bull', 'enter'].includes(s)) return 'green';
        if (['red', 'stop', 'bearish', 'lean_bear'].includes(s)) return 'red';
        if (['yellow', 'wait', 'neutral', 'caution'].includes(s)) return 'yellow';
        return 'neutral';
    },

    /** Análisis maestro: analiza ambas direcciones y retorna decisión unificada */
    async analyze(symbol, options = {}) {
        const { leverage, timeframe, temperature = 'normal' } = options;
        const cacheKey = `${symbol}_${leverage}_${timeframe}`;

        // Check cache — si el mismo symbol fue analizado hace menos de 12s, reusar
        const cached = this._cache[cacheKey];
        if (cached && (Date.now() - cached.time) < this._CACHE_TTL) {
            console.log(`⚡ ${symbol}: usando cache (${((Date.now() - cached.time) / 1000).toFixed(1)}s ago)`);
            return JSON.parse(JSON.stringify(cached.result)); // Deep copy
        }
        const startTime = Date.now();

        try {
            // PASO 1: Analizar ambas direcciones via API backend
            const [longR, shortR] = await Promise.all([
                API.analyze(symbol, 'LONG', leverage, timeframe),
                API.analyze(symbol, 'SHORT', leverage, timeframe)
            ]);

            let result = this._pickBestDirection(longR, shortR, symbol);
            if (!result) {
                EventFeed.log('pipeline', '⚫', `${symbol}: Sin señal en ninguna dirección`);
                return null;
            }

            // PASO 2: Normalizar señales de bots
            if (result.bots && result.bots.length > 0) {
                result.bots = result.bots.map(b => ({
                    ...b,
                    _originalSignal: b.signal,
                    signal: this.normalize(b.signal)
                }));
            }

            // PASO 3: SmartEngine anti flip-flop filter
            let smartFiltered = false;
            if (typeof SmartEngine !== 'undefined') {
                const override = SmartEngine.shouldOverrideAnalysis(symbol, result);
                if (override) {
                    result = override;
                    smartFiltered = true;
                }
                SmartEngine.recordAnalysis(symbol, result);
            }

            // PASO 4: Calcular alignment (para metadata)
            const greenBots = (result.bots || []).filter(b => b.signal === 'green' || b.vote === 'ENTER' || b.vote === 'GO').length;
            const totalBots = (result.bots || []).length;
            const alignment = totalBots > 0 ? greenBots / totalBots : 0;

            // PASO 5: Market regime info (no bloquea aquí, eso lo hace _evaluateBotEntry)
            let regime = null;
            if (typeof Intelligence !== 'undefined') {
                regime = Intelligence.getMarketScore();
            }

            // PASO 6: Metadata para transparencia total
            result._pipeline = {
                analyzedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
                longDecision: longR?.decision || 'NULL',
                longConf: longR?.confidence || 0,
                shortDecision: shortR?.decision || 'NULL',
                shortConf: shortR?.confidence || 0,
                chosenDirection: result.direction,
                smartEngineFiltered: smartFiltered,
                alignment: alignment,
                greenBots: greenBots,
                totalBots: totalBots,
                regime: regime?.regime || 'unknown',
                regimeScore: regime?.score || 0,
            };

            // Log al EventFeed
            const icon = result.decision === 'ENTER' ? '🟢' : result.decision === 'WAIT' ? '🟡' : '🔴';
            EventFeed.log('pipeline', icon,
                `${symbol}: ${result.decision} ${result.direction || '?'} ` +
                `(${result.confidence || 0}% · ${greenBots}/${totalBots} bots · ${(alignment * 100).toFixed(0)}% align)` +
                (smartFiltered ? ' [SmartEngine filtered]' : ''),
                { result, pipeline: result._pipeline }
            );

            // Guardar en cache
            this._cache[cacheKey] = { result, time: Date.now() };

            return result;

        } catch (e) {
            console.error(`SignalPipeline.analyze ${symbol}:`, e);
            EventFeed.log('error', '❌', `Pipeline ${symbol}: ${e.message}`);
            // Fallback: intentar solo LONG
            try { return await API.analyze(symbol, 'LONG', leverage, timeframe); }
            catch (e2) { return null; }
        }
    },

    /** Elige la mejor dirección entre LONG y SHORT */
    _pickBestDirection(longR, shortR, symbol) {
        if (!longR && !shortR) return null;
        if (!longR) return shortR;
        if (!shortR) return longR;

        // ENTER vale 100 puntos + confidence
        const lScore = (longR.decision === 'ENTER' ? 100 : 0) + (longR.confidence || 0);
        const sScore = (shortR.decision === 'ENTER' ? 100 : 0) + (shortR.confidence || 0);

        const best = lScore >= sScore ? longR : shortR;

        console.log(`🔄 ${symbol}: LONG ${longR.decision}(${longR.confidence}%) vs SHORT ${shortR.decision}(${shortR.confidence}%) → ${best.direction}`);

        return best;
    },

};
