(() => {
  const form = document.querySelector('[data-lesson-completion]');
  if (!form) return;

  const end = form.querySelector('[data-lecture-end]');
  const button = form.querySelector('button');
  const challenge = form.elements.namedItem('lessonChallenge');
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting || entry.intersectionRatio < 1) return;
    challenge.value = form.dataset.lessonChallenge;
    button.disabled = false;
    end.textContent = 'End of lecture reached. You can now complete this lesson.';
    observer.disconnect();
  }, { threshold: 1 });

  observer.observe(end);
})();
