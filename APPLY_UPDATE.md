# Apply Bot War Room V2.29.1

Replace V2.29 with this cumulative one-folder release and redeploy Railway.

This fixes the exact two TypeScript errors shown after V2.29 compiled:

- missing Trajectory Observer fields on the engine RunnerGenome fallback
- trajectoryOutcome union not narrowed to runner/dumper

No new Railway variables are required.
