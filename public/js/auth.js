(() => {
  for (const form of document.querySelectorAll('[data-registration-form]')) {
    const select = form.querySelector('[data-account-type]');
    const sync = () => {
      const faculty = select.value === 'faculty';
      form.querySelector('[data-id-label]').textContent = faculty ? 'Faculty ID' : 'Student ID';
      for (const element of form.querySelectorAll('[data-student-only]')) {
        element.hidden = faculty;
        for (const input of element.querySelectorAll('input,select')) { input.disabled = faculty; input.required = !faculty; }
      }
      form.querySelector('[data-faculty-note]').hidden = !faculty;
      const container = form.closest('[data-registration-container]') || form.parentElement;
      const google = container.querySelector('[data-google-register]');
      if (google) google.href = '/auth/google?intent=register&role=' + select.value;
    };
    select.addEventListener('change', sync); sync();
  }
  for (const button of document.querySelectorAll('[data-toggle-password]')) button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input'); const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; button.textContent = show ? 'Hide' : 'Show'; button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
})();
