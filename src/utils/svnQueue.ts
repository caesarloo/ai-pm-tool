/**
 * SVN 命令全局单飞队列
 * - SVN 工作副本有 .svn 锁：并发 svn 命令（diff/update/commit）会互等锁，
 *   被 execFile 60s 超时杀死的命令会误报失败（实际重试即可成功）
 * - 所有 svn 操作经 runSvnSerialized 排队串行执行，避免并发阻塞与误导性失败
 * - 前一个命令失败不阻塞后续命令（队列吞掉错误继续）
 */

let chain: Promise<unknown> = Promise.resolve();

export function runSvnSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn); // 前一个失败也继续执行本命令
  chain = next.then(
    () => undefined,
    () => undefined
  ); // 队列吞掉错误，保证链路不断
  return next;
}
