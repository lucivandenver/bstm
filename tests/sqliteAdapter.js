// Test-only sqlite3 callback adapter using Node's built-in SQLite. Production always uses MySQL.
import { DatabaseSync } from 'node:sqlite';
export const OPEN_READWRITE = 2;
export const OPEN_CREATE = 4;
export class Database {
  constructor(filename, mode, callback) {
    this.filename = filename;
    try { this.db = new DatabaseSync(filename); queueMicrotask(() => callback(null)); }
    catch (error) { queueMicrotask(() => callback(error)); }
  }
  serialize(callback) { callback(); }
  run(sql, parameters, callback) {
    if (typeof parameters === 'function') { callback = parameters; parameters = []; }
    try {
      const statement = this.db.prepare(sql);
      const result = Array.isArray(parameters) ? statement.run(...parameters) : statement.run(parameters || {});
      callback?.call({ lastID: Number(result.lastInsertRowid), changes: Number(result.changes) }, null);
    } catch (error) { callback?.(normalise(error)); }
  }
  all(sql, parameters, callback) {
    if (typeof parameters === 'function') { callback = parameters; parameters = []; }
    try {
      const statement = this.db.prepare(sql);
      const result = Array.isArray(parameters) ? statement.all(...parameters) : statement.all(parameters || {});
      callback?.(null, result.map(row => ({ ...row })));
    } catch (error) { callback?.(normalise(error)); }
  }
  close(callback) { try { this.db.close(); callback?.(); } catch (error) { callback?.(error); } }
}
function normalise(error) {
  if (error.message.includes('UNIQUE constraint')) error.code = 'SQLITE_CONSTRAINT_UNIQUE';
  if (error.message.includes('FOREIGN KEY constraint')) error.code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
  return error;
}
