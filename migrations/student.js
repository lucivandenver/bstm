import { DataTypes } from 'sequelize';
import '../models/adminModels.js';
import '../models/portalModels.js';
import { bootstrapAdmin, seedAdministration } from '../services/accounts.js';
import { sequelize, User } from '../models/learningModels.js';
export async function migrateStudent() {
  await sequelize.authenticate();
  const qi = sequelize.getQueryInterface();
  const tables = (await qi.showAllTables()).map(t => typeof t === 'string' ? t : Object.values(t)[0]);
  if (tables.includes('Users')) {
    // MySQL DDL is not transactional. Preflight before any schema changes.
    const [duplicates] = await sequelize.query('SELECT LOWER(TRIM(email)) AS email, COUNT(*) AS n FROM Users GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1');
    if (duplicates.length) throw new Error('Duplicate emails found. Resolve duplicate user emails before migrating. No users were deleted.');
    const columns = await qi.describeTable('Users');
    const additions = {
      sessionVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      facultyId: { type: DataTypes.STRING(40), allowNull: true }, gender: { type: DataTypes.STRING(30), allowNull: true },
      approvalStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'approved' },
      studentId: { type: DataTypes.STRING(40), allowNull: true }, section: { type: DataTypes.STRING(60), allowNull: true },
      googleId: { type: DataTypes.STRING, allowNull: true }, emailVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    };
    for (const [name, spec] of Object.entries(additions)) if (!columns[name]) await qi.addColumn('Users', name, spec);
    if (!columns.password.allowNull) await qi.changeColumn('Users', 'password', { type: DataTypes.STRING, allowNull: true });
    // Keep legacy staff accounts as staff until an administrator assigns academic permissions.
    const expectedRoles = ['admin', 'faculty', 'student', 'staff', 'visitors'];
    if (sequelize.getDialect() === 'mysql' && (columns.role.defaultValue !== 'student' || !expectedRoles.every(role => columns.role.type.includes(`'${role}'`)))) {
      await qi.changeColumn('Users', 'role', { type: DataTypes.ENUM(...expectedRoles), allowNull: false, defaultValue: 'student' });
    }
    await User.update({ role: 'student' }, { where: { role: 'visitors' } });
    await sequelize.query('UPDATE Users SET email = LOWER(TRIM(email))');
    const indexes = await qi.showIndex('Users');
    for (const field of ['email', 'studentId', 'facultyId', 'googleId']) {
      if (!indexes.some(i => i.unique && i.fields.length === 1 && i.fields[0].attribute === field)) {
        await qi.addIndex('Users', [field], { unique: true, name: `users_${field}_unique` });
      }
    }
  }
  const extend = async (table, fields) => {
    if (!tables.includes(table)) return;
    const columns = await qi.describeTable(table);
    for (const [name, spec] of Object.entries(fields)) if (!columns[name]) await qi.addColumn(table, name, spec);
  };
  await extend('Courses', { ownerId: { type: DataTypes.INTEGER, allowNull: true }, outcomes: { type: DataTypes.JSON, allowNull: true }, tasks: { type: DataTypes.JSON, allowNull: true }, policy: { type: DataTypes.JSON, allowNull: true }, enrollFrom: { type: DataTypes.DATE }, enrollUntil: { type: DataTypes.DATE }, deadline: { type: DataTypes.DATE }, certificateEnabled: { type: DataTypes.BOOLEAN, defaultValue: true }, awardsApproved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false } });
  await extend('CourseAttempts', { lastLessonId: { type: DataTypes.STRING(100), allowNull: true } });
  await extend('CareerPaths', { qualifications: { type: DataTypes.TEXT } });
  await extend('StudentProfiles', Object.fromEntries(['relocate', 'targetRoles', 'workPreferences', 'ojtTasks'].map(name => [name, { type: DataTypes.TEXT }])));
  // Creates missing tables only. Never force-sync or reset existing student data.
  await sequelize.sync();
  await seedAdministration();
  await bootstrapAdmin();
}
