/* ================================================================
   Scan2Moon — i18n.js
   Internationalisation engine: English (EN) + Nederlands (NL)

   Usage anywhere in JS:
     import { t, getCurrentLang, setLang } from "./i18n.js";
     const html = `<div>${t("risk_scanner_title")}</div>`;

   Static HTML:  add  data-i18n="key"  to any element — the text
                 content is replaced automatically on page load
                 and on language switch.
   ================================================================ */

/* ── Translation dictionary ─────────────────────────────────── */
const DICT = {

  /* ── Navigation ── */
  nav_home:            { en: "HOME",        nl: "HOME" },
  nav_scanners:        { en: "SCANNERS",    nl: "SCANNERS" },
  nav_radars:          { en: "RADARS",      nl: "RADARS" },
  nav_insights:        { en: "INSIGHTS",    nl: "INZICHTEN" },

  nav_risk_scanner:    { en: "Risk Scanner",         nl: "Risico Scanner" },
  nav_risk_scanner_sub:{ en: "On-chain rug detection", nl: "On-chain rug detectie" },

  nav_portfolio:       { en: "Portfolio Scanner",    nl: "Portfolio Scanner" },
  nav_portfolio_sub:   { en: "Wallet risk analysis", nl: "Portemonnee risicoanalyse" },

  nav_whale_dna:       { en: "Whale DNA",                       nl: "Walvis DNA" },
  nav_whale_dna_sub:   { en: "Wallet behavior & copy-trade score", nl: "Portemonnee gedrag & kopieer-handel score" },

  nav_entry_radar:     { en: "Entry Radar",         nl: "Instap Radar" },
  nav_entry_radar_sub: { en: "Early token detection", nl: "Vroege token detectie" },

  nav_watchlist:       { en: "Token Watchlist",     nl: "Token Volglijst" },
  nav_watchlist_sub:   { en: "Your saved tokens",   nl: "Jouw opgeslagen tokens" },

  nav_safe_ape:        { en: "Safe Ape Simulator",               nl: "Safe Ape Simulator" },
  nav_safe_ape_sub:    { en: "Paper trading with risk intelligence", nl: "Papierhandel met risico-intelligentie" },

  nav_leaderboard:     { en: "Leaderboard",          nl: "Scorebord" },
  nav_leaderboard_sub: { en: "Top Safe Ape traders", nl: "Top Safe Ape handelaars" },

  nav_about:           { en: "About Scan2Moon",      nl: "Over Scan2Moon" },
  nav_about_sub:       { en: "Project, mission & roadmap", nl: "Project, missie & routekaart" },

  /* ── Learn2Moon navigation ── */
  nav_learn2moon:           { en: "Learn2Moon",         nl: "Learn2Moon" },
  nav_learn_dashboard:      { en: "Dashboard",          nl: "Dashboard" },
  nav_learn_dashboard_sub:  { en: "Your learning overview & progress", nl: "Jouw leeroverzicht & voortgang" },
  nav_learn_guides:         { en: "Guides",             nl: "Gidsen" },
  nav_learn_guides_sub:     { en: "Step-by-step scanner guides", nl: "Stap-voor-stap scanner gidsen" },
  nav_learn_tasks:          { en: "Tasks",              nl: "Taken" },
  nav_learn_tasks_sub:      { en: "Daily challenges & missions",  nl: "Dagelijkse uitdagingen & missies" },
  nav_learn_academy:        { en: "Academy",            nl: "Academie" },
  nav_learn_academy_sub:    { en: "Full crypto education courses", nl: "Volledige crypto educatiecursussen" },

  /* ── Risk Scanner page ── */
  risk_scanner_title:  { en: "RISK SCANNER",         nl: "RISICO SCANNER" },
  risk_scanner_sub:    { en: "On-chain Solana token analysis • Rug detection • Real-time scoring",
                         nl: "On-chain Solana token analyse • Rug detectie • Real-time scoring" },
  scan_btn:            { en: "Scan Token",            nl: "Scan Token" },
  scan_placeholder:    { en: "Paste token mint address…", nl: "Plak token mint adres…" },
  final_score_label:   { en: "FINAL SCORE",           nl: "EINDSCORE" },
  btn_copy:            { en: "Copy",                  nl: "Kopieer" },
  btn_save:            { en: "Save",                  nl: "Opslaan" },
  btn_post:            { en: "Post",                  nl: "Delen" },
  add_watchlist:       { en: "☆ Add to Watchlist",   nl: "☆ Toevoegen aan Volglijst" },
  saved_watchlist:     { en: "⭐ Saved to Watchlist", nl: "⭐ Opgeslagen in Volglijst" },
  scan_time_label:     { en: "Scan Time",             nl: "Scan Tijd" },
  explain_risk:        { en: "Explain Risk",          nl: "Risico Uitleg" },
  liquidity_label:     { en: "Liquidity",             nl: "Liquiditeit" },
  top10_label:         { en: "Top 10 Holders",        nl: "Top 10 Houders" },
  market_cap_label:    { en: "Market Cap",            nl: "Marktkapitalisatie" },
  net_buy_label:       { en: "Net Buy Pressure (24H)", nl: "Netto Koopdruk (24U)" },
  verified_footer:     { en: "VERIFIED • SCAN2MOON • scan2moon.com",
                         nl: "GEVERIFIEERD • SCAN2MOON • scan2moon.com" },

  /* ── Risk level labels ── */
  risk_moon:           { en: "🌕 MOON COIN",       nl: "🌕 MAAN MUNT" },
  risk_low:            { en: "LOW RUG RISK",        nl: "LAAG RUG RISICO" },
  risk_moderate:       { en: "MODERATE RISK",       nl: "MATIG RISICO" },
  risk_high:           { en: "HIGH RUG RISK",       nl: "HOOG RUG RISICO" },
  risk_extreme:        { en: "EXTREME RISK 🚨",     nl: "EXTREEM RISICO 🚨" },

  /* ── Risk explanations ── */
  explain_moon:        { en: "🌕 Strong on-chain health. Low rug risk, clean liquidity and healthy holder distribution.",
                         nl: "🌕 Sterke on-chain gezondheid. Laag rug risico, schone liquiditeit en gezonde houdersverdeling." },
  explain_low:         { en: "Healthy structure. No critical sell pressure or liquidity abuse detected.",
                         nl: "Gezonde structuur. Geen kritische verkoopdruk of liquiditeitsmisbruik gedetecteerd." },
  explain_moderate:    { en: "Mixed signals. Possible liquidity weakness or elevated sell pressure.",
                         nl: "Gemengde signalen. Mogelijke liquiditeitszwakte of verhoogde verkoopdruk." },
  explain_high:        { en: "High-risk behavior detected. Strong rug indicators present.",
                         nl: "Hoog-risico gedrag gedetecteerd. Sterke rug indicatoren aanwezig." },

  /* ── Scan Signals panel ── */
  signals_panel:       { en: "SCAN SIGNALS",               nl: "SCAN SIGNALEN" },
  sig_age_trust:       { en: "Token Age Trust",            nl: "Token Leeftijd Vertrouwen" },
  sig_integrity:       { en: "Market Integrity",           nl: "Markt Integriteit" },
  sig_pump_danger:     { en: "Pump Danger",                nl: "Pomp Gevaar" },
  sig_lp_strength:     { en: "LP Strength",                nl: "LP Sterkte" },
  sig_mc_liq:          { en: "MC / Liquidity Ratio",       nl: "MC / Liquiditeit Verhouding" },
  sig_sell_pressure:   { en: "Sell Pressure (1h)",         nl: "Verkoopdruk (1u)" },
  sig_dev_behavior:    { en: "Dev Behavior",               nl: "Ontwikkelaar Gedrag" },
  sig_bundle:          { en: "Bundle Attack Safety",       nl: "Bundle Aanval Veiligheid" },
  sig_pump_launch:     { en: "Pump.fun Launch Risk",       nl: "Pump.fun Launch Risico" },
  sig_lp_stability:    { en: "LP Stability",               nl: "LP Stabiliteit" },
  sig_vol_consistency: { en: "Volume Consistency",         nl: "Volume Consistentie" },
  sig_vol_mcap:        { en: "Vol / MCap Ratio",           nl: "Vol / MCap Verhouding" },

  /* ── Final Score card ── */
  calculated_from:     { en: "Calculated from on-chain and market behavior",
                         nl: "Berekend op basis van on-chain en marktgedrag" },
  add_to_watchlist:    { en: "☆ Add to Watchlist",      nl: "☆ Voeg toe aan Watchlist" },
  saved_to_watchlist:  { en: "⭐ Saved to Watchlist",   nl: "⭐ Opgeslagen in Watchlist" },

  /* ── Bundle panel ── */
  bundle_panel_title:      { en: "📦 BUNDLE ATTACK DETECTOR",  nl: "📦 BUNDLE AANVAL DETECTOR" },
  bundle_scanning:         { en: "Scanning launch blocks for bundle activity…",
                             nl: "Lanceerblokken scannen op bundle activiteit…" },
  bundle_error:            { en: "Bundle analysis unavailable",  nl: "Bundle analyse niet beschikbaar" },
  bundle_safety_score:     { en: "BUNDLE SAFETY SCORE",          nl: "BUNDLE VEILIGHEIDS SCORE" },
  bundle_no_bundle:        { en: "No Bundle Detected",           nl: "Geen Bundle Gedetecteerd" },
  bundle_suspicious:       { en: "Suspicious Activity",          nl: "Verdachte Activiteit" },
  bundle_bundled:          { en: "Bundle Detected",              nl: "Bundle Gedetecteerd" },
  bundle_extreme:          { en: "Extreme Bundle",               nl: "Extreme Bundle" },
  bundle_no_data:          { en: "No Data",                      nl: "Geen Data" },
  bundle_pump_token:       { en: "Pump.fun Token",               nl: "Pump.fun Token" },
  bundle_explain_clean:    { en: "Launch block activity looks normal. No signs of coordinated wallet bundling detected.",
                             nl: "Lanceerblok activiteit ziet er normaal uit. Geen tekenen van gecoördineerde wallet bundeling gedetecteerd." },
  bundle_explain_sus:      { en: "Some wallets show similar timing or funding — worth watching but not conclusive.",
                             nl: "Sommige wallets tonen vergelijkbare timing of financiering — de moeite waard om te volgen maar niet conclusief." },
  bundle_explain_bundled:  { en: "Multiple wallets bought in the first blocks with signs of coordination. Classic bundle pattern.",
                             nl: "Meerdere wallets kochten in de eerste blokken met tekenen van coördinatie. Klassiek bundle patroon." },
  bundle_explain_extreme:  { en: "Heavy coordinated buying in launch blocks. High probability of a single entity controlling early supply.",
                             nl: "Zware gecoördineerde aankopen in lanceerblokken. Hoge kans dat één entiteit de vroege voorraad controleert." },
  bundle_explain_nodata:   { en: "Not enough transaction history to perform bundle analysis.",
                             nl: "Niet genoeg transactiegeschiedenis voor bundle analyse." },
  bundle_explain_pump:     { en: "Pump.fun origin: This token launched on pump.fun. Early buys went through the bonding curve — so the score above reflects post-graduation activity only.",
                             nl: "Pump.fun herkomst: Dit token lanceerde op pump.fun. Vroege aankopen gingen via de bonding curve — de score weerspiegelt alleen activiteit na graduatie." },
  bundle_supply_pct:       { en: "SUPPLY BOUGHT IN FIRST 5 BLOCKS", nl: "VOORRAAD GEKOCHT IN EERSTE 5 BLOKKEN" },
  bundle_early_wallets:    { en: "EARLY WALLETS DETECTED",          nl: "VROEGE WALLETS GEDETECTEERD" },
  bundle_common_funder:    { en: "COMMON FUNDER DETECTED",          nl: "GEMEENSCHAPPELIJKE FUNDER GEDETECTEERD" },
  bundle_controllers:      { en: "ESTIMATED REAL CONTROLLERS",      nl: "GESCHATTE ECHTE CONTROLLERS" },
  bundle_earliest_buyers:  { en: "⏱️ EARLIEST BUYERS DETECTED",    nl: "⏱️ VROEGSTE KOPERS GEDETECTEERD" },
  bundle_analyzed:         { en: "Analyzed first 5 launch blocks on Solana", nl: "Eerste 5 lanceerblokken geanalyseerd op Solana" },
  bundle_wallet_examined:  { en: "wallet examined",                 nl: "wallet onderzocht" },
  bundle_wallets_examined: { en: "wallets examined",                nl: "wallets onderzocht" },
  bundle_funder_alert:     { en: "share the same SOL funding source — a classic multi-wallet bundle pattern.",
                             nl: "hebben dezelfde SOL financieringsbron — een klassiek multi-wallet bundle patroon." },
  bundle_pump_footer:      { en: "Check the Scan Signals panel for Pump.fun Launch Risk score",
                             nl: "Controleer het Scan Signalen paneel voor de Pump.fun Launch Risico score" },

  /* ── Token Market Stats ── */
  market_stats_title:  { en: "Token Market Stats",         nl: "Token Markt Statistieken" },
  price_usd:           { en: "PRICE IN USD",               nl: "PRIJS IN USD" },
  price_sol:           { en: "PRICE IN SOL",               nl: "PRIJS IN SOL" },
  volume_24h:          { en: "24H VOLUME",                 nl: "24U VOLUME" },
  pair_created:        { en: "PAIR CREATED",               nl: "PAAR AANGEMAAKT" },
  buys_sells_1h:       { en: "BUYS / SELLS (1H)",          nl: "KOPEN / VERKOPEN (1U)" },
  buys_sells_24h:      { en: "BUYS / SELLS (24H)",         nl: "KOPEN / VERKOPEN (24U)" },

  /* ── Entry Radar ── */
  entry_radar_title:   { en: "📡 ENTRY RADAR",             nl: "📡 INSTAP RADAR" },
  entry_radar_sub:     { en: "Live early-stage token detection • Safety-filtered • Auto-refresh",
                         nl: "Live vroege token detectie • Veiligheidsfilter • Auto-vernieuwen" },
  newest_safe:         { en: "🚀 NEWEST SAFE TOKENS",      nl: "🚀 NIEUWSTE VEILIGE TOKENS" },
  high_risk_filtered:  { en: "High Risk tokens filtered out • Showing top 15",
                         nl: "Hoog Risico tokens gefilterd • Top 15 weergegeven" },
  entry_open:          { en: "OPEN 🟢",                    nl: "OPEN 🟢" },
  entry_caution:       { en: "CAUTION 🟡",                 nl: "VOORZICHTIG 🟡" },
  btn_refresh:         { en: "↻ Refresh",                  nl: "↻ Vernieuwen" },

  /* ── Portfolio Scanner ── */
  portfolio_title:     { en: "💼 PORTFOLIO SCANNER",       nl: "💼 PORTFOLIO SCANNER" },
  portfolio_sub:       { en: "Paste any Solana wallet to analyse your holdings",
                         nl: "Plak een Solana portemonnee om uw holdings te analyseren" },

  /* ── Whale DNA ── */
  whale_dna_title:     { en: "🧬 WHALE DNA",               nl: "🧬 WALVIS DNA" },
  whale_dna_sub:       { en: "Analyse wallet trading behavior & copy-trade risk",
                         nl: "Analyseer portemonnee handelsgedrag & kopieer-handel risico" },

  /* ── Safe Ape ── */
  safe_ape_title:      { en: "🦍 SAFE APE SIMULATOR",      nl: "🦍 SAFE APE SIMULATOR" },

  /* ── Watchlist ── */
  watchlist_title:     { en: "⭐ TOKEN WATCHLIST",          nl: "⭐ TOKEN VOLGLIJST" },
  watchlist_empty:     { en: "No tokens saved yet. Scan a token and add it to your watchlist!",
                         nl: "Nog geen tokens opgeslagen. Scan een token en voeg het toe aan je volglijst!" },

  /* ── Risk Scanner panels ── */
  awaiting_scan:       { en: "Awaiting Scan",           nl: "Scan Afwachten" },
  scan_waiting_sub:    { en: "Paste a token address above to begin", nl: "Plak een token adres hierboven om te beginnen" },
  main_analysis_title: { en: "MAIN ANALYSIS",           nl: "HOOFD ANALYSE" },
  live_market_cap:     { en: "📈 LIVE MARKET CAP",      nl: "📈 LIVE MARKTKAPITALISATIE" },
  top_holders_panel:   { en: "TOP HOLDERS",             nl: "TOP HOUDERS" },
  dev_history_panel:   { en: "🕵️ DEV HISTORY",         nl: "🕵️ ONTWIKKELAAR GESCHIEDENIS" },
  token_links_panel:   { en: "🔗 TOKEN LINKS",          nl: "🔗 TOKEN LINKS" },
  bundle_waiting_sub:  { en: "Detects coordinated wallet bundling at token launch",
                         nl: "Detecteert gecoördineerde wallet bundeling bij token lancering" },
  community_panel:     { en: "Scan2Moon Community",     nl: "Scan2Moon Community" },

  /* ── Entry Radar panels & legend ── */
  radar_legend_open:    { en: "OPEN – Safe to enter",   nl: "OPEN – Veilig om in te stappen" },
  radar_legend_caution: { en: "CAUTION – Enter carefully", nl: "VOORZICHTIG – Voorzichtig instappen" },
  radar_newest_safe:    { en: "🚀 NEWEST SAFE TOKENS",  nl: "🚀 NIEUWSTE VEILIGE TOKENS" },
  radar_high_risk_filtered: { en: "High Risk tokens filtered out • Showing top 15",
                              nl: "Hoog Risico tokens gefilterd • Top 15 weergegeven" },
  radar_whale_title:    { en: "🐋 RECENT WHALE BUYS",   nl: "🐋 RECENTE WALVIS AANKOPEN" },
  radar_whale_sub:      { en: "Live buys > $1,000 across radar tokens • Click wallet to run Whale DNA",
                          nl: "Live aankopen > $1.000 bij radar tokens • Klik op portemonnee voor Walvis DNA" },

  /* ── Entry Radar modal panels ── */
  modal_market_snapshot:{ en: "📊 Market Snapshot",     nl: "📊 Markt Momentopname" },
  modal_momentum:       { en: "🔥 Momentum Signals",    nl: "🔥 Momentum Signalen" },
  modal_risk_filter:    { en: "🛡️ Risk Filter",         nl: "🛡️ Risico Filter" },
  modal_growth:         { en: "📊 Early Growth Tracker", nl: "📊 Vroege Groei Tracker" },
  modal_dev_history:    { en: "🕵️ Dev History",         nl: "🕵️ Ontwikkelaar Geschiedenis" },
  modal_wallet_cluster: { en: "🔗 Wallet Cluster Detected", nl: "🔗 Wallet Cluster Gedetecteerd" },
  modal_top_holders:    { en: "🏆 Top 10 Holders",      nl: "🏆 Top 10 Houders" },
  modal_whale:          { en: "🐋 Whale & Smart Wallet Activity", nl: "🐋 Walvis & Slim Wallet Activiteit" },
  modal_safe_entry:     { en: "🎯 Max Safe Entry Calculator", nl: "🎯 Max Veilige Instap Calculator" },

  /* ── Portfolio Scanner ── */
  portfolio_placeholder:{ en: "Paste Solana wallet address…", nl: "Plak Solana portemonnee adres…" },
  portfolio_scan_btn:   { en: "Scan Wallet",            nl: "Scan Portemonnee" },
  portfolio_overview:   { en: "📊 PORTFOLIO OVERVIEW",  nl: "📊 PORTFOLIO OVERZICHT" },
  portfolio_holdings:   { en: "🪙 TOKEN HOLDINGS",      nl: "🪙 TOKEN BEZITTINGEN" },

  /* ── Whale DNA ── */
  whale_placeholder:    { en: "Paste any Solana wallet address to reveal their Whale DNA…",
                          nl: "Plak een Solana portemonnee adres om hun Walvis DNA te onthullen…" },
  whale_dna_profile:    { en: "🧬 WALLET DNA PROFILE",  nl: "🧬 PORTEMONNEE DNA PROFIEL" },
  whale_perf_stats:     { en: "📊 PERFORMANCE STATS",   nl: "📊 PRESTATIE STATISTIEKEN" },
  whale_copy_score:     { en: "🎯 COPY-TRADE RISK SCORE", nl: "🎯 KOPIEER-HANDEL RISICO SCORE" },
  whale_holdings:       { en: "🐋 CURRENT WHALE HOLDINGS", nl: "🐋 HUIDIGE WALVIS BEZITTINGEN" },

  /* ── Safe Ape ── */
  sa_token_placeholder: { en: "Paste token mint address to start trading…", nl: "Plak token mint adres om te beginnen met handelen…" },
  sa_analyse_btn:       { en: "🔍 Analyse Token",       nl: "🔍 Token Analyseren" },
  sa_disconnect:        { en: "Disconnect",              nl: "Verbreken" },
  sa_risk_score:        { en: "🛡️ SCAN2MOON RISK SCORE", nl: "🛡️ SCAN2MOON RISICO SCORE" },
  sa_market_signals:    { en: "📊 MARKET SIGNALS",      nl: "📊 MARKT SIGNALEN" },
  sa_trade_panel:       { en: "⚡ TRADE",               nl: "⚡ HANDEL" },
  sa_buy_tab:           { en: "BUY",                    nl: "KOPEN" },
  sa_sell_tab:          { en: "SELL",                   nl: "VERKOPEN" },
  sa_buy_btn:           { en: "🦍 APE IN (BUY)",        nl: "🦍 APE IN (KOPEN)" },
  sa_sell_btn:          { en: "🔴 EXIT POSITION (SELL)", nl: "🔴 POSITIE VERLATEN (VERKOPEN)" },
  sa_top_holders:       { en: "🏆 TOP HOLDERS",         nl: "🏆 TOP HOUDERS" },
  sa_holdings:          { en: "💼 YOUR HOLDINGS",       nl: "💼 JOUW BEZITTINGEN" },
  sa_recent_trades:     { en: "📋 RECENT TRADES",       nl: "📋 RECENTE HANDEL" },

  /* ── Watchlist ── */
  watchlist_sub:        { en: "Your saved tokens • Re-scan anytime • Track your picks",
                          nl: "Jouw opgeslagen tokens • Opnieuw scannen • Volg jouw keuzes" },
  wl_saved_tokens:      { en: "⭐ SAVED TOKENS",        nl: "⭐ OPGESLAGEN TOKENS" },
  wl_clear_all:         { en: "🗑️ Clear All",           nl: "🗑️ Alles Wissen" },

  /* ── Safe Ape header ── */
  safe_ape_title_short: { en: "SAFE APE SIMULATOR",     nl: "SAFE APE SIMULATOR" },
  safe_ape_sub:         { en: "Paper trading with real Scan2Moon risk intelligence",
                          nl: "Papierhandel met echte Scan2Moon risico-intelligentie" },

  /* ── About page ── */
  ab_hero_badge:        { en: "Built on Solana",        nl: "Gebouwd op Solana" },
  ab_hero_title:        { en: "Scan Smarter. Trade Safer.", nl: "Scan Slimmer. Handel Veiliger." },
  ab_hero_sub:          { en: "Scan2Moon is a professional on-chain intelligence platform for the Solana ecosystem. We give every trader — from first-timers to seasoned degens — the tools to read the chain honestly, enter positions wisely, and build real discipline in the most volatile market on earth.",
                          nl: "Scan2Moon is een professioneel on-chain intelligentieplatform voor het Solana-ecosysteem. Wij geven elke handelaar — van beginners tot ervaren degens — de tools om de blockchain eerlijk te lezen, posities wijs in te nemen en echte discipline op te bouwen in de meest volatiele markt ter wereld." },
  ab_cta_scanner:       { en: "🛡️ Try Risk Scanner",   nl: "🛡️ Probeer Risico Scanner" },
  ab_cta_ape:           { en: "🦍 Safe Ape Simulator",  nl: "🦍 Safe Ape Simulator" },
  ab_stat_tools:        { en: "Tools",                  nl: "Tools" },
  ab_stat_signals:      { en: "On-chain signals",       nl: "On-chain signalen" },
  ab_stat_version:      { en: "Latest version",         nl: "Nieuwste versie" },
  ab_what_title:        { en: "🔭 WHAT IS SCAN2MOON?",  nl: "🔭 WAT IS SCAN2MOON?" },
  ab_platform_title:    { en: "🛠️ THE PLATFORM",        nl: "🛠️ HET PLATFORM" },
  ab_platform_sub:      { en: "Seven integrated tools. One mission.",
                          nl: "Zeven geïntegreerde tools. Één missie." },
  ab_mission_title:     { en: "Our Mission",            nl: "Onze Missie" },
  ab_milestones_title:  { en: "🗺️ MILESTONES",          nl: "🗺️ MIJLPALEN" },
  ab_milestones_sub:    { en: "Where we've been. Where we're going.",
                          nl: "Waar we vandaan komen. Waar we naartoe gaan." },

  /* ── Leaderboard page ── */
  lb_title:             { en: "🏆 SAFE APE LEADERBOARD", nl: "🏆 SAFE APE SCOREBORD" },
  lb_subtitle:          { en: "Risk-adjusted rankings • Real discipline rewarded • Not just lucky degens",
                          nl: "Risico-gecorrigeerde ranglijsten • Echte discipline beloond • Niet alleen geluksvogels" },
  lb_mvp_today:         { en: "👑 MVP TODAY",            nl: "👑 MVP VANDAAG" },
  lb_mvp_week:          { en: "🔥 MVP THIS WEEK",        nl: "🔥 MVP DEZE WEEK" },
  lb_mvp_month:         { en: "🦍 MVP THIS MONTH",       nl: "🦍 MVP DEZE MAAND" },
  lb_mvp_alltime:       { en: "🐐 ALL TIME MVP",         nl: "🐐 ALL TIME MVP" },
  lb_your_rank:         { en: "YOUR RANK",               nl: "JOUW RANG" },
  lb_share_rank:        { en: "🐦 Share on X",           nl: "🐦 Delen op X" },
  lb_submit_score:      { en: "⬆️ Submit Score",         nl: "⬆️ Score Indienen" },
  lb_connect_msg:       { en: "🔗 Connect Phantom wallet to see your rank and submit your score",
                          nl: "🔗 Verbind Phantom portemonnee om je rang te zien en score in te dienen" },
  lb_connect_btn:       { en: "Connect Wallet",          nl: "Portemonnee Verbinden" },
  lb_tab_alltime:       { en: "🏆 All Time",             nl: "🏆 Altijd" },
  lb_tab_monthly:       { en: "📅 Monthly",              nl: "📅 Maandelijks" },
  lb_tab_weekly:        { en: "📆 Weekly",               nl: "📆 Wekelijks" },
  lb_tab_daily:         { en: "⚡ Daily",                nl: "⚡ Dagelijks" },
  lb_rankings_title:    { en: "📊 FULL RANKINGS",        nl: "📊 VOLLEDIGE RANGLIJST" },
  lb_footer_disclaimer: { en: "Simulated trading only. Not financial advice. Always DYOR.",
                          nl: "Alleen gesimuleerde handel. Geen financieel advies. Doe altijd je eigen onderzoek." },

  /* ── About page – mission pillars ── */
  ab_pillar_transparency:      { en: "Transparency",       nl: "Transparantie" },
  ab_pillar_transparency_text: { en: "Every score is explained. Every signal is sourced from on-chain data. No black boxes.",
                                  nl: "Elk score wordt uitgelegd. Elk signaal is afkomstig van on-chain data. Geen zwarte dozen." },
  ab_pillar_education:         { en: "Education First",    nl: "Educatie Eerst" },
  ab_pillar_education_text:    { en: "We don't just score tokens. We teach you what the signals mean and why they matter.",
                                  nl: "We scoren niet alleen tokens. We leren je wat de signalen betekenen en waarom ze belangrijk zijn." },
  ab_pillar_bias:              { en: "Zero Bias",          nl: "Nul Bias" },
  ab_pillar_bias_text:         { en: "No sponsored listings. No paid promotions. No partnerships that influence scores.",
                                  nl: "Geen gesponsorde vermeldingen. Geen betaalde promoties. Geen partnerschappen die scores beïnvloeden." },
  ab_pillar_access:            { en: "Open Access",        nl: "Open Toegang" },
  ab_pillar_access_text:       { en: "Core tools are free. Always. Scan2Moon grows with its community, not against it.",
                                  nl: "Kerntools zijn gratis. Altijd. Scan2Moon groeit met zijn community, niet ertegen." },

  /* ── About page – mission body ── */
  ab_mission_p1: { en: "The Solana ecosystem deserves better tooling. Not tools that profit from your confusion, not data behind a paywall, and not scores inflated to make mediocre tokens look safe. Scan2Moon is built to be honest — with the data, with the risk, and with you.",
                   nl: "Het Solana-ecosysteem verdient betere tools. Geen tools die profiteren van je verwarring, geen data achter een betaalmuur, en geen scores die opgeblazen zijn om middelmatige tokens er veilig uit te laten zien. Scan2Moon is gebouwd om eerlijk te zijn — met de data, met het risico, en met jou." },
  ab_mission_p2: { en: "We believe that retail traders who take the time to understand on-chain signals can consistently outperform those who don't. Our job is to make those signals accessible, understandable, and actionable — for free, for everyone, forever.",
                   nl: "Wij geloven dat retailhandelaren die de tijd nemen om on-chain signalen te begrijpen consequent beter kunnen presteren dan degenen die dat niet doen. Onze taak is om die signalen toegankelijk, begrijpelijk en uitvoerbaar te maken — gratis, voor iedereen, altijd." },

  /* ── About page – tool cards ── */
  ab_tool_risk_name:      { en: "Risk Scanner",         nl: "Risico Scanner" },
  ab_tool_risk_desc:      { en: "The core. Paste any Solana token mint address and receive a comprehensive on-chain risk breakdown in seconds — liquidity, LP lock status, holder concentration, developer history, and a composite 0–100 Risk Score.",
                            nl: "De kern. Plak een Solana token mintadres en ontvang binnen seconden een uitgebreide on-chain risicosamenvatting — liquiditeit, LP-lockstatus, houderconcentratie, ontwikkelaarsgeschiedenis en een samengestelde 0–100 Risicoscore." },
  ab_tool_portfolio_name: { en: "Portfolio Scanner",    nl: "Portfolio Scanner" },
  ab_tool_portfolio_desc: { en: "Scan an entire wallet at once. Every token holding scored, flagged, and categorised — giving you an instant picture of total portfolio risk exposure without opening a single chart.",
                            nl: "Scan een hele portemonnee tegelijk. Elke tokenpositie gescoord, gemarkeerd en gecategoriseerd — een direct beeld van de totale portfoliorisicobelichting zonder een enkele grafiek te openen." },
  ab_tool_whale_name:     { en: "Whale DNA",            nl: "Walvis DNA" },
  ab_tool_whale_desc:     { en: "Analyse any Solana wallet's on-chain behaviour: win rate, average hold time, token risk appetite, and a Copy-Trade Score that tells you whether this wallet is worth following — or avoiding.",
                            nl: "Analyseer het on-chain gedrag van een Solana-portemonnee: winstpercentage, gemiddelde houdtijd, risicotolerantie voor tokens en een Kopieer-Handel Score die aangeeft of deze portemonnee het volgen waard is — of juist niet." },
  ab_tool_entry_name:     { en: "Entry Radar",          nl: "Instap Radar" },
  ab_tool_entry_desc:     { en: "Real-time detection of newly listed Solana tokens that pass our safety filters. Momentum scoring, whale activity heatmap, safe entry price calculations, and auto-filtering of obvious traps.",
                            nl: "Real-time detectie van nieuw genoteerde Solana-tokens die onze veiligheidsfilters passeren. Momentumscore, walvisactiviteitheatmap, veilige instapprijsberekeningen en automatisch filteren van duidelijke valstrikken." },
  ab_tool_ape_name:       { en: "Safe Ape Simulator",   nl: "Safe Ape Simulator" },
  ab_tool_ape_desc:       { en: "Paper-trade Solana tokens with live prices, real-time candle charts, and a full risk-intelligence layer on every position. Start with $10,000 Sol2Moon and build your track record without risking real capital.",
                            nl: "Paper-trade Solana-tokens met live prijzen, realtime kandelaargrafieken en een volledige risico-intelligentielaag op elke positie. Begin met $10.000 Sol2Moon en bouw je reputatie op zonder echt kapitaal te riskeren." },
  ab_tool_lb_name:        { en: "Leaderboard",          nl: "Scorebord" },
  ab_tool_lb_desc:        { en: "The first leaderboard that ranks traders by risk-adjusted return — not raw P/L. It's not enough to get lucky once. Consistent, disciplined performance rises to the top. Compete globally, earn badges, and prove you can trade well.",
                            nl: "Het eerste scorebord dat handelaren rangschikt op risicogecorrigeerd rendement — niet op ruw P/V. Eén keer geluk hebben is niet genoeg. Consistent, gedisciplineerde prestaties stijgen naar de top. Concurreer wereldwijd, verdien badges en bewijs dat je goed kunt handelen." },
  ab_tool_wl_name:        { en: "Token Watchlist",      nl: "Token Volglijst" },
  ab_tool_wl_desc:        { en: "Save tokens you're monitoring across sessions. Re-scan any saved token with one click, track your watchlist over time, and jump straight to the Safe Ape Simulator to paper-trade anything you're watching.",
                            nl: "Sla tokens op die je over sessies heen volgt. Scan elk opgeslagen token opnieuw met één klik, volg je volglijst in de loop van de tijd en ga direct naar de Safe Ape Simulator om te paper-traden wat je in de gaten houdt." },
  ab_open_scanner:        { en: "Open Scanner →",       nl: "Open Scanner →" },
  ab_open_whale:          { en: "Open Whale DNA →",     nl: "Open Walvis DNA →" },
  ab_open_radar:          { en: "Open Radar →",         nl: "Open Radar →" },
  ab_open_simulator:      { en: "Open Simulator →",     nl: "Open Simulator →" },
  ab_open_lb:             { en: "Open Leaderboard →",   nl: "Open Scorebord →" },
  ab_open_wl:             { en: "Open Watchlist →",     nl: "Open Volglijst →" },

  /* ── About page – timeline ── */
  ab_tag_done:            { en: "Completed · 2026",     nl: "Voltooid · 2026" },
  ab_tag_active:          { en: "In Development",       nl: "In Ontwikkeling" },
  ab_tag_future:          { en: "Future",               nl: "Toekomst" },
  ab_timeline_v10_title:  { en: "V1.0 — Foundation Launch",  nl: "V1.0 — Fundament Launch" },
  ab_timeline_v20_title:  { en: "V2.0 — Full Platform",      nl: "V2.0 — Volledig Platform" },
  ab_timeline_v21_title:  { en: "V2.1 — Refinement & Community", nl: "V2.1 — Verfijning & Community" },
  ab_timeline_v25_title:  { en: "V2.5 — Learn2Moon Academy", nl: "V2.5 — Learn2Moon Academy" },
  ab_timeline_mobile_title:{ en: "Mobile App — Scan2Moon on iOS & Android", nl: "Mobiele App — Scan2Moon op iOS & Android" },
  ab_timeline_v30_title:  { en: "V3.0 — Intelligence Layer", nl: "V3.0 — Intelligentielaag" },
  ab_timeline_v420_title: { en: "V.420 — Surprise from the Moon", nl: "V.420 — Verrassing van de Maan" },

  /* ── Entry Radar – table & dynamic content ── */
  er_col_token:       { en: "Token",          nl: "Token" },
  er_col_age:         { en: "Age",            nl: "Leeftijd" },
  er_col_mktcap:      { en: "Mkt Cap",        nl: "Mkt Kap" },
  er_col_liquidity:   { en: "Liquidity",      nl: "Liquiditeit" },
  er_col_holders:     { en: "Holders",        nl: "Houders" },
  er_col_mom:         { en: "Mom.",           nl: "Mom." },
  er_col_risk:        { en: "Risk ⚡",         nl: "Risico ⚡" },
  er_col_entry:       { en: "Entry",          nl: "Instap" },
  er_col_move:        { en: "Potential",      nl: "Potentieel" },
  er_col_move_tip:    { en: "Estimated move potential based on MC / Liquidity ratio", nl: "Geschat bewegingspotentieel op basis van MC / Liquiditeitsverhouding" },
  er_col_chk:         { en: "Checks",         nl: "Checks" },
  er_col_chk_tip:     { en: "Quick trade checklist — click for full details", nl: "Snelle handels-checklist — klik voor volledige details" },
  er_col_max_entry:   { en: "Max Entry",      nl: "Max Instap" },
  er_col_trade:       { en: "Trade",          nl: "Handel" },
  er_prev_page:       { en: "← Previous 10", nl: "← Vorige 10" },
  er_next_page:       { en: "Next 10 →",      nl: "Volgende 10 →" },
  er_page_of:         { en: "Page",           nl: "Pagina" },
  er_tokens:          { en: "tokens",         nl: "tokens" },
  er_momentum_high:   { en: "High buy pressure",   nl: "Hoge koopdruk" },
  er_momentum_fast:   { en: "Fast growth",         nl: "Snelle groei" },
  er_momentum_stable: { en: "Stable accumulation", nl: "Stabiele accumulatie" },
  er_momentum_mild:   { en: "Mild buy pressure",   nl: "Milde koopdruk" },
  er_momentum_watch:  { en: "Watch carefully",     nl: "Let goed op" },
  er_risk_low:        { en: "LOW RISK",        nl: "LAAG RISICO" },
  er_risk_moderate:   { en: "MODERATE",        nl: "MATIG" },
  er_risk_high:       { en: "HIGH RISK",       nl: "HOOG RISICO" },
  er_size_small:      { en: "🐟 SMALL",        nl: "🐟 KLEIN" },
  er_size_med:        { en: "🐬 MED",          nl: "🐬 MIDDEN" },
  er_size_big:        { en: "🦈 BIG",          nl: "🦈 GROOT" },
  er_size_whale:      { en: "🐋 WHALE",        nl: "🐋 WALVIS" },
  er_estimated:       { en: "ESTIMATED",       nl: "GESCHAT" },
  er_from_vol:        { en: "FROM VOL DATA",   nl: "VAN VOL DATA" },
  er_wallet_label:    { en: "wallet",          nl: "portemonnee" },
  er_1h_window:       { en: "~1h window",      nl: "~1u venster" },
  er_view_dex:        { en: "📊 View on DexScreener", nl: "📊 Bekijk op DexScreener" },
  er_scan_whale:      { en: "🧬 Scan Whale",   nl: "🧬 Scan Walvis" },
  er_estimated_note:  { en: "📊 Estimated from 1H volume data across radar tokens · Auto-refreshes every 30s · Updated",
                        nl: "📊 Geschat van 1U volumedata over radartokens · Elke 30s vernieuwd · Bijgewerkt" },
  er_entry_window:    { en: "Entry Window:",   nl: "Instap Venster:" },
  er_full_scan:       { en: "Full Scan →",     nl: "Volledig Scannen →" },
  er_age_label:       { en: "Age:",            nl: "Leeftijd:" },
  er_risk_score_label:{ en: "Risk Score:",     nl: "Risico Score:" },
  er_same_scoring:    { en: "same scoring as Risk Scanner ·", nl: "zelfde score als Risico Scanner ·" },
  er_legend_early:    { en: "EARLY — Best entry",       nl: "VROEG — Beste instap" },
  er_legend_mid:      { en: "MID — Enter carefully",   nl: "MID — Voorzichtig instappen" },
  er_legend_late:     { en: "LATE — Wait for dip",     nl: "LAAT — Wacht op dip" },
  er_legend_high_buy: { en: "🔥 High buy pressure",    nl: "🔥 Hoge koopdruk" },
  er_legend_fast:     { en: "⚡ Fast growth",           nl: "⚡ Snelle groei" },
  er_legend_stable:   { en: "🟢 Stable accumulation",  nl: "🟢 Stabiele accumulatie" },

  /* ── Entry window labels ── */
  er_ew_early_label:  { en: "Best entry window",       nl: "Beste instapvenster" },
  er_ew_early_tip:    { en: "Fresh token — optimal entry, move just beginning", nl: "Vers token — optimale instap, beweging begint net" },
  er_ew_mid_label:    { en: "Enter carefully",         nl: "Voorzichtig instappen" },
  er_ew_mid_tip:      { en: "Some move made — still has potential, manage risk", nl: "Enige beweging gemaakt — heeft nog potentieel, beheer risico" },
  er_ew_late_label:   { en: "Wait for a dip",          nl: "Wacht op een dip" },
  er_ew_late_tip:     { en: "Significant pump detected — high risk entry here", nl: "Aanzienlijke pump gedetecteerd — hoog risico instap hier" },

  /* ── Move potential ── */
  er_move_ultra:      { en: "Very low MC vs liquidity — huge move potential", nl: "Zeer lage MC vs liquiditeit — enorm bewegingspotentieel" },
  er_move_high:       { en: "Good MC/LP ratio — 100–400% possible",          nl: "Goede MC/LP verhouding — 100–400% mogelijk" },
  er_move_mod:        { en: "Moderate — 50–100% realistic",                  nl: "Matig — 50–100% realistisch" },
  er_move_low:        { en: "High MC vs liquidity — limited upside",         nl: "Hoge MC vs liquiditeit — beperkt opwaarts potentieel" },

  /* ── Trade checklist ── */
  er_chk_title:       { en: "⚡ Quick Trade Checklist",     nl: "⚡ Snelle Handels-Checklist" },
  er_chk_passed:      { en: "passed",                       nl: "geslaagd" },
  er_chk_all_ok:      { en: "All checks passed — clean entry signal", nl: "Alle checks geslaagd — schoon instapsignaal" },
  er_chk_partial:     { en: "Some checks failed — trade with extra caution", nl: "Sommige checks niet geslaagd — handel met extra voorzichtigheid" },
  er_chk_mint:        { en: "Mint Authority: Renounced",   nl: "Mint Autoriteit: Opgegeven" },
  er_chk_mint_ok:     { en: "Verified on-chain",           nl: "On-chain geverifieerd" },
  er_chk_freeze:      { en: "Freeze Authority: Renounced", nl: "Freeze Autoriteit: Opgegeven" },
  er_chk_freeze_ok:   { en: "Verified on-chain",           nl: "On-chain geverifieerd" },
  er_chk_liq:         { en: "Liquidity > $30k",            nl: "Liquiditeit > $30k" },
  er_chk_buypres:     { en: "Buy pressure > 1.2x",         nl: "Koopdruk > 1.2x" },
  er_chk_age:         { en: "Age: 30min – 12hrs",          nl: "Leeftijd: 30min – 12uur" },
  er_chk_score:       { en: "Risk Score ≥ 65",             nl: "Risico Score ≥ 65" },
  er_chk_pump:        { en: "Not pumped > 300%",           nl: "Niet > 300% gepompt" },
  er_trade_btn:       { en: "Simulate",                    nl: "Simuleer" },
  er_trade_safe_ape:  { en: "Simulate on Safe Ape",        nl: "Simuleer op Safe Ape" },
  er_mint_auth:       { en: "Mint Authority",              nl: "Mint Autoriteit" },
  er_freeze_auth:     { en: "Freeze Authority",            nl: "Freeze Autoriteit" },
  er_authority_verified: { en: "Both authorities verified on-chain before showing this token", nl: "Beide autoriteiten on-chain geverifieerd voordat dit token wordt getoond" },
  er_risk_score_tip:  { en: "Market data score — open Risk Scanner for full on-chain analysis", nl: "Marktdata score — open Risico Scanner voor volledige on-chain analyse" },
  er_click_detail:    { en: "Click for full analysis",     nl: "Klik voor volledige analyse" },

  /* ── Community panel (community.js content) ── */
  community_panel:      { en: "Scan2Moon Community",    nl: "Scan2Moon Community" },
  comm_tagline:         { en: "On-chain Solana intelligence.<br/>Scan smarter. Trade safer.",
                          nl: "On-chain Solana intelligentie.<br/>Scan slimmer. Handel veiliger." },
  comm_built_solana:    { en: "Built on Solana",        nl: "Gebouwd op Solana" },
  comm_disclaimer:      { en: "Informational tool only. Always DYOR.<br/>Not financial advice.",
                          nl: "Alleen informatief. Doe altijd je eigen onderzoek.<br/>Geen financieel advies." },
  comm_live_stats:      { en: "📡 Live Stats",          nl: "📡 Live Statistieken" },
  comm_stat_visits:     { en: "Site Visits",            nl: "Websitebezoeken" },
  comm_stat_scans:      { en: "Risk Scans Run",         nl: "Risicoscans Uitgevoerd" },
  comm_stat_moon:       { en: "Moon Coins Detected",    nl: "Moon Coins Gedetecteerd" },
  comm_stat_note:       { en: "Moon Coins = Risk Score ≥ 80/100", nl: "Moon Coins = Risicoscore ≥ 80/100" },
  comm_community:       { en: "🌐 Community",           nl: "🌐 Community" },
  comm_follow_x:        { en: "Follow on X",            nl: "Volg op X" },
  comm_tg_name:         { en: "Telegram",               nl: "Telegram" },
  comm_tg_sub:          { en: "Join community chat",    nl: "Word lid van de community chat" },
  comm_gh_sub:          { en: "Open source",            nl: "Open source" },
  comm_contact:         { en: "Contact Us",             nl: "Contact" },
  comm_tools:           { en: "🛠️ Tools",              nl: "🛠️ Tools" },
  comm_tool_risk:       { en: "Risk Scanner",           nl: "Risico Scanner" },
  comm_tool_portfolio:  { en: "Portfolio Scanner",      nl: "Portfolio Scanner" },
  comm_tool_whale:      { en: "Whale DNA",              nl: "Walvis DNA" },
  comm_tool_radar:      { en: "Entry Radar",            nl: "Instap Radar" },
  comm_tool_watchlist:  { en: "Watchlist",              nl: "Volglijst" },
  comm_copyright:       { en: "© 2026 Scan2Moon · All rights reserved",
                          nl: "© 2026 Scan2Moon · Alle rechten voorbehouden" },
  comm_live_auto:       { en: "Live · Auto-refreshes every 60s",
                          nl: "Live · Elke 60s vernieuwd" },

  /* ── About page – "What is Scan2Moon?" body text ── */
  ab_what_p1: { en: "Scan2Moon started from a simple problem: the Solana ecosystem moves fast, and most retail traders have no reliable way to tell a legitimate opportunity from a rug. Market cap alone tells you nothing. Hype tells you even less.",
                nl: "Scan2Moon begon vanuit een eenvoudig probleem: het Solana-ecosysteem beweegt snel, en de meeste retailhandelaren hebben geen betrouwbare manier om een legitieme kans te onderscheiden van een rug. Marktkapitalisatie alleen zegt niets. Hype zegt nog minder." },
  ab_what_p2: { en: "We built a platform that reads what the chain actually says — token age, liquidity lock status, holder concentration, wallet behaviour, developer history, LP depth, and dozens of other signals — and turns all of it into a single, honest Risk Score. No noise. No paid partnerships. No sponsored listings.",
                nl: "We bouwden een platform dat leest wat de blockchain werkelijk zegt — token leeftijd, LP-lockstatus, houderconcentratie, portemonneegedrag, ontwikkelaarsgeschiedenis, LP-diepte en tientallen andere signalen — en dat alles omzet in één eerlijke Risicoscore. Geen ruis. Geen betaalde partnerschappen. Geen gesponsorde vermeldingen." },
  ab_what_p3: { en: "On top of that foundation we've layered a full trader ecosystem: track whales, spot early entries, simulate trades without risking real money, and compete with others on a risk-adjusted leaderboard that rewards discipline — not just luck.",
                nl: "Bovenop dat fundament hebben we een volledig handelsecosysteem gebouwd: volg walvissen, spot vroege instappen, simuleer trades zonder echt geld te riskeren en concurreer met anderen op een risicogecorrigeerd scorebord dat discipline beloont — niet alleen geluk." },
  ab_what_highlight: { en: "Scan2Moon is free, independent, and built entirely around one goal: helping you make better decisions on-chain.",
                       nl: "Scan2Moon is gratis, onafhankelijk en volledig gebouwd rond één doel: je helpen betere beslissingen te nemen on-chain." },

  /* ── About page – score demo labels ── */
  ab_demo_risk_score:  { en: "RISK SCORE",    nl: "RISICOSCORE" },
  ab_demo_safe_entry:  { en: "SAFE ENTRY",    nl: "VEILIGE INSTAP" },
  ab_demo_liquidity:   { en: "Liquidity",     nl: "Liquiditeit" },
  ab_demo_holders:     { en: "Holders",       nl: "Houders" },
  ab_demo_lp_lock:     { en: "LP Lock",       nl: "LP Lock" },
  ab_demo_dev_history: { en: "Dev History",   nl: "Ontwikkelaarsgeschiedenis" },
  ab_demo_age:         { en: "On-chain Age",  nl: "On-chain Leeftijd" },

  /* ── About page – timeline descriptions ── */
  ab_tl_v10_desc: { en: "Launched the original Scan2Moon Risk Scanner with on-chain token analysis, composite risk scoring, LP lock detection, holder concentration analysis, and the first version of the developer history check. Established the core scoring methodology that everything else is built on.",
                    nl: "Lancering van de originele Scan2Moon Risicoscanner met on-chain tokenanalyse, samengestelde risicoscoring, LP-lockdetectie, analyse van houderconcentratie en de eerste versie van de ontwikkelaarsgeschiedenischeck. Het vastleggen van de kernscoringsmethodologie waarop alles anders is gebouwd." },
  ab_tl_v20_desc: { en: "Complete rebuild and major platform expansion. Six new tools launched alongside a redesigned interface, real-time price feeds, live candle charts, a global leaderboard with badge system, and Sol2Moon — the in-game currency rewarding disciplined traders.",
                    nl: "Volledige herbouw en grote platformuitbreiding. Zes nieuwe tools gelanceerd naast een nieuw ontworpen interface, real-time prijsfeeds, live kandelaargrafieken, een wereldwijd scorebord met badgesysteem en Sol2Moon — de in-game valuta voor gedisciplineerde handelaren." },
  ab_tl_v21_desc: { en: "Ongoing improvements driven by community feedback. Expanded badge system, deeper leaderboard analytics, improved price feeds, performance tuning, and the groundwork for the biggest milestone yet.",
                    nl: "Voortdurende verbeteringen gedreven door community feedback. Uitgebreid badgesysteem, diepere scorebordanalytics, verbeterde prijsfeeds, prestatieoptimalisatie en de basis voor de grootste mijlpaal tot nu toe." },
  ab_tl_v25_desc: { en: "A free trading school built directly into Scan2Moon — designed for beginners who want to learn how to read on-chain data before risking real money. Structured 4-week courses, daily and weekly simulator challenges using Safe Ape, school badges, a student leaderboard, and wallet-based profiles tracking every milestone you hit.",
                    nl: "Een gratis handelsschool rechtstreeks in Scan2Moon ingebouwd — ontworpen voor beginners die willen leren hoe ze on-chain data moeten lezen voordat ze echt geld riskeren. Gestructureerde 4-weekse cursussen, dagelijkse en wekelijkse simulatoruitdagingen met Safe Ape, schoolbadges, een studentenscorebord en op portemonnee gebaseerde profielen die elke mijlpaal bijhouden." },
  ab_tl_mobile_desc: { en: "The full Scan2Moon experience — in your pocket. Risk scan tokens on the go, get push notifications for watchlist movements, receive Entry Radar alerts for new opportunities, and manage your Safe Ape portfolio directly from your phone. Built natively for both iOS and Android to match the speed of the Solana ecosystem.",
                       nl: "De volledige Scan2Moon-ervaring — in je zak. Scan tokens onderweg, ontvang pushmeldingen voor volglijstbewegingen, ontvang Instap Radar-waarschuwingen voor nieuwe kansen en beheer je Safe Ape-portfolio direct vanaf je telefoon. Gebouwd voor iOS en Android om de snelheid van het Solana-ecosysteem bij te houden." },
  ab_tl_v30_desc: { en: "Advanced on-chain pattern recognition, copy-trading alerts, wallet clustering, and deeper ecosystem integrations. The long-term vision for Scan2Moon is a full intelligence layer on top of Solana — not just a scanner, but a living map of the chain.",
                    nl: "Geavanceerde on-chain patroonherkenning, kopieer-handelwaarschuwingen, portemonnee-clustering en diepere ecosysteemintegraties. De langetermijnvisie voor Scan2Moon is een volledige intelligentielaag bovenop Solana — niet alleen een scanner, maar een levende kaart van de blockchain." },
  ab_tl_v420_desc: { en: "Something big is coming. We can't tell you what it is — but when it lands, you'll know. Stay close, stay ready. The moon is just the beginning. 🌕",
                     nl: "Er komt iets groots. We kunnen je niet vertellen wat het is — maar als het er is, weet je het. Blijf dicht bij ons, blijf klaar. De maan is slechts het begin. 🌕" },

  /* ── Homepage ── */
  home_last_scanned:     { en: "🕐 LAST SCANNED TOKENS",   nl: "🕐 LAATSTE GESCANDE TOKENS" },
  home_last_scanned_sub: { en: "Last 10 Risk Scanner results — click any to re-scan",
                           nl: "Laatste 10 Risico Scanner resultaten — klik om opnieuw te scannen" },
  home_community:        { en: "Scan2Moon Community",       nl: "Scan2Moon Community" },
  home_no_scans_title:   { en: "No scans yet",              nl: "Nog geen scans" },
  home_no_scans_sub:     { en: "Head to the Risk Scanner and scan your first token!",
                           nl: "Ga naar de Risico Scanner en scan je eerste token!" },
  home_avg_tx:           { en: "Avg TX Size",               nl: "Gem. TX Grootte" },
  home_rescan_hint:      { en: "Click to re-scan →",        nl: "Klik om opnieuw te scannen →" },
  home_trade_btn:        { en: "Trade on Safe Ape",         nl: "Handelen op Safe Ape" },
  home_clear_history:    { en: "Clear History",             nl: "Geschiedenis Wissen" },

  /* ── Guide hub page ── */
  guide_hub_badge:      { en: "📚 Scan2Moon Academy",   nl: "📚 Scan2Moon Academy" },
  guide_hub_title1:     { en: "Quick Start",             nl: "Snelstart" },
  guide_hub_title2:     { en: "Guides",                  nl: "Gidsen" },
  guide_hub_sub:        { en: "New to Scan2Moon? Start here. Each guide walks you through one tool — step by step, with real examples and a knowledge check at the end.",
                          nl: "Nieuw bij Scan2Moon? Begin hier. Elke gids leidt je stap voor stap door één tool — met echte voorbeelden en een kennischeck aan het einde." },
  guide_card1_tag:      { en: "🛡️ Risk Scanner",         nl: "🛡️ Risico Scanner" },
  guide_card1_title:    { en: "S2M – From Zero to Moon", nl: "S2M – Van Nul naar de Maan" },
  guide_card1_desc:     { en: "Learn to read the 12 on-chain signals, understand the Risk Score, and spot red flags before you ape in. Includes a 5-question knowledge check.",
                          nl: "Leer de 12 on-chain signalen lezen, begrijp de Risicoscore en herken rode vlaggen voordat je instapt. Inclusief een kennischeck van 5 vragen." },
  guide_meta_read:      { en: "⏱ ~8 min read",           nl: "⏱ ~8 min lezen" },
  guide_meta_quiz:      { en: "📝 Quiz included",         nl: "📝 Quiz inbegrepen" },
  guide_meta_live:      { en: "🔴 Live example",          nl: "🔴 Live voorbeeld" },
  guide_card2_tag:      { en: "🧬 Whale DNA",             nl: "🧬 Walvis DNA" },
  guide_card2_title:    { en: "Track the Smart Money",   nl: "Volg het Slimme Geld" },
  guide_card2_desc:     { en: "Discover how to use Whale DNA to follow wallet behavior, spot early accumulation, and understand what smart money is doing right now.",
                          nl: "Ontdek hoe je Walvis DNA gebruikt om portemonnee-gedrag te volgen, vroege accumulatie te spotten en te begrijpen wat slim geld nu doet." },
  guide_card3_tag:      { en: "🦍 Safe Ape",             nl: "🦍 Safe Ape" },
  guide_card3_title:    { en: "Paper Trade Before You Risk Real SOL", nl: "Paper Trade Voordat Je Echt SOL Riskeert" },
  guide_card3_desc:     { en: "Learn to use the Safe Ape simulator to test your strategy, track paper trades, and build discipline without risking actual funds.",
                          nl: "Leer de Safe Ape simulator te gebruiken om je strategie te testen, papierhandels bij te houden en discipline op te bouwen zonder echt geld te riskeren." },
  guide_coming_soon:    { en: "⏳ Coming Soon",           nl: "⏳ Binnenkort" },
  guide_cta_title:      { en: "Ready to scan your first token?", nl: "Klaar om je eerste token te scannen?" },
  guide_cta_sub:        { en: "Start with the Risk Scanner guide above, then put your knowledge to the test on a real token.",
                          nl: "Begin met de Risico Scanner gids hierboven en test daarna je kennis op een echt token." },
  guide_cta_btn:        { en: "🔍 Open Risk Scanner →",  nl: "🔍 Open Risico Scanner →" },

  /* ── Guide: Risk Scanner page ── */
  gr_back:              { en: "← Back to All Guides",    nl: "← Terug naar Alle Gidsen" },
  gr_badge_tag:         { en: "🛡️ Risk Scanner Guide",   nl: "🛡️ Risico Scanner Gids" },
  gr_title:             { en: "S2M – From Zero to Moon", nl: "S2M – Van Nul naar de Maan" },
  gr_subtitle:          { en: "Everything you need to scan a Solana token with confidence — 4 chapters, a live example, and a knowledge quiz at the end.",
                          nl: "Alles wat je nodig hebt om een Solana token met vertrouwen te scannen — 4 hoofdstukken, een live voorbeeld en een kennisquiz aan het einde." },
  gr_meta1:             { en: "⏱ ~8 min read",           nl: "⏱ ~8 min lezen" },
  gr_meta2:             { en: "📝 5-question quiz",       nl: "📝 5-vragen quiz" },
  gr_meta3:             { en: "🔴 Live demo",             nl: "🔴 Live demo" },
  gr_meta4:             { en: "🏅 Earn your badge",       nl: "🏅 Verdien je badge" },
  gr_ch1_num:           { en: "Chapter 1 of 4",          nl: "Hoofdstuk 1 van 4" },
  gr_ch1_title:         { en: "🔑 Finding a Token's Mint Address", nl: "🔑 Het Mint Adres van een Token Vinden" },
  gr_ch1_lead:          { en: "Before you can scan a token, you need its <strong style=\"color:#cffff4;\">mint address</strong>. Think of it as the token's unique fingerprint on the Solana blockchain — it never changes and there can only be one.",
                          nl: "Voordat je een token kunt scannen, heb je het <strong style=\"color:#cffff4;\">mint adres</strong> nodig. Zie het als de unieke vingerafdruk van het token op de Solana blockchain — het verandert nooit en er kan er maar één zijn." },
  gr_ch1_tip_title:     { en: "💡 What is a mint address?", nl: "💡 Wat is een mint adres?" },
  gr_ch1_tip_body:      { en: "Every Solana token has a unique mint address — a 32–44 character code made of letters and numbers. It's sometimes called the \"Contract Address\" or \"CA\". This is what Scan2Moon uses to look up all on-chain data for that token.",
                          nl: "Elk Solana token heeft een uniek mint adres — een code van 32–44 tekens bestaande uit letters en cijfers. Het wordt soms het \"Contract Adres\" of \"CA\" genoemd. Dit is wat Scan2Moon gebruikt om alle on-chain data van dat token op te zoeken." },
  gr_ch1_demo_label:    { en: "Example mint address",    nl: "Voorbeeld mint adres" },
  gr_ch1_steps_title:   { en: "How to find a token's mint address:", nl: "Hoe je het mint adres van een token vindt:" },
  gr_ch1_step1:         { en: "Go to <strong>DexScreener.com</strong> (the most reliable source for Solana token data)", nl: "Ga naar <strong>DexScreener.com</strong> (de meest betrouwbare bron voor Solana tokendata)" },
  gr_ch1_step2:         { en: "Search for the token by name — for example type <strong>\"GHOST\"</strong> in the search bar", nl: "Zoek het token op naam — typ bijvoorbeeld <strong>\"GHOST\"</strong> in de zoekbalk" },
  gr_ch1_step3:         { en: "Click on the correct token result (check the symbol and pair carefully)", nl: "Klik op het juiste tokenresultaat (controleer het symbool en paar zorgvuldig)" },
  gr_ch1_step4:         { en: "Look for <strong>\"Contract\"</strong> or <strong>\"CA\"</strong> on the token page — this is the mint address", nl: "Zoek naar <strong>\"Contract\"</strong> of <strong>\"CA\"</strong> op de tokenpagina — dit is het mint adres" },
  gr_ch1_step5:         { en: "Copy the full address and paste it into the Scan2Moon search bar", nl: "Kopieer het volledige adres en plak het in de Scan2Moon zoekbalk" },
  gr_ch1_warn_title:    { en: "⚠️ Never use the token name to scan", nl: "⚠️ Gebruik nooit de tokennaam om te scannen" },
  gr_ch1_warn_body:     { en: "Anyone can create a fake token called \"GHOST\" or \"SOL\". Always use the actual mint address to make sure you're scanning the real token, not an impostor.",
                          nl: "Iedereen kan een nep-token aanmaken met de naam \"GHOST\" of \"SOL\". Gebruik altijd het echte mint adres om zeker te zijn dat je het echte token scant, niet een imitatie." },
  gr_ch1_danger_title:  { en: "🚨 Token mint vs. wallet address", nl: "🚨 Token mint vs. portemonnee adres" },
  gr_ch1_danger_body:   { en: "A wallet address is YOUR address on Solana. A mint address is the TOKEN's address. They look similar but are completely different. Pasting your own wallet address into Scan2Moon will not work — it needs a token mint.",
                          nl: "Een portemonnee adres is JOUW adres op Solana. Een mint adres is het adres van het TOKEN. Ze zien er vergelijkbaar uit maar zijn compleet anders. Je eigen portemonnee adres in Scan2Moon plakken werkt niet — het heeft een token mint nodig." },
  gr_ch2_num:           { en: "Chapter 2 of 4",          nl: "Hoofdstuk 2 van 4" },
  gr_ch2_title:         { en: "📊 Reading the Risk Score", nl: "📊 De Risicoscore Begrijpen" },
  gr_ch2_lead:          { en: "Every scan produces a single number from 0 to 100. This is the <strong style=\"color:#cffff4;\">Risk Score</strong> — the higher the number, the safer the token looks based on its on-chain signals. Here's what each range means:",
                          nl: "Elke scan produceert een enkel getal van 0 tot 100. Dit is de <strong style=\"color:#cffff4;\">Risicoscore</strong> — hoe hoger het getal, hoe veiliger het token eruitziet op basis van de on-chain signalen. Dit betekent elk bereik:" },
  gr_score_moon_desc:   { en: "Moon Coin — strong signals, healthy liquidity, low rug risk. You're in good shape.", nl: "Moon Munt — sterke signalen, gezonde liquiditeit, laag rug risico. Je staat er goed voor." },
  gr_score_good_desc:   { en: "Low Risk — solid overall picture. Watch for any weak individual signals.", nl: "Laag Risico — solide totaalbeeld. Let op eventuele zwakke individuele signalen." },
  gr_score_warn_desc:   { en: "Moderate Risk — mixed signals. Trade carefully and size your position accordingly.", nl: "Matig Risico — gemengde signalen. Handel voorzichtig en pas je positiegrootte aan." },
  gr_score_high_desc:   { en: "High Rug Risk — multiple red flags. Not recommended unless you know the project well.", nl: "Hoog Rug Risico — meerdere rode vlaggen. Niet aanbevolen tenzij je het project goed kent." },
  gr_score_ext_desc:    { en: "Extreme Risk — serious danger signs. Avoid unless you are prepared to lose everything.", nl: "Extreem Risico — ernstige gevaarstekens. Vermijd tenzij je bereid bent alles te verliezen." },
  gr_ch2_tip_title:     { en: "💡 How is the score calculated?", nl: "💡 Hoe wordt de score berekend?" },
  gr_ch2_tip_body:      { en: "Scan2Moon checks 12 independent signals and weights each one based on importance. No single signal can inflate your score — the system requires clean signals across the board to score high. Even if volume looks great, a rug-risk liquidity pool will drag the score down.",
                          nl: "Scan2Moon controleert 12 onafhankelijke signalen en weegt elk op basis van belang. Geen enkel signaal kan je score opblazen — het systeem vereist schone signalen over de hele linie voor een hoge score. Zelfs als het volume er geweldig uitziet, zal een liquiditeitspool met rug-risico de score omlaag trekken." },
  gr_ch2_warn_title:    { en: "⚠️ The score is a tool, not a guarantee", nl: "⚠️ De score is een hulpmiddel, geen garantie" },
  gr_ch2_warn_body:     { en: "A high score reduces risk — it does not eliminate it. Crypto markets are unpredictable. Always trade with money you can afford to lose, regardless of scan results.",
                          nl: "Een hoge score vermindert het risico — het elimineert het niet. Cryptomarkten zijn onvoorspelbaar. Handel altijd met geld dat je je kunt veroorloven te verliezen, ongeacht de scanresultaten." },
  gr_ch3_num:           { en: "Chapter 3 of 4",          nl: "Hoofdstuk 3 van 4" },
  gr_ch3_title:         { en: "⚡ The 12 Signals — What They Mean", nl: "⚡ De 12 Signalen — Wat Ze Betekenen" },
  gr_ch3_lead:          { en: "Below the Risk Score you'll see a grid of 12 signals. Each one scores 0–100 individually. Here's what each signal measures and why it matters:",
                          nl: "Onder de Risicoscore zie je een raster van 12 signalen. Elk scoort individueel 0–100. Dit is wat elk signaal meet en waarom het belangrijk is:" },
  gr_sig1_name:         { en: "Token Age Trust",         nl: "Token Leeftijd Vertrouwen" },
  gr_sig1_desc:         { en: "How old is the token? Brand-new tokens (under 30 mins) score very low — there's no track record yet. Older tokens have had more time to prove themselves.",
                          nl: "Hoe oud is het token? Gloednieuwe tokens (jonger dan 30 minuten) scoren zeer laag — er is nog geen track record. Oudere tokens hebben meer tijd gehad om zichzelf te bewijzen." },
  gr_sig2_name:         { en: "Market Integrity",        nl: "Markt Integriteit" },
  gr_sig2_desc:         { en: "Is the price crashing? This detects active dumping. A token down 65%+ in 24h scores near zero — someone is selling hard, likely insiders or the dev team.",
                          nl: "Crasht de prijs? Dit detecteert actief dumpen. Een token dat meer dan 65% daalt in 24u scoort bijna nul — iemand verkoopt hard, waarschijnlijk insiders of het devteam." },
  gr_sig3_name:         { en: "Pump Danger",             nl: "Pomp Gevaar" },
  gr_sig3_desc:         { en: "Detects classic pump-and-dump setup: extreme price spike with weak volume or fast reversal. High pump danger = price may be artificially inflated.",
                          nl: "Detecteert klassieke pump-and-dump opzet: extreme prijspiek met zwak volume of snelle ommekeer. Hoog pompgevaar = prijs kan kunstmatig opgeblazen zijn." },
  gr_sig4_name:         { en: "LP Strength",             nl: "LP Sterkte" },
  gr_sig4_desc:         { en: "How much real money is in the liquidity pool? Low LP strength ($5K or less) means a single large sell can crash the price instantly — the classic \"rug pull\" setup.",
                          nl: "Hoeveel echt geld zit er in de liquiditeitspool? Lage LP sterkte ($5K of minder) betekent dat één grote verkoop de prijs direct kan crashen — de klassieke \"rug pull\" opzet." },
  gr_sig5_name:         { en: "MC / Liq Ratio",          nl: "MC / Liq Verhouding" },
  gr_sig5_desc:         { en: "Market Cap divided by Liquidity. If the ratio is 1000x or higher, the price cannot be sustained — there isn't enough liquidity to support the valuation.",
                          nl: "Marktkapitalisatie gedeeld door Liquiditeit. Als de verhouding 1000x of hoger is, kan de prijs niet worden gehandhaafd — er is niet genoeg liquiditeit om de waardering te ondersteunen." },
  gr_sig6_name:         { en: "Sell Pressure",           nl: "Verkoopdruk" },
  gr_sig6_desc:         { en: "How many people are selling vs. buying right now? High sell pressure means more exits than entries. Can signal a turn before the price collapses.",
                          nl: "Hoeveel mensen verkopen er vs. kopen er op dit moment? Hoge verkoopdruk betekent meer exits dan ingangen. Kan een ommekeer signaleren voordat de prijs instort." },
  gr_sig7_name:         { en: "Dev Behavior",            nl: "Ontwikkelaar Gedrag" },
  gr_sig7_desc:         { en: "What is the developer wallet doing? If mint authority is still active, the dev can print unlimited tokens. If dev holds >15% of supply, they control the price.",
                          nl: "Wat doet de portemonnee van de ontwikkelaar? Als de mint autoriteit nog actief is, kan de dev onbeperkte tokens drukken. Als de dev meer dan 15% van het aanbod houdt, controleren ze de prijs." },
  gr_sig8_name:         { en: "Bundle Attack Score",     nl: "Bundle Aanval Score" },
  gr_sig8_desc:         { en: "Were there bot-coordinated buys at launch designed to pump the price? Bundle attackers buy in bulk at launch, inflate the price, then dump on retail buyers. Low score = bundles detected.",
                          nl: "Waren er bot-gecoördineerde aankopen bij lancering om de prijs op te pompen? Bundle aanvallers kopen massaal bij lancering, blazen de prijs op en dumpen op retail kopers. Lage score = bundles gedetecteerd." },
  gr_sig9_name:         { en: "Pump.fun Launch Risk",    nl: "Pump.fun Launch Risico" },
  gr_sig9_desc:         { en: "Did this token launch on pump.fun? Tokens still on the bonding curve have \"virtual\" liquidity — not real exit liquidity. Scores very low until fully graduated to a real DEX.",
                          nl: "Is dit token gelanceerd op pump.fun? Tokens die nog op de bonding curve staan hebben \"virtuele\" liquiditeit — geen echte exitliquiditeit. Scoort zeer laag totdat het volledig is afgestudeerd naar een echte DEX." },
  gr_sig10_name:        { en: "LP Stability",            nl: "LP Stabiliteit" },
  gr_sig10_desc:        { en: "Is the liquidity pool growing, stable, or shrinking? Consistent liquidity is a positive sign. A rapidly draining pool is a red flag — liquidity providers are exiting.",
                          nl: "Groeit de liquiditeitspool, is die stabiel of krimpt die? Consistente liquiditeit is een positief teken. Een snel leeglopende pool is een rode vlag — liquiditeitsverschaffers stappen uit." },
  gr_sig11_name:        { en: "Volume Consistency",      nl: "Volume Consistentie" },
  gr_sig11_desc:        { en: "Is trading volume consistent and organic? Sudden massive volume spikes followed by silence often indicate wash trading or artificial hype to attract buyers.",
                          nl: "Is het handelsvolume consistent en organisch? Plotselinge massale volumepieken gevolgd door stilte duiden vaak op wash trading of kunstmatige hype om kopers aan te trekken." },
  gr_sig12_name:        { en: "Vol / MCap Ratio",        nl: "Vol / MCap Verhouding" },
  gr_sig12_desc:        { en: "Volume relative to market cap. Extreme values in either direction suggest manipulation — either suspiciously high wash trading or a dead token with no real activity.",
                          nl: "Volume ten opzichte van marktkapitalisatie. Extreme waarden in beide richtingen suggereren manipulatie — ofwel verdacht hoge wash trading ofwel een dood token zonder echte activiteit." },
  gr_ch3_tip_title:     { en: "💡 Which signals matter most?", nl: "💡 Welke signalen zijn het belangrijkst?" },
  gr_ch3_tip_body:      { en: "The three signals with the biggest weight are <strong>Token Age Trust (14%)</strong>, <strong>Market Integrity (12%)</strong>, and <strong>Pump.fun Launch Risk (12%)</strong>. LP Strength is lower weight but acts as a hard override — extremely low liquidity caps the total score regardless of other signals.",
                          nl: "De drie signalen met het grootste gewicht zijn <strong>Token Leeftijd Vertrouwen (14%)</strong>, <strong>Markt Integriteit (12%)</strong> en <strong>Pump.fun Launch Risico (12%)</strong>. LP Sterkte heeft een lager gewicht maar fungeert als harde begrenzing — extreem lage liquiditeit begrenst de totale score ongeacht andere signalen." },
  gr_ch4_num:           { en: "Chapter 4 of 4",          nl: "Hoofdstuk 4 van 4" },
  gr_ch4_title:         { en: "🚩 Red Flags — When to Walk Away", nl: "🚩 Rode Vlaggen — Wanneer Je Beter Weg Kunt Lopen" },
  gr_ch4_lead:          { en: "Even if you're excited about a token, these signals should give you serious pause. Experienced traders know that skipping a bad trade is just as profitable as catching a good one.",
                          nl: "Ook al ben je enthousiast over een token, deze signalen zouden je serieus moeten laten nadenken. Ervaren handelaren weten dat een slechte trade overslaan net zo winstgevend is als een goede vinden." },
  gr_rf1_title:         { en: "Score below 30 / Extreme Risk", nl: "Score onder 30 / Extreem Risico" },
  gr_rf1_body:          { en: "Multiple systems are flagging danger. This is not a \"hidden gem\" — the on-chain data is warning you clearly.", nl: "Meerdere systemen markeren gevaar. Dit is geen \"verborgen parel\" — de on-chain data waarschuwt je duidelijk." },
  gr_rf2_title:         { en: "LP Strength under 30 / 100", nl: "LP Sterkte onder 30 / 100" },
  gr_rf2_body:          { en: "Very weak liquidity. One whale sell can wipe the pool. You may not be able to exit at any reasonable price.", nl: "Zeer zwakke liquiditeit. Één walvisverkoop kan de pool leegmaken. Je kunt mogelijk niet uitstappen tegen een redelijke prijs." },
  gr_rf3_title:         { en: "Freeze Authority: Active", nl: "Freeze Autoriteit: Actief" },
  gr_rf3_body:          { en: "The developer can freeze your wallet balance and block you from selling at any time, for any reason, with no warning.", nl: "De ontwikkelaar kan je portemonnee saldo bevriezen en je blokkeren van verkopen op elk moment, om welke reden dan ook, zonder waarschuwing." },
  gr_rf4_title:         { en: "Token under 10 minutes old", nl: "Token jonger dan 10 minuten" },
  gr_rf4_body:          { en: "Brand-new tokens have no track record. The first few minutes are the highest-risk window — bots and bundlers are most active here.", nl: "Gloednieuwe tokens hebben geen track record. De eerste paar minuten zijn het hoogste risicovenster — bots en bundlers zijn hier het meest actief." },
  gr_rf5_title:         { en: "Pump.fun Launch Risk scores below 40", nl: "Pump.fun Launch Risico scoort onder 40" },
  gr_rf5_body:          { en: "Token is still on (or recently left) the pump.fun bonding curve. The \"liquidity\" may not be real exit liquidity. Check if it has graduated to Raydium or Meteora.", nl: "Token staat nog op (of heeft recent verlaten) de pump.fun bonding curve. De \"liquiditeit\" is misschien geen echte exitliquiditeit. Controleer of het is afgestudeerd naar Raydium of Meteora." },
  gr_rf6_title:         { en: "Bundle Attack Score below 40", nl: "Bundle Aanval Score onder 40" },
  gr_rf6_body:          { en: "Coordinated bot buys at launch were detected. These wallets will dump when the price is high enough. You are likely buying from them right now.", nl: "Gecoördineerde bot-aankopen bij lancering zijn gedetecteerd. Deze portemonnees zullen dumpen als de prijs hoog genoeg is. Je koopt waarschijnlijk op dit moment van hen." },
  gr_rf7_title:         { en: "Dev Holdings above 15%", nl: "Dev Bezit boven 15%" },
  gr_rf7_body:          { en: "The developer controls a large portion of supply. A single sell from their wallet can crash the price significantly.", nl: "De ontwikkelaar controleert een groot deel van het aanbod. Één verkoop vanuit hun portemonnee kan de prijs aanzienlijk doen crashen." },
  gr_rf8_title:         { en: "Top 10 holders above 70%", nl: "Top 10 houders boven 70%" },
  gr_rf8_body:          { en: "A handful of wallets own most of the supply. Price is extremely susceptible to coordinated dumping by any one of them.", nl: "Een handvol portemonnees bezit het grootste deel van het aanbod. De prijs is extreem vatbaar voor gecoördineerd dumpen door een van hen." },
  gr_ch4_tip_title:     { en: "💡 The \"discipline\" rule", nl: "💡 De \"discipline\" regel" },
  gr_ch4_tip_body:      { en: "The scan result doesn't decide for you — you do. But the traders who consistently survive in crypto are the ones who stick to their rules. If three or more red flags appear in a single scan, consider it a hard pass regardless of the hype around that token.",
                          nl: "Het scanresultaat beslist niet voor jou — jij doet dat. Maar de handelaren die consistent overleven in crypto zijn degenen die zich aan hun regels houden. Als drie of meer rode vlaggen in één scan verschijnen, beschouw het dan als een harde pas, ongeacht de hype rondom dat token." },
  gr_live_title:        { en: "🔴 Try a Live Example",   nl: "🔴 Probeer een Live Voorbeeld" },
  gr_live_body:         { en: "See everything you just learned in action. Click below to auto-fill a real token (GHOST) into the Risk Scanner — watch the scan run live and see all 12 signals for yourself.",
                          nl: "Zie alles wat je net hebt geleerd in actie. Klik hieronder om een echt token (GHOST) automatisch in te vullen in de Risico Scanner — bekijk de scan live en zie alle 12 signalen zelf." },
  gr_live_btn:          { en: "▶ Run Live Scan (GHOST)", nl: "▶ Start Live Scan (GHOST)" },
  gr_quiz_ch_num:       { en: "Knowledge Check",         nl: "Kennischeck" },
  gr_quiz_ch_title:     { en: "📝 Prove What You Know",  nl: "📝 Bewijs Wat Je Weet" },
  gr_quiz_ch_lead:      { en: "Answer all 5 questions correctly (or get 4/5) to earn your <strong style=\"color:#2cffc9;\">Certified Scan2Moon User</strong> badge — a card you can screenshot and share on X.",
                          nl: "Beantwoord alle 5 vragen correct (of haal 4/5) om je <strong style=\"color:#2cffc9;\">Gecertificeerd Scan2Moon Gebruiker</strong> badge te verdienen — een kaart die je kunt schermafbeelden en delen op X." },
  gr_quiz_title:        { en: "🌕 Risk Scanner Quiz",    nl: "🌕 Risico Scanner Quiz" },
  gr_quiz_sub:          { en: "Select the best answer for each question. Wrong answers show an explanation.", nl: "Selecteer het beste antwoord voor elke vraag. Foute antwoorden tonen een uitleg." },
  gr_q1_text:           { en: "You scan a token and see 87/100. What does this mean?", nl: "Je scant een token en ziet 87/100. Wat betekent dit?" },
  gr_q1_a:              { en: "The token is extremely risky and might rug", nl: "Het token is extreem riskant en kan gerugged worden" },
  gr_q1_b:              { en: "🌕 Moon Coin — strong on-chain signals, low rug risk", nl: "🌕 Moon Munt — sterke on-chain signalen, laag rug risico" },
  gr_q1_c:              { en: "The scan is still loading", nl: "De scan laadt nog" },
  gr_q1_ea:             { en: "❌ Not quite. A score of 87 is actually the highest tier — Moon Coin territory.", nl: "❌ Niet helemaal. Een score van 87 is de hoogste categorie — Moon Munt territorium." },
  gr_q1_eb:             { en: "✅ Correct! 80–100 is the Moon Coin range. Strong signals, low rug risk.", nl: "✅ Correct! 80–100 is het Moon Munt bereik. Sterke signalen, laag rug risico." },
  gr_q1_ec:             { en: "❌ Nope — 87/100 is a full completed scan result. Moon Coin level.", nl: "❌ Nee — 87/100 is een volledig afgerond scanresultaat. Moon Munt niveau." },
  gr_q2_text:           { en: "Where do you find a token's Mint Address?", nl: "Waar vind je het Mint Adres van een token?" },
  gr_q2_a:              { en: "In your Phantom wallet — it's your own wallet address", nl: "In je Phantom wallet — het is jouw eigen portemonnee adres" },
  gr_q2_b:              { en: "On DexScreener — search the token, copy the Contract Address (CA)", nl: "Op DexScreener — zoek het token op, kopieer het Contract Adres (CA)" },
  gr_q2_c:              { en: "The token name (like \"GHOST\") is the mint address", nl: "De tokennaam (zoals \"GHOST\") is het mint adres" },
  gr_q2_ea:             { en: "❌ Your wallet address is YOUR address — not the token's mint address. Never paste your own wallet.", nl: "❌ Jouw portemonnee adres is JOUW adres — niet het mint adres van het token. Plak nooit je eigen portemonnee." },
  gr_q2_eb:             { en: "✅ Correct! DexScreener shows the Contract Address (CA) for every Solana token. That's the mint address.", nl: "✅ Correct! DexScreener toont het Contract Adres (CA) voor elk Solana token. Dat is het mint adres." },
  gr_q2_ec:             { en: "❌ The token name is just a label — anyone can create a fake token with the same name. Always use the mint address.", nl: "❌ De tokennaam is slechts een label — iedereen kan een nep-token aanmaken met dezelfde naam. Gebruik altijd het mint adres." },
  gr_q3_text:           { en: "LP Strength scores 18/100 on a token you're about to buy. What does this mean?", nl: "LP Sterkte scoort 18/100 op een token dat je wilt kopen. Wat betekent dit?" },
  gr_q3_a:              { en: "Great! LP Strength doesn't affect the price much", nl: "Top! LP Sterkte heeft weinig invloed op de prijs" },
  gr_q3_b:              { en: "Very weak liquidity — one big sell can crash the price. High rug risk.", nl: "Zeer zwakke liquiditeit — één grote verkoop kan de prijs crashen. Hoog rug risico." },
  gr_q3_c:              { en: "It means the developer is active and engaged", nl: "Het betekent dat de ontwikkelaar actief is" },
  gr_q3_ea:             { en: "❌ LP Strength is one of the most important signals. Very low LP means the pool can be rugged instantly.", nl: "❌ LP Sterkte is een van de belangrijkste signalen. Zeer lage LP betekent dat de pool direct gerugged kan worden." },
  gr_q3_eb:             { en: "✅ Correct! 18/100 on LP Strength = dangerously weak liquidity. A whale can crash the price with one sell.", nl: "✅ Correct! 18/100 op LP Sterkte = gevaarlijk zwakke liquiditeit. Een walvis kan de prijs met één verkoop crashen." },
  gr_q3_ec:             { en: "❌ LP Strength measures liquidity pool depth, not developer activity. That's the Dev Behavior signal.", nl: "❌ LP Sterkte meet de diepte van de liquiditeitspool, niet de activiteit van de ontwikkelaar. Dat is het Ontwikkelaar Gedrag signaal." },
  gr_q4_text:           { en: "What does the Bundle Attack Detector check for?", nl: "Wat controleert de Bundle Aanval Detector?" },
  gr_q4_a:              { en: "Whether the token is listed on multiple exchanges", nl: "Of het token op meerdere beurzen staat" },
  gr_q4_b:              { en: "Bot-coordinated buys at launch that could dump on retail later", nl: "Bot-gecoördineerde aankopen bij lancering die later op retail gedumpt kunnen worden" },
  gr_q4_c:              { en: "Whether the smart contract has been formally audited", nl: "Of het smart contract formeel geauditeerd is" },
  gr_q4_ea:             { en: "❌ Multi-exchange listing has nothing to do with bundles. The Bundle Detector looks at launch-day wallet coordination.", nl: "❌ Multi-beurs notering heeft niets te maken met bundles. De Bundle Detector kijkt naar portemonnee-coördinatie op de lanceringsdag." },
  gr_q4_eb:             { en: "✅ Correct! Bundles are bot-coordinated buys at token launch. They accumulate early and dump on retail buyers who ape in later.", nl: "✅ Correct! Bundles zijn bot-gecoördineerde aankopen bij tokenlancering. Ze accumuleren vroeg en dumpen op retail kopers die later instappen." },
  gr_q4_ec:             { en: "❌ Smart contract audits are separate. Bundle detection analyzes on-chain transaction patterns at launch.", nl: "❌ Smart contract audits zijn apart. Bundle detectie analyseert on-chain transactiepatronen bij lancering." },
  gr_q5_text:           { en: "Freeze Authority is \"Active\" on a token you're holding. What is the real danger?", nl: "Freeze Autoriteit staat op \"Actief\" bij een token dat je houdt. Wat is het echte gevaar?" },
  gr_q5_a:              { en: "Nothing — Freeze Authority is always active on Solana tokens", nl: "Niets — Freeze Autoriteit is altijd actief bij Solana tokens" },
  gr_q5_b:              { en: "The developer can freeze your token balance and prevent you from selling", nl: "De ontwikkelaar kan jouw tokensaldo bevriezen en voorkomen dat je verkoopt" },
  gr_q5_c:              { en: "It means the token price is temporarily locked and won't move", nl: "Het betekent dat de tokenprijs tijdelijk vergrendeld is en niet beweegt" },
  gr_q5_ea:             { en: "❌ Freeze Authority is not always active. When renounced, no one can freeze tokens. When active — the developer can.", nl: "❌ Freeze Autoriteit is niet altijd actief. Als het is opgegeven, kan niemand tokens bevriezen. Als het actief is — de ontwikkelaar kan dat wel." },
  gr_q5_eb:             { en: "✅ Correct! An active Freeze Authority means the developer can freeze any wallet's tokens, blocking you from selling. It's a serious red flag.", nl: "✅ Correct! Een actieve Freeze Autoriteit betekent dat de ontwikkelaar de tokens van elke portemonnee kan bevriezen, waardoor je niet kunt verkopen. Het is een ernstige rode vlag." },
  gr_q5_ec:             { en: "❌ Freeze Authority doesn't lock the price — it locks individual token accounts. You could end up holding tokens you can never sell.", nl: "❌ Freeze Autoriteit vergrendelt de prijs niet — het vergrendelt individuele tokenaccounts. Je kunt eindigen met tokens die je nooit kunt verkopen." },
  gr_submit_btn:        { en: "Submit Answers →",        nl: "Antwoorden Indienen →" },
  gr_quiz_progress_init:{ en: "Answer all 5 questions to continue", nl: "Beantwoord alle 5 vragen om door te gaan" },
  gr_result_pass:       { en: "🌕 Passed! You're a certified scanner.", nl: "🌕 Geslaagd! Je bent een gecertificeerde scanner." },
  gr_result_fail:       { en: "Not quite — you need 4/5 to pass. Review the chapters and try again.", nl: "Niet helemaal — je hebt 4/5 nodig om te slagen. Bekijk de hoofdstukken opnieuw en probeer het opnieuw." },
  gr_fail_review:       { en: "Review the chapters above and try again — you've got this.", nl: "Bekijk de hoofdstukken hierboven en probeer het opnieuw — je kunt het!" },
  gr_retry_btn:         { en: "🔄 Try Again",            nl: "🔄 Opnieuw Proberen" },
  gr_badge_certified:   { en: "Certified",               nl: "Gecertificeerd" },
  gr_badge_user:        { en: "Scan2Moon User",          nl: "Scan2Moon Gebruiker" },
  gr_badge_course:      { en: "Risk Scanner Masterclass", nl: "Risico Scanner Meesterklas" },
  gr_badge_footer_text: { en: "SCAN2MOON.COM · POWERED BY ON-CHAIN DATA", nl: "SCAN2MOON.COM · AANGEDREVEN DOOR ON-CHAIN DATA" },
  gr_share_x_btn:       { en: "𝕏 Share on X",           nl: "𝕏 Delen op X" },
  gr_save_image_btn:    { en: "💾 Save as Image",        nl: "💾 Opslaan als Afbeelding" },
  gr_scan_first_btn:    { en: "🛡️ Scan Your First Token", nl: "🛡️ Scan Je Eerste Token" },
  gr_screenshot_hint:   { en: "💡 Take a screenshot of the badge above to share it", nl: "💡 Maak een schermafbeelding van de badge hierboven om het te delen" },
  gr_footer_question:   { en: "Want to explore more tools?", nl: "Wil je meer tools ontdekken?" },
  gr_footer_back:       { en: "← Back to All Guides",   nl: "← Terug naar Alle Gidsen" },
  gr_footer_scanner:    { en: "🛡️ Open Risk Scanner →", nl: "🛡️ Open Risico Scanner →" },

  /* ── Guide: Score ranges ── */
  gr_ch2_sr_moon_label: { en: "80–100 🌕",               nl: "80–100 🌕" },
  gr_ch2_sr_moon_desc:  { en: "Moon Coin — strong signals, healthy liquidity, low rug risk. You're in good shape.", nl: "Moon Munt — sterke signalen, gezonde liquiditeit, laag rug risico. Je zit goed." },
  gr_ch2_sr_good_label: { en: "65–79",                   nl: "65–79" },
  gr_ch2_sr_good_desc:  { en: "Low Risk — solid overall picture. Watch for any weak individual signals.", nl: "Laag Risico — solide algeheel beeld. Let op zwakke individuele signalen." },
  gr_ch2_sr_warn_label: { en: "45–64",                   nl: "45–64" },
  gr_ch2_sr_warn_desc:  { en: "Moderate Risk — mixed signals. Trade carefully and size your position accordingly.", nl: "Matig Risico — gemengde signalen. Handel voorzichtig en pas je positie aan." },
  gr_ch2_sr_high_label: { en: "25–44",                   nl: "25–44" },
  gr_ch2_sr_high_desc:  { en: "High Rug Risk — multiple red flags. Not recommended unless you know the project well.", nl: "Hoog Rug Risico — meerdere rode vlaggen. Niet aanbevolen tenzij je het project goed kent." },
  gr_ch2_sr_ext_label:  { en: "0–24 🚨",                 nl: "0–24 🚨" },
  gr_ch2_sr_ext_desc:   { en: "Extreme Risk — serious danger signs. Avoid unless you are prepared to lose everything.", nl: "Extreem Risico — ernstige gevaarstekens. Vermijd tenzij je bereid bent alles te verliezen." },

  /* ── Guide: Red flags ── */
  gr_ch4_rf1_title:     { en: "Score below 30 / Extreme Risk",         nl: "Score onder 30 / Extreem Risico" },
  gr_ch4_rf1_body:      { en: "Multiple systems are flagging danger. This is not a \"hidden gem\" — the on-chain data is warning you clearly.", nl: "Meerdere systemen signaleren gevaar. Dit is geen \"verborgen pareltje\" — de on-chain data waarschuwt je duidelijk." },
  gr_ch4_rf2_title:     { en: "LP Strength under 30 / 100",            nl: "LP Sterkte onder 30 / 100" },
  gr_ch4_rf2_body:      { en: "Very weak liquidity. One whale sell can wipe the pool. You may not be able to exit at any reasonable price.", nl: "Zeer zwakke liquiditeit. Één walvis verkoop kan de pool leegmaken. Je kunt mogelijk niet uitstappen tegen een redelijke prijs." },
  gr_ch4_rf3_title:     { en: "Freeze Authority: Active",              nl: "Freeze Autoriteit: Actief" },
  gr_ch4_rf3_body:      { en: "The developer can freeze your wallet balance and block you from selling at any time, for any reason, with no warning.", nl: "De ontwikkelaar kan je portemonnee saldo bevriezen en je op elk moment, om welke reden dan ook, zonder waarschuwing blokkeren van verkopen." },
  gr_ch4_rf4_title:     { en: "Token under 10 minutes old",            nl: "Token jonger dan 10 minuten" },
  gr_ch4_rf4_body:      { en: "Brand-new tokens have no track record. The first few minutes are the highest-risk window — bots and bundlers are most active here.", nl: "Gloednieuwe tokens hebben geen trackrecord. De eerste paar minuten zijn het hoogste risicovenster — bots en bundlers zijn hier het actiefst." },
  gr_ch4_rf5_title:     { en: "Pump.fun Launch Risk scores below 40",  nl: "Pump.fun Lanceerrisico scoort onder 40" },
  gr_ch4_rf5_body:      { en: "Token is still on (or recently left) the pump.fun bonding curve. The \"liquidity\" may not be real exit liquidity. Check if it has graduated to Raydium or Meteora.", nl: "Token staat nog op (of heeft recent de) pump.fun bondingcurve verlaten. De \"liquiditeit\" is mogelijk geen echte uitstapliquiditeit. Controleer of het is afgestudeerd naar Raydium of Meteora." },
  gr_ch4_rf6_title:     { en: "Bundle Attack Score below 40",          nl: "Bundle Aanval Score onder 40" },
  gr_ch4_rf6_body:      { en: "Coordinated bot buys at launch were detected. These wallets will dump when the price is high enough. You are likely buying from them right now.", nl: "Gecoördineerde botaankopen bij lancering zijn gedetecteerd. Deze portemonnees zullen dumpen als de prijs hoog genoeg is. Je koopt waarschijnlijk nu van hen." },
  gr_ch4_rf7_title:     { en: "Dev Holdings above 15%",               nl: "Ontwikkelaar bezit boven 15%" },
  gr_ch4_rf7_body:      { en: "The developer controls a large portion of supply. A single sell from their wallet can crash the price significantly.", nl: "De ontwikkelaar controleert een groot deel van het aanbod. Één verkoop vanuit hun portemonnee kan de prijs aanzienlijk laten crashen." },
  gr_ch4_rf8_title:     { en: "Top 10 holders above 70%",              nl: "Top 10 houders boven 70%" },
  gr_ch4_rf8_body:      { en: "A handful of wallets own most of the supply. Price is extremely susceptible to coordinated dumping by any one of them.", nl: "Een handvol portemonnees bezit het grootste deel van het aanbod. De prijs is extreem gevoelig voor gecoördineerd dumpen door een van hen." },

  /* ── Guide: Quiz additional ── */
  gr_result_fail_sub:   { en: "Review the chapters above and try again — you've got this.", nl: "Bekijk de hoofdstukken hierboven opnieuw en probeer het opnieuw — je kunt dit." },
  gr_quiz_progress_all: { en: "All answered — click Submit!", nl: "Alles beantwoord — klik op Indienen!" },

  /* ── Footer ── */
  footer_disclaimer:     { en: "Informational tool only. Always DYOR.",
                           nl: "Alleen informatief. Doe altijd je eigen onderzoek." },
  footer_powered:        { en: "Powered by Scan2Moon",      nl: "Aangedreven door Scan2Moon" },

  /* ── Common UI ── */
  on_chain_verified:   { en: "On-chain verified",          nl: "On-chain geverifieerd" },
  solana_rpc:          { en: "Solana RPC",                 nl: "Solana RPC" },
  view_dexscreener:    { en: "View live chart on DexScreener →", nl: "Bekijk live grafiek op DexScreener →" },
  real_time_data:      { en: "Real-time data · DexScreener", nl: "Real-time data · DexScreener" },
  loading:             { en: "Loading…",                   nl: "Laden…" },
  error_no_data:       { en: "⚠️ Could not fetch market data", nl: "⚠️ Marktdata kon niet worden opgehaald" },
};

/* ── Active language ─────────────────────────────────────────── */
let _lang = localStorage.getItem("s2m_lang") || "en";

export function getCurrentLang() { return _lang; }

/* ── Translate a key ──────────────────────────────────────────── */
export function t(key, fallback) {
  const entry = DICT[key];
  if (!entry) return fallback ?? key;
  return entry[_lang] ?? entry["en"] ?? fallback ?? key;
}

/* ── Apply translations to all data-i18n elements in the DOM ── */
export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    /* For inputs use placeholder, for everything else use textContent */
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });

  /* data-i18n-html: allows HTML markup inside translations (safe — only hardcoded DICT values) */
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    const key = el.getAttribute("data-i18n-html");
    el.innerHTML = t(key);
  });

  /* Update html lang attribute */
  document.documentElement.lang = _lang === "nl" ? "nl" : "en";

  /* Update active state on flag buttons */
  document.querySelectorAll(".lang-flag-btn").forEach(btn => {
    btn.classList.toggle("lang-active", btn.dataset.lang === _lang);
  });

  /* Dispatch event so pages can react and re-render dynamic content */
  window.dispatchEvent(new CustomEvent("langchange", { detail: { lang: _lang } }));
}

/* ── Set language and persist ─────────────────────────────────── */
export function setLang(lang) {
  if (!["en", "nl"].includes(lang)) return;
  _lang = lang;
  localStorage.setItem("s2m_lang", lang);
  applyTranslations();
}

/* ── Auto-apply on module load ────────────────────────────────── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyTranslations);
} else {
  applyTranslations();
}
