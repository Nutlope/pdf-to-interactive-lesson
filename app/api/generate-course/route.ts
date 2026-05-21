import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIdentifier,
} from "@/lib/utils/rate-limiter";
import { createJob } from "@/lib/utils/job-store";
import { enqueueGenerationJob } from "@/lib/utils/qstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get("X-Together-API-Key");
    const clientId = getClientIdentifier(request);

    const rateLimitCheck = await checkRateLimit(clientId, !!apiKey);
    if (!rateLimitCheck.allowed && !apiKey) {
      return NextResponse.json(
        {
          error:
            "You've used all 3 free courses. Please add your Together AI API key to generate unlimited courses.",
        },
        { status: 402 }
      );
    }

    const formData = await request.formData();
    const url = formData.get("url") as string | null;
    if (!url) {
      return NextResponse.json(
        { error: "Missing PDF url" },
        { status: 400 }
      );
    }

    const jobId = crypto.randomUUID();
    await createJob(jobId, {
      url,
      apiKey: apiKey || undefined,
      clientId,
    });
    await enqueueGenerationJob(jobId);

    return NextResponse.json({ jobId });
  } catch (error) {
    console.error("Error enqueuing course generation:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to enqueue job",
      },
      { status: 500 }
    );
  }
}
