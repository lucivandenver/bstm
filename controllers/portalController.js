import { Op } from 'sequelize';
import { Notification, User } from '../models/learningModels.js';
import { StudentFile } from '../models/portalModels.js';
import { Section } from '../models/adminModels.js';
import { fail } from '../services/courseAuthoring.js';
export const notificationCount = async (req, res) => res.json({ unread: await Notification.count({ where: { userId: req.user.id, readAt: null } }) });
export const notifications = async (req, res) => res.render('portalNotifications', { title: 'Notifications', role: req.user.role, admin: req.user.role === 'admin', faculty: req.user.role === 'faculty', home: `/${req.user.role}`, notifications: (await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 200 })).map(n => ({ ...n.get({ plain: true }), date: new Date(n.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }), unread: !n.readAt })) });
export const readAll = async (req, res) => { await Notification.update({ readAt: new Date() }, { where: { userId: req.user.id, readAt: null } }); res.redirect('/notifications'); };
export const openNotification = async (req, res) => { const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } }); if (!n) fail('Notification not found.', 404); await n.update({ readAt: new Date() }); res.redirect(/^\/(student|faculty|admin)(\/|$)/.test(n.href || '') ? n.href : '/notifications'); };
export const file = async (req, res) => {
  const file = await StudentFile.findByPk(req.params.id); if (!file) fail('File not found.', 404);
  let allowed = req.user.id === file.userId || req.user.role === 'admin';
  if (req.user.role === 'faculty') { const user = await User.findOne({ where: { id: file.userId, role: 'student' } }); allowed = Boolean(user && await Section.findOne({ where: { name: user.section, facultyId: req.user.id, active: true } })); }
  if (!allowed) fail('File not found.', 404);
  res.set({ 'Content-Type': file.mime, 'Content-Disposition': `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`, 'Cache-Control': 'no-store' }); res.send(file.data);
};
