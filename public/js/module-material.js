(() => {
  const form = document.querySelector('[data-module-material]');
  if (!form) return;
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-material-status]');
  button.disabled = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = 'Uploading PDF…';
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'X-CSRF-Token': form.elements._csrf.value, Accept: 'application/json' },
        body: new FormData(form)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.redirect) {
        throw new Error(result.message || (response.status === 403 || response.redirected
          ? 'Reopen the editor or sign in again, then retry.'
          : 'The PDF could not be attached. Check the file and try again.'));
      }
      window.history.replaceState(null, "", result.redirect);
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
})();
