import sharp from "sharp";
export const signatureFixture = () =>
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="140"><rect width="380" height="140" fill="#f5f0df"/><path d="M40 100Q90 25 105 85T175 55Q170 125 250 60M160 100L320 75" fill="none" stroke="#183e79" stroke-width="5"/></svg>',
    ),
  )
    .png()
    .toBuffer();
