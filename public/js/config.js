/* ========================================
   CONFIG - Application Configuration
   Trading Platform PRO v3.0
   ======================================== */

const CONFIG = {

    // App Info
    APP_NAME: 'TheRealShortShady',
    VERSION: '4.2.0',

    // API Endpoints
    API: {
        PRICES: '/api/prices',
        KLINES: '/api/klines',
        ANALYZE: '/api/analyze',
    },

    // Refresh Intervals (ms) - defaults, usuario puede cambiar
    INTERVALS: {
        PRICES: 5000,
        CANDLES: 10000,
    },

    // Opciones de refresh disponibles para el usuario
    REFRESH_OPTIONS: [
        { label: '1s',    prices: 1000,    candles: 2000    },
        { label: '2s',    prices: 2000,    candles: 4000    },
        { label: '5s',    prices: 5000,    candles: 10000   },
        { label: '10s',   prices: 10000,   candles: 15000   },
        { label: '30s',   prices: 30000,   candles: 30000   },
        { label: '1m',    prices: 60000,   candles: 60000   },
        { label: '5m',    prices: 300000,  candles: 300000  },
        { label: '15m',   prices: 900000,  candles: 900000  },
        { label: '1h',    prices: 3600000, candles: 3600000 },
    ],

    // Trading
    TRADING: {
        MAX_POSITIONS: 3,
        DEFAULT_BALANCE: 10000,
        FEE_RATE: 0.0004,
        MAX_LEVERAGE: 125,
        MIN_MARGIN: 5,
        MAX_FEE_RATIO: 0.1,
    },

    // Tokens (POL reemplaza MATIC desde sept 2023)
    TOKENS: {
        BTC:  { name: 'Bitcoin',      grade: 'A', sector: 'Store of Value',     maxLev: 125 },
        ETH:  { name: 'Ethereum',     grade: 'A', sector: 'Smart Contracts',    maxLev: 100 },
        BNB:  { name: 'BNB',          grade: 'A', sector: 'Exchange',           maxLev: 75 },
        SOL:  { name: 'Solana',       grade: 'A', sector: 'Smart Contracts',    maxLev: 75 },
        XRP:  { name: 'XRP',          grade: 'A', sector: 'Payments',           maxLev: 75 },
        ADA:  { name: 'Cardano',      grade: 'A', sector: 'Smart Contracts',    maxLev: 75 },
        DOGE: { name: 'Dogecoin',     grade: 'A', sector: 'Meme',              maxLev: 75 },
        AVAX: { name: 'Avalanche',    grade: 'A', sector: 'Smart Contracts',    maxLev: 75 },
        DOT:  { name: 'Polkadot',     grade: 'A', sector: 'Interoperability',   maxLev: 75 },
        LINK: { name: 'Chainlink',    grade: 'A', sector: 'Oracle',             maxLev: 75 },
        POL:  { name: 'Polygon',      grade: 'A', sector: 'Layer 2',            maxLev: 75 },
        LTC:  { name: 'Litecoin',     grade: 'A', sector: 'Payments',           maxLev: 75 },
        ARB:  { name: 'Arbitrum',     grade: 'B', sector: 'Layer 2',            maxLev: 50 },
        OP:   { name: 'Optimism',     grade: 'B', sector: 'Layer 2',            maxLev: 50 },
        INJ:  { name: 'Injective',    grade: 'B', sector: 'DeFi',              maxLev: 50 },
    },

    // Trading Modes (R:R corregido para ser >= 1.5:1)
    MODES: {
        scalping: { name: 'Scalping',  tf: '1m',  lev: 50, risk: 1, tp: 1.2, sl: 0.6, desc: 'Entradas rápidas, 1-5 min' },
        intraday: { name: 'Intraday',  tf: '15m', lev: 35, risk: 2, tp: 2.5, sl: 1.2, desc: 'Operaciones de horas' },
        swing:    { name: 'Swing',     tf: '1h',  lev: 20, risk: 2, tp: 4.0, sl: 2.0, desc: 'Operaciones de días' },
        position: { name: 'Position',  tf: '1d',  lev: 10, risk: 3, tp: 6.0, sl: 3.0, desc: 'Operaciones de semanas' },
    },

    // Timeframes disponibles
    TIMEFRAMES: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'],

    // Colors (tema oscuro trading)
    COLORS: {
        bg: '#06060a',
        panel: '#0c0c14',
        card: '#111119',
        border: '#1a1a24',
        text: '#e8e6e3',
        muted: '#666666',
        blue: '#5ebbff',
        green: '#10b981',
        red: '#f43f5e',
        yellow: '#f0c648',
        orange: '#f09848',
        purple: '#b07aff',
    },

    // Local Storage Keys
    STORAGE: {
        BALANCE: 'tp_balance',
        POSITIONS: 'tp_positions',
        SETTINGS: 'tp_settings',
        HISTORY: 'tp_history',
        REFRESH: 'tp_refresh',
    },

    // Chart defaults
    CHART: {
        MAX_CANDLES: 200,
        DEFAULT_CANDLES: 80,
        CANDLE_SPACING: 2,
        COLORS: {
            bullish: '#10b981',
            bearish: '#f43f5e',
            wick: '#555555',
            ema9: '#5ebbff',
            ema21: '#f09848',
            ema50: '#b07aff',
            volume: 'rgba(0, 212, 255, 0.08)',
            tp: '#10b981',
            sl: '#f43f5e',
            liq: '#f0c648',
            grid: 'rgba(255, 255, 255, 0.025)',
            crosshair: 'rgba(255, 255, 255, 0.15)',
        }
    }
};

// Freeze todo para prevenir modificaciones accidentales
Object.freeze(CONFIG);
Object.freeze(CONFIG.API);
Object.freeze(CONFIG.INTERVALS);
Object.freeze(CONFIG.TRADING);
Object.freeze(CONFIG.STORAGE);
Object.freeze(CONFIG.COLORS);
Object.freeze(CONFIG.CHART);
Object.freeze(CONFIG.CHART.COLORS);
Object.freeze(CONFIG.REFRESH_OPTIONS);
CONFIG.REFRESH_OPTIONS.forEach(o => Object.freeze(o));
Object.keys(CONFIG.TOKENS).forEach(k => Object.freeze(CONFIG.TOKENS[k]));
Object.freeze(CONFIG.TOKENS);
Object.keys(CONFIG.MODES).forEach(k => Object.freeze(CONFIG.MODES[k]));
Object.freeze(CONFIG.MODES);
Object.freeze(CONFIG.TIMEFRAMES);
