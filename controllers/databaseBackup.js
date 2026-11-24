import { audit } from '../services/accounts.js';
import { streamDatabaseBackup } from '../services/databaseBackup.js';

export async function exportDatabase(req, res) {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', onClose);

  try {
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date());
    const filename = `database_backup_${date}.sql`;
    await audit(req.user.id, 'database.backup.requested', 'database', null, { filename });
    res.set('Cache-Control', 'private, no-store');
    res.attachment(filename).type('application/sql; charset=utf-8');
    await streamDatabaseBackup(res, controller.signal);
  } catch (error) {
    if (controller.signal.aborted && ['AbortError', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code || error.name)) return;
    console.error('Database export failed:', error.code || error.name);
    if (!res.headersSent && !res.destroyed) {
      res.removeHeader('Content-Disposition');
      res.status(500).type('text/plain').send('Could not export the database. Try again.');
    }
  } finally {
    res.off('close', onClose);
  }
}
