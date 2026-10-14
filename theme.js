// 화면이 그려지기 전에 테마를 정한다 (깜빡임 방지)
(function () {
  var KEY = 'bw.theme';
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* 무시 */ }
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    document.documentElement.setAttribute('data-theme', saved || (media.matches ? 'dark' : 'light'));
    window.dispatchEvent(new Event('bw-theme'));
  }
  apply();
  media.addEventListener('change', function () { if (!saved) apply(); });
  window.bwTheme = {
    toggle: function () {
      saved = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, saved); } catch (e) { /* 무시 */ }
      apply();
    },
  };
})();
