#!/bin/bash
# ==============================================================================
# V1.3.3
# CF-Server-Monitor 安装/卸载脚本 (macOS 适配版)
# 支持: macOS Intel / macOS Apple Silicon (M1/M2/M3/M4)
# ==============================================================================

set -euo pipefail

AGENT_VERSION="1.3.3"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SERVICE_NAME="cf-probe"
LAUNCHD_FILE="/Library/LaunchDaemons/com.cf.probe.plist"
LAUNCHD_LABEL="system/com.cf.probe"
SCRIPT_FILE="/usr/local/bin/${SERVICE_NAME}.sh"
CONFIG_DIR="/Library/Application Support/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
LOG_FILE="/var/log/cf-probe.log"
TEMP_DIR="/tmp/cf-probe"
MAX_TRAFFIC_CORRECTION_GB=1000000

print_banner() {
    echo -e "${CYAN}╔═════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   CF-Server-Monitor (macOS Edition) ║${NC}"
    echo -e "${CYAN}╚═════════════════════════════════════╝${NC}"
}

info() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "${BLUE}[→]${NC} $1"; }

print_usage() {
    echo -e "${RED}错误: 运行所需的入参不完整。${NC}\n"
    echo "用法:"
    echo "  sudo bash $0 install -id=SERVER_ID -secret=SECRET -base_url=BASE_URL [选项]"
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
    echo "  sudo bash $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com"
    echo "  sudo bash $0 install -id=server123 -secret=abc123 -base_url=https://worker.example.com/prefix -proxy_url=http://user:pass@proxy.example.com:8080"
    echo "  sudo bash $0 uninstall"
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

derive_base_url() {
    local url="${1%%\?*}"
    url="${url%%#*}"
    case "$url" in */update) url="${url%/update}" ;; esac
    printf '%s' "${url%/}"
}

masked_proxy_url() {
    [ -z "${1:-}" ] && { printf '%s' "direct"; return; }
    printf '%s' "$1" | sed -E 's#(https?://[^:/@]*):[^@]*@#\1:******@#'
}

check_root() {
    if [ "$(id -u)" != "0" ]; then
        error "请使用 root 权限运行此脚本: sudo bash $0"
    fi
}

detect_macos() {
    local os_name
    os_name=$(uname -s)
    if [ "$os_name" != "Darwin" ]; then
        error "此脚本仅支持 macOS 系统"
    fi
    info "macOS 环境检测通过"
}

check_dependencies() {
    step "检测系统依赖..."
    local deps="curl awk grep sed df ps netstat vm_stat sysctl"
    local missing=""
    for cmd in ${deps}; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            missing="${missing} ${cmd}"
        else
            info "  ${cmd} ✓"
        fi
    done
    if [ -n "${missing}" ]; then
        error "缺少必要的系统命令: ${missing}"
    fi
    info "所有依赖检测通过"

}

stop_old_service() {
    step "清理可能存在的旧服务进程..."
    launchctl bootout system "${LAUNCHD_FILE}" 2>/dev/null || \
        launchctl bootout "${LAUNCHD_LABEL}" 2>/dev/null || true
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" 2>/dev/null || true
    fi
}

create_script() {
    step "注入 macOS 监控采集探针..."

    mkdir -p /usr/local/bin

    cat << 'PROBE_EOF' | sed "s|__AGENT_VERSION__|${AGENT_VERSION}|g" > "${SCRIPT_FILE}"
#!/bin/bash
set -u

AGENT_VERSION="__AGENT_VERSION__"
CONFIG_DIR="/Library/Application Support/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
MAX_TRAFFIC_CORRECTION_GB=1000000
TEMP_DIR="/tmp/cf-probe"

mkdir -p "${TEMP_DIR}" 2>/dev/null || true

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

COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
REPORT_INTERVAL=${REPORT_INTERVAL:-60}
AUTO_UPDATE=${AUTO_UPDATE:-0}
case "$AUTO_UPDATE" in
    0|1) ;;
    *) AUTO_UPDATE=0 ;;
esac
[ -z "${RESET_DAY:-}" ] && RESET_DAY=1
case "${COLLECT_INTERVAL:-}" in ''|*[!0-9]*) COLLECT_INTERVAL=0 ;; esac
case "${REPORT_INTERVAL:-}" in ''|*[!0-9]*) REPORT_INTERVAL=60 ;; esac
[ "${REPORT_INTERVAL}" -lt 1 ] && REPORT_INTERVAL=60
if [ "${COLLECT_INTERVAL}" -gt 0 ] && [ "${REPORT_INTERVAL}" -lt "${COLLECT_INTERVAL}" ]; then
    REPORT_INTERVAL="${COLLECT_INTERVAL}"
fi
ACTIVE_INTERVAL="${REPORT_INTERVAL}"
[ "${COLLECT_INTERVAL}" -gt 0 ] && ACTIVE_INTERVAL="${COLLECT_INTERVAL}"
CONFIG_MD5=${CONFIG_MD5:-none}
DEBUG_MODE=${DEBUG_MODE:-0}

derive_base_url() {
    local url="${1%%\?*}"
    url="${url%%#*}"
    case "$url" in */update) url="${url%/update}" ;; esac
    printf '%s' "${url%/}"
}

BASE_URL=${BASE_URL:-}
PROXY_URL=${PROXY_URL:-}
[ -z "$BASE_URL" ] && BASE_URL=$(derive_base_url "$WORKER_URL")
BASE_URL=${BASE_URL%/}
[ -n "$BASE_URL" ] && WORKER_URL="${BASE_URL}/update"

agent_curl() {
    if [ -n "$PROXY_URL" ]; then curl --noproxy '' --proxy "$PROXY_URL" "$@"; else curl --noproxy '*' "$@"; fi
}

masked_proxy_url() {
    [ -z "${1:-}" ] && { printf '%s' "direct"; return; }
    printf '%s' "$1" | sed -E 's#(https?://[^:/@]*):[^@]*@#\1:******@#'
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

get_install_url() {
    case "$BASE_URL" in
        http://*|https://*) printf '%s/install-mac.sh' "$BASE_URL" ;;
        *) return 1 ;;
    esac
}

schedule_agent_update() {
    if [ "${AUTO_UPDATE}" != "1" ]; then
        log_warn_debug "Auto update ignored: local AUTO_UPDATE=${AUTO_UPDATE}"
        return 0
    fi

    local now last lock_file install_url update_tmp_dir candidate_dir
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
    update_tmp_dir=""
    for candidate_dir in /tmp /var/tmp /private/tmp "${CONFIG_DIR}"; do
        if mkdir -p "$candidate_dir" 2>/dev/null && [ -d "$candidate_dir" ] && [ -w "$candidate_dir" ]; then
            update_tmp_dir="$candidate_dir"
            break
        fi
    done
    if [ -z "$update_tmp_dir" ]; then
        log_warn_debug "Auto update skipped: no writable temp dir"
        return 1
    fi
    if ! install_url=$(get_install_url); then
        log_warn_debug "Auto update skipped: invalid WORKER_URL=${WORKER_URL}"
        return 1
    fi
    log_debug "Auto update requested: install_url=${install_url}"
    log_debug "Auto update temp dir: ${update_tmp_dir}"

    nohup /bin/bash -c 'tmp="$2/cf-probe-auto-update.$$"; proxy="$3"; rm -f "$tmp"; if [ -n "$proxy" ]; then curl --noproxy "" --proxy "$proxy" -fsSL --connect-timeout 5 -m 30 "$1" -o "$tmp"; else curl --noproxy "*" -fsSL --connect-timeout 5 -m 30 "$1" -o "$tmp"; fi && /bin/bash "$tmp" install; rm -f "$tmp"' _ "$install_url" "$update_tmp_dir" "$PROXY_URL" >/dev/null 2>&1 &
    printf '%s\n' "$now" > "$lock_file" 2>/dev/null || true
    log_info "Auto update scheduled"
    return 0
}

# 动态检测 stdout 指向的日志文件
PROBE_LOG_FILE=""
if [ -L /dev/fd/1 ]; then
    _log_target=$(readlink /dev/fd/1 2>/dev/null || echo "")
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
    chown root:wheel "$tmp_file" 2>/dev/null || true
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

    new_collect=""
    new_report=""
    new_reset=""
    new_schema=""
    new_ct=""
    new_cu=""
    new_cm=""
    new_bd=""
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
        rm -f "${TEMP_DIR}/.cf_probe_"* 2>/dev/null || true
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
    http_code=$(agent_curl -skS -o /dev/null -w "%{http_code}" -X POST \
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
    netstat -ib 2>/dev/null | awk '
        NR==1 {
            for (i=1; i<=NF; i++) {
                if ($i == "Ibytes") rx_col = i
                if ($i == "Obytes") tx_col = i
            }
            next
        }
        $1 !~ /^lo0/ && rx_col && tx_col {
            rx+=$rx_col
            tx+=$tx_col
        }
        END { printf "%.0f %.0f\n", rx, tx }
    ' || echo "0 0"
}

is_leap_year() {
    local year=$1
    [ $((year % 4)) -eq 0 ] && [ $((year % 100)) -ne 0 ] || [ $((year % 400)) -eq 0 ]
}

get_period_start_ts() {
    local reset_day="${1:-0}"
    [ "${reset_day}" -eq 0 ] 2>/dev/null && { echo "0"; return; }
    local now_ts="${2:-0}"
    local year month day
    year=$(date -u -r "${now_ts}" '+%Y' 2>/dev/null || echo "")
    month=$(date -u -r "${now_ts}" '+%m' 2>/dev/null || echo "")
    day=$(date -u -r "${now_ts}" '+%d' 2>/dev/null || echo "")

    # date 失败时回退为当前时间
    if [ -z "$year" ] || [ -z "$month" ] || [ -z "$day" ]; then
        year=$(date -u '+%Y' 2>/dev/null || echo "1970")
        month=$(date -u '+%m' 2>/dev/null || echo "01")
        day=$(date -u '+%d' 2>/dev/null || echo "01")
    fi

    local target_day="${reset_day}"
    case "${month}" in
        02)
            if is_leap_year "${year}"; then
                [ "${target_day}" -gt 29 ] && target_day=29
            else
                [ "${target_day}" -gt 28 ] && target_day=28
            fi
            ;;
        04|06|09|11) [ "${target_day}" -gt 30 ] && target_day=30 ;;
    esac

    local period_start_ts
    if [ "${day}" -ge "${target_day}" ]; then
        period_start_ts=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${year}-${month}-${target_day} 00:00:00" '+%s' 2>/dev/null || echo "${now_ts}")
    else
        local prev_month=$((month - 1))
        [ "${prev_month}" -eq 0 ] && { prev_month=12; year=$((year - 1)); }
        local prev_month_str=$(printf "%02d" "${prev_month}")
        case "${prev_month}" in
            02)
                if is_leap_year "${year}"; then
                    [ "${target_day}" -gt 29 ] && target_day=29
                else
                    [ "${target_day}" -gt 28 ] && target_day=28
                fi
                ;;
            04|06|09|11) [ "${target_day}" -gt 30 ] && target_day=30 ;;
        esac
        period_start_ts=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${year}-${prev_month_str}-${target_day} 00:00:00" '+%s' 2>/dev/null || echo "${now_ts}")
    fi
    echo "${period_start_ts}"
}

calc_monthly_traffic() {
    local current_rx="${1:-0}"
    local current_tx="${2:-0}"
    local reset_day="${RESET_DAY:-1}"
    local now_ts
    now_ts=$(date '+%s')
    
    mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
    
    local saved_rx_prev=0 saved_tx_prev=0 saved_rx_period=0 saved_tx_period=0 saved_last_check=0 saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        local tmp_rx_prev tmp_tx_prev tmp_rx_period tmp_tx_period tmp_last_check tmp_period_start
        while IFS='=' read -r key value; do
            case "$key" in
                RX_PREV) tmp_rx_prev="${value:-0}" ;;
                TX_PREV) tmp_tx_prev="${value:-0}" ;;
                RX_PERIOD) tmp_rx_period="${value:-0}" ;;
                TX_PERIOD) tmp_tx_period="${value:-0}" ;;
                LAST_CHECK) tmp_last_check="${value:-0}" ;;
                PERIOD_START) tmp_period_start="${value:-0}" ;;
            esac
        done < "${TRAFFIC_DATA_FILE}"
        saved_rx_prev=${tmp_rx_prev:-0}; saved_tx_prev=${tmp_tx_prev:-0}
        saved_rx_period=${tmp_rx_period:-0}; saved_tx_period=${tmp_tx_period:-0}
        saved_last_check=${tmp_last_check:-0}; saved_period_start=${tmp_period_start:-0}
    fi
    
    local period_start_ts
    period_start_ts=$(get_period_start_ts "${reset_day}" "${now_ts}")
    
    local rx_delta=0 tx_delta=0
    if [ "${saved_last_check}" -ne 0 ]; then
        if [ "${current_rx}" -lt "${saved_rx_prev}" ] || [ "${current_tx}" -lt "${saved_tx_prev}" ]; then
            rx_delta=0; tx_delta=0
        else
            rx_delta=$((current_rx - saved_rx_prev))
            tx_delta=$((current_tx - saved_tx_prev))
        fi
        
        if [ "${period_start_ts}" -ne 0 ] && [ "${period_start_ts}" -ne "${saved_period_start}" ] && [ "${saved_period_start}" -ne 0 ]; then
            saved_rx_period="${rx_delta}"; saved_tx_period="${tx_delta}"
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
    
    echo "${saved_rx_period} ${saved_tx_period}"
}

get_cpu_stat() {
    local cpu_ticks
    cpu_ticks=$(sysctl -n kern.cp_time 2>/dev/null || echo "")
    if [ -n "$cpu_ticks" ]; then
        local user nice sys intr idle total
        user=$(echo "$cpu_ticks" | awk '{print $1}')
        nice=$(echo "$cpu_ticks" | awk '{print $2}')
        sys=$(echo "$cpu_ticks" | awk '{print $3}')
        intr=$(echo "$cpu_ticks" | awk '{print $4}')
        idle=$(echo "$cpu_ticks" | awk '{print $5}')
        total=$((user + nice + sys + intr + idle))
        local prev_file="/tmp/cf-probe/.cf_cpu_prev"
        local prev_total=0 prev_idle=0
        if [ -f "$prev_file" ]; then
            local prev=$(cat "$prev_file" 2>/dev/null || echo "0 0")
            prev_total=${prev%% *}
            prev_idle=${prev##* }
        fi
        mkdir -p /tmp/cf-probe 2>/dev/null || true
        echo "$total $idle" > "${prev_file}.tmp" && mv "${prev_file}.tmp" "$prev_file" 2>/dev/null || true
        local diff_total=$((total - prev_total))
        local diff_idle=$((idle - prev_idle))
        if [ "$diff_total" -gt 0 ]; then
            local usage=$(( (diff_total - diff_idle) * 100 / diff_total ))
            printf "%.2f\n" "$usage"
        else
            echo "0.00"
        fi
    else
        top -l 1 -n 0 2>/dev/null | grep "CPU usage" | tail -1 | awk '{
            split($3, user, "%");
            split($5, sys, "%");
            total = user[1] + sys[1];
            printf "%.2f\n", total
        }' || echo "0.00"
    fi
}

get_memory_stats() {
    local mem_total_bytes page_size free_pages active_pages inactive_pages wired_pages speculative_pages
    
    mem_total_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    mem_total_bytes=${mem_total_bytes:-0}
    
    page_size=$(sysctl -n hw.pagesize 2>/dev/null || echo "")
    if [ -z "${page_size:-}" ]; then
        page_size=$(vm_stat 2>/dev/null | grep "page size of" | awk '{print $8}')
    fi
    page_size=${page_size:-4096}
    
    local vm_stat_output
    vm_stat_output=$(vm_stat 2>/dev/null)
    
    free_pages=$(echo "${vm_stat_output}" | grep "Pages free:" | awk '{print $3}' | tr -d '.')
    free_pages=${free_pages:-0}
    
    active_pages=$(echo "${vm_stat_output}" | grep "Pages active:" | awk '{print $3}' | tr -d '.')
    active_pages=${active_pages:-0}
    
    inactive_pages=$(echo "${vm_stat_output}" | grep "Pages inactive:" | awk '{print $3}' | tr -d '.')
    inactive_pages=${inactive_pages:-0}
    
    wired_pages=$(echo "${vm_stat_output}" | grep "Pages wired down:" | awk '{print $4}' | tr -d '.')
    wired_pages=${wired_pages:-0}
    
    speculative_pages=$(echo "${vm_stat_output}" | grep "Pages speculative:" | awk '{print $3}' | tr -d '.')
    speculative_pages=${speculative_pages:-0}
    
    local ram_total=$((mem_total_bytes / 1024 / 1024))
    local avail_pages=$((free_pages + inactive_pages + speculative_pages))
    local avail_bytes=$((avail_pages * page_size))
    local ram_used=$(((mem_total_bytes - avail_bytes) / 1024 / 1024))
    
    [ "${ram_used}" -lt 0 ] && ram_used=0
    
    echo "${ram_total} ${ram_used}"
}

get_swap_stats() {
    local swap_usage
    swap_usage=$(sysctl vm.swapusage 2>/dev/null || echo "")
    
    local swap_total=0
    local swap_used=0
    
    if [ -n "${swap_usage}" ]; then
        swap_total=$(echo "${swap_usage}" | awk '
            /total =/ {
                for (i=1; i<=NF; i++) {
                    if ($i == "=") {
                        val = $(i+1);
                        suffix = substr(val, length(val));
                        num = substr(val, 1, length(val)-1) + 0;
                        if (suffix == "G") num = num * 1024;
                        printf "%.0f", num;
                        exit;
                    }
                }
            }
        ')
        swap_total=${swap_total:-0}
        
        swap_used=$(echo "${swap_usage}" | awk '
            /used =/ {
                for (i=1; i<=NF; i++) {
                    if ($i == "=") {
                        val = $(i+1);
                        suffix = substr(val, length(val));
                        num = substr(val, 1, length(val)-1) + 0;
                        if (suffix == "G") num = num * 1024;
                        printf "%.0f", num;
                        exit;
                    }
                }
            }
        ')
        swap_used=${swap_used:-0}
    fi
    
    echo "${swap_total} ${swap_used}"
}

get_gpu_metrics() {
    local gpu_usage="null"
    local gpu_info=""

    gpu_info=$(system_profiler SPDisplaysDataType 2>/dev/null | grep "Chipset Model" | awk -F': ' '{print $2}' | xargs || true)

    if [ -n "${gpu_info}" ]; then
        if [ "$(id -u)" = "0" ] && command -v powermetrics >/dev/null 2>&1; then
            local pm_output=""
            
            pm_output=$(powermetrics --samplers=gpu_power -i1 -n1 2>/dev/null || true)
            if [ -n "${pm_output}" ]; then
                gpu_usage=$(echo "${pm_output}" | awk '/gpu_active|GPU active|active percentage|utilization|active%/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9]+%?$/) {sub(/%/,"",$i); print $i; exit}}' || true)
            fi

            if [ -z "${gpu_usage}" ] || ! echo "${gpu_usage}" | grep -qE '^[0-9]+$'; then
                pm_output=$(powermetrics --samplers=gpu -i1 -n1 2>/dev/null || true)
                if [ -n "${pm_output}" ]; then
                    gpu_usage=$(echo "${pm_output}" | awk '/gpu_active|GPU active|active percentage|utilization|active%/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9]+%?$/) {sub(/%/,"",$i); print $i; exit}}' || true)
                fi
            fi

            if [ -z "${gpu_usage}" ] || ! echo "${gpu_usage}" | grep -qE '^[0-9]+$'; then
                pm_output=$(powermetrics --samplers=power -i1 -n1 2>/dev/null || true)
                if [ -n "${pm_output}" ]; then
                    gpu_usage=$(echo "${pm_output}" | awk '/gpu_active|GPU active|active percentage|utilization|active%/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9]+%?$/) {sub(/%/,"",$i); print $i; exit}}' || true)
                fi
            fi

            if [ -z "${gpu_usage}" ] || ! echo "${gpu_usage}" | grep -qE '^[0-9]+$'; then
                pm_output=$(powermetrics -i1 -n1 2>/dev/null || true)
                if [ -n "${pm_output}" ]; then
                    gpu_usage=$(echo "${pm_output}" | awk '/gpu_active|GPU active|active percentage|utilization|active%/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9]+%?$/) {sub(/%/,"",$i); print $i; exit}}' || true)
                fi
            fi

            if [ -z "${gpu_usage}" ] || ! echo "${gpu_usage}" | grep -qE '^[0-9]+$'; then
                pm_output=$(powermetrics --samplers=gpu_power -i1 -n1 2>/dev/null || true)
                if [ -n "${pm_output}" ]; then
                    gpu_usage=$(echo "${pm_output}" | grep -oE '[0-9]+%' | head -1 | tr -d '%' || true)
                fi
            fi

            if [ -z "${gpu_usage}" ] || ! echo "${gpu_usage}" | grep -qE '^[0-9]+$'; then
                pm_output=$(powermetrics --samplers=gpu_power -i1 -n1 2>/dev/null || true)
                if [ -n "${pm_output}" ]; then
                    gpu_usage=$(echo "${pm_output}" | grep -oE '[0-9]+' | head -1 || true)
                fi
            fi
        fi

        if [ -z "${gpu_usage}" ] || ! echo "${gpu_usage}" | grep -qE '^[0-9]+$'; then
            gpu_usage="null"
        else
            gpu_usage=$((10#${gpu_usage}))
        fi

        printf '%s\n%s\n' "${gpu_usage}" "$(json_string_or_null "${gpu_info}")"
    else
        printf 'null\nnull\n'
    fi
}

json_string_or_null() {
    local val="${1:-}"
    if [ -z "${val}" ]; then
        echo "null"
    else
        echo "\"$(escape_json "${val}")\""
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
    icmp_out=$(ping -c "$count" -W 2000 "$host" 2>/dev/null)
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
    local dest="${1:-}"
    shift
    local tmp="${dest}.tmp"
    rm -f "${tmp}"
    "$@" > "${tmp}" 2>/dev/null || true
    if [ -s "${tmp}" ]; then
        mv "${tmp}" "${dest}"
    else
        rm -f "${tmp}" "${dest}"
    fi
}

refresh_probe_async() {
    [ -n "${CT_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_probe_ct" get_probe "${CT_NODE}" 4 443 &
    [ -n "${CU_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_probe_cu" get_probe "${CU_NODE}" 4 443 &
    [ -n "${CM_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_probe_cm" get_probe "${CM_NODE}" 4 443 &
    [ -n "${BD_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_probe_bd" get_probe "${BD_NODE}" 4 443 &
    wait
}

run_network_worker() {
    set -u
    local last_ip=0
    local last_probe=0
    local probe_interval="${REPORT_INTERVAL:-60}"
    case "${probe_interval}" in ''|*[!0-9]*) probe_interval=60 ;; esac
    [ "${probe_interval}" -lt 30 ] && probe_interval=30
    [ "${probe_interval}" -gt 60 ] && probe_interval=60

    while true; do
        local now; now=$(date +%s)

        if [ $((now - last_ip)) -ge 600 ] || [ "${last_ip}" -eq 0 ]; then
            local direct_trace direct_region
            direct_trace=$(curl --noproxy '*' -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null || true)
            (printf '%s\n' "$direct_trace" | grep -q '^ip=' && echo "1" || echo "0") > "${TEMP_DIR}/.cf_ipv4.tmp" && mv "${TEMP_DIR}/.cf_ipv4.tmp" "${TEMP_DIR}/.cf_ipv4" || true
            direct_region=$(printf '%s\n' "$direct_trace" | awk -F= '$1 == "loc" && $2 ~ /^[A-Za-z][A-Za-z]$/ { print toupper($2); exit }')
            case "$direct_region" in
                [A-Z][A-Z]) printf '%s\n' "$direct_region" > "${TEMP_DIR}/.cf_region.tmp" && mv "${TEMP_DIR}/.cf_region.tmp" "${TEMP_DIR}/.cf_region" || true ;;
            esac
            (if route -n get -inet6 default >/dev/null 2>&1; then curl --noproxy '*' -6 -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0"; else echo "0"; fi) > "${TEMP_DIR}/.cf_ipv6.tmp" && mv "${TEMP_DIR}/.cf_ipv6.tmp" "${TEMP_DIR}/.cf_ipv6" || true
            last_ip="${now}"
        fi

        if [ $((now - last_probe)) -ge "${probe_interval}" ] || [ "${last_probe}" -eq 0 ]; then
            refresh_probe_async
            last_probe="${now}"
        fi
        sleep 5
    done
}

wait_for_network() {
    local max_wait=30
    local wait_step=2
    local waited=0
    while [ "${waited}" -lt "${max_wait}" ]; do
        if ping -c 1 -t 1 8.8.8.8 2>/dev/null | grep -q "64 bytes"; then
            return 0
        fi
        sleep "${wait_step}"
        waited=$((waited + wait_step))
    done
    return 0
}

echo "[INFO] CF-Server-Monitor Probe Engine Starting..."
echo "[INFO] Waiting for network availability..."
wait_for_network
echo "[INFO] Network ready, proceeding with initialization..."

NET_STAT=$(get_net_bytes)
RX_PREV=$(echo "${NET_STAT}" | awk '{print $1}'); RX_PREV=${RX_PREV:-0}
TX_PREV=$(echo "${NET_STAT}" | awk '{print $2}'); TX_PREV=${TX_PREV:-0}

PREV_LOOP_TIME=$(date +%s)

OS="$(sw_vers -productName 2>/dev/null || echo "macOS") $(sw_vers -productVersion 2>/dev/null || echo "")"
ARCH=$(uname -m)
CPU_INFO=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "")
if [ -z "${CPU_INFO:-}" ] || [ "${CPU_INFO}" = "unknown" ]; then
    CPU_INFO=$(system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | awk -F': ' '{print $2}' | xargs || echo "")
fi
[ -z "${CPU_INFO:-}" ] && CPU_INFO="${ARCH}"
CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "1")

GPU_METRICS=$(get_gpu_metrics)
GPU=$(echo "${GPU_METRICS}" | awk 'NR==1{print $1}'); GPU=${GPU:-null}
GPU_INFO_VALUE=$(echo "${GPU_METRICS}" | awk 'NR==2{print}')
[ -z "${GPU_INFO_VALUE:-}" ] && GPU_INFO_VALUE="null"

echo "[INFO] CF-Server-Monitor Probe Engine Started Successfully."

run_network_worker &
WORKER_PID=$!
SAMPLES_JSON=""
SAMPLE_COUNT=0
LAST_REPORT_TIME=0

while true; do
    LOOP_START_TIME=$(date +%s)
    rotate_log_if_needed "$PROBE_LOG_FILE"

    if ! kill -0 "${WORKER_PID}" 2>/dev/null; then
        run_network_worker &
        WORKER_PID=$!
    fi
    
    MEM_STATS=$(get_memory_stats)
    RAM_TOTAL=$(echo "${MEM_STATS}" | awk '{print $1}'); RAM_TOTAL=${RAM_TOTAL:-0}
    RAM_USED=$(echo "${MEM_STATS}" | awk '{print $2}'); RAM_USED=${RAM_USED:-0}

    SWAP_STATS=$(get_swap_stats)
    SWAP_TOTAL=$(echo "${SWAP_STATS}" | awk '{print $1}'); SWAP_TOTAL=${SWAP_TOTAL:-0}
    SWAP_USED=$(echo "${SWAP_STATS}" | awk '{print $2}'); SWAP_USED=${SWAP_USED:-0}

    DISK_TOTAL=0; DISK_USED=0
    DISK_STATS=$(df -kP 2>/dev/null | awk '
        NR>1 &&
        $1 ~ /^\/dev\/disk/ &&
        $1 !~ /devfs/ &&
        $1 !~ /tmpfs/ &&
        $1 !~ /^map/ &&
        $1 !~ /automount/ &&
        $NF !~ /\/Volumes\// { 
            total+=$2; used+=$3
        } 
        END {print total, used}
    ')

    if [ -n "${DISK_STATS:-}" ]; then
        DISK_TOTAL=$(echo "${DISK_STATS}" | awk '{print int($1/1024)}')
        DISK_USED=$(echo "${DISK_STATS}" | awk '{print int($2/1024)}')
    fi

    CPU=$(get_cpu_stat)

    GPU_METRICS=$(get_gpu_metrics)
    GPU=$(echo "${GPU_METRICS}" | awk 'NR==1{print $1}'); GPU=${GPU:-null}

    BOOT_TIME=""
    boot_time_raw=$(sysctl kern.boottime 2>/dev/null || echo "")
    if [ -n "${boot_time_raw:-}" ]; then
        BOOT_TIME=$(echo "${boot_time_raw}" | awk '
            {
                for (i=1; i<=NF; i++) {
                    if ($i == "sec") {
                        val = $(i+2);
                        gsub(/,/, "", val);
                        print val;
                        exit;
                    }
                }
            }
        ')
        BOOT_TIME=${BOOT_TIME:-0}
        BOOT_TIME=$((BOOT_TIME * 1000))
    else
        BOOT_TIME=0
    fi
    
    LOAD_AVG=""
    loadavg_raw=$(sysctl vm.loadavg 2>/dev/null || echo "")
    if [ -n "${loadavg_raw:-}" ]; then
        LOAD_AVG=$(echo "${loadavg_raw}" | sed 's/[{}]//g' | awk '{print $1, $2, $3}')
    fi
    LOAD_AVG=${LOAD_AVG:-"0 0 0"}
    
    PROCESSES=$(ps -e 2>/dev/null | wc -l || echo 0)
    PROCESSES=$(printf "%d" "${PROCESSES}")

    TCP_CONN=""
    TCP_CONN=$(netstat -an -p tcp 2>/dev/null | grep ESTABLISHED | wc -l || echo 0)
    TCP_CONN=${TCP_CONN:-0}
    TCP_CONN=$(printf "%d" "${TCP_CONN}")

    UDP_CONN=""
    UDP_CONN=$(netstat -an -p udp 2>/dev/null | grep -v "^Active" | grep -v "^Proto" | wc -l || echo 0)
    UDP_CONN=${UDP_CONN:-0}
    UDP_CONN=$(printf "%d" "${UDP_CONN}")

    NET_STAT=$(get_net_bytes)
    RX_NOW=$(echo "${NET_STAT}" | awk '{print $1}'); RX_NOW=${RX_NOW:-0}
    TX_NOW=$(echo "${NET_STAT}" | awk '{print $2}'); TX_NOW=${TX_NOW:-0}
    
    MONTHLY_TRAFFIC=$(calc_monthly_traffic "${RX_NOW}" "${TX_NOW}")
    RX_MONTHLY=$(echo "${MONTHLY_TRAFFIC}" | awk '{print $1}')
    TX_MONTHLY=$(echo "${MONTHLY_TRAFFIC}" | awk '{print $2}')
    
    TIME_DELTA=$((LOOP_START_TIME - PREV_LOOP_TIME))
    [ "${TIME_DELTA}" -le 0 ] && TIME_DELTA="${ACTIVE_INTERVAL}"
    
    RX_DELTA=$((RX_NOW - RX_PREV))
    TX_DELTA=$((TX_NOW - TX_PREV))
    [ "${RX_DELTA}" -lt 0 ] && RX_DELTA=0
    [ "${TX_DELTA}" -lt 0 ] && TX_DELTA=0
    
    RX_SPEED=$(safe_div "${RX_DELTA}" "${TIME_DELTA}" "0")
    TX_SPEED=$(safe_div "${TX_DELTA}" "${TIME_DELTA}" "0")
    
    RX_PREV="${RX_NOW}"
    TX_PREV="${TX_NOW}"
    PREV_LOOP_TIME="${LOOP_START_TIME}"

    [ -f "${TEMP_DIR}/.cf_ipv4" ] && IPV4=$(cat "${TEMP_DIR}/.cf_ipv4") || IPV4="0"
    [ -f "${TEMP_DIR}/.cf_ipv6" ] && IPV6=$(cat "${TEMP_DIR}/.cf_ipv6") || IPV6="0"
    [ -f "${TEMP_DIR}/.cf_region" ] && AGENT_REGION=$(cat "${TEMP_DIR}/.cf_region") || AGENT_REGION=""
    case "$AGENT_REGION" in [A-Z][A-Z]) ;; *) AGENT_REGION="" ;; esac
    if [ -f "${TEMP_DIR}/.cf_probe_ct" ]; then _p=$(cat "${TEMP_DIR}/.cf_probe_ct"); PING_CT=${_p%% *}; LOSS_CT=${_p##* }; else PING_CT=""; LOSS_CT=""; fi
    if [ -f "${TEMP_DIR}/.cf_probe_cu" ]; then _p=$(cat "${TEMP_DIR}/.cf_probe_cu"); PING_CU=${_p%% *}; LOSS_CU=${_p##* }; else PING_CU=""; LOSS_CU=""; fi
    if [ -f "${TEMP_DIR}/.cf_probe_cm" ]; then _p=$(cat "${TEMP_DIR}/.cf_probe_cm"); PING_CM=${_p%% *}; LOSS_CM=${_p##* }; else PING_CM=""; LOSS_CM=""; fi
    if [ -f "${TEMP_DIR}/.cf_probe_bd" ]; then _p=$(cat "${TEMP_DIR}/.cf_probe_bd"); PING_BD=${_p%% *}; LOSS_BD=${_p##* }; else PING_BD=""; LOSS_BD=""; fi

    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")
    ELOAD=$(escape_json "${LOAD_AVG}")
    PING_CT_JSON=$(json_probe_value "$CT_NODE" "$PING_CT")
    PING_CU_JSON=$(json_probe_value "$CU_NODE" "$PING_CU")
    PING_CM_JSON=$(json_probe_value "$CM_NODE" "$PING_CM")
    PING_BD_JSON=$(json_probe_value "$BD_NODE" "$PING_BD")
    LOSS_CT_JSON=$(json_probe_value "$CT_NODE" "$LOSS_CT")
    LOSS_CU_JSON=$(json_probe_value "$CU_NODE" "$LOSS_CU")
    LOSS_CM_JSON=$(json_probe_value "$CM_NODE" "$LOSS_CM")
    LOSS_BD_JSON=$(json_probe_value "$BD_NODE" "$LOSS_BD")
    
    METRICS_JSON=$(cat <<EOF
{"cpu":"${CPU}","ram_total":"${RAM_TOTAL}","ram_used":"${RAM_USED}","swap_total":"${SWAP_TOTAL}","swap_used":"${SWAP_USED}","disk_total":"${DISK_TOTAL}","disk_used":"${DISK_USED}","load_avg":"${ELOAD}","boot_time":"${BOOT_TIME}","net_rx":"${RX_NOW}","net_tx":"${TX_NOW}","net_rx_monthly":"${RX_MONTHLY}","net_tx_monthly":"${TX_MONTHLY}","net_in_speed":"${RX_SPEED}","net_out_speed":"${TX_SPEED}","os":"${EOS}","arch":"${EARCH}","cpu_info":"${ECPU}","cpu_cores":"${CPU_CORES}","gpu":${GPU},"gpu_info":${GPU_INFO_VALUE},"processes":"${PROCESSES}","tcp_conn":"${TCP_CONN}","udp_conn":"${UDP_CONN}","ip_v4":"${IPV4}","ip_v6":"${IPV6}","ping_ct":${PING_CT_JSON},"ping_cu":${PING_CU_JSON},"ping_cm":${PING_CM_JSON},"ping_bd":${PING_BD_JSON},"loss_ct":${LOSS_CT_JSON},"loss_cu":${LOSS_CU_JSON},"loss_cm":${LOSS_CM_JSON},"loss_bd":${LOSS_BD_JSON}}
EOF
)
    if [ "${COLLECT_INTERVAL}" -gt 0 ]; then
        SAMPLE_TS=$((LOOP_START_TIME * 1000))
        SAMPLE_JSON="{\"ts\":${SAMPLE_TS},\"metrics\":${METRICS_JSON}}"
        if [ -z "${SAMPLES_JSON:-}" ]; then
            SAMPLES_JSON="${SAMPLE_JSON}"
        else
            SAMPLES_JSON="${SAMPLES_JSON},${SAMPLE_JSON}"
        fi
        SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
    fi

    if [ "${LAST_REPORT_TIME}" -eq 0 ] || [ $((LOOP_START_TIME - LAST_REPORT_TIME)) -ge "${REPORT_INTERVAL}" ]; then
        if [ "${COLLECT_INTERVAL}" -gt 0 ]; then
            PAYLOAD=$(cat <<EOF
{"id":"${SERVER_ID}","secret":"${SECRET}","agent_region":"${AGENT_REGION}","metrics":${METRICS_JSON},"samples":[${SAMPLES_JSON}],"collect_interval":${COLLECT_INTERVAL},"report_interval":${REPORT_INTERVAL}}
EOF
)
        else
            PAYLOAD=$(cat <<EOF
{"id":"${SERVER_ID}","secret":"${SECRET}","agent_region":"${AGENT_REGION}","metrics":${METRICS_JSON},"collect_interval":${COLLECT_INTERVAL},"report_interval":${REPORT_INTERVAL}}
EOF
)
        fi
        REPORT_RESPONSE_FILE="${TEMP_DIR}/.cf_probe_response.$$"
        REPORT_HEADER_FILE="${TEMP_DIR}/.cf_probe_headers.$$"
        REPORT_HTTP_CODE=$(agent_curl -skS -D "$REPORT_HEADER_FILE" -o "$REPORT_RESPONSE_FILE" -w "%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -H "X-Agent-Config-Schema: 2" \
            -H "X-Agent-Version: ${AGENT_VERSION}" \
            -H "X-Agent-Config-Md5: ${CONFIG_MD5:-none}" \
            -d "${PAYLOAD}" -m 8 --connect-timeout 3 "${WORKER_URL}" 2>/dev/null || echo 000)
        case "$REPORT_HTTP_CODE" in ''|*[!0-9]*) REPORT_HTTP_CODE=000 ;; esac
        if [ "$REPORT_HTTP_CODE" = "200" ]; then
            apply_remote_config "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" || true
        fi
        rm -f "$REPORT_RESPONSE_FILE" "$REPORT_HEADER_FILE" 2>/dev/null || true
        SAMPLES_JSON=""
        SAMPLE_COUNT=0
        LAST_REPORT_TIME="${LOOP_START_TIME}"
    fi
    
    sleep "${ACTIVE_INTERVAL}"
done
PROBE_EOF

    chmod 755 "${SCRIPT_FILE}"
    chown root:wheel "${SCRIPT_FILE}"
    info "探针脚本注入完成: ${SCRIPT_FILE}"
}

create_service() {
    step "构建 launchd 守护配置..."
    
    cat > "${LAUNCHD_FILE}" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cf.probe</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SCRIPT_FILE}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>UserName</key>
    <string>root</string>
    <key>GroupName</key>
    <string>wheel</string>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
    <key>Nice</key>
    <integer>19</integer>
    <key>WorkingDirectory</key>
    <string>/usr/local/bin</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

    chown root:wheel "${LAUNCHD_FILE}"
    chmod 644 "${LAUNCHD_FILE}"
    info "launchd 守护配置文件生成成功: ${LAUNCHD_FILE}"
}

start_service() {
    step "加载 launchd 服务并激活监控探针..."
    
    if ! launchctl bootstrap system "${LAUNCHD_FILE}" 2>/dev/null; then
        error "探针服务配置加载失败。请执行命令排查原因: launchctl bootstrap system ${LAUNCHD_FILE}"
    fi
    
    sleep 2
    if launchctl print "${LAUNCHD_LABEL}" 2>/dev/null | grep -q "com.cf.probe"; then
        if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
            info "探针监控引擎已进入平稳运行状态。"
        else
            warn "探针服务配置已加载，进程未启动，执行强制启动..."
            launchctl kickstart -k "${LAUNCHD_LABEL}" 2>/dev/null || true
            sleep 2
            if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
                info "探针服务强制启动成功。"
            else
                error "探针服务未能启动成功。请执行命令排查原因: tail -50 ${LOG_FILE}"
            fi
        fi
    else
        error "探针服务配置加载失败。请执行命令排查原因: launchctl print ${LAUNCHD_LABEL}"
    fi
}

verify_install() {
    step "执行安装后自检..."
    
    local all_pass=1
    
    step "1. 验证 plist 文件格式..."
    if plutil -lint "${LAUNCHD_FILE}" 2>/dev/null; then
        info "plist 文件格式验证通过"
    else
        warn "plist 文件格式验证失败"
        all_pass=0
    fi
    
    step "2. 验证 launchd 服务状态..."
    if launchctl print "${LAUNCHD_LABEL}" 2>/dev/null | grep -q "com.cf.probe"; then
        info "launchd 服务配置已加载"
    else
        warn "launchd 服务配置未加载"
        all_pass=0
    fi
    
    step "3. 验证探针进程..."
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        info "探针进程运行正常"
    else
        warn "探针进程未检测到"
        all_pass=0
    fi
    
    if [ "${all_pass}" -eq 1 ]; then
        info "安装后自检全部通过"
    else
        warn "安装后自检存在问题，请检查日志: tail -50 ${LOG_FILE}"
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
    detect_macos
    check_dependencies
    stop_old_service

    if [ -f "${CONFIG_FILE}" ]; then
        step "检测到已有配置文件，执行二次安装..."

        if [ -n "${SERVER_ID}" ] && [ -n "${SECRET}" ] && [ -n "${WORKER_URL}" ]; then
            COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
            REPORT_INTERVAL=${REPORT_INTERVAL:-60}
            [ -z "${RESET_DAY}" ] && RESET_DAY=1
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
            chown root:wheel "${CONFIG_FILE}" 2>/dev/null || true
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
        [ -z "${RESET_DAY}" ] && RESET_DAY=1
        AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"

        step "创建配置目录..."
        mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
        chown root:wheel "${CONFIG_DIR}" 2>/dev/null || true
        chmod 700 "${CONFIG_DIR}" 2>/dev/null || true

        if [ ! -f "${TRAFFIC_DATA_FILE}" ]; then
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
        chown root:wheel "${CONFIG_FILE}" 2>/dev/null || true
        chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
        info "配置文件已生成: ${CONFIG_FILE}"
    fi

    COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
    REPORT_INTERVAL=${REPORT_INTERVAL:-60}
    AUTO_UPDATE=$(normalize_binary_value "$AUTO_UPDATE" 0) || error "auto_update 参数非法，仅支持 0 或 1"

    if [ -n "${RX_CORRECTION}" ] || [ -n "${TX_CORRECTION}" ]; then
        step "应用流量校正..."
        
        mkdir -p "${CONFIG_DIR}" 2>/dev/null || true
        chown root:wheel "${CONFIG_DIR}" 2>/dev/null || true
        chmod 700 "${CONFIG_DIR}" 2>/dev/null || true
        local now_ts=$(date '+%s')
        local rx_correction_bytes=0 tx_correction_bytes=0
        local net_stat
        net_stat=$(netstat -ib 2>/dev/null | awk '
        NR==1 { for (i=1; i<=NF; i++) { if ($i == "Ibytes") rx_col = i; if ($i == "Obytes") tx_col = i; } next }
        $1 !~ /^lo0/ && rx_col && tx_col { rx+=$rx_col; tx+=$tx_col }
        END { printf "%.0f %.0f\n", rx, tx }
    ' || echo "0 0")
        local current_rx=$(echo "${net_stat}" | awk '{print $1}')
        local current_tx=$(echo "${net_stat}" | awk '{print $2}')
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
    verify_install

    echo -e "\n${GREEN}============================================="
    echo -e "         CF-Server-Monitor ${AGENT_VERSION} 安装成功"
    echo -e "=============================================${NC}"
    echo -e "  服务状态 : ${GREEN}Active (Running)${NC}"
    echo -e "  配置参数 :"
    echo -e "    ● Server ID   : ${SERVER_ID}"
    echo -e "    ● Secret      : ********"
    echo -e "    ● Base URL    : ${BASE_URL}"
    echo -e "    ● Proxy       : $(masked_proxy_url "${PROXY_URL}")"
    echo -e "    ● 上报间隔    : ${REPORT_INTERVAL}秒"
    printf  '    ● 采样间隔    : %s秒\n' "${COLLECT_INTERVAL}"
    echo -e "    ● 自动更新    : ${AUTO_UPDATE}"
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
    echo -e "  管理指令 :"
    echo -e "    ● 查看实时日志 : tail -f ${LOG_FILE}"
    echo -e "    ● 查看运行状态 : launchctl print ${LAUNCHD_LABEL}"
    echo -e "    ● 停止探针服务 : sudo launchctl bootout ${LAUNCHD_LABEL}"
    echo -e "    ● 重启探针服务 : sudo launchctl kickstart -k ${LAUNCHD_LABEL}"
    echo -e "=============================================\n"
}

uninstall_probe() {
    print_banner
    echo -e "${YELLOW}[!] 开始执行无残留深度卸载清理方案...${NC}\n"
    check_root

    step "停用并撤销 launchd 守护进程..."
    launchctl bootout system "${LAUNCHD_FILE}" 2>/dev/null || \
        launchctl bootout "${LAUNCHD_LABEL}" 2>/dev/null || true

    step "清理服务描述性系统文件..."
    rm -f "${LAUNCHD_FILE}" 2>/dev/null || true

    step "销毁探针物理可执行代码文件..."
    rm -f "${SCRIPT_FILE}" 2>/dev/null || true

    step "抹除临时缓存区..."
    rm -rf "${TEMP_DIR}" 2>/dev/null || true

    step "抹除流量追踪数据..."
    rm -rf "${CONFIG_DIR}" 2>/dev/null || true

    step "清理日志文件..."
    rm -f "${LOG_FILE}" 2>/dev/null || true

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
