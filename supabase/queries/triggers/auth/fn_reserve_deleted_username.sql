-- Source body for public.fn_reserve_deleted_username() (BEFORE INSERT OR UPDATE
-- OF username on public.profiles).
-- Migration: supabase/migrations/*_reserve_deleted_username_prefix.sql
-- "deleted_" is reserved for accounts closed by fn_close_account. Only the
-- closure transition (deleted_at goes from NULL to set in the same UPDATE, run
-- by a role other than anon or authenticated) may write it; an unchanged username is never rejected, so older rows stay valid.
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.username IS NOT DISTINCT FROM OLD.username THEN
    RETURN NEW;
  END IF;

  IF NEW.username ILIKE 'deleted\_%' THEN
    IF TG_OP = 'UPDATE'
       AND current_user NOT IN ('anon', 'authenticated')
       AND OLD.deleted_at IS NULL
       AND NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Username "%" is reserved', NEW.username
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
