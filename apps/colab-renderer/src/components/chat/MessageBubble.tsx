import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { Message } from "../../../../runtime/src/types/conversation";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolResultBlock } from "./ToolResultBlock";

type MessageBubbleProps = {
	message: Message;
};

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
	const isUser = () => props.message.role === "user";
	const isToolCall = () => props.message.role === "tool_call";
	const isToolResult = () => props.message.role === "tool_result";
	const isStreaming = () => props.message.metadata?.status === "streaming";

	return (
		<div
			style={{
				display: "flex",
				"justify-content": isUser() ? "flex-end" : "flex-start",
				width: "100%",
			}}
		>
			<Show when={isToolCall()}>
				<ToolCallBlock message={props.message} />
			</Show>
			<Show when={isToolResult()}>
				<ToolResultBlock message={props.message} />
			</Show>
			<Show when={!isToolCall() && !isToolResult()}>
				<div
					style={{
						"max-width": isUser() ? "70%" : "85%",
						padding: "12px 16px",
						"border-radius": "12px",
						"background-color": isUser() ? "#45475a" : "#313244",
						color: "#cdd6f4",
						"font-size": "14px",
						"line-height": "1.6",
						"white-space": "pre-wrap",
						"word-break": "break-word",
					}}
				>
					{props.message.content}
					<Show when={isStreaming()}>
						<span
							style={{
								display: "inline-block",
								width: "8px",
								height: "16px",
								"background-color": "#89b4fa",
								"margin-left": "2px",
								animation: "blink 1s infinite",
							}}
						/>
					</Show>
				</div>
			</Show>
		</div>
	);
};
