// Bridges Windows -> WSL for the phone.
//
// zkd-app listens inside WSL2 (172.20.63.18:5176). Windows cannot reach that on
// its own loopback, and the phone cannot route to WSL's private subnet at all.
// The documented fix is `netsh interface portproxy`, which needs an ADMIN shell.
// This is the same thing in userland: a plain TCP relay, no elevation required,
// because binding a port above 1024 does not need it.
//
//   node tool/lan-relay.js 0.0.0.0:5176 172.20.63.18:5176
//
// Dies with the terminal. Not a substitute for the portproxy in a real setup —
// it is here so a tethered demo works without changing system config.
const net = require('net');
const [, , listen, target] = process.argv;
const [lh, lp] = listen.split(':');
const [th, tp] = target.split(':');

net
  .createServer((client) => {
    const up = net.connect(Number(tp), th);
    client.pipe(up);
    up.pipe(client);
    client.on('error', () => up.destroy());
    up.on('error', () => client.destroy());
  })
  .listen(Number(lp), lh, () => console.log(`relay ${listen} -> ${target}`))
  .on('error', (e) => {
    console.error('relay failed:', e.message);
    process.exit(1);
  });
