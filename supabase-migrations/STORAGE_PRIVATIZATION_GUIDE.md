# Storage Privatization — Deploy Guide

This is the operational runbook for making `property-documents` private and
moving company logos into a new public bucket.

The CODE for this is already deployed. This file documents the
INFRASTRUCTURE steps that need to happen in the Supabase Dashboard.

## Why

Currently `property-documents` is a **public** bucket. Even though the
front-end uses signed URLs for property documents, anyone who knows or
guesses a storage path can fetch the file directly via:
`https://<project>.supabase.co/storage/v1/object/public/property-documents/<path>`

That bypasses the signed URL altogether. The bucket itself must be private
for the signed URL pattern to actually mean anything.

## Plan (3 phases)

### Phase 1 — Create the public-assets bucket
Run **`2026-04-26_storage_privatization_phase1.sql`** in the Supabase SQL Editor.
This creates a new public bucket dedicated to legitimately-public files
(company logos, etc), adds RLS policies so users can only write to their own
folder within it, AND adds a backwards-compatible policy for `property-documents`
that admits both the new strict layout and existing legacy paths.

### Phase 2 — Deploy the code
Drop the new zip into GitHub and let Vercel build/deploy. The code already:

- Writes new logo uploads to `public-assets`
- Writes maintenance photos to the (still-public-for-now) `property-documents`
  bucket but DOES NOT save the public URL — only the durable path.
  Display now goes through `getDocumentSignedUrl`.
- Tenant Portal uploads work the same way.
- Tenant Inbox + Tenant Portal use the new `<SignedPhoto>` component which
  fetches signed URLs on render and falls back to legacy `url` for old data.

After deploy you can verify everything still works WHILE the
`property-documents` bucket is still public (signed URLs work whether the
bucket is public or private — they're just unnecessary on a public one).

### Phase 3 — Flip property-documents to private
After verifying the deploy is good:

1. Go to Supabase Dashboard → Storage → `property-documents`
2. Click the cog/settings icon
3. Toggle "Public bucket" OFF
4. Save

That's it. From this moment on, anyone trying to fetch a `property-documents/...`
URL directly will get a 400. Only signed URLs will work.

## Existing Logos

Existing company logos still live in `property-documents/<user_id>/company_logos/`.
After Phase 3 they'll stop loading.

**Recommended fix: re-upload them.** It takes 30 seconds:

1. Open Settings → Companies (or wherever you upload company logos)
2. For each company that has a logo, click "Upload" and pick the file again
3. The new code writes to `public-assets`, and the next dashboard render
   uses the new URL.

You only have ~6 companies, so this is 30 seconds total work.

(Alternatively: write a one-off node script that downloads each logo from
the old bucket and uploads to the new. Not worth the complexity for ~6 files.)

## Roll Back If Needed

If anything breaks after the bucket flip:

1. Go to Supabase Dashboard → Storage → `property-documents`
2. Toggle "Public bucket" back ON
3. URLs work again.

The code changes are backwards-compatible — they work whether the bucket
is public or private. The only difference is whether public URLs return data.

## Verification

After Phase 3 (flip to private), test:
- Open a property → Documents tab → click a document → opens fine (signed URL)
- Tenant Inbox → expand a repair request with photos → photos render (SignedPhoto)
- Company logo in dashboard → renders fine (uses public-assets bucket)
- Try to fetch a property-documents URL directly in a fresh incognito browser:
  `https://<project>.supabase.co/storage/v1/object/public/property-documents/<some_path>`
  → should return a 400 error. THAT'S THE WIN.
