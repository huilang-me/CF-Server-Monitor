#!/bin/bash
# ==============================================================================
# CF-Server-Monitor-Pro 安装/卸载脚本 (企业级安全加固版)
# 支持: Ubuntu/Debian/CentOS/RHEL/Fedora/Rocky/AlmaLinux
# Fixes: 1. 独立协程无 wait 阻塞 2. 原子化原子覆盖 3. 兼容全版本 Systemd 4. 严格 set -u 闭环
# ==============================================================================

set -euo pipefail

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

print_banner() {
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     CF-Server-Monitor-Pro 探针管理工具 (Enterprise) ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
}

info() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "${BLUE}[→]${NC} $1"; }

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
        centos|rhel|fedora|rocky|almalinux|ol|amzn) PKG_MGR="yum" ;;
        *) warn "未识别的系统类型: $OS_ID，尝试默认使用 apt-get" ; PKG_MGR="apt-get" ;;
    esac
}

install_deps() {
    step "检查系统依赖组件..."
    local required_cmds=("curl" "awk" "grep" "sed")
    
    for cmd in "${required_cmds[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            warn "缺少必要依赖: $cmd，正在尝试自动安装..."
            if [ "${PKG_MGR:-apt-get}" = "apt-get" ]; then
                apt-get update -qq && apt-get install -y -qq "$cmd" >/dev/null 2>&1 || true
            else
                yum install -y -q "$cmd" >/dev/null 2>&1 || true
            fi
        fi
        if ! command -v "$cmd" >/dev/null 2>&1; then
            error "无法自动安装依赖 [$cmd]，请手动安装后重试。"
        fi
    done
    
    if ! command -v systemctl >/dev/null 2>&1; then
        error "本脚本仅支持基于 systemd 的 Linux 发行版。"
    fi
    info "基础依赖组件检查通过"
}

stop_old_service() {
    step "清理可能存在的旧服务进程..."
    if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" 2>/dev/null || true
    fi
}

create_script() {
    local report_interval=${1:-60}
    step "注入工业级监控采集探针..."

    cat > "${SCRIPT_FILE}" << 'PROBE_EOF'
#!/bin/bash
# 激活严格的未定义变量检查与错误即刻退出
set -eu

SERVER_ID="${1:-}"
SECRET="${2:-}"
WORKER_URL="${3:-}"
REPORT_INTERVAL="${4:-60}"

# 严苛环境下的规范 JSON 字段转义函数
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
    awk 'NR>2 {rx+=$2; tx+=$10} END {printf "%.0f %.0f", rx, tx}' /proc/net/dev 2>/dev/null || echo "0 0"
}

get_cpu_stat() { 
    awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6}' /proc/stat 2>/dev/null || echo "0 0"
}

get_http_ping() { 
    local rtt
    rtt=$(curl -o /dev/null -s -m 1 --connect-timeout 1 -w "%{time_total}" "http://${1:-}" 2>/dev/null | awk '{printf "%.0f", $1*1000}')
    echo "${rtt:-0}"
}

# 静态测试节点定义
CT_NODES=("bj-ct-dualstack.ip.zstaticcdn.com" "sh-ct-dualstack.ip.zstaticcdn.com" "gd-ct-dualstack.ip.zstaticcdn.com")
CU_NODES=("bj-cu-dualstack.ip.zstaticcdn.com" "sh-cu-dualstack.ip.zstaticcdn.com" "gd-cu-dualstack.ip.zstaticcdn.com")
CM_NODES=("bj-cm-dualstack.ip.zstaticcdn.com" "sh-cm-dualstack.ip.zstaticcdn.com" "gd-cm-dualstack.ip.zstaticcdn.com")

# ==============================================================================
# 高并发/无竞态后台网络 Worker 协程
# ==============================================================================
run_network_worker() {
    # 继承外层 set -eu 行为
    set -eu
    local last_ip=0
    local last_ping=0
    
    while true; do
        local now; now=$(date +%s)
        
        # 10分钟检测一次 IP
        if [ $((now - last_ip)) -ge 600 ] || [ "$last_ip" -eq 0 ]; then
            (curl -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0") > /dev/shm/.cf_ipv4.tmp && mv /dev/shm/.cf_ipv4.tmp /dev/shm/.cf_ipv4 || true
            (curl -6 -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0") > /dev/shm/.cf_ipv6.tmp && mv /dev/shm/.cf_ipv6.tmp /dev/shm/.cf_ipv6 || true
            last_ip="$now"
        fi
        
        # 30秒检测一次网络延迟
        if [ $((now - last_ping)) -ge 30 ] || [ "$last_ping" -eq 0 ]; then
            local rand_idx=$((RANDOM % 3))
            get_http_ping "${CT_NODES[$rand_idx]}" > /dev/shm/.cf_ping_ct.tmp && mv /dev/shm/.cf_ping_ct.tmp /dev/shm/.cf_ping_ct || true
            get_http_ping "${CU_NODES[$rand_idx]}" > /dev/shm/.cf_ping_cu.tmp && mv /dev/shm/.cf_ping_cu.tmp /dev/shm/.cf_ping_cu || true
            get_http_ping "${CM_NODES[$rand_idx]}" > /dev/shm/.cf_ping_cm.tmp && mv /dev/shm/.cf_ping_cm.tmp /dev/shm/.cf_ping_cm || true
            get_http_ping "lf3-ips.zstaticcdn.com" > /dev/shm/.cf_ping_bd.tmp && mv /dev/shm/.cf_ping_bd.tmp /dev/shm/.cf_ping_bd || true
            last_ping="$now"
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

echo "[INFO] CF-Server-Monitor Probe Engine Started Successfully."

# 核心架构升级：在这里脱离主循环，静默启动常驻网络 Worker 协程，无 wait 干扰
run_network_worker &

while true; do
    LOOP_START_TIME=$(date +%s)
    
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
    
    if [ "${RAM_TOTAL}" -gt 0 ]; then
        RAM=$(awk -v u="${RAM_USED}" -v t="${RAM_TOTAL}" 'BEGIN {printf "%.2f", (u/t)*100}')
    else
        RAM="0.00"
    fi

    SWAP_TOTAL_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); SWAP_TOTAL_KB=${SWAP_TOTAL_KB:-0}
    SWAP_FREE_KB=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); SWAP_FREE_KB=${SWAP_FREE_KB:-0}
    SWAP_TOTAL=$((SWAP_TOTAL_KB / 1024))
    SWAP_USED=$(((SWAP_TOTAL_KB - SWAP_FREE_KB) / 1024))
    [ "${SWAP_USED}" -lt 0 ] && SWAP_USED=0

    # 规范化的 df 提取，防范因个别挂载路径过长导致换行错位
    DISK_INFO=$(df -P / 2>/dev/null | tail -n1 || echo "")
    DISK_TOTAL=0; DISK_USED=0; DISK=0
    if [ -n "${DISK_INFO}" ]; then
        DISK_TOTAL=$(echo "${DISK_INFO}" | awk '{print int($2/1024)}')
        DISK_USED=$(echo "${DISK_INFO}" | awk '{print int($3/1024)}')
        DISK=$(echo "${DISK_INFO}" | awk '{print $5}' | tr -d '%')
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
    BOOT_TIME=$(uptime -s 2>/dev/null || stat -c %y / 2>/dev/null | cut -d'.' -f1 || echo "Unknown")
    CPU_INFO=$(grep -m 1 'model name' /proc/cpuinfo 2>/dev/null | awk -F: '{print $2}' | xargs || echo "")
    [ -z "${CPU_INFO}" ] && CPU_INFO=${ARCH}
    CPU_CORES=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "1")
    LOAD=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}' || echo "0 0 0")
    UPTIME=$(uptime -p 2>/dev/null | sed 's/up //' || echo "Unknown")
    PROCESSES=$(ps -e 2>/dev/null | wc -l || echo 0)
    TCP_CONN=$(ss -ant 2>/dev/null | grep -c -v State || wc -l < /proc/net/tcp 2>/dev/null || echo 0)
    UDP_CONN=$(ss -anu 2>/dev/null | grep -c -v State || wc -l < /proc/net/udp 2>/dev/null || echo 0)

    # ------------------ 精确无干扰时钟网速算法 ------------------
    NET_STAT=$(get_net_bytes)
    RX_NOW=$(echo "$NET_STAT" | awk '{print $1}'); RX_NOW=${RX_NOW:-0}
    TX_NOW=$(echo "$NET_STAT" | awk '{print $2}'); TX_NOW=${TX_NOW:-0}
    
    TIME_DELTA=$((LOOP_START_TIME - PREV_LOOP_TIME))
    [ "${TIME_DELTA}" -le 0 ] && TIME_DELTA=${REPORT_INTERVAL}
    
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
    [ -f /dev/shm/.cf_ping_ct ] && PING_CT=$(cat /dev/shm/.cf_ping_ct) || PING_CT="0"
    [ -f /dev/shm/.cf_ping_cu ] && PING_CU=$(cat /dev/shm/.cf_ping_cu) || PING_CU="0"
    [ -f /dev/shm/.cf_ping_cm ] && PING_CM=$(cat /dev/shm/.cf_ping_cm) || PING_CM="0"
    [ -f /dev/shm/.cf_ping_bd ] && PING_BD=$(cat /dev/shm/.cf_ping_bd) || PING_BD="0"

    # 安全地构建闭合规范的 JSON 数据流
    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")
    EUPTIME=$(escape_json "${UPTIME}")

    PAYLOAD=$(cat <<EOF
{"id":"$SERVER_ID","secret":"$SECRET","metrics":{"cpu":"$CPU","ram":"$RAM","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","disk":"$DISK","disk_total":"$DISK_TOTAL","disk_used":"$DISK_USED","load":"$LOAD","uptime":"$EUPTIME","boot_time":"$BOOT_TIME","net_rx":"$RX_NOW","net_tx":"$TX_NOW","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED","os":"$EOS","arch":"$EARCH","cpu_info":"$ECPU","cpu_cores":"$CPU_CORES","processes":"$PROCESSES","tcp_conn":"$TCP_CONN","udp_conn":"$UDP_CONN","ip_v4":"$IPV4","ip_v6":"$IPV6","ping_ct":"$PING_CT","ping_cu":"$PING_CU","ping_cm":"$PING_CM","ping_bd":"$PING_BD"}}
EOF
)
    # 上报上游数据端 (限定 4s 超时控制，主循环绝不严重漂移)
    curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d "$PAYLOAD" -m 4 --connect-timeout 2 "$WORKER_URL" 2>/dev/null || true
    
    # 动态补偿机制：减去指标采集耗时，保证平稳的上报频率
    LOOP_END_TIME=$(date +%s)
    EXEC_DURATION=$((LOOP_END_TIME - LOOP_START_TIME))
    SLEEP_TIME=$((REPORT_INTERVAL - EXEC_DURATION))
    [ "${SLEEP_TIME}" -le 0 ] && SLEEP_TIME=1
    sleep "${SLEEP_TIME}"
done
PROBE_EOF

    chmod +x "${SCRIPT_FILE}"
    info "探针脚本注入完成: ${SCRIPT_FILE}"
}

create_service() {
    step "构建高兼容、全版本通用的 Systemd 守护配置..."
    
    local esc_id; esc_id=$(printf '%s' "$SERVER_ID" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_sec; esc_sec=$(printf '%s' "$SECRET" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_url; esc_url=$(printf '%s' "$WORKER_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    # 完全剔除 MemoryHigh/MemoryMax/CPUQuota 等低版本 Systemd 会抛错的非泛用特性
    # 仅使用全版本 Linux 完美兼容的 Nice 权重调配及 IO 闲置调度
    cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=CF Server Monitor Probe Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash "${SCRIPT_FILE}" "${esc_id}" "${esc_sec}" "${esc_url}" "${REPORT_INTERVAL}"
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

start_service() {
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
}

install_probe() {
    SERVER_ID=${1:-""}
    SECRET=${2:-""}
    WORKER_URL=${3:-""}
    REPORT_INTERVAL=${4:-60}

    if [ -z "$SERVER_ID" ] || [ -z "$SECRET" ] || [ -z "$WORKER_URL" ]; then
        echo -e "${RED}错误: 运行所需的入参不完整。${NC}\n"
        echo "用法:"
        echo "  bash $0 install <SERVER_ID> <SECRET> <WORKER_URL> [REPORT_INTERVAL]"
        exit 1
    fi

    print_banner
    check_root
    detect_os
    install_deps
    stop_old_service
    create_script "$REPORT_INTERVAL"
    create_service
    start_service

    echo -e "\n${GREEN}============================================="
    echo -e "         CF-Server-Monitor-Pro 安装成功"
    echo -e "=============================================${NC}"
    echo -e "  服务状态 : ${GREEN}Active (Running)${NC}"
    echo -e "  管理指令 :"
    echo -e "    ● 查看实时日志 : journalctl -u ${SERVICE_NAME} -f"
    echo -e "    ● 查看运行状态 : systemctl status ${SERVICE_NAME}"
    echo -e "    ● 停止探针服务 : systemctl stop ${SERVICE_NAME}"
    echo -e "=============================================\n"
}

uninstall_probe() {
    print_banner
    echo -e "${YELLOW}[!] 开始执行无残留深度卸载清理方案...${NC}\n"
    check_root

    step "停用并撤销系统守护进程..."
    if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    fi

    step "清理服务描述性系统文件..."
    rm -f "${SERVICE_FILE}"
    systemctl daemon-reload 2>/dev/null || true
    systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true

    step "销毁探针物理可执行代码文件..."
    rm -f "${SCRIPT_FILE}"

    step "抹除共享内存高速缓存区..."
    rm -f /dev/shm/.cf_ipv4 /dev/shm/.cf_ipv6 /dev/shm/.cf_ping_*

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