(() => {
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      })
      .catch(() => {});
  let deferred;
  const buttons = [...document.querySelectorAll("[data-pwa-install]")];
  const onLanding = () =>
    location.pathname === "/" && !document.querySelector(".workspace");
  const show = (value) => buttons.forEach((button) => (button.hidden = !value));
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const mac = !appleMobile && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)");
  const installed = () => navigator.standalone === true || standalone.matches;
  const canInstall = () => onLanding() && !installed();
  const refresh = () => show(canInstall() && Boolean(deferred || appleMobile || mac));
  refresh();
  standalone.addEventListener?.("change", refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    show(canInstall());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    show(false);
  });
  for (const button of buttons)
    button.addEventListener("click", async () => {
      if (!canInstall()) return;
      if (!deferred) {
        if (!appleMobile && !mac) return;
        const dialog = document.querySelector("[data-pwa-help]");
        const steps = appleMobile
          ? "Open CareerBridge in Safari. Tap Share, scroll down to Add to Home Screen, turn on Open as Web App if shown, then tap Add."
          : "Open CareerBridge in Safari. On macOS Sonoma or later, choose File → Add to Dock, then click Add.";
        if (!dialog?.showModal) {
          window.alert(steps);
          return;
        }
        dialog.querySelector("[data-pwa-steps]").textContent = steps;
        if (!dialog.open) dialog.showModal();
        return;
      }
      const prompt = deferred;
      deferred = null;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } finally {
        refresh();
      }
    });
})();
