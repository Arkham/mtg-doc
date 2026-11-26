# Shared by flake.nix and shell.nix so `nix develop` and `nix-shell` give the same tools.
{ pkgs }:

let
  # Node 24 mirrors CI (.github/workflows/ci.yml); pnpm 10 mirrors packageManager.
  nodejs = pkgs.nodejs_24;
  pnpm = pkgs.pnpm_10;
  # The Elm toolchain, in the versions elm-tooling.json pins, so the shell builds, formats and tests
  # Elm even before `pnpm install` has downloaded its own copies (pnpm scripts prefer those:
  # node_modules/.bin comes first in PATH).
  elm = pkgs.elmPackages;
in
pkgs.mkShell {
  packages = [
    nodejs
    pnpm
    pkgs.git
    elm.elm
    elm.elm-format
    elm.elm-json
    elm.elm-test-rs
  ];

  # Playwright fetches browsers into ~/.cache/ms-playwright, which works as-is on macOS.
  # On NixOS/Linux the browsers need system libraries; either install them for your distro
  # or reuse nixpkgs' copy (requires @playwright/test to match pkgs.playwright-driver.version):
  # PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

  shellHook = ''
    echo "mtg-doc: node $(node --version), pnpm $(pnpm --version), elm $(elm --version)"
    if [ ! -f .env ] && [ -f .env.example ]; then
      echo "tip: cp .env.example .env  # then fill in LLM_* (optional: the app also runs list-only)"
    fi
  '';
}
