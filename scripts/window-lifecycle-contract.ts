#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";

import {
	createGateReport,
	formatGateReport,
	type GateFinding,
	type GateReport,
	writeGateReport,
} from "./gate-report";

const ENTRY_PATH = "apps/desktop/src/index.ts";
const PERSISTENCE_PATH = "apps/desktop/src/stores/persistence.store.ts";
const REPORT_PATH = ".gate-reports/gate-window-lifecycle.json";

export type WindowLifecycleEvidence = {
	entrySource: string;
	persistenceSource: string;
};

export function evaluateWindowLifecycleContract(
	evidence: WindowLifecycleEvidence,
): GateFinding[] {
	const findings: GateFinding[] = [];

	const createsNativeWindow =
		evidence.entrySource.includes("createWindow(") ||
		evidence.entrySource.includes("new BrowserWindow(") ||
		evidence.entrySource.includes("new Electroview(");
	if (!createsNativeWindow) {
		findings.push({
			file: ENTRY_PATH,
			message: "Desktop startup does not create a native application window",
			severity: "error",
			rule: "window-create",
			remediation: "Create the ElectroBun window during desktop startup",
		});
	}

	const hasLifecycleControls = [".close(", ".minimize(", ".maximize("].every((operation) =>
		evidence.entrySource.includes(operation),
	);
	if (!hasLifecycleControls) {
		findings.push({
			file: ENTRY_PATH,
			message: "Close, minimize, and maximize operations are not wired to the native window",
			severity: "error",
			rule: "window-controls",
			remediation: "Bind every required window lifecycle control to the ElectroBun window",
		});
	}

	const hasGeometryPersistence =
		/(?:windowGeometry|windowState)/.test(evidence.persistenceSource) &&
		/(?:persist|save)/i.test(evidence.persistenceSource) &&
		/(?:load|restore)/i.test(evidence.persistenceSource);
	if (!hasGeometryPersistence) {
		findings.push({
			file: PERSISTENCE_PATH,
			message: "Window geometry and state are not persisted or restored across restarts",
			severity: "error",
			rule: "window-state-persistence",
			remediation: "Persist validated window geometry on change and restore it during startup",
		});
	}

	return findings;
}

export function createWindowLifecycleReport(evidence: WindowLifecycleEvidence): GateReport {
	return createGateReport(
		"window-lifecycle-contract",
		evaluateWindowLifecycleContract(evidence),
		0,
	);
}

function main(): void {
	const entrySource = existsSync(ENTRY_PATH) ? readFileSync(ENTRY_PATH, "utf8") : "";
	const persistenceSource = existsSync(PERSISTENCE_PATH)
		? readFileSync(PERSISTENCE_PATH, "utf8")
		: "";
	const report = createWindowLifecycleReport({ entrySource, persistenceSource });
	writeGateReport(report, REPORT_PATH);
	process.stdout.write(`${formatGateReport(report)}\n`);
	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main();
}
