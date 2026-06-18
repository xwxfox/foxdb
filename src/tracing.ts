import { feature } from "bun:bundle";

export interface TraceEvent {
  name: string;
  ph: "B" | "E";
  ts: number;
  rootId?: number;
  callId?: number;
  dur?: number;
  args?: Record<string, unknown>;
  pid: number;
}

export type TraceFilter = {
  nameFilter?: string | ((name: string) => boolean);
  limit?: number;
  minTotalUs?: number;
};

export type TraceRoot = {
  rootId: number;
  spans: number;
  totalUs: number;
  firstSpan: string;
  topSpan: string;
  topSpanUs: number;
};

type TraceGroupStats = {
  count: number;
  totalUs: number;
  minUs: number;
  maxUs: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
};

class TraceSession {
  private _events: TraceEvent[] = [];
  private _stack: { name: string; start: number; rootId: number; callId: number }[] = [];
  private _epoch = performance.now();
  private _pid = process.pid;
  private _nextRootId = 0;
  private _nextCallId = 0;

  begin(name: string, args?: Record<string, unknown>) {
    const isRoot = this._stack.length === 0;
    const rootId = isRoot ? ++this._nextRootId : this._stack[this._stack.length - 1]!.rootId;
    const callId = ++this._nextCallId;
    this._events.push({ name, ph: "B", ts: this._now(), rootId, callId, args, pid: this._pid });
    this._stack.push({ name, start: this._now(), rootId, callId });
    return callId;
  }

  end(args?: Record<string, unknown>) {
    const span = this._stack.pop();
    if (!span) return;
    const now = this._now();
    this._events.push({ name: span.name, ph: "E", ts: now, rootId: span.rootId, callId: span.callId, dur: now - span.start, args, pid: this._pid });
  }

  trace<T>(name: string, fn: () => T, args?: Record<string, unknown>): T {
    this.begin(name, args);
    try { return fn(); } finally { this.end(); }
  }

  async traceAsync<T>(name: string, fn: () => Promise<T>, args?: Record<string, unknown>): Promise<T> {
    this.begin(name, args);
    try { return await fn(); } finally { this.end(); }
  }

  reset() {
    this._events = [];
    this._stack = [];
    this._epoch = performance.now();
    this._nextRootId = 0;
    this._nextCallId = 0;
  }

  get events() { return this._events; }

  get roots() {
    return this.getRoots();
  }

  getRoots(filter: TraceFilter = {}) {
    const roots = new Map<number, { rootId: number; spans: number; totalUs: number; firstSpan?: string; topSpan?: string; topSpanUs: number }>();
    for (const e of this._events) {
      if (e.ph !== "E" || e.rootId == null) continue;
      const root = roots.get(e.rootId!) ?? { rootId: e.rootId!, spans: 0, totalUs: 0, topSpanUs: 0 };
      root.spans++;
      root.totalUs += e.dur ?? 0;
      root.firstSpan ??= e.name;
      if ((e.dur ?? 0) > root.topSpanUs) {
        root.topSpan = e.name;
        root.topSpanUs = e.dur ?? 0;
      }
      roots.set(e.rootId!, root);
    }

    return [...roots.values()]
      .filter((r) => (filter.minTotalUs ?? 0) === 0 || r.totalUs >= (filter.minTotalUs ?? 0))
      .sort((a, b) => b.totalUs - a.totalUs);
  }

  printSummary(filter: TraceFilter = {}) {
    const groups = this._groupEvents(filter);
    const sorted = Object.entries(groups).sort((a, b) => b[1].totalUs - a[1].totalUs);
    const limited = sorted.slice(0, filter.limit ?? sorted.length);

    console.log("\n═══════════════════════════════════ TRACE SUMMARY ═══════════════════════════════════");
    console.log(`${"NAME".padEnd(52)} ${"COUNT".padStart(6)} ${"TOTAL_MS".padStart(10)} ${"AVG_US".padStart(10)} ${"P50_US".padStart(10)} ${"P95_US".padStart(10)} ${"P99_US".padStart(10)} ${"MAX_US".padStart(10)}`);
    console.log("-".repeat(126));
    for (const [name, g] of limited) {
      console.log(
        `${name.padEnd(52)} ${String(g.count).padStart(6)} ${(g.totalUs / 1000).toFixed(2).padStart(10)} ` +
        `${(g.totalUs / g.count).toFixed(2).padStart(10)} ${g.p50Us.toFixed(2).padStart(10)} ${g.p95Us.toFixed(2).padStart(10)} ${g.p99Us.toFixed(2).padStart(10)} ${g.maxUs.toFixed(2).padStart(10)}`
      );
    }
    console.log("-".repeat(126));
    const roots = this.getRoots(filter);
    console.log(`Root calls: ${roots.length}`);
    console.log(`Total spans: ${this._events.filter((e) => e.ph === "E").length}`);
    const totalCpu = limited.reduce((a, [, g]) => a + g.totalUs, 0);
    console.log(`Total traced time: ${(totalCpu / 1000).toFixed(2)}ms`);
    console.log("═══════════════════════════════════════════════════════════════════════\n");
  }

  printRoots(filter: TraceFilter = {}) {
    const roots = this.getRoots(filter);
    if (roots.length === 0) return;
    console.log("\n═══════════════════════════════════ TRACE ROOTS ═══════════════════════════════════");
    console.log(`${"ROOT".padStart(6)} ${"SPANS".padStart(6)} ${"TOTAL_MS".padStart(10)} ${"TOP_SPAN".padEnd(52)} ${"TOP_MS".padStart(10)} ${"FIRST_SPAN"}`);
    console.log("-".repeat(104));
    for (const r of roots) {
      console.log(`${String(r.rootId).padStart(6)} ${String(r.spans).padStart(6)} ${(r.totalUs / 1000).toFixed(2).padStart(10)} ${(r.topSpan ?? "").padEnd(52)} ${(r.topSpanUs / 1000).toFixed(2).padStart(10)} ${r.firstSpan ?? ""}`);
    }
    console.log("-".repeat(104));
    console.log("═══════════════════════════════════════════════════════════════════════\n");
  }

  printRoot(rootId: number, filter: TraceFilter = {}) {
    const events = this._events.filter((e) => e.rootId === rootId && matchesFilter(e.name, filter.nameFilter));
    if (events.length === 0) return;
    console.log(`\n════════════════════════ TRACE ROOT ${rootId} ════════════════════════`);
    console.log(`${"TIME_MS".padStart(10)} ${"DUR_MS".padStart(10)} ${"SPAN"}`);
    console.log("-".repeat(80));
    for (const e of events) {
      if (e.ph !== "E") continue;
      console.log(`${(e.ts / 1000).toFixed(3).padStart(10)} ${(e.dur! / 1000).toFixed(3).padStart(10)} ${e.name}`);
    }
    console.log("-".repeat(80));
    console.log("═══════════════════════════════════════════════════════════════════\n");
  }

  private _groupEvents(filter: TraceFilter) {
    const groups: Record<string, { count: number; totalUs: number; minUs: number; maxUs: number; samples: number[] }> = {};
    for (const e of this._events) {
      if (e.ph !== "E") continue;
      if (!matchesFilter(e.name, filter.nameFilter)) continue;
      const n = e.name;
      const g = groups[n] ??= { count: 0, totalUs: 0, minUs: Infinity, maxUs: 0, samples: [] };
      const dur = e.dur ?? 0;
      g.count++;
      g.totalUs += dur;
      g.samples.push(dur);
      g.minUs = Math.min(g.minUs, dur);
      g.maxUs = Math.max(g.maxUs, dur);
    }

    const result: Record<string, TraceGroupStats> = {};
    for (const [name, g] of Object.entries(groups)) {
      if ((filter.minTotalUs ?? 0) > 0 && g.totalUs < (filter.minTotalUs ?? 0)) continue;
      g.samples.sort((a, b) => a - b);
      result[name] = {
        count: g.count,
        totalUs: g.totalUs,
        minUs: g.minUs,
        maxUs: g.maxUs,
        p50Us: percentile(g.samples, 0.50),
        p95Us: percentile(g.samples, 0.95),
        p99Us: percentile(g.samples, 0.99),
      };
    }
    return result;
  }

  private _now(): number {
    return (performance.now() - this._epoch) * 1000;
  }
}

function matchesFilter(name: string, filter: TraceFilter["nameFilter"]) {
  if (filter == null) return true;
  return typeof filter === "string" ? name.includes(filter) : filter(name);
}

function percentile(samples: number[], p: number) {
  if (samples.length === 0) return 0;
  const idx = Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1);
  return samples[idx] ?? 0;
}

const _tracer: TraceSession = feature("DEBUG_TRACING") ? new TraceSession() : (null as unknown as TraceSession);

export function traceBegin(name: string, args?: Record<string, unknown>) {
  if (feature("DEBUG_TRACING")) return (_tracer as TraceSession).begin(name, args);
}

export function traceEnd(args?: Record<string, unknown>) {
  if (feature("DEBUG_TRACING")) (_tracer as TraceSession).end(args);
}

export function traceSync<T>(name: string, fn: () => T, args?: Record<string, unknown>): T {
  if (!feature("DEBUG_TRACING")) return fn();
  const t = _tracer as TraceSession;
  t.begin(name, args);
  try { return fn(); } finally { t.end(); }
}

export async function traceAsync<T>(name: string, fn: () => Promise<T>, args?: Record<string, unknown>): Promise<T> {
  if (!feature("DEBUG_TRACING")) return fn();
  const t = _tracer as TraceSession;
  t.begin(name, args);
  try { return await fn(); } finally { t.end(); }
}

export function printTraceSummary(filter: TraceFilter = {}) {
  if (feature("DEBUG_TRACING")) (_tracer as TraceSession).printSummary(filter);
}

export function printTraceRoots(filter: TraceFilter = {}) {
  if (feature("DEBUG_TRACING")) (_tracer as TraceSession).printRoots(filter);
}

export function printTraceRoot(rootId: number, filter: TraceFilter = {}) {
  if (feature("DEBUG_TRACING")) (_tracer as TraceSession).printRoot(rootId, filter);
}

export function resetTrace() {
  if (feature("DEBUG_TRACING")) (_tracer as TraceSession).reset();
  if (feature("DEBUG_SQL_FILE")) sqlFileFlush();
}

export function getTraceEvents(filter: TraceFilter = {}) {
  if (!feature("DEBUG_TRACING")) return [];
  const events = (_tracer as TraceSession).events;
  if (filter.nameFilter == null) return events;
  return events.filter((e) => matchesFilter(e.name, filter.nameFilter));
}

export function getTraceRoots(filter: TraceFilter = {}) {
  return feature("DEBUG_TRACING") ? (_tracer as TraceSession).getRoots(filter) : [];
}

export function sqlDebug(message: string, data?: unknown) {
  if (feature("DEBUG_SQL_BUILDING")) console.log(`[SQL_BUILD] ${message}`);
  if (feature("DEBUG_SQL_BUILDING") && data != null) console.dir(data, { depth: 12, breakLength: 120, colors: true });
}

// --- SQL file output (DEBUG_SQL_FILE) -----------------------------------------

let _sqlWriter: Bun.FileSink | null = null;
let _sqlCurrentSection = "";

function sqlFileEnsure() {
  if (!_sqlWriter) {
    try {
      _sqlWriter = Bun.file("./foxdb-queries.sql").writer();
    } catch { /* ignore */ }
  }
}

export function sqlFileSection(section: string) {
  if (!feature("DEBUG_SQL_FILE")) return;
  sqlFileEnsure();
  if (_sqlCurrentSection && _sqlWriter) {
    _sqlWriter.write("\n");
    _sqlWriter.flush();
  }
  _sqlCurrentSection = section;
  if (_sqlWriter) {
    _sqlWriter.write(`\n-- ====== ${section} ======\n\n`);
    _sqlWriter.flush();
  }
}

export function sqlFileWrite(sql: string, params?: unknown[]) {
  if (!feature("DEBUG_SQL_FILE")) return;
  sqlFileEnsure();
  if (!_sqlWriter) return;
  const trimmed = sql.trimEnd();
  const line = params && params.length > 0
    ? `-- params: ${JSON.stringify(params)}\n${trimmed};\n`
    : `${trimmed};\n`;
  _sqlWriter.write(line);
  _sqlWriter.flush();
}

export function sqlFileFlush() {
  if (!feature("DEBUG_SQL_FILE")) return;
  if (_sqlWriter) {
    try { _sqlWriter.flush(); } catch { /* ignore */ }
  }
}

export function sqlFileClose() {
  if (!feature("DEBUG_SQL_FILE")) return;
  if (_sqlWriter) {
    try { _sqlWriter.flush(); } catch { /* ignore */ }
    try { _sqlWriter.end(); } catch { /* ignore */ }
    _sqlWriter = null;
  }
}
