export type RequestLock = { current: boolean };

export function acquireRequestLock(lock: RequestLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseRequestLock(lock: RequestLock): void {
  lock.current = false;
}
