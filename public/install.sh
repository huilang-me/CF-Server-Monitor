#!/bin/bash
# ==============================================================================
# V1.3.3
# CF-Server-Monitor 安装/卸载脚本 (企业级安全加固版)
# 支持: Ubuntu/Debian/CentOS/RHEL/Fedora/Rocky/AlmaLinux
# Fixes: 1. 独立协程无 wait 阻塞 2. 原子化原子覆盖 3. 兼容全版本 Systemd 4. 严格 set -u 闭环
# ==============================================================================

set -euo pipefail

AGENT_VERSION="1.3.3"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 路径定义
SERVICE_NAME="cf-probe"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SCRIPT_FILE="/usr/local/bin/${SERVICE_NAME}.sh"
CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
OLD_TRAFFIC_DATA_FILE="/var/lib/cf-probe/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000
CONTAINER_PID_FILE="/run/cf-probe.pid"
CONTAINER_LOG_FILE="/var/log/cf-probe.log"
DEBUG_ENV_FILE="/run/cf-probe-debug.env"

# 全局运行模式: systemd | container
RUNTIME_MODE="systemd"

print_banner() {
    echo -e "${CYAN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     CF-Server-Monitor (Enterprise)    ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}"
}

info() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "${BLUE}[→]${NC} $1"; }

print_usage() {
    echo -e "${RED}错误: 运行所需的入参不完整。${NC}\n"
    echo "用法:"
    echo "  bash $0 install -id=SERVER_ID -secret=SECRET -base_url=AGENT_BASE_URL [选项]"
    echo ""
    echo "必需参数:"
    echo "  -id=xxx        服务器ID"
    echo "  -secret=xxx    密钥"
    echo "  -base_url=xxx  探针根地址（脚本、/update、自动更新）"
    echo "  -url=xxx       兼容旧版：完整上报地址"
    echo ""
    echo "可选参数:"
    echo "  -interval=N    上报间隔(秒)，默认60"
    echo "  -collect_interval=N    采样间隔(秒)，默认0"
    echo "  -ct=HOST       自定义CT测试节点"
    echo "  -cu=HOST       自定义CU测试节点"
    echo "  -cm=HOST       自定义CM测试节点"
    echo "  -bd=HOST       自定义BD测试节点"
    echo "  -reset_day=N   流量重置日(1-31, 0=不重置)，默认1"
    echo "  -auto_update=0|1 自动更新探针，默认0"
    echo "  -proxy_url=URL HTTP(S)代理，可包含URL编码后的账号密码"
    echo "  -rx_correction=N  下行流量校正(GB)，覆盖当月下行数据"
    echo "  -tx_correction=N  上行流量校正(GB)，覆盖当月上行数据"
    echo "  -debug=0|1     输出上报调试日志，默认0，不写入配置"
    echo ""
    echo "示例:"
    echo "  bash $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com"
    echo "  bash $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com/prefix -proxy_url=http://user:pass@proxy.example.com:8080"
    echo "  bash $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com -interval=30 -debug=1"
    exit 1
}

normalize_binary_value() {
    local value="${1-}" default_value="${2-}"
    [ -z "$value" ] && value="$default_value"
    case "$value" in
        0|1) printf '%s' "$value" ;;
        *) return 1 ;;
    esac
}

detect_runtime_mode() {
    if [ "$(cat /proc/1/comm 2>/dev/null)" = "systemd" ] && [ -d /run/systemd/system ]; then
        RUNTIME_MODE="systemd"
        info "Runtime mode: systemd"
    else
        RUNTIME_MODE="container"
        warn "Runtime mode: container"
    fi
}

check_root() {
    if [ "$(id -u)" != "0" ]; then
        error "请使用 root 权限运行此脚本: sudo bash $0"
    fi
}

detect_os() {
    # 彻底杜绝 set -u 下 source /etc/os-release 由于发行版自身未知变量未定义导致的崩溃
    if [ -f /etc/os-release ]; then
        OS_ID=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'")
    else
        OS_ID=$(uname -s | tr '[:upper:]' '[:lower:]')
    fi
    OS_ID=${OS_ID:-"unknown"}
    
    case "$OS_ID" in
        ubuntu|debian|raspbian) PKG_MGR="apt-get" ;;
        centos|rhel|fedora|rocky|almalinux|ol|amzn|opencloudos|anolis|alinux) PKG_MGR="yum" ;;
        alpine) error "未识别的系统类型: alpine，请在后台选择正确的系统后复制命令重试" ;;
        *)
            warn "未识别的系统类型: $OS_ID，尝试自动检测包管理器..."
            if command -v apt-get >/dev/null 2>&1; then
                PKG_MGR="apt-get"
            elif command -v yum >/dev/null 2>&1; then
                PKG_MGR="yum"
            elif command -v dnf >/dev/null 2>&1; then
                PKG_MGR="yum"
            elif command -v apk >/dev/null 2>&1; then
                PKG_MGR="apk"
            elif command -v opkg >/dev/null 2>&1; then
                PKG_MGR="opkg"
            else
                error "未找到可用的包管理器 (apt-get/yum/dnf/apk/opkg)，请手动安装依赖。"
            fi
            ;;
    esac
}

install_deps() {
    step "检查系统依赖组件..."
    local required_cmds="curl awk grep sed ps df ping nc"

    for cmd in ${required_cmds}; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            warn "缺少必要依赖: ${cmd}，正在尝试自动安装..."
            local pkg="${cmd}"
            if [ "${cmd}" = "ping" ]; then
                if [ "${PKG_MGR:-apt-get}" = "apt-get" ]; then
                    pkg="iputils-ping"
                else
                    pkg="iputils"
                fi
            fi
            if [ "${cmd}" = "nc" ]; then
                case "${PKG_MGR:-apt-get}" in
                    apt-get) pkg="netcat-openbsd" ;;
                    yum)     pkg="nmap-ncat" ;;
                    *)       pkg="nc" ;;
                esac
            fi
            case "${PKG_MGR:-apt-get}" in
                apt-get) apt-get update -qq && apt-get install -y -qq "${pkg}" >/dev/null 2>&1 || true ;;
                yum)     yum install -y -q "${pkg}" >/dev/null 2>&1 || true ;;
                apk)     apk add --no-cache --quiet "${pkg}" >/dev/null 2>&1 || true ;;
                opkg)    opkg install "${pkg}" >/dev/null 2>&1 || true ;;
                *)       warn "未知的包管理器: ${PKG_MGR:-apt-get}，无法自动安装 ${pkg}" ;;
            esac
        fi
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            error "无法自动安装依赖 [${cmd}]，请手动安装后重试。"
        fi
    done

    info "基础依赖组件检查通过"

}

stop_old_service() {
    step "清理可能存在的旧服务进程..."
    if command -v systemctl >/dev/null 2>&1; then
        if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
            systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
        fi
        if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
            systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
        fi
    fi
    if [ -f "${CONTAINER_PID_FILE}" ]; then
        local old_pid
        old_pid=$(cat "${CONTAINER_PID_FILE}" 2>/dev/null || echo "")
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null || true
        fi
        rm -f "${CONTAINER_PID_FILE}"
    fi
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" 2>/dev/null || true
    fi
}

create_script() {
    step "注入工业级监控采集探针..."

    cat << 'PROBE_EOF' | sed "s|__AGENT_VERSION__|${AGENT_VERSION}|g" > "${SCRIPT_FILE}"
#!/bin/bash
set +eu

AGENT_VERSION="__AGENT_VERSION__"
SERVICE_NAME="cf-probe"
CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000
DEBUG_MODE=0

for arg in "$@"; do
    case "$arg" in
        -debug=*) DEBUG_MODE="${arg#-debug=}" ;;
    esac
done
case "$DEBUG_MODE" in
    0|1) ;;
    *) DEBUG_MODE=0 ;;
esac

if [ ! -f "${CONFIG_FILE}" ]; then
    echo "[ERROR] 配置文件不存在: ${CONFIG_FILE}"
    exit 1
fi

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

COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
REPORT_INTERVAL=${REPORT_INTERVAL:-60}
AUTO_UPDATE=${AUTO_UPDATE:-0}
case "$AUTO_UPDATE" in
    0|1) ;;
    *) AUTO_UPDATE=0 ;;
esac
[ -z "$RESET_DAY" ] && RESET_DAY=1
case "$COLLECT_INTERVAL" in ''|*[!0-9]*) COLLECT_INTERVAL=0 ;; esac
case "$REPORT_INTERVAL" in ''|*[!0-9]*) REPORT_INTERVAL=60 ;; esac
[ "$REPORT_INTERVAL" -lt 1 ] && REPORT_INTERVAL=60
if [ "$COLLECT_INTERVAL" -gt 0 ] && [ "$REPORT_INTERVAL" -lt "$COLLECT_INTERVAL" ]; then
    REPORT_INTERVAL="$COLLECT_INTERVAL"
fi
ACTIVE_INTERVAL="$REPORT_INTERVAL"
[ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
CONFIG_MD5=${CONFIG_MD5:-none}
BASE_URL=${BASE_URL:-}
PROXY_URL=${PROXY_URL:-}

derive_base_url() {
    local url="${1%%\?*}"
    case "$url" in
        */update) printf '%s' "${url%/update}" ;;
        *) printf '%s' "${url%/}" ;;
    esac
}

[ -z "$BASE_URL" ] && BASE_URL=$(derive_base_url "$WORKER_URL")
BASE_URL=${BASE_URL%/}
[ -n "$BASE_URL" ] && WORKER_URL="${BASE_URL}/update"

agent_curl() {
    if [ -n "${PROXY_URL:-}" ]; then
        curl --noproxy '' --proxy "$PROXY_URL" "$@"
    else
        curl --noproxy '*' "$@"
    fi
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
    [ -z "${PROXY_URL:-}" ] && { printf '%s' 'direct'; return; }
    printf '%s' "$PROXY_URL" | sed -E 's#(https?://[^:/@]+):[^@]*@#\1:******@#'
}

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

# 动态检测 stdout 指向的日志文件（systemd 模式走 journald 不写文件，此处为空）
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

get_install_url() {
    case "$BASE_URL" in
        http://*|https://*) printf '%s/install.sh' "${BASE_URL%/}" ;;
        *) return 1 ;;
    esac
}

schedule_agent_update() {
    if [ "${AUTO_UPDATE}" != "1" ]; then
        log_warn_debug "Auto update ignored: local AUTO_UPDATE=${AUTO_UPDATE}"
        return 0
    fi

    local now last lock_file install_url systemd_output systemd_status
    lock_file="${CONFIG_DIR}/auto_update.lock"

    now=$(date +%s)
    if [ -f "$lock_file" ]; then
        last=$(cat "$lock_file" 2>/dev/null || echo 0)
        case "$last" in ''|*[!0-9]*) last=0 ;; esac
        if [ $((now - last)) -lt 1800 ]; then
            log_warn_debug "Auto update already scheduled recently: age=$((now - last))s lock=${lock_file}"
            return 0
        fi
    fi

    mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
    if ! install_url=$(get_install_url); then
        log_warn_debug "Auto update skipped: invalid WORKER_URL=${WORKER_URL}"
        return 1
    fi
    log_debug "Auto update requested: install_url=${install_url}"

    if [ -d /run/systemd/system ] && command -v systemd-run >/dev/null 2>&1; then
        systemd_output=$(systemd-run --unit="${SERVICE_NAME}-auto-update-${now}" /bin/bash -c 'set -o pipefail; if [ -n "$2" ]; then curl --noproxy "" --proxy "$2" -fsSL --connect-timeout 5 -m 30 "$1"; else curl --noproxy "*" -fsSL --connect-timeout 5 -m 30 "$1"; fi | bash -s install' _ "$install_url" "$PROXY_URL" 2>&1)
        systemd_status=$?
        if [ "$systemd_status" -eq 0 ]; then
            printf '%s\n' "$now" > "$lock_file" 2>/dev/null || true
            log_info "Auto update scheduled via systemd-run: unit=${SERVICE_NAME}-auto-update-${now}"
            log_debug "systemd-run output: ${systemd_output}"
            return 0
        fi
        log_warn_debug "Auto update systemd-run failed: status=${systemd_status} output=${systemd_output}"
    fi

    if [ -d /run/systemd/system ]; then
        log_warn_debug "Auto update scheduling failed: systemd-run unavailable"
        return 1
    fi

    log_debug "Auto update scheduling via nohup: install_url=${install_url}"
    nohup /bin/bash -c 'set -o pipefail; if [ -n "$2" ]; then curl --noproxy "" --proxy "$2" -fsSL --connect-timeout 5 -m 30 "$1"; else curl --noproxy "*" -fsSL --connect-timeout 5 -m 30 "$1"; fi | bash -s install' _ "$install_url" "$PROXY_URL" >/dev/null 2>&1 &
    printf '%s\n' "$now" > "$lock_file" 2>/dev/null || true
    log_info "Auto update scheduled"
    return 0
}

persist_dynamic_config() {
    local tmp_file="${CONFIG_FILE}.tmp.$$"
    awk \
        -v collect="$1" \
        -v report="$2" \
        -v reset="$3" \
        -v md5="$4" \
        -v ct="$5" \
        -v cu="$6" \
        -v cm="$7" \
        -v bd="$8" '
        BEGIN { c=0; r=0; p=0; d=0; m=0; tct=0; tcu=0; tcm=0; tbd=0 }
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
    local response_file="$1" header_file="$2" body bytes new_md5
    local new_collect new_report new_reset new_schema new_ct new_cu new_cm new_bd
    local new_rx_corr new_tx_corr new_update has_config

    bytes=$(wc -c < "$response_file" 2>/dev/null || echo 9999)
    if [ "$bytes" -gt 1024 ]; then
        log_warn_debug "Remote config rejected: response too large bytes=${bytes}"
        return 1
    fi
    body=$(cat "$response_file" 2>/dev/null) || return 1
    log_debug "Remote config raw: bytes=${bytes} body=${body}"
    case "$body" in
        '') log_warn_debug "Remote config rejected: empty body"; return 1 ;;
        *[!a-z0-9_=\&.\-:]*) log_warn_debug "Remote config rejected: invalid characters body=${body}"; return 1 ;;
    esac

    new_rx_corr=""
    new_tx_corr=""
    new_update=""
    IFS='&' read -ra _fields <<< "$body"
    for _f in "${_fields[@]}"; do
        _k="${_f%%=*}"; _v="${_f#*=}"
        case "$_k" in
            collect_interval) new_collect="$_v" ;;
            report_interval)  new_report="$_v" ;;
            reset_day)        new_reset="$_v" ;;
            schema_version)   new_schema="$_v" ;;
            custom_ct)        new_ct="$_v" ;;
            custom_cu)        new_cu="$_v" ;;
            custom_cm)        new_cm="$_v" ;;
            custom_bd)        new_bd="$_v" ;;
            rx_correction)    new_rx_corr="$_v" ;;
            tx_correction)    new_tx_corr="$_v" ;;
            update)           new_update="$_v" ;;
            '')               ;;
            *)                log_warn_debug "Remote config rejected: unknown field=${_k}"; return 1 ;;
        esac
    done

    has_config=0
    if [ -n "${new_collect:-}" ] || [ -n "${new_report:-}" ] || [ -n "${new_reset:-}" ] || [ -n "${new_schema:-}" ]; then
        has_config=1
    fi
    log_debug "Remote config parsed: has_config=${has_config} update=${new_update:-} collect=${new_collect:-} report=${new_report:-} reset=${new_reset:-} schema=${new_schema:-} rx_corr=${new_rx_corr:-} tx_corr=${new_tx_corr:-}"

    if [ "$has_config" = "0" ]; then
        if [ "$new_update" = "1" ]; then
            log_debug "Remote update-only instruction received"
            schedule_agent_update
            return 0
        fi
        log_warn_debug "Remote config rejected: no config fields and update=${new_update:-}"
        return 1
    fi

    new_md5=$(awk 'tolower($1)=="x-agent-config-md5:" { gsub("\r", "", $2); print tolower($2); exit }' "$header_file")
    if [ "${#new_md5}" -ne 32 ]; then
        log_warn_debug "Remote config rejected: invalid md5 length md5=${new_md5:-}"
        return 1
    fi
    case "$new_md5" in *[!0-9a-f]*) log_warn_debug "Remote config rejected: invalid md5 chars md5=${new_md5}"; return 1 ;; esac
    log_debug "Remote config md5: current=${CONFIG_MD5:-none} remote=${new_md5}"

    case "$new_collect" in 0|1|2|5|10) ;; *) log_warn_debug "Remote config rejected: invalid collect_interval=${new_collect:-}"; return 1 ;; esac
    case "$new_report" in 30|60|120|180) ;; *) log_warn_debug "Remote config rejected: invalid report_interval=${new_report:-}"; return 1 ;; esac
    case "$new_reset" in 0|[1-9]|1[0-9]|2[0-9]|30|31) ;; *) log_warn_debug "Remote config rejected: invalid reset_day=${new_reset:-}"; return 1 ;; esac
    case "$new_update" in ''|0|1) ;; *) log_warn_debug "Remote config rejected: invalid update=${new_update}"; return 1 ;; esac
    if [ "$new_schema" != "2" ]; then
        log_warn_debug "Remote config rejected: invalid schema_version=${new_schema:-}"
        return 1
    fi
    if [ "$new_report" -lt "$new_collect" ]; then
        log_warn_debug "Remote config rejected: report_interval=${new_report} less than collect_interval=${new_collect}"
        return 1
    fi

    if [ "$new_md5" != "${CONFIG_MD5:-none}" ]; then
        persist_dynamic_config "$new_collect" "$new_report" "$new_reset" "$new_md5" "$new_ct" "$new_cu" "$new_cm" "$new_bd" || return 1
        COLLECT_INTERVAL="$new_collect"
        REPORT_INTERVAL="$new_report"
        RESET_DAY="$new_reset"
        CT_NODE="$new_ct"
        CU_NODE="$new_cu"
        CM_NODE="$new_cm"
        BD_NODE="$new_bd"
        CONFIG_MD5="$new_md5"
        ACTIVE_INTERVAL="$REPORT_INTERVAL"
        [ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
        log_info "Dynamic configuration applied: md5=${CONFIG_MD5} ct=${CT_NODE:-} cu=${CU_NODE:-} cm=${CM_NODE:-} bd=${BD_NODE:-}"

        if kill -0 "$WORKER_PID" 2>/dev/null; then
            pkill -P "$WORKER_PID" 2>/dev/null || true
            kill "$WORKER_PID" 2>/dev/null || true
            wait "$WORKER_PID" 2>/dev/null || true
        fi
        rm -f /dev/shm/.cf_probe_* 2>/dev/null || true
        run_network_worker &
        WORKER_PID=$!

        if [ "$COLLECT_INTERVAL" -gt 0 ]; then
            SAMPLES_JSON=""
            SAMPLE_COUNT=0
        fi
        LAST_REPORT_TIME=0
    fi

    if [ -n "$new_rx_corr" ] || [ -n "$new_tx_corr" ]; then
        if apply_traffic_correction "$new_rx_corr" "$new_tx_corr"; then
            send_correction_confirm "$new_rx_corr" "$new_tx_corr" || true
        fi
    fi

    if [ "$new_update" = "1" ]; then
        log_debug "Remote config includes update=1"
        schedule_agent_update || true
    fi
    return 0
}

normalize_correction_value() {
    local val="${1:-0}"
    [ -z "$val" ] && val=0
    printf '%s' "$val"
}

is_valid_correction_value() {
    local val
    val=$(normalize_correction_value "$1")
    awk -v v="$val" -v max="$MAX_TRAFFIC_CORRECTION_GB" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v + 0 >= 0 && v + 0 <= max) }'
}

send_correction_confirm() {
    local rx_val tx_val payload http_code
    rx_val=$(normalize_correction_value "$1")
    tx_val=$(normalize_correction_value "$2")
    is_valid_correction_value "$rx_val" && is_valid_correction_value "$tx_val" || return 1
    payload="{\"id\":\"$SERVER_ID\",\"secret\":\"$SECRET\",\"rx_correction\":$rx_val,\"tx_correction\":$tx_val}"
    http_code=$(agent_curl -sS -o /dev/null -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" -m 4 --connect-timeout 2 "$WORKER_URL" 2>/dev/null || echo 000)
    case "$http_code" in ''|*[!0-9]*) http_code=000 ;; esac
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        log_info "Traffic correction confirm sent: RX=${rx_val}GB TX=${tx_val}GB"
        return 0
    fi
    log_warn_debug "Traffic correction confirm failed: http=${http_code} RX=${rx_val}GB TX=${tx_val}GB"
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

# 严苛环境下的规范 JSON 字段转义函数
escape_json() {
    local val="${1:-}"
    val="${val//\\/\\\\}"
    val="${val//\"/\\\"}"
    val="${val//$'\n'/ }"
    val="${val//$'\r'/}"
    echo -n "$val"
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
    local year=$1
    [ $((year % 4)) -eq 0 ] && [ $((year % 100)) -ne 0 ] || [ $((year % 400)) -eq 0 ]
}

# 获取当月账单周期起始时间戳（UTC+0）
get_period_start_ts() {
    local reset_day="$1"
    [ "$reset_day" -eq 0 ] 2>/dev/null && { echo "0"; return; }
    local now_ts="$2"
    local year month day
    year=$(date -u -d "@${now_ts}" '+%Y' 2>/dev/null || date -u -r "${now_ts}" '+%Y' 2>/dev/null)
    month=$(date -u -d "@${now_ts}" '+%m' 2>/dev/null || date -u -r "${now_ts}" '+%m' 2>/dev/null)
    day=$(date -u -d "@${now_ts}" '+%d' 2>/dev/null || date -u -r "${now_ts}" '+%d' 2>/dev/null)
    
    local target_day="$reset_day"
    case "$month" in
        02) 
            if is_leap_year "$year"; then
                [ "$target_day" -gt 29 ] && target_day=29
            else
                [ "$target_day" -gt 28 ] && target_day=28
            fi
            ;;
        04|06|09|11) [ "$target_day" -gt 30 ] && target_day=30 ;;
    esac
    
    local period_start_ts
    if [ "$day" -ge "$target_day" ]; then
        period_start_ts=$(date -u -d "${year}-${month}-${target_day} 00:00:00" '+%s' 2>/dev/null || date -u -r "${now_ts}" '+%s' 2>/dev/null)
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
        period_start_ts=$(date -u -d "${year}-${prev_month_str}-${target_day} 00:00:00" '+%s' 2>/dev/null || date -u -r "${now_ts}" '+%s' 2>/dev/null)
    fi
    echo "$period_start_ts"
}

# 计算月度流量（自动持久化）
calc_monthly_traffic() {
    local current_rx="$1"
    local current_tx="$2"
    local reset_day="${RESET_DAY:-1}"
    local now_ts
    now_ts=$(date '+%s')
    
    mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
    
    # 读取上次保存的数据（使用临时变量避免与全局变量冲突）
    local saved_rx_prev=0 saved_tx_prev=0 saved_rx_period=0 saved_tx_period=0 saved_last_check=0 saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        local tmp_rx_prev tmp_tx_prev tmp_rx_period tmp_tx_period tmp_last_check tmp_period_start
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
    
    # 计算当前账单周期起始
    local period_start_ts
    period_start_ts=$(get_period_start_ts "$reset_day" "$now_ts")
    
    # 检测是否是首次运行（没有历史记录）
    local rx_delta=0 tx_delta=0
    if [ "$saved_last_check" -ne 0 ]; then
        # 非首次运行，计算增量
        if [ "$current_rx" -lt "$saved_rx_prev" ] || [ "$current_tx" -lt "$saved_tx_prev" ]; then
            rx_delta=0; tx_delta=0
        else
            rx_delta=$((current_rx - saved_rx_prev))
            tx_delta=$((current_tx - saved_tx_prev))
        fi
        
        # 判断是否进入新账单周期（跨月）
        if [ "$period_start_ts" -ne 0 ] && [ "$period_start_ts" -ne "$saved_period_start" ] && [ "$saved_period_start" -ne 0 ]; then
            saved_rx_period="$rx_delta"; saved_tx_period="$tx_delta"
        else
            saved_rx_period=$((saved_rx_period + rx_delta))
            saved_tx_period=$((saved_tx_period + tx_delta))
        fi
    else
        # 首次运行，周期流量从0开始
        saved_rx_period=0
        saved_tx_period=0
    fi
    
    # 持久化保存
    cat > "${TRAFFIC_DATA_FILE}.tmp" << EOF
RX_PREV=${current_rx}
TX_PREV=${current_tx}
RX_PERIOD=${saved_rx_period}
TX_PERIOD=${saved_tx_period}
LAST_CHECK=${now_ts}
PERIOD_START=${period_start_ts}
EOF
    mv "${TRAFFIC_DATA_FILE}.tmp" "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
    
    # 返回当月流量（上行=tx, 下行=rx）
    echo "$saved_rx_period $saved_tx_period"
}

get_cpu_stat() {
    awk '/^cpu /{total=$2+$3+$4+$5+$6+$7+$8+$9;idle=$5+$6;printf "%.0f %.0f\n",total,idle}' /proc/stat 2>/dev/null || echo "0 0";
}

json_string_or_null() {
    local val="${1:-}"
    if [ -z "${val}" ]; then
        echo "null"
    else
        echo "\"$(escape_json "${val}")\""
    fi
}

get_gpu_metrics() {
    local gpu_info_array=null
    local gpu_count=0

    if command -v nvidia-smi >/dev/null 2>&1; then
        local nvidia_output
        nvidia_output=$(nvidia-smi --query-gpu=index,name,utilization.gpu --format=csv,noheader,nounits 2>/dev/null || true)
        if [ -n "${nvidia_output}" ]; then
            while IFS= read -r nvidia_line; do
                [ -z "${nvidia_line}" ] && continue
                # GPU name may contain commas, so parse from both ends:
                # index is first token, utilization.gpu is last token, everything in between is name
                local gpu_idx gpu_name gpu_util
                gpu_idx=$(echo "${nvidia_line}" | awk -F',' '{gsub(/^[ \t]+|[ \t]+$/, "", $1); print $1}')
                gpu_util=$(echo "${nvidia_line}" | awk -F',' '{gsub(/[^0-9.]/, "", $NF); print $NF}')
                # Extract name: strip first field (index) and last field (utilization), trim commas and spaces
                gpu_name=$(echo "${nvidia_line}" | sed 's/^[^,]*,//; s/,[^,]*$//' | sed 's/^[ \t]*//;s/[ \t]*$//')
                case "${gpu_util}" in ''|*[!0-9.]*|*.*.*) gpu_util="null" ;; esac
                local gpu_name_escaped
                gpu_name_escaped=$(escape_json "${gpu_name}")
                if [ "${gpu_info_array}" != "null" ]; then
                    gpu_info_array="${gpu_info_array},{\"name\":\"${gpu_name_escaped}\",\"info\":${gpu_util},\"id\":\"${gpu_idx}\"}"
                else
                    gpu_info_array="{\"name\":\"${gpu_name_escaped}\",\"info\":${gpu_util},\"id\":\"${gpu_idx}\"}"
                fi
                gpu_count=$((gpu_count + 1))
            done <<< "${nvidia_output}"
        fi
    elif command -v rocm-smi >/dev/null 2>&1; then
        local rocm_names rocm_utils
        rocm_names=$(rocm-smi --showproductname 2>/dev/null | awk -F: '/Card series|Card model|Product Name/{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' || true)
        rocm_utils=$(rocm-smi --showuse 2>/dev/null | awk -F: '/GPU use/{gsub(/[^0-9.]/, "", $2); print $2}' || true)
        local idx=0
        while IFS= read -r rname; do
            [ -z "${rname}" ] && continue
            local rutil
            rutil=$(echo "${rocm_utils}" | sed -n "$((idx + 1))p")
            case "${rutil}" in ''|*[!0-9.]*|*.*.*) rutil="null" ;; esac
            local rname_escaped
            rname_escaped=$(escape_json "${rname}")
            if [ "${gpu_info_array}" != "null" ]; then
                gpu_info_array="${gpu_info_array},{\"name\":\"${rname_escaped}\",\"info\":${rutil},\"id\":\"${idx}\"}"
            else
                gpu_info_array="{\"name\":\"${rname_escaped}\",\"info\":${rutil},\"id\":\"${idx}\"}"
            fi
            idx=$((idx + 1))
            gpu_count=$((gpu_count + 1))
        done <<< "${rocm_names}"
    fi

    # lspci fallback: only when no GPU detected via nvidia-smi/rocm-smi
    if [ "${gpu_count}" -eq 0 ] && command -v lspci >/dev/null 2>&1; then
        local lspci_gpus
        lspci_gpus=$(lspci 2>/dev/null | awk '/VGA compatible controller|3D controller|Display controller/ && /NVIDIA|AMD|ATI|Radeon|Intel.*(Graphics|Arc|UHD|Iris)/{sub(/^[^:]*: /, ""); print}' || true)
        local lidx=0
        while IFS= read -r lgpu; do
            [ -z "${lgpu}" ] && continue
            local lgpu_escaped
            lgpu_escaped=$(escape_json "${lgpu}")
            if [ "${gpu_info_array}" != "null" ]; then
                gpu_info_array="${gpu_info_array},{\"name\":\"${lgpu_escaped}\",\"info\":0,\"id\":\"${lidx}\"}"
            else
                gpu_info_array="{\"name\":\"${lgpu_escaped}\",\"info\":0,\"id\":\"${lidx}\"}"
            fi
            lidx=$((lidx + 1))
            gpu_count=$((gpu_count + 1))
        done <<< "${lspci_gpus}"
    fi

    if [ "${gpu_count}" -gt 0 ]; then
        printf '[%s]' "${gpu_info_array}"
    else
        printf 'null'
    fi
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

split_probe_target() {
    local target="${1:-}"
    local default_port="${2:-443}"
    local probe_host="$target"
    local probe_port="$default_port"

    case "$target" in
        ''|*[!A-Za-z0-9._:-]*) return 1 ;;
        *:*)
            case "${target#*:}" in *:*) return 1 ;; esac
            probe_host="${target%:*}"
            probe_port="${target##*:}"
            ;;
    esac

    case "$probe_host" in ''|-*) return 1 ;; esac
    case "$probe_port" in ''|*[!0-9]*|??????*) return 1 ;; esac
    [ "$probe_port" -ge 1 ] && [ "$probe_port" -le 65535 ] || return 1

    echo "${probe_host} ${probe_port}"
    return 0
}

# 统一4探针：同时计算延迟(avg RTT)和丢包率(%)，输出格式 "RTT LOSS"
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
            log_debug "[get_probe] $host TCP all failed: ok=0 -> output 'null 100'"
            echo "null 100"
        fi
        return
    fi

    # TCP 不可用，回退 ICMP
    local icmp_out
    icmp_out=$(ping -c "$count" -W 2 "$host" 2>/dev/null)
    local avg_rtt loss
    avg_rtt=$(echo "$icmp_out" | awk -F'[/ ]' '/^rtt/{print $8}' | cut -d. -f1)
    loss=$(echo "$icmp_out" | awk '/packet loss/{for(i=1;i<=NF;i++) if($i~/[0-9]+%/){gsub(/%/,"",$i);printf "%d",$i;exit}}')
    [ -z "$avg_rtt" ] && avg_rtt="null"
    [ -z "$loss" ] && loss=100
    echo "$avg_rtt $loss"
}

# 测试节点定义（支持参数覆盖，空值则跳过）
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"

write_probe_result() {
    local dest="$1"
    shift
    local tmp="${dest}.tmp"
    rm -f "$tmp"
    if [ "$DEBUG_MODE" = "1" ]; then
        "$@" > "$tmp" || true
    else
        "$@" > "$tmp" 2>/dev/null || true
    fi
    if [ -s "$tmp" ]; then
        mv "$tmp" "$dest"
    else
        rm -f "$tmp" "$dest"
    fi
}

# Centos限制，所以改成串行执行
refresh_probe_async() {
    [ -n "$CT_NODE" ] && write_probe_result /dev/shm/.cf_probe_ct get_probe "$CT_NODE" 4 443
    [ -n "$CU_NODE" ] && write_probe_result /dev/shm/.cf_probe_cu get_probe "$CU_NODE" 4 443
    [ -n "$CM_NODE" ] && write_probe_result /dev/shm/.cf_probe_cm get_probe "$CM_NODE" 4 443
    [ -n "$BD_NODE" ] && write_probe_result /dev/shm/.cf_probe_bd get_probe "$BD_NODE" 4 443
}

# ==============================================================================
# 高并发/无竞态后台网络 Worker 协程
# ==============================================================================
run_network_worker() {
    # 继承外层 set -eu 行为
    set -eu
    local last_ip=0
    local last_probe=0
    local probe_interval="${REPORT_INTERVAL:-60}"
    case "$probe_interval" in ''|*[!0-9]*) probe_interval=60 ;; esac
    [ "$probe_interval" -lt 30 ] && probe_interval=30
    [ "$probe_interval" -gt 60 ] && probe_interval=60
    
    while true; do
        local now; now=$(date +%s)
        
        # 10分钟检测一次 IP
        if [ $((now - last_ip)) -ge 600 ] || [ "$last_ip" -eq 0 ]; then
            local direct_trace direct_trace_v6 direct_region
            direct_trace=$(direct_cf_trace 4 || true)
            direct_trace_v6=$(direct_cf_trace 6 || true)
            (printf '%s\n' "$direct_trace" | grep -q '^ip=' && echo "1" || echo "0") > /dev/shm/.cf_ipv4.tmp && mv /dev/shm/.cf_ipv4.tmp /dev/shm/.cf_ipv4 || true
            direct_region=$(printf '%s\n' "$direct_trace" | awk -F= '$1 == "loc" && $2 ~ /^[A-Za-z][A-Za-z]$/ { print toupper($2); exit }')
            case "$direct_region" in
                [A-Z][A-Z]) ;;
                *) direct_region=$(printf '%s\n' "$direct_trace_v6" | awk -F= '$1 == "loc" && $2 ~ /^[A-Za-z][A-Za-z]$/ { print toupper($2); exit }') ;;
            esac
            case "$direct_region" in [A-Z][A-Z]) ;; *) direct_region="" ;; esac
            printf '%s\n' "$direct_region" > /dev/shm/.cf_region.tmp && mv /dev/shm/.cf_region.tmp /dev/shm/.cf_region || true
            (printf '%s\n' "$direct_trace_v6" | grep -q '^ip=' && echo "1" || echo "0") > /dev/shm/.cf_ipv6.tmp && mv /dev/shm/.cf_ipv6.tmp /dev/shm/.cf_ipv6 || true
            last_ip="$now"
        fi
        
        # 统一探测：跟随上报间隔并限制在 30-60 秒，一次探测同时计算延迟和丢包率
        if [ $((now - last_probe)) -ge "$probe_interval" ] || [ "$last_probe" -eq 0 ]; then
            refresh_probe_async
            last_probe="$now"
        fi
        sleep 5
    done
}

# 首次基础数据初始化
NET_STAT=$(get_net_bytes)
RX_PREV=$(echo "$NET_STAT" | awk '{print $1}'); RX_PREV=${RX_PREV:-0}
TX_PREV=$(echo "$NET_STAT" | awk '{print $2}'); TX_PREV=${TX_PREV:-0}

CPU_STAT=$(get_cpu_stat)
PREV_CPU_TOTAL=$(echo "$CPU_STAT" | awk '{print $1}'); PREV_CPU_TOTAL=${PREV_CPU_TOTAL:-0}
PREV_CPU_IDLE=$(echo "$CPU_STAT" | awk '{print $2}'); PREV_CPU_IDLE=${PREV_CPU_IDLE:-0}

PREV_LOOP_TIME=$(date +%s)

if [ -z "${SERVER_ID:-}" ] || [ -z "${SECRET:-}" ] || [ -z "${WORKER_URL:-}" ]; then
    echo "[ERROR] $(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S') 配置缺失: SERVER_ID/SECRET/WORKER_URL 不能为空"
    exit 1
fi

log_info "CF-Server-Monitor Probe Engine Started Successfully."
log_debug "Config: id=${SERVER_ID} base_url=${BASE_URL} url=${WORKER_URL} proxy=$(masked_proxy_url) report_interval=${REPORT_INTERVAL}s collect_interval=${COLLECT_INTERVAL}s active_interval=${ACTIVE_INTERVAL}s reset_day=${RESET_DAY} auto_update=${AUTO_UPDATE} secret_len=${#SECRET}"
log_debug "Nodes: ct=${CT_NODE:-} cu=${CU_NODE:-} cm=${CM_NODE:-} bd=${BD_NODE:-}"

# 核心架构升级：在这里脱离主循环，静默启动常驻网络 Worker 协程，无 wait 干扰
run_network_worker &
WORKER_PID=$!
SAMPLES_JSON=""
SAMPLE_COUNT=0
LAST_REPORT_TIME=0

while true; do
    LOOP_START_TIME=$(date +%s)
    rotate_log_if_needed "$PROBE_LOG_FILE"

    # Worker 进程健康检查与自动重启
    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
        log_warn_debug "Network worker exited; restarting"
        run_network_worker &
        WORKER_PID=$!
    fi
    
    # ------------------ 同步系统指标采集模块 (全面 set -u 安全适配) ------------------
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

    # 统计所有数据分区的总容量和使用量（排除引导、光驱、Snap等）
    DISK_TOTAL=0; DISK_USED=0
    DISK_STATS=$(df -kP 2>/dev/null | awk '
        NR>1 &&
        $6 !~ /^(\/boot|\/boot\/efi|\/snap|\/var\/snap)/ &&
        $1 !~ /^(tmpfs|devtmpfs|overlay|squashfs|none)$/ &&
        $6 !~ /^(\/proc|\/sys|\/dev|\/run)$/ &&
        $2 ~ /^[0-9]/ &&
        $2 + 0 > 0 {
            total+=$2; used+=$3
        } 
        END {print total, used}
    ')

    if [ -n "${DISK_STATS}" ]; then
        DISK_TOTAL=$(echo "${DISK_STATS}" | awk '{print int($1/1024)}')
        DISK_USED=$(echo "${DISK_STATS}" | awk '{print int($2/1024)}')
    fi

    # CPU 核心利用率计算
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

    # 基础静态/准静态元数据安全解析
    if [ -f /etc/os-release ]; then
        OS_RAW=$(grep -E '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'")
    else
        OS_RAW=$(uname -srm)
    fi
    OS=${OS_RAW:-"Linux"}
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
    GPU_INFO_VALUE=$(get_gpu_metrics)
    [ -z "${GPU_INFO_VALUE}" ] && GPU_INFO_VALUE="null"
    LOAD_AVG=$(awk '{print $1, $2, $3}' /proc/loadavg 2>/dev/null); LOAD_AVG=${LOAD_AVG:-"0 0 0"}
    PROCESSES=$(ps -e 2>/dev/null | wc -l || echo 0)

    # ---------------- TCP ----------------
    TCP_CONN=""

    if command -v ss >/dev/null 2>&1; then
        # 只统计真正“活跃连接”
        TCP_CONN=$(ss -H -ant state established 2>/dev/null | wc -l)
    else
        # /proc fallback：只算 ESTABLISHED (st=01)
        TCP_CONN=$(awk 'NR>1 && $4=="01"{c++} END{print c+0}' /proc/net/tcp 2>/dev/null)
    fi

    TCP_CONN=$(printf "%s" "${TCP_CONN:-0}" | tr -d '\r\n ')


    # ---------------- UDP ----------------
    UDP_CONN=""

    if command -v ss >/dev/null 2>&1; then
        UDP_CONN=$(ss -H -anu 2>/dev/null | wc -l)
    else
        UDP_CONN=$(awk 'NR>1{c++} END{print c+0}' /proc/net/udp 2>/dev/null)
    fi

    UDP_CONN=$(printf "%s" "${UDP_CONN:-0}" | tr -d '\r\n ')

    # ------------------ 精确无干扰时钟网速算法 ------------------
    NET_STAT=$(get_net_bytes)
    RX_NOW=$(echo "$NET_STAT" | awk '{print $1}'); RX_NOW=${RX_NOW:-0}
    TX_NOW=$(echo "$NET_STAT" | awk '{print $2}'); TX_NOW=${TX_NOW:-0}
    
    # 计算当月累计流量
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

    # ------------------ 读取共享内存 (Rename 机制下绝对无竞态) ------------------
    [ -f /dev/shm/.cf_ipv4 ] && IPV4=$(cat /dev/shm/.cf_ipv4) || IPV4="0"
    [ -f /dev/shm/.cf_ipv6 ] && IPV6=$(cat /dev/shm/.cf_ipv6) || IPV6="0"
    [ -f /dev/shm/.cf_region ] && AGENT_REGION=$(cat /dev/shm/.cf_region) || AGENT_REGION=""
    case "$AGENT_REGION" in [A-Z][A-Z]) ;; *) AGENT_REGION="" ;; esac
    if [ -f /dev/shm/.cf_probe_ct ]; then _p=$(cat /dev/shm/.cf_probe_ct); PING_CT=${_p%% *}; LOSS_CT=${_p##* }; else PING_CT=""; LOSS_CT=""; fi
    if [ -f /dev/shm/.cf_probe_cu ]; then _p=$(cat /dev/shm/.cf_probe_cu); PING_CU=${_p%% *}; LOSS_CU=${_p##* }; else PING_CU=""; LOSS_CU=""; fi
    if [ -f /dev/shm/.cf_probe_cm ]; then _p=$(cat /dev/shm/.cf_probe_cm); PING_CM=${_p%% *}; LOSS_CM=${_p##* }; else PING_CM=""; LOSS_CM=""; fi
    if [ -f /dev/shm/.cf_probe_bd ]; then _p=$(cat /dev/shm/.cf_probe_bd); PING_BD=${_p%% *}; LOSS_BD=${_p##* }; else PING_BD=""; LOSS_BD=""; fi

    # 安全地构建闭合规范的 JSON 数据流
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
{"cpu":"$CPU","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","disk_total":"$DISK_TOTAL","disk_used":"$DISK_USED","load_avg":"$LOAD_AVG","boot_time":"$BOOT_TIME","net_rx":"$RX_NOW","net_tx":"$TX_NOW","net_rx_monthly":"$RX_MONTHLY","net_tx_monthly":"$TX_MONTHLY","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED","os":"$EOS","arch":"$EARCH","cpu_info":"$ECPU","cpu_cores":"$CPU_CORES","gpu_info":$GPU_INFO_VALUE,"processes":"$PROCESSES","tcp_conn":"$TCP_CONN","udp_conn":"$UDP_CONN","ip_v4":"$IPV4","ip_v6":"$IPV6","ping_ct":$PING_CT_JSON,"ping_cu":$PING_CU_JSON,"ping_cm":$PING_CM_JSON,"ping_bd":$PING_BD_JSON,"loss_ct":$LOSS_CT_JSON,"loss_cu":$LOSS_CU_JSON,"loss_cm":$LOSS_CM_JSON,"loss_bd":$LOSS_BD_JSON}
EOF
)
    # 上报上游数据端 (限定 4s 超时控制，主循环绝不严重漂移)
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
        PAYLOAD_BYTES=$(printf "%s" "$PAYLOAD" | wc -c | awk '{print $1}')
        log_debug "Report attempt: url=${WORKER_URL} samples=${SAMPLE_COUNT} payload_bytes=${PAYLOAD_BYTES}"

        REPORT_RESPONSE_FILE="/dev/shm/.cf_probe_response.$$"
        REPORT_HEADER_FILE="/dev/shm/.cf_probe_headers.$$"
        REPORT_ERROR_FILE="/dev/shm/.cf_probe_error.$$"
        REPORT_HEADERS=""
        REPORT_HTTP_CODE=$(agent_curl -sS -D "$REPORT_HEADER_FILE" -o "$REPORT_RESPONSE_FILE" -w "%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -H "X-Agent-Config-Schema: 2" \
            -H "X-Agent-Version: ${AGENT_VERSION}" \
            -H "X-Agent-Config-Md5: ${CONFIG_MD5:-none}" \
            -d "$PAYLOAD" -m 8 --connect-timeout 3 "$WORKER_URL" 2>"$REPORT_ERROR_FILE")
        REPORT_CURL_EXIT=$?
        case "$REPORT_HTTP_CODE" in ''|*[!0-9]*) REPORT_HTTP_CODE=000 ;; esac
        REPORT_RESPONSE=$(head -c 300 "$REPORT_RESPONSE_FILE" 2>/dev/null | tr '\r\n' '  ')
        REPORT_HEADERS=$(head -c 500 "$REPORT_HEADER_FILE" 2>/dev/null | tr '\r\n' '  ')
        REPORT_ERROR=$(head -c 300 "$REPORT_ERROR_FILE" 2>/dev/null | tr '\r\n' '  ')
        log_debug "Report response: http=${REPORT_HTTP_CODE} curl_exit=${REPORT_CURL_EXIT} headers=${REPORT_HEADERS} body=${REPORT_RESPONSE}"
        if [ "$REPORT_CURL_EXIT" -ne 0 ] || [ "$REPORT_HTTP_CODE" -lt 200 ] || [ "$REPORT_HTTP_CODE" -ge 300 ]; then
            log_warn_debug "Report failed: curl_exit=${REPORT_CURL_EXIT} http=${REPORT_HTTP_CODE} samples=${SAMPLE_COUNT} payload_bytes=${PAYLOAD_BYTES} response=${REPORT_RESPONSE} error=${REPORT_ERROR}"
        else
            if [ "$REPORT_HTTP_CODE" = "200" ] && ! apply_remote_config "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE"; then
                log_warn_debug "Dynamic configuration rejected"
            fi
            log_debug "Report success: http=${REPORT_HTTP_CODE} samples=${SAMPLE_COUNT} payload_bytes=${PAYLOAD_BYTES} response=${REPORT_RESPONSE}"
        fi
        rm -f "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" "$REPORT_ERROR_FILE" 2>/dev/null || true
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

create_service() {
    [ "$RUNTIME_MODE" != "systemd" ] && return

    step "构建高兼容、全版本通用的 Systemd 守护配置..."
    
    cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=CF Server Monitor Probe Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=CF_PROBE_DEBUG=0
EnvironmentFile=-${DEBUG_ENV_FILE}
ExecStart=/bin/bash "${SCRIPT_FILE}" -debug=\${CF_PROBE_DEBUG}
Restart=always
RestartSec=5
User=root
Group=root

# 生产级通用平滑优先级约束：永远不挤占前台核心业务
Nice=19
CPUSchedulingPolicy=other
IOSchedulingClass=idle
IOSchedulingPriority=7
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cf-probe

[Install]
WantedBy=multi-user.target
EOF

    info "Systemd 守护配置文件生成成功: ${SERVICE_FILE}"
}

apply_debug_runtime_env() {
    [ "$RUNTIME_MODE" != "systemd" ] && return

    if [ "${DEBUG_MODE:-0}" = "1" ]; then
        if mkdir -p /run 2>/dev/null && printf 'CF_PROBE_DEBUG=1\n' > "${DEBUG_ENV_FILE}" 2>/dev/null; then
            chmod 600 "${DEBUG_ENV_FILE}" 2>/dev/null || true
        else
            warn "调试日志运行参数写入失败，将按默认值 0 启动"
        fi
    else
        rm -f "${DEBUG_ENV_FILE}" 2>/dev/null || true
    fi
}

start_service() {
    if [ "$RUNTIME_MODE" = "systemd" ]; then
        step "加载进程树并激活监控探针..."
        systemctl daemon-reload
        systemctl enable ${SERVICE_NAME}.service >/dev/null 2>&1 || true
        systemctl restart ${SERVICE_NAME}.service

        sleep 1.5
        if systemctl is-active --quiet ${SERVICE_NAME}.service; then
            info "探针监控引擎已进入平稳运行状态。"
        else
            error "探针服务未能启动成功。请执行命令排查原因: journalctl -u ${SERVICE_NAME} -n 20"
        fi
    else
        step "以容器模式启动监控探针..."

        if [ -f "${CONTAINER_PID_FILE}" ] && kill -0 "$(cat "${CONTAINER_PID_FILE}")" 2>/dev/null; then
            info "探针已在运行中 (PID: $(cat "${CONTAINER_PID_FILE}"))"
            return
        fi

        mkdir -p /var/log 2>/dev/null || true

        nohup bash "${SCRIPT_FILE}" -debug="${DEBUG_MODE}" >> "${CONTAINER_LOG_FILE}" 2>&1 &
        local pid=$!
        echo "$pid" > "${CONTAINER_PID_FILE}"

        sleep 1.5
        if kill -0 "$pid" 2>/dev/null; then
            info "探针监控引擎已启动 (PID: $pid)"
        else
            error "探针启动失败，请查看日志: ${CONTAINER_LOG_FILE}"
        fi
    fi
}

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
    DEBUG_MODE=""
    CONFIG_MD5=""

    for arg in "$@"; do
        case "$arg" in
            -id=*) SERVER_ID="${arg#-id=}" ;;
            -secret=*) SECRET="${arg#-secret=}" ;;
            -url=*) WORKER_URL="${arg#-url=}" ;;
            -base_url=*|-base-url=*) BASE_URL="${arg#*=}" ;;
            -proxy_url=*|-proxy-url=*) PROXY_URL="${arg#*=}" ;;
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
            -debug=*) DEBUG_MODE=$(normalize_binary_value "${arg#-debug=}") || error "debug 参数非法，仅支持 0 或 1" ;;
        esac
    done

    BASE_URL="${BASE_URL%/}"
    if [ -n "$BASE_URL" ]; then
        WORKER_URL="${BASE_URL}/update"
    elif [ -n "$WORKER_URL" ]; then
        case "${WORKER_URL%%\?*}" in
            */update) BASE_URL="${WORKER_URL%%\?*}"; BASE_URL="${BASE_URL%/update}" ;;
            *) BASE_URL="${WORKER_URL%%\?*}"; BASE_URL="${BASE_URL%/}" ;;
        esac
    fi

    print_banner
    check_root
    detect_os
    detect_runtime_mode
    install_deps
    stop_old_service

    if [ -f "${CONFIG_FILE}" ]; then
        step "检测到已有配置文件，执行二次安装..."
        
        if [ -n "${SERVER_ID}" ] && [ -n "${SECRET}" ] && [ -n "${WORKER_URL}" ]; then
            COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
            REPORT_INTERVAL=${REPORT_INTERVAL:-60}
            [ -z "$RESET_DAY" ] && RESET_DAY=1
            AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"
            DEBUG_MODE=$(normalize_binary_value "$DEBUG_MODE" 0) || error "debug 参数非法，仅支持 0 或 1"

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
                    CONFIG_MD5) CONFIG_MD5="${value%\"}"; CONFIG_MD5="${CONFIG_MD5#\"}" ;;
                esac
            done < "${CONFIG_FILE}"
            [ -z "$BASE_URL" ] && { BASE_URL="${WORKER_URL%%\?*}"; BASE_URL="${BASE_URL%/update}"; BASE_URL="${BASE_URL%/}"; }
            [ -n "$BASE_URL" ] && WORKER_URL="${BASE_URL}/update"
        fi
    else
        if [ -z "${SERVER_ID}" ] || [ -z "${SECRET}" ] || [ -z "${WORKER_URL}" ]; then
            print_usage
        fi

        COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
        REPORT_INTERVAL=${REPORT_INTERVAL:-60}
        [ -z "$RESET_DAY" ] && RESET_DAY=1
        AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"
        DEBUG_MODE=$(normalize_binary_value "$DEBUG_MODE" 0) || error "debug 参数非法，仅支持 0 或 1"

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
    AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"
    DEBUG_MODE=$(normalize_binary_value "$DEBUG_MODE" 0) || error "debug 参数非法，仅支持 0 或 1"
    CONFIG_MD5=${CONFIG_MD5:-none}

    if [ -n "${RX_CORRECTION}" ] || [ -n "${TX_CORRECTION}" ]; then
        step "应用流量校正..."
        rm -f "${OLD_TRAFFIC_DATA_FILE}" 2>/dev/null || true
        
        mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
        local now_ts=$(date '+%s')
        local rx_correction_bytes=0 tx_correction_bytes=0
        local current_rx=$(awk 'NR>2 && $1~/^(eth|en|wl)[a-z0-9]*:/{rx+=$2}END{printf "%.0f", rx}' /proc/net/dev 2>/dev/null || echo 0)
        local current_tx=$(awk 'NR>2 && $1~/^(eth|en|wl)[a-z0-9]*:/{tx+=$10}END{printf "%.0f", tx}' /proc/net/dev 2>/dev/null || echo 0)
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
    apply_debug_runtime_env
    start_service

    echo -e "\n${GREEN}======================================================="
    echo -e "         CF-Server-Monitor ${AGENT_VERSION} 安装成功"
    echo -e "=======================================================${NC}"
    echo -e "  服务状态 : ${GREEN}Active (Running)${NC}"
    echo -e "  配置参数 :"
    echo -e "    ● Server ID   : ${SERVER_ID}"
    echo -e "    ● Secret      : ********"
    echo -e "    ● Worker URL  : ${WORKER_URL}"
    echo -e "    ● Base URL    : ${BASE_URL}"
    echo -e "    ● 代理        : $(printf '%s' "${PROXY_URL:-direct}" | sed -E 's#(https?://[^:/@]+):[^@]*@#\1:******@#')"
    echo -e "    ● 上报间隔    : ${REPORT_INTERVAL}秒"
    printf  '    ● 采样间隔    : %s秒\n' "${COLLECT_INTERVAL}"
    echo -e "    ● 自动更新    : ${AUTO_UPDATE}"
    echo -e "    ● 调试日志    : ${DEBUG_MODE}"
    [ -n "${RX_CORRECTION}" ] && echo -e "    ● 下行校正    : ${RX_CORRECTION}GB"
    [ -n "${TX_CORRECTION}" ] && echo -e "    ● 上行校正    : ${TX_CORRECTION}GB"
    if [ "${RESET_DAY}" = "0" ]; then
        echo -e "    ● 流量重置日  : 不重置"
    else
        echo -e "    ● 流量重置日  : ${RESET_DAY}号"
    fi
    [ -n "${CT_NODE}" ] && echo -e "    ● CT节点      : ${CT_NODE}"
    [ -n "${CU_NODE}" ] && echo -e "    ● CU节点      : ${CU_NODE}"
    [ -n "${CM_NODE}" ] && echo -e "    ● CM节点      : ${CM_NODE}"
    [ -n "${BD_NODE}" ] && echo -e "    ● BD节点      : ${BD_NODE}"
    if [ "$RUNTIME_MODE" = "systemd" ]; then
        echo -e "  管理指令 :"
        echo -e "    ● 查看实时日志 : journalctl -u ${SERVICE_NAME} -f"
        echo -e "    ● 查看运行状态 : systemctl status ${SERVICE_NAME}"
        echo -e "    ● 停止探针服务 : systemctl stop ${SERVICE_NAME}"
    else
        echo -e "  管理指令 :"
        echo -e "    ● 查看实时日志 : tail -f ${CONTAINER_LOG_FILE}"
        echo -e "    ● 停止探针服务 : kill \$(cat ${CONTAINER_PID_FILE})"
    fi
    echo -e "=============================================\n"
}

uninstall_probe() {
    print_banner
    echo -e "${YELLOW}[!] 开始执行无残留深度卸载清理方案...${NC}\n"
    check_root

    detect_runtime_mode

    step "停用并撤销系统守护进程..."
    if command -v systemctl >/dev/null 2>&1; then
        if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
            systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
        fi
        if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
            systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
        fi
    fi

    step "清理服务描述性系统文件..."
    rm -f "${SERVICE_FILE}"
    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload 2>/dev/null || true
        systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true
    fi

    step "销毁探针物理可执行代码文件..."
    rm -f "${SCRIPT_FILE}"

    step "抹除共享内存高速缓存区..."
    rm -f /dev/shm/.cf_ipv4 /dev/shm/.cf_ipv6 /dev/shm/.cf_region /dev/shm/.cf_probe_*

    step "抹除流量追踪数据..."
    rm -rf /var/lib/${SERVICE_NAME}
    rm -rf "${CONFIG_DIR}"

    step "清理容器模式运行痕迹..."
    if [ -f "${CONTAINER_PID_FILE}" ]; then
        local old_pid
        old_pid=$(cat "${CONTAINER_PID_FILE}" 2>/dev/null || echo "")
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null || true
        fi
        rm -f "${CONTAINER_PID_FILE}"
    fi
    rm -f "${CONTAINER_LOG_FILE}"

    step "根除孤儿或僵尸状态的探测残留进程..."
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" 2>/dev/null || true
    fi

    echo -e "\n${GREEN}╔══════════════════════════════════════════╗"
    echo -e "║     ✓ 卸载完毕！系统环境无任何残留。     ║"
    echo -e "╚══════════════════════════════════════════╝${NC}\n"
}

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
