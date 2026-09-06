#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'Run as the non-root probe user, with systemd --user available.' >&2
  exit 1
fi
for command in python3 bash curl jq bc nc dig ip; do
  command -v "$command" >/dev/null || { printf 'Missing dependency: %s\n' "$command" >&2; exit 1; }
done
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination="$HOME/.cf-probe/ip-quality"
umask 077
mkdir -p "$destination" "$HOME/.config/systemd/user"
test -s "$destination/config.json"
curl -fL --retry 2 --connect-timeout 10 --max-time 120 \
  'https://raw.githubusercontent.com/xykt/IPQuality/3c0eb8856c67ad351020d1edd1bfd4e2515d32fe/ip.sh' \
  -o "$destination/ipquality.sh.new"
printf 'ffb17dae790341c13023a94c5141775974dd73a3653ca5fba5c4648fc5588402  %s\n' "$destination/ipquality.sh.new" | sha256sum -c -
mv "$destination/ipquality.sh.new" "$destination/ipquality.sh"
install -m 700 "$base/ip-quality-collector.py" "$destination/collector.py"
install -m 600 "$base/cf-ip-quality.service" "$base/cf-ip-quality.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now cf-ip-quality.timer
systemctl --user start --no-block cf-ip-quality.service
systemctl --user list-timers cf-ip-quality.timer --no-pager
