(() => {
  const panel = document.querySelector("[data-course-job]");
  if (!panel) return;
  const text = panel.querySelector("[data-job-status]"),
    progress = panel.querySelector("progress"),
    actions = panel.querySelector("[data-job-actions]"),
    retry = panel.querySelector("[data-job-retry]");
  let stopped = false,
    retryAt = null,
    resuming = false;
  const resume = panel.querySelector("[data-job-resume]"),
    details = panel.querySelector("[data-job-details]"),
    blueprintPanel = panel.querySelector("[data-blueprint-review]"),
    blueprintForm = panel.querySelector("[data-blueprint-form]");
  const escape = value => String(value ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function showBlueprint(data) {
    stopped = true; progress.hidden = true; blueprintPanel.hidden = false;
    panel.querySelector("h2").textContent = "Review your course outline";
    text.textContent = "The source review and blueprint are ready. Edit or confirm them before full course generation.";
    const b = data.blueprint || {}, fields = blueprintPanel.querySelector("[data-blueprint-fields]");
    fields.innerHTML = `<label class="field">Course title<input name="title" required maxlength="160" value="${escape(b.title)}"></label><label class="field">Description<textarea name="description" required maxlength="2000" rows="3">${escape(b.description)}</textarea></label><label class="field">Learning outcomes · one per line<textarea name="outcomes" required rows="5">${escape((b.outcomes||[]).join("\n"))}</textarea></label><fieldset class="field"><legend>Competency areas</legend>${(data.options?.competencyAreas||b.competencyAreas||[]).map(a=>`<label class="check-label"><input type="checkbox" name="competencyAreas" value="${escape(a)}" ${b.competencyAreas?.includes(a)?"checked":""}>${escape(a)}</label>`).join("")}</fieldset>${(b.modules||[]).map((m,i)=>`<article class="editor-block"><h3>Topic Area ${i+1}</h3><label class="field">Topic area title<input name="moduleTitle" required maxlength="160" value="${escape(m.title)}"></label><label class="field">Topic area learning outcomes · one per line<textarea name="moduleOutcomes" required rows="3">${escape((m.outcomes||[]).join("\n"))}</textarea></label><input type="hidden" name="moduleReference" value="${escape(m.sourceReference)}"><p class="small muted">Source evidence: ${escape(m.sourceReference)}</p>${m.sourceNeedsReview?'<p class="notice info">No searchable source text matched this topic area. Review its content against your source material before publishing.</p>':''}</article>`).join("")}`;
  }
  blueprintForm?.addEventListener("submit", async event => {
    event.preventDefault(); const button=blueprintForm.querySelector('button[type="submit"]'),error=blueprintPanel.querySelector("[data-blueprint-error]");
    button.disabled=true; error.textContent="Approving blueprint and starting course generation…";
    try { const token=document.querySelector("meta[name=csrf-token]").content; const response=await fetch(panel.dataset.courseJob+"/approve-blueprint",{method:"POST",headers:{"X-CSRF-Token":token,"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(new FormData(blueprintForm))}); const result=await response.json(); if(!response.ok||!result.ok)throw Error(result.message||"Blueprint could not be approved."); location.assign(result.redirect); }
    catch(error){error.textContent=error.message;button.disabled=false;}
  });
  async function poll() {
    if (stopped || document.hidden) return;
    try {
      const response = await fetch(panel.dataset.courseJob, {
          headers: { Accept: "application/json" },
        }),
        data = await response.json();
      if (!response.ok || !data.ok)
        throw Error(data.message || "Sign in again to check generation.");
      const phases = { queued: "Queued", running: "Generating", generating: "Generating",
        validating: "Validating", retry: "Retrying", repair: "Retrying missing items",
        waiting: "Waiting to retry", fallback: "Trying backup provider", failed: "Paused", completed: "Complete" };
      if (details) {
        const counts = data.counts;
        details.textContent = [
          phases[data.phase] || "Preparing draft",
          `${data.completed || 0} of ${data.total || 0} source batches saved`,
          [data.provider, data.model].filter(Boolean).join(" / "),
          counts && `Requested: ${counts.requestedTopics ? `${counts.requestedTopics} topics, ` : ""}${counts.requestedQuestions} questions. Generated: ${counts.generatedTopics} topics, ${counts.generatedQuestions} questions.`,
          data.code, data.failureStage, data.reference && `Reference ${data.reference}`
        ].filter(Boolean).join(" · ");
      }
      if (data.total) {
        progress.max = data.total;
        progress.value = data.completed || 0;
      }
      if (data.status === "review" && data.phase === "blueprint-review") { showBlueprint(data); disconnect(); return; }
      if (data.status === "completed") {
        stopped = true;
        panel.querySelector("h2").textContent =
          data.moduleTitle ? `${data.moduleTitle} is ready for review` : "Your course is ready for review";
        text.textContent =
          data.moduleTitle ? "Review the topic areas and assessment in the module draft." :
          "Your course draft is ready. Review the lessons, questions and answers before submitting.";
        progress.value = 1;
        progress.max = 1;
        actions.hidden = false;
        const preview = actions.querySelector("[data-job-preview]");
        if (preview) preview.href = data.preview;
        actions.querySelector("[data-job-edit]").href = data.redirect;
      } else if (data.status === "failed") {
        stopped = true;
        panel.querySelector("h2").textContent = "Generation paused";
        retryAt = data.retryAt;
        if (resume) resume.hidden = !data.canResume;
        text.textContent =
          data?.message ||
          "Generation did not finish. Your source collection is saved.";
        progress.hidden = !data.completed;
        retry.hidden = false;
      } else {
        text.textContent =
          data?.message ||
          "Analyzing your saved materials. You can leave this page and return from generation history.";
        if (data.total) {
          progress.max = data.total;
          progress.value = data.completed || 0;
        }
      }
    } catch (error) {
      text.textContent = `${error.message} Retrying status check…`;
    }
  }
  function updateRetry() {
    if (!resume || resume.hidden) return;
    const seconds = retryAt
      ? Math.max(0, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000))
      : 0;
    resume.disabled = seconds > 0 || resuming;
    resume.textContent = resuming
      ? "Resuming…"
      : seconds
        ? `Resume available in ${seconds}s`
        : "Resume generation";
  }
  setInterval(updateRetry, 1000);
  resume?.addEventListener("click", async () => {
    resuming = true;
    resume.disabled = true;
    try {
      const response = await fetch(panel.dataset.courseJob + "/retry", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": document.querySelector("meta[name=csrf-token]")
            .content,
        },
        body: new URLSearchParams({
          _csrf: document.querySelector("meta[name=csrf-token]").content,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        retryAt = data?.retryAt || retryAt;
        throw Error(
          data?.message ||
            "Could not resume. Open the saved materials and retry.",
        );
      }
      location.assign(data.redirect);
    } catch (error) {
      resuming = false;
      text.textContent = error.message;
      updateRetry();
    }
  });
  let channel,
    fallbackTimer,
    reading = false,
    pending = false,
    closed = false;
  function disconnect() {
    closed = true;
    channel?.close();
    clearInterval(fallbackTimer);
  }
  async function refresh() {
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      do {
        pending = false;
        await poll();
      } while (pending && !stopped);
    } finally {
      reading = false;
    }
    if (stopped) disconnect();
  }
  function startEvents() {
    if (closed) return;
    if (!window.EventSource) {
      fallbackTimer = setInterval(refresh, 5000);
      return;
    }
    channel = new EventSource(panel.dataset.courseJob + "/events");
    channel.onmessage = refresh;
    channel.onerror = () => {
      if (!fallbackTimer) fallbackTimer = setInterval(refresh, 5000);
    };
    channel.onopen = () => {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
      refresh();
    };
  }
  async function connect() {
    await refresh();
    if (closed) return;
    try {
      const token = document.querySelector("meta[name=csrf-token]").content;
      const response = await fetch(panel.dataset.courseJob + "/ticket", {
        method: "POST",
        headers: { "X-CSRF-Token": token },
      });
      if (!response.ok) throw Error();
      const { ticket } = await response.json();
      if (closed) return;
      const url = new URL("/faculty/live", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      channel = new WebSocket(url, ticket);
      const timeout = setTimeout(() => channel.close(), 5000);
      channel.onopen = () => clearTimeout(timeout);
      channel.onmessage = refresh;
      channel.onclose = () => {
        clearTimeout(timeout);
        startEvents();
      };
    } catch {
      startEvents();
    }
  }
  connect();
  window.addEventListener("pagehide", disconnect, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
})();

