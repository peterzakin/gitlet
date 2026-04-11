import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createS3Client } from "./client.js";

export async function listRepos({
  bucket,
  region,
}: {
  bucket: string;
  region?: string;
}): Promise<string[]> {
  const client = createS3Client(region);

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
