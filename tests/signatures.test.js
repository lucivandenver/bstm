import { signatureFixture as fixture } from "./signatureFixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import { browser } from "./httpHelpers.js";
process.env.NODE_ENV = "test";
process.env.TEST_DB_STORAGE = ":memory:";
const { processSignature, validatedSignature } =
  await import("../services/signatureProcessing.js");
const { sequelize, User, Course, CourseAttempt } =
  await import("../models/learningModels.js");
const { CredentialRequest } = await import("../models/portalModels.js");
const { seedAdministration } = await import("../services/accounts.js");
const { startServer, closeResources } = await import("../index.js");
await test("signature conversion removes light paper, retains blue strokes and outputs a bounded transparent PNG", async () => {
  const result = await processSignature(await fixture());
  assert.match(result, /^data:image\/png;base64,/);
  const output = Buffer.from(result.split(",")[1], "base64"),
    image = sharp(output);
  const metadata = await image.metadata();
  assert(metadata.hasAlpha);
  assert(metadata.width <= 600 && metadata.height <= 240);
  const { data } = await image.raw().toBuffer({ resolveWithObject: true });
  let transparent = 0,
    ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) transparent++;
    if (data[i + 3] > 200 && data[i + 2] > data[i]) ink++;
  }
  assert(transparent > 100);
  assert(ink > 50);
  assert.match(await validatedSignature(result), /^data:image\/png;base64,/);
});
await test("transparent signatures with ink at the crop edge can be saved again", async () => {
  const image = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><path d="M0 10Q25 45 48 30T120 52" fill="none" stroke="#14223e" stroke-width="6"/></svg>',
  )).png().toBuffer();
  const preview = await processSignature(image);
  const saved = await validatedSignature(preview);
  assert.equal(saved, preview);
});

await test("a JPEG with dark edges can still use the visible paper as its background", async () => {
  const image = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#656565"/><rect x="10" y="10" width="180" height="80" fill="#eee6d8"/><path d="M40 65Q70 20 100 52T165 45" fill="none" stroke="#173772" stroke-width="5"/></svg>',
  )).jpeg().toBuffer();
  const result = await processSignature(image);
  const pixels = await sharp(Buffer.from(result.split(",")[1], "base64")).raw().toBuffer();
  assert(pixels.some((value, index) => index % 4 === 3 && value === 0));
  assert(pixels.some((value, index) => index % 4 === 0 && pixels[index + 2] - value > 30 && pixels[index + 3] > 200));
});

await test("signature decoding rejects malformed, blank, oversized and dark-background images", async () => {
  await assert.rejects(
    () => processSignature(Buffer.from("fake png")),
    /could not be decoded/,
  );
  await assert.rejects(() =>
    validatedSignature("data:image/svg+xml;base64,PHN2Zz4="),
  );
  await assert.rejects(
    () => processSignature(Buffer.alloc(4 * 1024 * 1024 + 1)),
    /4 MB/,
  );
  await assert.rejects(
    async () =>
      processSignature(
        await sharp({
          create: { width: 200, height: 100, channels: 3, background: "white" },
        })
          .png()
          .toBuffer(),
      ),
    /No clear signature/,
  );
  await assert.rejects(
    async () =>
      processSignature(
        await sharp({
          create: { width: 200, height: 100, channels: 3, background: "black" },
        })
          .png()
          .toBuffer(),
      ),
    /plain light background/,
  );
});
await test("approved faculty/admin process signatures privately; students are blocked and resubmission reopens approval", async () => {
  await sequelize.sync({ force: true });
  await seedAdministration();
  const password = await bcrypt.hash("TestingPassword-2026!", 4);
  const faculty = await User.create({
    name: "Signature Faculty",
    email: "signature-faculty@example.test",
    facultyId: "FAC-SIGN",
    role: "faculty",
    approvalStatus: "approved",
    password,
  });
  await User.create({
    name: "Signature Admin",
    email: "signature-admin@example.test",
    role: "admin",
    password,
  });
  await User.create({
    name: "Signature Student",
    email: "signature-student@example.test",
    role: "student",
    studentId: "STU-SIGN",
    section: "BSTM 4-1",
    gender: "Female",
    password,
  });
  const course = await Course.create({
    title: "Signature course",
    slug: "signature-course",
    ownerId: faculty.id,
    published: true,
    awardsApproved: true,
    modules: [],
    questions: [],
    prerequisites: [],
  });
  const attempt = await CourseAttempt.create({
    userId: (await User.findOne({ where: { role: "student" } })).id,
    courseId: course.id,
    attemptNumber: 1,
    snapshot: { title: course.title, awardsApproved: true },
    completedLessons: [],
    quizScores: {},
  });
  await CredentialRequest.create({
    courseId: course.id,
    facultyId: faculty.id,
    status: "approved",
    facultySignature: await processSignature(await fixture()),
  });
  const server = await startServer(0),
    base = `http://127.0.0.1:${server.address().port}`,
    f = browser(base),
    a = browser(base),
    s = browser(base);
  try {
    await f.login(faculty.email, "TestingPassword-2026!");
    await a.login("signature-admin@example.test", "TestingPassword-2026!");
    await s.login("signature-student@example.test", "TestingPassword-2026!");
    await f.get("/faculty/profile");
    await a.get("/admin/account");
    await s.get("/student/profile");
    const upload = async (client) => {
      const form = new FormData();
      form.set(
        "signature",
        new Blob([await fixture()], { type: "image/png" }),
        "signature.png",
      );
      return client.request("/signatures/process", {
        method: "POST",
        headers: { "X-CSRF-Token": client.csrf },
        body: form,
      });
    };
    let result = await upload(f);
    assert.equal(result.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    const data = JSON.parse(result.html);
    assert(data.ok);
    assert.match(data.signature, /^data:image\/png;base64,/);
    assert.equal((await upload(a)).status, 200);
    assert.equal((await upload(s)).status, 403);
    result = await f.post(`/faculty/courses/${course.id}/credentials`, {
      signature: data.signature,
      badgeLabel: "Booking fundamentals",
    });
    assert.equal(result.status, 302);
    assert.equal((await Course.findByPk(course.id)).awardsApproved, false);
    assert.equal(
      (await CourseAttempt.findByPk(attempt.id)).snapshot.awardsApproved,
      false,
    );
    assert.equal((await CredentialRequest.findOne()).status, "pending");
    assert.equal(
      (
        await f.post(`/faculty/courses/${course.id}/credentials`, {
          signature: "invalid",
        })
      ).status,
      422,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await closeResources();
  }
});
