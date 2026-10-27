(() => {
  const side = document.getElementById('sidebar');
  const open = document.getElementById('open-menu');
  const close = document.getElementById('close-menu');
  open?.addEventListener('click', () => { side.classList.add('open'); open.setAttribute('aria-expanded', 'true'); close.focus(); });
  const closeMenu = () => { side?.classList.remove('open'); open?.setAttribute('aria-expanded', 'false'); open?.focus(); };
  close?.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
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
  for (const form of document.querySelectorAll('form[data-quiz]')) {
    const label = form.querySelector('.quiz-draft');
    form.addEventListener('change', () => {
      const answered = new Set([...form.querySelectorAll('input[type=radio]:checked')].map(input => input.name)).size;
      const total = form.querySelectorAll('fieldset').length;
      label.textContent = `${answered} of ${total} questions answered in this tab. Submit to save the graded result.`;
    });
    form.addEventListener('submit', () => { const button = form.querySelector('button[type=submit],button'); button.disabled = true; button.textContent = 'Saving results…'; });
  }
  for (const form of document.querySelectorAll('[data-ai-form]')) {
    form.addEventListener('submit', () => { const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Generating guidance…'; });
  }
})();
