/**
 * The Android app has no build-time config injection for a LAN IP (it changes
 * per network, per laptop), so this is a plain constant to edit by hand — same
 * "IP can change after a router restart" caveat already called out in
 * zkd-launcher/README.txt for the web demo sites. Run `ipconfig` (Windows) or
 * `ifconfig`/`ip addr` (Mac/Linux) on the machine running `npm run dev` in
 * zkd-app, and update this to match if the phone stops syncing.
 */
/**
 * ── If the phone shows no data, it is almost always one of these three ─────
 *
 * 1. WRONG IP. Verified 2026-08-17: this machine's Wi-Fi address is
 *    192.168.0.144 (it was .106 when this file was written — DHCP moved it).
 *    Re-check with `ipconfig` on Windows and edit the line below.
 *
 * 2. THE SERVER IS INSIDE WSL, THE PHONE IS NOT. `npm run dev` binds inside
 *    WSL2, which sits behind its own NAT. Windows itself can reach it on
 *    localhost (WSL forwards that automatically) but nothing else on the Wi-Fi
 *    can — verified: 192.168.0.144:5176 refuses while localhost:5176 answers.
 *    A port proxy is required, from an ADMIN PowerShell on Windows:
 *
 *      netsh interface portproxy add v4tov4 listenport=5176
 *        listenaddress=0.0.0.0 connectport=5176 connectaddress=<WSL_IP>
 *      New-NetFirewallRule -DisplayName "ZKD 5176" -Direction Inbound
 *        -LocalPort 5176 -Protocol TCP -Action Allow
 *
 *    <WSL_IP> comes from `ip addr` inside WSL (172.20.63.18 as of this note)
 *    and CHANGES on every WSL restart, so the proxy needs re-pointing after a
 *    reboot. `netsh interface portproxy show all` lists what is currently set.
 *
 * 3. PHONE ON A DIFFERENT NETWORK. Mobile data, or a guest SSID that isolates
 *    clients, will both fail even with everything above correct.
 */
// USB route (current default). `adb reverse tcp:5176 tcp:5176` tunnels the
// PHONE's own localhost to this machine, which sidesteps all three problems
// above at once: no LAN IP to get wrong, no WSL NAT to cross, no admin-only
// port proxy, no firewall rule. It only holds while the USB cable is attached.
//
// For an UNTETHERED demo, swap to the LAN address and set up the port proxy
// described above:  export const API_BASE_URL = 'http://192.168.0.144:5176';
export const API_BASE_URL = 'http://localhost:5176';
