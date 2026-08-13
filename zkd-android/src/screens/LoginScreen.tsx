import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { C, mono } from '../theme';
import { Cta, Glass, Page, PageHead } from '../ui';
import { useWorld } from '../world';

/**
 * Mirrors zkd-app/lib/demoAccounts.ts. Not imported directly — this is a
 * separate Expo package with its own bundler, so the same five seeded
 * accounts are duplicated here as plain data rather than reached for across
 * a package boundary that does not otherwise exist.
 */
const DEMO_ACCOUNTS = [
  { email: 'priya@zkd.demo', password: 'priya-2026', name: 'Priya S.' },
  { email: 'arjun@zkd.demo', password: 'arjun-2026', name: 'Arjun M.' },
  { email: 'fatima@zkd.demo', password: 'fatima-2026', name: 'Fatima S.' },
  { email: 'rohan@zkd.demo', password: 'rohan-2026', name: 'Rohan V.' },
  { email: 'ananya@zkd.demo', password: 'ananya-2026', name: 'Ananya I.' },
];

export default function LoginScreen() {
  const { signIn } = useWorld();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    // On success WorldProvider's status flips to 'authenticated' and App.tsx
    // swaps the whole screen stack — no navigation call needed here.
  };

  const fillDemo = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(acc.email);
    setPassword(acc.password);
  };

  return (
    <Page>
      <PageHead title="Sign in">
        This is your card member account — it is how we know which trips, preferences and payment
        method are yours.
      </PageHead>

      {error ? (
        <Glass style={{ padding: 14, marginBottom: 14, borderColor: C.warnSoft }}>
          <Text style={{ color: C.warn, fontSize: 13.5 }}>{error}</Text>
        </Glass>
      ) : null}

      <Glass style={{ padding: 18, marginBottom: 16, gap: 10 }}>
        <Text style={{ color: C.text, fontFamily: mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 }}>
          Card member sign in
        </Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={C.mist2}
          autoCapitalize="none"
          keyboardType="email-address"
          style={inputStyle}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={C.mist2}
          secureTextEntry
          style={[inputStyle, { marginTop: 10 }]}
        />
        <View style={{ marginTop: 14 }}>
          <Cta label={busy ? 'Signing in…' : 'Sign in'} onPress={submit} />
        </View>
      </Glass>

      <Glass style={{ padding: 18 }}>
        <Text style={{ color: C.text, fontFamily: mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 10 }}>
          Demo accounts
        </Text>
        {DEMO_ACCOUNTS.map((a) => (
          <TouchableOpacity key={a.email} onPress={() => fillDemo(a)} style={{ paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: C.mist, fontSize: 13.5 }}>{a.name}</Text>
              <Text style={{ color: C.iris, fontSize: 12.5, fontFamily: mono }}>{a.email}</Text>
            </View>
          </TouchableOpacity>
        ))}
        <Text style={{ color: C.mist2, fontSize: 12, lineHeight: 18, marginTop: 8 }}>
          Every seeded account uses its own password — tap a name to fill the form. This is a
          prototype fixture, not how a real card member would authenticate.
        </Text>
      </Glass>
    </Page>
  );
}

const inputStyle = {
  backgroundColor: C.glass,
  borderWidth: 1,
  borderColor: C.edge,
  borderRadius: 11,
  color: C.text,
  fontSize: 14,
  paddingVertical: 11,
  paddingHorizontal: 13,
};
