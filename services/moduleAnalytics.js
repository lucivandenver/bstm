const counts = () => ({
  passed: 0, failedWithoutRetake: 0, failedAfterRetake: 0,
  ongoing: 0, notStarted: 0, historyUnavailable: 0, retook: 0, retookInPeriod: 0
});
const byAttemptModule = (id, moduleId) => JSON.stringify([id, moduleId]);
const datedBefore = (value, end) => value != null && new Date(value) < end;
const scored = result => !result.expired && Number.isFinite(result.score);

function moduleEvidence(attempt, module, draft, restarts, range) {
  const { from, through } = range;
  const results = (attempt.quizAttempts || []).filter(result => result.scope === module.id && scored(result));
  const dated = results.filter(result => datedBefore(result.at, through));
  const current = datedBefore(attempt.updatedAt, through);
  const available = current ? results : dated;
  const scores = attempt.quizScores || {};
  const saved = current ? scores[module.id] : undefined;
  const retakeCounter = Number(scores[`retake:${module.id}`] || 0);
  const retook = restarts.length > 0 || available.length > 1 || current && retakeCounter > 0;
  const retookInPeriod = restarts.some(at => new Date(at) >= from);
  const passing = attempt.snapshot.passingScore;
  const passed = saved >= passing || available.some(result => result.score >= passing);
  if (passed) return { status: 'passed', retook, retookInPeriod };

  const last = available.at(-1);
  const latestRestart = restarts.at(-1);
  const reset = latestRestart && (!last?.at || new Date(latestRestart) > new Date(last.at));
  const unfinishedRetake = current && retakeCounter > 0 && !Number.isFinite(saved);
  const failed = Number.isFinite(saved) || Boolean(last);
  const learning = current && (scores[`read:${module.id}`] ||
    (module.lessons || []).some(lesson => (attempt.completedLessons || []).includes(lesson.id)));
  const retakeDateUnknown = !current && retakeCounter > Math.max(restarts.length, dated.length - 1);
  let status;
  if (reset || unfinishedRetake || draft) status = 'ongoing';
  else if (retakeDateUnknown) status = 'historyUnavailable';
  else if (failed) status = retook ? 'failedAfterRetake' : 'failedWithoutRetake';
  else if (learning) status = 'ongoing';
  else status = current ? 'notStarted' : 'historyUnavailable';
  return { status, retook, retookInPeriod };
}

export function summarizeModules(entry, range, drafts, restarts, attempts) {
  const { course, learners } = entry;
  const modules = new Map();
  const add = module => {
    if (!modules.has(module.id)) modules.set(module.id, { title: module.title || module.id, learners: new Map() });
    return modules.get(module.id);
  };
  for (const module of course.modules || []) {
    const row = add(module);
    for (const [userId, learner] of learners) {
      if (!learner.attemptNumber) row.learners.set(userId, {
        status: datedBefore(course.updatedAt, range.through) ? 'notStarted' : 'historyUnavailable'
      });
    }
  }
  for (const attempt of attempts) {
    for (const module of attempt.snapshot.modules || []) {
      const { learners: records } = add(module);
      const previous = records.get(attempt.userId);
      const key = byAttemptModule(attempt.id, module.id);
      const result = moduleEvidence(attempt, module, drafts.has(key), restarts.get(key) || [], range);
      records.set(attempt.userId, {
        status: previous?.status === 'passed' ? 'passed' : result.status,
        retook: previous?.retook || result.retook,
        retookInPeriod: previous?.retookInPeriod || result.retookInPeriod
      });
    }
  }
  return [...modules.values()].map(({ title, learners: records }) => {
    const totals = counts();
    for (const item of records.values()) {
      totals[item.status]++;
      if (item.retook) totals.retook++;
      if (item.retookInPeriod) totals.retookInPeriod++;
    }
    return { title, total: records.size, ...totals };
  });
}

export function moduleActivity(drafts, events) {
  const saved = new Set(drafts.filter(draft => Object.keys(draft.answers || {}).length || draft.startedAt)
    .map(draft => byAttemptModule(draft.attemptId, draft.scope)));
  const restarts = new Map();
  for (const event of events) {
    const key = byAttemptModule(Number(event.targetId), event.details?.moduleId);
    if (!restarts.has(key)) restarts.set(key, []);
    restarts.get(key).push(event.createdAt);
  }
  return { saved, restarts };
}
