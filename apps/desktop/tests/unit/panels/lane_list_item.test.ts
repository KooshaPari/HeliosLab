import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { LaneListItem } from "../../../src/panels/lane_list_item";

describe("LaneListItem", () => {
	let container: HTMLDivElement;
	let item: LaneListItem;

	const mockProps = {
		laneId: "lane-1",
		laneName: "Test Lane",
		state: "running",
		onSelect: mock(),
		onContextMenu: mock(),
	};

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		if (item) {
			item.unmount();
		}
		document.body.removeChild(container);
	});

	it("should render lane item with status badge", () => {
		item = new LaneListItem(mockProps);
		item.mount(container);

		const laneItem = container.querySelector(".lane-list-item");
		expect(laneItem).toBeTruthy();
		expect(laneItem?.getAttribute("data-lane-item")).toBe("lane-1");
	});

	it("should render lane name", () => {
		item = new LaneListItem(mockProps);
		item.mount(container);

		const nameSpan = container.querySelector(".lane-item-name");
		expect(nameSpan?.textContent).toBe("Test Lane");
	});

	it("should display active indicator when isActive is true", () => {
		item = new LaneListItem({ ...mockProps, isActive: true });
		item.mount(container);

		const activeIndicator = container.querySelector(
			".lane-item-active-indicator",
		);
		expect(activeIndicator).toBeTruthy();

		const laneItem = container.querySelector(".lane-list-item");
		expect(laneItem?.classList.contains("active")).toBeTruthy();
	});

	it("should display selected state when isSelected is true", () => {
		item = new LaneListItem({ ...mockProps, isSelected: true });
		item.mount(container);

		const laneItem = container.querySelector(".lane-list-item");
		expect(laneItem?.classList.contains("selected")).toBeTruthy();
		expect(laneItem?.getAttribute("aria-selected")).toBe("true");
	});

	it("should display orphan warning icon when isOrphaned is true", () => {
		item = new LaneListItem({ ...mockProps, isOrphaned: true });
		item.mount(container);

		const orphanIcon = container.querySelector(".orphan-icon");
		expect(orphanIcon).toBeTruthy();
		expect(orphanIcon?.textContent).toBe("⚠");
	});

	it("should display session count when provided", () => {
		item = new LaneListItem({ ...mockProps, sessionCount: 3 });
		item.mount(container);

		const countSpan = container.querySelector(".lane-item-count");
		expect(countSpan?.textContent).toBe("3");
	});

	it("should not display session count when not provided", () => {
		item = new LaneListItem(mockProps);
		item.mount(container);

		const countSpan = container.querySelector(".lane-item-count");
		expect(countSpan).toBeFalsy();
	});

	it("should truncate long lane names", () => {
		const longName = "A".repeat(50);
		item = new LaneListItem({ ...mockProps, laneName: longName });
		item.mount(container);

		const nameSpan = container.querySelector(".lane-item-name");
		expect(nameSpan?.textContent?.length).toBeLessThanOrEqual(33); // 30 chars + "..."
	});

	it("should set title attribute for truncated names", () => {
		const longName = "A".repeat(50);
		item = new LaneListItem({ ...mockProps, laneName: longName });
		item.mount(container);

		const nameSpan = container.querySelector(".lane-item-name");
		expect(nameSpan?.getAttribute("title")).toBe(longName);
	});

	it("should call onSelect when clicked", () => {
		const onSelect = mock();
		item = new LaneListItem({ ...mockProps, onSelect });
		item.mount(container);

		const laneItem = container.querySelector(".lane-list-item") as HTMLElement;
		laneItem?.click();

		expect(onSelect).toHaveBeenCalledWith("lane-1");
	});

	it("should call onContextMenu when right-clicked", () => {
		const onContextMenu = mock();
		item = new LaneListItem({ ...mockProps, onContextMenu });
		item.mount(container);

		const laneItem = container.querySelector(".lane-list-item") as HTMLElement;
		const event = new MouseEvent("contextmenu", { bubbles: true });
		laneItem?.dispatchEvent(event);

		expect(onContextMenu).toHaveBeenCalled();
		expect(onContextMenu).toHaveBeenCalledWith(
			"lane-1",
			expect.any(MouseEvent),
		);
	});

	it("should call onSelect when Enter is pressed", () => {
		const onSelect = mock();
		item = new LaneListItem({ ...mockProps, onSelect });
		item.mount(container);

		const laneItem = container.querySelector(".lane-list-item") as HTMLElement;
		const event = new KeyboardEvent("keydown", { key: "Enter" });
		laneItem?.dispatchEvent(event);

		expect(onSelect).toHaveBeenCalledWith("lane-1");
	});

	it("should update item state when update() is called", () => {
		item = new LaneListItem(mockProps);
		item.mount(container);

		let laneItem = container.querySelector(".lane-list-item");
		expect(laneItem?.classList.contains("active")).toBeFalsy();

		item.update({ isActive: true });

		laneItem = container.querySelector(".lane-list-item");
		expect(laneItem?.classList.contains("active")).toBeTruthy();
	});

	it("should have proper accessibility attributes", () => {
		item = new LaneListItem({ ...mockProps, isSelected: true });
		item.mount(container);

		const laneItem = container.querySelector(".lane-list-item");
		expect(laneItem?.getAttribute("role")).toBe("option");
		expect(laneItem?.getAttribute("aria-selected")).toBe("true");
		expect(laneItem?.getAttribute("tabindex")).toBe("0");
	});

	it("should render correct badge state", () => {
		const statesList = [
			"idle",
			"running",
			"error",
			"blocked",
			"shared",
			"provisioning",
			"cleaning",
			"closed",
		];

		statesList.forEach((state) => {
			item = new LaneListItem({ ...mockProps, state });
			item.mount(container);

			const badge = container.querySelector(".badge-icon");
			expect(badge?.getAttribute("data-state")).toBe(state);

			item.unmount();
			while (container.firstChild) {
				container.removeChild(container.firstChild);
			}
		});
	});

	it("should handle both orphaned and active states together", () => {
		item = new LaneListItem({
			...mockProps,
			isOrphaned: true,
			isActive: true,
		});
		item.mount(container);

		const orphanIcon = container.querySelector(".orphan-icon");
		const activeIndicator = container.querySelector(
			".lane-item-active-indicator",
		);
		const laneItem = container.querySelector(".lane-list-item");

		expect(orphanIcon).toBeTruthy();
		expect(activeIndicator).toBeTruthy();
		expect(laneItem?.classList.contains("active")).toBeTruthy();
	});
});
