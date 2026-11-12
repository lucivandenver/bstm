import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { extractSource } from "../services/sourceExtraction.js";
import { browser } from "./httpHelpers.js";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "test-model";
process.env.NODE_ENV = "test";
process.env.TEST_DB_STORAGE = ":memory:";
const { sequelize, User, Course } = await import("../models/learningModels.js");
const { SourceDocument, AiJob } = await import("../models/portalModels.js");
const { Setting } = await import("../models/adminModels.js");
const { seedAdministration } = await import("../services/accounts.js");
const { courseBatches, sourceSections } =
  await import("../services/courseAi.js");
const { startServer, closeResources } = await import("../index.js");
const phrase =
  "Confirm guest requirements, check safety and accessibility, then verify booking availability. ";
async function docx(megabytes, text = phrase.repeat(500)) {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  if (megabytes)
    zip.file(
      "word/media/test-padding.bin",
      Buffer.alloc(megabytes * 1024 * 1024),
    );
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
function responseFor(payload) {
  const section = payload.sections.find((s) => s.text.length >= 100);
  return {
    insufficient: false,
    title: "Tourism information systems",
    description: "Understand and apply the supplied tourism booking concepts.",
    outcomes: ["Verify guest requirements and safe bookings."],
    minutes: 30,
    modules: [
      {
        title: "Tourism booking concepts",
        lessons: [
          {
            title: "Verify the booking",
            body: section.text.slice(0, 400),
            takeaways: ["Check before booking."],
          },
        ],
      },
    ],
    questions: Array.from({ length: payload.questionCount }, (_, i) => ({
      moduleIndex: 0,
      lessonIndex: 0,
      prompt: `Which booking action is appropriate in situation ${i + 1}?`,
      options: ["Confirm requirements", "Ignore safety"],
      answer: 0,
      explanation:
        "The teaching material requires confirmation and safety checks.",
      sourceReference: section.reference,
      sourceQuote: section.text.slice(0, 100),
    })),
  };
}
test("large source planning covers every character without overflowing course module limits", () => {
  const sections = Array.from({ length: 25 }, (_, i) => ({
    reference: `File ${i + 1}`,
    text: "x".repeat(39000),
  }));
  const batches = courseBatches(sections, 8);
  assert.equal(batches.length, 17);
  assert.equal(
    batches.reduce(
      (n, b) => n + b.sections.reduce((m, s) => m + s.text.length, 0),
      0,
    ),
    975000,
  );
  assert.equal(
    batches.reduce((n, b) => n + b.questionCount, 0),
    17,
  );
  assert.equal(
    courseBatches([{ reference: "One", text: "a".repeat(60001) }], 8).length,
    2,
    "even a small trailing fragment stays within the configured request limit",
  );
  assert.equal(
    sourceSections({ sections }).length,
    25,
    "collections above the previous 100k text limit are valid",
  );
});
let hundredMbPdf;
test("a valid PDF at exactly 100 MB passes source extraction", async () => {
  const pdf = new PDFDocument({ compress: false });
  const chunks = [];
  pdf.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => pdf.on("end", resolve));
  pdf.text(phrase.repeat(8));
  pdf.end();
  await finished;
  const raw = Buffer.concat(chunks),
    marker = raw.lastIndexOf("startxref");
  assert(marker > 0);
  // PDF whitespace between the trailer and startxref preserves existing offsets.
  const buffer = Buffer.concat([
    raw.subarray(0, marker),
    Buffer.alloc(100 * 1024 * 1024 - raw.length, 32),
    raw.subarray(marker),
  ]);
  hundredMbPdf = buffer;
  assert.equal(buffer.length, 100 * 1024 * 1024);
  const extracted = await extractSource({
    originalname: "Tourism module.pdf",
    buffer,
  });
  assert(extracted[0].text.includes("Confirm guest requirements"));
});
test("three large files upload incrementally, retry without duplicates, and generate a reviewed publishable multi-batch course", async () => {
  await sequelize.sync({ force: true });
  await seedAdministration();
  await Setting.upsert({ key: "aiDailyLimit", value: "50" });
  const password = await bcrypt.hash("BulkTesting-2026!", 4);
  const faculty = await User.create({
    name: "Faculty Bulk",
    email: "bulk@example.test",
    role: "faculty",
    approvalStatus: "approved",
    password,
  });
  const other = await User.create({
    name: "Other Faculty",
    email: "other-bulk@example.test",
    role: "faculty",
    approvalStatus: "approved",
    password,
  });
  const server = await startServer(0),
    base = `http://127.0.0.1:${server.address().port}`,
    f = browser(base),
    o = browser(base),
    originalFetch = globalThis.fetch;
  let sourceId;
  try {
    await f.login(faculty.email, "BulkTesting-2026!");
    await f.get("/faculty/upload");
    await o.login(other.email, "BulkTesting-2026!");
    await o.get("/faculty/upload");
    await (async () => {
      const body = new FormData();
      body.set("sources", new Blob([hundredMbPdf]), "100MB-tourism.pdf");
      const result = await f.request("/faculty/upload", {
        method: "POST",
        headers: { Accept: "application/json", "X-CSRF-Token": f.csrf },
        body,
      });
      assert.equal(result.status, 200, result.html);
      assert.equal(
        JSON.parse(result.html).ok,
        true,
        "a file exactly at 100 MB must be accepted",
      );
    })();
    hundredMbPdf = null;

    const bytes = [];
    for (const [i, size] of [15, 9, 11].entries()) {
      const buffer = await docx(size, `Module ${i + 1}. ` + phrase.repeat(500));
      bytes.push(buffer);
      const body = new FormData();
      body.set("sources", new Blob([buffer]), `Module ${i + 1}.docx`);
      if (sourceId) body.set("sourceId", sourceId);
      body.set("settings", JSON.stringify({ moduleTitle: "Saved material settings", questionCount: 12,
        topicCount: 7, level: "Advanced", outcomes: "Preserved outcome", competencyAreas: ["Digital skills"] }));
      const r = await f.request("/faculty/upload", {
        method: "POST",
        headers: { Accept: "application/json", "X-CSRF-Token": f.csrf },
        body,
      });
      assert.equal(r.status, 200, r.html);
      const data = JSON.parse(r.html);
      sourceId = String(data.sourceId);
      assert.equal(data.failed.length, 0);
    }
    const savedForm = await f.get(`/faculty/sources/${sourceId}`);
    assert.match(savedForm.html, /value="Saved material settings"/);
    assert.match(savedForm.html, /Preserved outcome/);
    assert.match(savedForm.html, /value="12"/);
    let source = await SourceDocument.findByPk(sourceId);
    assert.equal(new Set(source.sections.map((s) => s.documentKey)).size, 3);
    assert(source.sections.reduce((n, s) => n + s.text.length, 0) > 100000);
    const duplicate = new FormData();
    duplicate.set("sources", new Blob([bytes[0]]), "Module 1.docx");
    duplicate.set("sourceId", sourceId);
    assert.equal(
      (
        await f.request("/faculty/upload", {
          method: "POST",
          headers: { Accept: "application/json", "X-CSRF-Token": f.csrf },
          body: duplicate,
        })
      ).status,
      200,
    );
    source = await source.reload();
    assert.equal(source.sections.length, 3);
    const stolen = new FormData();
    stolen.set("sources", new Blob([await docx(0)]), "other.docx");
    stolen.set("sourceId", sourceId);
    assert.equal(
      (
        await o.request("/faculty/upload", {
          method: "POST",
          headers: { Accept: "application/json", "X-CSRF-Token": o.csrf },
          body: stolen,
        })
      ).status,
      404,
    );
    const tooLarge = new FormData();
    tooLarge.set(
      "sources",
      new Blob([Buffer.alloc(100 * 1024 * 1024 + 1)]),
      "oversized.pdf",
    );
    const tooBig = await f.request("/faculty/upload", {
      method: "POST",
      headers: { Accept: "application/json", "X-CSRF-Token": f.csrf },
      body: tooLarge,
    });
    assert.equal(tooBig.status, 413);
    assert.match(tooBig.html, /100 MB/);
    const seen = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("https://generativelanguage.googleapis.com/"))
        return originalFetch(url, init);
      const data = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
      seen.push(data);
      await new Promise((r) => setTimeout(r, 60));
      if (data.selectedCompetencyAreas) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Tourism information systems", description: "Understand tourism booking concepts.", outcomes: ["Verify guest requirements and safe bookings."], competencyAreas: data.selectedCompetencyAreas, modules: data.sections.slice(0, 3).map((section, index) => ({ title: `Tourism booking concepts ${index + 1}`, outcomes: ["Verify booking requirements."], sourceReference: section.reference })) }) }] } }] });
      return Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(responseFor(data)) }] } },
        ],
      });
    };
    const r = await f.request(`/faculty/sources/${sourceId}/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams([
        ...new URLSearchParams({
          _csrf: f.csrf,
          background: "yes",
          domain: "Tourism knowledge",
          outcomes: "Understand tourism booking.",
          questionCount: "8",
          consent: "yes",
        }),
        ["competencyAreas", "Tourism knowledge"],
        ["competencyAreas", "Communication"],
      ]),
    });
    assert.equal(r.status, 202, r.html);
    let { statusUrl } = JSON.parse(r.html);
    const repeated = await f.request(`/faculty/sources/${sourceId}/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _csrf: f.csrf,
        background: "yes",
        domain: "Tourism knowledge",
        outcomes: "Understand tourism booking.",
        questionCount: "8",
        consent: "yes",
      }),
    });
    assert.equal(repeated.status, 202, repeated.html);
    assert.equal(
      JSON.parse(repeated.html).statusUrl,
      statusUrl,
      "repeated starts resume the existing active job",
    );

    let state;
    assert.equal((await o.get(statusUrl)).status, 404, "jobs are private");
    for (let n = 0; n < 80; n++) {
      const poll = await f.request(statusUrl, {
        headers: { Accept: "application/json" },
      });
      state = JSON.parse(poll.html);
      if (state.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(state.status, "review", JSON.stringify(state));
    const approvedBlueprint = await f.post(`/faculty/generation/${state.id}/approve-blueprint`, {
      title: state.blueprint.title,
      description: state.blueprint.description,
      outcomes: state.blueprint.outcomes.join("\n"),
      competencyAreas: state.blueprint.competencyAreas,
      moduleTitle: state.blueprint.modules.map((module) => module.title),
      moduleOutcomes: state.blueprint.modules.map((module) => module.outcomes.join("\n")),
      moduleReference: state.blueprint.modules.map((module) => module.sourceReference),
    });
    assert.equal(approvedBlueprint.status, 202, approvedBlueprint.html);
    statusUrl = JSON.parse(approvedBlueprint.html).redirect;
    statusUrl = statusUrl.replace(/\/faculty\/generation\//, "/faculty/generation/");
    for (let n = 0; n < 80; n++) {
      const poll = await f.request(statusUrl, { headers: { Accept: "application/json" } });
      state = JSON.parse(poll.html);
      if (state.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(state.status, "completed", JSON.stringify(state));
    const courseCalls = seen.filter((payload) => payload.competencyAreas);
    assert.equal(courseCalls.length, 3);
    assert.equal(
      courseCalls.reduce(
        (n, p) => n + p.sections.reduce((m, s) => m + s.text.length, 0),
        0,
      ),
      source.sections.reduce((n, s) => n + s.text.length, 0),
    );
    const job = await AiJob.findByPk(state.id),
      course = await Course.findByPk(job.courseId);
    assert.equal(course.modules.length, 3);
    assert.deepEqual(course.modules.map(module => module.number), [1, 2, 3]);
    assert.equal(course.questions.length, 8);
    assert(
      course.questions.every(
        (q) =>
          q.answer === 0 && q.explanation && q.sourceReference && !q.reviewed,
      ),
    );
    assert.equal(course.published, false);
    assert.equal((await f.get(state.preview)).status, 200);
    assert.equal((await f.get(state.redirect)).status, 200);
    assert.deepEqual(course.competencyAreas, [
      "Tourism knowledge",
      "Communication",
    ]);
    const publish = await f.post(`/faculty/courses/${course.id}`, {
      action: "approve-generated",
      confirmReview: "yes",
      version: course.version,
    });
    assert.equal(publish.status, 302, publish.html);
    assert.equal((await course.reload()).published, false);
    await f.get("/faculty/upload");
    const created = await f.post("/faculty/courses", { title: "Faculty-owned course" });
    assert.equal(created.status, 302);
    const destinationId = Number(new URL(created.location, "https://example.test").searchParams.get("courseId"));
    for (const moduleTitle of ["First generated module", "Second generated module"]) {
      const started = await f.request(`/faculty/sources/${sourceId}/generate`, {
        method: "POST",
        headers: { Accept: "application/json", "X-CSRF-Token": f.csrf },
        body: new URLSearchParams({ destinationId, moduleTitle, topicCount: 6, topicTitles: "Verify guest requirements", domain: "Tourism knowledge", questionCount: 8, outcomes: "Verify guest requirements", consent: "yes", background: "yes" }),
      });
      assert.equal(started.status, 202, started.html);
      const { statusUrl: moduleStatusUrl } = JSON.parse(started.html);
      let moduleStatus;
      for (let n = 0; n < 80; n++) {
        const poll = await f.request(moduleStatusUrl, { headers: { Accept: "application/json" } });
        moduleStatus = JSON.parse(poll.html);
        if (moduleStatus.status !== "running") break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(moduleStatus.status, "completed", JSON.stringify(moduleStatus));
      assert.match(moduleStatus.redirect, new RegExp(`/faculty/courses/${destinationId}/edit\\?revision=\\d+`));
      assert.match((await f.get(moduleStatus.redirect)).html, /data-module-editor/);
    }
    const anchoredCourse = await Course.findByPk(destinationId);
    assert.equal(anchoredCourse.title, "FACULTY-OWNED COURSE");
    assert.deepEqual(anchoredCourse.modules.map(module => [module.number, module.title]), [[1, "First generated module"], [2, "Second generated module"]]);
    assert.equal(anchoredCourse.published, false);
    assert.ok(anchoredCourse.modules.every(module => module.materials.length === 3));
    assert.ok(anchoredCourse.questions.every(question => anchoredCourse.modules
      .find(module => module.id === question.moduleId).lessons.some(lesson => lesson.id === question.lessonId)));
    assert.ok(seen.some(payload => payload.moduleTitle === "Second generated module" &&
      payload.preferredTopicTitles?.includes("Verify guest requirements")));
    let failedCalls = 0;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("https://generativelanguage.googleapis.com/"))
        return originalFetch(url, init);
      const payload = JSON.parse(
          JSON.parse(init.body).contents[0].parts[0].text,
        );
      if (payload.selectedCompetencyAreas) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Tourism information systems", description: "Understand tourism booking concepts.", outcomes: ["Verify guest requirements and safe bookings."], competencyAreas: payload.selectedCompetencyAreas, modules: payload.sections.slice(0, 3).map((section, index) => ({ title: `Tourism booking concepts ${index + 1}`, outcomes: ["Verify booking requirements."], sourceReference: section.reference })) }) }] } }] });
      const draft = responseFor(payload);
      if (++failedCalls === 2 || failedCalls === 3) draft.questions = [];
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }],
      });
    };
    const failStart = await f.request(`/faculty/sources/${sourceId}/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _csrf: f.csrf,
        background: "yes",
        domain: "Tourism knowledge",
        outcomes: "Understand tourism booking.",
        questionCount: "8",
        consent: "yes",
      }),
    });
    assert.equal(failStart.status, 202, failStart.html);
    const blueprintUrl = JSON.parse(failStart.html).statusUrl;
    let blueprintState;
    for (let n = 0; n < 80; n++) {
      blueprintState = JSON.parse(
        (
          await f.request(blueprintUrl, {
            headers: { Accept: "application/json" },
          })
        ).html,
      );
      if (blueprintState.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(blueprintState.status, "review", JSON.stringify(blueprintState));
    const failedStart = await f.post(`/faculty/generation/${blueprintState.id}/approve-blueprint`, {
      title: blueprintState.blueprint.title,
      description: blueprintState.blueprint.description,
      outcomes: blueprintState.blueprint.outcomes.join("\n"),
      competencyAreas: blueprintState.blueprint.competencyAreas,
      moduleTitle: blueprintState.blueprint.modules.map((module) => module.title),
      moduleOutcomes: blueprintState.blueprint.modules.map((module) => module.outcomes.join("\n")),
      moduleReference: blueprintState.blueprint.modules.map((module) => module.sourceReference),
    });
    assert.equal(failedStart.status, 202, failedStart.html);
    const failedUrl = JSON.parse(failedStart.html).redirect;
    let failed;
    for (let n = 0; n < 80; n++) {
      failed = JSON.parse((await f.request(failedUrl, { headers: { Accept: "application/json" } })).html);
      if (failed.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(failed.status, "failed");
    assert.equal(failed.code, "COURSE_AI_INVALID");
    assert.equal(
      await Course.count(),
      2,
      "a later failed batch cannot save or publish a partial course",
    );
    assert.equal((await SourceDocument.findByPk(sourceId)).sections.length, 3);
    const oldFallback = process.env.COURSE_AI_FALLBACK,
      oldBackup = process.env.GROQ_API_KEY;
    try {
      process.env.COURSE_AI_FALLBACK = "groq";
      process.env.GROQ_API_KEY = "backup-test-key";
      const denied = await f.request(failedUrl + "/retry", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ _csrf: f.csrf }),
      });
      assert.equal(
        denied.status,
        400,
        "adding another provider requires renewed material-sharing permission",
      );
    } finally {
      if (oldFallback === undefined) delete process.env.COURSE_AI_FALLBACK;
      else process.env.COURSE_AI_FALLBACK = oldFallback;
      if (oldBackup === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = oldBackup;
    }
    const providerCallsBeforeResume = failedCalls;
    const resumed = await f.request(failedUrl + "/retry", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: f.csrf }),
    });
    assert.equal(resumed.status, 202, resumed.html);
    assert.equal(
      JSON.parse(resumed.html).redirect,
      failedUrl,
      "retry reuses the saved job",
    );
    let recovered;
    for (let n = 0; n < 80; n++) {
      recovered = JSON.parse(
        (
          await f.request(failedUrl, {
            headers: { Accept: "application/json" },
          })
        ).html,
      );
      if (recovered.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(recovered.status, "completed");
    assert.equal(
      failedCalls - providerCallsBeforeResume,
      2,
      "the first validated batch is restored, not regenerated",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((r) => server.close(r));
    await closeResources();
  }
});
