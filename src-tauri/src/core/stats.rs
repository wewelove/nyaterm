use std::collections::HashSet;

#[derive(serde::Serialize, Default)]
pub struct SystemInfo {
    pub hostname: String,
    pub uptime_sec: u64,
    pub os: String,
    pub arch: String,
}

#[derive(serde::Serialize, Default)]
pub struct LoadInfo {
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
}

#[derive(serde::Serialize, Default)]
pub struct CpuInfo {
    pub model: String,
    pub cores: u32,
    pub usage: f64,
    pub per_core: Vec<f64>,
}

#[derive(serde::Serialize, Default)]
pub struct MemoryInfo {
    pub used: u64,
    pub available: u64,
    pub cached: u64,
}

#[derive(serde::Serialize)]
pub struct NetworkInfo {
    pub nic: String,
    pub state: String,
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
}

#[derive(serde::Serialize)]
pub struct DiskInfo {
    pub device: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    pub use_percent: u32,
}

#[derive(serde::Serialize, Default)]
pub struct RemoteStats {
    pub system: SystemInfo,
    pub load: LoadInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub networks: Vec<NetworkInfo>,
    pub disks: Vec<DiskInfo>,
}

pub const SYSINFO_SCRIPT: &str = r#"sh -c '
base=${TMPDIR:-/tmp}/sysinfo.$$;
cpu1=$base.cpu1;
cpu2=$base.cpu2;
net1=$base.net1;
net2=$base.net2;
netr=$base.netr;
diskf=$base.disk;

trap "rm -f \"$cpu1\" \"$cpu2\" \"$net1\" \"$net2\" \"$netr\" \"$diskf\"" 0 HUP INT TERM;

host=$(cat /proc/sys/kernel/hostname 2>/dev/null);
[ -n "$host" ] || host=$(uname -n);
host=$(printf "%s" "$host" | tr "\t\r\n" "   ");

read upraw _ </proc/uptime;
uptime_sec=${upraw%.*};

if [ -r /etc/os-release ]; then
  . /etc/os-release;
  os=${PRETTY_NAME:-unknown};
else
  os=$(uname -s);
fi;
os=$(printf "%s" "$os" | tr "\t\r\n" "   ");

arch=$(uname -m);

read l1 l5 l15 _ </proc/loadavg;

cpu_model=$(awk -F: '"'"'
/^(model name|Hardware|Processor|cpu model)[[:space:]]*:/ && !m {
  gsub(/^[ \t]+/, "", $2);
  m=$2;
}
END {
  if (!m) m="unknown";
  print m;
}
'"'"' /proc/cpuinfo 2>/dev/null);

cpu_model=$(printf "%s" "$cpu_model" | tr "\t\r\n" "   ");

cpu_cores=$(awk '"'"'
/^processor[[:space:]]*:/ { c++ }
END { print c+0 }
'"'"' /proc/cpuinfo 2>/dev/null);

case $cpu_cores in
  ""|0) cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0) ;;
esac;

awk '"'"'
/^cpu/ {
  idle=$5+$6;
  total=0;
  for (i=2; i<=NF; i++) total+=$i;
  print $1, idle, total;
}
'"'"' /proc/stat >"$cpu1";

awk '"'"'
NR>2 {
  line=$0;
  sub(/^[ \t]+/, "", line);
  split(line, a, ":");
  nic=a[1];
  gsub(/^[ \t]+|[ \t]+$/, "", nic);
  gsub(/^[ \t]+/, "", a[2]);
  split(a[2], f, /[ \t]+/);
  print nic "\t" f[1] "\t" f[9];
}
'"'"' /proc/net/dev >"$net1";

interval=0.2;
sleep "$interval" 2>/dev/null || {
  interval=1;
  sleep 1;
};

awk '"'"'
/^cpu/ {
  idle=$5+$6;
  total=0;
  for (i=2; i<=NF; i++) total+=$i;
  print $1, idle, total;
}
'"'"' /proc/stat >"$cpu2";

awk '"'"'
NR>2 {
  line=$0;
  sub(/^[ \t]+/, "", line);
  split(line, a, ":");
  nic=a[1];
  gsub(/^[ \t]+|[ \t]+$/, "", nic);
  gsub(/^[ \t]+/, "", a[2]);
  split(a[2], f, /[ \t]+/);
  print nic "\t" f[1] "\t" f[9];
}
'"'"' /proc/net/dev >"$net2";

cpu_usage=$(awk '"'"'
NR==FNR {
  id[$1]=$2;
  tot[$1]=$3;
  next;
}
$1=="cpu" {
  didle=$2-id[$1];
  dtotal=$3-tot[$1];
  cpu=(dtotal>0) ? (1-didle/dtotal)*100 : 0;
  printf "%.1f", cpu;
}
'"'"' "$cpu1" "$cpu2");

set -- $(awk '"'"'
/MemTotal:/ { t=$2 }
/MemAvailable:/ { a=$2 }
/Buffers:/ { b=$2 }
/^Cached:/ { c=$2 }
/SReclaimable:/ { s=$2 }
END {
  printf "%.0f %.0f %.0f\n", (t-a)*1024, a*1024, (b+c+s)*1024;
}
'"'"' /proc/meminfo);

mem_used=$1;
mem_avail=$2;
mem_cache=$3;

printf "SYSTEM\t%s\t%s\t%s\t%s\n" "$host" "$uptime_sec" "$os" "$arch";
printf "LOAD\t%s\t%s\t%s\n" "$l1" "$l5" "$l15";
printf "CPU\t%s\t%s\t%s\n" "$cpu_model" "$cpu_cores" "$cpu_usage";

awk '"'"'
NR==FNR {
  id[$1]=$2;
  tot[$1]=$3;
  next;
}
/^cpu[0-9]/ {
  didle=$2-id[$1];
  dtotal=$3-tot[$1];
  cpu=(dtotal>0) ? (1-didle/dtotal)*100 : 0;
  n=substr($1,4);
  printf "CPUCORE\t%s\t%.1f\n", n, cpu;
}
'"'"' "$cpu1" "$cpu2";

printf "MEMORY\t%s\t%s\t%s\n" "$mem_used" "$mem_avail" "$mem_cache";

awk -v s="$interval" '"'"'
BEGIN {
  OFS="\t";
}
FNR==NR {
  rx[$1]=$2;
  tx[$1]=$3;
  next;
}
{
  nic=$1;

  if (nic=="" || nic=="lo") next;
  if (nic ~ /^(docker|veth|br-|virbr|flannel|cali|tunl|kube-ipvs0|cni|zt|tailscale|wg|tap|vnet)/) next;

  rxv=($2-rx[nic])/s;
  txv=($3-tx[nic])/s;

  if (rxv<0) rxv=0;
  if (txv<0) txv=0;

  printf "%s\t%.0f\t%.0f\n", nic, rxv, txv;
}
'"'"' "$net1" "$net2" >"$netr";

found_net=0;

if [ -s "$netr" ]; then
  while IFS="$(printf "\t")" read -r nic rx tx; do
    [ -n "$nic" ] || continue;
    [ -e "/sys/class/net/$nic/device" ] || continue;

    state=$(cat "/sys/class/net/$nic/operstate" 2>/dev/null || echo unknown);
    [ "$state" = "up" ] || continue;

    printf "NETWORK\t%s\t%s\t%s\t%s\n" "$nic" "$state" "$rx" "$tx";
    found_net=1;
  done <"$netr";
fi;

[ "$found_net" -eq 1 ] || printf "NETWORK\t-\t-\t0\t0\n";

if command -v findmnt >/dev/null 2>&1; then
  findmnt -b -rn -o SOURCE,TARGET,FSTYPE,SIZE,AVAIL,USE% 2>/dev/null | awk '"'"'
  BEGIN {
    OFS="\t";
  }
  {
    src=$1;
    mp=$2;
    fstype=$3;
    total=$4;
    avail=$5;
    usep=$6;

    if (src !~ "^/dev/") next;
    if (mp=="" || mp=="-") next;
    if (seen[mp]++) next;

    if (fstype ~ /^(tmpfs|devtmpfs|squashfs|overlay|proc|sysfs|cgroup|cgroup2|devpts|securityfs|pstore|bpf|tracefs|debugfs|mqueue|hugetlbfs|fusectl|configfs|autofs|ramfs|binfmt_misc)$/) next;

    gsub(/%/, "", usep);

    printf "%s\t%s\t%s\t%s\t%s\n", src, mp, total, avail, usep;
  }
  '"'"' >"$diskf";
elif command -v df >/dev/null 2>&1; then
  df -B1 -P 2>/dev/null | awk '"'"'
  BEGIN {
    OFS="\t";
  }
  NR>1 {
    src=$1;
    total=$2;
    avail=$4;
    usep=$5;
    mp=$6;

    if (src !~ "^/dev/") next;
    if (mp=="" || mp=="-") next;
    if (seen[mp]++) next;

    gsub(/%/, "", usep);

    printf "%s\t%s\t%s\t%s\t%s\n", src, mp, total, avail, usep;
  }
  '"'"' >"$diskf";
else
  : >"$diskf";
fi;

if [ -s "$diskf" ]; then
  while IFS="$(printf "\t")" read -r disk mp total avail usep; do
    [ -n "$disk" ] || continue;
    printf "DISK\t%s\t%s\t%s\t%s\t%s\n" "$disk" "$mp" "$total" "$avail" "$usep";
  done <"$diskf";
else
  printf "DISK\t-\t-\t0\t0\t0\n";
fi
'"#;

pub fn parse_stats_output(output: &str) -> RemoteStats {
    let mut stats = RemoteStats::default();
    let mut seen_disk_mounts = HashSet::new();

    for line in output.lines() {
        let cols: Vec<&str> = line.split('\t').collect();

        if cols.is_empty() {
            continue;
        }

        match cols[0] {
            "SYSTEM" if cols.len() >= 5 => {
                stats.system = SystemInfo {
                    hostname: cols[1].to_string(),
                    uptime_sec: cols[2].parse().unwrap_or(0),
                    os: cols[3].to_string(),
                    arch: cols[4].to_string(),
                };
            }

            "LOAD" if cols.len() >= 4 => {
                stats.load = LoadInfo {
                    load1: cols[1].parse().unwrap_or(0.0),
                    load5: cols[2].parse().unwrap_or(0.0),
                    load15: cols[3].parse().unwrap_or(0.0),
                };
            }

            "CPU" if cols.len() >= 4 => {
                stats.cpu = CpuInfo {
                    model: cols[1].to_string(),
                    cores: cols[2].parse().unwrap_or(0),
                    usage: cols[3].parse().unwrap_or(0.0),
                    per_core: Vec::new(),
                };
            }

            "CPUCORE" if cols.len() >= 3 => {
                let usage: f64 = cols[2].parse().unwrap_or(0.0);
                stats.cpu.per_core.push(usage);
            }

            "MEMORY" if cols.len() >= 4 => {
                stats.memory = MemoryInfo {
                    used: cols[1].parse().unwrap_or(0),
                    available: cols[2].parse().unwrap_or(0),
                    cached: cols[3].parse().unwrap_or(0),
                };
            }

            "NETWORK" if cols.len() >= 5 => {
                if cols[1] != "-" {
                    stats.networks.push(NetworkInfo {
                        nic: cols[1].to_string(),
                        state: cols[2].to_string(),
                        rx_bytes_per_sec: cols[3].parse().unwrap_or(0.0),
                        tx_bytes_per_sec: cols[4].parse().unwrap_or(0.0),
                    });
                }
            }

            "DISK" if cols.len() >= 6 => {
                if cols[1] != "-" {
                    let mount = cols[2].trim();

                    if mount.is_empty() || mount == "-" {
                        continue;
                    }

                    if seen_disk_mounts.insert(mount.to_string()) {
                        stats.disks.push(DiskInfo {
                            device: cols[1].to_string(),
                            mount: mount.to_string(),
                            total: cols[3].parse().unwrap_or(0),
                            available: cols[4].parse().unwrap_or(0),
                            use_percent: cols[5].parse().unwrap_or(0),
                        });
                    }
                }
            }

            _ => {}
        }
    }

    stats
}
