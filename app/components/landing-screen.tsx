"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { getApiKey } from "@/lib/api-key-storage";
import { storePendingFile } from "@/lib/utils/indexed-db-storage";
import { getOrCreateUserId } from "@/lib/utils/session";
import { ApiKeyDialog } from "./api-key-dialog";
import { Loader } from "@/components/ai-elements/loader";
import { LogoSvg } from "./svg-icons";
import { HeaderActions } from "./header-actions";
import { LandingSteps } from "./landing-steps";
import { Reveal } from "./reveal";
import { Footer } from "./footer";
import { Button } from "./ui/button";
import { Callout } from "./ui/callout";
import { Upload, UploadCloud, Sparkles } from "lucide-react";

function LandingScreen() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [hasCourses, setHasCourses] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkCourses = async () => {
      try {
        const userId = getOrCreateUserId();
        const response = await fetch("/api/courses", {
          headers: {
            "X-User-ID": userId,
          },
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json();
          setHasCourses(data.courses.length > 0);
        }
      } catch (error) {
        console.error("Failed to fetch courses:", error);
      }
    };

    checkCourses();
    window.addEventListener("storage", checkCourses);
    return () => window.removeEventListener("storage", checkCourses);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      handleFileUpload(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      handleFileUpload(file);
    }
  };

  const processFileUpload = async (file: File) => {
    const estimatedPages = Math.ceil(file.size / (100 * 1024));
    if (estimatedPages > 100) {
      setError(
        `This PDF appears to be very large (~${estimatedPages} pages). We currently only support PDFs up to 100 pages. Please upload a shorter document.`
      );
      return;
    }

    try {
      await storePendingFile(file);
      window.location.href = "/generating";
    } catch (error) {
      console.error("Failed to store file:", error);
      setError("Failed to process file. Please try again.");
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith(".pdf")) {
      setError("Please upload a PDF file");
      return;
    }

    const apiKey = getApiKey();

    if (!apiKey) {
      try {
        const response = await fetch("/api/rate-limit-status");
        const rateLimitStatus = await response.json();

        if (rateLimitStatus.hasReachedCourseLimit) {
          setError("You've used all 3 free courses! Add your Together AI API key to generate unlimited courses.");
          setPendingFile(file);
          setIsApiKeyDialogOpen(true);
          return;
        }
      } catch (error) {
        console.error("Failed to check rate limit:", error);
      }
    }

    await processFileUpload(file);
  };

  const handleApiKeySaved = () => {
    if (pendingFile) {
      const apiKey = getApiKey();
      if (apiKey) {
        const fileToUpload = pendingFile;
        setPendingFile(null);
        setError(null);
        setTimeout(() => {
          processFileUpload(fileToUpload);
        }, 100);
      } else {
        setPendingFile(null);
        setError(null);
      }
    }
  };

  const handleTryDemo = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      setProgress("Loading demo course...");

      const userId = getOrCreateUserId();
      const response = await fetch("/api/demo-course", {
        method: "POST",
        headers: {
          "X-User-ID": userId,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save demo course");
      }

      const savedCourse = await response.json();

      if (savedCourse && savedCourse.slug) {
        window.location.href = `/course/${savedCourse.slug}`;
      } else {
        throw new Error("Failed to retrieve course details");
      }
    } catch (error) {
      console.error("Failed to load demo:", error);
      setError("Failed to load demo course. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white relative flex flex-col overflow-x-clip">
      <ApiKeyDialog
        open={isApiKeyDialogOpen}
        onOpenChange={(open) => {
          setIsApiKeyDialogOpen(open);
          if (!open) handleApiKeySaved();
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-50 h-16 border-b-[0.5px] border-border bg-white/80 backdrop-blur-sm">
        <div className="h-full max-w-7xl mx-auto px-6 flex items-center justify-between">
          <Link
            href="/"
            aria-label="Go to PDF to Lesson home page"
            className="flex items-center gap-2.5 text-neutral-950"
          >
            <LogoSvg className="h-6 w-auto" aria-hidden="true" />
            <span className="font-sans text-lg font-bold leading-none tracking-normal whitespace-nowrap">
              PDF to Lesson
            </span>
          </Link>
          <HeaderActions showCoursesLink={hasCourses} />
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-6 pt-16 md:pt-24 pb-8 md:pb-10">
        {/* Hero */}
        <div className="relative">
          {/* Decorative illustrations flanking the hero on large screens */}
          <Image
            src="/landing-left.webp"
            alt=""
            aria-hidden="true"
            width={300}
            height={338}
            priority
            className="rise hidden lg:block absolute left-0 top-10 w-56 xl:w-72 h-auto z-0 pointer-events-none select-none"
            style={{ animationDelay: "0.15s" }}
          />
          <Image
            src="/landing-right.webp"
            alt=""
            aria-hidden="true"
            width={300}
            height={300}
            priority
            className="rise hidden lg:block absolute right-0 top-10 w-56 xl:w-72 h-auto z-0 pointer-events-none select-none"
            style={{ animationDelay: "0.22s" }}
          />

          <div className="relative z-10 text-center max-w-3xl mx-auto">
            <a
              href="https://togetherai.link/?utm_source=pdf-to-interactive-lesson&utm_medium=referral&utm_campaign=example-app"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Made & powered by Together AI"
              className="rise interactive inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white border border-border mb-6"
              style={{ animationDelay: "0.04s" }}
            >
              <span className="text-sm font-medium text-neutral-600">Made &amp; powered by</span>
              <img src="/together-logo-light.png" alt="Together AI" className="h-5 w-auto" />
            </a>
            <h1
              className="rise font-bold text-neutral-900 leading-[1.05] tracking-[-0.045em] text-balance mb-5 text-[clamp(2.5rem,7vw,4.5rem)]"
              style={{ animationDelay: "0.11s" }}
            >
              Make a tailored course for you
            </h1>
            <p
              className="rise text-lg md:text-xl text-neutral-600 font-medium text-pretty max-w-xl mx-auto mb-10"
              style={{ animationDelay: "0.18s" }}
            >
              Upload any material and turn it into a personalized, interactive course.
            </p>

          {/* Upload card */}
          <div className="rise max-w-2xl mx-auto" style={{ animationDelay: "0.25s" }}>
            <input
              ref={fileInputRef}
              type="file"
              id="file-upload"
              className="hidden"
              accept=".pdf,application/pdf"
              onChange={handleFileSelect}
              disabled={isProcessing}
            />
            <div className="gradient-border p-2 shadow-sm" style={{ borderWidth: "1px" }}>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={`group rounded-[14px] px-8 py-10 md:py-12 min-h-[210px] flex flex-col items-center justify-center text-center transition-colors duration-200 ease-standard ${
                  isDragging ? "bg-surface-subtle" : "bg-white"
                } ${!isProcessing ? "cursor-pointer" : ""}`}
              >
                {isProcessing ? (
                  <div className="flex flex-col items-center text-center">
                    <Loader size={30} className="mb-4 text-neutral-900" />
                    <p className="text-neutral-800 font-medium">{progress}</p>
                    <p className="text-sm text-neutral-500 mt-2">This may take a few minutes…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div
                      className={`mb-5 flex h-12 w-12 items-center justify-center text-neutral-700 transition-transform duration-300 ease-out-soft ${
                        isDragging ? "scale-110 -translate-y-0.5" : "group-hover:scale-105"
                      }`}
                    >
                      <UploadCloud className="h-8 w-8" />
                    </div>
                    <Button
                      size="lg"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Upload a PDF
                    </Button>
                    <p className="mt-4 text-sm text-neutral-500">
                      {isDragging ? "Drop your PDF to begin" : "or drag & drop your file here"}
                    </p>
                    <p className="mt-1 text-xs text-neutral-400">
                      PDF up to 100 pages
                    </p>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <Callout variant="incorrect" className="mt-6 text-sm text-left">
                {error}
              </Callout>
            )}

            {!isProcessing && (
              <div className="mt-6">
                <Button variant="outline" onClick={handleTryDemo}>
                  <Sparkles className="w-4 h-4" />
                  Try a demo course
                </Button>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Section 2 — How it works */}
        <LandingSteps />

        {/* Section 3 — CTA */}
        <section>
          <Reveal className="gradient-border max-w-5xl mx-auto p-8 md:p-12">
            <div className="flex flex-col items-center lg:flex-row lg:justify-between gap-8">
              <div className="max-w-xl text-center lg:text-left">
                <span className="text-xs font-semibold uppercase tracking-wider text-hint-fg">
                  Ready when you are
                </span>
                <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold text-neutral-900 tracking-[-0.04em] text-balance mt-2 mb-3 leading-[1.1]">
                  Turn your next PDF into a course you&rsquo;ll actually finish.
                </h2>
                <p className="text-base text-neutral-600">
                  No setup. Your first 3 courses are free.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row lg:flex-col gap-3 lg:flex-shrink-0 w-full sm:w-auto">
                <Button
                  size="lg"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                >
                  <Upload className="w-5 h-5" />
                  Upload a PDF
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleTryDemo}
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                >
                  {isProcessing ? (
                    <>
                      <Loader size={18} />
                      Loading demo…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Try the demo
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export { LandingScreen };
