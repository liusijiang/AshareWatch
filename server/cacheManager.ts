import fs from 'fs';
import path from 'path';
import { StockPoolItem, QuoteSnapshot, MinutePoint, TickPoint, SupplementaryNote } from './types.ts';
import { codeToMarket, toSecid, toSinaSymbol } from './symbols.ts';
import { getShanghaiDate } from './tradingCalendar.ts';

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || 'data');
const POOL_FILE = path.join(DATA_DIR, 'pool.json');
const QUOTES_CACHE_FILE = path.join(DATA_DIR, 'quotes_cache.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const TICKS_DIR = path.join(DATA_DIR, 'ticks');

export class CacheManager {
  private poolMap = new Map<string, StockPoolItem>();
  private quotesCache = new Map<string, QuoteSnapshot>();
  private minuteCache = new Map<string, MinutePoint[]>();
  private tickRingBuffers = new Map<string, TickPoint[]>();
  private notesMap = new Map<string, SupplementaryNote>();
  private lastSaveTime = 0;

  constructor() {
    this.ensureDirs();
    this.initPool();
    this.loadQuotesCache();
    this.initNotes();
  }

  private ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(TICKS_DIR)) {
      fs.mkdirSync(TICKS_DIR, { recursive: true });
    }
  }

  /**
   * 初始化股票池 (Section 8: 种子数据加载)
   */
  private initPool() {
    if (fs.existsSync(POOL_FILE)) {
      try {
        const list: StockPoolItem[] = JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8'));
        for (const item of list) {
          this.poolMap.set(item.code, item);
        }
        console.log(`[CacheManager] 从 ${POOL_FILE} 加载了 ${this.poolMap.size} 只标的`);
        return;
      } catch (err) {
        console.error('[CacheManager] 读取 pool.json 失败，准备重新种子化', err);
      }
    }

    // 从 /DOC/stockpool.json 恢复种子数据
    const seedPath = path.resolve(process.cwd(), 'DOC/stockpool.json');
    if (fs.existsSync(seedPath)) {
      try {
        const rawSeed: any[] = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const now = Date.now();
        const initialList: StockPoolItem[] = rawSeed.map((s) => {
          const code = String(s.code).padStart(6, '0');
          const market = codeToMarket(code);
          return {
            code,
            market,
            secid: toSecid(code),
            sina_symbol: toSinaSymbol(code),
            name: s.name || '',
            industry_l1: s.ind || '综合',
            sub_sector: s.sub || '',
            tier: (s.tier || '重点观察') as any,
            logic: s.logic || '',
            risk: s.risk || '',
            source: 'seed',
            added_at: now
          };
        });

        for (const item of initialList) {
          this.poolMap.set(item.code, item);
        }
        this.savePool();
        console.log(`[CacheManager] 成功使用 DOC/stockpool.json 种子化了 ${initialList.length} 只股票`);
        return;
      } catch (e) {
        console.error('[CacheManager] 解析 DOC/stockpool.json 失败', e);
      }
    }

    // 默认兜底种子数据
    const defaultCodes = [
      { code: '300855', name: '图南股份', industry_l1: '军工', sub_sector: '高温合金(航发材料)', tier: '重点观察' },
      { code: '600519', name: '贵州茅台', industry_l1: '食品饮料', sub_sector: '白酒', tier: '重点观察' },
      { code: '688981', name: '中芯国际', industry_l1: '半导体', sub_sector: '晶圆代工', tier: '重点观察' },
      { code: '588000', name: '科创50ETF华夏', industry_l1: '基金/ETF', sub_sector: '宽基ETF', tier: '重点观察' },
    ];
    for (const d of defaultCodes) {
      const code = d.code;
      const market = codeToMarket(code);
      this.poolMap.set(code, {
        code,
        market,
        secid: toSecid(code),
        sina_symbol: toSinaSymbol(code),
        name: d.name,
        industry_l1: d.industry_l1,
        sub_sector: d.sub_sector,
        tier: d.tier as any,
        logic: '优质细分龙头',
        risk: '行业周期波动',
        source: 'seed',
        added_at: Date.now()
      });
    }
    this.savePool();
  }

  private savePool() {
    try {
      const list = Array.from(this.poolMap.values());
      fs.writeFileSync(POOL_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('[CacheManager] 保存 pool.json 失败', e);
    }
  }

  /**
   * 初始化补充跟踪建议 notes.json
   */
  private initNotes() {
    if (fs.existsSync(NOTES_FILE)) {
      try {
        const list: SupplementaryNote[] = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
        for (const n of list) {
          this.notesMap.set(n.code, n);
        }
        return;
      } catch (e) {
        // ignore
      }
    }

    // 从股票池中提取 logic/risk 生成基础补充说明
    const notesList: SupplementaryNote[] = [];
    const now = Date.now();
    for (const item of this.poolMap.values()) {
      if (item.logic || item.risk) {
        const note: SupplementaryNote = {
          code: item.code,
          name: item.name,
          logic_summary: item.logic || '行业景气度向好，核心壁垒深厚。',
          operation_advice: '建议结合分时走势低吸布局，不追高，破5日线减仓。',
          risk_note: item.risk || '注意市场风格切换与宏观流动性风险。',
          source_doc: '补充跟踪',
          parsed_at: now
        };
        this.notesMap.set(item.code, note);
        notesList.push(note);
      }
    }
    try {
      fs.writeFileSync(NOTES_FILE, JSON.stringify(notesList, null, 2), 'utf-8');
    } catch (e) {}
  }

  /**
   * 加载行情持久化缓存 (防止重启丢失, Section 1 & 7)
   */
  private loadQuotesCache() {
    if (fs.existsSync(QUOTES_CACHE_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(QUOTES_CACHE_FILE, 'utf-8'));
        for (const [code, q] of Object.entries(raw)) {
          this.quotesCache.set(code, q as QuoteSnapshot);
        }
        console.log(`[CacheManager] 从磁盘恢复了 ${this.quotesCache.size} 条行情快照缓存`);
      } catch (e) {
        console.error('[CacheManager] 读取 quotes_cache.json 异常', e);
      }
    }
  }

  public saveQuotesCache() {
    try {
      const obj: Record<string, QuoteSnapshot> = {};
      for (const [code, q] of this.quotesCache.entries()) {
        obj[code] = q;
      }
      fs.writeFileSync(QUOTES_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
      this.lastSaveTime = Date.now();
    } catch (e) {
      console.error('[CacheManager] 保存 quotes_cache.json 失败', e);
    }
  }

  // ==================== 股票池方法 ====================
  public getPool(): StockPoolItem[] {
    return Array.from(this.poolMap.values());
  }

  public getPoolItem(code: string): StockPoolItem | undefined {
    return this.poolMap.get(code);
  }

  public addPoolItem(input: {
    code: string;
    name?: string;
    industry_l1?: string;
    sub_sector?: string;
    tier?: string;
    note?: string;
    logic?: string;
    risk?: string;
  }): StockPoolItem {
    const cleanCode = input.code.replace(/^[a-zA-Z.]+/, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      throw new Error('股票代码必须为6位数字');
    }
    if (this.poolMap.has(cleanCode)) {
      throw new Error(`代码 ${cleanCode} 已存在于股票池中`);
    }

    const market = codeToMarket(cleanCode);
    const item: StockPoolItem = {
      code: cleanCode,
      market,
      secid: toSecid(cleanCode),
      sina_symbol: toSinaSymbol(cleanCode),
      name: input.name || `标的${cleanCode}`,
      industry_l1: input.industry_l1 || '其他',
      sub_sector: input.sub_sector || '自选细分',
      tier: (input.tier as any) || '备选观察',
      logic: input.logic || input.note || '',
      risk: input.risk || '',
      source: 'user_added',
      added_at: Date.now(),
      added_by_note: input.note
    };

    this.poolMap.set(cleanCode, item);
    this.savePool();
    return item;
  }

  public deletePoolItem(code: string): boolean {
    const cleanCode = code.replace(/^[a-zA-Z.]+/, '');
    const existed = this.poolMap.delete(cleanCode);
    if (existed) {
      this.savePool();
      this.quotesCache.delete(cleanCode);
      this.minuteCache.delete(cleanCode);
      this.tickRingBuffers.delete(cleanCode);
    }
    return existed;
  }

  // ==================== 行情快照方法 ====================
  public getQuotes(): QuoteSnapshot[] {
    return Array.from(this.quotesCache.values());
  }

  public getQuote(code: string): QuoteSnapshot | undefined {
    return this.quotesCache.get(code);
  }

  public updateQuote(snapshot: QuoteSnapshot) {
    this.quotesCache.set(snapshot.code, snapshot);
    // 定期 10 秒落盘防掉电
    if (Date.now() - this.lastSaveTime > 10 * 1000) {
      this.saveQuotesCache();
    }
  }

  public updateQuotesBatch(map: Map<string, QuoteSnapshot>) {
    for (const [code, snapshot] of map.entries()) {
      this.quotesCache.set(code, snapshot);
    }
    if (Date.now() - this.lastSaveTime > 10 * 1000) {
      this.saveQuotesCache();
    }
  }

  // ==================== 分时线方法 ====================
  public getMinutePoints(code: string): MinutePoint[] {
    return this.minuteCache.get(code) || [];
  }

  public setMinutePoints(code: string, points: MinutePoint[]) {
    this.minuteCache.set(code, points);
  }

  // ==================== 逐笔成交 (Tick) 方法 ====================
  public getTicks(code: string, afterTime?: string): TickPoint[] {
    const list = this.tickRingBuffers.get(code) || [];
    if (!afterTime) {
      return list;
    }
    return list.filter(t => t.time > afterTime);
  }

  public appendTicks(code: string, newTicks: TickPoint[]) {
    let buf = this.tickRingBuffers.get(code);
    if (!buf) {
      buf = [];
      this.tickRingBuffers.set(code, buf);
    }
    buf.push(...newTicks);
    // Ring buffer 限制每 code 最多保留 2000 条 (Section 4.4)
    if (buf.length > 2000) {
      buf.splice(0, buf.length - 2000);
    }

    // 异步追加落盘到 data/ticks/{code}/{yyyy-mm-dd}.jsonl
    this.appendTicksToDisk(code, newTicks);
  }

  private appendTicksToDisk(code: string, ticks: TickPoint[]) {
    if (ticks.length === 0) return;
    try {
      const { dateStr } = getShanghaiDate();
      const codeDir = path.join(TICKS_DIR, code);
      if (!fs.existsSync(codeDir)) {
        fs.mkdirSync(codeDir, { recursive: true });
      }
      const tickFile = path.join(codeDir, `${dateStr}.jsonl`);
      const lines = ticks.map(t => JSON.stringify(t)).join('\n') + '\n';
      fs.appendFileSync(tickFile, lines, 'utf-8');
    } catch (e) {
      // 容错日志
    }
  }

  // ==================== 补充跟踪信息 ====================
  public getNote(code: string): SupplementaryNote | undefined {
    return this.notesMap.get(code);
  }
}

export const cacheManager = new CacheManager();
