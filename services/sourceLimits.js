// Raw files are uploaded sequentially by the browser; only extracted text is retained.
export const sourceLimits = Object.freeze({
  fileBytes: 100 * 1024 * 1024,
  requestBytes: 100 * 1024 * 1024,
  requestFiles: 20,
  textCharacters: 1000000,
  sections: 10000,
  pages: 300,
  chunkCharacters: 60000,
});
