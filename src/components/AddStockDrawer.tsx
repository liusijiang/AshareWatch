import React, { useState } from 'react';
import { X, Plus, AlertCircle, Sparkles } from 'lucide-react';
import { StockPoolItem } from '../types.ts';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  onStockAdded: (item: StockPoolItem) => void;
}

const COMMON_INDUSTRIES = [
  '军工', '机械设备', '电子', '半导体', '计算机', '通信',
  '非银金融', '银行', '传媒', '公用事业', '医药生物', '基础化工',
  '建筑材料', '有色金属', '商贸零售', '食品饮料', '社会服务', '汽车',
  '电力设备', '基金/ETF', '其他'
];

export const AddStockDrawer: React.FC<Props> = ({ isOpen, onClose, token, onStockAdded }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('半导体');
  const [subSector, setSubSector] = useState('');
  const [tier, setTier] = useState<'重点观察' | '候补观察' | '备选观察'>('重点观察');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().replace(/^[a-zA-Z.]+/, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('请输入正确的 6 位数字股票代码 (如 300855, 600519)');
      return;
    }

    if (!token) {
      setError('未检测到管理员授权令牌，请先输入密码');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/pool/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          code: cleanCode,
          name: name.trim() || undefined,
          industry_l1: industry,
          sub_sector: subSector.trim() || '自选细分',
          tier,
          note: note.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '添加股票失败');
        return;
      }

      onStockAdded(data);
      setCode('');
      setName('');
      setSubSector('');
      setNote('');
      onClose();
    } catch (err: any) {
      setError(err.message || '网络连接失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-5">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
            <Plus className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">新增跟踪标的</h3>
            <p className="text-xs text-slate-400 mt-0.5">录入后服务端将立即纳入多源行情秒级监控轮询队列</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                股票代码 <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="例如: 300855"
                maxLength={6}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                标的名称 (可留空自动拉取)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: 图南股份"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                申万一级行业
              </label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {COMMON_INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                细分赛道 / 业务方向
              </label>
              <input
                type="text"
                value={subSector}
                onChange={(e) => setSubSector(e.target.value)}
                placeholder="例如: 高温合金"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              观察梯度 (Tier)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['重点观察', '候补观察', '备选观察'] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTier(t)}
                  className={`py-2 text-xs font-medium rounded-xl border transition ${
                    tier === t
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400 font-bold'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              核心逻辑 / 关注备注
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="记录该标的的加入理由、催化剂或操作计划..."
              rows={3}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="flex items-center space-x-2 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-600/20 transition disabled:opacity-50 flex items-center space-x-1.5"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>立即录入跟踪池</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
