import { Op } from 'sequelize';
import { Course, CourseAttempt, User } from '../models/learningModels.js';
import { AuditLog, Section } from '../models/adminModels.js';
import { CourseAssignment, QuizDraft } from '../models/portalModels.js';
import { allModulesPassed } from './learning.js';

import { philippineDate } from './dashboardPeriod.js';
import { firstPublicationDates } from './coursePublications.js';
import { moduleActivity, summarizeModules } from './moduleAnalytics.js';

const DAY = 86_400_000;
const blankStatus = () => ({ notStarted: 0, inProgress: 0, answering: 0, completed: 0 });

function completionDate(attempt) {
  if (!allModulesPassed(attempt)) return null;
  if (attempt.completedAt) return attempt.completedAt;
  const passes = attempt.snapshot.modules.map(module => (attempt.quizAttempts || []).find(
    result => result.scope === module.id && !result.expired && result.score >= attempt.snapshot.passingScore
  )?.at);
  return passes.every(Boolean) ? new Date(Math.max(...passes.map(Date.parse))) : null;
}

function summarizeAnalytics(range, { courses, publishedDates, attempts, drafts, assignments, sections, students, events }) {
  const days = new Map();
  const metricKeys = ['published', 'started', 'submitted', 'retakes', 'completed'];
  for (let timestamp = +range.from; timestamp < +range.through; timestamp += DAY) {
    const date = philippineDate(new Date(timestamp));
    days.set(date, { date, published: 0, started: 0, submitted: 0, retakes: 0, completed: 0 });
  }
  const record = (date, metric) => {
    if (date == null || !Number.isFinite(+new Date(date))) return;
    const day = days.get(philippineDate(new Date(date)));
    if (day) day[metric]++;
  };

  const inPeriod = date => date != null && new Date(date) >= range.from && new Date(date) < range.through;
  const byCourse = new Map();
  const includesToday = range.through > new Date();
  for (const course of courses) {
    const publishedAt = publishedDates.get(course.id);
    record(publishedAt, 'published');
    const publishedByEnd = publishedAt ? publishedAt < range.through : includesToday && course.published;
    byCourse.set(course.id, { course, publishedByEnd, learners: new Map(), active: new Set() });
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
    if (!entry?.publishedByEnd) continue;
    for (const student of members.get(sectionNames.get(assignment.sectionId)) || []) {
      entry.learners.set(student.id, { status: 'notStarted' });
      if ([assignment.createdAt, student.createdAt, publishedDates.get(entry.course.id)].some(inPeriod)) {
        entry.active.add(student.id);
      }
    }
  }

  const { saved, restarts } = moduleActivity(drafts, events);
  const attemptsByCourse = new Map();
  const activeAttempts = new Set([
    ...drafts.filter(draft => [draft.startedAt, draft.updatedAt].some(inPeriod)).map(draft => String(draft.attemptId)),
    ...events.filter(event => inPeriod(event.createdAt)).map(event => String(event.targetId))
  ]);
  const answering = new Set(drafts.filter(draft => Object.keys(draft.answers || {}).length).map(draft => draft.attemptId));
  for (const attempt of attempts) {
    const entry = byCourse.get(attempt.courseId);
    if (!entry || !studentIds.has(attempt.userId)) continue;
    if (!attemptsByCourse.has(attempt.courseId)) attemptsByCourse.set(attempt.courseId, []);
    attemptsByCourse.get(attempt.courseId).push(attempt);
    const previous = entry.learners.get(attempt.userId);
    if (!previous?.attemptNumber) record(attempt.createdAt, 'started');
    for (const result of attempt.quizAttempts || []) {
      if (!result.expired && result.scope !== 'final' && result.scope !== 'pretest' && Number.isFinite(result.score)) record(result.at, 'submitted');
    }
    const completedAt = completionDate(attempt);
    record(completedAt, 'completed');
    if (activeAttempts.has(String(attempt.id)) ||
        [attempt.createdAt, attempt.updatedAt, completedAt].some(inPeriod) ||
        (attempt.quizAttempts || []).some(result => inPeriod(result.at))) {
      entry.active.add(attempt.userId);
    }
    const completeByEnd = completedAt && completedAt < range.through ||
      attempt.updatedAt < range.through && allModulesPassed(attempt);
    const status = completeByEnd ? 'completed' :
      answering.has(attempt.id) ? 'answering' : 'inProgress';
    // Attempts are ordered oldest to newest by attempt number.
    entry.learners.set(attempt.userId, { status, attemptNumber: attempt.attemptNumber });
  }

  const scopedAttempts = new Set(attempts.filter(attempt => studentIds.has(attempt.userId)).map(attempt => String(attempt.id)));
  for (const event of events) if (scopedAttempts.has(event.targetId)) record(event.createdAt, 'retakes');

  const status = blankStatus();
  const rows = [];
  for (const entry of byCourse.values()) {
    const { course, active } = entry;
    const learners = new Map([...entry.learners].filter(([id]) => active.has(id)));
    if (!learners.size && !inPeriod(publishedDates.get(course.id))) continue;
    const counts = blankStatus();
    for (const learner of learners.values()) {
      counts[learner.status]++;
      status[learner.status]++;
    }
    rows.push({ id: course.id, title: course.title, total: learners.size, ...counts,
      modules: summarizeModules({ course, learners }, range, saved, restarts,
        (attemptsByCourse.get(course.id) || []).filter(attempt => active.has(attempt.userId))) });
  }
  rows.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  const trend = [...days.values()];
  const totals = Object.fromEntries(metricKeys.map(
    key => [key, trend.reduce((sum, day) => sum + day[key], 0)]
  ));
  return { start: range.start, end: range.end, status, trend, courses: rows, totals };
}

export async function dashboardAnalytics(range, facultyId, selectedCourseId) {
  const before = { [Op.lt]: range.through };
  const courses = await Course.findAll({
    where: { createdAt: before, ...(selectedCourseId === undefined ? {} : { id: selectedCourseId }), ...(facultyId === undefined ? {} : { ownerId: facultyId }) },
    attributes: ['id', 'title', 'published', 'starter', 'createdAt', 'updatedAt', 'modules']
  });
  const courseId = { [Op.in]: courses.map(course => course.id) };
  const [publishedDates, attempts, assignments] = await Promise.all([
    firstPublicationDates(courses, { recordedOnly: true }),
    CourseAttempt.findAll({
      where: { courseId, createdAt: before },
      attributes: ['id', 'courseId', 'userId', 'attemptNumber', 'snapshot', 'quizScores', 'quizAttempts', 'completedLessons', 'completedAt', 'createdAt', 'updatedAt'],
      order: [['attemptNumber', 'ASC']]
    }),
    CourseAssignment.findAll({ where: { courseId, createdAt: before }, attributes: ['courseId', 'sectionId', 'createdAt'], raw: true })
  ]);
  const [sections, drafts, events] = await Promise.all([
    Section.findAll({ where: { id: { [Op.in]: [...new Set(assignments.map(row => row.sectionId))] } }, attributes: ['id', 'name'], raw: true }),
    QuizDraft.findAll({
      where: { attemptId: { [Op.in]: attempts.map(attempt => attempt.id) }, updatedAt: before },
      attributes: ['attemptId', 'answers', 'scope', 'startedAt', 'updatedAt']
    }),
    AuditLog.findAll({
      where: { action: 'module.retake_started', targetType: 'attempt',
        targetId: { [Op.in]: attempts.map(attempt => String(attempt.id)) }, createdAt: before },
      attributes: ['targetId', 'createdAt', 'details'], order: [['createdAt', 'ASC'], ['id', 'ASC']]
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
    attributes: ['id', 'section', 'createdAt'], raw: true
  });
  return summarizeAnalytics(range, { courses, publishedDates, attempts, drafts, assignments, sections, students, events });
}
