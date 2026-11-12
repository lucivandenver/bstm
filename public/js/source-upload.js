(() => {
  const form = document.querySelector("[data-source-upload]");
  if (!form) return;
  const input = form.querySelector("[type=file]"),
    status = form.querySelector("[data-upload-status]"),
    list = form.querySelector("[data-upload-files]"),
    link = form.querySelector("[data-source-link]");
  const steps = [...form.querySelectorAll("[data-upload-step]")];
  const navigation = form.querySelector("[data-upload-navigation]");
  const actions = form.querySelector("[data-upload-submit]");
  const back = form.querySelector("[data-upload-back]");
  const next = form.querySelector("[data-upload-next]");
  let step = 0;
  function showStep() {
    steps.forEach((panel, index) => { panel.hidden = index !== step; });
    back.disabled = step === 0;
    next.hidden = step === steps.length - 1;
    actions.hidden = step !== steps.length - 1;
  }
  if (steps.length) {
    navigation.hidden = false;
    showStep();
    back.addEventListener("click", () => { step--; showStep(); });
    next.addEventListener("click", () => {
      const field = steps[step].querySelector("[required]");
      if (field && !field.reportValidity()) return;
      step++;
      showStep();
      steps[step].querySelector("input, select")?.focus();
    });
  }
  let sourceId = "",
    saved = new Set(),
    busy = false;
  const identity = (file) =>
    [file.name, file.size, file.lastModified].join(":");
  input.addEventListener("change", () => {
    list.replaceChildren();
    for (const file of input.files) {
      const row = document.createElement("li");
      row.textContent = `${file.name} · ${(file.size / 1048576).toFixed(2)} MB`;
      list.append(row);
    }
  });
  const upload = (file) =>
    new Promise((resolve, reject) => {
      const body = new FormData();
      body.set("sources", file);
      const fields = form.elements;
      body.set("settings", JSON.stringify({
        destinationId: fields.destinationId.value, moduleTitle: fields.moduleTitle.value,
        level: fields.level.value, topicCount: fields.topicCount.value, questionCount: fields.questionCount.value,
        outcomes: fields.outcomes.value,
        competencyAreas: [...form.querySelectorAll('[name="competencyAreas"]:checked')].map(input => input.value)
      }));
      if (sourceId) body.set("sourceId", sourceId);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", form.action);
      xhr.timeout = 180000;
      xhr.setRequestHeader("Accept", "application/x-ndjson, application/json");
      xhr.setRequestHeader("X-CSRF-Token", form.elements._csrf.value);
      let readAt = 0, partial = "", finalData = null;
      const consumeProgress = () => {
        const chunk = xhr.responseText.slice(readAt); readAt = xhr.responseText.length;
        const lines = (partial + chunk).split("\n"); partial = lines.pop() || "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.done) finalData = event;
            else if (event.phase === "extracting") status.textContent = event.total
              ? `${event.filename}: extracting text · ${event.current} of ${event.total} ${event.unit}`
              : `${event.filename}: upload received · starting text extraction…`;
          } catch {}
        }
      };
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          status.textContent = `${file.name}: uploading ${Math.round((e.loaded / e.total) * 100)}%`;
      };
      xhr.onload = () => {
        consumeProgress();
        let data = finalData;
        if (!data) try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data);
        else
          reject(
            new Error(
              data?.message ||
                "Upload was not confirmed. Sign in again or retry this file.",
            ),
          );
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "Connection interrupted. Retry; confirmed files stay in your collection.",
          ),
        );
      xhr.ontimeout = () =>
        reject(
          new Error(
            "Extraction took too long. Retry this file; confirmed files stay saved.",
          ),
        );
      xhr.onprogress = consumeProgress;
      xhr.send(body);
    });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || steps.length && step !== steps.length - 1) return;
    const generate = e.submitter?.value !== "extract";
    if (generate && !form.elements.topicCount.reportValidity()) return;
    if (generate && (!form.elements.destinationId.value || form.elements.moduleTitle.value.trim().length < 4)) {
      status.textContent = "Choose your course and enter a module title of at least four characters.";
      return;
    }
    if (
      generate &&
      (!form.querySelector('[name="competencyAreas"]:checked') ||
        !form.elements.consent.checked)
    ) {
      status.textContent =
        "Choose the competency area and confirm permission before AI generation.";
      return;
    }
    if (
      generate &&
      (!Number.isInteger(Number(form.elements.questionCount.value)) ||
        Number(form.elements.questionCount.value) < 3 ||
        Number(form.elements.questionCount.value) > 30)
    ) {
      status.textContent =
        "Choose 3–30 questions. Large collections may require one question per module.";
      return;
    }
    if (!input.files.length) {
      status.textContent = "Choose your related learning files first.";
      return;
    }
    busy = true;
    const buttons = [...form.querySelectorAll("button")];
    const disabled = buttons.map((button) => button.disabled);
    buttons.forEach((b) => (b.disabled = true));
    input.disabled = true;
    form.setAttribute("aria-busy", "true");
    list.replaceChildren();
    let failures = 0;
    try {
      for (const file of input.files) {
        const row = document.createElement("li");
        list.append(row);
        row.textContent = `${file.name} · waiting`;
        if (saved.has(identity(file))) {
          row.textContent = `${file.name} · already saved`;
          continue;
        }
        try {
          if (!/\.(pdf|docx|pptx|txt)$/i.test(file.name))
            throw new Error(
              "Use PDF, DOCX, PPTX or TXT. Save legacy DOC as DOCX first.",
            );
          if (file.size > 100 * 1048576)
            throw new Error("Maximum 100 MB per file.");
          const data = await upload(file);
          sourceId = String(data.sourceId);
          saved.add(identity(file));
          row.textContent = `${file.name} · extracted and saved`;
          link.href = data.redirect;
          link.hidden = false;
          form.dataset.dirty = "false";
        } catch (error) {
          failures++;
          row.textContent = `${file.name} · ${error.message}`;
        }
      }
      if (failures) {
        status.textContent = `${failures} file(s) need attention. Successful files are saved; retry skips those files. Generate after resolving errors, or open the saved collection.`;
        return;
      }
      if (!generate) {
        status.textContent =
          "All files saved. Open your collection to inspect the text or generate a course.";
        return;
      }
      status.textContent = "Starting AI analysis of all saved materials…";
      const body = new URLSearchParams({
        _csrf: form.elements._csrf.value,
        mode: "ai",
        background: "yes",

        destinationId: form.elements.destinationId.value,
        moduleTitle: form.elements.moduleTitle.value.trim(),
        level: form.elements.level.value,
        topicCount: form.elements.topicCount.value,
        questionCount: form.elements.questionCount.value,
        outcomes:
          form.elements.outcomes.value.trim() ||
          "Derive clear learning outcomes from all supplied teaching materials. Explain and assess their key concepts.",
        consent: "yes",
      });
      for (const box of form.querySelectorAll(
        '[name="competencyAreas"]:checked',
      ))
        body.append("competencyAreas", box.value);
      const response = await fetch(`/faculty/sources/${sourceId}/generate`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": form.elements._csrf.value,
        },
        body,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok)
        throw new Error(
          data?.message ||
            "Generation could not start. Your source collection is saved.",
        );
      location.assign(data.statusUrl || data.redirect);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      buttons.forEach((b, i) => (b.disabled = disabled[i]));
      input.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
})();

