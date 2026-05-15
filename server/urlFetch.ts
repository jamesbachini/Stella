import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DocsSource } from "./types.js";

export type FetchedUrl = {
  url: string;
  title?: string;
  content: string;
};

const MAX_FETCH_BYTES = 512_000;
const MAX_CONTEXT_CHARS = 18_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

function isBlockedIp(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 0) {
    return false;
  }

  if (ipVersion === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs can be fetched.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials cannot be fetched.");
  }
  if (isBlockedHostname(url.hostname) || isBlockedIp(url.hostname)) {
    throw new Error("Private or local network URLs cannot be fetched.");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.some((address) => isBlockedIp(address.address))) {
    throw new Error("Private or local network URLs cannot be fetched.");
  }

  return url;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).replace(/\s+/g, " ").trim() : undefined;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(?:p|div|section|article|header|footer|li|tr|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

export async function fetchUrlContent(rawUrl: string): Promise<FetchedUrl> {
  let url = await assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1",
          "User-Agent": "StellarAI/0.1 URL fetch tool"
        }
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break;
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new Error("URL redirect response did not include a location.");
      }
      url = await assertSafeUrl(new URL(location, url).href);
      response.body?.cancel().catch(() => undefined);
    }

    if (!response) {
      throw new Error("URL fetch failed.");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new Error("URL redirected too many times.");
    }

    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !/(text\/|application\/json|application\/ld\+json|application\/xml|application\/rss\+xml)/i.test(
        contentType
      )
    ) {
      throw new Error(`Unsupported content type: ${contentType}.`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body was empty.");
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FETCH_BYTES) {
        throw new Error("URL response is too large to fetch.");
      }
      chunks.push(value);
    }

    const body = new TextDecoder().decode(Buffer.concat(chunks));
    const isHtml = /text\/html/i.test(contentType) || /<\/?[a-z][\s\S]*>/i.test(body);
    const title = isHtml ? extractTitle(body) : undefined;
    const content = (isHtml ? htmlToText(body) : body.trim()).slice(0, MAX_CONTEXT_CHARS);

    return {
      url: url.href,
      title,
      content
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("URL fetch timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchedUrlSources(fetchedUrls: FetchedUrl[]): DocsSource[] {
  return fetchedUrls.map((fetched) => ({
    title: fetched.title,
    url: fetched.url
  }));
}
