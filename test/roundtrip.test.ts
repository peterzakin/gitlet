import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import {
  setupBucket,
  destroyBucket,
  publishRepo,
  deleteRepo,
  listRepos,
  getRepoInfo,
} from "../src/index.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string) {
  return execFileAsync("git", args, { cwd });
}

const TEST_BUCKET = `gitlet-test-${crypto.randomBytes(4).toString("hex")}`;
const REPO_NAME = "testrepo";
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gitlet-test-"));
  tmpDirs.push(d);
  return d;
}

afterAll(async () => {
  // Clean up all temp directories
  for (const d of tmpDirs) {
    await fs.promises.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

describe("gitlet roundtrip", { timeout: 120_000 }, () => {
  let cloneUrl: string;

  it("step 1: setupBucket", async () => {
    const result = await setupBucket({ bucket: TEST_BUCKET });
    expect(result.bucket).toBe(TEST_BUCKET);
    expect(result.region).toBeTruthy();
  });

  it("step 1b: setupBucket is idempotent", async () => {
    const result = await setupBucket({ bucket: TEST_BUCKET });
    expect(result.bucket).toBe(TEST_BUCKET);
  });

  it("step 2-3: create repo and publishRepo", async () => {
    // Create a local git repo with commits
    const repoDir = makeTmpDir();
    await git(["init", "-b", "main"], repoDir);
    await git(["config", "user.email", "test@test.com"], repoDir);
    await git(["config", "user.name", "Test"], repoDir);

    await fs.promises.writeFile(path.join(repoDir, "hello.txt"), "hello world\n");
    await git(["add", "."], repoDir);
    await git(["commit", "-m", "initial commit"], repoDir);

    await fs.promises.writeFile(path.join(repoDir, "second.txt"), "second file\n");
    await git(["add", "."], repoDir);
    await git(["commit", "-m", "add second file"], repoDir);

    const result = await publishRepo({
      bucket: TEST_BUCKET,
      repoPath: repoDir,
      repo: REPO_NAME,
    });

    expect(result.cloneUrl).toContain(TEST_BUCKET);
    expect(result.cloneUrl).toContain(`${REPO_NAME}.git`);
    cloneUrl = result.cloneUrl;
  });

  it("step 4-5: git clone works and content matches", async () => {
    const cloneDir = makeTmpDir();
    const targetDir = path.join(cloneDir, "checkout");

    const { stderr } = await git(["clone", cloneUrl, targetDir], cloneDir);
    // clone succeeded

    // Check files
    const hello = await fs.promises.readFile(
      path.join(targetDir, "hello.txt"),
      "utf-8"
    );
    expect(hello).toBe("hello world\n");

    const second = await fs.promises.readFile(
      path.join(targetDir, "second.txt"),
      "utf-8"
    );
    expect(second).toBe("second file\n");

    // Check commit history
    const { stdout: log } = await git(
      ["log", "--oneline", "--format=%s"],
      targetDir
    );
    const commits = log.trim().split("\n");
    expect(commits).toEqual(["add second file", "initial commit"]);

    // Check default branch is main
    const { stdout: branch } = await git(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      targetDir
    );
    expect(branch.trim()).toBe("main");
  });

  it("step 6-9: publish update and re-clone", async () => {
    // We need the original repo — create a fresh one with the same history + new commit
    const repoDir = makeTmpDir();
    await git(["clone", cloneUrl, repoDir + "/src"], repoDir);
    const srcDir = repoDir + "/src";
    await git(["config", "user.email", "test@test.com"], srcDir);
    await git(["config", "user.name", "Test"], srcDir);

    await fs.promises.writeFile(path.join(srcDir, "third.txt"), "third file\n");
    await git(["add", "."], srcDir);
    await git(["commit", "-m", "add third file"], srcDir);

    // Re-publish
    await publishRepo({
      bucket: TEST_BUCKET,
      repoPath: srcDir,
      repo: REPO_NAME,
    });

    // Clone again
    const cloneDir = makeTmpDir();
    const targetDir = path.join(cloneDir, "checkout");
    await git(["clone", cloneUrl, targetDir], cloneDir);

    const third = await fs.promises.readFile(
      path.join(targetDir, "third.txt"),
      "utf-8"
    );
    expect(third).toBe("third file\n");

    const { stdout: log } = await git(
      ["log", "--oneline", "--format=%s"],
      targetDir
    );
    expect(log.trim().split("\n")).toContain("add third file");
  });

  it("step 10: listRepos", async () => {
    const repos = await listRepos({ bucket: TEST_BUCKET });
    expect(repos).toContain(REPO_NAME);
  });

  it("step 11: getRepoInfo", async () => {
    const info = await getRepoInfo({ bucket: TEST_BUCKET, repo: REPO_NAME });
    expect(info).not.toBeNull();
    expect(info!.exists).toBe(true);
    expect(info!.sizeBytes).toBeGreaterThan(0);
    expect(info!.lastModified).toBeInstanceOf(Date);
    // lastModified should be recent (within last 5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(info!.lastModified.getTime()).toBeGreaterThan(fiveMinAgo.getTime());
  });

  it("step 12-13: deleteRepo and clone fails", async () => {
    await deleteRepo({ bucket: TEST_BUCKET, repo: REPO_NAME });

    const cloneDir = makeTmpDir();
    const targetDir = path.join(cloneDir, "checkout");
    await expect(git(["clone", cloneUrl, targetDir], cloneDir)).rejects.toThrow();
  });

  it("step 14: listRepos returns empty", async () => {
    const repos = await listRepos({ bucket: TEST_BUCKET });
    expect(repos).toEqual([]);
  });

  it("step 15: destroyBucket", async () => {
    await destroyBucket({ bucket: TEST_BUCKET });
  });

  it("step 15b: destroyBucket on non-existent is no-op", async () => {
    await destroyBucket({ bucket: TEST_BUCKET });
  });
});
