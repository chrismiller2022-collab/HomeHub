// Text messages through Twilio. Incoming texts arrive at /api/sms (Twilio webhook); replies and
// reminders go out through Twilio's REST API.
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your Twilio number, +1555…),
//   PUBLIC_URL (https://your-app.vercel.app — must match the webhook URL set in Twilio exactly)
import { createHmac, timingSafeEqual } from 'node:crypto';

export function smsConfigured(env) {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

// Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + each POST param name+value, sorted by name)).
export function validTwilioSignature(authToken, url, params, signature) {
  var data = url + Object.keys(params).sort().map(function (k) { return k + params[k]; }).join('');
  var want = Buffer.from(createHmac('sha1', authToken).update(data).digest('base64'));
  var got = Buffer.from(String(signature || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

// "+1 (555) 123-4567", "555.123.4567" -> "+15551234567" (US numbers assumed when no country code).
export function normalisePhone(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  var digits = s.replace(/[^\d]/g, '');
  if (s[0] === '+') return digits.length >= 8 ? '+' + digits : null;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

// Split long replies at line or sentence boundaries to stay under Twilio's 1600-character limit.
export function splitForSms(text, max) {
  max = max || 1500;
  var parts = [], rest = String(text);
  while (rest.length > max) {
    var cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendSms(env, to, body, fetchImpl) {
  var parts = splitForSms(body);
  for (var i = 0; i < parts.length; i++) {
    var res = await (fetchImpl || fetch)('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ From: env.TWILIO_FROM, To: to, Body: parts[i] }).toString()
    });
    if (!res.ok) throw new Error('Twilio send failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
}

export var EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
