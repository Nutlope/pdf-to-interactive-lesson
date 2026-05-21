import { NextRequest, NextResponse } from "next/server";
import { generateCourseFromPdf } from "@/lib/generate-course-from-pdf";
import { incrementRateLimit } from "@/lib/utils/rate-limiter";
import { getJob, updateJob } from "@/lib/utils/job-store";
import { getQStashReceiver } from "@/lib/utils/qstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const bodyText = await request.text();

  const receiver = getQStashReceiver();
  if (receiver) {
    const signature = request.headers.get("upstash-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 401 }
      );
    }
    try {
      const valid = await receiver.verify({
        signature,
        body: bodyText,
      });
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
    } catch (err) {
      console.error("QStash signature verification failed:", err);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  let jobId: string | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    jobId = parsed.jobId;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await getJob(jobId);
  if (!job) {
    // Job state expired or never created — return 200 so QStash doesn't retry.
    console.warn(`Job ${jobId} not found; skipping.`);
    return NextResponse.json({ ok: true, skipped: "not-found" });
  }

  if (job.status === "complete" || job.status === "error") {
    // Already done — likely a duplicate delivery from QStash.
    return NextResponse.json({ ok: true, skipped: "already-finished" });
  }

  await updateJob(jobId, {
    status: "processing",
    startedAt: Date.now(),
  });

  try {
    const result = await generateCourseFromPdf({
      url: job.url,
      apiKey: job.apiKey || "",
      onProgress: (type, message) => {
        // Fire-and-forget progress updates. Failures here shouldn't kill
        // the job; the next progress event will overwrite anyway.
        updateJob(jobId!, { progressType: type, progress: message }).catch(
          (err) => console.error("Failed to write progress:", err)
        );
      },
    });

    if (!job.apiKey) {
      await incrementRateLimit(job.clientId);
    }

    await updateJob(jobId, {
      status: "complete",
      course: result.course,
      metadata: result.metadata,
      completedAt: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    await updateJob(jobId, {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      completedAt: Date.now(),
    });
    // Return 200 so QStash doesn't redrive — the failure is captured in
    // job state and the client will see the error via status polling.
    return NextResponse.json({ ok: true, jobError: true });
  }
}
