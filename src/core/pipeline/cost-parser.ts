export interface ParsedCost {
  costUsd: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Parse cost and token information from harness stdout.
 *
 * Looks for patterns commonly output by AI CLI tools:
 * - "Total cost: $0.0234" or "Cost: $1.23"
 * - "Input: 1234 tokens" / "Output: 567 tokens"
 * - "input_tokens: 1234" / "output_tokens: 567"
 * - "Tokens: 1234 in / 567 out"
 */
export function parseCostFromOutput(stdout: string): ParsedCost | null {
  let costUsd: number | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;

  // Cost patterns
  const costMatch = stdout.match(/(?:total\s+)?cost[:\s]+\$?([\d.]+)/i);
  if (costMatch) {
    costUsd = Number.parseFloat(costMatch[1]);
  }

  // Token patterns — "Input: N tokens" / "Output: N tokens"
  const inputMatch = stdout.match(
    /input(?:_tokens)?[:\s]+(\d+)(?:\s*tokens?)?/i
  );
  if (inputMatch) {
    tokensIn = Number.parseInt(inputMatch[1], 10);
  }

  const outputMatch = stdout.match(
    /output(?:_tokens)?[:\s]+(\d+)(?:\s*tokens?)?/i
  );
  if (outputMatch) {
    tokensOut = Number.parseInt(outputMatch[1], 10);
  }

  // "Tokens: N in / N out" pattern
  const compactMatch = stdout.match(
    /tokens?[:\s]+(\d+)\s*in\s*[/|]\s*(\d+)\s*out/i
  );
  if (compactMatch) {
    tokensIn = Number.parseInt(compactMatch[1], 10);
    tokensOut = Number.parseInt(compactMatch[2], 10);
  }

  if (costUsd === null && tokensIn === null && tokensOut === null) {
    return null;
  }

  return {
    costUsd: (costUsd ?? 0).toFixed(6),
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
  };
}
