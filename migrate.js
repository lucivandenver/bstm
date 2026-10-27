import { sequelize } from './models/db.js';
import { migrateStudent } from './migrations/student.js';
try {
  await migrateStudent();
  console.log('Student schema ready. Existing records preserved. Run npm run seed:student for optional starter courses.');
} catch (error) {
  console.error('Migration failed:', error.message);
  console.error('Ensure the database named in .env exists first. Back up existing data before migrating.');
  process.exitCode = 1;
} finally { await sequelize.close(); }
