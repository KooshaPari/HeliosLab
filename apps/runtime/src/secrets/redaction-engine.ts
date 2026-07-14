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

// ---------------------------------------------------------------------------
// RedactionEngine
// ---------------------------------------------------------------------------

export class RedactionEngine {
  private rules: RedactionRule[] = [];
  private compiledRules: Array<{ rule: RedactionRule; regex: RegExp }> = [];

  private totalScans = 0;
  private totalMatches = 0;
  private totalLatencyMs = 0;

  loadRules(rules: RedactionRule[]): void {
    this.rules = rules;
    this.compiledRules = rules
      .filter(r => r.enabled)
      .map(r => ({
        rule: r,
        // Ensure global flag for exec-loop scanning
        regex: new RegExp(
          r.pattern.source,
          r.pattern.flags.includes("g") ? r.pattern.flags : r.pattern.flags + "g"
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
    const allMatches: Array<{
      start: number;
      end: number;
      category: string;
      ruleId: string;
    }> = [];

    for (const { rule, regex } of this.compiledRules) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        allMatches.push({
          start: m.index,
          end: m.index + m[0].length,
          category: rule.category,
          ruleId: rule.id,
        });
      }
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
