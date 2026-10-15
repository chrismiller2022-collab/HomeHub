# Our frame: Frameo "Digital Picture Frame 159K" — setup log

Hand-off notes for whoever (person or Claude session) continues the frame setup. Newest at the bottom.

## The device
- Frameo frame, 15.6", About screen: **Hardware brand and model number: Digital Picture Frame 159K**,
  Frameo **v1.32.15 (80310)**.
- Not documented in wesbos/photo-frame-dashboard yet. Closest documented model: the Frameo
  "Digital Photo Frame 102k" (KJM, Rockchip RK3326 S101 board, Android 11 Go, no root) —
  `docs/frameo-rk3326-s101.md` there. Also similar: Pastigio FRAME156 15.6" (RK3326, Android 8.1, has `su`).
- Frameo Settings → About shows **Beta Program** and **ADB access** ("by cabled connection").

## Rules
Follow the wesbos repo rules: read-only checks first, owner approves every write, verified backup
before any write, no scripts written for other boards. Home Hub itself needs no root: install the
kiosk APK with `adb install` and make it the home app.

## Progress so far (2026-10-14/15)
1. Mac (MacBook Air 2018, Intel, macOS Sonoma 14.7): Homebrew wouldn't install. ADB installed directly
   from Google's platform-tools zip into `~/Downloads/platform-tools` — works (`./adb version` 1.0.41).
   The Mac has only USB-C ports; USB-C to USB-C cables don't work with these frames, and no
   USB-C→USB-A adapter was available.
2. ADB over Wi-Fi to the frame (192.168.1.132:5555): refused. Expected — on the 102K, Wi-Fi ADB stays
   closed until one USB session runs `adb tcpip 5555`.
3. Windows 10 PC: platform-tools in `C:\Users\Admin\Downloads\platform-tools`, `.\adb version` works.
   Frame on a USB-A to USB-C cable: `.\adb devices` empty, and `Get-PnpDevice` showed **no new USB device
   at all** (only Logitech peripherals, hubs and a "T6 USB Station" dock). So: no data connection yet.
   Suspects, in order: plugged through the T6 dock instead of the PC's own port; cable is power-only;
   wrong port on the frame (its USB-A socket is for flash drives — data needs the USB-C port);
   ADB access switch not actually on / "transfer from computer" on.

## Next steps
1. Get a USB device to appear (PC's own USB-A port, a known data cable, the frame's USB-C port).
   Look for VID_2207 (Rockchip), VID_18D1 (Android/Google) or VID_1F3A (Allwinner).
2. If it appears with a driver error: install Google's USB driver for it.
3. `adb devices` → Allow on the frame → `adb tcpip 5555` → the Mac can then `adb connect 192.168.1.132:5555`.
4. Read-only checks: `getprop ro.product.model`, `ro.build.fingerprint`, `ro.board.platform`,
   `wm size`, MemTotal, WebView versionName, `su -c id`. Compare with the 102K / FRAME156 docs.
5. Then (with approval): backup, disable the vendor OTA updater, `adb install homehub-kiosk.apk`
   (GitHub Releases → kiosk-latest), point it at the deployed Home Hub URL with `?key=`, set it as home.
   Home Hub still needs deploying (Supabase + Vercel, see README).
