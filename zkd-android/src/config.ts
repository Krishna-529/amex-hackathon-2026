/**
 * The Android app has no build-time config injection for a LAN IP (it changes
 * per network, per laptop), so this is a plain constant to edit by hand — same
 * "IP can change after a router restart" caveat already called out in
 * zkd-launcher/README.txt for the web demo sites. Run `ipconfig` (Windows) or
 * `ifconfig`/`ip addr` (Mac/Linux) on the machine running `npm run dev` in
 * zkd-app, and update this to match if the phone stops syncing.
 */
export const API_BASE_URL = 'http://192.168.0.106:5176';
