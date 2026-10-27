import { DataTypes, Op } from 'sequelize';
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
      studentId: { type: DataTypes.STRING(40), allowNull: true }, section: { type: DataTypes.STRING(60), allowNull: true },
      googleId: { type: DataTypes.STRING, allowNull: true }, emailVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    };
    for (const [name, spec] of Object.entries(additions)) if (!columns[name]) await qi.addColumn('Users', name, spec);
    await qi.changeColumn('Users', 'password', { type: DataTypes.STRING, allowNull: true });
    // Keep legacy staff accounts as staff until an administrator assigns academic permissions.
    await qi.changeColumn('Users', 'role', { type: DataTypes.ENUM('admin', 'faculty', 'student', 'staff', 'visitors'), allowNull: false, defaultValue: 'student' });
    await User.update({ role: 'student' }, { where: { role: 'visitors' } });
    await sequelize.query('UPDATE Users SET email = LOWER(TRIM(email))');
    const indexes = await qi.showIndex('Users');
    for (const field of ['email', 'studentId', 'googleId']) {
      if (!indexes.some(i => i.unique && i.fields.length === 1 && i.fields[0].attribute === field)) {
        await qi.addIndex('Users', [field], { unique: true, name: `users_${field}_unique` });
      }
    }
  }
  // Creates missing tables only. Never force-sync or reset existing student data.
  await sequelize.sync();
}
