/**
 * Scan2Moon ElizaOS Plugin
 * Solana on-chain intelligence tools for ElizaOS agents.
 *
 * Setup:
 *   Set SCAN2MOON_API_KEY in your agent's .env (free key: scan2moon.com/api-portal.html)
 *
 * Actions:
 *   ANALYZE_WALLET      — deployer rug history
 *   PREDICT_LP_PULL     — LP pull / rug probability
 *   DETECT_BUNDLE       — coordinated sniper attack detection
 *   GET_SMART_MONEY     — top on-chain traders leaderboard
 *   GET_NEW_PAIRS       — latest newly launched tokens
 */

import type {
  Plugin,
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";

const BASE = "https://scan2moon.com/.netlify/functions";
const SOL_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/* ── Helpers ─────────────────────────────────────────────────── */

function key(runtime: IAgentRuntime): string {
  return (runtime.getSetting("SCAN2MOON_API_KEY") as string) || "";
}

function authH(apiKey: string): Record<string, string> {
  return apiKey ? { "X-Api-Key": apiKey } : {};
}

async function api(path: string, apiKey: string, opts?: RequestInit): Promise<unknown> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authH(apiKey),
      ...(opts?.headers as Record<string, string> || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 402) {
    throw new Error(
      "Payment required. Get a free API key (1,000 calls/day) at scan2moon.com/api-portal.html " +
      "and set SCAN2MOON_API_KEY in your agent environment."
    );
  }
  if (!res.ok) throw new Error(`Scan2Moon API error ${res.status}`);
  return res.json();
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

/* ── ANALYZE_WALLET ──────────────────────────────────────────── */

const analyzeWalletAction: Action = {
  name: "ANALYZE_WALLET",
  similes: [
    "CHECK_WALLET", "WALLET_HISTORY", "DEV_WALLET",
    "RUG_CHECK_WALLET", "DEPLOYER_HISTORY", "WALLET_RUG_RATE",
  ],
  description:
    "Analyzes a Solana deployer wallet's full on-chain token launch history. " +
    "Shows every token launched (ACTIVE/DEAD/DUMPED/RUG), rug rate, and a " +
    "history penalty score. Use before trading to check if the dev has rugged before.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Check the dev wallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM for rugs" },
      },
      {
        name: "{{agentName}}",
        content: { text: "Analyzing that wallet's deployment history on Scan2Moon..." },
      },
    ],
  ],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = String(msg.content.text || "");
    return SOL_RE.test(t) && /wallet|deployer|dev\s|rug.check|launched|history/i.test(t);
  },
  handler: async (runtime, msg, _state, _opts, cb?: HandlerCallback) => {
    const t = String(msg.content.text || "");
    const wallet = t.match(SOL_RE)?.[0];
    if (!wallet) { cb && await cb({ text: "Please provide a Solana wallet address to analyze." }); return; }

    try {
      const data = await api(`/devWallet?wallet=${wallet}`, key(runtime)) as Record<string, unknown>;
      const rugRate  = Number(data.rugRate  ?? 0);
      const deployed = Number(data.totalDeployed ?? 0);
      const rugs     = Number(data.rugCount ?? 0);
      const active   = Number(data.activeCount ?? 0);

      const risk = rugRate >= 50 ? "🔴 HIGH RISK" : rugRate >= 20 ? "🟡 CAUTION" : "🟢 CLEAN";
      const lines = [
        `**Wallet: \`${wallet.slice(0,8)}…${wallet.slice(-4)}\`**`,
        "",
        `${risk} — Rug rate: **${rugRate.toFixed(1)}%** (${rugs} rugs / ${deployed} deployed)`,
        `Active tokens: ${active}  |  History penalty: ${data.historyPenalty ?? 0} pts`,
      ];

      const tokens = Array.isArray(data.tokens) ? data.tokens as Record<string, unknown>[] : [];
      if (tokens.length) {
        lines.push("", "**Recent launches:**");
        for (const tk of tokens.slice(0, 6)) {
          const e = tk.status === "ACTIVE" ? "🟢" : tk.status === "RUG" ? "💀" : "🔴";
          lines.push(`${e} **${tk.symbol ?? "?"}** — ${tk.status} | Liq: $${fmt(Number(tk.liquidity ?? 0))}`);
        }
      }

      cb && await cb({ text: lines.join("\n") });
    } catch (e: unknown) {
      cb && await cb({ text: `Wallet analysis failed: ${(e as Error).message}` });
    }
  },
};

/* ── PREDICT_LP_PULL ─────────────────────────────────────────── */

const predictLpPullAction: Action = {
  name: "PREDICT_LP_PULL",
  similes: [
    "LP_RISK", "RUG_RISK", "LP_PREDICTOR", "LIQUIDITY_RISK",
    "SAFE_TOKEN", "IS_TOKEN_SAFE", "RUG_PULL_RISK",
  ],
  description:
    "Predicts LP pull (rug) probability for a Solana token. Returns a safety " +
    "score 0–100, risk tier (LOW/MEDIUM/HIGH/EXTREME), and named signals. " +
    "Run before buying any new token.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Is token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v safe from rug?" },
      },
      {
        name: "{{agentName}}",
        content: { text: "Running LP pull predictor on that token..." },
      },
    ],
  ],
  validate: async (_r, msg) => {
    const t = String(msg.content.text || "");
    return SOL_RE.test(t) && /rug|lp.pull|safe|liquidity.risk|lp.risk|predict/i.test(t);
  },
  handler: async (runtime, msg, _state, _opts, cb?: HandlerCallback) => {
    const t = String(msg.content.text || "");
    const mint = t.match(SOL_RE)?.[0];
    if (!mint) { cb && await cb({ text: "Please provide a Solana token mint address." }); return; }

    try {
      const data = await api("/lpPredictor", key(runtime), {
        method: "POST",
        body: JSON.stringify({ mint }),
      }) as Record<string, unknown>;

      const risk = String(data.risk ?? "");
      const e = risk === "LOW" ? "🟢" : risk === "MEDIUM" ? "🟡" : "🔴";
      const lines = [
        `**LP Pull Risk: \`${mint.slice(0,8)}…${mint.slice(-4)}\`**`,
        "",
        `${e} **${data.label}** — Score: **${data.score}/100**  |  Risk: **${risk}**`,
        "",
        "**Signals:**",
      ];

      const sigs = Array.isArray(data.signals) ? data.signals as Record<string, unknown>[] : [];
      for (const s of sigs.slice(0, 7)) {
        const arrow = s.impact === "positive" ? "▲" : s.impact === "negative" ? "▼" : "—";
        const d = Number(s.delta ?? 0);
        lines.push(`${arrow} ${s.label}: ${s.value} (${d > 0 ? "+" : ""}${d} pts)`);
      }

      cb && await cb({ text: lines.join("\n") });
    } catch (e: unknown) {
      cb && await cb({ text: `LP prediction failed: ${(e as Error).message}` });
    }
  },
};

/* ── DETECT_BUNDLE ───────────────────────────────────────────── */

const detectBundleAction: Action = {
  name: "DETECT_BUNDLE",
  similes: [
    "BUNDLE_CHECK", "BUNDLE_ATTACK", "BUNDLE_DETECTOR",
    "SNIPER_CHECK", "COORDINATED_BUYERS", "LAUNCH_SNIPERS",
  ],
  description:
    "Detects coordinated bundle attacks on a Solana token launch. Identifies " +
    "early buyer wallets that share a common SOL funder (smoking-gun signal). " +
    "Returns a bundle safety score and verdict: CLEAN / SUSPICIOUS / BUNDLED / EXTREME.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Check for bundle attack on EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      },
      {
        name: "{{agentName}}",
        content: { text: "Running bundle attack detector on that token..." },
      },
    ],
  ],
  validate: async (_r, msg) => {
    const t = String(msg.content.text || "");
    return SOL_RE.test(t) && /bundle|sniper|coordinated|sniped|launch.attack/i.test(t);
  },
  handler: async (runtime, msg, _state, _opts, cb?: HandlerCallback) => {
    const t = String(msg.content.text || "");
    const mint = t.match(SOL_RE)?.[0];
    if (!mint) { cb && await cb({ text: "Please provide a Solana token mint address." }); return; }

    try {
      const data = await api("/bundle", key(runtime), {
        method: "POST",
        body: JSON.stringify({ mint }),
      }) as Record<string, unknown>;

      const verdict = String(data.verdict ?? "");
      const e = verdict === "CLEAN" ? "🟢" : verdict === "SUSPICIOUS" ? "🟡" : "🔴";
      const funder = data.commonFunderDetected
        ? "⚠️ **YES — coordinated attack confirmed!**"
        : "✅ None detected";

      cb && await cb({
        text: [
          `**Bundle Check: \`${mint.slice(0,8)}…${mint.slice(-4)}\`**`,
          "",
          `${e} **${verdict}** — ${data.label}`,
          `Bundle score: ${data.bundleScore}/100`,
          `Early buyers: ${data.earlyCount} wallets (${data.earlyPct}% of supply)`,
          `Common funder: ${funder}`,
        ].join("\n"),
      });
    } catch (e: unknown) {
      cb && await cb({ text: `Bundle detection failed: ${(e as Error).message}` });
    }
  },
};

/* ── GET_SMART_MONEY ─────────────────────────────────────────── */

const getSmartMoneyAction: Action = {
  name: "GET_SMART_MONEY",
  similes: [
    "SMART_WALLETS", "TOP_TRADERS", "WHALE_LEADERBOARD",
    "COPY_TRADE_WALLETS", "BEST_TRADERS", "PROFITABLE_WALLETS",
  ],
  description:
    "Returns the top Solana traders ranked by on-chain performance (copy score, " +
    "win rate). Useful for finding wallets to copy-trade or monitor.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Show me the top 5 Solana smart money wallets" },
      },
      {
        name: "{{agentName}}",
        content: { text: "Fetching the smart money leaderboard from Scan2Moon..." },
      },
    ],
  ],
  validate: async (_r, msg) => {
    const t = String(msg.content.text || "");
    return /smart.money|top.trader|whale.leaderboard|best.wallet|copy.trad|top.wallet|profitable.wallet/i.test(t);
  },
  handler: async (runtime, msg, _state, _opts, cb?: HandlerCallback) => {
    const t = String(msg.content.text || "");
    const num = t.match(/\b([1-9][0-9]?)\b/)?.[1];
    const limit = Math.min(10, Math.max(1, parseInt(num || "5")));

    try {
      const data = await api(
        `/smartMoneyLeaderboard?limit=${limit}&sort=copy_score`,
        key(runtime),
      ) as Record<string, unknown>;

      const entries = Array.isArray(data.entries)
        ? (data.entries as Record<string, unknown>[])
        : [];
      const lines = [`**Smart Money Leaderboard** (top ${entries.length})`, ""];

      for (const e of entries) {
        lines.push(
          `**#${e.rank}** ${e.archetypeEmoji} \`${e.walletShort}\` — ${e.archetypeName}`,
          `   Copy Score: **${e.copyScore}/100** | Win Rate: ${Number(e.winRate ?? 0).toFixed(1)}%`,
        );
      }

      cb && await cb({ text: lines.join("\n") });
    } catch (e: unknown) {
      cb && await cb({ text: `Smart money fetch failed: ${(e as Error).message}` });
    }
  },
};

/* ── GET_NEW_PAIRS ───────────────────────────────────────────── */

const getNewPairsAction: Action = {
  name: "GET_NEW_PAIRS",
  similes: [
    "NEW_TOKENS", "NEW_LAUNCHES", "FRESH_PAIRS",
    "LATEST_TOKENS", "NEW_COINS", "JUST_LAUNCHED",
  ],
  description:
    "Fetches the latest newly launched Solana tokens from Scan2Moon's own " +
    "on-chain detection feed (updated every 2 minutes). Returns tokens with " +
    "risk level (HIGH/MED/LOW), liquidity, market cap, and age.",
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Show me new Solana token launches" },
      },
      {
        name: "{{agentName}}",
        content: { text: "Fetching the latest new pairs from Scan2Moon..." },
      },
    ],
  ],
  validate: async (_r, msg) => {
    const t = String(msg.content.text || "");
    return /new.*(pair|token|launch|coin)|latest.*token|fresh.*token|just.*launched/i.test(t);
  },
  handler: async (runtime, _msg, _state, _opts, cb?: HandlerCallback) => {
    try {
      const data = await api("/newPairs", key(runtime)) as Record<string, unknown>;
      const tokens = Array.isArray(data.tokens)
        ? (data.tokens as Record<string, unknown>[]).slice(0, 8)
        : [];

      if (!tokens.length) {
        cb && await cb({ text: "No new pairs found right now — try again in a moment." });
        return;
      }

      const lines = [`**New Solana Launches** (${data.count ?? tokens.length} detected)`, ""];
      for (const tk of tokens) {
        const e = tk.riskLevel === "HIGH" ? "🔴" : tk.riskLevel === "LOW" ? "🟢" : "🟡";
        lines.push(
          `${e} **${tk.symbol}** (${tk.name}) — ${tk.age}`,
          `   Liq: $${fmt(Number(tk.liquidity ?? 0))} | MC: $${fmt(Number(tk.mc ?? 0))} | Risk: ${tk.riskLevel}`,
          `   \`${tk.mint}\``,
        );
      }

      cb && await cb({ text: lines.join("\n") });
    } catch (e: unknown) {
      cb && await cb({ text: `Failed to fetch new pairs: ${(e as Error).message}` });
    }
  },
};

/* ── Plugin export ───────────────────────────────────────────── */

export const scan2moonPlugin: Plugin = {
  name: "scan2moon",
  description:
    "Solana on-chain intelligence — wallet rug history, LP pull prediction, " +
    "bundle attack detection, smart money leaderboard, and new token pairs. " +
    "Requires SCAN2MOON_API_KEY env var (free at scan2moon.com/api-portal.html).",
  actions: [
    analyzeWalletAction,
    predictLpPullAction,
    detectBundleAction,
    getSmartMoneyAction,
    getNewPairsAction,
  ],
};

export default scan2moonPlugin;
