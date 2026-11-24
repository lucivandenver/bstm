import { Course, User } from '../models/learningModels.js';
import { dashboardAnalytics } from '../services/dashboardAnalytics.js';
import { dashboardPeriod, philippineDate } from '../services/dashboardPeriod.js';

export async function learningAnalytics(req, res) {
  const now = new Date();
  const range = dashboardPeriod(req.query, now);
  if (!range) return res.status(400).json({ message: 'Choose valid dates and a range of up to 366 days.' });

  const { facultyId = '', courseId = '' } = req.query;
  const faculty = await User.findAll({
    where: { role: 'faculty' }, attributes: ['id', 'name'], order: [['name', 'ASC'], ['id', 'ASC']], raw: true
  });
  const selected = faculty.find(person => String(person.id) === facultyId);
  if (facultyId !== '' && !selected) return res.status(400).json({ message: 'Choose a faculty member from the list.' });

  const courseOptions = await Course.findAll({
    attributes: ['id', 'title', 'ownerId'], order: [['title', 'ASC'], ['id', 'ASC']], raw: true
  });
  const course = courseOptions.find(item => String(item.id) === courseId &&
    (!selected || item.ownerId === selected.id));
  if (courseId !== '' && !course) return res.status(400).json({ message: 'Choose a course available for the selected faculty.' });

  const data = await dashboardAnalytics(range, selected?.id, course?.id);
  res.json({ ...data, faculty, courseOptions, selectedFaculty: selected || null,
    selectedCourse: course || null, today: philippineDate(now) });
}
