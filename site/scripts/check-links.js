// Checks every link in site/dist/index.html: internal anchors must exist; external URLs must
// answer HEAD (or GET) with a 2xx/3xx. GitHub issue comment anchors are checked against the API.
//   node site/scripts/check-links.js
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const html = fs.readFileSync(path.join(process.env.DIST ? path.resolve(process.env.DIST) : path.join(__dirname, "../dist"), "index.html"), "utf8");
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const hrefs = [...new Set([...html.matchAll(/\shref="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&")))];
const cites = [...new Set([...html.matchAll(/\scite="([^"]+)"/g)].map(m => m[1]))];

let bad = 0;
for (const h of hrefs.filter(h => h.startsWith("#"))) {
  if (!ids.has(h.slice(1))) {
    console.log("MISSING ANCHOR", h);
    bad++;
  }
}

function gh(args) {
  try {
    return JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (e) {
    return null;
  }
}

(async () => {
  const external = [...new Set(hrefs.concat(cites).filter(h => /^https?:/.test(h)))];
  for (const url of external) {
    let ok = false;
    let note = "";
    const comment = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)#issuecomment-(\d+)/);
    const privateRepo = url.match(/github\.com\/jlongster\/(prepack-revived|northstar-supply|freezedry)/);
    if (comment) {
      const c = gh([`repos/${comment[1]}/issues/comments/${comment[3]}`]);
      ok = !!c && c.issue_url.endsWith(`/issues/${comment[2]}`);
      note = "api comment";
    } else if (privateRepo) {
      ok = !!gh([`repos/jlongster/${privateRepo[1]}`]);
      note = "api repo";
      if (!ok && privateRepo[1] === "freezedry") {
        // Being extracted into its own repository; may not exist yet.
        ok = true;
        note = "PENDING (repo not created yet)";
      }
    } else if (/jamesbox\.exe\.xyz/.test(url)) {
      note = "own host (not reachable from inside); skipped";
      ok = true;
    } else {
      for (const method of ["HEAD", "GET"]) {
        try {
          const r = await fetch(url.split("#")[0], { method, redirect: "follow", headers: { "user-agent": "link-check" } });
          note = `${method} ${r.status}`;
          if (r.status < 400) {
            ok = true;
            break;
          }
        } catch (e) {
          note = method + " " + e.message;
        }
      }
    }
    console.log(ok ? "ok  " : "BAD ", note.padEnd(16), url);
    if (!ok) bad++;
  }
  console.log(`${hrefs.length} hrefs, ${external.length} external, ${bad} problems`);
  process.exit(bad ? 1 : 0);
})();
