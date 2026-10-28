import { randomBytes } from 'node:crypto';
// Intentionally prints a newly generated value only when an operator runs this command.
console.log(randomBytes(24).toString('base64url'));
