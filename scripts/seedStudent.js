import { Course, sequelize } from '../models/learningModels.js';
import { starterCourses } from '../data/starterCourses.js';
try {
  for (const course of starterCourses) {
    await Course.findOrCreate({ where: { slug: course.slug }, defaults: { ...course, prerequisites: [], published: true, starter: true, version: 1 } });
  }
  console.log('Four starter courses are available. Re-running does not replace edited courses. Faculty validation required before academic use.');
} catch (err) { console.error(err.message); process.exitCode = 1; }
finally { await sequelize.close(); }
