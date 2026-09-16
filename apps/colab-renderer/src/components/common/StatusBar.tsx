import type { Component } from "solid-js";
import { getAppState } from "../../stores/app.store";

export const StatusBar: Component = () => {
	const state = getAppState;

	function connectionColor(): string {
		const status = state().connectionStatus;
		if (status === "connected") return "#a6e3a1";
		if (status === "reconnecting") return "#f9e2af";
		return "#f38ba8";
	}

	return (
		<div
			style={{
				height: "24px",
				"min-height": "24px",
				"background-color": "#11111b",
				"border-top": "1px solid #313244",
				display: "flex",
				"align-items": "center",
				"justify-content": "space-between",
				padding: "0 12px",
				"font-size": "11px",
				color: "#6c7086",
				"flex-shrink": "0",
			}}
		>
			<div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
				<div
					style={{
						width: "8px",
						height: "8px",
						"border-radius": "50%",
						"background-color": connectionColor(),
					}}
				/>
				<span>{state().connectionStatus}</span>
			</div>
			<div style={{ color: "#89b4fa", "font-weight": "500" }}>
				{state().activeModel}
			</div>
			<div>session: --</div>
		</div>
	);
};
