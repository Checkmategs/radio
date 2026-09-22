from pathlib import Path

path = Path("/home/nineone/sten-http80/default.conf")
text = path.read_text()

old_http = """server {
    listen 10.91.0.55:80 default_server;
    server_name 10.91.0.55;
    return 301 https://10.91.0.55$request_uri;
}"""

new_http = """server {
    listen 10.91.0.55:80 default_server;
    server_name 10.91.0.55;
    client_max_body_size 520M;

    location = /radio { return 301 /radio/; }

    location /radio/ {
        proxy_pass http://127.0.0.1:9191/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header Connection "";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
        client_body_timeout 3600s;
    }

    location / {
        return 301 https://10.91.0.55$request_uri;
    }
}"""

if old_http not in text:
    raise SystemExit("http server block not found")
text = text.replace(old_http, new_http, 1)

text = text.replace(
    '    <a href="/radio/">91RADIO</a>\n',
    '    <a href="http://10.91.0.55/radio/">91RADIO</a>\n',
)
text = text.replace("    location = /radio    { return 301 /radio/; }\n", "")

https_radio = """
    # 91RADIO — live stream on :9191, prefix stripped
    location /radio/ {
        proxy_pass http://127.0.0.1:9191/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
        client_body_timeout 3600s;
    }
"""
if https_radio not in text:
    raise SystemExit("https radio block not found")
text = text.replace(https_radio, "\n")
path.write_text(text)
print("patched")
