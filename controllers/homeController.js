import { CareerPath } from '../models/adminModels.js';
import { User, Course, CourseAttempt } from '../models/learningModels.js';
export async function publicOverview() {
  const [students, faculty, courses, completions, pathways] = await Promise.all([
    User.count({where:{role:'student',active:true}}), User.count({where:{role:'faculty',active:true,approvalStatus:'approved'}}),
    Course.count({where:{published:true}}), CourseAttempt.count({where:{status:'completed'}}), CareerPath.count({where:{active:true}})
  ]);
  return {students, faculty, courses, completions, pathways};
}
export const homePage = async (req,res) => res.render('home', {title:'CareerBridge · Your next chapter',isLandingPage:true,stats:await publicOverview()});
export const aboutPage = async (req,res) => res.render('about', {title:'About CareerBridge',stats:await publicOverview()});
