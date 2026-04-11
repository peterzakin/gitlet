import { S3Client } from "@aws-sdk/client-s3";

export function resolveRegion(region?: string): string {
  return region ?? process.env.AWS_REGION ?? "us-east-1";
}

export function createS3Client(region?: string): S3Client {
  const resolved = resolveRegion(region);
  const endpoint = process.env.S3_ENDPOINT;

  return new S3Client({
    region: resolved,
    ...(endpoint && { endpoint, forcePathStyle: true }),
  });
}
