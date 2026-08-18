-- 0000_baseline — the schema as it stood BEFORE 0001_llm_usage.
-- Generated from the live public schema with the 0001-owned objects removed, so
-- that 0000 + 0001 reproduces the current schema EXACTLY. That equality is VERIFIED
-- by scripts/verify/migration-replay.mjs against an ephemeral Postgres, not asserted.

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

--
-- Name: exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    batch_id text NOT NULL,
    exam_date timestamp with time zone,
    cpt text,
    procedure text,
    site text,
    institution text,
    modality text,
    wrvu numeric DEFAULT 0 NOT NULL,
    estimated boolean DEFAULT false NOT NULL,
    source text DEFAULT 'screenshot'::text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: extra_duty_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extra_duty_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    bundle_date timestamp with time zone NOT NULL,
    pay_model text NOT NULL,
    exam_count integer DEFAULT 0 NOT NULL,
    count_mri integer DEFAULT 0 NOT NULL,
    count_ct integer DEFAULT 0 NOT NULL,
    count_xr integer DEFAULT 0 NOT NULL,
    count_other integer DEFAULT 0 NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    rate_snapshot jsonb,
    label text,
    batch_id text,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: extra_duty_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extra_duty_rates (
    user_id text NOT NULL,
    per_diem_rate numeric DEFAULT 0 NOT NULL,
    ppc_mri numeric DEFAULT 0 NOT NULL,
    ppc_ct numeric DEFAULT 0 NOT NULL,
    ppc_xr numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: rvu_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rvu_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_id uuid NOT NULL,
    cpt text NOT NULL,
    modality text,
    region text,
    description text,
    contrast text,
    wrvu numeric NOT NULL,
    meta jsonb
);

--
-- Name: rvu_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rvu_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id text,
    name text NOT NULL,
    source text DEFAULT 'custom'::text NOT NULL,
    year integer,
    conversion_factor numeric,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: user_kv; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_kv (
    user_id text NOT NULL,
    key text NOT NULL,
    value jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text,
    first_name text,
    last_name text,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);

--
-- Name: extra_duty_periods extra_duty_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extra_duty_periods
    ADD CONSTRAINT extra_duty_periods_pkey PRIMARY KEY (id);

--
-- Name: extra_duty_rates extra_duty_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extra_duty_rates
    ADD CONSTRAINT extra_duty_rates_pkey PRIMARY KEY (user_id);

--
-- Name: rvu_codes rvu_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rvu_codes
    ADD CONSTRAINT rvu_codes_pkey PRIMARY KEY (id);

--
-- Name: rvu_tables rvu_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rvu_tables
    ADD CONSTRAINT rvu_tables_pkey PRIMARY KEY (id);

--
-- Name: user_kv user_kv_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_kv
    ADD CONSTRAINT user_kv_pkey PRIMARY KEY (user_id, key);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: exams_user_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exams_user_batch_idx ON public.exams USING btree (user_id, batch_id);

--
-- Name: exams_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exams_user_date_idx ON public.exams USING btree (user_id, exam_date);

--
-- Name: extra_duty_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX extra_duty_user_date_idx ON public.extra_duty_periods USING btree (user_id, bundle_date);

--
-- Name: rvu_codes_table_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rvu_codes_table_idx ON public.rvu_codes USING btree (table_id);

--
-- Name: rvu_codes rvu_codes_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rvu_codes
    ADD CONSTRAINT rvu_codes_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.rvu_tables(id) ON DELETE CASCADE;
