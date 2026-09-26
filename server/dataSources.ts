/**
 * A股多数据源抓取与容错适配器 (Section 3)
 * 支持 东方财富, 腾讯, 新浪, 网易
 */
import iconv from 'iconv-lite';
import { QuoteSnapshot, MinutePoint, TickPoint, KlinePoint } from './types.ts';
import { toSecid, toSinaSymbol, toNeteasePrefix } from './symbols.ts';
import { sourceCircuitBreakers } from './circuitBreaker.ts';

const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '2500', 10);

/**
 * 校验 Quote 是否合法（防脏数据，Section 3.3）
 */
export function validateQuote(quote: QuoteSnapshot, cachedQuote?: QuoteSnapshot): boolean {
  if (!quote.price || !Number.isFinite(quote.price) || quote.price <= 0) {
    return false;
  }
  if (cachedQuote && cachedQuote.price > 0) {
    // 价格与上一缓存偏离小于 20% (防极端脏数据)
    const deviation = Math.abs(quote.price - cachedQuote.price) / cachedQuote.price;
    if (deviation >= 0.21) {
      console.warn(`[Validation] 标的 ${quote.code} 报价 ¥${quote.price} 与缓存 ¥${cachedQuote.price} 偏差超过 20%，丢弃该帧`);
      return false;
    }
  }
  if (cachedQuote && quote.timestamp > 0 && quote.timestamp < cachedQuote.timestamp) {
    // 数据时间戳不能倒退
    return false;
  }
  return true;
}

// ==================== 1. 腾讯财经 (主力批量快照，单次可达 80+ 标的) ====================
export async function fetchTencentQuotes(codes: string[]): Promise<Map<string, QuoteSnapshot>> {
  const cb = sourceCircuitBreakers.tencent;
  if (cb.getStatus() === 'OPEN') {
    throw new Error('Tencent circuit breaker is OPEN');
  }

  const symbols = codes.map(toSinaSymbol).join(',');
  const url = `https://qt.gtimg.cn/q=${symbols}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const text = iconv.decode(Buffer.from(arrayBuffer), 'gbk');
    const lines = text.split(';').map(l => l.trim()).filter(l => l.length > 10);

    const resultMap = new Map<string, QuoteSnapshot>();
    const now = Date.now();

    for (const line of lines) {
      const match = line.match(/v_([a-zA-Z0-9]+)="([^"]+)"/);
      if (!match) continue;
      const fields = match[2].split('~');
      if (fields.length < 35) continue;

      const code = fields[2];
      const name = fields[1];
      const price = parseFloat(fields[3]) || 0;
      const prev_close = parseFloat(fields[4]) || 0;
      const open = parseFloat(fields[5]) || 0;
      const volume = parseFloat(fields[6]) || 0; // 手
      const amount = (parseFloat(fields[37]) || 0) * 10000; // 万元转元
      const high = parseFloat(fields[33]) || price;
      const low = parseFloat(fields[34]) || price;
      const change = parseFloat(fields[31]) || 0;
      const change_pct = parseFloat(fields[32]) || 0;

      // 买卖五档: [价格, 量(手)]
      const bid: [number, number][] = ([
        [parseFloat(fields[9]) || 0, parseInt(fields[10], 10) || 0],
        [parseFloat(fields[11]) || 0, parseInt(fields[12], 10) || 0],
        [parseFloat(fields[13]) || 0, parseInt(fields[14], 10) || 0],
        [parseFloat(fields[15]) || 0, parseInt(fields[16], 10) || 0],
        [parseFloat(fields[17]) || 0, parseInt(fields[18], 10) || 0],
      ] as [number, number][]).filter(b => b[0] > 0);

      const ask: [number, number][] = ([
        [parseFloat(fields[19]) || 0, parseInt(fields[20], 10) || 0],
        [parseFloat(fields[21]) || 0, parseInt(fields[22], 10) || 0],
        [parseFloat(fields[23]) || 0, parseInt(fields[24], 10) || 0],
        [parseFloat(fields[25]) || 0, parseInt(fields[26], 10) || 0],
        [parseFloat(fields[27]) || 0, parseInt(fields[28], 10) || 0],
      ] as [number, number][]).filter(a => a[0] > 0);

      // 时间字段如 '20260925150000' (源自A股交易所北京时间 +08:00)
      const timeStr = fields[30];
      let timestamp = now;
      if (timeStr && timeStr.length === 14) {
        const y = timeStr.slice(0, 4);
        const m = timeStr.slice(4, 6);
        const d = timeStr.slice(6, 8);
        const hh = timeStr.slice(8, 10);
        const mm = timeStr.slice(10, 12);
        const ss = timeStr.slice(12, 14);
        // 显式指定 +08:00 北京时间时区解析
        const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`).getTime();
        if (!isNaN(parsed)) {
          timestamp = parsed;
        }
      }

      resultMap.set(code, {
        code,
        name,
        price,
        prev_close,
        open,
        high,
        low,
        volume,
        amount,
        change,
        change_pct,
        bid,
        ask,
        timestamp,
        source: 'tencent',
        is_stale: false,
        fetched_at: now
      });
    }

    cb.recordSuccess();
    return resultMap;
  } catch (err) {
    cb.recordFailure(err);
    throw err;
  }
}

// ==================== 2. 新浪财经 (带 Referer 校验的备用批量快照) ====================
export async function fetchSinaQuotes(codes: string[]): Promise<Map<string, QuoteSnapshot>> {
  const cb = sourceCircuitBreakers.sina;
  if (cb.getStatus() === 'OPEN') {
    throw new Error('Sina circuit breaker is OPEN');
  }

  const symbols = codes.map(toSinaSymbol).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    const text = iconv.decode(Buffer.from(arrayBuffer), 'gbk');
    const lines = text.split('\n').filter(l => l.includes('='));

    const resultMap = new Map<string, QuoteSnapshot>();
    const now = Date.now();

    for (const line of lines) {
      const match = line.match(/var hq_str_([a-zA-Z0-9]+)="([^"]+)";/);
      if (!match) continue;
      const fullSymbol = match[1];
      const code = fullSymbol.slice(2);
      const fields = match[2].split(',');
      if (fields.length < 30) continue;

      const name = fields[0];
      const open = parseFloat(fields[1]) || 0;
      const prev_close = parseFloat(fields[2]) || 0;
      const price = parseFloat(fields[3]) || 0;
      const high = parseFloat(fields[4]) || price;
      const low = parseFloat(fields[5]) || price;
      const volume = (parseFloat(fields[8]) || 0) / 100; // 股转手
      const amount = parseFloat(fields[9]) || 0; // 元
      const change = parseFloat((price - prev_close).toFixed(3));
      const change_pct = prev_close > 0 ? parseFloat(((change / prev_close) * 100).toFixed(2)) : 0;

      const bid: [number, number][] = ([
        [parseFloat(fields[11]) || 0, Math.round((parseInt(fields[10], 10) || 0) / 100)],
        [parseFloat(fields[13]) || 0, Math.round((parseInt(fields[12], 10) || 0) / 100)],
        [parseFloat(fields[15]) || 0, Math.round((parseInt(fields[14], 10) || 0) / 100)],
        [parseFloat(fields[17]) || 0, Math.round((parseInt(fields[16], 10) || 0) / 100)],
        [parseFloat(fields[19]) || 0, Math.round((parseInt(fields[18], 10) || 0) / 100)],
      ] as [number, number][]).filter(b => b[0] > 0);

      const ask: [number, number][] = ([
        [parseFloat(fields[21]) || 0, Math.round((parseInt(fields[20], 10) || 0) / 100)],
        [parseFloat(fields[23]) || 0, Math.round((parseInt(fields[22], 10) || 0) / 100)],
        [parseFloat(fields[25]) || 0, Math.round((parseInt(fields[24], 10) || 0) / 100)],
        [parseFloat(fields[27]) || 0, Math.round((parseInt(fields[26], 10) || 0) / 100)],
        [parseFloat(fields[29]) || 0, Math.round((parseInt(fields[28], 10) || 0) / 100)],
      ] as [number, number][]).filter(a => a[0] > 0);

      resultMap.set(code, {
        code,
        name,
        price,
        prev_close,
        open,
        high,
        low,
        volume,
        amount,
        change,
        change_pct,
        bid,
        ask,
        timestamp: now,
        source: 'sina',
        is_stale: false,
        fetched_at: now
      });
    }

    cb.recordSuccess();
    return resultMap;
  } catch (err) {
    cb.recordFailure(err);
    throw err;
  }
}

// ==================== 3. 东方财富单标的快照 ====================
export async function fetchEastmoneyQuote(code: string): Promise<QuoteSnapshot> {
  const cb = sourceCircuitBreakers.eastmoney;
  if (cb.getStatus() === 'OPEN') {
    throw new Error('Eastmoney circuit breaker is OPEN');
  }

  const secid = toSecid(code);
  const fields = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170,f19,f20,f39,f40,f51,f52';
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${fields}&invt=2&_=${Date.now()}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const d = json.data;
    if (!d || !d.f43) throw new Error('Empty Eastmoney quote data');

    const now = Date.now();
    const price = d.f43;
    const prev_close = d.f60;
    const change = parseFloat((price - prev_close).toFixed(3));
    const change_pct = prev_close > 0 ? parseFloat(((change / prev_close) * 100).toFixed(2)) : 0;

    cb.recordSuccess();
    return {
      code,
      name: d.f58 || '',
      price,
      prev_close,
      open: d.f46 || price,
      high: d.f44 || price,
      low: d.f45 || price,
      volume: d.f47 || 0,
      amount: d.f48 || 0,
      change,
      change_pct,
      bid: [[d.f19 || price, 0]],
      ask: [[d.f39 || price, 0]],
      timestamp: now,
      source: 'eastmoney',
      is_stale: false,
      fetched_at: now
    };
  } catch (err) {
    cb.recordFailure(err);
    throw err;
  }
}

// ==================== 4. 东方财富与腾讯分时线 (当日 1-min trends) ====================
export async function fetchEastmoneyTrends(code: string): Promise<MinutePoint[]> {
  // 1. 尝试东财分时接口
  try {
    const secid = toSecid(code);
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&_=${Date.now()}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.ok) {
      const json: any = await res.json();
      const trendsRaw = json.data?.trends || [];
      if (trendsRaw.length > 0) {
        return trendsRaw.map((line: string) => {
          const parts = line.split(',');
          const timePart = parts[0].includes(' ') ? parts[0].split(' ')[1] : parts[0];
          return {
            code,
            time: timePart.slice(0, 5),
            price: parseFloat(parts[2]),
            volume: parseFloat(parts[5]),
            amount: parseFloat(parts[6]),
            avg_price: parseFloat(parts[7])
          };
        });
      }
    }
  } catch (err) {
    // 降级到腾讯高速分时通道
  }

  // 2. 备用高可用通道: 腾讯当日逐分分时接口 (web.ifzq.gtimg.cn)
  try {
    const symbol = toSinaSymbol(code);
    const tencentUrl = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`;
    const tencentRes = await fetch(tencentUrl, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (tencentRes.ok) {
      const j: any = await tencentRes.json();
      const rawList: string[] = j.data?.[symbol]?.data?.data || [];
      if (rawList.length > 0) {
        let prevVol = 0;
        let prevAmt = 0;
        return rawList.map((itemStr: string, idx: number) => {
          // 格式: "0930 34.80 30 104400.00" -> 第3项和第4项为当天从开盘截至该分钟的累计成交量(手)和累计成交额(元)
          const p = itemStr.split(' ');
          const time = p[0].length === 4 ? `${p[0].slice(0, 2)}:${p[0].slice(2, 4)}` : p[0];
          const price = parseFloat(p[1]) || 0;
          const cumVol = parseFloat(p[2]) || 0;
          const cumAmt = parseFloat(p[3]) || 0;

          // 科创板(688/689)等特殊板块在腾讯分时接口中累计成交量单位本身就是「股」，而主板/创业板为「手」
          // 动态自适应判断成交量单位：对比 cumAmt / cumVol 与 cumAmt / (cumVol * 100) 哪个贴近价格
          const isVolInShares = cumVol > 0 && Math.abs(cumAmt / cumVol - price) < Math.abs(cumAmt / (cumVol * 100) - price);
          const totalShares = isVolInShares ? cumVol : cumVol * 100;

          // 计算当分钟的单分增量成交量 (统一转为 A 股标准显示单位：手) 与成交额
          const deltaVolRaw = idx === 0 ? cumVol : Math.max(0, cumVol - prevVol);
          const deltaVol = isVolInShares ? Math.round(deltaVolRaw / 100) : deltaVolRaw;
          const deltaAmt = idx === 0 ? cumAmt : Math.max(0, cumAmt - prevAmt);
          prevVol = cumVol;
          prevAmt = cumAmt;

          const avg_price = totalShares > 0 ? parseFloat((cumAmt / totalShares).toFixed(2)) : price;
          return {
            code,
            time,
            price,
            volume: deltaVol,
            amount: deltaAmt,
            avg_price
          };
        });
      }
    }
  } catch (err) {
    // ignore
  }

  return [];
}

// ==================== 5. 东方财富逐笔成交 (Tick明细) ====================
export async function fetchEastmoneyDetails(code: string): Promise<TickPoint[]> {
  const secid = toSecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/details/get?secid=${secid}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55&pos=-60&_=${Date.now()}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const rawDetails = json.data?.details || [];

    const ticks: TickPoint[] = rawDetails.map((line: string) => {
      // 格式: "09:30:02,26.85,15,1,..."
      const parts = line.split(',');
      const dirCode = parseInt(parts[3], 10);
      const direction: "B" | "S" | "N" = dirCode === 1 ? 'B' : dirCode === 2 ? 'S' : 'N';
      return {
        code,
        time: parts[0],
        price: parseFloat(parts[1]),
        volume: parseInt(parts[2], 10) || 0,
        direction
      };
    });

    return ticks;
  } catch (err) {
    return [];
  }
}

// ==================== 6. 腾讯历史复权 K 线 ====================
export async function fetchTencentKline(code: string, period: 'day' | 'week' | 'month' = 'day', count: number = 80): Promise<KlinePoint[]> {
  const symbol = toSinaSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,${count},qfq`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const stockObj = json.data?.[symbol];
    const rawBars = stockObj?.[`qfq${period}`] || stockObj?.[period] || [];

    return rawBars.map((item: any) => ({
      time: item[0],
      open: parseFloat(item[1]),
      close: parseFloat(item[2]),
      high: parseFloat(item[3]),
      low: parseFloat(item[4]),
      volume: parseFloat(item[5])
    }));
  } catch (err) {
    return [];
  }
}
