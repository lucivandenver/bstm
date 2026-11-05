import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = 'test';
process.env.TEST_DB_STORAGE = ':memory:';
const { sequelize } = await import('../models/learningModels.js');
const { Setting } = await import('../models/adminModels.js');
await sequelize.sync({force:true});
test.after(async () => sequelize.close());
const {
  createCourseTransport,
  retryInformation,
  courseAiConfiguration,
} = await import("../services/courseAiProvider.js");
const input = {
  system: "Use only supplied teaching material.",
  payload: {
    questionCount: 3,
    sections: [{ reference: "Page 1", text: "Verify guest requirements." }],
  },
  schema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
  },
};
const gemini = { provider: "gemini", model: "test-model" };
const success = () =>
  Response.json({
    candidates: [{ content: { parts: [{ text: '{"summary":"Verified"}' }] } }],
  });
test("quota metadata distinguishes retry delays, daily exhaustion and unavailable quota", () => {
  assert.deepEqual(
    retryInformation(
      new Response("", { status: 429, headers: { "Retry-After": "45" } }),
      {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "55s",
            },
          ],
        },
      },
    ),
    { hard: false, noQuota: false, delayMs: 55000 },
  );
  assert.equal(
    retryInformation(new Response("", { status: 429 }), {
      error: {
        details: [
          { violations: [{ quotaId: "RequestsPerDay", quotaValue: "100" }] },
        ],
      },
    }).hard,
    true,
  );
  assert.equal(
    retryInformation(new Response("", { status: 429 }), {
      error: {
        details: [
          { violations: [{ quotaId: "RequestsPerMinute", quotaValue: "0" }] },
        ],
      },
    }).noQuota,
    true,
  );
});
test("transport honors Retry-After, uses bounded backoff, and never retries authentication failures", async () => {
  const old = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    let calls = 0;
    const delays = [],
      statuses = [];
    const request = createCourseTransport({
      fetchImpl: async () =>
        ++calls === 1
          ? Response.json(
              { error: {} },
              { status: 429, headers: { "Retry-After": "45" } },
            )
          : success(),
      wait: async (ms) => delays.push(ms),
      now: () => 100000,
      random: () => 0,
    });
    const result = await request(gemini, {
      ...input,
      onStatus: (s) => statuses.push(s),
    });
    assert.equal(result.text, '{"summary":"Verified"}');
    assert.deepEqual(delays, [45000]);
    assert.equal(statuses[0].phase, "waiting");
    assert.equal(calls, 2);
    let rejectedCalls = 0;
    const rejected = createCourseTransport({
      fetchImpl: async () => {
        rejectedCalls++;
        return Response.json(
          { error: { message: "Invalid credentials" } },
          { status: 403 },
        );
      },
      wait: async () => assert.fail("must not retry 403"),
    });
    await assert.rejects(() => rejected(gemini, input), {
      code: "COURSE_AI_AUTH",
    });
    assert.equal(rejectedCalls, 1);
  } finally {
    if (old === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = old;
  }
});
test("per-day/no-quota errors stop immediately and long waits are returned for a later resume", async () => {
  const old = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    for (const [quotaId, quotaValue, code] of [
      ["RequestsPerDay", "100", "COURSE_AI_DAILY_QUOTA"],
      ["RequestsPerMinute", "0", "COURSE_AI_NO_QUOTA"],
    ]) {
      let calls = 0;
      const request = createCourseTransport({
        fetchImpl: async () => {
          calls++;
          return Response.json(
            { error: { details: [{ violations: [{ quotaId, quotaValue }] }] } },
            { status: 429 },
          );
        },
        wait: async () => assert.fail("hard quota must not retry"),
      });
      await assert.rejects(() => request(gemini, input), { code });
      assert.equal(calls, 1);
    }
    const request = createCourseTransport({
      fetchImpl: async () =>
        Response.json(
          { error: {} },
          { status: 429, headers: { "Retry-After": "120" } },
        ),
      now: () => 100000,
      random: () => 0,
    });
    await assert.rejects(
      () => request(gemini, input),
      (e) => e.code === "COURSE_AI_QUOTA" && Date.parse(e.retryAt) === 220000,
    );
  } finally {
    if (old === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = old;
  }
});
test("Groq uses its own credentials and closed structured JSON schema, validated through the common transport", async () => {
  const old = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "groq-test-key";
  try {
    const request = createCourseTransport({
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
        assert.equal(init.headers.Authorization, "Bearer groq-test-key");
        assert.equal(init.headers["User-Agent"], "CareerBridge/1.0");
        assert(!("x-goog-api-key" in init.headers));
        const body = JSON.parse(init.body);
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(
          body.response_format.json_schema.schema.additionalProperties,
          false,
        );
        assert.deepEqual(body.response_format.json_schema.schema.required, [
          "summary",
        ]);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"summary":"Verified"}' },
            },
          ],
        });
      },
    });
    assert.equal(
      (await request({ provider: "groq", model: "openai/gpt-oss-20b" }, input))
        .provider,
      "groq",
    );
  } finally {
    if (old === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = old;
  }
});

test("an explicitly configured independent Groq backup handles a primary quota failure", async () => {
  const originalFetch = globalThis.fetch,
    oldGemini = process.env.GEMINI_API_KEY,
    oldGroq = process.env.GROQ_API_KEY,
    oldInterval = process.env.COURSE_AI_INTERVAL_MS, oldFallback = process.env.COURSE_AI_FALLBACK;
  process.env.GEMINI_API_KEY = "primary-test";
  process.env.GROQ_API_KEY = "backup-test";
  process.env.COURSE_AI_INTERVAL_MS = "0";
  process.env.COURSE_AI_FALLBACK = "groq";
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(url);
      if (url.includes("googleapis.com"))
        return Response.json(
          {
            error: {
              details: [
                {
                  violations: [{ quotaId: "RequestsPerDay", quotaValue: "10" }],
                },
              ],
            },
          },
          { status: 429 },
        );
      assert.equal(init.headers.Authorization, "Bearer backup-test");
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"summary":"Backup result"}' },
          },
        ],
      });
    };
    const { requestCourseAi } = await import("../services/courseAiProvider.js");
    const result = await requestCourseAi({ ...gemini, fallback: true }, input);
    assert.equal(result.provider, "groq");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [
      ["GEMINI_API_KEY", oldGemini],
      ["GROQ_API_KEY", oldGroq],
      ["COURSE_AI_INTERVAL_MS", oldInterval],
      ["COURSE_AI_FALLBACK", oldFallback],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});


test('Render AI_PROVIDER selects Groq and administrator disable overrides configured keys', async () => {
  const names = ['AI_PROVIDER','COURSE_AI_PROVIDER','GROQ_API_KEY','AI_ENABLED'];
  const previous = names.map(name => [name,process.env[name]]);
  try {
    delete process.env.COURSE_AI_PROVIDER;
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'test-alias-key';
    process.env.AI_ENABLED = 'true';
    assert.equal((await courseAiConfiguration()).provider,'groq');
    assert.equal((await courseAiConfiguration()).ready,true);
    await Setting.upsert({key:'courseGroqEnabled',value:'false'});
    assert.equal((await courseAiConfiguration()).ready,false);
  } finally {
    await Setting.destroy({where:{key:'courseGroqEnabled'}});
    for(const [name,value] of previous) { if(value === undefined) delete process.env[name]; else process.env[name]=value; }
  }
});

test('replacing Gemini credentials with Groq selects the available enabled provider', async () => {
  const names = ['GEMINI_API_KEY','GEMINI_FALLBACK_API_KEY','GROQ_API_KEY','COURSE_AI_PROVIDER','AI_PROVIDER','AI_ENABLED'];
  const previous = names.map(name => [name,process.env[name]]);
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_FALLBACK_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.COURSE_AI_PROVIDER;
    process.env.GROQ_API_KEY='test-replacement-key';
    process.env.AI_ENABLED='true';
    assert.equal((await courseAiConfiguration()).provider,'groq');
    assert.equal((await courseAiConfiguration()).ready,true);
    process.env.COURSE_AI_PROVIDER='gemini';
    assert.equal((await courseAiConfiguration()).provider,'groq');
    await Setting.upsert({key:'courseAiProvider',value:'gemini'});
    assert.equal((await courseAiConfiguration()).provider,'groq');
    await Setting.upsert({key:'courseGroqEnabled',value:'false'});
    assert.equal((await courseAiConfiguration()).ready,false);
    await Setting.upsert({key:'courseGeminiEnabled',value:'false'});
    assert.match((await courseAiConfiguration()).unavailableReason,/disabled/);
  } finally {
    await Setting.destroy({where:{key:['courseAiProvider','courseGroqEnabled','courseGeminiEnabled']}});
    for(const [name,value] of previous) { if(value === undefined) delete process.env[name]; else process.env[name]=value; }
  }
});


test('a non-JSON gateway denial is reported as provider availability instead of invalid credentials', async () => {
  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY='test-gateway-key';
  try {
    const request = createCourseTransport({fetchImpl:async()=>new Response('error code: 1010',{status:403})});
    await assert.rejects(()=>request({provider:'groq',model:'openai/gpt-oss-20b'},input),{code:'COURSE_AI_UNAVAILABLE'});
  } finally { if(previous === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY=previous; }
});
