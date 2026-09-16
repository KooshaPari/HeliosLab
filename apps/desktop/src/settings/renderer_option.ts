/**
 * Renderer Option Component
 * Displays a selectable renderer entry with availability and active status
 */

export interface RendererOptionProps {
	rendererId: string;
	name: string;
	isAvailable: boolean;
	isActive: boolean;
	unavailableReason?: string;
	onSelect: (rendererId: string) => void;
}

export class RendererOption {
	private props: RendererOptionProps;
	private container: HTMLElement | null = null;

	constructor(props: RendererOptionProps) {
		this.props = props;
	}

	mount(container: HTMLElement): void {
		this.container = container;
		this.render();
		this.attachEventListeners();
	}

	unmount(): void {
		this.detachEventListeners();
		this.container = null;
	}

	update(props: Partial<RendererOptionProps>): void {
		Object.assign(this.props, props);
		this.render();
	}

	private render(): void {
		if (!this.container) return;

		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		const option = this.createOptionElement();
		this.container.appendChild(option);
	}

	private createOptionElement(): HTMLElement {
		const option = document.createElement("div");
		option.className = "renderer-option";
		option.setAttribute("data-renderer", this.props.rendererId);
		option.style.padding = "12px";
		option.style.backgroundColor = this.props.isActive ? "#eff6ff" : "white";
		option.style.borderRadius = "6px";
		option.style.border = this.props.isActive
			? "2px solid #3b82f6"
			: "1px solid #e5e7eb";
		option.style.cursor = this.props.isAvailable ? "pointer" : "not-allowed";
		option.style.opacity = this.props.isAvailable ? "1" : "0.6";
		option.style.transition = "all 150ms ease-in-out";
		option.role = "button";
		option.tabIndex = this.props.isAvailable ? 0 : -1;

		if (this.props.unavailableReason) {
			option.setAttribute("title", this.props.unavailableReason);
		}

		// Content layout
		const contentContainer = document.createElement("div");
		contentContainer.style.display = "flex";
		contentContainer.style.justifyContent = "space-between";
		contentContainer.style.alignItems = "center";

		// Left side: name and badges
		const leftSide = document.createElement("div");
		leftSide.style.flex = "1";
		leftSide.style.display = "flex";
		leftSide.style.alignItems = "center";
		leftSide.style.gap = "8px";

		// Name
		const nameSpan = document.createElement("span");
		nameSpan.className = "renderer-name";
		nameSpan.textContent = this.props.name;
		nameSpan.style.fontWeight = "500";
		nameSpan.style.color = "#1f2937";
		nameSpan.style.fontSize = "14px";
		leftSide.appendChild(nameSpan);

		// Status badge
		if (this.props.isActive) {
			const activeBadge = document.createElement("span");
			activeBadge.className = "active-badge";
			activeBadge.textContent = "Active";
			activeBadge.style.backgroundColor = "#dbeafe";
			activeBadge.style.color = "#0c4a6e";
			activeBadge.style.fontSize = "12px";
			activeBadge.style.padding = "2px 8px";
			activeBadge.style.borderRadius = "3px";
			activeBadge.style.fontWeight = "500";
			leftSide.appendChild(activeBadge);
		}

		if (!this.props.isAvailable) {
			const unavailableBadge = document.createElement("span");
			unavailableBadge.className = "unavailable-badge";
			unavailableBadge.textContent = "Not Available";
			unavailableBadge.style.backgroundColor = "#fecaca";
			unavailableBadge.style.color = "#7f1d1d";
			unavailableBadge.style.fontSize = "12px";
			unavailableBadge.style.padding = "2px 8px";
			unavailableBadge.style.borderRadius = "3px";
			leftSide.appendChild(unavailableBadge);
		}

		contentContainer.appendChild(leftSide);

		// Right side: radio button
		const radioInput = document.createElement("input");
		radioInput.type = "radio";
		radioInput.name = "renderer-select";
		radioInput.value = this.props.rendererId;
		radioInput.checked = this.props.isActive;
		radioInput.disabled = !this.props.isAvailable;
		radioInput.style.cursor = this.props.isAvailable
			? "pointer"
			: "not-allowed";

		contentContainer.appendChild(radioInput);

		option.appendChild(contentContainer);

		return option;
	}

	private attachEventListeners(): void {
		if (!this.container) return;

		const option = this.container.querySelector(
			".renderer-option",
		) as HTMLElement;
		if (!option) return;

		if (this.props.isAvailable) {
			option.addEventListener("click", () => {
				if (!this.props.isActive) {
					this.props.onSelect(this.props.rendererId);
				}
			});

			option.addEventListener("keydown", (e) => {
				const event = e as KeyboardEvent;
				if (event.key === "Enter" && !this.props.isActive) {
					event.preventDefault();
					this.props.onSelect(this.props.rendererId);
				}
			});

			// Hover effect
			option.addEventListener("mouseenter", () => {
				if (!this.props.isActive) {
					option.style.backgroundColor = "#f3f4f6";
				}
			});

			option.addEventListener("mouseleave", () => {
				option.style.backgroundColor = this.props.isActive
					? "#eff6ff"
					: "white";
			});
		}
	}

	private detachEventListeners(): void {
		// Event listeners are automatically removed when element is removed
	}
}

export function createRendererOption(
	props: RendererOptionProps,
): RendererOption {
	return new RendererOption(props);
}
