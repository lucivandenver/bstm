import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSectors, sectorsForModule } from '../services/careerSectors.js';
import { studentCareerEvidence } from '../services/moduleEvidence.js';
import { defaultCareerTracks } from '../services/learning.js';
const tourism = 'Tourism and Hospitality Knowledge';
function attempt(id, title, score = 90) {
  return { id, courseId: id, createdAt: new Date().toISOString(), status: 'ongoing', completedLessons: ['l'], quizAttempts: [], quizScores: { m: score },
    snapshot: { title, domain: tourism, passingScore: 75, modules: [{ id: 'm', title, lessons: [{ id: 'l', title: 'Introduction' }] }], questions: [{ moduleId: 'm', domain: tourism }] } };
}
test('eight sectors keep unrelated careers unassessed, then detect newly passed faculty modules', () => {
  assert.equal(careerSectors.length, 8);
  const travel = attempt(1, 'Planning and Booking');
  let evidence = studentCareerEvidence([travel], defaultCareerTracks);
  assert.ok(evidence.tracks.length >= 3);
  assert.ok(evidence.tracks.every(track => track.sector === 'Travel and Tour Operations'));
  assert.equal(evidence.sectors.some(sector => sector.name === 'Airline and Airport Services'), false);
  const airline = attempt(2, 'Airline Passenger Handling');
  evidence = studentCareerEvidence([travel, airline], defaultCareerTracks);
  assert.equal(evidence.sectors.find(sector => sector.name === 'Airline and Airport Services').assessed, true);
  assert.ok(evidence.tracks.some(track => track.title === 'Airport Ground Services Assistant'));
  assert.equal(studentCareerEvidence([attempt(3, 'Cruise Services', 40)], defaultCareerTracks).tracks.length, 0);
});
test('valid finals affect scored evidence while certificates corroborate without extra points', () => {
  const a = attempt(1, 'Planning and Booking');
  a.status = 'completed'; a.finalScore = 80;
  const evidence = studentCareerEvidence([a], defaultCareerTracks);
  assert.equal(evidence.tracks[0].average, 85);
  const certified = studentCareerEvidence([a], defaultCareerTracks, [{ attemptId: 1, moduleId: 'm', revoked: false }]);
  assert.equal(certified.tracks[0].rank, evidence.tracks[0].rank);
  assert.equal(certified.tracks[0].supportingModules[0].certificateEarned, true);
  assert.equal(certified.tracks[0].supportingModules[0].finalAssessmentScore, 80);
  a.finalScore = 30;
  assert.equal(studentCareerEvidence([a], defaultCareerTracks).tracks[0].average, 90);
});
test('module outcomes and topic titles can classify future content without a catalog code change', () => {
  assert.deepEqual(sectorsForModule({ title: 'Professional Studies' }, { title: 'Unit 1', outcomes: ['Apply restaurant table service'], lessons: [] }), ['Food and Beverage Services']);
  assert.deepEqual(sectorsForModule({ title: 'Unrelated' }, { title: 'Unit 1', lessons: [] }), []);
});

test('the first passing result stays fixed and failed related modules remain gaps only', async () => {
  const { moduleAssessmentResult } = await import('../services/learning.js');
  const { quizAccess } = await import('../services/portalLearning.js');
  const a = attempt(1, 'Planning and Booking', 100);
  a.quizAttempts = [{ scope: 'm', score: 40 }, { scope: 'm', score: 80, scores: { [tourism]: 80 } }, { scope: 'm', score: 100, scores: { [tourism]: 100 } }];
  assert.equal(moduleAssessmentResult(a, 'm').score, 80);
  assert.equal(quizAccess(a, 'm'), false);
  const evidence = studentCareerEvidence([a, attempt(2, 'Reservations', 40)], defaultCareerTracks);
  assert.equal(evidence.completed[0].score, 80);
  assert.equal(evidence.completed[0].retakesBeforePass, 1);
  assert.equal(evidence.tracks[0].supportingModules[0].retakesBeforePass, 1);
  assert.equal(evidence.tracks[0].average, 80);
  assert.equal(evidence.tracks[0].failedModules[0].score, 40);
  assert.ok(evidence.tracks[0].gaps.includes(tourism));
  assert.ok(evidence.sectors.every(sector => sector.assessed));
});
