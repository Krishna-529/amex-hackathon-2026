import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, mono } from '../theme';
import { PROFILE } from '../lib/data';
import { useWorld } from '../world';
import { Eyebrow, Glass, KV, Page, PageHead, Sect, Why } from '../ui';

export default function ProfileScreen() {
  const { world, consent, setConsent, settled, chosen } = useWorld();

  if (!world) {
    return (
      <Page>
        <PageHead title="Your details" />
      </Page>
    );
  }

  const pick = world.alts.find((a) => a.id === chosen)!;
  const rebooked = settled === 'booked';

  return (
    <Page>
      <PageHead title="Your details">
        Everything we hold about you, and why we need it. An airline will not issue a ticket in your
        name without these, so this is the whole list — nothing is kept that a booking does not
        require.
      </PageHead>

      <Glass style={s.card}>
        <Eyebrow>Who the ticket is issued to</Eyebrow>
        <KV first k="Name, exactly as on your passport" v={PROFILE.legalName} />
        <KV k="Date of birth" v={PROFILE.dob} />
        <KV k="Gender" v={PROFILE.gender} />
        <KV k="Nationality" v={PROFILE.nationality} />
        <Why>
          Airlines match these three against your travel document at check-in. A mismatch is the most
          common reason an automatic rebooking is rejected, so we store them exactly as printed.
        </Why>
      </Glass>

      <Glass style={s.card}>
        <Eyebrow>Travel document</Eyebrow>
        <KV first k="Passport" v={PROFILE.passport.number} />
        <KV k="Expires" v={PROFILE.passport.expiry} />
        <KV k="Issued by" v={PROFILE.passport.issued} />
        <Why>
          Needed for the international leg only. We show you the last two digits so you can confirm it
          is the right document without us displaying the number back to anyone.
        </Why>
      </Glass>

      <Glass style={s.card}>
        <Eyebrow>How the airline reaches you</Eyebrow>
        <KV first k="Email" v={PROFILE.contact.email} />
        <KV k="Mobile" v={PROFILE.contact.phone} />
        <Why>
          These go on the booking itself. It is how the carrier sends your boarding pass — and how we
          reach you inside the 90 seconds before we act.
        </Why>
      </Glass>

      <Glass style={s.card}>
        <Eyebrow>Frequent flyer</Eyebrow>
        {PROFILE.loyalty.map((l, i) => (
          <KV
            key={l.number}
            first={i === 0}
            k={l.airline}
            v={`${l.number}${l.tier !== '—' ? ` · ${l.tier}` : ''}`}
          />
        ))}
        <Why>Attached to every rebooking so a disruption never costs you status miles.</Why>
      </Glass>

      <Sect>Your bookings</Sect>
      <Glass style={s.card}>
        {world.upcoming.map((f, i) => {
          const wasCancelled = f.id === 'u1';
          return (
            <View key={f.id} style={[s.bk, i === 0 && s.bkFirst]}>
              <View style={s.bkH}>
                <Text style={s.fc}>{f.code}</Text>
                <Text style={s.rt}>
                  {f.from} → {f.to}
                </Text>
                <Text style={s.pnr}>{wasCancelled && rebooked ? 'RB4T9Z' : f.pnr}</Text>
              </View>
              <Text style={s.bkM}>
                {wasCancelled && rebooked
                  ? `Reissued as ${pick.code} · ${pick.dep} — new record locator, old one voided`
                  : `${f.date} · ${f.dep} · seat ${f.seat} · ${f.terminal}`}
              </Text>
            </View>
          );
        })}
        <View style={s.bk}>
          <View style={s.bkH}>
            <Text style={s.fc}>HOTEL</Text>
            <Text style={s.rt}>{world.hotels[0].name}</Text>
            <Text style={s.pnr}>HT-88214</Text>
          </View>
          <Text style={s.bkM}>
            {rebooked
              ? 'Check-in moved to 16:30 · same rate'
              : `Check-in ${world.hotels[0].checkin} · 1 night`}
          </Text>
        </View>
        {world.cabLegs.map((l, i) => (
          <View key={l.id} style={s.bk}>
            <View style={s.bkH}>
              <Text style={s.fc}>CAB</Text>
              <Text style={s.rt}>
                {l.from} → {l.to}
              </Text>
              <Text style={s.pnr}>{i === 0 ? 'CB-4471' : 'CB-4472'}</Text>
            </View>
            <Text style={s.bkM}>
              {world.cabs[0].kind} · pickup {l.pickup}
            </Text>
          </View>
        ))}
      </Glass>

      <Glass style={s.card}>
        <Eyebrow>How you like to fly</Eyebrow>
        {PROFILE.prefs.map((p, i) => (
          <KV key={p.k} first={i === 0} k={p.k} v={p.v} />
        ))}
        <Text style={s.permLbl}>When a flight breaks</Text>
        <View style={s.seg}>
          {(['autopilot', 'ask'] as const).map((c) => (
            <TouchableOpacity
              key={c}
              style={[s.segBtn, consent === c && s.segOn]}
              onPress={() => setConsent(c)}
              activeOpacity={0.8}
            >
              <Text style={[s.segTxt, consent === c && { color: '#fff' }]}>
                {c === 'autopilot' ? 'Autopilot' : 'Ask me first'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Why>
          {consent === 'autopilot'
            ? 'We rebook inside your policy without waking you. You still get 90 seconds to stop us before anything is paid for.'
            : 'We do all the work then stop and wait for your go-ahead. If you do not answer, we hold rather than book.'}
        </Why>
      </Glass>

      <Glass style={s.card}>
        <Eyebrow>Payment</Eyebrow>
        <KV first k="Card on file" v={PROFILE.payment.card} />
        <KV k="How we charge" v={PROFILE.payment.method} />
        <Why>
          Each booking gets its own single-use card number, locked to that amount and that date. It
          cannot be reused, so nothing here can be charged twice.
        </Why>
      </Glass>

      <Glass style={[s.card, { borderColor: 'rgba(75,171,124,.3)', marginBottom: 0 }]}>
        <Eyebrow color={C.safe}>What we never hold</Eyebrow>
        {PROFILE.never.map((n, i) => (
          <KV key={n} first={i === 0} k={n} v="✓" ok />
        ))}
      </Glass>
    </Page>
  );
}

const s = StyleSheet.create({
  card: { padding: 18, marginBottom: 14 },

  bk: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,.075)',
  },
  bkFirst: { borderTopWidth: 0, paddingTop: 0 },
  bkH: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fc: { fontFamily: mono, fontSize: 11, color: C.mist, minWidth: 52 },
  rt: { fontSize: 12.5, color: C.text, flex: 1 },
  pnr: {
    fontFamily: mono,
    fontSize: 11.5,
    color: C.iris,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(47,127,240,.1)',
    borderWidth: 1,
    borderColor: 'rgba(47,127,240,.28)',
    overflow: 'hidden',
  },
  bkM: { fontSize: 11, color: C.mist2, marginTop: 6, lineHeight: 16 },

  permLbl: {
    fontFamily: mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: C.mist2,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 9,
  },
  seg: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,.28)',
    borderWidth: 1,
    borderColor: C.edge,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: C.iris },
  segTxt: { color: C.mist, fontSize: 12.5, fontWeight: '600' },
});
