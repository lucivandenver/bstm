import multer from "multer";
import { sourceLimits } from "./sourceLimits.js";
// Bound aggregate memory even for chunked multipart requests without Content-Length.
export function sourceUploadStorage() {
  return {
    _handleFile(req, file, callback) {
      const chunks = [];
      let size = 0,
        done = false;
      file.stream.on("data", (chunk) => {
        if (done) return;
        req.sourceUploadBytes = (req.sourceUploadBytes || 0) + chunk.length;
        if (req.sourceUploadBytes > sourceLimits.requestBytes) {
          done = true;
          chunks.length = 0;
          callback(new multer.MulterError("LIMIT_TOTAL_SIZE"));
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
      });
      file.stream.on("error", (error) => {
        if (!done) {
          done = true;
          callback(error);
        }
      });
      file.stream.on("end", () => {
        if (!done) {
          done = true;
          callback(null, { buffer: Buffer.concat(chunks), size });
        }
      });
    },
    _removeFile(req, file, callback) {
      delete file.buffer;
      callback(null);
    },
  };
}
