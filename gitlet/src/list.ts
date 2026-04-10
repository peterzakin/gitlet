import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

function getClient(): S3Client {
  return new S3Client({ region: process.env.GIT_S3_REGION ?? "us-east-1" });
}

export async function listRepos({
  bucket,
}: {
  bucket: string;
}): Promise<string[]> {
  const client = getClient();

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
