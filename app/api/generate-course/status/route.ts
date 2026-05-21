import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/utils/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId" },
      { status: 400 }
    );
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: "Job not found or expired" },
      { status: 404 }
    );
  }

  // Don't leak the stored API key back to the client.
  const safe = { ...job };
  delete safe.apiKey;
  return NextResponse.json(safe);
}
