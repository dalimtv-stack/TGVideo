package com.tgvideo.app;

import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin Capacitor para ExoPlayer en Android TV.
 * Optimizado para decodificación por hardware de alta velocidad,
 * Scrubbing Mode reactivo, SeekParameters dinámicos y LoadControl ajustado.
 */
@CapacitorPlugin(name = "ExoPlayerPlugin")
public class ExoPlayerPlugin extends Plugin {
    private static final String TAG = "TGVideoExoPlayer";

    private ExoPlayer player;
    private PlayerView playerView;
    private DefaultTrackSelector trackSelector;
    private LocalStreamServer streamServer;
    private Handler progressHandler;
    private Runnable progressRunnable;
    private boolean isPlaying = false;
    private boolean isScrubbing = false;

    // Métricas de rendimiento
    private long playbackRequestedAt = 0;
    private long lastSeekRequestedAt = 0;
    private String activeVideoDecoder = "desconocido";

    @Override
    public void load() {
        super.load();
        progressHandler = new Handler(Looper.getMainLooper());
        streamServer = new LocalStreamServer((streamId, start, end, requestId) -> {
            JSObject ev = new JSObject();
            ev.put("streamId", streamId);
            ev.put("start", start);
            ev.put("end", end);
            ev.put("requestId", requestId);
            notifyListeners("needRange", ev);
        });
        streamServer.start();
        Log.d(TAG, "ExoPlayerPlugin cargado");
    }

    @PluginMethod
    public void startStreamServer(PluginCall call) {
        int port = streamServer != null ? streamServer.start() : -1;
        JSObject res = new JSObject();
        res.put("port", port);
        call.resolve(res);
    }

    @PluginMethod
    public void registerStream(PluginCall call) {
        String id = call.getString("id");
        long size = call.getData().optLong("size", 0L);
        String mime = call.getString("mime", "video/mp4");
        String name = call.getString("name", "video.mp4");

        if (streamServer != null && id != null) {
            streamServer.registerStream(id, size, mime, name);
        }
        JSObject res = new JSObject();
        res.put("registered", true);
        call.resolve(res);
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        long resumeAtMs = (long) (call.getData().optDouble("resumeAt", 0.0) * 1000.0);
        playbackRequestedAt = System.currentTimeMillis();

        getActivity().runOnUiThread(() -> {
            try {
                if (player == null) {
                    initExoPlayer();
                }

                if (url != null) {
                    MediaItem mediaItem = MediaItem.fromUri(Uri.parse(url));
                    player.setMediaItem(mediaItem);
                    if (resumeAtMs > 0) {
                        player.setSeekParameters(SeekParameters.CLOSEST_SYNC);
                        player.seekTo(resumeAtMs);
                        player.setSeekParameters(SeekParameters.EXACT);
                    }
                    player.prepare();
                    player.play();
                }

                startProgressTimer();
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Error iniciando reproducción", e);
                call.reject("Error al iniciar ExoPlayer: " + e.getMessage());
            }
        });
    }

    /**
     * Inicializa ExoPlayer con LoadControl optimizado, aceleración por hardware
     * y listeners analíticos de tiempo de respuesta.
     */
    private void initExoPlayer() {
        // 1. Configuración de búfer ajustada (LoadControl)
        // Reducimos tiempos de inicio y retenemos 30s de búfer posterior para rebobinados instantáneos
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        15000, // minBufferMs: 15s en vez de 50s
                        30000, // maxBufferMs: 30s
                        500,   // bufferForPlaybackMs: 500ms para arranque ultrarrápido
                        1000   // bufferForPlaybackAfterRebufferMs: 1000ms
                )
                .setBackBuffer(30000, true) // Retener 30s de historial de fotogramas clave
                .build();

        // 2. RenderersFactory enfocado a decodificación por hardware con MediaCodec
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(getContext())
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
                .setEnableDecoderFallback(true)
                .setMediaCodecSelector(MediaCodecSelector.DEFAULT);

        // 3. TrackSelector
        trackSelector = new DefaultTrackSelector(getContext());

        // 4. Instancia de ExoPlayer
        player = new ExoPlayer.Builder(getContext(), renderersFactory)
                .setTrackSelector(trackSelector)
                .setLoadControl(loadControl)
                .build();

        // Parámetro de búsqueda por defecto
        player.setSeekParameters(SeekParameters.EXACT);

        // 5. AnalyticsListener para métricas de tiempo a primer fotograma y decodificadores
        player.addAnalyticsListener(new AnalyticsListener() {
            @Override
            public void onRenderedFirstFrame(EventTime eventTime, Object output, long renderTimeMs) {
                long elapsed = System.currentTimeMillis() - playbackRequestedAt;
                Log.i(TAG, "Primer fotograma renderizado tras inicio en " + elapsed + " ms");
                JSObject ev = new JSObject();
                ev.put("type", "firstFrame");
                ev.put("elapsedMs", elapsed);
                notifyListeners("onPerformanceMetric", ev);
            }

            @Override
            public void onVideoDecoderInitialized(EventTime eventTime, String decoderName, long initializedTimestampMs, long initializationDurationMs) {
                activeVideoDecoder = decoderName != null ? decoderName : "hardware";
                Log.i(TAG, "Decodificador de hardware seleccionado: " + activeVideoDecoder + " (inicializado en " + initializationDurationMs + " ms)");
                JSObject ev = new JSObject();
                ev.put("type", "decoderInit");
                ev.put("decoder", activeVideoDecoder);
                ev.put("durationMs", initializationDurationMs);
                notifyListeners("onPerformanceMetric", ev);
            }

            @Override
            public void onSeekStarted(EventTime eventTime) {
                lastSeekRequestedAt = System.currentTimeMillis();
            }

            @Override
            public void onDroppedVideoFrames(EventTime eventTime, int droppedFrames, long elapsedMs) {
                if (droppedFrames > 10) {
                    Log.w(TAG, "Frames descartados detectados: " + droppedFrames + " en " + elapsedMs + " ms");
                }
            }
        });

        // 6. Listener de estados estándar
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    JSObject ret = new JSObject();
                    ret.put("state", "ready");
                    ret.put("duration", player.getDuration() / 1000.0);
                    notifyListeners("onReady", ret);
                } else if (state == Player.STATE_ENDED) {
                    notifyListeners("onEnded", new JSObject());
                }
            }

            @Override
            public void onIsPlayingChanged(boolean playing) {
                isPlaying = playing;
                JSObject ret = new JSObject();
                ret.put("isPlaying", playing);
                notifyListeners("onPlayingChanged", ret);
            }
        });

        // 7. Layout del reproductor
        android.view.LayoutInflater inflater = android.view.LayoutInflater.from(getContext());
        int layoutRes = getContext().getResources().getIdentifier("exo_player_layout", "layout", getContext().getPackageName());
        if (layoutRes != 0) {
            playerView = (PlayerView) inflater.inflate(layoutRes, null);
        } else {
            playerView = new PlayerView(getContext());
            playerView.setUseController(false);
            playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        }
        playerView.setPlayer(player);

        ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        int webViewIndex = parent.indexOfChild(getBridge().getWebView());
        parent.addView(playerView, webViewIndex, params);

        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }

    /**
     * Activa o desactiva el Scrubbing Mode interactivo.
     * Durante el desplazamiento interactivo por la barra de tiempo:
     * - Activa setScrubbingModeEnabled(true)
     * - Cambia SeekParameters a CLOSEST_SYNC para que el hardware pinte fotogramas al instante
     * Al terminar, restablece SeekParameters a EXACT y apaga Scrubbing Mode.
     */
    @PluginMethod
    public void setScrubbingMode(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        isScrubbing = enabled;

        getActivity().runOnUiThread(() -> {
            if (player != null) {
                try {
                    player.setScrubbingModeEnabled(enabled);
                } catch (Throwable t) {
                    Log.w(TAG, "setScrubbingModeEnabled no soportado o en modo seguro: " + t.getMessage());
                }

                if (enabled) {
                    player.setSeekParameters(SeekParameters.CLOSEST_SYNC);
                } else {
                    player.setSeekParameters(SeekParameters.EXACT);
                }
            }
            call.resolve();
        });
    }

    /**
     * Posicionamiento temporal. Soporta salto rápido a sync frame (fast: true)
     * o salto exacto fotograma a fotograma (exact: true).
     */
    @PluginMethod
    public void seekTo(PluginCall call) {
        double posSeconds = call.getDouble("position", 0.0);
        boolean fast = call.getBoolean("fast", false);
        boolean exact = call.getBoolean("exact", false);
        long targetMs = (long) (Math.max(0.0, posSeconds) * 1000.0);

        getActivity().runOnUiThread(() -> {
            if (player != null) {
                if (fast || isScrubbing) {
                    player.setSeekParameters(SeekParameters.CLOSEST_SYNC);
                } else if (exact) {
                    player.setSeekParameters(SeekParameters.EXACT);
                }
                player.seekTo(targetMs);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getPlaybackMetrics(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject res = new JSObject();
            if (player != null) {
                res.put("currentTime", player.getCurrentPosition() / 1000.0);
                res.put("duration", player.getDuration() > 0 ? player.getDuration() / 1000.0 : 0.0);
                res.put("bufferedPosition", player.getBufferedPosition() / 1000.0);
                res.put("isPlaying", player.isPlaying());
                res.put("isScrubbing", isScrubbing);
                res.put("videoDecoder", activeVideoDecoder);
            }
            call.resolve(res);
        });
    }

    @PluginMethod
    public void getTracks(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                JSObject result = new JSObject();
                JSArray audio = new JSArray();
                JSArray text = new JSArray();
                if (player != null) {
                    Tracks tracks = player.getCurrentTracks();
                    if (tracks != null) {
                        for (int groupIndex = 0; groupIndex < tracks.getGroups().size(); groupIndex++) {
                            Tracks.Group group = tracks.getGroups().get(groupIndex);
                            if (group == null) continue;
                            int type = group.getType();
                            if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT) continue;
                            int trackCount = group.length;
                            for (int trackIndex = 0; trackIndex < trackCount; trackIndex++) {
                                try {
                                    if (!group.isTrackSupported(trackIndex)) continue;
                                } catch (Throwable ignored) {}
                                Format format = group.getTrackFormat(trackIndex);
                                if (format == null) continue;
                                JSObject item = new JSObject();
                                item.put("group", groupIndex);
                                item.put("track", trackIndex);
                                item.put("language", format.language != null ? format.language : "");
                                item.put("label", format.label != null ? format.label : "");
                                try {
                                    item.put("selected", group.isTrackSelected(trackIndex));
                                } catch (Throwable t) {
                                    item.put("selected", false);
                                }
                                item.put("type", type == C.TRACK_TYPE_AUDIO ? "audio" : "text");
                                if (type == C.TRACK_TYPE_AUDIO) audio.put(item);
                                else text.put(item);
                            }
                        }
                    }
                }
                result.put("audio", audio);
                result.put("text", text);
                call.resolve(result);
            } catch (Throwable t) {
                call.reject("getTracks falló: " + (t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName()));
            }
        });
    }

    @PluginMethod
    public void selectTrack(PluginCall call) {
        String typeName = call.getString("type", "audio");
        int groupIndex = call.getData().optInt("group", -1);
        int trackIndex = call.getData().optInt("track", -1);
        boolean enabled = call.getData().optBoolean("enabled", true);
        getActivity().runOnUiThread(() -> {
            if (player == null) { call.reject("ExoPlayer no está activo"); return; }
            int trackType = "text".equals(typeName) ? C.TRACK_TYPE_TEXT : C.TRACK_TYPE_AUDIO;
            if (trackType == C.TRACK_TYPE_TEXT && !enabled) {
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .clearOverridesOfType(trackType).setTrackTypeDisabled(trackType, true).build());
                call.resolve();
                return;
            }
            Tracks groups = player.getCurrentTracks();
            if (groupIndex < 0 || groupIndex >= groups.getGroups().size()) {
                call.reject("Grupo de pista no disponible"); return;
            }
            Tracks.Group group = groups.getGroups().get(groupIndex);
            if (trackIndex < 0 || trackIndex >= group.length || group.getType() != trackType) {
                call.reject("Pista no disponible"); return;
            }
            TrackSelectionOverride override = new TrackSelectionOverride(group.getMediaTrackGroup(), trackIndex);
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .clearOverridesOfType(trackType).addOverride(override)
                    .setTrackTypeDisabled(trackType, false).build());
            call.resolve();
        });
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", true);
        getActivity().runOnUiThread(() -> {
            try {
                if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } catch (Throwable ignored) {}
            call.resolve();
        });
    }

    @PluginMethod
    public void togglePlay(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) {
                if (player.isPlaying()) player.pause();
                else player.play();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopPlayback();
            call.resolve();
        });
    }

    private void startProgressTimer() {
        stopProgressTimer();
        progressRunnable = new Runnable() {
            @Override
            public void run() {
                if (player != null) {
                    long cur = player.getCurrentPosition();
                    long dur = player.getDuration();
                    long buf = player.getBufferedPosition();
                    JSObject ret = new JSObject();
                    ret.put("currentTime", cur / 1000.0);
                    ret.put("duration", dur > 0 ? dur / 1000.0 : 0.0);
                    ret.put("bufferedTime", buf > 0 ? buf / 1000.0 : 0.0);
                    ret.put("isPlaying", player.isPlaying());
                    ret.put("isScrubbing", isScrubbing);
                    notifyListeners("onPlaybackProgress", ret);
                }
                progressHandler.postDelayed(this, isScrubbing ? 200 : 400);
            }
        };
        progressHandler.post(progressRunnable);
    }

    private void stopProgressTimer() {
        if (progressHandler != null && progressRunnable != null) {
            progressHandler.removeCallbacks(progressRunnable);
        }
    }

    private void stopPlayback() {
        stopProgressTimer();
        if (streamServer != null) {
            streamServer.cleanPending();
        }
        if (player != null) {
            try {
                player.setScrubbingModeEnabled(false);
            } catch (Throwable ignored) {}
            player.stop();
            player.clearMediaItems();
            player.release();
            player = null;
        }
        if (playerView != null) {
            ViewGroup parent = (ViewGroup) playerView.getParent();
            if (parent != null) parent.removeView(playerView);
            playerView = null;
        }
        try {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        } catch (Exception ignored) {}
        isScrubbing = false;
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        stopPlayback();
        if (streamServer != null) {
            streamServer.stop();
        }
    }
}
