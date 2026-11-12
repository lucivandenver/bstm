import { DataTypes } from 'sequelize';
import { sequelize, User, Course, CourseAttempt } from './learningModels.js';
const json = value => ({ type: DataTypes.JSON, allowNull: false, defaultValue: value });
export const CourseRevision = sequelize.define('CourseRevision', { courseId: DataTypes.INTEGER, actorId: DataTypes.INTEGER, version: DataTypes.INTEGER, action: DataTypes.STRING(30), snapshot: json({}) });
export const CourseAssignment = sequelize.define('CourseAssignment', { courseId: { type: DataTypes.INTEGER, allowNull: false }, sectionId: { type: DataTypes.INTEGER, allowNull: false }, facultyId: DataTypes.INTEGER, dueAt: DataTypes.DATE, required: { type: DataTypes.BOOLEAN, defaultValue: true } }, { indexes: [{ unique: true, fields: ['courseId', 'sectionId'] }] });
export const QuestionBank = sequelize.define('QuestionBank', { ownerId: DataTypes.INTEGER, prompt: DataTypes.TEXT, options: json([]), answer: DataTypes.INTEGER, explanation: DataTypes.TEXT, domain: DataTypes.STRING(60), sourceReference: DataTypes.STRING(200), sourceQuote: DataTypes.TEXT, reviewed: { type: DataTypes.BOOLEAN, defaultValue: false }, active: { type: DataTypes.BOOLEAN, defaultValue: true } });
export const SourceDocument = sequelize.define('SourceDocument', { ownerId: DataTypes.INTEGER, filename: DataTypes.STRING, sections: json([]), generationSettings: DataTypes.JSON });
export const SourceFilePart = sequelize.define('SourceFilePart', {
  ownerId: { type: DataTypes.INTEGER, allowNull: false },
  sourceId: { type: DataTypes.INTEGER, allowNull: false },
  documentKey: { type: DataTypes.STRING(64), allowNull: false },
  part: { type: DataTypes.INTEGER, allowNull: false },
  filename: DataTypes.STRING(120),
  bytes: DataTypes.INTEGER,
  content: { type: DataTypes.BLOB('long'), allowNull: false }
}, { indexes: [{ unique: true, fields: ['sourceId', 'documentKey', 'part'] }] });
export const AiJob = sequelize.define('AiJob', { userId: DataTypes.INTEGER, type: DataTypes.STRING(30), status: DataTypes.STRING(20), errorCode: DataTypes.STRING(80), sourceId: DataTypes.INTEGER, courseId: DataTypes.INTEGER, state: json({}) });
export const DiagnosticDraft = sequelize.define('DiagnosticDraft', { userId: { type: DataTypes.INTEGER, unique: true }, answers: json({}), revision: { type: DataTypes.INTEGER, defaultValue: 0 } });
export const QuizDraft = sequelize.define('QuizDraft', { userId: DataTypes.INTEGER, attemptId: DataTypes.INTEGER, scope: DataTypes.STRING(60), answers: json({}), revision: { type: DataTypes.INTEGER, defaultValue: 0 }, startedAt: DataTypes.DATE }, { indexes: [{ unique: true, fields: ['userId', 'attemptId', 'scope'] }] });
export const PracticalSubmission = sequelize.define('PracticalSubmission', { userId: DataTypes.INTEGER, attemptId: DataTypes.INTEGER, taskId: DataTypes.STRING(60), response: DataTypes.TEXT, link: DataTypes.STRING(1000), scores: json({}), grade: DataTypes.INTEGER, feedback: DataTypes.TEXT, status: { type: DataTypes.STRING(30), defaultValue: 'submitted' }, gradedBy: DataTypes.INTEGER, gradedAt: DataTypes.DATE }, { indexes: [{ unique: true, fields: ['attemptId', 'taskId'] }] });
export const CourseFeedback = sequelize.define('CourseFeedback', { userId: DataTypes.INTEGER, attemptId: { type: DataTypes.INTEGER, unique: true }, rating: DataTypes.INTEGER, comment: DataTypes.TEXT });
export const FacultyNote = sequelize.define('FacultyNote', { studentId: DataTypes.INTEGER, facultyId: DataTypes.INTEGER, feedback: DataTypes.TEXT, remediation: DataTypes.TEXT, visibility: DataTypes.STRING(20) });
export const ProfileCorrection = sequelize.define('ProfileCorrection', { userId: DataTypes.INTEGER, studentId: DataTypes.STRING(40), section: DataTypes.STRING(60), reason: DataTypes.TEXT, status: { type: DataTypes.STRING(20), defaultValue: 'pending' }, reviewedBy: DataTypes.INTEGER });
export const StudentFile = sequelize.define('StudentFile', { userId: DataTypes.INTEGER, kind: DataTypes.STRING(20), filename: DataTypes.STRING, mime: DataTypes.STRING(100), data: DataTypes.BLOB('long') });
export const CredentialRequest = sequelize.define('CredentialRequest', {
  courseId: { type: DataTypes.INTEGER, allowNull: false }, facultyId: { type: DataTypes.INTEGER, allowNull: false },
  facultySignature: { type: DataTypes.TEXT('long'), allowNull: false }, badge: json({ enabled: true, label: 'Course completion' }),
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' }, remarks: DataTypes.TEXT,
  reviewedBy: DataTypes.INTEGER, reviewedAt: DataTypes.DATE
}, { indexes: [{ unique: true, fields: ['courseId'] }] });
for (const m of [CourseRevision, CourseAssignment]) m.belongsTo(Course, { foreignKey: 'courseId', onDelete: 'RESTRICT' });
for (const m of [QuizDraft, PracticalSubmission, CourseFeedback]) m.belongsTo(CourseAttempt, { foreignKey: 'attemptId', onDelete: 'RESTRICT' });
for (const m of [QuizDraft, PracticalSubmission, CourseFeedback, StudentFile, ProfileCorrection]) m.belongsTo(User, { foreignKey: 'userId', onDelete: 'RESTRICT' });
