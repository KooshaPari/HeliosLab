/**
 * FR-HELIOS-070: Runtime Metrics Tests
 * Verifies: FR-PRF-001 (Instrumentation hooks for lane-create, session-restore)
 */
import { expect, test } from "bun:test";
import { InMemoryLocalBus } from "../../../src/protocol/bus";

test("captures lane create latency metrics", async () => {
	const bus = new InMemoryLocalBus();

	const response = await bus.request({
		id: "cmd-1",
		type: "command",
		ts: new Date().toISOString(),
		workspace_id: "workspace-alpha",
		correlation_id: "corr-lane-1",
		method: "lane.create",
		payload: { id: "lane-alpha" },
	});

	expect(response.status).toBe("ok");

	const report = bus.getMetricsReport();
	const laneSummary = report.summaries.find(
		(metric) => metric.metric === "lane_create_latency_ms",
	);
	expect(laneSummary).toBeDefined();
	expect((laneSummary?.count ?? 0) >= 1).toBe(true);

	const metricEvents = bus
		.getEvents()
		.filter((event) => event.topic === "diagnostics.metric");
	expect(
		metricEvents.some(
			(event) => event.payload?.metric === "lane_create_latency_ms",
		),
	).toBe(true);
});

test("captures session restore latency metrics", async () => {
	const bus = new InMemoryLocalBus();

	const response = await bus.request({
		id: "cmd-restore-1",
		type: "command",
		ts: new Date().toISOString(),
		workspace_id: "workspace-alpha",
		lane_id: "lane-alpha",
		session_id: "session-restore",
		correlation_id: "corr-restore-1",
		method: "session.attach",
		payload: { id: "session-restore", restore: true },
	});

	expect(response.status).toBe("ok");

	const report = bus.getMetricsReport();
	const restoreSummary = report.summaries.find(
		(metric) => metric.metric === "session_restore_latency_ms",
	);
	expect(restoreSummary).toBeDefined();
	expect((restoreSummary?.count ?? 0) >= 1).toBe(true);
});

test("captures terminal output backlog depth", async () => {
	const bus = new InMemoryLocalBus();

	await bus.publish({
		id: "evt-output-1",
		type: "event",
		ts: new Date().toISOString(),
		workspace_id: "workspace-alpha",
		lane_id: "lane-alpha",
		session_id: "session-1",
		topic: "terminal.output",
		terminal_id: "terminal-1",
		correlation_id: "corr-output-1",
		payload: {
			line: "hello",
			backlog_depth: 17,
		},
	});

	const report = bus.getMetricsReport();
	const backlogSummary = report.summaries.find(
		(metric) => metric.metric === "terminal_output_backlog_depth",
	);

	expect(backlogSummary).toBeDefined();
	expect(backlogSummary?.latest).toBe(17);

	const metricEvents = bus
		.getEvents()
		.filter((event) => event.topic === "diagnostics.metric");
	expect(
		metricEvents.some(
			(event) => event.payload?.metric === "terminal_output_backlog_depth",
		),
	).toBe(true);
});
