-- Size and type limits for the verification bucket (#312). It was the only bucket
-- without limits. The app uploads camera photos to it through
-- buildVerificationProofUpload (`<product_id>/<proof>_<timestamp>.<ext>`), so it
-- takes the same limits as `products`. Grant review (AGENTS.md): data only, no
-- privilege or policy changes.

UPDATE storage.buckets
SET public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
WHERE id = 'verification';
