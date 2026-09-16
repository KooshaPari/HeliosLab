import { type Component, For } from "solid-js";

type ToastItem = {
	id: string;
	type: "success" | "error" | "warning" | "info";
	message: string;
};

type ToastContainerProps = {
	toasts: ToastItem[];
	onDismiss: (id: string) => void;
};

const colors: Record<string, string> = {
	success: "#a6e3a1",
	error: "#f38ba8",
	warning: "#f9e2af",
	info: "#89b4fa",
};

export const ToastContainer: Component<ToastContainerProps> = (props) => {
	return (
		<div
			style={{
				position: "fixed",
				top: "16px",
				right: "16px",
				"z-index": "3000",
				display: "flex",
				"flex-direction": "column",
				gap: "8px",
			}}
		>
			<For each={props.toasts}>
				{(toast) => (
					<div
						onClick={() => props.onDismiss(toast.id)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								props.onDismiss(toast.id);
							}
						}}
						style={{
							padding: "10px 16px",
							"border-radius": "8px",
							cursor: "pointer",
							"background-color": "#313244",
							"border-left": `3px solid ${colors[toast.type]}`,
							color: "#cdd6f4",
							"font-size": "13px",
							"max-width": "360px",
							"box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
						}}
					>
						{toast.message}
					</div>
				)}
			</For>
		</div>
	);
};
