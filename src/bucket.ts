import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  type ObjectIdentifier,
  type BucketLocationConstraint,
} from "@aws-sdk/client-s3";

function getClient(region?: string): S3Client {
  return new S3Client({ region: region ?? process.env.GIT_S3_REGION ?? "us-east-1" });
}

export async function setupBucket({
  bucket,
  region,
}: {
  bucket: string;
  region?: string;
}): Promise<{ bucket: string; region: string }> {
  const resolvedRegion = region ?? process.env.GIT_S3_REGION ?? "us-east-1";
  const client = getClient(resolvedRegion);

  // 1. Create bucket (idempotent)
  try {
    await client.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(resolvedRegion !== "us-east-1" && {
          CreateBucketConfiguration: { LocationConstraint: resolvedRegion as BucketLocationConstraint },
        }),
      })
    );
  } catch (err: any) {
    if (err.name === "BucketAlreadyOwnedByYou") {
      // Bucket exists and is ours — continue
    } else if (err.name === "BucketAlreadyExists") {
      throw new Error(
        `Bucket "${bucket}" already exists and is owned by a different AWS account`
      );
    } else {
      throw err;
    }
  }

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

  return { bucket, region: resolvedRegion };
}

export async function destroyBucket({
  bucket,
}: {
  bucket: string;
}): Promise<void> {
  const client = getClient();

  // List and delete all object versions (including delete markers)
  try {
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

    // Delete the bucket
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch (err: any) {
    if (err.name === "NoSuchBucket") {
      return; // Bucket doesn't exist — no-op
    }
    throw err;
  }
}
