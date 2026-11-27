package com.tgvideo.app;

// native/android/AppUpdaterPlugin.java
// Descarga la APK de la nueva versión con progreso y abre el instalador de Android.
// Se copia a android/app/src/main/java/com/tgvideo/app/ desde el workflow de GitHub Actions
// y desde scripts/prepare-android.js (una sola fuente para ambos).
//
// Por qué antes había que descargar dos veces:
//  1. Si la app no tenía el permiso «Instalar apps desconocidas», Android mostraba el aviso o los
//     ajustes y, al volver, la instalación ya se había perdido: había que repetir la descarga.
//  2. load() borraba siempre tgvideo_update.apk. Si el sistema recreaba la actividad mientras se
//     abría el instalador (frecuente en Android TV / Fire TV con poca memoria), el APK desaparecía
//     justo cuando el instalador iba a leerlo.
// Ahora: se comprueba el permiso, se guarda la instalación pendiente y se reanuda sola al volver de
// los ajustes; el APK tiene nombre por versión, se verifica su tamaño y solo se borran APK antiguos.

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;

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

    private static final String PREFIX = "tgvideo_update";
    private static final long STALE_MS = 6L * 60L * 60L * 1000L; // 6 horas

    private volatile boolean downloading = false;
    private File pendingApk = null;
    private boolean waitingPermission = false;

    @Override
    public void load() {
        super.load();
        cleanOldUpdateApks();
    }

    // Solo borra APK de actualización antiguos: nunca uno recién descargado que el instalador
    // podría estar leyendo si la actividad se ha recreado.
    private void cleanOldUpdateApks() {
        try {
            Context context = getContext();
            if (context == null) return;
            long now = System.currentTimeMillis();
            File[] dirs = new File[] { context.getExternalCacheDir(), context.getCacheDir() };
            for (File dir : dirs) {
                if (dir == null) continue;
                File[] files = dir.listFiles();
                if (files == null) continue;
                for (File f : files) {
                    String n = f.getName();
                    if (n.startsWith(PREFIX) && n.endsWith(".apk") && now - f.lastModified() > STALE_MS) {
                        f.delete();
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return getContext().getPackageManager().canRequestPackageInstalls();
        } catch (Exception e) {
            return true;
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canInstallPackages());
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String urlString = call.getString("url");
        final String version = call.getString("version", "latest");
        if (urlString == null || urlString.isEmpty()) {
            call.reject("URL de descarga no proporcionada");
            return;
        }
        if (downloading) {
            // Evita dos descargas simultáneas escribiendo en el mismo fichero
            JSObject ret = new JSObject();
            ret.put("alreadyRunning", true);
            call.resolve(ret);
            return;
        }
        downloading = true;
        call.resolve();

        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            OutputStream output = null;
            try {
                Context context = getContext();
                File cacheDir = context.getExternalCacheDir();
                if (cacheDir == null) cacheDir = context.getCacheDir();

                String safeVersion = version.replaceAll("[^A-Za-z0-9._-]", "_");
                File apkFile = new File(cacheDir, PREFIX + "_" + safeVersion + ".apk");
                File partFile = new File(cacheDir, PREFIX + "_" + safeVersion + ".part");
                if (partFile.exists()) partFile.delete();
                if (apkFile.exists()) apkFile.delete();

                URL url = new URL(urlString);
                int redirectCount = 0;
                while (true) {
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(30000);
                    connection.setUseCaches(false);
                    connection.setRequestProperty("User-Agent", "TGVideo-AppUpdater");
                    connection.setRequestProperty("Cache-Control", "no-cache");
                    connection.connect();
                    int status = connection.getResponseCode();
                    if ((status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM ||
                         status == HttpURLConnection.HTTP_SEE_OTHER || status == 307 || status == 308) && redirectCount < 8) {
                        String location = connection.getHeaderField("Location");
                        connection.disconnect();
                        url = new URL(url, location);
                        redirectCount++;
                        continue;
                    }
                    if (status < 200 || status >= 300) {
                        throw new Exception("HTTP " + status + " al descargar la actualización");
                    }
                    break;
                }

                long fileLength = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                    ? connection.getContentLengthLong()
                    : connection.getContentLength();
                input = new BufferedInputStream(connection.getInputStream(), 16384);
                output = new FileOutputStream(partFile);

                byte[] data = new byte[16384];
                long total = 0;
                int count;
                long lastNotifyTime = 0;
                while ((count = input.read(data)) != -1) {
                    total += count;
                    output.write(data, 0, count);
                    long now = System.currentTimeMillis();
                    if (now - lastNotifyTime > 250 && fileLength > 0) {
                        lastNotifyTime = now;
                        int percent = (int) Math.min(99, (total * 100) / fileLength);
                        JSObject progressObj = new JSObject();
                        progressObj.put("percent", percent);
                        progressObj.put("bytesDownloaded", total);
                        progressObj.put("totalBytes", fileLength);
                        notifyListeners("onUpdateProgress", progressObj);
                    }
                }
                output.flush();
                if (output instanceof FileOutputStream) {
                    try { ((FileOutputStream) output).getFD().sync(); } catch (Exception ignored) {}
                }
                output.close();
                output = null;
                input.close();
                input = null;

                if (fileLength > 0 && total != fileLength) {
                    partFile.delete();
                    throw new Exception("Descarga incompleta (" + total + " de " + fileLength + " bytes)");
                }
                if (total < 1024 * 1024) {
                    partFile.delete();
                    throw new Exception("El archivo descargado no es una APK válida");
                }
                if (!partFile.renameTo(apkFile)) {
                    throw new Exception("No se pudo preparar el archivo de instalación");
                }

                JSObject doneObj = new JSObject();
                doneObj.put("percent", 100);
                doneObj.put("bytesDownloaded", total);
                doneObj.put("totalBytes", total);
                notifyListeners("onUpdateProgress", doneObj);

                final File readyApk = apkFile;
                new Handler(Looper.getMainLooper()).post(() -> installOrAskPermission(readyApk));
            } catch (Exception e) {
                JSObject errObj = new JSObject();
                errObj.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                notifyListeners("onUpdateError", errObj);
            } finally {
                try { if (output != null) output.close(); } catch (Exception ignored) {}
                try { if (input != null) input.close(); } catch (Exception ignored) {}
                if (connection != null) connection.disconnect();
                downloading = false;
            }
        }).start();
    }

    private void installOrAskPermission(File apkFile) {
        if (!canInstallPackages()) {
            pendingApk = apkFile;
            waitingPermission = true;
            JSObject obj = new JSObject();
            obj.put("state", "permission");
            notifyListeners("onUpdateState", obj);
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
            } catch (Exception e) {
                // Algunos Android TV no tienen esa pantalla: se intenta abrir el instalador igualmente
                waitingPermission = false;
                launchInstaller(apkFile);
            }
            return;
        }
        launchInstaller(apkFile);
    }

    private void launchInstaller(File apkFile) {
        try {
            Context context = getContext();
            Uri apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
            pendingApk = null;
            JSObject obj = new JSObject();
            obj.put("state", "installer");
            notifyListeners("onUpdateState", obj);
        } catch (Exception e) {
            JSObject errObj = new JSObject();
            errObj.put("error", "No se pudo abrir el instalador: " + e.getMessage());
            notifyListeners("onUpdateError", errObj);
        }
    }

    // Al volver de los ajustes de «Instalar apps desconocidas» se reanuda la instalación sin descargar otra vez
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (waitingPermission && pendingApk != null) {
            waitingPermission = false;
            File apk = pendingApk;
            if (!apk.exists()) {
                JSObject errObj = new JSObject();
                errObj.put("error", "El archivo descargado ya no existe. Vuelve a intentarlo.");
                notifyListeners("onUpdateError", errObj);
                pendingApk = null;
                return;
            }
            if (canInstallPackages()) {
                launchInstaller(apk);
            } else {
                JSObject obj = new JSObject();
                obj.put("state", "permission-denied");
                notifyListeners("onUpdateState", obj);
            }
        }
    }

    // Reintento manual desde la app sin repetir la descarga
    @PluginMethod
    public void retryInstall(PluginCall call) {
        if (pendingApk == null || !pendingApk.exists()) {
            call.reject("No hay ninguna actualización descargada pendiente");
            return;
        }
        final File apk = pendingApk;
        new Handler(Looper.getMainLooper()).post(() -> installOrAskPermission(apk));
        call.resolve();
    }
}
