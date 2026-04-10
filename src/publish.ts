import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const execFileAsync = promisify(execFile);

function resolveRegion(region?: string): string {
  return region ?? process.env.GIT_S3_REGION ?? "us-east-1";
}

async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, { cwd });
  } catch (err: any) {
    throw new Error(`git ${args.join(" ")} failed: ${err.stderr ?? err.message}`);
  }
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDir(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

export async function publishRepo({
  bucket,
  repoPath,
  repo,
  region,
}: {
  bucket: string;
  repoPath: string;
  repo: string;
  region?: string;
}): Promise<{ cloneUrl: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gitlet-"));
  const bareDir = path.join(tmpDir, "repo.git");

  try {
    // 1-2. Clone as bare
    await runGit(["clone", "--bare", repoPath, bareDir], tmpDir);

    // 3. Repack into single packfile
    await runGit(["repack", "-a", "-d"], bareDir);

    // 4. Generate dumb HTTP index files
    await runGit(["update-server-info"], bareDir);

    // 5. Sync to S3
    const client = new S3Client({ region: resolveRegion(region) });
    const prefix = `${repo}.git/`;

    // Collect all local files with their relative paths
    const allFiles = await walkDir(bareDir);
    const localEntries = new Map<string, string>(); // relative key -> absolute path
    for (const absPath of allFiles) {
      const relPath = path.relative(bareDir, absPath);
      localEntries.set(relPath, absPath);
    }

    // Upload objects/ first (content-addressed, safe to upload first)
    const objectKeys: string[] = [];
    const pointerKeys: string[] = [];
    for (const relPath of localEntries.keys()) {
      if (relPath.startsWith("objects/")) {
        objectKeys.push(relPath);
      } else {
        pointerKeys.push(relPath);
      }
    }

    // Upload objects
    for (const key of objectKeys) {
      const body = await fs.promises.readFile(localEntries.get(key)!);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${key}`,
          Body: body,
        })
      );
    }

    // Upload pointer files (info/refs, HEAD, objects/info/packs)
    for (const key of pointerKeys) {
      const body = await fs.promises.readFile(localEntries.get(key)!);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${key}`,
          Body: body,
        })
      );
    }

    // Delete stale objects under the prefix
    const remoteKeys = new Set<string>();
    let continuationToken: string | undefined;
    while (true) {
      const listResult = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of listResult.Contents ?? []) {
        if (obj.Key) {
          remoteKeys.add(obj.Key);
        }
      }
      if (!listResult.IsTruncated) break;
      continuationToken = listResult.NextContinuationToken;
    }

    const localS3Keys = new Set(
      [...localEntries.keys()].map((k) => `${prefix}${k}`)
    );
    const staleKeys = [...remoteKeys].filter((k) => !localS3Keys.has(k));

    if (staleKeys.length > 0) {
      // Batch delete in groups of 1000 (S3 limit)
      for (let i = 0; i < staleKeys.length; i += 1000) {
        const batch = staleKeys.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          })
        );
      }
    }

    return { cloneUrl: `https://${bucket}.s3.amazonaws.com/${repo}.git` };
  } finally {
    // 6. Clean up temp directory
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}
