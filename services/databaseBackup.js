import { addAbortSignal } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mysql from 'mysql2';
import { mysqlConnection } from '../config/deployment.js';

const header = `SET FOREIGN_KEY_CHECKS=0;
SET NAMES utf8mb4 COLLATE utf8mb4_general_ci;
SET @backup_sql_mode = @@SESSION.sql_mode;
SET @backup_time_zone = @@SESSION.time_zone;
SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';
SET SESSION time_zone = '+00:00';
`;

const footer = `
SET SESSION time_zone = @backup_time_zone;
SET SESSION sql_mode = @backup_sql_mode;
SET FOREIGN_KEY_CHECKS=1;
`;

// Skip quoted literals and identifiers, including comments stored as SQL strings.
const schemaCollation = /'(?:[^'\\]|\\[\s\S]|'')*'|"(?:[^"\\]|\\[\s\S]|"")*"|`(?:[^`]|``)*`|(\bCOLLATE(?:\s*=\s*|\s+))(?:utf8mb4_0900_ai_ci|`utf8mb4_0900_ai_ci`)(?![\w$])/gi;
const portableSchema = ddl => ddl.replace(schemaCollation, (match, clause) => clause ? clause + 'utf8mb4_general_ci' : match);
const identifier = name => mysql.escapeId(name, true);

function sqlValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || Buffer.isBuffer(value)) {
    return mysql.escape(value);
  }
  throw new Error('A database value has an unsupported type for SQL export.');
}

export async function streamDatabaseBackup(output, signal) {
  signal.throwIfAborted();
  const connection = mysql.createConnection({
    ...mysqlConnection(),
    charset: 'UTF8MB4_GENERAL_CI',
    dateStrings: true,
    jsonStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 10000,
  });
  const client = connection.promise();
  let rowStream;
  // Socket failures during a streamed query are emitted by the connection.
  connection.on('error', error => rowStream?.destroy(error));

  async function metadata(sql) {
    signal.throwIfAborted();
    const [rows] = await client.query({ sql, timeout: 10000 });
    return rows;
  }

  try {
    await client.connect();
    await metadata("SET SESSION time_zone = '+00:00'");
    await metadata("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
    await metadata('SET SESSION sql_quote_show_create = 1');
    await metadata('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await metadata('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const tables = await metadata("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");

    async function* dump() {
      yield header;
      for (const table of tables) {
        const name = identifier(Object.values(table)[0]);
        const [definition] = await metadata(`SHOW CREATE TABLE ${name}`);
        yield `\n${portableSchema(definition['Create Table'])};\n`;

        // Explicit columns preserve invisible fields and leave calculated values to MySQL.
        const columns = (await metadata(`SHOW COLUMNS FROM ${name}`))
          .filter(column => !/\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/i.test(column.Extra))
          .map(column => identifier(column.Field))
          .join(', ');
        const insert = `INSERT INTO ${name} (${columns}) VALUES (`;
        rowStream = addAbortSignal(signal, connection.query({
          sql: `SELECT ${columns} FROM ${name}`,
          rowsAsArray: true,
          // Keep floating-point values in their original wire representation.
          typeCast: (field, next) => field.type === 'FLOAT' || field.type === 'DOUBLE' ? field.string() : next(),
        }).stream({ highWaterMark: 1 }));
        for await (const row of rowStream) {
          yield `${insert}${row.map(sqlValue).join(', ')});\n`;
        }
        rowStream = undefined;
      }
      await metadata('COMMIT');
      yield footer;
    }

    await pipeline(dump(), output, { signal });
  } finally {
    rowStream?.destroy();
    connection.destroy();
  }
}
