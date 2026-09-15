Bot War Room V2.12.1 — compact deployment folder (stale-build cleanup)

This package intentionally contains ONE canonical copy of each source file.
The build command runs prepare-structure.mjs, which creates app/, lib/, components/, public/, and api routes during deployment.

Paper wallet start: $1,000.
No demo candidate fallback is included.
Set your Railway environment variables from .env.example.

Build fix: prepare-structure.mjs now deletes stale generated app/lib/components/tests trees before rebuilding them, so old smoke tests from previous uploads cannot break deployment.
