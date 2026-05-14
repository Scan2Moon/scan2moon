var _generatedKey = "";
var _proKey       = "";

/* ── Starter key generation ──────────────────────────────── */
async function generateKey() {
  var email = (document.getElementById("kEmail").value || "").trim();
  if (!email || !email.includes("@") || !email.includes(".")) {
    showError("Please enter a valid email address.");
    return;
  }

  document.getElementById("kFormWrap").style.display = "none";
  document.getElementById("kError").style.display    = "none";
  document.getElementById("kSuccess").style.display  = "none";
  document.getElementById("kLoading").style.display  = "block";

  try {
    var res  = await fetch("/.netlify/functions/selfServeKey", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: email }),
    });
    var data = await res.json();
    document.getElementById("kLoading").style.display = "none";

    if (!res.ok || !data.ok) {
      showError(data.error || "Something went wrong. Please try again.");
      document.getElementById("kFormWrap").style.display = "block";
      return;
    }
    _generatedKey = data.keyId;
    document.getElementById("kDisplay").textContent = data.keyId;
    document.getElementById("kSuccess").style.display = "block";
  } catch (e) {
    document.getElementById("kLoading").style.display = "none";
    showError("Network error. Please check your connection and try again.");
    document.getElementById("kFormWrap").style.display = "block";
  }
}

function copyKey() {
  if (!_generatedKey) return;
  navigator.clipboard.writeText(_generatedKey).then(function() {
    var btn = document.getElementById("kCopyBtn");
    btn.textContent = "Copied!";
    btn.style.background = "rgba(44,255,201,.28)";
    setTimeout(function() {
      btn.textContent = "Copy";
      btn.style.background = "var(--accent-dim)";
    }, 2000);
  }).catch(function() {
    var el = document.getElementById("kDisplay");
    var r = document.createRange(); r.selectNode(el);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
  });
}

function showError(msg) {
  var el = document.getElementById("kError");
  el.textContent = msg;
  el.style.display = "block";
}

/* ── Key Dashboard ───────────────────────────────────────── */
var PLAN_COLORS_DB = { starter:"#2cffc9", pro:"#c084fc", power:"#ffd166", enterprise:"#5bc8ff" };

async function checkKeyStatus() {
  var key = (document.getElementById("dbKey").value || "").trim();
  if (!key || !/^s2m_[0-9a-f]{32}$/.test(key)) {
    showDbError("Please paste a valid API key (format: s2m_ followed by 32 hex characters).");
    return;
  }
  var btn = document.getElementById("dbCheckBtn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  document.getElementById("dbLoading").style.display = "block";
  document.getElementById("dbError").style.display   = "none";
  document.getElementById("dbPanel").style.display   = "none";

  try {
    var res  = await fetch("/.netlify/functions/keyStatus", {
      headers: { "X-Api-Key": key },
    });
    var data = await res.json();
    document.getElementById("dbLoading").style.display = "none";
    btn.disabled = false; btn.textContent = "Check Status";

    if (!res.ok || !data.ok) {
      showDbError(data.error || "Could not fetch key status.");
      return;
    }
    renderDashboard(data);
  } catch (e) {
    document.getElementById("dbLoading").style.display = "none";
    btn.disabled = false; btn.textContent = "Check Status";
    showDbError("Network error. Please try again.");
  }
}

function renderDashboard(d) {
  var color = PLAN_COLORS_DB[d.plan] || "#2cffc9";

  /* Plan badge */
  var badge = document.getElementById("dbPlanBadge");
  badge.textContent = d.plan.toUpperCase();
  badge.style.color       = color;
  badge.style.borderColor = color + "55";
  badge.style.background  = color + "14";

  /* Masked key */
  document.getElementById("dbKeyMasked").textContent = d.keyId;

  /* Active badge */
  var ab = document.getElementById("dbActiveBadge");
  ab.textContent = d.active ? "● ACTIVE" : "● REVOKED";
  ab.style.color = d.active ? "var(--green)" : "var(--red)";

  /* Usage bar */
  var pct      = d.dailyLimit > 0 ? Math.min(100, (d.dailyUsed / d.dailyLimit) * 100) : 0;
  var barColor = pct > 85 ? "var(--red)" : pct > 60 ? "var(--amber)" : color;
  document.getElementById("dbUsageText").textContent = d.dailyUsed.toLocaleString() + " / " + d.dailyLimit.toLocaleString();
  document.getElementById("dbUsageText").style.color = barColor;
  document.getElementById("dbUsageBar").style.width      = pct + "%";
  document.getElementById("dbUsageBar").style.background = barColor;

  /* Stats */
  document.getElementById("dbRemaining").textContent = d.dailyRemaining.toLocaleString();
  document.getElementById("dbRemaining").style.color = color;
  document.getElementById("dbTotal").textContent     = (d.totalRequests || 0).toLocaleString();

  /* Resets in */
  var resetsAt = new Date(d.resetsAt);
  var diffMs   = Math.max(0, resetsAt - Date.now());
  var diffH    = Math.floor(diffMs / 3600000);
  var diffM    = Math.floor((diffMs % 3600000) / 60000);
  document.getElementById("dbResetsIn").textContent = diffH + "h " + diffM + "m";
  document.getElementById("dbResetsAt").textContent = resetsAt.toUTCString().slice(17, 22);

  /* Last used */
  document.getElementById("dbLastUsed").textContent = d.lastUsedAt
    ? new Date(d.lastUsedAt).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" })
    : "Never";

  /* Footer meta */
  document.getElementById("dbEmail").textContent     = d.email;
  document.getElementById("dbCreatedAt").textContent = d.createdAt
    ? new Date(d.createdAt).toLocaleDateString(undefined, { month:"short", year:"numeric" })
    : "—";

  /* Upgrade nudge for starter */
  var nudge = document.getElementById("dbUpgradeNudge");
  if (nudge) nudge.style.display = d.plan === "starter" ? "flex" : "none";

  /* Renewal tile */
  var renewTile  = document.getElementById("dbRenewalTile");
  var expiryWarn = document.getElementById("dbExpiryWarn");
  if (renewTile) {
    if (d.plan !== "starter" && d.renewsAt) {
      renewTile.style.display = "flex";
      var renewDate = new Date(d.renewsAt);
      document.getElementById("dbRenewsDate").textContent = renewDate.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric", timeZone:"UTC" });
      var days   = d.daysUntilExpiry;
      var daysEl = document.getElementById("dbDaysLeft");
      var renewBtn = document.getElementById("dbRenewBtn");
      if (days <= 0) {
        daysEl.textContent = "EXPIRED";
        daysEl.style.color = "var(--red)";
        if (renewBtn) { renewBtn.style.background = "var(--red)"; renewBtn.style.color = "#fff"; }
      } else if (days <= 7) {
        daysEl.textContent = days + " day" + (days !== 1 ? "s" : "") + " left";
        daysEl.style.color = "var(--amber)";
        if (expiryWarn) {
          expiryWarn.style.display = "flex";
          var warnText = document.getElementById("dbExpiryWarnText");
          if (warnText) warnText.textContent = "⚠ Your plan expires in " + days + " day" + (days !== 1 ? "s" : "") + " — renew to keep full access.";
        }
      } else {
        daysEl.textContent = days + " days left";
        daysEl.style.color = "var(--green)";
      }
    } else {
      renewTile.style.display = "none";
      if (expiryWarn) expiryWarn.style.display = "none";
    }
  }

  document.getElementById("dbPanel").style.display = "block";
}

function scrollToRenew() {
  var keyInput = document.getElementById("upExistingKey");
  var rawKey   = (document.getElementById("dbKey") || {}).value || "";
  if (keyInput && rawKey) keyInput.value = rawKey;
  var target = document.getElementById("upgrade-pro");
  if (target) target.scrollIntoView({ behavior: "smooth" });
}

async function revokeMyKey() {
  var rawKey = (document.getElementById("dbKey") || {}).value || "";
  if (!rawKey || !rawKey.startsWith("s2m_")) {
    alert("Re-enter your API key in the field above first, then click Revoke.");
    return;
  }
  var confirmed = window.confirm(
    "Revoke key " + rawKey.slice(0, 8) + "…" + rawKey.slice(-4) + "?\n\n" +
    "This is PERMANENT. The key will stop working immediately.\n" +
    "A confirmation email will be sent to the address on file."
  );
  if (!confirmed) return;

  var btn = document.getElementById("dbRevokeBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Revoking…"; }

  try {
    var res  = await fetch("/.netlify/functions/revokeMyKey", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ keyId: rawKey, confirm: "REVOKE" }),
    });
    var data = await res.json();
    if (data.ok) {
      if (btn) { btn.textContent = "✓ Revoked"; btn.style.color = "var(--green)"; btn.style.borderColor = "rgba(44,255,201,.4)"; }
      var ab = document.getElementById("dbActiveBadge");
      if (ab) { ab.textContent = "● REVOKED"; ab.style.color = "var(--red)"; }
      alert("Key revoked. Check your email for confirmation.\nYou can generate a new key from the API portal.");
    } else {
      if (btn) { btn.disabled = false; btn.textContent = "Revoke This Key"; }
      alert("Error: " + (data.error || "Unknown error"));
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Revoke This Key"; }
    alert("Network error — please try again.");
  }
}

function showDbError(msg) {
  var el = document.getElementById("dbError");
  el.textContent   = msg;
  el.style.display = "block";
}

/* ── Plan selector ───────────────────────────────────────── */
var _selectedPlan = { id: "pro", usd: 49, units: 49000000, label: "Pro", dailyLimit: 25000 };
var PLANS = {
  pro:   { id: "pro",   usd: 49,  units: 49000000, label: "Pro",   dailyLimit: 25000  },
  power: { id: "power", usd: 99,  units: 99000000, label: "Power", dailyLimit: 100000 },
};

function setPlan(id) {
  _selectedPlan = PLANS[id] || PLANS.pro;
  var amt = _selectedPlan.usd;
  document.getElementById("upPlanPro").style.borderColor   = id === "pro"   ? "rgba(192,132,252,.8)"  : "rgba(192,132,252,.2)";
  document.getElementById("upPlanPro").style.background    = id === "pro"   ? "rgba(192,132,252,.12)" : "transparent";
  document.getElementById("upPlanPower").style.borderColor = id === "power" ? "rgba(255,209,102,.8)"  : "rgba(255,209,102,.2)";
  document.getElementById("upPlanPower").style.background  = id === "power" ? "rgba(255,209,102,.12)" : "transparent";
  var payBtnAmt  = document.getElementById("upPayBtnAmount");
  var payBtnAmt2 = document.getElementById("upPayBtnAmount2");
  var manualAmt  = document.getElementById("upManualAmount");
  if (payBtnAmt)  payBtnAmt.textContent  = amt;
  if (payBtnAmt2) payBtnAmt2.textContent = amt;
  if (manualAmt)  manualAmt.textContent  = amt + " USDC";
}

function selectPlanAndScroll(id) {
  setPlan(id);
  var target = document.getElementById("upgrade-pro");
  if (target) target.scrollIntoView({ behavior: "smooth" });
}

/* ── Solana wallet connect ───────────────────────────────── */
var _solanaProvider     = null;
var _solanaWalletPubkey = null;

function getSolanaProvider() {
  return (window.phantom && window.phantom.solana)
    || window.solana
    || window.backpack
    || null;
}

async function initWalletPay() {
  var provider = getSolanaProvider();
  if (!provider) {
    showUpError("No Solana wallet detected. Install Phantom (phantom.com) then refresh.");
    return;
  }
  var btn = document.getElementById("upConnectBtn");
  btn.textContent = "Connecting…";
  btn.disabled    = true;
  try {
    var resp            = await provider.connect();
    _solanaProvider     = provider;
    _solanaWalletPubkey = resp.publicKey.toString();
    document.getElementById("upWalletConnect").style.display = "none";
    document.getElementById("upWalletAddr").textContent =
      _solanaWalletPubkey.slice(0, 5) + "…" + _solanaWalletPubkey.slice(-4);
    document.getElementById("upWalletReady").style.display = "block";
  } catch (e) {
    btn.textContent = "Connect Wallet & Pay " + _selectedPlan.usd + " USDC";
    btn.disabled    = false;
    var msg = (e && e.message) ? e.message.toLowerCase() : "";
    showUpError(
      (e && e.code === 4001) || msg.includes("reject") || msg.includes("cancel")
        ? "Connection rejected. Please approve in your wallet."
        : "Could not connect: " + ((e && e.message) || "unknown error")
    );
  }
}

function disconnectWallet() {
  _solanaProvider     = null;
  _solanaWalletPubkey = null;
  document.getElementById("upWalletReady").style.display   = "none";
  document.getElementById("upWalletConnect").style.display = "block";
  var btn = document.getElementById("upConnectBtn");
  btn.textContent = "Connect Wallet & Pay " + _selectedPlan.usd + " USDC";
  btn.disabled    = false;
}

/* ── Send USDC via wallet ─────────────────────────────────── */
async function sendUsdcPayment() {
  var provider = _solanaProvider || getSolanaProvider();
  if (!provider || !_solanaWalletPubkey) { showUpError("Wallet not connected."); return; }

  var email = (document.getElementById("upEmail").value || "").trim();
  if (!email || !email.includes("@") || !email.includes(".")) {
    document.getElementById("upEmail").focus();
    showUpError("Please fill in your email first.");
    return;
  }

  /* Show spinner */
  document.getElementById("upWalletReady").style.display   = "none";
  document.getElementById("upWalletConfirm").style.display = "block";
  document.getElementById("upError").style.display         = "none";

  try {
    var w3 = window.solanaWeb3;
    if (!w3) throw new Error("solana/web3.js not loaded — please hard-refresh.");

    var connection   = new w3.Connection("https://api.mainnet-beta.solana.com", "confirmed");
    var payerPk      = new w3.PublicKey(_solanaWalletPubkey);
    var mintPk       = new w3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); /* USDC-SPL */
    var recipientPk  = new w3.PublicKey("2NYUevD2m8eRvHFsT3JvDy8poxiWNVEKXqnDvXWrZpyC"); /* Scan2Moon */
    var tokenProgId  = new w3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    var ataProgId    = new w3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ");
    var sysProgId    = new w3.PublicKey("11111111111111111111111111111111");

    /* Derive associated token accounts */
    var senderATA = w3.PublicKey.findProgramAddressSync(
      [payerPk.toBuffer(), tokenProgId.toBuffer(), mintPk.toBuffer()], ataProgId)[0];
    var recipientATA = w3.PublicKey.findProgramAddressSync(
      [recipientPk.toBuffer(), tokenProgId.toBuffer(), mintPk.toBuffer()], ataProgId)[0];

    var ixList = [];

    /* Create recipient ATA if it doesn't exist yet */
    var ataInfo = await connection.getAccountInfo(recipientATA);
    if (!ataInfo) {
      ixList.push(new w3.TransactionInstruction({
        programId: ataProgId,
        keys: [
          { pubkey: payerPk,      isSigner: true,  isWritable: true  },
          { pubkey: recipientATA, isSigner: false, isWritable: true  },
          { pubkey: recipientPk,  isSigner: false, isWritable: false },
          { pubkey: mintPk,       isSigner: false, isWritable: false },
          { pubkey: sysProgId,    isSigner: false, isWritable: false },
          { pubkey: tokenProgId,  isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
      }));
    }

    /* SPL token transfer: amount in raw units (USDC has 6 decimals) */
    var rawAmount = _selectedPlan.units; /* e.g. 49_000_000 for $49 */
    var transferData = Buffer.alloc(9);
    transferData.writeUInt8(3, 0); /* instruction index 3 = Transfer */
    transferData.writeBigUInt64LE(BigInt(rawAmount), 1);

    ixList.push(new w3.TransactionInstruction({
      programId: tokenProgId,
      keys: [
        { pubkey: senderATA,    isSigner: false, isWritable: true  },
        { pubkey: recipientATA, isSigner: false, isWritable: true  },
        { pubkey: payerPk,      isSigner: true,  isWritable: false },
      ],
      data: transferData,
    }));

    /* Build and sign transaction */
    var { blockhash } = await connection.getLatestBlockhash("confirmed");
    var tx = new w3.Transaction({ recentBlockhash: blockhash, feePayer: payerPk });
    ixList.forEach(function(ix) { tx.add(ix); });

    /* Request wallet signature */
    var signedTx = await provider.signTransaction(tx);

    /* Broadcast */
    var rawTx    = signedTx.serialize();
    var broadcastSig = null; /* tracked separately so the catch block can surface it */
    var txSig    = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
    broadcastSig = txSig; /* tx is now on-chain — capture before confirmTransaction can throw */

    /* Wait for 1 confirmation.
       NOTE: if this times out the payment IS on-chain. The catch block below
       detects this case via broadcastSig and surfaces the sig so the user can
       claim manually rather than thinking their payment failed. */
    await connection.confirmTransaction(txSig, "confirmed");

    /* Success — auto-fill the manual claim field and switch view */
    document.getElementById("upWalletConfirm").style.display = "none";
    document.getElementById("upTx").value = txSig;

    var txLinkEl = document.getElementById("upWalletTxLink");
    if (txLinkEl) {
      txLinkEl.innerHTML = '<a href="https://solscan.io/tx/' + txSig + '" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent);">View on Solscan &rarr;</a>';
      txLinkEl.style.display = "block";
    }

    /* Trigger claim automatically */
    await claimProKey();

  } catch (e) {
    document.getElementById("upWalletConfirm").style.display = "none";
    document.getElementById("upWalletReady").style.display   = "block";
    var msg = (e && e.message) ? e.message.toLowerCase() : "";

    /* If the broadcast already succeeded but confirmation timed out, the payment
       IS on-chain. Surface the sig so the user can claim manually. */
    if (typeof broadcastSig === "string" && broadcastSig.length > 0) {
      document.getElementById("upTx").value = broadcastSig;
      showUpError(
        "Payment sent but confirmation timed out. Your transaction signature has been filled in above — click \"Claim My Key\" to complete. " +
        "You can also verify on Solscan: https://solscan.io/tx/" + broadcastSig
      );
      return;
    }

    showUpError(
      (e && e.code === 4001) || msg.includes("reject") || msg.includes("cancel")
        ? "Transaction rejected. You can still pay manually using the address below."
        : "Payment failed: " + ((e && e.message) || "unknown error") + ". Try the manual method below."
    );
  }
}

/* ── Claim key after pasting tx sig ─────────────────────── */
async function claimProKey() {
  var txSig = (document.getElementById("upTx").value          || "").trim();
  var email = (document.getElementById("upEmail").value       || "").trim();
  var keyId = (document.getElementById("upExistingKey").value || "").trim();

  if (!txSig) { showUpError("Please paste your transaction signature."); return; }
  if (!email || !email.includes("@") || !email.includes(".")) {
    showUpError("Please enter a valid email address."); return;
  }

  document.getElementById("upFormWrap").style.display = "none";
  document.getElementById("upError").style.display    = "none";
  document.getElementById("upSuccess").style.display  = "none";
  document.getElementById("upLoading").style.display  = "block";

  try {
    var body = { txSignature: txSig, email: email };
    if (keyId) body.existingKeyId = keyId;

    var res  = await fetch("/.netlify/functions/upgradeKey", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    var data = await res.json();
    document.getElementById("upLoading").style.display = "none";

    if (!res.ok || !data.ok) {
      showUpError(data.error || "Verification failed. Please double-check the signature and email.");
      document.getElementById("upFormWrap").style.display = "block";
      return;
    }

    _proKey = data.keyId;
    document.getElementById("upDisplay").textContent = data.keyId;
    var planEl = document.getElementById("upSuccessPlan");
    if (planEl) planEl.textContent = data.planLabel + " — " + data.dailyLimit.toLocaleString() + " req/day";
    document.getElementById("upSuccess").style.display = "block";

  } catch (e) {
    document.getElementById("upLoading").style.display = "none";
    showUpError("Network error. Please check your connection and try again.");
    document.getElementById("upFormWrap").style.display = "block";
  }
}

function copyProKey() {
  if (!_proKey) return;
  navigator.clipboard.writeText(_proKey).then(function() {
    var btn = document.getElementById("upCopyBtn");
    btn.textContent = "Copied!";
    btn.style.background = "rgba(192,132,252,.28)";
    setTimeout(function() {
      btn.textContent = "Copy";
      btn.style.background = "var(--purple-dim)";
    }, 2000);
  }).catch(function() {
    var el = document.getElementById("upDisplay");
    var r = document.createRange(); r.selectNode(el);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
  });
}

function copyProWallet() {
  var addr = document.getElementById("proWallet").textContent.trim();
  var btn  = document.getElementById("proWalletCopyBtn");
  navigator.clipboard.writeText(addr).then(function() {
    btn.textContent = "Copied!";
    setTimeout(function() { btn.textContent = "Copy"; }, 2000);
  }).catch(function() {});
}

function showUpError(msg) {
  var el = document.getElementById("upError");
  el.textContent   = msg;
  el.style.display = "block";
  /* if wallet confirm is showing, switch back to form */
  var wc = document.getElementById("upWalletConfirm");
  if (wc && wc.style.display !== "none") {
    wc.style.display = "none";
    document.getElementById("upFormWrap").style.display = "block";
  }
}

/* ── Enter-key shortcuts ─────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function() {
  var kEmail = document.getElementById("kEmail");
  if (kEmail) kEmail.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); generateKey(); }
  });
});
