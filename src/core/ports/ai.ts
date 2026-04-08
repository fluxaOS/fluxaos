export interface CompletionMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface CompletionParams {
	model: string;
	messages: CompletionMessage[];
	maxTokens?: number;
	temperature?: number;
	tools?: Record<string, unknown>[];
}

export interface CompletionUsage {
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export interface CompletionResult {
	content: string;
	usage: CompletionUsage;
}

export interface CompletionChunk {
	type: "text" | "tool_use";
	content: string;
	usage?: CompletionUsage;
}

export interface ModelInfo {
	id: string;
	name: string;
	capabilities: string[];
}

export interface AIProvider {
	complete(params: CompletionParams): Promise<CompletionResult>;

	stream(params: CompletionParams): AsyncIterable<CompletionChunk>;

	listModels(): Promise<ModelInfo[]>;

	healthCheck(): Promise<boolean>;
}
