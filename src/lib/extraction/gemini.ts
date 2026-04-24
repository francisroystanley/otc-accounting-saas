// This module imports "server-only" and is untestable by vitest directly — the
// guard throws at import time under Node's default export condition. Pure
// helpers (ExtractionError, classifySdkError, copy map) live in ./errors so
// they can be unit-tested in isolation. See
// docs/solutions/best-practices/server-only-bypass-from-node-and-vitest-2026-04-22.md
import { GoogleGenAI } from "@google/genai";
import "server-only";
import { getGeminiModelOverride, getGoogleGenaiApiKey } from "@/lib/env";
import { DEFAULT_GEMINI_MODEL } from "@/lib/extraction/config";
import { ExtractionError, classifySdkError } from "@/lib/extraction/errors";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/extraction/prompt";
import { geminiResponseSchema, parseExtractionResult } from "@/lib/extraction/schemas";
import type { ExtractionResult } from "@/lib/extraction/types";

const toBase64 = (bytes: Uint8Array): string => {
  return Buffer.from(bytes).toString("base64");
};

export const extractFromPdfBytes = async (bytes: Uint8Array): Promise<ExtractionResult> => {
  const client = new GoogleGenAI({ apiKey: getGoogleGenaiApiKey() });
  const model = getGeminiModelOverride() ?? DEFAULT_GEMINI_MODEL;

  const response = await client.models
    .generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: toBase64(bytes),
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: EXTRACTION_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: geminiResponseSchema,
        temperature: 0,
      },
    })
    .catch((error: unknown): never => {
      throw new ExtractionError(classifySdkError(error), { cause: error });
    });

  const text = response.text;

  if (typeof text !== "string" || text.length === 0) {
    throw new ExtractionError("empty_response");
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ExtractionError("invalid_json", { cause: error });
  }

  try {
    return parseExtractionResult(raw);
  } catch (error) {
    throw new ExtractionError("schema_mismatch", { cause: error });
  }
};
