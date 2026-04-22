import { GoogleGenAI } from "@google/genai";
import "server-only";
import { getGeminiModelOverride, getGoogleGenaiApiKey } from "@/lib/env";
import { DEFAULT_GEMINI_MODEL } from "@/lib/extraction/config";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/extraction/prompt";
import { geminiResponseSchema, parseExtractionResult } from "@/lib/extraction/schemas";
import type { ExtractionResult } from "@/lib/extraction/types";

export type ExtractionErrorKind = "sdk_error" | "empty_response" | "invalid_json" | "schema_mismatch";

export class ExtractionError extends Error {
  readonly kind: ExtractionErrorKind;

  constructor(kind: ExtractionErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExtractionError";
    this.kind = kind;
  }
}

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
      throw new ExtractionError("sdk_error", "Gemini generateContent failed", { cause: error });
    });

  const text = response.text;

  if (typeof text !== "string" || text.length === 0) {
    throw new ExtractionError("empty_response", "Gemini returned an empty response");
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ExtractionError("invalid_json", "Gemini response was not valid JSON", { cause: error });
  }

  try {
    return parseExtractionResult(raw);
  } catch (error) {
    throw new ExtractionError("schema_mismatch", "Gemini response did not match expected schema", { cause: error });
  }
};
