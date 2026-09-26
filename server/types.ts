export interface StockPoolItem {
  code: string;            // 6位数字代码, e.g. "600519"
  market: "SH" | "SZ";     // 由code首位推导: '6'->SH, '0'|'3'->SZ, "688"/"689"->SH(科创), "300"/"301"->SZ(创业)
  secid: string;           // 东方财富格式 "1.600519" (SH=1) / "0.000001" (SZ=0)
  sina_symbol: string;     // 新浪/腾讯格式 "sh600519" / "sz000001"
  name: string;
  industry_l1: string;     // 申万一级行业
  sub_sector: string;      // 细分赛道
  tier: "重点观察" | "候补观察" | "备选观察";
  logic: string;           // 投资逻辑摘要
  risk: string;            // 风险点摘要
  source: "seed" | "user_added";
  added_at: number;        // epoch ms
  added_by_note?: string;  // 用户新增时的备注, 可空
}

export interface QuoteSnapshot {
  code: string;
  name: string;
  price: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;          // 手
  amount: number;          // 成交额(元)
  change: number;
  change_pct: number;
  bid: [number, number][]; // 5档买盘 [价格,量]
  ask: [number, number][]; // 5档卖盘
  timestamp: number;       // 数据时间戳(epoch ms)
  source: "eastmoney" | "tencent" | "sina" | "netease";
  is_stale: boolean;       // 超过TTL未刷新时置true
  fetched_at: number;
  sparkline?: number[];    // 当日真实分时抽样走势点位 (缩略图专用)
}

export interface TickPoint {
  code: string;
  time: string;   // "HH:mm:ss"
  price: number;
  volume: number; // 该笔成交量(手)
  direction: "B" | "S" | "N"; // 主动买/卖/中性
}

export interface MinutePoint {
  code: string;
  time: string;    // "HH:mm"
  avg_price: number; // 均价线值
  price: number;
  volume: number;   // 该分钟累计成交量
  amount: number;
}

export interface KlinePoint {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface AuthTokenPayload {
  iat: number;
  exp: number;      // iat + 24h
  scope: "write";
}

export interface SupplementaryNote {
  code: string;
  name: string;
  logic_summary: string;   // 对应"逻辑"段落
  operation_advice: string; // 对应"操作"段落
  risk_note?: string;       // 若有"风险"段落
  source_doc: "补充跟踪";
  parsed_at: number;
}

export type TradingSession = "PRE_MARKET" | "AUCTION" | "MORNING" | "LUNCH_BREAK" | "AFTERNOON" | "CLOSED";
