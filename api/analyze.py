from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import ssl
import math

# === CONSTANTES ===
GRADE_A = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'POL', 'LTC']
GRADE_B = ['ARB', 'OP', 'INJ', 'SUI', 'SEI', 'TIA', 'JUP', 'WIF', 'PEPE', 'BONK', 'RENDER', 'FET', 'NEAR', 'APT', 'FIL', 'ATOM', 'UNI', 'AAVE']
# Accept any symbol — validation done by checking if Binance returns data
VALID_SYMBOLS = None  # None means accept all — validated at runtime
VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']

# ATR multipliers per timeframe (TP_mult, SL_mult)
ATR_MULTIPLIERS = {
    '1m':  (2.0, 0.8),    # R:R 2.5:1 — scalping needs tight SL, wide TP
    '3m':  (2.2, 0.9),    # R:R 2.4:1
    '5m':  (2.5, 1.0),    # R:R 2.5:1
    '15m': (2.8, 1.2),    # R:R 2.3:1
    '30m': (3.0, 1.4),    # R:R 2.1:1
    '1h':  (3.2, 1.6),    # R:R 2.0:1
    '2h':  (3.5, 1.8),    # R:R 1.9:1
    '4h':  (3.8, 2.0),    # R:R 1.9:1
    '1d':  (4.0, 2.2),    # R:R 1.8:1
    '1w':  (5.0, 2.8),    # R:R 1.8:1
}

# NUEVO: Períodos de indicadores adaptados por timeframe
# Timeframes cortos = períodos más cortos (más sensibles)
# Timeframes largos = períodos más largos (menos ruido)
RSI_PERIODS = {
    '1m': 7, '3m': 9, '5m': 10, '15m': 14, '30m': 14,
    '1h': 14, '2h': 14, '4h': 14, '1d': 21, '1w': 21
}
BB_PERIODS = {
    '1m': 12, '3m': 15, '5m': 18, '15m': 20, '30m': 20,
    '1h': 20, '2h': 20, '4h': 20, '1d': 25, '1w': 30
}
MACD_PARAMS = {
    # (fast, slow, signal)
    '1m': (6, 13, 5), '3m': (8, 17, 6), '5m': (9, 21, 7),
    '15m': (12, 26, 9), '30m': (12, 26, 9),
    '1h': (12, 26, 9), '2h': (12, 26, 9), '4h': (12, 26, 9),
    '1d': (12, 26, 9), '1w': (12, 26, 9)
}

# Fallback % targets when ATR is zero (TP_pct, SL_pct) — all enforce min 2:1 R:R
FALLBACK_PCT = {
    '1m':  (0.004, 0.0015),   # TP 0.4%, SL 0.15% → R:R 2.7:1
    '3m':  (0.006, 0.0025),   # TP 0.6%, SL 0.25%
    '5m':  (0.009, 0.004),    # TP 0.9%, SL 0.4%
    '15m': (0.015, 0.007),
    '30m': (0.022, 0.010),
    '1h':  (0.030, 0.015),
    '2h':  (0.040, 0.020),
    '4h':  (0.055, 0.028),
    '1d':  (0.080, 0.045),
    '1w':  (0.120, 0.065),
}


# === PRICE PRECISION ===

def price_precision(price):
    if price <= 0:
        return 2
    if price >= 1000:
        return 2
    elif price >= 100:
        return 3
    elif price >= 1:
        return 4
    elif price >= 0.01:
        return 5
    elif price >= 0.001:
        return 6
    else:
        return 8


def round_price(value, price):
    decimals = price_precision(price)
    return round(value, decimals)


# === INDICADORES ===

def rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gains += change
        else:
            losses -= change
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        if change > 0:
            avg_gain = (avg_gain * (period - 1) + change) / period
            avg_loss = (avg_loss * (period - 1)) / period
        else:
            avg_gain = (avg_gain * (period - 1)) / period
            avg_loss = (avg_loss * (period - 1) - change) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def ema(data, period):
    if not data or len(data) < period:
        return data[-1] if data else 0.0
    k = 2 / (period + 1)
    val = sum(data[:period]) / period
    for x in data[period:]:
        val = x * k + val * (1 - k)
    return val


def sma(data, period):
    if not data or len(data) < period:
        return data[-1] if data else 0.0
    return sum(data[-period:]) / period


def atr(candles, period=14):
    if len(candles) < period + 1:
        if len(candles) >= 2:
            trs = [c['h'] - c['l'] for c in candles[-min(len(candles), period):]]
            return sum(trs) / len(trs) if trs else 0.0
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        h, l, pc = candles[i]['h'], candles[i]['l'], candles[i - 1]['c']
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    if not trs:
        return 0.0
    atr_val = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr_val = (atr_val * (period - 1) + tr) / period
    return atr_val


def macd(closes, fast=12, slow=26, signal_period=9):
    if len(closes) < slow + signal_period:
        return {'macd': 0, 'signal': 0, 'histogram': 0}
    k_fast = 2 / (fast + 1)
    k_slow = 2 / (slow + 1)
    ema_fast = sum(closes[:fast]) / fast
    ema_slow = sum(closes[:slow]) / slow
    macd_series = []
    for i in range(slow, len(closes)):
        ema_fast = closes[i] * k_fast + ema_fast * (1 - k_fast)
        ema_slow = closes[i] * k_slow + ema_slow * (1 - k_slow)
        macd_series.append(ema_fast - ema_slow)
    if len(macd_series) < signal_period:
        return {'macd': macd_series[-1] if macd_series else 0, 'signal': 0, 'histogram': 0}
    k_sig = 2 / (signal_period + 1)
    signal_val = sum(macd_series[:signal_period]) / signal_period
    for x in macd_series[signal_period:]:
        signal_val = x * k_sig + signal_val * (1 - k_sig)
    macd_val = macd_series[-1]
    return {'macd': macd_val, 'signal': signal_val, 'histogram': macd_val - signal_val}


def bollinger_bands(closes, period=20, std_dev=2):
    if len(closes) < period:
        p = closes[-1] if closes else 0
        return {'upper': p, 'middle': p, 'lower': p, 'width': 0}
    slc = closes[-period:]
    middle = sum(slc) / period
    variance = sum((x - middle) ** 2 for x in slc) / period
    std = variance ** 0.5
    return {
        'upper': middle + std * std_dev,
        'middle': middle,
        'lower': middle - std * std_dev,
        'width': (2 * std * std_dev) / middle * 100 if middle > 0 else 0
    }


def stochastic(candles, k_period=14, d_period=3):
    if len(candles) < k_period:
        return {'k': 50, 'd': 50}
    k_values = []
    for i in range(k_period - 1, len(candles)):
        window = candles[i - k_period + 1:i + 1]
        high = max(c['h'] for c in window)
        low = min(c['l'] for c in window)
        close = candles[i]['c']
        if high == low:
            k_values.append(50)
        else:
            k_values.append(((close - low) / (high - low)) * 100)
    k_val = k_values[-1] if k_values else 50
    d_val = sum(k_values[-d_period:]) / min(d_period, len(k_values))
    return {'k': k_val, 'd': d_val}


def volume_analysis(candles, period=20):
    if len(candles) < period:
        return {'ratio': 1.0, 'trend': 'normal'}
    vols = [c['v'] for c in candles]
    avg = sum(vols[-period:]) / period
    current = vols[-1]
    ratio = current / avg if avg > 0 else 1.0
    if ratio > 3.0:
        trend = 'spike'
    elif ratio > 1.5:
        trend = 'high'
    elif ratio < 0.5:
        trend = 'low'
    else:
        trend = 'normal'
    return {'ratio': round(ratio, 2), 'trend': trend}


def detect_divergence(candles, period=14):
    if len(candles) < period + 5:
        return 'none'
    closes = [c['c'] for c in candles]
    rsi_vals = []
    for i in range(len(candles) - 5, len(candles)):
        rsi_vals.append(rsi(closes[:i + 1], period))
    price_trend = closes[-1] - closes[-5]
    rsi_trend = rsi_vals[-1] - rsi_vals[0]
    if price_trend > 0 and rsi_trend < -3:
        return 'bearish'
    elif price_trend < 0 and rsi_trend > 3:
        return 'bullish'
    return 'none'


# === BOTS DE ANÁLISIS ===

def bot_trend(candles, price, direction):
    if len(candles) < 21:
        return None
    closes = [c['c'] for c in candles]
    ema9 = ema(closes, 9)
    ema21 = ema(closes, 21)
    ema50 = ema(closes, 50) if len(closes) >= 50 else ema21
    score = 0
    reasons = []
    if direction == 'LONG':
        if ema9 > ema21:
            score += 35
            reasons.append('EMA9 > EMA21')
        if price > ema9:
            score += 25
            reasons.append('Precio > EMA9')
        if price > ema21:
            score += 20
            reasons.append('Precio > EMA21')
        if ema21 > ema50:
            score += 20
            reasons.append('Tendencia macro alcista')
    else:
        if ema9 < ema21:
            score += 35
            reasons.append('EMA9 < EMA21')
        if price < ema9:
            score += 25
            reasons.append('Precio < EMA9')
        if price < ema21:
            score += 20
            reasons.append('Precio < EMA21')
        if ema21 < ema50:
            score += 20
            reasons.append('Tendencia macro bajista')
    sig = 'GREEN' if score >= 70 else 'YELLOW' if score >= 40 else 'RED'
    return {'name': 'Tendencia', 'signal': sig, 'score': score,
            'reason': ' | '.join(reasons) if reasons else 'Sin señal de tendencia', 'weight': 1.5}


def bot_bitcoin(symbol, btc_change):
    if symbol == 'BTC':
        return {'name': 'Bitcoin', 'signal': 'GREEN', 'score': 100,
                'reason': 'Operando BTC directamente', 'weight': 1.2, 'critical': True}
    vol = abs(btc_change)
    if vol > 8:
        return {'name': 'Bitcoin', 'signal': 'RED', 'score': 0,
                'reason': f'BTC muy volátil ({vol:.1f}%) - Peligroso para alts', 'weight': 1.2, 'critical': True}
    elif vol > 5:
        return {'name': 'Bitcoin', 'signal': 'YELLOW', 'score': 40,
                'reason': f'BTC volátil ({vol:.1f}%) - Precaución', 'weight': 1.2, 'critical': True}
    else:
        return {'name': 'Bitcoin', 'signal': 'GREEN', 'score': 100,
                'reason': f'BTC estable ({btc_change:+.1f}%)', 'weight': 1.2, 'critical': True}


def bot_rsi(candles, direction, interval='15m'):
    period = RSI_PERIODS.get(interval, 14)
    if len(candles) < period + 1:
        return None
    rsi_val = rsi([c['c'] for c in candles], period)
    if direction == 'LONG':
        if rsi_val > 80:
            return {'name': 'RSI', 'signal': 'RED', 'score': 0,
                    'reason': f'RSI sobrecompra extrema ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
        elif rsi_val > 70:
            return {'name': 'RSI', 'signal': 'YELLOW', 'score': 30,
                    'reason': f'RSI sobrecompra ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
        elif rsi_val < 25:
            return {'name': 'RSI', 'signal': 'GREEN', 'score': 100,
                    'reason': f'RSI sobreventa fuerte ({rsi_val:.0f}) - Rebote probable', 'weight': 2.0, 'critical': True}
        elif rsi_val < 35:
            return {'name': 'RSI', 'signal': 'GREEN', 'score': 90,
                    'reason': f'RSI zona baja ({rsi_val:.0f}) - Favorable', 'weight': 2.0, 'critical': True}
        elif rsi_val < 55:
            return {'name': 'RSI', 'signal': 'GREEN', 'score': 80,
                    'reason': f'RSI neutral-bajo ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
        else:
            return {'name': 'RSI', 'signal': 'YELLOW', 'score': 55,
                    'reason': f'RSI neutral-alto ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
    else:
        if rsi_val < 20:
            return {'name': 'RSI', 'signal': 'RED', 'score': 0,
                    'reason': f'RSI sobreventa extrema ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
        elif rsi_val < 30:
            return {'name': 'RSI', 'signal': 'YELLOW', 'score': 30,
                    'reason': f'RSI sobreventa ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
        elif rsi_val > 75:
            return {'name': 'RSI', 'signal': 'GREEN', 'score': 100,
                    'reason': f'RSI sobrecompra fuerte ({rsi_val:.0f}) - Caída probable', 'weight': 2.0, 'critical': True}
        elif rsi_val > 65:
            return {'name': 'RSI', 'signal': 'GREEN', 'score': 90,
                    'reason': f'RSI zona alta ({rsi_val:.0f}) - Favorable', 'weight': 2.0, 'critical': True}
        elif rsi_val > 45:
            return {'name': 'RSI', 'signal': 'GREEN', 'score': 80,
                    'reason': f'RSI neutral-alto ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}
        else:
            return {'name': 'RSI', 'signal': 'YELLOW', 'score': 55,
                    'reason': f'RSI neutral-bajo ({rsi_val:.0f})', 'weight': 2.0, 'critical': True}


def bot_whales(candles):
    if len(candles) < 20:
        return None
    vol_data = volume_analysis(candles)
    vols = [c['v'] for c in candles]
    avg = sum(vols[-20:]) / 20
    spikes = sum(1 for v in vols[-5:] if v > avg * 3)
    big_spikes = sum(1 for v in vols[-5:] if v > avg * 5)
    if big_spikes >= 2:
        return {'name': 'Ballenas', 'signal': 'RED', 'score': 10,
                'reason': f'Manipulación extrema ({big_spikes} mega-spikes)', 'weight': 1.0}
    elif spikes >= 3:
        return {'name': 'Ballenas', 'signal': 'RED', 'score': 20,
                'reason': f'Alta manipulación ({spikes} spikes)', 'weight': 1.0}
    elif spikes >= 1:
        return {'name': 'Ballenas', 'signal': 'YELLOW', 'score': 60,
                'reason': f'Actividad sospechosa (vol {vol_data["ratio"]}x)', 'weight': 1.0}
    elif vol_data['trend'] == 'low':
        return {'name': 'Ballenas', 'signal': 'YELLOW', 'score': 65,
                'reason': f'Volumen bajo (vol {vol_data["ratio"]}x) - Poca liquidez', 'weight': 1.0}
    else:
        return {'name': 'Ballenas', 'signal': 'GREEN', 'score': 100,
                'reason': f'Mercado natural (vol {vol_data["ratio"]}x)', 'weight': 1.0}


def bot_quality(symbol):
    if symbol in GRADE_A:
        return {'name': 'Calidad', 'signal': 'GREEN', 'score': 100,
                'reason': 'Token Grado A - Alta liquidez', 'weight': 1.3}
    elif symbol in ('ARB', 'OP', 'INJ', 'SUI', 'APT', 'SEI', 'TIA', 'JUP', 'WLD', 'FET', 'NEAR', 'FIL', 'ATOM', 'UNI', 'AAVE'):
        return {'name': 'Calidad', 'signal': 'YELLOW', 'score': 70,
                'reason': 'Token Grado B - Liquidez moderada', 'weight': 1.3}
    else:
        return {'name': 'Calidad', 'signal': 'YELLOW', 'score': 55,
                'reason': 'Token Grado C - Verificar liquidez', 'weight': 1.3}


def bot_macd_bb(candles, direction, interval='15m'):
    bb_period = BB_PERIODS.get(interval, 20)
    macd_fast, macd_slow, macd_signal = MACD_PARAMS.get(interval, (12, 26, 9))
    min_candles = max(bb_period, macd_slow + macd_signal) + 5
    if len(candles) < min_candles:
        return None
    closes = [c['c'] for c in candles]
    price = closes[-1]
    macd_data = macd(closes, macd_fast, macd_slow, macd_signal)
    bb = bollinger_bands(closes, bb_period)
    score = 0
    reasons = []
    if direction == 'LONG':
        if macd_data['histogram'] > 0:
            score += 35
            reasons.append('MACD positivo')
        if macd_data['macd'] > macd_data['signal']:
            score += 25
            reasons.append('MACD > Señal')
        if price <= bb['lower'] * 1.01:
            score += 25
            reasons.append('Precio en banda inferior BB')
        elif price < bb['middle']:
            score += 15
            reasons.append('Precio bajo media BB')
        if bb['width'] > 3:
            reasons.append(f'BB ancho ({bb["width"]:.1f}%) - Alta volatilidad')
    else:
        if macd_data['histogram'] < 0:
            score += 35
            reasons.append('MACD negativo')
        if macd_data['macd'] < macd_data['signal']:
            score += 25
            reasons.append('MACD < Señal')
        if price >= bb['upper'] * 0.99:
            score += 25
            reasons.append('Precio en banda superior BB')
        elif price > bb['middle']:
            score += 15
            reasons.append('Precio sobre media BB')
        if bb['width'] > 3:
            reasons.append(f'BB ancho ({bb["width"]:.1f}%) - Alta volatilidad')
    sig = 'GREEN' if score >= 60 else 'YELLOW' if score >= 30 else 'RED'
    return {'name': 'MACD+BB', 'signal': sig, 'score': min(100, score),
            'reason': ' | '.join(reasons) if reasons else 'Sin señal clara', 'weight': 1.5}


def bot_macro(btc_change, eth_change, direction):
    pos, neg = 0, 0
    reasons = []
    if btc_change > 3:
        pos += 2; reasons.append(f'BTC fuerte ({btc_change:+.1f}%)')
    elif btc_change > 1:
        pos += 1; reasons.append(f'BTC positivo ({btc_change:+.1f}%)')
    elif btc_change < -3:
        neg += 2; reasons.append(f'BTC cayendo ({btc_change:+.1f}%)')
    elif btc_change < -1:
        neg += 1; reasons.append(f'BTC débil ({btc_change:+.1f}%)')
    if eth_change > 3:
        pos += 2; reasons.append(f'ETH fuerte ({eth_change:+.1f}%)')
    elif eth_change > 1:
        pos += 1; reasons.append(f'ETH positivo ({eth_change:+.1f}%)')
    elif eth_change < -3:
        neg += 2; reasons.append(f'ETH cayendo ({eth_change:+.1f}%)')
    elif eth_change < -1:
        neg += 1; reasons.append(f'ETH débil ({eth_change:+.1f}%)')
    if direction == 'LONG':
        score = 50 + pos * 15 - neg * 20
    else:
        score = 50 + neg * 15 - pos * 20
    score = max(0, min(100, score))
    if (direction == 'LONG' and neg >= 3) or (direction == 'SHORT' and pos >= 3):
        return {'name': 'Macro', 'signal': 'RED', 'score': score,
                'reason': ' | '.join(reasons) or 'Macro desfavorable', 'weight': 1.5, 'critical': True}
    elif score >= 65:
        return {'name': 'Macro', 'signal': 'GREEN', 'score': score,
                'reason': ' | '.join(reasons) or 'Macro favorable', 'weight': 1.5, 'critical': True}
    else:
        return {'name': 'Macro', 'signal': 'YELLOW', 'score': score,
                'reason': ' | '.join(reasons) or 'Macro neutral', 'weight': 1.5, 'critical': True}


# === MOTOR DE ANÁLISIS ===

def analyze(symbol, direction, candles, price, btc_change, eth_change, base_lev=50, interval='15m'):
    results = []
    bots = [
        bot_trend(candles, price, direction),
        bot_bitcoin(symbol, btc_change),
        bot_rsi(candles, direction, interval),  # NUEVO: pasa interval para adaptar período
        bot_whales(candles),
        bot_quality(symbol),
        bot_macd_bb(candles, direction, interval),  # NUEVO: pasa interval para adaptar períodos
        bot_macro(btc_change, eth_change, direction),
    ]
    results = [b for b in bots if b is not None]

    if not results:
        return {'decision': 'WAIT', 'confidence': 0, 'leverage': 0,
                'reason': 'Datos insuficientes para analizar', 'bots': []}

    # FIX: Require 2+ critical REDs for CANCEL (was 1 — too aggressive, blocked dip-buying)
    critical_reds = [r for r in results if r.get('critical') and r['signal'] == 'RED']
    if len(critical_reds) >= 2:
        reasons = [f"{r['name']}: {r['reason']}" for r in critical_reds]
        return {'decision': 'CANCEL', 'confidence': 0, 'leverage': 0,
                'reason': f"STOP - {' + '.join(reasons)}", 'bots': results}
    # Single critical RED with very low score = still cancel (extreme case)
    if len(critical_reds) == 1 and critical_reds[0]['score'] == 0:
        return {'decision': 'CANCEL', 'confidence': 0, 'leverage': 0,
                'reason': f"STOP - {critical_reds[0]['name']}: {critical_reds[0]['reason']}", 'bots': results}

    greens = len([r for r in results if r['signal'] == 'GREEN'])
    yellows = len([r for r in results if r['signal'] == 'YELLOW'])
    reds = len([r for r in results if r['signal'] == 'RED'])
    total_w = sum(r.get('weight', 1) for r in results)
    confidence = int(sum((r['score'] / 100) * r.get('weight', 1) for r in results) / total_w * 100) if total_w else 50

    if greens >= 5 and reds == 0 and confidence >= 70:
        lev = min(60, base_lev)
        return {'decision': 'ENTER', 'confidence': confidence, 'leverage': lev,
                'reason': f'Excelente ({greens}G {yellows}Y) - Conf: {confidence}%', 'bots': results}
    elif greens >= 4 and reds == 0 and confidence >= 60:
        lev = min(50, base_lev)
        return {'decision': 'ENTER', 'confidence': confidence, 'leverage': lev,
                'reason': f'Buena señal ({greens}G {yellows}Y) - Conf: {confidence}%', 'bots': results}
    elif greens >= 3 and reds <= 1 and confidence >= 55:
        lev = min(40, base_lev)
        return {'decision': 'ENTER', 'confidence': confidence, 'leverage': lev,
                'reason': f'Aceptable ({greens}G {yellows}Y {reds}R) - Conf: {confidence}%', 'bots': results}
    else:
        return {'decision': 'WAIT', 'confidence': confidence, 'leverage': 0,
                'reason': f'Esperar ({greens}G {yellows}Y {reds}R) - Conf: {confidence}%', 'bots': results}


# === TP/SL CALCULATION ===

def calculate_tp_sl(price, direction, atr_val, interval):
    tp_mult, sl_mult = ATR_MULTIPLIERS.get(interval, (2.5, 1.5))
    tp_pct, sl_pct = FALLBACK_PCT.get(interval, (0.015, 0.009))

    atr_meaningful = atr_val > 0 and (atr_val / price) > 0.0001

    if atr_meaningful:
        tp_offset = atr_val * tp_mult
        sl_offset = atr_val * sl_mult

        min_tp_offset = price * 0.001
        min_sl_offset = price * 0.0005
        tp_offset = max(tp_offset, min_tp_offset)
        sl_offset = max(sl_offset, min_sl_offset)

        max_tp_offset = price * 0.15
        max_sl_offset = price * 0.08
        tp_offset = min(tp_offset, max_tp_offset)
        sl_offset = min(sl_offset, max_sl_offset)
    else:
        tp_offset = price * tp_pct
        sl_offset = price * sl_pct

    if direction == 'LONG':
        tp = price + tp_offset
        sl = price - sl_offset
    else:
        tp = price - tp_offset
        sl = price + sl_offset

    tp = round_price(tp, price)
    sl = round_price(sl, price)

    if direction == 'LONG':
        if tp <= price:
            tp = round_price(price * (1 + tp_pct), price)
        if sl >= price:
            sl = round_price(price * (1 - sl_pct), price)
    else:
        if tp >= price:
            tp = round_price(price * (1 - tp_pct), price)
        if sl <= price:
            sl = round_price(price * (1 + sl_pct), price)

    tp_dist = abs(tp - price)
    sl_dist = abs(sl - price)
    rr = round(tp_dist / sl_dist, 2) if sl_dist > 0 else 2.0

    # Enforce minimum R:R of 2.0 — if TP is too close relative to SL, widen TP
    MIN_RR = 2.0
    if rr < MIN_RR and sl_dist > 0:
        tp_dist = sl_dist * MIN_RR
        if direction == 'LONG':
            tp = round_price(price + tp_dist, price)
        else:
            tp = round_price(price - tp_dist, price)
        rr = MIN_RR

    return tp, sl, rr


# === HANDLER HTTP ===
# CAMBIADO: Futures API (fapi/v1) con fallback a Spot (api/v3)

FUTURES_HOSTS = [
    "fapi.binance.com",
]

SPOT_HOSTS = [
    "api.binance.com",
    "api1.binance.com",
    "api2.binance.com",
    "api3.binance.com",
    "api4.binance.com",
    "data-api.binance.vision",
]

# NUEVO: Caché simple con TTL (funciona en warm starts de Vercel)
import time
_cache = {}
_CACHE_TTL = 5  # segundos

def _get_cached(key):
    """Obtener valor de caché si no expiró"""
    if key in _cache:
        data, timestamp = _cache[key]
        if time.time() - timestamp < _CACHE_TTL:
            return data
        del _cache[key]
    return None

def _set_cached(key, data):
    """Guardar en caché con timestamp"""
    _cache[key] = (data, time.time())
    # Limpiar caché viejo (máximo 50 entries)
    if len(_cache) > 50:
        oldest = min(_cache.keys(), key=lambda k: _cache[k][1])
        del _cache[oldest]


def _fetch_json(hosts, path, ctx):
    """Helper para fetch con SSL, timeout y fallback de hosts"""
    last_error = None
    for host in hosts:
        try:
            url = f"https://{host}{path}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(req, timeout=10, context=ctx)
            return json.loads(resp.read().decode())
        except Exception as e:
            last_error = e
            continue
    raise last_error


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._send_json(200, {})

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length).decode()) if content_length else {}

            symbol = (body.get('symbol') or 'BTC').upper().replace('USDT', '')
            direction = (body.get('direction') or 'LONG').upper()
            base_lev = body.get('leverage') or 50
            interval = body.get('interval') or '15m'

            if direction not in ('LONG', 'SHORT'):
                self._send_json(400, {'error': f'Direction inválida: {direction}'})
                return
            if interval not in VALID_INTERVALS:
                self._send_json(400, {'error': f'Interval inválido: {interval}'})
                return

            ctx = ssl.create_default_context()

            # --- KLINES: Con caché + Futures primero, fallback Spot ---
            kline_path = f"?symbol={symbol}USDT&interval={interval}&limit=100"
            cache_key = f"klines:{symbol}:{interval}"
            cached = _get_cached(cache_key)

            if cached:
                klines, data_source = cached
            else:
                data_source = 'futures'
                try:
                    klines = _fetch_json(FUTURES_HOSTS, f"/fapi/v1/klines{kline_path}", ctx)
                except Exception:
                    klines = _fetch_json(SPOT_HOSTS, f"/api/v3/klines{kline_path}", ctx)
                    data_source = 'spot'
                _set_cached(cache_key, (klines, data_source))

            # NUEVO: Validar que klines sea un array válido
            if not isinstance(klines, list) or len(klines) == 0:
                self._send_json(400, {'error': f'Símbolo inválido o sin datos: {symbol}USDT'})
                return

            # NUEVO: Validar estructura de cada kline antes de procesar
            try:
                candles = [{'o': float(k[1]), 'h': float(k[2]), 'l': float(k[3]),
                            'c': float(k[4]), 'v': float(k[5])} for k in klines]
            except (IndexError, ValueError, TypeError) as e:
                self._send_json(400, {'error': f'Datos de klines malformados: {str(e)}'})
                return

            # --- TICKERS: Con caché + usar MISMA fuente que klines para consistencia ---
            ticker_cache_key = f"tickers:{data_source}"
            tickers = _get_cached(ticker_cache_key)

            if not tickers:
                try:
                    if data_source == 'futures':
                        tickers = _fetch_json(FUTURES_HOSTS, "/fapi/v1/ticker/24hr", ctx)
                    else:
                        tickers = _fetch_json(SPOT_HOSTS, "/api/v3/ticker/24hr", ctx)
                except Exception:
                    # Si falla, intentar la otra fuente como fallback
                    try:
                        if data_source == 'futures':
                            tickers = _fetch_json(SPOT_HOSTS, "/api/v3/ticker/24hr", ctx)
                        else:
                            tickers = _fetch_json(FUTURES_HOSTS, "/fapi/v1/ticker/24hr", ctx)
                    except Exception as e:
                        self._send_json(502, {'error': f'No se pudo obtener tickers: {str(e)}'})
                        return
                _set_cached(ticker_cache_key, tickers)

            # Validar que tickers sea un array
            if not isinstance(tickers, list):
                self._send_json(502, {'error': 'Respuesta de tickers inválida'})
                return

            btc_change, eth_change, price = 0.0, 0.0, candles[-1]['c'] if candles else 0.0
            for t in tickers:
                if t['symbol'] == 'BTCUSDT':
                    btc_change = float(t['priceChangePercent'])
                elif t['symbol'] == 'ETHUSDT':
                    eth_change = float(t['priceChangePercent'])
                elif t['symbol'] == f'{symbol}USDT':
                    price = float(t['lastPrice'])

            result = analyze(symbol, direction, candles, price, btc_change, eth_change, base_lev, interval)

            # Calculate TP/SL with proper precision
            atr_val = atr(candles)
            tp, sl, rr = calculate_tp_sl(price, direction, atr_val, interval)

            result['tp'] = tp
            result['sl'] = sl
            result['rr_ratio'] = rr
            result['price'] = round_price(price, price)
            result['direction'] = direction
            result['symbol'] = symbol
            result['atr'] = round_price(atr_val, price)
            result['atr_pct'] = round(atr_val / price * 100, 4) if price > 0 else 0
            result['interval'] = interval
            result['source'] = data_source

            self._send_json(200, result)

        except urllib.error.URLError as e:
            self._send_json(502, {'error': f'Binance no responde: {str(e)}'})
        except json.JSONDecodeError:
            self._send_json(400, {'error': 'JSON inválido en el body'})
        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
