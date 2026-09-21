#!/usr/bin/env python3
import http.server
import json
import os

PORT = 5050
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROGRESS_FILE = os.path.join(BASE_DIR, "user_progress.json")

class PDDHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        clean_path = self.path.split('?')[0]
        if clean_path == '/api/progress':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            if os.path.exists(PROGRESS_FILE):
                with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(b'{"answersLog": {}, "favorites": []}')
            return

        super().do_GET()

    def do_POST(self):
        clean_path = self.path.split('?')[0]
        if clean_path == '/api/progress':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                
                resp_data = b'{"status": "ok", "saved": true}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_data)
            except Exception as e:
                err_data = json.dumps({"error": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(err_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(err_data)
            return

        self.send_response(404)
        self.end_headers()

def run_server():
    server_address = ('', PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, PDDHandler)
    print(f"==================================================")
    print(f" PDD Smart Trainer Server running on:")
    print(f" http://localhost:{PORT}")
    print(f"==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")

if __name__ == "__main__":
    run_server()
