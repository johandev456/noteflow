export interface Usage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface Prices {
  /** Price per million tokens, in the user's currency (USD by convention). */
  inputPerM: number;
  outputPerM: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, calls: 0 });

export function addUsage(usage: Usage, inputTokens: number, outputTokens: number): Usage {
  return {
    inputTokens: usage.inputTokens + inputTokens,
    outputTokens: usage.outputTokens + outputTokens,
    calls: usage.calls + 1,
  };
}

/** Returns null when no prices are configured, so the UI can show tokens only. */
export function estimateCost(usage: Usage, prices: Prices): number | null {
  if (prices.inputPerM <= 0 && prices.outputPerM <= 0) return null;
  return (
    (usage.inputTokens * prices.inputPerM + usage.outputTokens * prices.outputPerM) / 1_000_000
  );
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
