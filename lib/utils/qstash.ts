/**
 * QStash client + receiver helpers.
 *
 * Course generation work is queued via QStash so the public route returns
 * immediately (no maxDuration risk for queued jobs) and the worker runs on
 * its own fresh function invocation.
 *
 * Concurrency is enforced by QStash Flow Control (parallelism: 2) — the
 * cross-instance replacement for the previous in-memory semaphore.
 *
 * Local dev: when QSTASH_TOKEN is unset, fall back to a fire-and-forget
 * fetch to the worker endpoint. The worker endpoint must mirror this by
 * skipping signature verification when the receiver keys are unset.
 */

import { Client, Receiver } from "@upstash/qstash";

const FLOW_CONTROL_KEY = "course-generation";
const FLOW_CONTROL_PARALLELISM = 2;

function getWorkerUrl(): string {
  const explicit = process.env.WORKER_BASE_URL;
  if (explicit) return `${explicit.replace(/\/$/, "")}/api/run-generation-job`;
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}/api/run-generation-job`;
  return "http://localhost:3000/api/run-generation-job";
}

export function isQStashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN;
}

export async function enqueueGenerationJob(jobId: string): Promise<void> {
  const workerUrl = getWorkerUrl();

  if (isQStashConfigured()) {
    const client = new Client({ token: process.env.QSTASH_TOKEN! });
    await client.publishJSON({
      url: workerUrl,
      body: { jobId },
      flowControl: {
        key: FLOW_CONTROL_KEY,
        parallelism: FLOW_CONTROL_PARALLELISM,
      },
      retries: 1,
    });
    return;
  }

  // Local dev fallback: fire-and-forget. Don't await; just kick it off.
  // Errors here are swallowed because the worker will log its own.
  fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  }).catch((err) => {
    console.error("Local worker kick-off failed:", err);
  });
}

export function getQStashReceiver(): Receiver | null {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) return null;
  return new Receiver({
    currentSigningKey: current,
    nextSigningKey: next,
  });
}
