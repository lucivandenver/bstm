import test from 'node:test';
import assert from 'node:assert/strict';
import { awardGallery } from '../services/awardGallery.js';
const attempts = [{ id: 1, courseId: 11, snapshot: { modules: [] } }, { id: 2, courseId: 12, snapshot: { modules: [] } }];
const credentials = [
  { id: 'a', attemptId: 1, courseTitle: 'Tourism systems', moduleId: 'm1', moduleTitle: 'Booking', skills: ['Bookings'], issuedAt: '2026-11-01' },
  { id: 'b', attemptId: 1, courseTitle: 'Tourism systems', moduleId: 'm2', moduleTitle: 'Travel', skills: ['Itineraries'], issuedAt: '2026-11-02' },
  { id: 'c', attemptId: 2, courseTitle: 'Guiding', moduleId: 'm3', moduleTitle: 'Visitor care', skills: ['Safety'], issuedAt: '2026-11-03' }
];
test('one course badge combines earned module skills without adding unearned modules', () => {
  const gallery = awardGallery(credentials, attempts, { type: 'badge' });
  assert.equal(gallery.count, 2);
  const badge = gallery.records.find(r => r.courseId === 11);
  assert.deepEqual(new Set(badge.skills), new Set(['Bookings', 'Itineraries']));
  assert.equal(badge.modules.length, 2);
  assert.ok(badge.shareUrl.endsWith('?badge=course'));
});
test('search, type and sorting work together and pagination preserves filters', () => {
  const certificates = awardGallery(credentials, attempts, { type: 'certificate', q: 'Tourism', sort: 'az' });
  assert.deepEqual(certificates.records.map(r => r.title), ['Booking', 'Travel']);
  assert.equal(awardGallery(credentials, attempts, { q: 'MinSU' }).count, 5);
  assert.equal(awardGallery(credentials, attempts, { q: 'no matching academy' }).count, 0);
  const more = [...credentials, ...Array.from({ length: 5 }, (_,i) => ({ ...credentials[0], id: `extra${i}`, moduleId: `extra${i}` }))];
  const page = awardGallery(more, attempts, { type: 'certificate', q: 'Tourism', sort: 'az', page: 2 });
  assert.equal(page.records.length, 2);
  assert.ok(page.previous.includes('type=certificate'));
  assert.ok(page.previous.includes('q=Tourism'));
  assert.equal(page.page, 2);
});

test('badge/certificate pairs stay together and descriptions remain brief', async () => {
  const { briefAwardDescription } = await import('../services/awardGallery.js');
  assert.equal(briefAwardDescription('First sentence. First sentence. Second sentence. Third sentence.'), 'First sentence. Second sentence.');
  assert.ok(briefAwardDescription('A very long description '.repeat(100)).length <= 320);
  const gallery = awardGallery(credentials, attempts);
  assert.equal(gallery.groups.length, 2);
  for (const group of gallery.groups) {
    assert.equal(group.badges.length, 1);
    assert.ok(group.certificates.every(c => c.courseId === group.badges[0].courseId));
  }
});

test('all awards flow badge-first without reserving a course column', () => {
  const gallery = awardGallery(credentials, attempts);
  assert.equal(gallery.paired, false);
  assert.deepEqual(gallery.records.map(row => row.type), ['badge', 'certificate', 'badge', 'certificate', 'certificate']);
  assert.equal(gallery.records.length, 5);
});
