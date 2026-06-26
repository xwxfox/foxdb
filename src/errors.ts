/**
 * src/errors.ts
 * Central error type with invisible tracing and structured context.
 */

/**
 * a single entry in the error trace
 * @category Errors
 */
export interface TraceEntry {
  label: string;
  time: number;
  details?: Record<string, unknown>;
}

/**
 * context captured when an error occurs
 * @category Errors
 */
export interface ORMErrorContext {
  table?: string;
  operation?: string;
  sql?: string;
  params?: unknown[];
  schema?: unknown;
  [key: string]: unknown;
}

/**
 * structured error with trace and context
 * @category Errors
 */
export class ORMError extends Error {
  readonly code: string;
  readonly trace: TraceEntry[];
  readonly context: ORMErrorContext;

  constructor(
    message: string,
    opts: {
      code: string;
      trace: TraceEntry[];
      context?: ORMErrorContext;
    }
  ) {
    super(message);
    this.name = "ORMError";
    this.code = opts.code;
    this.trace = opts.trace;
    this.context = opts.context ?? {};
  }
}

// Lazy trace storage: avoid creating TraceEntry objects until an error occurs.
// Labels, times, and details are stored as separate arrays and only combined
// when currentTrace() is called (via raise()).
const _traceLabels: string[] = [];
const _traceTimes: number[] = [];
const _traceDetails: (Record<string, unknown> | undefined)[] = [];

/** @internal */
export function enterTrace(label: string, details?: Record<string, unknown>): void {
  _traceLabels.push(label);
  _traceTimes.push(Date.now());
  _traceDetails.push(details);
}

/** @internal */
export function leaveTrace(): void {
  _traceLabels.pop();
  _traceTimes.pop();
  _traceDetails.pop();
}

/** @internal */
export function currentTrace(): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (let i = 0; i < _traceLabels.length; i++) {
    entries.push({
      label: _traceLabels[i]!,
      time: _traceTimes[i]!,
      details: _traceDetails[i],
    });
  }
  return entries;
}

/**
 * @internal
 * @category Errors
 */
export function withTrace<T>(
  label: string,
  details: Record<string, unknown> | undefined,
  fn: () => T
): T {
  enterTrace(label, details);
  try {
    return fn();
  } finally {
    leaveTrace();
  }
}

/**
 * throw an ORMError with trace and context
 * @category Errors
 */
export function raise(
  code: string,
  message: string,
  context?: ORMErrorContext
): never {
  throw new ORMError(message, {
    code,
    trace: currentTrace(),
    context,
  });
}

/**
 * how to handle runtime errors
 * @category Errors
 */
export type ErrorPolicy = "throw" | "emit" | "emit-swallow" | "crash";

/** @internal */
export function handleError(
  err: ORMError,
  policy: ErrorPolicy,
  emit?: (event: string, payload: unknown) => void
): never | void {
  if (emit) {
    emit("error", { phase: "error", error: err, timestamp: Date.now() });
  }

  switch (policy) {
    case "emit-swallow":
      return;
    case "crash":
      console.error("[foxdb] fatal error - crashing", err);
      process.exit(1);
    case "emit":
    case "throw":
    default:
      throw err;
  }
}
