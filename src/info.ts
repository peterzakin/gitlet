import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createS3Client } from "./client.js";

export async function getRepoInfo({
  bucket,
  repo,
  region,
}: {
  bucket: string;
  repo: string;
  region?: string;
}): Promise<{
  exists: boolean;
  cloneUrl: string;
  sizeBytes: number;
  lastModified: Date;
} | null> {
  const client = createS3Client(region);
  const prefix = `${repo}.git/`;

  let totalSize = 0;
  let maxLastModified: Date | null = null;
  let objectCount = 0;
  let continuationToken: string | undefined;

  while (true) {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of result.Contents ?? []) {
      objectCount++;
      totalSize += obj.Size ?? 0;
      if (obj.LastModified) {
        if (!maxLastModified || obj.LastModified > maxLastModified) {
          maxLastModified = obj.LastModified;
        }
      }
    }

    if (!result.IsTruncated) break;
    continuationToken = result.NextContinuationToken;
  }

  if (objectCount === 0) return null;

  return {
    exists: true,
    cloneUrl: `https://${bucket}.s3.amazonaws.com/${repo}.git`,
    sizeBytes: totalSize,
    lastModified: maxLastModified!,
  };
}
