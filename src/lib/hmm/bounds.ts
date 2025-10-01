export type L2BoundsOptions = {
  multiplier: number;       // l2Multiplier
  wiggle: number;           // l2Wiggle (0..0.4)
  hardMin: number;          // hard minimum
  capRatio?: number;        // cap relative to avg (default 2.0)
  softTargetRatio: number;  // l2SoftTarget
};

export type L2Bounds = {
  avgChars: number;
  target: number;
  cap: number;
  min: number;
  max: number;
  softTarget: number;
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function computeL2Bounds(avgChars: number, opts: L2BoundsOptions): L2Bounds {
  const wiggle = clamp(opts.wiggle, 0, 0.4);
  const capRatio = opts.capRatio ?? 2.0;
  const target = Math.max(100, Math.floor(avgChars * opts.multiplier));
  const cap = Math.floor(avgChars * capRatio);
  const min = Math.max(opts.hardMin, 0);
  const max = Math.max(min + 50, Math.min(cap, Math.floor(target * (1 + wiggle))));
  const softTarget = Math.max(50, Math.floor(avgChars * opts.softTargetRatio));
  return { avgChars, target, cap, min, max, softTarget };
}

