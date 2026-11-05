# Common instructions for every Prepack-revival agent

Project: revive Facebook's archived Prepack (JS partial evaluator) and attack the problems that made the team abandon it. Read /tmp/opencode/pp-hard/PLAN.md (overall plan; find your phase/track), /tmp/opencode/pp-work/BASELINE.md (build + test commands) and /tmp/opencode/pp-work/test/serializer/hard/README.md (hard corpus + scoreboard).

## Your workspace
- You have your OWN git worktree (path given in your task) on your own branch, created from branch `revive`. `node_modules` is a symlink to the main checkout; do not run `yarn install` in the worktree (if you must add a dependency, tell the coordinator in your report instead, or install into the worktree only after replacing the symlink with a real install).
- Build: `yarn build-prepack` (babel src -> lib, ~4s). Always rebuild before testing.
- Never touch /tmp/opencode/pp-work (main checkout) or other agents' worktrees in /tmp/opencode/pp-wt/*.

## Gates (a change counts only if all hold)
1. `yarn test-serializer --fast` passes (1002/1002) during iteration; the FULL `yarn test-serializer` (3378/3378, ~3 min) must pass before you finish.
2. `yarn test-error-handler` passes (42/42).
3. `node scripts/hard-scoreboard.js` (optionally `--filter P1-loops` etc.): your target tests move from CRASH/WRONG/BLOAT to PASS, and NO test anywhere in the corpus moves to WRONG. Do not commit test/serializer/hard/results.json changes.
4. `yarn lint` and `yarn flow` clean for files you touched (flow takes ~90s; run at least before finishing).

## Rules
- Correctness beats coverage. Never "fix" a crash by producing possibly-wrong output. When unsure, bail out with a clear diagnostic (that is CRASH, not WRONG; acceptable).
- Never weaken or edit existing tests/corpus expectations to make them pass. You may ADD tests (regular serializer tests under test/serializer/<area>/ for fixed behavior, and new hard-corpus cases with the corpus header format).
- If a test in the main serializer suite starts failing because your change is more precise (e.g. output changed but still correct), investigate; only update its markers if you can explain why the new behavior is correct, and list every such case in your report.
- Keep changes in your area. Hot shared files (src/realm.js, src/completions.js, src/methods/join.js, src/utils/paths.js) — if you must touch one outside your area, keep the diff small and mention it in the report so the coordinator can merge.
- Commit early and often on your branch with conventional commits (`fix(joins): ...`, `feat(smt): ...`, `test(loops): ...`). Do not merge into `revive` or push.
- Write a short design note at docs/revive/<your-track>.md: what you changed, why, what remains unsolved and WHY (minimal examples). An honest "this is fundamentally hard because X" is a valid result.
- Time-box: stop after you reach your track's done-criteria or after roughly a few hours of diminishing returns, and report.

## Report back (final message)
- Scoreboard before/after for your target folder(s) and the corpus total (PASS/CRASH/WRONG/BLOAT).
- List of commits, files touched (flag hot shared files), tests added.
- What you could not solve and why; suggestions for next steps / dependencies on other tracks.
