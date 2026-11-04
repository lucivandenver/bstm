import { buildEvidence, summarizeLearning } from '../services/evidence.js';
import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { User, Course, CourseAttempt, Assessment, StudentProfile, Notification, sequelize } from '../models/learningModels.js';
import { Section, Announcement, Setting } from '../models/adminModels.js';
import { CourseRevision, CourseAssignment, QuestionBank, SourceDocument, AiJob, PracticalSubmission, FacultyNote, CredentialRequest } from '../models/portalModels.js';
import { text } from '../services/validation.js';
import { audit } from '../services/accounts.js';
import { domains } from '../data/starterCourses.js';
import { blankCourse, courseInput, publishCheck, questionInput, fail } from '../services/courseAuthoring.js';
import { generateCourse, manualSourceDraft, aiConfiguration, sourceSections } from '../services/courseAi.js';
import { generationError, safeGenerationError } from '../services/courseGenerationErrors.js';
import { extractSource } from '../services/sourceExtraction.js';
import { progress, careerMatches, publicQuestions } from '../services/learning.js';
import { finalizeAttempt } from '../services/portalLearning.js';
const plain = r => r?.get({ plain: true });
const date = d => d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'â€”';
const render = (res, view, data = {}) => res.render(`faculty/${view}`, { facultyNav: view, ...data });
export const assignedSections = req => Section.findAll({ where: { active: true }, order: [['name','ASC']] });
export async function assignedStudents(req) { const courses = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] }), ids = courses.map(c => c.id); const [attempts, assignments, legacySections] = await Promise.all([CourseAttempt.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['userId'], group: ['userId'] }), CourseAssignment.findAll({ where: { courseId: { [Op.in]: ids } }, attributes: ['sectionId'] }), Section.findAll({ where: { facultyId: req.user.id, active: true }, attributes: ['id', 'name'] })]); const sections = [...new Map([...legacySections, ...(assignments.length ? await Section.findAll({ where: { id: { [Op.in]: assignments.map(a => a.sectionId) } }, attributes: ['id', 'name'] }) : [])].map(section => [section.id, section])).values()]; const scopes = [{ id: { [Op.in]: attempts.map(a => a.userId) } }]; if (sections.length) scopes.push({ section: { [Op.in]: sections.map(s => s.name) } }); return User.findAll({ where: { role: 'student', [Op.or]: scopes }, attributes: ['id', 'name', 'studentId', 'section', 'email', 'gender'] }); }
async function studentAccess(req) { const students = await assignedStudents(req); const s = students.find(s => s.id === Number(req.params.id)); if (!s) fail('Assigned student not found.', 404); return s; }
async function ownedCourse(req, transaction) { const c = await Course.findOne({ where: { id: req.params.id, ownerId: req.user.id }, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) }); if (!c) fail('Course not found or not owned by your account.', 404); return c; }
export const dashboard = async (req, res) => {
  const sections = await assignedSections(req), students = await assignedStudents(req), owned = await Course.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
  const attempts = await CourseAttempt.findAll({ where: { userId: { [Op.in]: students.map(s => s.id) }, courseId: { [Op.in]: owned.map(c => c.id) } }, order: [['createdAt', 'DESC']] });
  const pending = await PracticalSubmission.count({ where: { attemptId: { [Op.in]: attempts.map(a => a.id) }, status: 'submitted' } });
  const completed = attempts.filter(a => a.status === 'completed').length;
  render(res, 'dashboard', { title: 'Faculty overview', students: students.slice(0, 8).map(plain), sections: sections.map(plain), studentCount: students.length, courseCount: await Course.count({ where: { ownerId: req.user.id } }), publishedCount: await Course.count({ where: { ownerId: req.user.id, published: true } }), pendingCredentials: await CredentialRequest.count({ where: { facultyId: req.user.id, status: 'pending' } }), active: new Set(attempts.filter(a => a.status !== 'completed').map(a => a.userId)).size, pending, completed, completionRate: attempts.length ? Math.round(completed / attempts.length * 100) : 0, support: students.filter(s => attempts.some(a => a.userId === s.id && a.status !== 'completed' && (!a.lastActivityAt || Date.now() - new Date(a.lastActivityAt) > 7 * 86400000))).map(plain) });
};
export const profile = (req, res) => render(res, 'profile', { title: 'My faculty profile', googleConnected: Boolean(req.user.googleId), returned: req.user.approvalStatus === 'returned' });
export const saveProfile = async (req, res) => { const name = text(req.body.name, 100), facultyPosition = text(req.body.facultyPosition, 120), facultyEducation = text(req.body.facultyEducation, 200), facultyQualifications = text(req.body.facultyQualifications, 2000); if (name.length < 2 || !facultyPosition || !facultyEducation || !facultyQualifications) fail('Complete your name, position, education and qualifications.'); const resubmit = req.user.approvalStatus === 'returned'; await req.user.update({ name, facultyPosition, facultyEducation, facultyQualifications, ...(resubmit ? { approvalStatus: 'pending', facultyReviewedBy: null, facultyReviewedAt: null } : {}) }); if (resubmit) { const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'] }); await Notification.bulkCreate(admins.map(admin \ÈH]ØZ]ZKœÚÝÒ[™^
	Õ\Ù\œÉÊNÃBˆ›Üˆ
ÛÛœÝšY[ÙˆÉÙ[XZ[	Ë	ÜÝY[Y	Ë	Ù˜XÝ[RY	Ë	ÙÛÛÙÛRY	×JHÃBˆYˆ
Z[™^\ËœÛÛYJHOˆK[š\]YH	‰ˆK™šY[Ë›[™ÝOOHH	‰ˆK™šY[ÖÌK˜]šX]HOOHšY[
JHÃBˆ]ØZ]ZK˜Y[™^
	Õ\Ù\œÉËÙšY[KÈ[š\]YNˆYK˜[YNˆ\Ù\œ×ÉÙšY[WÝ[š\]YXJNÃBˆCBˆCBˆCBˆÛÛœÝ^[™H\Þ[˜È
X›KšY[ÊHOˆÃBˆYˆ
]X›\Ëš[˜ÛY\ÊX›JJH™]\›ŽÃBˆÛÛœÝÛÛ[[œÈH]ØZ]ZK™\ØÜšX™UX›JX›JNÃBˆ›Üˆ
ÛÛœÝÛ˜[YKÜX×HÙˆØš™XÝ™[šY\ÊšY[ÊJHYˆ
XÛÛ[[œÖÛ˜[YWJH]ØZ]ZK˜YÛÛ[[ŠX›K˜[YKÜXÊNÃBˆNÃBˆ]ØZ]^[™
	ÐÛÝ\œÙ\ÉËÈÝÛ™\’YˆÈ\Nˆ]U\\Ë’S•QÑT‹[ÝÓ[ˆYHKÝ]ÛÛY\ÎˆÈ\Nˆ]U\\Ë’”ÓÓ‹[ÝÓ[ˆYHK\ÚÜÎˆÈ\Nˆ]U\\Ë’”ÓÓ‹[ÝÓ[ˆYHKÛXÞNˆÈ\Nˆ]U\\Ë’”ÓÓ‹[ÝÓ[ˆYHK[œ›Ûœ›ÛNˆÈ\Nˆ]U\\Ë‘UHK[œ›Û[[ˆÈ\Nˆ]U\\Ë‘UHKXY[™NˆÈ\Nˆ]U\\Ë‘UHKÙ\YšXØ]Q[˜X›YˆÈ\Nˆ]U\\Ë“ÓÓPS‹Y˜][˜[YNˆYHK]Ø\™Ð\›Ý™YˆÈ\Nˆ]U\\Ë“ÓÓPS‹[ÝÓ[ˆ˜[ÙKY˜][˜[YNˆ˜[ÙHHJNÃBˆ]ØZ]^[™
	ÐÛÝ\œÙP][\ÉËÈ\Ý\ÜÛÛ’YˆÈ\Nˆ]U\\Ë”Õ’S‘ÊL
K[ÝÓ[ˆYHHJNÃBˆ]ØZ]^[™
	ÐÜ™Y[X[ÉËÈ˜XÝ[TÚYÛ˜]\™NˆÈ\Nˆ]U\\Ë•V
	ÛÛ™ÉÊHK˜XÝ[S˜[YNˆÈ\Nˆ]U\\Ë”Õ’S‘ÊL
HKYZ[”ÚYÛ˜]\™NˆÈ\Nˆ]U\\Ë•V
	ÛÛ™ÉÊHKYZ[“˜[YNˆÈ\Nˆ]U\\Ë”Õ’S‘ÊMŒ
HK˜YÙSX™[ˆÈ\Nˆ]U\\Ë”Õ’S‘ÊŒ
HHJNÃBˆYˆ
Ù\]Y[^™K™Ù]X[XÝ

HOOH	Û^\Ü[	È	‰ˆX›\Ëš[˜ÛY\Ê	ÔÙ][™ÜÉÊJHÈÛÛœÝÙ][™ÜÐÛÛ[[œÈH]ØZ]ZK™\ØÜšX™UX›J	ÔÙ][™ÜÉÊNÈYˆ
Ù][™ÜÐÛÛ[[œË˜[YH	‰ˆTÝš[™ÊÙ][™ÜÐÛÛ[[œË˜[YK\JKÓÝÙ\Ø\ÙJ
Kš[˜ÛY\Ê	ÛÛ™Ý^	ÊJH]ØZ]ZK˜Ú[™ÙPÛÛ[[Š	ÔÙ][™ÜÉË	Ý˜[YIËÈ\Nˆ]U\\Ë•V
	ÛÛ™ÉÊK[ÝÓ[ˆYHJNÈCBˆ]ØZ]^[™
	ÐØ\™Y\”]ÉËÈ]X[YšXØ][ÛœÎˆÈ\Nˆ]U\\Ë•VHJNÃBˆ]ØZ]^[™
	ÔÝY[›Ùš[\ÉËØš™XÝ™œ›ÛQ[šY\ÊÉÜ™[ØØ]IË	Ý\™Ù]›Û\ÉË	ÝÛÜšÔ™Y™\™[˜Ù\ÉË	ÛÚ\ÚÜÉ×K›X\
˜[YHOˆÛ˜[YKÈ\Nˆ]U\\Ë•VWJJJNÃBˆËÈÜ™X]\ÈZ\ÜÚ[™ÈX›\ÈÛ›Kˆ™]™\ˆ›Ü˜ÙK\Þ[˜ÈÜˆ™\Ù]^\Ý[™ÈÝY[]KƒBˆ]ØZ]Ù\]Y[^™KœÞ[˜Ê
NÃBˆ]ØZ]ÙYYYZ[š\Ý˜][ÛŠ
NÃBˆ]ØZ]›ÛÝÝ˜\YZ[Š
NÃBŸCB