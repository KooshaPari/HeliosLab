/**
 * FR-HELIOS-079: Protocol Assets Tests
 * Verifies: FR-BUS-003 (Method registry), FR-BUS-004 (Topic registry)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { METHODS } from "../../../src/protocol/methods";
import { TOPICS } from "../../../src/protocol/topics";

type StringCollectionDoc = {
	methods?: string[];
	topics?: string[];
};

type SchemaBranch = {
	if?: {
		properties?: Record<string, { const?: string }>;
		required?: string[];
	};
	then?: {
		required?: string[];
	};
};

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function getConditionalRequiredSets(contract: Record<string, unknown>) {
	const branches = (
		(contract.allOf as SchemaBranch[] | undefined) ?? []
	).filter((branch) => branch.if?.properties && branch.then?.required);

	const responseRequired = new Set<string>();
	const methodRequired = new Map<string, string[]>();
	const topicRequired = new Map<string, string[]>();

	for (const branch of branches) {
		const typeConst = branch.if?.properties?.type?.const;
		const methodConst = branch.if?.properties?.method?.const;
		const topicConst = branch.if?.properties?.topic?.const;
		const required = [...new Set(branch.then?.required ?? [])].sort();

		if (typeConst === "response" && !methodConst && !topicConst) {
			for (const field of required) {
				responseRequired.add(field);
			}
		}
		if (typeConst === "command" && methodConst) {
			methodRequired.set(methodConst, required);
		}
		if (typeConst === "event" && topicConst) {
			topicRequired.set(topicConst, required);
		}
	}

	return { responseRequired, methodRequired, topicRequired };
}

describe("protocol asset parity", () => {
	test("keeps runtime methods and topics aligned with protocol specs", () => {
		const methodsDoc = readJson<StringCollectionDoc>(
			"specs/protocol/v1/methods.json",
		);
		const topicsDoc = readJson<StringCollectionDoc>(
			"specs/protocol/v1/topics.json",
		);

		expect(methodsDoc.methods ?? []).toEqual([...METHODS]);
		expect(topicsDoc.topics ?? []).toEqual([...TOPICS]);
	});

	test("keeps contract schema enums aligned with runtime protocol sets", () => {
		const contract = readJson<Record<string, unknown>>(
			[
				"agileplus-specs",
				"colab-agent-terminal-control-plane",
				"contracts",
				"orchestration-envelope.schema.json",
			].join("/"),
		);
		const properties = (contract.properties as Record<string, unknown>) ?? {};
		const methodProp = (properties.method as Record<string, unknown>) ?? {};
		const topicProp = (properties.topic as Record<string, unknown>) ?? {};
		const methodEnum = ((methodProp.enum as Array<string | null>) ?? []).filter(
			Boolean,
		);
		const topicEnum = ((topicProp.enum as Array<string | null>) ?? []).filter(
			Boolean,
		);

		expect(methodEnum).toEqual([...METHODS]);
		expect(topicEnum).toEqual([...TOPICS]);
	});

	test("keeps contract schema conditional required fields aligned with runtime guards", () => {
		const contract = readJson<Record<string, unknown>>(
			[
				"agileplus-specs",
				"colab-agent-terminal-control-plane",
				"contracts",
				"orchestration-envelope.schema.json",
			].join("/"),
		);
		const { responseRequired, methodRequired, topicRequired } =
			getConditionalRequiredSets(contract);

		expect([...responseRequired].sort()).toEqual(["status"]);
		expect(methodRequired).toEqual(
			new Map<string, string[]>([
				["lane.create", ["correlation_id", "workspace_id"]],
				[
					"session.attach",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
				[
					"terminal.spawn",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
			]),
		);
		expect(topicRequired).toEqual(
			new Map<string, string[]>([
				["lane.create.started", ["correlation_id", "lane_id", "workspace_id"]],
				["lane.created", ["correlation_id", "lane_id", "workspace_id"]],
				["lane.create.failed", ["correlation_id", "lane_id", "workspace_id"]],
				[
					"session.attach.started",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
				[
					"session.attached",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
				[
					"session.attach.failed",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
				[
					"terminal.spawn.started",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
				[
					"terminal.spawned",
					[
						"correlation_id",
						"lane_id",
						"session_id",
						"terminal_id",
						"workspace_id",
					],
				],
				[
					"terminal.spawn.failed",
					["correlation_id", "lane_id", "session_id", "workspace_id"],
				],
			]),
		);
	});

	test("keeps schema timestamp pattern aligned with strict RFC3339 runtime contract", () => {
		const contract = readJson<Record<string, unknown>>(
			[
				"agileplus-specs",
				"colab-agent-terminal-control-plane",
				"contracts",
				"orchestration-envelope.schema.json",
			].join("/"),
		);
		const properties = (contract.properties as Record<string, unknown>) ?? {};
		const ts = (properties.ts as Record<string, unknown>) ?? {};
		const timestamp = (properties.timestamp as Record<string, unknown>) ?? {};
		const expectedPattern =
			"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$";

		expect(ts.pattern).toBe(expectedPattern);
		expect(timestamp.pattern).toBe(expectedPattern);
	});

	// These six topics appear in the older contract copies (docs/specs,
	// apps/runtime/tests/contracts, .archive) but not in the canonical contract
	// or in TOPICS, which is why the parity gate passes while the declared
	// surface stays incomplete.
	//
	// One of the six is drift rather than a pure gap: bus/lifecycle.ts declares
	// lane.attach.started and request-handlers.ts already publishes it, so the
	// emitter and its own registry disagree about the same topic. An earlier
	// version of this comment claimed the runtime never emits any of the six,
	// which was wrong for that one.
	//
	// The assertion above previously required all fifteen conditional-required
	// rules, which cannot hold against the canonical contract, so it now covers
	// the nine that are defined and this records the remainder. Keeping it as a
	// test means implementing the surface turns a failure green rather than
	// silently widening an assertion.
	test("the contract's lane attach/cleanup and session terminate topics are not implemented", () => {
		const unimplemented = [
			"lane.attach.started",
			"lane.attach.failed",
			"lane.cleanup.started",
			"lane.cleanup.failed",
			"session.terminate.started",
			"session.terminate.failed",
		];

		for (const topic of unimplemented) {
			expect(TOPICS).not.toContain(topic);
		}
	});
});
