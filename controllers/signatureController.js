import { processSignature } from "../services/signatureProcessing.js";
export async function processUpload(req, res) {
  if (
    req.user.role !== "admin" &&
    !(req.user.role === "faculty" && req.user.approvalStatus === "approved")
  )
    return res
      .status(403)
      .json({
        ok: false,
        message:
          "Only an administrator or approved faculty can process a signature.",
      });
  try {
    const signature = await processSignature(req.file?.buffer);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, signature });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({
        ok: false,
        message: error.status
          ? error.message
          : "Signature processing is unavailable. Please retry.",
      });
  }
}
