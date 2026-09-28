import { Response } from 'express';
import { cacheManager } from './cacheManager.ts';
import { getSessionState, isTradingDay, getShanghaiDate } from './tradingCalendar.ts';
import { fetchTencentQuotes, fetchSinaQuotes, fetchEastmoneyTrends, fetchEastmoneyDetails, validateQuote } from './dataSources.ts';
import { sourceCircuitBreakers } from './circuitBreaker.ts';
import { QuoteSnapshot, MinutePoint, TradingSession } from './types.ts';

/**
 * 统一分时走势降采样算法：
 * A股全天 240 分钟交易按固定步长（每8分钟1点）均匀采样，全天形成约 30 个基准采样点
 * 午间休市或半日停留在 50% 轴线，杜绝频繁伸缩与局部微小抖动放大
 */
export function computeSparkline(minutePoints: MinutePoint[], fallbackPrice?: number): number[] {
  if (!minutePoints || minutePoints.length === 0) {
    return fallbackPrice && fallbackPrice > 0 ? [fallbackPrice] : [];
  }
  if (minutePoints.length <= 30) {
    return minutePoints.map(p => p.price);
  }
  const step = 8;
  const sampled: number[] = [];
  for (let i = 0; i < minutePoints.length; i += step) {
    sampled.push(minutePoints[i].price);
  }
  const lastPrice = minutePoints[minutePoints.length - 1].price;
  if (sampled[sampled.length - 1] !== lastPrice) {
    sampled.push(lastPrice);
  }
  return sampled;
}

class MarketScheduler {
  private sseClients = new Set<Response>();
  private isRunning = false;
  private quoteTimer: NodeJS.Timeout | null = null;
  private detailTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private minuteTimer: NodeJS.Timeout | null = null;
  private lastFetchTime = 0;
  private activeViewingCodes = new Set<string>();
  private currentSession: TradingSession = getSessionState();
  private minuteRefreshIndex = 0;

  constructor() {
    this.startScheduler();
  }

  // ==================== SSE 客户端管理 ====================
  public addSseClient(res: Response) {
    this.sseClients.add(res);
    res.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  public registerViewingCode(code: string) {
    this.activeViewingCodes.add(code);
    // 立即触发一次该标的的高频细节拉取
    this.fetchDetailsForCode(code).catch(() => {});
  }

  public unregisterViewingCode(code: string) {
    this.activeViewingCodes.delete(code);
  }

  public broadcast(event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch (err) {
        this.sseClients.delete(client);
      }
    }
  }

  // ==================== 调度器主体 ====================
  public startScheduler() {
    if (this.isRunning) return;
    this.isRunning = true;

    // 启动初始拉取 (Boot-up pull: 即使在休市期也拉取最新昨收/收盘价)
    this.fetchQuotesRound().catch((e) => console.error('[Scheduler] 启动初始拉取异常', e.message));

    // SSE 15秒心跳 Ping (Section 5.3)
    this.pingTimer = setInterval(() => {
      const nowSession = getSessionState();
      this.checkSessionTransition(nowSession);
      this.broadcast('ping', { time: Date.now(), session: nowSession });
    }, 15000);

    // 核心循环：动态根据时段调整频率 (Section 4.2)
    this.scheduleNextTick();

    // 针对正在查看详情的标的拉取分时/逐笔 (每 4 秒)
    this.detailTimer = setInterval(() => {
      this.fetchActiveDetailsRound();
    }, 4000);

    // 盘中循环温和刷新全池分时走势 (每 20 秒轮换一批，使左侧列表所有股票分时图保持全天动态更新)
    this.minuteTimer = setInterval(() => {
      this.refreshPoolMinutesRound().catch(() => {});
    }, 20000);

    // 启动后异步温和预热全股票池分时数据，使缩略图快速获得高精度真实走势
    setTimeout(() => {
      this.warmupMinuteCache().catch(e => console.error('[Scheduler] 预热分时异常', e.message));
    }, 1000);
  }

  private checkSessionTransition(newSession: TradingSession) {
    if (newSession !== this.currentSession) {
      const prevSession = this.currentSession;
      this.currentSession = newSession;
      console.log(`[Scheduler] 交易时段切换: ${prevSession} -> ${newSession}`);
      this.broadcast('session_change', { session: newSession, time: Date.now() });

      // 当开盘或恢复交易时立即拉取全池行情和分时
      if (newSession === 'MORNING' || newSession === 'AFTERNOON') {
        this.fetchQuotesRound().catch(() => {});
        this.refreshPoolMinutesRound().catch(() => {});
      }
    }
  }

  private scheduleNextTick() {
    const session = getSessionState();
    this.checkSessionTransition(session);

    let delayMs = 3000; // 默认 3 秒 (MORNING / AFTERNOON / AUCTION)

    if (session === 'LUNCH_BREAK') {
      delayMs = 15000; // 午休缩短至 15 秒轮询，确保能精准捕获 13:00 下午开盘
    } else if (session === 'CLOSED') {
      // 盘后休市，降低频率至 60 秒轮询保活
      delayMs = 60000;
    } else if (session === 'PRE_MARKET') {
      delayMs = 15000;
    }

    this.quoteTimer = setTimeout(async () => {
      try {
        await this.fetchQuotesRound();
      } catch (e: any) {
        console.error('[Scheduler] 轮询异常:', e.message);
      } finally {
        this.scheduleNextTick();
      }
    }, delayMs);
  }

  /**
   * 批量抓取行情快照 (带多源优先级容错与防封控分批, Section 3.3 & 3.4)
   */
  public async fetchQuotesRound() {
    const pool = cacheManager.getPool();
    if (pool.length === 0) return;

    const allCodes = pool.map(item => item.code);
    const BATCH_SIZE = 80;
    const batches: string[][] = [];
    for (let i = 0; i < allCodes.length; i += BATCH_SIZE) {
      batches.push(allCodes.slice(i, i + BATCH_SIZE));
    }

    const updatedSnapshots: QuoteSnapshot[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batchCodes = batches[i];
      if (i > 0) {
        await new Promise(r => setTimeout(r, 100));
      }

      let quotesMap: Map<string, QuoteSnapshot> | null = null;

      // 优先级 1: 腾讯财经批量
      if (sourceCircuitBreakers.tencent.getStatus() !== 'OPEN') {
        try {
          quotesMap = await fetchTencentQuotes(batchCodes);
        } catch (err: any) {
          console.warn('[Scheduler] 腾讯源请求失败，尝试切换新浪备用源:', err.message);
        }
      }

      // 优先级 2: 新浪财经批量
      if (!quotesMap && sourceCircuitBreakers.sina.getStatus() !== 'OPEN') {
        try {
          quotesMap = await fetchSinaQuotes(batchCodes);
          console.log('[Scheduler] 成功使用新浪备用源完成数据同步');
        } catch (err: any) {
          console.error('[Scheduler] 新浪源也发生异常:', err.message);
        }
      }

      if (quotesMap) {
        for (const code of batchCodes) {
          const fresh = quotesMap.get(code);
          const cached = cacheManager.getQuote(code);

          if (fresh && validateQuote(fresh, cached)) {
            // 附带最新准确的分时降采样点
            const minutePoints = cacheManager.getMinutePoints(code);
            fresh.sparkline = computeSparkline(minutePoints, fresh.price);
            cacheManager.updateQuote(fresh);
            updatedSnapshots.push(fresh);
          } else if (cached) {
            cached.is_stale = true;
          }
        }
      }
    }

    this.lastFetchTime = Date.now();

    // 通过 SSE 广播变动的 quote (含真实 sparkline)
    if (updatedSnapshots.length > 0) {
      for (const q of updatedSnapshots) {
        this.broadcast('quote_update', {
          code: q.code,
          name: q.name,
          price: q.price,
          change: q.change,
          change_pct: q.change_pct,
          high: q.high,
          low: q.low,
          volume: q.volume,
          amount: q.amount,
          timestamp: q.timestamp,
          sparkline: q.sparkline
        });
      }
    }
  }

  /**
   * 针对当前用户正在激活查看的股票拉取分时/逐笔成交
   */
  private async fetchActiveDetailsRound() {
    if (this.activeViewingCodes.size === 0) return;
    for (const code of this.activeViewingCodes) {
      await this.fetchDetailsForCode(code);
    }
  }

  private async fetchDetailsForCode(code: string) {
    try {
      const trends = await fetchEastmoneyTrends(code);
      if (trends.length > 0) {
        cacheManager.setMinutePoints(code, trends);
        const sparkline = computeSparkline(trends);
        const cachedQ = cacheManager.getQuote(code);
        if (cachedQ) {
          cachedQ.sparkline = sparkline;
        }
        this.broadcast('minute_update', { code, points: trends, sparkline });
      }

      const details = await fetchEastmoneyDetails(code);
      if (details.length > 0) {
        cacheManager.appendTicks(code, details);
        this.broadcast('tick_update', { code, ticks: details });
      }
    } catch (e) {
      // 容错
    }
  }

  /**
   * 盘中轮询刷新全股票池的分时数据 (分批平滑轮询)
   */
  public async refreshPoolMinutesRound() {
    const session = getSessionState();
    if (session === 'CLOSED' || session === 'PRE_MARKET') return;

    const pool = cacheManager.getPool();
    if (pool.length === 0) return;

    const BATCH_SIZE = 6;
    const startIdx = this.minuteRefreshIndex % pool.length;
    const targetSlice = pool.slice(startIdx, startIdx + BATCH_SIZE);
    this.minuteRefreshIndex = (startIdx + BATCH_SIZE) % pool.length;

    for (const item of targetSlice) {
      try {
        const trends = await fetchEastmoneyTrends(item.code);
        if (trends && trends.length > 0) {
          cacheManager.setMinutePoints(item.code, trends);
          const sparkline = computeSparkline(trends);
          const q = cacheManager.getQuote(item.code);
          if (q) {
            q.sparkline = sparkline;
          }
          this.broadcast('minute_update', { code: item.code, points: trends, sparkline });
        }
      } catch (e) {
        // ignore
      }
      await new Promise(r => setTimeout(r, 60));
    }
  }

  public async warmupMinuteCache() {
    const pool = cacheManager.getPool();
    for (const item of pool) {
      if (cacheManager.getMinutePoints(item.code).length === 0) {
        try {
          const trends = await fetchEastmoneyTrends(item.code);
          if (trends && trends.length > 0) {
            cacheManager.setMinutePoints(item.code, trends);
            const sparkline = computeSparkline(trends);
            const q = cacheManager.getQuote(item.code);
            if (q) {
              q.sparkline = sparkline;
            }
          }
        } catch (e) {
          // ignore error on warm up
        }
        await new Promise(r => setTimeout(r, 60));
      }
    }
  }

  public getLastFetchTime() {
    return this.lastFetchTime;
  }
}

export const marketScheduler = new MarketScheduler();

