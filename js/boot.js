/* Starts the site once every script has loaded. Offline support is switched on by the production build. */
/* Lab names also appear inside links and sentences, so the translator needs them too. */
RT.labs.forEach((l) => {
  const b = window.RTLabsBn[l.id];
  if (!b) return;
  if (b.title && !window.RTStrings[l.title]) window.RTStrings[l.title] = b.title;
  if (b.short && !window.RTStrings[l.short]) window.RTStrings[l.short] = b.short;
});
RT.start();
if ('serviceWorker' in navigator && document.documentElement.dataset.sw && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register(document.documentElement.dataset.sw).catch(() => {});
}
