import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { User } from './userModel.js';
export const Section = sequelize.define('Section', {
  name: { type: DataTypes.STRING(60), allowNull: false, unique: true }, academicYear: DataTypes.STRING(30),
  facultyId: { type: DataTypes.INTEGER, allowNull: true }, active: { type: DataTypes.BOOLEAN, defaultValue: true }
});
Section.belongsTo(User, { foreignKey: 'facultyId', as: 'faculty', onDelete: 'RESTRICT' });
export const AuditLog = sequelize.define('AuditLog', {
  actorId: DataTypes.INTEGER, action: { type: DataTypes.STRING(80), allowNull: false },
  targetType: DataTypes.STRING(40), targetId: DataTypes.STRING(60), details: DataTypes.JSON
});
export const Setting = sequelize.define('Setting', { key: { type: DataTypes.STRING(60), unique: true }, value: DataTypes.TEXT });
export const Announcement = sequelize.define('Announcement', {
  title: { type: DataTypes.STRING(160), allowNull: false }, body: { type: DataTypes.TEXT, allowNull: false },
  audience: { type: DataTypes.STRING(20), defaultValue: 'all' }, published: { type: DataTypes.BOOLEAN, defaultValue: true }, authorId: DataTypes.INTEGER
});
export const CareerPath = sequelize.define('CareerPath', {
  title: { type: DataTypes.STRING(160), unique: true, allowNull: false }, focus: DataTypes.STRING(160),
  required: { type: DataTypes.JSON, allowNull: false }, active: { type: DataTypes.BOOLEAN, defaultValue: true }
});
