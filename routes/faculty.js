import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { requireUser, requireFaculty, asyncRoute } from '../middleware/security.js';
import { googleStart } from '../controllers/googleController.js';
import * as c from '../controllers/facultyController.js';
const r = Router(); r.use(requireUser, requireFaculty);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 8 } });
r.get('/', asyncRoute(c.dashboard)); r.get('/profile', c.profile); r.post('/profile', asyncRoute(c.saveProfile)); r.post('/connect-google', googleStart);
r.get('/courses', asyncRoute(c.courses)); r.get('/courses/new', asyncRoute(c.editor)); r.post('/courses', asyncRoute(c.saveCourse));
r.get('/courses/:id/edit', asyncRoute(c.editor)); r.post('/courses/:id', asyncRoute(c.saveCourse)); r.post('/courses/:id/archive', asyncRoute(c.archiveCourse)); r.get('/courses/:id/preview', asyncRoute(c.preview));
r.get('/credentials', asyncRoute(c.credentials)); r.post('/courses/:id/credentials', asyncRoute(c.submitCredential));
const draftLimit = (limit, manual) => rateLimit({
  windowMs: 60000, limit, keyGenerator: req => String(req.user.id),
  skip: req => (req.body.mode === 'manual') !== manual,
  handler: (req, res) => res.status(429).json({ ok: false, code: 'COURSE_REQUEST_LIMIT', message: 'Too many draft requests. Wait one minute before retrying. Your saved source remains available.' })
});
r.get('/upload', asyncRoute(c.uploadPage));
r.post('/upload', rateLimit({ windowMs: 60000, limit: 5 }), upload.single('source'), asyncRoute(c.upload));
r.get('/sources/:id', asyncRoute(c.source));
r.post('/sources/:id/generate', draftLimit(2, false), draftLimit(5, true), asyncRoute(c.generate));
r.get('/questions', asyncRoute(c.bank)); r.post('/questions', asyncRoute(c.saveQuestion)); r.post('/questions/:id', asyncRoute(c.saveQuestion));
r.get('/students', asyncRoute(c.students)); r.get('/students/:id', asyncRoute(c.student)); r.post('/students/:id/notes', asyncRoute(c.note));
r.get('/monitoring', asyncRoute(c.monitoring)); r.get('/reports', asyncRoute(c.monitoring));
r.get('/assignments', asyncRoute(c.assignments)); r.post('/assignments', asyncRoute(c.assign));
r.get('/evaluations', asyncRoute(c.evaluations)); r.post('/evaluations/:id', asyncRoute(c.gradeTask));
r.get('/announcements', asyncRoute(c.announcements)); r.post('/announcements', asyncRoute(c.announce));
export default r;
