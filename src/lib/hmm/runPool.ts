export async function runPool<T, R>(
  items: T[],
  worker: (it: T, i: number) => Promise<R>,
  limit = 3
): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let next = 0;
  const running: Promise<void>[] = [];

  async function runOne(i: number) {
    try {
      const r = await worker(items[i], i);
      (results as any)[i] = r;
    } catch (e) {
      throw e;
    }
  }

  while (next < items.length || running.length > 0) {
    while (next < items.length && running.length < limit) {
      const i = next++;
      const p = runOne(i).then(() => {
        const idx = running.indexOf(p as any);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(p as any);
    }
    if (running.length > 0) await Promise.race(running);
  }

  return results;
}

