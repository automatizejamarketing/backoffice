import { db } from "../lib/db/index";
import { radarSearchConfigurations } from "../lib/db/schema";

async function main() {
  await db.insert(radarSearchConfigurations).values({
    name: "Hamburguerias — Brasil",
    niche: "Food",
    subNiche: "Hamburgueria",
    keywords: ["hambúrguer", "smash burger", "hambúrguer artesanal"],
    hashtags: ["#hamburgueria", "#smashburger"],
    platforms: ["Instagram", "TikTok"],
    formats: ["Reels", "TikTok"],
    frequency: "A cada 3 horas",
    maxResults: 50,
    minScore: 0,
    requiresApproval: true,
    isActive: true,
  });
  console.log("Configuração criada com sucesso!");
}
main().catch(console.error);
