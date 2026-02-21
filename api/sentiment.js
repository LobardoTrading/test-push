/* ========================================
   SENTIMENT API — Free External Data
   Aggregates: Fear&Greed, CoinGecko Global, Trending
   ======================================== */

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

    try {
        const [fearGreed, globalData, trending] = await Promise.allSettled([
            fetchFearGreed(),
            fetchGlobalData(),
            fetchTrending()
        ]);

        const result = {
            fearGreed: fearGreed.status === 'fulfilled' ? fearGreed.value : null,
            global: globalData.status === 'fulfilled' ? globalData.value : null,
            trending: trending.status === 'fulfilled' ? trending.value : null,
            timestamp: new Date().toISOString()
        };

        res.status(200).json(result);
    } catch (error) {
        console.error('Sentiment API error:', error);
        res.status(500).json({ error: 'Failed to fetch sentiment data' });
    }
}

// Fear & Greed Index — alternative.me (free, no key)
async function fetchFearGreed() {
    const resp = await fetch('https://api.alternative.me/fng/?limit=7&format=json', {
        signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`FNG ${resp.status}`);
    const data = await resp.json();

    if (!data?.data?.length) return null;

    const current = data.data[0];
    const history = data.data.map(d => ({
        value: parseInt(d.value),
        label: d.value_classification,
        timestamp: new Date(parseInt(d.timestamp) * 1000).toISOString()
    }));

    // Trend: is fear increasing or decreasing?
    const today = parseInt(data.data[0]?.value || 50);
    const yesterday = parseInt(data.data[1]?.value || 50);
    const weekAgo = parseInt(data.data[6]?.value || 50);

    return {
        value: today,
        label: current.value_classification,
        yesterday: yesterday,
        weekAgo: weekAgo,
        trend1d: today - yesterday,
        trend7d: today - weekAgo,
        history
    };
}

// CoinGecko Global Market Data (free, no key)
async function fetchGlobalData() {
    const resp = await fetch('https://api.coingecko.com/api/v3/global', {
        signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`CG Global ${resp.status}`);
    const data = await resp.json();

    if (!data?.data) return null;

    const d = data.data;
    return {
        totalMarketCap: d.total_market_cap?.usd || 0,
        totalVolume24h: d.total_volume?.usd || 0,
        btcDominance: d.market_cap_percentage?.btc || 0,
        ethDominance: d.market_cap_percentage?.eth || 0,
        marketCapChange24h: d.market_cap_change_percentage_24h_usd || 0,
        activeCryptos: d.active_cryptocurrencies || 0,
        markets: d.markets || 0
    };
}

// CoinGecko Trending (free, no key)
async function fetchTrending() {
    const resp = await fetch('https://api.coingecko.com/api/v3/search/trending', {
        signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`CG Trending ${resp.status}`);
    const data = await resp.json();

    if (!data?.coins) return null;

    return data.coins.slice(0, 7).map(c => ({
        name: c.item?.name || '?',
        symbol: c.item?.symbol?.toUpperCase() || '?',
        rank: c.item?.market_cap_rank || null,
        score: c.item?.score || 0,
        priceBtc: c.item?.price_btc || 0
    }));
}
