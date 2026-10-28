export const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const email = value => text(value, 254).toLowerCase();
export function registrationInput(body, google = null) {
  const role = body.account_type || 'student';
  if (!['student', 'faculty'].includes(role)) throw new Error('Select Student or Faculty registration.');
  if (google && role !== google.role) throw new Error('Restart Google registration to change account type.');
  const id = text(body.identityId || (role === 'faculty' ? body.faculty_id : body.student_id), 40);
  const data = { name: text(body.name, 100), email: google ? google.email : email(body.email), role,
    studentId: role === 'student' ? id : null, facultyId: role === 'faculty' ? id : null,
    section: role === 'student' ? text(body.section, 60) : null, gender: role === 'student' ? text(body.gender, 30) : null,
    approvalStatus: role === 'faculty' ? 'pending' : 'approved' };
  if (data.name.length < 2) throw new Error('Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Enter a valid email address.');
  if (!/^[\w-]{3,40}$/.test(id)) throw new Error('Enter a valid Student ID or Faculty ID.');
  if (role === 'student' && !data.section) throw new Error('Choose your section.');
  if (role === 'student' && !['Female', 'Male', 'Other', 'Prefer not to say'].includes(data.gender)) throw new Error('Select your gender.');
  if (!google) {
    if (typeof body.password !== 'string' || body.password.length < 10 || Buffer.byteLength(body.password) > 72) throw new Error('Use a password with at least 10 characters and at most 72 bytes.');
    if (body.password !== body.confirm_password) throw new Error('Passwords do not match.');
  }
  return data;
}
export function profileInput(body) {
  const data = {};
  const limits = { yearLevel: 30, academicYear: 30, graduationYear: 4, ojtStatus: 40, ojtCompany: 160, ojtArea: 100, careerInterest: 80, preferredLocation: 120, languages: 200, skills: 1500, qualifications: 1500, bio: 600 };
  for (const [key, max] of Object.entries(limits)) data[key] = text(body[key], max);
  if (!['4th year', 'Graduating'].includes(data.yearLevel)) throw new Error('Select your year level.');
  if (!/^\d{4}-\d{4}$/.test(data.academicYear)) throw new Error('Use the academic year format 2026-2027.');
  if (!/^20\d{2}$/.test(data.graduationYear)) throw new Error('Enter a valid graduation year.');
  if (!['Not yet started', 'Ongoing', 'Completed'].includes(data.ojtStatus)) throw new Error('Select your OJT status.');
  if (!data.careerInterest || !data.preferredLocation) throw new Error('Enter your career interest and preferred work location.');
  const hours = body.ojtHours === '' ? 0 : Number(body.ojtHours);
  if (!Number.isInteger(hours) || hours < 0 || hours > 10000) throw new Error('OJT hours must be from 0 to 10,000.');
  return { ...data, ojtHours: hours, complete: true };
}
