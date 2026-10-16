# Project IDX workspace definition.
#
# Opens this repo in https://idx.dev with Node 20, Docker (for the compose
# stack) and both dependency trees installed. Two web previews are declared:
#   • dashboard  → Vite dev server on :5173 (proxies /api to the API below)
#   • api        → the Express API on :5000, serving the built dashboard at /app
#
# The dashboard preview sets VITE_PROXY_TARGET=http://127.0.0.1:5000, so it
# talks to the local `api` preview instead of a sleeping free-tier host. If the
# local API is not running, Pulse/vite.config.js transparently forwards /api to
# VITE_FALLBACK_API (your Render URL) and, failing that, returns a well-formed
# JSON error — the UI shows a readable notice instead of a white screen.
#
# One-command alternative: `npm run dev:all` starts API + dashboard together.
{ pkgs, ... }: {
  channel = "stable-24.05";

  packages = [
    pkgs.nodejs_20
    pkgs.git
    pkgs.docker
    pkgs.zip
  ];

  idx = {
    extensions = [
      "dbaeumer.vscode-eslint"
      "esbenp.prettier-vscode"
      "ms-azuretools.vscode-docker"
    ];

    workspace = {
      onCreate = {
        api-install = "npm install --no-audit --no-fund";
        ui-install = "cd Pulse && npm install --no-audit --no-fund";
      };
      # Rebuild the dashboard so /app works from the API preview immediately.
      onStart = {
        ui-build = "cd Pulse && npm run build";
      };
    };

    previews = {
      enable = true;
      previews = {
        dashboard = {
          command = [
            "sh" "-c"
            "VITE_PROXY_TARGET=http://127.0.0.1:5000 npm run dev --prefix Pulse"
          ];
          manager = "web";
        };
        api = {
          command = [ "sh" "-c" "PORT=5000 npm start" ];
          manager = "web";
        };
        # Credential-free demo of the whole stack (mock Zernio inside compose).
        docker-demo = {
          command = [
            "docker" "compose" "-f" "docker-compose.yml" "-f" "docker-compose.mock.yml" "up" "--build"
          ];
          manager = "web";
        };
      };
    };
  };
}
