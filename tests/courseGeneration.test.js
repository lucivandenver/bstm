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
    lessonIndex: 0,
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
  assert.equal(result.questions[0].lessonId, result.modules[0].lessons[0].id);
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
  await assert.rejects(() => generateCourse(faculty.id, source, options), {
    code: "COURSE_AI_NOT_CONFIGURED",
  });
  assert.equal(await AiJob.count(), 0);

});
await test("provider failures are actionable and do not save partial courses", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "models/test-model";
  const original = globalThis.fetch;
  const cases = [
    [401, "COURSE_AI_AUTH"],
    [403, "COURSE_AI_AUTH"],
    [404, "COURSE_AI_MODEL"],
    [429, "COURSE_AI_QUOTA"],
    [500, "COURSE_AI_UNAVAILABLE"],
  ];
  try {
    for (const [status, code] of cases) {
      globalThis.fetch = async () =>
        new Response('{"secret":"must never be shown"}', { status });
      const before = await Course.count();
      await assert.rejects(
        () => generateCourse(faculty.id, source, options),
        (e) => e.code === code && !e.message.includes("must never"),
      );
      assert.equal(await Course.count(), before);
      assert.equal(
        (await AiJob.findOne({ order: [["id", "DESC"]] })).status,
        "failed",
      );
    }
    for (const [payload, code] of [
      [{ candidates: [{ finishReason: "MAX_TOKENS" }] }, "COURSE_AI_TRUNCATED"],
      [{ promptFeedback: { blockReason: "SAFETY" } }, "COURSE_AI_BLOCKED"],
      [
        { candidates: [{ content: { parts: [{ text: "not JSON" }] } }] },
        "COURSE_AI_INVALID",
      ],
    ]) {
      globalThis.fetch = async () => Response.json(payload);
      await assert.rejects(() => generateCourse(faculty.id, source, options), {
        code,
      });
    }
    globalThis.fetch = async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    };
    await assert.rejects(() => generateCourse(faculty.id, source, options), {
      code: "COURSE_AI_TIMEOUT",
    });
  } finally {
    globalThis.fetch = original;
  }
});
await test("successful generation atomically stores an unpublished course, revision and completed job", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.match(url, /models\/test-model:generateContent$/);
      const request = JSON.parse(init.body);
      assert.equal(request.generationConfig.responseJsonSchema.type, "object");
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(draft()) }] },
          },
        ],
      });
    };
    const { course, job } = await generateCourse(faculty.id, source, options);
    assert.equal(course.published, false);
    assert.equal(job.courseId, course.id);
    assert.equal(job.status, "completed");
    assert.equal(
      await CourseRevision.count({ where: { courseId: course.id } }),
      1,
    );
  } finally {
    globalThis.fetch = original;
  }
});
await test("save failure rolls back course and revision and job-log failure cannot mask the original error", async () => {
  const original = globalThis.fetch,
    create = CourseRevision.create,
    update = AiJob.prototype.update,
    count = await Course.count();
  try {
    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(draft()) }] } },
        ],
      });
    CourseRevision.create = async () => {
      throw { original: { code: "ER_BAD_FIELD_ERROR" } };
    };
    AiJob.prototype.update = async function (values, ...args) {
      if (values.status === "failed") throw new Error("log unavailable");
      return update.call(this, values, ...args);
    };
    await assert.rejects(() => generateCourse(faculty.id, source, options), {
      code: "COURSE_SCHEMA_NOT_READY",
    });
    assert.equal(await Course.count(), count);
  } finally {
    globalThis.fetch = original;
    CourseRevision.create = create;
    AiJob.prototype.update = update;
    await AiJob.update({ status: "failed" }, { where: { status: "running" } });
  }
});
await test("admission failure before a job is created uses a safe diagnostic", async () => {
  const findAll = AiJob.findAll;
  try {
    AiJob.findAll = async (query) => {
      if (query?.where?.status === "failed") throw { original: { code: "ER_NO_SUCH_TABLE" }, sql: "do not disclose" };
      return findAll.call(AiJob, query);
    };
    await assert.rejects(
      () =>
        generateCourse(faculty.id, source, {
          ...options,
          outcomes: "New admission should check database quota storage.",
        }),
      (e) =>
        e.code === "COURSE_SCHEMA_NOT_READY" &&
        !e.message.includes("do not disclose"),
    );
  } finally {
    AiJob.findAll = findAll;
  }
  assert.equal(
    safeGenerationError({ original: { code: "ER_LOCK_DEADLOCK" } }, "quota")
      .code,
    "COURSE_STORAGE_BUSY",
  );
});
await test("duplicate jobs are blocked but application daily caps do not block generation", async () => {
  const job = await AiJob.create({
    userId: faculty.id,
    sourceId: source.id,
    type: "course-draft",
    status: "running",
  });
  await assert.rejects(() => generateCourse(faculty.id, source, options), {
    code: "COURSE_ALREADY_RUNNING",
  });
  await job.update({ status: "failed" });
  await Setting.update({ value: "1" }, { where: { key: "aiDailyLimit" } });
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "models/test-model";
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft()) }] } }] }), { status: 200 });
  try {
    const result = await generateCourse(faculty.id, source, { ...options, outcomes: "A distinct new course request." });
    assert.equal(result.job.status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  }
  await Setting.upsert({ key: "aiDailyLimit", value: "50" });
});
await test("Faculty source errors retain inputs and legacy manual submissions are rejected", async () => {
  const server = await startServer(0),
    base = `http://127.0.0.1:${server.address().port}`,
    f = browser(base);
  try {
    await f.login(faculty.email, "TestingPassword-2026!");
    let r = await f.get(`/faculty/sources/${source.id}`);
    assert.equal(r.status, 200);
    assert.match(r.html, /Competency areas/);
    assert.match(r.html, /data-course-generation/);
    delete process.env.GEMINI_API_KEY;
    r = await f.post(`/faculty/sources/${source.id}/generate`, {
      ...options,
      consent: "yes",
    });
    assert.equal(r.status, 503);
    assert.match(r.html, /COURSE_AI_NOT_CONFIGURED/);
    assert.match(r.html, /Confirm guest requirements\./);
    assert.match(r.html, /service.docx/);
    assert.doesNotMatch(r.html, /Something went wrong/);
    const originalFetch = globalThis.fetch;
    process.env.GEMINI_API_KEY = "test-key";
    try {
      globalThis.fetch = async (url, init) =>
        String(url).startsWith("https://generativelanguage.googleapis.com/")
          ? Response.json({
              candidates: [
                { content: { parts: [{ text: JSON.stringify(draft()) }] } },
              ],
            })
          : originalFetch(url, init);
      const result = await f.request(`/faculty/sources/${source.id}/generate`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          ...options,
          consent: "yes",
          _csrf: f.csrf,
        }),
      });
      assert.equal(result.status, 200);
      const data = JSON.parse(result.html);
      assert.equal(data.ok, true);
      const courseId = Number(data.redirect.match(/courses\/(\d+)/)[1]);
      const course = await Course.findByPk(courseId);
      assert.equal(course.published, false);
      assert.equal((await f.get(data.redirect)).status, 200);
      let publish = await f.post(`/faculty/courses/${courseId}`, {
        action: "publish",
        courseData: JSON.stringify(course.get({ plain: true })),
      });
      assert.equal(
        publish.status,
        400,
        "unreviewed AI answers cannot be published",
      );
      const reviewed = {
        ...course.get({ plain: true }),
        questions: course.questions.map((q) => ({ ...q, reviewed: true })),
      };
      publish = await f.post(`/faculty/courses/${courseId}`, {
        action: "publish",
        confirmReview: "yes",
        courseData: JSON.stringify(reviewed),
      });
      assert.equal(publish.status, 302);
      assert.equal((await Course.findByPk(courseId)).published, false);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GEMINI_API_KEY;
    }
    r = await f.post(`/faculty/sources/${source.id}/generate`, {
      ...options,
      mode: "manual",
      consent: "",
    });
    assert.equal(r.status,400);
    assert.match(r.html,/Select Generate course/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeResources();
  }
});

