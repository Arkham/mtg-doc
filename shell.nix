# For plain `nix-shell`; the flake is the source of truth.
# `nix develop` (or direnv + .envrc) pins nixpkgs through flake.lock, this uses <nixpkgs>.
import ./nix/dev-shell.nix { pkgs = import <nixpkgs> { }; }
