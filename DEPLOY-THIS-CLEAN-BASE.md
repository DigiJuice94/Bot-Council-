# Deploy this clean base

This folder is the complete Railway project root. The repository root must show
`app`, `components`, `lib`, `public`, `package.json`, and `Dockerfile` directly.

Do not upload this folder beside an older project folder and do not leave old
source files in the repository. GitHub's file uploader merges files; it does not
remove retired files automatically. Replace the old repository contents with
the contents of this folder, then deploy the resulting commit.

This package does not depend on `deployment-source.tar.gz`. Its Dockerfile builds the included `app/`, `components/`, `lib/`, and `public/` directories directly.

Successful deployment is visually identifiable by the dashboard label:

`Bot War Room V3.6.3.6 · CANONICAL · FULL EXITS`

The Proof of Work cabinet also reports:

`V3.6.3.6 Clean Canonical / Proof of Work`

If either older label is still visible, Railway is building an older commit or
the project root is pointed at a nested/previous folder.
