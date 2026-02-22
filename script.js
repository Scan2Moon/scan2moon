import { renderMainAnalysis } from "./mainAnalysis.js";
import { renderSignals } from "./scanSignals.js";
import { renderMarketCap, stopMarketCap } from "./marketCap.js";
import { renderHolders } from "./holders.js";
import { renderFinalScore } from "./finalScore.js";
import { callRpc } from "./rpc.js";
import "./community.js";
import bs58 from "bs58";

/* ============================= */
/* SAFE TEXT SETTER */
/* ============================= */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

/* ============================= */
/* BASE58 VALIDATION (Solana Safe) */
/* ============================= */
function isValidSolanaAddress(address) {
  try {
    if (!address) return false;

    // Solana mint length is typically 32–44 chars
    if (address.length < 32 || address.length > 44) return false;

    bs58.decode(address);
    return true;
  } catch {
    return false;
  }
}

/* ============================= */
/* SCAN BUTTON HANDLER */
/* ============================= */
document.getElementById("scanBtn").onclick = async () => {
  const mintInput = document.getElementById("mintInput");
  const mint = mintInput.value.trim();

  /* BASIC CHECK */
  if (!mint) {
    alert("Paste token mint address");
    return;
  }

  /* BASE58 VALIDATION */
  if (!isValidSolanaAddress(mint)) {
    alert("Invalid Solana mint address.\nPlease check for typos (no 0, O, I, l allowed).");
    return;
  }

  /* RESET UI */
  setText("mainAnalysis", "Loading...");
  setText("holdersTable", "Loading...");
  setText("scanSignals", "Analyzing market...");
  setText("finalScore", "Calculating score...");
  setText("marketCap", "Loading market cap...");

  stopMarketCap();

  try {
    /* CORE ANALYSIS */
    await renderMainAnalysis(mint);
    await renderHolders(mint);
    await renderSignals(mint);
    renderFinalScore();

    /* 🌍 GLOBAL STATS */
    if (window.incrementGlobalStat) {
      window.incrementGlobalStat("scan");
    }

    if (window.scanResult?.totalScore >= 70) {
      if (window.incrementGlobalStat) {
        window.incrementGlobalStat("moon");
      }
    }

  } catch (e) {
    console.error("Core scan failed:", e);
    setText("mainAnalysis", "Scan failed");
    setText("holdersTable", "Unavailable");
    setText("scanSignals", "Unavailable");
    setText("finalScore", "0");
    alert("Scan failed.\nInvalid mint or backend error.\nCheck console for details.");
    return;
  }

  /* MARKET CAP SEPARATE SAFE BLOCK */
  try {
    renderMarketCap(mint);
  } catch (e) {
    console.warn("Market cap failed:", e);
    setText("marketCap", "Market cap unavailable");
  }
};