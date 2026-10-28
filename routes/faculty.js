import { Router } from 'express';
import { requireUser, requireFaculty, asyncRoute } from '../middleware/security.js';
import { googleStart } from '../controllers/googleController.js';
import * as c from '../controllers/facultyController.js';
const r = Router(); r.use(requireUser, requireFaculty);
r.get('/', asyncRoute(c.dashboard)); r.get('/profile', c.profile); r.post('/profile', asyncRoute(c.saveProfile)); r.post('/connect-google', googleStart);
export default r;
