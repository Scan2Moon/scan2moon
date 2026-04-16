/* ============================================================
   Scan2Moon — Sentinel AI Agent (Gemini proxy)
   POST /.netlify/functions/sentinel
   Body: { scanData: { ... } }
   ============================================================ */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

/* ── Rate limit: 5 requests per minute per IP ── */
const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > 60000) {
    rateMap.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count++;
  return entry.count > 5;
}
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, e] of rateMap) if (e.start < cutoff) rateMap.delete(ip);
}, 120000);

/* ── Build the Gemini prompt ── */
function buildPrompt(d) {
  const signals = d.signalScores ? Object.entries(d.signalScores).map(([k, v]) => {
    const labels = {
      ageTrust:      "Token Age & Trust",
      integrity:     "Market Integrity",
      pumpDanger:    "Pump & Dump Danger",
      lpStrength:    "Liquidity Pool Strength",
      lpStability:   "LP Stability",
      mcLiqRatio:    "Market Cap / Liquidity Ratio",
      sellPressure:  "Sell Pressure",
      volumeConsist: "Volume Consistency",
      devBehavior:   "Developer Behavior",
      volMcapRatio:  "Volume / Market Cap Ratio",
      pumpFunRisk:   "Pump.fun Launch Risk",
      bundleScore:   "Bundle Attack Score",
    };
    return `  - ${labels[k] || k}: ${v}/100`;
  }).join("\n") : "  (not available)";

  return `You are Sentinel, an AI crypto safety agent for Scan2Moon — a Solana token risk analysis platform. Your job is to explain scan results in a professional but beginner-friendly way.

Here are the scan results for ${d.name} (${d.symbol}):

OVERALL SCORE: ${d.totalScore}/100 — ${d.riskLevel}
MINT: ${d.mint}

MARKET DATA:
  - Liquidity: ${d.liquidity}
  - Market Cap: ${d.marketCap}
  - Top 10 Holders: ${d.top10}
  - 24H Volume: $${d.vol24h ? Number(d.vol24h).toLocaleString() : "N/A"}
  - Buys (24H): ${d.buys24h || "N/A"} | Sells (24H): ${d.sells24h || "N/A"}
  - Net Buy Pressure: ${d.netBuy ?? "N/A"}

DEVELOPER / AUTHORITY:
  - Mint Authority: ${d.mintAuthority}
  - Freeze Authority: ${d.freezeAuthority}
  - Dev Holdings: ${d.devPercent}
  - Is Pump.fun Token: ${d.isPumpFun ? "YES" : "NO"}
  - Graduated from Pump.fun: ${d.hasGraduated ? "YES" : "NO"}

INDIVIDUAL SIGNAL SCORES (0-100, higher = safer):
${signals}

Respond ONLY with a valid JSON object in this exact format (no markdown, no code fences, just raw JSON):
{
  "verdict": "one of: SAFE TO APE | LOW RISK | MODERATE RISK | HIGH RISK | EXTREME DANGER",
  "verdictEmoji": "one emoji matching the verdict",
  "summary": "2-3 sentence plain-English summary of this token's overall safety. Speak directly to the user.",
  "signalBreakdown": [
    { "name": "signal name", "score": 0-100, "status": "good/warn/bad", "explanation": "1 sentence plain explanation of what this score means and why" }
  ],
  "redFlags": ["list of specific risks found, max 5, each under 15 words"],
  "greenFlags": ["list of positive signals found, max 5, each under 15 words"],
  "moonPotential": {
    "rating": "one of: LOW | MEDIUM | HIGH | MOONSHOT",
    "emoji": "one emoji",
    "score": 0-100,
    "reasoning": "2-3 sentences on moon potential based on the data"
  },
  "recommendation": "1-2 sentences on what a smart trader should do with this token right now",
  "beginnerTip": "1 simple tip for a beginner about this specific token — keep it friendly and clear"
}`;
}

/* ── Handler ── */
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many requests. Please wait a moment." }) };

  if (!GEMINI_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Sentinel not configured." }) };

  let scanData;
  try { scanData = JSON.parse(event.body || "{}").scanData; }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) }; }

  if (!scanData) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing scanData." }) };

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(scanData) }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error("Gemini error:", err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Gemini API error.", detail: err }) };
    }

    const geminiJson = await geminiRes.json();
    const rawText    = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "";

    /* Parse the JSON Gemini returns */
    let analysis;
    try {
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      /* If Gemini didn't return clean JSON, wrap the raw text */
      analysis = { summary: rawText, verdict: "UNKNOWN", verdictEmoji: "🤖", signalBreakdown: [], redFlags: [], greenFlags: [], moonPotential: { rating: "UNKNOWN", emoji: "❓", score: 50, reasoning: "" }, recommendation: "", beginnerTip: "" };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ analysis }) };

  } catch (err) {
    console.error("Sentinel handler error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error." }) };
  }
};
