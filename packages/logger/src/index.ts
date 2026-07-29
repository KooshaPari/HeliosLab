/**
 * @helios/logger
 *
 * Structured logger wrapping pino. Preserves the original Logger interface
 * so all existing call sites remain compatible.
 *
 * wraps: pino@^9.6.0  (https://github.com/pinojs/pino)
 */
import pino, { type Logger as PinoLogger } from 'pino';

// ---------------------------------------------------------------------------
// Public types — kept identical to the original interface for backward compat
// ---------------------------------------------------------------------------

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4,
}

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    context?: Record<string, unknown>;
    error?: Error | unknown;
}

export interface Logger {
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
    fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;
    child(context: Record<string, unknown>): Logger;
    withLevel(level: LogLevel): Logger;
}

// ---------------------------------------------------------------------------
// Level mapping
// ---------------------------------------------------------------------------

const LEVEL_MAP: Record<LogLevel, pino.Level> = {
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.WARN]: 'warn',
    [LogLevel.ERROR]: 'error',
    [LogLevel.FATAL]: 'fatal',
};

function pinoLevel(level: LogLevel): pino.Level {
    return LEVEL_MAP[level] ?? 'info';
}

// ---------------------------------------------------------------------------
// PinoLogger adapter — implements the helios Logger interface on top of pino
// ---------------------------------------------------------------------------

class PinoLoggerAdapter implements Logger {
    constructor(private readonly inner: PinoLogger) {}

    debug(message: string, context?: Record<string, unknown>): void {
        if (context) {
            this.inner.debug(context, message);
        } else {
            this.inner.debug(message);
        }
    }

    info(message: string, context?: Record<string, unknown>): void {
        if (context) {
            this.inner.info(context, message);
        } else {
            this.inner.info(message);
        }
    }

    warn(message: string, context?: Record<string, unknown>): void {
        if (context) {
            this.inner.warn(context, message);
        } else {
            this.inner.warn(message);
        }
    }

    error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
        const merged = error instanceof Error
            ? { err: error, ...(context ?? {}) }
            : { ...(context ?? {}), ...(error != null ? { rawError: error } : {}) };
        this.inner.error(merged, message);
    }

    fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
        const merged = error instanceof Error
            ? { err: error, ...(context ?? {}) }
            : { ...(context ?? {}), ...(error != null ? { rawError: error } : {}) };
        this.inner.fatal(merged, message);
    }

    child(context: Record<string, unknown>): Logger {
        return new PinoLoggerAdapter(this.inner.child(context));
    }

    withLevel(level: LogLevel): Logger {
        return new PinoLoggerAdapter(this.inner.child({}, { level: pinoLevel(level) }));
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function buildPino(level: pino.Level): PinoLogger {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        return pino({
            level,
            transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'SYS:standard' },
            },
        });
    }
    return pino({ level });
}

export function createLogger(minLevel: LogLevel = LogLevel.INFO): Logger {
    return new PinoLoggerAdapter(buildPino(pinoLevel(minLevel)));
}

// ---------------------------------------------------------------------------
// Default singleton (compatible drop-in for existing `new ConsoleLogger()`)
// ---------------------------------------------------------------------------

/** @deprecated Use createLogger() directly. Kept for backward compatibility. */
export class ConsoleLogger implements Logger {
    private readonly _inner: Logger;

    constructor(minLevel: LogLevel = LogLevel.INFO, baseContext: Record<string, unknown> = {}) {
        const base = createLogger(minLevel);
        this._inner = Object.keys(baseContext).length > 0 ? base.child(baseContext) : base;
    }

    debug(message: string, context?: Record<string, unknown>): void { this._inner.debug(message, context); }
    info(message: string, context?: Record<string, unknown>): void { this._inner.info(message, context); }
    warn(message: string, context?: Record<string, unknown>): void { this._inner.warn(message, context); }
    error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void { this._inner.error(message, error, context); }
    fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void { this._inner.fatal(message, error, context); }
    child(context: Record<string, unknown>): Logger { return this._inner.child(context); }
    withLevel(level: LogLevel): Logger { return this._inner.withLevel(level); }
}
