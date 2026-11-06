import { sourceLimits as limits } from "./sourceLimits.js";
import {
  courseAiConfiguration as aiConfiguration,
  requestCourseAi,
} from "./courseAiProvider.js";
export { courseAiConfiguration as aiConfiguration } from "./courseAiProvider.js";
import { Op } from "sequelize";
import { randomUUID, createHash } from "node:crypto";
import { AiJob, CourseRevision } from "../models/portalModels.js";
import { sequelize, User, Course } from "../models/learningModels.js";
import { audit } from "./accounts.js";
import { courseInput } from "./courseAuthoring.js";
import {
  generationError,
  safeGenerationError,
} from "./courseGenerationErrors.js";
import { domains } from "../data/starterCourses.js";
import { text } from "./validation.js";
export function sourceSections(source) {
  let sections = source?.sections;
  if (typeof sections === "string") {
    try {
      sections = JSON.parse(sections);
    } catch {
      throw generationError("COURSE_SOURCE_INVALID");
    }
  }
  if (
    !Array.isArray(sections) ||
    !sections.length ||
    sections.length > limits.sections ||
    sections.some(
      (s) => typeof s?.reference !== "string" || typeof s?.text !== "string",
    ) ||
    sections.reduce((n, s) => n + s.text.length, 0) > limits.textCharacters
  )
    throw generationError("COURSE_SOURCE_INVALID");
  sections = sections.filter((s) => s.text.trim());
  return sections.length ? sections : [{ reference: "No searchable text · manual verification required", text: "" }];
}
export function draftSchema(count) {
  const str = { type: "string" },
    array = (items) => ({ type: "array", items });
  return {
    type: "object",
    required: [
      "insufficient",
      "title",
      "description",
      "outcomes",
      "modules",
      "questions",
    ],
    properties: {
      insufficient: { type: "boolean" },
      title: str,
      description: str,
      minutes: { type: "integer", minimum: 5, maximum: 6000 },
      outcomes: array(str),
      modules: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          required: ["title", "lessons"],
          properties: {
            title: str,
            lessons: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                required: ["title", "body", "takeaways", "sourceReference", "sourceQuote"],
                properties: { title: str, body: str, takeaways: array(str), sourceReference: str, sourceQuote: str },
              },
            },
          },
        },
      },
      questions: {
        type: "array",
        maxItems: count,
        items: {
          type: "object",
          required: [
            "moduleIndex",
            "prompt",
            "options",
            "answer",
            "explanation",
            "sourceReference",
            "sourceQuote",
          ],
          properties: {
            moduleIndex: { type: "integer", minimum: 0, maximum: 5 },
            prompt: str,
            options: { type: "array", minItems: 2, maxItems: 6, items: str },
            answer: { type: "integer", minimum: 0, maximum: 5 },
            explanation: str,
            sourceReference: str,
            sourceQuote: str,
          },
        },
      },
    },
  };
}
const blueprintSchema = {
  type: "object",
  required: ["insufficient", "title", "description", "outcomes", "competencyAreas", "modules"],
  properties: {
    insufficient: { type: "boolean" }, title: { type: "string" }, description: { type: "string" },
    outcomes: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
    competencyAreas: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    modules: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", required: ["title", "outcomes", "sourceReference"], propertie