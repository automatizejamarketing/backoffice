import { db } from "../lib/db";
import { videoTemplate } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function run() {
  const updates = [
    { id: "d96389ef-94a5-46ec-95e6-ab5ee0463484", thumbnailUrl: "https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/5c3f7bd0-96bc-401e-b741-abe761ee20ed.jpg" },
    { id: "8ce98ebd-d3d9-4117-bf8d-037f7561c12f", thumbnailUrl: "https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/eace3500-e54a-4289-a799-6f2b86f41a89.jpg" },
    { id: "c777e15c-784b-4ed4-a1ae-248321f87ad0", thumbnailUrl: "https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/0eedd2c5-f92d-4bc6-94ea-cc045b035fb0.jpg" },
    { id: "7ff51678-6a1b-4133-8b12-ca4eb703aa6e", thumbnailUrl: "https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/7ca2e5e7-4c32-4bc7-9760-38b24321a4fe.jpg" },
  ];

  for (const update of updates) {
    const [result] = await db
      .update(videoTemplate)
      .set({ thumbnailUrl: update.thumbnailUrl, updatedAt: new Date() })
      .where(eq(videoTemplate.id, update.id))
      .returning();
    console.log(`✅ Updated ${result.name}: ${result.thumbnailUrl}`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});