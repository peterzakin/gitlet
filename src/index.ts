export { setupBucket, destroyBucket } from "./bucket.js";
export { publishToS3, publishToR2 } from "./publish.js";
export { deleteRepo } from "./delete.js";
export { listRepos } from "./list.js";
export { getRepoInfo } from "./info.js";

import { setupBucket, destroyBucket } from "./bucket.js";
import { publishToS3, publishToR2 } from "./publish.js";
import { deleteRepo } from "./delete.js";
import { listRepos } from "./list.js";
import { getRepoInfo } from "./info.js";

export interface S3Options {
  /** S3 bucket name. Falls back to GIT_S3_BUCKET env var. */
  bucket?: string;
  /** AWS region. Falls back to GIT_S3_REGION env var, then "us-east-1". */
  region?: string;
  /** Custom S3-compatible endpoint (for R2). Falls back to GIT_R2_ENDPOINT env var. */
  endpoint?: string;
}

export interface GitletOptions extends S3Options {
  repo: string;
}

export class Gitlet {
  static async setupBucket(options?: S3Options) {
    return setupBucket(options ?? {});
  }

  static async publishToS3(options: { bucket?: string; repoPath: string; repo: string; region?: string }) {
    return publishToS3(options);
  }

  static async publishToR2(options: { bucket?: string; repoPath: string; repo: string; endpoint?: string; publicUrl?: string }) {
    return publishToR2(options);
  }

  static async delete(options: GitletOptions) {
    return deleteRepo(options);
  }

  static async list(options?: S3Options) {
    return listRepos(options ?? {});
  }

  static async info(options: GitletOptions & { publicUrl?: string }) {
    return getRepoInfo(options);
  }

  static async destroyBucket(options?: S3Options) {
    return destroyBucket(options ?? {});
  }
}
