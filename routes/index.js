
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
import { homePage } from "../controllers/homeController.js";
import { loginPage, registerPage, forgotPasswordPage, dashboardPage, loginUser, registerUser, logoutUser } from "../controllers/authController.js";
import { googleStart, googleCallback } from '../controllers/googleController.js';
import { verify } from '../controllers/studentController.js';
import { asyncRoute, requireUser } from '../middleware/security.js';
import studentRoutes from './student.js';
const router = express.Router();
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, message: 'Too many sign-in attempts. Try again in 15 minutes.' });
router.get("/", homePage);
router.get("/about", (req, res) => res.render("about", { title: "About CareerBridge" }));
router.get("/login", loginPage);
router.post("/login", authLimit, asyncRoute(loginUser));
router.get("/register", registerPage);
router.post("/register", authLimit, asyncRoute(registerUser));
router.get("/forgot-password", forgotPasswordPage);
router.get("/auth/google", authLimit, googleStart);
router.get("/auth/google/callback", authLimit, asyncRoute(googleCallback));
router.get("/dashboard", requireUser, dashboardPage);
router.post("/logout", logoutUser);
router.use('/student', studentRoutes);
router.get('/verify/:id', asyncRoute(verify));
export default router;
