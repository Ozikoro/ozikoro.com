CREATE TYPE public.teacher_status AS ENUM ('pending','approved','suspended');
CREATE TYPE public.booking_status AS ENUM ('requested','confirmed','completed','cancelled');

CREATE TABLE public.teacher_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  headline text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  dialects text[] NOT NULL DEFAULT '{}',
  specialties text[] NOT NULL DEFAULT '{}',
  qualifications text NOT NULL DEFAULT '',
  years_experience int NOT NULL DEFAULT 0,
  hourly_rate_kobo int NOT NULL DEFAULT 0 CHECK (hourly_rate_kobo >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  video_url text,
  photo_url text,
  country text NOT NULL DEFAULT '',
  open_to_schools boolean NOT NULL DEFAULT true,
  status public.teacher_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.teacher_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_profiles TO authenticated;
GRANT ALL ON public.teacher_profiles TO service_role;
ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approved teachers are public" ON public.teacher_profiles FOR SELECT USING (status = 'approved' OR user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Teachers create own profile" ON public.teacher_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'pending');
CREATE POLICY "Teachers edit own profile" ON public.teacher_profiles FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete teachers" ON public.teacher_profiles FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Teachers cannot approve themselves.
CREATE OR REPLACE FUNCTION public.guard_teacher_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only admins can change teacher status';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER teacher_status_guard BEFORE UPDATE ON public.teacher_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_teacher_status();

CREATE TABLE public.lesson_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  minutes int NOT NULL DEFAULT 60 CHECK (minutes BETWEEN 15 AND 240),
  note text NOT NULL DEFAULT '',
  price_kobo int NOT NULL DEFAULT 0,
  status public.booking_status NOT NULL DEFAULT 'requested',
  payment_reference text,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.lesson_bookings TO authenticated;
GRANT ALL ON public.lesson_bookings TO service_role;
ALTER TABLE public.lesson_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parties see bookings" ON public.lesson_bookings FOR SELECT TO authenticated USING (learner_id = auth.uid() OR teacher_id IN (SELECT id FROM public.teacher_profiles WHERE user_id = auth.uid()));
CREATE POLICY "Learners request bookings" ON public.lesson_bookings FOR INSERT TO authenticated WITH CHECK (learner_id = auth.uid() AND status = 'requested' AND paid = false);
CREATE POLICY "Parties update bookings" ON public.lesson_bookings FOR UPDATE TO authenticated USING (learner_id = auth.uid() OR teacher_id IN (SELECT id FROM public.teacher_profiles WHERE user_id = auth.uid()));
-- Payment fields only change server-side (Paystack webhook with service role).
CREATE OR REPLACE FUNCTION public.guard_booking_payment() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.paid IS DISTINCT FROM OLD.paid OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference OR NEW.price_kobo IS DISTINCT FROM OLD.price_kobo) AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Payment fields are set by the payment server only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_payment_guard BEFORE UPDATE ON public.lesson_bookings FOR EACH ROW EXECUTE FUNCTION public.guard_booking_payment();

CREATE TABLE public.teacher_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.lesson_bookings(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.teacher_reviews TO anon;
GRANT SELECT, INSERT ON public.teacher_reviews TO authenticated;
GRANT ALL ON public.teacher_reviews TO service_role;
ALTER TABLE public.teacher_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reviews are public" ON public.teacher_reviews FOR SELECT USING (true);
CREATE POLICY "Learners review completed lessons" ON public.teacher_reviews FOR INSERT TO authenticated WITH CHECK (
  reviewer_id = auth.uid() AND EXISTS (SELECT 1 FROM public.lesson_bookings b WHERE b.id = booking_id AND b.learner_id = auth.uid() AND b.teacher_id = teacher_reviews.teacher_id AND b.status = 'completed'));

CREATE TABLE public.school_hire_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_name text NOT NULL,
  contact_email text NOT NULL,
  role_details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.school_hire_requests TO authenticated;
GRANT ALL ON public.school_hire_requests TO service_role;
ALTER TABLE public.school_hire_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parties see hire requests" ON public.school_hire_requests FOR SELECT TO authenticated USING (requester_id = auth.uid() OR teacher_id IN (SELECT id FROM public.teacher_profiles WHERE user_id = auth.uid()));
CREATE POLICY "Schools send hire requests" ON public.school_hire_requests FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid() AND status = 'sent');
CREATE POLICY "Teachers answer hire requests" ON public.school_hire_requests FOR UPDATE TO authenticated USING (teacher_id IN (SELECT id FROM public.teacher_profiles WHERE user_id = auth.uid()));

CREATE VIEW public.teacher_ratings WITH (security_invoker = true) AS
  SELECT teacher_id, round(avg(rating)::numeric, 1) AS avg_rating, count(*)::int AS review_count FROM public.teacher_reviews GROUP BY teacher_id;
GRANT SELECT ON public.teacher_ratings TO anon, authenticated;