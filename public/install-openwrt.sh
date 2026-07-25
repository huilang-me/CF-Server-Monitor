#!/bin/sh
# ==============================================================================
# V1.3.3
# CF-Server-Monitor 安装/卸载脚本 (OpenWrt 专用版)
# 支持: OpenWrt / LEDE / ImmortalWrt (procd + opkg)
# 纯 POSIX sh 实现，无 bash 依赖
# Fixes: 1. 独立协程无 wait 阻塞 2. 原子化原子覆盖 3. 兼容 procd 服务框架
#        4. 严格 set -u 闭环 5. 使用 /tmp 替代 /dev/shm（OpenWrt 无 /dev/shm）
#        6. 配置文件化管理 7. Worker 健康检查自动重启 8. IPv6 路由检测优化
# ==============================================================================

set -eu

AGENT_VERSION="1.3.3"

# 路径定义（配置文件系统）
CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
OLD_TRAFFIC_DATA_FILE="/var/lib/cf-probe/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000

# 颜色定义（busybox sh 下仅 printf '%b' 可用）
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 路径定义
SERVICE_NAME="cf-probe"
PROCD_FILE="/etc/init.d/${SERVICE_NAME}"
SCRIPT_FILE="/usr/local/bin/${SERVICE_NAME}.sh"
PID_FILE="/var/run/${SERVICE_NAME}.pid"
LOG_FILE="/var/log/${SERVICE_NAME}.log"
SHM_DIR="/tmp"

mkdir -p /usr/local/bin /var/run /var/log 2>/dev/null || true

# ---------------------------------------------------------------
# 统一输出工具（纯 POSIX sh）
# ---------------------------------------------------------------
print_banner() {
    printf '%b╔═════════════════════════════════════╗%b\n' "${CYAN}" "${NC}"
    printf '%b║     CF-Server-Monitor (OpenWrt)     ║%b\n' "${CYAN}" "${NC}"
    printf '%b╚═════════════════════════════════════╝%b\n' "${CYAN}" "${NC}"
}

info()  { printf '%b[✓]%b %s\n' "${GREEN}" "${NC}" "$1"; }
warn()  { printf '%b[!]%b %s\n' "${YELLOW}" "${NC}" "$1"; }
error() { printf '%b[✗]%b %s\n' "${RED}"   "${NC}" "$1"; exit 1; }
step()  { printf '%b[→]%b %s\n' "${BLUE}"  "${NC}" "$1"; }

print_usage() {
    printf '%b错误: 运行所需的入参不完整。%b\n\n' "${RED}" "${NC}"
    echo "用法:"
    echo "  sh $0 install -id=SERVER_ID -secret=SECRET -base_url=BASE_URL [选项]"
    echo ""
    echo "必需参数:"
    echo "  -id=xxx        服务器ID"
    echo "  -secret=xxx    密钥"
    echo "  -base_url=xxx  探针 BaseURL"
    echo ""
    echo "可选参数:"
    echo "  -url=xxx       兼容旧版上报地址参数"
    echo "  -proxy_url=xxx HTTP(S) 代理 URL"
    echo "  -interval=N    上报间隔(秒)，默认60"
    echo "  -collect_interval=N    采样间隔(秒)，默认0"
    echo "  -ct=HOST       自定义CT测试节点"
    echo "  -cu=HOST       自定义CU测试节点"
    echo "  -cm=HOST       自定义CM测试节点"
    echo "  -bd=HOST       自定义BD测试节点"
    echo "  -reset_day=N   流量重置日(1-31, 0=不重置)，默认1"
    echo "  -auto_update=0|1 自动更新探针，默认0"
    echo "  -rx_correction=N  下行流量校正(GB)，覆盖当月下行数据"
    echo "  -tx_correction=N  上行流量校正(GB)，覆盖当月上行数据"
    echo ""
    echo "示例:"
    echo "  sh $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com"
    echo "  sh $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com/prefix -proxy_url=http://user:pass@proxy.example.com:8080"
    exit 1
}

sed_escape() {
    printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/&/\\&/g; s/@/\\@/g; s/\//\\\//g; s/|/\\|/g; s/"/\\"/g'
}

derive_base_url() {
    local _cf_base_url="${1%%\?*}"
    _cf_base_url="${_cf_base_url%%#*}"
    case "$_cf_base_url" in */update) _cf_base_url="${_cf_base_url%/update}" ;; esac
    printf '%s' "${_cf_base_url%/}"
}

masked_proxy_url() {
    [ -z "${1:-}" ] && { printf '%s' "direct"; return; }
    printf '%s' "$1" | sed 's#\(https\?://[^:/@]*\):[^@]*@#\1:******@#'
}

normalize_binary_value() {
    local _cf_binary_value="${1-}" _cf_binary_default="${2-}"
    [ -z "$_cf_binary_value" ] && _cf_binary_value="$_cf_binary_default"
    case "$_cf_binary_value" in
        0|1) printf '%s' "$_cf_binary_value" ;;
        *) return 1 ;;
    esac
}

to_uint() {
    _cf_num=$(printf '%s' "${1:-0}" | sed 's/^0*//')
    case "${_cf_num}" in
        ''|*[!0-9]*) echo 0 ;;
        ?|??|???|????|?????|??????|???????|????????|?????????) echo "${_cf_num}" ;;
        *) echo 0 ;;
    esac
}

normalize_reset_day() {
    _cf_day=$(printf '%s' "${1:-1}" | sed 's/^0*//')
    case "${_cf_day}" in
        '') echo 0 ;;
        *[!0-9]*) echo 1 ;;
        0|[1-9]|1[0-9]|2[0-9]|30|31) echo "${_cf_day}" ;;
        *) echo 1 ;;
    esac
}

normalize_probe_config() {
    COLLECT_INTERVAL=$(to_uint "${COLLECT_INTERVAL:-0}")
    REPORT_INTERVAL=$(to_uint "${REPORT_INTERVAL:-60}")
    [ "${REPORT_INTERVAL}" -lt 1 ] && REPORT_INTERVAL=60
    if [ "${COLLECT_INTERVAL}" -gt 0 ] && [ "${REPORT_INTERVAL}" -lt "${COLLECT_INTERVAL}" ]; then
        REPORT_INTERVAL="${COLLECT_INTERVAL}"
    fi
    RESET_DAY=$(normalize_reset_day "${RESET_DAY:-1}")
}

check_root() {
    if [ "$(id -u)" != "0" ]; then
        error "请使用 root 权限运行此脚本: sudo sh $0"
    fi
}

# ---------------------------------------------------------------
# OS / Init 系统探测
# ---------------------------------------------------------------
detect_os() {
    if [ -f /etc/os-release ]; then
        OS_ID=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'")
    elif [ -f /etc/openwrt_release ]; then
        OS_ID="openwrt"
    else
        OS_ID=$(uname -s | tr '[:upper:]' '[:lower:]')
    fi
    OS_ID=${OS_ID:-"unknown"}

    case "$OS_ID" in
        immortalwrt|openwrt|lede)
            if command -v apk >/dev/null 2>&1; then
                PKG_MGR="apk"
            elif command -v opkg >/dev/null 2>&1; then
                PKG_MGR="opkg"
            else
                error "未找到可用的包管理器 (apk/opkg)，当前系统: $OS_ID"
            fi
            ;;
        *)
            warn "检测到非 OpenWrt 系统: $OS_ID，仍将尝试使用 opkg"
            PKG_MGR="opkg"
            ;;
    esac

    if command -v procd >/dev/null 2>&1 || [ -f /sbin/procd ]; then
        INIT_SYSTEM="procd"
    elif command -v rc-service >/dev/null 2>&1 && [ -d /etc/runlevels ]; then
        INIT_SYSTEM="openrc"
    elif [ -d /run/systemd/system ]; then
        INIT_SYSTEM="systemd"
    else
        INIT_SYSTEM="manual"
    fi
}

# ---------------------------------------------------------------
# 依赖安装（OpenWrt 版 — 纯 POSIX sh，无需 bash）
# ---------------------------------------------------------------
install_deps() {
    step "检查系统依赖组件..."

    case "$PKG_MGR" in
        apk)
            required_pkgs="curl coreutils procps-ng ip-full"
            optional_ping_pkg="iputils"
            if ! command -v apk >/dev/null 2>&1; then
                error "未找到 apk 包管理器。"
            fi
            step "刷新 APK 索引并安装基础依赖..."
            apk update --quiet >/dev/null 2>&1 || true
            apk add --no-cache --quiet $required_pkgs >/dev/null 2>&1 || \
                apk add --no-cache $required_pkgs || \
                warn "部分依赖安装失败，请手动执行: apk add $required_pkgs"
            apk add --no-cache --quiet $optional_ping_pkg >/dev/null 2>&1 || true
            ;;
        opkg)
            required_pkgs="curl coreutils procps-ng ip-full"
            optional_ping_pkg="iputils-ping"
            if ! command -v opkg >/dev/null 2>&1; then
                error "未找到 opkg 包管理器，当前系统不是 OpenWrt 系列。"
            fi
            step "更新 OPKG 索引并安装基础依赖..."
            opkg update >/dev/null 2>&1 || true
            opkg install $required_pkgs >/dev/null 2>&1 || \
                opkg install --force-overwrite $required_pkgs >/dev/null 2>&1 || \
                warn "部分依赖安装失败，请手动执行: opkg install $required_pkgs"
            opkg install $optional_ping_pkg >/dev/null 2>&1 || true
            ;;
        *)
            error "未知的包管理器: ${PKG_MGR}"
            ;;
    esac

    required_cmds="curl awk grep sed"
    for cmd in ${required_cmds}; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            warn "缺少依赖: ${cmd}，某些功能可能不可用。"
        fi
    done

    for cmd in pgrep pkill ss; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            warn "缺少可选依赖: ${cmd}（不影响核心监控功能）"
        fi
    done

    if ! command -v ping >/dev/null 2>&1; then
        warn "未找到 ping，丢包率监控将上报为空；可手动安装 iputils-ping 或系统自带 ping 包"
    fi

    info "基础依赖组件检查通过"

    case "$INIT_SYSTEM" in
        procd)   info "检测到 procd，将注册为 OpenWrt 系统服务。" ;;
        openrc)  info "检测到 OpenRC，将注册为系统服务。" ;;
        systemd) warn "检测到 systemd — 建议使用 install.sh。" ;;
        manual)  warn "未检测到 init 系统，将采用后台进程方式运行。" ;;
    esac
}


# ---------------------------------------------------------------
# 清理旧进程 / 旧服务
# ---------------------------------------------------------------
stop_old_service() {
    step "清理可能存在的旧服务进程..."

    if [ "$INIT_SYSTEM" = "procd" ] && [ -f "$PROCD_FILE" ]; then
        "$PROCD_FILE" stop >/dev/null 2>&1 || true
        "$PROCD_FILE" disable >/dev/null 2>&1 || true
        rm -f "$PROCD_FILE"
    elif [ "$INIT_SYSTEM" = "openrc" ] && [ -f "$PROCD_FILE" ]; then
        rc-service "$SERVICE_NAME" stop >/dev/null 2>&1 || true
        rc-update del "$SERVICE_NAME" default >/dev/null 2>&1 || true
        rm -f "$PROCD_FILE"
    fi

    if [ -f "$PID_FILE" ]; then
        old_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
        if [ -n "$old_pid" ] && kill -0 "$old_pid" >/dev/null 2>&1; then
            kill -TERM "$old_pid" >/dev/null 2>&1 || true
            sleep 1
            kill -9 "$old_pid" >/dev/null 2>&1 || true
        fi
        rm -f "$PID_FILE"
    fi

    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" >/dev/null 2>&1 || true
    fi
}

# ---------------------------------------------------------------
# 注入探针脚本（纯 POSIX sh，无任何 bash 特有语法）
# OpenWrt 适配：/dev/shm → /tmp
# ---------------------------------------------------------------
create_script() {
    step "注入工业级监控采集探针..."

    mkdir -p /usr/local/bin 2>/dev/null || true

    cat << 'PROBE_EOF' | sed "s|__AGENT_VERSION__|${AGENT_VERSION}|g" > "${SCRIPT_FILE}"
#!/bin/sh
set +eu

AGENT_VERSION="__AGENT_VERSION__"
PID_FILE="/var/run/cf-probe.pid"
echo $$ > "$PID_FILE"

CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000

if [ ! -f "${CONFIG_FILE}" ]; then
    echo "[ERROR] 配置文件不存在: ${CONFIG_FILE}"
    exit 1
fi

SERVER_ID=""
SECRET=""
WORKER_URL=""
BASE_URL=""
PROXY_URL=""
COLLECT_INTERVAL=""
REPORT_INTERVAL=""
CT_NODE=""
CU_NODE=""
CM_NODE=""
BD_NODE=""
RESET_DAY=""
AUTO_UPDATE=""
CONFIG_MD5=""

while IFS='=' read -r key value; do
    case "$key" in
        SERVER_ID) SERVER_ID="${value%\"}"; SERVER_ID="${SERVER_ID#\"}" ;;
        SECRET) SECRET="${value%\"}"; SECRET="${SECRET#\"}" ;;
        WORKER_URL) WORKER_URL="${value%\"}"; WORKER_URL="${WORKER_URL#\"}" ;;
        BASE_URL) BASE_URL="${value%\"}"; BASE_URL="${BASE_URL#\"}" ;;
        PROXY_URL) PROXY_URL="${value%\"}"; PROXY_URL="${PROXY_URL#\"}" ;;
        COLLECT_INTERVAL) COLLECT_INTERVAL="${value%\"}"; COLLECT_INTERVAL="${COLLECT_INTERVAL#\"}" ;;
        REPORT_INTERVAL) REPORT_INTERVAL="${value%\"}"; REPORT_INTERVAL="${REPORT_INTERVAL#\"}" ;;
        CT_NODE) CT_NODE="${value%\"}"; CT_NODE="${CT_NODE#\"}" ;;
        CU_NODE) CU_NODE="${value%\"}"; CU_NODE="${CU_NODE#\"}" ;;
        CM_NODE) CM_NODE="${value%\"}"; CM_NODE="${CM_NODE#\"}" ;;
        BD_NODE) BD_NODE="${value%\"}"; BD_NODE="${BD_NODE#\"}" ;;
        RESET_DAY) RESET_DAY="${value%\"}"; RESET_DAY="${RESET_DAY#\"}" ;;
        AUTO_UPDATE) AUTO_UPDATE="${value%\"}"; AUTO_UPDATE="${AUTO_UPDATE#\"}" ;;
        CONFIG_MD5) CONFIG_MD5="${value%\"}"; CONFIG_MD5="${CONFIG_MD5#\"}" ;;
    esac
done < "${CONFIG_FILE}"

to_uint() {
    local num=$(printf '%s' "${1:-0}" | sed 's/^0*//')
    case "${num}" in
        ''|*[!0-9]*) echo 0 ;;
        ?|??|???|????|?????|??????|???????|????????|?????????) echo "${num}" ;;
        *) echo 0 ;;
    esac
}

normalize_reset_day() {
    local day=$(printf '%s' "${1:-1}" | sed 's/^0*//')
    case "${day}" in
        '') echo 0 ;;
        *[!0-9]*) echo 1 ;;
        0|[1-9]|1[0-9]|2[0-9]|30|31) echo "${day}" ;;
        *) echo 1 ;;
    esac
}

COLLECT_INTERVAL=$(to_uint "${COLLECT_INTERVAL:-0}")
REPORT_INTERVAL=$(to_uint "${REPORT_INTERVAL:-60}")
RESET_DAY=$(normalize_reset_day "${RESET_DAY:-1}")
[ "$REPORT_INTERVAL" -lt 1 ] && REPORT_INTERVAL=60
if [ "$COLLECT_INTERVAL" -gt 0 ] && [ "$REPORT_INTERVAL" -lt "$COLLECT_INTERVAL" ]; then
    REPORT_INTERVAL="$COLLECT_INTERVAL"
fi
ACTIVE_INTERVAL="$REPORT_INTERVAL"
[ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
CONFIG_MD5=${CONFIG_MD5:-none}
AUTO_UPDATE=${AUTO_UPDATE:-0}
case "$AUTO_UPDATE" in
    0|1) ;;
    *) AUTO_UPDATE=0 ;;
esac
DEBUG_MODE=${DEBUG_MODE:-0}

derive_base_url() {
    local _cf_base_url="${1%%\?*}"
    _cf_base_url="${_cf_base_url%%#*}"
    case "$_cf_base_url" in */update) _cf_base_url="${_cf_base_url%/update}" ;; esac
    printf '%s' "${_cf_base_url%/}"
}

BASE_URL=${BASE_URL:-}
PROXY_URL=${PROXY_URL:-}
[ -z "$BASE_URL" ] && BASE_URL=$(derive_base_url "$WORKER_URL")
BASE_URL=${BASE_URL%/}
[ -n "$BASE_URL" ] && WORKER_URL="${BASE_URL}/update"

agent_curl() {
    if [ -n "$PROXY_URL" ]; then curl --noproxy '' --proxy "$PROXY_URL" "$@"; else curl --noproxy '*' "$@"; fi
}

get_direct_route_source() {
    local family="$1" route_line direct_interface direct_source
    route_line=$(ip "-${family}" route show table main default 2>/dev/null | awk '
        function is_tunnel(name) {
            name = tolower(name)
            return name ~ /^(lo|tun|tap|utun|clash|mihomo|sing|warp|tailscale|wg)/
        }
        {
            dev = ""; via = ""
            for (i = 1; i <= NF; i++) {
                if ($i == "dev" && i < NF) dev = $(i + 1)
                if ($i == "via" && i < NF) via = $(i + 1)
            }
            if (dev != "" && !is_tunnel(dev)) {
                if (via != "") { print; selected = 1; exit }
                if (fallback == "") fallback = $0
            }
        }
        END { if (!selected && fallback != "") print fallback }
    ' | head -n 1)
    [ -n "$route_line" ] || return 1

    direct_interface=$(printf '%s\n' "$route_line" | awk '{ for (i = 1; i <= NF; i++) if ($i == "dev" && i < NF) { print $(i + 1); exit } }')
    direct_source=$(printf '%s\n' "$route_line" | awk '{ for (i = 1; i <= NF; i++) if ($i == "src" && i < NF) { print $(i + 1); exit } }')
    if [ -z "$direct_source" ] && [ -n "$direct_interface" ]; then
        direct_source=$(ip "-${family}" addr show dev "$direct_interface" scope global 2>/dev/null | awk '$1 == "inet" || $1 == "inet6" { sub(/\/.*/, "", $2); print $2; exit }')
    fi

    case "$family:$direct_source" in
        4:*.*.*.*|6:*:*) printf '%s\n' "$direct_source" ;;
        *) return 1 ;;
    esac
}

direct_cf_trace() {
    local family="$1" direct_source trace_url
    direct_source=$(get_direct_route_source "$family") || return 1
    # Bind the physical source address and use a fixed Cloudflare IP so TUN policy routing and fake DNS are bypassed.
    case "$family" in
        4) trace_url='http://1.1.1.1/cdn-cgi/trace' ;;
        6) trace_url='http://[2606:4700:4700::1111]/cdn-cgi/trace' ;;
        *) return 1 ;;
    esac
    curl --noproxy '*' "-${family}" --interface "$direct_source" -s -m 4 --connect-timeout 2 \
        -H 'Host: cloudflare.com' "$trace_url" 2>/dev/null
}

masked_proxy_url() {
    [ -z "${1:-}" ] && { printf '%s' "direct"; return; }
    printf '%s' "$1" | sed 's#\(https\?://[^:/@]*\):[^@]*@#\1:******@#'
}

SHM_DIR="/tmp"

log_ts() {
    date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
    echo "[INFO] $(log_ts) $*"
}

log_debug() {
    [ "$DEBUG_MODE" = "1" ] && echo "[DEBUG] $(log_ts) $*" >&2
}

log_warn_debug() {
    [ "$DEBUG_MODE" = "1" ] && echo "[WARN] $(log_ts) $*"
}

get_install_url() {
    case "$BASE_URL" in
        http://*|https://*) printf '%s/install-openwrt.sh' "$BASE_URL" ;;
        *) return 1 ;;
    esac
}

schedule_agent_update() {
    if [ "${AUTO_UPDATE}" != "1" ]; then
        log_warn_debug "Auto update ignored: local AUTO_UPDATE=${AUTO_UPDATE}"
        return 0
    fi

    local now last lock_file install_url tmp_dir
    lock_file="${CONFIG_DIR}/auto_update.lock"
    tmp_dir="${SHM_DIR:-/tmp}"

    now=$(date +%s)
    if [ -f "$lock_file" ]; then
        last=$(cat "$lock_file" 2>/dev/null || echo 0)
        case "$last" in ''|*[!0-9]*) last=0 ;; esac
        if [ $((now - last)) -lt 1800 ]; then
            log_warn_debug "Auto update already scheduled recently: age=$((now - last))s lock=${lock_file}"
            return 0
        fi
    fi

    mkdir -p "$tmp_dir" "${CONFIG_DIR}" 2>/dev/null || true
    if ! install_url=$(get_install_url); then
        log_warn_debug "Auto update skipped: invalid WORKER_URL=${WORKER_URL}"
        return 1
    fi
    log_debug "Auto update requested: install_url=${install_url}"

    nohup /bin/sh -c 'tmp="$2/auto_update_install.$$"; proxy="$3"; rm -f "$tmp"; if [ -n "$proxy" ]; then curl --noproxy "" --proxy "$proxy" -fsSL --connect-timeout 5 -m 30 "$1" -o "$tmp"; else curl --noproxy "*" -fsSL --connect-timeout 5 -m 30 "$1" -o "$tmp"; fi && /bin/sh "$tmp" install; rm -f "$tmp"' _ "$install_url" "$tmp_dir" "$PROXY_URL" >/dev/null 2>&1 &
    printf '%s\n' "$now" > "$lock_file" 2>/dev/null || true
    log_info "Auto update scheduled"
    return 0
}

# 动态检测 stdout 指向的日志文件（procd 模式走 syslog 不写文件，此处为空）
PROBE_LOG_FILE=""
if [ -L /proc/self/fd/1 ]; then
    _log_target=$(readlink /proc/self/fd/1 2>/dev/null || echo "")
    [ -f "$_log_target" ] && [ -w "$_log_target" ] && PROBE_LOG_FILE="$_log_target"
fi

rotate_log_if_needed() {
    [ -f "$1" ] || return 0
    local _sz
    _sz=$(wc -c < "$1" 2>/dev/null || echo 0)
    [ "${_sz:-0}" -gt 1048576 ] || return 0
    local _lines
    _lines=$(wc -l < "$1" 2>/dev/null || echo 0)
    if [ "${_lines}" -eq 1 ]; then
        : > "$1" 2>/dev/null
        return 0
    fi
    local _tmp="${1}.rot.$$"
    tail -c 102400 "$1" > "$_tmp" 2>/dev/null || { rm -f "$_tmp"; return 0; }
    : > "$1" 2>/dev/null
    cat "$_tmp" >> "$1" 2>/dev/null || true
    rm -f "$_tmp" 2>/dev/null || true
}

persist_dynamic_config() {
    local tmp_file="${CONFIG_FILE}.tmp.$$"
    awk -v collect="$1" -v report="$2" -v reset="$3" -v md5="$4" -v ct="$5" -v cu="$6" -v cm="$7" -v bd="$8" '
        BEGIN { c=0; r=0; d=0; m=0; tct=0; tcu=0; tcm=0; tbd=0 }
        /^COLLECT_INTERVAL=/ { print "COLLECT_INTERVAL=\"" collect "\""; c=1; next }
        /^REPORT_INTERVAL=/ { print "REPORT_INTERVAL=\"" report "\""; r=1; next }
        /^RESET_DAY=/ { print "RESET_DAY=\"" reset "\""; d=1; next }
        /^CONFIG_MD5=/ { print "CONFIG_MD5=\"" md5 "\""; m=1; next }
        /^CT_NODE=/ { print "CT_NODE=\"" ct "\""; tct=1; next }
        /^CU_NODE=/ { print "CU_NODE=\"" cu "\""; tcu=1; next }
        /^CM_NODE=/ { print "CM_NODE=\"" cm "\""; tcm=1; next }
        /^BD_NODE=/ { print "BD_NODE=\"" bd "\""; tbd=1; next }
        { print }
        END {
            if (!c) print "COLLECT_INTERVAL=\"" collect "\""
            if (!r) print "REPORT_INTERVAL=\"" report "\""
            if (!d) print "RESET_DAY=\"" reset "\""
            if (!m) print "CONFIG_MD5=\"" md5 "\""
            if (!tct) print "CT_NODE=\"" ct "\""
            if (!tcu) print "CU_NODE=\"" cu "\""
            if (!tcm) print "CM_NODE=\"" cm "\""
            if (!tbd) print "BD_NODE=\"" bd "\""
        }
    ' "$CONFIG_FILE" > "$tmp_file" || { rm -f "$tmp_file"; return 1; }
    chmod 600 "$tmp_file" 2>/dev/null || true
    mv "$tmp_file" "$CONFIG_FILE"
}

apply_remote_config() {
    local response_file="$1"
    local header_file="$2"
    local bytes=$(wc -c < "$response_file" 2>/dev/null || echo 9999)
    if [ "$bytes" -gt 1024 ]; then
        log_warn_debug "Remote config rejected: response too large bytes=${bytes}"
        return 1
    fi
    local body=$(cat "$response_file" 2>/dev/null) || return 1
    log_debug "Remote config raw: bytes=${bytes} body=${body}"
    case "$body" in
        '') log_warn_debug "Remote config rejected: empty body"; return 1 ;;
        *[!a-z0-9_=\&.\-:]*) log_warn_debug "Remote config rejected: invalid characters body=${body}"; return 1 ;;
    esac

    local collect=""
    local report=""
    local reset=""
    local schema=""
    local ct=""
    local cu=""
    local cm=""
    local bd=""
    local rx_corr=""
    local tx_corr=""
    local update=""
    local saved_ifs="$IFS"
    IFS='&'
    for _f in $body; do
        _k="${_f%%=*}"; _v="${_f#*=}"
        case "$_k" in
            collect_interval) collect="$_v" ;;
            report_interval)  report="$_v" ;;
            reset_day)        reset="$_v" ;;
            schema_version)   schema="$_v" ;;
            custom_ct)        ct="$_v" ;;
            custom_cu)        cu="$_v" ;;
            custom_cm)        cm="$_v" ;;
            custom_bd)        bd="$_v" ;;
            rx_correction)    rx_corr="$_v" ;;
            tx_correction)    tx_corr="$_v" ;;
            update)           update="$_v" ;;
            '')               ;;
            *)                IFS="$saved_ifs"; log_warn_debug "Remote config rejected: unknown field=${_k}"; return 1 ;;
        esac
    done
    IFS="$saved_ifs"

    local has_config=0
    if [ -n "$collect" ] || [ -n "$report" ] || [ -n "$reset" ] || [ -n "$schema" ]; then
        has_config=1
    fi
    log_debug "Remote config parsed: has_config=${has_config} update=${update:-} collect=${collect:-} report=${report:-} reset=${reset:-} schema=${schema:-} rx_corr=${rx_corr:-} tx_corr=${tx_corr:-}"

    if [ "$has_config" = "0" ]; then
        if [ "$update" = "1" ]; then
            log_debug "Remote update-only instruction received"
            schedule_agent_update
            return 0
        fi
        log_warn_debug "Remote config rejected: no config fields and update=${update:-}"
        return 1
    fi

    local md5=$(awk 'tolower($1)=="x-agent-config-md5:" { gsub("\r", "", $2); print tolower($2); exit }' "$header_file")
    if [ "${#md5}" -ne 32 ]; then
        log_warn_debug "Remote config rejected: invalid md5 length md5=${md5:-}"
        return 1
    fi
    case "$md5" in *[!0-9a-f]*) log_warn_debug "Remote config rejected: invalid md5 chars md5=${md5}"; return 1 ;; esac
    log_debug "Remote config md5: current=${CONFIG_MD5:-none} remote=${md5}"

    case "$collect" in 0|1|2|5|10) ;; *) log_warn_debug "Remote config rejected: invalid collect_interval=${collect:-}"; return 1 ;; esac
    case "$report" in 30|60|120|180) ;; *) log_warn_debug "Remote config rejected: invalid report_interval=${report:-}"; return 1 ;; esac
    case "$reset" in 0|[1-9]|1[0-9]|2[0-9]|30|31) ;; *) log_warn_debug "Remote config rejected: invalid reset_day=${reset:-}"; return 1 ;; esac
    case "$update" in ''|0|1) ;; *) log_warn_debug "Remote config rejected: invalid update=${update}"; return 1 ;; esac
    if [ "$schema" != "2" ]; then
        log_warn_debug "Remote config rejected: invalid schema_version=${schema:-}"
        return 1
    fi
    if [ "$report" -lt "$collect" ]; then
        log_warn_debug "Remote config rejected: report_interval=${report} less than collect_interval=${collect}"
        return 1
    fi

    if [ "$md5" != "${CONFIG_MD5:-none}" ]; then
        persist_dynamic_config "$collect" "$report" "$reset" "$md5" "$ct" "$cu" "$cm" "$bd" || return 1
        COLLECT_INTERVAL="$collect"
        REPORT_INTERVAL="$report"
        RESET_DAY="$reset"
        CT_NODE="$ct"
        CU_NODE="$cu"
        CM_NODE="$cm"
        BD_NODE="$bd"
        CONFIG_MD5="$md5"
        ACTIVE_INTERVAL="$REPORT_INTERVAL"
        [ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
        log_info "Dynamic configuration applied: md5=${CONFIG_MD5} ct=${CT_NODE:-} cu=${CU_NODE:-} cm=${CM_NODE:-} bd=${BD_NODE:-}"

        if kill -0 "$WORKER_PID" 2>/dev/null; then
            pkill -P "$WORKER_PID" 2>/dev/null || true
            kill "$WORKER_PID" 2>/dev/null || true
            wait "$WORKER_PID" 2>/dev/null || true
        fi
        rm -f /tmp/.cf_probe_* 2>/dev/null || true
        run_network_worker &
        WORKER_PID=$!

        if [ "$COLLECT_INTERVAL" -gt 0 ]; then
            SAMPLES_JSON=""
            SAMPLE_COUNT=0
        fi
        LAST_REPORT_TIME=0
    fi

    if [ -n "$rx_corr" ] || [ -n "$tx_corr" ]; then
        if apply_traffic_correction "$rx_corr" "$tx_corr"; then
            send_correction_confirm "$rx_corr" "$tx_corr" || true
        fi
    fi

    if [ "$update" = "1" ]; then
        log_debug "Remote config includes update=1"
        schedule_agent_update || true
    fi
    return 0
}

normalize_correction_value() {
    local corr_val="${1:-0}"
    [ -z "$corr_val" ] && local corr_val=0
    printf '%s' "$corr_val"
}

is_valid_correction_value() {
    local check_val=$(normalize_correction_value "$1")
    awk -v v="$check_val" -v max="$MAX_TRAFFIC_CORRECTION_GB" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v + 0 >= 0 && v + 0 <= max) }'
}

send_correction_confirm() {
    local ack_rx=$(normalize_correction_value "$1")
    local ack_tx=$(normalize_correction_value "$2")
    is_valid_correction_value "$ack_rx" && is_valid_correction_value "$ack_tx" || return 1
    local ack_payload="{\"id\":\"$SERVER_ID\",\"secret\":\"$SECRET\",\"rx_correction\":$ack_rx,\"tx_correction\":$ack_tx}"
    local ack_http=$(agent_curl -sS -o /dev/null -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "$ack_payload" -m 4 --connect-timeout 2 "$WORKER_URL" 2>/dev/null || echo 000)
    case "$ack_http" in ''|*[!0-9]*) local ack_http=000 ;; esac
    if [ "$ack_http" -ge 200 ] && [ "$ack_http" -lt 300 ]; then
        log_info "Traffic correction confirm sent: RX=${ack_rx}GB TX=${ack_tx}GB"
        return 0
    fi
    log_warn_debug "Traffic correction confirm failed: http=${ack_http} RX=${ack_rx}GB TX=${ack_tx}GB"
    return 1
}

apply_traffic_correction() {
    local rx_val="${1:-0}"
    local tx_val="${2:-0}"
    [ -z "$rx_val" ] && rx_val=0
    [ -z "$tx_val" ] && tx_val=0
    is_valid_correction_value "$rx_val" && is_valid_correction_value "$tx_val" || return 1
    local rx_bytes=0 tx_bytes=0
    rx_bytes=$(printf '%s' "$rx_val" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
    tx_bytes=$(printf '%s' "$tx_val" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
    local saved_rx_prev=0 saved_tx_prev=0 saved_rx_period=0 saved_tx_period=0 saved_last_check=0 saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        while IFS='=' read -r key value; do
            case "$key" in
                RX_PREV) saved_rx_prev="${value%%\"*}"; saved_rx_prev="${saved_rx_prev#\"}" ;;
                TX_PREV) saved_tx_prev="${value%%\"*}"; saved_tx_prev="${saved_tx_prev#\"}" ;;
                RX_PERIOD) saved_rx_period="${value%%\"*}"; saved_rx_period="${saved_rx_period#\"}" ;;
                TX_PERIOD) saved_tx_period="${value%%\"*}"; saved_tx_period="${saved_tx_period#\"}" ;;
                LAST_CHECK) saved_last_check="${value%%\"*}"; saved_last_check="${saved_last_check#\"}" ;;
                PERIOD_START) saved_period_start="${value%%\"*}"; saved_period_start="${saved_period_start#\"}" ;;
            esac
        done < "${TRAFFIC_DATA_FILE}"
    fi
    local now_ts
    now_ts=$(date +%s)
    saved_rx_period=${rx_bytes}
    saved_tx_period=${tx_bytes}
    log_info "Traffic correction applied: RX=${rx_val}GB (${rx_bytes} bytes) TX=${tx_val}GB (${tx_bytes} bytes)"
    mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
    cat > "${TRAFFIC_DATA_FILE}.tmp" << EOF
RX_PREV=${saved_rx_prev}
TX_PREV=${saved_tx_prev}
RX_PERIOD=${saved_rx_period}
TX_PERIOD=${saved_tx_period}
LAST_CHECK=${now_ts}
PERIOD_START=${saved_period_start}
EOF
    mv "${TRAFFIC_DATA_FILE}.tmp" "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
}

escape_json() {
    printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r' '  '
}

json_probe_value() {
    local node="${1:-}"
    local value="${2:-}"
    if [ -z "$node" ]; then
        printf 'false'
    else
        printf '"%s"' "$(escape_json "$value")"
    fi
}

safe_div() {
    local num="${1:-0}"
    local den="${2:-0}"
    local def="${3:-0}"
    if [ "${den}" -eq 0 ]; then echo "${def}"; else echo $(( num / den )); fi
}

get_net_bytes() {
    awk 'NR>2 && $1~/^(eth|en|wl)[a-z0-9]*:/{rx+=$2;tx+=$10}END{printf "%.0f %.0f\n",rx,tx}' /proc/net/dev 2>/dev/null || echo "0 0";
}

is_leap_year() {
    local ly_year=$1
    [ $((ly_year % 4)) -eq 0 ] && [ $((ly_year % 100)) -ne 0 ] || [ $((ly_year % 400)) -eq 0 ]
}

get_period_start_ts() {
    local reset_day
    reset_day=$(normalize_reset_day "${1:-1}")
    [ "$reset_day" -eq 0 ] 2>/dev/null && { echo "0"; return; }
    local now_ts="$2"
    local year month day _date_parts

    # 用 awk 将 epoch 秒转换为 year month day（UTC），避免 BusyBox date -d 不可用
    _date_parts=$(awk 'BEGIN{
        t='"${now_ts}"'; d=int(t/86400)+719468; y=int((d-122.1)/365.25);
        m=int((d-365.25*y+122.1)/30.6001); day=d-int(30.6001*(m+(m>2?1:0)-3)+1.5);
        if(m<14) m=m-1; else { m=m-13; if(m>2) y=y+1 }
        printf "%04d %02d %02d\n", y, m, day
    }')
    year=$(echo "$_date_parts" | awk '{print $1}')
    month=$(echo "$_date_parts" | awk '{print $2}')
    day=$(echo "$_date_parts" | awk '{print $3}')

    local target_day="$reset_day"

    case "$month" in
        02)
            if [ $((year % 4)) -eq 0 ] && [ $((year % 100)) -ne 0 ] || [ $((year % 400)) -eq 0 ]; then
                [ "$target_day" -gt 29 ] && target_day=29
            else
                [ "$target_day" -gt 28 ] && target_day=28
            fi
            ;;
        04|06|09|11)
            [ "$target_day" -gt 30 ] && target_day=30
            ;;
    esac

    local period_start_ts
    if [ "$day" -ge "$target_day" ]; then
        # 用 awk 将年月日转为 epoch 秒（UTC），兼容 BusyBox date -d 不可用
        period_start_ts=$(awk 'BEGIN{
            y='"${year}"'; m='"${month}"'; d='"${target_day}"';
            if(m<=2){y=y-1;m=m+12}
            A=int(y/100);B=2-A+int(A/4);
            JD=int(365.25*(y+4716))+int(30.6001*(m+1))+d+B-1524.5;
            printf "%d", (JD-2440587.5)*86400
        }')
    else
        local prev_month=$((month - 1))
        [ "$prev_month" -eq 0 ] && { prev_month=12; year=$((year - 1)); }
        local prev_month_str=$(printf "%02d" "$prev_month")
        case "$prev_month" in
            02)
                if is_leap_year "$year"; then
                    [ "$target_day" -gt 29 ] && target_day=29
                else
                    [ "$target_day" -gt 28 ] && target_day=28
                fi
                ;;
            04|06|09|11) [ "$target_day" -gt 30 ] && target_day=30 ;;
        esac
        period_start_ts=$(awk 'BEGIN{
            y='"${year}"'; m='"${prev_month}"'; d='"${target_day}"';
            if(m<=2){y=y-1;m=m+12}
            A=int(y/100);B=2-A+int(A/4);
            JD=int(365.25*(y+4716))+int(30.6001*(m+1))+d+B-1524.5;
            printf "%d", (JD-2440587.5)*86400
        }')
    fi

    echo "$period_start_ts"
}

calc_monthly_traffic() {
    local current_rx="$1"
    local current_tx="$2"
    local reset_day="${RESET_DAY:-1}"
    local now_ts
    now_ts=$(date '+%s')

    mkdir -p "${CONFIG_DIR}" 2>/dev/null || true

    local saved_rx_prev=0 saved_tx_prev=0 saved_rx_period=0 saved_tx_period=0
    local saved_last_check=0 saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        local tmp_rx_prev='' tmp_tx_prev='' tmp_rx_period='' tmp_tx_period=''
        local tmp_last_check='' tmp_period_start=''
        while IFS='=' read -r key value; do
            case "$key" in
                RX_PREV) tmp_rx_prev="$value" ;;
                TX_PREV) tmp_tx_prev="$value" ;;
                RX_PERIOD) tmp_rx_period="$value" ;;
                TX_PERIOD) tmp_tx_period="$value" ;;
                LAST_CHECK) tmp_last_check="$value" ;;
                PERIOD_START) tmp_period_start="$value" ;;
            esac
        done < "${TRAFFIC_DATA_FILE}"
        saved_rx_prev=${tmp_rx_prev:-0}; saved_tx_prev=${tmp_tx_prev:-0}
        saved_rx_period=${tmp_rx_period:-0}; saved_tx_period=${tmp_tx_period:-0}
        saved_last_check=${tmp_last_check:-0}; saved_period_start=${tmp_period_start:-0}
    fi

    local period_start_ts
    period_start_ts=$(get_period_start_ts "$reset_day" "$now_ts")

    local rx_delta=0 tx_delta=0
    if [ "$saved_last_check" -ne 0 ]; then
        if [ "$current_rx" -lt "$saved_rx_prev" ] || [ "$current_tx" -lt "$saved_tx_prev" ]; then
            rx_delta=0; tx_delta=0
        else
            rx_delta=$((current_rx - saved_rx_prev))
            tx_delta=$((current_tx - saved_tx_prev))
        fi

        if [ "$period_start_ts" -ne 0 ] && [ "$period_start_ts" -ne "$saved_period_start" ] && [ "$saved_period_start" -ne 0 ]; then
            saved_rx_period="$rx_delta"; saved_tx_period="$tx_delta"
        else
            saved_rx_period=$((saved_rx_period + rx_delta))
            saved_tx_period=$((saved_tx_period + tx_delta))
        fi
    else
        saved_rx_period=0
        saved_tx_period=0
    fi

    cat > "${TRAFFIC_DATA_FILE}.tmp" << EOF
RX_PREV=${current_rx}
TX_PREV=${current_tx}
RX_PERIOD=${saved_rx_period}
TX_PERIOD=${saved_tx_period}
LAST_CHECK=${now_ts}
PERIOD_START=${period_start_ts}
EOF
    mv "${TRAFFIC_DATA_FILE}.tmp" "${TRAFFIC_DATA_FILE}" 2>/dev/null || true

    echo "$saved_rx_period $saved_tx_period"
}

get_cpu_stat() {
    awk '/^cpu /{total=$2+$3+$4+$5+$6+$7+$8+$9;idle=$5+$6;printf "%.0f %.0f\n",total,idle}' /proc/stat 2>/dev/null || echo "0 0";
}

get_time_ms() {
    local ts
    ts=$(date +%s%3N 2>/dev/null || true)
    case "${ts}" in
        ''|*[!0-9]*) ;;
        ?????????????) echo "${ts}"; return 0 ;;
        ??????????????*) echo "${ts:0:13}"; return 0 ;;
    esac

    ts=$(date +%s%N 2>/dev/null || true)
    case "${ts}" in
        ''|*[!0-9]*) ;;
        ???????????????????) echo "${ts:0:13}"; return 0 ;;
    esac

    if command -v perl >/dev/null 2>&1; then
        perl -MTime::HiRes=time -e 'printf "%.0f\n", time() * 1000' 2>/dev/null && return 0
    fi
    return 1
}

has_nc_zero_io() {
    command -v nc >/dev/null 2>&1 || return 1
    nc -h 2>&1 | grep -q -e '-z' || return 1
    nc -h 2>&1 | grep -q -e '-w' || return 1
}

get_tcp_ping_nc() {
    local host="${1:-}"
    local port="${2:-443}"
    local start end ms

    start=$(get_time_ms) || return 1
    if nc -z -w 2 "${host}" "${port}" >/dev/null 2>&1; then
        end=$(get_time_ms) || return 1
        ms=$((end - start))
        [ "${ms}" -lt 1 ] && ms=1
        echo "${ms}"
        return 0
    fi
    return 1
}

split_probe_target() (
    target="${1:-}"
    default_port="${2:-443}"
    probe_host="$target"
    probe_port="$default_port"

    case "$target" in
        ''|*[!A-Za-z0-9._:-]*) exit 1 ;;
        *:*)
            case "${target#*:}" in *:*) exit 1 ;; esac
            probe_host="${target%:*}"
            probe_port="${target##*:}"
            ;;
    esac

    case "$probe_host" in ''|-*) exit 1 ;; esac
    case "$probe_port" in ''|*[!0-9]*|??????*) exit 1 ;; esac
    [ "$probe_port" -ge 1 ] && [ "$probe_port" -le 65535 ] || exit 1

    printf '%s %s\n' "$probe_host" "$probe_port"
)

get_probe() {
    local target="${1:-}"
    local count="${2:-4}"
    local port="${3:-443}"

    if [ -z "$target" ]; then
        echo "null 100"
        return
    fi

    local host probe_target
    if ! probe_target=$(split_probe_target "$target" "$port"); then
        echo "null 100"
        return
    fi
    host="${probe_target% *}"
    port="${probe_target##* }"

    if has_nc_zero_io && get_time_ms >/dev/null 2>&1; then
        local ok=0 values="" i=1 rtt
        while [ "$i" -le "$count" ]; do
            rtt=$(get_tcp_ping_nc "$host" "$port" 2>/dev/null)
            if [ -n "$rtt" ]; then
                ok=$((ok + 1))
                values="$values $rtt"
            fi
            i=$((i + 1))
        done
        if [ "$ok" -gt 0 ]; then
            local sorted median_val n=$ok
            sorted=$(echo "$values" | tr ' ' '\n' | grep -v '^$' | sort -n)
            if [ $((n % 2)) -eq 1 ]; then
                median_val=$(echo "$sorted" | sed -n "$(( (n + 1) / 2 ))p")
            else
                local a b
                a=$(echo "$sorted" | sed -n "$(( n / 2 ))p")
                b=$(echo "$sorted" | sed -n "$(( n / 2 + 1 ))p")
                median_val=$(( (a + b) / 2 ))
            fi
            echo "$median_val $(( (count - ok) * 100 / count ))"
        else
            echo "null 100"
        fi
        return
    fi

    local icmp_out
    icmp_out=$(ping -c "$count" -W 2 "$host" 2>/dev/null)
    local avg_rtt loss
    avg_rtt=$(echo "$icmp_out" | awk -F'[/ ]' '/^rtt/{print $8}' | cut -d. -f1)
    loss=$(echo "$icmp_out" | awk '/packet loss/{for(i=1;i<=NF;i++) if($i~/[0-9]+%/){gsub(/%/,"",$i);printf "%d",$i;exit}}')
    [ -z "$avg_rtt" ] && avg_rtt="null"
    [ -z "$loss" ] && loss=100
    echo "$avg_rtt $loss"
}

CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"

write_probe_result() {
    local dest="$1"
    shift
    local tmp="${dest}.tmp"
    rm -f "$tmp"
    "$@" > "$tmp" 2>/dev/null || true
    if [ -s "$tmp" ]; then
        mv "$tmp" "$dest"
    else
        rm -f "$tmp" "$dest"
    fi
}

refresh_probe_async() {
    [ -n "$CT_NODE" ] && write_probe_result /tmp/.cf_probe_ct get_probe "$CT_NODE" 4 443 &
    [ -n "$CU_NODE" ] && write_probe_result /tmp/.cf_probe_cu get_probe "$CU_NODE" 4 443 &
    [ -n "$CM_NODE" ] && write_probe_result /tmp/.cf_probe_cm get_probe "$CM_NODE" 4 443 &
    [ -n "$BD_NODE" ] && write_probe_result /tmp/.cf_probe_bd get_probe "$BD_NODE" 4 443 &
    wait
}

run_network_worker() {
    set -eu
    last_ip=0
    last_probe=0
    probe_interval="${REPORT_INTERVAL:-60}"
    case "$probe_interval" in ''|*[!0-9]*) probe_interval=60 ;; esac
    [ "$probe_interval" -lt 30 ] && probe_interval=30
    [ "$probe_interval" -gt 60 ] && probe_interval=60

    while true; do
        now=$(date +%s)

        if [ $((now - last_ip)) -ge 600 ] || [ "$last_ip" -eq 0 ]; then
            local direct_trace direct_trace_v6 direct_region
            direct_trace=$(direct_cf_trace 4 || true)
            direct_trace_v6=$(direct_cf_trace 6 || true)
            (printf '%s\n' "$direct_trace" | grep -q '^ip=' && echo "1" || echo "0") > /tmp/.cf_ipv4.tmp && mv /tmp/.cf_ipv4.tmp /tmp/.cf_ipv4 || true
            direct_region=$(printf '%s\n' "$direct_trace" | awk -F= '$1 == "loc" && $2 ~ /^[A-Za-z][A-Za-z]$/ { print toupper($2); exit }')
            case "$direct_region" in
                [A-Z][A-Z]) ;;
                *) direct_region=$(printf '%s\n' "$direct_trace_v6" | awk -F= '$1 == "loc" && $2 ~ /^[A-Za-z][A-Za-z]$/ { print toupper($2); exit }') ;;
            esac
            case "$direct_region" in [A-Z][A-Z]) ;; *) direct_region="" ;; esac
            printf '%s\n' "$direct_region" > /tmp/.cf_region.tmp && mv /tmp/.cf_region.tmp /tmp/.cf_region || true
            (printf '%s\n' "$direct_trace_v6" | grep -q '^ip=' && echo "1" || echo "0") > /tmp/.cf_ipv6.tmp && mv /tmp/.cf_ipv6.tmp /tmp/.cf_ipv6 || true
            last_ip="$now"
        fi

        if [ $((now - last_probe)) -ge "$probe_interval" ] || [ "$last_probe" -eq 0 ]; then
            refresh_probe_async
            last_probe="$now"
        fi
        sleep 5
    done
}

NET_STAT=$(get_net_bytes)
RX_PREV=$(echo "$NET_STAT" | awk '{print $1}'); RX_PREV=${RX_PREV:-0}
TX_PREV=$(echo "$NET_STAT" | awk '{print $2}'); TX_PREV=${TX_PREV:-0}

CPU_STAT=$(get_cpu_stat)
PREV_CPU_TOTAL=$(echo "$CPU_STAT" | awk '{print $1}'); PREV_CPU_TOTAL=${PREV_CPU_TOTAL:-0}
PREV_CPU_IDLE=$(echo "$CPU_STAT" | awk '{print $2}'); PREV_CPU_IDLE=${PREV_CPU_IDLE:-0}

PREV_LOOP_TIME=$(date +%s)

echo "[INFO] CF-Server-Monitor Probe Engine Started Successfully."

run_network_worker &
WORKER_PID=$!
SAMPLES_JSON=""
SAMPLE_COUNT=0
LAST_REPORT_TIME=0

while true; do
    LOOP_START_TIME=$(date +%s)
    rotate_log_if_needed "$PROBE_LOG_FILE"

    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
        run_network_worker &
        WORKER_PID=$!
    fi

    MEM_TOTAL_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_TOTAL_KB=${MEM_TOTAL_KB:-0}
    MEM_AVAIL_KB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_AVAIL_KB=${MEM_AVAIL_KB:-0}
    if [ "${MEM_AVAIL_KB}" -eq 0 ]; then
        MEM_FREE_KB=$(awk '/^MemFree:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_FREE_KB=${MEM_FREE_KB:-0}
        MEM_BUFF_KB=$(awk '/^Buffers:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_BUFF_KB=${MEM_BUFF_KB:-0}
        MEM_CACH_KB=$(awk '/^Cached:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_CACH_KB=${MEM_CACH_KB:-0}
        MEM_AVAIL_KB=$((MEM_FREE_KB + MEM_BUFF_KB + MEM_CACH_KB))
    fi
    RAM_TOTAL=$((MEM_TOTAL_KB / 1024))
    RAM_USED=$(((MEM_TOTAL_KB - MEM_AVAIL_KB) / 1024))
    [ "${RAM_USED}" -lt 0 ] && RAM_USED=0

    SWAP_TOTAL_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); SWAP_TOTAL_KB=${SWAP_TOTAL_KB:-0}
    SWAP_FREE_KB=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); SWAP_FREE_KB=${SWAP_FREE_KB:-0}
    SWAP_TOTAL=$((SWAP_TOTAL_KB / 1024))
    SWAP_USED=$(((SWAP_TOTAL_KB - SWAP_FREE_KB) / 1024))
    [ "${SWAP_USED}" -lt 0 ] && SWAP_USED=0

    DISK_INFO=$(df -P / 2>/dev/null | tail -n1 || echo "")
    DISK_TOTAL=0; DISK_USED=0
    if [ -n "${DISK_INFO}" ]; then
        DISK_TOTAL=$(echo "${DISK_INFO}" | awk '{print int($2/1024)}')
        DISK_USED=$(echo "${DISK_INFO}" | awk '{print int($3/1024)}')
    fi

    CPU_STAT=$(get_cpu_stat)
    CPU_TOTAL_NOW=$(echo "$CPU_STAT" | awk '{print $1}'); CPU_TOTAL_NOW=${CPU_TOTAL_NOW:-0}
    CPU_IDLE_NOW=$(echo "$CPU_STAT" | awk '{print $2}'); CPU_IDLE_NOW=${CPU_IDLE_NOW:-0}
    DIFF_TOTAL=$((CPU_TOTAL_NOW - PREV_CPU_TOTAL))
    DIFF_IDLE=$((CPU_IDLE_NOW - PREV_CPU_IDLE))

    if [ "${DIFF_TOTAL}" -le 0 ]; then
        CPU="0.00"
    else
        CPU=$(awk -v t="${DIFF_TOTAL}" -v i="${DIFF_IDLE}" 'BEGIN {p=(1-i/t)*100; if(p<0)p=0; if(p>100)p=100; printf "%.2f", p}')
    fi
    PREV_CPU_TOTAL=${CPU_TOTAL_NOW}
    PREV_CPU_IDLE=${CPU_IDLE_NOW}

    if [ -f /etc/os-release ]; then
        OS_RAW=$(grep -E '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'")
    else
        OS_RAW=$(uname -srm)
    fi
    OS=${OS_RAW:-"OpenWrt"}
    ARCH=$(uname -m)
    BOOT_TIME=$(awk '$1=="btime"{print $2}' /proc/stat 2>/dev/null)
    if [ -n "${BOOT_TIME:-}" ]; then
        BOOT_TIME=$((BOOT_TIME * 1000))
    else
        uptime_sec=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
        now_sec=$(date +%s)

        if [ "$uptime_sec" -gt 0 ] 2>/dev/null; then
            BOOT_TIME=$(( (now_sec - uptime_sec) * 1000 ))
        else
            BOOT_TIME=0
        fi
    fi
    CPU_INFO=$(grep -m 1 'model name' /proc/cpuinfo 2>/dev/null | awk -F: '{print $2}' | xargs || echo "")
    [ -z "${CPU_INFO}" ] && CPU_INFO=${ARCH}
    CPU_CORES=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "1")
    LOAD_AVG=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}' || echo "0 0 0")
    PROCESSES=$(ps -e 2>/dev/null | wc -l || echo 0)

    TCP_CONN=""
    if command -v ss >/dev/null 2>&1; then
        TCP_CONN=$(ss -H -ant state established 2>/dev/null | wc -l)
    else
        TCP_CONN=$(awk 'NR>1 && $4=="01"{c++} END{print c+0}' /proc/net/tcp 2>/dev/null)
    fi
    TCP_CONN=$(printf "%s" "${TCP_CONN:-0}" | tr -d '\r\n ')

    UDP_CONN=""
    if command -v ss >/dev/null 2>&1; then
        UDP_CONN=$(ss -H -anu 2>/dev/null | wc -l)
    else
        UDP_CONN=$(awk 'NR>1{c++} END{print c+0}' /proc/net/udp 2>/dev/null)
    fi
    UDP_CONN=$(printf "%s" "${UDP_CONN:-0}" | tr -d '\r\n ')

    NET_STAT=$(get_net_bytes)
    RX_NOW=$(echo "$NET_STAT" | awk '{print $1}'); RX_NOW=${RX_NOW:-0}
    TX_NOW=$(echo "$NET_STAT" | awk '{print $2}'); TX_NOW=${TX_NOW:-0}

    MONTHLY_TRAFFIC=$(calc_monthly_traffic "$RX_NOW" "$TX_NOW")
    RX_MONTHLY=$(echo "$MONTHLY_TRAFFIC" | awk '{print $1}')
    TX_MONTHLY=$(echo "$MONTHLY_TRAFFIC" | awk '{print $2}')

    TIME_DELTA=$((LOOP_START_TIME - PREV_LOOP_TIME))
    [ "${TIME_DELTA}" -le 0 ] && TIME_DELTA=${ACTIVE_INTERVAL}

    RX_DELTA=$((RX_NOW - RX_PREV))
    TX_DELTA=$((TX_NOW - TX_PREV))
    [ "${RX_DELTA}" -lt 0 ] && RX_DELTA=0
    [ "${TX_DELTA}" -lt 0 ] && TX_DELTA=0

    RX_SPEED=$(safe_div "${RX_DELTA}" "${TIME_DELTA}" "0")
    TX_SPEED=$(safe_div "${TX_DELTA}" "${TIME_DELTA}" "0")

    RX_PREV=${RX_NOW}
    TX_PREV=${TX_NOW}
    PREV_LOOP_TIME=${LOOP_START_TIME}

    [ -f /tmp/.cf_ipv4 ] && IPV4=$(cat /tmp/.cf_ipv4) || IPV4="0"
    [ -f /tmp/.cf_ipv6 ] && IPV6=$(cat /tmp/.cf_ipv6) || IPV6="0"
    [ -f /tmp/.cf_region ] && AGENT_REGION=$(cat /tmp/.cf_region) || AGENT_REGION=""
    case "$AGENT_REGION" in [A-Z][A-Z]) ;; *) AGENT_REGION="" ;; esac
    if [ -f /tmp/.cf_probe_ct ]; then _p=$(cat /tmp/.cf_probe_ct); PING_CT=${_p%% *}; LOSS_CT=${_p##* }; else PING_CT=""; LOSS_CT=""; fi
    if [ -f /tmp/.cf_probe_cu ]; then _p=$(cat /tmp/.cf_probe_cu); PING_CU=${_p%% *}; LOSS_CU=${_p##* }; else PING_CU=""; LOSS_CU=""; fi
    if [ -f /tmp/.cf_probe_cm ]; then _p=$(cat /tmp/.cf_probe_cm); PING_CM=${_p%% *}; LOSS_CM=${_p##* }; else PING_CM=""; LOSS_CM=""; fi
    if [ -f /tmp/.cf_probe_bd ]; then _p=$(cat /tmp/.cf_probe_bd); PING_BD=${_p%% *}; LOSS_BD=${_p##* }; else PING_BD=""; LOSS_BD=""; fi

    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")
    PING_CT_JSON=$(json_probe_value "$CT_NODE" "$PING_CT")
    PING_CU_JSON=$(json_probe_value "$CU_NODE" "$PING_CU")
    PING_CM_JSON=$(json_probe_value "$CM_NODE" "$PING_CM")
    PING_BD_JSON=$(json_probe_value "$BD_NODE" "$PING_BD")
    LOSS_CT_JSON=$(json_probe_value "$CT_NODE" "$LOSS_CT")
    LOSS_CU_JSON=$(json_probe_value "$CU_NODE" "$LOSS_CU")
    LOSS_CM_JSON=$(json_probe_value "$CM_NODE" "$LOSS_CM")
    LOSS_BD_JSON=$(json_probe_value "$BD_NODE" "$LOSS_BD")

    METRICS_JSON=$(cat <<EOF
{"cpu":"$CPU","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","disk_total":"$DISK_TOTAL","disk_used":"$DISK_USED","load_avg":"$LOAD_AVG","boot_time":"$BOOT_TIME","net_rx":"$RX_NOW","net_tx":"$TX_NOW","net_rx_monthly":"$RX_MONTHLY","net_tx_monthly":"$TX_MONTHLY","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED","os":"$EOS","arch":"$EARCH","cpu_info":"$ECPU","cpu_cores":"$CPU_CORES","processes":"$PROCESSES","tcp_conn":"$TCP_CONN","udp_conn":"$UDP_CONN","ip_v4":"$IPV4","ip_v6":"$IPV6","ping_ct":$PING_CT_JSON,"ping_cu":$PING_CU_JSON,"ping_cm":$PING_CM_JSON,"ping_bd":$PING_BD_JSON,"loss_ct":$LOSS_CT_JSON,"loss_cu":$LOSS_CU_JSON,"loss_cm":$LOSS_CM_JSON,"loss_bd":$LOSS_BD_JSON}
EOF
)
    if [ "$COLLECT_INTERVAL" -gt 0 ]; then
        SAMPLE_TS=$((LOOP_START_TIME * 1000))
        SAMPLE_JSON="{\"ts\":$SAMPLE_TS,\"metrics\":$METRICS_JSON}"
        if [ -z "$SAMPLES_JSON" ]; then
            SAMPLES_JSON="$SAMPLE_JSON"
        else
            SAMPLES_JSON="$SAMPLES_JSON,$SAMPLE_JSON"
        fi
        SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
    fi

    if [ "$LAST_REPORT_TIME" -eq 0 ] || [ $((LOOP_START_TIME - LAST_REPORT_TIME)) -ge "$REPORT_INTERVAL" ]; then
        if [ "$COLLECT_INTERVAL" -gt 0 ]; then
            PAYLOAD=$(cat <<EOF
{"id":"$SERVER_ID","secret":"$SECRET","agent_region":"$AGENT_REGION","metrics":$METRICS_JSON,"samples":[$SAMPLES_JSON],"collect_interval":$COLLECT_INTERVAL,"report_interval":$REPORT_INTERVAL}
EOF
)
        else
            PAYLOAD=$(cat <<EOF
{"id":"$SERVER_ID","secret":"$SECRET","agent_region":"$AGENT_REGION","metrics":$METRICS_JSON,"collect_interval":$COLLECT_INTERVAL,"report_interval":$REPORT_INTERVAL}
EOF
)
        fi
        REPORT_RESPONSE_FILE="/tmp/.cf_probe_response.$$"
        REPORT_HEADER_FILE="/tmp/.cf_probe_headers.$$"
        REPORT_HTTP_CODE=$(agent_curl -sS -D "$REPORT_HEADER_FILE" -o "$REPORT_RESPONSE_FILE" -w "%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -H "X-Agent-Config-Schema: 2" \
            -H "X-Agent-Version: ${AGENT_VERSION}" \
            -H "X-Agent-Config-Md5: ${CONFIG_MD5:-none}" \
            -d "$PAYLOAD" -m 8 --connect-timeout 3 "$WORKER_URL" 2>/dev/null || echo 000)
        case "$REPORT_HTTP_CODE" in ''|*[!0-9]*) REPORT_HTTP_CODE=000 ;; esac
        if [ "$REPORT_HTTP_CODE" = "200" ]; then
            apply_remote_config "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" || true
        fi
        rm -f "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" 2>/dev/null || true
        SAMPLES_JSON=""
        SAMPLE_COUNT=0
        LAST_REPORT_TIME=$LOOP_START_TIME
    fi

    sleep "${ACTIVE_INTERVAL}"
done
PROBE_EOF

    chmod +x "${SCRIPT_FILE}"
    info "探针脚本注入完成: ${SCRIPT_FILE}"
}

# ---------------------------------------------------------------
# 创建 procd 服务脚本 / 手动启停入口
# ---------------------------------------------------------------
create_service() {
    exec_line="/bin/sh \"${SCRIPT_FILE}\""

    if [ "$INIT_SYSTEM" = "procd" ]; then
        step "构建 procd init 脚本..."
        cat > "${PROCD_FILE}" << EOF
#!/bin/sh /etc/rc.common

# CF-Server-Monitor Probe Agent (OpenWrt / procd)
# 自动生成，请勿直接修改。

START=99
STOP=15

USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /bin/sh "${SCRIPT_FILE}"
    procd_set_param respawn 3600 5 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param pidfile "${PID_FILE}"
    procd_close_instance
}

stop_service() {
    rm -f "${PID_FILE}"
}

service_triggers() {
    procd_add_reload_trigger "${SERVICE_NAME}"
}
EOF
        chmod +x "${PROCD_FILE}"
        info "procd 服务脚本生成: ${PROCD_FILE}"
    elif [ "$INIT_SYSTEM" = "openrc" ]; then
        step "构建 OpenRC init 脚本..."
        cat > "${PROCD_FILE}" << EOF
#!/sbin/openrc-run
# CF-Server-Monitor Probe Agent (ImmortalWrt / OpenRC)

description="CF Server Monitor Probe Agent"
command="/bin/sh"
command_args="${SCRIPT_FILE}"
command_background="yes"
pidfile="${PID_FILE}"
output_log="${LOG_FILE}"
error_log="${LOG_FILE}"

depend() {
    need net
    use dns
    after firewall
}
EOF
        chmod +x "${PROCD_FILE}"
        info "OpenRC 服务脚本生成: ${PROCD_FILE}"
    else
        step "非 procd/OpenRC 环境 — 将使用手动后台进程方式运行..."
        info "启停命令将写入: ${SCRIPT_FILE}.ctl"
    fi

    echo "#!/bin/sh
# CF-Server-Monitor 手动启停脚本（OpenWrt 兼容）
START_CMD=\"${exec_line} >> ${LOG_FILE} 2>&1 &\"
PID_FILE='${PID_FILE}'
LOG_FILE='${LOG_FILE}'

case \"\${1:-start}\" in
    start)
        if command -v pgrep >/dev/null 2>&1 && pgrep -f '${SERVICE_NAME}.sh' >/dev/null 2>&1; then
            echo '探针已在运行。'
            exit 0
        fi
        nohup ${exec_line} >> \$LOG_FILE 2>&1 &
        echo \$! > \$PID_FILE
        disown >/dev/null 2>&1 || true
        echo '探针已启动（PID: '\"\$(cat \$PID_FILE)\"'）'
        ;;
    stop)
        if command -v pkill >/dev/null 2>&1; then
            pkill -9 -f '${SERVICE_NAME}.sh' >/dev/null 2>&1 || true
        elif [ -f \"\$PID_FILE\" ]; then
            PID=\$(cat \$PID_FILE)
            kill -TERM \$PID >/dev/null 2>&1 || true
            sleep 1
            kill -9 \$PID >/dev/null 2>&1 || true
        fi
        rm -f \$PID_FILE
        echo '探针已停止。'
        ;;
    status)
        if command -v pgrep >/dev/null 2>&1 && pgrep -f '${SERVICE_NAME}.sh' >/dev/null 2>&1; then
            echo '运行中'
        elif [ -f \"\$PID_FILE\" ] && kill -0 \"\$(cat \$PID_FILE)\" >/dev/null 2>&1; then
            echo '运行中（PID: '\"\$(cat \$PID_FILE)\"'）'
        else
            echo '未运行'
        fi
        ;;
    restart)
        \$0 stop
        sleep 1
        \$0 start
        ;;
    log)
        tail -f \$LOG_FILE
        ;;
    *)
        echo '用法: \$0 {start|stop|status|restart|log}'
        exit 1
        ;;
esac
" > "${SCRIPT_FILE}.ctl"
    chmod +x "${SCRIPT_FILE}.ctl"
}

# ---------------------------------------------------------------
# 启动服务
# ---------------------------------------------------------------
start_service() {
    step "加载进程树并激活监控探针..."

    if [ "$INIT_SYSTEM" = "procd" ]; then
        "$PROCD_FILE" enable >/dev/null 2>&1 || true
        "$PROCD_FILE" restart || error "procd 服务启动失败，请检查日志: tail -n 30 ${LOG_FILE}"
    elif [ "$INIT_SYSTEM" = "openrc" ]; then
        rc-update add "${SERVICE_NAME}" default >/dev/null 2>&1 || true
        rc-service "${SERVICE_NAME}" restart || error "OpenRC 服务启动失败，请检查日志: tail -n 30 ${LOG_FILE}"
    else
        sh "${SCRIPT_FILE}.ctl" start || error "后台进程启动失败，请检查日志: tail -n 30 ${LOG_FILE}"
    fi

    sleep 2

    service_running=0
    if command -v pgrep >/dev/null 2>&1 && pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        service_running=1
    elif [ "$INIT_SYSTEM" = "procd" ] && command -v ubus >/dev/null 2>&1 && ubus call service list 2>/dev/null | grep -q "\"${SERVICE_NAME}\""; then
        service_running=1
    elif [ "$INIT_SYSTEM" = "procd" ] && [ -f "$PROCD_FILE" ] && "$PROCD_FILE" status >/dev/null 2>&1; then
        service_running=1
    elif [ "$INIT_SYSTEM" = "openrc" ] && rc-service "${SERVICE_NAME}" status >/dev/null 2>&1; then
        service_running=1
    elif [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        service_running=1
    fi

    if [ "$service_running" -eq 1 ]; then
        info "探针监控引擎已进入平稳运行状态。"
    else
        warn "探针服务可能未启动成功。请排查: tail -n 30 ${LOG_FILE}"
        case "$INIT_SYSTEM" in
            procd) warn "在 OpenWrt 上可执行: ${PROCD_FILE} status" ;;
            openrc) warn "在 OpenRC 上可执行: rc-service ${SERVICE_NAME} status" ;;
        esac
    fi
}

# ---------------------------------------------------------------
# 安装主流程
# ---------------------------------------------------------------
install_probe() {
    SERVER_ID=""
    SECRET=""
    WORKER_URL=""
    BASE_URL=""
    PROXY_URL=""
    COLLECT_INTERVAL=""
    REPORT_INTERVAL=""
    CT_NODE=""
    CU_NODE=""
    CM_NODE=""
    BD_NODE=""
    RESET_DAY=""
    AUTO_UPDATE=""
    RX_CORRECTION=""
    TX_CORRECTION=""

    for arg in "$@"; do
        case "$arg" in
            -id=*) SERVER_ID="${arg#-id=}" ;;
            -secret=*) SECRET="${arg#-secret=}" ;;
            -url=*) WORKER_URL="${arg#-url=}" ;;
            -base_url=*) BASE_URL="${arg#-base_url=}" ;;
            -proxy_url=*) PROXY_URL="${arg#-proxy_url=}" ;;
            -collect_interval=*|-collect=*) COLLECT_INTERVAL="${arg#*=}" ;;
            -interval=*) REPORT_INTERVAL="${arg#-interval=}" ;;
            -ct=*) CT_NODE="${arg#-ct=}" ;;
            -cu=*) CU_NODE="${arg#-cu=}" ;;
            -cm=*) CM_NODE="${arg#-cm=}" ;;
            -bd=*) BD_NODE="${arg#-bd=}" ;;
            -reset_day=*) RESET_DAY="${arg#-reset_day=}" ;;
            -auto_update=*|-auto-update=*) AUTO_UPDATE=$(normalize_binary_value "${arg#*=}") || error "auto_update 参数非法，仅支持 0 或 1" ;;
            -rx_correction=*) RX_CORRECTION="${arg#-rx_correction=}" ;;
            -tx_correction=*) TX_CORRECTION="${arg#-tx_correction=}" ;;
        esac
    done

    [ -z "$BASE_URL" ] && BASE_URL=$(derive_base_url "$WORKER_URL")
    BASE_URL=${BASE_URL%/}
    [ -n "$BASE_URL" ] && WORKER_URL="${BASE_URL}/update"

    print_banner
    check_root
    detect_os
    install_deps

    stop_old_service

    if [ -f "${CONFIG_FILE}" ]; then
        step "检测到已有配置文件，执行二次安装..."
        
        if [ -n "${SERVER_ID}" ] && [ -n "${SECRET}" ] && [ -n "${WORKER_URL}" ]; then
            COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
            REPORT_INTERVAL=${REPORT_INTERVAL:-60}
            [ -z "$RESET_DAY" ] && RESET_DAY=1
            normalize_probe_config
            AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"
            
            step "更新配置文件..."
            cat > "${CONFIG_FILE}" << EOF
SERVER_ID="${SERVER_ID}"
SECRET="${SECRET}"
WORKER_URL="${WORKER_URL}"
BASE_URL="${BASE_URL}"
PROXY_URL="${PROXY_URL}"
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
RESET_DAY="${RESET_DAY}"
AUTO_UPDATE="${AUTO_UPDATE}"
CONFIG_MD5="none"
EOF
            chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
            info "配置文件已更新: ${CONFIG_FILE}"
        else
            step "从配置文件读取参数..."
            while IFS='=' read -r key value; do
                case "$key" in
                    SERVER_ID) SERVER_ID="${value%\"}"; SERVER_ID="${SERVER_ID#\"}" ;;
                    SECRET) SECRET="${value%\"}"; SECRET="${SECRET#\"}" ;;
                    WORKER_URL) WORKER_URL="${value%\"}"; WORKER_URL="${WORKER_URL#\"}" ;;
                    BASE_URL) BASE_URL="${value%\"}"; BASE_URL="${BASE_URL#\"}" ;;
                    PROXY_URL) PROXY_URL="${value%\"}"; PROXY_URL="${PROXY_URL#\"}" ;;
                    COLLECT_INTERVAL) COLLECT_INTERVAL="${value%\"}"; COLLECT_INTERVAL="${COLLECT_INTERVAL#\"}" ;;
                    REPORT_INTERVAL) REPORT_INTERVAL="${value%\"}"; REPORT_INTERVAL="${REPORT_INTERVAL#\"}" ;;
                    CT_NODE) CT_NODE="${value%\"}"; CT_NODE="${CT_NODE#\"}" ;;
                    CU_NODE) CU_NODE="${value%\"}"; CU_NODE="${CU_NODE#\"}" ;;
                    CM_NODE) CM_NODE="${value%\"}"; CM_NODE="${CM_NODE#\"}" ;;
                    BD_NODE) BD_NODE="${value%\"}"; BD_NODE="${BD_NODE#\"}" ;;
                    RESET_DAY) RESET_DAY="${value%\"}"; RESET_DAY="${RESET_DAY#\"}" ;;
                    AUTO_UPDATE) AUTO_UPDATE="${value%\"}"; AUTO_UPDATE="${AUTO_UPDATE#\"}" ;;
                esac
            done < "${CONFIG_FILE}"
            [ -z "$BASE_URL" ] && BASE_URL=$(derive_base_url "$WORKER_URL")
            BASE_URL=${BASE_URL%/}
            [ -n "$BASE_URL" ] && WORKER_URL="${BASE_URL}/update"
        fi
    else
        if [ -z "${SERVER_ID}" ] || [ -z "${SECRET}" ] || [ -z "${WORKER_URL}" ]; then
            print_usage
        fi

        COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
        REPORT_INTERVAL=${REPORT_INTERVAL:-60}
        [ -z "$RESET_DAY" ] && RESET_DAY=1
        normalize_probe_config
        AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"

        step "创建配置目录..."
        mkdir -p "${CONFIG_DIR}" 2>/dev/null || true

        if [ -f "${OLD_TRAFFIC_DATA_FILE}" ]; then
            step "迁移旧流量数据..."
            mv "${OLD_TRAFFIC_DATA_FILE}" "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
            rm -rf /var/lib/cf-probe 2>/dev/null || true
            info "已从旧路径迁移流量数据"
        elif [ ! -f "${TRAFFIC_DATA_FILE}" ]; then
            touch "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
            info "创建新流量数据文件"
        fi

        step "生成配置文件..."
        cat > "${CONFIG_FILE}" << EOF
SERVER_ID="${SERVER_ID}"
SECRET="${SECRET}"
WORKER_URL="${WORKER_URL}"
BASE_URL="${BASE_URL}"
PROXY_URL="${PROXY_URL}"
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
RESET_DAY="${RESET_DAY}"
AUTO_UPDATE="${AUTO_UPDATE}"
CONFIG_MD5="none"
EOF
        chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
        info "配置文件已生成: ${CONFIG_FILE}"
    fi

    COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
    REPORT_INTERVAL=${REPORT_INTERVAL:-60}
    normalize_probe_config
    AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"

    if [ -n "${RX_CORRECTION}" ] || [ -n "${TX_CORRECTION}" ]; then
        step "应用流量校正..."
        rm -f "${OLD_TRAFFIC_DATA_FILE}" 2>/dev/null || true
        
        mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
        now_ts=$(date '+%s')
        rx_correction_bytes=0; tx_correction_bytes=0
        current_rx=$(awk 'NR>2 && $1~/^(eth|en|wl)[a-z0-9]*:/{rx+=$2}END{printf "%.0f", rx}' /proc/net/dev 2>/dev/null || echo 0)
        current_tx=$(awk 'NR>2 && $1~/^(eth|en|wl)[a-z0-9]*:/{tx+=$10}END{printf "%.0f", tx}' /proc/net/dev 2>/dev/null || echo 0)
        [ -n "${RX_CORRECTION}" ] && rx_correction_bytes=$(echo "${RX_CORRECTION}" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
        [ -n "${TX_CORRECTION}" ] && tx_correction_bytes=$(echo "${TX_CORRECTION}" | awk '{printf "%.0f", $1 * 1024 * 1024 * 1024}')
        [ -n "${RX_CORRECTION}" ] && info "下行流量校正: ${RX_CORRECTION}GB"
        [ -n "${TX_CORRECTION}" ] && info "上行流量校正: ${TX_CORRECTION}GB"
        
        cat > "${TRAFFIC_DATA_FILE}" << EOF
RX_PREV=${current_rx}
TX_PREV=${current_tx}
RX_PERIOD=${rx_correction_bytes}
TX_PERIOD=${tx_correction_bytes}
LAST_CHECK=${now_ts}
PERIOD_START=0
EOF
    fi

    create_script
    create_service
    start_service

    printf '\n%b=============================================%b\n' "${GREEN}" "${NC}"
    printf  '         CF-Server-Monitor %s 安装成功\n' "${AGENT_VERSION}"
    printf  '%b=============================================%b\n' "${GREEN}" "${NC}"
    printf  '  服务状态 : %bActive (Running)%b\n' "${GREEN}" "${NC}"
    printf  '  配置参数 :\n'
    printf  '    ● Server ID   : %s\n' "${SERVER_ID}"
    printf  '    ● Secret      : %s\n' "********"
    printf  '    ● Base URL    : %s\n' "${BASE_URL}"
    printf  '    ● Proxy       : %s\n' "$(masked_proxy_url "${PROXY_URL}")"
    printf  '    ● 上报间隔    : %s秒\n' "${REPORT_INTERVAL}"
    printf  '    ● 采样间隔    : %s秒\n' "${COLLECT_INTERVAL}"
    printf  '    ● 自动更新    : %s\n' "${AUTO_UPDATE}"
    [ -n "${RX_CORRECTION}" ] && printf  '    ● 下行校正    : %sGB\n' "${RX_CORRECTION}"
    [ -n "${TX_CORRECTION}" ] && printf  '    ● 上行校正    : %sGB\n' "${TX_CORRECTION}"
    if [ "${RESET_DAY}" = "0" ]; then
        printf  '    ● 流量重置日  : 不重置\n'
    else
        printf  '    ● 流量重置日  : %s号\n' "${RESET_DAY}"
    fi
    [ -n "${CT_NODE}" ] && printf  '    ● CT节点      : %s\n' "${CT_NODE}"
    [ -n "${CU_NODE}" ] && printf  '    ● CU节点      : %s\n' "${CU_NODE}"
    [ -n "${CM_NODE}" ] && printf  '    ● CM节点      : %s\n' "${CM_NODE}"
    [ -n "${BD_NODE}" ] && printf  '    ● BD节点      : %s\n' "${BD_NODE}"
    printf  '  运行模式 : '
    case "$INIT_SYSTEM" in
        procd) echo "procd 系统服务 (${PROCD_FILE})" ;;
        openrc) echo "OpenRC 系统服务 (${PROCD_FILE})" ;;
        *)     if [ -f "$PID_FILE" ]; then echo "手动后台进程 (PID: $(cat "$PID_FILE"))"; else echo "手动后台进程"; fi ;;
    esac
    printf  '  管理指令 :\n'
    if [ "$INIT_SYSTEM" = "procd" ]; then
        printf  '    ● 查看日志     : tail -f %s\n' "${LOG_FILE}"
        printf  '    ● 查看状态     : %s status\n' "${PROCD_FILE}"
        printf  '    ● 启动/停止    : %s {start|stop|restart}\n' "${PROCD_FILE}"
    elif [ "$INIT_SYSTEM" = "openrc" ]; then
        printf  '    ● 查看日志     : tail -f %s\n' "${LOG_FILE}"
        printf  '    ● 查看状态     : rc-service %s status\n' "${SERVICE_NAME}"
        printf  '    ● 启动/停止    : rc-service %s {start|stop|restart}\n' "${SERVICE_NAME}"
    else
        printf  '    ● 查看日志     : tail -f %s\n' "${LOG_FILE}"
        printf  '    ● 启动/停止    : sh %s {start|stop|restart|status|log}\n' "${SCRIPT_FILE}.ctl"
    fi
    printf  '    ● 彻底卸载     : sh %s uninstall\n' "$0"
    printf  '%b=============================================%b\n\n' "${GREEN}" "${NC}"
}

# ---------------------------------------------------------------
# 卸载主流程
# ---------------------------------------------------------------

uninstall_probe() {
    print_banner
    printf '%b[!] 开始执行无残留深度卸载清理方案...%b\n\n' "${YELLOW}" "${NC}"
    check_root
    detect_os

    step "停用并撤销系统守护进程..."
    stop_old_service

    step "清理服务脚本文件..."
    rm -f "${PROCD_FILE}"

    step "销毁探针物理可执行代码文件..."
    rm -f "${SCRIPT_FILE}"
    rm -f "${SCRIPT_FILE}.ctl"

    step "抹除共享内存高速缓存区..."
    rm -f /tmp/.cf_ipv4 /tmp/.cf_ipv6 /tmp/.cf_region /tmp/.cf_probe_* 2>/dev/null || true

    step "抹除流量追踪数据..."
    rm -rf /var/lib/${SERVICE_NAME}
    rm -rf "${CONFIG_DIR}"

    step "清理日志与 PID 文件..."
    rm -f "${PID_FILE}" "${LOG_FILE}" 2>/dev/null || true

    printf '\n%b╔══════════════════════════════════════════╗%b\n' "${GREEN}" "${NC}"
    printf  '║     ✓ 卸载完毕！系统环境无任何残留。     ║\n'
    printf  '%b╚══════════════════════════════════════════╝%b\n\n' "${GREEN}" "${NC}"
}

# ---------------------------------------------------------------
# 入口
# ---------------------------------------------------------------
case "${1:-install}" in
    install)
        shift 1 2>/dev/null || true
        install_probe "$@"
        ;;
    uninstall|remove|delete|purge)
        uninstall_probe
        ;;
    *)
        echo "未知指令. 可选命令: install | uninstall"
        exit 1
        ;;
esac
