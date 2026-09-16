# DTL War Room — Title Logo Fix

This build fixes the homepage title image by pointing the hero to the new uploaded transparent title art and forcing a fresh file path to avoid cache issues.

## Fix included
- homepage hero now uses `title-logo-v3.png?v=3`
- new static route `/title-logo-v3.png`
- cache disabled for logo files so Railway/browser caching does not keep the old title image
- three monetization cards remain directly below the hero

Deploy this update over the current build and the hero title should switch to the rough white transparent logo immediately.
