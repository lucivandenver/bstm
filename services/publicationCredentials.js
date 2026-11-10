import { Setting } from '../models/adminModels.js';
import { CredentialRequest } from '../models/portalModels.js';

export async function facultySignature(facultyId, transaction) {
  const saved = await Setting.findOne({ where: { key: `facultySignature:${facultyId}` }, transaction });
  if (saved?.value) return saved.value;
  const legacy = await CredentialRequest.findOne({
    where: { facultyId, status: 'approved' }, order: [['updatedAt', 'DESC']], transaction
  });
  return legacy?.facultySignature;
}

export async function preparePublicationCredential(course, transaction, adminId) {
  const where = { courseId: course.id };
  const existing = await CredentialRequest.findOne({ where, transaction });
  const signature = await facultySignature(course.ownerId, transaction) ||
    (existing?.facultyId === course.ownerId && existing.status !== 'rejected' && existing.facultySignature);
  if (!signature) return false;
  const values = {
    facultyId: course.ownerId, facultySignature: signature, badge: { enabled: true, label: course.title },
    status: adminId ? 'approved' : 'pending', remarks: null,
    reviewedBy: adminId || null, reviewedAt: adminId ? new Date() : null
  };
  if (existing) await existing.update(values, { transaction });
  else await CredentialRequest.create({ ...where, ...values }, { transaction });
  return true;
}
