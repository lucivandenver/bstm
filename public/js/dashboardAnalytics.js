(() => {
  const root = document.querySelector('[data-learning-analytics]');
  if (!root) return;
  const form = root.querySelector('form');
  const { period, start, end } = form.elements;
  const message = root.querySelector('[data-analytics-message]');
  const results = root.querySelector('[data-analytics-results]');
  const charts = [];
  let request;
  const number = new Intl.NumberFormat('en-PH');
  const states = [
    ['notStarted', 'Not started', '#64748b'],
    ['inProgress', 'In progress', '#2369ac'],
    ['answering', 'Answering', '#a04f0a'],
    ['completed', 'Completed', '#007042'],
  ];
  const activity = [
    ['published', 'First published', '#6b43a7'],
    ['started', 'Started', '#2369ac'],
    ['submitted', 'Quiz submissions', '#a04f0a'],
    ['completed', 'Completed', '#007042'],
  ];
  const percent = row => row.total ? Math.round(100 * row.completed / row.total) : 0;

  function chart(name, config) {
    charts.push(new Chart(root.querySelector(`[data-chart="${name}"]`), {
      ...config,
      options: { responsive: true, maintainAspectRatio: false, animation: false, ...config.options }
    }));
  }

  function renderCharts({ trend, status, courses }) {
    charts.splice(0).forEach(item => item.destroy());
    const labels = trend.map(row => row.date);
    const featured = courses.filter(row => row.total > 0).slice(0, 8);
    const points = courses.filter(row => row.total > 0).map(row => ({
      x: row.total, y: percent(row), title: row.title
    }));
    chart('trend', {
      type: 'line',
      data: { labels, datasets: activity.map(([key, label, color]) => ({
        label, borderColor: color, backgroundColor: color, data: trend.map(row => row[key]), pointRadius: trend.length > 45 ? 0 : 3
      })) },
      options: { scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    chart('progress', {
      type: 'pie',
      data: {
        labels: states.map(([, label]) => label),
        datasets: [{ backgroundColor: states.map(([, , color]) => color), data: states.map(([key]) => status[key]) }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
    chart('courses', {
      type: 'bar',
      data: {
        labels: featured.map(row => row.title),
        datasets: states.map(([key, label, color]) => ({ label, backgroundColor: color, data: featured.map(row => row[key]) }))
      },
      options: {
        indexAxis: 'y',
        scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true, ticks: {
          callback(value) {
            const label = this.getLabelForValue(value);
            return label.length > 24 ? `${label.slice(0, 23)}…` : label;
          }
        } } },
        plugins: { legend: { display: false } }
      }
    });
    chart('completion', {
      type: 'scatter',
      data: { datasets: [{ data: points, backgroundColor: '#007042', pointRadius: 5 }] },
      options: {
        scales: {
          x: { beginAtZero: true, title: { display: true, text: 'Learners' }, ticks: { precision: 0 } },
          y: { min: 0, max: 100, title: { display: true, text: 'Completed (%)' } }
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: ({ raw }) => `${raw.title}: ${raw.y}% completed · ${raw.x} learners`
        } } }
      }
    });
  }

  function table(selector, rows) {
    const body = root.querySelector(selector);
    body.replaceChildren(...rows.map(values => {
      const row = document.createElement('tr');
      for (const value of values) {
        row.insertCell().textContent = typeof value === 'number' ? number.format(value) : value;
      }
      return row;
    }));
  }

  async function load() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    message.textContent = 'Loading learning analytics…';
    results.hidden = true;
    try {
      const query = new URLSearchParams(new FormData(form));
      const response = await fetch(`${root.dataset.learningAnalytics}?${query}`, {
        headers: { Accept: 'application/json' }, signal: controller.signal
      });
      if (response.status === 400) throw new Error((await response.json()).message);
      if (!response.ok || response.redirected) throw new Error('Could not load analytics. Reload the page or try again.');
      const data = await response.json();
      for (const cell of root.querySelectorAll('[data-total]')) cell.textContent = number.format(data.totals[cell.dataset.total]);
      table('[data-course-rows]', data.courses.map(row => [
        row.title, row.total, ...states.map(([key]) => row[key]), row.total ? `${percent(row)}%` : '—'
      ]));
      table('[data-day-rows]', data.trend.map(row => [row.date, ...activity.map(([key]) => row[key])]));
      const noLearners = !Object.values(data.status).some(Boolean);
      const dates = data.start === data.end ? data.start : `${data.start} to ${data.end}`;
      message.textContent = `${dates} · Philippine time${noLearners ? ' · No learner progress recorded through the end date.' : ''}`;
      results.hidden = false;
      if (globalThis.Chart) renderCharts(data);
      else root.querySelector('.analytics-charts').hidden = true;
      if (period.value !== 'custom') {
        start.value = data.start;
        end.value = data.end;
      }
    } catch (error) {
      if (error.name !== 'AbortError') message.textContent = error.message;
    }
  }

  period.addEventListener('change', () => {
    if (period.value !== 'custom') load();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    load();
  });
  load();
})();
