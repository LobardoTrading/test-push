from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import ssl
from urllib.parse import urlparse, parse_qs

# Binance Futures exchange info + 24h ticker
FUTURES_HOST = "fapi.binance.com"
SPOT_HOST = "api.binance.com"


def _fetch(host, path, ctx, timeout=10):
    url = f"https://{host}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
    return json.loads(resp.read().decode())


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            ctx = ssl.create_default_context()
            query = parse_qs(urlparse(self.path).query)
            mode = query.get('mode', ['all'])[0]  # all | top_movers | search
            search = query.get('q', [''])[0].upper()

            # Get 24h ticker for all USDT perpetual futures
            try:
                tickers = _fetch(FUTURES_HOST, "/fapi/v1/ticker/24hr", ctx)
                source = 'futures'
            except Exception:
                tickers = _fetch(SPOT_HOST, "/api/v3/ticker/24hr", ctx)
                source = 'spot'

            # Filter USDT pairs only
            usdt_pairs = []
            for t in tickers:
                sym = t.get('symbol', '')
                if not sym.endswith('USDT'):
                    continue
                base = sym.replace('USDT', '')
                # Skip leveraged tokens, test tokens, etc
                if any(x in base for x in ['UP', 'DOWN', 'BULL', 'BEAR', '1000', 'BULL', 'HALF']):
                    if base not in ['1000PEPE', '1000SHIB', '1000FLOKI', '1000BONK', '1000SATS', '1000LUNC', '1000XEC', '1000RATS']:
                        continue

                price = float(t.get('lastPrice', 0))
                if price <= 0:
                    continue

                change = float(t.get('priceChangePercent', 0))
                volume = float(t.get('quoteVolume', 0))
                high = float(t.get('highPrice', 0))
                low = float(t.get('lowPrice', 0))

                # Volatility = (high - low) / low * 100
                volatility = ((high - low) / low * 100) if low > 0 else 0

                usdt_pairs.append({
                    'symbol': base,
                    'pair': sym,
                    'price': price,
                    'change': round(change, 2),
                    'volume': round(volume, 0),
                    'high': high,
                    'low': low,
                    'volatility': round(volatility, 2),
                    'source': source,
                })

            # Apply filters
            if search:
                usdt_pairs = [p for p in usdt_pairs if search in p['symbol']]

            if mode == 'top_movers':
                # Top gainers + top losers + highest volume + highest volatility
                by_change_up = sorted(usdt_pairs, key=lambda x: x['change'], reverse=True)[:15]
                by_change_down = sorted(usdt_pairs, key=lambda x: x['change'])[:15]
                by_volume = sorted(usdt_pairs, key=lambda x: x['volume'], reverse=True)[:15]
                by_volatility = sorted(usdt_pairs, key=lambda x: x['volatility'], reverse=True)[:15]

                result = {
                    'top_gainers': by_change_up,
                    'top_losers': by_change_down,
                    'top_volume': by_volume,
                    'top_volatile': by_volatility,
                    'total': len(usdt_pairs),
                }
            else:
                # Sort by volume descending (most liquid first)
                usdt_pairs.sort(key=lambda x: x['volume'], reverse=True)
                result = {
                    'symbols': usdt_pairs,
                    'total': len(usdt_pairs),
                }

            self._send_json(200, result)

        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=10')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
