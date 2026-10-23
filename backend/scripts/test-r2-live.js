
const dotenv = require("dotenv");
dotenv.config();

const storageService = require("../services/storageService");

async function testR2Live() {
  console.log("=== Testing Cloudflare R2 Integration ===");
  console.log("Storage Provider:", storageService.provider);
  console.log("Bucket Name:", storageService.r2Bucket);
  console.log("Endpoint:", storageService.r2Endpoint);

  // 1. Image upload test
  console.log("\n1. Testing Image Upload...");
  const dummyImageBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const imageFile = {
    originalname: "test_pixel.png",
    mimetype: "image/png",
    buffer: dummyImageBuffer,
  };

  const imageKey = await storageService.uploadFile(imageFile, { folder: "photos" });
  console.log("✓ Uploaded Image Key:", imageKey);

  // 2. Head / Metadata test
  console.log("\n2. Testing Head / Metadata Retrieval...");
  const imageMeta = await storageService.getFileMetadata(imageKey);
  console.log("✓ Retrieved Metadata:", imageMeta);

  // 3. Audio upload test
  console.log("\n3. Testing Audio Upload...");
  const dummyAudioBuffer = Buffer.from("simulated audio buffer bytes for testing voice note");
  const audioFile = {
    originalname: "test_voice.mp3",
    mimetype: "audio/mpeg",
    buffer: dummyAudioBuffer,
  };

  const audioKey = await storageService.uploadFile(audioFile, { folder: "audio" });
  console.log("✓ Uploaded Audio Key:", audioKey);

  // 4. Presigned Download URL test
  console.log("\n4. Testing Presigned Download URL Generation...");
  const presignedUrl = await storageService.getPresignedDownloadUrl(audioKey, 600);
  console.log("✓ Presigned Download URL (expires in 10m):", presignedUrl.split("?")[0] + "?<presigned-signature>");

  // 5. Public URL test
  console.log("\n5. Testing Public URL Generation...");
  const publicUrl = storageService.getPublicUrl(imageKey);
  console.log("✓ Resolved URL:", publicUrl);

  // 6. Delete test
  console.log("\n6. Testing Deletion of Uploaded Test Assets...");
  await storageService.deleteFile(imageKey);
  console.log("✓ Deleted Image:", imageKey);
  await storageService.deleteFile(audioKey);
  console.log("✓ Deleted Audio:", audioKey);

  // 7. Verify deletion
  const verifyMeta = await storageService.getFileMetadata(imageKey);
  console.log("✓ Metadata after deletion (should be null):", verifyMeta);

  console.log("\n=== ALL CLOUDFLARE R2 LIVE TESTS PASSED! ===");
}

testR2Live().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
