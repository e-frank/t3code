#!/usr/bin/env bash
# Fork: GitHub's runners at times cannot resolve Ubuntu's package hosts, and apt then retries
# until the job times out. Look up each host that fails through Cloudflare's DNS over HTTPS and
# pin it in /etc/hosts. Does nothing while the runner's DNS works.
set -u
for host in azure.archive.ubuntu.com archive.ubuntu.com security.ubuntu.com; do
  timeout 10 getent hosts "$host" >/dev/null && continue
  ip=$(curl -fsS --max-time 10 -H 'accept: application/dns-json' \
    "https://1.1.1.1/dns-query?name=$host&type=A" |
    jq -r '[.Answer[]? | select(.type == 1) | .data][0] // empty')
  if [ -n "$ip" ]; then
    echo "$ip $host" | sudo tee -a /etc/hosts
  else
    echo "Could not resolve $host" >&2
  fi
done
exit 0
