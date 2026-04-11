# Gitlet

Publish git repositories to S3 as static files so anyone can `git clone` them over HTTPS — no server required.

## Install

```bash
npm install gitlet
```

## Usage

```typescript
import { Gitlet } from "gitlet";

// Set up a bucket for a user (idempotent — safe to call multiple times)
await Gitlet.setupBucket({ bucket: "git-alice-a1b2c3" });

// Publish a repo
const { cloneUrl } = await Gitlet.publish({
  bucket: "git-alice-a1b2c3",
  repo: "myapp",
  repoPath: "/var/repos/alice/myapp",
});
// => https://git-alice-a1b2c3.s3.amazonaws.com/myapp.git

// Anyone can now clone it
// $ git clone https://git-alice-a1b2c3.s3.amazonaws.com/myapp.git

// List all repos in a bucket
const repos = await Gitlet.list({ bucket: "git-alice-a1b2c3" });
// => ["myapp", "todoapp"]

// Get repo info
const info = await Gitlet.info({ bucket: "git-alice-a1b2c3", repo: "myapp" });
// => { exists: true, cloneUrl: "...", sizeBytes: 48320, lastModified: Date }

// Delete a repo
await Gitlet.delete({ bucket: "git-alice-a1b2c3", repo: "myapp" });

// Tear down a user's bucket entirely
await Gitlet.destroyBucket({ bucket: "git-alice-a1b2c3" });
```

## Configuration

Region defaults to `us-east-1`. Override with the `GIT_S3_REGION` env var or pass `region` to any method:

```typescript
await Gitlet.setupBucket({ bucket: "git-alice-a1b2c3", region: "eu-west-1" });

await Gitlet.publish({
  bucket: "git-alice-a1b2c3",
  repo: "myapp",
  repoPath: "/var/repos/alice/myapp",
  region: "eu-west-1",
});
```

## How it works

Git's [dumb HTTP protocol](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols) serves repos from static files. S3 is a static file host. Gitlet bridges the two:

1. Clones your repo as a bare repo into a temp directory
2. Repacks into a single packfile (`git repack -a -d`)
3. Generates protocol index files (`git update-server-info`)
4. Uploads to S3, cleaning up stale objects

Published repos are read-only. `git clone` and `git fetch` work. `git push` does not — S3 can't process incoming git data. To update a published repo, call `Gitlet.publish` again after new commits.

## Bucket setup

`setupBucket` configures the bucket for public read access:

- Creates the bucket (if it doesn't exist)
- Disables Block Public Access
- Applies a public `s3:GetObject` policy (read-only, no write, no list)
- Enables versioning
- Adds a lifecycle rule to delete old versions after 30 days
