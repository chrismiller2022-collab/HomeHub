# Putting Home Hub on the photo frame

The software side (Supabase, Vercel, calendars, people, to-dos) can be finished and used from
your phone before the frame arrives. This page covers the frame itself. It follows
[wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard), which documents
the hardware. **Read that repo's README for your exact board before running anything.** Frames
sold under the same name ship with different boards, and the steps differ.

## Before it arrives

- [ ] Home Hub deployed and working on your phone (README steps 1–4).
- [ ] Your kiosk address written down: `https://<your-app>.vercel.app/?key=<ACCESS_KEY>`.
- [ ] A **data** cable. The cable in the box is often power-only. Some frames need **USB-A to
      USB-C**, because USB-C to USB-C gives neither power nor data on them.
- [ ] `adb` installed on your computer: Android SDK Platform-Tools
      (`brew install android-platform-tools` on a Mac).
- [ ] A clone of wesbos/photo-frame-dashboard. Check its open issues and PRs too: new board
      variants show up there first.

## When it arrives: identify it first

Settings → About on the frame, and the USB IDs when plugged in. That repo's README has a table:

| You see | Board | Start with |
| --- | --- | --- |
| Rockchip, USB name `Synergy 10X1`, "Allow USB debugging?" prompt | BIUFRAME RK3126, Android 6 (the one in the video) | `docs/biuframe-setup-guide.md`, `scripts/biuframe-setup.sh check` |
| Firmware has `A33` and `PF1007L`, home app is **AiMOR** | Allwinner A33, Android 6 | `docs/pf1007l-start-here.md` |
| Anything else | unknown | the "phase map" in that README |

> **PF1007L / AiMOR warning:** the vendor app accepts root shell commands from the vendor's server
> over an unencrypted connection. Read `docs/aimor-remote-root-shell.md` and disable it **before**
> putting the frame on Wi-Fi.

Follow their rules: back up before any write, change one thing at a time, and stop at the first
mismatch.

## What the frame needs for Home Hub

1. **A WebView new enough (Chrome 84+).** Stock Android 6 frames ship WebView 44, which can't run
   it. The wesbos guides upgrade it to WebView 106. Check under Settings → Apps → Android System
   WebView, or with
   `adb shell dumpsys package com.android.webview | grep versionName`.
2. **Let's Encrypt root certificates.** Android 6 doesn't trust them, and Vercel serves Let's
   Encrypt certificates. The BIUFRAME guide adds the roots; without them the page won't load over
   HTTPS.
3. **Correct date, time and time zone** on the frame (Settings → Date & time). The display uses
   the frame's clock to decide what "today" is.
4. **A full-screen browser that starts on boot.** Pick one:
   - **The wesbos kiosk app** (`dashboard/kiosk/`): a small full-screen WebView with the screen
     kept on. Change `DEFAULT_URL` in `MainActivity.java` to your kiosk address, build with
     `dashboard/kiosk/build.sh`, then `adb install -r kiosk/build/homehq.apk`. To exit, hold two
     fingers still for 1.5 s. Or skip the rebuild and launch it with your address once:
     ```sh
     adb shell am start -a android.intent.action.VIEW \
       -d 'https://<your-app>.vercel.app/?key=<ACCESS_KEY>' -n com.wesbos.homehq/.MainActivity
     ```
     The key is then remembered, so later launches of the default address still sign in. You
     still need `DEFAULT_URL` to point at your app.
   - **Fully Kiosk Browser** (sideload the APK; it uses the system WebView, so step 1 still
     applies): set the Start URL to your kiosk address and turn on "Start on boot" and "Keep
     screen on".
   - Set your kiosk app as the default launcher (the wesbos guide covers launcher changes), so a
     power cut or reboot comes back to Home Hub.

## Check it on the frame

- [ ] Today, Calendar and To-dos all load; the clock and date are right.
- [ ] Ticking off a to-do on the frame shows on your phone within a minute, and the other way round.
- [ ] Change an event in Google Calendar; it appears within ~10 minutes.
- [ ] Night dimming starts at the hour set in Settings, and a tap wakes it.
- [ ] Pull the power, plug it back in: it boots straight back into Home Hub.

If the page is blank or stuck on "Household key", open the address with `?key=…` again. If it
won't load at all, the WebView version or the certificates (items 1–2) are the usual cause.
`adb logcat | grep -i chromium` shows WebView errors.

## Wall-display details already handled by the app

- Designed for 1280×800 (the 10.1" frames). It also adapts to other sizes and phones.
- Big touch targets; press and hold a to-do to edit it (there's no right-click or hover).
- Returns to Today after 3 idle minutes; reloads itself after midnight to pick up updates.
- Shows the last calendar data and an "Offline" badge if Wi-Fi drops; recovers on its own.
- If the app fails to start (for example, right after a deploy), it reloads until it does.
