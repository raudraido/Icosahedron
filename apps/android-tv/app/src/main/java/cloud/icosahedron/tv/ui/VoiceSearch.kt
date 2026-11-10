@file:OptIn(ExperimentalTvMaterial3Api::class)

package cloud.icosahedron.tv.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import cloud.icosahedron.tv.R

/**
 * Voice search with the app's own screen: the microphone listens (the system's speech recognizer does the
 * recognising, the TV's remote supplies the sound), what is heard shows up while you speak, and the final
 * words are handed to [onText]. Nothing from the system's own search bar appears.
 */
class VoiceSearch internal constructor(private val context: Context) {
    var listening by mutableStateOf(false)
        private set
    /** What has been understood so far. */
    var heard by mutableStateOf("")
        private set
    var message by mutableStateOf<String?>(null)
        private set
    internal var onText: (String) -> Unit = {}
    internal var askPermission: () -> Unit = {}
    private var recognizer: SpeechRecognizer? = null

    fun toggle() { if (listening) cancel() else start() }

    internal fun start() {
        message = null
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            message = "Voice search is not available on this TV."
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            askPermission()
            return
        }
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        heard = ""
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName),
        )
        listening = true
    }

    fun cancel() {
        recognizer?.cancel()
        listening = false
    }

    internal fun denied() {
        message = "Allow the microphone to search by voice (Settings, Apps, Icosahedron, Permissions)."
    }

    internal fun destroy() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    private fun first(b: Bundle?): String? =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }

    private val listener = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) { first(partialResults)?.let { heard = it } }
        override fun onResults(results: Bundle?) {
            listening = false
            first(results)?.let { heard = it; onText(it.trim()) }
        }
        override fun onError(error: Int) {
            listening = false
            message = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Did not hear anything. Try again."
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "No connection to the speech recognizer."
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow the microphone to search by voice."
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The speech recognizer is busy. Try again."
                else -> "Voice search failed (code $error)."
            }
        }
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }
}

@Composable
fun rememberVoiceSearch(onText: (String) -> Unit): VoiceSearch {
    val context = LocalContext.current
    val voice = remember { VoiceSearch(context) }
    voice.onText = onText
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) voice.start() else voice.denied()
    }
    voice.askPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) }
    DisposableEffect(Unit) { onDispose { voice.destroy() } }
    return voice
}

/** A microphone that pulses while the TV listens, with the words as they are understood. */
@Composable
fun ListeningPanel(heard: String) {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val s by pulse.animateFloat(
        initialValue = 0.85f, targetValue = 1.2f, label = "scale",
        animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
    )
    Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.size(120.dp).scale(s).clip(CircleShape).background(Accent.copy(alpha = 0.22f)))
            Box(Modifier.size(72.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_mic), contentDescription = null, modifier = Modifier.size(36.dp))
            }
        }
        Text("Listening… say an artist, an album or a song", color = Dim, fontSize = 16.sp, modifier = Modifier.padding(top = 20.dp))
        Text(heard, fontSize = 28.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp, start = 48.dp, end = 48.dp))
    }
}
