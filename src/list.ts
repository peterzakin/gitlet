import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function listRepos({
  bucket,
  region,
}: {
  bucket: string;
  region?: string;
}): Promise<string[]> {
  const client = new S3Client({ region: region ?? process.env.GIT_S3_REGION ?? "us-east-1" });

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
