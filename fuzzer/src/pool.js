/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// A pool of worker processes running worker.js. Each task gets a wall-clock
// timeout; a worker that times out or dies is killed and replaced, so Prepack
// hanging or running out of memory on one program never stops the run.

const childProcess = require("child_process");
const path = require("path");

const WORKER = path.join(__dirname, "worker.js");
const RECYCLE_AFTER = 250;

class Pool {
  constructor(size, options, timeout) {
    this.options = options;
    this.timeout = timeout;
    this.queue = [];
    this.workers = [];
    this.nextId = 1;
    for (let i = 0; i < size; i++) this.workers.push(this.spawn());
  }

  spawn() {
    const child = childProcess.fork(WORKER, [], {
      env: Object.assign({}, process.env, { FUZZ_OPTIONS: JSON.stringify(this.options), TZ: "UTC", LANG: "C" }),
      execArgv: ["--stack-size=10000", "--max-old-space-size=3072"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const w = { child, busy: undefined, ready: false, done: 0, stderr: "" };
    child.stderr.on("data", d => {
      w.stderr = (w.stderr + d).slice(-4000);
    });
    child.on("message", m => {
      if (m.ready) {
        w.ready = true;
        this.pump();
        return;
      }
      const job = w.busy;
      if (!job || job.task.id !== m.id) return;
      clearTimeout(job.timer);
      w.busy = undefined;
      w.done++;
      job.resolve(m.result);
      if (w.done >= RECYCLE_AFTER) this.replace(w);
      this.pump();
    });
    child.on("exit", (code, signal) => {
      if (w.dead) return;
      w.dead = true;
      const job = w.busy;
      w.busy = undefined;
      if (job) {
        clearTimeout(job.timer);
        job.resolve({ status: "died", detail: `worker exited (${signal || code}) ${lastLine(w.stderr)}` });
      }
      this.replace(w, true);
      this.pump();
    });
    return w;
  }

  replace(w, alreadyDead) {
    const i = this.workers.indexOf(w);
    w.dead = true;
    if (!alreadyDead) w.child.kill("SIGKILL");
    if (i >= 0 && !this.closed) this.workers[i] = this.spawn();
  }

  run(task) {
    return new Promise(resolve => {
      this.queue.push({ task: Object.assign({ id: this.nextId++ }, task), resolve });
      this.pump();
    });
  }

  pump() {
    for (const w of this.workers) {
      if (this.queue.length === 0) return;
      if (w.busy || !w.ready || w.dead) continue;
      const job = this.queue.shift();
      w.busy = job;
      job.timer = setTimeout(() => {
        if (w.busy !== job) return;
        w.busy = undefined;
        job.resolve({ status: "timeout", detail: `no result after ${this.timeout}ms` });
        this.replace(w);
        this.pump();
      }, this.timeout);
      w.child.send(job.task);
    }
  }

  close() {
    this.closed = true;
    for (const w of this.workers) {
      w.dead = true;
      w.child.kill("SIGKILL");
    }
  }
}

function lastLine(s) {
  const lines = s.trim().split("\n");
  return lines[lines.length - 1] || "";
}

module.exports = { Pool };
