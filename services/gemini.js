export function aiConfiguration() {
  const primary = process.env.GEMINI_API_KEY?.trim();
  const backup = process.env.GEMINI_FALLBACK_API_KEY?.trim();
  const model = (process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash").replace(/^models\//, "");
  return {
    ready: Boolean(primary || backup),
    model,
    providers: [
      ...(primary ? [{ key: primary, model }] : []),
      ...(backup ? [{ key: backup, model }] : []),
    ],
  };
}
