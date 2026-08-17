import { calculateBollingerBands, type BollingerBandsResult } from './bollinger-bands.js';

export interface DividendInfo {
  annualDividend: number;
  dividendYield: number; // in percent
  dividendCount: number;
  treasury10yYield: number; // in percent
  erpSpread: number; // in percent
  signal: 'high_yield' | 'low_yield' | 'neutral';
}

export interface RealStockQuoteResult {
  symbol: string;
  name?: string;
  latestPrice: number;
  previousPrice: number;
  change_percent: number;
  timestamp: string;
  providerName: string;
  boll?: BollingerBandsResult;
  dividend?: DividendInfo;
}

export interface FetchStockOptions {
  includeBollinger?: boolean;
  bollInterval?: string;
  bollPeriod?: number;
  bollStdDev?: number;
  treasury10yYield?: number;
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
  if (/^[69]\d{5}$/.test(s)) return `${s}.SS`;
  if (/^[0123]\d{5}$/.test(s)) return `${s}.SZ`;
  if (/^\d{1,5}$/.test(s)) {
    const four = s.length > 4 ? s.replace(/^0+/, '').padStart(4, '0') : s.padStart(4, '0');
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
  boll?: BollingerBandsResult,
  dividend?: DividendInfo,
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
    ...(boll ? { boll } : {}),
    ...(dividend ? { dividend } : {}),
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

export async function fetchStockQuoteFromTencent(
  symbol: string,
  timeoutMs = 5000,
): Promise<RealStockQuoteResult | null> {
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

export async function fetchWeeklyCandlesFromTencent(
  symbol: string,
  timeoutMs = 5000,
): Promise<number[] | null> {
  const tencentSymbol = normalizeSymbolForTencent(symbol);
  if (!tencentSymbol || (!tencentSymbol.startsWith('sh') && !tencentSymbol.startsWith('sz'))) {
    return null;
  }
  const buffer = await httpFetchBuffer(
    `http://data.gtimg.cn/flashdata/hushen/weekly/${encodeURIComponent(tencentSymbol)}.js`,
    timeoutMs,
  );
  if (!buffer) return null;

  const text = new TextDecoder('utf-8').decode(buffer);
  const lines = text.split('\n');
  const closes: number[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      const close = Number(parts[2]);
      if (Number.isFinite(close) && close > 0) {
        closes.push(close);
      }
    }
  }
  return closes.length > 0 ? closes : null;
}

function parseYahooCloses(data: any): number[] {
  const rawCloses: unknown[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
  return rawCloses.filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0);
}

function computeYahooBollinger(data: any, latestPrice: number, options: FetchStockOptions): BollingerBandsResult | undefined {
  if (options.includeBollinger === false) return undefined;
  const closes = parseYahooCloses(data);
  if (closes.length === 0) return undefined;
  return calculateBollingerBands(closes, {
    period: options.bollPeriod ?? 20,
    stdDevMultiplier: options.bollStdDev ?? 2,
    interval: options.bollInterval || '1wk',
    currentPrice: latestPrice,
  }) || undefined;
}

function parseYahooMeta(meta: any) {
  if (!meta) return null;
  const latestPrice = Number(meta.regularMarketPrice ?? meta.chartPreviousClose);
  const previousPrice = Number(meta.chartPreviousClose ?? meta.previousClose ?? latestPrice);
  return {
    latestPrice,
    previousPrice,
    symbol: String(meta.symbol || ''),
  };
}

export function parseYahooDividends(
  data: any,
  latestPrice: number,
  symbol: string,
  customTreasuryYield?: number,
): DividendInfo | undefined {
  const events = data?.chart?.result?.[0]?.events?.dividends;
  if (!events || typeof events !== 'object') return undefined;

  const entries = Object.values(events) as Array<{ amount?: number }>;
  let annualDividend = 0;
  let count = 0;
  for (const entry of entries) {
    const amt = Number(entry?.amount ?? 0);
    if (Number.isFinite(amt) && amt > 0) {
      annualDividend += amt;
      count++;
    }
  }

  if (annualDividend <= 0 || latestPrice <= 0) return undefined;

  const dividendYield = (annualDividend / latestPrice) * 100;
  const isChinaOrHk = symbol.endsWith('.SS') || symbol.endsWith('.SZ') || symbol.endsWith('.HK') || /^(sh|sz|hk|\d)/i.test(symbol);
  const treasury10yYield = typeof customTreasuryYield === 'number' && customTreasuryYield > 0
    ? customTreasuryYield
    : (isChinaOrHk ? 2.2 : 4.0);
  const erpSpread = dividendYield - treasury10yYield;

  let signal: DividendInfo['signal'] = 'neutral';
  if (dividendYield >= 5.0 || erpSpread >= 2.5) {
    signal = 'high_yield';
  } else if (dividendYield <= 2.5) {
    signal = 'low_yield';
  }

  return {
    annualDividend: Number(annualDividend.toFixed(4)),
    dividendYield: Number(dividendYield.toFixed(2)),
    dividendCount: count,
    treasury10yYield: Number(treasury10yYield.toFixed(2)),
    erpSpread: Number(erpSpread.toFixed(2)),
    signal,
  };
}

export async function fetchStockQuoteFromYahoo(
  symbol: string,
  timeoutMs = 5000,
  options: FetchStockOptions = {},
): Promise<RealStockQuoteResult | null> {
  const yahooSymbol = normalizeSymbolForYahoo(symbol);
  if (!yahooSymbol) return null;
  const interval = options.bollInterval || '1wk';
  const range = interval === '1d' ? '3mo' : '1y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&events=div`;
  const buffer = await httpFetchBuffer(url, timeoutMs);
  if (!buffer) return null;

  try {
    const rawText = new TextDecoder('utf-8').decode(buffer);
    const data = JSON.parse(rawText) as any;
    const metaInfo = parseYahooMeta(data?.chart?.result?.[0]?.meta);
    if (!metaInfo) return null;

    const boll = computeYahooBollinger(data, metaInfo.latestPrice, options);
    const dividend = parseYahooDividends(data, metaInfo.latestPrice, symbol, options.treasury10yYield);
    return buildQuoteResult(
      symbol,
      metaInfo.latestPrice,
      metaInfo.previousPrice,
      metaInfo.symbol || symbol,
      'yahoo',
      boll,
      dividend,
    );
  } catch {
    return null;
  }
}

export async function fetchRealStockQuote(
  symbol: string,
  timeoutMs = 5000,
  options: FetchStockOptions = { includeBollinger: true },
): Promise<RealStockQuoteResult | null> {
  const yahooResult = await fetchStockQuoteFromYahoo(symbol, timeoutMs, options);
  if (yahooResult && (!options.includeBollinger || yahooResult.boll)) {
    return yahooResult;
  }

  const tencentResult = await fetchStockQuoteFromTencent(symbol, timeoutMs);
  if (tencentResult) {
    if (options.includeBollinger !== false) {
      const tencentCloses = await fetchWeeklyCandlesFromTencent(symbol, timeoutMs);
      if (tencentCloses && tencentCloses.length > 0) {
        const boll = calculateBollingerBands(tencentCloses, {
          period: options.bollPeriod ?? 20,
          stdDevMultiplier: options.bollStdDev ?? 2,
          interval: options.bollInterval || '1wk',
          currentPrice: tencentResult.latestPrice,
        });
        if (boll) tencentResult.boll = boll;
      }
    }
    return tencentResult;
  }

  return yahooResult;
}
