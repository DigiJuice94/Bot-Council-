# Deploy this clean base

This folder is the complete Railway project root. The repository root must show
`app`, `components`, `lib`, `public`, `package.json`, and `Dockerfile` directly.

Do not upload this folder beside an older project folder and do not leave old
source files in the repository. GitHub's file uploader merges files; it does not
remove retired files automatically. Replace the old repository contents with
the contents of this folder, then deploy the resulting commit.

This package includes a generated `deployment-source.tar.gz` containing the exact same canonical `app/`, `components/`, `lib/`, and `public/` tree. Railway restores it before building, so the deployment still works if GitHub's browser uploader drops nested folders.

Do not delete `deployment-source.tar.gz`. It is the upload-safe copy of this same build, not an older version.

Successful deployment is visually identifiable by the dashboard label:

`Bot War Room V3.6.3.7 · ACCOUNTING VERIFIED · GUARDIAN RECOVERY`

The Proof of Work cabinet also reports:

`V3.6.3.7 Accounting Reconciled / Guardian Recovery`

If either older label is still visible, Railway is building an older commit or
the project root is pointed at a nested/previous folder.
