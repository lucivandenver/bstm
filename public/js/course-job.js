(() => {
  const panel = document.querySelector("[data-course-job]");
  if (!panel) return;
  const text = panel.querySelector("[data-job-status]"),
    progress = panel.querySelector("progress"),
    actions = panel.querySelector("[data-job-actions]"),
    retry = panel.querySelector("[data-job-retry]");
  let stopped = false, stream, timer;
  function render(data) {
      if (data.status === "completed") {
        stopped = true;
        stream?.close(); clearInterval(timer);
        panel.querySelector("h2").textContent =
          "Your course is ready for review";
        text.textContent =
          "Your course draft is ready, with lessons, questions, correct answers and explanations. Preview it or open the editor before publishing.";
        progress.value = 1;
        progress.max = 1;
        actions.hidden = false;
        actions.querySelector("[data-job-preview]").href = data.preview;
        actions.querySelector("[data-job-edit]").href = data.redirect;
      } else if (data.status === "failed") {
        stopped = true;
        stream?.close(); clearInterval(timer);
        text.textContent =
          data.message ||
          "Generation did not finish. Your source collection is saved.";
        progress.hidden = true;
        retry.hidden = false;
      } else {
        text.textContent =
          data.message ||
          "Analyzing your saved materials. You can leave this page and return from generation history.";
        if (data.total) {
          progress.max = data.total;
          progress.value = data.completed || 0;
        }
      }
  }
  async function poll() {
    if (stopped || document.hidden) return;
    try {
      const response = await fetch(panel.dataset.courseJob, { headers: { Accept: "application/json" } }), data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.message || "Sign in again to check generation.");
      render(data);
    } catch (error) { text.textContent = `${error.message} Retrying status check…`; }
  }
  if ("EventSource" in window && panel.dataset.courseStream) {
    stream = new EventSource(panel.dataset.courseStream);
    stream.addEventListener("progress", event => { try { render(JSON.parse(event.data)); } catch {} });
    stream.onerror = () => { stream.close(); if (!stopped) { text.textContent = "Reconnecting to live progress…"; timer = setInterval(poll, 3000); poll(); } };
  } else { timer = setInterval(poll, 2500); poll(); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();
