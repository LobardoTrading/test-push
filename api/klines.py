from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import ssl
from urllib.parse import urlparse, parse_qs

VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']
VALID_SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX',
                 'DOT', 'LINK', 'POL', 'LTC', 'ARB', 'OP', 'INJ']
MAX_LIMIT = 500

# Binance FUTURES endpoints (USD-M)
FUTURES_HOSTS = [
    "fapi.binance.com",
]

# Fallback: Spot API
SPOT_HOSTS = [
    "api.binance.com",
    "api1.binance.com",
    "api2.binance.com",
    "api3.binance.com",
    "api4.binance.com",
    "data-api.binance.vision",
]


def _fetch_with_fallback(hosts, path, ctx, timeout=10):
    last_error = None
    for host in hosts:
        try:
            url = f"https://{host}{path}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
            return json.loads(resp.read().decode())
        except Exception as e:
            last_error = e
            continue
    raise last_error


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            symbol = query.get('symbol', ['BTC'])[0].upper()
            interval = query.get('interval', ['15m'])[0]
            limit = min(int(query.get('limit', ['100'])[0]), MAX_LIMIT)

            if symbol not in VALID_SYMBOLS:
                self._send_json(400, {'error': f'Symbol inválido: {symbol}'})
                return
            if interval not in VALID_INTERVALS:
                self._send_json(400, {'error': f'Interval inválido: {interval}'})
                return
            if limit < 1:
                self._send_json(400, {'error': 'Limit debe ser >= 1'})
                return

            ctx = ssl.create_default_context()
            kline_path = f"?symbol={symbol}USDT&interval={interval}&limit={limit}"

            # Intentar Futures API primero, fallback a Spot
            try:
                data = _fetch_with_fallback(
                    FUTURES_HOSTS, f"/fapi/v1/klines{kline_path}", ctx
                )
                source = 'futures'
            except Exception:
                data = _fetch_with_fallback(
                    SPOT_HOSTS, f"/api/v3/klines{kline_path}", ctx
                )
                source = 'spot'

            candles = [{
                't': k[0],
                'o': float(k[1]),
                'h': float(k[2]),
                'l': float(k[3]),
                'c': float(k[4]),
                'v': float(k[5]),
                'trades': int(k[8]),
                'source': source
            } for k in data]

            self._send_json(200, candles)

        except urllib.error.URLError as e:
            self._send_json(502, {'error': f'Binance no responde: {str(e)}'})
        except (ValueError, TypeError) as e:
            self._send_json(400, {'error': f'Parámetro inválido: {str(e)}'})
        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=5')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
