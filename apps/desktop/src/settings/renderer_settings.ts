/**
 * Renderer Settings Section
 * Manages the renderer engine selection within the app settings panel
 */

export interface Renderer {
	id: string;
	name: string;
	isAvailable: boolean;
	isActive: boolean;
}

export interface RendererSettingsProps {
	renderers: Renderer[];
	onRendererSelect: (rendererId: string) => void;
	isLoading?: boolean;
	error?: string;
}

export class RendererSettings {
	private props: RendererSettingsProps;
	private container: HTMLElement | null = null;

	constructor(props: RendererSettingsProps) {
		this.props = props;
	}

	mount(container: HTMLElement): void {
		this.container = container;
		this.render();
	}

	unmount(): void {
		this.container = null;
	}

	update(props: Partial<RendererSettingsProps>): void {
		Object.assign(this.props, props);
		this.render();
	}

	private render(): void {
		if (!this.container) return;

		while (this.container.firstChild) {
			this.container.removeChild(this.container.firstChild);
		}

		const section = this.createSettingsSection();
		this.container.appendChild(section);
	}

	private createSettingsSection(): HTMLElement {
		const section = document.createElement("div");
		section.className = "renderer-settings-section";
		section.style.padding = "16px";
		section.style.borderRadius = "8px";
		section.style.backgroundColor = "#f9fafb";
		section.style.marginBottom = "16px";

		// Header
		const header = document.createElement("h2");
		header.className = "renderer-settings-header";
		header.textContent = "Renderer Engine";
		header.style.margin = "0 0 8px 0";
		header.style.fontSize = "16px";
		header.style.fontWeight = "600";
		header.style.color = "#1f2937";
		section.appendChild(header);

		// Description
		const description = document.createElement("p");
		description.className = "renderer-settings-description";
		description.textContent = "Choose your terminal renderer engine.";
		description.style.margin = "0 0 16px 0";
		description.style.fontSize = "14px";
		description.style.color = "#6b7280";
		section.appendChild(description);

		// Content
		if (this.props.isLoading) {
			const loading = document.createElement("div");
			loading.className = "renderer-settings-loading";
			loading.textContent = "Loading renderer options...";
			loading.style.padding = "16px";
			loading.style.textAlign = "center";
			loading.style.color = "#9ca3af";
			section.appendChild(loading);
		} else if (this.props.error) {
			const error = document.createElement("div");
			error.className = "renderer-settings-error";
			error.textContent = `Error: ${this.props.error}`;
			error.style.padding = "12px";
			error.style.backgroundColor = "#fee2e2";
			error.style.color = "#991b1b";
			error.style.borderRadius = "4px";
			error.style.fontSize = "14px";
			section.appendChild(error);
		} else {
			const optionsContainer = document.createElement("div");
			optionsContainer.className = "renderer-options";
			optionsContainer.style.display = "flex";
			optionsContainer.style.flexDirection = "column";
			optionsContainer.style.gap = "12px";

			this.props.renderers.forEach((renderer) => {
				optionsContainer.appendChild(this.createRendererOption(renderer));
			});

			section.appendChild(optionsContainer);
		}

		return section;
	}

	private createRendererOption(renderer: Renderer): HTMLElement {
		const option = document.createElement("div");
		option.className = `renderer-option ${renderer.isActive ? "active" : ""} ${renderer.isAvailable ? "available" : "unavailable"}`;
		option.setAttribute("data-renderer", renderer.id);
		option.style.padding = "12px";
		option.style.backgroundColor = "white";
		option.style.borderRadius = "6px";
		option.style.border = renderer.isActive
			? "2px solid #3b82f6"
			: "1px solid #e5e7eb";
		option.style.cursor = renderer.isAvailable ? "pointer" : "not-allowed";
		option.style.opacity = renderer.isAvailable ? "1" : "0.6";
		option.style.transition = "all 200ms ease-in-out";

		if (renderer.isAvailable && !renderer.isActive) {
			option.style.position = "relative";
			option.addEventListener("mouseenter", () => {
				option.style.backgroundColor = "#f3f4f6";
			});
			option.addEventListener("mouseleave", () => {
				option.style.backgroundColor = "white";
			});
		}

		// Content container
		const content = document.createElement("div");
		content.style.display = "flex";
		content.style.justifyContent = "space-between";
		content.style.alignItems = "center";

		// Name and status
		const nameContainer = document.createElement("div");
		nameContainer.style.flex = "1";

		const name = document.createElement("span");
		name.className = "renderer-name";
		name.textContent = renderer.name;
		name.style.fontWeight = "500";
		name.style.color = "#1f2937";
		name.style.fontSize = "14px";
		nameContainer.appendChild(name);

		// Availability/Active badge
		const badge = document.createElement("span");
		badge.className = "renderer-badge";
		badge.style.marginLeft = "8px";
		badge.style.fontSize = "12px";
		badge.style.padding = "2px 8px";
		badge.style.borderRadius = "3px";

		if (renderer.isActive) {
			badge.textContent = "Active";
			badge.style.backgroundColor = "#dbeafe";
			badge.style.color = "#0c4a6e";
		} else if (!renderer.isAvailable) {
			badge.textContent = "Unavailable";
			badge.style.backgroundColor = "#fecaca";
			badge.style.color = "#7f1d1d";
		} else {
			badge.textContent = "Available";
			badge.style.backgroundColor = "#dcfce7";
			badge.style.color = "#166534";
		}

		nameContainer.appendChild(badge);
		content.appendChild(nameContainer);

		// Radio button or indicator
		const indicator = document.createElement("input");
		indicator.type = "radio";
		indicator.name = "renderer-select";
		indicator.value = renderer.id;
		indicator.checked = renderer.isActive;
		indicator.disabled = !renderer.isAvailable;
		indicator.style.cursor = renderer.isAvailable ? "pointer" : "not-allowed";

		content.appendChild(indicator);

		option.appendChild(content);

		// Click handler
		if (renderer.isAvailable) {
			option.addEventListener("click", () => {
				indicator.checked = true;
				this.props.onRendererSelect(renderer.id);
			});
		}

		return option;
	}
}

export function createRendererSettings(
	props: RendererSettingsProps,
): RendererSettings {
	return new RendererSettings(props);
}
