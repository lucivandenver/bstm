import { Op } from 'sequelize';
import { User, CourseAttempt } from '../models/learningModels.js';
import { Section } from '../models/adminModels.js';
import { text } from '../services/validation.js';
export const dashboard = async (req, res) => {
  const sections = await Section.findAll({ where: { facultyId: req.user.id, active: true } });
  const students = await User.findAll({ where: { role: 'student', section: { [Op.in]: sections.map(s => s.name) } }, attributes: ['id', 'name', 'studentId', 'section'] });
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) } }, order: [['createdAt', 'DESC']], limit: 300 });
  const names = new Map(students.map(s => [s.id, s.name]));
  res.render('faculty/dashboard', { title: 'Faculty overview', sections: sections.map(s => s.get({ plain: true })), students: students.map(s => s.get({ plain: true })),
    attempts: attempts.map(a => ({ name: names.get(a.userId), title: a.snapshot.title, status: a.status, score: a.finalScore, attempt: a.attemptNumber, minutes: Math.floor(a.activeSeconds / 60), started: new Date(a.createdAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' }) })), completed: attempts.filter(a => a.status === 'completed').length });
};
export const profile = (req, res) => res.render('faculty/profile', { title: 'My faculty profile', googleConnected: Boolean(req.user.googleId) });
export const saveProfile = async (req, res) => {
  const name = text(req.body.name, 100); if (name.length < 2) throw Object.assign(new Error('Enter your full name.'), { status: 400 });
  await req.user.update({ name }); req.flash('success_msg', 'Profile saved. Contact Admin for Faculty ID corrections.'); res.redirect('/faculty/profile');
};
