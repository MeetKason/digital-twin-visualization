/** 避免一块临时缺瓦触发整幅底图回退；授权拒绝和持续不可用分别处理。 */
export class ImageryRecovery {
  private failures: number[] = [];
  record(error: { timesRetried: number; retry: boolean; error?: { statusCode?: number; status?: number } }, now = Date.now()) {
    const status = error.error?.statusCode ?? error.error?.status;
    if (status === 401 || status === 403) return "fallback";
    if (error.timesRetried < 1) { error.retry = true; return "retry"; }
    this.failures = this.failures.filter((time) => now - time <= 10000);
    this.failures.push(now);
    return this.failures.length >= 8 ? "fallback" : "keep";
  }
}
