import { generateText, APICallError, RetryError } from "ai";
import {
  QuestionType,
  type Module,
  type Lesson,
  type MultipleChoiceLesson,
  type ModuleWithLessons,
  type LessonResult,
  type FailedLesson,
  type FlowConfig,
  type SimpleEdge,
  type FlowDiagramLesson,
} from "./types";
import {
  standardLessonsSchema,
  singleLessonSchema,
  flowAnalysisSchema,
  flowQuestionSchema,
  validationResultSchema,
} from "./schemas";
import {
  createTogetherClient,
  DEFAULT_MODEL,
  getTogetherProviderOptions,
} from "./utils/together";
import { parseJSON } from "./utils/json";

export interface LessonProgressCallback {
  (type: string, message: string, data?: any): void;
}

export interface CreateLessonsInput {
  module: Module;
  content: string;
  apiKey: string;
  model?: string;
  validateStructure?: boolean; // Kept for API compat — Zod now handles this
  validateContent?: boolean;
  retryFailures?: boolean;
  maxRetries?: number;
  onProgress?: LessonProgressCallback;
  /** Questions already generated in previous modules — avoid duplicating these */
  previousQuestions?: string[];
  /** All module titles in the course — helps focus questions on this module's scope */
  allModuleTitles?: string[];
}

export interface ValidateLessonInput {
  lesson: Lesson;
  moduleTitle: string;
  content: string;
  apiKey: string;
  model?: string;
}

export interface ValidationResult {
  isValid: boolean;
  explanation: string;
  issues?: {
    content?: string;
    question?: string;
    answer?: string;
    choices?: string;
  };
}

/**
 * Ensures every lesson has a non-empty `info` field. MiniMax intermittently
 * drops this field; rather than fail the entire module, we derive it from the
 * first sentence of the lesson content.
 */
function ensureInfo(lesson: any): any {
  if (!lesson.info || typeof lesson.info !== "string" || lesson.info.trim() === "") {
    const content: string = lesson.content ?? "";
    const match = content.match(/^[^.!?\n]+[.!?]/);
    lesson.info = match ? match[0].trim() : content.substring(0, 120).trim();
  }
  return lesson;
}

/**
 * Sorts the 3 generated lessons into canonical order:
 *   [0] short-answer, [1] true-false, [2] multiple-choice.
 * The model occasionally emits them in a different order; rather than fail,
 * we accept any order and reorder here.
 */
function sortLessonsByType(lessons: any[]): any[] {
  const order: Record<string, number> = {
    "short-answer": 0,
    "true-false": 1,
    "multiple-choice": 2,
  };
  return [...lessons].sort((a, b) => {
    const ao = order[a.questionType] ?? 99;
    const bo = order[b.questionType] ?? 99;
    return ao - bo;
  });
}

/**
 * Shuffles multiple-choice options in-place and updates the answer index.
 * The prompt instructs the model to always place the correct answer at index 0,
 * so we use choices[0] as the source of truth regardless of what answer index
 * the model outputs. This eliminates wrong-index errors.
 */
function shuffleMultipleChoice(lesson: any): void {
  const choices = lesson.choices as (string | number)[];
  const correctChoice = choices[0];

  // Fisher-Yates shuffle
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }

  // Update the answer index to where the correct choice ended up
  lesson.answer = choices.indexOf(correctChoice);
}

export async function createLessons({
  module,
  content,
  apiKey,
  model = DEFAULT_MODEL,
  validateContent = true,
  onProgress,
  previousQuestions = [],
  allModuleTitles = [],
}: CreateLessonsInput): Promise<ModuleWithLessons> {
  onProgress?.("lesson-start", `Generating lessons for "${module.title}"...`);
  const together = createTogetherClient(apiKey);
  const providerOptions = getTogetherProviderOptions(model);

  // Build deduplication context for the prompt
  const moduleContext = allModuleTitles.length > 0
    ? `\nThis course has ${allModuleTitles.length} modules:\n${allModuleTitles.map((t, i) => `${i + 1}. "${t}"`).join("\n")}\nYou are generating lessons ONLY for module "${module.title}". Focus your questions on topics and facts unique to this module's scope. Do NOT cover topics that belong to the other modules.\n`
    : "";

  const dedupContext = previousQuestions.length > 0
    ? `\nIMPORTANT — AVOID DUPLICATE QUESTIONS: The following questions have already been used in other modules of this course. You MUST NOT ask the same or similar questions. Each question must test a DIFFERENT fact or concept.\nThis means: do NOT ask about the same topic even with different wording. For example, if a previous question asks about "continued pretraining phases", do NOT ask another question about continued pretraining phases in different words.\nAlready used:\n${previousQuestions.map((q, i) => `${i + 1}. "${q}"`).join("\n")}\n`
    : "";

  const standardLessonPrompt = `Analyse the following content and create 3 lessons for the module "${module.title}".
Respond ONLY with a JSON object. No other text.

CRITICAL: Every fact, claim, and detail in your lessons MUST come directly from the source content below. Do NOT infer, elaborate, or add information not explicitly stated in the source. Do NOT reference the source as "the article", "the passage", or "the brief" — write as if the lesson stands alone.
${moduleContext}${dedupContext}
Each lesson must be SELF-SUFFICIENT: the "content" field must teach the specific facts needed to answer its own question. A student who only sees that lesson content should have enough information to answer correctly.

You must create exactly ONE lesson for EACH question type:
1. "short-answer" - answer is a text string. The answer must be a fact EXPLICITLY stated in the source content. Do NOT ask about exact URLs, code snippets, or strings that may have formatting issues. Do NOT embed unverified claims or translations in the question itself — only state facts from the source. The lesson content must explicitly include the answer-bearing fact, not just surrounding context.
2. "true-false" - answer is true or false (boolean). The statement MUST be clearly and unambiguously true or false based solely on the source content. Avoid nuanced, debatable, or misleading phrasing. Do NOT use double negatives. Do NOT paraphrase the source in a way that subtly changes meaning.
3. "multiple-choice" - answer is ALWAYS 0. Put the CORRECT answer as the FIRST choice (index 0), then 3 wrong choices. The correct answer AND all distractor choices must be grounded in or directly related to the source content. Do NOT invent plausible-sounding facts for distractors. The lesson content must include enough specific detail to distinguish the correct choice from the distractors. Do NOT write negation-based questions such as "Which is NOT...", "Which is NOT mentioned...", "All of the following EXCEPT...", or any question where the student must pick the absent option.

Content-writing rules:
- Write 4-6 sentences, not 2-3.
- Include the exact names, numbers, categories, or sequence labels needed for the question when the question depends on them.
- Avoid vague summaries. If a question asks "which", "what percentage", "what order", or "which technique", the content must explicitly mention the relevant compared items.
- For multiple-choice, mention the distinguishing detail that makes the correct option correct.
- For multiple-choice, ask for the supported/correct option, not the unsupported option.
- Write the content first, then derive the question from that content.

Return this exact JSON structure:
{
  "lessons": [
    {
      "title": "Lesson Title",
      "content": "Lesson content, 4-6 sentences long and sufficient to answer the question.",
      "info": "A quick one sentence key fact",
      "question": "A question to test understanding",
      "questionType": "short-answer",
      "answer": "The answer text"
    },
    {
      "title": "Lesson Title",
      "content": "Lesson content, 4-6 sentences long and sufficient to answer the question.",
      "info": "A quick one sentence key fact",
      "question": "A true or false statement",
      "questionType": "true-false",
      "answer": true
    },
    {
      "title": "Lesson Title",
      "content": "Lesson content, 4-6 sentences long and sufficient to answer the question.",
      "info": "A quick one sentence key fact",
      "question": "A multiple choice question",
      "questionType": "multiple-choice",
      "answer": 0,
      "choices": ["Correct answer", "Wrong option B", "Wrong option C", "Wrong option D"],
      "explanation": "Why the correct answer is right"
    }
  ]
}

For numeric questions, choices can be numbers: [88.3, 91.7, 92.7, 95.0]

Content:
${content}`;

  // Start both standard lesson generation and flow generation concurrently
  const standardLessonsPromise = generateText({
    model: together(model),
    providerOptions,
    prompt: standardLessonPrompt,
  });

  const flowGenerationPromise = generateFlowDiagram({
    moduleTitle: module.title,
    content,
    apiKey,
    model,
    previousQuestions,
  });

  // Wait for both to complete
  const [result, flowResult] = await Promise.all([
    standardLessonsPromise,
    flowGenerationPromise,
  ]);

  // Start flow question generation early
  const flowQuestionPromise =
    flowResult?.hasFlow && flowResult.flowConfig
      ? generateFlowQuestion({
          flowConfig: flowResult.flowConfig,
          moduleTitle: module.title,
          content,
          apiKey,
          model,
          previousQuestions,
        })
      : Promise.resolve(null);

  // Parse JSON and validate with Zod, retrying on structural failures (truncation, wrong types)
  // Wraps parseJSON so JSON parse errors trigger retry the same way Zod errors do.
  const maxStructureRetries = 5;

  function tryParse(text: string):
    | { ok: true; data: any }
    | { ok: false; error: string } {
    try {
      const parsed = parseJSON(text);
      const validated = standardLessonsSchema.safeParse(parsed);
      if (validated.success) return { ok: true, data: validated };
      return {
        ok: false,
        error: validated.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n  • "),
      };
    } catch (err: any) {
      return { ok: false, error: `JSON parse failed: ${err.message}` };
    }
  }

  let parseResult = tryParse(result.text);
  let lastError = parseResult.ok ? "" : parseResult.error;

  for (let attempt = 1; attempt <= maxStructureRetries && !parseResult.ok; attempt++) {
    console.warn(
      `  ⚠️  Validation failed for "${module.title}" (attempt ${attempt}/${maxStructureRetries}):\n  • ${lastError}`
    );

    // Put the corrective feedback at the TOP so the model sees it first,
    // then the full standard prompt below.
    const retryPrompt = `YOUR PREVIOUS RESPONSE FAILED VALIDATION. READ THIS CAREFULLY BEFORE YOU RESPOND.

Errors from your previous attempt:
  • ${lastError}

MANDATORY RULES — do not violate any of these:
1. Respond with ONLY a JSON object. No prose, no markdown fences, no trailing text.
2. The root object has ONE key: "lessons" — an array of EXACTLY 3 objects, in this EXACT order:
     [0] { "title", "content", "info", "question", "questionType": "short-answer",   "answer": <string> }
     [1] { "title", "content", "info", "question", "questionType": "true-false",     "answer": <boolean true or false — NOT a string, NOT a number> }
     [2] { "title", "content", "info", "question", "questionType": "multiple-choice", "answer": 0, "choices": [<4 strings or numbers>], "explanation": <string> }
3. EVERY lesson MUST include the "info" field — a one-sentence key fact. Do NOT omit it.
4. Do NOT include more than 3 lessons. Do NOT include fewer than 3 lessons.
5. Do NOT swap the order of question types. Short-answer FIRST, true-false SECOND, multiple-choice THIRD.
6. Ensure the JSON is syntactically valid: balanced braces, balanced brackets, commas between fields, double-quoted keys and strings.

Now generate the corrected response following all of the instructions below.

──────────────────────────────────────────────────────

${standardLessonPrompt}`;

    const retryResult = await generateText({
      model: together(model),
      providerOptions,
      prompt: retryPrompt,
    });
    parseResult = tryParse(retryResult.text);
    if (!parseResult.ok) lastError = parseResult.error;
  }

  if (!parseResult.ok) {
    console.error(`Validation failed for module "${module.title}" after ${maxStructureRetries} retries:\n  • ${lastError}`);
    throw new Error(`Structured output validation failed after ${maxStructureRetries} retries: ${lastError}`);
  }

  const validated = parseResult.data as { success: true; data: { lessons: any[] } };

  // Track failures by lesson index
  const failuresByIndex = new Map<number, FailedLesson>();
  // Normalize: clone, sort into canonical order, and fill in any missing `info` fields.
  const lessons: any[] = sortLessonsByType(
    validated.data.lessons.map((lesson) => ensureInfo({ ...lesson }))
  );

  // Shuffle multiple-choice options so the correct answer isn't always first
  for (const lesson of lessons) {
    if (lesson.questionType === "multiple-choice" && Array.isArray(lesson.choices) && lesson.choices.length === 4) {
      shuffleMultipleChoice(lesson);
    }
  }

  // Reject true-false questions that are actually open-ended (asking "which", "what", etc.)
  const openEndedPattern = /\b(which|what|who|where|when|how|why|name|list|describe|explain)\b.*\?$/i;
  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    if (lesson.questionType === "true-false" && openEndedPattern.test(lesson.question)) {
      console.error(`  ❌ True-false question is open-ended, rejecting: "${lesson.question.substring(0, 80)}..."`);
      failuresByIndex.set(i, {
        success: false,
        data: lesson,
        error: {
          validationType: "content",
          reason: "True-false question must be a statement, not an open-ended question. Rewrite as a clear declarative statement that can be judged true or false.",
          details: [`Question "${lesson.question}" contains interrogative wording incompatible with true-false format.`],
        },
      });
    }
  }

  // Reject multiple-choice questions that use negation (e.g. "Which is NOT...")
  const negationPattern = /\bNOT\b|\bEXCEPT\b/;
  for (let i = 0; i < lessons.length; i++) {
    if (failuresByIndex.has(i)) continue;
    const lesson = lessons[i];
    if (lesson.questionType === "multiple-choice" && negationPattern.test(lesson.question)) {
      console.error(`  ❌ Multiple-choice uses negation, rejecting: "${lesson.question.substring(0, 80)}..."`);
      failuresByIndex.set(i, {
        success: false,
        data: lesson,
        error: {
          validationType: "content",
          reason: "Multiple-choice questions must not use negation (NOT, EXCEPT). Ask for the correct/supported option instead.",
          details: [`Question "${lesson.question}" uses negation wording.`],
        },
      });
    }
  }

  // Run LLM-based content validation if requested (concurrently)
  if (validateContent) {
    const validationPromises = lessons.map(async (lesson: any, i: number) => {
      try {
        const validation = await validateLesson({
          lesson,
          moduleTitle: module.title,
          content,
          apiKey,
          model,
        });
        return { index: i, lesson, validation };
      } catch (error: any) {
        if (RetryError.isInstance(error) || APICallError.isInstance(error)) {
          console.warn(`  ⚠️  Lesson "${lesson.title}" validation temporarily unavailable - skipping`);
          return { index: i, lesson, validation: null };
        }
        console.warn(`  ⚠️  Lesson "${lesson.title}" validation error - skipping`);
        return { index: i, lesson, validation: null };
      }
    });

    const validationResults = await Promise.all(validationPromises);

    for (const { index, lesson, validation } of validationResults) {
      if (!validation) continue;
      if (!validation.isValid) {
        const details: string[] = [validation.explanation];
        if (validation.issues) {
          Object.entries(validation.issues).forEach(([field, issue]) => {
            details.push(`[${field}] ${issue}`);
          });
        }
        failuresByIndex.set(index, {
          success: false,
          data: lesson,
          error: { validationType: "content", reason: validation.explanation, details },
        });
        console.error(`  ❌ Lesson "${lesson.title}" failed content validation: ${validation.explanation}`);
      }
    }
  }

  // Get flow lesson (was started earlier in parallel)
  const flowLesson = await flowQuestionPromise;

  if (flowLesson) {
    if (validateContent) {
      try {
        const validation = await validateLesson({
          lesson: flowLesson,
          moduleTitle: module.title,
          content,
          apiKey,
          model,
        });
        if (validation.isValid) {
          lessons.push(flowLesson);
        } else {
          console.error(`  ❌ Flow lesson "${flowLesson.title}" failed validation`);
          const flowIndex = lessons.length;
          failuresByIndex.set(flowIndex, {
            success: false,
            data: flowLesson,
            error: { validationType: "content", reason: validation.explanation, details: [validation.explanation] },
          });
          lessons.push(flowLesson);
        }
      } catch {
        lessons.push(flowLesson);
      }
    } else {
      lessons.push(flowLesson);
    }
  }

  // Retry failed lessons (simple single-pass regeneration)
  if (failuresByIndex.size > 0) {
    const fixPromises = Array.from(failuresByIndex.entries()).map(
      async ([index, failed]) => {
        try {
          const fixResult = await generateText({
            model: together(model),
            providerOptions,
            prompt: `Fix this lesson that failed validation. The problem was:
${failed.error.reason}
${failed.error.details?.join("\n") || ""}

IMPORTANT: All facts must come ONLY from the source content. Do NOT infer or add information not in the source.
The corrected lesson must be SELF-SUFFICIENT: its content must include the specific facts needed to answer its own question. If the question depends on names, numbers, categories, techniques, or an order of steps, explicitly include those in the content.

Module: "${module.title}"
Original lesson: ${JSON.stringify(failed.data, null, 2)}

Source content:
${content}

Generate a corrected version. Respond ONLY with JSON matching this structure:
${failed.data.questionType === "short-answer" ? '{"title":"...","content":"...","info":"...","question":"...","questionType":"short-answer","answer":"..."}' : ""}
${failed.data.questionType === "true-false" ? '{"title":"...","content":"...","info":"...","question":"...","questionType":"true-false","answer":true}' : ""}
${failed.data.questionType === "multiple-choice" ? '{"title":"...","content":"...","info":"...","question":"...","questionType":"multiple-choice","answer":0,"choices":["Correct answer","Wrong B","Wrong C","Wrong D"],"explanation":"..."}' : ""}`,
          });
          const parsed = parseJSON(fixResult.text);
          const revalidated = singleLessonSchema.safeParse(parsed);
          if (revalidated.success) {
            const fixed = ensureInfo({ ...revalidated.data });
            if (fixed.questionType === "multiple-choice" && Array.isArray(fixed.choices) && fixed.choices.length === 4) {
              shuffleMultipleChoice(fixed);
            }
            // Re-check deterministic rules on retried lesson
            if (fixed.questionType === "multiple-choice" && negationPattern.test(fixed.question)) {
              console.error(`  ❌ Retried lesson still uses negation, keeping failure: "${fixed.question.substring(0, 80)}..."`);
              return; // keep original failure
            }
            lessons[index] = fixed;
            failuresByIndex.delete(index);
          }
        } catch {
          // Fix failed — keep original failure
        }
      }
    );
    await Promise.all(fixPromises);
  }

  // Build final results
  const lessonResults: LessonResult[] = lessons.map((lesson: any, index: number) => {
    const failure = failuresByIndex.get(index);
    return failure || { success: true, data: lesson };
  });

  const moduleResult = { title: module.title, lessons: lessonResults };
  const successfulCount = lessonResults.filter((r) => r.success).length;

  onProgress?.(
    "lesson-complete",
    `Completed "${module.title}" (${successfulCount}/${lessonResults.length} lessons)`,
    { moduleTitle: module.title, successful: successfulCount, total: lessonResults.length }
  );

  return moduleResult;
}

function topologicalSort(flowConfig: FlowConfig): string[] {
  const { nodes, edges } = flowConfig;
  const ids = nodes.map((n) => n.id);
  const inDegree = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, [] as string[]]));

  for (const [from, to] of edges) {
    adj.get(from)?.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue = ids.filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of adj.get(current) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  return order;
}

/**
 * Analyzes module content for flow/process diagrams.
 */
async function generateFlowDiagram({
  moduleTitle,
  content,
  apiKey,
  model = DEFAULT_MODEL,
  previousQuestions = [],
}: {
  moduleTitle: string;
  content: string;
  apiKey: string;
  model?: string;
  previousQuestions?: string[];
}): Promise<{ hasFlow: boolean; flowConfig?: FlowConfig } | null> {
  const together = createTogetherClient(apiKey);
  const providerOptions = getTogetherProviderOptions(model);

  const flowDedupContext = previousQuestions.length > 0
    ? `\nIMPORTANT: The following questions have already been used in earlier modules. You must find a DIFFERENT process or flow unique to this module's topic "${moduleTitle}". Do NOT model the same process already covered.\nAlready used questions:\n${previousQuestions.map((q, i) => `${i + 1}. "${q}"`).join("\n")}\n`
    : "";

  try {
    const result = await generateText({
      model: together(model),
      providerOptions,
      prompt: `Analyze the following content for the module "${moduleTitle}".
Determine if this content describes a PROCESS, SYSTEM, or SEQUENTIAL FLOW suitable for a flow diagram.
Only include processes and steps that are EXPLICITLY described in the source content. Do NOT invent or infer steps.
The flow MUST be specific to the topic of this module ("${moduleTitle}") — not a general overview of the entire document.
${flowDedupContext}

Good candidates: step-by-step processes, system architectures, cause-and-effect chains, workflows, state transitions.

Respond ONLY with JSON. No other text.

If suitable:
{
  "hasFlow": true,
  "nodes": [
    {"id": "step-1", "label": "First Step", "type": "start"},
    {"id": "step-2", "label": "Process Step", "type": "process"},
    {"id": "step-3", "label": "Final Output", "type": "output"}
  ],
  "edges": [["step-1", "step-2"], ["step-2", "step-3"]]
}

If NOT suitable:
{"hasFlow": false, "nodes": [], "edges": []}

Node types: "start" (1 only), "process" (steps), "output" (terminal).
Keep labels concise (2-5 words). Use 4-8 nodes. Each id must be unique.

Content:
${content}`,
    });

    const parsed = parseJSON(result.text);
    const validated = flowAnalysisSchema.safeParse(parsed);

    if (!validated.success) {
      return { hasFlow: false };
    }

    const { hasFlow, nodes, edges } = validated.data;
    if (!hasFlow || nodes.length === 0) {
      return { hasFlow: false };
    }

    return {
      hasFlow: true,
      flowConfig: {
        nodes: nodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
        edges: edges as SimpleEdge[],
      },
    };
  } catch (error) {
    console.error(`  ❌ Error generating flow diagram for "${moduleTitle}":`, error);
    return { hasFlow: false };
  }
}

/**
 * Generates a drag-drop ordering question from a flow diagram.
 */
async function generateFlowQuestion({
  flowConfig,
  moduleTitle,
  content,
  apiKey,
  model = DEFAULT_MODEL,
  previousQuestions = [],
}: {
  flowConfig: FlowConfig;
  moduleTitle: string;
  content: string;
  apiKey: string;
  model?: string;
  previousQuestions?: string[];
}): Promise<FlowDiagramLesson | null> {
  const together = createTogetherClient(apiKey);
  const providerOptions = getTogetherProviderOptions(model);
  const nodeLabels = flowConfig.nodes.map((n) => n.label);

  const flowQDedupContext = previousQuestions.length > 0
    ? `\nIMPORTANT — AVOID DUPLICATE QUESTIONS: These questions already exist in other modules. Your question MUST ask about a DIFFERENT process or aspect. Do NOT rephrase an existing question.\nAlready used:\n${previousQuestions.map((q, i) => `${i + 1}. "${q}"`).join("\n")}\n`
    : "";

  const flowQuestionPrompt = `Given this flow diagram for the module "${moduleTitle}", create a drag-and-drop ordering question.

Flow nodes: ${nodeLabels.map((l, i) => `${i + 1}. ${l}`).join(", ")}
${flowQDedupContext}

Respond ONLY with JSON:
{
  "title": "Lesson Title",
  "content": "A 4-6 sentence explanation of the process that explicitly names the steps used in the ordering question",
  "info": "One key fact about this process",
  "question": "What is the correct order of steps in [specific process name]?",
  "stepsInOrder": ["First step", "Second step", "Third step"]
}

Rules:
- Select 3 important sequential nodes from the flow
- stepsInOrder = 3 node labels listed in their CORRECT chronological order (first step first, last step last)
- The question MUST be specific to this process — mention the actual process or topic by name. Do NOT use generic phrasing like "Put the following steps in the correct order"
- The content MUST explicitly mention all 3 selected step names and make their order clear enough that a student can solve the question from the content alone.
- All content, info, and question text must come from the source content. Do NOT add facts not in the source.

Source content:
${content}`;

  // Parses the model's flow question response, returning a typed result so
  // JSON parse errors and Zod errors are both handled by the retry loop.
  function tryParseFlowQuestion(
    text: string
  ): { ok: true; data: any } | { ok: false; error: string } {
    try {
      const parsed = parseJSON(text);
      const validated = flowQuestionSchema.safeParse(parsed);
      if (validated.success) return { ok: true, data: validated.data };
      return {
        ok: false,
        error: validated.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n  • "),
      };
    } catch (err: any) {
      return { ok: false, error: `JSON parse failed: ${err.message}` };
    }
  }

  try {
    const maxFlowRetries = 3;
    let result = await generateText({
      model: together(model),
      providerOptions,
      prompt: flowQuestionPrompt,
    });

    let flowParse = tryParseFlowQuestion(result.text);
    let flowLastError = flowParse.ok ? "" : flowParse.error;

    for (
      let attempt = 1;
      attempt <= maxFlowRetries && !flowParse.ok;
      attempt++
    ) {
      console.warn(
        `  ⚠️  Flow question parse failed for "${moduleTitle}" (attempt ${attempt}/${maxFlowRetries}):\n  • ${flowLastError}`
      );
      const retryPrompt = `YOUR PREVIOUS RESPONSE FAILED VALIDATION. Errors:
  • ${flowLastError}

Respond with ONLY a JSON object. No prose, no markdown fences, no trailing text.
The JSON must have: title, content, info, question, stepsInOrder (array of exactly 3 strings).
Ensure the JSON is syntactically valid with balanced braces and brackets.

${flowQuestionPrompt}`;
      result = await generateText({
        model: together(model),
        providerOptions,
        prompt: retryPrompt,
      });
      flowParse = tryParseFlowQuestion(result.text);
      if (!flowParse.ok) flowLastError = flowParse.error;
    }

    if (!flowParse.ok) {
      console.error(
        `  ❌ Flow question generation failed for "${moduleTitle}" after ${maxFlowRetries} retries:\n  • ${flowLastError}`
      );
      return null;
    }

    const q = flowParse.data;

    // Re-sort stepsInOrder using the flow diagram's topological order as source of truth
    // (the model sometimes returns steps in the wrong sequence)
    const topoOrder = topologicalSort(flowConfig);
    const labelToPosition = new Map<string, number>();
    for (let i = 0; i < topoOrder.length; i++) {
      const node = flowConfig.nodes.find((n) => n.id === topoOrder[i]);
      if (node) labelToPosition.set(node.label, i);
    }
    const sortedSteps = [...q.stepsInOrder].sort((a, b) => {
      const posA = labelToPosition.get(a) ?? Infinity;
      const posB = labelToPosition.get(b) ?? Infinity;
      return posA - posB;
    });
    const correctOrder = sortedSteps;
    const choices = [...correctOrder];
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    const slots = ["First", "Second", "Third"];
    const answer = correctOrder.map((step) => choices.indexOf(step));

    return {
      title: q.title,
      content: q.content,
      info: q.info,
      question: q.question,
      questionType: QuestionType.FlowDiagram,
      flowConfig,
      choices,
      slots,
      answer,
    };
  } catch (error) {
    console.error(`  ❌ Error generating flow question for "${moduleTitle}":`, error);
    return null;
  }
}

export async function validateLesson({
  lesson,
  moduleTitle,
  content,
  apiKey,
  model = DEFAULT_MODEL,
}: ValidateLessonInput): Promise<ValidationResult> {
  const together = createTogetherClient(apiKey);
  const providerOptions = getTogetherProviderOptions(model);

  const lessonData = {
    title: lesson.title,
    content: lesson.content,
    info: lesson.info,
    question: lesson.question,
    questionType: lesson.questionType,
    answer: lesson.answer,
    ...(lesson.questionType === QuestionType.MultipleChoice && {
      choices: (lesson as MultipleChoiceLesson).choices,
      explanation: (lesson as MultipleChoiceLesson).explanation,
    }),
    ...(lesson.questionType === QuestionType.FlowDiagram && {
      choices: (lesson as FlowDiagramLesson).choices,
      slots: (lesson as FlowDiagramLesson).slots,
      flowConfig: (lesson as FlowDiagramLesson).flowConfig,
    }),
  };

  const result = await generateText({
    model: together(model),
    providerOptions,
    prompt: `You are a lesson quality validator. Validate the following lesson against the source content.
Respond ONLY with JSON. No other text.

Module: "${moduleTitle}"

Lesson to Validate:
${JSON.stringify(lessonData, null, 2)}

Source Content:
${content}

Validation Criteria:
1. CONTENT: Is the lesson content factually accurate based on the source?
2. QUESTION: Is the question clear, relevant, and properly tests understanding?
3. ANSWER: Is the answer correct based on the source content?
4. CHOICES (if multiple-choice): Are all choices plausible? Is the correct answer index accurate? Fail any multiple-choice question that uses negation or exclusion wording such as "NOT", "EXCEPT", "least likely", or asks the student to identify the absent option.
5. INFO: Does the highlighted info fact come from the lesson content?
6. GROUNDING: Are ALL facts and claims in the lesson content, answer, and choices EXPLICITLY stated in or directly supported by the source? Flag any claims that appear plausible but are NOT in the source (hallucination).
7. SUFFICIENCY: Does the lesson content itself teach enough information for a student to answer the question correctly without seeing the source? Fail if the content is too generic, omits the key names/numbers/categories/steps needed for the question, or does not distinguish the correct answer from alternatives.

Return:
{"isValid": true, "explanation": "Brief assessment"}

Or if issues found:
{"isValid": false, "explanation": "Brief assessment", "issues": {"content": "issue", "answer": "issue"}}

Only include specific issue fields that have problems.`,
  });

  try {
    const parsed = parseJSON(result.text);
    const validated = validationResultSchema.safeParse(parsed);

    if (!validated.success) {
      return { isValid: false, explanation: "Failed to validate - invalid response format" };
    }

    return {
      isValid: validated.data.isValid,
      explanation: validated.data.explanation,
      issues: validated.data.issues,
    };
  } catch {
    console.error("Failed to parse validation response:", result.text.substring(0, 200));
    return { isValid: false, explanation: "Failed to validate lesson - invalid response format" };
  }
}
