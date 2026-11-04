import "../config/env.js";
import { aiConfiguration } from "../services/gemini.js";
import { explainCareer } from "../services/careerAi.js";
const config = aiConfiguration();
try {
  if (!config.ready)
    throw Object.assign(
      new Error("Set GEMINI_API_KEY in the private environment."),
      { code: "AI_NOT_CONFIGURED" },
    );
  const result = await explainCareer({
    scores: { "Tourism knowledge": 85 },
    tracks: [
      {
        title: "Tourism Information Assistant",
        label: "Exploratory validation example",
        required: ["Tourism knowledge"],
        strengths: ["Tourism knowledge"],
        gaps: [],
      },
    ],
  });
  console.log(
    JSON.stringify({
      ok: true,
      model: config.model,
      validatedMatches: result.matches.length,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      model: config.model,
      code: error.code || "AI_UNAVAILABLE",
      message: error.code
        ? error.message
        : "Provider verification did not finish.",
    }),
  );
  process.exitCode = 1;
}
