import { db } from "../lib/db";
import { videoTemplate } from "../lib/db/schema";

async function run() {
  console.log("Creating Template...");

  const templateId = crypto.randomUUID();

  const [created] = await db
    .insert(videoTemplate)
    .values({
      id: templateId,
      name: "004",
      creatomateTemplateId: "f528ec2d-699d-4ed0-91f0-6e2a0d7f9bb3",
      videoSourceKey: "Video-1",
      thumbnailUrl: "https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/426fa923-8946-4b6d-9b6a-437db38fe7c9.jpg",
      videoPreviewUrl: "https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/0e60a6aa-0907-4a5b-9c6b-7d9b4a1dd3e7.mp4",
      status: "active",
    })
    .returning();

  console.log("✅ Template created:", created);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});