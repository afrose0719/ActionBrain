package app.actionbrain.android

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The Quick Settings tile. Tap it to pause ALL capture (notifications and chat reading) for an hour, tap again to resume.
 * It changes nothing but the pause time, so your other choices are kept.
 */
class CaptureTileService : TileService() {
    override fun onStartListening() = update()

    override fun onClick() {
        val settings = CaptureSettings(this)
        settings.pauseFor(if (settings.load().paused(System.currentTimeMillis())) 0 else PAUSE_MINUTES)
        update()
    }

    private fun update() {
        val tile = qsTile ?: return
        val paused = CaptureSettings(this).load().paused(System.currentTimeMillis())
        tile.state = if (paused) Tile.STATE_INACTIVE else Tile.STATE_ACTIVE
        tile.label = getString(R.string.tile_label)
        if (Build.VERSION.SDK_INT >= 29) tile.subtitle = if (paused) "Paused" else "Capturing"
        tile.updateTile()
    }

    private companion object {
        const val PAUSE_MINUTES = 60
    }
}
