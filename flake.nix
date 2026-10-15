{
  description = "TypeScript 7 lab: Node.js 26 + pnpm dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.nodejs_26
            pkgs.pnpm
          ];
        };
      });

      # copier stays out of the dev shell (docs/template-decisions.md D25)
      apps = forAllSystems (pkgs: {
        update = {
          type = "app";
          program = pkgs.lib.getExe (
            pkgs.writeShellApplication {
              name = "update";
              runtimeInputs = [
                pkgs.copier
                pkgs.git
              ];
              text = ''exec copier update --defaults "$@"'';
            }
          );
          meta.description = "Update this project from the copier-ts7 template";
        };
      });
    };
}
