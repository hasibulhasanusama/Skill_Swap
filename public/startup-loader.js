
(() => {
  const overlay = document.getElementById("ss-startup-loader");
  if (!overlay) return;

  const started = performance.now();
  let closing = false;

  function finish() {
    if (closing) return;
    closing = true;

    const delay = Math.max(0, 2000 - (performance.now() - started));

    setTimeout(() => {
      overlay.classList.add("ss-loader-finished");
      setTimeout(() => overlay.remove(), 350);
    }, delay);
  }

  window.addEventListener("ss-page-ready", finish, { once: true });

  document.addEventListener("DOMContentLoaded", () => {
    // Reuse the site's existing logo.
    const brandMark = document.querySelector("header .brand .mark");
    const logo = overlay.querySelector(".ss-loader-logo");

    if (brandMark && logo) {
      const copy = brandMark.cloneNode(true);
      copy.removeAttribute("id");
      copy.classList.add("ss-loader-brand-copy");
      logo.replaceChildren(copy);
    }
  }, { once: true });

  // Reveal the page even if a startup request or script fails.
  setTimeout(finish, 8000);
})();
