"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { getApiKey } from "@/lib/api-key-storage";
import { getPendingFile } from "@/lib/utils/indexed-db-storage";
import { getOrCreateUserId } from "@/lib/utils/session";
import type { Course } from "@/lib/types";
import { HeaderActions } from "../components/header-actions";
import { ApiKeyDialog } from "../components/api-key-dialog";

import Link from "next/link";
import { Github, Twitter } from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import { useImageFadeIn } from "../hooks/use-image-fade-in";

export function GeneratingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isQueued, setIsQueued] = useState(false);
  const [lastUpload, setLastUpload] = useState<{ url: string; fileName: string } | null>(null);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const hasStarted = useRef(false);
  const logoFadeIn = useImageFadeIn("/logo.svg");
  const creatingGuyFadeIn = useImageFadeIn("/creating-guy.svg");

  useEffect(() => {
    if (hasStarted.current) return;

    const initializeUpload = async () => {
      // First check for file in IndexedDB (immediate redirect from upload)
      try {
        const file = await getPendingFile();
        if (file) {
          hasStarted.current = true;
          handleFileUpload(file);
          return;
        }
      } catch (error) {
        console.error("Failed to retrieve pending file:", error);
        setError("Failed to retrieve file. Please try uploading again.");
        setIsProcessing(false);
        return;
      }

      // Fallback: Get file URL from query params if provided (for direct links)
      const fileUrl = searchParams.get("url");
      const fileName = searchParams.get("fileName");

      if (fileUrl && fileName) {
        hasStarted.current = true;
        handleGenerateFromUrl(fileUrl, fileName);
        return;
      }

      // No file or URL provided, redirect back to courses
      router.push("/courses");
    };

    initializeUpload();
  }, [searchParams, router]);

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setProgress("Uploading PDF to storage...");

    try {
      // Check file size as a rough proxy for page count
      const estimatedPages = Math.ceil(file.size / (100 * 1024));
      if (estimatedPages > 100) {
        throw new Error(
          `This PDF appears to be very large (~${estimatedPages} pages). We currently only support PDFs up to 100 pages. Please upload a shorter document.`
        );
      }

      // Upload to Vercel Blob
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload-url",
      });

      // Store the upload info for retry
      setLastUpload({ url: blob.url, fileName: file.name });

      // Continue with generation (skip setting processing state since we're already processing)
      await handleGenerateFromUrl(blob.url, file.name, true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to upload file. Please try again.";
      
      let displayError = errorMessage;
      if (errorMessage.includes("pages") && errorMessage.includes("100")) {
        displayError = "This PDF is too large. We currently support PDFs up to 100 pages. Please split your document into smaller sections or upload a shorter version.";
      } else if (errorMessage.includes("credits")) {
        displayError = errorMessage;
      } else if (errorMessage.includes("API key") || errorMessage.includes("free course")) {
        displayError = errorMessage;
      }
      
      setError(displayError);
      setIsProcessing(false);
    }
  };

  const handleGenerateFromUrl = async (url: string, fileName: string, skipProcessingState = false) => {
    if (!skipProcessingState) {
      setIsProcessing(true);
    }
    setError(null);
    setIsQueued(false);
    setProgress("Generating course from PDF...");

    // Store the upload info for retry
    setLastUpload({ url, fileName });

    try {
      const apiKey = getApiKey();

      const formData = new FormData();
      formData.append("url", url);

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["X-Together-API-Key"] = apiKey;
      }

      const enqueueResponse = await fetch("/api/generate-course", {
        method: "POST",
        headers,
        body: formData,
      });

      if (!enqueueResponse.ok) {
        const errorData = await enqueueResponse.json();
        if (enqueueResponse.status === 402) {
          throw new Error(errorData.message || `Insufficient credits.`);
        }
        throw new Error(errorData.error || "Failed to generate course");
      }

      const { jobId } = (await enqueueResponse.json()) as { jobId: string };
      if (!jobId) {
        throw new Error("No jobId returned from server");
      }

      const POLL_INTERVAL_MS = 1500;
      const MAX_POLL_MS = 20 * 60 * 1000;
      const startedAt = Date.now();

      let courseData: Course | null = null;
      let courseMetadata: Record<string, unknown> | null = null;

      while (Date.now() - startedAt < MAX_POLL_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const statusResponse = await fetch(
          `/api/generate-course/status?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );

        if (!statusResponse.ok) {
          if (statusResponse.status === 404) {
            throw new Error("Job expired before completing. Please try again.");
          }
          continue;
        }

        const state = await statusResponse.json();

        if (state.status === "queued") {
          setIsQueued(true);
          setProgress("Waiting in line...");
        } else if (state.status === "processing") {
          setIsQueued(false);
          if (state.progress) {
            setProgress(state.progress);
          }
        } else if (state.status === "complete") {
          courseData = state.course;
          courseMetadata = state.metadata || null;
          break;
        } else if (state.status === "error") {
          throw new Error(state.error || "Unknown error occurred during course generation");
        }
      }

      if (!courseData) {
        throw new Error("Course generation timed out. Please try again.");
      }

      // Attach generation metadata to course object (for debug panel)
      if (courseMetadata) {
        (courseData as unknown as Record<string, unknown>)._metadata = courseMetadata;
      }

      setProgress("Course generated successfully! Saving to database...");

      // Save course to database for sharing
      try {
        const userId = getOrCreateUserId();
        const saveResponse = await fetch("/api/courses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": userId,
          },
          body: JSON.stringify({ course: courseData }),
        });

        if (!saveResponse.ok) {
          const errorData = await saveResponse.json();
          throw new Error(errorData.error || "Failed to save course");
        }

        const savedCourse = await saveResponse.json();
        setProgress("Course saved! Redirecting...");
        
        // Navigate to the course using the slug from the database
        router.push(`/course/${savedCourse.slug}`);
      } catch (saveError) {
        console.error("Error saving course to database:", saveError);
        // For now, show error - in production you might want to save locally as fallback
        throw new Error("Failed to save course to database. Please try again.");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to process PDF. Please try again.";

      let displayError = errorMessage;
      if (errorMessage.includes("pages") && errorMessage.includes("100")) {
        displayError = "This PDF is too large. We currently support PDFs up to 100 pages. Please split your document into smaller sections or upload a shorter version.";
      } else if (errorMessage.includes("credits")) {
        displayError = errorMessage;
      } else if (errorMessage.includes("API key")) {
        displayError = errorMessage;
      }

      setError(displayError);
      setIsProcessing(false);
    }
  };

  const isApiKeyError = error?.toLowerCase().includes("api key") || error?.toLowerCase().includes("invalid api");

  const handleApiKeyDialogChange = (open: boolean) => {
    setIsApiKeyDialogOpen(open);
    // When dialog closes, check if a key was saved and auto-retry
    if (!open && lastUpload) {
      const key = getApiKey();
      if (key) {
        setError(null);
        handleGenerateFromUrl(lastUpload.url, lastUpload.fileName);
      }
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <ApiKeyDialog
        open={isApiKeyDialogOpen}
        onOpenChange={handleApiKeyDialogChange}
        message={isApiKeyError ? "Add your Together AI API key to continue generating your course." : undefined}
      />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b-[0.5px] border-neutral-200 bg-white w-full">
        <div className="w-full px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/">
              <img
                ref={logoFadeIn.imgRef}
                src="/logo.svg"
                alt="Logo"
                onLoad={logoFadeIn.handleLoad}
                onError={logoFadeIn.handleError}
                className={`h-6 w-auto transition-opacity duration-700 ease-out ${logoFadeIn.isLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
            </Link>
          </div>
          <HeaderActions showCoursesLink />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center bg-white relative">
        <div className="max-w-2xl w-full px-8 flex-1 flex flex-col items-center justify-center pb-64 relative z-10">
          <div className="flex flex-col items-center justify-center">
            {error ? (
              <div className="w-full max-w-xl">
                <div className="bg-red-50 border border-red-200 rounded-2xl p-8 mb-8">
                  <div className="flex items-start gap-4 mb-6">
                    <div className="flex-shrink-0">
                      <svg
                        className="w-10 h-10 text-red-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div className="flex-1 pt-2">
                      <h2 className="text-red-900 font-bold text-2xl mb-3">Failed to generate course</h2>
                      <p className="text-red-800 text-base leading-relaxed">{error}</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 justify-center">
                  {isApiKeyError ? (
                    <button
                      onClick={() => setIsApiKeyDialogOpen(true)}
                      className="px-8 py-3 bg-neutral-900 text-white rounded-full font-medium hover:bg-neutral-800 transition-colors text-sm"
                    >
                      Add API Key
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (lastUpload) {
                          setError(null);
                          handleGenerateFromUrl(lastUpload.url, lastUpload.fileName);
                        } else {
                          router.push("/courses");
                        }
                      }}
                      className="px-8 py-3 bg-neutral-900 text-white rounded-full font-medium hover:bg-neutral-800 transition-colors text-sm"
                    >
                      Try Again
                    </button>
                  )}
                  <Link
                    href="/courses"
                    className="px-8 py-3 bg-neutral-100 text-neutral-700 rounded-full font-medium hover:bg-neutral-200 transition-colors text-sm"
                  >
                    Back to Courses
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <Loader size={48} className="mb-8 text-blue-500 [animation-duration:0.6s]" />
                <p className="text-neutral-900 font-bold text-4xl mb-6">{progress}</p>
                <p className="text-sm text-neutral-500">
                  {isQueued ? "Your course is queued and will begin as soon as a slot opens." : "This may take a few minutes..."}
                </p>
              </div>
            )}
          </div>
        </div>
        
        {/* Creating Guy Illustration at Bottom - Clipping with Footer */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-center z-0" style={{ marginBottom: '0px' }}>
          <img 
            ref={creatingGuyFadeIn.imgRef}
            src="/creating-guy.svg" 
            alt="Creating illustration"
            onLoad={creatingGuyFadeIn.handleLoad}
            onError={creatingGuyFadeIn.handleError}
            className={`h-auto max-w-md w-full transition-opacity duration-700 ease-out ${creatingGuyFadeIn.isLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t-[0.5px] border-neutral-200 px-4 py-4 flex items-center justify-between relative z-10">
        <a
          href="https://together.ai"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Powered by together.ai"
          className="inline-flex items-center gap-1.5 px-3 h-6 rounded-full bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 transition-colors"
        >
          <span className="text-xs font-medium text-white">Powered by</span>
          <img
            src="/together-ai-new-logo.png"
            alt="Together AI"
            className="h-3 w-auto object-contain"
          />
        </a>
        <div className="flex items-center gap-3">
          <a 
            href="https://github.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 bg-neutral-50 border border-neutral-200 rounded-full text-neutral-700 hover:text-neutral-900 transition-colors"
            aria-label="GitHub"
          >
            <Github className="w-4 h-4" />
          </a>
          <a 
            href="https://x.com/nutlope" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 bg-neutral-50 border border-neutral-200 rounded-full text-neutral-700 hover:text-neutral-900 transition-colors"
            aria-label="X (Twitter)"
          >
            <Twitter className="w-4 h-4" />
          </a>
        </div>
      </footer>
    </div>
  );
}
