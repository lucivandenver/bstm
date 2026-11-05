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
    details = panel.querySelector("[data-job-details]");
  async function poll() {
    if (stopped || document.hidden) return;
    try {
      const response = await fetch(panel.dataset.courseJob, {
          headers: { Accept: "application/json" },
        }),
        data = await response.json();
      if (!response.ok || !data.ok)
        throw Error(data.message || "Sign in again to check generation.");
      if (details)
        details.textContent = `${data.completed || 0} of ${data.total || 0} sections saved${data.code ? " · " + data.code : ""}${data.reference ? " · Reference " + data.reference : ""}`;
      if (data.total) {
        progress.max = data.total;
        progress.value = data.completed || 0;
      }
      if (data.status === "completed") {
        stopped = true;
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
