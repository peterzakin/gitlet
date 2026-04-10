import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function listRepos({
  bucket = process.env.GIT_S3_BUCKET,
  region = process.env.GIT_S3_REGION ?? "us-east-1",
  endpoint = process.env.GIT_R2_ENDPOINT,
}: {
  bucket?: string;
  region?: string;
  endpoint?: string;
} = {}): Promise<string[]> {
  if (!bucket) throw new Error("bucket is required (pass it or set GIT_S3_BUCKET)");
  const client = new S3Client({
    region: endpoint ? "auto" : region,
    ...(endpoint && {
      endpoint,
      forcePathStyle: true,
    }),
  });

  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "",
      Delimiter: "/",
    })
  );

  const repos: string[] = [];
  for (const prefix of result.CommonPrefixes ?? []) {
    if (prefix.Prefix && prefix.Prefix.endsWith(".git/")) {
      repos.push(prefix.Prefix.slice(0, -".git/".length));
    }
  }

  return repos;
}
