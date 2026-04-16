/* ============================================================
   Scan2Moon — Sentinel AI Agent (Groq / Llama proxy)
   POST /.netlify/functions/sentinel
   Body: { scanData: { ... } }
   ============================================================ */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";

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

/* ── Build the prompt ── */
function buildPrompt(d, lang) {
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

  const isNL = lang === "nl";
  const langInstruction = isNL
    ? "BELANGRIJK: Schrijf je volledige antwoord in het NEDERLANDS. Alle tekst in het JSON-object moet in het Nederlands zijn."
    : "Write your entire response in ENGLISH.";

  return `You are Sentinel, an AI crypto safety agent for Scan2Moon — a Solana token risk analysis platform. Your job is to explain scan results in a professional but beginner-friendly way.

${langInstruction}

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
  "verdict": "${isNL ? "één van: VEILIG | LAAG RISICO | MATIG RISICO | HOOG RISICO | EXTREEM GEVAAR" : "one of: SAFE TO APE | LOW RISK | MODERATE RISK | HIGH RISK | EXTREME DANGER"}",
  "verdictEmoji": "one emoji matching the verdict",
  "summary": "${isNL ? "2-3 zinnen samenvatting van de veiligheid van dit token. Spreek de gebruiker direct aan in het Nederlands." : "2-3 sentence plain-English summary of this token's overall safety. Speak directly to the user."}",
  "signalBreakdown": [
    { "name": "signal name", "score": 0-100, "status": "good/warn/bad", "explanation": "${isNL ? "1 zin in het Nederlands die uitlegt wat deze score betekent en waarom" : "1 sentence plain explanation of what this score means and why"}" }
  ],
  "redFlags": ["${isNL ? "lijst van specifieke risicos, max 5, elk onder 15 woorden, in het Nederlands" : "list of specific risks found, max 5, each under 15 words"}"],
  "greenFlags": ["${isNL ? "lijst van positieve signalen, max 5, elk onder 15 woorden, in het Nederlands" : "list of positive signals found, max 5, each under 15 words"}"],
  "moonPotential": {
    "rating": "${isNL ? "één van: LAAG | GEMIDDELD | HOOG | MOONSHOT" : "one of: LOW | MEDIUM | HIGH | MOONSHOT"}",
    "emoji": "one emoji",
    "score": 0-100,
    "reasoning": "${isNL ? "2-3 zinnen over moon potentieel in het Nederlands" : "2-3 sentences on moon potential based on the data"}"
  },
  "recommendation": "${isNL ? "1-2 zinnen over wat een slimme trader nu moet doen, in het Nederlands" : "1-2 sentences on what a smart trader should do with this token right now"}",
  "beginnerTip": "${isNL ? "1 simpele tip voor een beginner over dit specifieke token, in het Nederlands" : "1 simple tip for a beginner about this specific token — keep it friendly and clear"}"
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

  if (!GROQ_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Sentinel not configured." }) };

  let scanData, lang;
  try {
    const body = JSON.parse(event.body || "{}");
    scanData = body.scanData;
    lang = ["en", "nl"].includes(body.lang) ? body.lang : "en";
  }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) }; }

  if (!scanData) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing scanData." }) };

  try {
    const groqRes = await fetch(GROQ_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       "llama-3.1-8b-instant",
        messages:    [{ role: "user", content: buildPrompt(scanData, lang) }],
        temperature: 0.6,
        max_tokens:  2000,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Groq API error.", detail: err }) };
    }

    const groqJson = await groqRes.json();
    const rawText  = groqJson.choices?.[0]?.message?.content || "";

    /* Parse the JSON Groq returns */
    let analysis;
    try {
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      /* If Groq didn't return clean JSON, wrap the raw text */
      analysis = { summary: rawText, verdict: "UNKNOWN", verdictEmoji: "🤖", signalBreakdown: [], redFlags: [], greenFlags: [], moonPotential: { rating: "UNKNOWN", emoji: "❓", score: 50, reasoning: "" }, recommendation: "", beginnerTip: "" };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ analysis }) };

  } catch (err) {
    console.error("Sentinel handler error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error." }) };
  }
};
