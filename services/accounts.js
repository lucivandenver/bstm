import bcrypt from 'bcryptjs';
import { User, sequelize } from '../models/learningModels.js';
import { Section, Setting, CareerPath, AuditLog } from '../models/adminModels.js';
import { defaultCareerTracks } from './learning.js';
export const ownerEmail = () => (process.env.ADMIN_EMAIL || 'bstm4thyear.mbc@gmail.com').trim().toLowerCase();
export const genders = ['Female', 'Male', 'Other', 'Prefer not to say'];
export function usable(user) { return user?.active && (user.role !== 'faculty' || user.approvalStatus === 'approved'); }
export function accessMessage(user) {
  return user?.role === 'faculty' && user.approvalStatus !== 'approved' ? 'Your faculty account is awaiting admin approval or has not been approved yet.' : 'This account is inactive. Contact the administrator.';
}
export const destination = user => user.role === 'admin' ? '/admin' : user.role === 'faculty' ? '/faculty' : '/student';
export async function setting(key, fallback = '') { return (await Setting.findOne({ where: { key } }))?.value ?? fallback; }
export async function audit(actorId, action, targetType, targetId, details = {}, transaction) {
  return AuditLog.create({ actorId, action, targetType, targetId: String(targetId ?? ''), details }, { transaction });
}
export async function bootstrapAdmin() {
  const address = ownerEmail();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('ADMIN_EMAIL must be a valid email.');
  const initial = process.env.ADMIN_INITIAL_PASSWORD;
  if (initial && (initial.length < 14 || Buffer.byteLength(initial) > 72)) throw new Error('ADMIN_INITIAL_PASSWORD must contain at least 14 characters and at most 72 bytes.');
  await sequelize.transaction(async transaction => {
    const [user] = await User.findOrCreate({ where: { email: address }, defaults: { name: 'CareerBridge Administrator', role: 'admin', password: initial ? await bcrypt.hash(initial, 12) : null, active: true, approvalStatus: 'approved' }, transaction });
    if (user.role !== 'admin') {
      // Existing password accounts require a private bootstrap password to promote.
      // A previously verified Google account is already proof of ownership.
      if (!initial && !(user.googleId && user.emailVerified)) throw new Error('Admin email already belongs to an unverified account. Set ADMIN_INITIAL_PASSWORD privately to provision the owner.');
      await user.update({ role: 'admin', approvalStatus: 'approved', ...(initial ? { password: await bcrypt.hash(initial, 12) } : {}) }, { transaction });
      await audit(null, 'owner.provisioned', 'user', user.id, {}, transaction);
    } else if (!user.password && initial) await user.update({ password: await bcrypt.hash(initial, 12) }, { transaction });
  });
}
export async function seedAdministration() {
  const firstSeed = !await Setting.findOne({ where: { key: 'adminSeedVersion' } });
  if (firstSeed) for (const name of ['BSTM 4-1', 'BSTM 4-2', 'BSTM 4-3', 'BSTM 4-4']) await Section.findOrCreate({ where: { name }, defaults: { academicYear: '2026-2027', active: true } });
  const old = await User.findAll({ where: { role: 'student' }, attributes: ['section'] });
  for (const user of old) if (user.section) await Section.findOrCreate({ where: { name: user.section }, defaults: { active: true } });
  if (firstSeed) for (const track of defaultCareerTracks) await CareerPath.findOrCreate({ where: { title: track.title }, defaults: { ...track, active: true } });
  for (const [key, value] of Object.entries({ adminSeedVersion: '1', institutionName: 'MinSU Bongabong Campus', academicYear: '2026-2027', registrationEnabled: 'true', facultyRegistrationEnabled: 'true', certificateFooter: 'Platform course completion record. Not a TESDA or professional licence.' })) await Setting.findOrCreate({ where: { key }, defaults: { value } });
}
