#!/bin/sh
# ==============================================================================
# V1.2.0
# CF-Server-Monitor 安装/卸载脚本 (OpenWrt 专用版)
# 支持: OpenWrt / LEDE / ImmortalWrt (procd + opkg)
# 纯 POSIX sh 实现，无 bash 依赖
# Fixes: 1. 独立协程无 wait 阻塞 2. 原子化原子覆盖 3. 兼容 procd 服务框架
#        4. 严格 set -u 闭环 5. 使用 /tmp 替代 /dev/shm（OpenWrt 无 /dev/shm）
#        6. 配置文件化管理 7. Worker 健康检查自动重启 8. IPv6 路由检测优化
# ==============================================================================

set -eu

# 路径定义（配置文件系统）
CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"
OLD_TRAFFIC_DATA_FILE="/var/lib/cf-probe/traffic.dat"

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
    printf '%b╔══════════════════════════════════════════════════╗%b\n' "${CYAN}" "${NC}"
    printf '%b║     CF-Server-Monitor 探针管理工具 (OpenWrt)     ║%b\n' "${CYAN}" "${NC}"
    printf '%b╚══════════════════════════════════════════════════╝%b\n' "${CYAN}" "${NC}"
}

info()  { printf '%b[✓]%b %s\n' "${GREEN}" "${NC}" "$1"; }
warn()  { printf '%b[!]%b %s\n' "${YELLOW}" "${NC}" "$1"; }
error() { printf '%b[✗]%b %s\n' "${RED}"   "${NC}" "$1"; exit 1; }
step()  { printf '%b[→]%b %s\n' "${BLUE}"  "${NC}" "$1"; }

print_usage() {
    printf '%b错误: 运行所需的入参不完整。%b\n\n' "${RED}" "${NC}"
    echo "用法:"
    echo "  sh $0 install -id=SERVER_ID -secret=SECRET -url=WORKER_URL [选项]"
    echo ""
    echo "必需参数:"
    echo "  -id=xxx        服务器ID"
    echo "  -secret=xxx    密钥"
    echo "  -url=xxx       上报地址"
    echo ""
    echo "可选参数:"
    echo "  -interval=N    上报间隔(秒)，默认60"
    echo "  -ping=TYPE     探测类型: http | tcp，默认http"
    echo "  -ct=HOST       自定义CT测试节点"
    echo "  -cu=HOST       自定义CU测试节点"
    echo "  -cm=HOST       自定义CM测试节点"
    echo "  -bd=HOST       自定义BD测试节点"
    echo "  -reset_day=N   流量重置日(1-31, 0=不重置)，默认1"
    echo "  -rx_correction=N  下行流量校正(GB)，修改当月下行数据"
    echo "  -tx_correction=N  上行流量校正(GB)，修改当月上行数据"
    echo ""
    echo "示例:"
    echo "  sh $0 install -id=server123 -secret=abc123 -url=https://worker.example.com"
    echo "  sh $0 install -id=server123 -secret=abc123 -url=https://worker.example.com -interval=30 -ping=tcp"
    echo "  sh $0 install -id=server123 -secret=abc123 -url=https://worker.example.com -reset_day=15"
    echo "  sh $0 install -id=server123 -secret=abc123 -url=https://worker.example.com -rx_correction=10 -tx_correction=5"
    exit 1
}

sed_escape() {
    printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/&/\\&/g; s/@/\\@/g; s/\//\\\//g; s/|/\\|/g; s/"/\\"/g'
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
            error "未知的包管理器: $PKG_MGR"
            ;;
    esac

    required_cmds="curl awk grep sed"
    for cmd in $required_cmds; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            warn "缺少依赖: $cmd，某些功能可能不可用。"
        fi
    done

    for cmd in pgrep pkill ss; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            warn "缺少可选依赖: $cmd（不影响核心监控功能）"
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
# 从旧版本服务文件提取参数（兼容 procd 和 OpenRC）
# ---------------------------------------------------------------
extract_old_params() {
    if [ -f "${PROCD_FILE}" ]; then
        step "检测到旧版本服务文件，提取参数..."
        
        # 先获取原始行，避免 shell 解释
        local raw_line
        raw_line=$(grep -E "^(procd_set_param command|command_args=)" "${PROCD_FILE}" 2>/dev/null | head -1 || echo "")
        
        if [ -n "${raw_line}" ]; then
            local args=""
            
            # 使用 printf + sed 处理，避免 shell 解释
            if printf '%s' "$raw_line" | grep -q "^procd_set_param command"; then
                # procd 格式: procd_set_param command /bin/sh /usr/local/bin/cf-probe.sh ...
                args=$(printf '%s' "$raw_line" | sed 's/^procd_set_param command //')
            else
                # OpenRC 格式: command_args="/usr/local/bin/cf-probe.sh ..."
                args=$(printf '%s' "$raw_line" | sed 's/^command_args=//' | sed 's/^"//; s/"$//')
            fi
            
            # 移除反引号（如果有）
            args=$(printf '%s' "$args" | tr -d '`')
            
            # 清理可能的残留引号
            args=$(printf '%s' "$args" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            
            # 用 awk 按空格提取参数（完全避免 shell 解释）
            # 注意：procd 格式中第一个参数是 /bin/sh，第二个是脚本路径，第三个才是 SERVER_ID
            # OpenRC 格式中第一个参数就是 SERVER_ID
            local is_procd=0
            if printf '%s' "$raw_line" | grep -q "^procd_set_param command"; then
                is_procd=1
            fi
            
            if [ "$is_procd" -eq 1 ]; then
                # procd 格式：跳过 /bin/sh 和脚本路径
                OLD_SERVER_ID=$(printf '%s' "$args" | awk '{print $3}')
                OLD_SECRET=$(printf '%s' "$args" | awk '{print $4}')
                OLD_WORKER_URL=$(printf '%s' "$args" | awk '{print $5}')
                OLD_REPORT_INTERVAL=$(printf '%s' "$args" | awk '{print $6}')
                OLD_PING_TYPE=$(printf '%s' "$args" | awk '{print $7}')
                OLD_CT_NODE=$(printf '%s' "$args" | awk '{print $8}')
                OLD_CU_NODE=$(printf '%s' "$args" | awk '{print $9}')
                OLD_CM_NODE=$(printf '%s' "$args" | awk '{print $10}')
                OLD_BD_NODE=$(printf '%s' "$args" | awk '{print $11}')
                OLD_RESET_DAY=$(printf '%s' "$args" | awk '{print $12}')
            else
                # OpenRC 格式：直接从第一个参数开始
                OLD_SERVER_ID=$(printf '%s' "$args" | awk '{print $1}')
                OLD_SECRET=$(printf '%s' "$args" | awk '{print $2}')
                OLD_WORKER_URL=$(printf '%s' "$args" | awk '{print $3}')
                OLD_REPORT_INTERVAL=$(printf '%s' "$args" | awk '{print $4}')
                OLD_PING_TYPE=$(printf '%s' "$args" | awk '{print $5}')
                OLD_CT_NODE=$(printf '%s' "$args" | awk '{print $6}')
                OLD_CU_NODE=$(printf '%s' "$args" | awk '{print $7}')
                OLD_CM_NODE=$(printf '%s' "$args" | awk '{print $8}')
                OLD_BD_NODE=$(printf '%s' "$args" | awk '{print $9}')
                OLD_RESET_DAY=$(printf '%s' "$args" | awk '{print $10}')
            fi
            
            # 清理引号（如果有）
            OLD_SERVER_ID=$(printf '%s' "$OLD_SERVER_ID" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_SECRET=$(printf '%s' "$OLD_SECRET" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_WORKER_URL=$(printf '%s' "$OLD_WORKER_URL" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_REPORT_INTERVAL=$(printf '%s' "$OLD_REPORT_INTERVAL" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_PING_TYPE=$(printf '%s' "$OLD_PING_TYPE" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_CT_NODE=$(printf '%s' "$OLD_CT_NODE" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_CU_NODE=$(printf '%s' "$OLD_CU_NODE" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_CM_NODE=$(printf '%s' "$OLD_CM_NODE" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_BD_NODE=$(printf '%s' "$OLD_BD_NODE" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")
            OLD_RESET_DAY=$(printf '%s' "$OLD_RESET_DAY" | sed 's/^"//; s/"$//' | sed "s/^'//; s/'$//")

            # 调试输出（可选）
            echo "提取的参数:"
            echo "  SERVER_ID: '$OLD_SERVER_ID'"
            echo "  SECRET: '$OLD_SECRET'"
            echo "  WORKER_URL: '$OLD_WORKER_URL'"
            echo "  INTERVAL: '$OLD_REPORT_INTERVAL'"
            echo "  PING_TYPE: '$OLD_PING_TYPE'"
            [ -n "$OLD_CT_NODE" ] && echo "  CT: '$OLD_CT_NODE'"
            [ -n "$OLD_CU_NODE" ] && echo "  CU: '$OLD_CU_NODE'"
            [ -n "$OLD_CM_NODE" ] && echo "  CM: '$OLD_CM_NODE'"
            [ -n "$OLD_BD_NODE" ] && echo "  BD: '$OLD_BD_NODE'"
            [ -n "$OLD_RESET_DAY" ] && echo "  RESET_DAY: '$OLD_RESET_DAY'"

            if [ -n "${OLD_SERVER_ID}" ] && [ -n "${OLD_SECRET}" ] && [ -n "${OLD_WORKER_URL}" ]; then
                info "已从旧版本服务文件提取参数"
                info "  Server ID: ${OLD_SERVER_ID}"
                info "  Worker URL: ${OLD_WORKER_URL}"
                return 0
            else
                warn "从旧服务文件提取参数失败，参数不完整"
                warn "  提取到的 Server ID: '${OLD_SERVER_ID:-空}'"
                warn "  提取到的 Secret: '${OLD_SECRET:-空}'"
                warn "  提取到的 Worker URL: '${OLD_WORKER_URL:-空}'"
                return 1
            fi
        fi
    fi
    return 0
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

    cat > "${SCRIPT_FILE}" << 'PROBE_EOF'
#!/bin/sh
set +eu

PID_FILE="/var/run/cf-probe.pid"
echo $$ > "$PID_FILE"

CONFIG_DIR="/etc/config/cf-probe"
CONFIG_FILE="${CONFIG_DIR}/config.conf"
TRAFFIC_DATA_FILE="${CONFIG_DIR}/traffic.dat"

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

COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
REPORT_INTERVAL=${REPORT_INTERVAL:-60}
PING_TYPE=${PING_TYPE:-http}
[ -z "$RESET_DAY" ] && RESET_DAY=1
case "$COLLECT_INTERVAL" in ''|*[!0-9]*) COLLECT_INTERVAL=0 ;; esac
case "$REPORT_INTERVAL" in ''|*[!0-9]*) REPORT_INTERVAL=60 ;; esac
[ "$REPORT_INTERVAL" -lt 1 ] && REPORT_INTERVAL=60
if [ "$COLLECT_INTERVAL" -gt 0 ] && [ "$REPORT_INTERVAL" -lt "$COLLECT_INTERVAL" ]; then
    REPORT_INTERVAL="$COLLECT_INTERVAL"
fi
ACTIVE_INTERVAL="$REPORT_INTERVAL"
[ "$COLLECT_INTERVAL" -gt 0 ] && ACTIVE_INTERVAL="$COLLECT_INTERVAL"

SHM_DIR="/tmp"

escape_json() {
    printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r' '  '
}

safe_div() {
    num="${1:-0}"
    den="${2:-0}"
    def="${3:-0}"
    if [ "${den}" -eq 0 ]; then echo "${def}"; else echo $(( num / den )); fi
}

get_net_bytes() {
    awk 'NR>2 && $1~/^(eth|en|wl)[a-z0-9]*:/{rx+=$2;tx+=$10}END{printf "%.0f %.0f\n",rx,tx}' /proc/net/dev 2>/dev/null || echo "0 0";
}

is_leap_year() {
    year=$1
    [ $((year % 4)) -eq 0 ] && [ $((year % 100)) -ne 0 ] || [ $((year % 400)) -eq 0 ]
}

get_period_start_ts() {
    reset_day="$1"
    [ "$reset_day" -eq 0 ] 2>/dev/null && { echo "0"; return; }
    now_ts="$2"

    # 只用 epoch 秒
    year=$(date +%Y 2>/dev/null || echo 1970)
    month=$(date +%m 2>/dev/null || echo 1)
    day=$(date +%d 2>/dev/null || echo 1)

    # BusyBox fallback（无 date -d 时）
    if [ "${year}" = "1970" ]; then
        # 退化方案：直接按 30 天周期（OpenWrt 保底逻辑）
        echo $((now_ts - 30 * 86400))
        return
    fi

    target_day="$reset_day"

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

    # 用 epoch 回算（避免 date -d）
    # 直接算“本月 reset_day 00:00”的近似值

    # 当前月1号时间
    month_start=$((now_ts - ( (day - 1) * 86400 )))

    reset_ts=$((month_start + (target_day - 1) * 86400))

    if [ "$day" -lt "$target_day" ]; then
        reset_ts=$((reset_ts - 30 * 86400))
    fi

    echo "$reset_ts"
}

calc_monthly_traffic() {
    current_rx="$1"
    current_tx="$2"
    reset_day="${RESET_DAY:-1}"
    now_ts=$(date '+%s')

    mkdir -p "${CONFIG_DIR}" 2>/dev/null || true

    saved_rx_prev=0; saved_tx_prev=0; saved_rx_period=0; saved_tx_period=0
    saved_last_check=0; saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        tmp_rx_prev=''; tmp_tx_prev=''; tmp_rx_period=''; tmp_tx_period=''
        tmp_last_check=''; tmp_period_start=''
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

    period_start_ts=$(get_period_start_ts "$reset_day" "$now_ts")

    rx_delta=0; tx_delta=0
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

get_http_ping() {
    rtt=$(curl -o /dev/null -s -m 1 --connect-timeout 1 -w "%{time_total}" "http://${1:-}" 2>/dev/null | awk '{printf "%.0f", $1*1000}')
    if [ -n "$rtt" ] && [ "$rtt" -gt 0 ] 2>/dev/null; then
        echo "$rtt"
    else
        echo ""
    fi
}

get_tcp_ping() {
    host="${1:-}"
    port="${2:-443}"
    scheme="http"
    timing=''

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

    awk -v t="${timing}" 'BEGIN{
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
    host="$1"
    port="${2:-443}"

    if [ "${PING_TYPE}" = "tcp" ]; then
        get_tcp_ping "$host" "$port"
    else
        get_http_ping "$host"
    fi
}

get_packet_loss() {
    host="${1:-}"
    count="${2:-5}"

    if [ -z "$host" ] || ! command -v ping >/dev/null 2>&1; then
        echo ""
        return
    fi

    timeout_arg=""
    if ping -W 1 -c 1 127.0.0.1 >/dev/null 2>&1; then
        timeout_arg="-W 1"
    fi

    ping -c "$count" $timeout_arg "$host" 2>/dev/null | awk -F',' '/packet loss/{
        for (i=1; i<=NF; i++) {
            if ($i ~ /packet loss/) {
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
                split($i, a, "%")
                gsub(/[^0-9.]/, "", a[1])
                if (a[1] != "") {
                    printf "%.0f\n", a[1]
                }
            }
        }
    }'
}

CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"

write_probe_result() {
    local dest="$1"
    shift
    local tmp="${dest}.tmp"
    if "$@" > "$tmp"; then
        mv "$tmp" "$dest"
    else
        rm -f "$tmp" "$dest"
    fi
}

refresh_latency_async() {
    [ -n "$CT_NODE" ] && write_probe_result /tmp/.cf_ping_ct get_ping "$CT_NODE" &
    [ -n "$CU_NODE" ] && write_probe_result /tmp/.cf_ping_cu get_ping "$CU_NODE" &
    [ -n "$CM_NODE" ] && write_probe_result /tmp/.cf_ping_cm get_ping "$CM_NODE" &
    [ -n "$BD_NODE" ] && write_probe_result /tmp/.cf_ping_bd get_ping "$BD_NODE" &
    [ -n "$CT_NODE" ] && write_probe_result /tmp/.cf_loss_ct get_packet_loss "$CT_NODE" &
    [ -n "$CU_NODE" ] && write_probe_result /tmp/.cf_loss_cu get_packet_loss "$CU_NODE" &
    [ -n "$CM_NODE" ] && write_probe_result /tmp/.cf_loss_cm get_packet_loss "$CM_NODE" &
    [ -n "$BD_NODE" ] && write_probe_result /tmp/.cf_loss_bd get_packet_loss "$BD_NODE" &
}

run_network_worker() {
    set -eu
    last_ip=0
    last_ping=0

    while true; do
        now=$(date +%s)

        if [ $((now - last_ip)) -ge 600 ] || [ "$last_ip" -eq 0 ]; then
            (curl -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0") > /tmp/.cf_ipv4.tmp && mv /tmp/.cf_ipv4.tmp /tmp/.cf_ipv4 || true
            (if ip -6 route show default >/dev/null 2>&1; then curl -6 -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0"; else echo "0"; fi) > /tmp/.cf_ipv6.tmp && mv /tmp/.cf_ipv6.tmp /tmp/.cf_ipv6 || true
            last_ip="$now"
        fi

        if [ $((now - last_ping)) -ge 30 ] || [ "$last_ping" -eq 0 ]; then
            refresh_latency_async
            last_ping="$now"
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
    [ -f /tmp/.cf_ping_ct ] && PING_CT=$(cat /tmp/.cf_ping_ct) || PING_CT=""
    [ -f /tmp/.cf_ping_cu ] && PING_CU=$(cat /tmp/.cf_ping_cu) || PING_CU=""
    [ -f /tmp/.cf_ping_cm ] && PING_CM=$(cat /tmp/.cf_ping_cm) || PING_CM=""
    [ -f /tmp/.cf_ping_bd ] && PING_BD=$(cat /tmp/.cf_ping_bd) || PING_BD=""
    [ -f /tmp/.cf_loss_ct ] && LOSS_CT=$(cat /tmp/.cf_loss_ct) || LOSS_CT=""
    [ -f /tmp/.cf_loss_cu ] && LOSS_CU=$(cat /tmp/.cf_loss_cu) || LOSS_CU=""
    [ -f /tmp/.cf_loss_cm ] && LOSS_CM=$(cat /tmp/.cf_loss_cm) || LOSS_CM=""
    [ -f /tmp/.cf_loss_bd ] && LOSS_BD=$(cat /tmp/.cf_loss_bd) || LOSS_BD=""

    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")

    METRICS_JSON=$(cat <<EOF
{"cpu":"$CPU","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","disk_total":"$DISK_TOTAL","disk_used":"$DISK_USED","load_avg":"$LOAD_AVG","boot_time":"$BOOT_TIME","net_rx":"$RX_NOW","net_tx":"$TX_NOW","net_rx_monthly":"$RX_MONTHLY","net_tx_monthly":"$TX_MONTHLY","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED","os":"$EOS","arch":"$EARCH","cpu_info":"$ECPU","cpu_cores":"$CPU_CORES","processes":"$PROCESSES","tcp_conn":"$TCP_CONN","udp_conn":"$UDP_CONN","ip_v4":"$IPV4","ip_v6":"$IPV6","ping_ct":"$PING_CT","ping_cu":"$PING_CU","ping_cm":"$PING_CM","ping_bd":"$PING_BD","loss_ct":"$LOSS_CT","loss_cu":"$LOSS_CU","loss_cm":"$LOSS_CM","loss_bd":"$LOSS_BD"}
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
{"id":"$SERVER_ID","secret":"$SECRET","metrics":$METRICS_JSON,"samples":[$SAMPLES_JSON],"collect_interval":$COLLECT_INTERVAL,"report_interval":$REPORT_INTERVAL}
EOF
)
        else
            PAYLOAD=$(cat <<EOF
{"id":"$SERVER_ID","secret":"$SECRET","metrics":$METRICS_JSON,"collect_interval":$COLLECT_INTERVAL,"report_interval":$REPORT_INTERVAL}
EOF
)
        fi
        curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d "$PAYLOAD" -m 4 --connect-timeout 2 "$WORKER_URL" 2>/dev/null || true
        SAMPLES_JSON=""
        SAMPLE_COUNT=0
        LAST_REPORT_TIME=$LOOP_START_TIME
    fi

    LOOP_END_TIME=$(date +%s)
    EXEC_DURATION=$((LOOP_END_TIME - LOOP_START_TIME))
    SLEEP_TIME=$((ACTIVE_INTERVAL - EXEC_DURATION))
    [ "${SLEEP_TIME}" -le 0 ] && SLEEP_TIME=1
    sleep "${SLEEP_TIME}"
done
PROBE_EOF

    chmod +x "${SCRIPT_FILE}"
    info "探针脚本注入完成: ${SCRIPT_FILE}"
}

# ---------------------------------------------------------------
# 创建 procd 服务脚本 / 手动启停入口
# ---------------------------------------------------------------
create_service() {
    esc_id=$(printf '%s' "$SERVER_ID" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_sec=$(printf '%s' "$SECRET" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')
    esc_url=$(printf '%s' "$WORKER_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_ping=$(printf '%s' "$PING_TYPE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_ct=$(printf '%s' "$CT_NODE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_cu=$(printf '%s' "$CU_NODE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_cm=$(printf '%s' "$CM_NODE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_bd=$(printf '%s' "$BD_NODE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_reset_day=$(printf '%s' "$RESET_DAY" | sed 's/\\/\\\\/g; s/"/\\"/g')

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
    elif [ "$INIT_SYSTEM" = "procd" ] && command -v ubus >/dev/null 2>&1 && ubus call service list >/dev/null 2>&1 | grep -q "\"${SERVICE_NAME}\""; then
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

    # 用于保存从旧服务文件提取的参数
    OLD_SERVER_ID=""
    OLD_SECRET=""
    OLD_WORKER_URL=""
    OLD_REPORT_INTERVAL=""
    OLD_PING_TYPE=""
    OLD_CT_NODE=""
    OLD_CU_NODE=""
    OLD_CM_NODE=""
    OLD_BD_NODE=""
    OLD_RESET_DAY=""

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
    detect_os
    install_deps

    # 在停止旧服务之前，先提取旧参数
    extract_old_params

    stop_old_service

    if [ -f "${CONFIG_FILE}" ]; then
        step "检测到已有配置文件，执行二次安装..."
        
        if [ -n "${SERVER_ID}" ] && [ -n "${SECRET}" ] && [ -n "${WORKER_URL}" ]; then
            COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
            REPORT_INTERVAL=${REPORT_INTERVAL:-60}
            PING_TYPE=${PING_TYPE:-http}
            [ -z "$RESET_DAY" ] && RESET_DAY=1
            
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
EOF
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
            # 使用从旧服务文件提取的参数
            if [ -n "${OLD_SERVER_ID}" ] && [ -n "${OLD_SECRET}" ] && [ -n "${OLD_WORKER_URL}" ]; then
                step "使用从旧服务文件提取的参数..."
                SERVER_ID="${OLD_SERVER_ID}"
                SECRET="${OLD_SECRET}"
                WORKER_URL="${OLD_WORKER_URL}"
                REPORT_INTERVAL="${OLD_REPORT_INTERVAL:-60}"
                PING_TYPE="${OLD_PING_TYPE:-http}"
                CT_NODE="${OLD_CT_NODE:-}"
                CU_NODE="${OLD_CU_NODE:-}"
                CM_NODE="${OLD_CM_NODE:-}"
                BD_NODE="${OLD_BD_NODE:-}"
                [ -z "${OLD_RESET_DAY}" ] && RESET_DAY=1 || RESET_DAY="${OLD_RESET_DAY}"
                info "已从旧版本服务文件恢复参数"
            else
                print_usage
            fi
        fi

        COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
        REPORT_INTERVAL=${REPORT_INTERVAL:-60}
        PING_TYPE=${PING_TYPE:-http}
        [ -z "$RESET_DAY" ] && RESET_DAY=1

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
COLLECT_INTERVAL="${COLLECT_INTERVAL}"
REPORT_INTERVAL="${REPORT_INTERVAL}"
PING_TYPE="${PING_TYPE}"
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"
RESET_DAY="${RESET_DAY}"
EOF
        info "配置文件已生成: ${CONFIG_FILE}"
    fi

    COLLECT_INTERVAL=${COLLECT_INTERVAL:-0}
    REPORT_INTERVAL=${REPORT_INTERVAL:-60}

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
    printf  '         CF-Server-Monitor 安装成功\n'
    printf  '%b=============================================%b\n' "${GREEN}" "${NC}"
    printf  '  服务状态 : %bActive (Running)%b\n' "${GREEN}" "${NC}"
    printf  '  配置参数 :\n'
    printf  '    ● Server ID   : %s\n' "${SERVER_ID}"
    printf  '    ● Secret      : %s\n' "${SECRET}"
    printf  '    ● Worker URL  : %s\n' "${WORKER_URL}"
    printf  '    ● 上报间隔    : %s秒\n' "${REPORT_INTERVAL}"
    printf  '    ● 探测类型    : %s\n' "${PING_TYPE}"
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
        *)     echo "手动后台进程 (PID: $(cat "$PID_FILE"))" ;;
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
    rm -f /tmp/.cf_ipv4 /tmp/.cf_ipv6 /tmp/.cf_ping_* /tmp/.cf_loss_* 2>/dev/null || true

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
