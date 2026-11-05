// Build a lookup table when the app starts.
const units = ["B", "KB", "MB", "GB", "TB"];
const bytesPer = {};
for (let i = 0; i < units.length; i++) {
  bytesPer[units[i]] = Math.pow(1024, i);
}

// Only known when the app actually runs.
const startedAt = Date.now();

global.app = { bytesPer, startedAt };
