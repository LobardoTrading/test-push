from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import ssl

# Tokens soportados (POL reemplaza MATIC desde sept 2023)
SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX',
           'DOT', 'LINK', 'POL', 'LTC', 'ARB', 'OP', 'INJ']

# Binance FUTURES endpoints (USD-M)
FUTURES_HOSTS = [
    "fapi.binance.com",
]

# Fallback: Spot API (si Futures falla)
SPOT_HOSTS = [
    "api.binance.com",
    "api1.binance.com",
    "api2.binance.com",
    "api3.binance.com",
    "api4.binance.com",
    "data-api.binance.vision",
]


def _fetch_with_fallback(hosts, path, ctx, timeout=10):
    """Intenta múltiples hosts de Binance hasta que uno responda"""
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
            ctx = ssl.create_default_context()

            # Intentar Futures API primero, fallback a Spot
            try:
                data = _fetch_with_fallback(
                    FUTURES_HOSTS, "/fapi/v1/ticker/24hr", ctx
                )
                source = 'futures'
            except Exception:
                data = _fetch_with_fallback(
                    SPOT_HOSTS, "/api/v3/ticker/24hr", ctx
                )
                source = 'spot'

            result = {}
            for t in data:
                if t['symbol'].endswith('USDT'):
                    s = t['symbol'].replace('USDT', '')
                    if s in SYMBOLS:
                        result[s] = {
                            'price': float(t['lastPrice']),
                            'change': float(t['priceChangePercent']),
                            'volume': float(t['quoteVolume']),
                            'high24h': float(t['highPrice']),
                            'low24h': float(t['lowPrice']),
                            'source': source,
                        }

            self._send_json(200, result)

        except urllib.error.URLError as e:
            self._send_json(502, {'error': f'Binance no responde: {str(e)}'})
        except json.JSONDecodeError:
            self._send_json(502, {'error': 'Respuesta inválida de Binance'})
        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=3')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
