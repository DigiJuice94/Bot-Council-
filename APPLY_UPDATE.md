# Apply Bot War Room V2.18.1

This is V2.18 plus a Railway build rescue.

## Important
Replace the repository-root `package.json` with the one in this folder.
The current repo package.json belongs to a different Express project and does not
contain an npm `build` script.

Then upload/replace the remaining V2.18.1 files as usual and redeploy Railway.

Expected build command:
`node prepare-structure.mjs && next build`
