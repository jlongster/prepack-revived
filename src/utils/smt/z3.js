/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

// A synchronous bridge to a persistent native z3 process.
//
// Prepack is synchronous, so the solver is driven through two named pipes with non-blocking reads and writes,
// polled with fs.readSync/fs.writeSync. Queries are framed by an (echo) marker. Every failure mode (z3 not
// installed, crash, hang, malformed output) turns into an "unknown" answer, which callers must treat as
// "don't know". After a few crashes the bridge disables itself for the rest of the process.

export type Z3Answer = "sat" | "unsat" | "unknown";

const MARKER = "@@PREPACK_Z3_END@@";
const MAX_RESTARTS = 3;

let sleepCell: void | Int32Array;
function sleep(ms: number): void {
  const SAB = (global: any).SharedArrayBuffer; // eslint-disable-line no-undef
  const A = (global: any).Atomics; // eslint-disable-line no-undef
  if (SAB === undefined || A === undefined) return;
  if (sleepCell === undefined) sleepCell = new Int32Array(new SAB(4));
  A.wait(sleepCell, 0, 0, ms);
}

export class Z3Process {
  constructor(binary: string, timeoutMs: number, prelude: string) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.prelude = prelude;
    this.restarts = 0;
    this.disabled = false;
    this.pending = "";
    this.buffer = Buffer.alloc(1 << 16);
  }

  binary: string;
  timeoutMs: number;
  prelude: string;
  restarts: number;
  disabled: boolean;
  pending: string;
  buffer: Buffer;
  child: void | child_process$ChildProcess;
  dir: void | string;
  inFd: void | number;
  outFd: void | number;
  lastError: void | string;

  // Sends a script and returns everything z3 printed for it, or undefined if z3 is unavailable / crashed / timed out.
  run(script: string): void | string {
    if (this.disabled) return undefined;
    if (this.inFd === undefined && !this._start()) return undefined;
    let deadline = Date.now() + this.timeoutMs;
    try {
      this._write(script + `\n(echo "${MARKER}")\n`, deadline);
      return this._readUntilMarker(deadline);
    } catch (e) {
      this.lastError = e && e.message;
      this._kill();
      if (++this.restarts > MAX_RESTARTS) this.disabled = true;
      return undefined;
    }
  }

  close(): void {
    this._kill();
  }

  _start(): boolean {
    let fs = require("fs");
    let path = require("path");
    let os = require("os");
    let cp = require("child_process");
    try {
      let dir = fs.mkdtempSync(path.join(os.tmpdir(), "prepack-z3-"));
      this.dir = dir;
      let inPath = path.join(dir, "in");
      let outPath = path.join(dir, "out");
      let mk = cp.spawnSync("mkfifo", [inPath, outPath]);
      if (mk.status !== 0) throw new Error("mkfifo failed");
      // Opening the read side O_RDWR keeps a writer around, so reads never see EOF and never block.
      this.outFd = fs.openSync(outPath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
      let quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
      let child = cp.spawn(
        "sh",
        ["-c", `exec ${quote(this.binary)} -in -smt2 < ${quote(inPath)} > ${quote(outPath)}`],
        {
          stdio: "ignore",
          detached: false,
        }
      );
      child.unref();
      child.on("error", () => {
        this.disabled = true;
      });
      this.child = child;
      registerExitHook(this);
      let deadline = Date.now() + 5000;
      for (;;) {
        try {
          this.inFd = fs.openSync(inPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
          break;
        } catch (e) {
          if (e.code !== "ENXIO" || Date.now() > deadline) throw e;
          sleep(1);
        }
      }
      this.pending = "";
      let out = this.run(this.prelude);
      if (out === undefined || out.includes("(error")) {
        this.lastError = "prelude rejected: " + String(out);
        this._kill();
        this.disabled = true;
        return false;
      }
      return true;
    } catch (e) {
      this.lastError = e && e.message;
      this._kill();
      this.disabled = true;
      return false;
    }
  }

  _write(text: string, deadline: number): void {
    let fs = require("fs");
    let fd = this.inFd;
    if (fd === undefined) throw new Error("z3 not running");
    let data = Buffer.from(text, "utf8");
    let offset = 0;
    let spins = 0;
    while (offset < data.length) {
      let n = 0;
      try {
        n = fs.writeSync(fd, data, offset, data.length - offset);
      } catch (e) {
        if (e.code !== "EAGAIN") throw e;
      }
      if (n > 0) {
        offset += n;
        continue;
      }
      if (Date.now() > deadline) throw new Error("z3 write timeout");
      if (++spins > 100) sleep(1);
    }
  }

  _readUntilMarker(deadline: number): string {
    let fs = require("fs");
    let fd = this.outFd;
    if (fd === undefined) throw new Error("z3 not running");
    let spins = 0;
    for (;;) {
      let i = this.pending.indexOf(MARKER);
      if (i >= 0) {
        let result = this.pending.slice(0, i);
        this.pending = this.pending.slice(i + MARKER.length).replace(/^\r?\n/, "");
        return result;
      }
      let n = 0;
      try {
        n = fs.readSync(fd, this.buffer, 0, this.buffer.length, (null: any));
      } catch (e) {
        if (e.code !== "EAGAIN") throw e;
      }
      if (n > 0) {
        this.pending += this.buffer.toString("utf8", 0, n);
        spins = 0;
        continue;
      }
      if (Date.now() > deadline) throw new Error("z3 read timeout");
      // Spin briefly (answers usually arrive within tens of microseconds), then back off.
      if (++spins > 2000) sleep(spins > 4000 ? 2 : 0.2);
    }
    // eslint-disable-next-line no-unreachable
    return "";
  }

  _kill(): void {
    let fs = require("fs");
    if (this.child !== undefined) {
      try {
        this.child.kill("SIGKILL");
      } catch (e) {}
      this.child = undefined;
    }
    for (let fd of [this.inFd, this.outFd]) {
      if (fd === undefined) continue;
      try {
        fs.closeSync(fd);
      } catch (e) {}
    }
    this.inFd = this.outFd = undefined;
    if (this.dir !== undefined) {
      let path = require("path");
      for (let name of ["in", "out"]) {
        try {
          fs.unlinkSync(path.join(this.dir, name));
        } catch (e) {}
      }
      try {
        fs.rmdirSync(this.dir);
      } catch (e) {}
      this.dir = undefined;
    }
    this.pending = "";
  }
}

let liveProcesses: Set<Z3Process> = new Set();
let exitHookRegistered = false;
function registerExitHook(p: Z3Process): void {
  liveProcesses.add(p);
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.on("exit", () => {
    for (let q of liveProcesses) q.close();
  });
}

// Returns the path of a usable z3 binary, or undefined. PREPACK_Z3 overrides the binary; PREPACK_Z3=none disables it.
export function findZ3(): void | string {
  if (typeof process === "undefined" || process.platform === "win32") return undefined;
  let binary = process.env.PREPACK_Z3 || "z3";
  if (binary === "none") return undefined;
  try {
    let cp = require("child_process");
    if (typeof cp.spawnSync !== "function") return undefined;
    let r = cp.spawnSync(binary, ["-version"], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0 || !/Z3 version/.test(String(r.stdout))) return undefined;
    return binary;
  } catch (e) {
    return undefined;
  }
}
