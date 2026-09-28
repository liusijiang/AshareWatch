import React, { useId } from 'react';

interface Props {
  points?: number[];
  prevClose?: number; // 昨收基准价 (提供基准中轴与精准真实比例，杜绝微小波动占满失真)
  isPositive?: boolean;
  width?: number;
  height?: number;
  isClosed?: boolean; // 是否已收盘 (已收盘则全幅撑满，未收盘按全天自然交易进度推进)
}

export const MiniSparkline: React.FC<Props> = ({
  points = [],
  prevClose,
  isPositive,
  width = 56,
  height = 20,
  isClosed = false
}) => {
  const gradId = useId().replace(/:/g, '_');
  const validPoints = points.filter(p => typeof p === 'number' && !isNaN(p) && p > 0);

  if (validPoints.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center opacity-30 select-none">
        <div className="w-full h-px bg-slate-600" />
      </div>
    );
  }

  // 1. 基准价与 Y 轴范围精确计算
  // 以昨收价（或首个开盘点）为对称中轴，真实反映涨跌振幅，平盘或极微小抖动不会被占满高度虚假放大
  const refPrice = prevClose && prevClose > 0 ? prevClose : validPoints[0];
  const diffs = validPoints.map(p => Math.abs(p - refPrice));
  // 保持至少 0.3% 的动态波动空间，平盘微小抖动保持贴近平直中轴
  const maxDiff = Math.max(...diffs, refPrice * 0.003);

  const maxVal = refPrice + maxDiff;
  const minVal = refPrice - maxDiff;
  const range = maxVal - minVal || 1;

  // 上下预留 2px 留白避免描边被裁切
  const padY = 2;
  const usableH = height - padY * 2;
  const zeroY = height - padY - ((refPrice - minVal) / range) * usableH;

  // 2. X 轴时间比例基准：A股全天交易（4小时=240分钟）对应 30 个基准采样点
  // 若已收盘或点数已达 30 点，则全幅平铺；盘中按已完成的时段自然展开 (午休稳定停留在 50% 轴线)
  const totalSlots = isClosed || validPoints.length >= 30 ? validPoints.length : 30;

  const coords = validPoints.map((p, i) => {
    const x = (i / Math.max(1, totalSlots - 1)) * (width - 4) + 2;
    const y = height - padY - ((p - minVal) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lastPrice = validPoints[validPoints.length - 1];
  const isUp = typeof isPositive === 'boolean'
    ? isPositive
    : (refPrice ? lastPrice >= refPrice : lastPrice >= validPoints[0]);

  const strokeColor = isUp ? '#ef4444' : '#10b981';
  const lastCoord = coords[coords.length - 1].split(',');
  const lastX = parseFloat(lastCoord[0]);
  const lastY = parseFloat(lastCoord[1]);

  const pathD = `M ${coords.join(' L ')}`;
  // 渐变阴影严格沿最后绘制点下落闭合，防止未交易时间段被斜切污染
  const areaD = `${pathD} L ${lastX},${height - 1} L 2,${height - 1} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible select-none shrink-0"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* 昨收基准中轴虚线 (Zero Baseline: 贯穿全宽，精确区分红涨/绿跌区域与真实波动幅度) */}
      <line
        x1={2}
        y1={zeroY}
        x2={width - 2}
        y2={zeroY}
        stroke="rgba(148, 163, 184, 0.25)"
        strokeDasharray="2,2"
        strokeWidth={0.75}
      />

      {/* 走势渐变阴影面积 */}
      <path d={areaD} fill={`url(#${gradId})`} />

      {/* 分时折线轨迹 */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 最新价尾部微光指示点 */}
      <circle cx={lastX} cy={lastY} r={1.6} fill={strokeColor} />
      <circle cx={lastX} cy={lastY} r={3.2} fill={strokeColor} fillOpacity={0.25} />
    </svg>
  );
};
