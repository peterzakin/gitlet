import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function getRepoInfo({
  bucket = process.env.GIT_S3_BUCKET,
  repo,
  region = process.env.GIT_S3_REGION ?? "us-east-1",
  endpoint = process.env.GIT_R2_ENDPOINT,
  publicUrl = process.env.GIT_R2_PUBLIC_URL,
}: {
  bucket?: string;
  repo: string;
  region?: string;
  endpoint?: string;
  publicUrl?: string;
}): Promise<{
  exists: boolean;
  cloneUrl: string;
  sizeBytes: number;
  lastModified: Date;
} | null> {
  if (!bucket) throw new Error("bucket is required (pass it or set GIT_S3_BUCKET)");
  const client = new S3Client({
    region: endpoint ? "auto" : region,
    ...(endpoint && {
      endpoint,
      forcePathStyle: true,
    }),
  });
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

  let cloneUrl: string;
  if (publicUrl) {
    const base = publicUrl.replace(/\/+$/, "");
    cloneUrl = `${base}/${repo}.git`;
  } else if (endpoint) {
    const base = endpoint.replace(/\/+$/, "");
    cloneUrl = `${base}/${bucket}/${repo}.git`;
  } else {
    cloneUrl = `https://${bucket}.s3.amazonaws.com/${repo}.git`;
  }

  return {
    exists: true,
    cloneUrl,
    sizeBytes: totalSize,
    lastModified: maxLastModified!,
  };
}
