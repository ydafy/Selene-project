CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (((old.email)::text IS DISTINCT FROM (new.email)::text))
  EXECUTE FUNCTION public.fn_on_auth_user_updated();

CREATE TRIGGER tr_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_on_auth_user_created();
