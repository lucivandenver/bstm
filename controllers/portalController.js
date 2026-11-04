import { Op } from 'sequelize';
import { Notification, User, Course, CourseAttempt } from '../models/learningModels.js';
import { StudentFile, CourseAssignment } from '../models/portalModels.js';
import { Section } from '../models/adminModels.js';
import { fail } from '../services/courseAuthoring.js';
export const notificationCount = async (req, res) => res.json({ unread: await Notification.count({ where: { userId: req.user.id, readAt: null } }) });
export const notificationFeed = async (req, res) => {
  const rows = await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 5, attributes: ['id','title','message','href','readAt','createdAt'] });
  res.set('Cache-Control', 'no-store');
  res.json({ unread: await Notification.count({ where: { userId: req.user.id, readAt: null } }), notifications: rows.map(n => ({ ...n.get({ plain: true }), href: /^\/(student|faculty|admin)(\/|$)/.test(n.href || '') ? n.href : '/notifications' })) });
};
export const notificationStream = (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  let closed = false, busy = false;
  const send = async () => {
    if (closed || busy) return; busy = true;
    try {
      const rows = await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt','DESC']], limit: 5, attributes: ['id','title','message','href','readAt','createdAt'] });
      const unread = await Notification.count({ where: { userId: req.user.id, readAt: null } });
      const notifications = rows.map(n => { const item = n.get({ plain: true }); if (!/^\/(student|faculty|admin)(\/|$)/.test(item.href || '')) item.href = '/notifications'; return item; });
      res.write(`event: notifications\ndata: ${JSON.stringify({ unread, notifications })}\n\n`);
    } catch { res.write(': retry\n\n'); } finally { busy = false; }
  };
  send(); const timer = setInterval(send, 20000); const heartbeat = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, 25000);
  req.on('close', () => { closed = true; clearInterval(timer); clearInterval(heartbeat); });
};
export const notifications = async (req, res) => res.render('portalNotifications', { title: 'Notifications', role: req.user.role, admin: req.user.role === 'admin', faculty: req.user.role === 'faculty', home: `/${req.user.role}`, notifications: (await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 200 })).map(n => ({ ...n.get({ plain: true }), date: new Date(n.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }), unread: !n.readAt })) });
export const readAll = async (req, res) => { await Notification.update({ readAt: new Date() }, { where: { userId: req.user.id, readAt: null } }); res.redirect('/notifications'); };
export const openNotification = async (req, res) => { const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } }); if (!n) fail('Notification not found.', 404); await n.update({ readAt: new Date() }); res.redirect(/^\/(student|faculty|admin)(\/|$)/.test(n.href || '') ? n.href : '/notifications'); };
export const file = async (req, res) => {
  const file = await StudentFile.findByPk(req.params.id); if (!file) fail('File not found.', 404);
  let allowed = req.user.id === file.userId || req.user.role === 'admin';
  if (req.user.role === 'faculty') { const user = await User.findOne({ where: { id: file.userId, role: 'student' } }); if (user) { const ownCourses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }); const ids = ownCourses.map(c => c.id); const [attempt, section, legacySection] = await Promise.all([CourseAttempt.findOne({ where: { userId: user.id, courseId: { [Op.in]: ids } }, attributes: ['id'] }), Section.findOne({ where: { name: user.section, active: true }, attributes: ['id'] }), Section.findOne({ where: { name: user.section, facultyId: req.user.id, active: true }, attributes: ['id'] })]); const assignment = section && ids.length ? await CourseAssignment.findOne({ where: { sectionId: section.id, courseId: { [Op.in]: ids } }, attributes: ['id'] }) : null; allowed = Boolean(attempt || assignment || legacySection); } }
  if (!allowed) fail('File not found.', 404);
  res.set({ 'Content-Type': file.mime, 'Content-Disposition': `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`, 'Cache-Control': 'no-store' }); res.send(file.data);
};
