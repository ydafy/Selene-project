CREATE TABLE "internal"."cron_leases" (
  "job"        text                     NOT NULL,
  "lease_id"   uuid                     NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "cron_leases_pkey" PRIMARY KEY (job)
);

ALTER TABLE "internal"."cron_leases"
  ENABLE ROW LEVEL SECURITY;

-- One expiring lease per cron job, held while a run works (odd/tasks/internal-schema.md S4).
-- Only fn_acquire_cron_lease and fn_release_cron_lease (SECURITY DEFINER, owner postgres)
-- read or write it, so no client role and not service_role hold a privilege on it.
REVOKE ALL ON TABLE "internal"."cron_leases" FROM PUBLIC, "anon", "authenticated", "service_role";
