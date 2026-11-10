CREATE TABLE "public"."push_tokens" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         uuid                     NOT NULL,
  "token"           text                     NOT NULL,
  "platform"        text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "disabled_at"     timestamp with time zone,
  "disabled_reason" text,
  CONSTRAINT "push_tokens_pkey" PRIMARY KEY (id),
  CONSTRAINT "push_tokens_platform_check" CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
  CONSTRAINT "push_tokens_token_key" UNIQUE (token),
  CONSTRAINT "push_tokens_token_shape_chk" CHECK (((char_length(token) <= 255) AND (token ~ '^Expo(nent)?PushToken\[[^\]\s]+\]$'::text))),
  CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE "public"."push_tokens"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX push_tokens_active_user_idx ON public.push_tokens USING btree (user_id)
  WHERE (disabled_at IS NULL);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_tokens" TO "service_role";

COMMENT ON TABLE "public"."push_tokens" IS 'Expo push tokens, one row per device. Written only by fn_register_push_token / fn_unregister_push_token and the push dispatcher (service role). disabled_at is set when Expo reports the token as dead.';

REVOKE ALL ON TABLE "public"."push_tokens" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."push_tokens" TO "postgres";

REVOKE ALL ON TABLE "public"."push_tokens" FROM "anon", "authenticated";
