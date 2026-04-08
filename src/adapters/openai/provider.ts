import OpenAI from 'openai';
import type {
  AIProvider,
  CompletionChunk,
  CompletionParams,
  CompletionResult,
  ModelInfo,
} from '@/core/ports/ai';

export class OpenAIAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey ?? process.env.OPENAI_API_KEY,
    });
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
    });

    const content = response.choices[0]?.message?.content ?? '';
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCost(params.model, inputTokens, outputTokens),
      },
    };
  }

  async *stream(params: CompletionParams): AsyncIterable<CompletionChunk> {
    const messages = params.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const stream = await this.client.chat.completions.create({
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield {
          type: 'text',
          content: delta.content,
        };
      }

      if (chunk.usage) {
        totalInputTokens = chunk.usage.prompt_tokens;
        totalOutputTokens = chunk.usage.completion_tokens;
      }
    }

    yield {
      type: 'text',
      content: '',
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: estimateCost(
          params.model,
          totalInputTokens,
          totalOutputTokens
        ),
      },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.client.models.list();
      return response.data
        .filter(
          (m) =>
            m.id.startsWith('gpt-') ||
            m.id.startsWith('o') ||
            m.id.startsWith('chatgpt-')
        )
        .map((m) => ({
          id: m.id,
          name: m.id,
          capabilities: ['code', 'analysis'],
        }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

// Hardcoded cost rates for alpha (per 1K tokens)
const COST_RATES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  o1: { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
};

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = COST_RATES[model] ?? { input: 0.003, output: 0.015 };
  return (
    (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output
  );
}
