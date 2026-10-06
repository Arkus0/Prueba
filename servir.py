#!/usr/bin/env python3
"""Sirve la app OCR → IA en el navegador (incluido el móvil por WiFi).

Uso:
  python servir.py            # HTTP en el puerto 8000 (PC / localhost)
  python servir.py --https    # HTTPS en 8443 con cert autofirmado (móvil por WiFi)

El navegador exige un origen seguro (HTTPS o localhost) para permitir el acceso a
la cámara; por eso el móvil necesita la variante --https (o el flag de Chrome
documentado en el README).
"""

import argparse
import http.server
import os
import socket
import socketserver
import ssl
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.discard("127.0.0.1")
    return sorted(ips) or ["(IP no detectada: usa ipconfig)"]


def make_cert(cert_path, key_path):
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", key_path, "-out", cert_path, "-days", "825",
            "-subj", "/CN=ocr-qa-local",
        ],
        check=True,
    )


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("· %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--https", action="store_true", help="servir por HTTPS (cámara en el móvil)")
    ap.add_argument("--port", type=int, default=None, help="puerto (por defecto 8000 http / 8443 https)")
    args = ap.parse_args()
    port = args.port or (8443 if args.https else 8000)

    os.chdir(ROOT)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("0.0.0.0", port), Handler)

    scheme = "http"
    if args.https:
        scheme = "https"
        cert_dir = os.path.join(ROOT, ".certs")
        cert = os.path.join(cert_dir, "cert.pem")
        key = os.path.join(cert_dir, "key.pem")
        os.makedirs(cert_dir, exist_ok=True)
        if not (os.path.exists(cert) and os.path.exists(key)):
            print("Generando certificado autofirmado…")
            try:
                make_cert(cert, key)
            except Exception as e:
                print(f"No se pudo generar el certificado ({e}).")
                print("Alternativa con HTTP: en Chrome del móvil activa el flag")
                print("  chrome://flags/#unsafely-treat-insecure-origin-as-secure")
                print(f"con el valor  http://<IP-DEL-PC>:8000  y reinicia el navegador.")
                sys.exit(1)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print(f"Sirviendo {ROOT}")
    for ip in local_ips():
        print(f"  Móvil (misma WiFi):   {scheme}://{ip}:{port}")
    print(f"  Este PC:              {scheme}://localhost:{port}")
    if args.https:
        print('\nEl certificado es autofirmado: el móvil mostrará un aviso → "Configuración avanzada" → "Continuar de todos modos".')
    print("\nCtrl+C para parar.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
