export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const PDF_MAGIC_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);

export const MAX_FILENAME_LENGTH = 255;

export type FilenameValidationError =
  | "filename_empty"
  | "filename_too_long"
  | "filename_has_path_separator"
  | "filename_has_null_byte"
  | "filename_not_pdf";

export const validateFilename = (filename: string): FilenameValidationError | null => {
  if (filename.length === 0) {
    return "filename_empty";
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    return "filename_too_long";
  }

  if (filename.includes("/") || filename.includes("\\")) {
    return "filename_has_path_separator";
  }

  if (filename.includes("\0")) {
    return "filename_has_null_byte";
  }

  if (!filename.toLowerCase().endsWith(".pdf")) {
    return "filename_not_pdf";
  }

  return null;
};

export const hasPdfMagicBytes = (bytes: Uint8Array): boolean => {
  if (bytes.length < PDF_MAGIC_BYTES.length) {
    return false;
  }

  for (let i = 0; i < PDF_MAGIC_BYTES.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC_BYTES[i]) {
      return false;
    }
  }

  return true;
};

export const isWithinSizeLimit = (sizeBytes: number): boolean => {
  return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_UPLOAD_BYTES;
};

export const storagePathForDocument = (workspaceId: string, documentId: string): string => {
  return `${workspaceId}/${documentId}.pdf`;
};
