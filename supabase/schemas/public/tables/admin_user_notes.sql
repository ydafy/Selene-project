CREATE TABLE "public"."admin_user_notes" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid,
  "admin_id"   uuid,
  "content"    text                     NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "admin_user_notes_pkey" PRIMARY KEY (id),
  CONSTRAINT "admin_user_notes_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES public.profiles(id),
  CONSTRAINT "admin_user_notes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE "public"."admin_user_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_admin_user_notes_admin_id ON public.admin_user_notes USING btree (admin_id);

CREATE INDEX ix_admin_user_notes_user_id ON public.admin_user_notes USING btree (user_id);

CREATE POLICY "admin_user_notes_all" ON "public"."admin_user_notes"
  FOR ALL
  TO "authenticated"
  USING (( SELECT public.is_admin() AS is_admin));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_user_notes" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_user_notes" FROM "authenticated";

GRANT INSERT, SELECT ON TABLE "public"."admin_user_notes" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_user_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_user_notes" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_user_notes" FROM "anon";
