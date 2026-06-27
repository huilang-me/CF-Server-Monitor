#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import json
import time
import socket
import shutil
import ctypes
import queue
import threading
import platform
import subprocess
import urllib.request
from pathlib import Path
from datetime import datetime

import tkinter as tk
from tkinter import ttk, messagebox, filedialog

APP_NAME = "CF-Server-Monitor"
TASK_NAME = "CFProbe"

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "cf_probe_config.json"
LOG_FILE = BASE_DIR / "cf_probe.log"
AGENT_FILE = Path(__file__).resolve()

DEFAULT_COLLECT_INTERVAL = 0
DEFAULT_INTERVAL = 60
MAX_LOG_SIZE = 2 * 1024 * 1024
LOG_BACKUP_COUNT = 3

DEFAULT_CONFIG = {
    "server_id": "服务器ID",
    "secret": "连接密匙",
    "worker_url": "上传网站",
    "collect_interval": 0,
    "report_interval": 60,
    "silent_start": False,
    "ping_type": "tcp",
}

CT_NODE = "gd-ct-dualstack.ip.zstaticcdn.com"
CU_NODE = "gd-cu-dualstack.ip.zstaticcdn.com"
CM_NODE = "gd-cm-dualstack.ip.zstaticcdn.com"
BD_NODE = "lf3-ips.zstaticcdn.com"

log_queue = queue.Queue()
stop_event = threading.Event()
tray_icon = None


def is_windows():
    return platform.system().lower() == "windows"


def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def relaunch_as_admin():
    try:
        exe = sys.executable
        script = str(Path(__file__).resolve())
        args = [script] + sys.argv[1:]
        argline = subprocess.list2cmdline(args)

        rc = ctypes.windll.shell32.ShellExecuteW(
            None,
            "runas",
            exe,
            argline,
            None,
            1,
        )
        return rc > 32
    except Exception:
        return False


def ensure_admin(auto_exit=True):
    if is_admin():
        return True
    ok = relaunch_as_admin()
    if ok and auto_exit:
        sys.exit(0)
    return False


def run_cmd(cmd):
    return subprocess.run(
        cmd,
        shell=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def ensure_base_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)


def rotate_logs():
    try:
        ensure_base_dir()
        if not LOG_FILE.exists():
            return
        if LOG_FILE.stat().st_size < MAX_LOG_SIZE:
            return

        for i in range(LOG_BACKUP_COUNT - 1, 0, -1):
            src = BASE_DIR / f"cf_probe.log.{i}"
            dst = BASE_DIR / f"cf_probe.log.{i + 1}"
            if src.exists():
                if dst.exists():
                    dst.unlink(missing_ok=True)
                src.rename(dst)

        first_backup = BASE_DIR / "cf_probe.log.1"
        if first_backup.exists():
            first_backup.unlink(missing_ok=True)

        LOG_FILE.rename(first_backup)
    except Exception:
        pass


def log(msg):
    try:
        ensure_base_dir()
        rotate_logs()
        line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        try:
            log_queue.put(line)
        except Exception:
            pass
        print(line)
    except Exception:
        pass


def ensure_deps():
    missing = []

    try:
        import psutil  # noqa
    except Exception:
        missing.append("psutil")

    try:
        import pystray  # noqa
    except Exception:
        missing.append("pystray")

    try:
        from PIL import Image  # noqa
    except Exception:
        missing.append("pillow")

    if not missing:
        return True

    log(f"缺少依赖，正在安装: {', '.join(missing)}")
    cmd = f'"{sys.executable}" -m pip install {" ".join(missing)} -q'
    result = run_cmd(cmd)
    if result.returncode != 0:
        log(result.stderr.strip() or result.stdout.strip())
        return False
    return True


def load_config():
    if CONFIG_FILE.exists():
        with CONFIG_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        cfg = DEFAULT_CONFIG.copy()
        cfg.update(data)
        return cfg
    return DEFAULT_CONFIG.copy()


def save_config(config):
    ensure_base_dir()
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def install_self():
    return Path(__file__).resolve()


def find_pythonw():
    current = Path(sys.executable)
    if current.name.lower() == "pythonw.exe":
        return str(current)
    candidate = current.with_name("pythonw.exe")
    if candidate.exists():
        return str(candidate)
    return str(current)


def task_exists():
    result = run_cmd(f'schtasks /Query /TN "{TASK_NAME}"')
    return result.returncode == 0


def create_startup_task():
    cfg = load_config()
    pythonw = find_pythonw()

    current_script = Path(__file__).resolve()

    task_args = "gui --minimized" if cfg.get("silent_start", True) else "gui"

    task_run = (
        f'\\"{pythonw}\\" '
        f'\\"{current_script}\\" '
        f'{task_args}'
    )

    cmd = (
        f'schtasks /Create '
        f'/TN "{TASK_NAME}" '
        f'/SC ONLOGON '
        f'/RL LIMITED '
        f'/TR "{task_run}" '
        f'/F'
    )
    result = run_cmd(cmd)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    log("已开启跟随系统自动启动。")


def delete_startup_task():
    result = run_cmd(f'schtasks /Delete /TN "{TASK_NAME}" /F')
    if result.returncode == 0:
        log("已关闭跟随系统自动启动。")
    else:
        log("自动启动任务不存在或删除失败。")


def http_post_json(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "CF-Server-Monitor-Windows-CN",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            resp.read()
        return True
    except Exception as e:
        log(f"上报失败: {e}")
        return False


def fetch_text(url, timeout=3):
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "CF-Server-Monitor-Windows-CN"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def get_public_ipv4():
    for url in ("https://ipv4.icanhazip.com", "https://api.ipify.org"):
        ip = fetch_text(url, timeout=3)
        if ip and "." in ip:
            return ip
    return ""


def get_public_ipv6():
    for url in ("https://ipv6.icanhazip.com", "https://api64.ipify.org"):
        ip = fetch_text(url, timeout=3)
        if ip and ":" in ip:
            return ip
    return ""


def get_http_ping(host):
    if not host:
        return ""
    try:
        req = urllib.request.Request(
            f"http://{host}",
            headers={"User-Agent": "CF-Server-Monitor-Windows-CN"},
        )
        start = time.perf_counter()
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            resp.read(1)
        ms = int((time.perf_counter() - start) * 1000)
        return str(ms if ms > 0 else 1)
    except Exception:
        return ""


def get_tcp_ping(host, port=443):
    if not host:
        return ""
    try:
        start = time.perf_counter()
        sock = socket.create_connection((host, port), timeout=2)
        sock.close()
        ms = int((time.perf_counter() - start) * 1000)
        return str(ms if ms > 0 else 1)
    except Exception:
        return ""


def get_ping(host, ping_type="tcp"):
    if ping_type == "http":
        return get_http_ping(host)
    return get_tcp_ping(host, 443)


def get_cpu_name():
    cmds = [
        'wmic cpu get name',
        'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)"',
    ]

    for cmd in cmds:
        try:
            result = run_cmd(cmd)
            lines = [x.strip() for x in result.stdout.splitlines() if x.strip()]
            for line in lines:
                low = line.lower()
                if low == "name":
                    continue
                if "do-regular" in low:
                    continue
                return " ".join(line.split())
        except Exception:
            pass

    val = " ".join((platform.processor() or "").split())
    return val or "Unknown CPU"


def get_os_name():
    return "Windows 10 LTSC"


def get_arch():
    arch = (platform.machine() or "").lower()
    if arch in ("amd64", "x86_64"):
        return "x86_64"
    if arch in ("x86", "i386", "i686"):
        return "x86"
    if arch in ("arm64", "aarch64"):
        return "aarch64"
    return arch or "unknown"


def get_boot_time_ms(psutil):
    try:
        return str(int(psutil.boot_time() * 1000))
    except Exception:
        return "0"


def get_uptime_text(psutil):
    try:
        seconds = int(time.time() - psutil.boot_time())
        days, rem = divmod(seconds, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, _ = divmod(rem, 60)

        parts = []
        if days:
            parts.append(f"{days} days")
        if hours:
            parts.append(f"{hours} hours")
        if minutes or not parts:
            parts.append(f"{minutes} minutes")
        return ", ".join(parts)
    except Exception:
        return "Unknown"


def get_load_text(cpu_percent):
    try:
        v1 = max(min(cpu_percent / 100.0, 999.0), 0.0)
        v2 = max(v1 * 0.8, 0.0)
        v3 = max(v1 * 0.6, 0.0)
        return f"{v1:.2f} {v2:.2f} {v3:.2f}"
    except Exception:
        return "0 0 0"


def get_connection_count(psutil):
    tcp_conn = 0
    udp_conn = 0
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.type == socket.SOCK_STREAM:
                tcp_conn += 1
            elif conn.type == socket.SOCK_DGRAM:
                udp_conn += 1
    except Exception:
        pass
    return tcp_conn, udp_conn


def mb_to_gb_text(mb_text):
    try:
        mb = float(mb_text)
        return f"{mb / 1024:.2f} GB"
    except Exception:
        return "-"


def collect_metrics(psutil, previous_net):
    now = time.time()

    cpu_percent = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    disk = shutil.disk_usage("C:\\")

    net = psutil.net_io_counters()
    rx_now = int(getattr(net, "bytes_recv", 0))
    tx_now = int(getattr(net, "bytes_sent", 0))

    prev_time = previous_net.get("time", now)
    rx_prev = previous_net.get("rx", rx_now)
    tx_prev = previous_net.get("tx", tx_now)

    delta_time = max(now - prev_time, 1)
    rx_speed = int(max(rx_now - rx_prev, 0) / delta_time)
    tx_speed = int(max(tx_now - tx_prev, 0) / delta_time)

    previous_net["time"] = now
    previous_net["rx"] = rx_now
    previous_net["tx"] = tx_now

    tcp_conn, udp_conn = get_connection_count(psutil)

    try:
        processes = len(psutil.pids())
    except Exception:
        processes = 0

    metrics = {
        "cpu": f"{cpu_percent:.2f}",
        "ram": f"{mem.percent:.2f}",
        "ram_total": str(int(mem.total / 1024 / 1024)),
        "ram_used": str(int(mem.used / 1024 / 1024)),
        "swap_total": str(int(swap.total / 1024 / 1024)),
        "swap_used": str(int(swap.used / 1024 / 1024)),
        "disk": str(int((disk.used / disk.total) * 100)) if disk.total else "0",
        "disk_total": str(int(disk.total / 1024 / 1024)),
        "disk_used": str(int(disk.used / 1024 / 1024)),
        "load_avg": get_load_text(cpu_percent),
        "boot_time": get_boot_time_ms(psutil),
        "net_rx": str(rx_now),
        "net_tx": str(tx_now),
        "net_in_speed": str(rx_speed),
        "net_out_speed": str(tx_speed),
        "os": get_os_name(),
        "arch": get_arch(),
        "cpu_info": get_cpu_name(),
        "cpu_cores": str(psutil.cpu_count(logical=True) or os.cpu_count() or 1),
        "processes": str(processes),
        "tcp_conn": str(tcp_conn),
        "udp_conn": str(udp_conn),
    }
    return metrics


def probe_loop(status_callback=None):
    import psutil

    config = load_config()
    server_id = config.get("server_id", "").strip()
    secret = config.get("secret", "").strip()
    worker_url = config.get("worker_url", "").strip()
    try:
        collect_interval = int(config.get("collect_interval", DEFAULT_COLLECT_INTERVAL))
    except Exception:
        collect_interval = DEFAULT_COLLECT_INTERVAL
    try:
        report_interval = int(config.get("report_interval", DEFAULT_INTERVAL))
    except Exception:
        report_interval = DEFAULT_INTERVAL
    collect_interval = max(collect_interval, 0)
    report_interval = max(report_interval, 1)
    if collect_interval > 0:
        report_interval = max(report_interval, collect_interval)
    active_interval = collect_interval if collect_interval > 0 else report_interval
    ping_type = config.get("ping_type", "tcp").strip().lower() or "tcp"

    if not server_id or not secret or not worker_url:
        log("配置不完整，请先填写并保存。")
        return

    previous_net = {}
    cache = {
        "ip_v4": "0",
        "ip_v6": "0",
        "ping_ct": "",
        "ping_cu": "",
        "ping_cm": "",
        "ping_bd": "",
        "public_ipv4": "",
        "public_ipv6": "",
    }

    last_ip_check = 0
    cache_lock = threading.Lock()
    last_ping_check = 0
    ping_thread = None
    last_report_time = 0
    last_report_ok = False
    samples = []

    def refresh_ping_cache():
        values = {
            "ping_ct": get_ping(CT_NODE, ping_type),
            "ping_cu": get_ping(CU_NODE, ping_type),
            "ping_cm": get_ping(CM_NODE, ping_type),
            "ping_bd": get_ping(BD_NODE, ping_type),
        }
        with cache_lock:
            cache.update(values)

    try:
        psutil.cpu_percent(interval=None)
    except Exception:
        pass

    log("探针已启动。")

    while not stop_event.is_set():
        loop_start = time.time()

        try:
            now = time.time()

            if now - last_ip_check >= 600 or last_ip_check == 0:
                cache["public_ipv4"] = get_public_ipv4()
                cache["public_ipv6"] = get_public_ipv6()
                cache["ip_v4"] = "1" if cache["public_ipv4"] else "0"
                cache["ip_v6"] = "1" if cache["public_ipv6"] else "0"
                last_ip_check = now

            if (now - last_ping_check >= 30 or last_ping_check == 0) and (ping_thread is None or not ping_thread.is_alive()):
                last_ping_check = now
                ping_thread = threading.Thread(target=refresh_ping_cache, daemon=True)
                ping_thread.start()

            metrics = collect_metrics(psutil, previous_net)
            with cache_lock:
                cache_snapshot = dict(cache)
            metrics["ip_v4"] = cache_snapshot["ip_v4"]
            metrics["ip_v6"] = cache_snapshot["ip_v6"]
            metrics["ping_ct"] = cache_snapshot["ping_ct"]
            metrics["ping_cu"] = cache_snapshot["ping_cu"]
            metrics["ping_cm"] = cache_snapshot["ping_cm"]
            metrics["ping_bd"] = cache_snapshot["ping_bd"]

            sample_ts = int(loop_start * 1000)
            if collect_interval > 0:
                samples.append({
                    "ts": sample_ts,
                    "metrics": dict(metrics),
                })

            should_report = (
                last_report_time == 0
                or now - last_report_time >= report_interval
            )

            if should_report:
                payload = {
                    "id": server_id,
                    "secret": secret,
                    "metrics": metrics,
                    "collect_interval": collect_interval,
                    "report_interval": report_interval,
                }
                if collect_interval > 0:
                    payload["samples"] = samples
                last_report_ok = http_post_json(worker_url, payload)
                samples = []
                last_report_time = now

            if status_callback:
                gui_data = dict(metrics)
                gui_data["public_ipv4"] = cache_snapshot["public_ipv4"]
                gui_data["public_ipv6"] = cache_snapshot["public_ipv6"]
                gui_data["uptime_text"] = get_uptime_text(psutil)
                status_callback(gui_data, last_report_ok, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

            if should_report and last_report_ok:
                log("上报成功。")
        except Exception as e:
            log(f"主循环异常: {e}")
            if status_callback:
                status_callback({}, False, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

        used = time.time() - loop_start
        sleep_time = max(active_interval - used, 1)
        stop_event.wait(sleep_time)

    log("探针已停止。")


class ProbeGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("CF服务器监控探针")
        self.root.geometry("1140x780")
        self.root.minsize(1020, 700)

        self.config = load_config()
        self.worker_thread = None

        self.server_id_var = tk.StringVar(value=self.config.get("server_id", ""))
        self.secret_var = tk.StringVar(value=self.config.get("secret", ""))
        self.url_var = tk.StringVar(value=self.config.get("worker_url", ""))
        self.collect_interval_var = tk.StringVar(value=str(self.config.get("collect_interval", DEFAULT_COLLECT_INTERVAL)))
        self.interval_var = tk.StringVar(value=str(self.config.get("report_interval", DEFAULT_INTERVAL)))
        self.ping_type_var = tk.StringVar(value=self.config.get("ping_type", "tcp"))
        self.silent_start_var = tk.BooleanVar(value=self.config.get("silent_start", True))
        self.autostart_var = tk.BooleanVar(value=task_exists())

        self.status_var = tk.StringVar(value="未启动")
        self.last_report_var = tk.StringVar(value="-")
        self.online_var = tk.StringVar(value="离线")

        self.build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.hide_window)
        self.root.after(300, self.flush_logs)

    def build_ui(self):
        main = ttk.Frame(self.root, padding=14)
        main.pack(fill=tk.BOTH, expand=True)

        left = ttk.Frame(main)
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        right = ttk.Frame(main, width=410)
        right.pack(side=tk.RIGHT, fill=tk.Y, padx=(14, 0))
        right.pack_propagate(False)

        form = ttk.LabelFrame(left, text="探针配置", padding=12)
        form.pack(fill=tk.X)

        ttk.Label(form, text="服务器ID：").grid(row=0, column=0, sticky=tk.W, pady=5)
        ttk.Entry(form, textvariable=self.server_id_var).grid(row=0, column=1, sticky=tk.EW, pady=5)

        ttk.Label(form, text="密匙：").grid(row=1, column=0, sticky=tk.W, pady=5)
        ttk.Entry(form, textvariable=self.secret_var, show="*").grid(row=1, column=1, sticky=tk.EW, pady=5)

        ttk.Label(form, text="上报链接：").grid(row=2, column=0, sticky=tk.W, pady=5)
        ttk.Entry(form, textvariable=self.url_var).grid(row=2, column=1, sticky=tk.EW, pady=5)

        ttk.Label(form, text="上报间隔：").grid(row=3, column=0, sticky=tk.W, pady=5)
        interval_frame = ttk.Frame(form)
        interval_frame.grid(row=3, column=1, sticky=tk.W, pady=5)
        ttk.Label(interval_frame, text="Collect").pack(side=tk.LEFT)
        ttk.Entry(interval_frame, textvariable=self.collect_interval_var, width=8).pack(side=tk.LEFT, padx=(6, 10))
        ttk.Label(interval_frame, text="Report").pack(side=tk.LEFT)
        ttk.Entry(interval_frame, textvariable=self.interval_var, width=12).pack(side=tk.LEFT)
        ttk.Label(interval_frame, text="秒").pack(side=tk.LEFT, padx=(6, 0))

        ttk.Label(form, text="延时模式：").grid(row=4, column=0, sticky=tk.W, pady=5)
        ping_frame = ttk.Frame(form)
        ping_frame.grid(row=4, column=1, sticky=tk.W, pady=5)
        ttk.Radiobutton(ping_frame, text="TCP", variable=self.ping_type_var, value="tcp").pack(side=tk.LEFT)
        ttk.Radiobutton(ping_frame, text="HTTP", variable=self.ping_type_var, value="http").pack(side=tk.LEFT, padx=(12, 0))

        form.columnconfigure(1, weight=1)

        options = ttk.Frame(left)
        options.pack(fill=tk.X, pady=(10, 6))

        ttk.Checkbutton(
            options,
            text="跟随系统自动启动",
            variable=self.autostart_var,
            command=self.toggle_autostart,
        ).pack(side=tk.LEFT)

        ttk.Checkbutton(
            options,
            text="开机静默启动（不弹主界面）",
            variable=self.silent_start_var,
            command=self.save_quick,
        ).pack(side=tk.LEFT, padx=12)

        toolbar = ttk.Frame(left)
        toolbar.pack(fill=tk.X, pady=(6, 10))

        ttk.Button(toolbar, text="保存配置", command=lambda: self.save(show_msg=True)).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="导入配置", command=self.import_config).pack(side=tk.LEFT, padx=6)
        ttk.Button(toolbar, text="导出配置", command=self.export_config).pack(side=tk.LEFT, padx=6)
        ttk.Button(toolbar, text="启动探针", command=self.start_probe).pack(side=tk.LEFT, padx=6)
        ttk.Button(toolbar, text="停止探针", command=self.stop_probe).pack(side=tk.LEFT, padx=6)
        ttk.Button(toolbar, text="隐藏窗口", command=self.hide_window).pack(side=tk.LEFT, padx=6)
        ttk.Button(toolbar, text="退出程序", command=self.exit_app).pack(side=tk.RIGHT)

        log_box = ttk.LabelFrame(left, text="运行日志", padding=8)
        log_box.pack(fill=tk.BOTH, expand=True)

        self.log_text = tk.Text(log_box, wrap=tk.WORD, font=("Consolas", 10))
        self.log_text.pack(fill=tk.BOTH, expand=True)

        ttk.Label(right, text="运行状态", font=("Microsoft YaHei UI", 12, "bold")).pack(anchor=tk.W)

        self.online_label = tk.Label(
            right,
            textvariable=self.online_var,
            fg="white",
            bg="#d9534f",
            width=12,
            pady=8,
            font=("Microsoft YaHei UI", 10, "bold"),
        )
        self.online_label.pack(anchor=tk.W, pady=(8, 8))

        ttk.Label(right, text="状态说明：").pack(anchor=tk.W)
        ttk.Label(right, textvariable=self.status_var).pack(anchor=tk.W, pady=(4, 10))

        ttk.Label(right, text="最近一次上报时间：").pack(anchor=tk.W)
        ttk.Label(right, textvariable=self.last_report_var).pack(anchor=tk.W, pady=(4, 10))

        self.uptime_label = ttk.Label(right, text="运行时间（本地显示）：-")
        self.uptime_label.pack(anchor=tk.W, pady=3)

        self.boot_label = ttk.Label(right, text="启动时间戳：-")
        self.boot_label.pack(anchor=tk.W, pady=3)

        self.os_label = ttk.Label(right, text="操作系统：-")
        self.os_label.pack(anchor=tk.W, pady=3)

        self.arch_label = ttk.Label(right, text="系统架构：-")
        self.arch_label.pack(anchor=tk.W, pady=3)

        self.cpu_model_label = ttk.Label(right, text="CPU型号：-")
        self.cpu_model_label.pack(anchor=tk.W, pady=3)

        self.cpu_core_label = ttk.Label(right, text="CPU核心：-")
        self.cpu_core_label.pack(anchor=tk.W, pady=3)

        self.load_label = ttk.Label(right, text="负载均值：-")
        self.load_label.pack(anchor=tk.W, pady=3)

        self.cpu_label = ttk.Label(right, text="CPU占用：-")
        self.cpu_label.pack(anchor=tk.W, pady=3)

        self.ram_label = ttk.Label(right, text="内存占用：-")
        self.ram_label.pack(anchor=tk.W, pady=3)

        self.ram_total_label = ttk.Label(right, text="总内存：-")
        self.ram_total_label.pack(anchor=tk.W, pady=3)

        self.swap_label = ttk.Label(right, text="交换占用：-")
        self.swap_label.pack(anchor=tk.W, pady=3)

        self.swap_total_label = ttk.Label(right, text="总交换：-")
        self.swap_total_label.pack(anchor=tk.W, pady=3)

        self.disk_label = ttk.Label(right, text="磁盘占用：-")
        self.disk_label.pack(anchor=tk.W, pady=3)

        self.disk_total_label = ttk.Label(right, text="总磁盘：-")
        self.disk_total_label.pack(anchor=tk.W, pady=3)

        self.net_label = ttk.Label(right, text="网络速度：-")
        self.net_label.pack(anchor=tk.W, pady=3)

        self.ip_status_label = ttk.Label(right, text="IPv4/IPv6状态：-")
        self.ip_status_label.pack(anchor=tk.W, pady=3)

        self.public_ip_label = ttk.Label(right, text="公网IP：-")
        self.public_ip_label.pack(anchor=tk.W, pady=3)

        self.ping_label = ttk.Label(right, text="延时：-")
        self.ping_label.pack(anchor=tk.W, pady=3)

        ttk.Separator(right).pack(fill=tk.X, pady=12)

        ttk.Label(
            right,
            text="说明：已严格对齐 Linux V1.0.1 协议。boot_time 为毫秒时间戳，容量字段按 MB 上报，GUI 仅转换成 GB 显示。",
            wraplength=360,
        ).pack(anchor=tk.W)

    def save_quick(self):
        self.save(show_msg=False)

    def save(self, show_msg=False):
        try:
            collect_interval = int(self.collect_interval_var.get().strip() or DEFAULT_COLLECT_INTERVAL)
            interval = int(self.interval_var.get().strip() or DEFAULT_INTERVAL)

            if collect_interval < 0:
                collect_interval = 0
            if collect_interval > 0 and interval < collect_interval:
                interval = collect_interval

            ping_type = self.ping_type_var.get().strip().lower()

            if ping_type not in ("tcp", "http"):
                ping_type = "tcp"

            config = {
                "server_id": self.server_id_var.get().strip(),
                "secret": self.secret_var.get().strip(),
                "worker_url": self.url_var.get().strip(),
                "collect_interval": collect_interval,
                "report_interval": interval,
                "silent_start": bool(self.silent_start_var.get()),
                "ping_type": ping_type,
            }

            if (
                not config["server_id"]
                or not config["secret"]
                or not config["worker_url"]
            ):
                if show_msg:
                    messagebox.showwarning("提示", "请填写完整配置。")
                return False

            if not config["worker_url"].startswith(("http://", "https://")):
                if show_msg:
                    messagebox.showwarning(
                        "提示",
                        "上报链接必须以 http:// 或 https:// 开头"
                    )
                return False

            save_config(config)

            if self.autostart_var.get():
                try:
                    create_startup_task()
                except Exception as e:
                    log(f"更新自动启动任务失败: {e}")

            running = (
                self.worker_thread
                and self.worker_thread.is_alive()
            )

            if running:
                log("配置已变更，正在重启探针...")

                stop_event.set()

                self.worker_thread.join(timeout=5)

                stop_event.clear()

                self.worker_thread = threading.Thread(
                    target=probe_loop,
                    args=(self.update_metrics,),
                    daemon=True,
                )

                self.worker_thread.start()

                log("探针已重新启动。")

            else:
                stop_event.clear()
                self.worker_thread = threading.Thread(
                    target=probe_loop,
                    args=(self.update_metrics,),
                    daemon=True,
                )
                self.worker_thread.start()
                self.status_var.set("运行中")
                log("探针已启动。")

            log("配置已保存。")

            if show_msg:
                messagebox.showinfo("完成", "配置已保存。")

            return True

        except Exception as e:
            messagebox.showerror("错误", str(e))
            return False
    
    def import_config(self):
        file_path = filedialog.askopenfilename(
            title="导入配置",
            filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")],
        )
        if not file_path:
            return
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)

            self.server_id_var.set(cfg.get("server_id", DEFAULT_CONFIG["server_id"]))
            self.secret_var.set(cfg.get("secret", DEFAULT_CONFIG["secret"]))
            self.url_var.set(cfg.get("worker_url", DEFAULT_CONFIG["worker_url"]))
            self.collect_interval_var.set(str(cfg.get("collect_interval", DEFAULT_CONFIG["collect_interval"])))
            self.interval_var.set(str(cfg.get("report_interval", DEFAULT_CONFIG["report_interval"])))
            self.silent_start_var.set(bool(cfg.get("silent_start", True)))
            self.ping_type_var.set(cfg.get("ping_type", "tcp"))

            log("已导入配置。")
            messagebox.showinfo("完成", "配置导入成功。")
        except Exception as e:
            messagebox.showerror("错误", f"导入失败: {e}")

    def export_config(self):
        file_path = filedialog.asksaveasfilename(
            title="导出配置",
            defaultextension=".json",
            filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")],
        )
        if not file_path:
            return
        try:
            collect_interval = int(self.collect_interval_var.get().strip() or DEFAULT_COLLECT_INTERVAL)
            interval = int(self.interval_var.get().strip() or DEFAULT_INTERVAL)
            if collect_interval < 0:
                collect_interval = 0
            if collect_interval > 0 and interval < collect_interval:
                interval = collect_interval
            ping_type = self.ping_type_var.get().strip().lower()
            if ping_type not in ("tcp", "http"):
                ping_type = "tcp"

            cfg = {
                "server_id": self.server_id_var.get().strip(),
                "secret": self.secret_var.get().strip(),
                "worker_url": self.url_var.get().strip(),
                "collect_interval": collect_interval,
                "report_interval": interval,
                "silent_start": bool(self.silent_start_var.get()),
                "ping_type": ping_type,
            }
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)

            log("已导出配置。")
            messagebox.showinfo("完成", "配置导出成功。")
        except Exception as e:
            messagebox.showerror("错误", f"导出失败: {e}")

    def start_probe(self):
        if self.worker_thread and self.worker_thread.is_alive():
            log("探针已经在运行。")
            return

        if not self.save(show_msg=False):
            messagebox.showwarning("提示", "请先填写完整配置。")
            return

        stop_event.clear()
        self.worker_thread = threading.Thread(
            target=probe_loop,
            args=(self.update_metrics,),
            daemon=True,
        )
        self.worker_thread.start()
        self.status_var.set("运行中")
        log("已点击启动探针。")

    def stop_probe(self):
        stop_event.set()

        if self.worker_thread and self.worker_thread.is_alive():
            self.worker_thread.join(timeout=5)

        self.status_var.set("已停止")
        self.online_var.set("离线")
        self.online_label.config(bg="#d9534f")

        log("已点击停止探针。")

    def update_metrics(self, metrics, ok, report_time):
        self.root.after(0, lambda: self.render_metrics(metrics, ok, report_time))

    def render_metrics(self, metrics, ok, report_time):
        self.last_report_var.set(report_time)

        if ok:
            self.status_var.set("运行中，上报成功")
            self.online_var.set("在线")
            self.online_label.config(bg="#28a745")
        else:
            self.status_var.set("运行中，上报失败")
            self.online_var.set("离线")
            self.online_label.config(bg="#d9534f")

        if not metrics:
            return

        self.uptime_label.config(text=f"运行时间（本地显示）：{metrics.get('uptime_text', '-')}")
        self.boot_label.config(text=f"启动时间戳：{metrics.get('boot_time', '-')}")
        self.os_label.config(text=f"操作系统：{metrics.get('os', '-')}")
        self.arch_label.config(text=f"系统架构：{metrics.get('arch', '-')}")
        self.cpu_model_label.config(text=f"CPU型号：{metrics.get('cpu_info', '-')}")
        self.cpu_core_label.config(text=f"CPU核心：{metrics.get('cpu_cores', '-')}")
        self.load_label.config(text=f"负载均值：{metrics.get('load_avg', '-')}")
        self.cpu_label.config(text=f"CPU占用：{metrics.get('cpu', '-')}%")
        self.ram_label.config(text=f"内存占用：{metrics.get('ram', '-')}%")
        self.ram_total_label.config(text=f"总内存：{mb_to_gb_text(metrics.get('ram_total', '0'))}")
        self.swap_label.config(text=f"交换占用：{mb_to_gb_text(metrics.get('swap_used', '0'))}")
        self.swap_total_label.config(text=f"总交换：{mb_to_gb_text(metrics.get('swap_total', '0'))}")
        self.disk_label.config(text=f"磁盘占用：{metrics.get('disk', '-')}%")
        self.disk_total_label.config(text=f"总磁盘：{mb_to_gb_text(metrics.get('disk_total', '0'))}")
        self.net_label.config(
            text=f"网络速度：↓{metrics.get('net_in_speed', '0')} B/s ↑{metrics.get('net_out_speed', '0')} B/s"
        )
        self.ip_status_label.config(
            text=f"IPv4/IPv6状态：{metrics.get('ip_v4', '0')} / {metrics.get('ip_v6', '0')}"
        )
        self.public_ip_label.config(
            text=f"公网IP：{metrics.get('public_ipv4', '-') or '-'} / {metrics.get('public_ipv6', '-') or '-'}"
        )
        self.ping_label.config(
            text=(
                f"电信 {metrics.get('ping_ct', '') or '-'}ms  "
                f"联通 {metrics.get('ping_cu', '') or '-'}ms  "
                f"移动 {metrics.get('ping_cm', '') or '-'}ms  "
                f"BGP {metrics.get('ping_bd', '') or '-'}ms"
            )
        )

    def toggle_autostart(self):
        try:
            if self.autostart_var.get():
                self.save(show_msg=False)
                create_startup_task()
            else:
                delete_startup_task()
        except Exception as e:
            self.autostart_var.set(task_exists())
            messagebox.showerror("错误", str(e))

    def flush_logs(self):
        try:
            while True:
                line = log_queue.get_nowait()
                self.log_text.insert(tk.END, line + "\n")
                self.log_text.see(tk.END)

                lines = int(self.log_text.index("end-1c").split(".")[0])
                if lines > 2000:
                    self.log_text.delete("1.0", "200.0")
        except queue.Empty:
            pass
        self.root.after(300, self.flush_logs)

    def hide_window(self):
        self.root.withdraw()
        log("窗口已隐藏到系统托盘。")

    def show_window(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def exit_app(self):
        if messagebox.askyesno("退出", "确定要退出程序吗？"):
            stop_event.set()
            global tray_icon
            if tray_icon:
                try:
                    tray_icon.stop()
                except Exception:
                    pass
            try:
                self.root.destroy()
            except Exception:
                pass
            os._exit(0)


def load_tray_image():
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (64, 64), (22, 119, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse((8, 8, 56, 56), fill=(255, 255, 255, 255))
    return img


def create_tray_icon(app):
    global tray_icon
    import pystray

    image = load_tray_image()

    def on_show(icon, item):
        app.root.after(0, app.show_window)

    def on_toggle_autostart(icon, item):
        def action():
            try:
                if task_exists():
                    delete_startup_task()
                    app.autostart_var.set(False)
                else:
                    app.save(show_msg=False)
                    create_startup_task()
                    app.autostart_var.set(True)
            except Exception as e:
                messagebox.showerror("错误", str(e))
        app.root.after(0, action)

    def on_start(icon, item):
        app.root.after(0, app.start_probe)

    def on_stop(icon, item):
        app.root.after(0, app.stop_probe)

    def on_exit(icon, item):
        app.root.after(0, app.exit_app)

    def checked(item):
        return task_exists()

    tray_icon = pystray.Icon(
        APP_NAME,
        image,
        "CF服务器监控探针",
        menu=pystray.Menu(
            pystray.MenuItem("显示窗口", on_show),
            pystray.MenuItem("启动探针", on_start),
            pystray.MenuItem("停止探针", on_stop),
            pystray.MenuItem("跟随系统自动启动", on_toggle_autostart, checked=checked),
            pystray.MenuItem("退出程序", on_exit),
        ),
    )

    threading.Thread(target=tray_icon.run, daemon=True).start()


def uninstall_cli():
    delete_startup_task()
    stop_event.set()

    files_to_remove = [
        CONFIG_FILE,
        LOG_FILE,
    ]

    try:
        for f in files_to_remove:
            if f.exists():
                f.unlink()

        for i in range(1, LOG_BACKUP_COUNT + 1):
            backup = BASE_DIR / f"cf_probe.log.{i}"
            if backup.exists():
                backup.unlink()

    except Exception as e:
        print(f"清理文件失败: {e}")

    print("卸载完成。")


def run_gui(minimized=False):
    if not ensure_deps():
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("错误", "依赖安装失败，请手动执行: pip install psutil pystray pillow")
        return

    cfg = load_config()
    silent = bool(cfg.get("silent_start", True))

    root = tk.Tk()
    app = ProbeGUI(root)
    create_tray_icon(app)
    app.start_probe()

    if minimized or silent:
        root.withdraw()

    root.mainloop()


def main():
    if not is_windows():
        print("此程序仅适用于 Windows 10/11。")
        sys.exit(1)

    cmd = sys.argv[1].lower() if len(sys.argv) >= 2 else "gui"

    if cmd in ("uninstall", "remove", "delete", "purge"):
        if not ensure_admin():
            print("无法获取管理员权限。")
            sys.exit(1)

    if cmd == "gui":
        run_gui("--minimized" in sys.argv)
    elif cmd == "run":
        if not ensure_deps():
            print("缺少依赖，请执行: pip install psutil pystray pillow")
            sys.exit(1)
        probe_loop()
    elif cmd in ("uninstall", "remove", "delete", "purge"):
        uninstall_cli()
    else:
        run_gui()


if __name__ == "__main__":
    main()
