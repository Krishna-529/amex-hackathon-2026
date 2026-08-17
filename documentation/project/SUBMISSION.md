# ZKD Concierge — submission bundle

**Autonomous Travel-Disruption Concierge**
Codestreet 2026 / American Express · Team ZKD, IIT Madras

---

## What's in here

```
assets/media/   ZKD-full-tutorial.mp4     6m39s — everything, web + mobile
            ZKD-web-tutorial.mp4      3m30s — web only
            ZKD-mobile-tutorial.mp4   2m52s — Android only
assets/builds/  ZKD-Concierge.apk         installable, self-contained
docs/       the four written documents
./          full source, including git history — this repository
```

---

## Run the web app

```bash
cd zkd-app
npm install
npm run dev          # → http://localhost:5176
```

Routes: `/flights` · `/flights/[id]` · `/prepare/[id]` · `/recovery/[id]` ·
`/profile` · `/settings` · `/history` · `/how-it-works`

## Install the Android app

```bash
adb install assets/builds/ZKD-Concierge.apk
```

Release build with the JS bundled — it needs no dev server. Grant notifications
on first launch, or:

```bash
adb shell pm grant in.zettatech.zkdconcierge android.permission.POST_NOTIFICATIONS
```

The cancellation notification fires a few seconds after launch on a dedicated
MAX-importance channel, with three action buttons.

To build from source: `cd zkd-android && npm install && npx expo run:android`

## Reproduce the numbers

```bash
python3 iropssim.py | diff - iropssim-output.json    # must be empty
```

Fixed seed. Every `sim`-tier figure in the docs comes from this file.

---

## The three claims worth checking

**1. The prediction buys speed, not safety.**
A cancellation is a fact the airline files — you don't need to predict it to act
on it. The model exists to move 42 s of work *before* the event, so recovery takes
~11 s instead of 53 s. A false positive costs one API call; a false negative costs
42 seconds. Neither strands anyone. Safety rests on the consent gate and the
default-deny policy layer, neither of which consults a probability.

**2. The fast part is fast because it isn't AI.**
Of the ~11 s, **95% is waiting on airline, hotel and payment APIs**. Allocation,
three negotiation rounds and the policy check together are ~0.6 s, because
negotiation iterates a candidate set already in memory and makes zero new supplier
calls. There is **no GPU on the critical path**. Supplier rate limits are the
ceiling, not compute.

**3. Nothing irreversible happens before the member has had their say.**
Everything before ACT is free — nothing claimed, nothing spent. Above 80% we ask *in advance*,
while there are hours to think; if answered, a cancellation needs no window at all.
Otherwise the member gets a real window, sized to how long the fare is guaranteed. And consent gates *spending*, not
care: if the fix costs nothing, silence books it rather than leaving someone at an
airport overnight.

---

## Known limitations, stated plainly

- **No commercial forecast key yet.** The disruption forecast is bought from Lumo rather than
  built; without a key it runs on a labelled mock. It is advisory until back-tested against
  outcomes on our own routes. Accuracy is not claimed, and the vendor's claims are not repeated
  as ours.
- **No live supplier integration.** Duffel and LiteAPI sandboxes are the intended
  proving ground; the prototype calls nothing.
- **Payment is mocked.** Amex vPayment sits behind a contract test.
- **API failure is not modelled** — rate limits, timeouts, circuit breakers. Given
  supplier limits are the binding constraint, this is the most significant gap.
- **Diversions and turn-backs** are out of scope, though both strand a member.
- **The Android app is a subset of the web app**: four screens. It has no
  pre-authorisation flow and no consent settings screen, so the 80% early ask
  appears only in the web build and in the web section of the video.
- **DGCA duty-of-care thresholds carry evidence tier `deck`** — taken from the
  Round 1 submission; the primary CAR text has not been re-retrieved and must be
  reconciled before production.

Where a number is a design target rather than a measurement, the docs say so.
