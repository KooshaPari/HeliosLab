#!/usr/bin/env bun
/**
 * Gate 6: Security vulnerability scanning
 * Scans dependencies for known vulnerabilities using Bun audit
 */

import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-security.json";

export interface Vulnerability {
	id: string;
	package: string;
	severity: "low" | "moderate" | "high" | "critical";
	description: string;
	affectedVersions: string;
	url?: string;
}

/**
 * Parse Bun's package-keyed JSON audit report.
 */
export function parseBunAuditReport(output: string): Vulnerability[] {
	const parsed: unknown = JSON.parse(output);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Bun audit output must be a package-keyed object");
	}

	const vulnerabilities: Vulnerability[] = [];
	for (const [packageName, advisories] of Object.entries(parsed)) {
		if (!Array.isArray(advisories)) {
			throw new Error(`Bun audit advisories for ${packageName} must be an array`);
		}
		for (const advisory of advisories) {
			if (advisory === null || typeof advisory !== "object") {
				throw new Error(`Invalid Bun audit advisory for ${packageName}`);
			}
			const data = advisory as Record<string, unknown>;
			const severity = data.severity;
			if (
				severity !== "low" &&
				severity !== "moderate" &&
				severity !== "high" &&
				severity !== "critical"
			) {
				throw new Error(`Invalid Bun audit severity for ${packageName}`);
			}
			if (
				(typeof data.id !== "string" && typeof data.id !== "number") ||
				typeof data.title !== "string" ||
				typeof data.vulnerable_versions !== "string"
			) {
				throw new Error(`Incomplete Bun audit advisory for ${packageName}`);
			}

			vulnerabilities.push({
				id: String(data.id),
				package: packageName,
				severity,
				description: data.title,
				affectedVersions: data.vulnerable_versions,
				url: typeof data.url === "string" ? data.url : undefined,
			});
		}
	}
	return vulnerabilities;
}

/**
 * Convert vulnerabilities to gate findings.
 */
export function vulnerabilitiesToFindings(vulns: Vulnerability[]): GateFinding[] {
	return vulns.map((v) => {
		const blocking = v.severity === "high" || v.severity === "critical";
		return {
			file: v.package,
			message: `[${v.severity.toUpperCase()}] ${v.id}: ${v.description} (affected: ${v.affectedVersions})`,
			severity: blocking ? "error" : "warning",
			rule: blocking ? "security-vulnerability" : "security-advisory",
			remediation: `Upgrade ${v.package} outside ${v.affectedVersions}${v.url ? `; see ${v.url}` : ""}`,
		};
	});
}

export function evaluateBunAuditResult(result: {
	stdout: string;
	stderr: string;
	exitCode: number;
}): GateFinding[] {
	if (result.stdout.trim().length === 0) {
		return [scannerFailure(result.stderr || `bun audit exited ${result.exitCode} without output`)];
	}

	try {
		const vulnerabilities = parseBunAuditReport(result.stdout);
		if (result.exitCode !== 0 && vulnerabilities.length === 0) {
			return [scannerFailure(result.stderr || `bun audit exited ${result.exitCode}`)];
		}
		return vulnerabilitiesToFindings(vulnerabilities);
	} catch (error) {
		return [scannerFailure(`Unable to parse bun audit output: ${String(error)}`)];
	}
}

function scannerFailure(detail: string): GateFinding {
	return {
		file: "bun.lock",
		message: `Dependency scanner failed: ${detail.trim()}`,
		severity: "error",
		rule: "security-scanner-unavailable",
		remediation: "Restore registry access and rerun bun audit --json",
	};
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const startTime = Date.now();
	let findings: GateFinding[];
	try {
		const audit = Bun.spawnSync({
			cmd: [process.execPath, "audit", "--json"],
			stdout: "pipe",
			stderr: "pipe",
		});
		findings = evaluateBunAuditResult({
			stdout: audit.stdout.toString(),
			stderr: audit.stderr.toString(),
			exitCode: audit.exitCode,
		});
	} catch (error) {
		findings = [scannerFailure(String(error))];
	}
	const duration = Date.now() - startTime;

	const report = createGateReport("security", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);

	console.log(formatGateReport(report));

	if (findings.length === 0) {
		console.log("No high or critical security vulnerabilities found.");
	}

	process.exit(report.status === "pass" ? 0 : 1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`Error: ${e}`);
		process.exit(2);
	});
}
