--
-- PostgreSQL database dump
--

\restrict FZ8LdxgTXjntyhkVplBMdCSuKp4XpmJHMckhFYsVKjj8JfVsRfkcpmqFU7rfUE1

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: booking_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.booking_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.booking_seq OWNER TO zkdapp;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bookings; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.bookings (
    id text NOT NULL,
    passenger_id text NOT NULL,
    flight_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.bookings OWNER TO zkdapp;

--
-- Name: credentials; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.credentials (
    email text NOT NULL,
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.credentials OWNER TO zkdapp;

--
-- Name: decision_ledger; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.decision_ledger (
    id bigint NOT NULL,
    kind text NOT NULL,
    flight_id text,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.decision_ledger OWNER TO zkdapp;

--
-- Name: decision_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.decision_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.decision_ledger_id_seq OWNER TO zkdapp;

--
-- Name: decision_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: zkdapp
--

ALTER SEQUENCE public.decision_ledger_id_seq OWNED BY public.decision_ledger.id;


--
-- Name: disruption_events; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.disruption_events (
    flight_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.disruption_events OWNER TO zkdapp;

--
-- Name: flights; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.flights (
    id text NOT NULL,
    dep_iso text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.flights OWNER TO zkdapp;

--
-- Name: itineraries; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.itineraries (
    id text NOT NULL,
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.itineraries OWNER TO zkdapp;

--
-- Name: itinerary_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.itinerary_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.itinerary_seq OWNER TO zkdapp;

--
-- Name: journey_prefs; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.journey_prefs (
    key text NOT NULL,
    flight_id text NOT NULL,
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.journey_prefs OWNER TO zkdapp;

--
-- Name: migrations; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.migrations OWNER TO zkdapp;

--
-- Name: passengers; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.passengers (
    id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.passengers OWNER TO zkdapp;

--
-- Name: past_flights; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.past_flights (
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.past_flights OWNER TO zkdapp;

--
-- Name: pipeline_runs; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.pipeline_runs (
    key text NOT NULL,
    flight_id text NOT NULL,
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.pipeline_runs OWNER TO zkdapp;

--
-- Name: pre_auths; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.pre_auths (
    key text NOT NULL,
    flight_id text NOT NULL,
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.pre_auths OWNER TO zkdapp;

--
-- Name: ranker_decision_log; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.ranker_decision_log (
    id bigint NOT NULL,
    kind text NOT NULL,
    decision_id text NOT NULL,
    flight_id text NOT NULL,
    member_id text,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.ranker_decision_log OWNER TO zkdapp;

--
-- Name: ranker_decision_log_id_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.ranker_decision_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ranker_decision_log_id_seq OWNER TO zkdapp;

--
-- Name: ranker_decision_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: zkdapp
--

ALTER SEQUENCE public.ranker_decision_log_id_seq OWNED BY public.ranker_decision_log.id;


--
-- Name: recovery_tasks; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.recovery_tasks (
    key text NOT NULL,
    flight_id text NOT NULL,
    passenger_id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.recovery_tasks OWNER TO zkdapp;

--
-- Name: ride_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.ride_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ride_seq OWNER TO zkdapp;

--
-- Name: rides; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.rides (
    id text NOT NULL,
    passenger_id text NOT NULL,
    flight_id text,
    data jsonb NOT NULL
);


ALTER TABLE public.rides OWNER TO zkdapp;

--
-- Name: seed_state; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.seed_state (
    id text NOT NULL
);


ALTER TABLE public.seed_state OWNER TO zkdapp;

--
-- Name: stay_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.stay_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stay_seq OWNER TO zkdapp;

--
-- Name: stays; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.stays (
    id text NOT NULL,
    passenger_id text NOT NULL,
    flight_id text,
    data jsonb NOT NULL
);


ALTER TABLE public.stays OWNER TO zkdapp;

--
-- Name: task_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.task_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_seq OWNER TO zkdapp;

--
-- Name: traveller_seq; Type: SEQUENCE; Schema: public; Owner: zkdapp
--

CREATE SEQUENCE public.traveller_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.traveller_seq OWNER TO zkdapp;

--
-- Name: travellers; Type: TABLE; Schema: public; Owner: zkdapp
--

CREATE TABLE public.travellers (
    id text NOT NULL,
    data jsonb NOT NULL
);


ALTER TABLE public.travellers OWNER TO zkdapp;

--
-- Name: decision_ledger id; Type: DEFAULT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.decision_ledger ALTER COLUMN id SET DEFAULT nextval('public.decision_ledger_id_seq'::regclass);


--
-- Name: ranker_decision_log id; Type: DEFAULT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.ranker_decision_log ALTER COLUMN id SET DEFAULT nextval('public.ranker_decision_log_id_seq'::regclass);


--
-- Data for Name: bookings; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.bookings (id, passenger_id, flight_id, data) FROM stdin;
bk16	p-priya	u1	{"id": "bk16", "pnr": "QK7R2M", "seat": "14C", "cabin": "Economy", "seats": [{"seat": "14C", "travellerId": "tr24"}], "farePaid": {"amount": 7450, "currency": "INR"}, "flightId": "u1", "legIndex": 0, "fareBasis": "partially-refundable", "itineraryId": "it2", "passengerId": "p-priya", "travellerIds": ["tr24"]}
bk17	p-priya	u2	{"id": "bk17", "pnr": "QK7R2M", "seat": "22A", "cabin": "Economy", "seats": [{"seat": "22A", "travellerId": "tr25"}], "farePaid": {"amount": 48200, "currency": "INR"}, "flightId": "u2", "legIndex": 1, "fareBasis": "refundable", "itineraryId": "it2", "passengerId": "p-priya", "travellerIds": ["tr25"]}
bk18	p-priya	u3	{"id": "bk18", "pnr": "LP4XZ1", "seat": "8F", "cabin": "Economy", "seats": [{"seat": "8F", "travellerId": "tr26"}], "farePaid": {"amount": 5980, "currency": "INR"}, "flightId": "u3", "fareBasis": "non-refundable", "passengerId": "p-priya", "travellerIds": ["tr26"]}
bk19	p-priya	u4	{"id": "bk19", "pnr": "GV3K9R", "seat": "11A", "cabin": "Economy", "seats": [{"seat": "11A", "travellerId": "tr27"}], "farePaid": {"amount": 6720, "currency": "INR"}, "flightId": "u4", "fareBasis": "partially-refundable", "passengerId": "p-priya", "travellerIds": ["tr27"]}
bk20	p-priya	u5	{"id": "bk20", "pnr": "HT6M2B", "seat": "9C", "cabin": "Economy", "seats": [{"seat": "9C", "travellerId": "tr28"}], "farePaid": {"amount": 8310, "currency": "INR"}, "flightId": "u5", "fareBasis": "partially-refundable", "passengerId": "p-priya", "travellerIds": ["tr28"]}
bk21	p-priya	u6	{"id": "bk21", "pnr": "RN8W5D", "seat": "4A", "cabin": "Premium Economy", "seats": [{"seat": "4A", "travellerId": "tr29"}], "farePaid": {"amount": 14900, "currency": "INR"}, "flightId": "u6", "fareBasis": "refundable", "passengerId": "p-priya", "travellerIds": ["tr29"]}
bk22	p-arjun	f-multi	{"id": "bk22", "pnr": "MX9F2K", "seat": "12A", "cabin": "Economy", "seats": [{"seat": "12A", "travellerId": "tr30"}, {"seat": "12B", "travellerId": "tr31"}, {"seat": "12C", "travellerId": "tr32"}, {"seat": "12D", "travellerId": "tr33"}, {"seat": "12E", "travellerId": "tr34"}, {"seat": "12F", "travellerId": "tr35"}], "farePaid": {"amount": 6450, "currency": "INR"}, "flightId": "f-multi", "fareBasis": "partially-refundable", "passengerId": "p-arjun", "travellerIds": ["tr30", "tr31", "tr32", "tr33", "tr34", "tr35"]}
bk23	p-rohan	f-multi	{"id": "bk23", "pnr": "RT4H8P", "seat": "14C", "cabin": "Economy", "seats": [{"seat": "14C", "travellerId": "tr36"}, {"seat": "14D", "travellerId": "tr37"}], "farePaid": {"amount": 9180, "currency": "INR"}, "flightId": "f-multi", "fareBasis": "non-refundable", "passengerId": "p-rohan", "travellerIds": ["tr36", "tr37"]}
bk24	p-fatima	f-depth	{"id": "bk24", "pnr": "FS3K9L", "seat": "9A", "cabin": "Economy", "seats": [{"seat": "9A", "travellerId": "tr38"}, {"seat": "9B", "travellerId": "tr39"}, {"seat": "9C", "travellerId": "tr40"}], "farePaid": {"amount": 5240, "currency": "INR"}, "flightId": "f-depth", "fareBasis": "non-refundable", "passengerId": "p-fatima", "travellerIds": ["tr38", "tr39", "tr40"]}
bk25	p-ananya	f-depth	{"id": "bk25", "pnr": "AZ2N7Q", "seat": "6D", "cabin": "Economy", "seats": [{"seat": "6D", "travellerId": "tr41"}], "farePaid": {"amount": 5240, "currency": "INR"}, "flightId": "f-depth", "fareBasis": "non-refundable", "passengerId": "p-ananya", "travellerIds": ["tr41"]}
\.


--
-- Data for Name: credentials; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.credentials (email, passenger_id, data) FROM stdin;
priya@zkd.demo	p-priya	{"email": "priya@zkd.demo", "passengerId": "p-priya", "passwordHash": "scrypt$c1d632ccd8b0cb276ffbae215f8a8c0f$9abee825097e1bfc059942faf07cb145f0fa11817f5d65fb3a0725f236adf824be37abee5d8ce8111f27713b21297d97033a1dd3bbfbaf1f48d59b1415c6faf6"}
arjun@zkd.demo	p-arjun	{"email": "arjun@zkd.demo", "passengerId": "p-arjun", "passwordHash": "scrypt$5d2bd3434bcebc217ce069ba800abbe0$ad715d1c91d3152b8e96011697dc4d2676813301e7c7f1b3612189dc7e870c99dc6ffcbd0b3b396c0fd6d72a9719e5a0a9d169261660a9fef49f0059f7264d44"}
fatima@zkd.demo	p-fatima	{"email": "fatima@zkd.demo", "passengerId": "p-fatima", "passwordHash": "scrypt$f67d8251e1f871fddc0361a5f52487f5$fdece2cedff06b97367aeb05ea34c3792b48ab0309d900d0071981ebc08e840ee71b0e7c010e812b7b8089a928142862944c214b510c3beb7d997acd0eb2f74e"}
rohan@zkd.demo	p-rohan	{"email": "rohan@zkd.demo", "passengerId": "p-rohan", "passwordHash": "scrypt$b30e30bb4aeedccf4c0ab821b00554e3$0b418c69c3546c5cfb77fb9ad8dc0d23c69e19ac299b1bd1d0afc625b2bbb94138c28b94932180ef4e28e80ffe8eac90f18b2219c4609213af38d10aa676a505"}
ananya@zkd.demo	p-ananya	{"email": "ananya@zkd.demo", "passengerId": "p-ananya", "passwordHash": "scrypt$63b25c7d96b86f5ed79c9fd4f45b6a47$268a56eb616a1bf8eba74665a9b001f028e49d6137e0dff84fc427696ded49f778459d5197bad87e1e06895d22211e672c29df8a4f679bd8346e0b839681ee3a"}
\.


--
-- Data for Name: decision_ledger; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.decision_ledger (id, kind, flight_id, logged_at, data) FROM stdin;
1	notification	f-depth	2026-08-22 18:32:22.257371+05:30	{"kind": "cancelled", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "f-depth", "loggedAt": 1787403742254, "delivered": false, "passengerId": "p-ananya"}
2	notification	f-depth	2026-08-22 18:32:23.161661+05:30	{"kind": "cancelled", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "f-depth", "loggedAt": 1787403743161, "delivered": false, "passengerId": "p-fatima"}
3	notification	f-depth	2026-08-22 18:32:23.467901+05:30	{"kind": "booked", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "f-depth", "loggedAt": 1787403743466, "delivered": false, "passengerId": "p-ananya"}
4	notification	f-depth	2026-08-22 18:32:24.480743+05:30	{"kind": "booked", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "f-depth", "loggedAt": 1787403744479, "delivered": false, "passengerId": "p-fatima"}
5	member-report	u4	2026-08-22 18:33:12.393212+05:30	{"source": "member", "reports": 1, "evidence": ["1 of 3 independent reports", "our airline data feed shows this flight cancelled"], "flightId": "u4", "loggedAt": 1787403792392, "confirmed": true, "passengerId": "p-priya"}
6	notification	u4	2026-08-22 18:33:15.236273+05:30	{"kind": "cancelled", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "u4", "loggedAt": 1787403795235, "delivered": false, "passengerId": "p-priya"}
7	notification	u4	2026-08-22 18:33:19.002785+05:30	{"kind": "booked", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "u4", "loggedAt": 1787403799001, "delivered": false, "passengerId": "p-priya"}
8	member-report	u2	2026-08-22 18:38:21.063915+05:30	{"source": "member", "reports": 1, "evidence": ["1 of 3 independent reports", "no live status available (unconfigured, cached, or out of allowance)"], "flightId": "u2", "loggedAt": 1787404101061, "confirmed": false, "passengerId": "p-priya"}
9	member-report	u3	2026-08-22 18:39:03.176758+05:30	{"source": "member", "reports": 1, "evidence": ["1 of 3 independent reports", "our airline data feed shows this flight cancelled"], "flightId": "u3", "loggedAt": 1787404143176, "confirmed": true, "passengerId": "p-priya"}
10	notification	u3	2026-08-22 18:39:08.49037+05:30	{"kind": "cancelled", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "u3", "loggedAt": 1787404148489, "delivered": false, "passengerId": "p-priya"}
11	notification	u3	2026-08-22 18:39:13.460242+05:30	{"kind": "booked", "channels": [{"ok": false, "error": "ContentSid Required (no open session and no template: WhatsApp forbids business-initiated free text. In the sandbox the recipient must send the join code; in production set TWILIO_WHATSAPP_CONTENT_SID to an approved UTILITY template)", "channel": "whatsapp", "skipped": false}, {"ok": false, "channel": "push", "skipped": true}, {"ok": false, "error": "You need to complete one transaction of 100 INR or more before using API route.", "channel": "sms", "skipped": false}], "flightId": "u3", "loggedAt": 1787404153459, "delivered": false, "passengerId": "p-priya"}
12	member-intent	u4	2026-08-22 18:40:56.41797+05:30	{"changes": [], "clamped": [], "flightId": "u4", "loggedAt": 1787404256416, "restated": "You want to find flight options departing only after 4:00 AM.", "keptCount": 28, "confidence": "high", "passengerId": "p-priya", "unsupported": ["only after 4AM"], "removedCount": 0}
\.


--
-- Data for Name: disruption_events; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.disruption_events (flight_id, data) FROM stdin;
\.


--
-- Data for Name: flights; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.flights (id, dep_iso, data) FROM stdin;
f-depth	2026-08-25T07:30:00.000Z	{"id": "f-depth", "to": "MAA", "code": "6E 234", "from": "BLR", "depISO": "2026-08-25T07:30:00.000Z", "aircraft": "A320", "terminal": "T1", "candidates": {"alts": [], "cabs": [], "hotels": [], "cabLegs": []}, "durationMin": 80, "hasHardConstraint": false, "connectionSlackMinutes": null}
u5	2026-09-01T00:30:00.000Z	{"id": "u5", "to": "DEL", "code": "6E 2789", "from": "BOM", "depISO": "2026-09-01T00:30:00.000Z", "aircraft": "A321neo", "terminal": "T2", "candidates": {"alts": [], "cabs": [], "hotels": [], "cabLegs": []}, "durationMin": 130, "hasHardConstraint": false, "connectionSlackMinutes": null}
u2	2026-08-25T09:38:00.000Z	{"id": "u2", "to": "LHR", "code": "AI 2201", "from": "DEL", "depISO": "2026-08-25T09:38:00.000Z", "aircraft": "B787-9", "terminal": "T3", "candidates": {"alts": [], "cabs": [], "hotels": [], "cabLegs": []}, "durationMin": 555, "hasHardConstraint": true, "connectionSlackMinutes": null}
u4	2026-09-01T00:30:00.000Z	{"id": "u4", "to": "GOI", "code": "6E 6155", "from": "BOM", "depISO": "2026-09-01T00:30:00.000Z", "aircraft": "A320neo", "terminal": "T2", "candidates": {"alts": [], "cabs": [], "hotels": [], "cabLegs": []}, "durationMin": 90, "hasHardConstraint": false, "connectionSlackMinutes": null}
u6	2026-09-01T00:30:00.000Z	{"id": "u6", "to": "BLR", "code": "AI 2984", "from": "DEL", "depISO": "2026-09-01T00:30:00.000Z", "aircraft": "A320neo", "terminal": "T3", "candidates": {"alts": [], "cabs": [], "hotels": [], "cabLegs": []}, "durationMin": 165, "hasHardConstraint": true, "connectionSlackMinutes": 55}
u1	2026-08-25T03:18:00.000Z	{"id": "u1", "to": "DEL", "code": "AI 2803", "from": "MAA", "depISO": "2026-08-25T03:18:00.000Z", "aircraft": "A320neo", "terminal": "T1", "candidates": {"alts": [], "cabs": [{"id": "c1", "ok": true, "why": "Within the transfer allowance the airline reimburses", "kind": "Sedan", "extra": 0, "seats": 3, "currency": "INR"}, {"id": "c2", "ok": true, "why": "More boot space for your London bags · ₹900 over the allowance", "kind": "SUV", "extra": 900, "seats": 6, "currency": "INR"}, {"id": "c3", "ok": false, "why": "Beyond the transfer allowance the airline will reimburse", "kind": "Chauffeured luxury", "extra": 6200, "seats": 3, "currency": "INR"}], "hotels": [{"id": "h1", "ok": true, "why": "Same property, same rate — we only moved the check-in time", "area": "Aerocity · 8 min from T3", "name": "Andaz Delhi Aerocity", "rate": 0, "walk": "Your existing booking, re-timed", "extra": 0, "checkin": "16:30", "currency": "INR"}, {"id": "h2", "ok": true, "why": "Airline-covered up to your entitlement; ₹2,400 over", "area": "Aerocity · 10 min from T3", "name": "Roseate House", "rate": 0, "walk": "New booking", "extra": 2400, "checkin": "17:00", "currency": "INR"}, {"id": "h3", "ok": false, "why": "Beyond the duty-of-care rate the airline will reimburse", "area": "Chanakyapuri · 40 min from T3", "name": "The Leela Palace", "rate": 0, "walk": "New booking", "extra": 14800, "checkin": "17:00", "currency": "INR"}], "cabLegs": [{"id": "l1", "to": "Andaz Aerocity", "from": "DEL T3", "note": "Re-timed around your new arrival", "pickup": "14:08"}, {"id": "l2", "to": "DEL T3", "from": "Andaz Aerocity", "note": "Re-timed for your London departure", "pickup": "09:40"}]}, "durationMin": 160, "hasHardConstraint": true, "connectionSlackMinutes": 220}
u3	2026-09-11T02:18:00.000Z	{"id": "u3", "to": "DEL", "code": "6E 5192", "from": "BOM", "depISO": "2026-09-11T02:18:00.000Z", "aircraft": "A320", "terminal": "T2", "candidates": {"alts": [], "cabs": [], "hotels": [], "cabLegs": []}, "durationMin": 135, "hasHardConstraint": false, "connectionSlackMinutes": null}
f-multi	2026-08-25T05:30:00.000Z	{"id": "f-multi", "to": "BLR", "code": "AI 401", "from": "DEL", "depISO": "2026-08-25T05:30:00.000Z", "aircraft": "A321neo", "terminal": "T3", "candidates": {"alts": [], "cabs": [{"id": "mc1", "ok": true, "why": "Within the transfer allowance the airline reimburses", "kind": "Sedan", "extra": 0, "seats": 3, "currency": "INR"}, {"id": "mc2", "ok": true, "why": "One vehicle for the whole party · ₹900 over the allowance", "kind": "SUV", "extra": 900, "seats": 6, "currency": "INR"}], "hotels": [{"id": "mh1", "ok": true, "why": "Within the duty-of-care rate", "area": "Airport area · 12 min", "name": "Ibis Bengaluru Airport", "rate": 0, "walk": "New booking", "extra": 0, "checkin": "18:00", "currency": "INR"}, {"id": "mh2", "ok": true, "why": "Airline-covered up to your entitlement; ₹2,400 over per room", "area": "Airport area · 15 min", "name": "Trinity Hometel", "rate": 0, "walk": "New booking", "extra": 2400, "checkin": "18:00", "currency": "INR"}], "cabLegs": [{"id": "ml1", "to": "Ibis Bengaluru Airport", "from": "BLR T2", "note": "Re-timed around new arrival", "pickup": "15:40"}]}, "durationMin": 170, "hasHardConstraint": false, "connectionSlackMinutes": null}
\.


--
-- Data for Name: itineraries; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.itineraries (id, passenger_id, data) FROM stdin;
it2	p-priya	{"id": "it2", "bookingIds": ["bk16", "bk17"], "passengerId": "p-priya"}
\.


--
-- Data for Name: journey_prefs; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.journey_prefs (key, flight_id, passenger_id, data) FROM stdin;
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.migrations (name, applied_at) FROM stdin;
0001_init.sql	2026-08-17 13:11:38.997348+05:30
0002_stays_and_rides.sql	2026-08-18 07:44:12.906804+05:30
0003_journey_prefs.sql	2026-08-22 18:17:24.472969+05:30
0004_preauth_flight_index.sql	2026-08-22 18:17:24.485471+05:30
0005_pipeline_runs.sql	2026-08-22 18:17:24.500917+05:30
0006_decision_ledger.sql	2026-08-22 18:17:24.519979+05:30
0007_ranker_decision_log.sql	2026-08-22 18:17:24.540829+05:30
\.


--
-- Data for Name: passengers; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.passengers (id, data) FROM stdin;
p-priya	{"id": "p-priya", "dob": "14 Mar 1988", "prefs": [{"k": "Seat", "v": "Aisle, forward cabin"}, {"k": "Meal", "v": "Vegetarian (AVML)"}, {"k": "Cabin entitlement", "v": "Economy"}, {"k": "Per-transaction cap", "v": "₹25,000"}], "gender": "Female", "consent": "autopilot", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "payment": {"card": "Amex Platinum •••• •••• •••• 1008", "method": "Single-use virtual card per booking"}, "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian"}
p-arjun	{"id": "p-arjun", "dob": "02 Jul 1991", "prefs": [{"k": "Cabin entitlement", "v": "Economy"}, {"k": "Per-transaction cap", "v": "₹25,000"}], "gender": "Male", "consent": "autopilot", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "payment": {"card": "Amex Platinum •••• •••• •••• 1008", "method": "Single-use virtual card per booking"}, "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "ARJUN MEHTA", "displayName": "Arjun M.", "nationality": "Indian"}
p-fatima	{"id": "p-fatima", "dob": "19 Nov 1994", "prefs": [{"k": "Cabin entitlement", "v": "Economy"}, {"k": "Per-transaction cap", "v": "₹25,000"}], "gender": "Female", "consent": "autopilot", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "payment": {"card": "Amex Platinum •••• •••• •••• 1008", "method": "Single-use virtual card per booking"}, "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "FATIMA SHEIKH", "displayName": "Fatima S.", "nationality": "Indian"}
p-rohan	{"id": "p-rohan", "dob": "30 Jan 1985", "prefs": [{"k": "Cabin entitlement", "v": "Economy"}, {"k": "Per-transaction cap", "v": "₹25,000"}], "gender": "Male", "consent": "autopilot", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "payment": {"card": "Amex Platinum •••• •••• •••• 1008", "method": "Single-use virtual card per booking"}, "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "ROHAN VERMA", "displayName": "Rohan V.", "nationality": "Indian"}
p-ananya	{"id": "p-ananya", "dob": "08 Sep 1997", "prefs": [{"k": "Cabin entitlement", "v": "Economy"}, {"k": "Per-transaction cap", "v": "₹25,000"}], "gender": "Female", "consent": "autopilot", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "payment": {"card": "Amex Platinum •••• •••• •••• 1008", "method": "Single-use virtual card per booking"}, "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "ANANYA IYER", "displayName": "Ananya I.", "nationality": "Indian"}
\.


--
-- Data for Name: past_flights; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.past_flights (passenger_id, data) FROM stdin;
p-priya	[{"id": "p1", "to": "DEL", "arr": "07:20", "dep": "05:00", "dur": "2h 20m", "code": "6E 6402", "date": "47 days ago", "from": "CCU", "exact": "3 Jul 2026", "detail": "Cancelled 50 minutes before departure · rebooked automatically", "outcome": "cancelled", "recovered": "We put you on 6E 812 three hours later and the airline covered the fare."}, {"id": "p2", "to": "BLR", "arr": "21:15", "dep": "18:30", "dur": "2h 45m", "code": "AI 803", "date": "66 days ago", "from": "DEL", "exact": "14 Jun 2026", "detail": "Departed 2h 10m late", "outcome": "delayed"}, {"id": "p3", "to": "DEL", "arr": "10:30", "dep": "07:45", "dur": "2h 45m", "code": "UK 996", "date": "69 days ago", "from": "BLR", "exact": "11 Jun 2026", "detail": "On time", "outcome": "ontime"}, {"id": "p4", "to": "GAU", "arr": "08:30", "dep": "06:00", "dur": "2h 30m", "code": "6E 2117", "date": "236 days ago", "from": "DEL", "exact": "26 Dec 2025", "detail": "Delhi weather closure", "outcome": "cancelled", "recovered": "No same-day seat existed. We booked you a hotel and the first flight next morning."}, {"id": "p5", "to": "DEL", "arr": "09:40", "dep": "07:00", "dur": "2h 40m", "code": "AI 2803", "date": "250 days ago", "from": "MAA", "exact": "12 Dec 2025", "detail": "On time", "outcome": "ontime"}, {"id": "p6", "to": "MAA", "arr": "23:55", "dep": "21:10", "dur": "2h 45m", "code": "SG 8169", "date": "267 days ago", "from": "DEL", "exact": "25 Nov 2025", "detail": "Departed 55m late", "outcome": "delayed"}, {"id": "p7", "to": "DEL", "arr": "09:40", "dep": "07:00", "dur": "2h 40m", "code": "AI 2803", "date": "322 days ago", "from": "MAA", "exact": "1 Oct 2025", "detail": "On time", "outcome": "ontime"}, {"id": "p8", "to": "DEL", "arr": "08:15", "dep": "06:00", "dur": "2h 15m", "code": "6E 5192", "date": "401 days ago", "from": "BOM", "exact": "14 Jul 2025", "detail": "On time", "outcome": "ontime"}]
\.


--
-- Data for Name: pipeline_runs; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.pipeline_runs (key, flight_id, passenger_id, data) FROM stdin;
\.


--
-- Data for Name: pre_auths; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.pre_auths (key, flight_id, passenger_id, data) FROM stdin;
\.


--
-- Data for Name: ranker_decision_log; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.ranker_decision_log (id, kind, decision_id, flight_id, member_id, logged_at, data) FROM stdin;
1	shown	f-depth:p-ananya:1787403741698	f-depth	p-ananya	2026-08-22 18:32:21.701557+05:30	{"weights": {"cost": 0.6, "cabin": 0.48, "seats": 0.3, "effort": 0.6, "redeye": 0.6, "arrival": 3, "loyalty": 1.04, "stability": 1.2, "weatherRisk": 1, "advisoryRisk": 2.5}, "flightId": "f-depth", "loggedAt": 1787403741698, "memberId": "p-ananya", "strategy": "earliest_arrival", "candidates": [{"code": "6E 6269", "rank": 0, "altId": "oag:BLRMAA:2026-08-25:6E 6269", "utility": 0.537, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.013888888888888888, "loyalty": 1, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 9762", "rank": 1, "altId": "oag:BLRMAA:2026-08-25:AI 9762", "utility": 0.4273, "features": {"cost": 0, "cabin": 0, "seats": 0.125, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "KL 4719", "rank": 2, "altId": "oag:BLRMAA:2026-08-25:KL 4719", "utility": -0.353, "features": {"cost": 0, "cabin": 0, "seats": 0.875, "effort": 0, "redeye": 0, "arrival": -0.013888888888888888, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "JL 9059", "rank": 3, "altId": "oag:BLRMAA:2026-08-25:JL 9059", "utility": -0.428, "features": {"cost": 0, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.013888888888888888, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AF 3780", "rank": 4, "altId": "oag:BLRMAA:2026-08-25:AF 3780", "utility": -0.4655, "features": {"cost": 0, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.013888888888888888, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 1472", "rank": 5, "altId": "oag:BLRMAA:2026-08-25:IX 1472", "utility": -0.5739, "features": {"cost": 0, "cabin": 0, "seats": 0, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "QF 5241", "rank": 6, "altId": "oag:BLRMAA:2026-08-25:QF 5241", "utility": -0.578, "features": {"cost": 0, "cabin": 0, "seats": 0.125, "effort": 0, "redeye": 0, "arrival": -0.013888888888888888, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "VS 8442", "rank": 7, "altId": "oag:BLRMAA:2026-08-25:VS 8442", "utility": -0.578, "features": {"cost": 0, "cabin": 0, "seats": 0.125, "effort": 0, "redeye": 0, "arrival": -0.013888888888888888, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BZ 201", "rank": 8, "altId": "oag:BLRMAA:2026-08-25:BZ 201", "utility": -0.6322, "features": {"cost": 0, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.06944444444444445, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BA 8298", "rank": 9, "altId": "oag:BLRMAA:2026-08-25:BA 8298", "utility": -2.3655, "features": {"cost": 0, "cabin": 0, "seats": 0, "effort": 0, "redeye": 0, "arrival": -0.5972222222222222, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}], "decisionId": "f-depth:p-ananya:1787403741698", "weightsVersion": 2}
2	shown	f-depth:p-fatima:1787403742825	f-depth	p-fatima	2026-08-22 18:32:22.826852+05:30	{"weights": {"cost": 0.6, "cabin": 0.48, "seats": 0.3, "effort": 0.6, "redeye": 0.6, "arrival": 3, "loyalty": 1.04, "stability": 1.2, "weatherRisk": 1, "advisoryRisk": 2.5}, "flightId": "f-depth", "loggedAt": 1787403742825, "memberId": "p-fatima", "strategy": "earliest_arrival", "candidates": [{"code": "6E 6269", "rank": 0, "altId": "oag:BLRMAA:2026-08-25:6E 6269", "utility": -0.8297, "features": {"cost": 0, "cabin": 0, "seats": 0.125, "effort": 0, "redeye": 0, "arrival": -0.4444444444444444, "loyalty": 1, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9808", "rank": 1, "altId": "duffel:off_0000B9dD5XbzNTpp2qmQ7j", "utility": -1.5489, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "KL 4719", "rank": 2, "altId": "oag:BLRMAA:2026-08-25:KL 4719", "utility": -1.7197, "features": {"cost": 0, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.4444444444444444, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "JL 9059", "rank": 3, "altId": "oag:BLRMAA:2026-08-25:JL 9059", "utility": -1.7947, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.4444444444444444, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AF 3780", "rank": 4, "altId": "oag:BLRMAA:2026-08-25:AF 3780", "utility": -1.8322, "features": {"cost": 0, "cabin": 0, "seats": 0.25, "effort": 0, "redeye": 0, "arrival": -0.4444444444444444, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BZ 201", "rank": 5, "altId": "oag:BLRMAA:2026-08-25:BZ 201", "utility": -1.9989, "features": {"cost": 0, "cabin": 0, "seats": 0.25, "effort": 0, "redeye": 0, "arrival": -0.5, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2402", "rank": 6, "altId": "duffel:off_0000B9dD5XYnZLHasxHs9T", "utility": -2.0852, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.5, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9762", "rank": 7, "altId": "duffel:off_0000B9dD5XVFmWRmhxd2co", "utility": -2.5905, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.34722222222222227, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2846", "rank": 8, "altId": "duffel:off_0000B9dD5XVxjt0wk9xbjS", "utility": -2.8352, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.75, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2604", "rank": 9, "altId": "duffel:off_0000B9dD5XVblCjMj3nKBJ", "utility": -3.4186, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.9444444444444445, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9437", "rank": 10, "altId": "duffel:off_0000B9dD5Xd3JWgZ69HGmm", "utility": -3.5905, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.6805555555555555, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2852", "rank": 11, "altId": "duffel:off_0000B9dD5XZ9Y1ZAu3S9hi", "utility": -4.0852, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -1.1666666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9426", "rank": 12, "altId": "duffel:off_0000B9dD5XVFmWRmhxd2cu", "utility": -5.6739, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -1.375, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9804", "rank": 13, "altId": "duffel:off_0000B9dD5XbdOnYF1kc8Zp", "utility": -5.8822, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -1.4444444444444444, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9439", "rank": 14, "altId": "duffel:off_0000B9dD5XchKqOz536zEY", "utility": -6.0905, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -1.513888888888889, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2854", "rank": 15, "altId": "duffel:off_0000B9dD5XVxjt0wk9xbjl", "utility": -7.1269, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.180555555555556, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2610", "rank": 16, "altId": "duffel:off_0000B9dD5XVxjt0wk9xbjE", "utility": -8.3352, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.5833333333333335, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9806", "rank": 17, "altId": "duffel:off_0000B9dD5XbdOnYF1kc8Zd", "utility": -8.4239, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.2916666666666665, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "ZZ 4449", "rank": 18, "altId": "duffel:off_0000B9dD5PM64gMxRFHcF0", "utility": -8.5072, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.319444444444444, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BA 0107", "rank": 19, "altId": "duffel:off_0000B9dD5PMS3MeXSLRtnG", "utility": -8.5072, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.319444444444444, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9482", "rank": 20, "altId": "duffel:off_0000B9dD5XVFmWRmhxd2ci", "utility": -8.8405, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.430555555555556, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2850", "rank": 21, "altId": "duffel:off_0000B9dD5XZrVO8KwFmioK", "utility": -9.1269, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.847222222222222, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9441", "rank": 22, "altId": "duffel:off_0000B9dD5XdPICy97FRYKp", "utility": -9.5072, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.6527777777777777, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2642", "rank": 23, "altId": "duffel:off_0000B9dD5XZrVO8KwFmioD", "utility": -9.5852, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -3, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9478", "rank": 24, "altId": "duffel:off_0000B9dD5XVblCjMj3nKB5", "utility": -10.4239, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -2.9583333333333335, "loyalty": 0, "stability": -0.45283999999999996, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2811", "rank": 25, "altId": "duffel:off_0000B9dD5XWJiZIWlG7tHd", "utility": -10.6686, "features": {"cost": -2, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -3.361111111111111, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}], "decisionId": "f-depth:p-fatima:1787403742825", "weightsVersion": 2}
3	shown	u4:p-priya:1787403794863	u4	p-priya	2026-08-22 18:33:14.864781+05:30	{"weights": {"cost": 0.6, "cabin": 0.48, "seats": 0.3, "effort": 0.6, "redeye": 0.6, "arrival": 3, "loyalty": 1.04, "stability": 1.2, "weatherRisk": 1, "advisoryRisk": 2.5}, "flightId": "u4", "loggedAt": 1787403794863, "memberId": "p-priya", "strategy": "earliest_arrival", "candidates": [{"code": "ZZ 4449", "rank": 0, "altId": "duffel:off_0000B9dDAG3zsURg3AVmnr", "utility": -0.9298, "features": {"cost": -0.9704, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BA 0107", "rank": 1, "altId": "duffel:off_0000B9dDAG4LrAjG4Gg4Lj", "utility": -0.9298, "features": {"cost": -0.9704, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "6E 6361", "rank": 2, "altId": "oag:BOMGOI:2026-09-01:6E 6361", "utility": -2.0076, "features": {"cost": 0, "cabin": 0, "seats": 0.25, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 1, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2812", "rank": 3, "altId": "duffel:off_0000B9dDAPGNfohOaBNIrC", "utility": -2.0269, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.5055555555555555, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 603", "rank": 4, "altId": "oag:BOMGOI:2026-09-01:AI 603", "utility": -2.2561, "features": {"cost": 0, "cabin": 0, "seats": 0.125, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 0603", "rank": 5, "altId": "duffel:off_0000B9dDAPMlI5nqtyMOnM", "utility": -2.764, "features": {"cost": -1.284, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AF 6052", "rank": 6, "altId": "oag:BOMGOI:2026-09-01:AF 6052", "utility": -2.8976, "features": {"cost": 0, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "KL 3680", "rank": 7, "altId": "oag:BOMGOI:2026-09-01:KL 3680", "utility": -2.9351, "features": {"cost": 0, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "MH 5272", "rank": 8, "altId": "oag:BOMGOI:2026-09-01:MH 5272", "utility": -2.9726, "features": {"cost": 0, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "VS 8546", "rank": 9, "altId": "oag:BOMGOI:2026-09-01:VS 8546", "utility": -3.0101, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LX 9874", "rank": 10, "altId": "oag:BOMGOI:2026-09-01:LX 9874", "utility": -3.0309, "features": {"cost": 0, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "UL 3640", "rank": 11, "altId": "oag:BOMGOI:2026-09-01:UL 3640", "utility": -3.1434, "features": {"cost": 0, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LH 5312", "rank": 12, "altId": "oag:BOMGOI:2026-09-01:LH 5312", "utility": -3.1809, "features": {"cost": 0, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "MK 8040", "rank": 13, "altId": "oag:BOMGOI:2026-09-01:MK 8040", "utility": -3.2184, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2603", "rank": 14, "altId": "duffel:off_0000B9dDAPH5dBGYcNhrxV", "utility": -4.2352, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.2416666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2424", "rank": 15, "altId": "duffel:off_0000B9dDAPG1h8PoZ5D1Ig", "utility": -4.5686, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.3527777777777779, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2930", "rank": 16, "altId": "duffel:off_0000B9dDAPG1h8PoZ5D1IT", "utility": -4.8186, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.4361111111111111, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2851", "rank": 17, "altId": "duffel:off_0000B9dDAPFfiS8EXz2jkF", "utility": -4.9852, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.4916666666666665, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2863", "rank": 18, "altId": "duffel:off_0000B9dDAPKHRJommHCPvt", "utility": -5.9852, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.825, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2477", "rank": 19, "altId": "duffel:off_0000B9dDAPKdQ06MnNMhTo", "utility": -6.5194, "features": {"cost": -1.0152, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.1999999999999997, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9531", "rank": 20, "altId": "duffel:off_0000B9dDAPHnaXpiea2R46", "utility": -7.1427, "features": {"cost": -0.8808, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.088888888888889, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2677", "rank": 21, "altId": "duffel:off_0000B9dDAPGjeUyybHXaPH", "utility": -7.5686, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.352777777777778, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9669", "rank": 22, "altId": "duffel:off_0000B9dDAPMPJPWGssC7F8", "utility": -7.7726, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.0749999999999997, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2745", "rank": 23, "altId": "duffel:off_0000B9dDAPJDVGy2iyhZGi", "utility": -7.8231, "features": {"cost": -1.1048, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.6166666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2853", "rank": 24, "altId": "duffel:off_0000B9dDAPGNfohOaBNIr4", "utility": -8.7352, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.7416666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9533", "rank": 25, "altId": "duffel:off_0000B9dDAPI9ZE7IfgCic0", "utility": -9.6844, "features": {"cost": -0.8808, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.9361111111111113, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2493", "rank": 26, "altId": "duffel:off_0000B9dDAPIVXuOsgmN0AQ", "utility": -9.7769, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.088888888888889, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2919", "rank": 27, "altId": "duffel:off_0000B9dDAPI9ZE7IfgCicK", "utility": -11.4019, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.630555555555556, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}], "decisionId": "u4:p-priya:1787403794863", "weightsVersion": 2}
4	shown	u3:p-priya:1787404147552	u3	p-priya	2026-08-22 18:39:07.55398+05:30	{"weights": {"cost": 0.6, "cabin": 0.48, "seats": 0.3, "effort": 0.6, "redeye": 0.6, "arrival": 3, "loyalty": 1.04, "stability": 1.2, "weatherRisk": 1, "advisoryRisk": 2.5}, "flightId": "u3", "loggedAt": 1787404147552, "memberId": "p-priya", "strategy": "earliest_arrival", "candidates": [{"code": "AI 2422", "rank": 0, "altId": "duffel:off_0000B9dDgrMOsaXJjKaSKb", "utility": -0.1764, "features": {"cost": -1.443652561247216, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LO 4442", "rank": 1, "altId": "oag:BOMDEL:2026-09-11:LO 4442", "utility": -0.4804, "features": {"cost": -0.1358574610244989, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LX 9890", "rank": 2, "altId": "oag:BOMDEL:2026-09-11:LX 9890", "utility": -0.5514, "features": {"cost": -0.1291759465478842, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2452", "rank": 3, "altId": "duffel:off_0000B9dDgrBPXRkJBFRgBz", "utility": -0.8441, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.34722222222222227, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BZ 102", "rank": 4, "altId": "oag:BOMDEL:2026-09-11:BZ 102", "utility": -1.4586, "features": {"cost": -0.1759465478841871, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.3055555555555555, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LH 5276", "rank": 5, "altId": "oag:BOMDEL:2026-09-11:LH 5276", "utility": -1.553, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.34722222222222227, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AF 3342", "rank": 6, "altId": "oag:BOMDEL:2026-09-11:AF 3342", "utility": -1.583, "features": {"cost": -0.3207126948775056, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.3055555555555555, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BZ 154", "rank": 7, "altId": "oag:BOMDEL:2026-09-11:BZ 154", "utility": -1.5872, "features": {"cost": -0.022271714922048998, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.4166666666666667, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "SG 803", "rank": 8, "altId": "oag:BOMDEL:2026-09-11:SG 803", "utility": -1.7136, "features": {"cost": -0.062360801781737196, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.1388888888888889, "loyalty": 0, "stability": -1.1179999999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 0603", "rank": 9, "altId": "duffel:off_0000B9dDgqoitnb82spYpM", "utility": -2.0936, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.5277777777777778, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "KL 3649", "rank": 10, "altId": "oag:BOMDEL:2026-09-11:KL 3649", "utility": -2.3956, "features": {"cost": -0.19599109131403117, "cabin": 0, "seats": 0.875, "effort": 0, "redeye": 0, "arrival": -0.638888888888889, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2928", "rank": 11, "altId": "duffel:off_0000B9dDgr9zcibz6qmXz2", "utility": -2.4691, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8888888888888888, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2581", "rank": 12, "altId": "duffel:off_0000B9dDgrJZ38GfaXGBuU", "utility": -2.5102, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.6666666666666666, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2728", "rank": 13, "altId": "duffel:off_0000B9dDgrGjDg01RjvvUU", "utility": -2.7602, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.75, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2424", "rank": 14, "altId": "duffel:off_0000B9dDgr9zcibz6qmXza", "utility": -2.7607, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.9861111111111112, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2785", "rank": 15, "altId": "duffel:off_0000B9dDgqoMv7JY1mfHHa", "utility": -2.8436, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.7777777777777778, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 0471", "rank": 16, "altId": "duffel:off_0000B9dDgrH5CMHbSq6D2b", "utility": -3.0102, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8333333333333334, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2930", "rank": 17, "altId": "duffel:off_0000B9dDgrALbOtZ7wwpXH", "utility": -3.0107, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.0694444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9487", "rank": 18, "altId": "duffel:off_0000B9dDgqwsPU7USAe4XK", "utility": -3.238, "features": {"cost": -0.6207126948775056, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8472222222222222, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2428", "rank": 19, "altId": "duffel:off_0000B9dDgrBPXRkJBFRgCQ", "utility": -3.3024, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.1666666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9753", "rank": 20, "altId": "duffel:off_0000B9dDgqv6W4haMfoemB", "utility": -3.4956, "features": {"cost": -1.119599109131403, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8333333333333334, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2970", "rank": 21, "altId": "duffel:off_0000B9dDgrBlW81tCLbxkY", "utility": -3.5524, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.25, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2851", "rank": 22, "altId": "duffel:off_0000B9dDgqruhw9MCmK6ny", "utility": -3.8852, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.125, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AA 118", "rank": 23, "altId": "duffel:off_0000B9dDger7N4NowprItU", "utility": -3.9829, "features": {"cost": -0.6955456570155902, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.0805555555555555, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "BA 0107", "rank": 24, "altId": "duffel:off_0000B9dDgeqPPhoeudWjn2", "utility": -4.0128, "features": {"cost": -0.74543429844098, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.0805555555555555, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "ZZ 4449", "rank": 25, "altId": "duffel:off_0000B9dDgephSLFUsRCAgU", "utility": -4.0278, "features": {"cost": -0.7703786191536748, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.0805555555555555, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2432", "rank": 26, "altId": "duffel:off_0000B9dDgrC7UoJTDRmFIb", "utility": -4.0524, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.4166666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9716", "rank": 27, "altId": "duffel:off_0000B9dDgr0QCIxIdAIu4n", "utility": -4.2135, "features": {"cost": -1.3438752783964365, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.027777777777778, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2430", "rank": 28, "altId": "duffel:off_0000B9dDgrC7UoJTDRmFIy", "utility": -4.3024, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.5, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2952", "rank": 29, "altId": "duffel:off_0000B9dDgrCTTUb3EXwWql", "utility": -5.0107, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.736111111111111, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2444", "rank": 30, "altId": "duffel:off_0000B9dDgqsydz06G4oxSl", "utility": -5.0519, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.513888888888889, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2997", "rank": 31, "altId": "duffel:off_0000B9dDgrFJIwrhNLGnH2", "utility": -5.1352, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.5416666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2687", "rank": 32, "altId": "duffel:off_0000B9dDgrDBQrADGkH5xg", "utility": -5.1357, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.7777777777777777, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2419", "rank": 33, "altId": "duffel:off_0000B9dDgrCTTUb3EXwWrE", "utility": -5.3024, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.8333333333333333, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2503", "rank": 34, "altId": "duffel:off_0000B9dDgrEFMu0xK2lwca", "utility": -5.7545, "features": {"cost": -1.6432071269487751, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.8194444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2677", "rank": 35, "altId": "duffel:off_0000B9dDgrALbOtZ7wwpXu", "utility": -5.7607, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.986111111111111, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9531", "rank": 36, "altId": "duffel:off_0000B9dDgr9de2KP5kcGQg", "utility": -6.1921, "features": {"cost": -1.1692650334075725, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.7222222222222223, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2960", "rank": 37, "altId": "duffel:off_0000B9dDgrCpSAsdFe6oPD", "utility": -6.3441, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.180555555555556, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2944", "rank": 38, "altId": "duffel:off_0000B9dDgrCpSAsdFe6oPU", "utility": -6.5941, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.263888888888889, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9980", "rank": 39, "altId": "duffel:off_0000B9dDgr9de2KP5kcGRB", "utility": -6.7863, "features": {"cost": -1.7429844097995546, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.8055555555555556, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2442", "rank": 40, "altId": "duffel:off_0000B9dDgr3xz7n6o9xjaz", "utility": -6.8323, "features": {"cost": -0.8701559020044544, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.3333333333333335, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2915", "rank": 41, "altId": "duffel:off_0000B9dDgrGNEziRQdldwc", "utility": -7.0312, "features": {"cost": -1.6182628062360802, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.25, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 1851", "rank": 42, "altId": "duffel:off_0000B9dDgr4Jxo4gpG8197", "utility": -7.0823, "features": {"cost": -0.8701559020044544, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.4166666666666665, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2531", "rank": 43, "altId": "duffel:off_0000B9dDgrExKGa7MF6Vj8", "utility": -7.1352, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.2083333333333335, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2659", "rank": 44, "altId": "duffel:off_0000B9dDgqrCkZaCAZzXiQ", "utility": -7.4686, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.319444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2730", "rank": 45, "altId": "duffel:off_0000B9dDgrIr5lhVYKvco3", "utility": -7.5102, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.3333333333333335, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2783", "rank": 46, "altId": "duffel:off_0000B9dDgqrYjFrmBg9pFx", "utility": -8.4269, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.638888888888889, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9485", "rank": 47, "altId": "duffel:off_0000B9dDgqwsPU7USAe4Xt", "utility": -8.5713, "features": {"cost": -0.6207126948775056, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.625, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2440", "rank": 48, "altId": "duffel:off_0000B9dDgrIV75PvXElLFH", "utility": -8.6615, "features": {"cost": -1.418708240534521, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.8333333333333335, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2426", "rank": 49, "altId": "duffel:off_0000B9dDgrN6px6TlWv1QQ", "utility": -8.8772, "features": {"cost": -0.944988864142539, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2408", "rank": 50, "altId": "duffel:off_0000B9dDgqsGgcQwDsUOMD", "utility": -9.295, "features": {"cost": -1.2939866369710469, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.0694444444444446, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2940", "rank": 51, "altId": "duffel:off_0000B9dDgqruhw9MCmK6oZ", "utility": -9.3922, "features": {"cost": -0.9699331848552338, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.1666666666666665, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2988", "rank": 52, "altId": "duffel:off_0000B9dDgrLKwXgZg25bfL", "utility": -9.6871, "features": {"cost": -1.0447661469933185, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.25, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 0816", "rank": 53, "altId": "duffel:off_0000B9dDgrB3YlSjA9HOdi", "utility": -9.7607, "features": {"cost": -0.8202672605790646, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.3194444444444446, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 1895", "rank": 54, "altId": "duffel:off_0000B9dDgqqUnD128Neyb3", "utility": -10.295, "features": {"cost": -1.2939866369710469, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.402777777777778, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2986", "rank": 55, "altId": "duffel:off_0000B9dDgr3c0RVWn3nS2y", "utility": -10.9798, "features": {"cost": -1.3937639198218263, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.611111111111111, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 1882", "rank": 56, "altId": "duffel:off_0000B9dDgqo0wR1y0gUzjv", "utility": -11.5001, "features": {"cost": -1.219153674832962, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.8194444444444446, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9718", "rank": 57, "altId": "duffel:off_0000B9dDgr0mAzEseGTBdI", "utility": -11.6302, "features": {"cost": -1.3438752783964365, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.5, "loyalty": 0, "stability": -0.4945, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}], "decisionId": "u3:p-priya:1787404147552", "weightsVersion": 2}
5	shown	u4:anon:1787404256415	u4	anon	2026-08-22 18:40:56.417912+05:30	{"weights": {"cost": 0.6, "cabin": 0.48, "seats": 0.3, "effort": 0.6, "redeye": 0.6, "arrival": 3, "loyalty": 1.04, "stability": 1.2, "weatherRisk": 1, "advisoryRisk": 2.5}, "flightId": "u4", "loggedAt": 1787404256415, "memberId": "anon", "strategy": "earliest_arrival", "candidates": [{"code": "BA 0107", "rank": 0, "altId": "duffel:off_0000B9dDmKU52NhWkwUSCw", "utility": -0.9567, "features": {"cost": -1.0152, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "ZZ 4449", "rank": 1, "altId": "duffel:off_0000B9dDmKT16KqmhdzbYA", "utility": -0.9567, "features": {"cost": -1.0152, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": 0, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "6E 6361", "rank": 2, "altId": "oag:BOMGOI:2026-09-01:6E 6361", "utility": -2.0076, "features": {"cost": 0, "cabin": 0, "seats": 0.25, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 1, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2812", "rank": 3, "altId": "duffel:off_0000B9dDmScWmrDBzSVJUI", "utility": -2.0269, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.5055555555555555, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 603", "rank": 4, "altId": "oag:BOMGOI:2026-09-01:AI 603", "utility": -2.2561, "features": {"cost": 0, "cabin": 0, "seats": 0.125, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 0603", "rank": 5, "altId": "duffel:off_0000B9dDmSg4Zg30ASA90l", "utility": -2.764, "features": {"cost": -1.284, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AF 6052", "rank": 6, "altId": "oag:BOMGOI:2026-09-01:AF 6052", "utility": -2.8976, "features": {"cost": 0, "cabin": 0, "seats": 0.75, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "KL 3680", "rank": 7, "altId": "oag:BOMGOI:2026-09-01:KL 3680", "utility": -2.9351, "features": {"cost": 0, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "MH 5272", "rank": 8, "altId": "oag:BOMGOI:2026-09-01:MH 5272", "utility": -2.9726, "features": {"cost": 0, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "VS 8546", "rank": 9, "altId": "oag:BOMGOI:2026-09-01:VS 8546", "utility": -3.0101, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.8250000000000001, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LX 9874", "rank": 10, "altId": "oag:BOMGOI:2026-09-01:LX 9874", "utility": -3.0309, "features": {"cost": 0, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "UL 3640", "rank": 11, "altId": "oag:BOMGOI:2026-09-01:UL 3640", "utility": -3.1434, "features": {"cost": 0, "cabin": 0, "seats": 0.625, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "LH 5312", "rank": 12, "altId": "oag:BOMGOI:2026-09-01:LH 5312", "utility": -3.1809, "features": {"cost": 0, "cabin": 0, "seats": 0.5, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "MK 8040", "rank": 13, "altId": "oag:BOMGOI:2026-09-01:MK 8040", "utility": -3.2184, "features": {"cost": 0, "cabin": 0, "seats": 0.375, "effort": 0, "redeye": 0, "arrival": -0.8944444444444444, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2603", "rank": 14, "altId": "duffel:off_0000B9dDmScslXUm0Yfb2a", "utility": -4.2352, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.2416666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2424", "rank": 15, "altId": "duffel:off_0000B9dDmSbopUe1xGAkNq", "utility": -4.5686, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.3527777777777779, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2930", "rank": 16, "altId": "duffel:off_0000B9dDmSbopUe1xGAkNj", "utility": -4.8186, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.4361111111111111, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2851", "rank": 17, "altId": "duffel:off_0000B9dDmSbopUe1xGAkNc", "utility": -4.9852, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.4916666666666665, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2863", "rank": 18, "altId": "duffel:off_0000B9dDmSeeewug63V0o4", "utility": -5.9852, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -1.825, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2477", "rank": 19, "altId": "duffel:off_0000B9dDmSeeewug63V0oA", "utility": -6.5194, "features": {"cost": -1.0152, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.1999999999999997, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9531", "rank": 20, "altId": "duffel:off_0000B9dDmSdEkDmM1epsb2", "utility": -7.1427, "features": {"cost": -0.8808, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.088888888888889, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2677", "rank": 21, "altId": "duffel:off_0000B9dDmScWmrDBzSVJUW", "utility": -7.5686, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.352777777777778, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9669", "rank": 22, "altId": "duffel:off_0000B9dDmSfiazlQ9LzrSi", "utility": -7.7726, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.0749999999999997, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2745", "rank": 23, "altId": "duffel:off_0000B9dDmSeIgGd64xKjFh", "utility": -7.8231, "features": {"cost": -1.1048, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.6166666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2853", "rank": 24, "altId": "duffel:off_0000B9dDmScWmrDBzSVJUB", "utility": -8.7352, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.7416666666666667, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "IX 9533", "rank": 25, "altId": "duffel:off_0000B9dDmSdaiu3w2l0A8v", "utility": -9.6844, "features": {"cost": -0.8808, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -2.9361111111111113, "loyalty": 0, "stability": -0.5142599999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2493", "rank": 26, "altId": "duffel:off_0000B9dDmSdwhaLW3rARhF", "utility": -9.7769, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.088888888888889, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}, {"code": "AI 2919", "rank": 27, "altId": "duffel:off_0000B9dDmSdaiu3w2l0A99", "utility": -11.4019, "features": {"cost": -2, "cabin": 0, "seats": 1, "effort": 0, "redeye": 0, "arrival": -3.630555555555556, "loyalty": 1, "stability": -0.5164799999999999, "weatherRisk": 0, "advisoryRisk": 0}, "propensity": 1, "bookability": 0.97}], "decisionId": "u4:anon:1787404256415", "weightsVersion": 2}
\.


--
-- Data for Name: recovery_tasks; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.recovery_tasks (key, flight_id, passenger_id, data) FROM stdin;
\.


--
-- Data for Name: rides; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.rides (id, passenger_id, flight_id, data) FROM stdin;
\.


--
-- Data for Name: seed_state; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.seed_state (id) FROM stdin;
seeded
\.


--
-- Data for Name: stays; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.stays (id, passenger_id, flight_id, data) FROM stdin;
\.


--
-- Data for Name: travellers; Type: TABLE DATA; Schema: public; Owner: zkdapp
--

COPY public.travellers (id, data) FROM stdin;
tr24	{"id": "tr24", "dob": "14 Mar 1988", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian", "passengerId": "p-priya"}
tr25	{"id": "tr25", "dob": "14 Mar 1988", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian", "passengerId": "p-priya"}
tr26	{"id": "tr26", "dob": "14 Mar 1988", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian", "passengerId": "p-priya"}
tr27	{"id": "tr27", "dob": "14 Mar 1988", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian", "passengerId": "p-priya"}
tr28	{"id": "tr28", "dob": "14 Mar 1988", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian", "passengerId": "p-priya"}
tr29	{"id": "tr29", "dob": "14 Mar 1988", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [{"tier": "Gold", "number": "AI••••8802", "airline": "Air India · Maharaja Club"}, {"tier": "—", "number": "6E••••1173", "airline": "IndiGo · 6E Rewards"}], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "PRIYA RAMESH SUNDARAM", "displayName": "Priya S.", "nationality": "Indian", "passengerId": "p-priya"}
tr30	{"id": "tr30", "dob": "02 Jul 1991", "type": "adult", "gender": "Male", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "ARJUN MEHTA", "displayName": "Arjun M.", "nationality": "Indian", "passengerId": "p-arjun"}
tr31	{"id": "tr31", "dob": "11 Sep 1992", "type": "adult", "gender": "Female", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "MEERA MEHTA", "displayName": "Meera M.", "nationality": "Indian", "passengerId": null}
tr32	{"id": "tr32", "dob": "04 Apr 2016", "type": "child", "gender": "Male", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "AARAV MEHTA", "displayName": "Aarav M.", "nationality": "Indian", "passengerId": null}
tr33	{"id": "tr33", "dob": "19 Jan 2019", "type": "child", "gender": "Female", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "DIYA MEHTA", "displayName": "Diya M.", "nationality": "Indian", "passengerId": null}
tr34	{"id": "tr34", "dob": "02 Feb 1958", "type": "adult", "gender": "Male", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "SURESH MEHTA", "displayName": "Suresh M.", "nationality": "Indian", "passengerId": null}
tr35	{"id": "tr35", "dob": "17 May 1960", "type": "adult", "gender": "Female", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "LAKSHMI MEHTA", "displayName": "Lakshmi M.", "nationality": "Indian", "passengerId": null}
tr36	{"id": "tr36", "dob": "30 Jan 1985", "type": "adult", "gender": "Male", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "ROHAN VERMA", "displayName": "Rohan V.", "nationality": "Indian", "passengerId": "p-rohan"}
tr37	{"id": "tr37", "dob": "23 Aug 1987", "type": "adult", "gender": "Male", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "KABIR NAIR", "displayName": "Kabir N.", "nationality": "Indian", "passengerId": null}
tr38	{"id": "tr38", "dob": "19 Nov 1994", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "FATIMA SHEIKH", "displayName": "Fatima S.", "nationality": "Indian", "passengerId": "p-fatima"}
tr39	{"id": "tr39", "dob": "05 Jun 1993", "type": "adult", "gender": "Female", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "ZOYA SHEIKH", "displayName": "Zoya S.", "nationality": "Indian", "passengerId": null}
tr40	{"id": "tr40", "dob": "14 Oct 1990", "type": "adult", "gender": "Male", "contact": {"email": "—", "phone": "—"}, "loyalty": [], "passport": {"expiry": "—", "issued": "India", "number": "Z••••••••"}, "legalName": "IMRAN SHEIKH", "displayName": "Imran S.", "nationality": "Indian", "passengerId": null}
tr41	{"id": "tr41", "dob": "08 Sep 1997", "type": "adult", "gender": "Female", "contact": {"email": "member@•••••.com", "phone": "+91 ••••• 0000"}, "loyalty": [], "passport": {"expiry": "Sep 2031", "issued": "India", "number": "Z••••••21"}, "legalName": "ANANYA IYER", "displayName": "Ananya I.", "nationality": "Indian", "passengerId": "p-ananya"}
\.


--
-- Name: booking_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.booking_seq', 25, true);


--
-- Name: decision_ledger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.decision_ledger_id_seq', 12, true);


--
-- Name: itinerary_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.itinerary_seq', 2, true);


--
-- Name: ranker_decision_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.ranker_decision_log_id_seq', 5, true);


--
-- Name: ride_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.ride_seq', 1, false);


--
-- Name: stay_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.stay_seq', 2, true);


--
-- Name: task_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.task_seq', 8, true);


--
-- Name: traveller_seq; Type: SEQUENCE SET; Schema: public; Owner: zkdapp
--

SELECT pg_catalog.setval('public.traveller_seq', 41, true);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (email);


--
-- Name: decision_ledger decision_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.decision_ledger
    ADD CONSTRAINT decision_ledger_pkey PRIMARY KEY (id);


--
-- Name: disruption_events disruption_events_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.disruption_events
    ADD CONSTRAINT disruption_events_pkey PRIMARY KEY (flight_id);


--
-- Name: flights flights_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.flights
    ADD CONSTRAINT flights_pkey PRIMARY KEY (id);


--
-- Name: itineraries itineraries_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.itineraries
    ADD CONSTRAINT itineraries_pkey PRIMARY KEY (id);


--
-- Name: journey_prefs journey_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.journey_prefs
    ADD CONSTRAINT journey_prefs_pkey PRIMARY KEY (key);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (name);


--
-- Name: passengers passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.passengers
    ADD CONSTRAINT passengers_pkey PRIMARY KEY (id);


--
-- Name: past_flights past_flights_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.past_flights
    ADD CONSTRAINT past_flights_pkey PRIMARY KEY (passenger_id);


--
-- Name: pipeline_runs pipeline_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (key);


--
-- Name: pre_auths pre_auths_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.pre_auths
    ADD CONSTRAINT pre_auths_pkey PRIMARY KEY (key);


--
-- Name: ranker_decision_log ranker_decision_log_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.ranker_decision_log
    ADD CONSTRAINT ranker_decision_log_pkey PRIMARY KEY (id);


--
-- Name: recovery_tasks recovery_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.recovery_tasks
    ADD CONSTRAINT recovery_tasks_pkey PRIMARY KEY (key);


--
-- Name: rides rides_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.rides
    ADD CONSTRAINT rides_pkey PRIMARY KEY (id);


--
-- Name: seed_state seed_state_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.seed_state
    ADD CONSTRAINT seed_state_pkey PRIMARY KEY (id);


--
-- Name: stays stays_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.stays
    ADD CONSTRAINT stays_pkey PRIMARY KEY (id);


--
-- Name: travellers travellers_pkey; Type: CONSTRAINT; Schema: public; Owner: zkdapp
--

ALTER TABLE ONLY public.travellers
    ADD CONSTRAINT travellers_pkey PRIMARY KEY (id);


--
-- Name: bookings_flight_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX bookings_flight_id_idx ON public.bookings USING btree (flight_id);


--
-- Name: bookings_passenger_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX bookings_passenger_id_idx ON public.bookings USING btree (passenger_id);


--
-- Name: credentials_passenger_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX credentials_passenger_id_idx ON public.credentials USING btree (passenger_id);


--
-- Name: decision_ledger_kind_flight_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX decision_ledger_kind_flight_idx ON public.decision_ledger USING btree (kind, flight_id);


--
-- Name: decision_ledger_logged_at_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX decision_ledger_logged_at_idx ON public.decision_ledger USING btree (logged_at);


--
-- Name: flights_dep_iso_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX flights_dep_iso_idx ON public.flights USING btree (dep_iso);


--
-- Name: journey_prefs_flight_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX journey_prefs_flight_id_idx ON public.journey_prefs USING btree (flight_id);


--
-- Name: pipeline_runs_flight_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX pipeline_runs_flight_id_idx ON public.pipeline_runs USING btree (flight_id);


--
-- Name: pre_auths_flight_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX pre_auths_flight_id_idx ON public.pre_auths USING btree (flight_id);


--
-- Name: ranker_decision_log_decision_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX ranker_decision_log_decision_idx ON public.ranker_decision_log USING btree (decision_id);


--
-- Name: ranker_decision_log_flight_member_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX ranker_decision_log_flight_member_idx ON public.ranker_decision_log USING btree (flight_id, member_id);


--
-- Name: ranker_decision_log_kind_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX ranker_decision_log_kind_idx ON public.ranker_decision_log USING btree (kind);


--
-- Name: recovery_tasks_flight_id_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX recovery_tasks_flight_id_idx ON public.recovery_tasks USING btree (flight_id);


--
-- Name: rides_passenger_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX rides_passenger_idx ON public.rides USING btree (passenger_id);


--
-- Name: stays_passenger_idx; Type: INDEX; Schema: public; Owner: zkdapp
--

CREATE INDEX stays_passenger_idx ON public.stays USING btree (passenger_id);


--
-- PostgreSQL database dump complete
--

\unrestrict FZ8LdxgTXjntyhkVplBMdCSuKp4XpmJHMckhFYsVKjj8JfVsRfkcpmqFU7rfUE1

