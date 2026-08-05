import { db } from "../lib/db";
import { videoTemplate } from "../lib/db/schema";
import { eq, and, isNull, or } from "drizzle-orm";
import { videoTemplatePreviewService } from "../lib/creatomate/preview-service";

async function run() {
  const apiKey = "896b6007199a4ba383d6f7eabf5bd76cbcea4e334288506369bec1a8e320eef56a050f86608d97b6277f46bc46fff8b1";
  process.env.CREATOMATE_API_KEY = apiKey;
  
  console.log("Starting preview generation for active templates...");

  const templates = await db
    .select()
    .from(videoTemplate)
    .where(
      and(
        eq(videoTemplate.status, "active"),
        or(
          isNull(videoTemplate.videoPreviewUrl),
          eq(videoTemplate.videoPreviewUrl, "")
        )
      )
    );

  console.log(`Found ${templates.length} templates needing preview.`);

  for (const template of templates) {
    console.log(`Generating preview for: ${template.name} (${template.id})`);
    
    try {
      const result = await videoTemplatePreviewService.generatePreview({
        templateId: template.creatomateTemplateId,
        videoSourceKey: template.videoSourceKey,
      });

      if (result.success && result.videoPreviewUrl) {
        await db
          .update(videoTemplate)
          .set({
            videoPreviewUrl: result.videoPreviewUrl,
            thumbnailUrl: result.thumbnailUrl ?? null,
            updatedAt: new Date(),
          })
          .where(eq(videoTemplate.id, template.id));
        
        console.log(`✅ Success for ${template.name}`);
      } else {
        console.error(`❌ Failed for ${template.name}: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ Error for ${template.name}:`, error);
    }
  }

  console.log("Finished.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});