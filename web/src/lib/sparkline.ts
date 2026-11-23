/** Sums neighbouring counts so a long series fits in at most `max` points. */
export function downsample(counts: number[], max: number): number[] {
  if (counts.length <= max) return counts;
  const out: number[] = [];
  const size = counts.length / max;
  for (let i = 0; i < max; i++) {
    let sum = 0;
    for (let j = Math.floor(i * size); j < Math.floor((i + 1) * size); j++) sum += counts[j];
    out.push(sum);
  }
  return out;
}

/** The points of a sparkline in a box: 1 px in from the edges, the busiest point at the top. */
export function sparkPoints(counts: number[], width: number, height: number): [number, number][] {
  const peak = Math.max(1, ...counts);
  const step = counts.length > 1 ? width / (counts.length - 1) : 0;
  return counts.map((n, i) => [i * step, height - 1 - (n / peak) * (height - 2)]);
}

/** How often something happened over a stretch: "once", "every 5s", "every 2 min", "every 3 h". */
export function rateOf(total: number, seconds: number): string {
  if (total <= 1) return "once";
  const every = seconds / total;
  if (every < 90) return `every ${Math.max(1, Math.round(every))}s`;
  if (every < 5400) return `every ${Math.round(every / 60)} min`;
  return `every ${Math.round(every / 3600)} h`;
}
