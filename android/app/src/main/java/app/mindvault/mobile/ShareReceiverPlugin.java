package app.mindvault.mobile;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.IntentCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Receives "Share to Mindvault" intents (text, links, PDFs, files) and hands them to the web app.
 * The web side calls getPending() at start-up and again whenever "shareReceived" fires.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    /** Sent by the home-screen widget and launcher shortcuts; extra "mode" says what to open. */
    public static final String ACTION_QUICK = "app.mindvault.mobile.QUICK";

    private static final long MAX_FILE_BYTES = 40L * 1024L * 1024L;

    private final List<Intent> pending = new ArrayList<>();

    @Override
    public void load() {
        remember(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (remember(intent)) {
            notifyListeners("shareReceived", new JSObject());
        }
    }

    private boolean remember(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action) && !ACTION_QUICK.equals(action)) return false;
        synchronized (pending) {
            // Copy: the activity's own intent must not be consumed twice.
            pending.add(new Intent(intent));
        }
        return true;
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        List<Intent> batch;
        synchronized (pending) {
            batch = new ArrayList<>(pending);
            pending.clear();
        }
        JSArray items = new JSArray();
        for (Intent intent : batch) {
            try {
                items.put(describe(intent));
            } catch (Exception ignored) {
                // An unreadable share is skipped; the rest still import.
            }
        }
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    private JSObject describe(Intent intent) throws Exception {
        JSObject out = new JSObject();
        if (ACTION_QUICK.equals(intent.getAction())) {
            String mode = intent.getStringExtra("mode");
            out.put("shortcut", mode != null ? mode : "capture");
            return out;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null) out.put("text", text);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (subject != null) out.put("subject", subject);

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri single = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (single != null) uris.add(single);
        } else {
            ArrayList<Uri> many = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (many != null) uris.addAll(many);
        }

        JSArray files = new JSArray();
        for (Uri uri : uris) {
            JSObject file = readFile(uri);
            if (file != null) files.put(file);
        }
        out.put("files", files);
        return out;
    }

    private JSObject readFile(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String name = "shared-file";
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) name = cursor.getString(index);
            }
        }
        String mime = resolver.getType(uri);
        if (mime == null) mime = "application/octet-stream";

        JSObject file = new JSObject();
        file.put("name", name);
        file.put("mime", mime);

        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_FILE_BYTES) {
                    file.put("tooLarge", true);
                    return file;
                }
                out.write(buffer, 0, read);
            }
            file.put("b64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        }
        return file;
    }
}
