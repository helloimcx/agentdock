import sqlite3, json, datetime, sys

DB = "/var/lib/agentdock/runtime/local-core.db"
db = sqlite3.connect(DB)

# 1) 从 workspace_registry 提取 projects（source=runtime-project）
projects = []
for (m,) in db.execute("SELECT metadata_json FROM workspace_registry"):
    meta = json.loads(m or "{}")
    p = meta.get("project") if meta.get("source") == "runtime-project" else None
    if not p or not p.get("name"):
        continue
    # 清理空凭据的 lark 平台（问题1的 "Lark 2"）
    platforms = []
    for pl in (p.get("platforms") or []):
        opts = pl.get("options") or {}
        if pl.get("type") == "lark" and not str(opts.get("app_id") or "").strip() and not str(opts.get("app_secret") or "").strip():
            print("  drop empty-cred lark platform: %s instance=%s" % (p["name"], opts.get("instance_id")))
            continue
        platforms.append(pl)
    p = {**p, "platforms": platforms}
    projects.append(p)

# 2) 合并进 runtime_config.config_json（保留已有顶层键）
row = db.execute("SELECT config_json FROM runtime_config WHERE id='desktop'").fetchone()
config = json.loads(row[0]) if row and row[0] else {}
config["config_version"] = 2
config["projects"] = projects
now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
db.execute("UPDATE runtime_config SET config_json=?, updated_at=? WHERE id='desktop'", (json.dumps(config, ensure_ascii=False), now))

# 3) 可选：删除指定失效线程（旧 agent runtime 绑定的 side-thread），
#    使其在下一次触发时按当前 agent 自动重建。用法：python3 migrate-agentdock-sqlite.py <thread_id>
import sys
STALE = sys.argv[1] if len(sys.argv) > 1 else None
if STALE:
    db.execute("DELETE FROM platform_thread_bindings WHERE thread_id=?", (STALE,))
    db.execute("UPDATE platform_users SET thread_id=NULL WHERE thread_id=?", (STALE,))
    db.execute("DELETE FROM threads WHERE id=?", (STALE,))
    print("  deleted stale thread: %s" % STALE)

db.commit()
print("migrated %d projects into runtime_config.config_json" % len(projects))
db.close()
