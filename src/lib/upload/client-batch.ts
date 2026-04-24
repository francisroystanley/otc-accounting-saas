import { isWithinSizeLimit, validateFilename } from "@/lib/upload/validate";

const MAX_FILES_PER_BATCH = 10;
const PDF_MIME_TYPE = "application/pdf";

export type UploadStage = "queued" | "signing" | "uploading" | "finalizing" | "done" | "failed";

export type ClientOnlyCode =
  | "too_many_in_batch"
  | "non_pdf_extension"
  | "non_pdf_mime"
  | "client_oversize"
  | "empty_file"
  | "network_error"
  | "storage_put_failed"
  | "filename_empty"
  | "filename_too_long"
  | "filename_has_path_separator"
  | "filename_has_null_byte"
  | "filename_not_pdf";

export type ServerCode =
  | "forbidden_origin"
  | "unauthorized"
  | "invalid_json_body"
  | "invalid_payload"
  | "signed_url_failed"
  | "forbidden_path"
  | "storage_object_missing"
  | "empty_upload"
  | "oversize"
  | "magic_bytes_mismatch"
  | "insert_failed"
  | "publish_failed";

export type KnownCode = ClientOnlyCode | ServerCode;

export type SignResult =
  | {
      ok: true;
      signedUrl: string;
      token: string;
      documentId: string;
      storagePath: string;
    }
  | { ok: false; code: string };

export type PutResult = { ok: true } | { ok: false };

export type FinalizeResult = { ok: true; documentId: string } | { ok: false; code: string };

export type UploadBatchPort = {
  signUpload: (filename: string) => Promise<SignResult>;
  putToStorage: (token: string, file: File, storagePath: string) => Promise<PutResult>;
  finalizeUpload: (args: { documentId: string; filename: string; storagePath: string }) => Promise<FinalizeResult>;
  onProgress: (stage: UploadStage, percent: number) => void;
};

export type UploadOneResult =
  | { ok: true; documentId: string; filename: string }
  | { ok: false; filename: string; code: string };

export type PreCheckFailure = { code: ClientOnlyCode };

export type BatchPreCheck = {
  accepted: File[];
  rejected: Array<{ file: File; code: ClientOnlyCode }>;
};

const hasPdfExtension = (name: string): boolean => {
  return name.toLowerCase().endsWith(".pdf");
};

export const preCheckFile = (file: File): PreCheckFailure | null => {
  if (!hasPdfExtension(file.name)) {
    return { code: "non_pdf_extension" };
  }

  const filenameError = validateFilename(file.name);

  if (filenameError !== null) {
    return { code: filenameError };
  }

  if (file.size === 0) {
    return { code: "empty_file" };
  }

  if (!isWithinSizeLimit(file.size)) {
    return { code: "client_oversize" };
  }

  if (file.type !== PDF_MIME_TYPE) {
    return { code: "non_pdf_mime" };
  }

  return null;
};

export const preCheckBatch = (files: File[]): BatchPreCheck => {
  const accepted: File[] = [];
  const rejected: Array<{ file: File; code: ClientOnlyCode }> = [];

  for (const file of files) {
    if (accepted.length >= MAX_FILES_PER_BATCH) {
      rejected.push({ file, code: "too_many_in_batch" });
      continue;
    }

    const failure = preCheckFile(file);

    if (failure === null) {
      accepted.push(file);
    } else {
      rejected.push({ file, code: failure.code });
    }
  }

  return { accepted, rejected };
};

const asNetworkError = (filename: string): UploadOneResult => {
  return { ok: false, filename, code: "network_error" };
};

export const uploadOne = async (file: File, port: UploadBatchPort): Promise<UploadOneResult> => {
  const filename = file.name;

  let signResult: SignResult;

  try {
    port.onProgress("signing", 10);
    signResult = await port.signUpload(filename);
  } catch (error) {
    console.error("[uploadOne] signUpload threw", error);
    port.onProgress("failed", 100);

    return asNetworkError(filename);
  }

  if (!signResult.ok) {
    port.onProgress("failed", 100);

    return { ok: false, filename, code: signResult.code };
  }

  const { token, documentId, storagePath } = signResult;

  let putResult: PutResult;

  try {
    port.onProgress("uploading", 40);
    putResult = await port.putToStorage(token, file, storagePath);
  } catch (error) {
    console.error("[uploadOne] putToStorage threw", error);
    port.onProgress("failed", 100);

    return asNetworkError(filename);
  }

  if (!putResult.ok) {
    port.onProgress("failed", 100);

    return { ok: false, filename, code: "storage_put_failed" };
  }

  let finalizeResult: FinalizeResult;

  try {
    port.onProgress("finalizing", 75);
    finalizeResult = await port.finalizeUpload({ documentId, filename, storagePath });
  } catch (error) {
    console.error("[uploadOne] finalizeUpload threw", error);
    port.onProgress("failed", 100);

    return asNetworkError(filename);
  }

  if (!finalizeResult.ok) {
    port.onProgress("failed", 100);

    return { ok: false, filename, code: finalizeResult.code };
  }

  port.onProgress("done", 100);

  return { ok: true, documentId: finalizeResult.documentId, filename };
};

const USER_MESSAGES: Readonly<Record<KnownCode, string>> = {
  forbidden_origin: "Request blocked. Refresh the page and try again.",
  unauthorized: "Session expired. Sign in and try again.",
  invalid_json_body: "Upload failed due to a bad request. Try again.",
  invalid_payload: "Upload failed due to a bad request. Try again.",
  signed_url_failed: "Couldn't prepare the upload. Try again in a moment.",
  filename_empty: "That file has no name.",
  filename_too_long: "That filename is too long. Rename it under 255 characters and try again.",
  filename_has_path_separator: "That filename contains a slash. Rename it and try again.",
  filename_has_null_byte: "That filename contains an invalid character. Rename it and try again.",
  filename_not_pdf: "That file isn't a PDF.",
  forbidden_path: "That upload was rejected. Refresh and try again.",
  storage_object_missing: "The upload didn't reach storage. Try again.",
  empty_upload: "That file is empty.",
  oversize: "That file is over the 10 MB limit.",
  magic_bytes_mismatch: "That file isn't a valid PDF. Convert it and try again.",
  insert_failed: "Couldn't save the document. Try again.",
  publish_failed: "Upload saved but queuing for extraction failed. Try again.",
  network_error: "Network error. Check your connection and try again.",
  storage_put_failed: "Couldn't upload to storage. Try again.",
  too_many_in_batch: "Max 10 files per batch. Drop the rest in a follow-up.",
  non_pdf_extension: "That file isn't a PDF.",
  non_pdf_mime: "That file isn't a PDF.",
  client_oversize: "That file is over the 10 MB limit.",
  empty_file: "That file is empty.",
};

export const USER_MESSAGE_FALLBACK = "Upload failed. Try again.";

const isKnownCode = (code: string): code is KnownCode => {
  return Object.prototype.hasOwnProperty.call(USER_MESSAGES, code);
};

export const userMessageForCode = (code: string): string => {
  if (!isKnownCode(code)) {
    return USER_MESSAGE_FALLBACK;
  }

  return USER_MESSAGES[code];
};

export type BatchSummary = {
  succeeded: number;
  failed: number;
  message: string;
  tone: "success" | "error";
};

export const summarizeBatchResults = (results: UploadOneResult[]): BatchSummary => {
  let succeeded = 0;
  let failed = 0;

  for (const result of results) {
    if (result.ok) {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }

  if (succeeded === 0 && failed === 0) {
    return { succeeded: 0, failed: 0, message: "", tone: "success" };
  }

  if (failed === 0) {
    const noun = succeeded === 1 ? "file" : "files";

    return { succeeded, failed, message: `Queued ${succeeded} ${noun}`, tone: "success" };
  }

  if (succeeded === 0) {
    return { succeeded, failed, message: `All ${failed} uploads failed`, tone: "error" };
  }

  const total = succeeded + failed;

  return { succeeded, failed, message: `Queued ${succeeded} of ${total}; ${failed} failed`, tone: "error" };
};
