import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { browser } from "./httpHelpers.js";
process.env.NODE_ENV = "test";
process.env.TEST_DB_STORAGE = ":memory:";
const { sequelize, User, Course } = await import("../models/learningModels.js");
const { AiJob, SourceDocument, CourseRevision } =
  await import("../models/portalModels.js");
const { Setting } = await import("../models/adminModels.js");
const {
  generateCourse,
  sourceSections,
  validateGeneratedDraft,
} = await import("../services/courseAi.js");
const { safeGenerationError } =
  await import("../services/courseGenerationErrors.js");
const { domains } = await import("../data/starterCourses.js");
const { seedAdministration } = await import("../services/accounts.js");
const { startServer, closeResources } = await import("../index.js");
const quote = "Confirm the guest requirements before making a recommendation.";
const sections = [
  {
    reference: "Paragraph 1",
    text: quote + " Check safety and accessibility before booking.",
  },
];
const options = {
  domain: domains[0],
  level: "Foundation",
  outcomes: "Confirm guest requirements.",
  questionCount: 3,
};
const draft = () => ({
  insufficient: false,
  title: "Guest service foundations",
  description: "Apply a professional service workflow.",
  outcomes: ["Confirm guest requirements."],
  modules: [
    {
      title: "Service preparation",
      lessons: [
        {
          title: "Confirm the request",
          body: sections[0].text,
          takeaways: ["Ask before recommending."],
        },
      ],
    },
  ],
  questions: [1, 2, 3].map(() => ({
    moduleIndex: 0,
    prompt: "What should you do before recommending a service?",
    options: ["Confirm requirements", "Ignore the request"],
    answer: 0,
    explanation: quote,
    sourceReference: "Paragraph 1",
    sourceQuote: quote,
  })),
});
let faculty, source;
await test("generation initializes isolated storage and source", async () => {
  await sequelize.sync({ force: true });
  await seedAdministration();
  faculty = await User.create({
    name: "Course Author",
    email: "course-author@example.test",
    facultyId: "FAC-AI",
    role: "faculty",
    approvalStatus: "approved",
    password: await bcrypt.hash("TestingPassword-2026!", 4),
  });
  source = await SourceDocument.create({
    ownerId: faculty.id,
    filename: "service.docx",
    sections,
  });
  await Setting.upsert({ key: "aiDailyLimit", value: "50" });
});
await test("AI responses are grounded, mapped to server IDs and always require review", () => {
  const result = validateGeneratedDraft(draft(), sections, options);
  assert.equal(result.questions.length, 3);
  assert.equal(result.questions[0].reviewed, false);
  assert.equal(result.questions[0].moduleId, result.modules[0].id);
  assert.equal(result.domain, domains[0]);
  const bad = draft();
  bad.questions[0].sourceQuote = "A completely invented source statement.";
  const reviewedWithoutQuote = validateGeneratedDraft(bad, sections, options);
  assert.equal(reviewedWithoutQuote.questions[0].sourceQuote, "");
  assert.equal(reviewedWithoutQuote.questions[0].sourceNeedsReview, true);
  assert.throws(
    () =>
      validateGeneratedDraft({ ...draft(), questions: [] }, sections, options),
    { code: "COURSE_AI_INVALID" },
  );
  assert.throws(
    () => validateGeneratedDraft({ insufficient: true }, sections, options),
    { code: "COURSE_SOURCE_INSUFFICIENT" },
  );
  assert.deepEqual(
    sourceSections({ sections: JSON.stringify(sections) }),
    sections,
  );
  assert.equal(sourceSections({ sections: [{ reference: "Page 1", text: " " }] })[0].text, "");
});
await test("missing provider configuration leaves the saved source available", async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  await assert.rejects(() 