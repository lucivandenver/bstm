import "../config/env.js";
import {
  courseAiConfiguration,
  requestCourseAi,
} from "../services/courseAiProvider.js";
import { draftSchema, validateGeneratedDraft } from "../services/courseAi.js";
const config = await courseAiConfiguration(),
  start = Date.now();
const quote =
  "Verify guest requirements, travel dates and booking availability before confirming a reservation.";
const sections = [
  {
    reference: "Synthetic teaching paragraph",
    text:
      quote +
      " Explain prices and cancellation rules clearly. Protect guest information and use authorized records only.",
  },
];
const options = {
  domain: "Tourism and Hospitality Knowledge",
  level: "Foundation",
  outcomes: "Verify reliable tourism reservations.",
  questionCount: 3,
};
try {
  if (!config.ready)
    throw Object.assign(new Error("Configure the selected course provider."), {
      code: "COURSE_AI_NOT_CONFIGURED",
    });
  const result = await requestCourseAi(config, {
    system:
      "Create one concise BSTM module from the supplied source, with lessons and exactly three MCQs. Each question must have exactly one correct zero-based answer, moduleIndex 0, explanation, exact sourceReference and a verbatim 10–1200 character sourceQuote. Return insufficient:false and complete JSON. Do not invent source facts.",
    payload: { ...options, sections },
    schema: draftSchema(3),
  });
  const draft = validateGeneratedDraft(
    JSON.parse(result.text),
    sections,
    options,
  );
  console.log(
    JSON.stringify({
      ok: true,
      provider: result.provider,
      model: result.model,
      seconds: Math.round((Date.now() - start) / 100) / 10,
      modules: draft.modules.length,
      questions: draft.questions.length,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      provider: config.provider,
      model: config.model,
      code: error.code || "COURSE_AI_INVALID",
      message: error.code
        ? error.message
        : "Provider output failed validation.",
    }),
  );
  process.exitCode = 1;
}

finally { const { sequelize } = await import("../models/learningModels.js"); await sequelize.close(); }
