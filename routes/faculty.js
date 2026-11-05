import { Router } from 'express';
import { AiJob } from '../models/portalModels.js';
import multer from 'multer';
import { sourceLimits } from '../services/sourceLimits.js';
import { sourceUploadStorage } from '../services/sourceUploadStorage.js';
import { rateLimit } from 'express-rate-limit';
import { requireUser, requireFaculty, asyncRoute } from '../middleware/security.js';
import { googleStart } from '../controllers/googleController.js';
import * as c from '../controllers/facultyController.js';
const r = Router(); r.use(requireUser, requireFaculty);
const upload = multer({ storage: sourceUploadStorage(), limits: { fileSize: sourceLimits.fileBytes + 1, files: sourceLimits.requestFiles, fields: 8 } });
r.get('/', asyncRoute(c.dashboard)); r.get('/profile', c.profile); r.post('/profile', asyncRoute(c.saveProfile)); r.post('/connect-google', googleStart);
r.get('/courses', asyncRoute(c.courses)); r.get('/courses/new', asyncRoute(c.editor)); r.post('/courses', asyncRoute(c.saveCourse));
r.get('/courses/:id/edit', asyncRoute(c.editor)); r.post('/courses/:id', asyncRoute(c.saveCourse)); r.post('/courses/:id/archive', asyncRoute(c.archiveCourse)); r.post('/courses/:id/delete', asyncRoute(c.deleteDraft)); r.get('/courses/:id/preview', asyncRoute(c.preview));
r.get('/credentials', asyncRoute(c.credentials)); r.post('/courses/:id/credentials', asyncRoute(c.submitCredential));
const draftLimit = (limit, manual) => rateLimit({
  windowMs: 60000, limit, keyGenerator: req => String(req.user.id),
  skip: async req => (req.body.mode === 'manual') !== manual || (!manual && req.body.background === 'yes' && Boolean(await AiJob.findOne({where:{userId:req.user.id,sourceId:req.params.id,status:'running',type:'course-draft'}}))),
  handler: (req, res) => res.status(429).json({ ok: false, code: 'COURSE_REQUEST_LIMIT', message: 'Too many draft requests. Wait one minute before retrying. Your saved source remains available.' })
});
r.get('/upload', asyncRoute(c.uploadPage));
r.post('/upload', rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => String(req.user.id), handler: (req,res) => res.status(429).json({ok:false,message:'Upload paused. Wait one minute and retry the remaining files; extracted files are saved.'}) }), (req,res,next) => upload.array('sources', sourceLimits.requestFiles)(req,res,error => { if (!error) return next(); const message=error.code==='LIMIT_TOTAL_SIZE'?'Combined request exceeds 100 MB. Use the upload queue to send files one at a time.':error.code==='LIMIT_FILE_SIZE'?'Each file can be up to 100 MB. The remaining files have not been uploaded.':'Upload up to 20 files per request, or use the sequential upload queue.'; if(req.get('accept')?.includes('application/json'))return res.status(413).json({ok:false,message}); error.status=413;error.message=message;next(error); }), asyncRoute(c.upload));
r.get('/sources/:id', asyncRoute(c.source)); r.post('/sources/:id/delete', asyncRoute(c.deleteSource));
r.post('/sources/:id/generate', draftLimit(2, false), draftLimit(5, true), asyncRoute(c.generate));
r.get('/generation/:id', asyncRoute(c.generationStatus));
r.get('/questions', asyncRoute(c.bank)); r.post('/questions', asyncRoute(c.saveQuestion)); r.post('/questions/:id', asyncRoute(c.saveQuestion));
r.get('/students', asyncRoute(c.students)); r.get('/students/:id', asyncRoute(c.student)); r.post('/students/:id/notes', asyncRoute(c.note));
r.get('/monitoring', asyncRoute(c.monitoring)); r.get('/reports', asyncRoute(c.monitoring));
r.get('/assignments', asyncRoute(c.assignments)); r.post('/assignments', asyncRoute(c.assign));
r.get('/evaluations', asyncRoute(c.evaluations)); r.post('/evaluations/:id', asyncRoute(c.gradeTask));
r.get('/announcements', asyncRoute(c.announcements)); r.post('/announcements', asyncRoute(c.announce));
export default r;
