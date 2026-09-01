import { NextResponse } from "next/server";
import { getActiveRadarConfigurations } from "@/lib/db/radar-queries";
import { executeRadarConfiguration } from "@/lib/radar/radar-service";

// For Vercel Cron (or external cron pings)
export async function GET(request: Request) {
  // TODO: Add proper authentication check for cron
  // e.g. check Authorization header with a CRON_SECRET

  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const activeConfigs = await getActiveRadarConfigurations();
    const now = new Date();
    
    let processed = 0;
    const results = [];

    for (const config of activeConfigs) {
      // Check if it's time to run based on nextRunAt
      if (!config.nextRunAt || config.nextRunAt <= now) {
        // Execute the job
        const res = await executeRadarConfiguration(config.id, undefined, false);
        results.push({ configId: config.id, result: res });
        processed++;
        
        // Very basic mock to update nextRunAt (+3 hours for example)
        // In reality you would parse config.frequency ("A cada 3 horas") to calculate the next date.
        // Doing this update in radar-service or radar-queries
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Processed ${processed} radar configurations.`,
      results
    });
  } catch (error: any) {
    console.error("Cron Radar Sync Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
