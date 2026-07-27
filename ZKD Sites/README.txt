TEAM ZKD - three sites
======================

  1  System design      port 5173   architecture, scalability, feasibility
  2  Success metrics    port 5174   250,000-case Monte Carlo + sources
  3  Personas           port 5175   four recovery scenarios

RUNNING THEM
  Double-click "Start ZKD Sites.cmd". It prints the current URLs.
  Leave that window open - closing it stops all three.

FROM ANOTHER DEVICE (phone, second laptop)
  Same Wi-Fi, then use the LAN address the launcher prints.
  At the time these shortcuts were made that was 192.168.0.102.

  The IP is handed out by DHCP and CAN CHANGE after a router or
  machine restart. If a shortcut stops working, run the launcher
  and use the address it prints.

  Windows Firewall may ask to allow Node.js on private networks
  the first time. It has to be allowed or other devices cannot connect.

NOTE ON EXPOSURE
  These are development servers now bound to 0.0.0.0, so anyone on
  the same Wi-Fi can open them. Fine for a demo on your own network.
  Do not run them on public or conference Wi-Fi.

SOURCE
  C:\Users\HPW\Desktop\Amex GOAT\zkd-sites
