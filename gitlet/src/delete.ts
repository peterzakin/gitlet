import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

function getClient(): S3Client {
  return new S3Client({ region: process.env.GIT_S3_REGION ?? "us-east-1" });
}

export async function deleteRepo({
  bucket,
  repo,
}: {
  bucket: string;
  repo: string;
}): Promise<void> {
  const client = getClient();
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
