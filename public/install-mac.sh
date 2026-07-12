#!/bin/bash
# ==============================================================================
# V1.2.0
# CF-Server-Monitor 安装/卸载脚本 (macOS 适配版)
# 支持: macOS Intel / macOS Apple Silicon (M1/M2/M3/M4)
# ==============================================================================

set -euo pipefail

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
    echo "  sudo bash $0 install -id=SERVER_ID -secret=SECRET -url=WORKER_URL [选项]"
    echo ""
    echo "必需参数:"
    echo "  -id=xxx        服务器ID"
    echo "  -secret=xxx    密钥"
    echo "  -url=xxx       上报地址"
    echo ""
    echo "可选参数:"
    echo "  -interval=N    上报间隔(秒)，默认60"
    echo "  -collect_interval=N    采样间隔(秒)，默认0"
    echo "  -ping=TYPE     探测类型: http | tcp，默认http"
    echo "  -ct=HOST       自定义CT测试节点"
    echo "  -cu=HOST       自定义CU测试节点"
    echo "  -cm=HOST       自定义CM测试节点"
    echo "  -bd=HOST       自定义BD测试节点"
    echo "  -reset_day=N   流量重置日(1-31, 0=不重置)，默认1"
    echo "  -rx_correction=N  下行流量校正(GB)，覆盖当月下行数据"
    echo "  -tx_correction=N  上行流量校正(GB)，覆盖当月上行数据"
    echo ""
    echo "示例:"
    echo "  sudo bash $0 install -id=server123 -secret=abc123 -url=https://worker.example.com"
    echo "  sudo bash $0 uninstall"
    exit 1
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
    for cmd in $deps; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing="$missing $cmd"
        else
            info "  $cmd ✓"
        fi
    done
    if [ -n "$missing" ]; then
        error "缺少必要的系统命令: $missing"
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

    cat > "${SCRIPT_FILE}" << 'PROBE_EOF'
#!/bin/bash
set -u

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
COLLECT_INTERVAL=""
REPORT_INTERVAL=""
PING_TYPE=""
CT_NODE=""
CU_NODE=""
CM_NODE=""
BD_NODE=""
RESET_DAY=""
CONFIG_MD5=""

while IFS='=' read -r key value; do
    case "$key" in
        SERVER_ID) SERVER_ID="${value%\"}"; SERVER_ID="${SERVER_ID#\"}" ;;
        SECRET) SECRET="${value%\"}"; SECRET="${SECRET#\"}" ;;
        WORKER_URL) WORKER_URL="${value%\"}"; WORKER_URL="${WORKER_URL#\"}" ;;
        COLLECT_INTERVAL) COLLECT_INTERVAL="${value%\"}"; COLLECT_INTERVAL="${COLLECT_INTERVAL#\"}" ;;
        REPORT_INTERVAL) REPORT_INTERVAL="${value%\"}"; REPORT_INTERVAL="${REPORT_INTERVAL#\"}" ;;
        PING_TYPE) PING_TYPE="${value%\"}"; PING_TYPE="${PING_TYPE#\"}" ;;
        CT_NODE) CT_NODE="${value%\"}"; CT_NODE="${CT_NODE#\"}" ;;
        CU_NODE) CU_NODE="${value%\"}"; CU_NODE="${CU_NODE#\"}" ;;
        CM_NODE) CM_NODE="${value%\"}"; CM_NODE="${CM_NODE#\"}" ;;
        BD_NODE) BD_NODE="${value%\"}"; BD_NODE="${BD_NODE#\"}" ;;
        RESET_DAY) RESET_DAY="${value%\"}"; RESET_DAY="${RESET_DAY#\"}" ;;
        CONFIG_MD5) CONFIG_MD5="${value%\"}"; CONFIG_MD5="${CONFIG_MD5#\"}" ;;
    esac
done < "${CONFIG_FILE}"

COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
REPORT_INTERVAL=${REPORT_INTERVAL:-60}
PING_TYPE=${PING_TYPE:-http}
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

log_ts() {
    date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
    echo "[INFO] $(log_ts) $*"
}

log_debug() {
    [ "$DEBUG_MODE" = "1" ] && echo "[DEBUG] $(log_ts) $*"
}

log_warn_debug() {
    [ "$DEBUG_MODE" = "1" ] && echo "[WARN] $(log_ts) $*"
}

persist_dynamic_config() {
    local tmp_file="${CONFIG_FILE}.tmp.$$"
    awk -v collect="$1" -v report="$2" -v ping="$3" -v reset="$4" -v md5="$5" -v ct="$6" -v cu="$7" -v cm="$8" -v bd="$9" '
        BEGIN { c=0; r=0; p=0; d=0; m=0; tct=0; tcu=0; tcm=0; tbd=0 }
        /^COLLECT_INTERVAL=/ { print "COLLECT_INTERVAL=\"" collect "\""; c=1; next }
        /^REPORT_INTERVAL=/ { print "REPORT_INTERVAL=\"" report "\""; r=1; next }
        /^PING_TYPE=/ { print "PING_TYPE=\"" ping "\""; p=1; next }
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
            if (!p) print "PING_TYPE=\"" ping "\""
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
    local new_collect new_ping new_report new_reset new_schema new_ct new_cu new_cm new_bd
    local new_rx_corr new_tx_corr
    bytes=$(wc -c < "$response_file" 2>/dev/null || echo 9999)
    [ "$bytes" -le 1024 ] || return 1
    body=$(cat "$response_file" 2>/dev/null) || return 1
    case "$body" in ''|*[!a-z0-9_=\&.\-]*) return 1 ;; esac
    new_md5=$(awk 'tolower($1)=="x-agent-config-md5:" { gsub("\r", "", $2); print tolower($2); exit }' "$header_file")
    [ "${#new_md5}" -eq 32 ] || return 1
    case "$new_md5" in *[!0-9a-f]*) return 1 ;; esac
    new_collect=$(printf '%s' "$body" | cut -d '&' -f 1); new_collect=${new_collect#collect_interval=}
    new_ping=$(printf '%s' "$body" | cut -d '&' -f 2); new_ping=${new_ping#ping_mode=}
    new_report=$(printf '%s' "$body" | cut -d '&' -f 3); new_report=${new_report#report_interval=}
    new_reset=$(printf '%s' "$body" | cut -d '&' -f 4); new_reset=${new_reset#reset_day=}
    new_schema=$(printf '%s' "$body" | cut -d '&' -f 5); new_schema=${new_schema#schema_version=}
    new_ct=$(printf '%s' "$body" | cut -d '&' -f 6); new_ct=${new_ct#custom_ct=}
    new_cu=$(printf '%s' "$body" | cut -d '&' -f 7); new_cu=${new_cu#custom_cu=}
    new_cm=$(printf '%s' "$body" | cut -d '&' -f 8); new_cm=${new_cm#custom_cm=}
    new_bd=$(printf '%s' "$body" | cut -d '&' -f 9); new_bd=${new_bd#custom_bd=}
    case "$new_collect" in 0|1|2|5|10) ;; *) return 1 ;; esac
    case "$new_report" in 30|60|120|180) ;; *) return 1 ;; esac
    case "$new_ping" in http|tcp) ;; *) return 1 ;; esac
    case "$new_reset" in 0|[1-9]|1[0-9]|2[0-9]|30|31) ;; *) return 1 ;; esac
    [ "$new_schema" = "1" ] || return 1
    [ "$new_report" -ge "$new_collect" ] || return 1
    new_rx_corr=""
    new_tx_corr=""
    local field_count
    field_count=$(printf '%s' "$body" | awk -F'&' '{print NF}')
    if [ "$field_count" -ge 11 ]; then
        local f10 f11
        f10=$(printf '%s' "$body" | cut -d '&' -f 10)
        f11=$(printf '%s' "$body" | cut -d '&' -f 11)
        case "$f10" in rx_correction=*) new_rx_corr="${f10#rx_correction=}" ;; esac
        case "$f11" in tx_correction=*) new_tx_corr="${f11#tx_correction=}" ;; esac
    fi
    persist_dynamic_config "$new_collect" "$new_report" "$new_ping" "$new_reset" "$new_md5" "$new_ct" "$new_cu" "$new_cm" "$new_bd" || return 1
    COLLECT_INTERVAL="$new_collect"
    REPORT_INTERVAL="$new_report"
    PING_TYPE="$new_ping"
    RESET_DAY="$new_reset"
    CT_NODE="$new_ct"
    CU_NODE="$new_cu"
    CM_NODE="$new_cm"
    BD_NODE="$new_bd"
    CONFIG_MD5="$new_md5"
    ACTIVE_INTERVAL="$REPORT_INTERVAL"
    [ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"
    log_info "Dynamic configuration applied: md5=${CONFIG_MD5} ct=${CT_NODE:-} cu=${CU_NODE:-} cm=${CM_NODE:-} bd=${BD_NODE:-}"
    if [ -n "$new_rx_corr" ] || [ -n "$new_tx_corr" ]; then
        if apply_traffic_correction "$new_rx_corr" "$new_tx_corr"; then
            send_correction_confirm "$new_rx_corr" "$new_tx_corr" || true
        fi
    fi
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
    http_code=$(curl -skS -o /dev/null -w "%{http_code}" -X POST \
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
    cat > "${TRAFFIC_DATA_FILE}" << EOF
RX_PREV=${saved_rx_prev}
TX_PREV=${saved_tx_prev}
RX_PERIOD=${saved_rx_period}
TX_PERIOD=${saved_tx_period}
LAST_CHECK=${now_ts}
PERIOD_START=${saved_period_start}
EOF
}

escape_json() {
    local val="${1:-}"
    val="${val//\\/\\\\}"
    val="${val//\"/\\\"}"
    val="${val//$'\n'/ }"
    val="${val//$'\r'/}"
    echo -n "$val"
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
    year=$(date -u -r "${now_ts}" '+%Y' 2>/dev/null)
    month=$(date -u -r "${now_ts}" '+%m' 2>/dev/null)
    day=$(date -u -r "${now_ts}" '+%d' 2>/dev/null)
    
    local target_day="${reset_day}"
    case "${month:-}" in
        02) 
            if is_leap_year "${year:-0}"; then
                [ "${target_day}" -gt 29 ] && target_day=29
            else
                [ "${target_day}" -gt 28 ] && target_day=28
            fi
            ;;
        04|06|09|11) [ "${target_day}" -gt 30 ] && target_day=30 ;;
    esac
    
    local period_start_ts
    if [ "${day:-0}" -ge "${target_day}" ]; then
        period_start_ts=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${year:-0}-${month:-01}-${target_day} 00:00:00" '+%s' 2>/dev/null || echo "${now_ts}")
    else
        local prev_month=$((month - 1))
        [ "${prev_month}" -eq 0 ] && { prev_month=12; year=$((year - 1)); }
        local prev_month_str=$(printf "%02d" "${prev_month}")
        case "${prev_month}" in
            02) 
                if is_leap_year "${year:-0}"; then
                    [ "${target_day}" -gt 29 ] && target_day=29
                else
                    [ "${target_day}" -gt 28 ] && target_day=28
                fi
                ;;
            04|06|09|11) [ "${target_day}" -gt 30 ] && target_day=30 ;;
        esac
        period_start_ts=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${year:-0}-${prev_month_str}-${target_day} 00:00:00" '+%s' 2>/dev/null || echo "${now_ts}")
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
    top -l 2 -n 0 2>/dev/null | grep "CPU usage" | tail -1 | awk '{
        split($3, user, "%");
        split($5, sys, "%");
        total = user[1] + sys[1];
        printf "%.2f\n", total
    }' || echo "0.00"
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

get_http_ping() { 
    local rtt
    rtt=$(curl -o /dev/null -s -m 3 --connect-timeout 2 -w "%{time_total}" "http://${1:-}" 2>/dev/null | awk '{printf "%.0f", $1*1000}')
    if [ -n "${rtt:-}" ] && [ "${rtt}" -gt 0 ] 2>/dev/null; then
        echo "${rtt}"
    else
        echo ""
    fi
}

get_tcp_ping() {
    local host="${1:-}"
    local port="${2:-443}"
    local scheme="http"
    local timing

    if [ -z "${host}" ]; then
        echo ""
        return
    fi

    if [ "${port}" = "443" ]; then
        scheme="https"
    fi

    timing=$(curl -k -o /dev/null -s \
        --connect-timeout 2 \
        --max-time 3 \
        -w "%{time_namelookup} %{time_connect}" \
        "${scheme}://${host}:${port}/" 2>/dev/null || true)

    awk -v t="${timing:-}" 'BEGIN{
        split(t, a, " ")
        dns = a[1] + 0
        conn = a[2] + 0
        if (conn <= 0 || conn < dns) {
            print ""
            exit
        }
        ms = int((conn - dns) * 1000 + 0.5)
        if (ms < 1) ms = 1
        print ms
    }'
}

get_ping() {
    local host="${1:-}"
    local port="${2:-443}"
    
    if [ "${PING_TYPE:-http}" = "tcp" ]; then
        get_tcp_ping "${host}" "${port}"
    else
        get_http_ping "${host}"
    fi
}

get_packet_loss() {
    local host="${1:-}"
    local count="${2:-4}"

    if [ -z "${host}" ]; then
        echo ""
        return
    fi

    local ok=0
    local i=1
    while [ "${i}" -le "${count}" ]; do
        if get_ping "${host}" 2>/dev/null | grep -qE '^[0-9]+$'; then
            ok=$((ok + 1))
        fi
        i=$((i + 1))
    done
    echo $(( (count - ok) * 100 / count ))
}

CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"

write_probe_result() {
    local dest="${1:-}"
    shift
    local tmp="${dest}.tmp"
    if "$@" > "${tmp}"; then
        mv "${tmp}" "${dest}"
    else
        rm -f "${tmp}" "${dest}"
    fi
}

refresh_latency_async() {
    [ -n "${CT_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_ping_ct" get_ping "${CT_NODE}" &
    [ -n "${CU_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_ping_cu" get_ping "${CU_NODE}" &
    [ -n "${CM_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_ping_cm" get_ping "${CM_NODE}" &
    [ -n "${BD_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_ping_bd" get_ping "${BD_NODE}" &
    [ -n "${CT_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_loss_ct" get_packet_loss "${CT_NODE}" &
    [ -n "${CU_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_loss_cu" get_packet_loss "${CU_NODE}" &
    [ -n "${CM_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_loss_cm" get_packet_loss "${CM_NODE}" &
    [ -n "${BD_NODE:-}" ] && write_probe_result "${TEMP_DIR}/.cf_loss_bd" get_packet_loss "${BD_NODE}" &
}

run_network_worker() {
    set -u
    local last_ip=0
    local last_ping=0
    
    while true; do
        local now; now=$(date +%s)
        
        if [ $((now - last_ip)) -ge 600 ] || [ "${last_ip}" -eq 0 ]; then
            (curl -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0") > "${TEMP_DIR}/.cf_ipv4.tmp" && mv "${TEMP_DIR}/.cf_ipv4.tmp" "${TEMP_DIR}/.cf_ipv4" || true
            (if route -n get -inet6 default >/dev/null 2>&1; then curl -6 -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0"; else echo "0"; fi) > "${TEMP_DIR}/.cf_ipv6.tmp" && mv "${TEMP_DIR}/.cf_ipv6.tmp" "${TEMP_DIR}/.cf_ipv6" || true
            last_ip="${now}"
        fi
        
        if [ $((now - last_ping)) -ge 30 ] || [ "${last_ping}" -eq 0 ]; then
            refresh_latency_async
            last_ping="${now}"
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
        LOAD_AVG=$(echo "${loadavg_raw}" | sed 's/[{}]//g' | awk '{print $3, $4, $5}')
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
    [ -f "${TEMP_DIR}/.cf_ping_ct" ] && PING_CT=$(cat "${TEMP_DIR}/.cf_ping_ct") || PING_CT=""
    [ -f "${TEMP_DIR}/.cf_ping_cu" ] && PING_CU=$(cat "${TEMP_DIR}/.cf_ping_cu") || PING_CU=""
    [ -f "${TEMP_DIR}/.cf_ping_cm" ] && PING_CM=$(cat "${TEMP_DIR}/.cf_ping_cm") || PING_CM=""
    [ -f "${TEMP_DIR}/.cf_ping_bd" ] && PING_BD=$(cat "${TEMP_DIR}/.cf_ping_bd") || PING_BD=""
    [ -f "${TEMP_DIR}/.cf_loss_ct" ] && LOSS_CT=$(cat "${TEMP_DIR}/.cf_loss_ct") || LOSS_CT=""
    [ -f "${TEMP_DIR}/.cf_loss_cu" ] && LOSS_CU=$(cat "${TEMP_DIR}/.cf_loss_cu") || LOSS_CU=""
    [ -f "${TEMP_DIR}/.cf_loss_cm" ] && LOSS_CM=$(cat "${TEMP_DIR}/.cf_loss_cm") || LOSS_CM=""
    [ -f "${TEMP_DIR}/.cf_loss_bd" ] && LOSS_BD=$(cat "${TEMP_DIR}/.cf_loss_bd") || LOSS_BD=""

    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")
    ELOAD=$(escape_json "${LOAD_AVG}")
    
    EPING_CT=$(escape_json "${PING_CT}")
    EPING_CU=$(escape_json "${PING_CU}")
    EPING_CM=$(escape_json "${PING_CM}")
    EPING_BD=$(escape_json "${PING_BD}")
    
    ELOSS_CT=$(escape_json "${LOSS_CT}")
    ELOSS_CU=$(escape_json "${LOSS_CU}")
    ELOSS_CM=$(escape_json "${LOSS_CM}")
    ELOSS_BD=$(escape_json "${LOSS_BD}")

    METRICS_JSON=$(cat <<EOF
{"cpu":"${CPU}","ram_total":"${RAM_TOTAL}","ram_used":"${RAM_USED}","swap_total":"${SWAP_TOTAL}","swap_used":"${SWAP_USED}","disk_total":"${DISK_TOTAL}","disk_used":"${DISK_USED}","load_avg":"${ELOAD}","boot_time":"${BOOT_TIME}","net_rx":"${RX_NOW}","net_tx":"${TX_NOW}","net_rx_monthly":"${RX_MONTHLY}","net_tx_monthly":"${TX_MONTHLY}","net_in_speed":"${RX_SPEED}","net_out_speed":"${TX_SPEED}","os":"${EOS}","arch":"${EARCH}","cpu_info":"${ECPU}","cpu_cores":"${CPU_CORES}","gpu":${GPU},"gpu_info":${GPU_INFO_VALUE},"processes":"${PROCESSES}","tcp_conn":"${TCP_CONN}","udp_conn":"${UDP_CONN}","ip_v4":"${IPV4}","ip_v6":"${IPV6}","ping_ct":"${EPING_CT}","ping_cu":"${EPING_CU}","ping_cm":"${EPING_CM}","ping_bd":"${EPING_BD}","loss_ct":"${ELOSS_CT}","loss_cu":"${ELOSS_CU}","loss_cm":"${ELOSS_CM}","loss_bd":"${ELOSS_BD}"}
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
{"id":"${SERVER_ID}","secret":"${SECRET}","metrics":${METRICS_JSON},"samples":[${SAMPLES_JSON}],"collect_interval":${COLLECT_INTERVAL},"report_interval":${REPORT_INTERVAL}}
EOF
)
        else
            PAYLOAD=$(cat <<EOF
{"id":"${SERVER_ID}","secret":"${SECRET}","metrics":${METRICS_JSON},"collect_interval":${COLLECT_INTERVAL},"report_interval":${REPORT_INTERVAL}}
EOF
)
        fi
        REPORT_RESPONSE_FILE="${TEMP_DIR}/.cf_probe_response.$$"
        REPORT_HEADER_FILE="${TEMP_DIR}/.cf_probe_headers.$$"
        REPORT_HTTP_CODE=$(curl -skS -D "$REPORT_HEADER_FILE" -o "$REPORT_RESPONSE_FILE" -w "%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -H "X-Agent-Config-Schema: 1" \
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
    
    LOOP_END_TIME=$(date +%s)
    EXEC_DURATION=$((LOOP_END_TIME - LOOP_START_TIME))
    SLEEP_TIME=$((ACTIVE_INTERVAL - EXEC_DURATION))
    [ "${SLEEP_TIME}" -le 0 ] && SLEEP_TIME=1
    sleep "${SLEEP_TIME}"
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
    COLLECT_INTERVAL=""
    REPORT_INTERVAL=""
    PING_TYPE=""
    CT_NODE=""
    CU_NODE=""
    CM_NODE=""
    BD_NODE=""
    RESET_DAY=""
    RX_CORRECTION=""
    TX_CORRECTION=""

    for arg in "$@"; do
        case "$arg" in
            -id=*) SERVER_ID="${arg#-id=}" ;;
            -secret=*) SECRET="${arg#-secret=}" ;;
            -url=*) WORKER_URL="${arg#-url=}" ;;
            -collect_interval=*|-collect=*) COLLECT_INTERVAL="${arg#*=}" ;;
            -interval=*) REPORT_INTERVAL="${arg#-interval=}" ;;
            -ping=*) PING_TYPE="${arg#-ping=}" ;;
            -ct=*) CT_NODE="${arg#-ct=}" ;;
            -cu=*) CU_NODE="${arg#-cu=}" ;;
            -cm=*) CM_NODE="${arg#-cm=}" ;;
            -bd=*) BD_NODE="${arg#-bd=}" ;;
            -reset_day=*) RESET_DAY="${arg#-reset_day=}" ;;
            -rx_correction=*) RX_CORRECTION="${arg#-rx_correction=}" ;;
            -tx_correction=*) TX_CORRECTION="${arg#-tx_correction=}" ;;
        esac
    done

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
            PING_TYPE=${PING_TYPE:-http}
            [ -z "${RESET_DAY}" ] && RESET_DAY=1
            
            step "更新配置文件..."
            cat > "${CONFIG_FILE}" << EOF
SERVER_ID="${SERVER_ID}"
SECRET="${SECRET}"
WORKER_URL="${WORKER_URL}"
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
PING_TYPE="${PING_TYPE}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
RESET_DAY="${RESET_DAY}"
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
                    COLLECT_INTERVAL) COLLECT_INTERVAL="${value%\"}"; COLLECT_INTERVAL="${COLLECT_INTERVAL#\"}" ;;
                    REPORT_INTERVAL) REPORT_INTERVAL="${value%\"}"; REPORT_INTERVAL="${REPORT_INTERVAL#\"}" ;;
                    PING_TYPE) PING_TYPE="${value%\"}"; PING_TYPE="${PING_TYPE#\"}" ;;
                    CT_NODE) CT_NODE="${value%\"}"; CT_NODE="${CT_NODE#\"}" ;;
                    CU_NODE) CU_NODE="${value%\"}"; CU_NODE="${CU_NODE#\"}" ;;
                    CM_NODE) CM_NODE="${value%\"}"; CM_NODE="${CM_NODE#\"}" ;;
                    BD_NODE) BD_NODE="${value%\"}"; BD_NODE="${BD_NODE#\"}" ;;
                    RESET_DAY) RESET_DAY="${value%\"}"; RESET_DAY="${RESET_DAY#\"}" ;;
                esac
            done < "${CONFIG_FILE}"
        fi
    else
        if [ -z "${SERVER_ID}" ] || [ -z "${SECRET}" ] || [ -z "${WORKER_URL}" ]; then
            print_usage
        fi

        COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
        REPORT_INTERVAL=${REPORT_INTERVAL:-60}
        PING_TYPE=${PING_TYPE:-http}
        [ -z "${RESET_DAY}" ] && RESET_DAY=1

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
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
PING_TYPE="${PING_TYPE}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
RESET_DAY="${RESET_DAY}"
CONFIG_MD5="none"
EOF
        chown root:wheel "${CONFIG_FILE}" 2>/dev/null || true
        chmod 600 "${CONFIG_FILE}" 2>/dev/null || true
        info "配置文件已生成: ${CONFIG_FILE}"
    fi

    COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
    REPORT_INTERVAL=${REPORT_INTERVAL:-60}

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
    echo -e "         CF-Server-Monitor 安装成功"
    echo -e "=============================================${NC}"
    echo -e "  服务状态 : ${GREEN}Active (Running)${NC}"
    echo -e "  配置参数 :"
    echo -e "    ● Server ID   : ${SERVER_ID}"
    echo -e "    ● Secret      : ********"
    echo -e "    ● Worker URL  : ${WORKER_URL}"
    echo -e "    ● 上报间隔    : ${REPORT_INTERVAL}秒"
    printf  '    ● 采样间隔    : %s秒\n' "${COLLECT_INTERVAL}"
    echo -e "    ● 探测类型    : ${PING_TYPE}"
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
