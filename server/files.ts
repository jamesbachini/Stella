import type { Express } from "express";
import type { ExtractedFile } from "./types.js";

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".rs",
  ".go",
  ".py",
  ".java",
  ".sol",
  ".sh"
]);

function extensionFor(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function isTextFile(file: Express.Multer.File): boolean {
  return (
    file.mimetype.startsWith("text/") ||
    file.mimetype === "application/json" ||
    file.mimetype === "application/xml" ||
    file.mimetype === "application/x-yaml" ||
    TEXT_EXTENSIONS.has(extensionFor(file.originalname))
  );
}

export async function extractFiles(
  files: Express.Multer.File[] = []
): Promise<ExtractedFile[]> {
  const extracted: ExtractedFile[] = [];

  for (const file of files) {
    if (file.mimetype === "application/pdf" || extensionFor(file.originalname) === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: file.buffer });
      const result = await parser.getText();
      await parser.destroy();
      extracted.push({
        name: file.originalname,
        mimeType: file.mimetype,
        text: result.text.slice(0, 40_000)
      });
      continue;
    }

    if (!isTextFile(file)) {
      throw new Error(`Unsupported file type for ${file.originalname}`);
    }

    extracted.push({
      name: file.originalname,
      mimeType: file.mimetype,
      text: file.buffer.toString("utf8").slice(0, 40_000)
    });
  }

  return extracted;
}
