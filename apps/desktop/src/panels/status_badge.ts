/**
 * Status Badge Component
 * Displays a color-coded indicator for each lane's lifecycle state
 */

export interface StatusBadgeProps {
	state: string;
	isOrphaned?: boolean;
	theme?: "light" | "dark";
}

export const DEFAULT_COLOR_SCHEME: Record<
	string,
	{ color: string; bgColor: string }
> = {
	idle: { color: "#999999", bgColor: "#f5f5f5" },
	running: { color: "#22c55e", bgColor: "#dcfce7" },
	blocked: { color: "#eab308", bgColor: "#fefce8" },
	error: { color: "#ef4444", bgColor: "#fee2e2" },
	shared: { color: "#3b82f6", bgColor: "#dbeafe" },
	provisioning: { color: "#f59e0b", bgColor: "#fef3c7" },
	cleaning: { color: "#f59e0b", bgColor: "#fef3c7" },
	closed: { color: "#6b7280", bgColor: "#f3f4f6" },
	orphaned: { color: "#ea580c", bgColor: "#fed7aa" },
};

export interface StatusBadgeContent {
	icon: string;
	label: string;
	color: string;
	bgColor: string;
}

export class StatusBadge {
	private props: StatusBadgeProps;
	private container: HTMLElement | null = null;

	constructor(props: StatusBadgeProps) {
		this.props = props;
	}

	mount(container: HTMLElement): void {
		this.container = container;
		this.render();
	}

	unmount(): void {
		this.container = null;
	}

	update(props: Partial<StatusBadgeProps>): void {
		Object.assign(this.props, props);
		this.render();
	}

	private render(): void {
		if (!this.container) return;

		// Clear children safely
		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		const badge = this.createBadgeElement();
		this.container.appendChild(badge);
	}

	private createBadgeElement(): HTMLElement {
		const content = this.getBadgeContent(this.props.state);
		const container = document.createElement("span");
		container.className = "status-badge";
		container.setAttribute("data-state", this.props.state);
		container.setAttribute("role", "status");
		container.setAttribute("aria-label", content.label);

		// Set inline styles
		container.style.color = content.color;
		container.style.backgroundColor = content.bgColor;

		// Icon
		const icon = document.createElement("span");
		icon.className = "badge-icon";
		icon.textContent = content.icon;

		// Tooltip
		const tooltip = document.createElement("span");
		tooltip.className = "badge-tooltip";
		tooltip.textContent = content.label;

		container.appendChild(icon);
		container.appendChild(tooltip);

		return container;
	}

	getBadgeContent(state: string): StatusBadgeContent {
		const baseContent = this.getBaseContent(state);
		const colorScheme =
			DEFAULT_COLOR_SCHEME[state] || DEFAULT_COLOR_SCHEME.idle;

		return {
			...baseContent,
			color: colorScheme.color,
			bgColor: colorScheme.bgColor,
		};
	}

	private getBaseContent(
		state: string,
	): Omit<StatusBadgeContent, "color" | "bgColor"> {
		const stateMap: Record<
			string,
			Omit<StatusBadgeContent, "color" | "bgColor">
		> = {
			idle: { icon: "●", label: "Idle" },
			running: { icon: "●", label: "Running" },
			blocked: { icon: "●", label: "Blocked" },
			error: { icon: "●", label: "Error" },
			shared: { icon: "●", label: "Shared" },
			provisioning: { icon: "◌", label: "Provisioning..." },
			cleaning: { icon: "◌", label: "Cleaning..." },
			closed: { icon: "✕", label: "Closed" },
			orphaned: { icon: "⚠", label: "Orphaned" },
		};

		return stateMap[state] || { icon: "?", label: "Unknown state" };
	}
}

export function createStatusBadge(props: StatusBadgeProps): StatusBadge {
	return new StatusBadge(props);
}

export function getStatusBadgeContent(state: string): StatusBadgeContent {
	const badge = new StatusBadge({ state });
	return badge.getBadgeContent(state);
}
