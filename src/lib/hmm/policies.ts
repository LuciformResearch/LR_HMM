export type UnderflowMode = 'accept' | 'regenerate' | 'error';
export type OverflowMode = 'accept' | 'regenerate';

export function evaluateUnderflow(len: number, min: number, mode: UnderflowMode): { decision: 'ok' | 'accept' | 'error' | 'regenerate'; message: string } {
  if (min <= 0) return { decision: 'ok', message: 'No minimum enforced' };
  if (len >= min) return { decision: 'ok', message: `Length OK: ${len} >= ${min}` };
  const base = `Underflow: len=${len} < min=${min}`;
  if (mode === 'accept') return { decision: 'accept', message: `${base} — ACCEPT (mode=accept)` };
  if (mode === 'error') return { decision: 'error', message: `${base} — ERROR (mode=error)` };
  return { decision: 'regenerate', message: `${base} — REGENERATE (mode=regenerate)` };
}

export function evaluateOverflow(
  len: number,
  avgChars: number,
  max: number,
  mode: OverflowMode,
  overflowMaxRatio: number,
  currentSoftTargetRatio: number,
  softRatioStep: number
): { decision: 'accept' | 'regenerate' | 'reject'; newSoftTargetRatio?: number; message: string } {
  if (len <= max) return { decision: 'accept', message: `Within max: len=${len} <= max=${max}` };
  const ratioToAvg = len / Math.max(1, avgChars);
  const base = `Overflow: len=${len} > max=${max} (avgL1=${avgChars} ratio=${ratioToAvg.toFixed(2)})`;
  if (mode === 'accept' && ratioToAvg <= overflowMaxRatio) {
    return { decision: 'accept', message: `${base} — ACCEPT (mode=accept, maxRatio=${overflowMaxRatio})` };
  }
  if (mode === 'regenerate') {
    const newSoft = Math.max(0.3, Number((currentSoftTargetRatio - softRatioStep).toFixed(2)));
    return { decision: 'regenerate', newSoftTargetRatio: newSoft, message: `${base} — REGENERATE softTarget: ${currentSoftTargetRatio} -> ${newSoft}` };
  }
  return { decision: 'reject', message: `${base} — REJECT` };
}

