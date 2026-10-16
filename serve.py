#!/usr/bin/env python3
"""
Servidor de desenvolvimento.

Por que não é só `python3 -m http.server`:

O servidor padrão manda `Last-Modified` e deixa o navegador decidir se revalida.
Para módulos ES isso é um problema real — o Chrome guarda o módulo já compilado
e, ao recarregar, reaproveita a versão antiga. Na prática: você edita
`src/tuning.js`, recarrega a página, e o jogo continua com os números velhos.
Pior, o sintoma imita um bug de código ("mudei o valor e não mudou nada").

Aqui todo recurso vai com `Cache-Control: no-store`, então F5 sempre traz o
arquivo do disco. É mais lento e é exatamente o que se quer durante o ajuste.
"""

import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Silencia o log de cada asset; erros continuam aparecendo.
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class Ipv6Server(ThreadingHTTPServer):
    """O mesmo servidor, mas em IPv6.

    Por que precisa: `localhost` é resolvido para `::1` (IPv6) ANTES de
    `127.0.0.1` pelo navegador e pelo curl. Um servidor que só escuta em IPv4
    faz o navegador receber um reset na conexão e mostrar erro de página —
    mesmo que o `127.0.0.1` esteja respondendo 200.

    `IPV6_V6ONLY = 1` é obrigatório aqui: sem ele, em Linux, escutar em `::1`
    também reivindica `127.0.0.1` (é o par v4-mapped dele) e o bind do servidor
    IPv4 falharia com "address already in use".
    """

    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    root = Path(__file__).resolve().parent

    os.chdir(root)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    except OSError as e:
        print(f"não consegui subir na porta {port}: {e}", flush=True)
        print(f"provavelmente já há um servidor rodando. tente: ./serve.sh {port + 1}", flush=True)
        sys.exit(1)

    # Segundo socket, no mesmo porta, para `localhost` -> ::1. Veja Ipv6Server.
    # Máquina sem IPv6 é normal: o servidor IPv4 continua valendo sozinho.
    try:
        server_v6 = Ipv6Server(("::1", port), NoCacheHandler)
    except OSError as e:
        print(f"(sem IPv6 em ::1: {e} — seguindo só com 127.0.0.1)", flush=True)
    else:
        threading.Thread(target=server_v6.serve_forever, daemon=True).start()

    print(f"→ http://localhost:{port}", flush=True)
    print(f"   (ou http://127.0.0.1:{port})", flush=True)
    print("   (sem cache — editar tuning.js e dar F5 basta)", flush=True)
    print("   Ctrl+C para parar", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nparado.", flush=True)


if __name__ == "__main__":
    main()
