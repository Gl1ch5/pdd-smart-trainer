#!/usr/bin/env python3
"""
PDD Smart Trainer backend: static files + per-user progress API (SQLite, stdlib only).

Login-only accounts: POST /api/login {"login": "..."} creates the user on first use
and returns a session token. Every answer attempt is stored, so mistakes are kept
even after they are corrected.

API (all JSON, token in "Authorization: Bearer <token>"):
  POST /api/login               {login}               -> {token, login}
  GET  /api/progress                                  -> {login, questions, favorites}
  POST /api/events              {events: [...]}       -> {ok, progress}
       event: {type: "answer", qid, sel, ok, ts}
              {type: "fav", qid, on, ts}
              {type: "reset"}
  GET  /api/global-stats                              -> {qid: [attempts, wrong]}

Env: PDD_PORT (5050), PDD_HOST (127.0.0.1 for production, 0.0.0.0 locally), PDD_DB.
"""
import http.server
import json
import os
import re
import secrets
import sqlite3
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PDD_PORT", "5050"))
HOST = os.environ.get("PDD_HOST", "0.0.0.0")
DB_PATH = os.environ.get("PDD_DB", os.path.join(BASE_DIR, "pdd_users.db"))

LOGIN_RE = re.compile(r"^[\w.\-]{2,32}$", re.UNICODE)
QID_RE = re.compile(r"^t\d{1,2}_q\d{1,2}$")
MAX_BODY = 2 * 1024 * 1024
MAX_EVENTS = 5000

_local = threading.local()
_global_cache = {"ts": 0, "data": None}


def db():
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def init_db():
    conn = db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            login TEXT UNIQUE NOT NULL COLLATE NOCASE,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attempts (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            qid TEXT NOT NULL,
            selected INTEGER NOT NULL,
            is_correct INTEGER NOT NULL,
            ts INTEGER NOT NULL,
            UNIQUE (user_id, qid, ts)
        );
        CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, qid);
        CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            qid TEXT NOT NULL,
            ts INTEGER NOT NULL,
            PRIMARY KEY (user_id, qid)
        );
    """)
    conn.commit()


def now_ms():
    return int(time.time() * 1000)


def user_by_token(token):
    if not token:
        return None
    row = db().execute(
        "SELECT u.id, u.login FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
        (token,),
    ).fetchone()
    return {"id": row[0], "login": row[1]} if row else None


def login(name):
    conn = db()
    conn.execute("INSERT OR IGNORE INTO users (login, created_at) VALUES (?, ?)", (name, now_ms()))
    uid, real = conn.execute("SELECT id, login FROM users WHERE login = ?", (name,)).fetchone()
    token = secrets.token_urlsafe(24)
    conn.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, uid, now_ms()))
    conn.commit()
    return {"token": token, "login": real}


def progress(user):
    conn = db()
    questions = {}
    rows = conn.execute(
        "SELECT qid, selected, is_correct, ts FROM attempts WHERE user_id = ? ORDER BY ts",
        (user["id"],),
    )
    for qid, sel, ok, ts in rows:
        q = questions.setdefault(qid, {"attempts": 0, "wrong": 0, "correct": 0})
        q["attempts"] += 1
        q["wrong" if not ok else "correct"] += 1
        q["sel"] = sel
        q["ok"] = bool(ok)
        q["ts"] = ts
    favs = [r[0] for r in conn.execute(
        "SELECT qid FROM favorites WHERE user_id = ? ORDER BY ts", (user["id"],))]
    return {"login": user["login"], "questions": questions, "favorites": favs}


def apply_events(user, events):
    conn = db()
    uid = user["id"]
    for ev in events[:MAX_EVENTS]:
        if not isinstance(ev, dict):
            continue
        kind = ev.get("type")
        if kind == "reset":
            conn.execute("DELETE FROM attempts WHERE user_id = ?", (uid,))
            continue
        qid = ev.get("qid")
        if not isinstance(qid, str) or not QID_RE.match(qid):
            continue
        ts = ev.get("ts")
        ts = int(ts) if isinstance(ts, (int, float)) and ts > 0 else now_ms()
        if kind == "answer":
            sel = ev.get("sel")
            if not isinstance(sel, int) or not 0 <= sel < 10:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO attempts (user_id, qid, selected, is_correct, ts) VALUES (?, ?, ?, ?, ?)",
                (uid, qid, sel, 1 if ev.get("ok") else 0, ts),
            )
        elif kind == "fav":
            if ev.get("on"):
                conn.execute("INSERT OR REPLACE INTO favorites (user_id, qid, ts) VALUES (?, ?, ?)", (uid, qid, ts))
            else:
                conn.execute("DELETE FROM favorites WHERE user_id = ? AND qid = ?", (uid, qid))
    conn.commit()


def global_stats():
    # Cheap aggregate, cached for a minute
    if _global_cache["data"] is not None and time.time() - _global_cache["ts"] < 60:
        return _global_cache["data"]
    data = {}
    for qid, n, wrong in db().execute(
            "SELECT qid, COUNT(*), SUM(1 - is_correct) FROM attempts GROUP BY qid"):
        data[qid] = [n, wrong]
    _global_cache.update(ts=time.time(), data=data)
    return data


class PDDHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def end_headers(self):
        # Allow the static frontend to be hosted elsewhere (e.g. GitHub Pages)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def auth_user(self):
        header = self.headers.get("Authorization", "")
        token = header[7:].strip() if header.startswith("Bearer ") else ""
        return user_by_token(token)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/progress":
            user = self.auth_user()
            if not user:
                return self.send_json({"error": "unauthorized"}, 401)
            return self.send_json(progress(user))
        if path == "/api/global-stats":
            return self.send_json(global_stats())
        if path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        # Never expose server-side files
        if path.endswith((".db", ".db-wal", ".db-shm", ".py")) or "/." in path:
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        data = self.read_json()
        if path == "/api/login":
            name = (data or {}).get("login") if isinstance(data, dict) else None
            # Case-insensitive logins (SQLite NOCASE only folds ASCII)
            name = name.strip().lower() if isinstance(name, str) else ""
            if not LOGIN_RE.match(name):
                return self.send_json({"error": "Логин: 2–32 символа, буквы, цифры, . _ -"}, 400)
            return self.send_json(login(name))
        if path == "/api/events":
            user = self.auth_user()
            if not user:
                return self.send_json({"error": "unauthorized"}, 401)
            events = data.get("events") if isinstance(data, dict) else None
            if not isinstance(events, list):
                return self.send_json({"error": "bad request"}, 400)
            apply_events(user, events)
            return self.send_json({"ok": True, "progress": progress(user)})
        self.send_json({"error": "not found"}, 404)


def run_server():
    init_db()
    httpd = http.server.ThreadingHTTPServer((HOST, PORT), PDDHandler)
    print("==================================================")
    print(" PDD Smart Trainer Server running on:")
    print(f" http://localhost:{PORT}")
    print("==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")


if __name__ == "__main__":
    run_server()
