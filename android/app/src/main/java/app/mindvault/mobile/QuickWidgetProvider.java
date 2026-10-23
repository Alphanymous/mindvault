package app.mindvault.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * Home-screen widget with one-tap shortcuts: capture, voice note, search, prompts.
 * Each button re-opens the app with ACTION_QUICK; ShareReceiverPlugin hands the mode to the web app.
 */
public class QuickWidgetProvider extends AppWidgetProvider {

    private static PendingIntent action(Context context, int requestCode, String mode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ShareReceiverPlugin.ACTION_QUICK);
        intent.putExtra("mode", mode);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick);
            views.setOnClickPendingIntent(R.id.widget_capture, action(context, 1, "capture"));
            views.setOnClickPendingIntent(R.id.widget_voice, action(context, 2, "dictate"));
            views.setOnClickPendingIntent(R.id.widget_search, action(context, 3, "search"));
            views.setOnClickPendingIntent(R.id.widget_prompts, action(context, 4, "prompts"));
            manager.updateAppWidget(id, views);
        }
    }
}
