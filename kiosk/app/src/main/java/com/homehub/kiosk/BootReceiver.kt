package com.homehub.kiosk

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Opens Home Hub when the frame finishes booting. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
