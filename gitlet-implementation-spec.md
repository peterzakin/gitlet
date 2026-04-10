# Gitlet: Implementation Spec

## What you're building

A module that publishes git repositories as static files to S3 so that anyone can `git clone` them over HTTPS with no server involved. The git dumb HTTP protocol serves repos from static files. S3 is a static file host. Your module creates those files and syncs them to S3.

Each user gets their own S3 bucket, created and configured by the module. The caller manages the mapping between users and buckets.

## Prerequisites

- An AWS account
- `git` available on the system where your platform backend runs
- AWS SDK credentials configured (env vars, IAM role, etc.) with permissions to create and manage S3 buckets

## Configuration

```
GIT_S3_REGION=us-east-1
```

There is no global bucket name. The caller passes a bucket name to every function.

---

## Task 1: `setupBucket` function

Creates and configures an S3 bucket for a user. Must be idempotent — safe to call multiple times for the same bucket.

**Signature:**

```
setupBucket({
  bucket: string,         // e.g. "git-alice-a1b2c3"
  region?: string,        // defaults to GIT_S3_REGION
}) => Promise<{ bucket: string, region: string }>
```

**Implementation steps (in order):**

1. Create the bucket if it doesn't already exist. If the bucket already exists and is owned by the same account, continue without error.
2. Disable "Block Public Access" settings for the bucket (all four toggles off). This is required so the bucket policy in the next step can grant public reads.
3. Apply a bucket policy that allows public `s3:GetObject` on `arn:aws:s3:::<bucket>/*`. No public write, no public list.
4. Enable versioning on the bucket.
5. Add a lifecycle rule that deletes non-current object versions after 30 days.

**Error handling:**
- If the bucket exists but is owned by a different account, throw a clear error — bucket names are globally unique.
- If any configuration step fails, throw. A partially configured bucket is fine since the function is idempotent and the caller can retry.

**Acceptance criteria:**
- Calling `setupBucket` twice with the same name produces no errors and leaves the bucket in the correct state.
- An unauthenticated HTTP GET to `https://<bucket>.s3.amazonaws.com/test.txt` returns 404 (not 403). Public read is enabled, the object just doesn't exist.
- An unauthenticated PUT to the bucket is rejected (403).

---

## Task 2: `publishRepo` function

The core function. Takes a local git repo, prepares it for dumb HTTP serving, and syncs it to S3.

**Signature:**

```
publishRepo({
  bucket: string,        // the user's bucket, e.g. "git-alice-a1b2c3"
  repoPath: string,      // absolute path to a local git repo (bare or working tree)
  repo: string,          // e.g. "myapp"
}) => Promise<{ cloneUrl: string }>
```

**Implementation steps (in order):**

1. Create a temp directory.
2. Clone the source repo into the temp dir as a bare repo:
   ```
   git clone --bare <repoPath> <tmpDir>/repo.git
   ```
3. Inside the bare repo, repack into a single packfile:
   ```
   cd <tmpDir>/repo.git
   git repack -a -d
   ```
4. Generate the dumb HTTP protocol index files:
   ```
   git update-server-info
   ```
5. Sync to S3 with the correct key prefix. The S3 key prefix is `<repo>.git/`. **Upload order matters for consistency:**
   - First, sync everything under `objects/` (packfiles are content-addressed, safe to upload first).
   - Then, sync `info/refs`, `HEAD`, and `objects/info/packs` (these are the mutable pointers).
   Use the AWS SDK to upload files. Delete stale objects under the same prefix that are no longer present locally (equivalent of `aws s3 sync --delete`).
6. Clean up the temp directory.
7. Return `{ cloneUrl: "https://<bucket>.s3.amazonaws.com/<repo>.git" }`.

**Error handling:**
- If any git command fails, throw with the stderr output.
- If S3 sync fails, throw. Do not leave partial uploads — the old version remains valid because versioning is enabled.
- Always clean up the temp directory, even on failure (use try/finally).

**Acceptance criteria:**
- After calling `publishRepo`, running `git clone <cloneUrl>` from a different machine produces a valid checkout with the correct branch, files, and history.
- Calling `publishRepo` again after new commits updates the clone URL to reflect the new state.
- The S3 prefix for the repo contains only these paths:
  ```
  HEAD
  info/refs
  objects/info/packs
  objects/pack/pack-<hash>.pack
  objects/pack/pack-<hash>.idx
  ```
  No loose objects, no stale packfiles.

---

## Task 3: `deleteRepo` function

**Signature:**

```
deleteRepo({
  bucket: string,
  repo: string,
}) => Promise<void>
```

**Implementation:**

Delete all objects under the S3 key prefix `<repo>.git/`. Use a list + batch delete since S3 has no "delete prefix" operation.

**Acceptance criteria:**
- After calling `deleteRepo`, the clone URL returns 404 on all paths.
- No orphaned objects remain under the prefix.

---

## Task 4: `listRepos` function

**Signature:**

```
listRepos({
  bucket: string,
}) => Promise<string[]>   // returns repo names, e.g. ["myapp", "todoapp"]
```

**Implementation:**

List S3 objects with prefix `` (root) and delimiter `/`. Extract the top-level prefixes, strip the `.git/` suffix. Each unique prefix is a repo name.

**Acceptance criteria:**
- Returns an empty array if the bucket has no repos.
- Returns correct names after publish and delete operations.

---

## Task 5: `getRepoInfo` function

**Signature:**

```
getRepoInfo({
  bucket: string,
  repo: string,
}) => Promise<{
  exists: boolean,
  cloneUrl: string,
  sizeBytes: number,       // total size of all objects in the prefix
  lastModified: Date,      // most recent LastModified across all objects
} | null>
```

**Implementation:**

List all objects under `<repo>.git/`, sum their sizes, find the max LastModified. If no objects exist, return null.

---

## Task 6: `destroyBucket` function

Tears down a user's bucket entirely. Use when a user account is deleted.

**Signature:**

```
destroyBucket({
  bucket: string,
}) => Promise<void>
```

**Implementation steps:**

1. List all object versions (including delete markers) in the bucket.
2. Batch delete all object versions. S3 requires all versions to be deleted before a bucket can be removed.
3. Delete the bucket itself.

**Error handling:**
- If the bucket doesn't exist, return without error.

**Acceptance criteria:**
- After calling `destroyBucket`, the bucket no longer exists.
- Calling `destroyBucket` on a non-existent bucket does not throw.

---

## Task 7: Integration test

Write a test that validates the full flow end-to-end.

**Steps:**

1. Call `setupBucket` with a unique test bucket name.
2. Create a temporary local git repo with a few commits on `main`.
3. Call `publishRepo`.
4. `git clone` the returned clone URL into a new temp directory.
5. Assert:
   - The clone succeeds (exit code 0).
   - The cloned repo has the same commit history (`git log --oneline` matches).
   - The file contents match.
   - The default branch is `main`.
6. Add a new commit to the original repo.
7. Call `publishRepo` again.
8. In a fresh temp directory, `git clone` again.
9. Assert the new commit is present.
10. Call `listRepos` and assert it returns the repo name.
11. Call `getRepoInfo` and assert size > 0 and lastModified is recent.
12. Call `deleteRepo`.
13. Assert `git clone` now fails.
14. Call `listRepos` and assert it returns an empty array.
15. Call `destroyBucket`.
16. Clean up all temp directories.

---

## File structure

```
gitlet/
  src/
    bucket.ts               # Task 1: setupBucket, Task 6: destroyBucket
    publish.ts              # Task 2: publishRepo
    delete.ts               # Task 3: deleteRepo
    list.ts                 # Task 4: listRepos
    info.ts                 # Task 5: getRepoInfo
    index.ts                # re-exports all functions
  test/
    roundtrip.test.ts       # Task 7
  package.json
  tsconfig.json
  README.md
```

Adjust the language and file extensions to match your platform's stack. The logic is the same regardless of language: shell out to `git` for repo prep, use the AWS SDK for S3 operations.

---

## Implementation notes

- **Shell out to `git` for all git operations.** Libraries like `isomorphic-git` or `go-git` exist but the real `git` binary is battle-tested for repack and update-server-info. Don't reinvent this.
- **Use the AWS SDK (not the CLI) for S3 operations** in the application code.
- **The S3 sync must delete stale objects** under the repo prefix. Each `git repack -a -d` produces a new pack with a new hash. Without cleanup, old packs accumulate and waste storage.
- **`git update-server-info` is not optional.** Without it, the dumb protocol has no `info/refs` file and clone will fail.
- **The `Content-Type` of S3 objects doesn't matter for git.** Git clients don't check it. Don't waste time setting MIME types.
- **S3 provides strong read-after-write consistency.** Once the upload completes, the new version is immediately available. No propagation delay.
- **Bucket names must be globally unique across all AWS accounts.** The caller is responsible for generating unique names (e.g. by appending a hash or user ID).
