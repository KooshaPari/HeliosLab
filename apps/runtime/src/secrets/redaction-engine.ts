// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactionContext {
  artifactId: string;
  artifactType: string;
  correlationId: string;
}

export interface RedactionMatch {
  category: string;
  ruleId: string;
  position: number;
  length: number;
}

export interface RedactionResult {
  redacted: string;
  matches: RedactionMatch[];
  latencyMs: number;
}

export interface RedactionStats {
  totalScans: number;
  totalMatches: number;
  avgLatencyMs: number;
}

export interface RedactionRule {
  id: string;
  category: string;
  pattern: RegExp;
  description: string;
  enabled: boolean;
  falsePositiveRate?: number;
}

export function assertRedactionPatternConsumesInput(pattern: RegExp): void {
  const probe = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  const emptyMatch = probe.exec("");
  if (emptyMatch?.[0].length === 0) {
    throw new Error("Invalid redaction rule: pattern must consume input");
  }
}

interface CollectedRedactionMatch {
  start: number;
  end: number;
  category: string;
  ruleId: string;
}

function collectRuleMatches(
  content: string,
  rule: RedactionRule,
  regex: RegExp
): CollectedRedactionMatch[] {
  const matches: CollectedRedactionMatch[] = [];
  regex.lastIndex = 0;
  let match = regex.exec(content);
  while (match !== null) {
    const matchedText = match[0];
    if (matchedText === undefined || matchedText.length === 0) {
      const codePoint = content.codePointAt(match.index);
      regex.lastIndex =
        match.index + (regex.unicode && codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
    } else {
      matches.push({
        start: match.index,
        end: match.index + matchedText.length,
        category: rule.category,
        ruleId: rule.id,
      });
    }
    match = regex.exec(content);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// RedactionEngine
// ---------------------------------------------------------------------------

export class RedactionEngine {
  private compiledRules: Array<{ rule: RedactionRule; regex: RegExp }> = [];

  private totalScans = 0;
  private totalMatches = 0;
  private totalLatencyMs = 0;

  loadRules(rules: RedactionRule[]): void {
    for (const rule of rules) assertRedactionPatternConsumesInput(rule.pattern);
    this.compiledRules = rules
      .filter(r => r.enabled)
      .map(r => ({
        rule: r,
        // Ensure global flag for exec-loop scanning
        regex: new RegExp(
          r.pattern.source,
          r.pattern.flags.includes("g") ? r.pattern.flags : `${r.pattern.flags}g`
        ),
      }));
  }

  isTextContent(content: unknown): boolean {
    return typeof content === "string";
  }

  redact(content: string, _context: RedactionContext): RedactionResult {
    const start = performance.now();

    if (!this.isTextContent(content)) {
      const latencyMs = performance.now() - start;
      this._recordStats(0, latencyMs);
      return { redacted: content as string, matches: [], latencyMs };
    }

    // Collect all matches first (on original string), then apply replacements
    const allMatches: CollectedRedactionMatch[] = [];

    for (const { rule, regex } of this.compiledRules) {
      allMatches.push(...collectRuleMatches(content, rule, regex));
    }

    // Sort by start position
    allMatches.sort((a, b) => a.start - b.start);

    // Merge overlapping matches
    const merged: typeof allMatches = [];
    for (const m of allMatches) {
      if (merged.length > 0 && m.start < merged[merged.length - 1].end) {
        const last = merged[merged.length - 1];
        last.end = Math.max(last.end, m.end);
      } else {
        merged.push({ ...m });
      }
    }

    // Apply replacements with offset tracking
    const matches: RedactionMatch[] = [];
    let result = content;
    let offset = 0;

    for (const m of merged) {
      const replacement = `[REDACTED:${m.category}]`;
      const adjStart = m.start + offset;
      const adjEnd = m.end + offset;
      result = result.slice(0, adjStart) + replacement + result.slice(adjEnd);
      offset += replacement.length - (m.end - m.start);
      matches.push({
        category: m.category,
        ruleId: m.ruleId,
        position: m.start,
        length: m.end - m.start,
      });
    }

    const latencyMs = performance.now() - start;
    this._recordStats(matches.length, latencyMs);
    return { redacted: result, matches, latencyMs };
  }

  getStats(): RedactionStats {
    return {
      totalScans: this.totalScans,
      totalMatches: this.totalMatches,
      avgLatencyMs: this.totalScans === 0 ? 0 : this.totalLatencyMs / this.totalScans,
    };
  }

  private _recordStats(matchCount: number, latencyMs: number): void {
    this.totalScans++;
    this.totalMatches += matchCount;
    this.totalLatencyMs += latencyMs;
  }
}
