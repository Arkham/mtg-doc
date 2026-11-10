# Shared by flake.nix and shell.nix so `nix develop` and `nix-shell` give the same tools.
{ pkgs }:

let
  # Node 24 mirrors CI (.github/workflows/ci.yml); pnpm 10 mirrors packageManager.
  nodejs = pkgs.nodejs_24;
  pnpm = pkgs.pnpm_10;
in
pkgs.mkShell {
  packages = [
    nodejs
    pnpm
    pkgs.git
  ];

  # Playwright fetches browsers into ~/.cache/ms-playwright, which works as-is on macOS.
  # On NixOS/Linux the browsers need system libraries; either install them for your distro
  # or reuse nixpkgs' copy (requires @playwright/test to match pkgs.playwright-driver.version):
  # PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

  shellHook = ''
    echo "mtg-doc: node $(node --version), pnpm $(pnpm --version)"
    if [ ! -f .env ] && [ -f .env.example ]; then
      echo "tip: cp .env.example .env  # then fill in LLM_* (optional: the app also runs list-only)"
    fi
  '';
}
