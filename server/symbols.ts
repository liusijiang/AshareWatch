/**
 * 证券代码映射工具函数 (Section 3.2)
 */

export function codeToMarket(code: string): "SH" | "SZ" {
  const clean = code.replace(/^[a-zA-Z.]+/, '');
  // 6开头的代码(600/601/603/605主板, 688/689科创板), 51/58开头的ETF
  if (clean.startsWith('6') || clean.startsWith('51') || clean.startsWith('58')) {
    return 'SH';
  }
  // 000/001/002/003深市主板, 300/301创业板, 15/16深市ETF
  return 'SZ';
}

export function toSecid(code: string): string {
  const clean = code.replace(/^[a-zA-Z.]+/, '');
  return (codeToMarket(clean) === 'SH' ? '1.' : '0.') + clean;
}

export function toSinaSymbol(code: string): string {
  const clean = code.replace(/^[a-zA-Z.]+/, '');
  return (codeToMarket(clean) === 'SH' ? 'sh' : 'sz') + clean;
}

export function toNeteasePrefix(code: string): string {
  const clean = code.replace(/^[a-zA-Z.]+/, '');
  // 网易前缀与东财相反: SH=0, SZ=1
  return (codeToMarket(clean) === 'SH' ? '0' : '1') + clean;
}
