(() => {
  for (const form of document.querySelectorAll("[data-signature-form]")) {
    const file = form.querySelector("[data-signature-file]"),
      hidden = form.querySelector("[data-signature-value]"),
      status = form.querySelector("[data-signature-status]");
    const previews = (form.closest("section") || form).querySelectorAll(
      "[data-course-signature-preview],[data-signature-preview]",
    );
    const initial = hidden.value;
    const initialPreviews = [...previews].map((preview) => ({
      preview,
      src: preview.getAttribute("src"),
      hidden: preview.hidden,
    }));
    let ready = !file.required || Boolean(initial),
      sequence = 0,
      busy = false;
    file.addEventListener("change", async () => {
      const token = ++sequence,
        selected = file.files?.[0];
      file.setCustomValidity("");
      busy = false;
      form.removeAttribute("aria-busy");
      ready = false;
      hidden.value = "";
      if (!selected) {
        for (const saved of initialPreviews) {
          if (saved.src) saved.preview.src = saved.src;
          else saved.preview.removeAttribute("src");
          saved.preview.hidden = saved.hidden;
        }
        hidden.value = initial;
        ready = !file.required || Boolean(initial);
        if (status) status.textContent = "";
        return;
      }
      const supportedType = /^image\/(png|jpeg|webp)$/.test(selected.type);
      const unknownType = !selected.type || selected.type === "application/octet-stream";
      const supportedName = /\.(png|jpe?g|webp)$/i.test(selected.name);
      if (!(supportedType || (unknownType && supportedName)) || selected.size > 4 * 1024 * 1024) {
        file.setCustomValidity(
          "Choose a PNG, JPEG or WebP signature up to 4 MB.",
        );
        file.reportValidity();
        return;
      }
      busy = true;
      form.setAttribute("aria-busy", "true");
      if (status) status.textContent = "Removing the paper background…";
      try {
        const body = new FormData();
        body.set("signature", selected);
        const csrf = form.querySelector("[name=_csrf]").value;
        const response = await fetch("/signatures/process", {
          method: "POST",
          headers: { Accept: "application/json", "X-CSRF-Token": csrf },
          body,
        });
        const data = await response.json().catch(() => null);
        if (token !== sequence) return;
        if (!response.ok || !data?.ok)
          throw new Error(
            data?.message ||
              "Signature processing failed. Sign in again or try a clearer image.",
          );
        hidden.value = data.signature;
        for (const preview of previews) {
          preview.src = data.signature;
          preview.hidden = false;
        }
        ready = true;
        if (status)
          status.textContent =
            "Transparent PNG ready. Check the preview before submitting.";
      } catch (error) {
        if (token !== sequence) return;
        file.setCustomValidity(error.message);
        if (status) status.textContent = error.message;
      } finally {
        if (token === sequence) {
          busy = false;
          form.removeAttribute("aria-busy");
        }
      }
    });
    form.addEventListener("submit", (event) => {
      if (busy || !ready) {
        event.preventDefault();
        file.setCustomValidity(
          busy
            ? "Wait for the signature preview before saving."
            : "Choose a clear signature image and wait for its preview.",
        );
        file.reportValidity();
        if (busy) file.setCustomValidity("");
      }
    });
  }
})();
