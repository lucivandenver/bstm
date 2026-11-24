import { moduleResults } from './evidence.js';
import { allModulesPassed } from './learning.js';

const week = 7 * 86_400_000;
export function inDashboardPeriod(value, range) {
  if (!range) return true;
  if (value == null) return false;
  const time = new Date(value);
  return time >= range.from && time < range.through;
}

function hasActivity(attempt, range) {
  return [attempt.createdAt, attempt.lastActivityAt, attempt.completedAt].some(date => inDashboardPeriod(date, range)) ||
    (attempt.quizAttempts || []).some(result => !result.expired && inDashboardPeriod(result.at, range));
}

function resultsThrough(attempt, range, now) {
  if (!range || range.through > now || attempt.updatedAt < range.through) return moduleResults(attempt);
  return moduleResults({
    snapshot: attempt.snapshot,
    // For an attempt changed after the selected period, use its dated quiz history.
    quizAttempts: (attempt.quizAttempts || []).filter(result => result.at && new Date(result.at) < range.through)
  });
}

export function facultyDashboardStats({ attempts, students, courses, range, now }) {
  let modulesPassed = 0, modulesTotal = 0, completed = 0, attemptCount = 0;
  const enrolled = new Set();
  const active = new Set();
  const courseLearners = new Map();
  const needsCheckIn = new Set();
  for (const attempt of attempts) {
    if (!allModulesPassed(attempt) && (!attempt.lastActivityAt || now - attempt.lastActivityAt > week)) {
      needsCheckIn.add(attempt.userId);
    }
    if (inDashboardPeriod(attempt.createdAt, range)) enrolled.add(attempt.userId);
    if (!hasActivity(attempt, range)) continue;
    const modules = resultsThrough(attempt, range, now);
    const passed = modules.filter(module => module.passed).length;
    modulesPassed += passed;
    modulesTotal += modules.length;
    attemptCount++;
    if (modules.length > 0 && modules.length === passed) {
      completed++;
    } else {
      active.add(attempt.userId);
      if (!courseLearners.has(attempt.courseId)) courseLearners.set(attempt.courseId, new Set());
      courseLearners.get(attempt.courseId).add(attempt.userId);
    }
  }

  const learnerActivity = courses
    .map(course => ({ title: course.title, learners: courseLearners.get(course.id)?.size || 0 }))
    .filter(course => course.learners > 0)
    .sort((a, b) => b.learners - a.learners || a.title.localeCompare(b.title));
  return {
    studentCount: range ? enrolled.size : students.length,
    active: active.size,
    modulesPassed, modulesTotal, completed, attemptCount,
    modulesRemaining: modulesTotal - modulesPassed,
    completionRate: modulesTotal ? Math.round(modulesPassed / modulesTotal * 100) : null,
    learnerActivity,
    support: students.filter(student => needsCheckIn.has(student.id))
  };
}
