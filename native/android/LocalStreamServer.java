package com.tgvideo.app;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Servidor HTTP local de alto rendimiento para ExoPlayer.
 * Atiende peticiones HTTP Range con respuestas 206 Partial Content
 * y hace puente con el cliente de Telegram en la capa Web/Capacitor.
 */
public class LocalStreamServer {
    private static final String TAG = "TGVideoStreamServer";

    public interface RangeListener {
        void onNeedRange(String streamId, long start, long end, String requestId);
    }

    public static class StreamMeta {
        public final String id;
        public final long size;
        public final String mime;
        public final String name;

        public StreamMeta(String id, long size, String mime, String name) {
            this.id = id;
            this.size = size;
            this.mime = mime != null && !mime.isEmpty() ? mime : "video/mp4";
            this.name = name != null && !name.isEmpty() ? name : "video.mp4";
        }
    }

    private ServerSocket serverSocket;
    private Thread serverThread;
    private volatile boolean running = false;
    private int port = 0;
    private final RangeListener listener;
    private final Map<String, StreamMeta> streams = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<byte[]>> pendingChunks = new ConcurrentHashMap<>();
    private final ExecutorService workerPool = Executors.newFixedThreadPool(8);

    public LocalStreamServer(RangeListener listener) {
        this.listener = listener;
    }

    public synchronized int start() {
        if (running && serverSocket != null && !serverSocket.isClosed()) {
            return port;
        }
        try {
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            port = serverSocket.getLocalPort();
            running = true;
            serverThread = new Thread(this::listenLoop, "TGVideo-LocalStreamServer");
            serverThread.setDaemon(true);
            serverThread.start();
            Log.d(TAG, "LocalStreamServer iniciado en 127.0.0.1:" + port);
            return port;
        } catch (Exception e) {
            Log.e(TAG, "Error iniciando LocalStreamServer", e);
            return -1;
        }
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (Exception ignored) {}
        streams.clear();
        cleanPending();
        try {
            workerPool.shutdownNow();
        } catch (Exception ignored) {}
        Log.d(TAG, "LocalStreamServer detenido");
    }

    public void registerStream(String id, long size, String mime, String name) {
        if (id == null) return;
        streams.put(id, new StreamMeta(id, size, mime, name));
        Log.d(TAG, "Stream registrado: id=" + id + " size=" + size + " mime=" + mime);
    }

    public void unregisterStream(String id) {
        if (id != null) {
            streams.remove(id);
        }
    }

    public void putChunk(String requestId, byte[] data) {
        if (requestId == null) return;
        CompletableFuture<byte[]> future = pendingChunks.remove(requestId);
        if (future != null) {
            future.complete(data != null ? data : new byte[0]);
        }
    }

    public void failChunk(String requestId) {
        if (requestId == null) return;
        CompletableFuture<byte[]> future = pendingChunks.remove(requestId);
        if (future != null) {
            future.complete(new byte[0]);
        }
    }

    public void cleanPending() {
        for (CompletableFuture<byte[]> f : pendingChunks.values()) {
            try { f.complete(new byte[0]); } catch (Exception ignored) {}
        }
        pendingChunks.clear();
    }

    private void listenLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                workerPool.execute(() -> handleConnection(client));
            } catch (Exception e) {
                if (!running) break;
            }
        }
    }

    private void handleConnection(Socket socket) {
        try {
            socket.setSoTimeout(30000);
            socket.setTcpNoDelay(true);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            ByteArrayOutputStream headerBuf = new ByteArrayOutputStream();
            int b;
            int matches = 0;
            while ((b = in.read()) != -1) {
                headerBuf.write(b);
                if ((matches == 0 || matches == 2) && b == '\r') matches++;
                else if ((matches == 1 || matches == 3) && b == '\n') matches++;
                else matches = 0;
                if (matches == 4) break;
            }

            String headerStr = new String(headerBuf.toByteArray(), StandardCharsets.ISO_8859_1);
            String[] lines = headerStr.split("\r\n");
            if (lines.length == 0 || lines[0].isEmpty()) {
                socket.close();
                return;
            }

            String[] parts = lines[0].split(" ");
            if (parts.length < 2) {
                socket.close();
                return;
            }

            String method = parts[0];
            String uri = parts[1];

            if ("OPTIONS".equalsIgnoreCase(method)) {
                String resp = "HTTP/1.1 204 No Content\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                        "Access-Control-Allow-Headers: Content-Type, Range\r\n" +
                        "Access-Control-Max-Age: 600\r\n" +
                        "Content-Length: 0\r\nConnection: close\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            if ("POST".equalsIgnoreCase(method) && uri.startsWith("/chunk")) {
                int qIdx = uri.indexOf("requestId=");
                String reqId = qIdx != -1 ? uri.substring(qIdx + 10) : "";
                int ampIdx = reqId.indexOf('&');
                if (ampIdx != -1) reqId = reqId.substring(0, ampIdx);

                int contentLength = 0;
                for (String line : lines) {
                    if (line.toLowerCase().startsWith("content-length:")) {
                        try {
                            contentLength = Integer.parseInt(line.substring(15).trim());
                        } catch (NumberFormatException ignored) {}
                    }
                }

                ByteArrayOutputStream bodyBuf = new ByteArrayOutputStream();
                if (contentLength > 0) {
                    byte[] buf = new byte[16384];
                    int readTotal = 0;
                    while (readTotal < contentLength) {
                        int r = in.read(buf, 0, Math.min(buf.length, contentLength - readTotal));
                        if (r == -1) break;
                        bodyBuf.write(buf, 0, r);
                        readTotal += r;
                    }
                }

                putChunk(reqId, bodyBuf.toByteArray());
                String resp = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            if ("POST".equalsIgnoreCase(method) && uri.startsWith("/error")) {
                int qIdx = uri.indexOf("requestId=");
                String reqId = qIdx != -1 ? uri.substring(qIdx + 10) : "";
                int ampIdx = reqId.indexOf('&');
                if (ampIdx != -1) reqId = reqId.substring(0, ampIdx);
                failChunk(reqId);
                String resp = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            if (!uri.startsWith("/stream/")) {
                String resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            String pathAfter = uri.substring(8);
            int slashIdx = pathAfter.indexOf('/');
            String streamId = slashIdx != -1 ? pathAfter.substring(0, slashIdx) : pathAfter;

            StreamMeta meta = streams.get(streamId);
            if (meta == null) {
                String resp = "HTTP/1.1 404 Stream Not Found\r\nContent-Length: 0\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            long totalSize = meta.size;
            long start = 0;
            long end = totalSize > 0 ? totalSize - 1 : Long.MAX_VALUE;
            boolean hasRange = false;

            for (String line : lines) {
                if (line.toLowerCase().startsWith("range:")) {
                    hasRange = true;
                    String rVal = line.substring(6).trim();
                    if (rVal.startsWith("bytes=")) {
                        rVal = rVal.substring(6).trim();
                        String[] rParts = rVal.split("-");
                        if (rParts.length > 0 && !rParts[0].isEmpty()) {
                            try {
                                start = Long.parseLong(rParts[0]);
                            } catch (NumberFormatException ignored) {}
                        }
                        if (rParts.length > 1 && !rParts[1].isEmpty()) {
                            try {
                                end = Long.parseLong(rParts[1]);
                            } catch (NumberFormatException ignored) {}
                        }
                    }
                }
            }

            if (totalSize > 0 && start >= totalSize) {
                String resp = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + totalSize + "\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            // Bloques optimizados para ExoPlayer: 2MB máx por petición de fragmento
            long blockSize = 2L * 1024L * 1024L;
            if (end - start + 1 > blockSize) {
                end = totalSize > 0 ? Math.min(totalSize - 1, start + blockSize - 1) : start + blockSize - 1;
            }

            String reqId = UUID.randomUUID().toString();
            CompletableFuture<byte[]> chunkFuture = new CompletableFuture<>();
            pendingChunks.put(reqId, chunkFuture);

            if (listener != null) {
                listener.onNeedRange(streamId, start, end, reqId);
            }

            byte[] chunkData;
            try {
                // Timeout de seguridad de 20s para descargar el chunk
                chunkData = chunkFuture.get(20, TimeUnit.SECONDS);
            } catch (Exception e) {
                pendingChunks.remove(reqId);
                String resp = "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\n\r\n";
                out.write(resp.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                socket.close();
                return;
            }

            if (chunkData == null) chunkData = new byte[0];

            StringBuilder sb = new StringBuilder();
            if (hasRange) {
                sb.append("HTTP/1.1 206 Partial Content\r\n");
                sb.append("Content-Range: bytes ").append(start).append("-").append(start + chunkData.length - 1);
                if (totalSize > 0) sb.append("/").append(totalSize);
                else sb.append("/*");
                sb.append("\r\n");
            } else {
                sb.append("HTTP/1.1 200 OK\r\n");
            }
            sb.append("Content-Type: ").append(meta.mime).append("\r\n");
            sb.append("Content-Length: ").append(chunkData.length).append("\r\n");
            sb.append("Accept-Ranges: bytes\r\n");
            sb.append("Access-Control-Allow-Origin: *\r\n");
            sb.append("Connection: close\r\n\r\n");

            out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (chunkData.length > 0) {
                out.write(chunkData);
            }
            out.flush();
            socket.close();
        } catch (Exception ignored) {
            try { socket.close(); } catch (Exception ignored2) {}
        }
    }
}
