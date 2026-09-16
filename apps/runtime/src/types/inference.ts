export type InferenceMessage = {
	role: "user" | "assistant" | "system";
	content: string;
};

export type InferenceRequest = {
	model: string;
	messages: InferenceMessage[];
	maxTokens?: number;
	temperature?: number;
};

export type TokenUsage = {
	input: number;
	output: number;
};

export type FinishReason = "end_turn" | "max_tokens" | "stop_sequence";

export type InferenceResponse = {
	content: string;
	model: string;
	tokenUsage: TokenUsage;
	finishReason: FinishReason;
};

export type ModelInfo = {
	id: string;
	name: string;
	contextWindow: number;
	providerId: string;
};
