CREATE TYPE "public"."product_status_enum" AS ENUM (
  'PENDING_VERIFICATION',
  'IN_REVIEW',
  'VERIFIED',
  'SOLD',
  'REJECTED',
  'HIDDEN',
  'RESERVED',
  'IN_DISPUTE'
);
