import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { cacheManager } from './server/cacheManager.ts';
import { marketScheduler } from './server/scheduler.ts';
import { verifyPassword, requireWriteAuth } from './server/auth.ts';
import { getSessionState, getShanghaiDate, isTradingDay } from './server/tradingCalendar.ts';
import { sourceCircuitBreakers } from './server/circuitBreaker.ts';
import { fetchEastmoneyTrends, fetchEastmoneyDetails, fetchTencentKline, fetchTencentQuotes } from './server/dataSources.ts';

const app = express();
const PORT = 3000;

app.use(express.json());

// ==================== 5.1 鉴权 API ====================
app.post('/api/auth/verify', (req: Request, res: Response) => {
  const { password } = req.body || {};
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const result = verifyPassword(password, clientIp);
  if (!result.success) {
    return res.status(result.status).json({ error: result.error, code: 'AUTH_FAILED' });
  }
  return res.json({ token: result.token, exp: result.exp });
});

// ==================== 5.2 股票池 API ====================
app.get('/api/pool', (_req: Request, res: Response) => {
  const pool = cacheManager.getPool();
  res.json(pool);
});

app.post('/api/pool/add', requireWriteAuth, async (req: Request, res: Response) => {
  try {
    const { code, name, industry_l1, sub_sector, tier, note } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: '必须提供股票代码', code: 'PARAM_MISSING' });
    }

    const cleanCode = String(code).replace(/^[a-zA-Z.]+/, '').padStart(6, '0');
    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ error: '股票代码必须为6位数字', code: 'INVALID_CODE' });
    }

    // 查重
    if (cacheManager.getPoolItem(cleanCode)) {
      return res.status(409).json({ error: `代码 ${cleanCode} 已存在于股票池中`, code: 'CODE_EXISTS' });
    }

    // 若名称未提供，尝试调用上游拉取一次静态信息补全 (Section 5.2)
    let resolvedName = name;
    if (!resolvedName) {
      try {
        const qMap = await fetchTencentQuotes([cleanCode]);
        const q = qMap.get(cleanCode);
        if (q && q.name) {
          resolvedName = q.name;
        }
      } catch (e) {
        // ignore
      }
    }

    const newItem = cacheManager.addPoolItem({
      code: cleanCode,
      name: resolvedName || `标的${cleanCode}`,
      industry_l1: industry_l1 || '其他',
      sub_sector: sub_sector || '自选标的',
      tier: tier || '备选观察',
      note: note || ''
    });

    // 触发一次即时 quote 抓取 (Section 5.2)
    marketScheduler.fetchQuotesRound().catch(() => {});

    return res.status(201).json(newItem);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || '新增失败', code: 'ADD_FAILED' });
  }
});

app.delete('/api/pool/:code', requireWriteAuth, (req: Request, res: Response) => {
  const { code } = req.params;
  const deleted = cacheManager.deletePoolItem(code);
  if (!deleted) {
    return res.status(404).json({ error: '未找到指定标的', code: 'NOT_FOUND' });
  }
  return res.status(204).send();
});

// ==================== 5.3 行情数据 API ====================
app.get('/api/quotes', (_req: Request, res: Response) => {
  const quotes = cacheManager.getQuotes().map(q => {
    const minutePoints = cacheManager.getMinutePoints(q.code);
    if (minutePoints.length > 0) {
      // 降采样至 24~30 个点，既保留真实走势波动，又保证轻量快速传输
      const step = Math.max(1, Math.floor(minutePoints.length / 28));
      const sparkline = minutePoints
        .filter((_, idx) => idx % step === 0 || idx === minutePoints.length - 1)
        .map(p => p.price);
      return { ...q, sparkline };
    }
    return q;
  });
  res.json(quotes);
});

app.get('/api/quotes/:code', (req: Request, res: Response) => {
  const { code } = req.params;
  const cleanCode = code.replace(/^[a-zA-Z.]+/, '');
  const quote = cacheManager.getQuote(cleanCode);
  if (!quote) {
    return res.status(404).json({ error: '未找到该标的行情数据', code: 'NOT_FOUND' });
  }
  const minutePoints = cacheManager.getMinutePoints(cleanCode);
  if (minutePoints.length > 0) {
    const step = Math.max(1, Math.floor(minutePoints.length / 28));
    const sparkline = minutePoints
      .filter((_, idx) => idx % step === 0 || idx === minutePoints.length - 1)
      .map(p => p.price);
    return res.json({ ...quote, sparkline });
  }
  res.json(quote);
});

app.get('/api/quotes/:code/minute', async (req: Request, res: Response) => {
  const { code } = req.params;
  const cleanCode = code.replace(/^[a-zA-Z.]+/, '');
  let points = cacheManager.getMinutePoints(cleanCode);

  // 若内存无缓存，立即主动从东财拉取一次
  if (points.length === 0) {
    try {
      points = await fetchEastmoneyTrends(cleanCode);
      if (points.length > 0) {
        cacheManager.setMinutePoints(cleanCode, points);
      }
    } catch (e) {
      // ignore
    }
  }
  res.json(points);
});

app.get('/api/quotes/:code/tick', async (req: Request, res: Response) => {
  const { code } = req.params;
  const after = req.query.after as string | undefined;
  const cleanCode = code.replace(/^[a-zA-Z.]+/, '');
  let ticks = cacheManager.getTicks(cleanCode, after);

  // 若首次获取为空，尝试调用上游
  if (ticks.length === 0 && !after) {
    try {
      const freshTicks = await fetchEastmoneyDetails(cleanCode);
      if (freshTicks.length > 0) {
        cacheManager.appendTicks(cleanCode, freshTicks);
        ticks = freshTicks;
      }
    } catch (e) {
      // ignore
    }
  }
  res.json(ticks);
});

// 历史复权 K 线 (日K/周K)
app.get('/api/quotes/:code/kline', async (req: Request, res: Response) => {
  const { code } = req.params;
  const period = (req.query.period as any) || 'day';
  const cleanCode = code.replace(/^[a-zA-Z.]+/, '');
  try {
    const klines = await fetchTencentKline(cleanCode, period, 80);
    res.json(klines);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'FETCH_KLINE_FAILED' });
  }
});

// 补充跟踪操作建议 (Section 9)
app.get('/api/notes/:code', (req: Request, res: Response) => {
  const { code } = req.params;
  const cleanCode = code.replace(/^[a-zA-Z.]+/, '');
  const note = cacheManager.getNote(cleanCode);
  if (!note) {
    return res.status(404).json({ error: '暂无补充跟踪建议', code: 'NOT_FOUND' });
  }
  res.json(note);
});

// 活跃查看标的登记与注销 (提高被查看股票的分时/逐笔刷新优先级)
app.post('/api/active-view', (req: Request, res: Response) => {
  const { code, action } = req.body || {};
  if (code) {
    const cleanCode = String(code).replace(/^[a-zA-Z.]+/, '');
    if (action === 'enter') {
      marketScheduler.registerViewingCode(cleanCode);
    } else {
      marketScheduler.unregisterViewingCode(cleanCode);
    }
  }
  res.json({ success: true });
});

// ==================== SSE 实时行情流 (Section 5.3) ====================
app.get('/api/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
  res.flushHeaders?.();

  // 发送初始已就绪事件
  res.write(`event: ready\ndata: ${JSON.stringify({ time: Date.now(), session: getSessionState() })}\n\n`);

  marketScheduler.addSseClient(res);
});

// ==================== 系统健康检查 (Section 5.3) ====================
app.get('/api/health', (_req: Request, res: Response) => {
  const shTime = getShanghaiDate();
  res.json({
    status: 'ok',
    session: getSessionState(),
    isTradingDay: isTradingDay(),
    shanghaiTime: `${shTime.dateStr} ${shTime.timeStr}`,
    sources: {
      eastmoney: sourceCircuitBreakers.eastmoney.getStatus(),
      tencent: sourceCircuitBreakers.tencent.getStatus(),
      sina: sourceCircuitBreakers.sina.getStatus(),
      netease: sourceCircuitBreakers.netease.getStatus()
    },
    poolCount: cacheManager.getPool().length,
    quotesCount: cacheManager.getQuotes().length,
    last_fetch_at: marketScheduler.getLastFetchTime()
  });
});

// ==================== Vite 或静态页面挂载 ====================
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] A股跟踪池后端服务运行在 http://0.0.0.0:${PORT}`);
  });
}

startServer();
