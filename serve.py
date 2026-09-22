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

import sys
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


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    root = Path(__file__).resolve().parent

    import os
    os.chdir(root)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    except OSError as e:
        print(f"não consegui subir na porta {port}: {e}")
        print(f"provavelmente já há um servidor rodando. tente: ./serve.sh {port + 1}")
        sys.exit(1)

    print(f"→ http://localhost:{port}")
    print("   (sem cache — editar tuning.js e dar F5 basta)")
    print("   Ctrl+C para parar")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nparado.")


if __name__ == "__main__":
    main()
