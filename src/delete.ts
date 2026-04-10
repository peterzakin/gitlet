import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

export async function deleteRepo({
  bucket = process.env.GIT_S3_BUCKET,
  repo,
  region = process.env.GIT_S3_REGION ?? "us-east-1",
  endpoint = process.env.GIT_R2_ENDPOINT,
}: {
  bucket?: string;
  repo: string;
  region?: string;
  endpoint?: string;
}): Promise<void> {
  if (!bucket) throw new Error("bucket is required (pass it or set GIT_S3_BUCKET)");
  const client = new S3Client({
    region: endpoint ? "auto" : region,
    ...(endpoint && {
      endpoint,
      forcePathStyle: true,
    }),
  });
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
