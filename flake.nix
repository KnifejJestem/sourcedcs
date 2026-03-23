{
  description = "SOURCE DCS — ATO brief, GCI server, and .miz→YAML tooling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Node.js versions matching each service's Dockerfile
        nodejs22 = pkgs.nodejs_22;  # asacs-link

        # Python environment with the one third-party dependency (PyYAML)
        pythonEnv = pkgs.python3.withPackages (ps: [ ps.pyyaml ps.pytest ]);

        # miztoyaml — DCS .miz → ATO brief YAML CLI tool
        miztoyaml = pkgs.python3Packages.buildPythonApplication {
          pname = "miztoyaml";
          version = "0.1.0";
          src = ./tools;
          format = "other";
          propagatedBuildInputs = [ pkgs.python3Packages.pyyaml ];
          installPhase = ''
            mkdir -p $out/lib/python3/site-packages/tools
            cp -r $src/miztoyaml $out/lib/python3/site-packages/tools/miztoyaml
            mkdir -p $out/bin
            cat > $out/bin/miztoyaml <<'EOF'
            #!${pkgs.python3}/bin/python3
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', 'lib', 'python3', 'site-packages'))
            from tools.miztoyaml import main
            main()
            EOF
            chmod +x $out/bin/miztoyaml
          '';
        };

        # atobrief — tactical briefing web app (Express + js-yaml + socket.io)
        # Matches Dockerfile: node:20-alpine, exposes port 4000 (set via PORT env var).
        # Required env vars: CASDOOR_ENDPOINT, ATOBRIEF_CLIENT_ID, ATOBRIEF_CLIENT_SECRET
        # Run `nix build .#atobrief` once — Nix will report the correct npmDepsHash on failure.
        atobrief = pkgs.buildNpmPackage {
          pname = "atobrief";
          version = "1.0.0";
          src = ./atobrief;
          nodejs = nodejs22;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/atobrief
            cp server.js package.json $out/share/atobrief/
            cp -r public/ $out/share/atobrief/public/
            cp -r data/   $out/share/atobrief/data/
            cp -r node_modules/ $out/share/atobrief/node_modules/
            mkdir -p $out/bin
            cat > $out/bin/atobrief <<EOF
            #!/usr/bin/env sh
            cd $out/share/atobrief
            exec ${nodejs22}/bin/node server.js "\$@"
            EOF
            chmod +x $out/bin/atobrief
          '';
        };

        # sourcedcs-web — main website (Express)
        # Matches Dockerfile: node:20-alpine, exposes port 7000 (set via PORT=7000 env var).
        # Required env vars: see .env.example — CASDOOR_*, DISCORD_BOT_TOKEN, etc.
        # Run `nix build .#sourcedcs-web` once — Nix will report the correct npmDepsHash on failure.
        sourcedcs-web = pkgs.buildNpmPackage {
          pname = "sourcedcs-web";
          version = "1.0.0";
          src = ./sourcedcs-web;
          nodejs = nodejs22;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/sourcedcs-web
            cp server.js package.json $out/share/sourcedcs-web/
            cp -r public/ $out/share/sourcedcs-web/public/
            cp -r node_modules/ $out/share/sourcedcs-web/node_modules/
            mkdir -p $out/share/sourcedcs-web/data
            mkdir -p $out/bin
            cat > $out/bin/sourcedcs-web <<EOF
            #!/usr/bin/env sh
            cd $out/share/sourcedcs-web
            exec ${nodejs22}/bin/node server.js "\$@"
            EOF
            chmod +x $out/bin/sourcedcs-web
          '';
        };

        # asacs-link — DCS GCI server (WebSocket relay, ESM)
        # Matches Dockerfile: node:22-alpine, exposes HTTP port 3000 + UDP 7788 for DCS.
        # Required env vars: ASACS_PASSWORD_{BLUE,RED,NEUTRAL,ADMIN}, ASACS_UDP_HOST
        # Run `nix build .#asacs-link` once — Nix will report the correct npmDepsHash on failure.
        asacs-link = pkgs.buildNpmPackage {
          pname = "asacs-link";
          version = "1.0.0";
          src = ./asacs_link;
          nodejs = nodejs22;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/asacs-link
            cp -r . $out/share/asacs-link/
            mkdir -p $out/bin
            cat > $out/bin/asacs-link <<EOF
            #!/usr/bin/env sh
            cd $out/share/asacs-link
            exec ${nodejs22}/bin/node server.js "\$@"
            EOF
            chmod +x $out/bin/asacs-link
          '';
        };

      in {
        packages = {
          inherit miztoyaml atobrief sourcedcs-web asacs-link;
          default = miztoyaml;
        };

        devShells.default = pkgs.mkShell {
          name = "sourcedcs";
          # nodejs_22 is the highest version needed; it can also run the Node 20 apps.
          buildInputs = [
            nodejs22
            pythonEnv
            pkgs.docker
            pkgs.docker-compose
          ];
          shellHook = ''
            echo "SOURCE DCS dev shell"
            echo "  node    $(node --version)"
            echo "  python  $(python3 --version)"
            echo ""
            echo "Individual services:"
            echo "  miztoyaml:    python3 -m tools.miztoyaml <file.miz>"
            echo "  atobrief:     cd atobrief    && PORT=4000 npm start"
            echo "  sourcedcs-web: cd sourcedcs-web && PORT=7000 npm start"
            echo "  asacs-link:   cd asacs_link  && PORT=3000 npm start"
            echo "  tests:        python3 -m pytest tools/tests/ -v"
            echo ""
            echo "Full stack (Docker Compose):"
            echo "  cp .env.example infra/.env && \$EDITOR infra/.env"
            echo "  cd infra && docker compose up -d"
          '';
        };
      }
    );
}
