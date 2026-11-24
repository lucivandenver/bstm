(() => {
  const root = document.querySelector('[data-learning-analytics]');
  if (!root) return;
  const form = root.querySelector('form');
  const { period, start, end } = form.elements;
  const message = root.querySelector('[data-analytics-message]');
  const results = root.querySelector('[data-analytics-results]');
  const charts = [];
  let request;
  let faculty = [];
  const facultySearch = root.querySelector('[data-faculty-search]');
  const facultySelect = root.querySelector('[data-faculty-select]');
  const facultyMatches = root.querySelector('[data-faculty-matches]');
  const normalizeName = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-PH');
  const shortDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const axis = { beginAtZero: true, grid: { color: '#e9eff1' }, border: { display: false }, ticks: { precision: 0 } };
  const legend = { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } };
  const tooltip = { backgroundColor: '#142c32', padding: 12, usePointStyle: true };
  const barStyle = { borderRadius: 5, maxBarThickness: 22 };

  function updateFacultyOptions() {
    const selected = facultySelect.value;
    const query = normalizeName(facultySearch.value.trim());
    const matching = faculty.filter(person => normalizeName(person.name).includes(query));
    const matchingIds = new Set(matching.map(person => String(person.id)));
    const visible = faculty.filter(person => matchingIds.has(String(person.id)) || String(person.id) === selected);
    const nameCounts = new Map();
    for (const { name } of faculty) {
      const key = normalizeName(name);
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    facultySelect.replaceChildren(new Option('All faculty', ''), ...visible.map(person => {
      const label = nameCounts.get(normalizeName(person.name)) > 1 ? `${person.name} (#${person.id})` : person.name;
      return new Option(label, person.id);
    }));
    if ([...facultySelect.options].some(option => option.value === selected)) facultySelect.value = selected;
    facultyMatches.hidden = !query;
    facultyMatches.textContent = matching.length ? `${matching.length} matching faculty` : 'No faculty names match your search.';
    return matching;
  }

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
    ['submitted', 'Module quiz submissions', '#a04f0a'],
    ['retakes', 'Retake starts', '#bf365b'],
    ['completed', 'Course attempts completed', '#007042'],
  ];
  const modulesSelect = root.querySelector('[data-module-course]');
  const moduleStates = [
    ['passed', 'Passed', '#007042'],
    ['failedWithoutRetake', 'Failed · no retake', '#a82745'],
    ['failedAfterRetake', 'Failed after retake', '#8141a1'],
    ['ongoing', 'Ongoing', '#2369ac'],
    ['notStarted', 'Not started', '#64748b'],
    ['historyUnavailable', 'History unavailable', '#ad691a']
  ];
  let moduleChart, coursesById;
  const percent = row => row.total ? Math.round(100 * row.completed / row.total) : 0;

  function chart(name, config) {
    charts.push(new Chart(root.querySelector(`[data-chart="${name}"]`), {
      ...config,
      options: { responsive: true, maintainAspectRatio: false, animation: false, ...config.options,
        plugins: { legend, tooltip, ...config.options.plugins } }
    }));
  }

  function renderCharts({ trend, status, courses }) {
    charts.splice(0).forEach(item => item.destroy());
    const labels = trend.map(row => row.date);
    const featured = courses.filter(row => row.total > 0).slice(0, 8);
    const points = courses.filter(row => row.total > 0).map(row => ({
      x: row.total, y: percent(row), title: row.title
    }));
    const hasActivity = trend.some(row => activity.some(([key]) => row[key] > 0));
    const hasProgress = states.some(([key]) => status[key] > 0);
    for (const [name, visible] of [['trend', hasActivity], ['progress', hasProgress], ['courses', hasProgress], ['completion', hasProgress]]) {
      root.querySelector(`[data-chart="${name}"]`).parentElement.hidden = !visible;
    }
    root.querySelector('[data-trend-empty]').hidden = hasActivity;
    root.querySelector('[data-progress-empty]').hidden = hasProgress;
    for (const name of ['courses', 'completion']) {
      root.querySelector(`[data-chart="${name}"]`).closest('section').hidden = !hasProgress;
    }
    if (hasActivity) chart('trend', {
      type: 'line',
      data: { labels, datasets: activity.map(([key, label, color]) => ({
        label, borderColor: color, backgroundColor: color, data: trend.map(row => row[key]), borderWidth: 2, pointRadius: trend.length > 45 ? 0 : 3, pointHoverRadius: 5
      })) },
      options: { interaction: { mode: 'index', intersect: false }, scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0,
          callback: index => shortDate.format(new Date(labels[index])) } }, y: axis
      } }
    });
    if (!hasProgress) return;
    chart('progress', {
      type: 'doughnut',
      data: {
        labels: states.map(([, label]) => label),
        datasets: [{ borderRadius: 5, borderWidth: 2, backgroundColor: states.map(([, , color]) => color), data: states.map(([key]) => status[key]) }]
      },
      options: { cutout: '72%' }
    });
    chart('courses', {
      type: 'bar',
      data: {
        labels: featured.map(row => row.title),
        datasets: states.map(([key, label, color]) => ({ ...barStyle, label, backgroundColor: color, data: featured.map(row => row[key]) }))
      },
      options: {
        indexAxis: 'y',
        scales: { x: { ...axis, stacked: true }, y: { grid: { display: false }, stacked: true, ticks: {
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

  function renderModules() {
    moduleChart?.destroy();
    moduleChart = null;
    const modules = coursesById.get(modulesSelect.value)?.modules ?? [];
    root.querySelector('[data-module-results]').hidden = !modules.length;
    root.querySelector('[data-module-empty]').hidden = !!modules.length;
    table('[data-module-rows]', modules.map(row => [
      row.title, row.total, ...moduleStates.map(([key]) => row[key]), row.retook, row.retookInPeriod
    ]));
    const canvas = root.querySelector('[data-module-chart]');
    canvas.parentElement.hidden = !globalThis.Chart || !modules.length;
    if (!globalThis.Chart || !modules.length) return;
    canvas.parentElement.style.height = `${Math.max(210, modules.length * 30 + 90)}px`;
    moduleChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: modules.map(row => row.title), datasets: moduleStates.map(([key, label, color]) => ({
        ...barStyle, label, backgroundColor: color, data: modules.map(row => row[key])
      })) },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, animation: false,
        scales: { x: { ...axis, stacked: true }, y: { grid: { display: false }, stacked: true, ticks: {
          callback(value) {
            const label = this.getLabelForValue(value);
            return label.length > 24 ? `${label.slice(0, 23)}…` : label;
          }
        } } },
        plugins: { legend, tooltip }
      }
    });
  }

  modulesSelect.addEventListener('change', renderModules);

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
      if (request !== controller) return;
      faculty = data.faculty;
      updateFacultyOptions();
      for (const cell of root.querySelectorAll('[data-total]')) cell.textContent = number.format(data.totals[cell.dataset.total]);
      table('[data-course-rows]', data.courses.map(row => [
        row.title, row.total, ...states.map(([key]) => row[key]), row.total ? `${percent(row)}%` : '—'
      ]));
      table('[data-day-rows]', data.trend.map(row => [row.date, ...activity.map(([key]) => row[key])]));
      const noLearners = !Object.values(data.status).some(Boolean);
      const dates = data.start === data.end ? data.start : `${data.start} to ${data.end}`;
      message.textContent = `${dates} · Philippine time · ${data.selectedFaculty?.name || 'All faculty'}${noLearners ? ' · No learner progress recorded through the end date.' : ''}`;
      results.hidden = false;
      const previousCourse = modulesSelect.value;
      coursesById = new Map(data.courses.map(course => [String(course.id), course]));
      modulesSelect.replaceChildren(...data.courses.map(course => new Option(course.title, course.id)));
      modulesSelect.disabled = !data.courses.length;
      if (coursesById.has(previousCourse)) modulesSelect.value = previousCourse;
      renderModules();
      if (globalThis.Chart) renderCharts(data);
      else root.querySelector('.analytics-charts').hidden = true;
      start.max = end.max = data.today;
      if (period.value !== 'custom') {
        start.value = data.start;
        end.value = data.end;
      }
    } catch (error) {
      if (request === controller && error.name !== 'AbortError') message.textContent = error.message;
    }
  }

  facultySearch.addEventListener('input', updateFacultyOptions);
  facultySearch.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const matching = updateFacultyOptions();
    if (matching.length === 1) {
      facultySelect.value = String(matching[0].id);
      if (form.reportValidity()) load();
    } else {
      facultySelect.focus();
    }
  });
  facultySelect.addEventListener('change', () => {
    if (form.reportValidity()) load();
  });
  period.addEventListener('change', () => {
    if (period.value !== 'custom') load();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    load();
  });
  load();
})();
