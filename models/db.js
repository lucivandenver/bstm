import '../config/env.js';
import { Sequelize } from 'sequelize';
import { mysqlTransport } from '../config/deployment.js';
const testing = process.env.NODE_ENV === 'test' && process.env.TEST_DB_STORAGE;
export const sequelize = testing ? new Sequelize({
  dialect: 'sqlite', storage: process.env.TEST_DB_STORAGE, logging: false,
  dialectModule: await import('../tests/sqliteAdapter.js')
}) : new Sequelize(
  process.env.DB_NAME || 'BSTM', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '',
  { host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306), dialect: 'mysql', logging: false, dialectOptions: mysqlTransport(), pool: { max: 5, min: 0, idle: 10000 } }
);
