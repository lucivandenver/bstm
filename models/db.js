import '../config/env.js';
import { Sequelize } from 'sequelize';
import { mysqlConnection } from '../config/deployment.js';
const testing = process.env.NODE_ENV === 'test' && process.env.TEST_DB_STORAGE;
const { database, user, password, host, port, ssl } = testing ? {} : mysqlConnection();
export const sequelize = testing ? new Sequelize({
  dialect: 'sqlite', storage: process.env.TEST_DB_STORAGE, logging: false,
  dialectModule: await import('../tests/sqliteAdapter.js')
}) : new Sequelize(
  database, user, password,
  { host, port, dialect: 'mysql', logging: false, dialectOptions: ssl ? { ssl } : {}, pool: { max: 5, min: 0, idle: 10000 } }
);
