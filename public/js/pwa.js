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
  show(false);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    show(onLanding());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    show(false);
  });
  for (const button of buttons)
    button.addEventListener("click", async () => {
      if (!deferred || !onLanding()) return;
      const prompt = deferred;
      deferred = null;
      await prompt.prompt();
      await prompt.userChoice;
      show(false);
    });
})();
