import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

interface RevisionStatus {
  state: string;
  distributionChannels?: { crxVersion: string }[];
}

interface ItemStatus {
  publishedItemRevisionStatus?: RevisionStatus;
  submittedItemRevisionStatus?: RevisionStatus;
  lastAsyncUploadState?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before enabling Chrome Web Store publishing.`);
  return value;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${requiredEnv("CWS_ACCESS_TOKEN")}`);
  const response = await fetch(`https://chromewebstore.googleapis.com${path}`, {
    ...init,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${await response.text()}`);
  return (await response.json()) as T;
}

// Chrome treats missing version components as zero.
function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function submit(version: string): Promise<void> {
  const zip = `bgav-${version}.zip`;
  const manifest = JSON.parse(
    execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }),
  ) as {
    version: string;
  };
  if (manifest.version !== version)
    throw new Error(`Expected ${version} in ${zip}, found ${manifest.version}.`);

  const publisher = encodeURIComponent(requiredEnv("CWS_PUBLISHER_ID"));
  const item = encodeURIComponent(requiredEnv("CWS_ITEM_ID"));
  const resource = `/v2/publishers/${publisher}/items/${item}`;
  const statusPath = `${resource}:fetchStatus`;
  const status = await request<ItemStatus>(statusPath);
  const published = status.publishedItemRevisionStatus?.distributionChannels ?? [];
  const submitted = status.submittedItemRevisionStatus;

  if (published.some(({ crxVersion }) => compareVersions(crxVersion, version) === 0)) {
    console.log(`Chrome Web Store already published ${version}.`);
    return;
  }
  if (published.length === 0)
    throw new Error("Publish the first version in the Developer Dashboard.");
  if (published.some(({ crxVersion }) => compareVersions(crxVersion, version) > 0)) {
    throw new Error(`Chrome Web Store already has a version newer than ${version}.`);
  }
  if (submitted?.state === "PENDING_REVIEW" || submitted?.state === "STAGED") {
    if (
      submitted.state === "PENDING_REVIEW" &&
      submitted.distributionChannels?.some(({ crxVersion }) => crxVersion === version)
    ) {
      console.log(`Chrome Web Store already has ${version} in review.`);
      return;
    }
    throw new Error(
      `Chrome Web Store has an active submission (${submitted.state}). Retry after it settles.`,
    );
  }
  if (status.lastAsyncUploadState === "IN_PROGRESS") {
    throw new Error("Chrome Web Store has an upload in progress. Retry after it finishes.");
  }

  const upload = await request<{ uploadState: string; crxVersion?: string }>(
    `/upload${resource}:upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: await readFile(zip),
    },
  );
  let state = upload.uploadState;
  for (let attempt = 0; state === "IN_PROGRESS" && attempt < 24; attempt++) {
    await setTimeout(5_000);
    state = (await request<ItemStatus>(statusPath)).lastAsyncUploadState ?? "NOT_FOUND";
  }
  if (state !== "SUCCEEDED") throw new Error(`Chrome Web Store upload ended with state ${state}.`);
  if (upload.crxVersion !== undefined && upload.crxVersion !== version) {
    throw new Error(`Chrome Web Store received ${upload.crxVersion}, expected ${version}.`);
  }

  const submission = await request<{ state: string; warningInfo?: unknown }>(
    `${resource}:publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
    },
  );
  if (!["PENDING_REVIEW", "PUBLISHED", "PUBLISHED_TO_TESTERS"].includes(submission.state)) {
    throw new Error(`Chrome Web Store returned submission state ${submission.state}.`);
  }
  console.log(`Chrome Web Store accepted ${version} (${submission.state}).`);
  if (submission.warningInfo) console.warn(JSON.stringify(submission.warningInfo));
}

const version = process.argv[2];
if (!version) throw new Error("Usage: node scripts/publish-chrome.ts <version>");
await submit(version);
