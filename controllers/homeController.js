import { CareerPath } from '../models/adminModels.js';
import { User, Course, CourseAttempt } from '../models/learningModels.js';
export const homePage = async (req, res) => {
  const [students, courses, completions, pathways] = await Promise.all([User.count({ where: { role: 'student', active: true } }), Course.count({ where: { published: true } }), CourseAttempt.count({ where: { status: 'completed' } }), CareerPath.count({ where: { active: true } })]);
  res.render('home', { title: 'CareerBridge · Your next chapter', stats: { students, courses, completions, pathways } });
};
export const aboutPage = async (req,res) => res.render('about', { title: 'About CareerBridge', stats: { students: await User.count({ where: { role:'student', active:true } }), pathways: await CareerPath.count({ where: { active:true } }) } });
