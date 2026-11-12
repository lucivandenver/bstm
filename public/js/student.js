(() => {
  const side = document.getElementById('sidebar');
  const open = document.getElementById('open-menu');
  const close = document.getElementById('close-menu');
  open?.addEventListener('click', () => { side.classList.add('open'); open.setAttribute('aria-expanded', 'true'); close.focus(); });
  const closeMenu = () => { side?.classList.remove('open'); open?.setAttribute('aria-expanded', 'false'); open?.focus(); };
  close?.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && side?.classList.contains('open')) closeMenu(); });
  for (const button of document.querySelectorAll('[data-open-award]')) {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.openAward);
      if (dialog && !dialog.open) dialog.showModal();
    });
  }
  for (const button of document.querySelectorAll('[data-share-badge]')) {
    button.addEventListener('click', async () => {
      const url = new URL(button.dataset.shareBadge, location.href).href;
      const status = button.closest('dialog').querySelector('[data-share-status]');
      try {
        if (navigator.share) await navigator.share({ title: 'CareerBridge badge', url });
        else {
          await navigator.clipboard.writeText(url);
          status.textContent = 'Badge link copied.';
        }
      } catch (error) {
        if (error.name !== 'AbortError') status.textContent = 'Open the badge to copy its link.';
      }
    });
  }
  for (const link of document.querySelectorAll('[data-download-certificate]')) {
    link.addEventListener('click', () => {
      const download = document.createElement('a');
      download.href = link.dataset.downloadCertificate;
      download.download = '';
      document.body.append(download);
      download.click();
      download.remove();
    });
  }
  // Count only estimated active browser time. Hidden or idle tabs stop sending activity.
  const learning = document.querySelector('[data-attempt]');
  if (learning) {
    let lastInteraction = Date.now();
    for (const event of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(event, () => { lastInteraction = Date.now(); }, { passive: true });
    const status = document.getElementById('save-status');
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden || Date.now() - lastInteraction > 60000) return;
      busy = true;
      try {
        const response = await fetch(`/student/learn/${learning.dataset.attempt}/heartbeat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content }, body: '{}'
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Not saved');
        await response.json();
        status.textContent = 'Learning activity synced';
      } catch { status.textContent = 'Activity sync paused · Check your connection'; }
      finally { busy = false; }
    };
    tick(); setInterval(tick, 20000);
  }
  for (const form of document.querySelectorAll('form[data-quiz]:not([data-draft-url])')) {
    const label = form.querySelector('.quiz-draft');
    form.addEventListener('change', () => {
      const answered = new Set([...form.querySelectorAll('input[type=radio]:checked')].map(input => input.name)).size;
      const total = form.querySelectorAll('fieldset').length;
      label.textContent = `${answered} of ${total} questions answered in this tab. Submit to save the graded result.`;
    });
    form.addEventListener('submit', () => { const button = form.querySelector('button[type=submit],button'); button.disabled = true; button.textContent = 'Saving results…'; });
  }
  for (const form of document.querySelectorAll('[data-ai-form]')) {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]') || form.querySelector('button');
      const loading = form.querySelector('[data-ai-loading]');
      if (loading) {
        loading.hidden = false;
        form.setAttribute('aria-busy', 'true');
        const status = loading.querySelector('[data-ai-status]');
        const messages = ['Mapping your BSTM strengths…', 'Checking career matches…', 'Preparing your recommendations…'];
        let index = 0;
        window.setInterval(() => { index = (index + 1) % messages.length; if (status && !loading.hidden) status.textContent = messages[index]; }, 1800);
      }
      if (button) { button.disabled = true; button.textContent = 'Finding career matches…'; }
    });
  }
})();

for (const navigation of document.querySelectorAll('.assessment-topic-actions')) {
  const form = navigation.closest('form');
  const topics = [...form.querySelectorAll('[data-assessment-topic]')];
  const submit = form.querySelector('[data-topic-submit]');
  if (!submit || submit.disabled) continue;
  if (submit.matches('a')) {
    submit.addEventListener('click', event => {
      const unanswered = form.querySelector('[data-assessment-topic]:not([hidden]) input:invalid');
      if (unanswered) {
        event.preventDefault();
        unanswered.reportValidity();
      }
    });
  }
  if (topics.length < 2) continue;

  const back = navigation.querySelector('[data-topic-back]');
  const next = navigation.querySelector('[data-topic-next]');
  const status = navigation.querySelector('[data-topic-status]');
  let current = Math.max(0, topics.findIndex(topic => topic.id === `topic-${form.dataset.activeTopic}`));
  function showTopic(focus = false) {
    topics.forEach((topic, index) => { topic.hidden = index !== current; });
    back.disabled = current === 0;
    next.hidden = current === topics.length - 1;
    submit.hidden = !next.hidden;
    status.textContent = `Topic ${current + 1} of ${topics.length}`;
    if (focus) topics[current].querySelector('h2')?.focus();
  }
  navigation.hidden = false;
  showTopic();
  back.addEventListener('click', () => { current--; showTopic(true); });
  next.addEventListener('click', () => {
    const unanswered = topics[current].querySelector('input:invalid');
    if (unanswered) return unanswered.reportValidity();
    current++;
    showTopic(true);
  });
  form.addEventListener('invalid', event => {
    const index = topics.indexOf(event.target.closest('[data-assessment-topic]'));
    if (index < 0 || !topics[index].hidden) return;
    current = index;
    showTopic();
  }, true);
}

for (const form of document.querySelectorAll('[data-inline-topic]')) {
  const outline = [...document.querySelectorAll('[data-outline-quiz]')]
    .find(link => link.dataset.outlineQuiz === form.dataset.inlineTopic);
  form.addEventListener('draftsaved', () => {
    if (!outline || [...form.querySelectorAll('fieldset')].some(question => !question.querySelector('input:checked'))) return;
    const circle = outline.querySelector('.check-circle');
    circle.classList.remove('is-empty');
    circle.classList.add('is-complete');
    circle.textContent = '✓';
    outline.querySelector('[data-topic-state]').textContent = 'Answered';
  });
}
