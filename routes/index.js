import * as portal from '../controllers/portalController.js';

  /*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import express from "express";
import { rateLimit } from 'express-rate-limit';
import { homePage, aboutPage } from "../controllers/homeController.js";
import { loginPage, registerPage, forgotPasswordPage, dashboardPage, loginUser, registerUser, logoutUser, cancelGoogleRegistration } from "../controllers/authController.js";
import { googleStart, googleCallback } from '../controllers/googleController.js';
import { verify } from '../controllers/studentController.js';
import { asyncRoute, requireUser } from '../middleware/security.js';
import adminRoutes from './admin.js';
import facultyRoutes from './faculty.js';
import studentRoutes from './student.js';
const router = express.Router();
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, message: 'Too many sign-in attempts. Try again in 15 minutes.' });
router.get("/", asyncRoute(homePage));
router.get('/privacy', (req,res) => res.render('accountInformation', { title: 'How your information is used', privacy: true }));
router.get('/terms', (req,res) => res.render('accountInformation', { title: 'Using CareerBridge', privacy: false }));
router.get("/about", asyncRoute(aboutPage));
router.get("/login", asyncRoute(loginPage));
router.post("/login", authLimit, asyncRoute(loginUser));
router.get("/register", asyncRoute(registerPage));
router.post("/register", authLimit, asyncRoute(registerUser));
router.post("/register/cancel-google", cancelGoogleRegistration);
router.get("/forgot-password", forgotPasswordPage);
router.get("/auth/google", authLimit, googleStart);
router.get("/auth/google/callback", authLimit, asyncRoute(googleCallback));
router.get("/dashboard", requireUser, dashboardPage);
router.post("/logout", logoutUser);
router.use('/student', studentRoutes);
router.use('/admin', adminRoutes);
router.use('/faculty', facultyRoutes);
router.get('/verify/:id', asyncRoute(verify));
router.get('/notifications', requireUser, asyncRoute(portal.notifications));
router.get('/notifications/count', requireUser, asyncRoute(portal.notificationCount));
router.get('/notifications/feed', requireUser, asyncRoute(portal.notificationFeed));
router.get('/notifications/stream', requireUser, asyncRoute(portal.notificationStream));
router.post('/notifications/read', requireUser, asyncRoute(portal.readAll));
router.post('/notifications/:id/open', requireUser, asyncRoute(portal.openNotification));
router.get('/files/:id', requireUser, asyncRoute(portal.file));
export default router;
