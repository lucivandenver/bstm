import { Setting } from "../models/adminModels.js";
import { generationError } from "./courseGenerationErrors.js";
import { GoogleAuth } from "google-auth-library";

const vertexMode = () => process.env.VERTEX_AUTH_MODE?.trim().toLowerCase() === "api_key" ? "api_key" : "service_account";
const vertexProject = () => process.env.VERTEX_PROJECT_ID?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim();
const vertexLocation = () => process.env.VERTEX_LOCATION?.trim() || process.env.GOOGLE_CLOUD_LOCATION?.trim();

export function missingVertexSettings() {
  if (vertexMode() === "api_key") return process.env.VERTEX_API_KEY?.trim() ? [] : ["VERTEX_API_KEY"];
  const missing = [];
  if (!vertexProject()) missing.push("VERTEX_PROJECT_ID");
  if (!vertexLocation()) missing.push("VERTEX_LOCATION");
  if (!process.env.VERTEX_SERVICE_ACCOUNT_JSON?.trim() && !process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    missing.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
  return missing;
}

const vertexReady = () => missingVertexSettings().length === 0;

export async function courseAiConfiguration() {
  const settings = Object.fromEntries((await Setting.findAll({where:{key:['courseAiProvider','courseAiEnabled','courseGeminiEnabled','courseGroqEnabled','courseVertexEnabled']}})).map(row => [row.key,row.value]));
  const enabled = settings.courseAiEnabled === undefined ? process.env.AI_ENABLED !== 'false' : settings.courseAiEnabled === 'true';
  const allowed = name => settings[name === 'groq' ? 'courseGroqEnabled' : name === 'vertex' ? 'courseVertexEnabled' : 'courseGeminiEnabled'] !== 'false';
  const selected = settings.courseAiProvider || process.env.COURSE_AI_PROVIDER || process.env.AI_PROVIDER;
  const provider = ["groq", "vertex"].includes(selected) ? selected : "gemini";
  const model =
    provider === "groq"
      ? process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b"
      : provider === "vertex"
        ? process.env.VERTEX_MODEL?.trim() || "gemini-2.5-flash"
      : (
          process.env.COURSE_GEMINI_MODEL?.trim() ||
          process.env.GEMINI_MODEL?.trim() ||
          "gemini-3.1-flash-lite"
        ).replace(/^models\//, "");
  const key =
    provider === "groq" ? process.env.GROQ_API_KEY : provider === "vertex" ? process.env.VERTEX_API_KEY : (process.env.GEMINI_API_KEY || process.env.GEMINI_FALLBACK_API_KEY);
  const fallback =
    process.env.COURSE_AI_FALLBACK === "groq" &&
    provider !== "groq" && allowed("groq") &&
    process.env.GROQ_API_KEY?.trim();
  return {
    provider,
    model,
    ready: enabled && allowed(provider) && (provider === "vertex" ? vertexReady() : Boolean(key?.trim())),
    enabled,
    geminiEnabled: allowed("gemini"),
    groqEnabled: allowed("groq"),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_FALLBACK_API_KEY?.trim()),
    groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
    vertexEnabled: allowed("vertex"),
    vertexConfigured: vertexReady(),
    vertexAuthMode: vertexMode(),
    vertexMissingSettings: missingVertexSettings().join(", "),
    label: fallback
      ? `${provider === "vertex" ? "Vertex AI" : "Gemini"} and Groq`
      : provider === "groq"
        ? "Groq"
        : provider === "vertex" ? "Vertex AI" : "Gemini",
    fallback: Boolean(fallback),
  };
}

export function retryInformation(response, body = {}, now = Date.now()) {
  body = body || {};
  const details = body.error?.details || [];
  const raw = String(response.headers?.get("retry-after") || "");
  const seconds = /^\d+(\.\d+)?$/.test(raw)
    ? Number(raw)
    : Math.max(0, (Date.parse(raw) - now) / 1000) || 0;
  const retry = details.find((d) => String(d["@type"]).endsWith("RetryInfo"));
  const hinted = Number(String(retry?.retryDelay || "").replace(/s$/, "")) || 0;
  // Quota metadata is used only for classification, never exposed or logged.
  const violations = details.flatMap((d) => d.violations || []);
  const hard =
    violations.some(
      (v) =>
        Number(v.quotaValue) === 0 ||
        /perday|per_day|daily/i.test(v.quotaId || v.quotaMetric || ""),
    ) ||
    /daily|per day|tokens per day|billing|credit balance/i.test(
      body.error?.message || "",
    );
  return {
    hard,
    noQuota: violations.some((v) => Number(v.quotaValue) === 0),
    delayMs: Math.ceil(Math.max(seconds, hinted) * 1000),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let tail = Promise.resolve(),
  nextRequestAt = 0;
// All Faculty jobs in this service share the same provider credentials.
async function serial(task, onStatus) {
  const previous = tail;
  let release;
  tail = new Promise((resolve) => (release = resolve));
  onStatus?.({
    phase: "queued",
    message: "Waiting for the shared AI generation queue…",
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}
const strictSchema = (node) => {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([k, v]) => [k, strictSchema(v)]),
    );
    out.required = Object.keys(node.properties);
    out.additionalProperties = false;
  }
  if (node.items) out.items = strictSchema(node.items);
  return out;
};

export function createCourseTransport({
  fetchImpl = (...args) => fetch(...args),
  wait = sleep,
  now = Date.now,
  random = Math.random,
} = {}) {
  return async function request(config, { system, payload, schema, onStatus }) {
    const key = (config.apiKey || (config.provider === "groq" ? process.env.GROQ_API_KEY : config.provider === "vertex" ? process.env.VERTEX_API_KEY : process.env.GEMINI_API_KEY || process.env.GEMINI_FALLBACK_API_KEY))?.trim();
    if (config.provider === "vertex" ? !vertexReady() : !key) throw generationError("COURSE_AI_NOT_CONFIGURED");
    const groq = config.provider === "groq";
    const vertex = config.provider === "vertex";
    let url = groq
      ? "https://api.groq.com/openai/v1/chat/completions"
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
    const headers = groq ? { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "User-Agent": "CareerBridge/1.0" } : { "Content-Type": "application/json" };
    if (vertex) {
      if (vertexMode() === "api_key") {
        url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(config.model)}:generateContent`;
        headers["x-goog-api-key"] = key;
      } else {
        try {
          const json = process.env.VERTEX_SERVICE_ACCOUNT_JSON?.trim();
          const scopes = ["https://www.googleapis.com/auth/cloud-platform"];
          const auth = new GoogleAuth(json ? { credentials: JSON.parse(json), scopes } : { scopes });
          const client = await auth.getClient();
          const token = await client.getAccessToken();
          if (!token?.token) throw generationError("COURSE_AI_AUTH");
          headers.Authorization = `Bearer ${token.token}`;
        } catch {
          throw generationError("COURSE_AI_AUTH", "Vertex AI could not authenticate. Ask Admin to check the Render Secret File, credential path, and service account access.");
        }
        const project = vertexProject(), location = vertexLocation();
        const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
        url = `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(config.model)}:generateContent`;
      }
    } else if (!groq) headers["x-goog-api-key"] = key;
    const body = groq
      ? {
          model: config.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(payload) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "course_draft",
              strict: true,
              schema: strictSchema(schema),
            },
          },
          temperature: 0.2,
          max_completion_tokens: 3500,
        }
      : {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: JSON.stringify(payload) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            temperature: 0.2,
            maxOutputTokens: Math.min(
              14000,
              2500 + payload.questionCount * 350,
            ),
          },
        };
    for (let attempt = 0; attempt < 4; attempt++) {
      let response, data;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify(body),
        });
        data = (await response.json().catch(() => ({}))) || {};
      } catch (error) {
        if (attempt === 3) throw generationError("COURSE_AI_TIMEOUT");
      }
      if (response?.ok) {
        if (groq) {
          const choice = data.choices?.[0];
          if (choice?.finish_reason === "length")
            throw generationError("COURSE_AI_TRUNCATED");
          if (!choice?.message?.content)
            throw generationError("COURSE_AI_INVALID");
          return {
            text: choice.message.content,
            provider: config.provider,
            model: config.model,
          };
        }
        const candidate = data.candidates?.[0];
        if (["MAX_TOKENS", "CONTINUATION"].includes(candidate?.finishReason))
          throw generationError("COURSE_AI_TRUNCATED");
        if (
          data.promptFeedback?.blockReason ||
          ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].includes(
            candidate?.finishReason,
          )
        )
          throw generationError("COURSE_AI_BLOCKED");
        const text = candidate?.content?.parts
          ?.filter((p) => !p.thought)
          .map((p) => p.text || "")
          .join("");
        if (!text) throw generationError("COURSE_AI_INVALID");
        return { text, provider: config.provider, model: config.model };
      }
      const status = response?.status;
      if (status === 403 && Object.keys(data).length === 0) throw generationError("COURSE_AI_UNAVAILABLE");
      if (status && ![408, 429, 500, 502, 503, 504].includes(status))
        throw generationError(
          [401, 403].includes(status)
            ? "COURSE_AI_AUTH"
            : status === 404
              ? "COURSE_AI_MODEL"
              : "COURSE_AI_REQUEST",
        );
      const info = response
        ? retryInformation(response, data, now())
        : { hard: false, delayMs: 0 };
      if (status === 429 && info.hard)
        throw generationError(
          info.noQuota ? "COURSE_AI_NO_QUOTA" : "COURSE_AI_DAILY_QUOTA",
        );
      const delay = Math.max(
        info.delayMs,
        Math.min(30000, 2000 * 2 ** attempt) + Math.floor(random() * 1000),
      );
      if (attempt === 3 || delay > 60000) {
        const error = generationError(
          status === 429 ? "COURSE_AI_QUOTA" : "COURSE_AI_UNAVAILABLE",
        );
        error.retryAt = new Date(now() + Math.max(delay, 60000)).toISOString();
        throw error;
      }
      onStatus?.({
        phase: "waiting",
        retryAt: new Date(now() + delay).toISOString(),
        message: `${groq ? "Groq" : vertex ? "Vertex AI" : "Gemini"} is busy or rate-limited. Waiting before retry ${attempt + 2} of 4…`,
      });
      await wait(delay);
    }
  };
}
const transport = createCourseTransport();
export async function requestCourseAi(config, input) {
  return serial(async () => {
    config = await courseAiConfiguration();
    if (!config.ready) throw generationError("COURSE_AI_NOT_CONFIGURED");
    const configured = Number(process.env.COURSE_AI_INTERVAL_MS);
    const interval =
      Number.isFinite(configured) && configured >= 0
        ? Math.min(configured, 60000)
        : process.env.NODE_ENV === "test"
          ? 0
          : config.provider === "groq"
            ? 1500
            : 2500;
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) {
      input.onStatus?.({
        phase: "waiting",
        retryAt: new Date(Date.now() + wait).toISOString(),
        message: "Spacing AI requests to reduce rate-limit errors…",
      });
      await sleep(wait);
    }
    config = await courseAiConfiguration();
    if (!config.ready) throw generationError("COURSE_AI_NOT_CONFIGURED");
    try {
      try {
        return await transport(config, input);
      } catch (error) {
        if (config.provider === 'gemini' && process.env.GEMINI_FALLBACK_API_KEY?.trim() && process.env.GEMINI_FALLBACK_API_KEY !== process.env.GEMINI_API_KEY && ['COURSE_AI_QUOTA','COURSE_AI_DAILY_QUOTA','COURSE_AI_NO_QUOTA','COURSE_AI_UNAVAILABLE','COURSE_AI_TIMEOUT'].includes(error.code)) {
          try { return await transport({...config,apiKey:process.env.GEMINI_FALLBACK_API_KEY.trim()},input); }
          catch (backupError) { error = backupError; }
        }
        if (
          config.fallback &&
          [
            "COURSE_AI_QUOTA",
            "COURSE_AI_DAILY_QUOTA",
            "COURSE_AI_NO_QUOTA",
            "COURSE_AI_UNAVAILABLE",
            "COURSE_AI_TIMEOUT",
          ].includes(error.code)
        ) {
          input.onStatus?.({
            phase: "fallback",
            message:
              "Primary provider unavailable. Trying the configured Groq backup…",
          });
          return await transport(
            {
              provider: "groq",
              model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
            },
            input,
          );
        }
        throw error;
      }
    } finally {
      nextRequestAt = Date.now() + interval;
    }
  }, input.onStatus);
}

