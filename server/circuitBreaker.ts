/**
 * 熔断器 (Circuit Breaker) - Section 3.3
 */

export type CircuitStatus = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SourceHealth {
  source: string;
  status: CircuitStatus;
  failuresInWindow: number;
  lastFailureAt: number;
  openUntil: number;
}

export class CircuitBreaker {
  private status: CircuitStatus = 'CLOSED';
  private failureTimestamps: number[] = [];
  private openUntil = 0;
  private readonly windowMs = 60 * 1000; // 60s
  private readonly threshold = 5;        // 5次失败触发熔断
  private readonly cooldownMs = 30 * 1000; // 30s冷却

  constructor(public readonly name: string) {}

  public getStatus(): CircuitStatus {
    const now = Date.now();
    if (this.status === 'OPEN') {
      if (now >= this.openUntil) {
        this.status = 'HALF_OPEN';
        console.log(`[CircuitBreaker] ${this.name} 冷却期结束，状态变迁为 HALF_OPEN`);
      }
    }
    return this.status;
  }

  public recordSuccess(): void {
    if (this.status === 'HALF_OPEN') {
      console.log(`[CircuitBreaker] ${this.name} 试探成功，状态恢复为 CLOSED`);
    }
    this.status = 'CLOSED';
    this.failureTimestamps = [];
    this.openUntil = 0;
  }

  public recordFailure(err?: any): void {
    const now = Date.now();
    this.failureTimestamps.push(now);
    // 移除窗口外的失败
    this.failureTimestamps = this.failureTimestamps.filter(t => now - t < this.windowMs);

    if (this.status === 'HALF_OPEN') {
      this.status = 'OPEN';
      this.openUntil = now + this.cooldownMs;
      console.warn(`[CircuitBreaker] ${this.name} HALF_OPEN 试探失败，重新进入 OPEN 状态 (${this.cooldownMs}ms)`);
      return;
    }

    if (this.failureTimestamps.length >= this.threshold && this.status === 'CLOSED') {
      this.status = 'OPEN';
      this.openUntil = now + this.cooldownMs;
      console.error(`[CircuitBreaker] ${this.name} 最近60秒内失败达到 ${this.threshold} 次，触发熔断，进入 OPEN 状态`);
    }
  }

  public getHealth(): SourceHealth {
    const now = Date.now();
    const cleanFailures = this.failureTimestamps.filter(t => now - t < this.windowMs);
    return {
      source: this.name,
      status: this.getStatus(),
      failuresInWindow: cleanFailures.length,
      lastFailureAt: this.failureTimestamps[this.failureTimestamps.length - 1] || 0,
      openUntil: this.openUntil
    };
  }
}

export const sourceCircuitBreakers: Record<string, CircuitBreaker> = {
  eastmoney: new CircuitBreaker('eastmoney'),
  tencent: new CircuitBreaker('tencent'),
  sina: new CircuitBreaker('sina'),
  netease: new CircuitBreaker('netease')
};
