package com.agentdock.a11y;

import android.content.Context;
import android.os.Build;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class CommandDispatcher {
    private final Context context;
    private final IntentEngine intentEngine;

    public CommandDispatcher(Context context) {
        this.context = context;
        this.intentEngine = new IntentEngine(context);
    }

    public JSONObject dispatch(JSONObject request) throws Exception {
        String capability = request.optString("capability", "");
        JSONObject args = request.optJSONObject("args");
        if (args == null) args = new JSONObject();

        if ("filesystem.read".equals(capability)) {
            return handleFileRead(args.optString("path"));
        } else if ("filesystem.list".equals(capability)) {
            return handleFileList(args.optString("path", "."));
        } else if ("filesystem.write".equals(capability)) {
            return handleFileWrite(args.optString("path"), args.optString("content"), args.optString("encoding"));
        } else if ("shell.exec".equals(capability)) {
            String command = extractShellCommand(args);
            return executeShell(command);
        }

        throw new Exception("Capability not supported: " + capability);
    }

    private String extractShellCommand(JSONObject args) {
        String program = args.optString("program", "");
        JSONArray argv = args.optJSONArray("arguments");
        if ("sh".equals(program) && argv != null) {
            for (int i = 0; i < argv.length(); i++) {
                if ("-c".equals(argv.optString(i)) && i + 1 < argv.length()) {
                    return argv.optString(i + 1);
                }
            }
        }
        if (args.has("command")) return args.optString("command");
        if (argv != null && argv.length() > 0) {
            StringBuilder sb = new StringBuilder();
            if (!program.isEmpty()) sb.append(program).append(" ");
            for (int i = 0; i < argv.length(); i++) {
                if (i > 0) sb.append(" ");
                sb.append(argv.optString(i));
            }
            return sb.toString();
        }
        return program;
    }

    private JSONObject executeShell(String fullCommand) {
        JSONObject res = new JSONObject();
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        int exitCode = 0;

        String[] subCmds = splitChainedCommands(fullCommand);
        for (String cmd : subCmds) {
            cmd = cmd.trim();
            if (cmd.isEmpty()) continue;

            ShellResult part = executeSingleCommand(cmd);
            if (part.stdout != null && !part.stdout.isEmpty()) {
                if (stdout.length() > 0 && !stdout.toString().endsWith("\n")) stdout.append("\n");
                stdout.append(part.stdout);
            }
            if (part.stderr != null && !part.stderr.isEmpty()) {
                if (stderr.length() > 0 && !stderr.toString().endsWith("\n")) stderr.append("\n");
                stderr.append(part.stderr);
            }
            if (part.exitCode != 0) {
                exitCode = part.exitCode;
                break;
            }
        }

        try {
            res.put("stdout", stdout.toString());
            res.put("stderr", stderr.toString());
            res.put("exitCode", exitCode);
        } catch (Exception ignored) {}
        return res;
    }

    private static class ShellResult {
        String stdout = "";
        String stderr = "";
        int exitCode = 0;
        ShellResult(String stdout, int exitCode) { this.stdout = stdout; this.exitCode = exitCode; }
        ShellResult(String stdout, String stderr, int exitCode) {
            this.stdout = stdout; this.stderr = stderr; this.exitCode = exitCode;
        }
    }

    private ShellResult executeSingleCommand(String cmd) {
        if (cmd.startsWith("mobile-ui")) {
            return handleMobileUiCommand(cmd.substring("mobile-ui".length()).trim());
        }
        if (cmd.startsWith("mobile-apps")) {
            return handleMobileAppsCommand(cmd.substring("mobile-apps".length()).trim());
        }
        if (cmd.startsWith("termux-")) {
            return handleTermuxCommand(cmd);
        }
        if (cmd.startsWith("sleep ")) {
            try {
                double sec = Double.parseDouble(cmd.substring(6).trim());
                Thread.sleep((long) (sec * 1000));
                return new ShellResult("", 0);
            } catch (Exception ignored) {}
        }
        if (cmd.startsWith("echo ")) {
            return new ShellResult(cmd.substring(5).trim(), 0);
        }

        // Fallback to Android system shell
        return executeSystemShell(cmd);
    }

    private ShellResult handleMobileUiCommand(String rest) {
        AgentDockAccessibilityService service = AgentDockAccessibilityService.instance;
        if (service == null) {
            return new ShellResult("", "Accessibility service is not running", 1);
        }

        String[] tokens = tokenize(rest);
        String sub = tokens.length > 0 ? tokens[0] : "help";

        if ("screen".equals(sub)) {
            String action = tokens.length > 1 && !tokens[1].startsWith("--") ? tokens[1] : "status";
            String owner = extractParam(tokens, rest, "--owner");
            String durationStr = extractParam(tokens, rest, "--duration");
            if (durationStr == null) durationStr = extractParam(tokens, rest, "--duration-seconds");
            int duration = 120;
            if (durationStr != null) {
                try { duration = Integer.parseInt(durationStr); } catch (Exception ignored) {}
            }

            JSONObject body = new JSONObject();
            try {
                String mappedAction = "keep-awake".equals(action) ? "acquire" : action;
                body.put("action", mappedAction);
                body.put("duration", duration);
                body.put("durationSeconds", duration);
                if (owner != null && !owner.isEmpty()) body.put("owner", owner);

                String resJson = service.handleRequest("POST", "/api/screen", "/api/screen", body.toString());
                JSONObject parsed = new JSONObject(resJson);
                parsed.put("cliProtocol", 2);
                boolean ok = parsed.optBoolean("ok", true);
                return new ShellResult(parsed.toString(), ok ? "" : parsed.optString("error", "Screen action failed"), ok ? 0 : 1);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("status".equals(sub)) {
            boolean json = rest.contains("--json");
            String raw = service.handleRequest("GET", "/api/status", "/api/status", "");
            try {
                JSONObject s = new JSONObject(raw);
                boolean ok = s.optBoolean("ok", true);
                if (!ok) return new ShellResult(raw, s.optString("error", "Status failed"), 1);
                if (json) return new ShellResult(raw, 0);

                String out = "Service enabled: " + s.optBoolean("serviceEnabled") + "\n" +
                    "Current package: " + s.optString("currentPackage", "none") + "\n" +
                    "Current activity: " + s.optString("currentActivity", "none") + "\n" +
                    "Screen: " + s.optInt("screenWidth") + "x" + s.optInt("screenHeight");
                return new ShellResult(out, 0);
            } catch (Exception e) {
                return new ShellResult(raw, 0);
            }
        }

        if ("dump".equals(sub)) {
            boolean interactiveOnly = !rest.contains("--interactive-only=false");
            boolean json = rest.contains("--json");
            String path = interactiveOnly ? "/api/dump?interactiveOnly=true" : "/api/dump?interactiveOnly=false";
            String raw = service.handleRequest("GET", "/api/dump", path, "");
            try {
                JSONObject root = new JSONObject(raw);
                boolean ok = root.optBoolean("ok", true);
                if (!ok) {
                    String err = root.optString("error", "Screen dump failed");
                    return new ShellResult(raw, err, 1);
                }
                if (json) return new ShellResult(raw, 0);
                return new ShellResult(formatDumpCompact(root), 0);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("click".equals(sub)) {
            if (tokens.length < 2) return new ShellResult("", "Usage: mobile-ui click <idx|\"text\"|x,y>", 1);
            String target = tokens[1];
            String idFlag = extractParam(tokens, rest, "--id");
            JSONObject body = new JSONObject();
            try {
                if (idFlag != null) {
                    body.put("id", idFlag);
                    if (!target.startsWith("--")) body.put("text", target);
                } else if (target.matches("^\\d+$")) {
                    body.put("index", Integer.parseInt(target));
                } else if (target.contains(",")) {
                    String[] parts = target.split(",");
                    JSONArray pt = new JSONArray();
                    pt.put(Integer.parseInt(parts[0].trim()));
                    pt.put(Integer.parseInt(parts[1].trim()));
                    body.put("point", pt);
                } else {
                    body.put("text", target);
                }
                String res = service.handleRequest("POST", "/api/click", "/api/click", body.toString());
                JSONObject resObj = new JSONObject(res);
                boolean ok = resObj.optBoolean("ok", true);
                return new ShellResult(res, ok ? "" : resObj.optString("error", "Click failed"), ok ? 0 : 1);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("input".equals(sub)) {
            if (tokens.length < 2) return new ShellResult("", "Usage: mobile-ui input <text>", 1);
            String text = tokens[1];
            String targetIdx = extractParam(tokens, rest, "--target");
            if (targetIdx == null) targetIdx = extractParam(tokens, rest, "--index");

            JSONObject body = new JSONObject();
            try {
                body.put("text", text);
                body.put("clear", !rest.contains("--no-clear"));
                if (targetIdx != null && targetIdx.matches("^\\d+$")) {
                    body.put("index", Integer.parseInt(targetIdx));
                }
                String res = service.handleRequest("POST", "/api/input", "/api/input", body.toString());
                JSONObject resObj = new JSONObject(res);
                boolean ok = resObj.optBoolean("ok", true);
                return new ShellResult(res, ok ? "" : resObj.optString("error", "Input failed"), ok ? 0 : 1);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("scroll".equals(sub)) {
            String dir = tokens.length > 1 && !tokens[1].startsWith("--") ? tokens[1] : "down";
            JSONObject body = new JSONObject();
            try {
                body.put("direction", dir);
                String res = service.handleRequest("POST", "/api/scroll", "/api/scroll", body.toString());
                JSONObject resObj = new JSONObject(res);
                boolean ok = resObj.optBoolean("ok", true);
                return new ShellResult(res, ok ? "" : resObj.optString("error", "Scroll failed"), ok ? 0 : 1);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("back".equals(sub) || "home".equals(sub)) {
            try {
                JSONObject body = new JSONObject();
                body.put("action", sub);
                String res = service.handleRequest("POST", "/api/action", "/api/action", body.toString());
                JSONObject resObj = new JSONObject(res);
                boolean ok = resObj.optBoolean("ok", true);
                return new ShellResult(res, ok ? "" : resObj.optString("error", "Action failed"), ok ? 0 : 1);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("wait".equals(sub)) {
            if (tokens.length < 2) return new ShellResult("", "Usage: mobile-ui wait <text>", 1);
            String waitText = tokens[1];
            long start = System.currentTimeMillis();
            while (System.currentTimeMillis() - start < 5000) {
                String dump = service.handleRequest("GET", "/api/dump", "/api/dump?interactiveOnly=true", "");
                if (dump.contains(waitText)) {
                    return new ShellResult("Found element matching \"" + waitText + "\"", 0);
                }
                try { Thread.sleep(250); } catch (InterruptedException ignored) {}
            }
            return new ShellResult("", "Timed out waiting for \"" + waitText + "\"", 1);
        }

        return new ShellResult("Unknown mobile-ui command: " + sub, 1);
    }

    private ShellResult handleMobileAppsCommand(String rest) {
        String[] tokens = tokenize(rest);
        String sub = tokens.length > 0 ? tokens[0] : "list";

        if ("intent".equals(sub)) {
            if (tokens.length < 2) return new ShellResult("", "Usage: mobile-apps intent <uri>", 1);
            try {
                String msg = intentEngine.launchCustomUri(tokens[1]);
                return new ShellResult(msg, 0);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("open".equals(sub)) {
            if (tokens.length < 2) return new ShellResult("", "Usage: mobile-apps open <app> [action]", 1);
            String app = tokens[1];
            String action = tokens.length > 2 && !tokens[2].startsWith("--") ? tokens[2] : "open";
            Map<String, String> params = new HashMap<>();
            for (String token : tokens) {
                if (token.startsWith("--") && token.contains("=")) {
                    int eq = token.indexOf("=");
                    params.put(token.substring(2, eq), token.substring(eq + 1));
                }
            }
            try {
                String msg = intentEngine.openAppAction(app, action, params);
                return new ShellResult(msg, 0);
            } catch (Exception e) {
                return new ShellResult("", e.getMessage(), 1);
            }
        }

        if ("list".equals(sub)) {
            String list = "Supported mobile apps: alipay (open, pay, scan, ride, collect, transfer)\n" +
                "wechat (open, scan, pay)\n" +
                "amap (open, navigate, search)\n" +
                "meituan (open, search, takeout)\n" +
                "taobao (open, search, cart)\n" +
                "system (settings, wifi, bluetooth, display, battery, date)";
            return new ShellResult(list, 0);
        }

        return new ShellResult("Unknown mobile-apps command: " + sub, 1);
    }

    private ShellResult handleTermuxCommand(String cmd) {
        String[] tokens = tokenize(cmd);
        String tool = tokens[0];

        if ("termux-tts-speak".equals(tool)) {
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i < tokens.length; i++) {
                if (!tokens[i].startsWith("-")) {
                    if (sb.length() > 0) sb.append(" ");
                    sb.append(tokens[i]);
                }
            }
            SystemApiHandlers.ttsSpeak(context, sb.toString());
            return new ShellResult("", 0);
        }

        if ("termux-battery-status".equals(tool)) {
            JSONObject b = SystemApiHandlers.getBatteryStatus(context);
            return new ShellResult(b.toString(), 0);
        }

        if ("termux-clipboard-get".equals(tool)) {
            return new ShellResult(SystemApiHandlers.getClipboard(context), 0);
        }

        if ("termux-clipboard-set".equals(tool)) {
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i < tokens.length; i++) {
                if (sb.length() > 0) sb.append(" ");
                sb.append(tokens[i]);
            }
            SystemApiHandlers.setClipboard(context, sb.toString());
            return new ShellResult("", 0);
        }

        if ("termux-vibrate".equals(tool)) {
            SystemApiHandlers.vibrate(context, 200);
            return new ShellResult("", 0);
        }

        if ("termux-torch".equals(tool)) {
            boolean on = tokens.length > 1 && "on".equalsIgnoreCase(tokens[1]);
            SystemApiHandlers.setTorch(context, on);
            return new ShellResult("", 0);
        }

        if ("termux-toast".equals(tool)) {
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i < tokens.length; i++) {
                if (sb.length() > 0) sb.append(" ");
                sb.append(tokens[i]);
            }
            SystemApiHandlers.showToast(context, sb.toString());
            return new ShellResult("", 0);
        }

        if ("termux-volume".equals(tool)) {
            String stream = tokens.length > 1 ? tokens[1] : "music";
            Integer level = tokens.length > 2 && tokens[2].matches("^\\d+$") ? Integer.parseInt(tokens[2]) : null;
            JSONObject v = SystemApiHandlers.handleVolume(context, stream, level);
            return new ShellResult(v.toString(), 0);
        }

        if ("termux-location".equals(tool)) {
            JSONObject loc = SystemApiHandlers.getLocation(context);
            return new ShellResult(loc.toString(), 0);
        }

        return executeSystemShell(cmd);
    }

    private ShellResult executeSystemShell(String cmd) {
        Process process = null;
        try {
            process = new ProcessBuilder("/system/bin/sh", "-c", cmd).start();
            ByteArrayOutputStream outBaos = new ByteArrayOutputStream();
            ByteArrayOutputStream errBaos = new ByteArrayOutputStream();

            final Process procRef = process;
            Thread t1 = new Thread(() -> copyStream(procRef.getInputStream(), outBaos));
            Thread t2 = new Thread(() -> copyStream(procRef.getErrorStream(), errBaos));
            t1.start();
            t2.start();

            boolean finished = process.waitFor(15, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                process.destroy();
                return new ShellResult("", "Command timed out", 124);
            }
            t1.join(500);
            t2.join(500);
            return new ShellResult(outBaos.toString("UTF-8").trim(), errBaos.toString("UTF-8").trim(), process.exitValue());
        } catch (Exception e) {
            return new ShellResult("", e.getMessage(), 1);
        } finally {
            if (process != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        if (process.isAlive()) process.destroyForcibly();
                    } else {
                        process.destroy();
                    }
                } catch (Throwable ignored) {}
            }
        }
    }

    private static void copyStream(InputStream in, ByteArrayOutputStream out) {
        try {
            byte[] buf = new byte[1024];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        } catch (Exception ignored) {}
    }

    private String formatDumpCompact(JSONObject root) {
        JSONArray elements = root.optJSONArray("elements");
        if (elements == null || elements.length() == 0) return "No visible interactive elements found.";
        StringBuilder sb = new StringBuilder();
        sb.append("Current: ").append(root.optString("package")).append("/").append(root.optString("activity")).append("\n");
        for (int i = 0; i < elements.length(); i++) {
            JSONObject el = elements.optJSONObject(i);
            if (el == null) continue;
            sb.append("[").append(el.optInt("index", i + 1)).append("] ");
            String text = el.optString("text", "");
            if (!text.isEmpty()) sb.append("text=\"").append(text.replace("\n", " ")).append("\" ");
            String id = el.optString("id", "");
            if (!id.isEmpty()) sb.append("id=\"").append(id).append("\" ");
            if (el.optBoolean("clickable")) sb.append("clickable ");
            if (el.optBoolean("editable")) sb.append("editable ");
            sb.append("\n");
        }
        return sb.toString().trim();
    }

    private String[] splitChainedCommands(String full) {
        List<String> list = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuote = false;
        char quoteChar = ' ';
        int len = full.length();

        for (int i = 0; i < len; i++) {
            char c = full.charAt(i);
            if (inQuote) {
                if (c == quoteChar) inQuote = false;
                cur.append(c);
            } else if (c == '"' || c == '\'') {
                inQuote = true;
                quoteChar = c;
                cur.append(c);
            } else if (c == ';') {
                if (cur.length() > 0) {
                    list.add(cur.toString().trim());
                    cur.setLength(0);
                }
            } else if (c == '&' && i + 1 < len && full.charAt(i + 1) == '&') {
                if (cur.length() > 0) {
                    list.add(cur.toString().trim());
                    cur.setLength(0);
                }
                i++; // skip second &
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0 && !cur.toString().trim().isEmpty()) {
            list.add(cur.toString().trim());
        }
        return list.toArray(new String[0]);
    }

    private String[] tokenize(String s) {
        List<String> tokens = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuote = false;
        char quoteChar = ' ';
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (inQuote) {
                if (c == quoteChar) inQuote = false;
                else cur.append(c);
            } else if (c == '"' || c == '\'') {
                inQuote = true;
                quoteChar = c;
            } else if (Character.isWhitespace(c)) {
                if (cur.length() > 0) {
                    tokens.add(cur.toString());
                    cur.setLength(0);
                }
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0) tokens.add(cur.toString());
        return tokens.toArray(new String[0]);
    }

    private String extractParam(String[] tokens, String raw, String prefix) {
        for (int i = 0; i < tokens.length; i++) {
            String token = tokens[i];
            if (token.startsWith(prefix + "=")) {
                String val = token.substring((prefix + "=").length()).trim();
                return stripQuotes(val);
            }
            if (token.equals(prefix) && i + 1 < tokens.length && !tokens[i + 1].startsWith("--")) {
                return stripQuotes(tokens[i + 1].trim());
            }
        }
        return null;
    }

    private static String stripQuotes(String val) {
        if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
            return val.substring(1, val.length() - 1);
        }
        return val;
    }

    private boolean isPathWithinBase(File file, File baseDir) {
        String filePath = file.getPath();
        String basePath = baseDir.getPath();
        return filePath.equals(basePath) || filePath.startsWith(basePath + File.separator);
    }

    private JSONObject handleFileRead(String relativePath) throws Exception {
        File baseDir = context.getFilesDir().getCanonicalFile();
        File f = new File(baseDir, relativePath).getCanonicalFile();
        if (!isPathWithinBase(f, baseDir)) {
            throw new Exception("Path is outside approved directory: " + relativePath);
        }
        if (!f.exists()) throw new Exception("File not found: " + relativePath);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (InputStream is = new FileInputStream(f)) {
            byte[] buf = new byte[2048];
            int n;
            while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
        }
        byte[] bytes = baos.toByteArray();
        JSONObject res = new JSONObject();
        res.put("path", relativePath);
        res.put("encoding", "base64");
        res.put("content", Base64.encodeToString(bytes, Base64.NO_WRAP));
        res.put("bytes", bytes.length);
        return res;
    }

    private JSONObject handleFileList(String relativePath) throws Exception {
        File baseDir = context.getFilesDir().getCanonicalFile();
        File dir = new File(baseDir, relativePath).getCanonicalFile();
        if (!isPathWithinBase(dir, baseDir)) {
            throw new Exception("Path is outside approved directory: " + relativePath);
        }
        if (!dir.exists() || !dir.isDirectory()) throw new Exception("Directory not found: " + relativePath);

        File[] files = dir.listFiles();
        JSONArray entries = new JSONArray();
        if (files != null) {
            for (File child : files) {
                JSONObject item = new JSONObject();
                item.put("name", child.getName());
                item.put("type", child.isDirectory() ? "directory" : "file");
                entries.put(item);
            }
        }
        JSONObject res = new JSONObject();
        res.put("path", relativePath);
        res.put("entries", entries);
        res.put("truncated", false);
        return res;
    }

    private JSONObject handleFileWrite(String relativePath, String content, String encoding) throws Exception {
        File baseDir = context.getFilesDir().getCanonicalFile();
        File f = new File(baseDir, relativePath).getCanonicalFile();
        if (!isPathWithinBase(f, baseDir)) {
            throw new Exception("Path is outside approved directory: " + relativePath);
        }
        File parent = f.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();

        byte[] bytes = "base64".equalsIgnoreCase(encoding) ? Base64.decode(content, Base64.DEFAULT) : content.getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(bytes);
        }
        JSONObject res = new JSONObject();
        res.put("path", relativePath);
        res.put("bytes", bytes.length);
        return res;
    }
}
