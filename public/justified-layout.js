export const DEFAULT_RATIO = 1.5;

export function targetRowHeight(width) {
  if (width < 520) return 150;
  if (width < 900) return 200;
  return 240;
}

// Returns how many photos from `start` form the next row, or null if that can't be decided yet.
// A row is never guessed: while any ratio in it is unknown (null) we wait, so committed rows never move.
// A row that doesn't fill the width is only returned when `final` (no more photos are coming).
export function planRow(ratios, start, width, targetH, gap, final) {
  let sum = 0;
  let n = 0;
  for (let i = start; i < ratios.length; i++) {
    const r = ratios[i];
    if (r == null) return null;
    sum += r;
    n++;
    if (sum * targetH + gap * (n - 1) >= width) {
      if (n > 1) {
        const hWith = (width - gap * (n - 1)) / sum;
        const hWithout = (width - gap * (n - 2)) / (sum - r);
        if (Math.abs(hWithout - targetH) < Math.abs(hWith - targetH)) n--;
      }
      return { n, stretch: true };
    }
  }
  return final && n > 0 ? { n, stretch: false } : null;
}
