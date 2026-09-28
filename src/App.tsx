import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  Plus,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Layers,
  Clock,
  Shield,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Flame,
  Tag,
  GitCommit
} from 'lucide-react';
import { StockPoolItem, QuoteSnapshot, TradingSession, MinutePoint, TickPoint, HealthInfo } from './types.ts';
import { APP_VERSION, CODE_LAST_MODIFIED } from './version.ts';
import { PasswordGateModal } from './components/PasswordGateModal.tsx';
import { AddStockDrawer } from './components/AddStockDrawer.tsx';
import { MarketDetailPanel } from './components/MarketDetailPanel.tsx';
import { MiniSparkline } from './components/MiniSparkline.tsx';
import { StockAccordionDetail } from './components/StockAccordionDetail.tsx';

export default function App() {
  const [pool, setPool] = useState<StockPoolItem[]>([]);
  const [quotes, setQuotes] = useState<Map<string, QuoteSnapshot>>(new Map());
  const [session, setSession] = useState<TradingSession>('CLOSED');
  const [shanghaiClock, setShanghaiClock] = useState<string>('');
  const [sseConnected, setSseConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // 移动端和平板竖版展开项状态 (点击其他项自动收起前一项并展开新项)
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [mobileDetailModalCode, setMobileDetailModalCode] = useState<string | null>(null);

  // 筛选与视图
  const [search, setSearch] = useState('');
  const [selectedTier, setSelectedTier] = useState<string>('全部');
  const [selectedSubSector, setSelectedSubSector] = useState<string>('全部');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('全部');
  const [sortBy, setSortBy] = useState<'change_desc' | 'change_asc' | 'amount_desc' | 'price_desc' | 'code_asc'>('change_desc');

  // 当前选中的股票 (默认选中首个或图南股份)
  const [selectedCode, setSelectedCode] = useState<string>('');
  const selectedCodeRef = useRef(selectedCode);
  useEffect(() => {
    selectedCodeRef.current = selectedCode;
  }, [selectedCode]);

  const [realtimeMinutes, setRealtimeMinutes] = useState<{ code: string; points: MinutePoint[] } | null>(null);
  const [realtimeTicks, setRealtimeTicks] = useState<{ code: string; ticks: TickPoint[] } | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [token, setToken] = useState<string | null>(localStorage.getItem('admin_token'));
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [versionInfo, setVersionInfo] = useState({
    version: APP_VERSION,
    lastModified: CODE_LAST_MODIFIED
  });
  const [showHealthModal, setShowHealthModal] = useState(false);

  // 1. 初始化拉取股票池和初始行情，并建立定时健康检查
  useEffect(() => {
    fetchPool();
    fetchQuotes();
    fetchHealth();

    // 本地北京时间时钟
    const clockTimer = setInterval(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
      setShanghaiClock(timeStr);
    }, 1000);

    // 盘中定时全量数据同步对齐 (每 25 秒)，保证即使在低频时段全池缩略图与统计指标与后端严格一致
    const syncTimer = setInterval(() => {
      fetchQuotes();
      fetchHealth();
    }, 25000);

    return () => {
      clearInterval(clockTimer);
      clearInterval(syncTimer);
    };
  }, []);

  // 2. 建立 SSE 实时推流连接
  useEffect(() => {
    let es: EventSource | null = null;
    let pollFallbackTimer: NodeJS.Timeout | null = null;
    let failCount = 0;

    const connectSSE = () => {
      try {
        es = new EventSource('/api/stream');

        es.onopen = () => {
          setSseConnected(true);
          failCount = 0;
          if (pollFallbackTimer) {
            clearInterval(pollFallbackTimer);
            pollFallbackTimer = null;
          }
        };

        // 接收高频行情快照广播
        es.addEventListener('quote_update', (e) => {
          const item = JSON.parse(e.data);
          setQuotes((prev) => {
            const next = new Map(prev);
            const old = next.get(item.code);

            // 保持 sparkline 全天真实分时轨迹：若上游带有 sparkline 则同步，否则仅更新末尾最新价点位
            let sparkline = item.sparkline || old?.sparkline;
            if (sparkline && sparkline.length > 0) {
              sparkline = [...sparkline];
              sparkline[sparkline.length - 1] = item.price;
            } else if (item.price > 0) {
              sparkline = [old?.open || item.price, item.price];
            }

            const merged: QuoteSnapshot = {
              ...(old || {
                code: item.code,
                name: item.name || '',
                price: item.price,
                prev_close: item.price - (item.change || 0),
                open: item.price,
                high: item.high || item.price,
                low: item.low || item.price,
                volume: item.volume || 0,
                amount: item.amount || 0,
                change: item.change || 0,
                change_pct: item.change_pct || 0,
                bid: [],
                ask: [],
                timestamp: item.timestamp,
                source: 'tencent',
                is_stale: false,
                fetched_at: Date.now()
              }),
              price: item.price,
              change: item.change,
              change_pct: item.change_pct,
              high: item.high || old?.high || item.price,
              low: item.low || old?.low || item.price,
              volume: item.volume || old?.volume || 0,
              amount: item.amount || old?.amount || 0,
              timestamp: item.timestamp,
              fetched_at: Date.now(),
              sparkline
            };
            next.set(item.code, merged);
            return next;
          });
        });

        // 接收分时数据更新
        es.addEventListener('minute_update', (e) => {
          const data = JSON.parse(e.data);
          const { code, points, sparkline } = data;
          if (code && Array.isArray(points)) {
            // 同步列表缩略图
            setQuotes((prev) => {
              const next = new Map(prev);
              const old = next.get(code);
              if (old) {
                next.set(code, {
                  ...old,
                  sparkline: sparkline || old.sparkline
                });
              }
              return next;
            });

            // 若为当前正在激活查看的股票，推送给详情图表
            if (code === selectedCodeRef.current) {
              setRealtimeMinutes({ code, points });
            }
          }
        });

        // 接收逐笔成交更新
        es.addEventListener('tick_update', (e) => {
          const data = JSON.parse(e.data);
          const { code, ticks } = data;
          if (code === selectedCodeRef.current && Array.isArray(ticks)) {
            setRealtimeTicks({ code, ticks });
          }
        });

        // 接收交易时段切换 (如午休切换到午后开盘)
        es.addEventListener('session_change', (e) => {
          const d = JSON.parse(e.data);
          if (d.session) {
            setSession(d.session);
            fetchQuotes();
            fetchHealth();
          }
        });

        // SSE 初始化完成事件
        es.addEventListener('ready', (e) => {
          const d = JSON.parse(e.data);
          if (d.session) setSession(d.session);
          if (d.version || d.lastModified) {
            setVersionInfo({
              version: d.version || APP_VERSION,
              lastModified: d.lastModified || CODE_LAST_MODIFIED
            });
          }
        });

        es.onerror = () => {
          setSseConnected(false);
          es?.close();
          failCount++;
          if (failCount >= 2 && !pollFallbackTimer) {
            pollFallbackTimer = setInterval(fetchQuotes, 5000);
          }
          setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        setSseConnected(false);
      }
    };

    connectSSE();

    return () => {
      es?.close();
      if (pollFallbackTimer) clearInterval(pollFallbackTimer);
    };
  }, []);

  const fetchPool = async () => {
    try {
      const res = await fetch('/api/pool');
      const data = await res.json();
      if (Array.isArray(data)) {
        setPool(data);
        if (data.length > 0 && !selectedCode) {
          // 优先选中图南股份或首个股票
          const target = data.find(p => p.code === '300855') || data[0];
          setSelectedCode(target.code);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotes = async () => {
    try {
      const res = await fetch('/api/quotes');
      const list: QuoteSnapshot[] = await res.json();
      if (Array.isArray(list)) {
        setQuotes((prev) => {
          const next = new Map(prev);
          for (const q of list) {
            const old = next.get(q.code);
            next.set(q.code, {
              ...old,
              ...q,
              sparkline: q.sparkline && q.sparkline.length > 0 ? q.sparkline : old?.sparkline
            });
          }
          return next;
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health');
      const data: HealthInfo = await res.json();
      setHealthInfo(data);
      if (data.session) setSession(data.session);
      if (data.version || data.lastModified) {
        setVersionInfo({
          version: data.version || APP_VERSION,
          lastModified: data.lastModified || CODE_LAST_MODIFIED
        });
      }
    } catch (e) {
      // ignore
    }
  };

  const handleOpenAddStock = () => {
    if (!token) {
      setIsAuthModalOpen(true);
    } else {
      setIsAddDrawerOpen(true);
    }
  };

  const handleAuthSuccess = (newToken: string) => {
    setToken(newToken);
    setIsAddDrawerOpen(true);
  };

  const handleStockAdded = (newItem: StockPoolItem) => {
    setPool(prev => [newItem, ...prev]);
    setSelectedCode(newItem.code);
    fetchQuotes();
  };

  const handleDeleteStock = (code: string) => {
    setPool(prev => {
      const next = prev.filter(p => p.code !== code);
      if (selectedCode === code) {
        setSelectedCode(next[0]?.code || '');
      }
      return next;
    });
    if (expandedCode === code) {
      setExpandedCode(null);
    }
    setQuotes(prev => {
      const next = new Map(prev);
      next.delete(code);
      return next;
    });
  };

  const handleItemClick = (code: string) => {
    setSelectedCode(code);
    // 在移动端和平板竖屏上，点击当前展开项则收起，点击未展开项则收起其他项并展开当前项
    setExpandedCode(prev => (prev === code ? null : code));
  };

  // 申万行业与细分赛道 (sub) 汇总清单
  const industries = useMemo(() => {
    const set = new Set<string>();
    pool.forEach(p => {
      if (p.industry_l1) set.add(p.industry_l1);
    });
    return ['全部', ...Array.from(set)];
  }, [pool]);

  const subSectors = useMemo(() => {
    const set = new Set<string>();
    pool.forEach(p => {
      if (p.sub_sector) set.add(p.sub_sector);
    });
    return ['全部', ...Array.from(set).slice(0, 30)];
  }, [pool]);

  // 统计概览
  const stats = useMemo(() => {
    let upCount = 0;
    let downCount = 0;
    let flatCount = 0;
    let totalChange = 0;
    let validCount = 0;

    for (const p of pool) {
      const q = quotes.get(p.code);
      if (q && q.price > 0) {
        validCount++;
        totalChange += q.change_pct;
        if (q.change_pct > 0) upCount++;
        else if (q.change_pct < 0) downCount++;
        else flatCount++;
      }
    }

    const avgChange = validCount > 0 ? (totalChange / validCount).toFixed(2) : '0.00';
    return { upCount, downCount, flatCount, avgChange, total: pool.length };
  }, [pool, quotes]);

  // 过滤与排序
  const filteredPool = useMemo(() => {
    return pool.filter(item => {
      if (selectedTier !== '全部' && item.tier !== selectedTier) return false;
      if (selectedIndustry !== '全部' && item.industry_l1 !== selectedIndustry) return false;
      if (selectedSubSector !== '全部' && item.sub_sector !== selectedSubSector) return false;
      if (search) {
        const q = search.toLowerCase();
        return item.code.includes(q) || item.name.toLowerCase().includes(q) || (item.sub_sector || '').toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => {
      const qa = quotes.get(a.code);
      const qb = quotes.get(b.code);
      if (sortBy === 'change_desc') return (qb?.change_pct ?? -999) - (qa?.change_pct ?? -999);
      if (sortBy === 'change_asc') return (qa?.change_pct ?? 999) - (qb?.change_pct ?? 999);
      if (sortBy === 'amount_desc') return (qb?.amount ?? 0) - (qa?.amount ?? 0);
      if (sortBy === 'price_desc') return (qb?.price ?? 0) - (qa?.price ?? 0);
      if (sortBy === 'code_asc') return a.code.localeCompare(b.code);
      return 0;
    });
  }, [pool, quotes, selectedTier, selectedIndustry, selectedSubSector, search, sortBy]);

  // 当前选中的标的实体
  const currentStock = useMemo(() => {
    return pool.find(p => p.code === selectedCode) || filteredPool[0] || pool[0] || null;
  }, [pool, filteredPool, selectedCode]);

  // 交易时段指示徽章
  const sessionBadge = useMemo(() => {
    switch (session) {
      case 'MORNING':
      case 'AFTERNOON':
        return { text: '连续竞价', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse' };
      case 'AUCTION':
        return { text: '集合竞价', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'LUNCH_BREAK':
        return { text: '午间休盘', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' };
      case 'PRE_MARKET':
        return { text: '盘前准备', color: 'bg-slate-700 text-slate-300 border-slate-600' };
      default:
        return { text: '已收盘', color: 'bg-slate-800 text-slate-400 border-slate-700' };
    }
  }, [session]);

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* 顶部紧凑状态与导航条 (高度从原本的 72px 压缩到 42px) */}
      <header className="h-10 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 select-none z-20">
        <div className="flex items-center space-x-2">
          <div className="p-1 bg-blue-600 text-white rounded-md">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-xs text-slate-100 tracking-tight">
            A股精选跟踪池
          </span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium border ${sessionBadge.color}`}>
            {sessionBadge.text}
          </span>

          {/* 极简实时指标胶囊 */}
          <div className="hidden sm:flex items-center space-x-2 text-[11px] font-mono text-slate-400 pl-2 border-l border-slate-800">
            <span>池:{stats.total}</span>
            <span className="text-rose-400 font-semibold">涨:{stats.upCount}</span>
            <span className="text-emerald-400 font-semibold">跌:{stats.downCount}</span>
            <span>平:{stats.flatCount}</span>
            <span className={Number(stats.avgChange) >= 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
              均:{Number(stats.avgChange) > 0 ? '+' : ''}{stats.avgChange}%
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono">
          {/* 版本号与代码最后修改时间 (右上角常驻) */}
          <div 
            onClick={() => setShowHealthModal(true)}
            className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-800/90 border border-slate-700/70 text-slate-300 text-[11px] cursor-pointer hover:bg-slate-800 hover:border-slate-600 transition select-none shadow-sm"
            title={`应用版本: ${versionInfo.version}\n代码最后修改时间: ${versionInfo.lastModified} (CST)\n点击查看系统诊断面板`}
          >
            <span className="font-semibold text-sky-400 bg-sky-500/15 px-1 py-0.2 rounded text-[10px] border border-sky-500/25">
              {versionInfo.version}
            </span>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <div className="hidden sm:flex items-center space-x-1 text-slate-400">
              <GitCommit className="w-3 h-3 text-slate-500 shrink-0" />
              <span className="text-slate-500 text-[10px] hidden md:inline">修改:</span>
              <span className="text-slate-300 text-[10px] font-mono tracking-tight">{versionInfo.lastModified}</span>
            </div>
          </div>

          <div className="hidden md:flex items-center space-x-1 text-slate-400">
            <Clock className="w-3 h-3 text-slate-500" />
            <span className="text-[11px]">{shanghaiClock || '09:30:00'} CST</span>
          </div>

          <div
            onClick={() => setShowHealthModal(true)}
            className="flex items-center space-x-1 cursor-pointer text-[11px]"
            title="查看数据源熔断状态与诊断"
          >
            {sseConnected ? (
              <span className="inline-flex items-center text-emerald-400">
                <Wifi className="w-3 h-3 mr-0.5" />
                <span className="hidden md:inline">SSE推流</span>
              </span>
            ) : (
              <span className="inline-flex items-center text-amber-400">
                <WifiOff className="w-3 h-3 mr-0.5" />
                <span className="hidden md:inline">轮询兜底</span>
              </span>
            )}
          </div>

          <button
            onClick={handleOpenAddStock}
            className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition active:scale-95"
          >
            <Plus className="w-3 h-3 mr-1" />
            <span>加自选</span>
          </button>
        </div>
      </header>

      {/* 左右布局主工作区 (平板竖版与手机端全宽列表+折叠展开，桌面端双栏分屏) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* ================= 股票池列表 (移动端全屏折叠展开 / 桌面端左侧边栏) ================= */}
        <section className="w-full lg:w-[280px] xl:w-[320px] flex flex-col border-r border-slate-800 bg-slate-900/40 shrink-0 min-h-0 flex-1 lg:flex-none">
          {/* 左侧顶端搜索与分类工具栏 (紧凑) */}
          <div className="p-2 border-b border-slate-800 space-y-1.5 shrink-0 bg-slate-900/60">
            {/* 搜索框与排序 */}
            <div className="flex items-center space-x-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜代码/名称/赛道..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-sans"
                />
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-blue-500 font-mono"
              >
                <option value="change_desc">涨跌↓</option>
                <option value="change_asc">涨跌↑</option>
                <option value="amount_desc">成交额↓</option>
                <option value="price_desc">最新价↓</option>
                <option value="code_asc">代码↑</option>
              </select>
            </div>

            {/* 观察梯度分类按钮 */}
            <div className="flex items-center justify-between gap-1 text-[11px]">
              {['全部', '重点观察', '候补观察', '备选观察'].map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTier(t)}
                  className={`flex-1 py-0.5 rounded text-center transition ${
                    selectedTier === t
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800/80'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 标的池列表区 (平板竖版与移动端支持向下展开) */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {loading ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                正在载入股票池...
              </div>
            ) : filteredPool.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                无匹配标的
              </div>
            ) : (
              filteredPool.map((stock) => {
                const q = quotes.get(stock.code);
                const isSelected = currentStock?.code === stock.code;
                const isExpanded = expandedCode === stock.code;
                const isUp = (q?.change_pct ?? 0) > 0;
                const isDown = (q?.change_pct ?? 0) < 0;
                const priceColor = isUp ? 'text-rose-400' : isDown ? 'text-emerald-400' : 'text-slate-300';
                const sparkPoints = q?.sparkline && q.sparkline.length > 0 ? q.sparkline : [q?.open || 0, q?.price || 0];

                return (
                  <div key={stock.code} className="border-b border-slate-800/60 last:border-b-0">
                    <div
                      onClick={() => handleItemClick(stock.code)}
                      className={`px-3 py-1.5 cursor-pointer transition flex items-center justify-between group ${
                        isSelected
                          ? 'bg-blue-600/15 border-l-4 border-blue-500 pl-2'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      {/* 左侧：名称、代码、赛道 (sub) */}
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <span className={`text-xs font-bold truncate ${isSelected ? 'text-blue-400' : 'text-slate-100 group-hover:text-blue-300'}`}>
                            {stock.name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {stock.code}
                          </span>
                          <span className={`text-[9px] px-1 py-0.1 rounded font-medium ${
                            stock.tier === '重点观察' ? 'bg-amber-500/10 text-amber-300' :
                            stock.tier === '候补观察' ? 'bg-blue-500/10 text-blue-300' :
                            'bg-slate-800 text-slate-400'
                          }`}>
                            {stock.tier.slice(0, 2)}
                          </span>
                        </div>

                        {/* 突出展示赛道类别 (sub) 与行业 */}
                        <div className="flex items-center space-x-1 text-[10px] text-slate-400 truncate mt-0.5">
                          <span className="text-slate-500">{stock.industry_l1}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-sky-400/90 font-medium truncate">
                            {stock.sub_sector || '主线赛道'}
                          </span>
                        </div>
                      </div>

                      {/* 右侧：微图与价格涨跌幅及移动端折叠图标 */}
                      <div className="flex items-center space-x-2 shrink-0">
                        <div className="hidden sm:block">
                          <MiniSparkline
                            points={sparkPoints}
                            prevClose={q?.prev_close}
                            isPositive={isUp}
                            width={54}
                            height={20}
                            isClosed={session === 'CLOSED'}
                          />
                        </div>

                        <div className="text-right w-16">
                          <div className={`text-xs font-bold font-mono ${priceColor}`}>
                            {q?.price ? q.price.toFixed(2) : '--'}
                          </div>
                          <div className={`text-[10px] font-semibold font-mono ${priceColor}`}>
                            {isUp ? '+' : ''}{q?.change_pct ? q.change_pct.toFixed(2) : '0.00'}%
                          </div>
                        </div>

                        {/* 平板竖版与手机端展开/收起指示器 */}
                        <div className="lg:hidden text-slate-500 group-hover:text-slate-300 pl-0.5">
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 平板竖版与手机端向下展开的简易分时走势图与日K线 */}
                    {isExpanded && (
                      <div className="lg:hidden">
                        <StockAccordionDetail
                          stock={stock}
                          quote={q}
                          onCollapse={() => setExpandedCode(null)}
                          onOpenFullDetail={() => setMobileDetailModalCode(stock.code)}
                          realtimeMinutePoints={realtimeMinutes?.code === stock.code ? realtimeMinutes.points : undefined}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 列表底部快速状态 */}
          <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between shrink-0 font-mono">
            <span>筛选显示: {filteredPool.length} / {pool.length} 只</span>
            <span className="hidden lg:inline">点击立即切换右侧全屏图表</span>
            <span className="lg:hidden">点击项展开分时/日K</span>
          </div>
        </section>

        {/* ================= 桌面端右侧：行情数据与大幅分时/K线图表 ================= */}
        <section className="hidden lg:flex flex-1 flex-col min-w-0 min-h-0 bg-slate-950 overflow-hidden">
          <MarketDetailPanel
            stock={currentStock}
            quote={currentStock ? quotes.get(currentStock.code) : undefined}
            onDeleteStock={handleDeleteStock}
            onRequestAuth={() => setIsAuthModalOpen(true)}
            token={token}
            realtimeMinutePoints={currentStock && realtimeMinutes?.code === currentStock.code ? realtimeMinutes.points : undefined}
            realtimeTicks={currentStock && realtimeTicks?.code === currentStock.code ? realtimeTicks.ticks : undefined}
          />
        </section>
      </div>

      {/* 移动端与平板竖版深度盘口明细浮层 */}
      {mobileDetailModalCode && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 lg:hidden animate-fadeIn">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-100">
                {pool.find(p => p.code === mobileDetailModalCode)?.name}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                ({mobileDetailModalCode}) 深度盘口与明细
              </span>
            </div>
            <button
              onClick={() => setMobileDetailModalCode(null)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
            >
              返回列表
            </button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <MarketDetailPanel
              stock={pool.find(p => p.code === mobileDetailModalCode) || null}
              quote={quotes.get(mobileDetailModalCode)}
              onDeleteStock={(code) => {
                handleDeleteStock(code);
                setMobileDetailModalCode(null);
              }}
              onRequestAuth={() => setIsAuthModalOpen(true)}
              token={token}
              realtimeMinutePoints={realtimeMinutes?.code === mobileDetailModalCode ? realtimeMinutes.points : undefined}
              realtimeTicks={realtimeTicks?.code === mobileDetailModalCode ? realtimeTicks.ticks : undefined}
            />
          </div>
        </div>
      )}

      {/* 密码门禁 Modal */}
      <PasswordGateModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      {/* 添加标的 Drawer */}
      <AddStockDrawer
        isOpen={isAddDrawerOpen}
        onClose={() => setIsAddDrawerOpen(false)}
        token={token}
        onStockAdded={handleStockAdded}
      />

      {/* 系统健康检查与熔断器面板 */}
      {showHealthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <Shield className="w-4 h-4 text-blue-400" />
                <span>数据源熔断状态与时段诊断 (Circuit Breakers)</span>
              </h3>
              <button
                onClick={() => setShowHealthModal(false)}
                className="text-slate-400 hover:text-slate-100 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400">应用版本与代码状态:</span>
                <span className="text-sky-400 font-bold">
                  {versionInfo.version}
                  <span className="text-slate-400 font-normal ml-2">({versionInfo.lastModified} CST)</span>
                </span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400">当前交易时段:</span>
                <span className="text-emerald-400 font-bold">{healthInfo?.session}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400">北京时间 (CST):</span>
                <span className="text-slate-200">{healthInfo?.shanghaiTime}</span>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400">缓存标的与行情数:</span>
                <span className="text-slate-200">{healthInfo?.poolCount} 只 / {healthInfo?.quotesCount} 条快照</span>
              </div>

              <div className="pt-1">
                <span className="text-slate-400 block mb-1.5 font-sans font-semibold text-[11px]">四路数据源熔断状态矩阵:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(healthInfo?.sources || {}).map(([source, status]) => (
                    <div key={source} className="p-1.5 rounded bg-slate-950 border border-slate-800 flex justify-between items-center text-[11px]">
                      <span className="text-slate-300 font-sans capitalize">{source}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                        status === 'CLOSED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        status === 'HALF_OPEN' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-rose-500/10 text-rose-400'
                      }`}>
                        {status as string}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  fetchHealth();
                  fetchQuotes();
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              >
                刷新状态
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
