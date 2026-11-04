(() => {
  for (const form of document.querySelectorAll('[data-signature-form]')) {
    const file = form.querySelector('[data-signature-file]'), hidden = form.querySelector('[data-signature-value]'), previews = form.querySelectorAll('[data-course-signature-preview]');
    let ready = Boolean(hidden.value);
    file.addEventListener('change', () => {
      file.setCustomValidity('');
      ready = false; hidden.value = '';
      const selected = file.files?.[0]; if (!selected) return;
      if (!/^image\/(png|jpeg|webp)$/.test(selected.type) || selected.size > 4 * 1024 * 1024) { file.setCustomValidity('Choose a PNG, JPEG or WebP image up to 4 MB.'); file.reportValidity(); return; }
      file.setCustomValidity(''); const image = new Image(); image.onload = () => {
        const scale = Math.min(1, 600 / image.width, 300 / image.height), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) { const light = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]); if (light > 232) pixels.data[i + 3] = 0; else if (light > 205) pixels.data[i + 3] = Math.round(pixels.data[i + 3] * (232 - light) / 27); }
        ctx.putImageData(pixels, 0, 0); hidden.value = canvas.toDataURL('image/png'); previews.forEach(preview => { preview.src = hidden.value; preview.hidden = false; }); ready = true; URL.revokeObjectURL(image.src);
      }; image.src = URL.createObjectURL(selected);
    });
    form.addEventListener('submit', event => { if (!ready) { event.preventDefault(); file.setCustomValidity('Choose a signature image and wait for its preview before submitting.'); file.reportValidity(); } });
  }
})();
