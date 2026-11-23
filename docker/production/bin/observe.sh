#!/usr/bin/env bash
# The observer's only command (owner, 2026-11-23, Release Path brief Q8): the Release Console reads a
# server's containers, logs and releases through the tunnel with a key that can run nothing else. The
# observer's key is forced to `sudo -n /opt/saha-textile/bin/observe.sh`; the request arrives in
# SSH_ORIGINAL_COMMAND (kept by sudoers) and must be one of:
#
#   containers                                    every container: service, state, health, figures
#   logs <service> [--since <minutes>] [--errors] up to 500 recent lines, 60 minutes at most
#   releases                                      current, previous and every release kept
#   disk                                          the root disk and Docker's own use
#
# Each prints one JSON document. It reads only: no restart, no exec, no file outside the releases'
# own record files. The apps' and the edge's log lines are already masked where they are written.
set -euo pipefail

ROOT="${SAHA_TEXTILE_ROOT:-/opt/saha-textile}"
PROJECT="${COMPOSE_PROJECT:-saha-textile}"
request="${1:-${SSH_ORIGINAL_COMMAND:-}}"

refuse() {
	printf '{"error":"%s"}\n' "$1"
	exit 2
}

# The whole request is checked before anything runs; anything else is refused.
[[ "$request" =~ ^(containers|releases|disk|logs\ [a-z][a-z0-9-]{1,30}(\ --since\ ([1-9]|[1-5][0-9]|60))?(\ --errors)?)$ ]] ||
	refuse 'Ask for containers, logs <service> [--since <1-60>] [--errors], releases or disk.'

exec python3 - "$ROOT" "$PROJECT" "$request" <<'PYTHON'
import json, os, re, shutil, subprocess, sys
from datetime import datetime, timezone

root, project, request = sys.argv[1:4]
words = request.split()

def run(*args):
    return subprocess.run(list(args), capture_output=True, text=True, check=True).stdout

def size(text):
    match = re.match(r'^([\d.]+)\s*([KMGT]?i?B)$', text.strip())
    if not match:
        return None
    units = {'B': 1, 'KB': 1e3, 'MB': 1e6, 'GB': 1e9, 'TB': 1e12, 'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'TiB': 1024**4}
    return int(float(match.group(1)) * units.get(match.group(2), 1))

def containers_of(service=None):
    label = ['--filter', f'label=com.docker.compose.project={project}']
    if service:
        label += ['--filter', f'label=com.docker.compose.service={service}']
    return [line for line in run('docker', 'ps', '-a', '-q', *label).split() if line]

def when(path):
    return datetime.fromtimestamp(os.stat(path).st_mtime, timezone.utc).isoformat()

if words[0] == 'containers':
    ids = containers_of()
    stats = {}
    if ids:
        for line in run('docker', 'stats', '--no-stream', '--format', '{{json .}}', *ids).splitlines():
            row = json.loads(line)
            used, _, limit = row.get('MemUsage', '').partition('/')
            stats[row['ID'][:12]] = {
                'cpuPercent': float(row.get('CPUPerc', '0%').rstrip('%') or 0),
                'memBytes': size(used),
                'memLimitBytes': size(limit),
            }
    out = []
    for item in json.loads(run('docker', 'inspect', *ids)) if ids else []:
        state = item['State']
        out.append({
            'service': item['Config']['Labels'].get('com.docker.compose.service'),
            'name': item['Name'].lstrip('/'),
            'state': state['Status'],
            'health': (state.get('Health') or {}).get('Status'),
            'startedAt': state.get('StartedAt'),
            'restarts': item.get('RestartCount', 0),
            **stats.get(item['Id'][:12], {'cpuPercent': None, 'memBytes': None, 'memLimitBytes': None}),
        })
    print(json.dumps({'containers': sorted(out, key=lambda c: (c['service'] or '', c['name']))}))

elif words[0] == 'logs':
    service = words[1]
    since = int(words[words.index('--since') + 1]) if '--since' in words else 15
    errors = '--errors' in words
    lines = []
    for container in containers_of(service):
        result = subprocess.run(['docker', 'logs', '--since', f'{since}m', '--tail', '500', container],
                                capture_output=True, text=True)
        lines += (result.stdout + result.stderr).splitlines()
    if errors:
        lines = [l for l in lines if re.search(r'"level"\s*:\s*"(error|fatal)"|\b(error|fatal|panic)\b', l, re.I)]
    print(json.dumps({'service': service, 'sinceMinutes': since, 'lines': lines[-500:]}))

elif words[0] == 'releases':
    folder = os.path.join(root, 'releases')
    def target(link):
        path = os.path.join(root, link)
        return os.path.basename(os.readlink(path)) if os.path.islink(path) else None
    def read_words(path):
        return [w for w in open(path).read().split()] if os.path.exists(path) else []
    releases = []
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        path = os.path.join(folder, name)
        if os.path.isdir(path):
            releases.append({
                'id': name,
                'at': when(path),
                'deployedBlank': read_words(os.path.join(path, 'allowed-blank.txt')),
                'rotation': read_words(os.path.join(path, 'rotation.txt')),
            })
    print(json.dumps({'current': target('current'), 'previous': target('previous'), 'releases': releases}))

elif words[0] == 'disk':
    disk = shutil.disk_usage('/')
    docker = [json.loads(line) for line in run('docker', 'system', 'df', '--format', '{{json .}}').splitlines()]
    print(json.dumps({
        'root': {'totalBytes': disk.total, 'usedBytes': disk.used, 'freeBytes': disk.free},
        'docker': [{'type': row.get('Type'), 'size': row.get('Size'), 'reclaimable': row.get('Reclaimable')} for row in docker],
    }))
PYTHON
