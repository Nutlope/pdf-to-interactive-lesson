"use client";

import { useState, useEffect, useRef } from "react";
import { upload } from "@vercel/blob/client";
import { getApiKey } from "@/lib/api-key-storage";
import { getStoredCourses, saveCourse, updateCourseSlug } from "@/lib/storage";
import { storePendingFile } from "@/lib/utils/indexed-db-storage";
import { generateSlug, ensureUniqueSlug } from "@/lib/utils/slug";
import { ApiKeyDialog } from "./api-key-dialog";
import { Github, Twitter } from "lucide-react";
import Link from "next/link";
import { useImageFadeIn } from "../hooks/use-image-fade-in";
import { Loader } from "@/components/ai-elements/loader";
import { useRouter } from "next/navigation";
import demoLesson from "@/lessons.json";

interface LandingScreenProps {
  onCourseGenerated: (courseData: any) => void;
}

function LandingScreen({
  onCourseGenerated,
}: LandingScreenProps) {
  const router = useRouter();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [hasCourses, setHasCourses] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkCourses = () => {
      const courses = getStoredCourses();
      setHasCourses(courses.length > 0);
    };
    
    // Check on mount
    checkCourses();
    
    // Listen for storage changes (from other tabs)
    window.addEventListener("storage", checkCourses);
    
    return () => {
      window.removeEventListener("storage", checkCourses);
    };
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
      handleFileUpload(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const processFileUpload = async (file: File, apiKey: string) => {
    // Check file size as a rough proxy for page count (most PDFs are ~50-200KB per page)
    const estimatedPages = Math.ceil(file.size / (100 * 1024)); // Rough estimate
    if (estimatedPages > 100) {
      setError(
        `This PDF appears to be very large (~${estimatedPages} pages). We currently only support PDFs up to 100 pages. Please upload a shorter document.`
      );
      return;
    }

    try {
      // Store file in IndexedDB (avoids sessionStorage quota limits)
      await storePendingFile(file);
      // Redirect immediately to generating page
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

    // Check for API key
    const apiKey = getApiKey();
    if (!apiKey) {
      setError("Please add your Together AI API key first.");
      setPendingFile(file); // Store the file to upload after API key is saved
      setIsApiKeyDialogOpen(true);
      return;
    }

    // Process the file upload
    await processFileUpload(file, apiKey);
  };

  const handleApiKeySaved = () => {
    // If there's a pending file and an API key now exists, automatically start the upload
    if (pendingFile) {
      const apiKey = getApiKey();
      if (apiKey) {
        const fileToUpload = pendingFile;
        setPendingFile(null); // Clear pending file before starting upload
        setError(null); // Clear any error messages
        // Small delay to ensure dialog closes smoothly
        setTimeout(() => {
          processFileUpload(fileToUpload, apiKey);
        }, 100);
      } else {
        // Dialog was dismissed without saving - clear pending state
        setPendingFile(null);
        setError(null);
      }
    }
  };

  const handleTryDemo = () => {
    // Load the demo lesson and navigate to it
    const courseData = {
      title: demoLesson.title,
      modules: demoLesson.modules,
    } as any; // Type assertion - lessons.json matches the Course structure

    // Save to local storage
    const courseId = saveCourse(courseData);
    const courses = getStoredCourses();
    const course = courses.find((c) => c.id === courseId);

    if (course) {
      // Generate and set slug
      if (!course.slug) {
        const baseSlug = generateSlug(course.course.title, course.id);
        const existingSlugs = courses
          .map((c) => c.slug)
          .filter(Boolean) as string[];
        const slug = ensureUniqueSlug(baseSlug, existingSlugs);
        updateCourseSlug(courseId, slug);
        router.push(`/course/${slug}`);
      } else {
        router.push(`/course/${course.slug}`);
      }
    }
  };

  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const footerFadeIn = useImageFadeIn("/landing-footer-powered-by.svg");
  const imageRefs = {
    bg: useRef<HTMLImageElement>(null),
    logo: useRef<HTMLImageElement>(null),
    heroPowered: useRef<HTMLImageElement>(null),
    left: useRef<HTMLImageElement>(null),
    right: useRef<HTMLImageElement>(null),
  };

  const handleImageLoad = (imageName: string) => {
    setLoadedImages((prev) => new Set(prev).add(imageName));
  };

  const handleImageError = (imageName: string) => {
    // If image fails to load, still mark it as "loaded" so it doesn't stay invisible
    setLoadedImages((prev) => new Set(prev).add(imageName));
  };

  // Check if images are already loaded (for cached images)
  useEffect(() => {
    const checkImageLoaded = (ref: React.RefObject<HTMLImageElement | null>, imageName: string) => {
      if (ref.current && ref.current.complete && ref.current.naturalWidth > 0) {
        // Image is already loaded
        handleImageLoad(imageName);
      }
    };

    // Small delay to ensure refs are set
    setTimeout(() => {
      checkImageLoaded(imageRefs.bg, 'bg');
      checkImageLoaded(imageRefs.logo, 'logo');
      checkImageLoaded(imageRefs.heroPowered, 'hero-powered');
      checkImageLoaded(imageRefs.left, 'left');
      checkImageLoaded(imageRefs.right, 'right');
    }, 0);
  }, []);

  return (
    <div className="min-h-screen bg-white relative">
      {/* Background SVG */}
      <img 
        ref={imageRefs.bg}
        src="/landing-bg.svg" 
        alt="" 
        onLoad={() => handleImageLoad('bg')}
        onError={() => handleImageError('bg')}
        className={`fixed -bottom-40 left-0 w-full h-auto z-0 opacity-[0.08] blur-2xl transition-opacity duration-700 ease-out ${loadedImages.has('bg') ? 'opacity-[0.08]' : 'opacity-0'}`}
      />
      
      {/* API Key Dialog */}
      <ApiKeyDialog 
        open={isApiKeyDialogOpen} 
        onOpenChange={(open) => {
          setIsApiKeyDialogOpen(open);
          if (!open) {
            // When dialog closes, check if API key was saved and trigger upload
            handleApiKeySaved();
          }
        }}
      />
      
      {/* Header */}
      <header className="sticky top-0 z-50 border-b-[0.5px] border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img 
              ref={imageRefs.logo}
              src="/logo.svg" 
              alt="Logo"
              onLoad={() => handleImageLoad('logo')}
              onError={() => handleImageError('logo')}
              className={`h-6 w-auto transition-opacity duration-700 ease-out ${loadedImages.has('logo') ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
          <div className="flex items-center gap-4">
            {hasCourses && (
              <Link
                href="/courses"
                className="flex items-center justify-center h-10 px-4 bg-neutral-50 border border-neutral-200 rounded-full text-neutral-700 hover:text-neutral-900 transition-colors text-xs font-medium"
                aria-label="Courses"
              >
                Courses
              </Link>
            )}
            <button 
              onClick={() => setIsApiKeyDialogOpen(true)}
              className="flex items-center justify-center w-10 h-10 bg-neutral-50 border border-neutral-200 rounded-full text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer"
              aria-label="API Key"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-20">
        {/* Badge */}
        <div className="flex justify-center mb-12">
          <a 
            href="https://together.ai" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-block"
          >
            <img 
              ref={imageRefs.heroPowered}
              src="/landing-hero-powered-by.svg" 
              alt="Made & powered by together.ai"
              onLoad={() => handleImageLoad('hero-powered')}
              onError={() => handleImageError('hero-powered')}
              className={`h-auto transition-opacity duration-700 ease-out ${loadedImages.has('hero-powered') ? 'opacity-100' : 'opacity-0'}`}
            />
          </a>
        </div>

        {/* Hero Section */}
        <div className="text-center mb-16 relative">
          {/* Decorative elements */}
          <img 
            ref={imageRefs.left}
            src="/landing-left.svg" 
            alt="" 
            onLoad={() => handleImageLoad('left')}
            onError={() => handleImageError('left')}
            className={`hidden md:block absolute left-0 top-0 w-80 h-80 z-0 transition-opacity duration-700 ease-out ${loadedImages.has('left') ? 'opacity-100' : 'opacity-0'}`}
          />

          <img 
            ref={imageRefs.right}
            src="/landing-right.svg" 
            alt="" 
            onLoad={() => handleImageLoad('right')}
            onError={() => handleImageError('right')}
            className={`hidden md:block absolute right-0 top-0 w-80 h-80 z-0 transition-opacity duration-700 ease-out ${loadedImages.has('right') ? 'opacity-100' : 'opacity-0'}`}
          />

          <h1 className="relative text-7xl font-bold text-neutral-900 mb-6 leading-none font-[family-name:var(--font-fustat)] z-10">
            Make a tailored
            <br />
            course for you
          </h1>
          <p className="relative text-xl text-neutral-700 mb-12 font-medium leading-tight font-[family-name:var(--font-fustat)] z-10">
            Upload any materials to generate
            <br />a personalized course!
          </p>

          {/* Upload Area */}
          <div className="max-w-2xl mx-auto space-y-6">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-3xl p-8 md:p-16 transition-all backdrop-blur-sm min-h-[200px] flex flex-col items-center justify-center ${
                isDragging
                  ? "border-blue-500 bg-blue-50/80"
                  : isProcessing
                  ? "border-blue-500 bg-blue-50/80"
                  : error
                  ? "border-red-500 bg-red-50/80"
                  : "border-neutral-300 bg-white/80"
              } ${!isProcessing ? "cursor-pointer" : ""}`}
            >
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <Loader size={32} className="mb-4 text-blue-500 [animation-duration:0.6s]" />
                  <p className="text-neutral-700 font-medium">{progress}</p>
                  <p className="text-sm text-neutral-500 mt-2">
                    This may take a few minutes...
                  </p>
                </div>
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    disabled={isProcessing}
                  />
                  <label
                    htmlFor="file-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="mb-4 px-6 py-3 bg-neutral-900 text-white rounded-full font-medium hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isProcessing}
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      Upload a PDF
                    </button>
                    <p className="text-sm text-neutral-500">
                      Or drag-and-drop here
                    </p>
                  </label>

                  {error && (
                    <div className="w-full mt-6 p-4 md:p-5 bg-red-100 border border-red-300 rounded-xl">
                      <p className="text-red-700 text-sm md:text-base leading-relaxed text-center">{error}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Demo Button */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-neutral-200"></div>
              <span className="text-sm text-neutral-500 font-medium">or</span>
              <div className="flex-1 h-px bg-neutral-200"></div>
            </div>

            <button
              onClick={handleTryDemo}
              disabled={isProcessing}
              className="w-full px-6 py-4 bg-white border-2 border-neutral-200 text-neutral-900 rounded-2xl font-medium hover:bg-neutral-50 hover:border-neutral-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Try Demo Course
              </div>
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-4 left-4 z-10">
        <a 
          href="https://together.ai" 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-block"
        >
          <img 
            ref={footerFadeIn.imgRef}
            src="/landing-footer-powered-by.svg" 
            alt="Powered by together.ai"
            onLoad={footerFadeIn.handleLoad}
            onError={footerFadeIn.handleError}
            className={`h-auto transition-opacity duration-700 ease-out ${footerFadeIn.isLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </a>
      </footer>

      {/* Social Icons */}
      <div className="fixed bottom-4 right-4 flex items-center gap-3 z-10">
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
            href="https://x.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 bg-neutral-50 border border-neutral-200 rounded-full text-neutral-700 hover:text-neutral-900 transition-colors"
            aria-label="X (Twitter)"
          >
            <Twitter className="w-4 h-4" />
          </a>
      </div>
    </div>
  );
}

export { LandingScreen };
