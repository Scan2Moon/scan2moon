/* skin-global.js — loaded in <head> on every page
   Applies Neon Degen skin + injects side art panels */
(function () {
  var nd = false;
  try { nd = localStorage.getItem('s2m_dash_skin') === 'neon_degen'; } catch (e) {}

  /* Apply data-skin to <html> immediately (body not yet available) */
  if (nd) document.documentElement.dataset.skin = 'neon_degen';

  /* Load JetBrains Mono font only when neon_degen skin is active.
     Done here (in <head>) so the font request fires as early as possible. */
  if (nd) {
    var fl = document.createElement('link');
    fl.rel  = 'stylesheet';
    fl.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap';
    document.head.appendChild(fl);
  }

  /* Also apply to body once DOM is ready */
  function applyToBody() {
    if (nd) {
      document.body.dataset.skin = 'neon_degen';
      inject();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToBody);
  } else {
    applyToBody();
  }

  if (!nd) return;

  /* ── Side art injection ───────────────────────────────────── */
  function inject() {
    if (document.getElementById('nd-left-art')) return;

    var left = document.createElement('div');
    left.id = 'nd-left-art';
    left.className = 'nd-side-art nd-side-left';
    left.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 900" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">'
      + '<defs><filter id="ndGlL" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<filter id="ndGlL2" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<linearGradient id="ndCF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c840ff" stop-opacity="0.5"/><stop offset="100%" stop-color="#c840ff" stop-opacity="0"/></linearGradient></defs>'
      + '<line x1="50" y1="105" x2="50" y2="810" stroke="rgba(200,64,255,0.10)" stroke-dasharray="4,7" stroke-width="0.5"/><line x1="100" y1="105" x2="100" y2="810" stroke="rgba(200,64,255,0.10)" stroke-dasharray="4,7" stroke-width="0.5"/><line x1="150" y1="105" x2="150" y2="810" stroke="rgba(200,64,255,0.10)" stroke-dasharray="4,7" stroke-width="0.5"/>'
      + '<line x1="5" y1="270" x2="193" y2="270" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/><line x1="5" y1="350" x2="193" y2="350" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/><line x1="5" y1="430" x2="193" y2="430" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/><line x1="5" y1="510" x2="193" y2="510" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/><line x1="5" y1="590" x2="193" y2="590" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/><line x1="5" y1="670" x2="193" y2="670" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>'
      + '<text x="193" y="274" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.148</text><text x="193" y="354" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.141</text><text x="193" y="434" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.134</text><text x="193" y="514" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.127</text><text x="193" y="594" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.120</text><text x="193" y="674" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.113</text>'
      + '<line x1="20" y1="625" x2="20" y2="695" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="15" y="638" width="10" height="44" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="52" y1="562" x2="52" y2="628" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="47" y="575" width="10" height="44" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="68" y1="525" x2="68" y2="587" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="63" y="538" width="10" height="38" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="100" y1="478" x2="100" y2="540" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="95" y="490" width="10" height="40" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="116" y1="438" x2="116" y2="500" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="111" y="450" width="10" height="40" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="148" y1="392" x2="148" y2="452" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="143" y="404" width="10" height="40" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="164" y1="350" x2="164" y2="410" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="159" y="362" width="10" height="38" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="180" y1="308" x2="180" y2="368" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="175" y="320" width="10" height="38" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="36" y1="628" x2="36" y2="680" stroke="rgba(255,58,170,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="31" y="642" width="10" height="22" fill="rgba(255,58,170,0.55)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="84" y1="522" x2="84" y2="576" stroke="rgba(255,58,170,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="79" y="536" width="10" height="20" fill="rgba(255,58,170,0.55)" filter="url(#ndGlL)" rx="1"/>'
      + '<line x1="132" y1="440" x2="132" y2="492" stroke="rgba(255,58,170,0.45)" stroke-width="1" filter="url(#ndGlL)"/><rect x="127" y="452" width="10" height="16" fill="rgba(255,58,170,0.55)" filter="url(#ndGlL)" rx="1"/>'
      + '<path d="M 20,638 L 36,664 L 52,575 L 68,538 L 84,556 L 100,490 L 116,450 L 132,468 L 148,404 L 164,362 L 180,320" stroke="#c840ff" stroke-width="1.5" fill="none" filter="url(#ndGlL2)" opacity="0.85"/>'
      + '<path d="M 20,638 L 36,664 L 52,575 L 68,538 L 84,556 L 100,490 L 116,450 L 132,468 L 148,404 L 164,362 L 180,320 L 180,760 L 20,760 Z" fill="url(#ndCF)" opacity="0.12"/>'
      + '<line x1="5" y1="820" x2="193" y2="820" stroke="rgba(200,64,255,0.14)" stroke-width="0.5"/>'
      + '<rect x="15" y="790" width="10" height="30" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="31" y="802" width="10" height="18" fill="rgba(255,58,170,0.28)" rx="1"/><rect x="47" y="788" width="10" height="32" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="63" y="795" width="10" height="25" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="79" y="800" width="10" height="20" fill="rgba(255,58,170,0.28)" rx="1"/><rect x="95" y="792" width="10" height="28" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="111" y="796" width="10" height="24" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="127" y="806" width="10" height="14" fill="rgba(255,58,170,0.28)" rx="1"/><rect x="143" y="785" width="10" height="35" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="159" y="780" width="10" height="40" fill="rgba(57,255,20,0.28)" rx="1"/><rect x="175" y="774" width="10" height="46" fill="rgba(57,255,20,0.30)" rx="1"/>'
      + '<text x="100" y="48" font-size="11" fill="rgba(200,130,255,0.65)" text-anchor="middle" font-family="monospace" font-weight="bold" letter-spacing="2" filter="url(#ndGlL)">SOL/USDC</text>'
      + '<text x="100" y="66" font-size="8" fill="rgba(57,255,20,0.55)" text-anchor="middle" font-family="monospace">&#9650; +18.4% 24h</text>'
      + '<line x1="18" y1="86" x2="78" y2="86" stroke="rgba(200,64,255,0.22)" stroke-width="0.8"/><line x1="78" y1="86" x2="78" y2="100" stroke="rgba(200,64,255,0.22)" stroke-width="0.8"/><circle cx="18" cy="86" r="2" fill="rgba(200,64,255,0.55)" filter="url(#ndGlL)"/><circle cx="78" cy="86" r="2" fill="rgba(200,64,255,0.45)"/><line x1="118" y1="82" x2="182" y2="82" stroke="rgba(255,58,170,0.18)" stroke-width="0.8"/><circle cx="182" cy="82" r="2" fill="rgba(255,58,170,0.40)"/>'
      + '<line x1="18" y1="870" x2="80" y2="870" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/><circle cx="18" cy="870" r="1.5" fill="rgba(200,64,255,0.40)"/>'
      + '<text transform="translate(10,520) rotate(-90)" font-size="7" fill="rgba(200,64,255,0.28)" text-anchor="middle" font-family="monospace" letter-spacing="3">PRICE</text>'
      + '</svg>';
    document.body.appendChild(left);

    var right = document.createElement('div');
    right.id = 'nd-right-art';
    right.className = 'nd-side-art nd-side-right';
    right.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 900" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">'
      + '<defs><filter id="ndGlR" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<filter id="ndGlR2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<radialGradient id="ndMG" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgba(230,195,255,0.85)"/><stop offset="55%" stop-color="rgba(180,80,255,0.55)"/><stop offset="100%" stop-color="rgba(100,0,220,0.08)"/></radialGradient></defs>'
      + '<circle cx="28" cy="55" r="1" fill="rgba(255,255,255,0.60)"/><circle cx="72" cy="32" r="1.5" fill="rgba(210,150,255,0.70)"/><circle cx="145" cy="48" r="1" fill="rgba(255,255,255,0.50)"/><circle cx="175" cy="78" r="1.5" fill="rgba(230,190,255,0.60)"/><circle cx="50" cy="118" r="1" fill="rgba(255,255,255,0.40)"/><circle cx="18" cy="205" r="1" fill="rgba(255,255,255,0.40)"/><circle cx="165" cy="228" r="1.2" fill="rgba(230,190,255,0.55)"/><circle cx="88" cy="175" r="0.8" fill="rgba(255,255,255,0.50)"/><circle cx="125" cy="285" r="1" fill="rgba(210,150,255,0.45)"/><circle cx="38" cy="345" r="1" fill="rgba(255,255,255,0.35)"/><circle cx="182" cy="388" r="1.2" fill="rgba(230,190,255,0.50)"/><circle cx="12" cy="462" r="1" fill="rgba(255,255,255,0.38)"/><circle cx="60" cy="555" r="1" fill="rgba(255,255,255,0.30)"/>'
      + '<circle cx="100" cy="105" r="72" fill="rgba(150,0,255,0.06)" filter="url(#ndGlR2)"/>'
      + '<circle cx="100" cy="105" r="55" fill="url(#ndMG)" filter="url(#ndGlR)"/>'
      + '<circle cx="100" cy="105" r="55" fill="none" stroke="rgba(200,64,255,0.55)" stroke-width="1.2" filter="url(#ndGlR)"/>'
      + '<circle cx="82" cy="92" r="8" fill="rgba(80,0,180,0.30)" stroke="rgba(180,100,255,0.22)" stroke-width="0.7"/><circle cx="116" cy="108" r="5" fill="rgba(80,0,180,0.22)"/><circle cx="96" cy="120" r="4" fill="rgba(80,0,180,0.20)"/>'
      + '<g transform="translate(148,450) rotate(-42)" filter="url(#ndGlR)"><ellipse cx="0" cy="0" rx="9" ry="26" fill="rgba(192,64,255,0.72)" stroke="rgba(220,160,255,0.80)" stroke-width="1"/><path d="M -9,0 L 0,-36 L 9,0 Z" fill="rgba(255,58,170,0.72)"/><path d="M -9,16 L -22,34 L -9,26 Z" fill="rgba(160,30,240,0.65)"/><path d="M 9,16 L 22,34 L 9,26 Z" fill="rgba(160,30,240,0.65)"/><circle cx="0" cy="-3" r="5" fill="rgba(220,180,255,0.45)" stroke="rgba(230,200,255,0.72)" stroke-width="1"/></g>'
      + '<path d="M 158,490 Q 170,535 163,578 Q 175,620 167,660 Q 180,700 170,740" stroke="rgba(255,80,220,0.38)" stroke-width="3" fill="none" stroke-dasharray="3,5" filter="url(#ndGlR)"/>'
      + '<circle cx="164" cy="565" r="2.5" fill="rgba(255,58,170,0.72)" filter="url(#ndGlR)"/><circle cx="169" cy="618" r="1.8" fill="rgba(200,64,255,0.65)" filter="url(#ndGlR)"/><circle cx="162" cy="655" r="2" fill="rgba(255,58,170,0.55)" filter="url(#ndGlR)"/>'
      + '<text transform="translate(190,455) rotate(90)" font-size="8" fill="rgba(200,64,255,0.38)" font-family="monospace" letter-spacing="5" text-anchor="middle">TO THE MOON</text>'
      + '<line x1="8" y1="298" x2="70" y2="298" stroke="rgba(200,64,255,0.28)" stroke-width="0.8"/><circle cx="8" cy="298" r="2.5" fill="rgba(57,255,20,0.65)" filter="url(#ndGlR)"/><text x="14" y="295" font-size="6" fill="rgba(200,130,255,0.40)" font-family="monospace">BUY</text>'
      + '<line x1="8" y1="318" x2="52" y2="318" stroke="rgba(255,58,170,0.22)" stroke-width="0.8"/><circle cx="8" cy="318" r="2" fill="rgba(255,58,170,0.55)"/><text x="14" y="315" font-size="6" fill="rgba(255,130,190,0.38)" font-family="monospace">SELL</text>'
      + '<line x1="8" y1="338" x2="80" y2="338" stroke="rgba(200,64,255,0.22)" stroke-width="0.8"/><circle cx="8" cy="338" r="2.5" fill="rgba(57,255,20,0.55)" filter="url(#ndGlR)"/><text x="14" y="335" font-size="6" fill="rgba(200,130,255,0.38)" font-family="monospace">BUY</text>'
      + '<g transform="translate(76,748)" filter="url(#ndGlR)" opacity="0.72"><line x1="-32" y1="10" x2="32" y2="-6" stroke="rgba(200,64,255,0.80)" stroke-width="3" stroke-linecap="round"/><line x1="-32" y1="-4" x2="32" y2="-20" stroke="rgba(200,64,255,0.80)" stroke-width="3" stroke-linecap="round"/><line x1="-32" y1="24" x2="32" y2="8" stroke="rgba(200,64,255,0.80)" stroke-width="3" stroke-linecap="round"/></g>'
      + '<g transform="translate(118,800)" filter="url(#ndGlR)" opacity="0.52"><rect x="-18" y="-18" width="36" height="38" rx="6" fill="none" stroke="rgba(255,58,170,0.62)" stroke-width="1.5"/><rect x="-6" y="-48" width="13" height="32" rx="4" fill="none" stroke="rgba(255,58,170,0.62)" stroke-width="1.5"/><rect x="10" y="-43" width="10" height="28" rx="4" fill="none" stroke="rgba(200,64,255,0.62)" stroke-width="1.5"/><rect x="-29" y="-8" width="13" height="20" rx="4" fill="none" stroke="rgba(200,64,255,0.62)" stroke-width="1.5"/></g>'
      + '<text x="100" y="862" font-size="14" fill="rgba(200,64,255,0.48)" text-anchor="middle" font-family="monospace" font-weight="bold" letter-spacing="4" filter="url(#ndGlR)">DEGEN</text>'
      + '<line x1="128" y1="14" x2="188" y2="14" stroke="rgba(200,64,255,0.20)" stroke-width="0.8"/><line x1="188" y1="14" x2="188" y2="52" stroke="rgba(200,64,255,0.20)" stroke-width="0.8"/><circle cx="128" cy="14" r="2" fill="rgba(200,64,255,0.45)" filter="url(#ndGlR)"/>'
      + '<line x1="18" y1="878" x2="82" y2="878" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/><circle cx="18" cy="878" r="1.8" fill="rgba(200,64,255,0.42)"/>'
      + '</svg>';
    document.body.appendChild(right);
    setTimeout(function() { left.style.opacity='1'; right.style.opacity='1'; }, 50);
  }
})();
