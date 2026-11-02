import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.TEST_DB_STORAGE=':memory:';
const {sequelize,User,Course,CourseAttempt,StudentProfile}=await import('../models/learningModels.js');
const {migrateStudent}=await import('../migrations/student.js');
await test('additive portal migration upgrades a legacy course table twice while preserving users and attempts',async()=>{
  const qi=sequelize.getQueryInterface();
  const newColumns=['ownerId','outcomes','tasks','policy','enrollFrom','enrollUntil','deadline','certificateEnabled'];
  const oldAttributes=Object.fromEntries(Object.entries(Course.getAttributes()).filter(([name])=>!newColumns.includes(name)));
  await qi.createTable('Courses',oldAttributes);await sequelize.sync();
  const user=await User.create({name:'Legacy Student',email:'legacy@example.test',studentId:'OLD-001',section:'BSTM 4-1',role:'student',gender:'Female'});
  const legacy={slug:'legacy',title:'Existing course',domain:'Communication',modules:[],questions:[],prerequisites:[],version:3,passingScore:75,minutes:30,published:true};
  const course=await Course.create(legacy,{fields:Object.keys(legacy)});
  const attempt=await CourseAttempt.create({userId:user.id,courseId:course.id,attemptNumber:1,courseVersion:3,snapshot:legacy,status:'completed',finalScore:92,completedAt:new Date()});
  try{
    await migrateStudent();await migrateStudent();
    assert.equal((await User.findByPk(user.id)).studentId,'OLD-001');assert.equal((await Course.findByPk(course.id)).version,3);
    assert.equal((await CourseAttempt.findByPk(attempt.id)).snapshot.title,'Existing course');assert.equal((await CourseAttempt.findByPk(attempt.id)).finalScore,92);
    const columns=await qi.describeTable('Courses');for(const name of newColumns)assert.ok(columns[name],name);
    const tables=await qi.showAllTables();assert.ok(tables.includes('PracticalSubmissions'));assert.ok(tables.includes('DiagnosticDrafts'));
  }finally{await sequelize.close();}
});
