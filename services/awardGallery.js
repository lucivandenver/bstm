export function awardGallery(credentials, attempts, { q = '', type = '', sort = 'latest', page = 1, academy = 'MinSU Bongabong Campus' } = {}) {
  const rows = credentials.map(row => {
    const attempt = attempts.find(a => Number(a.id) === Number(row.attemptId));
    const module = attempt?.snapshot.modules?.find(m => m.id === row.moduleId);
    return { ...row, courseId: attempt?.courseId ?? `legacy-${row.attemptId}`, academy,
      title: row.moduleTitle || row.courseTitle, type: 'certificate',
      description: attempt?.snapshot.description || '', minutes: attempt?.snapshot.minutes,
      skills: row.skills || module?.skills || [], issued: new Date(row.issuedAt || 0).getTime(),
      date: row.issuedAt ? new Date(row.issuedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '—',
      dialogId: `certificate-${row.id}` };
  });
  const badges = [...new Set(rows.map(row => row.courseId))].map(courseId => {
    const earned = rows.filter(row => row.courseId === courseId).sort((a,b) => b.issued - a.issued);
    const modules = [...new Map(earned.filter(row => row.moduleId).map(row => [row.moduleId, row])).values()];
    const first = earned.reduce((a,b) => a.issued < b.issued ? a : b);
    return { ...earned[0], type: 'badge', title: earned[0].courseTitle, moduleTitle: null, modules,
      date: first.date, issued: first.issued, dialogId: `course-badge-${courseId}`,
      skills: [...new Set(modules.flatMap(row => row.skills))], shareUrl: `/verify/${earned[0].id}?badge=course` };
  });
  const query = String(q).trim().toLowerCase();
  let records = [...badges, ...rows].filter(row => (!type || row.type === type) && `${row.title} ${row.courseTitle} ${row.academy}`.toLowerCase().includes(query));
  records.sort(sort === 'az' ? (a,b) => a.title.localeCompare(b.title) || a.type.localeCompare(b.type) : (a,b) => b.issued - a.issued || a.title.localeCompare(b.title));
  const pages = Math.max(1, Math.ceil(records.length / 5));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  const href = next => `?${new URLSearchParams({ q, type, sort, page: String(next) })}`;
  return { records: records.slice((current-1)*5,current*5), count: records.length, page: current, pages,
    previous: current > 1 ? href(current-1) : null, next: current < pages ? href(current+1) : null, q, type, sort };
}
