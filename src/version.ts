/**
 * 客户端版本与代码构建元信息
 */
export const APP_VERSION = 'v1.2.0';
export const CODE_LAST_MODIFIED = '2026-09-28 13:08:27';

export interface VersionInfo {
  version: string;
  lastModified: string;
  lastModifiedTimestamp?: number;
}
