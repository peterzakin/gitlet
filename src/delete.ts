import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { createS3Client } from "./client.js";

export async function deleteRepo({
  bucket,
  repo,
  region,
}: {
  bucket: string;
  repo: string;
  region?: string;
}): Promise<void> {
  const client = createS3Client(region);
  const prefix = `${repo}.git/`;

  let continuationToken: string | undefined;
  while (true) {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const objects = (listResult.Contents ?? [])
      .filter((o) => o.Key)
      .map((o) => ({ Key: o.Key! }));

    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        })
      );
    }

    if (!listResult.IsTruncated) break;
    continuationToken = listResult.NextContinuationToken;
  }
}
