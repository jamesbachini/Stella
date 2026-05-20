import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { config } from "./config.js";
import type { DocsSource, RetrievedDocs } from "./types.js";

type Frontmatter = {
  title?: string;
  description?: string;
  sidebarLabel?: string;
};

type Heading = {
  depth: number;
  text: string;
  slug: string;
};

type DocsChunk = {
  id: string;
  filePath: string;
  relativePath: string;
  title: string;
  description: string;
  url: string;
  headingPath: string[];
  content: string;
  searchText: string;
  termCounts: Map<string, number>;
  uniqueTerms: Set<string>;
  length: number;
};

type DocsIndex = {
  chunks: DocsChunk[];
  docFrequency: Map<string, number>;
  averageLength: number;
  indexedAt: number;
};

type SearchOptions = {
  docsRoot?: string;
  baseUrl?: string;
  maxContextChars?: number;
  maxSources?: number;
};

type RankedChunk = {
  chunk: DocsChunk;
  score: number;
  matchedTerms: string[];
};

const CODE_FENCE_PATTERN = /^(```|~~~)/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const DEFAULT_MAX_CONTEXT_CHARS = 16_000;
const MAX_CHUNK_CHARS = 4_200;
const MIN_CHUNK_CHARS = 450;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "use",
  "using",
  "what",
  "when",
  "with",
  "you",
  "your"
]);

const QUERY_EXPANSIONS: Record<string, string[]> = {
  verify: ["verifier", "verifies", "verified", "verification", "proof"],
  verifier: ["verify", "verifies", "verification", "proof"],
  verifies: ["verify", "verifier", "verification", "proof"],
  verification: ["verify", "verifier", "verifies", "proof"],
  circuit: ["circuits", "proof", "zk", "zero", "knowledge"],
  circuits: ["circuit", "proof", "zk", "zero", "knowledge"],
  noir: ["ultrahonk", "barretenberg", "circuit", "circuits"],
  zk: ["zero", "knowledge", "proof", "proofs", "verifier"],
  sac: ["stellar", "asset", "contract", "token"],
  soroban: ["smart", "contract", "contracts"],
  contract: ["soroban", "smart"],
  contracts: ["soroban", "smart"],
  sep: ["stellar", "ecosystem", "proposal"],
  horizon: ["api", "server", "operations", "payments", "accounts"],
  rpc: ["json", "server", "simulate", "transaction", "contract"],
  trustline: ["trust", "asset", "change", "trust"],
  trustlines: ["trustline", "trust", "asset", "change"],
  friendbot: ["testnet", "fund", "account", "xlm"],
  xdr: ["transaction", "envelope", "stellar"],
  freighter: ["wallet", "sign", "transaction"],
  passkey: ["passkeys", "smart", "wallet", "account"],
  passkeys: ["passkey", "smart", "wallet", "account"],
  clawback: ["asset", "authorization", "issuer"],
  wasm: ["contract", "soroban", "deploy"],
  ttl: ["archival", "storage", "restore", "extend"],
  mpp: ["machine", "payments", "protocol"],
  x402: ["payment", "http", "agentic"]
};

let cachedIndex:
  | {
      cacheKey: string;
      index: Promise<DocsIndex>;
    }
  | undefined;

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, body: raw };
  }

  const endIndex = raw.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatterText = raw.slice(4, endIndex);
  const body = raw.slice(endIndex + 4).replace(/^\s*\n/, "");
  const frontmatter: Frontmatter = {};

  for (const line of frontmatterText.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = unquoteFrontmatterValue(match[2].trim());
    if (key === "title") {
      frontmatter.title = value;
    } else if (key === "description") {
      frontmatter.description = value;
    } else if (key === "sidebar_label") {
      frontmatter.sidebarLabel = value;
    }
  }

  return { frontmatter, body };
}

export function cleanMdxForSearch(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (CODE_FENCE_PATTERN.test(line.trim())) {
      inFence = !inFence;
      cleaned.push(line);
      continue;
    }

    if (inFence) {
      cleaned.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export ") ||
      trimmed.startsWith("{/*") ||
      trimmed === "*/}" ||
      /^<\/?[A-Z][A-Za-z0-9]*(\s[^>]*)?>$/.test(trimmed) ||
      /^<([A-Z][A-Za-z0-9]*)\s[^>]*\/>$/.test(trimmed)
    ) {
      continue;
    }

    const withoutAdmonition = line.replace(/^:::\w+.*$/, "").replace(/^:::$/, "");
    const withoutJsx = withoutAdmonition
      .replace(/<\/?[A-Z][A-Za-z0-9]*(\s[^>]*)?>/g, "")
      .replace(/<([A-Z][A-Za-z0-9]*)\s[^>]*\/>/g, "")
      .replace(/{#([^}]+)}/g, "")
      .replace(/<br\s*\/?>/gi, "\n");
    cleaned.push(withoutJsx);
  }

  return cleaned
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function docsPathToUrl(
  relativePath: string,
  baseUrl = "https://developers.stellar.org/docs",
  headingSlug?: string
): string {
  const normalized = relativePath.split(sep).join("/");
  const withoutExt = normalized.replace(/\.(mdx|md)$/i, "");
  const route = withoutExt.endsWith("/README")
    ? withoutExt.slice(0, -"README".length).replace(/\/$/, "")
    : withoutExt;
  const url = `${baseUrl.replace(/\/$/, "")}/${route}`.replace(/\/$/, "");
  return headingSlug ? `${url}#${headingSlug}` : url;
}

export async function retrieveStellarDocs(
  message: string,
  options: SearchOptions = {}
): Promise<RetrievedDocs> {
  const query = message.replace(/\s+/g, " ").trim().slice(0, 700);
  if (!query) {
    return { context: "", sources: [] };
  }

  const docsRoot = resolve(process.cwd(), options.docsRoot ?? config.stellarDocsRoot);
  const baseUrl = options.baseUrl ?? config.stellarDocsBaseUrl;
  const maxContextChars =
    options.maxContextChars ?? config.docsContextMaxChars ?? DEFAULT_MAX_CONTEXT_CHARS;

  try {
    const index = await getDocsIndex(docsRoot, baseUrl);
    const ranked = rankChunks(index, query).slice(0, 16);
    return formatRetrievedDocs(ranked, maxContextChars, options.maxSources ?? 8);
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown local docs search error";
    return {
      context: `Docs retrieval failed for this turn: ${messageText}`,
      sources: []
    };
  }
}

async function getDocsIndex(docsRoot: string, baseUrl: string): Promise<DocsIndex> {
  const cacheKey = `${docsRoot}\0${baseUrl}`;
  if (!cachedIndex || cachedIndex.cacheKey !== cacheKey) {
    cachedIndex = {
      cacheKey,
      index: buildDocsIndex(docsRoot, baseUrl)
    };
  }
  return cachedIndex.index;
}

async function buildDocsIndex(docsRoot: string, baseUrl: string): Promise<DocsIndex> {
  const files = await listDocsFiles(docsRoot);
  if (files.length === 0) {
    throw new Error(`No markdown docs found in ${docsRoot}`);
  }

  const chunks: DocsChunk[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, "utf8");
    const relativePath = relative(docsRoot, filePath);
    chunks.push(...chunkDocument(raw, filePath, relativePath, baseUrl));
  }

  const docFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
    for (const term of chunk.uniqueTerms) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    chunks,
    docFrequency,
    averageLength: totalLength / Math.max(chunks.length, 1),
    indexedAt: Date.now()
  };
}

async function listDocsFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) {
          await walk(fullPath);
        }
        continue;
      }
      if (/\.(mdx|md)$/i.test(entry.name)) {
        found.push(fullPath);
      }
    }
  }

  await walk(root);
  return found.sort();
}

function chunkDocument(
  raw: string,
  filePath: string,
  relativePath: string,
  baseUrl: string
): DocsChunk[] {
  const { frontmatter, body } = parseFrontmatter(raw);
  const cleaned = cleanMdxForSearch(body);
  const title = frontmatter.title ?? firstMarkdownHeading(cleaned) ?? titleFromPath(relativePath);
  const description = frontmatter.description ?? "";
  const sections = splitSections(cleaned);
  const chunks: DocsChunk[] = [];

  for (const section of sections) {
    const headingPath = section.headings.map((heading) => heading.text);
    const url = docsPathToUrl(relativePath, baseUrl, section.headings.at(-1)?.slug);
    const contentPieces = splitLargeSection(section.content);

    for (const [pieceIndex, content] of contentPieces.entries()) {
      const searchText = [
        title,
        description,
        frontmatter.sidebarLabel ?? "",
        relativePath.replace(/[\/_-]/g, " "),
        ...headingPath,
        content
      ]
        .filter(Boolean)
        .join("\n");
      const termCounts = countTerms(searchText);
      const chunkIdSuffix =
        section.headings.at(-1)?.slug ?? relativePath.replace(/[^\w]+/g, "-");
      chunks.push({
        id: `${relativePath}#${chunkIdSuffix}-${pieceIndex}`,
        filePath,
        relativePath,
        title,
        description,
        url,
        headingPath,
        content,
        searchText,
        termCounts,
        uniqueTerms: new Set(termCounts.keys()),
        length: [...termCounts.values()].reduce((sum, count) => sum + count, 0)
      });
    }
  }

  return chunks;
}

function splitSections(cleaned: string): Array<{ headings: Heading[]; content: string }> {
  const sections: Array<{ headings: Heading[]; content: string }> = [];
  const headingStack: Heading[] = [];
  let currentLines: string[] = [];
  let currentHeadings: Heading[] = [];
  let inFence = false;

  function flush(): void {
    const content = currentLines.join("\n").trim();
    if (content) {
      sections.push({ headings: currentHeadings, content });
    }
  }

  for (const line of cleaned.split("\n")) {
    if (CODE_FENCE_PATTERN.test(line.trim())) {
      inFence = !inFence;
    }

    const headingMatch = !inFence ? line.match(HEADING_PATTERN) : null;
    if (headingMatch) {
      flush();
      const depth = headingMatch[1].length;
      const text = stripMarkdownInline(headingMatch[2]);
      while (headingStack.length && headingStack[headingStack.length - 1].depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ depth, text, slug: slugify(text) });
      currentHeadings = [...headingStack];
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections.length > 0 ? sections : [{ headings: [], content: cleaned }];
}

function splitLargeSection(content: string): string[] {
  if (content.length <= MAX_CHUNK_CHARS) {
    return [content];
  }

  const pieces: string[] = [];
  let current = "";
  let inFence = false;

  for (const paragraph of content.split(/\n{2,}/)) {
    const fenceCount = paragraph
      .split("\n")
      .filter((line) => CODE_FENCE_PATTERN.test(line.trim())).length;
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS && !inFence) {
      pieces.push(current.trim());
      current = paragraph;
    } else {
      current = next;
    }
    if (fenceCount % 2 === 1) {
      inFence = !inFence;
    }
  }

  if (current.trim()) {
    pieces.push(current.trim());
  }
  return pieces;
}

function rankChunks(index: DocsIndex, query: string): RankedChunk[] {
  const analysis = analyzeQuery(query);
  if (analysis.terms.length === 0 && analysis.phrases.length === 0) {
    return [];
  }

  const ranked: RankedChunk[] = [];
  for (const chunk of index.chunks) {
    const score = scoreChunk(index, chunk, analysis);
    if (score > 0) {
      const matchedTerms = analysis.terms.filter((term) => chunk.uniqueTerms.has(term));
      ranked.push({ chunk, score, matchedTerms });
    }
  }

  return diversifyResults(
    ranked.sort((a, b) => b.score - a.score)
  );
}

function analyzeQuery(query: string): {
  raw: string;
  normalized: string;
  terms: string[];
  coreTerms: string[];
  phrases: string[];
  codeTerms: string[];
  languageHints: string[];
} {
  const normalized = query.toLowerCase();
  const quotedPhrases = [...query.matchAll(/"([^"]+)"/g)].map((match) =>
    normalizeSpaces(match[1].toLowerCase())
  );
  const phraseCandidates = normalizeSpaces(normalized)
    .split(/[?.!,;:]\s+/)
    .filter((phrase) => phrase.split(/\s+/).length > 1 && phrase.length <= 80);
  const codeTerms = extractCodeTerms(query);
  const coreTerms = tokenize(query).filter((term) => !STOP_WORDS.has(term));
  const expandedTerms = new Set([...coreTerms, ...codeTerms.map((term) => term.toLowerCase())]);

  for (const term of coreTerms) {
    for (const expansion of QUERY_EXPANSIONS[term] ?? []) {
      expandedTerms.add(expansion);
    }
  }

  return {
    raw: query,
    normalized,
    terms: [...expandedTerms],
    coreTerms,
    phrases: [...new Set([...quotedPhrases, ...phraseCandidates, ...adjacentPhrases(coreTerms)])],
    codeTerms,
    languageHints: detectLanguageHints(normalized)
  };
}

function scoreChunk(
  index: DocsIndex,
  chunk: DocsChunk,
  analysis: ReturnType<typeof analyzeQuery>
): number {
  let score = 0;
  const totalChunks = index.chunks.length;
  const k1 = 1.2;
  const b = 0.75;

  for (const term of analysis.terms) {
    const tf = chunk.termCounts.get(term) ?? 0;
    if (tf === 0) {
      continue;
    }
    const df = index.docFrequency.get(term) ?? 0;
    const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
    const denominator = tf + k1 * (1 - b + b * (chunk.length / index.averageLength));
    score += idf * ((tf * (k1 + 1)) / denominator);
  }

  const title = chunk.title.toLowerCase();
  const description = chunk.description.toLowerCase();
  const headings = chunk.headingPath.join(" ").toLowerCase();
  const path = chunk.relativePath.toLowerCase().replace(/[\/_-]/g, " ");
  const searchText = chunk.searchText.toLowerCase();

  for (const term of analysis.coreTerms) {
    const tf = chunk.termCounts.get(term) ?? 0;
    const df = index.docFrequency.get(term) ?? 0;
    if (tf > 0 && df > 0 && df <= Math.max(12, index.chunks.length * 0.04)) {
      score += 18;
    }
    if (title.includes(term)) {
      score += 12;
    }
    if (headings.includes(term)) {
      score += 6;
    }
    if (description.includes(term)) {
      score += 4;
    }
    if (path.includes(term)) {
      score += 5;
    }
  }

  for (const phrase of analysis.phrases) {
    if (phrase.length < 4) {
      continue;
    }
    if (title.includes(phrase)) {
      score += 16;
    } else if (headings.includes(phrase)) {
      score += 12;
    } else if (description.includes(phrase)) {
      score += 8;
    } else if (searchText.includes(phrase)) {
      score += 6;
    }
  }

  for (const codeTerm of analysis.codeTerms) {
    const codeNeedle = codeTerm.toLowerCase();
    if (searchText.includes(codeNeedle)) {
      score += 12;
    }
    if (title.includes(codeNeedle)) {
      score += 25;
    }
    if (headings.includes(codeNeedle)) {
      score += 14;
    }
    if (path.includes(codeNeedle.replace(/[^\w]+/g, " "))) {
      score += 18;
    }
  }

  for (const language of analysis.languageHints) {
    if (searchText.includes(`\`\`\`${language}`) || searchText.includes(language)) {
      score += 2;
    }
  }

  const matchedCoreTerms = analysis.coreTerms.filter((term) => chunk.uniqueTerms.has(term));
  if (analysis.coreTerms.length > 1) {
    score += (matchedCoreTerms.length / analysis.coreTerms.length) * 6;
  }
  if (matchedCoreTerms.length >= 2) {
    score += matchedCoreTerms.length * 2;
  }

  const rareCoreTerms = analysis.coreTerms.filter((term) => {
    const df = index.docFrequency.get(term) ?? 0;
    return df > 0 && df <= Math.max(12, index.chunks.length * 0.04);
  });
  if (rareCoreTerms.length > 0) {
    const matchedRareTerms = rareCoreTerms.filter((term) => chunk.uniqueTerms.has(term));
    if (matchedRareTerms.length === 0) {
      score *= 0.35;
    } else {
      score += matchedRareTerms.length * 14;
    }
  }

  return score;
}

function diversifyResults(ranked: RankedChunk[]): RankedChunk[] {
  const selected: RankedChunk[] = [];
  const perPageCount = new Map<string, number>();

  for (const result of ranked) {
    const count = perPageCount.get(result.chunk.relativePath) ?? 0;
    const penalty = count === 0 ? 1 : count === 1 ? 0.72 : 0.45;
    selected.push({ ...result, score: result.score * penalty });
    perPageCount.set(result.chunk.relativePath, count + 1);
  }

  return selected.sort((a, b) => b.score - a.score);
}

function formatRetrievedDocs(
  ranked: RankedChunk[],
  maxContextChars: number,
  maxSources: number
): RetrievedDocs {
  if (ranked.length === 0) {
    return { context: "", sources: [] };
  }

  const sources: DocsSource[] = [];
  const seenSources = new Set<string>();
  const blocks: string[] = [];
  let usedChars = 0;

  for (const result of ranked) {
    if (blocks.length >= 10 || usedChars >= maxContextChars) {
      break;
    }

    const chunk = result.chunk;
    const sourceUrl = stripHash(chunk.url);
    if (!seenSources.has(sourceUrl) && sources.length < maxSources) {
      seenSources.add(sourceUrl);
      sources.push({ title: chunk.title, url: sourceUrl });
    }

    const heading = chunk.headingPath.length ? chunk.headingPath.join(" > ") : chunk.title;
    const matched = result.matchedTerms.slice(0, 8).join(", ");
    const excerptBudget = Math.max(
      900,
      Math.min(2_400, maxContextChars - usedChars - 300)
    );
    const block = [
      `### ${chunk.title}`,
      `Source: ${chunk.url}`,
      `Section: ${heading}`,
      matched ? `Matched terms: ${matched}` : "",
      "",
      trimToChars(chunk.content, excerptBudget)
    ]
      .filter((line) => line !== "")
      .join("\n");

    if (usedChars + block.length > maxContextChars && blocks.length > 0) {
      break;
    }
    blocks.push(block);
    usedChars += block.length + 2;
  }

  return {
    context: blocks.join("\n\n---\n\n"),
    sources
  };
}

function unquoteFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstMarkdownHeading(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (match) {
      return stripMarkdownInline(match[1]);
    }
  }
  return undefined;
}

function titleFromPath(relativePath: string): string {
  const normalized = relativePath.split(sep).join("/");
  const leaf = normalized
    .replace(/\/README\.(mdx|md)$/i, "")
    .replace(/\.(mdx|md)$/i, "")
    .split("/")
    .pop();
  return (leaf ?? "Stellar Docs")
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function slugify(text: string): string {
  return stripMarkdownInline(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return [
    ...text
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .matchAll(/[a-z0-9]+(?:-[a-z0-9]+)*/g)
  ].map((match) => match[0]);
}

function adjacentPhrases(terms: string[]): string[] {
  const phrases: string[] = [];
  for (let index = 0; index < terms.length - 1; index += 1) {
    phrases.push(`${terms[index]} ${terms[index + 1]}`);
  }
  for (let index = 0; index < terms.length - 2; index += 1) {
    phrases.push(`${terms[index]} ${terms[index + 1]} ${terms[index + 2]}`);
  }
  return phrases;
}

function countTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokenize(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

function extractCodeTerms(query: string): string[] {
  return [
    ...query.matchAll(
      /(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\([^\)]*\)|[A-Z][A-Za-z0-9_$]*)+|[A-Z]{2,}-?\d*|\/[A-Za-z0-9_./:-]+|@[A-Za-z0-9_./-]+|[a-z]+-[a-z0-9-]+)/g
    )
  ].map((match) => match[0]);
}

function detectLanguageHints(normalizedQuery: string): string[] {
  const hints: string[] = [];
  const languages: Array<[string, string[]]> = [
    ["js", ["javascript", "typescript", "node", "npm"]],
    ["python", ["python", "py"]],
    ["rust", ["rust", "cargo"]],
    ["go", ["golang", " go "]],
    ["java", ["java"]],
    ["swift", ["swift"]],
    ["kotlin", ["kotlin"]]
  ];

  for (const [language, needles] of languages) {
    if (needles.some((needle) => normalizedQuery.includes(needle))) {
      hints.push(language);
    }
  }
  return hints;
}

function stripHash(url: string): string {
  return url.split("#")[0];
}

function trimToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const trimmed = text.slice(0, maxChars);
  const lastBreak = Math.max(trimmed.lastIndexOf("\n\n"), trimmed.lastIndexOf(". "));
  if (lastBreak > maxChars * 0.55) {
    return `${trimmed.slice(0, lastBreak).trim()}...`;
  }
  return `${trimmed.trim()}...`;
}
