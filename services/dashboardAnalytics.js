import { Op } from 'sequelize';
import { Course, CourseAttempt, User } from '../models/learningModels.js';
import { Section, AuditLog } from '../models/adminModels.js';
import { CourseAssignment, CourseRevision, QuizDraft } from '../models/portalModels.js';
import { allModulesPassed } from './learning.js';

const DAY = 86_400_000;
const manila = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' });
const dayKey = date => manila.format(date);
const midnight = date => new Date(`${date}T00:00:00+08:00`);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(+midnight(value)) && dayKey(midnight(value)) === value;
const periods = { day: 1, week: 7, month: 30 };
const blankStatus = () => ({ notStarted: 0, inProgress: 0, answering: 0, completed: 0 });

export function analyticsRange({ period = 'week', start, end }, now = new Date()) {
  const today = dayKey(now);
  if (Object.hasOwn(periods, period)) {
    end = today;
    start = dayKey(new Date(+midnight(end) - (periods[period] - 1) * DAY));
  } else if (period !== 'custom') return null;
  if (!validDay(start) || !validDay(end) || start > end || end > today) return null;
  const from = midnight(start);
  const through = new Date(+midnight(end) + DAY);
  if ((through - from) / DAY > 366) return null;
  return { start, end, from, through };
}

function completionDate(attempt) {
  if (!allModulesPassed(attempt)) return null;
  if (attempt.completedAt) return attempt.completedAt;
  const passes = attempt.snapshot.modules.map(module => (attempt.quizAttempts || []).find(
    result => result.scope === module.id && !result.expired && result.score >= attempt.snapshot.passingScore
  )?.at);
  return passes.every(Boolean) ? new Date(Math.max(...passes.map(Date.parse))) : attempt.updatedAt;
}

export function summarizeAnalytics(range, { courses, publications, attempts, drafts, assignments, sections, students }) {
  const days = new Map();
  for (let timestamp = +range.from; timestamp < +range.through; timestamp += DAY) {
    const date = dayKey(new Date(timestamp));
    days.set(date, { date, published: 0, started: 0, submitted: 0, completed: 0 });
  }
  const record = (date, metric) => {
    if (date == null || !Number.isFinite(+new Date(date))) return;
    const day = days.get(dayKey(new Date(date)));
    if (day) day[metric]++;
  };

  const firstPublication = new Map();
  for (const { courseId, at } of publications) {
    const current = firstPublication.get(courseId);
    if (!current || at < current) firstPublication.set(courseId, at);
  }
  const byCourse = new Map();
  for (const course of courses) {
    const publishedAt = course.starter ? course.createdAt : firstPublication.get(course.id) || (course.published ? course.createdAt : null);
    record(publishedAt, 'published');
    byCourse.set(course.id, { course, publishedAt, learners: new Map() });
  }

  const studentIds = new Set(students.map(student => student.id));
  const members = new Map();
  for (const student of students) {
    if (!members.has(student.section)) members.set(student.section, []);
    members.get(student.section).push(student);
  }
  const sectionNames = new Map(sections.map(section => [section.id, section.name]));
  for (const assignment of assignments) {
    const entry = byCourse.get(assignment.courseId);
    if (!entry?.publishedAt || entry.publishedAt >= range.through) continue;
    for (const student of members.get(sectionNames.get(assignment.sectionId)) || []) {
      entry.learners.set(student.id, { status: 'notStarted' });
    }
  }

  const answering = new Set(drafts.filter(draft => Object.keys(draft.answers || {}).length).map(draft => draft.attemptId));
  for (const attempt of attempts) {
    const entry = byCourse.get(attempt.courseId);
    if (!entry || !studentIds.has(attempt.userId)) continue;
    const previous = entry.learners.get(attempt.userId);
    if (!previous?.attemptNumber) record(attempt.createdAt, 'started');
    for (const result of attempt.quizAttempts || []) {
      if (!result.expired && result.scope !== 'final') record(result.at, 'submitted');
    }
    const completedAt = completionDate(attempt);
    record(completedAt, 'completed');
    const status = completedAt && completedAt < range.through ? 'completed' :
      answering.has(attempt.id) ? 'answering' : 'inProgress';
    // Attempts are ordered oldest to newest by attempt number.
    entry.learners.set(attempt.userId, { status, attemptNumber: attempt.attemptNumber });
  }

  const status = blankStatus();
  const rows = [];
  for (const { course, learners, publishedAt } of byCourse.values()) {
    if (!learners.size && (!publishedAt || publishedAt >= range.through)) continue;
    const counts = blankStatus();
    for (const learner of learners.values()) {
      counts[learner.status]++;
      status[learner.status]++;
    }
    rows.push({ title: course.title, total: learners.size, ...counts });
  }
  rows.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  const trend = [...days.values()];
  const totals = Object.fromEntries(['published', 'started', 'submitted', 'completed'].map(
    key => [key, trend.reduce((sum, day) => sum + day[key], 0)]
  ));
  return { start: range.start, end: range.end, status, trend, courses: rows, totals };
}

export async function dashboardAnalytics(range, ownerId) {
  const before = { [Op.lt]: range.through };
  const courses = await Course.findAll({
    where: { createdAt: before, ...(ownerId === undefined ? {} : { ownerId }) },
    attributes: ['id', 'title', 'published', 'starter', 'createdAt'], raw: true
  });
  const courseId = { [Op.in]: courses.map(course => course.id) };
  const [revisions, events, attempts, assignments] = await Promise.all([
    CourseRevision.findAll({ where: { courseId, action: ['published', 'admin-published', 'publication-approved', 'module-published'] }, attributes: ['courseId', 'action', 'createdAt', 'updatedAt'], raw: true }),
    AuditLog.findAll({ where: { targetType: 'course', targetId: { [Op.in]: courses.map(course => String(course.id)) }, action: ['course.published', 'course.republished', 'module.published', 'module.republished'] }, attributes: ['targetId', 'createdAt'], raw: true }),
    CourseAttempt.findAll({
      where: { courseId, createdAt: before },
      attributes: ['id', 'courseId', 'userId', 'attemptNumber', 'snapshot', 'quizScores', 'quizAttempts', 'completedAt', 'createdAt', 'updatedAt'],
      order: [['attemptNumber', 'ASC']]
    }),
    CourseAssignment.findAll({ where: { courseId, createdAt: before }, attributes: ['courseId', 'sectionId'], raw: true })
  ]);
  const [sections, drafts] = await Promise.all([
    Section.findAll({ where: { id: { [Op.in]: [...new Set(assignments.map(row => row.sectionId))] } }, attributes: ['id', 'name'], raw: true }),
    QuizDraft.findAll({
      where: { attemptId: { [Op.in]: attempts.map(attempt => attempt.id) }, updatedAt: before },
      attributes: ['attemptId', 'answers']
    })
  ]);
  const students = await User.findAll({
    where: {
      role: 'student', createdAt: before,
      [Op.or]: [
        { id: { [Op.in]: [...new Set(attempts.map(attempt => attempt.userId))] } },
        { section: { [Op.in]: sections.map(section => section.name) } }
      ]
    },
    attributes: ['id', 'section'], raw: true
  });
  const publications = [
    ...events.map(row => ({ courseId: Number(row.targetId), at: row.createdAt })),
    ...revisions.map(row => ({ courseId: row.courseId, at: row.action === 'module-published' ? row.updatedAt : row.createdAt }))
  ];
  return summarizeAnalytics(range, { courses, publications, attempts, drafts, assignments, sections, students });
}
