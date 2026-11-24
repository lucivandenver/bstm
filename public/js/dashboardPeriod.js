for (const select of document.querySelectorAll('[data-period-select]')) {
  const fields = select.form.querySelectorAll('[data-custom-date]');
  const updateDates = () => {
    const custom = select.value === 'custom';
    for (const field of fields) {
      field.hidden = !custom;
      const input = field.querySelector('input');
      input.disabled = !custom;
      input.required = custom;
    }
  };
  select.addEventListener('change', updateDates);
  updateDates();
}
