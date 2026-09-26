export interface StockPoolItem {
  code: string;
  market: "SH" | "SZ";
  secid: string;
  sina_symbol: string;
  name: string;
  industry_l1: string;
  sub_sector: string;
  tier: "重点观察" | "候补观察" | "备选观察";
  logic: string;
  risk: string;
  source: "seed" | "user_added";
  added_at: number;
  added_by_note?: string;
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
  timestamp: number;
  source: "eastmoney" | "tencent" | "sina" | "netease";
  is_stale: boolean;
  fetched_at: number;
  sparkline?: number[];
}

export interface TickPoint {
  code: string;
  time: string;
  price: number;
  volume: number;
  direction: "B" | "S" | "N";
}

export interface MinutePoint {
  code: string;
  time: string;
  avg_price: number;
  price: number;
  volume: number;
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

export interface SupplementaryNote {
  code: string;
  name: string;
  logic_summary: string;
  operation_advice: string;
  risk_note?: string;
  source_doc: "补充跟踪";
  parsed_at: number;
}

export type TradingSession = "PRE_MARKET" | "AUCTION" | "MORNING" | "LUNCH_BREAK" | "AFTERNOON" | "CLOSED";
