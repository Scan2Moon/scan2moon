/* ============================================================
   Scan2Moon -- Smart Money Leaderboard  (frontend module)

   Two modes:
   A) leaderboard.html  -- auto-mount, always visible
   B) whale-dna.html    -- lazy/toggle via window.smLbToggle()

   Toggle button:  id="smLbToggleBtn"
   Wrapper div:    id="dnaSmLbWrapper"
   Container div:  id="smLbContainer"
   ============================================================ */

const API = "/.netlify/functions/smartMoneyLeaderboard";

const ARCHETYPE_TABS = [
  { id: "all",          emoji: "",     label: "All"          },
  { id: "smart_money",  emoji: "\uD83E\uDDE0", label: "Smart Money"  },
  { id: "whale",        emoji: "\uD83D\uDC0B", label: "Whale"        },
  { id: "accumulator",  emoji: "\uD83D\uDFE2", label: "Accumulator"  },
  { id: "flipper",      emoji: "\uD83D\uDD04", label: "Flipper"      },
  { id: "sniper",       emoji: "\uD83C\uDFAF", label: "Sniper"       },
  { id: "degen",        emoji: "\uD83C\uDFB0", label: "Degen"        },
  { id: "bot",          emoji: "\uD83E\uDD16", label: "Bot"          },
  { id: "dev_wallet",   emoji: "\uD83D\uDEE0\uFE0F", label: "Dev Wallet"   },
  { id: "rug_deployer", emoji: "\uD83D\uDC80", label: "Rug Deployer" },
];

const SORT_OPTIONS = [
  { value: "copy_score",  label: "Copy Score"   },
  { value: "win_rate",    label: "Win Rate"     },
  { value: "total_value", label: "Total Value"  },
  { value: "scan_count",  label: "Most Scanned" },
];

let state       = { archetype: "all", sort: "copy_score", data: null, loading: false };
let initialised = false;
let isOpen      = false;

/* detect which mode we are in */
const isLazyMode = !!document.getElementById("dnaSmLbWrapper");

/* ------------------------------------------------------------------
   Public toggle -- called by whale-dna.html button onclick
------------------------------------------------------------------ */
window.smLbToggle = function () {
  const wrapper = document.getElementById("dnaSmLbWrapper");
  const btn     = document.getElementById("smLbToggleBtn");
  if (!wrapper) return;

  if (!initialised) {
    injectShell();
    initialised = true;
    wrapper.classList.add("open");
    isOpen = true;
    if (btn) btn.classList.add("active");
    load();
    return;
  }

  isOpen = !isOpen;
  wrapper.classList.toggle("open", isOpen);
  if (btn) btn.classList.toggle("active", isOpen);
};

/* ------------------------------------------------------------------
   Auto-mount on leaderboard.html (not lazy)
------------------------------------------------------------------ */
if (!isLazyMode) {
  injectShell();
  initialised = true;
  load();
}

/* ------------------------------------------------------------------
   Inject panel HTML into #smLbContainer
------------------------------------------------------------------ */
function injectShell() {
  const container = document.getElementById("smLbContainer");
  if (!container) return;

  const tabsHTML = ARCHETYPE_TABS.map(function(t) {
    var em = t.emoji ? t.emoji + "\u00a0" : "";
    var active = t.id === state.archetype ? " active" : "";
    return '<button class="sm-lb-tab' + active + '" data-archetype="' + t.id + '">'
      + em + t.label
      + ' <span class="sm-lb-tab-count" id="smCount_' + t.id + '">\u2013</span>'
      + '</button>';
  }).join("");

  const optsHTML = SORT_OPTIONS.map(function(o) {
    var sel = o.value === state.sort ? " selected" : "";
    return '<option value="' + o.value + '"' + sel + '>' + o.label + '</option>';
  }).join("");

  container.innerHTML =
    '<div class="panel sm-lb-panel">'
    + '<div class="panel-header sm-lb-header">'
    +   '<div>'
    +     '<div class="panel-title sm-lb-title">SMART MONEY BOARD</div>'
    +     '<div class="sm-lb-subtitle">Real wallets &middot; Real on-chain behavior &middot; Built from every Whale DNA scan</div>'
    +   '</div>'
    +   '<div class="sm-lb-sort-wrap">'
    +     '<label class="sm-lb-sort-label">Sort by</label>'
    +     '<select class="sm-lb-sort-select" id="smSortSelect">' + optsHTML + '</select>'
    +   '</div>'
    + '</div>'
    + '<div class="sm-lb-tabs" id="smTabs">' + tabsHTML + '</div>'
    + '<div class="panel-body sm-lb-body" id="smLbBody">' + spinnerHTML() + '</div>'
    + '</div>';

  document.getElementById("smSortSelect").addEventListener("change", function(e) {
    state.sort = e.target.value;
    load();
  });

  document.getElementById("smTabs").addEventListener("click", function(e) {
    var btn = e.target.closest("[data-archetype]");
    if (!btn) return;
    state.archetype = btn.dataset.archetype;
    document.querySelectorAll(".sm-lb-tab").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    load();
  });
}

/* ------------------------------------------------------------------
   Fetch + render
------------------------------------------------------------------ */
async function load() {
  if (state.loading) return;
  state.loading = true;
  var body = document.getElementById("smLbBody");
  if (body) body.innerHTML = spinnerHTML();

  try {
    var url = API + "?archetype=" + state.archetype + "&sort=" + state.sort + "&limit=50";
    var res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
    render();
  } catch (e) {
    var b2 = document.getElementById("smLbBody");
    if (b2) b2.innerHTML = '<div class="sm-lb-state sm-lb-error">Could not load: ' + e.message + '</div>';
  } finally {
    state.loading = false;
  }
}

/* ------------------------------------------------------------------
   Render table
------------------------------------------------------------------ */
function render() {
  var entries      = (state.data && state.data.entries)      || [];
  var distribution = (state.data && state.data.distribution) || {};

  ARCHETYPE_TABS.forEach(function(t) {
    var el = document.getElementById("smCount_" + t.id);
    if (el) el.textContent = ((distribution[t.id] || 0)).toLocaleString();
  });

  var countEl = document.getElementById("smLbBtnCount");
  if (countEl) {
    var total = distribution.all || 0;
    countEl.textContent = total > 0 ? " \u00b7 " + total.toLocaleString() + " wallets" : "";
  }

  var body = document.getElementById("smLbBody");
  if (!body) return;

  if (entries.length === 0) {
    body.innerHTML =
      '<div class="sm-lb-state">'
      + '<div class="sm-lb-empty-icon">\uD83D\uDD0D</div>'
      + '<div class="sm-lb-empty-title">No wallets scanned yet for this archetype</div>'
      + '<div class="sm-lb-empty-sub">Run a <a href="whale-dna.html">Whale DNA scan</a> to add the first wallet!</div>'
      + '</div>';
    return;
  }

  var rows = entries.map(rowHTML).join("");

  body.innerHTML =
    '<table class="sm-lb-table">'
    + '<thead><tr>'
    +   '<th class="sm-lb-th-rank">#</th>'
    +   '<th>Wallet</th>'
    +   '<th>Archetype</th>'
    +   '<th class="sm-lb-th-score">Copy Score</th>'
    +   '<th class="sm-lb-th-num">Win Rate</th>'
    +   '<th class="sm-lb-th-num sm-lb-hide-sm">Value</th>'
    +   '<th class="sm-lb-th-num sm-lb-hide-sm">Deploys</th>'
    +   '<th class="sm-lb-th-num sm-lb-hide-xs">Scans</th>'
    +   '<th></th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>'
    + '<div class="sm-lb-foot">'
    +   'Showing ' + entries.length + ' wallets &nbsp;&middot;&nbsp;'
    +   'Updated as users run Whale DNA scans &nbsp;&middot;&nbsp;'
    +   '<a href="whale-dna.html" class="sm-lb-foot-link">Scan a wallet &rarr;</a>'
    + '</div>';

  body.querySelectorAll("[data-scan-wallet]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var wallet = btn.dataset.scanWallet;
      try { localStorage.setItem("s2m_prefill_whale", wallet); } catch(ex) {}
      var input = document.getElementById("walletInput");
      if (input) {
        input.value = wallet;
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(function() {
          if (typeof startScan === "function") startScan();
        }, 200);
      } else {
        window.location.href = "whale-dna.html";
      }
    });
  });
}

/* ------------------------------------------------------------------
   Row template
------------------------------------------------------------------ */
function rowHTML(e) {
  var medals   = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
  var rankBadge = e.rank <= 3
    ? medals[e.rank - 1]
    : '<span class="sm-lb-rank-num">' + e.rank + '</span>';

  var winPct   = (e.winRate || 0).toFixed(0) + "%";
  var winClass = e.winRate >= 60 ? "sm-lb-green" : e.winRate >= 40 ? "sm-lb-yellow" : "sm-lb-red";
  var valStr   = fmtVal(e.totalValue);

  var deplStr;
  if (e.totalDeployed > 0) {
    var rugNote = e.rugRate > 0 ? ' <span class="sm-lb-rug-note">(' + e.rugRate.toFixed(0) + '% rug)</span>' : "";
    deplStr = e.totalDeployed + rugNote;
  } else {
    deplStr = "\u2014";
  }

  var tagStr = "";
  if (Array.isArray(e.tags) && e.tags.length > 0) {
    tagStr = '<div class="sm-lb-tags">'
      + e.tags.slice(0, 2).map(function(t) {
          return '<span class="sm-lb-tag">' + t + '</span>';
        }).join("")
      + '</div>';
  }

  return '<tr class="sm-lb-row">'
    + '<td class="sm-lb-td-rank">' + rankBadge + '</td>'
    + '<td class="sm-lb-td-wallet">'
    +   '<div class="sm-lb-wallet-wrap">'
    +     '<span class="sm-lb-wallet-addr" title="' + e.wallet + '">' + e.walletShort + '</span>'
    +     '<button class="sm-lb-copy-btn" data-copy="' + e.wallet + '" title="Copy address">\u29c9</button>'
    +   '</div>'
    +   tagStr
    + '</td>'
    + '<td class="sm-lb-td-arch">'
    +   '<span class="sm-lb-arch-badge" style="--arch-color:' + e.archetypeColor + '">'
    +     e.archetypeEmoji + ' ' + e.archetypeName
    +   '</span>'
    + '</td>'
    + '<td class="sm-lb-td-score">' + scoreBarHTML(e.copyScore) + '</td>'
    + '<td class="sm-lb-td-num ' + winClass + '">' + winPct + '</td>'
    + '<td class="sm-lb-td-num sm-lb-hide-sm">' + valStr + '</td>'
    + '<td class="sm-lb-td-num sm-lb-hide-sm">' + deplStr + '</td>'
    + '<td class="sm-lb-td-num sm-lb-hide-xs">' + (e.scanCount || 1) + '</td>'
    + '<td class="sm-lb-td-action">'
    +   '<button class="sm-lb-scan-btn" data-scan-wallet="' + e.wallet + '">Scan DNA</button>'
    + '</td>'
    + '</tr>';
}

/* ------------------------------------------------------------------
   Helpers
------------------------------------------------------------------ */
function scoreBarHTML(score) {
  var s     = Math.max(0, Math.min(100, score || 50));
  var color = s >= 70 ? "#2cffc9" : s >= 40 ? "#ffd700" : "#ff4d6d";
  return '<div class="sm-lb-score-wrap">'
    + '<div class="sm-lb-score-bar">'
    +   '<div class="sm-lb-score-fill" style="width:' + s + '%;background:' + color + '"></div>'
    + '</div>'
    + '<span class="sm-lb-score-num" style="color:' + color + '">' + s + '</span>'
    + '</div>';
}

function fmtVal(v) {
  if (!v || v === 0) return "\u2014";
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(1) + "M";
  if (v >= 1000)    return "$" + (v / 1000).toFixed(1) + "k";
  return "$" + v.toFixed(0);
}

function spinnerHTML() {
  return '<div class="sm-lb-loading-wrap">'
    + '<div class="sm-lb-spin-ring"></div>'
    + '<div class="sm-lb-spin-text">Scanning wallets\u2026</div>'
    + '</div>';
}

/* ------------------------------------------------------------------
   Copy-to-clipboard (delegated)
------------------------------------------------------------------ */
document.addEventListener("click", function(e) {
  var btn = e.target.closest("[data-copy]");
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy).then(function() {
    var orig = btn.textContent;
    btn.textContent = "\u2713";
    setTimeout(function() { btn.textContent = orig; }, 1500);
  }).catch(function() {});
});
