import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import bcrypt from "bcryptjs";
import { browser } from "./httpHelpers.js";
process.env.NODE_ENV = "test";
process.env.TEST_DB_STORAGE = ":memory:";
const { sequelize, User } = await import("../models/learningModels.js");
const { AiJob } = await import("../models/portalModels.js");
const { signalCourseJob } = await import("../services/courseLive.js");
const { startServer, closeResources } = await import("../index.js");

test(
  "course progress is delivered by WebSocket and SSE to the job owner",
  { timeout: 20000 },
  async () => {
    await sequelize.sync({ force: true });
    const password = await bcrypt.hash("LiveTesting-2026!", 4);
    const [owner, other] = await Promise.all(
      ["owner", "other"].map((name) =>
        User.create({
          name,
          email: name + "@example.test",
          password,
          role: "faculty",
          approvalStatus: "approved",
        }),
      ),
    );
    const job = await AiJob.create({
      userId: owner.id,
      type: "course-draft",
      status: "completed",
    });
    const server = await startServer(0),
      base = "http://127.0.0.1:" + server.address().port;
    const controller = new AbortController();
    const clients = [];
    try {
      const faculty = browser(base),
        outsider = browser(base);
      for (const [client, user] of [
        [faculty, owner],
        [outsider, other],
      ]) {
        await client.login(user.email, "LiveTesting-2026!");
        await client.get("/faculty/upload");
      }
      const path = "/faculty/generation/" + job.id;
      assert.equal((await outsider.post(path + "/ticket")).status, 404);
      assert.equal((await outsider.get(path + "/events")).status, 404);
      const reply = await faculty.post(path + "/ticket");
      assert.equal(reply.status, 200);
      const { ticket } = JSON.parse(reply.html);
      const ws = new WebSocket(
        base.replace("http:", "ws:") + "/faculty/live",
        ticket,
        { origin: base },
      );
      clients.push(ws);
      assert.equal(String((await once(ws, "message"))[0]), "update");
      const sse = await fetch(base + path + "/events", {
        headers: { cookie: faculty.cookie },
        signal: controller.signal,
      });
      assert.match(sse.headers.get("content-type"), /event-stream/);
      const reader = sse.body.getReader();
      assert.match(
        Buffer.from((await reader.read()).value).toString(),
        /data: update/,
      );
      const next = once(ws, "message");
      signalCourseJob(job.id);
      assert.equal(String((await next)[0]), "update");
      assert.match(
        Buffer.from((await reader.read()).value).toString(),
        /data: update/,
      );
      const reused = new WebSocket(
        base.replace("http:", "ws:") + "/faculty/live",
        ticket,
        { origin: base },
      );
      await once(reused, "error");
    } finally {
      controller.abort();
      for (const ws of clients) ws.terminate();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await closeResources();
    }
  },
);
