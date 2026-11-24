package expo.modules.audiofocus

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hands narration Android audio focus, so music from Spotify, YouTube Music or
 * any other player pauses while a story is spoken and is free to resume after.
 *
 * Speech attributes matter: the system pauses rather than ducks players that
 * are themselves playing speech, and `setWillPauseWhenDucked` keeps the
 * behaviour consistent on older releases.
 */
class AudioFocusModule : Module() {
  private var focusRequest: AudioFocusRequest? = null
  private var legacyFocusHeld = false

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.applicationContext?.getSystemService(Context.AUDIO_SERVICE)
      as? AudioManager

  private val listener = AudioManager.OnAudioFocusChangeListener { }

  private fun abandonFocus() {
    val manager = audioManager
    if (manager != null) {
      focusRequest?.let { manager.abandonAudioFocusRequest(it) }
      if (legacyFocusHeld) {
        @Suppress("DEPRECATION")
        manager.abandonAudioFocus(listener)
      }
    }
    focusRequest = null
    legacyFocusHeld = false
  }

  override fun definition() = ModuleDefinition {
    Name("AudioFocus")

    /** Ask for transient exclusive focus. Returns false when it was refused. */
    Function("request") {
      val manager = audioManager ?: return@Function false
      if (focusRequest != null || legacyFocusHeld) return@Function true

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .setWillPauseWhenDucked(true)
          .setOnAudioFocusChangeListener(listener)
          .build()

        if (manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
          focusRequest = request
          true
        } else {
          false
        }
      } else {
        @Suppress("DEPRECATION")
        val granted = manager.requestAudioFocus(
          listener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        legacyFocusHeld = granted
        granted
      }
    }

    /** Give the focus back, letting the paused player carry on. */
    Function("abandon") {
      abandonFocus()
      true
    }
  }
}
