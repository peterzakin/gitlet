import { setupBucket, destroyBucket } from "./bucket.js";
import { publishRepo } from "./publish.js";
import { deleteRepo } from "./delete.js";
import { listRepos } from "./list.js";
import { getRepoInfo } from "./info.js";

export interface GitletOptions {
  bucket: string;
  repo: string;
  region?: string;
}

export class Gitlet {
  static async setupBucket(options: { bucket: string; region?: string }) {
    return setupBucket(options);
  }

  static async publish(options: GitletOptions & { repoPath: string }) {
    return publishRepo(options);
  }

  static async delete(options: GitletOptions) {
    return deleteRepo(options);
  }

  static async list(options: { bucket: string; region?: string }) {
    return listRepos(options);
  }

  static async info(options: GitletOptions) {
    return getRepoInfo(options);
  }

  static async destroyBucket(options: { bucket: string; region?: string }) {
    return destroyBucket(options);
  }
}
