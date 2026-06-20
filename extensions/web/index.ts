import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const WEB_ACTIONS = [
  "search",
  "goto",
  "click",
  "search_next",
  "close",
] as const;
const REF_PATTERN = /^e\d+$/;
const SESSION_PREFIX = "pi-web-";
const ARTIFACT_ROOT_SEGMENTS = [".kdriver"] as const;
const KDRIVER_TIMEOUT_MS = 60_000;
const KDRIVER_CLOSE_TIMEOUT_MS = 15_000;
const KDRIVER_MARKDOWN_PAGE_DEPTH = 20;
const KDRIVER_RUNTIME_ENV = "PI_WEB_KDRIVER_RUNTIME";
const KDRIVER_EXCERPT_CHARS = 700;
const PREVIEW_CHARS = 280;
const FIRST_ITEMS_LIMIT = 5;
const GOOGLE_SEARCH_URL = "https://www.google.com/search";
const NOVNC_URL = "http://localhost:6080/vnc.html";
const CLOSE_COMMAND = ["close"] as const;
const SHUTDOWN_CLEANUP_REASONS = new Set(["quit", "new", "resume", "fork"]);
const execFileAsync = promisify(execFile);

const webToolParameters = Type.Object(
  {
    action: StringEnum(WEB_ACTIONS),
    query: Type.Optional(
      Type.String({ description: "Search query for action=search" }),
    ),
    url: Type.Optional(
      Type.String({ description: "Absolute http(s) URL for action=goto" }),
    ),
    ref: Type.Optional(
      Type.String({
        description: "kdriver element ref such as e142 for action=click",
      }),
    ),
  },
  { additionalProperties: false },
);

export type WebToolParameters = Static<typeof webToolParameters>;

type SearchInput = { action: "search"; query: string };
type GotoInput = { action: "goto"; url: string };
type ClickInput = { action: "click"; ref: string };
type SearchNextInput = { action: "search_next" };
type CloseInput = { action: "close" };

export type WebActionInput =
  | SearchInput
  | GotoInput
  | ClickInput
  | SearchNextInput
  | CloseInput;

export class WebToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebToolError";
  }
}

export interface RuntimeContext {
  cwd: string;
  artifactRoot: string;
  sessionName: string;
  runtime: "container" | "local";
  timeouts: {
    kdriverMs: number;
    closeMs: number;
  };
}

type KdriverExpectation = "status" | "json";

type KdriverStatusResult = { ok: true; stdout: string; stderr: string };
type KdriverJsonResult = { ok: true; json: unknown };

type KdriverResult<TExpectation extends KdriverExpectation> =
  TExpectation extends "json" ? KdriverJsonResult : KdriverStatusResult;

type ExecFailureLike = {
  code?: unknown;
  message?: unknown;
  stderr?: unknown;
  stdout?: unknown;
  killed?: unknown;
  signal?: unknown;
  name?: unknown;
};

type SnapshotPageMetadata = {
  title: string;
  url: string;
  selectedTabIndex?: number;
};

export type MarkdownArtifact = {
  snapshotPath: string;
  metadataPath: string;
  size?: number;
  page: SnapshotPageMetadata;
};

type RawSearchResult = {
  title?: unknown;
  href?: unknown;
  url?: unknown;
  body?: unknown;
  snippet?: unknown;
  ref?: unknown;
};

export type SearchResultItem = {
  title: string;
  url: string;
  body: string;
  ref?: string;
};

export type SearchPaginationLink = {
  ref: string;
  description?: string;
  url?: string;
};

export type SearchPagination = {
  next: SearchPaginationLink | null;
  previous: SearchPaginationLink | null;
};

export type SearchData = {
  engine: "google";
  page?: SnapshotPageMetadata;
  results: SearchResultItem[];
  pagination: SearchPagination;
};

export type CurrentGoogleSearchPage = SearchData & {
  pagination: SearchPagination & { next: SearchPaginationLink };
};

type FormattedWebResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

type CloseResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

type WebResultDetails = Record<string, unknown>;

type WebRenderResult = {
  details?: unknown;
};

type WebRenderOptions = {
  expanded?: boolean;
  isPartial?: boolean;
};

type WebTheme = {
  bold(text: string): string;
  fg(color: string, text: string): string;
};

type WebRenderContext = {
  isError?: boolean;
  args?: unknown;
  lastComponent?: unknown;
};

let actionQueue: Promise<void> = Promise.resolve();
let hasExtensionOwnedSession = false;

function requiredString(
  params: WebToolParameters,
  field: "query" | "url" | "ref",
): string {
  const value = params[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WebToolError(`web ${params.action} requires non-blank ${field}`);
  }
  return value.trim();
}

function parseHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebToolError(
      "web goto requires url to be an absolute http(s) URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebToolError(
      "web goto accepts only absolute http(s) URLs in url",
    );
  }

  return parsed.toString();
}

function parseRef(rawRef: string): string {
  if (!REF_PATTERN.test(rawRef)) {
    throw new WebToolError(
      "web click requires ref shaped like a kdriver ref, for example e142",
    );
  }
  return rawRef;
}

export function parseActionInput(params: WebToolParameters): WebActionInput {
  switch (params.action) {
    case "search":
      return { action: "search", query: requiredString(params, "query") };
    case "goto":
      return {
        action: "goto",
        url: parseHttpUrl(requiredString(params, "url")),
      };
    case "click":
      return { action: "click", ref: parseRef(requiredString(params, "ref")) };
    case "search_next":
      return { action: "search_next" };
    case "close":
      return { action: "close" };
    default: {
      const exhaustive: never = params.action;
      throw new WebToolError(
        `web action is not supported: ${String(exhaustive)}`,
      );
    }
  }
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSessionName(ctx: ExtensionContext): string {
  const rawSessionId = ctx.sessionManager.getSessionId();
  if (typeof rawSessionId !== "string" || rawSessionId.trim().length === 0) {
    throw new WebToolError(
      "Invariant violation: web requires a non-empty Pi session id before launching kdriver",
    );
  }

  const sanitizedSessionId = sanitizeSessionId(rawSessionId);
  if (sanitizedSessionId.length === 0) {
    throw new WebToolError(
      "Invariant violation: web Pi session id is unusable after sanitization before launching kdriver",
    );
  }

  return `${SESSION_PREFIX}${sanitizedSessionId}`;
}

function formatFilesystemError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function getKdriverRuntime(): "container" | "local" {
  const value = process.env[KDRIVER_RUNTIME_ENV]?.trim();
  if (!value || value === "container") {
    return "container";
  }
  if (value === "local") {
    return "local";
  }
  throw new WebToolError(
    `${KDRIVER_RUNTIME_ENV} must be unset, container, or local; got ${value}`,
  );
}

export async function getRuntimeContext(
  ctx: ExtensionContext,
): Promise<RuntimeContext> {
  const cwd = path.resolve(ctx.cwd);
  const sessionName = getSessionName(ctx);
  const requestedArtifactRoot = path.join(cwd, ...ARTIFACT_ROOT_SEGMENTS);

  let artifactRoot: string;
  try {
    await mkdir(requestedArtifactRoot, { recursive: true });
    artifactRoot = await realpath(requestedArtifactRoot);
  } catch (error) {
    throw new WebToolError(
      `Failed to create web artifact root at ${requestedArtifactRoot}: ${formatFilesystemError(error)}`,
    );
  }

  return {
    cwd,
    artifactRoot,
    sessionName,
    runtime: getKdriverRuntime(),
    timeouts: {
      kdriverMs: KDRIVER_TIMEOUT_MS,
      closeMs: KDRIVER_CLOSE_TIMEOUT_MS,
    },
  };
}

function validateKdriverArgs(args: readonly string[]): void {
  const [command, ...rest] = args;

  if (
    command === "open" &&
    rest.length === 3 &&
    rest[0] === "--profile-template" &&
    rest[1] === "shared"
  ) {
    parseHttpUrl(rest[2] ?? "");
    return;
  }

  if (command === "goto" && rest.length === 1) {
    parseHttpUrl(rest[0] ?? "");
    return;
  }

  if (command === "click" && rest.length === 1) {
    parseRef(rest[0] ?? "");
    return;
  }

  if (
    command === "snapshot" &&
    rest.length === 1 &&
    rest[0] === "--search-results"
  ) {
    return;
  }

  if (command === "snapshot" && rest[0] === "--markdown") {
    if (rest.length === 1) {
      return;
    }
    if (
      rest.length === 3 &&
      rest[1] === "--depth" &&
      /^\d+$/.test(rest[2] ?? "")
    ) {
      return;
    }
  }

  if (command === "profile-list" && rest.length === 0) {
    return;
  }

  if (
    command === "profile-template-create" &&
    rest.length === 1 &&
    /^[A-Za-z0-9._-]+$/.test(rest[0] ?? "")
  ) {
    return;
  }

  if (command === "close" && rest.length === 0) {
    return;
  }

  throw new WebToolError(
    `Invariant violation: unsupported kdriver command shape: ${args.join(" ")}`,
  );
}

function excerptOutput(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= KDRIVER_EXCERPT_CHARS) {
    return compact || "<empty>";
  }
  return `${compact.slice(0, KDRIVER_EXCERPT_CHARS)}…`;
}

function formatOutputExcerpts(stdout: string, stderr: string): string {
  return `stdout: ${excerptOutput(stdout)}; stderr: ${excerptOutput(stderr)}`;
}

function isMissingCommandError(error: unknown): boolean {
  const failure = error as ExecFailureLike;
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  const stderr = typeof failure.stderr === "string" ? failure.stderr : "";

  return (
    code === "ENOENT" ||
    /not found|ENOENT|command not found|no such file/i.test(
      `${message}\n${stderr}`,
    )
  );
}

function isAbortOrTimeoutError(error: unknown): boolean {
  const failure = error as ExecFailureLike;
  const name = typeof failure.name === "string" ? failure.name : "";
  const message = typeof failure.message === "string" ? failure.message : "";
  const code = typeof failure.code === "string" ? failure.code : "";

  return (
    name === "AbortError" ||
    code === "ABORT_ERR" ||
    /abort|cancel|timeout|timed out/i.test(message)
  );
}

function buildKdriverArgs(
  runtime: RuntimeContext,
  args: readonly string[],
): string[] {
  return [`--runtime=${runtime.runtime}`, `-s=${runtime.sessionName}`, ...args];
}

export async function runKdriver<TExpectation extends KdriverExpectation>(
  pi: ExtensionAPI,
  runtime: RuntimeContext,
  args: readonly string[],
  expectation: TExpectation,
  signal: AbortSignal | undefined,
): Promise<KdriverResult<TExpectation>> {
  validateKdriverArgs(args);

  const timeout =
    args[0] === "close" ? runtime.timeouts.closeMs : runtime.timeouts.kdriverMs;
  const commandArgs = buildKdriverArgs(runtime, args);

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync("kdriver-cli", commandArgs, {
      cwd: runtime.cwd,
      timeout,
      signal,
      maxBuffer: 2 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as ExecFailureLike;
    stdout = typeof failure.stdout === "string" ? failure.stdout : "";
    stderr = typeof failure.stderr === "string" ? failure.stderr : "";

    if (isMissingCommandError(error)) {
      throw new WebToolError(
        "kdriver-cli is required for web. Install kdriver-cli and ensure it is available on PATH before using web.",
      );
    }

    if (isAbortOrTimeoutError(error) || failure.killed === true) {
      throw new WebToolError(
        `kdriver-cli command timed out or was cancelled before artifacts were trusted: ${args.join(" ")}`,
      );
    }

    const code = failure.code ?? failure.signal ?? "unknown";
    throw new WebToolError(
      `kdriver-cli exited with code ${String(code)} for ${args.join(" ")}. ${formatOutputExcerpts(stdout, stderr)}`,
    );
  }

  if (expectation === "status") {
    return { ok: true, stdout, stderr } as KdriverResult<TExpectation>;
  }

  try {
    return {
      ok: true,
      json: JSON.parse(stdout),
    } as KdriverResult<TExpectation>;
  } catch {
    throw new WebToolError(
      `kdriver-cli provider-format error: expected JSON from ${args.join(" ")}. ${formatOutputExcerpts(stdout, stderr)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(
  source: Record<string, unknown>,
  field: string,
  errorPrefix: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WebToolError(`${errorPrefix}: missing ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export async function assertPathUnderArtifactRoot(
  candidatePath: string,
  runtime: RuntimeContext,
): Promise<string> {
  if (candidatePath.trim().length === 0) {
    throw new WebToolError(
      "Artifact metadata error: snapshot metadata contains a blank artifact path",
    );
  }

  const candidate = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(runtime.artifactRoot, candidatePath);

  if (!isPathInside(runtime.artifactRoot, candidate)) {
    throw new WebToolError(
      `Invariant violation: artifact path outside web artifact root: ${candidate} is not under ${runtime.artifactRoot}`,
    );
  }

  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    throw new WebToolError(
      `Artifact metadata error: artifact path is missing or inaccessible at ${candidate}: ${formatFilesystemError(error)}`,
    );
  }

  if (!isPathInside(runtime.artifactRoot, resolved)) {
    throw new WebToolError(
      `Invariant violation: resolved artifact path outside web artifact root: ${resolved} is not under ${runtime.artifactRoot}`,
    );
  }

  return resolved;
}

function parseSnapshotPage(rawPage: unknown): SnapshotPageMetadata {
  if (!isRecord(rawPage)) {
    throw new WebToolError("Artifact metadata error: missing page metadata");
  }

  const page: SnapshotPageMetadata = {
    title: readStringField(rawPage, "title", "Artifact metadata error"),
    url: readStringField(rawPage, "url", "Artifact metadata error"),
  };

  if (typeof rawPage.selectedTabIndex === "number") {
    page.selectedTabIndex = rawPage.selectedTabIndex;
  }

  return page;
}

export async function captureMarkdown(
  pi: ExtensionAPI,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
  depth?: number,
): Promise<MarkdownArtifact> {
  const args =
    depth === undefined
      ? (["snapshot", "--markdown"] as const)
      : (["snapshot", "--markdown", "--depth", String(depth)] as const);
  const { json } = await runKdriver(
    pi,
    runtime,
    args,
    "json",
    signal,
  );
  if (!isRecord(json)) {
    throw new WebToolError(
      "Artifact metadata error: markdown snapshot provider returned non-object metadata",
    );
  }

  const snapshotPath = await assertPathUnderArtifactRoot(
    readStringField(json, "snapshotPath", "Artifact metadata error"),
    runtime,
  );
  const metadataPath = await assertPathUnderArtifactRoot(
    readStringField(json, "metadataPath", "Artifact metadata error"),
    runtime,
  );

  const snapshotStats = await stat(snapshotPath).catch((error: unknown) => {
    throw new WebToolError(
      `Artifact metadata error: markdown artifact is missing at ${snapshotPath}: ${formatFilesystemError(error)}`,
    );
  });

  return {
    snapshotPath,
    metadataPath,
    size: typeof json.size === "number" ? json.size : snapshotStats.size,
    page: parseSnapshotPage(json.page),
  };
}

function parsePaginationLink(
  value: unknown,
  field: string,
): SearchPaginationLink | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new WebToolError(
      `kdriver-cli provider-format error: pagination.${field} must be object or null`,
    );
  }

  const ref = readStringField(
    value,
    "ref",
    "kdriver-cli provider-format error",
  );
  const link: SearchPaginationLink = { ref };
  const description = optionalString(value.description);
  if (description) {
    link.description = description;
  }
  const url = optionalString(value.href) ?? optionalString(value.url);
  if (url) {
    link.url = url;
  }
  return link;
}

function parseSearchResult(
  raw: RawSearchResult,
  index: number,
): SearchResultItem {
  const title = optionalString(raw.title);
  const url = optionalString(raw.href) ?? optionalString(raw.url);
  if (!title || !url) {
    throw new WebToolError(
      `kdriver-cli provider-format error: result ${index + 1} missing title or url`,
    );
  }

  const item: SearchResultItem = {
    title,
    url,
    body: optionalString(raw.body) ?? optionalString(raw.snippet) ?? "",
  };

  const ref = optionalString(raw.ref);
  if (ref) {
    item.ref = ref;
  }

  return item;
}

export async function loadSearchResults(
  pi: ExtensionAPI,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<SearchData> {
  const { json } = await runKdriver(
    pi,
    runtime,
    ["snapshot", "--search-results"],
    "json",
    signal,
  );
  if (!isRecord(json)) {
    throw new WebToolError(
      "kdriver-cli provider-format error: search results provider returned non-object JSON",
    );
  }

  const status = optionalString(json.status);
  if (status !== "searchResults") {
    throw new WebToolError(
      `kdriver-cli provider-format error: expected searchResults status, got ${status ?? "<missing>"}`,
    );
  }

  const engine = optionalString(json.engine);
  if (engine !== "google") {
    throw new WebToolError(
      `kdriver-cli provider-format error: expected google search results, got ${engine ?? "<missing>"}`,
    );
  }

  if (!Array.isArray(json.results)) {
    throw new WebToolError(
      "kdriver-cli provider-format error: search results missing results array",
    );
  }

  const pagination = isRecord(json.pagination) ? json.pagination : {};
  return {
    engine: "google",
    page: isRecord(json.page) ? parseSnapshotPage(json.page) : undefined,
    results: json.results.map((result, index) => {
      if (!isRecord(result)) {
        throw new WebToolError(
          `kdriver-cli provider-format error: result ${index + 1} must be an object`,
        );
      }
      return parseSearchResult(result, index);
    }),
    pagination: {
      next: parsePaginationLink(pagination.next, "next"),
      previous: parsePaginationLink(pagination.previous, "previous"),
    },
  };
}

function isGoogleSearchUrl(url: string | undefined): boolean {
  if (!url) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return (
      /(^|\.)google\.[^./]+$/.test(parsed.hostname) &&
      parsed.pathname === "/search"
    );
  } catch {
    return false;
  }
}

export async function loadCurrentGoogleSearchPage(
  pi: ExtensionAPI,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<CurrentGoogleSearchPage> {
  const searchData = await loadSearchResults(pi, runtime, signal);
  if (!isGoogleSearchUrl(searchData.page?.url)) {
    throw new WebToolError(
      "web search_next requires current page to be a Google search results page before clicking next",
    );
  }

  if (!searchData.pagination.next?.ref) {
    throw new WebToolError(
      "web search_next requires current Google search page to expose pagination.next.ref before clicking next",
    );
  }

  return searchData as CurrentGoogleSearchPage;
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= PREVIEW_CHARS) {
    return compact;
  }
  return `${compact.slice(0, PREVIEW_CHARS)}…`;
}

function firstSearchRefs(results: SearchResultItem[]): string[] {
  return results
    .slice(0, FIRST_ITEMS_LIMIT)
    .flatMap((result) => (result.ref ? [result.ref] : []));
}

function firstSearchTitles(results: SearchResultItem[]): string[] {
  return results
    .slice(0, FIRST_ITEMS_LIMIT)
    .map((result) => truncatePreview(result.title));
}

export function formatPageResult(
  action: string,
  artifact: MarkdownArtifact,
  runtime: RuntimeContext,
): FormattedWebResult {
  const title = truncatePreview(artifact.page.title);
  const url = artifact.page.url;
  const content = [
    `web ${action} page captured`,
    `Title: ${title}`,
    `URL: ${url}`,
    `Markdown artifact: ${artifact.snapshotPath}`,
    `Metadata artifact: ${artifact.metadataPath}`,
  ].join("\n");

  return {
    content: [{ type: "text", text: content }],
    details: {
      action,
      session: runtime.sessionName,
      title,
      url,
      preview: truncatePreview(`${title} ${url}`),
      snapshotPath: artifact.snapshotPath,
      metadataPath: artifact.metadataPath,
      size: artifact.size,
      selectedTabIndex: artifact.page.selectedTabIndex,
    },
  };
}

export function formatSearchResult(
  action: string,
  searchData: SearchData,
  artifact: MarkdownArtifact,
  runtime: RuntimeContext,
): FormattedWebResult {
  const firstRefs = firstSearchRefs(searchData.results);
  const firstTitles = firstSearchTitles(searchData.results);
  const pageTitle = truncatePreview(
    searchData.page?.title ?? artifact.page.title,
  );
  const pageUrl = searchData.page?.url ?? artifact.page.url;
  const preview = truncatePreview(
    searchData.results
      .slice(0, FIRST_ITEMS_LIMIT)
      .map((result) => [result.title, result.body].filter(Boolean).join(" — "))
      .join(" | "),
  );

  const content = [
    `web ${action} search captured`,
    `Title: ${pageTitle}`,
    `URL: ${pageUrl}`,
    `Results: ${searchData.results.length}`,
    `First refs: ${firstRefs.length > 0 ? firstRefs.join(", ") : "none"}`,
    `First titles: ${firstTitles.length > 0 ? firstTitles.join(" | ") : "none"}`,
    `Pagination: next=${searchData.pagination.next ? "yes" : "no"}, previous=${searchData.pagination.previous ? "yes" : "no"}`,
    `Markdown artifact: ${artifact.snapshotPath}`,
    `Metadata artifact: ${artifact.metadataPath}`,
  ].join("\n");

  return {
    content: [{ type: "text", text: content }],
    details: {
      action,
      session: runtime.sessionName,
      engine: searchData.engine,
      title: pageTitle,
      url: pageUrl,
      resultCount: searchData.results.length,
      firstRefs,
      firstTitles,
      hasNextPage: Boolean(searchData.pagination.next),
      hasPreviousPage: Boolean(searchData.pagination.previous),
      nextRef: searchData.pagination.next?.ref,
      previousRef: searchData.pagination.previous?.ref,
      preview,
      snapshotPath: artifact.snapshotPath,
      metadataPath: artifact.metadataPath,
      size: artifact.size,
    },
  };
}

function formatBlockedSearchWarning(
  input: SearchInput,
  artifact: MarkdownArtifact,
  runtime: RuntimeContext,
  providerError: unknown,
): FormattedWebResult {
  const title = truncatePreview(artifact.page.title);
  const url = artifact.page.url;
  const content = [
    "web search warning: Google did not expose parseable search results",
    `Query: ${input.query}`,
    `Title: ${title}`,
    `URL: ${url}`,
    `Open noVNC to handle consent/CAPTCHA/interstitial: ${NOVNC_URL}`,
    `Markdown artifact: ${artifact.snapshotPath}`,
    `Metadata artifact: ${artifact.metadataPath}`,
  ].join("\n");

  return {
    content: [{ type: "text", text: content }],
    details: {
      action: input.action,
      status: "warning",
      reason: "blocked_or_unparseable_search_results",
      session: runtime.sessionName,
      query: input.query,
      title,
      url,
      resultCount: 0,
      firstRefs: [],
      firstTitles: [],
      hasNextPage: false,
      hasPreviousPage: false,
      noVncUrl: NOVNC_URL,
      providerError: formatFilesystemError(providerError),
      snapshotPath: artifact.snapshotPath,
      metadataPath: artifact.metadataPath,
      size: artifact.size,
    },
  };
}

function buildGoogleSearchUrl(input: SearchInput): string {
  const url = new URL(GOOGLE_SEARCH_URL);
  url.searchParams.set("q", input.query);
  return url.toString();
}

function renderValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return truncatePreview(trimmed);
}

function getDetails(result: WebRenderResult): WebResultDetails | undefined {
  return isRecord(result.details) ? result.details : undefined;
}

function reuseText(context: WebRenderContext): Text {
  return context.lastComponent instanceof Text
    ? context.lastComponent
    : new Text("", 0, 0);
}

function renderActionSummary(
  args: unknown,
  theme: WebTheme,
): string {
  const record = isRecord(args) ? args : {};
  const action = renderValue(record.action) ?? "<action>";
  let text = theme.fg("toolTitle", theme.bold("web "));
  text += theme.fg("accent", action);

  const query = renderValue(record.query);
  const url = renderValue(record.url);
  const ref = renderValue(record.ref);
  if (query) {
    text += " " + theme.fg("dim", `query=\"${query}\"`);
  }
  if (url) {
    text += " " + theme.fg("dim", `url=${url}`);
  }
  if (ref) {
    text += " " + theme.fg("dim", `ref=${ref}`);
  }
  return text;
}

function renderCallSummary(
  args: unknown,
  theme: WebTheme,
  context: WebRenderContext,
): Text {
  const text = reuseText(context);
  text.setText(renderActionSummary(args, theme));
  return text;
}

function renderStringList(value: unknown): string {
  if (!Array.isArray(value)) {
    return "none";
  }
  const items = value.flatMap((item) => {
    const rendered = renderValue(item);
    return rendered ? [rendered] : [];
  });
  return items.length > 0 ? items.join(", ") : "none";
}

function renderStatusLabel(
  details: WebResultDetails | undefined,
  isError: boolean | undefined,
): "success" | "warning" | "failure" {
  if (isError) {
    return "failure";
  }
  return details?.status === "warning" ? "warning" : "success";
}

function renderResultSummary(
  result: WebRenderResult,
  options: WebRenderOptions,
  theme: WebTheme,
  context: WebRenderContext,
): Text {
  const text = reuseText(context);
  if (options.isPartial) {
    text.setText(theme.fg("warning", "web running"));
    return text;
  }

  const details = getDetails(result);
  const status = renderStatusLabel(details, context.isError);
  const color =
    status === "failure" ? "error" : status === "warning" ? "warning" : "success";
  const contextArgs = isRecord(context.args) ? context.args : {};
  const action = renderValue(details?.action ?? contextArgs.action) ?? "web";
  const parts = [theme.fg(color, `web ${status}: ${action}`)];

  const title = renderValue(details?.title);
  const url = renderValue(details?.url);
  const session = renderValue(details?.session);
  const snapshotPath = renderValue(details?.snapshotPath);
  const metadataPath = renderValue(details?.metadataPath);
  const noVncUrl = renderValue(details?.noVncUrl);

  if (typeof details?.resultCount === "number") {
    parts.push(theme.fg("muted", `results=${details.resultCount}`));
  }
  if (typeof details?.closed === "boolean") {
    parts.push(theme.fg("muted", `closed=${details.closed ? "yes" : "no"}`));
  }
  if (title) {
    parts.push(theme.fg("dim", `title=${title}`));
  }
  if (url) {
    parts.push(theme.fg("dim", `url=${url}`));
  }
  if (Array.isArray(details?.firstRefs)) {
    parts.push(theme.fg("dim", `refs=${renderStringList(details.firstRefs)}`));
  }
  if (typeof details?.hasNextPage === "boolean") {
    parts.push(theme.fg("dim", `next=${details.hasNextPage ? "yes" : "no"}`));
  }
  if (noVncUrl) {
    parts.push(theme.fg("warning", `noVNC=${noVncUrl}`));
  }
  if (snapshotPath) {
    parts.push(theme.fg("dim", `markdown=${snapshotPath}`));
  }
  if (options.expanded) {
    if (metadataPath) {
      parts.push(theme.fg("dim", `metadata=${metadataPath}`));
    }
    if (session) {
      parts.push(theme.fg("dim", `session=${session}`));
    }
  }
  if (!details) {
    parts.push(theme.fg("muted", "details unavailable"));
  }

  text.setText(parts.join("\n"));
  return text;
}

async function captureBlockedSearchWarning(
  pi: ExtensionAPI,
  input: SearchInput,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
  providerError: unknown,
): Promise<FormattedWebResult> {
  try {
    const artifact = await captureMarkdown(pi, runtime, signal);
    return formatBlockedSearchWarning(input, artifact, runtime, providerError);
  } catch (markdownError) {
    throw new WebToolError(
      `web search blocked by Google consent/CAPTCHA/interstitial and no usable Markdown artifact could be captured. Search provider: ${formatFilesystemError(providerError)}. Markdown provider: ${formatFilesystemError(markdownError)}`,
    );
  }
}

function enqueueAction<T>(operation: () => Promise<T>): Promise<T> {
  const run = actionQueue.then(operation, operation);
  actionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureSharedProfileTemplate(
  pi: ExtensionAPI,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<void> {
  const profiles = await runKdriver(
    pi,
    runtime,
    ["profile-list"],
    "status",
    signal,
  );
  const hasShared = profiles.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .includes("shared");
  if (hasShared) {
    return;
  }

  await runKdriver(
    pi,
    runtime,
    ["profile-template-create", "shared"],
    "status",
    signal,
  );
}

async function gotoPage(
  pi: ExtensionAPI,
  input: GotoInput,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<FormattedWebResult> {
  await ensureSharedProfileTemplate(pi, runtime, signal);
  await runKdriver(
    pi,
    runtime,
    ["open", "--profile-template", "shared", input.url],
    "status",
    signal,
  );
  hasExtensionOwnedSession = true;
  const artifact = await captureMarkdown(
    pi,
    runtime,
    signal,
    KDRIVER_MARKDOWN_PAGE_DEPTH,
  );
  return formatPageResult(input.action, artifact, runtime);
}

async function searchGoogle(
  pi: ExtensionAPI,
  input: SearchInput,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<FormattedWebResult> {
  const searchUrl = buildGoogleSearchUrl(input);
  await ensureSharedProfileTemplate(pi, runtime, signal);
  await runKdriver(
    pi,
    runtime,
    ["open", "--profile-template", "shared", searchUrl],
    "status",
    signal,
  );
  hasExtensionOwnedSession = true;

  let searchData: SearchData;
  try {
    searchData = await loadSearchResults(pi, runtime, signal);
  } catch (error) {
    return captureBlockedSearchWarning(pi, input, runtime, signal, error);
  }

  if (searchData.results.length === 0) {
    return captureBlockedSearchWarning(
      pi,
      input,
      runtime,
      signal,
      new WebToolError(
        "kdriver-cli provider-format error: Google search results were empty",
      ),
    );
  }

  const artifact = await captureMarkdown(pi, runtime, signal);
  return formatSearchResult(input.action, searchData, artifact, runtime);
}

async function clickRef(
  pi: ExtensionAPI,
  input: ClickInput,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<FormattedWebResult> {
  await runKdriver(pi, runtime, ["click", input.ref], "status", signal);
  hasExtensionOwnedSession = true;
  const artifact = await captureMarkdown(
    pi,
    runtime,
    signal,
    KDRIVER_MARKDOWN_PAGE_DEPTH,
  );
  return formatPageResult(input.action, artifact, runtime);
}

async function searchNext(
  pi: ExtensionAPI,
  input: SearchNextInput,
  runtime: RuntimeContext,
  signal: AbortSignal | undefined,
): Promise<FormattedWebResult> {
  const currentSearchData = await loadCurrentGoogleSearchPage(
    pi,
    runtime,
    signal,
  );
  const nextUrl = currentSearchData.pagination.next.url
    ? new URL(currentSearchData.pagination.next.url, currentSearchData.page?.url ?? GOOGLE_SEARCH_URL).toString()
    : undefined;
  if (nextUrl) {
    await runKdriver(
      pi,
      runtime,
      ["goto", nextUrl],
      "status",
      signal,
    );
  } else {
    await runKdriver(
      pi,
      runtime,
      ["click", currentSearchData.pagination.next.ref],
      "status",
      signal,
    );
  }
  hasExtensionOwnedSession = true;
  const refreshedSearchData = await loadSearchResults(pi, runtime, signal);
  const artifact = await captureMarkdown(pi, runtime, signal);
  return formatSearchResult(input.action, refreshedSearchData, artifact, runtime);
}

export async function closeSession(
  pi: ExtensionAPI,
  runtime: RuntimeContext,
  explicit: boolean,
  signal: AbortSignal | undefined,
): Promise<CloseResult> {
  try {
    await runKdriver(pi, runtime, CLOSE_COMMAND, "status", signal);
  } catch (error) {
    if (explicit) {
      throw new WebToolError(
        `web close failed for session ${runtime.sessionName}: ${formatFilesystemError(error)}`,
      );
    }
    throw error;
  }

  hasExtensionOwnedSession = false;

  return {
    content: [
      {
        type: "text",
        text: `web close completed\nSession: ${runtime.sessionName}`,
      },
    ],
    details: {
      action: "close",
      session: runtime.sessionName,
      closed: true,
    },
  };
}

function notifyCleanupWarning(
  ctx: ExtensionContext,
  reason: string,
  error: unknown,
): void {
  const message = `web background cleanup warning during ${reason}: ${formatFilesystemError(error)}`;
  const maybeUi = (
    ctx as {
      ui?: {
        notify?: (message: string, type?: "info" | "warning" | "error") => void;
      };
    }
  ).ui;
  if (typeof maybeUi?.notify === "function") {
    maybeUi.notify(message, "warning");
    return;
  }
  console.warn(message);
}

async function cleanupSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  reason: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  return enqueueAction(async () => {
    if (!hasExtensionOwnedSession) {
      return;
    }

    try {
      const runtime = await getRuntimeContext(ctx);
      await closeSession(pi, runtime, false, signal);
    } catch (error) {
      notifyCleanupWarning(ctx, reason, error);
    }
  });
}

async function executeWebAction(
  pi: ExtensionAPI,
  input: WebActionInput,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
) {
  return enqueueAction(async () => {
    const runtime = await getRuntimeContext(ctx);
    switch (input.action) {
      case "goto":
        return gotoPage(pi, input, runtime, signal);
      case "search":
        return searchGoogle(pi, input, runtime, signal);
      case "close":
        return closeSession(pi, runtime, true, signal);
      case "click":
        return clickRef(pi, input, runtime, signal);
      case "search_next":
        return searchNext(pi, input, runtime, signal);
    }
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web",
    label: "Web",
    description:
      "Use a browser-backed kdriver web session for search, navigation, clicks, search pagination, and closing the session.",
    promptSnippet:
      "Use web for browser search/navigation/clicks; web returns compact summaries and artifact paths instead of full page dumps.",
    promptGuidelines: [
      "Use web when the task needs browser-backed search, page navigation, link clicking, Google search pagination, or closing the browser session.",
      "web keeps output compact: full page/search content is written to Markdown artifacts and tool results include artifact paths instead of inlining large content.",
      "For web search use action=search with query; for browser navigation use action=goto with an absolute http(s) url; for clicking use action=click with a kdriver ref such as e142.",
    ],
    parameters: webToolParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = parseActionInput(params);
      return executeWebAction(pi, input, ctx, signal);
    },
    renderCall(args, theme, context) {
      return renderCallSummary(args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderResultSummary(result, options, theme, context);
    },
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "reload") {
      return;
    }
    if (SHUTDOWN_CLEANUP_REASONS.has(event.reason)) {
      await cleanupSession(
        pi,
        ctx,
        `session_shutdown:${event.reason}`,
        undefined,
      );
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    await cleanupSession(pi, ctx, "session_before_compact", event.signal);
  });
}
