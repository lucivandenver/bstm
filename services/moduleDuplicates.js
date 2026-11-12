const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const keys = materials => [...new Set((materials || []).map(file => file.documentKey).filter(Boolean))].sort().join(':');
const content = module => (module.lessons || []).map(lesson => normalized(lesson.body)).filter(Boolean).sort().join('\n');

export function duplicateModule(modules, candidate, excludeId, previous) {
  const title = normalized(candidate.title);
  const files = keys(candidate.materials);
  const body = content(candidate);
  const changedTitle = title && title !== normalized(previous?.title);
  const changedFiles = files && files !== keys(previous?.materials);
  const changedBody = body && body !== content(previous || {});
  return modules.find(module => module.id !== excludeId && (
    (changedTitle && normalized(module.title) === title) ||
    (changedFiles && keys(module.materials) === files) ||
    (changedBody && content(module) === body)
  ));
}

export const duplicateModuleMessage = module => `“${module.title}” already uses this module name or content. Edit the existing module instead.`;
