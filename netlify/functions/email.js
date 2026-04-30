/* ================================================================
   Scan2Moon -- Email Helper (Resend)
   Shared by selfServeKey and upgradeKey.

   Requires env var: RESEND_API_KEY
   Sender domain must be verified in Resend dashboard.
   ================================================================ */

const SITE_URL = process.env.URL || "https://scan2moon.com";

const PLAN_COLORS = {
  starter:    "#2cffc9",
  pro:        "#9945ff",
  power:      "#ff9632",
  enterprise: "#5bc8ff",
};

const PLAN_LABELS = {
  starter:    "Starter",
  pro:        "Pro",
  power:      "Power",
  enterprise: "Enterprise",
};

/* ----------------------------------------------------------------
   sendKeyEmail({ to, keyId, plan, planLabel, dailyLimit, action })
   action: "created" | "upgraded"
   ---------------------------------------------------------------- */
async function sendKeyEmail({ to, keyId, plan, planLabel, dailyLimit, action }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping email for", to);
    return { ok: false, reason: "email not configured" };
  }

  const color = PLAN_COLORS[plan] || "#2cffc9";
  const label = planLabel || PLAN_LABELS[plan] || plan;
  const isUpgrade = action === "upgraded";

  const subject = isUpgrade
    ? `Your Scan2Moon key was upgraded to ${label}`
    : `Your Scan2Moon ${label} API Key`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#060f15;font-family:'Courier New',Courier,monospace;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060f15;">
  <tr><td align="center" style="padding:32px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

    <!-- LOGO -->
    <tr><td style="padding-bottom:28px;text-align:center;">
      <div style="display:inline-block;background:#0a161e;border:1px solid ${color}33;border-radius:10px;padding:14px 24px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:3px;color:#5a7080;text-transform:uppercase;display:block;margin-bottom:4px;">SOLANA ANALYTICS</span>
        <span style="font-size:22px;font-weight:900;color:#e8f4f8;letter-spacing:2px;">SCAN2MOON</span>
      </div>
    </td></tr>

    <!-- HERO -->
    <tr><td style="background:#0a161e;border:1px solid ${color}40;border-radius:12px;padding:28px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:${color};letter-spacing:2px;text-transform:uppercase;">
        ${isUpgrade ? "&#11014; Key Upgraded" : "&#9989; Key Ready"}
      </p>
      <h1 style="margin:0 0 20px;font-size:20px;font-weight:900;color:#e8f4f8;">
        ${label} Plan ${isUpgrade ? "Activated" : "— You're in"}
      </h1>

      <!-- Key display -->
      <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#5bc8ff;letter-spacing:1px;text-transform:uppercase;">YOUR API KEY</p>
      <div style="background:#030d12;border:1px solid ${color}33;border-radius:7px;padding:14px 16px;margin-bottom:8px;">
        <code style="font-size:14px;color:#e8f4f8;word-break:break-all;">${keyId}</code>
      </div>
      <p style="margin:0 0 24px;font-size:11px;color:#e8a020;">
        &#9888; Save this key now — it cannot be recovered if lost.
      </p>

      <!-- Plan stats -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48%" style="background:#030d12;border-radius:8px;padding:14px;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:9px;font-weight:700;color:#5a7080;letter-spacing:1px;text-transform:uppercase;">Daily Limit</p>
            <p style="margin:0;font-size:20px;font-weight:900;color:${color};">${dailyLimit.toLocaleString()}</p>
            <p style="margin:2px 0 0;font-size:10px;color:#5a7080;">requests / day</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:#030d12;border-radius:8px;padding:14px;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:9px;font-weight:700;color:#5a7080;letter-spacing:1px;text-transform:uppercase;">Resets</p>
            <p style="margin:0;font-size:20px;font-weight:900;color:#e8f4f8;">Daily</p>
            <p style="margin:2px 0 0;font-size:10px;color:#5a7080;">midnight UTC</p>
          </td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="height:16px;"></td></tr>

    <!-- HOW TO USE -->
    <tr><td style="background:#0a161e;border:1px solid rgba(44,255,201,.1);border-radius:10px;padding:20px;">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;color:#2cffc9;letter-spacing:1.5px;text-transform:uppercase;">Quick Start</p>
      <p style="margin:0 0 10px;font-size:12px;color:#8fa3b0;">Pass your key in the <code style="color:#2cffc9;background:#030d12;padding:1px 5px;border-radius:3px;">X-Api-Key</code> header:</p>
      <div style="background:#030d12;border-radius:6px;padding:12px 14px;">
        <code style="font-size:12px;color:#c8dfe8;line-height:1.7;word-break:break-all;">
          curl -H "X-Api-Key: ${keyId}" \<br>
          &nbsp;&nbsp;"${SITE_URL}/.netlify/functions/devWallet?wallet=ADDRESS"
        </code>
      </div>
    </td></tr>

    <tr><td style="height:20px;"></td></tr>

    <!-- CTA -->
    <tr><td style="text-align:center;padding-bottom:24px;">
      <a href="${SITE_URL}/api-portal.html#my-dashboard"
         style="display:inline-block;background:linear-gradient(135deg,#2cffc9,#1db8a0);color:#051015;font-weight:800;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        View API Docs &amp; Dashboard &#8594;
      </a>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="border-top:1px solid rgba(255,255,255,.05);padding-top:20px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#3a5060;">Scan2Moon &mdash; Solana Analytics</p>
      <p style="margin:0;font-size:11px;color:#3a5060;">
        Questions? <a href="https://x.com/Scan2Moon" style="color:#5a7080;text-decoration:none;">@Scan2Moon on X</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_KEY,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    "Scan2Moon <noreply@scan2moon.com>",
        to:      [to],
        subject: subject,
        html:    html,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => String(res.status));
      console.warn("[email] Resend error:", err);
      return { ok: false, reason: "Resend returned " + res.status };
    }

    console.log("[email] Sent", subject, "to", to);
    return { ok: true };
  } catch (e) {
    console.warn("[email] Send failed:", e.message);
    return { ok: false, reason: e.message };
  }
}


/* ----------------------------------------------------------------
   sendRenewalReminderEmail({ to, keyId, plan, planLabel, dailyLimit, daysLeft, renewsAt })
   Sent 7 days before expiry.
   ---------------------------------------------------------------- */
async function sendRenewalReminderEmail({ to, keyId, plan, planLabel, dailyLimit, daysLeft, renewsAt }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return { ok: false, reason: "email not configured" };

  const color   = PLAN_COLORS[plan] || "#2cffc9";
  const label   = planLabel || PLAN_LABELS[plan] || plan;
  const price   = plan === "power" ? 99 : 49;
  const subject = "⚠ Your Scan2Moon " + label + " key expires in " + daysLeft + " day" + (daysLeft !== 1 ? "s" : "");
  const expDate = new Date(renewsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const keyMasked = keyId.slice(0, 8) + "..." + keyId.slice(-4);

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060f15;font-family:'Courier New',Courier,monospace;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060f15;">
  <tr><td align="center" style="padding:32px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr><td style="padding-bottom:24px;text-align:center;">
      <div style="display:inline-block;background:#0a161e;border:1px solid ${color}33;border-radius:10px;padding:14px 24px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:3px;color:#5a7080;text-transform:uppercase;display:block;margin-bottom:4px;">SOLANA ANALYTICS</span>
        <span style="font-size:22px;font-weight:900;color:#e8f4f8;letter-spacing:2px;">SCAN2MOON</span>
      </div>
    </td></tr>
    <tr><td style="background:#0a161e;border:1px solid #e8a02066;border-radius:12px;padding:28px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#e8a020;letter-spacing:2px;text-transform:uppercase;">&#9888; Renewal Reminder</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#e8f4f8;">Your ${label} key expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#8fa3b0;">
        Key <code style="color:#2cffc9;background:#030d12;padding:2px 6px;border-radius:3px;">${keyMasked}</code>
        expires on <strong style="color:#e8f4f8;">${expDate}</strong>.
        After that it will be downgraded to the free Starter plan (1,000 req/day).
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="48%" style="background:#030d12;border-radius:8px;padding:14px;">
            <p style="margin:0 0 4px;font-size:9px;font-weight:700;color:#5a7080;letter-spacing:1px;text-transform:uppercase;">Current Plan</p>
            <p style="margin:0;font-size:18px;font-weight:900;color:${color};">${label}</p>
            <p style="margin:2px 0 0;font-size:10px;color:#5a7080;">${dailyLimit.toLocaleString()} req/day</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:#030d12;border-radius:8px;padding:14px;">
            <p style="margin:0 0 4px;font-size:9px;font-weight:700;color:#5a7080;letter-spacing:1px;text-transform:uppercase;">Renewal Cost</p>
            <p style="margin:0;font-size:18px;font-weight:900;color:#e8f4f8;">$${price} USDC</p>
            <p style="margin:2px 0 0;font-size:10px;color:#5a7080;">one-time, 30 days</p>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:12px;color:#8fa3b0;">
        Send $${price} USDC to
        <code style="color:#2cffc9;font-size:11px;background:#030d12;padding:2px 5px;border-radius:3px;">2NYUevD2m8eRvHFsT3JvDy8poxiWNVEKXqnDvXWrZpyC</code>,
        then paste your tx signature in the API portal with your existing key ID to renew in place.
      </p>
    </td></tr>
    <tr><td style="height:16px;"></td></tr>
    <tr><td style="text-align:center;padding-bottom:24px;">
      <a href="${SITE_URL}/api-portal.html#upgrade"
         style="display:inline-block;background:linear-gradient(135deg,#e8a020,#c07010);color:#0a0500;font-weight:800;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Renew Now &#8594;
      </a>
    </td></tr>
    <tr><td style="border-top:1px solid rgba(255,255,255,.05);padding-top:20px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#3a5060;">Scan2Moon &mdash; <a href="https://x.com/Scan2Moon" style="color:#5a7080;text-decoration:none;">@Scan2Moon on X</a></p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Scan2Moon <noreply@scan2moon.com>", to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "Resend " + res.status };
    console.log("[email] Sent renewal reminder to", to);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/* ----------------------------------------------------------------
   sendExpiryEmail({ to, keyId, plan, planLabel })
   Sent when a key is downgraded after expiry.
   ---------------------------------------------------------------- */
async function sendExpiryEmail({ to, keyId, plan, planLabel }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return { ok: false, reason: "email not configured" };

  const label     = planLabel || PLAN_LABELS[plan] || plan;
  const price     = plan === "power" ? 99 : 49;
  const subject   = "Your Scan2Moon " + label + " key has expired";
  const keyMasked = keyId.slice(0, 8) + "..." + keyId.slice(-4);

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060f15;font-family:'Courier New',Courier,monospace;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060f15;">
  <tr><td align="center" style="padding:32px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr><td style="padding-bottom:24px;text-align:center;">
      <div style="display:inline-block;background:#0a161e;border:1px solid #ffffff22;border-radius:10px;padding:14px 24px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:3px;color:#5a7080;text-transform:uppercase;display:block;margin-bottom:4px;">SOLANA ANALYTICS</span>
        <span style="font-size:22px;font-weight:900;color:#e8f4f8;letter-spacing:2px;">SCAN2MOON</span>
      </div>
    </td></tr>
    <tr><td style="background:#0a161e;border:1px solid #ff444433;border-radius:12px;padding:28px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#ff6060;letter-spacing:2px;text-transform:uppercase;">&#10006; Plan Expired</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#e8f4f8;">Your ${label} key has been downgraded</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#8fa3b0;">
        Key <code style="color:#2cffc9;background:#030d12;padding:2px 6px;border-radius:3px;">${keyMasked}</code>
        has been moved to the <strong style="color:#e8f4f8;">Starter plan</strong> (1,000 req/day).
        Your key still works — just at the free tier.
      </p>
      <p style="margin:0 0 24px;font-size:12px;color:#8fa3b0;">
        To restore ${label} access, send $${price} USDC to
        <code style="color:#2cffc9;font-size:11px;background:#030d12;padding:2px 5px;border-radius:3px;">2NYUevD2m8eRvHFsT3JvDy8poxiWNVEKXqnDvXWrZpyC</code>
        and paste the tx signature in the portal with your existing key ID.
      </p>
    </td></tr>
    <tr><td style="height:16px;"></td></tr>
    <tr><td style="text-align:center;padding-bottom:24px;">
      <a href="${SITE_URL}/api-portal.html#upgrade"
         style="display:inline-block;background:linear-gradient(135deg,#2cffc9,#1db8a0);color:#051015;font-weight:800;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Reactivate ${label} &#8594;
      </a>
    </td></tr>
    <tr><td style="border-top:1px solid rgba(255,255,255,.05);padding-top:20px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#3a5060;">Scan2Moon &mdash; <a href="https://x.com/Scan2Moon" style="color:#5a7080;text-decoration:none;">@Scan2Moon on X</a></p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Scan2Moon <noreply@scan2moon.com>", to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "Resend " + res.status };
    console.log("[email] Sent expiry notice to", to);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}


/* ----------------------------------------------------------------
   sendReceiptEmail({ to, keyId, plan, planLabel, dailyLimit,
                      amountPaid, txSig, action, renewsAt })
   Formal payment receipt — sent alongside the key email on upgrade.
   ---------------------------------------------------------------- */
async function sendReceiptEmail({ to, keyId, plan, planLabel, dailyLimit, amountPaid, txSig, action, renewsAt }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return { ok: false, reason: "email not configured" };

  const color     = PLAN_COLORS[plan] || "#2cffc9";
  const label     = planLabel || PLAN_LABELS[plan] || plan;
  const isRenewal = action === "upgraded";
  const subject   = "Scan2Moon Payment Receipt — " + label + " Plan";
  const keyMasked = keyId.slice(0, 8) + "..." + keyId.slice(-4);
  const txMasked  = txSig ? txSig.slice(0, 16) + "..." + txSig.slice(-8) : "—";
  const txLink    = txSig ? "https://solscan.io/tx/" + txSig : null;
  const paidDate  = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const renewDate = renewsAt ? new Date(renewsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060f15;font-family:'Courier New',Courier,monospace;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060f15;">
  <tr><td align="center" style="padding:32px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

    <!-- LOGO -->
    <tr><td style="padding-bottom:24px;text-align:center;">
      <div style="display:inline-block;background:#0a161e;border:1px solid ${color}33;border-radius:10px;padding:14px 24px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:3px;color:#5a7080;text-transform:uppercase;display:block;margin-bottom:4px;">SOLANA ANALYTICS</span>
        <span style="font-size:22px;font-weight:900;color:#e8f4f8;letter-spacing:2px;">SCAN2MOON</span>
      </div>
    </td></tr>

    <!-- RECEIPT HEADER -->
    <tr><td style="background:#0a161e;border:1px solid ${color}40;border-radius:12px;padding:28px;margin-bottom:16px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:${color};letter-spacing:2px;text-transform:uppercase;">&#9989; Payment Confirmed</p>
      <h1 style="margin:0 0 24px;font-size:20px;font-weight:900;color:#e8f4f8;">${isRenewal ? "Renewal" : "Upgrade"} Receipt</h1>

      <!-- Amount box -->
      <div style="background:#030d12;border:1px solid ${color}22;border-radius:9px;padding:18px 20px;margin-bottom:20px;display:flex;align-items:center;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">
              <p style="margin:0 0 3px;font-size:9px;font-weight:700;color:#5a7080;letter-spacing:1px;text-transform:uppercase;">Amount Paid</p>
              <p style="margin:0;font-size:28px;font-weight:900;color:${color};">$${parseFloat(amountPaid).toFixed(2)} <span style="font-size:14px;color:#5a7080;">USDC</span></p>
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <p style="margin:0 0 3px;font-size:9px;font-weight:700;color:#5a7080;letter-spacing:1px;text-transform:uppercase;">Plan</p>
              <p style="margin:0;font-size:18px;font-weight:900;color:#e8f4f8;">${label}</p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Receipt line items -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr style="border-bottom:1px solid rgba(255,255,255,.05);">
          <td style="padding:10px 0;font-size:11px;color:#5a7080;">Date</td>
          <td style="padding:10px 0;font-size:11px;color:#e8f4f8;text-align:right;">${paidDate}</td>
        </tr>
        <tr style="border-bottom:1px solid rgba(255,255,255,.05);">
          <td style="padding:10px 0;font-size:11px;color:#5a7080;">Product</td>
          <td style="padding:10px 0;font-size:11px;color:#e8f4f8;text-align:right;">Scan2Moon ${label} API — 30 days</td>
        </tr>
        <tr style="border-bottom:1px solid rgba(255,255,255,.05);">
          <td style="padding:10px 0;font-size:11px;color:#5a7080;">Daily Quota</td>
          <td style="padding:10px 0;font-size:11px;color:#e8f4f8;text-align:right;">${dailyLimit.toLocaleString()} requests / day</td>
        </tr>
        <tr style="border-bottom:1px solid rgba(255,255,255,.05);">
          <td style="padding:10px 0;font-size:11px;color:#5a7080;">Key</td>
          <td style="padding:10px 0;font-size:11px;text-align:right;"><code style="color:#2cffc9;background:#030d12;padding:2px 6px;border-radius:3px;">${keyMasked}</code></td>
        </tr>
        <tr style="border-bottom:1px solid rgba(255,255,255,.05);">
          <td style="padding:10px 0;font-size:11px;color:#5a7080;">Renews / Expires</td>
          <td style="padding:10px 0;font-size:11px;color:#e8f4f8;text-align:right;">${renewDate}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:11px;color:#5a7080;">Transaction</td>
          <td style="padding:10px 0;font-size:11px;text-align:right;">
            ${txLink
              ? `<a href="${txLink}" style="color:#2cffc9;text-decoration:none;font-family:'Courier New',monospace;">${txMasked} &#8599;</a>`
              : `<code style="color:#8fa3b0;">${txMasked}</code>`}
          </td>
        </tr>
      </table>

      <p style="margin:20px 0 0;font-size:10px;color:#3a5060;text-align:center;">
        Payment made on-chain via USDC-SPL on Solana Mainnet.
        This email serves as your receipt. Keep it for your records.
      </p>
    </td></tr>

    <tr><td style="height:16px;"></td></tr>

    <!-- CTA -->
    <tr><td style="text-align:center;padding-bottom:24px;">
      <a href="${SITE_URL}/api-portal.html#my-dashboard"
         style="display:inline-block;background:linear-gradient(135deg,#2cffc9,#1db8a0);color:#051015;font-weight:800;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        View Dashboard &#8594;
      </a>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="border-top:1px solid rgba(255,255,255,.05);padding-top:20px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#3a5060;">Scan2Moon &mdash; Solana Analytics</p>
      <p style="margin:0;font-size:11px;color:#3a5060;">
        Questions? <a href="https://x.com/Scan2Moon" style="color:#5a7080;text-decoration:none;">@Scan2Moon on X</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Scan2Moon <noreply@scan2moon.com>", to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "Resend " + res.status };
    console.log("[email] Sent receipt to", to);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/* ----------------------------------------------------------------
   sendRevokeEmail({ to, keyId, plan, planLabel })
   Confirmation sent when user self-revokes a key.
   ---------------------------------------------------------------- */
async function sendRevokeEmail({ to, keyId, plan, planLabel }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return { ok: false, reason: "email not configured" };

  const label     = planLabel || PLAN_LABELS[plan] || plan;
  const subject   = "Your Scan2Moon API key has been revoked";
  const keyMasked = keyId.slice(0, 8) + "..." + keyId.slice(-4);
  const revokedAt = new Date().toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#060f15;font-family:'Courier New',Courier,monospace;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060f15;">
  <tr><td align="center" style="padding:32px 16px;">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
    <tr><td style="padding-bottom:24px;text-align:center;">
      <div style="display:inline-block;background:#0a161e;border:1px solid #ffffff22;border-radius:10px;padding:14px 24px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:3px;color:#5a7080;text-transform:uppercase;display:block;margin-bottom:4px;">SOLANA ANALYTICS</span>
        <span style="font-size:22px;font-weight:900;color:#e8f4f8;letter-spacing:2px;">SCAN2MOON</span>
      </div>
    </td></tr>
    <tr><td style="background:#0a161e;border:1px solid rgba(255,77,109,.25);border-radius:12px;padding:28px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#ff4d6d;letter-spacing:2px;text-transform:uppercase;">&#128274; Key Revoked</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#e8f4f8;">Your API key has been disabled</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#8fa3b0;">
        Key <code style="color:#2cffc9;background:#030d12;padding:2px 6px;border-radius:3px;">${keyMasked}</code>
        (${label} plan) was revoked on <strong style="color:#e8f4f8;">${revokedAt}</strong>.
        It will no longer accept API requests.
      </p>
      <p style="margin:0;font-size:12px;color:#5a7080;">
        If you did not request this, please contact us immediately on
        <a href="https://x.com/Scan2Moon" style="color:#2cffc9;text-decoration:none;">@Scan2Moon</a> — someone may have had access to your key.
        You can generate a new key at any time from the API portal.
      </p>
    </td></tr>
    <tr><td style="height:16px;"></td></tr>
    <tr><td style="text-align:center;padding-bottom:24px;">
      <a href="${SITE_URL}/api-portal.html#get-key"
         style="display:inline-block;background:linear-gradient(135deg,#2cffc9,#1db8a0);color:#051015;font-weight:800;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;">
        Get a New Key &#8594;
      </a>
    </td></tr>
    <tr><td style="border-top:1px solid rgba(255,255,255,.05);padding-top:20px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#3a5060;">Scan2Moon &mdash; <a href="https://x.com/Scan2Moon" style="color:#5a7080;text-decoration:none;">@Scan2Moon on X</a></p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Scan2Moon <noreply@scan2moon.com>", to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: "Resend " + res.status };
    console.log("[email] Sent revoke confirmation to", to);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { sendKeyEmail, sendRenewalReminderEmail, sendExpiryEmail, sendReceiptEmail, sendRevokeEmail };
