import { Op } from 'sequelize';
import { AuditLog } from '../models/adminModels.js';
import { CourseRevision } from '../models/portalModels.js';

export async function firstPublicationDates(courses, { recordedOnly = false } = {}) {
  const courseIds = courses.map(course => course.id);
  const [revisions, events] = await Promise.all([
    CourseRevision.findAll({
      where: { courseId: { [Op.in]: courseIds }, action: ['published', 'admin-published', 'publication-approved', 'module-published'] },
      attributes: ['courseId', 'action', 'createdAt', 'updatedAt'], raw: true
    }),
    AuditLog.findAll({
      where: { targetType: 'course', targetId: { [Op.in]: courseIds.map(String) }, action: ['course.published', 'course.republished', 'module.published', 'module.republished'] },
      attributes: ['targetId', 'createdAt'], raw: true
    })
  ]);
  const publications = [
    ...events.map(row => ({ courseId: Number(row.targetId), at: row.createdAt })),
    ...revisions.map(row => ({ courseId: row.courseId, at: row.action === 'module-published' ? row.updatedAt : row.createdAt }))
  ];
  const earliest = new Map();
  for (const { courseId, at } of publications) {
    if (!at) continue;
    const timestamp = new Date(at);
    const current = earliest.get(courseId);
    if (Number.isFinite(+timestamp) && (!current || timestamp < current)) earliest.set(courseId, timestamp);
  }
  return new Map(courses.map(course => [
    course.id, course.starter ? new Date(course.createdAt) : earliest.get(course.id) || (course.published && !recordedOnly ? course.createdAt : null)
  ]));
}
