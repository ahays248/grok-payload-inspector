/**
 * Ranking estimator, not a billing tokenizer.
 * Good enough to sort "which tool is the hog" — the point of the lesson.
 * ~4 characters per token is the usual English rule of thumb.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateJson(value: unknown): number {
  if (value == null) return 0;
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
