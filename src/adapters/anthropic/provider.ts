import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  CompletionChunk,
  CompletionParams,
  CompletionResult,
  ModelInfo,
} from '@/core/ports/ai';

const KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    capabilities: ['code', 'analysis', 'reasoning', 'vision'],
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    capabilities: ['code', 'analysis', 'reasoning', 'vision'],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    capabilities: ['code', 'analysis', 'fast'],
  },
];

export class AnthropicAIProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const systemMessage = params.messages.find((m) => m.role === 'system');
    const userMessages = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: userMessages,
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
    });

    const content = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

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
    const systemMessage = params.messages.find((m) => m.role === 'system');
    const userMessages = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: userMessages,
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield {
          type: 'text',
          content: event.delta.text,
        };
      }
    }

    const finalMessage = await stream.finalMessage();
    const inputTokens = finalMessage.usage.input_tokens;
    const outputTokens = finalMessage.usage.output_tokens;

    yield {
      type: 'text',
      content: '',
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCost(params.model, inputTokens, outputTokens),
      },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return KNOWN_MODELS;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

// Hardcoded cost rates for alpha (per 1K tokens)
const COST_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 },
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
