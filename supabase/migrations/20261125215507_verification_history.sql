SET local check_function_bodies = off;

DROP VIEW "public"."admin_product_queue_view";

CREATE TABLE "public"."product_verification_evidence" (
  "id"              uuid NOT NULL DEFAULT gen_random_uuid(),
  "verification_id" uuid NOT NULL,
  CONSTRAINT "product_verification_evidence_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."product_verification_evidence"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."product_verification_evidence" FROM "anon";

CREATE TABLE "public"."product_verifications" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "product_id"      uuid                     NOT NULL,
  "submitted_by"    uuid                     NOT NULL,
  "submitted_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "benchmark_score" integer,
  CONSTRAINT "product_verifications_benchmark_score_chk" CHECK ((benchmark_score >= 0)),
  CONSTRAINT "product_verifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."product_verifications"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."product_verifications" FROM "anon";

CREATE TYPE "public"."product_verification_decision" AS ENUM (
  'approved',
  'rejected'
);

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "decision" public.product_verification_decision;

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "decided_by" uuid;

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "decided_at" timestamp WITH time zone;

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "public_note" text;

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "private_note_id" uuid;

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "locked_by" uuid;

ALTER TABLE "public"."product_verifications"
  ADD COLUMN "locked_at" timestamp WITH time zone;

CREATE TYPE "public"."verification_evidence_kind" AS ENUM (
  'physical',
  'performance'
);

ALTER TABLE "public"."product_verification_evidence"
  ADD COLUMN "kind" public.verification_evidence_kind NOT NULL;

ALTER TABLE "public"."product_verification_evidence"
  ADD COLUMN "storage_path" text NOT NULL;

ALTER TABLE "public"."product_verification_evidence"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION internal.fn_product_verifications_keep_decided_closed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  -- A decision is written once (odd/tasks/verification-history.md S1): a
  -- decided attempt is verification evidence and is never reopened or edited,
  -- whoever runs the update. A new submission is a new attempt.
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'a decided verification attempt cannot change'
      USING ERRCODE = '23514', DETAIL = format('product verification %s', OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_lock_product (
  p_product_id uuid
)
  RETURNS TABLE (
    success            boolean,
    locked_by_username text,
    locked_at          timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_verification_id UUID;
    v_locker_id UUID;
    v_locker_name TEXT;
    v_lock_time TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- The review lock lives on the listing's open verification attempt
    -- (odd/tasks/verification-history.md S4).
    SELECT v.id, v.locked_by, v.locked_at
    INTO v_verification_id, v_locker_id, v_lock_time
    FROM public.product_verifications v
    WHERE v.product_id = p_product_id
      AND v.decision IS NULL
    FOR UPDATE;

    IF v_verification_id IS NULL THEN
        RAISE EXCEPTION 'VERIFICATION_NOT_OPEN';
    END IF;

    IF v_locker_id IS NOT NULL THEN
        SELECT username INTO v_locker_name
        FROM public.profiles
        WHERE id = v_locker_id;
    END IF;

    IF v_locker_id IS NULL OR v_lock_time < (now() - interval '10 minutes') THEN
        UPDATE public.product_verifications
        SET locked_by = v_auth_user_id, locked_at = now()
        WHERE id = v_verification_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSIF v_locker_id = v_auth_user_id THEN
        UPDATE public.product_verifications
        SET locked_at = now()
        WHERE id = v_verification_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSE
        RETURN QUERY SELECT false, v_locker_name, v_lock_time;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_product_verdict (
  p_product_id   uuid,
  p_verdict      text,
  p_public_note  text DEFAULT NULL::text,
  p_private_note text DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_verification_id UUID;
  v_private_note_id UUID;
  v_locked_by UUID;
  v_lock_time TIMESTAMPTZ;
  v_seller_id UUID;
  v_product_name TEXT;
  v_status public.product_status;
  v_audit_id UUID;
  v_event_kind TEXT;
  v_notif_title TEXT;
  v_notif_msg TEXT;
  v_notif_type TEXT;
  v_action_path TEXT;
BEGIN
  -- 1. Extraer ID del Administrador desde la sesión segura del JWT
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  -- 2. Validar que el usuario sea realmente un administrador
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- 3. Cargar datos del producto y bloquear la fila para actualización
  SELECT p.seller_id, p.name, p.status
  INTO v_seller_id, v_product_name, v_status
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  -- The lock and the decision live on the listing's open verification
  -- attempt (odd/tasks/verification-history.md S4, S5).
  SELECT v.id, v.locked_by, v.locked_at
  INTO v_verification_id, v_locked_by, v_lock_time
  FROM public.product_verifications v
  WHERE v.product_id = p_product_id
    AND v.decision IS NULL
  FOR UPDATE;

  -- Without an open attempt there is no lock. The same verdict repeated after
  -- the attempt was decided writes nothing.
  IF v_verification_id IS NULL THEN
    IF (p_verdict = 'APPROVE' AND v_status = 'verified')
       OR (p_verdict = 'REJECT' AND v_status = 'rejected') THEN
      RETURN true;
    END IF;
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
  END IF;

  -- 4. Validar concurrencia: que el bloqueo siga perteneciendo al administrador y no haya expirado (10 min)
  IF v_locked_by IS NULL OR v_locked_by IS DISTINCT FROM v_auth_user_id OR v_lock_time < (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
  END IF;

  IF (p_verdict = 'APPROVE' AND v_status = 'verified')
     OR (p_verdict = 'REJECT' AND v_status = 'rejected') THEN
    UPDATE public.product_verifications
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = v_verification_id;
    RETURN true;
  END IF;

  IF p_verdict IS DISTINCT FROM 'APPROVE' AND p_verdict IS DISTINCT FROM 'REJECT' THEN
    RAISE EXCEPTION 'INVALID_VERDICT_VALUE';
  END IF;

  IF p_verdict = 'REJECT' AND COALESCE(trim(p_public_note), '') = '' THEN
    RAISE EXCEPTION 'REJECTION_NOTE_REQUIRED';
  END IF;

  -- 5. Insertar Nota Privada de Inteligencia del Admin (Solo si fue proporcionada)
  IF p_private_note IS NOT NULL AND trim(p_private_note) <> '' THEN
    INSERT INTO public.admin_user_notes (user_id, admin_id, content)
    VALUES (v_seller_id, v_auth_user_id, trim(p_private_note))
    RETURNING id INTO v_private_note_id;
  END IF;

  -- 6. Cerrar el intento con la decisión, liberar el lock y actualizar el estado del producto
  UPDATE public.product_verifications
  SET decision = CASE WHEN p_verdict = 'REJECT'
                   THEN 'rejected'::public.product_verification_decision
                   ELSE 'approved'::public.product_verification_decision END,
      decided_by = v_auth_user_id,
      decided_at = now(),
      public_note = NULLIF(trim(p_public_note), ''),
      private_note_id = v_private_note_id,
      locked_by = NULL,
      locked_at = NULL
  WHERE id = v_verification_id;

  UPDATE public.products
  SET status = CASE WHEN p_verdict = 'REJECT'
                 THEN 'rejected'::public.product_status
                 ELSE 'verified'::public.product_status END,
      updated_at = now()
  WHERE id = p_product_id;

  -- 7. Registrar Log de Auditoría Administrativa (Corregido: p_product_id sin castear a texto)
  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    CASE WHEN p_verdict = 'REJECT' THEN 'PRODUCT_REJECT' ELSE 'PRODUCT_APPROVE' END,
    p_product_id, -- <-- FIX: Eliminamos el ::text para que coincida con el tipo UUID de la columna
    jsonb_build_object(
      'product_name', v_product_name,
      'seller_id', v_seller_id,
      'admin_note', trim(p_public_note),
      'verdict', p_verdict,
      'verification_id', v_verification_id
    )
  )
  RETURNING id INTO v_audit_id;

  -- 8. Resolver textos dinámicos de la Notificación para el vendedor
  IF p_verdict = 'REJECT' THEN
    v_notif_title := 'Producto Rechazado';
    v_event_kind := 'product.rejected';
    v_notif_type := 'error';
    v_notif_msg := 'Tu producto "' || v_product_name || '" ha sido rechazado. Motivo: ' || COALESCE(trim(p_public_note), 'No especificado por el administrador.');
    v_action_path := '/verify/' || p_product_id::text;
  ELSE
    v_notif_title := 'Producto Verificado';
    v_action_path := '/product/' || p_product_id::text;
    IF p_public_note IS NOT NULL AND trim(p_public_note) <> '' THEN
      v_event_kind := 'product.approved_with_note';
      v_notif_type := 'warning';
      v_notif_msg := '¡Listo! Tu producto "' || v_product_name || '" ya está a la venta. Nota del administrador: ' || trim(p_public_note);
    ELSE
      v_event_kind := 'product.approved';
      v_notif_type := 'success';
      v_notif_msg := '¡Felicidades! Tu producto "' || v_product_name || '" ha sido aprobado por moderación.';
    END IF;
  END IF;

  -- 9. Insertar Notificación para el vendedor (Bypass seguro de RLS)
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  ) VALUES (
    v_seller_id,
    v_event_kind,
    v_event_kind || ':' || p_product_id::text || ':' || v_audit_id::text,
    jsonb_build_object('product_id', p_product_id, 'recipient_role', 'seller'),
    v_notif_title,
    v_notif_msg,
    v_notif_type,
    false,
    v_action_path
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_submit_product_verification (
  p_product_id        uuid,
  p_physical_paths    text[],
  p_performance_paths text[]  DEFAULT '{}'::text[],
  p_benchmark_score   integer DEFAULT NULL::integer
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_seller_id uuid;
  v_status public.product_status;
  v_deleted_at timestamptz;
  v_hold public.product_status;
  v_physical text[] := COALESCE(p_physical_paths, '{}'::text[]);
  v_performance text[] := COALESCE(p_performance_paths, '{}'::text[]);
  v_verification_id uuid;
BEGIN
  -- The seller sends a listing to review (odd/tasks/verification-history.md
  -- S3): one attempt with its proofs, each a file the seller uploaded to the
  -- listing's folder of bucket verification.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT public.fn_current_account_is_active() THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE';
  END IF;

  SELECT p.seller_id, p.status, p.deleted_at, p.status_before_account_hold
  INTO v_seller_id, v_status, v_deleted_at, v_hold
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR v_seller_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF v_deleted_at IS NOT NULL
    OR v_hold IS NOT NULL
    OR v_status NOT IN ('pending_verification'::public.product_status, 'rejected'::public.product_status) THEN
    RAISE EXCEPTION 'INVALID_STATUS_FOR_VERIFICATION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_verifications v
    WHERE v.product_id = p_product_id AND v.decision IS NULL
  ) THEN
    RAISE EXCEPTION 'VERIFICATION_ALREADY_OPEN';
  END IF;

  IF cardinality(v_physical) = 0 THEN
    RAISE EXCEPTION 'PHYSICAL_PROOF_REQUIRED';
  END IF;

  IF p_benchmark_score < 0 THEN
    RAISE EXCEPTION 'INVALID_BENCHMARK_SCORE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_physical || v_performance) AS e(path)
    WHERE (starts_with(e.path, p_product_id::text || '/') AND strpos(e.path, '..') = 0) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_PATH';
  END IF;

  IF (SELECT count(DISTINCT e.path) FROM unnest(v_physical || v_performance) AS e(path))
     <> cardinality(v_physical || v_performance) THEN
    RAISE EXCEPTION 'DUPLICATE_EVIDENCE_PATH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_physical || v_performance) AS e(path)
    WHERE NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'verification' AND o.name = e.path
    )
  ) THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_FOUND';
  END IF;

  INSERT INTO public.product_verifications (product_id, submitted_by, benchmark_score)
  VALUES (p_product_id, v_caller, p_benchmark_score)
  RETURNING id INTO v_verification_id;

  INSERT INTO public.product_verification_evidence (verification_id, kind, storage_path)
  SELECT v_verification_id, 'physical'::public.verification_evidence_kind, e.path
  FROM unnest(v_physical) AS e(path)
  UNION ALL
  SELECT v_verification_id, 'performance'::public.verification_evidence_kind, e.path
  FROM unnest(v_performance) AS e(path);

  UPDATE public.products
  SET status = 'in_review'::public.product_status
  WHERE id = p_product_id;

  RETURN v_verification_id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.fn_unlock_product (
  p_product_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
    v_auth_user_id UUID;
    v_verification_id UUID;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- Active admins only: is_admin() reads profiles_private.role and status.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- The review lock lives on the listing's open verification attempt
    -- (odd/tasks/verification-history.md S4).
    UPDATE public.product_verifications
    SET locked_by = NULL, locked_at = NULL
    WHERE product_id = p_product_id
    AND decision IS NULL
    AND (locked_by = v_auth_user_id OR locked_at < (now() - interval '10 minutes'))
    RETURNING id INTO v_verification_id;

    IF v_verification_id IS NOT NULL THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'PRODUCT_UNLOCK', p_product_id,
                jsonb_build_object('timestamp', now(), 'verification_id', v_verification_id));
        RETURN true;
    END IF;

    RETURN false;
END;
$function$;

ALTER TABLE "public"."product_verification_evidence"
  ADD CONSTRAINT "product_verification_evidence_storage_path_chk" CHECK ((btrim(storage_path) <> ''::text));

ALTER TABLE "public"."product_verification_evidence"
  ADD CONSTRAINT "product_verification_evidence_verification_id_storage_path_key" UNIQUE (verification_id, storage_path);

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_decision_chk" CHECK ((num_nonnulls(decision, decided_by, decided_at) = ANY (ARRAY[0, 3])));

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_lock_chk" CHECK (((locked_by IS NULL) = (locked_at IS NULL)));

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_lock_open_chk" CHECK (((decision IS NULL) OR (locked_by IS NULL)));

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_notes_decided_chk" CHECK (((decision IS NOT NULL) OR ((public_note IS NULL) AND (private_note_id IS NULL))));

ALTER TABLE "public"."product_verification_evidence"
  ADD CONSTRAINT "product_verification_evidence_verification_id_fkey" FOREIGN KEY (verification_id) REFERENCES public.product_verifications(id) ON DELETE RESTRICT;

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_private_note_id_fkey" FOREIGN KEY (private_note_id) REFERENCES public.admin_user_notes(id) ON DELETE RESTRICT;

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_public_note_chk" CHECK (((public_note IS NULL) OR (btrim(public_note) <> ''::text)));

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_rejection_note_chk" CHECK (((decision IS DISTINCT FROM 'rejected'::public.product_verification_decision) OR (public_note IS NOT NULL)));

ALTER TABLE "public"."product_verifications"
  ADD CONSTRAINT "product_verifications_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE VIEW "public"."admin_product_queue_view" WITH (security_invoker=true) AS  SELECT p.id,
    p.created_at,
    p.name,
    p.description,
    p.price_cents,
    p.category,
    p.condition,
    p.usage,
    p.images,
    p.status,
    p.specifications,
    p.seller_id,
    p.views,
    p.aspect_ratio,
    p.shipping_cost_cents,
    p.shipping_payer,
    p.origin_zip,
    p.package_preset,
    p.updated_at,
    v.id AS verification_id,
    v.submitted_at,
    v.benchmark_score,
    v.locked_by,
    v.locked_at,
    ( SELECT r.public_note
           FROM public.product_verifications r
          WHERE ((r.product_id = p.id) AND (r.decision = 'rejected'::public.product_verification_decision))
          ORDER BY r.submitted_at DESC
         LIMIT 1) AS last_rejection_note,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'storage_path', e.storage_path) ORDER BY e.kind, e.storage_path) AS jsonb_agg
           FROM public.product_verification_evidence e
          WHERE (e.verification_id = v.id)), '[]'::jsonb) AS evidence
   FROM (public.product_verifications v
     JOIN public.products p ON ((p.id = v.product_id)))
  WHERE ((v.decision IS NULL) AND (p.status = 'in_review'::public.product_status) AND (p.deleted_at IS NULL) AND public.is_admin())
  ORDER BY v.submitted_at;

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "anon";

CREATE INDEX ix_product_verifications_decided_by ON public.product_verifications USING btree (decided_by)
  WHERE (decided_by IS NOT NULL);

CREATE INDEX ix_product_verifications_locked_by ON public.product_verifications USING btree (locked_by)
  WHERE (locked_by IS NOT NULL);

CREATE INDEX ix_product_verifications_open_submitted_at ON public.product_verifications USING btree (submitted_at)
  WHERE (decision IS NULL);

CREATE INDEX ix_product_verifications_private_note_id ON public.product_verifications USING btree (private_note_id)
  WHERE (private_note_id IS NOT NULL);

CREATE INDEX ix_product_verifications_product_submitted_at ON public.product_verifications USING btree (product_id, submitted_at DESC);

CREATE INDEX ix_product_verifications_submitted_by ON public.product_verifications USING btree (submitted_by);

CREATE UNIQUE INDEX ux_product_verifications_open_product ON public.product_verifications USING btree (product_id)
  WHERE (decision IS NULL);

CREATE TRIGGER product_verifications_keep_decided_closed
  BEFORE UPDATE ON public.product_verifications
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_product_verifications_keep_decided_closed();

CREATE POLICY "product_verification_evidence_select_owner_or_admin" ON "public"."product_verification_evidence"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM (public.product_verifications v
     JOIN public.products p ON ((p.id = v.product_id)))
  WHERE ((v.id = product_verification_evidence.verification_id) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "product_verifications_select_owner_or_admin" ON "public"."product_verifications"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_verifications.product_id) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))));

COMMENT ON TABLE "public"."product_verification_evidence" IS 'One row per proof of a verification attempt (#651): its kind and its object path in bucket verification (<product_id>/<file>). A proof the seller did not change is a new row with the same path; storage objects are never overwritten. Written only by fn_submit_product_verification. Retention (#450): kept forever as verification evidence, so its foreign key is ON DELETE RESTRICT.';

COMMENT ON TABLE "public"."product_verifications" IS 'One row per verification submission of a listing (#651): what the seller submitted and, once decided, the decision, the reviewer and the notes. Written only by fn_submit_product_verification and the admin lock and verdict RPCs; one open attempt per listing; a decided attempt never changes (trigger product_verifications_keep_decided_closed). The review lock lives on the open attempt. Retention (#450): kept forever as verification evidence, so every foreign key is ON DELETE RESTRICT.';

REVOKE ALL ON FUNCTION "internal"."fn_product_verifications_keep_decided_closed"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) TO "service_role";

REVOKE ALL ON TABLE "public"."product_verification_evidence" FROM "authenticated";

GRANT SELECT ON TABLE "public"."product_verification_evidence" TO "authenticated";

REVOKE ALL ON TABLE "public"."product_verification_evidence" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verification_evidence" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verification_evidence" TO "service_role";

REVOKE ALL ON TABLE "public"."product_verifications" FROM "authenticated";

GRANT SELECT ON TABLE "public"."product_verifications" TO "authenticated";

REVOKE ALL ON TABLE "public"."product_verifications" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verifications" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_verifications" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_product_queue_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_product_queue_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_product_queue_view" TO "service_role";
