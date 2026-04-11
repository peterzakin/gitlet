import { S3Client } from "@aws-sdk/client-s3";

export function resolveRegion(region?: string): string {
  return region ?? process.env.AWS_REGION ?? "us-east-1";
}

export function createS3Client(region?: string): S3Client {
  const resolved = resolveRegion(region);

  const accountId = process.env.CF_ACCOUNT_ID;
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;

  const endpoint =
    process.env.S3_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  const credentials =
    r2AccessKey && r2SecretKey
      ? { accessKeyId: r2AccessKey, secretAccessKey: r2SecretKey }
      : undefined;

  return new S3Client({
    region: resolved,
    ...(endpoint && { endpoint, forcePathStyle: true }),
    ...(credentials && { credentials }),
  });
}
