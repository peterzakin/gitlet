import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  type ObjectIdentifier,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";

function getClient(options: { region: string; endpoint?: string }): S3Client {
  return new S3Client({
    region: options.region,
    ...(options.endpoint && {
      endpoint: options.endpoint,
      forcePathStyle: true,
    }),
  });
}

export async function setupBucket({
  bucket = process.env.GIT_S3_BUCKET,
  region = process.env.GIT_S3_REGION ?? "us-east-1",
  endpoint = process.env.GIT_R2_ENDPOINT,
}: {
  bucket?: string;
  region?: string;
  endpoint?: string;
} = {}): Promise<{ bucket: string; region: string }> {
  if (!bucket) throw new Error("bucket is required (pass it or set GIT_S3_BUCKET)");
  const resolvedRegion = endpoint ? "auto" : region;
  const client = getClient({ region: resolvedRegion, endpoint });

  // 1. Create bucket (idempotent)
  try {
    await client.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(!endpoint && resolvedRegion !== "us-east-1" && {
          CreateBucketConfiguration: { LocationConstraint: resolvedRegion as BucketLocationConstraint },
        }),
      })
    );
  } catch (err: any) {
    if (err.name === "BucketAlreadyOwnedByYou") {
      // Bucket exists and is ours — continue
    } else if (err.name === "BucketAlreadyExists") {
      throw new Error(
        `Bucket "${bucket}" already exists and is owned by a different account`
      );
    } else {
      throw err;
    }
  }

  // Steps 2-5 are AWS-specific and not supported by S3-compatible providers like R2
  if (!endpoint) {
    // 2. Disable Block Public Access
    await client.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          IgnorePublicAcls: false,
          BlockPublicPolicy: false,
          RestrictPublicBuckets: false,
        },
      })
    );

    // 3. Apply public-read bucket policy
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucket}/*`,
        },
      ],
    };
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify(policy),
      })
    );

    // 4. Enable versioning
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: "Enabled" },
      })
    );

    // 5. Lifecycle rule: delete non-current versions after 30 days
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "delete-old-versions",
              Status: "Enabled",
              NoncurrentVersionExpiration: { NoncurrentDays: 30 },
              Filter: { Prefix: "" },
            },
          ],
        },
      })
    );
  }

  return { bucket, region: resolvedRegion };
}

export async function destroyBucket({
  bucket = process.env.GIT_S3_BUCKET,
  region = process.env.GIT_S3_REGION ?? "us-east-1",
  endpoint = process.env.GIT_R2_ENDPOINT,
}: {
  bucket?: string;
  region?: string;
  endpoint?: string;
} = {}): Promise<void> {
  if (!bucket) throw new Error("bucket is required (pass it or set GIT_S3_BUCKET)");
  const resolvedRegion = endpoint ? "auto" : region;
  const client = getClient({ region: resolvedRegion, endpoint });

  try {
    if (endpoint) {
      // S3-compatible providers may not have versioning enabled — use simple list+delete
      let continuationToken: string | undefined;
      while (true) {
        const listResult = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken,
          })
        );

        const objects: ObjectIdentifier[] = (listResult.Contents ?? [])
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
    } else {
      // AWS S3: list and delete all object versions (including delete markers)
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;

      while (true) {
        const listResult = await client.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          })
        );

        const objects: ObjectIdentifier[] = [];

        for (const v of listResult.Versions ?? []) {
          if (v.Key && v.VersionId) {
            objects.push({ Key: v.Key, VersionId: v.VersionId });
          }
        }
        for (const dm of listResult.DeleteMarkers ?? []) {
          if (dm.Key && dm.VersionId) {
            objects.push({ Key: dm.Key, VersionId: dm.VersionId });
          }
        }

        if (objects.length > 0) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects, Quiet: true },
            })
          );
        }

        if (!listResult.IsTruncated) break;
        keyMarker = listResult.NextKeyMarker;
        versionIdMarker = listResult.NextVersionIdMarker;
      }
    }

    // Delete the bucket
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch (err: any) {
    if (err.name === "NoSuchBucket") {
      return; // Bucket doesn't exist — no-op
    }
    throw err;
  }
}
