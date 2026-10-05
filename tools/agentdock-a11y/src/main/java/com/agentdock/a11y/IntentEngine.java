package com.agentdock.a11y;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class IntentEngine {
    private final Context context;

    public IntentEngine(Context context) {
        this.context = context;
    }

    public String launchCustomUri(String rawUri) throws Exception {
        String uri = rawUri.trim();
        if ((uri.startsWith("\"") && uri.endsWith("\"")) || (uri.startsWith("'") && uri.endsWith("'"))) {
            uri = uri.substring(1, uri.length() - 1);
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        return "Launched intent: " + uri;
    }

    public String openAppAction(String app, String action, Map<String, String> params) throws Exception {
        String targetApp = app.toLowerCase().trim();
        String targetAction = (action == null || action.isEmpty()) ? "open" : action.toLowerCase().trim();

        if ("system".equals(targetApp) || "settings".equals(targetApp)) {
            return openSystemSetting(targetAction);
        }

        String uri = resolveAppUri(targetApp, targetAction, params);
        if (uri != null) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return "Launched " + targetApp + " (" + targetAction + "): " + uri;
        }

        // Package launch fallback
        String pkg = resolvePackageName(targetApp);
        if (pkg != null) {
            PackageManager pm = context.getPackageManager();
            Intent launchIntent = pm.getLaunchIntentForPackage(pkg);
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launchIntent);
                return "Launched " + targetApp + " package: " + pkg;
            }
        }

        throw new Exception("Unknown app or action: " + targetApp + " / " + targetAction);
    }

    private String resolveAppUri(String app, String action, Map<String, String> params) throws Exception {
        String keyword = params.containsKey("keyword") ? params.get("keyword") : "";
        String dest = params.containsKey("destination") ? params.get("destination") : "";
        String encKeyword = URLEncoder.encode(keyword, StandardCharsets.UTF_8.name());
        String encDest = URLEncoder.encode(dest, StandardCharsets.UTF_8.name());

        if ("alipay".equals(app)) {
            if ("open".equals(action)) return "alipays://platformapi/startapp?appId=20000001";
            if ("pay".equals(action)) return "alipayqr://platformapi/startapp?saId=20000056";
            if ("scan".equals(action)) return "alipayqr://platformapi/startapp?saId=10000007";
            if ("ride".equals(action) || "bus".equals(action)) return "alipays://platformapi/startapp?appId=20000193";
            if ("collect".equals(action)) return "alipays://platformapi/startapp?appId=20000123";
            if ("transfer".equals(action)) return "alipays://platformapi/startapp?appId=20000116";
        } else if ("wechat".equals(app)) {
            if ("scan".equals(action)) return "weixin://dl/scan";
            if ("pay".equals(action)) return "weixin://dl/businessWebview/link/payment";
        } else if ("amap".equals(app)) {
            if ("open".equals(action)) return "androidamap://rootmap";
            if ("navigate".equals(action)) {
                return "androidamap://navi?sourceApplication=agentdock&poiname=" + encDest + "&lat=0&lon=0&dev=0&style=2";
            }
            if ("search".equals(action)) {
                return "androidamap://arroundpoi?sourceApplication=agentdock&keywords=" + encKeyword;
            }
        } else if ("meituan".equals(app)) {
            if ("open".equals(action)) return "imeituan://www.meituan.com";
            if ("search".equals(action)) return "imeituan://www.meituan.com/search?keyword=" + encKeyword;
            if ("takeout".equals(action)) return "imeituan://www.meituan.com/takeout";
        } else if ("taobao".equals(app)) {
            if ("open".equals(action)) return "taobao://home";
            if ("search".equals(action)) return "taobao://s.taobao.com/search?q=" + encKeyword;
            if ("cart".equals(action)) return "taobao://cart";
        }
        return null;
    }

    private String resolvePackageName(String app) {
        if ("alipay".equals(app)) return "com.eg.android.AlipayGphone";
        if ("wechat".equals(app)) return "com.tencent.mm";
        if ("amap".equals(app)) return "com.autonavi.minimap";
        if ("meituan".equals(app)) return "com.sankuai.meituan";
        if ("taobao".equals(app)) return "com.taobao.taobao";
        return null;
    }

    private String openSystemSetting(String action) throws Exception {
        String intentAction = Settings.ACTION_SETTINGS;
        if ("wifi".equals(action)) intentAction = Settings.ACTION_WIFI_SETTINGS;
        else if ("bluetooth".equals(action)) intentAction = Settings.ACTION_BLUETOOTH_SETTINGS;
        else if ("display".equals(action)) intentAction = Settings.ACTION_DISPLAY_SETTINGS;
        else if ("battery".equals(action)) intentAction = Intent.ACTION_POWER_USAGE_SUMMARY;
        else if ("date".equals(action)) intentAction = Settings.ACTION_DATE_SETTINGS;
        else if ("accessibility".equals(action)) intentAction = Settings.ACTION_ACCESSIBILITY_SETTINGS;

        Intent intent = new Intent(intentAction);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        return "Opened system settings: " + action;
    }
}
