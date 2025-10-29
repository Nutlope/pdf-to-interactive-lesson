import { writeFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import axios from "axios";
import { put } from "@vercel/blob";
import { ocr } from "./ocr";
import { createCourse } from "./create-course";
import type { Course } from "@/app/hooks/use-course-navigation";

export interface ProgressCallback {
  (type: string, message: string, data?: any): void;
}

export interface GenerateCourseOptions {
  file?: File;
  url?: string;
  onProgress?: ProgressCallback;
}

export interface GenerateCourseResult {
  course?: Course; // Optional if stored in Blob
  courseUrl?: string; // Blob URL if course is too large
  metadata: {
    generationTime: string;
    ocrTime: string;
    courseTime: string;
    modulesCount: number;
    lessonsCount: number;
    pages: number;
    tokens: number;
  };
}

/**
 * Generate a course from a PDF file or URL
 * @param options - Configuration options including file/URL and progress callback
 * @returns Course data and metadata
 */
export async function generateCourseFromPdf(
  options: GenerateCourseOptions
): Promise<GenerateCourseResult> {
  const { file, url, onProgress } = options;
  let tempFilePath: string | null = null;
  let isTemp = false;

  try {
    // Check for API key
    if (!process.env.TOGETHER_API_KEY) {
      throw new Error("TOGETHER_API_KEY not configured");
    }

    // Validate input
    if (!file && !url) {
      throw new Error("Either 'file' or 'url' must be provided");
    }

    onProgress?.("init", "Initializing...");

    // Handle URL
    if (url) {
      onProgress?.("download", "Downloading PDF from URL...");
      console.log(`📄 Processing URL: ${url}`);

      // Download to /tmp (serverless-compatible)
      const response = await axios({
        method: "GET",
        url,
        responseType: "arraybuffer",
      });

      const buffer = Buffer.from(response.data);
      tempFilePath = `/tmp/download-${Date.now()}.pdf`;
      await writeFile(tempFilePath, buffer);
      isTemp = true;
      console.log(`✅ Downloaded to ${tempFilePath}`);
    }
    // Handle file upload
    else if (file) {
      onProgress?.("upload", `Processing uploaded file: ${file.name}`);
      console.log(`📄 Processing uploaded file: ${file.name}`);

      // Save to /tmp for processing
      // Using /tmp makes it serverless-compatible (Vercel, Netlify, etc.)
      const timestamp = Date.now();
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      tempFilePath = `/tmp/upload-${timestamp}.pdf`;
      await writeFile(tempFilePath, buffer);
      isTemp = true;
      console.log(`✅ Saved to temp: ${tempFilePath}`);
    }

    if (!tempFilePath) {
      throw new Error("Failed to process file");
    }

    // Extract content from PDF
    onProgress?.("ocr", "Extracting text from PDF using OCR...");
    console.log("🔍 Extracting content...");
    const ocrStartTime = Date.now();

    const result = await ocr(tempFilePath, {
      maintainFormat: false,
      concurrency: 5,
      cleanup: true,
    });

    const content = result.pages.map((p) => p.content).join("\n\n");
    const ocrElapsed = ((Date.now() - ocrStartTime) / 1000).toFixed(2);

    onProgress?.("ocr-complete", `OCR completed in ${ocrElapsed}s`, {
      pages: result.pages.length,
      tokens: result.inputTokens,
    });

    // Generate course
    onProgress?.("generate-modules", "Generating course modules...");
    console.log("🤖 Generating course...");
    const courseStartTime = Date.now();

    const course = await createCourse({
      content,
      validateStructure: true,
      validateContent: true,
      retryFailures: true,
      maxRetries: 3,
    });

    const courseElapsed = ((Date.now() - courseStartTime) / 1000).toFixed(2);

    onProgress?.(
      "generate-lessons",
      `Generated ${course.modules.length} modules with lessons`
    );

    // Cleanup temp file
    if (isTemp && tempFilePath && existsSync(tempFilePath)) {
      await unlink(tempFilePath);
      console.log("🧹 Cleaned up temporary file");
    }

    // Calculate total time
    const totalElapsed = (
      (Date.now() - ocrStartTime + Date.now() - courseStartTime) /
      1000
    ).toFixed(2);

    const metadata = {
      generationTime: `${totalElapsed}s`,
      ocrTime: `${ocrElapsed}s`,
      courseTime: `${courseElapsed}s`,
      modulesCount: course.modules.length,
      lessonsCount: course.modules.reduce(
        (sum, mod) => sum + mod.lessons.length,
        0
      ),
      pages: result.pages.length,
      tokens: result.inputTokens,
    };

    // Check if course JSON is too large for direct response
    const courseJson = JSON.stringify(course);
    const courseSizeInMB =
      Buffer.byteLength(courseJson, "utf8") / (1024 * 1024);

    // If course is larger than 2MB, store in Blob (Vercel limit is 4.5MB, leave buffer)
    if (courseSizeInMB > 2) {
      onProgress?.(
        "storing",
        `Course is large (${courseSizeInMB.toFixed(2)}MB), storing in cloud...`
      );
      console.log(
        `📦 Course is ${courseSizeInMB.toFixed(2)}MB, storing in Blob`
      );

      const blob = await put(`courses/${Date.now()}-course.json`, courseJson, {
        access: "public",
        addRandomSuffix: true,
        contentType: "application/json",
      });

      console.log(`✅ Course stored at: ${blob.url}`);

      return {
        courseUrl: blob.url,
        metadata,
      };
    }

    // Course is small enough, return directly
    return {
      course: course as Course,
      metadata,
    };
  } catch (error) {
    // Cleanup temp file on error
    if (isTemp && tempFilePath && existsSync(tempFilePath)) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        console.error("Failed to cleanup temp file:", cleanupError);
      }
    }

    throw error;
  }
}
