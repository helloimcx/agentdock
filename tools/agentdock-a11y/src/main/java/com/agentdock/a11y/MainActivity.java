package com.agentdock.a11y;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private TextView statusText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(60, 80, 60, 60);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = new TextView(this);
        title.setText("AgentDock 无障碍服务");
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 0, 0, 30);
        layout.addView(title);

        statusText = new TextView(this);
        statusText.setTextSize(16);
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(0, 0, 0, 50);
        layout.addView(statusText);

        Button btnSettings = new Button(this);
        btnSettings.setText("1. 前往开启「无障碍服务」");
        btnSettings.setTextSize(16);
        btnSettings.setPadding(40, 25, 40, 25);
        btnSettings.setOnClickListener(v -> {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            startActivity(intent);
        });
        layout.addView(btnSettings);

        Button btnBattery = new Button(this);
        btnBattery.setText("2. 设置「自启动与省电无限制」");
        btnBattery.setTextSize(16);
        btnBattery.setPadding(40, 25, 40, 25);
        btnBattery.setOnClickListener(v -> {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        });
        layout.addView(btnBattery);

        TextView tip = new TextView(this);
        tip.setText("\n说明:\n1. 点击按钮 1，在系统设置中找到「已下载的应用/服务」->「AgentDock 无障碍桥接服务」并开启\n2. 点击按钮 2，开启「自启动」并将「省电策略」设为「无限制」，避免息屏被冻结\n3. 服务启动后将自动监听 127.0.0.1:19832 端口供 mobile-ui 调用");
        tip.setTextSize(14);
        tip.setPadding(0, 30, 0, 0);
        layout.addView(tip);

        setContentView(layout);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (AgentDockAccessibilityService.instance != null) {
            statusText.setText("🟢 状态: 无障碍桥接服务正在运行\n端口: 127.0.0.1:19832 就绪");
            statusText.setTextColor(0xFF2E7D32);
        } else {
            statusText.setText("🔴 状态: 无障碍服务未开启\n请点击下方按钮开启权限");
            statusText.setTextColor(0xFFC62828);
        }
    }
}
