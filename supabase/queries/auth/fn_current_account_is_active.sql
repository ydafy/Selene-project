
SELECT NOT EXISTS (
    SELECT 1
    FROM public.profiles_private
    WHERE id = (SELECT auth.uid())
    AND status IN ('suspended', 'banned')
);
