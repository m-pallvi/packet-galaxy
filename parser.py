# parser.py - Packet Galaxy
# Reads a Wireshark capture and writes galaxy.json for the p5.js sketch.

import json
import ipaddress
from collections import Counter, defaultdict
from scapy.all import rdpcap, IP, TCP, UDP, DNSQR

CAPTURE_FILE = "capture_alerts.pcapng" # the file you saved from Wireshark
OUTPUT_FILE = "galaxy.json"     # the file p5.js will read
MAX_STARS = 150                 # keep the galaxy readable

# ---- Security settings (Step 4) ----
SCAN_PORT_LIMIT = 20    # one machine touching more ports than this = port scan
ODD_DNS_LENGTH = 50     # DNS names longer than this look suspicious
ODD_DNS_LABELS = 6      # names with more dot-separated parts than this look suspicious


def is_private(address):
    """True if the IP belongs to a home/uni network (e.g. 192.168.x.x)."""
    return ipaddress.ip_address(address).is_private


def is_odd_dns(name):
    """Very simple rules that catch long or deeply nested domain names."""
    return len(name) > ODD_DNS_LENGTH or name.count(".") + 1 > ODD_DNS_LABELS


# 1. Load the capture file
packets = rdpcap(CAPTURE_FILE)
print(f"Loaded {len(packets)} packets from {CAPTURE_FILE}")

# 2. Prepare empty containers
stars = defaultdict(lambda: {"packets": 0, "bytes": 0,
                             "protocols": Counter(), "ports": set()})
dns_names = Counter()
syn_ports = defaultdict(set)   # (scanner, target) -> ports it knocked on

# 3. Go through every packet one by one
for pkt in packets:
    # DNS lookups first (they may travel over IPv4 or IPv6)
    if pkt.haslayer(DNSQR):
        name = pkt[DNSQR].qname.decode(errors="ignore").rstrip(".")
        dns_names[name] += 1

    if IP not in pkt:
        continue                      # stars use IPv4 only for now

    src = pkt[IP].src
    dst = pkt[IP].dst

    # Port-scan clue: a SYN packet is a "knock" on a port
    if TCP in pkt and pkt[TCP].flags == "S":
        syn_ports[(src, dst)].add(pkt[TCP].dport)

    # Work out which side is the outside world
    if is_private(src) and not is_private(dst):
        remote, outgoing = dst, True
    elif is_private(dst) and not is_private(src):
        remote, outgoing = src, False
    else:
        continue                      # local-to-local traffic, skip

    star = stars[remote]
    star["packets"] += 1
    star["bytes"] += len(pkt)

    if TCP in pkt:
        star["protocols"]["TCP"] += 1
        star["ports"].add(pkt[TCP].dport if outgoing else pkt[TCP].sport)
    elif UDP in pkt:
        star["protocols"]["UDP"] += 1
        star["ports"].add(pkt[UDP].dport if outgoing else pkt[UDP].sport)
    else:
        star["protocols"]["OTHER"] += 1

# 4. Turn the counts into a neat list, biggest stars first
star_list = []
for ip, info in stars.items():
    protocol = info["protocols"].most_common(1)[0][0] if info["protocols"] else "OTHER"
    star_list.append({
        "ip": ip,
        "packets": info["packets"],
        "bytes": info["bytes"],
        "protocol": protocol,
        "ports": sorted(info["ports"])[:10],
    })
star_list.sort(key=lambda s: s["packets"], reverse=True)

# 5. Security layer: find port scans and odd DNS names
alerts = []
for (scanner, target), ports in syn_ports.items():
    if len(ports) > SCAN_PORT_LIMIT:
        alerts.append({"type": "port_scan", "src": scanner,
                       "dst": target, "ports": len(ports)})
        print(f"ALERT: {scanner} knocked on {len(ports)} ports of {target}")

dns_list = []
for name, count in dns_names.most_common(60):
    odd = is_odd_dns(name)
    dns_list.append({"name": name, "count": count, "odd": odd})
    if odd:
        print(f"ALERT: odd DNS name {name}")

# 6. Save everything for p5.js
galaxy = {"stars": star_list[:MAX_STARS], "dns": dns_list, "alerts": alerts}
with open(OUTPUT_FILE, "w") as f:
    json.dump(galaxy, f, indent=2)

print(f"Saved {len(galaxy['stars'])} stars, {len(dns_list)} DNS names "
      f"and {len(alerts)} alerts to {OUTPUT_FILE}")