/* Skin loader: applies saved skin before first paint to avoid flash. */
(function () {
  try {
    var s = localStorage.getItem('s2m_dash_skin');
    if (s) document.body.dataset.skin = s;
  } catch (e) {}
})();
