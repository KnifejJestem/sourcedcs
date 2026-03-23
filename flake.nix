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
        # Run `nix build .#atobrief` once with the fakeHash to obtain the real hash from the error.
        atobrief = pkgs.buildNpmPackage {
          pname = "atobrief";
          version = "1.0.0";
          src = ./atobrief;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/atobrief
            cp -r . $out/share/atobrief
            mkdir -p $out/bin
            cat > $out/bin/atobrief <<EOF
            #!${pkgs.nodejs}/bin/node
            process.chdir('$out/share/atobrief');
            require('$out/share/atobrief/server.js');
            EOF
            chmod +x $out/bin/atobrief
          '';
        };

        # sourcedcs-web — main website (Express)
        # Run `nix build .#sourcedcs-web` once with this hash to obtain the real hash from the error.
        sourcedcs-web = pkgs.buildNpmPackage {
          pname = "sourcedcs-web";
          version = "1.0.0";
          src = ./sourcedcs-web;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/sourcedcs-web
            cp -r . $out/share/sourcedcs-web
            mkdir -p $out/bin
            cat > $out/bin/sourcedcs-web <<EOF
            #!${pkgs.nodejs}/bin/node
            process.chdir('$out/share/sourcedcs-web');
            require('$out/share/sourcedcs-web/server.js');
            EOF
            chmod +x $out/bin/sourcedcs-web
          '';
        };

        # asacs-link — DCS GCI server (WebSocket relay)
        # Run `nix build .#asacs-link` once with this hash to obtain the real hash from the error.
        asacs-link = pkgs.buildNpmPackage {
          pname = "asacs-link";
          version = "1.0.0";
          src = ./asacs_link;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          installPhase = ''
            mkdir -p $out/share/asacs-link
            cp -r . $out/share/asacs-link
            mkdir -p $out/bin
            cat > $out/bin/asacs-link <<EOF
            #!${pkgs.nodejs}/bin/node --input-type=module
            import { createRequire } from 'module';
            import { fileURLToPath } from 'url';
            import { dirname } from 'path';
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            process.chdir('$out/share/asacs-link');
            await import('$out/share/asacs-link/server.js');
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
          buildInputs = [
            pkgs.nodejs
            pythonEnv
          ];
          shellHook = ''
            echo "SOURCE DCS dev shell"
            echo "  node    $(node --version)"
            echo "  python  $(python3 --version)"
            echo ""
            echo "Run miztoyaml:    python3 -m tools.miztoyaml <file.miz>"
            echo "Run atobrief:     cd atobrief && npm start"
            echo "Run sourcedcs-web:  cd sourcedcs-web && npm start"
            echo "Run asacs-link:   cd asacs_link && npm start"
            echo "Run tests:        python3 -m pytest tools/tests/ -v"
          '';
        };
      }
    );
}
