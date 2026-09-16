export interface ProtectedPathMatch {
	patternId: string;
	pattern: string;
	matchedPath: string;
	warningMessage: string;
	command: string;
}

export interface ProtectedPathPattern {
	id: string;
	pattern: string;
	description: string;
	enabled: boolean;
	isDefault: boolean;
}

export interface ProtectedPathAcknowledgment {
	patternId: string;
	matchedPath: string;
	acknowledgedAt: number;
}
