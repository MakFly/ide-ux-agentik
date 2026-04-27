export type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: LogLevel = "info";
const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|api[_-]?key|access[_-]?key|private[_-]?key|cookie)/i;

function resolveLogLevel(): LogLevel {
  const raw = (process.env.AGENT_LOG_LEVEL ?? process.env.LOG_LEVEL ?? DEFAULT_LEVEL).toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return DEFAULT_LEVEL;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[resolveLogLevel()];
}

export function truncateForLog(value: unknown, max = 2_000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

export function errorToLogFields(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return {
    errorName: "NonError",
    errorMessage: String(error),
  };
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (value instanceof Error) return errorToLogFields(value);
  if (depth >= 5) return "[max-depth]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.slice(0, 100).map((entry) => sanitize(entry, depth + 1, seen));
    }

    const out: LogContext = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : sanitize(entry, depth + 1, seen);
    }
    return out;
  }

  return String(value);
}

function write(level: LogLevel, event: string, context: LogContext = {}): void {
  if (!shouldLog(level)) return;

  const payload = sanitize({
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  }) as LogContext;

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (event: string, context?: LogContext) => write("debug", event, context),
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) => write("error", event, context),
  exception: (event: string, error: unknown, context?: LogContext) =>
    write("error", event, { ...(context ?? {}), ...errorToLogFields(error) }),
};
