const MAX_PATTERN_LENGTH = 200;
const MAX_INPUT_LENGTH = 10_000;

/**
 * Heuristic ReDoS screen: rejects backreferences and quantified groups whose
 * body itself contains a quantifier — the classic catastrophic-backtracking
 * shapes like (a+)+, (a*b)*, ((ab)+)+. The worker-thread timeout in
 * safeRegexTest is the hard backstop for anything the heuristic misses
 * (e.g. overlapping alternation like (a|a)+).
 */
export function isPatternSafe(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  if (/\\[1-9]/.test(pattern)) return false; // backreferences

  const groupStack: { hasQuantifier: boolean }[] = [];
  let escaped = false;
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    switch (ch) {
      case '[':
        inClass = true;
        break;
      case '(':
        groupStack.push({ hasQuantifier: false });
        break;
      case ')': {
        const group = groupStack.pop();
        const next = pattern[i + 1];
        const quantified = next === '+' || next === '*' || next === '{' || next === '?';
        if (group?.hasQuantifier && quantified && next !== '?') return false;
        // A quantified group counts as a quantifier for its parent group.
        if (quantified && groupStack.length > 0) {
          const parent = groupStack[groupStack.length - 1];
          if (parent) parent.hasQuantifier = true;
        }
        break;
      }
      case '+':
      case '*':
      case '{': {
        const top = groupStack[groupStack.length - 1];
        if (top) top.hasQuantifier = true;
        break;
      }
    }
  }
  return true;
}

export interface RegexTestResult {
  ok: boolean;
  result?: boolean;
  note?: 'invalid_regex' | 'unsafe_regex' | 'regex_timeout' | 'input_too_long';
}

/**
 * Regex execution with a hard, synchronous timeout.
 *
 * V8 regex runs in native code, so neither vm timeouts nor event-loop tricks
 * can interrupt it. The only reliable preemption is a separate thread: a
 * persistent worker runs `re.test(s)` and signals completion through a
 * SharedArrayBuffer; the caller blocks on Atomics.wait with a deadline and
 * terminates the worker if it blows the budget. In non-Node environments
 * (browser sandbox) we fall back to direct execution behind the heuristic.
 */
interface WorkerThreadsModule {
  Worker: new (
    code: string,
    opts: { eval: true; workerData: { sab: SharedArrayBuffer } },
  ) => {
    postMessage: (msg: unknown) => void;
    terminate: () => Promise<number>;
    unref: () => void;
  };
}

const WORKER_SOURCE = `
  const { parentPort, workerData } = require('node:worker_threads');
  const signal = new Int32Array(workerData.sab);
  Atomics.store(signal, 0, 1); // ready
  Atomics.notify(signal, 0);
  parentPort.on('message', ({ pattern, input }) => {
    let outcome = 3; // invalid
    try {
      outcome = new RegExp(pattern).test(input) ? 1 : 2;
    } catch {}
    Atomics.store(signal, 1, outcome);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  });
`;

class RegexWorker {
  private readonly worker: InstanceType<WorkerThreadsModule['Worker']>;
  private readonly signal: Int32Array;
  readonly healthy: boolean;

  constructor(wt: WorkerThreadsModule) {
    const sab = new SharedArrayBuffer(8);
    this.signal = new Int32Array(sab);
    this.worker = new wt.Worker(WORKER_SOURCE, { eval: true, workerData: { sab } });
    this.worker.unref();
    // Block until the worker thread is up (it runs regardless of our event loop).
    this.healthy = Atomics.wait(this.signal, 0, 0, 5000) !== 'timed-out';
  }

  test(pattern: string, input: string, timeoutMs: number): RegexTestResult {
    Atomics.store(this.signal, 0, 0);
    this.worker.postMessage({ pattern, input });
    const waited = Atomics.wait(this.signal, 0, 0, timeoutMs);
    if (waited === 'timed-out' && Atomics.load(this.signal, 0) === 0) {
      void this.worker.terminate();
      sharedWorker = undefined; // force respawn on next use
      return { ok: false, note: 'regex_timeout' };
    }
    const outcome = Atomics.load(this.signal, 1);
    if (outcome === 3) return { ok: false, note: 'invalid_regex' };
    return { ok: true, result: outcome === 1 };
  }

  destroy(): void {
    void this.worker.terminate();
  }
}

let workerThreads: WorkerThreadsModule | null | undefined;
let sharedWorker: RegexWorker | null | undefined;

function getWorker(): RegexWorker | null {
  if (sharedWorker !== undefined) return sharedWorker;
  if (workerThreads === undefined) {
    try {
      // process.getBuiltinModule works in both ESM and CJS and is invisible to
      // browser bundlers (unlike require/import of node:worker_threads).
      // Reached via globalThis because this package carries no Node typings.
      const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
        .process;
      workerThreads =
        (proc?.getBuiltinModule?.('node:worker_threads') as WorkerThreadsModule | undefined) ??
        null;
    } catch {
      workerThreads = null;
    }
  }
  if (!workerThreads) {
    sharedWorker = null;
    return null;
  }
  const candidate = new RegexWorker(workerThreads);
  if (!candidate.healthy) {
    candidate.destroy();
    sharedWorker = null;
    return null;
  }
  sharedWorker = candidate;
  return candidate;
}

/** Compiles and executes `pattern` against `input` under a safety screen + timeout. */
export function safeRegexTest(pattern: string, input: string, timeoutMs = 25): RegexTestResult {
  if (!isPatternSafe(pattern)) return { ok: false, note: 'unsafe_regex' };
  if (input.length > MAX_INPUT_LENGTH) return { ok: false, note: 'input_too_long' };

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { ok: false, note: 'invalid_regex' };
  }

  const worker = getWorker();
  if (worker) return worker.test(pattern, input, timeoutMs);

  // Browser fallback: the heuristic screen already ran.
  return { ok: true, result: regex.test(input) };
}
