import React, { useState, useEffect } from 'react';
import {
  X,
  TrendingUp,
  TrendingDown,
  Layers,
  Clock,
  ShieldAlert,
  Lightbulb,
  FileText,
  Trash2,
  Activity,
  BarChart3,
  Calendar
} from 'lucide-react';
import { StockPoolItem, QuoteSnapshot, MinutePoint, TickPoint, KlinePoint, SupplementaryNote } from '../types.ts';
import { MinuteChart } from './MinuteChart.tsx';
import { KlineChart } from './KlineChart.tsx';

interface Props {
  stock: StockPoolItem;
  quote?: QuoteSnapshot;
  onClose: () => void;
  onDeleteStock: (code: string) => void;
  onRequestAuth: () => void;
  token: string | null;
}

export const StockDetailPage: React.FC<Props> = ({
  stock,
  quote,
  onClose,
  onDeleteStock,
  onRequestAuth,
  token
}) => {
  const [activeTab, setActiveTab] = useState<'minute' | 'kline' | 'ticks' | 'notes'>('minute');
  const [klinePeriod, setKlinePeriod] = useState<'day' | 'week' | 'month'>('day');
  const [minutePoints, setMinutePoints] = useState<MinutePoint[]>([]);
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [klines, setKlines] = useState<KlinePoint[]>([]);
  const [note, setNote] = useState<SupplementaryNote | null>(null);
  const [loadingMinute, setLoadingMinute] = useState(false);
  const [loadingKline, setLoadingKline] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 挂载时告知后端提高该标的轮询权重 (Section 5.3)
  useEffect(() => {
    fetch('/api/active-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: stock.code, action: 'enter' })
    }).catch(() => {});

    // 加载分时、逐笔、补充说明
    loadMinuteData();
    loadTickData();
    loadNoteData();

    return () => {
      fetch('/api/active-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: stock.code, action: 'leave' })
      }).catch(() => {});
    };
  }, [stock.code]);

  const loadMinuteData = async () => {
    setLoadingMinute(true);
    try {
      const res = await fetch(`/api/quotes/${stock.code}/minute`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMinutePoints(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMinute(false);
    }
  };

  const loadTickData = async () => {
    try {
      const res = await fetch(`/api/quotes/${stock.code}/tick`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setTicks(data.slice(-50).reverse()); // 最新在前
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadKlineData = async (period: 'day' | 'week' | 'month' = klinePeriod) => {
    setLoadingKline(true);
    try {
      const res = await fetch(`/api/quotes/${stock.code}/kline?period=${period}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setKlines(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingKline(false);
    }
  };

  const loadNoteData = async () => {
    try {
      const res = await fetch(`/api/notes/${stock.code}`);
      if (res.ok) {
        const data = await res.json();
        setNote(data);
      }
    } catch (e) {
      // ignore
    }
  };

  const handleDelete = async () => {
    if (!token) {
      onRequestAuth();
      return;
    }

    if (!confirm(`确定要将 ${stock.name} (${stock.code}) 从跟踪池中移除吗？`)) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/pool/${stock.code}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok || res.status === 204) {
        onDeleteStock(stock.code);
        onClose();
      } else {
        alert('删除标的失败，请确认管理授权');
      }
    } catch (err: any) {
      alert(err.message || '网络异常');
    } finally {
      setDeleting(false);
    }
  };

  const isUp = (quote?.change_pct ?? 0) > 0;
  const isDown = (quote?.change_pct ?? 0) < 0;
  const priceColor = isUp ? 'text-rose-400' : isDown ? 'text-emerald-400' : 'text-slate-200';
  const bgColor = isUp ? 'bg-rose-500/10' : isDown ? 'bg-emerald-500/10' : 'bg-slate-800';

  const maxOrderVol = Math.max(
    ...(quote?.bid.map(b => b[1]) || [1]),
    ...(quote?.ask.map(a => a[1]) || [1]),
    1
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-end bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-4xl h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
        {/* 顶部标题栏 */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-slate-800 text-slate-300">
              {stock.market}.{stock.code}
            </span>
            <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
              <span>{stock.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-normal ${
                stock.tier === '重点观察' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                stock.tier === '候补观察' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                'bg-slate-700/40 text-slate-300'
              }`}>
                {stock.tier}
              </span>
            </h2>
            <span className="text-xs text-slate-400 hidden sm:inline">
              {stock.industry_l1} · {stock.sub_sector}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="从跟踪池移除标的"
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 实时行情核心看板 (QuoteHeader) */}
        <div className="px-6 py-4 bg-slate-950/60 border-b border-slate-800">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* 价格与涨跌幅 */}
            <div className="flex items-baseline space-x-4">
              <span className={`text-4xl font-extrabold font-mono tracking-tight ${priceColor}`}>
                ¥{quote?.price ? quote.price.toFixed(2) : '--'}
              </span>
              <div className="flex flex-col">
                <div className={`flex items-center text-sm font-bold font-mono ${priceColor}`}>
                  {isUp ? <TrendingUp className="w-4 h-4 mr-0.5" /> : isDown ? <TrendingDown className="w-4 h-4 mr-0.5" /> : null}
                  <span>{isUp ? '+' : ''}{quote?.change ? quote.change.toFixed(2) : '0.00'}</span>
                  <span className="ml-1.5">({isUp ? '+' : ''}{quote?.change_pct ? quote.change_pct.toFixed(2) : '0.00'}%)</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono mt-0.5">
                  更新: {quote?.timestamp ? new Date(quote.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '--'} ({quote?.source || '多源对齐'})
                </span>
              </div>
            </div>

            {/* 当日指标栅格 */}
            <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs font-mono">
              <div>
                <span className="text-slate-500 block">今开:</span>
                <span className="text-slate-200 font-semibold">¥{quote?.open?.toFixed(2) || '--'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">最高:</span>
                <span className="text-rose-400 font-semibold">¥{quote?.high?.toFixed(2) || '--'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">成交量:</span>
                <span className="text-slate-200 font-semibold">{(quote?.volume || 0).toLocaleString()} 手</span>
              </div>
              <div>
                <span className="text-slate-500 block">昨收:</span>
                <span className="text-slate-400 font-semibold">¥{quote?.prev_close?.toFixed(2) || '--'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">最低:</span>
                <span className="text-emerald-400 font-semibold">¥{quote?.low?.toFixed(2) || '--'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">成交额:</span>
                <span className="text-slate-200 font-semibold">{((quote?.amount || 0) / 100000000).toFixed(2)} 亿元</span>
              </div>
            </div>

            {/* 买卖五档盘口 */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-[11px] font-mono space-y-1">
              <div className="text-slate-400 flex justify-between border-b border-slate-800/80 pb-1 text-[10px]">
                <span>盘口</span>
                <span>申报价格</span>
                <span>挂单量(手)</span>
              </div>
              {/* 卖五到卖一 */}
              {(quote?.ask || []).slice(0, 3).reverse().map((a, i) => (
                <div key={`ask-${i}`} className="relative flex justify-between items-center text-emerald-400">
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded"
                    style={{ width: `${Math.min(100, (a[1] / maxOrderVol) * 100)}%` }}
                  />
                  <span className="text-slate-500 text-[10px]">卖{3 - i}</span>
                  <span>¥{a[0].toFixed(2)}</span>
                  <span>{a[1]}</span>
                </div>
              ))}
              {/* 买一到买三 */}
              {(quote?.bid || []).slice(0, 3).map((b, i) => (
                <div key={`bid-${i}`} className="relative flex justify-between items-center text-rose-400">
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none rounded"
                    style={{ width: `${Math.min(100, (b[1] / maxOrderVol) * 100)}%` }}
                  />
                  <span className="text-slate-500 text-[10px]">买{i + 1}</span>
                  <span>¥{b[0].toFixed(2)}</span>
                  <span>{b[1]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tab 导航 */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 bg-slate-900/40">
          <div className="flex -mb-px">
            {[
              { id: 'minute', label: '当日分时走势 (1-min)', icon: Activity },
              { id: 'kline', label: '复权K线', icon: BarChart3 },
              { id: 'ticks', label: '逐笔成交明细', icon: Clock },
              { id: 'notes', label: '核心逻辑与操作建议', icon: Lightbulb },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === 'kline') {
                      loadKlineData(klinePeriod);
                    }
                  }}
                  className={`flex items-center space-x-1.5 py-3 px-4 text-xs font-medium border-b-2 transition ${
                    active
                      ? 'border-blue-500 text-blue-400 font-bold'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {activeTab === 'kline' && (
            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 my-1.5">
              {[
                { id: 'day', label: '日K' },
                { id: 'week', label: '周K' },
                { id: 'month', label: '月K' }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    const newPeriod = p.id as 'day' | 'week' | 'month';
                    setKlinePeriod(newPeriod);
                    loadKlineData(newPeriod);
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition ${
                    klinePeriod === p.id
                      ? 'bg-blue-600 text-white font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 内容滚动区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Tab 1: 分时图 */}
          {activeTab === 'minute' && (
            <div className="space-y-4">
              <MinuteChart points={minutePoints} prevClose={quote?.prev_close || 0} />
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>分时走势由上游 1 分钟趋势数据与内存环形缓冲实时聚合</span>
                <button
                  onClick={loadMinuteData}
                  disabled={loadingMinute}
                  className="text-blue-400 hover:underline"
                >
                  {loadingMinute ? '拉取中...' : '刷新分时'}
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: 日K/周K/月K线 */}
          {activeTab === 'kline' && (
            <div className="space-y-4">
              {loadingKline ? (
                <div className="h-[320px] flex items-center justify-center text-slate-400 text-xs">
                  正在拉取前复权{klinePeriod === 'week' ? '周K' : klinePeriod === 'month' ? '月K' : '日K'}线数据...
                </div>
              ) : (
                <KlineChart data={klines} period={klinePeriod} />
              )}
            </div>
          )}

          {/* Tab 3: 逐笔成交 */}
          {activeTab === 'ticks' && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-xs text-slate-400">
                <span>逐笔明细 (最近 50 笔)</span>
                <span className="flex items-center text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                  交易时段实时更新
                </span>
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full text-xs font-mono text-left">
                  <thead className="text-[11px] text-slate-500 bg-slate-900/60 sticky top-0">
                    <tr>
                      <th className="px-4 py-2">时间</th>
                      <th className="px-4 py-2">成交价</th>
                      <th className="px-4 py-2 text-right">现手</th>
                      <th className="px-4 py-2 text-center">盘向</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {ticks.map((t, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/40">
                        <td className="px-4 py-1.5 text-slate-400">{t.time}</td>
                        <td className="px-4 py-1.5 font-bold text-slate-100">¥{t.price.toFixed(2)}</td>
                        <td className="px-4 py-1.5 text-right text-slate-300">{t.volume}</td>
                        <td className="px-4 py-1.5 text-center">
                          {t.direction === 'B' ? (
                            <span className="text-rose-400 font-bold">买盘</span>
                          ) : t.direction === 'S' ? (
                            <span className="text-emerald-400 font-bold">卖盘</span>
                          ) : (
                            <span className="text-slate-500">中性</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 4: 逻辑与补充跟踪 */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              {/* 投资逻辑 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-center space-x-2 text-amber-400 text-sm font-bold">
                  <Lightbulb className="w-4 h-4" />
                  <span>核心投资逻辑 (Logic)</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {stock.logic || '暂无详细记录，建议持续关注其订单释放与估值性价比。'}
                </p>
              </div>

              {/* 风险点 */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-center space-x-2 text-rose-400 text-sm font-bold">
                  <ShieldAlert className="w-4 h-4" />
                  <span>风险提示 (Risk Factors)</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {stock.risk || '注意市场风格剧烈轮动与行业周期下行风险。'}
                </p>
              </div>

              {/* 补充跟踪操作建议 */}
              {note && (
                <div className="bg-blue-950/20 border border-blue-800/40 rounded-xl p-5 space-y-3">
                  <div className="flex items-center space-x-2 text-blue-400 text-sm font-bold">
                    <FileText className="w-4 h-4" />
                    <span>补充跟踪建议 (专家跟踪视角)</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">🔹 操作策略：</span>
                      <p className="text-slate-200">{note.operation_advice}</p>
                    </div>
                    {note.risk_note && (
                      <div>
                        <span className="text-slate-400 block font-semibold mb-0.5">🔹 特别警示：</span>
                        <p className="text-slate-300">{note.risk_note}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
