package com.agentdock.a11y;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity implements MeshClient.StatusListener {
    private TextView a11yStatusText;
    private TextView meshStatusText;
    private EditText serverInput;
    private EditText tokenInput;
    private Button btnPair;
    private MeshPreferences preferences;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = new MeshPreferences(this);

        ScrollView scrollView = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 50, 40, 50);

        TextView title = new TextView(this);
        title.setText("AgentDock 移动端 Mesh 节点");
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 0, 0, 20);
        layout.addView(title);

        a11yStatusText = new TextView(this);
        a11yStatusText.setTextSize(14);
        a11yStatusText.setPadding(0, 0, 0, 15);
        layout.addView(a11yStatusText);

        meshStatusText = new TextView(this);
        meshStatusText.setTextSize(14);
        meshStatusText.setPadding(0, 0, 0, 30);
        layout.addView(meshStatusText);

        TextView serverLabel = new TextView(this);
        serverLabel.setText("AgentDock 服务端地址 (HTTP/HTTPS):");
        serverLabel.setTextSize(14);
        layout.addView(serverLabel);

        serverInput = new EditText(this);
        serverInput.setHint("例如: https://your-server.com 或 http://192.168.1.x:9831");
        serverInput.setText(preferences.getServerUrl());
        serverInput.setTextSize(14);
        layout.addView(serverInput);

        TextView tokenLabel = new TextView(this);
        tokenLabel.setText("配对令牌 (Pairing Token):");
        tokenLabel.setTextSize(14);
        tokenLabel.setPadding(0, 15, 0, 0);
        layout.addView(tokenLabel);

        tokenInput = new EditText(this);
        tokenInput.setHint("从控制台或配对文件获取的 10 分钟单次令牌");
        tokenInput.setTextSize(14);
        layout.addView(tokenInput);

        btnPair = new Button(this);
        btnPair.setText("配对并连接 Mesh 网关");
        btnPair.setTextSize(15);
        btnPair.setOnClickListener(v -> handlePairAndConnect());
        layout.addView(btnPair);

        Button btnDisconnect = new Button(this);
        btnDisconnect.setText("断开连接并清除配置");
        btnDisconnect.setTextSize(14);
        btnDisconnect.setOnClickListener(v -> {
            MeshClient.getInstance(this).stop();
            preferences.clear();
            serverInput.setText("");
            tokenInput.setText("");
            updateMeshUi("DISCONNECTED", "已清除配置");
            Toast.makeText(this, "已清除配对信息", Toast.LENGTH_SHORT).show();
        });
        layout.addView(btnDisconnect);

        View divider = new View(this);
        divider.setBackgroundColor(0xFFE0E0E0);
        LinearLayout.LayoutParams divParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 2);
        divParams.setMargins(0, 30, 0, 30);
        layout.addView(divider, divParams);

        TextView permTitle = new TextView(this);
        permTitle.setText("系统权限与保活配置:");
        permTitle.setTextSize(15);
        permTitle.setPadding(0, 0, 0, 15);
        layout.addView(permTitle);

        Button btnSettings = new Button(this);
        btnSettings.setText("1. 开启「无障碍服务」权限");
        btnSettings.setOnClickListener(v -> {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            startActivity(intent);
        });
        layout.addView(btnSettings);

        Button btnBattery = new Button(this);
        btnBattery.setText("2. 设置「自启动与省电无限制」");
        btnBattery.setOnClickListener(v -> {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        });
        layout.addView(btnBattery);

        Button release = new Button(this);
        release.setText("释放当前亮屏保护");
        release.setOnClickListener(v -> {
            AgentDockAccessibilityService service = AgentDockAccessibilityService.instance;
            if (service != null) {
                service.releaseScreen();
                Toast.makeText(this, "亮屏保护已释放", Toast.LENGTH_SHORT).show();
            }
        });
        layout.addView(release);

        TextView tip = new TextView(this);
        tip.setText("\n特性说明:\n• 全新架构：零本地监听端口，采用安全出站长连接 (Outbound Only)\n• 单 APK 即可支撑大模型屏幕操作 (mobile-ui)、App 直达 (mobile-apps) 与系统能力 (termux-api)\n• 息屏或重启后，随无障碍服务与前台服务自动保活重连");
        tip.setTextSize(13);
        tip.setTextColor(0xFF666666);
        tip.setPadding(0, 20, 0, 0);
        layout.addView(tip);

        scrollView.addView(layout);
        setContentView(scrollView);

        MeshClient.getInstance(this).setStatusListener(this);
        processIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        processIntent(intent);
    }

    private void processIntent(Intent intent) {
        if (intent == null) return;
        String intentServer = intent.getStringExtra("server");
        if (intentServer != null && !intentServer.trim().isEmpty()) {
            serverInput.setText(intentServer.trim());
        }
        String intentToken = intent.getStringExtra("pairingToken");
        if (intentToken != null && !intentToken.trim().isEmpty()) {
            tokenInput.setText(intentToken.trim());
        }
        if (intent.getBooleanExtra("autoConnect", false)) {
            mainHandler.post(this::handlePairAndConnect);
        }
    }

    private void handlePairAndConnect() {
        String server = serverInput.getText().toString().trim();
        String pairingToken = tokenInput.getText().toString().trim();

        if (server.isEmpty()) {
            Toast.makeText(this, "请输入服务端地址", Toast.LENGTH_SHORT).show();
            return;
        }

        if (preferences.isConfigured() && pairingToken.isEmpty() && server.equals(preferences.getServerUrl())) {
            // Already enrolled, just reconnect
            MeshClient.getInstance(this).start();
            Toast.makeText(this, "正在重连已配置的 Mesh 节点...", Toast.LENGTH_SHORT).show();
            return;
        }

        if (pairingToken.isEmpty()) {
            Toast.makeText(this, "请输入配对令牌进行首次配对", Toast.LENGTH_SHORT).show();
            return;
        }

        btnPair.setEnabled(false);
        btnPair.setText("正在配对...");

        new Thread(() -> {
            try {
                Log.i("AgentDockMain", "Initiating mesh enrollment: server=" + server + ", token=" + pairingToken);
                JSONObject data = MeshClient.enroll(server, pairingToken);
                String nodeId = data.getString("nodeId");
                String token = data.getString("token");
                Log.i("AgentDockMain", "Mesh enrollment success: nodeId=" + nodeId);
                preferences.saveCredentials(server, nodeId, token);

                mainHandler.post(() -> {
                    btnPair.setEnabled(true);
                    btnPair.setText("配对并连接 Mesh 网关");
                    tokenInput.setText("");
                    Toast.makeText(this, "配对成功! 节点 ID: " + nodeId, Toast.LENGTH_LONG).show();
                    MeshClient client = MeshClient.getInstance(this);
                    client.stop();
                    client.start();
                });
            } catch (Exception e) {
                Log.e("AgentDockMain", "Mesh enrollment error: " + e.getMessage(), e);
                mainHandler.post(() -> {
                    btnPair.setEnabled(true);
                    btnPair.setText("配对并连接 Mesh 网关");
                    Toast.makeText(this, "配对失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    @Override
    public void onStatusChanged(String status, String details) {
        mainHandler.post(() -> updateMeshUi(status, details));
    }

    private void updateMeshUi(String status, String details) {
        if ("CONNECTED".equals(status)) {
            meshStatusText.setText("🟢 Mesh 状态: 已连接 (" + details + ")");
            meshStatusText.setTextColor(0xFF2E7D32);
        } else if ("CONNECTING".equals(status) || "RECONNECTING".equals(status)) {
            meshStatusText.setText("🟡 Mesh 状态: 正在连接... (" + details + ")");
            meshStatusText.setTextColor(0xFFF57F17);
        } else if ("NOT_CONFIGURED".equals(status)) {
            meshStatusText.setText("⚪ Mesh 状态: 未配置 (请输入服务端地址与配对码)");
            meshStatusText.setTextColor(0xFF757575);
        } else {
            meshStatusText.setText("🔴 Mesh 状态: 未连接 (" + details + ")");
            meshStatusText.setTextColor(0xFFC62828);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (AgentDockAccessibilityService.instance != null) {
            String holdStatus = "亮屏保护未启用";
            try {
                JSONObject screen = new JSONObject(AgentDockAccessibilityService.instance.screenStatus());
                if (screen.optBoolean("keepAwake")) {
                    holdStatus = "亮屏保护已启用 (剩余 " + (screen.optLong("remainingMs") / 1000) + "s)";
                }
            } catch (Exception ignored) {}
            a11yStatusText.setText("🟢 无障碍服务: 正在运行\n   " + holdStatus);
            a11yStatusText.setTextColor(0xFF2E7D32);
        } else {
            a11yStatusText.setText("🔴 无障碍服务: 未开启 (请点击下方按钮 1 开启)");
            a11yStatusText.setTextColor(0xFFC62828);
        }

        updateMeshUi(MeshClient.getInstance(this).getStatus(), preferences.getNodeId());
    }

    @Override
    protected void onDestroy() {
        MeshClient.getInstance(this).setStatusListener(null);
        super.onDestroy();
    }
}
