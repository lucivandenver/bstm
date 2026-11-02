(() => {
  const form = document.querySelector("[data-course-generation]");
  if (!form) return;
  const error = form.querySelector("[data-generation-error]"),
    status = form.querySelector("[data-generation-status]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = event.submitter?.value || "ai";
    if (!form.elements.domain.value) {
      form.elements.domain.focus();
      form.elements.domain.reportValidity();
      return;
    }
    const body = new URLSearchParams(new FormData(form));
    body.set("mode", mode);
    const buttons = [...form.querySelectorAll("button")],
      disabled = buttons.map((b) => b.disabled);
    buttons.forEach((b) => (b.disabled = true));
    form.setAttribute("aria-busy", "true");
    error.hidden = true;
    status.textContent =
      mode === "manual"
        ? "Importing your saved source…"
        : "Generating and validating your draft. Keep this page open; this can take up to a minute…";
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
          data?.message
            ? `${data.message}${data.code ? " (" + data.code + ")" : ""}${data.reference ? " · Reference " + data.reference : ""}`
            : "The request could not finish. Check your connection or sign in again. Your saved source remains available.",
        );
      location.assign(data.redirect);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      status.textContent =
        "Your source and form inputs are retained. Review the message before retrying.";
    } finally {
      buttons.forEach((b, i) => (b.disabled = disabled[i]));
      form.removeAttribute("aria-busy");
    }
  });
})();
