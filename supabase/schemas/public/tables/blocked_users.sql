CREATE TABLE "public"."blocked_users" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "blocker_id" uuid                     NOT NULL,
  "blocked_id" uuid                     NOT NULL,
  CONSTRAINT "blocked_users_blocker_id_blocked_id_key" UNIQUE (blocker_id, blocked_id),
  CONSTRAINT "blocked_users_pkey" PRIMARY KEY (id),
  CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE "public"."blocked_users"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_blocked_users_blocked_id ON public.blocked_users USING btree (blocked_id);

CREATE POLICY "blocked_users_all" ON "public"."blocked_users"
  FOR ALL
  TO PUBLIC
  USING ((( SELECT auth.uid() AS uid) = blocker_id));

REVOKE ALL ON TABLE "public"."blocked_users" FROM "anon", "authenticated";

GRANT INSERT ON TABLE "public"."blocked_users" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."blocked_users" TO "service_role";

REVOKE ALL ON TABLE "public"."blocked_users" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."blocked_users" TO "postgres";
