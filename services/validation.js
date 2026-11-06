export const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const email = value => text(value, 254).toLowerCase();
export function registrationInput(body, google = null) {
  const role = body.account_type || 'student';
  if (!['student', 'faculty'].includes(role)) throw new Error('Select Student or Faculty registration.');
  if (google && role !== google.role) throw new Error('Restart Google registration to change account type.');
  const id = text(body.identityId || (role === 'faculty' ? body.faculty_id : body.student_id), 40);
  const data = { name: text(body.name, 100), email: google ? google.email : email(body.email), role,
    studentId: role === 'student' ? id : null, facultyId: role === 'faculty' ? id : null,
    facultyPosition: role === 'faculty' ? text(body.facultyPosition, 120) : null,
    facultyEducation: role === 'faculty' ? text(body.facultyEducation, 200) : null,
    facultyQualifications: role === 'faculty' ? text(body.facultyQualifications, 2000) : null,
    section: role === 'student' ? text(body.section, 60) : null, gender: role === 'student' ? text(body.gender, 30) : null,
    approvalStatus: role === 'faculty' ? 'pending' : 'approved' };
  if (data.name.length < 2) throw new Error('Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Enter a valid email address.');
  if (!/^[\w-]{3,40}$/.test(id)) throw new Error('Enter a valid Student ID or Faculty ID.');
  if (role === 'student' && !data.section) throw new Error('Choose your section.');
  if (role === 'faculty' && (!data.facultyPosition || !data.facultyEducation || !data.facultyQualifications)) throw new Error('Enter your position, educational attainment and relevant qualifications.');
  if (role === 'student' && !['Female', 'Male'].includes(data.gender)) throw new Error('Select your gender.');
  if (!google) {
    if (typeof body.password !== 'string' || body.password.length < 10 || Buffer.byteLength(body.password) > 72) throw new Error('Use a password with at least 10 characters and at most 72 bytes.');
    if (body.password !== body.confirm_password) throw new Error('Passwords do not match.');
  }
  return data;
}
export function profileInput(body) {
  const data = { yearLevel: text(body.yearLevel, 30), academicYear: text(body.academicYear, 30), graduationYear: text(body.graduationYear, 4), bio: text(body.bio, 600) };
  if (!['1st year', '2nd year', '3rd year', '4th year', 'Graduating'].includes(data.yearLevel)) throw new Error('Select your year level.');
  if (!/^\d{4}-\d{4}$/.test(data.academicYear)) throw new Error('Use the academic year format 2026-2027.');
  if (!/^20\d{2}$/.test(data.graduationYear)) throw new Error('Enter a valid graduation year.');
  return { ...data, complete: true };
}
