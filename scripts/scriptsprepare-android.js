// scripts/prepare-android.js
// Configura automáticamente AndroidManifest.xml, banners 16:9, aceleración de hardware,
// WebSettings, FileProvider y AppUpdaterPlugin para Android TV y compilaciones locales.
import fs from 'fs';
import path from 'path';

const ANDROID_RES = path.resolve('android/app/src/main/res');
const MANIFEST_PATH = path.resolve('android/app/src/main/AndroidManifest.xml');

function ensureAppUpdaterPlugin() {
  const javaDir = path.resolve('android/app/src/main/java/com/tgvideo/app');
  if (!fs.existsSync(javaDir)) {
    fs.mkdirSync(javaDir, { recursive: true });
  }

  const pluginPath = path.join(javaDir, 'AppUpdaterPlugin.java');
  const pluginCode = `package com.tgvideo.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import java.util.List;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdaterPlugin")
public class AppUpdaterPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        cleanOldUpdateApk();
    }

    private void cleanOldUpdateApk() {
        try {
            Context context = getContext();
            if (context == null) return;
            File cacheDir = context.getExternalCacheDir();
            if (cacheDir != null) {
                File f = new File(cacheDir, "tgvideo_update.apk");
                if (f.exists()) f.delete();
            }
            File intCache = context.getCacheDir();
            if (intCache != null) {
                File f = new File(intCache, "tgvideo_update.apk");
                if (f.exists()) f.delete();
            }
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String urlString = call.getString("url");
        if (urlString == null || urlString.isEmpty()) {
            call.reject("URL de descarga no proporcionada");
            return;
        }

        call.resolve();

        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            OutputStream output = null;
            try {
                Context context = getContext();
                File cacheDir = context.getExternalCacheDir();
                if (cacheDir == null) cacheDir = context.getCacheDir();

                File apkFile = new File(cacheDir, "tgvideo_update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                URL url = new URL(urlString);
                int redirectCount = 0;
                while (redirectCount < 5) {
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestProperty("User-Agent", "TGVideo-AppUpdater");
                    connection.connect();

                    int status = connection.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_TEMP ||
                        status == HttpURLConnection.HTTP_MOVED_PERM ||
                        status == 307 || status == 308) {
                        String newUrl = connection.getHeaderField("Location");
                        connection.disconnect();
                        url = new URL(newUrl);
                        redirectCount++;
                    } else {
                        break;
                    }
                }

                int fileLength = connection.getContentLength();
                input = new BufferedInputStream(connection.getInputStream(), 8192);
                output = new FileOutputStream(apkFile);

                byte[] data = new byte[8192];
                long total = 0;
                int count;
                long lastNotifyTime = 0;

                while ((count = input.read(data)) != -1) {
                    total += count;
                    output.write(data, 0, count);

                    long now = System.currentTimeMillis();
                    if (now - lastNotifyTime > 250 && fileLength > 0) {
                        lastNotifyTime = now;
                        int percent = (int) ((total * 100) / fileLength);
                        JSObject progressObj = new JSObject();
                        progressObj.put("percent", percent);
                        progressObj.put("bytesDownloaded", total);
                        progressObj.put("totalBytes", fileLength);
                        notifyListeners("onUpdateProgress", progressObj);
                    }
                }

                output.flush();
                output.close();
                output = null;
                input.close();
                input = null;

                apkFile.setReadable(true, false);

                // Notificar 100% completado
                JSObject doneObj = new JSObject();
                doneObj.put("percent", 100);
                doneObj.put("bytesDownloaded", total);
                doneObj.put("totalBytes", total);
                notifyListeners("onUpdateProgress", doneObj);

                // Pequeña pausa para asegurar sincronización en almacenamiento antes de iniciar el intent
                try { Thread.sleep(250); } catch (InterruptedException ignored) {}

                // Lanzar instalador nativo del paquete APK
                Uri apkUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    apkFile
                );

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);

                List<ResolveInfo> resInfoList = context.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
                for (ResolveInfo resolveInfo : resInfoList) {
                    context.grantUriPermission(resolveInfo.activityInfo.packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }

                Activity act = getActivity();
                if (act != null && !act.isFinishing()) {
                    act.runOnUiThread(() -> {
                        try {
                            act.startActivity(intent);
                        } catch (Exception ex) {
                            context.startActivity(intent);
                        }
                    });
                } else {
                    context.startActivity(intent);
                }

            } catch (Exception e) {
                JSObject errObj = new JSObject();
                errObj.put("error", e.getMessage());
                notifyListeners("onUpdateError", errObj);
            } finally {
                try { if (output != null) output.close(); } catch (Exception ignored) {}
                try { if (input != null) input.close(); } catch (Exception ignored) {}
                if (connection != null) connection.disconnect();
            }
        }).start();
    }
}
`;
  fs.writeFileSync(pluginPath, pluginCode, 'utf-8');
  console.log('[prepare-android] AppUpdaterPlugin.java inyectado con éxito.');
}

function ensureFilePathsXml() {
  const xmlDir = path.join(ANDROID_RES, 'xml');
  if (!fs.existsSync(xmlDir)) {
    fs.mkdirSync(xmlDir, { recursive: true });
  }
  const fp = path.join(xmlDir, 'file_paths.xml');
  const content = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-cache-path name="external_cache" path="." />
    <cache-path name="cache" path="." />
</paths>
`;
  fs.writeFileSync(fp, content, 'utf-8');
  console.log('[prepare-android] file_paths.xml creado para FileProvider.');
}

function configureManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log('[prepare-android] AndroidManifest.xml no encontrado. Ejecuta primero "npx cap add android".');
    return;
  }

  let m = fs.readFileSync(MANIFEST_PATH, 'utf-8');

  // 1. Features Leanback
  if (!m.includes('android.software.leanback')) {
    m = m.replace(
      /(<manifest[^>]*>)/,
      '$1\n    <uses-feature android:name="android.software.leanback" android:required="false" />\n    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />'
    );
  }

  // 2. Banner, cleartext y aceleración por hardware en <application>
  if (!m.includes('android:banner=')) {
    m = m.replace('<application', '<application android:banner="@drawable/banner" android:logo="@drawable/banner" android:usesCleartextTraffic="true" android:hardwareAccelerated="true"');
  } else {
    if (!m.includes('android:usesCleartextTraffic=')) {
      m = m.replace('<application', '<application android:usesCleartextTraffic="true"');
    }
    if (!m.includes('android:hardwareAccelerated=')) {
      m = m.replace('<application', '<application android:hardwareAccelerated="true"');
    }
  }

  // 3. Banner e icono en MainActivity
  m = m.replace(/<activity\b[^>]*MainActivity[^>]*>/, (tag) => {
    if (!tag.includes('android:banner=')) {
      tag = tag.replace(/>$/, ' android:banner="@drawable/banner" android:icon="@drawable/banner" android:logo="@drawable/banner">');
    } else if (!tag.includes('android:icon=')) {
      tag = tag.replace(/>$/, ' android:icon="@drawable/banner">');
    }
    return tag;
  });

  // 4. Intent filter LEANBACK_LAUNCHER
  if (!m.includes('LEANBACK_LAUNCHER')) {
    const leanbackFilter = `            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>`;
    m = m.replace(/(<intent-filter\b[\s\S]*?android\.intent\.category\.LAUNCHER[\s\S]*?<\/intent-filter>)/, `${leanbackFilter}\n$1`);
  }

  // 5. Permisos para actualización de APK
  if (!m.includes('REQUEST_INSTALL_PACKAGES')) {
    m = m.replace('</manifest>', '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n</manifest>');
  }

  // 6. FileProvider para instalar APK descargada
  if (!m.includes('${applicationId}.fileprovider') && !m.includes('androidx.core.content.FileProvider')) {
    const providerXml = `        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>`;
    m = m.replace('</application>', `${providerXml}\n    </application>`);
  }

  fs.writeFileSync(MANIFEST_PATH, m, 'utf-8');
  console.log('[prepare-android] AndroidManifest.xml configurado correctamente para Android TV e instalador.');
}

function copyBanners() {
  const candidates = [
    'public/icons/icon-landscape.alt2.png',
    'public/icons/icon-landscape.alt.png',
    'public/icons/icon-landscape.png'
  ];

  const bannerSrc = candidates.find(c => fs.existsSync(path.resolve(c)));
  if (!bannerSrc) {
    console.warn('[prepare-android] No se encontró imagen de banner en public/icons/');
    return;
  }

  const srcBuffer = fs.readFileSync(path.resolve(bannerSrc));
  const folders = [
    'drawable',
    'drawable-mdpi',
    'drawable-tvdpi',
    'drawable-hdpi',
    'drawable-xhdpi',
    'drawable-xxhdpi',
    'drawable-xxxhdpi',
    'mipmap-mdpi',
    'mipmap-tvdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi'
  ];

  folders.forEach(folder => {
    const targetDir = path.join(ANDROID_RES, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(path.join(targetDir, 'banner.png'), srcBuffer);
    fs.writeFileSync(path.join(targetDir, 'tv_banner.png'), srcBuffer);
  });

  console.log(`[prepare-android] Banners 16:9 inyectados desde ${bannerSrc} en carpetas de recursos.`);
}

function configureStyles() {
  const stylePaths = [
    path.join(ANDROID_RES, 'values/styles.xml'),
    path.join(ANDROID_RES, 'values-night/styles.xml')
  ];

  stylePaths.forEach(sp => {
    if (fs.existsSync(sp)) {
      let st = fs.readFileSync(sp, 'utf-8');
      if (st.includes('android:windowBackground')) {
        st = st.replace(/<item name="android:windowBackground">[^<]+<\/item>/, '<item name="android:windowBackground">@android:color/black</item>');
      } else {
        st = st.replace('</style>', '    <item name="android:windowBackground">@android:color/black</item>\n    </style>');
      }
      fs.writeFileSync(sp, st, 'utf-8');
    }
  });
  console.log('[prepare-android] Fondo negro configurado en styles.xml.');
}

function configureMainActivity() {
  const javaDir = path.resolve('android/app/src/main/java');
  if (!fs.existsSync(javaDir)) return;

  function findMainActivity(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const found = findMainActivity(full);
        if (found) return found;
      } else if (ent.name === 'MainActivity.java') {
        return full;
      }
    }
    return null;
  }

  const mainPath = findMainActivity(javaDir);
  if (!mainPath) return;

  let content = fs.readFileSync(mainPath, 'utf-8');

  // Registrar plugins en onCreate si aún no están registrados
  if (!content.includes('AppUpdaterPlugin.class')) {
    if (content.includes('registerPlugin(ExoPlayerPlugin.class);')) {
      content = content.replace(
        'registerPlugin(ExoPlayerPlugin.class);',
        'registerPlugin(AppUpdaterPlugin.class);\n        registerPlugin(ExoPlayerPlugin.class);'
      );
    } else if (content.includes('public class MainActivity extends BridgeActivity {')) {
      const onCreateReplacement = `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(ExoPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }`;
      content = content.replace('public class MainActivity extends BridgeActivity {', onCreateReplacement);
    }
  }

  // WebSettings para reproducción de medios sin bloqueo, soporte óptimo de WebView y control de escala en Android TV
  if (!content.includes('setMediaPlaybackRequiresUserGesture(false)')) {
    const webSettingsCode = `
        if (getBridge() != null && getBridge().getWebView() != null) {
            android.webkit.WebSettings ws = getBridge().getWebView().getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            ws.setMediaPlaybackRequiresUserGesture(false);
            ws.setAllowFileAccess(true);
            ws.setAllowContentAccess(true);
            ws.setTextZoom(100);
            getBridge().getWebView().setBackgroundColor(android.graphics.Color.BLACK);
        }`;

    if (content.includes('super.onCreate(savedInstanceState);')) {
      const hwCode = `\n        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED, android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);`;
      content = content.replace('super.onCreate(savedInstanceState);', `super.onCreate(savedInstanceState);${hwCode}${webSettingsCode}`);
    }
  }

  // dispatchKeyEvent para mandos de Android TV
  if (!content.includes('dispatchKeyEvent')) {
    const dispatchMethod = `
    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        int action = event.getAction();
        int keyCode = event.getKeyCode();
        if (action == android.view.KeyEvent.ACTION_DOWN) {
            if (keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PLAY ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PAUSE ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_REWIND ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_NEXT ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_STEP_FORWARD ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_STEP_BACKWARD ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD) {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().dispatchKeyEvent(event);
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }
`;
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace !== -1) {
      content = content.slice(0, lastBrace) + dispatchMethod + content.slice(lastBrace);
    }
  }

  fs.writeFileSync(mainPath, content, 'utf-8');
  console.log('[prepare-android] MainActivity.java configurado (Plugins, WebSettings, dispatchKeyEvent).');
}

try {
  ensureAppUpdaterPlugin();
  ensureFilePathsXml();
  configureManifest();
  copyBanners();
  configureStyles();
  configureMainActivity();
  console.log('[prepare-android] Preparación para Android completada con éxito.');
} catch (err) {
  console.error('[prepare-android] Error:', err);
}