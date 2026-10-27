import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareGoogleEnvironment } from '../services/googleSetup.js';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv[2];
if (!argument) {
  console.error('Usage: npm run setup:google -- "C:\\Users\\YourName\\Downloads\\client_secret_....json"');
  process.exitCode = 1;
} else {
  try {
    const credentials = JSON.parse(fs.readFileSync(path.resolve(argument), 'utf8'));
    const destination = path.join(project, '.env');
    const source = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : fs.readFileSync(path.join(project, '.env.example'), 'utf8');
    const prepared = prepareGoogleEnvironment(credentials, source);
    fs.writeFileSync(destination, prepared.content, { mode: 0o600 });
    console.log('Google OAuth credentials saved to the private local .env. Existing database settings were preserved.');
    console.log(`Open in your browser: ${prepared.appUrl}`);
    console.log(`Google callback: ${prepared.redirect}`);
    console.log('Restart npm run xian to load the configuration. Credential values were not printed.');
  } catch (error) {
    // File/JSON errors can include source content. Never echo those or credential values.
    console.error(error instanceof SyntaxError || error?.code ? 'Could not read the credential JSON. Check the file path and format.' : error.message);
    process.exitCode = 1;
  }
}
