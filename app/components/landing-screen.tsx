"use client";

import { useState } from "react";

interface LandingScreenProps {
  onStartCourse: () => void;
  onCourseGenerated: (courseData: any) => void;
}

function LandingScreen({
  onStartCourse,
  onCourseGenerated,
}: LandingScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

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

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith(".pdf")) {
      setError("Please upload a PDF file");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress("Uploading PDF...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/generate-course", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to generate course");
      }

      // Read the streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete JSON objects (separated by newlines)
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            if (event.type === "error") {
              throw new Error(event.error);
            } else if (event.type === "complete") {
              // Check if course was stored in Blob or returned directly
              if (event.data.courseUrl) {
                // Large course stored in Blob, fetch it
                setProgress("Downloading course data...");
                const courseResponse = await fetch(event.data.courseUrl);
                if (!courseResponse.ok) {
                  throw new Error("Failed to fetch course from storage");
                }
                const courseData = await courseResponse.json();
                setProgress("Course loaded successfully!");
                onCourseGenerated(courseData);
              } else if (event.data.course) {
                // Small course returned directly
                setProgress("Course generated successfully!");
                onCourseGenerated(event.data.course);
              } else {
                throw new Error("No course data received");
              }
              return;
            } else {
              // Update progress with the message
              setProgress(event.message);
            }
          } catch (parseError) {
            console.error("Failed to parse event:", line, parseError);
          }
        }
      }
    } catch (err) {
      console.error("Error generating course:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate course"
      );
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-gray-700 hover:text-gray-900 font-medium">
              Login
            </button>
            <button className="px-5 py-2 bg-gray-900 text-white rounded-full font-medium hover:bg-gray-800 transition-colors">
              Sign Up
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-20">
        {/* Badge */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full shadow-sm">
            <span className="text-sm text-gray-600">Made & powered by</span>
            <span className="text-sm font-semibold text-gray-900">
              together.ai
            </span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="text-center mb-16 relative">
          {/* Decorative elements */}
          <div className="absolute left-0 top-0 w-64 h-64 opacity-50">
            <div className="absolute left-12 top-8">
              <div className="w-12 h-12 bg-orange-400 rounded-lg flex items-center justify-center text-white font-bold text-xs transform -rotate-12">
                PDF
              </div>
            </div>
            <div className="absolute left-28 top-24">
              <div className="w-16 h-16 bg-red-400 rounded-full flex items-center justify-center transform rotate-12">
                <div className="text-3xl">💡</div>
              </div>
            </div>
            <div className="absolute left-4 top-40">
              <div className="w-8 h-8 bg-green-400 rounded-full"></div>
            </div>
          </div>

          <div className="absolute right-0 top-0 w-64 h-64 opacity-50">
            <div className="absolute right-12 top-12">
              <div className="w-24 h-24 bg-yellow-300 rounded-3xl flex items-center justify-center transform rotate-6">
                <div className="text-4xl">📋</div>
              </div>
            </div>
            <div className="absolute right-32 top-32">
              <div className="w-12 h-12 bg-green-400 rounded-2xl flex items-center justify-center text-white text-xl">
                💬
              </div>
            </div>
            <div className="absolute right-8 top-56">
              <div className="w-10 h-10 bg-emerald-400 rounded-lg flex items-center justify-center text-white text-lg">
                ↑
              </div>
            </div>
          </div>

          <h1 className="text-6xl font-bold text-gray-900 mb-6 leading-tight">
            Make a tailored
            <br />
            course for you
          </h1>
          <p className="text-xl text-gray-600 mb-12">
            Upload any materials to generate
            <br />a personalized course!
          </p>

          {/* Upload Area */}
          <div className="max-w-2xl mx-auto">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-3xl p-16 transition-all ${
                isDragging
                  ? "border-blue-500 bg-blue-50"
                  : isProcessing
                  ? "border-blue-500 bg-blue-50"
                  : error
                  ? "border-red-500 bg-red-50"
                  : "border-gray-300 bg-white/50"
              }`}
            >
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <div className="mb-4 w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-gray-700 font-medium">{progress}</p>
                  <p className="text-sm text-gray-500 mt-2">
                    This may take a few minutes...
                  </p>
                </div>
              ) : (
                <>
                  <input
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
                      className="mb-4 px-6 py-3 bg-gray-900 text-white rounded-full font-medium hover:bg-gray-800 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <p className="text-sm text-gray-500">
                      Or drag-and-drop here
                    </p>
                  </label>

                  {error && (
                    <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-lg">
                      <p className="text-red-700 text-sm">{error}</p>
                    </div>
                  )}

                  {/* Demo button */}
                  <div className="mt-8">
                    <button
                      onClick={onStartCourse}
                      className="text-sm text-blue-600 hover:text-blue-700 underline"
                    >
                      Try demo course
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-4 left-4 text-xs text-gray-500">
        Powered by <span className="font-semibold">together.ai</span>
      </footer>
    </div>
  );
}

export { LandingScreen };
