import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { User } from './userModel.js';
const json = (value) => ({ type: DataTypes.JSON, allowNull: false, defaultValue: value });
export const StudentProfile = sequelize.define('StudentProfile', {
  userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  yearLevel: DataTypes.STRING(30), academicYear: DataTypes.STRING(30), graduationYear: DataTypes.STRING(4),
  ojtStatus: DataTypes.STRING(40), ojtCompany: DataTypes.STRING(160), ojtArea: DataTypes.STRING(100),
  ojtHours: DataTypes.INTEGER, careerInterest: DataTypes.STRING(80), preferredLocation: DataTypes.STRING(120),
  languages: DataTypes.STRING(200), skills: DataTypes.TEXT, qualifications: DataTypes.TEXT,
  bio: DataTypes.TEXT, complete: { type: DataTypes.BOOLEAN, defaultValue: false }
});
export const Course = sequelize.define('Course', {
  slug: { type: DataTypes.STRING, unique: true, allowNull: false }, title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT, domain: DataTypes.STRING(60), level: DataTypes.STRING(40),
  minutes: DataTypes.INTEGER, version: { type: DataTypes.INTEGER, defaultValue: 1 },
  passingScore: { type: DataTypes.INTEGER, defaultValue: 75 },
  modules: json([]), questions: json([]), prerequisites: json([]),
  published: { type: DataTypes.BOOLEAN, defaultValue: false }, starter: { type: DataTypes.BOOLEAN, defaultValue: false }
});
export const CourseAttempt = sequelize.define('CourseAttempt', {
  userId: { type: DataTypes.INTEGER, allowNull: false }, courseId: { type: DataTypes.INTEGER, allowNull: false },
  attemptNumber: { type: DataTypes.INTEGER, allowNull: false }, courseVersion: DataTypes.INTEGER,
  // Snapshot freezes the requirements for this attempt when a course is later edited.
  snapshot: json({}), completedLessons: json([]), quizScores: json({}),
  quizAttempts: json([]), status: { type: DataTypes.STRING(30), defaultValue: 'ongoing' },
  finalScore: DataTypes.INTEGER, completedAt: DataTypes.DATE, activeSeconds: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastActivityAt: DataTypes.DATE, lastHeartbeatAt: DataTypes.DATE
}, { indexes: [{ unique: true, fields: ['userId', 'courseId', 'attemptNumber'] }] });
export const Assessment = sequelize.define('Assessment', {
  userId: { type: DataTypes.INTEGER, allowNull: false }, scores: json({}), score: DataTypes.INTEGER,
  answers: json([]), version: { type: DataTypes.INTEGER, defaultValue: 1 }
});
export const Credential = sequelize.define('Credential', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false }, attemptId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  courseTitle: DataTypes.STRING, recipientName: DataTypes.STRING, courseVersion: DataTypes.INTEGER,
  score: DataTypes.INTEGER, stars: DataTypes.INTEGER, issuedAt: DataTypes.DATE,
  revoked: { type: DataTypes.BOOLEAN, defaultValue: false }
});
export const Notification = sequelize.define('Notification', {
  userId: { type: DataTypes.INTEGER, allowNull: false }, title: DataTypes.STRING, message: DataTypes.TEXT, href: DataTypes.STRING,
  readAt: DataTypes.DATE
});
for (const model of [StudentProfile, CourseAttempt, Assessment, Credential, Notification]) {
  model.belongsTo(User, { foreignKey: 'userId', onDelete: 'RESTRICT' });
}
CourseAttempt.belongsTo(Course, { foreignKey: 'courseId', onDelete: 'RESTRICT' });
Credential.belongsTo(CourseAttempt, { foreignKey: 'attemptId', onDelete: 'RESTRICT' });
export { User, sequelize };
