(() => {
  const matchLink = document.querySelector("[data-career-match-search]");
  const matchLoading = document.querySelector("[data-career-match-loading]");
  if (matchLink && matchLoading) {
    matchLink.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (matchLink.dataset.searching) return;
      matchLink.dataset.searching = "true";
      matchLink.setAttribute("aria-disabled", "true");
      matchLoading.hidden = false;
      matchLoading.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
      window.setTimeout(() => location.assign(matchLink.href), 850);
    });
  }
  const form = document.querySelector("[data-career-form]");
  if (!form) return;
  const button = form.querySelector("button[type=submit]"),
    loading = form.querySelector("[data-career-loading]"),
    error = form.querySelector("[data-career-error]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new URLSearchParams(new FormData(form));
    button.disabled = true;
    loading.hidden = false;
    error.hidden = true;
    form.setAttribute("aria-busy", "true");
    loading.scrollIntoView({
      block: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": body.get("_csrf"),
        },
        body,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok)
        throw new Error(
          data?.message ||
            "The request could not finish. Sign in again or retry; previous results are retained.",
        );
      location.assign(data.redirect);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      loading.hidden = true;
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
})();
