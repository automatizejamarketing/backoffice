import { db } from "@/lib/db";
import { videoTemplate } from "@/lib/db/schema";
import { VideoTemplatesClient } from "./components/video-templates-client";

export const dynamic = "force-dynamic";

export default async function VideoTemplatesPage() {
  const templates = await db
    .select()
    .from(videoTemplate)
    .orderBy(videoTemplate.position);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates de Vídeo</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as referências e templates do Creatomate que aparecem no Criador de Vídeo.
          </p>
        </div>
      </div>
      
      <VideoTemplatesClient initialTemplates={templates} />
    </div>
  );
}
