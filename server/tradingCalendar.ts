import { TradingSession } from './types.ts';

/**
 * 交易日历与时段状态判断 (Section 4.1)
 * 强制统一使用 Asia/Shanghai 时区
 */

export function getShanghaiDate(date: Date = new Date()): { year: number; month: number; day: number; hour: number; minute: number; second: number; dayOfWeek: number; timeStr: string; dateStr: string } {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'narrow',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => {
    const p = parts.find(x => x.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };

  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');

  // 周几计算: 0=周日, 1=周一, ... 6=周六
  // 使用 UTC 转换到上海日期的毫秒时间推导星期
  const shanghaiTimeString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`;
  const shDate = new Date(shanghaiTimeString);
  const dayOfWeek = shDate.getDay();

  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hour, minute, second, dayOfWeek, timeStr, dateStr };
}

// 常见法定节假日配置 (可扩展 holidays.json)
const HOLIDAYS = new Set<string>([
  '2026-01-01', '2026-01-02', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-04', '2026-05-05', '2026-06-19', '2026-10-01',
  '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'
]);

export function isTradingDay(date: Date = new Date()): boolean {
  const { dayOfWeek, dateStr } = getShanghaiDate(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false; // 周末闭市
  }
  if (HOLIDAYS.has(dateStr)) {
    return false; // 法定节假日
  }
  return true;
}

export function getSessionState(now: Date = new Date()): TradingSession {
  if (!isTradingDay(now)) {
    return 'CLOSED';
  }

  const { hour, minute } = getShanghaiDate(now);
  const totalMinutes = hour * 60 + minute;

  // 00:00 - 09:15
  if (totalMinutes < 9 * 60 + 15) {
    return 'PRE_MARKET';
  }
  // 09:15 - 09:25 (早盘集合竞价)
  if (totalMinutes < 9 * 60 + 25) {
    return 'AUCTION';
  }
  // 09:25 - 11:30 (早盘连续竞价及撮合展示)
  if (totalMinutes < 11 * 60 + 30) {
    return 'MORNING';
  }
  // 11:30 - 13:00 (午间休盘)
  if (totalMinutes < 13 * 60) {
    return 'LUNCH_BREAK';
  }
  // 13:00 - 15:00 (午后连续竞价及收盘集合竞价)
  if (totalMinutes <= 15 * 60) {
    return 'AFTERNOON';
  }
  // 15:00 以后收盘
  return 'CLOSED';
}
