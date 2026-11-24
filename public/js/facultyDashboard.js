(() => {
  if (!globalThis.Chart) return;
  const options = { maintainAspectRatio: false, animation: false };
  const activity = document.querySelector('[data-faculty-activity]');
  if (activity) {
    const courses = JSON.parse(activity.dataset.facultyActivity).slice(0, 8);
    activity.parentElement.hidden = false;
    new Chart(activity, {
      type: 'bar',
      data: {
        labels: courses.map(course => course.title),
        datasets: [{ label: 'Active learners', data: courses.map(course => course.learners), backgroundColor: '#007042', borderRadius: 4 }]
      },
      options: {
        ...options, indexAxis: 'y',
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: {
            callback(value) {
              const label = this.getLabelForValue(value);
              const limit = this.chart.width < 400 ? 16 : 24;
              return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
            }
          } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
  const modules = document.querySelector('[data-modules-passed]');
  if (modules) {
    modules.parentElement.hidden = false;
    new Chart(modules, {
      type: 'doughnut',
      data: {
        labels: ['Passed', 'Still to pass'],
        datasets: [{
          data: [Number(modules.dataset.modulesPassed), Number(modules.dataset.modulesRemaining)],
          backgroundColor: ['#007042', '#64748b']
        }]
      },
      options: { ...options, plugins: { legend: { position: 'bottom' } } }
    });
  }
})();
