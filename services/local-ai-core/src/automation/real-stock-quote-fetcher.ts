export interface RealStockQuoteResult {
  symbol: string;
  name?: string;
  latestPrice: number;
  previousPrice: number;
  change_percent: number;
  timestamp: string;
  providerName: string;
}

export function normalizeSymbolForTencent(symbol: string): string {
  const s = symbol.trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  const lower = s.toLowerCase();

  if (upper.endsWith('.SH') || upper.endsWith('.SS')) {
    return `sh${upper.replace(/\.(SH|SS)$/, '')}`;
  }
  if (upper.endsWith('.SZ')) {
    return `sz${upper.replace(/\.SZ$/, '')}`;
  }
  if (upper.endsWith('.HK')) {
    const rawNum = upper.replace(/\.HK$/, '').padStart(5, '0');
    return `hk${rawNum}`;
  }
  if (/^(sh|sz|hk|us)[0-9a-z]+/i.test(lower)) {
    return lower;
  }
  if (/^[69]\d{5}$/.test(s)) return `sh${s}`;
  if (/^[03]\d{5}$/.test(s)) return `sz${s}`;
  if (/^\d{1,5}$/.test(s)) return `hk${s.padStart(5, '0')}`;
  return `us${upper}`;
}

export function normalizeSymbolForYahoo(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (!s) return '';
  if (s.endsWith('.SH')) return `${s.replace(/\.SH$/, '')}.SS`;
  if (s.endsWith('.HK')) {
    const raw = s.replace(/\.HK$/, '');
    const four = raw.length > 4 ? raw.replace(/^0+/, '').padStart(4, '0') : raw.padStart(4, '0');
    return `${four}.HK`;
  }
  if (s.startsWith('SH') && /^\d{6}$/.test(s.slice(2))) return `${s.slice(2)}.SS`;
  if (s.startsWith('SZ') && /^\d{6}$/.test(s.slice(2))) return `${s.slice(2)}.SZ`;
  if (s.startsWith('HK') && /^\d{1,5}$/.test(s.slice(2))) {
    const raw = s.slice(2);
    const four = raw.length > 4 ? raw.replace(/^0+/, '').padStart(4, '0') : raw.padStart(4, '0');
    return `${four}.HK`;
  }
  if (s.startsWith('US')) return s.slice(2);
  return s;
}

function buildQuoteResult(
  originalSymbol: string,
  latestPrice: number,
  previousPrice: number,
  name: string,
  providerName: string,
): RealStockQuoteResult | null {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) return null;
  const prev = Number.isFinite(previousPrice) && previousPrice > 0 ? previousPrice : latestPrice;
  const changePercent = prev > 0 ? ((latestPrice - prev) / prev) * 100 : 0;
  return {
    symbol: originalSymbol.toUpperCase(),
    name: name || originalSymbol.toUpperCase(),
    latestPrice,
    previousPrice: prev,
    change_percent: Number(changePercent.toFixed(2)),
    timestamp: new Date().toISOString(),
    providerName,
  };
}

async function httpFetchBuffer(url: string, timeoutMs: number): Promise<ArrayBuffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
    });
    clearTimeout(timer);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchStockQuoteFromTencent(symbol: string, timeoutMs = 5000): Promise<RealStockQuoteResult | null> {
  const tencentSymbol = normalizeSymbolForTencent(symbol);
  if (!tencentSymbol) return null;
  const buffer = await httpFetchBuffer(`http://qt.gtimg.cn/q=${encodeURIComponent(tencentSymbol)}`, timeoutMs);
  if (!buffer) return null;

  let text = '';
  try {
    text = new TextDecoder('gbk').decode(buffer);
  } catch {
    text = new TextDecoder('utf-8').decode(buffer);
  }

  const eqIdx = text.indexOf('=');
  if (eqIdx === -1) return null;
  const rawContent = text.slice(eqIdx + 1).trim().replace(/^"/, '').replace(/";?$/, '');
  if (!rawContent || rawContent === 'pv_none_') return null;

  const parts = rawContent.split('~');
  if (parts.length < 5) return null;

  return buildQuoteResult(symbol, Number(parts[3]), Number(parts[4]), parts[1] || '', 'gtimg');
}

export async function fetchStockQuoteFromYahoo(symbol: string, timeoutMs = 5000): Promise<RealStockQuoteResult | null> {
  const yahooSymbol = normalizeSymbolForYahoo(symbol);
  if (!yahooSymbol) return null;
  const buffer = await httpFetchBuffer(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`, timeoutMs);
  if (!buffer) return null;

  try {
    const rawText = new TextDecoder('utf-8').decode(buffer);
    const data = JSON.parse(rawText) as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const latestPrice = Number(meta.regularMarketPrice ?? meta.chartPreviousClose);
    const previousPrice = Number(meta.chartPreviousClose ?? meta.previousClose ?? latestPrice);
    return buildQuoteResult(symbol, latestPrice, previousPrice, meta.symbol || symbol, 'yahoo');
  } catch {
    return null;
  }
}

export async function fetchRealStockQuote(symbol: string, timeoutMs = 5000): Promise<RealStockQuoteResult | null> {
  const tencentResult = await fetchStockQuoteFromTencent(symbol, timeoutMs);
  if (tencentResult) return tencentResult;
  return await fetchStockQuoteFromYahoo(symbol, timeoutMs);
}
