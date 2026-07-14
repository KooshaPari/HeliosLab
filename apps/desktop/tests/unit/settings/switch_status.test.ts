import { SwitchStatus } from "../../../src/settings/switch_status";

describe("SwitchStatus", () => {
  let container: HTMLDivElement;
  let status: SwitchStatus;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (status) {
      status.unmount();
    }
    document.body.removeChild(container);
  });

  it("should not render when inactive", () => {
    status = new SwitchStatus();
    status.mount(container);
    status.update({ isActive: false });

    const statusDiv = container.querySelector(".switch-status");
    expect(statusDiv).toBeFalsy();
  });

  it("should show progress message when started", () => {
    status = new SwitchStatus();
    status.mount(container);
    status.update({ isActive: true, phase: "started" });

    const message = container.querySelector(".switch-status-message");
    expect(message?.textContent).toContain("Switching renderer");
  });

  it("should show success message when committed", () => {
    status = new SwitchStatus();
    status.mount(container);
    status.update({ isActive: true, phase: "committed" });

    const message = container.querySelector(".switch-status-message");
    expect(message?.textContent).toContain("Switch successful");
  });

  it("should show failure message with reason", () => {
    status = new SwitchStatus();
    status.mount(container);
    status.update({
      isActive: true,
      phase: "failed",
      failureReason: "Timeout",
    });

    const message = container.querySelector(".switch-status-message");
    expect(message?.textContent).toContain("Switch failed");
    expect(message?.textContent).toContain("Timeout");
  });

  it("should show rollback message", () => {
    status = new SwitchStatus();
    status.mount(container);
    status.update({
      isActive: true,
      phase: "rolled_back",
      failureReason: "Compatibility issue",
    });

    const message = container.querySelector(".switch-status-message");
    expect(message?.textContent).toContain("Switch rolled back");
    expect(message?.textContent).toContain("Compatibility issue");
  });

  it("should display progress bar during transaction", () => {
    status = new SwitchStatus();
    status.mount(container);
    status.update({ isActive: true, phase: "swapping", elapsedMs: 2000 });

    const progressBar = container.querySelector(".switch-status");
    expect(progressBar).toBeTruthy();
  });
});
