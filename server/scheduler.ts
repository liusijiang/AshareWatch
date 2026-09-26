import { Response } from 'express';
import { cacheManager } from './cacheManager.ts';
import { getSessionState, isTradingDay, getShanghaiDate } from './tradingCalendar.ts';
import { fetchTencentQuotes, fetchSinaQuotes, fetchEastmoneyTrends, fetchEastmoneyDetails, validateQuote } from './dataSources.ts';
import { sourceCircuitBreakers } from './circuitBreaker.ts';
import { QuoteSnapshot } from './types.ts';

class MarketScheduler {
  private sseClients = new Set<Response>();
  private isRunning = false;
  private quoteTimer: NodeJS.Timeout | null = null;
  private detailTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastFetchTime = 0;
  private activeViewingCodes = new Set<string>();

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
      this.broadcast('ping', { time: Date.now() });
    }, 15000);

    // 核心循环：动态根据时段调整频率 (Section 4.2)
    this.scheduleNextTick();

    // 针对正在查看详情的标的拉取分时/逐笔 (每 5 秒)
    this.detailTimer = setInterval(() => {
      this.fetchActiveDetailsRound();
    }, 5000);

    // 启动后异步温和预热全股票池分时数据，使缩略图快速获得高精度真实走势
    setTimeout(() => {
      this.warmupMinuteCache().catch(e => console.error('[Scheduler] 预热分时异常', e.message));
    }, 1000);
  }

  private scheduleNextTick() {
    const session = getSessionState();
    let delayMs = 3000; // 默认 3 秒 (MORNING / AFTERNOON / AUCTION)

    if (session === 'LUNCH_BREAK') {
      delayMs = 30000; // 午休 30 秒 (Section 4.2)
    } else if (session === 'CLOSED') {
      // 盘后休市，降低频率至 60 秒轮询保活或等待次日开盘
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
    // 超过 80 只标的分批抓取 (Section 3.4)
    const BATCH_SIZE = 80;
    const batches: string[][] = [];
    for (let i = 0; i < allCodes.length; i += BATCH_SIZE) {
      batches.push(allCodes.slice(i, i + BATCH_SIZE));
    }

    const updatedSnapshots: QuoteSnapshot[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batchCodes = batches[i];
      if (i > 0) {
        // 批次间错开 100ms 防止限流 (Section 3.4)
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

      // 优先级 2: 新浪财经批量 (若腾讯不可用或熔断)
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
            cacheManager.updateQuote(fresh);
            updatedSnapshots.push(fresh);
          } else if (cached) {
            // 校验失败保留旧数据，标记为 stale
            cached.is_stale = true;
          }
        }
      }
    }

    this.lastFetchTime = Date.now();

    // 通过 SSE 广播变动的 quote (Section 5.3)
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
          timestamp: q.timestamp
        });
      }
    }
  }

  /**
   * 针对当前用户正在激活查看的股票拉取分时/逐笔成交
   */
  private async fetchActiveDetailsRound() {
    const session = getSessionState();
    // 仅在开盘时段或初次查看时抓取
    if (this.activeViewingCodes.size === 0) return;

    for (const code of this.activeViewingCodes) {
      try {
        const trends = await fetchEastmoneyTrends(code);
        if (trends.length > 0) {
          cacheManager.setMinutePoints(code, trends);
          this.broadcast('minute_update', { code, points: trends });
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
  }

  public async warmupMinuteCache() {
    const pool = cacheManager.getPool();
    for (const item of pool) {
      if (cacheManager.getMinutePoints(item.code).length === 0) {
        try {
          const trends = await fetchEastmoneyTrends(item.code);
          if (trends && trends.length > 0) {
            cacheManager.setMinutePoints(item.code, trends);
          }
        } catch (e) {
          // ignore error on warm up
        }
        // 错开 60ms 平滑抓取
        await new Promise(r => setTimeout(r, 60));
      }
    }
  }

  public getLastFetchTime() {
    return this.lastFetchTime;
  }
}

export const marketScheduler = new MarketScheduler();
