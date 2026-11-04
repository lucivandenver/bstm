export function aiConfiguration() {
  return {
    ready: Boolean(process.env.GEMINI_API_KEY?.trim()),
    model: (process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash").replace(
      /^models\//,
      "",
    ),
  };
}
