// netlify/functions/_localStore.js
// Shared in-memory store for local dev.
// Both simulator.js and leaderboard.js require() this same module,
// so Node's module cache returns THE SAME object — data is shared.
// On Netlify production this is never used (Blobs works fine there).

module.exports = {};