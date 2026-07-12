#Requires -Version 5.1
<#
.SYNOPSIS
    CF-Server-Monitor Windows 探针 (PowerShell 版)
.DESCRIPTION
    无 Python 依赖，纯 PowerShell 实现，功能对齐 Linux install.sh
.PARAMETER Action
    install   - 安装并启动探针服务
    uninstall - 卸载探针服务
    run       - 前台运行（调试用）
    status    - 查看运行状态
    stop      - 停止探针
.PARAMETER Id
    服务器 ID
.PARAMETER Secret
    API 认证密钥
.PARAMETER Url
    Worker 上报地址
.PARAMETER CollectInterval
    兼容参数。Windows PowerShell 版不使用 samples 采样缓存，始终按上报间隔采集并上报。
.PARAMETER ReportInterval
    上报间隔（秒），默认 60
.PARAMETER PingType
    探测类型: http | tcp，默认 tcp
.PARAMETER ResetDay
    流量重置日（1-31, 0=不重置），默认 1
.PARAMETER RxCorrection
    下行流量校正（GB），直接设置当月下行数据
.PARAMETER TxCorrection
    上行流量校正（GB），直接设置当月上行数据
.PARAMETER CtNode
    自定义 CT 测试节点
.PARAMETER CuNode
    自定义 CU 测试节点
.PARAMETER CmNode
    自定义 CM 测试节点
.PARAMETER BdNode
    自定义 BD 测试节点
.EXAMPLE
    .\cf-server-monitor.ps1 install -Id "xxx" -Secret "yyy" -Url "https://worker.example.com/update"
.EXAMPLE
    .\cf-server-monitor.ps1 install -Id "xxx" -Secret "yyy" -Url "https://worker.example.com/update" -RxCorrection 10 -TxCorrection 5
.EXAMPLE
    .\cf-server-monitor.ps1 uninstall
#>
param(
    [Parameter(Position=0)]
    [ValidateSet("install","uninstall","run","tray","status","stop")]
    [string]$Action = "run",

    [string]$Id = "",
    [string]$Secret = "",
    [string]$Url = "",
    [string]$CollectInterval = "0",
    [string]$ReportInterval = "60",
    [string]$PingType = "tcp",
    [string]$ResetDay = "1",
    [string]$RxCorrection = "",
    [string]$TxCorrection = "",
    [string]$CtNode = "",
    [string]$CuNode = "",
    [string]$CmNode = "",
    [string]$BdNode = "",
    
    [switch]$STA
)

if (-not $STA -and $host.Runspace.ApartmentState -ne 'STA') {
    if ($MyInvocation.MyCommand.Path) {
        $scriptPath = $MyInvocation.MyCommand.Path
    } elseif ($PSCommandPath) {
        $scriptPath = $PSCommandPath
    } else {
        $scriptPath = Join-Path (Get-Location).Path "cf-server-monitor.ps1"
    }
    $argList = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$scriptPath`" $Action -STA"
    if ($Id) { $argList += " -Id `"$Id`"" }
    if ($Secret) { $argList += " -Secret `"$Secret`"" }
    if ($Url) { $argList += " -Url `"$Url`"" }
    if ($CollectInterval) { $argList += " -CollectInterval `"$CollectInterval`"" }
    if ($ReportInterval) { $argList += " -ReportInterval `"$ReportInterval`"" }
    if ($PingType) { $argList += " -PingType `"$PingType`"" }
    if ($ResetDay) { $argList += " -ResetDay `"$ResetDay`"" }
    if ($RxCorrection) { $argList += " -RxCorrection `"$RxCorrection`"" }
    if ($TxCorrection) { $argList += " -TxCorrection `"$TxCorrection`"" }
    if ($CtNode) { $argList += " -CtNode `"$CtNode`"" }
    if ($CuNode) { $argList += " -CuNode `"$CuNode`"" }
    if ($CmNode) { $argList += " -CmNode `"$CmNode`"" }
    if ($BdNode) { $argList += " -BdNode `"$BdNode`"" }
    Start-Process powershell.exe -ArgumentList $argList
    exit 0
}

$ErrorActionPreference = "Continue"
$DebugPreference = "SilentlyContinue"
trap { Write-Host "捕获到异常: $_" -ForegroundColor Red; continue }

$ErrorActionPreference = "Stop"

$APP_NAME = "CF-Server-Monitor"
$TASK_NAME = "CFProbe"
# 获取脚本所在目录
if ($MyInvocation.MyCommand.Path) {
    $SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
} elseif ($PSCommandPath) {
    $SCRIPT_DIR = Split-Path -Parent $PSCommandPath
} else {
    $SCRIPT_DIR = (Get-Location).Path
}
$CONFIG_DIR = $SCRIPT_DIR
$CONFIG_FILE = Join-Path $CONFIG_DIR "cf_probe_config.json"
$LOG_FILE = Join-Path $CONFIG_DIR "cf_probe.log"
$TRAFFIC_FILE = Join-Path $CONFIG_DIR "cf_probe_traffic.dat"

$DEFAULT_CT = "gd-ct-dualstack.ip.zstaticcdn.com"
$DEFAULT_CU = "gd-cu-dualstack.ip.zstaticcdn.com"
$DEFAULT_CM = "gd-cm-dualstack.ip.zstaticcdn.com"
$DEFAULT_BD = "lf3-ips.zstaticcdn.com"
$MAX_TRAFFIC_CORRECTION_GB = 1000000

$MAX_LOG_SIZE = 2MB
$LOG_BACKUP_COUNT = 3

# ============================================================
# 工具函数
# ============================================================

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    try {
        if (Test-Path $LOG_FILE) {
            $size = (Get-Item $LOG_FILE).Length
            if ($size -gt $MAX_LOG_SIZE) {
                for ($i = $LOG_BACKUP_COUNT - 1; $i -ge 1; $i--) {
                    $src = Join-Path $CONFIG_DIR "cf_probe.log.$i"
                    $dst = Join-Path $CONFIG_DIR "cf_probe.log.$($i+1)"
                    if (Test-Path $src) {
                        if (Test-Path $dst) { Remove-Item $dst -Force }
                        Rename-Item $src $dst
                    }
                }
                $backup = Join-Path $CONFIG_DIR "cf_probe.log.1"
                if (Test-Path $backup) { Remove-Item $backup -Force }
                Rename-Item $LOG_FILE $backup
            }
        }
        [System.IO.File]::AppendAllText($LOG_FILE, $line + "`r`n", [System.Text.Encoding]::UTF8)
    } catch {
        # 日志写入失败，忽略
    }
    Write-Host $line
}

function Load-Config {
    Write-Log "尝试加载配置文件: $CONFIG_FILE" "DEBUG"
    if (Test-Path $CONFIG_FILE) {
        try {
            $content = Get-Content $CONFIG_FILE -Raw -Encoding UTF8
            $raw = $content | ConvertFrom-Json
            Write-Log "配置文件加载成功" "INFO"
            # 清理 URL
            if ($raw.worker_url) {
                $raw.worker_url = $raw.worker_url.Trim().Trim("'").Trim('"')
            }
            # 同时清理其他可能包含引号的字段
            if ($raw.secret) {
                $raw.secret = $raw.secret.Trim().Trim("'").Trim('"')
            }
            if ($raw.server_id) {
                $raw.server_id = $raw.server_id.Trim().Trim("'").Trim('"')
            }
            return $raw
        } catch {
            Write-Log "配置文件加载失败: $_" "ERROR"
            Write-Log "错误详情: $($_.Exception.Message)" "ERROR"
            return $null
        }
    } else {
        Write-Log "配置文件不存在: $CONFIG_FILE" "WARN"
        return $null
    }
}

function Save-Config {
    param($Config)
    $tempFile = "$CONFIG_FILE.tmp"
    $backupFile = "$CONFIG_FILE.bak"
    try {
        if (-not (Test-Path $CONFIG_DIR)) {
            New-Item -ItemType Directory -Path $CONFIG_DIR -Force | Out-Null
        }
        $json = $Config | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($tempFile, $json, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path $CONFIG_FILE) {
            Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
            [System.IO.File]::Replace($tempFile, $CONFIG_FILE, $backupFile)
            Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
        } else {
            Move-Item -LiteralPath $tempFile -Destination $CONFIG_FILE
        }
        Write-Log "配置文件已保存: $CONFIG_FILE" "DEBUG"
        return $true
    } catch {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $CONFIG_FILE) -and (Test-Path -LiteralPath $backupFile)) {
            Move-Item -LiteralPath $backupFile -Destination $CONFIG_FILE -Force -ErrorAction SilentlyContinue
        } else {
            Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
        }
        Write-Log "保存配置文件失败: $_" "ERROR"
        return $false
    }
}

function ConvertFrom-AgentConfigResponse {
    param([string]$Body, [string]$ConfigMd5)

    if ([string]::IsNullOrEmpty($Body) -or [Text.Encoding]::UTF8.GetByteCount($Body) -gt 1024) {
        throw "动态配置响应长度无效"
    }
    $ConfigMd5 = $ConfigMd5.Trim().ToLowerInvariant()
    if ($ConfigMd5 -notmatch '^[a-f0-9]{32}$') { throw "动态配置 MD5 无效" }
    if ($Body -notmatch '^[a-z0-9_=&.\-]+$') { throw "动态配置包含非法字符" }

    $expectedKeys = @('collect_interval', 'ping_mode', 'report_interval', 'reset_day', 'schema_version', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd')
    $parts = $Body.Split('&')
    if ($parts.Count -lt $expectedKeys.Count) { throw "动态配置字段数量无效" }
    $values = @{}
    for ($i = 0; $i -lt [Math]::Min($parts.Count, $expectedKeys.Count); $i++) {
        $pair = $parts[$i].Split('=')
        if ($pair.Count -ne 2 -or $pair[0] -ne $expectedKeys[$i]) { throw "动态配置字段无效" }
        $values[$pair[0]] = $pair[1]
    }

    for ($i = $expectedKeys.Count; $i -lt $parts.Count; $i++) {
        $pair = $parts[$i].Split('=')
        if ($pair.Count -eq 2) {
            $values[$pair[0]] = $pair[1]
        }
    }

    foreach ($key in @('collect_interval', 'report_interval', 'reset_day', 'schema_version')) {
        if ($values[$key] -notmatch '^(0|[1-9][0-9]*)$') { throw "动态配置数值无效" }
    }
    $collect = [int]$values.collect_interval
    $report = [int]$values.report_interval
    $reset = [int]$values.reset_day
    $schema = [int]$values.schema_version
    if (@(0, 1, 2, 5, 10) -notcontains $collect) { throw "collect_interval 无效" }
    if (@(30, 60, 120, 180) -notcontains $report -or $report -lt $collect) { throw "report_interval 无效" }
    if (@('http', 'tcp') -notcontains $values.ping_mode) { throw "ping_mode 无效" }
    if ($reset -lt 0 -or $reset -gt 31 -or $schema -ne 1) { throw "reset_day 或 schema_version 无效" }

    $canonical = "collect_interval=$collect&ping_mode=$($values.ping_mode)&report_interval=$report&reset_day=$reset&schema_version=$schema&custom_ct=$($values.custom_ct)&custom_cu=$($values.custom_cu)&custom_cm=$($values.custom_cm)&custom_bd=$($values.custom_bd)"
    if ($Body -cne $canonical -and $Body -cne "$canonical&rx_correction=$($values.rx_correction)&tx_correction=$($values.tx_correction)") {
        throw "动态配置不是规范格式"
    }

    $result = @{
        collect_interval = $collect
        ping_type = $values.ping_mode
        report_interval = $report
        reset_day = $reset
        config_md5 = $ConfigMd5
        ct_node = $values.custom_ct
        cu_node = $values.custom_cu
        cm_node = $values.custom_cm
        bd_node = $values.custom_bd
    }

    if ($values.ContainsKey('rx_correction') -and $values.rx_correction -ne '') {
        $result.rx_correction = $values.rx_correction
    }
    if ($values.ContainsKey('tx_correction') -and $values.tx_correction -ne '') {
        $result.tx_correction = $values.tx_correction
    }

    return $result
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-AsAdmin {
    if ($MyInvocation.MyCommand.Path) {
        $scriptPath = $MyInvocation.MyCommand.Path
    } elseif ($PSCommandPath) {
        $scriptPath = $PSCommandPath
    } else {
        $scriptPath = Join-Path (Get-Location).Path "cf-server-monitor.ps1"
    }
    $argList = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$scriptPath`" $Action -STA"
    if ($Id) { $argList += " -Id `"$Id`"" }
    if ($Secret) { $argList += " -Secret `"$Secret`"" }
    if ($Url) { $argList += " -Url `"$Url`"" }
    if ($ReportInterval -and $ReportInterval -ne "60") { $argList += " -ReportInterval `"$ReportInterval`"" }
    if ($PingType -and $PingType -ne "tcp") { $argList += " -PingType `"$PingType`"" }
    if ($ResetDay -and $ResetDay -ne "1") { $argList += " -ResetDay `"$ResetDay`"" }
    if ($RxCorrection) { $argList += " -RxCorrection `"$RxCorrection`"" }
    if ($TxCorrection) { $argList += " -TxCorrection `"$TxCorrection`"" }
    if ($CtNode) { $argList += " -CtNode `"$CtNode`"" }
    if ($CuNode) { $argList += " -CuNode `"$CuNode`"" }
    if ($CmNode) { $argList += " -CmNode `"$CmNode`"" }
    if ($BdNode) { $argList += " -BdNode `"$BdNode`"" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait
}

# ============================================================
# 指标采集
# ============================================================

function Get-CpuUsage {
    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        return [math]::Round($cpu.LoadPercentage, 2)
    } catch {
        try {
            $counter = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
            $null = $counter.NextValue()
            Start-Sleep -Milliseconds 200
            return [math]::Round($counter.NextValue(), 2)
        } catch {
            return 0
        }
    }
}

function Get-CpuInfo {
    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        return $cpu.Name.Trim()
    } catch {
        return "Unknown CPU"
    }
}

function Get-CpuCores {
    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        return $cpu.NumberOfLogicalProcessors
    } catch {
        return [Environment]::ProcessorCount
    }
}

function Get-MemoryInfo {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $totalMB = [math]::Round($os.TotalVisibleMemorySize / 1024)
        $freeMB = [math]::Round($os.FreePhysicalMemory / 1024)
        $usedMB = $totalMB - $freeMB
        return @{ total = $totalMB; used = $usedMB }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Get-SwapInfo {
    try {
        $cs = Get-CimInstance Win32_ComputerSystem
        $totalMB = [math]::Round($cs.TotalPhysicalMemory / 1024 / 1024)
        $os = Get-CimInstance Win32_OperatingSystem
        $freeVirtual = [math]::Round($os.FreeVirtualMemory / 1024)
        $freePhys = [math]::Round($os.FreePhysicalMemory / 1024)
        $usedMB = $totalMB - $freePhys
        $swapTotal = [math]::Max($freeVirtual - $freePhys, 0)
        return @{ total = $swapTotal; used = [math]::Min($usedMB, $swapTotal) }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Get-DiskInfo {
    try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        $totalMB = [math]::Round($disk.Size / 1024 / 1024)
        $freeMB = [math]::Round($disk.FreeSpace / 1024 / 1024)
        $usedMB = $totalMB - $freeMB
        return @{ total = $totalMB; used = $usedMB }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Get-NetworkStats {
    try {
        $adapters = Get-NetAdapterStatistics -ErrorAction SilentlyContinue
        if ($adapters) {
            $totalRx = 0
            $totalTx = 0
            foreach ($adapter in $adapters) {
                try {
                    $totalRx += [long]$adapter.ReceivedBytes
                    $totalTx += [long]$adapter.SentBytes
                } catch {}
            }
            return @{ rx = $totalRx; tx = $totalTx }
        }
    } catch {}
    Write-Log "网络流量获取失败" "DEBUG"
    return @{ rx = 0; tx = 0 }
}

function Get-TcpUdpConnections {
    $tcp = 0; $udp = 0
    try {
        $conns = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue
        $tcp = ($conns | Measure-Object).Count
    } catch {}
    try {
        $conns = Get-NetUDPEndpoint -ErrorAction SilentlyContinue
        $udp = ($conns | Measure-Object).Count
    } catch {}
    return @{ tcp = $tcp; udp = $udp }
}

function Get-ProcessCount {
    try {
        return (Get-Process | Measure-Object).Count
    } catch {
        return 0
    }
}

function Get-BootTime {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $boot = $os.LastBootUpTime
        return [long]([DateTimeOffset]::new($boot).ToUnixTimeMilliseconds())
    } catch {
        return 0
    }
}

function Get-GpuInfo {
    $gpuUsage = $null
    $gpuName = $null
    try {
        $nvidia = & nvidia-smi --query-gpu=name,utilization.gpu --format=csv,noheader,nounits 2>$null
        if ($nvidia) {
            $parts = ($nvidia | Select-Object -First 1) -split ','
            $gpuName = $parts[0].Trim()
            $gpuUsage = $parts[1].Trim()
        }
    } catch {}
    if (-not $gpuName) {
        try {
            $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
            $gpuName = $gpu.Name
        } catch {}
    }
    return @{ usage = $gpuUsage; name = $gpuName }
}

function Get-LoadAvg {
    param([double]$CpuPercent)
    $v1 = [math]::Min([math]::Max($CpuPercent / 100.0, 0.0), 999.0)
    $v2 = [math]::Max($v1 * 0.8, 0.0)
    $v3 = [math]::Max($v1 * 0.6, 0.0)
    return "{0:N2} {1:N2} {2:N2}" -f $v1, $v2, $v3
}

# ============================================================
# 网络探测
# ============================================================

function Get-HttpPing {
    param([string]$TargetHost)
    if (-not $TargetHost) { return "" }
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $req = [System.Net.HttpWebRequest]::Create("http://$TargetHost")
        $req.Timeout = 1500
        $req.Method = "GET"
        $req.AllowAutoRedirect = $false
        try { $resp = $req.GetResponse(); $resp.Close() } catch {}
        $sw.Stop()
        $ms = [int]$sw.ElapsedMilliseconds
        return if ($ms -gt 0) { $ms.ToString() } else { "1" }
    } catch {
        return ""
    }
}

function Get-TcpPing {
    param([string]$TargetHost, [int]$Port = 443) 
    if (-not $TargetHost) { return "" }
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $tcp = New-Object System.Net.Sockets.TcpClient
        $task = $tcp.ConnectAsync($TargetHost, $Port)
        if ($task.Wait(5000)) {
            $sw.Stop()
            $tcp.Close()
            $ms = [int]$sw.ElapsedMilliseconds
            if ($ms -gt 0) { return $ms.ToString() } else { return "1" }
        } else {
            $tcp.Close()
            return ""
        }
    } catch {
        return ""
    }
}


function Get-Ping {
    param([string]$TargetHost, [string]$PingType = "tcp")
    $TargetHost = $TargetHost.Trim()
    if (-not $TargetHost) { 
        return "" 
    }
    if ($PingType -eq "http") { 
        $result = Get-HttpPing -TargetHost $TargetHost
        return $result
    }
    $result = Get-TcpPing -TargetHost $TargetHost
    return $result
}

function Get-PacketLoss {
    param([string]$TargetHost, [int]$Count = 5) 
    $TargetHost = $TargetHost.Trim()
    if (-not $TargetHost) { return "" }
    try {
        $result = ping -n $Count -w 1000 $TargetHost 2>$null
        $lossLine = $result | Select-String "(?:Lost|丢失)\s*=\s*(\d+)"
        if ($lossLine) {
            $lost = [int]$lossLine.Matches[0].Groups[1].Value
            $pct = [math]::Round(($lost / $Count) * 100)
            return $pct.ToString()
        }
    } catch {
        Write-Log "Get-PacketLoss: $TargetHost 异常: $_" "DEBUG"
    }
    return ""
}

# ============================================================
# 异步 Ping 检测（后台执行，结果写入临时文件）
# ============================================================

function Start-PingBackgroundJob {
    param(
        [string]$CtNode,
        [string]$CuNode,
        [string]$CmNode,
        [string]$BdNode,
        [string]$PingType,
        [string]$TempFile
    )

    $jobScript = {
        param($ct, $cu, $cm, $bd, $pingType, $tempFile)

        function Get-Ping {
            param([string]$TargetHost, [string]$PingType)
            $TargetHost = $TargetHost.Trim()
            if (-not $TargetHost) { return "" }
            try {
                if ($PingType -eq "http") {
                    $request = [System.Net.WebRequest]::Create("http://${TargetHost}/")
                    $request.Timeout = 3000
                    $request.Method = "HEAD"
                    $start = [DateTime]::Now
                    $response = $request.GetResponse()
                    $response.Close()
                    $duration = [math]::Round(([DateTime]::Now - $start).TotalMilliseconds)
                    return $duration.ToString()
                } else {
                    $tcp = New-Object System.Net.Sockets.TCPClient
                    $tcp.SendTimeout = 3000
                    $tcp.ReceiveTimeout = 3000
                    $start = [DateTime]::Now
                    $tcp.Connect($TargetHost, 443)
                    $duration = [math]::Round(([DateTime]::Now - $start).TotalMilliseconds)
                    $tcp.Close()
                    return $duration.ToString()
                }
            } catch {
                return ""
            }
        }

        function Get-PacketLoss {
            param([string]$TargetHost, [string]$PingType, [int]$Count = 4)
            $TargetHost = $TargetHost.Trim()
            if (-not $TargetHost) { return "" }
            $ok = 0
            for ($i = 0; $i -lt $Count; $i++) {
                $r = Get-Ping -TargetHost $TargetHost -PingType $PingType
                if ($r -match '^\d+$') { $ok++ }
            }
            return [math]::Round(($Count - $ok) / $Count * 100).ToString()
        }

        $result = @{
            ct_ping = Get-Ping -TargetHost $ct -PingType $pingType
            cu_ping = Get-Ping -TargetHost $cu -PingType $pingType
            cm_ping = Get-Ping -TargetHost $cm -PingType $pingType
            bd_ping = Get-Ping -TargetHost $bd -PingType $pingType
            ct_loss = Get-PacketLoss -TargetHost $ct -PingType $pingType
            cu_loss = Get-PacketLoss -TargetHost $cu -PingType $pingType
            cm_loss = Get-PacketLoss -TargetHost $cm -PingType $pingType
            bd_loss = Get-PacketLoss -TargetHost $bd -PingType $pingType
            timestamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        }

        $json = $result | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($tempFile, $json, [System.Text.Encoding]::UTF8)
    }

    $jobArgs = @($CtNode, $CuNode, $CmNode, $BdNode, $PingType, $TempFile)
    Start-Job -ScriptBlock $jobScript -ArgumentList $jobArgs -Name "CFProbePingJob" | Out-Null
}

function Read-PingResults {
    param([string]$TempFile)
    if (Test-Path $TempFile) {
        try {
            $json = [System.IO.File]::ReadAllText($TempFile, [System.Text.Encoding]::UTF8)
            $result = $json | ConvertFrom-Json
            return $result
        } catch {}
    }
    return $null
}

function Remove-PingBackgroundJob {
    $job = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
    if ($job) {
        Remove-Job -Name "CFProbePingJob" -Force -ErrorAction SilentlyContinue
    }
}

# ============================================================
# IP 检测
# ============================================================

function Test-PublicIPv4 {
    try {
        $ip = (Invoke-RestMethod -Uri "https://ipv4.icanhazip.com" -TimeoutSec 3 -ErrorAction Stop).Trim()
        if ($ip -match '\.') { return $true }
    } catch {}
    try {
        $ip = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 3 -ErrorAction Stop).Trim()
        if ($ip -match '\.') { return $true }
    } catch {}
    return $false
}

function Test-PublicIPv6 {
    try {
        $ip = (Invoke-RestMethod -Uri "https://ipv6.icanhazip.com" -TimeoutSec 3 -ErrorAction Stop).Trim()
        if ($ip -match ':') { return $true }
    } catch {}
    try {
        $ip = (Invoke-RestMethod -Uri "https://api64.ipify.org" -TimeoutSec 3 -ErrorAction Stop).Trim()
        if ($ip -match ':') { return $true }
    } catch {}
    return $false
}

# ============================================================
# 流量统计
# ============================================================

function Get-TrafficData {
    if (Test-Path $TRAFFIC_FILE) {
        $raw = Get-Content $TRAFFIC_FILE -Raw -Encoding UTF8
        $data = @{}
        $raw -split "`n" | ForEach-Object {
            $line = $_.Trim()
            if ($line -match '^(\w+)=(.+)$') {
                $data[$Matches[1]] = $Matches[2]
            }
        }
        return $data
    }
    return @{}
}

function Save-TrafficData {
    param($Data)
    if (-not (Test-Path $CONFIG_DIR)) { New-Item -ItemType Directory -Path $CONFIG_DIR -Force | Out-Null }
    $lines = @()
    foreach ($key in $Data.Keys) {
        $lines += "$key=$($Data[$key])"
    }
    $lines -join "`n" | Set-Content $TRAFFIC_FILE -Encoding UTF8
}

function Apply-TrafficCorrection {
    param([string]$RxCorrection, [string]$TxCorrection)
    if ([string]::IsNullOrEmpty($RxCorrection)) { $RxCorrection = "0" }
    if ([string]::IsNullOrEmpty($TxCorrection)) { $TxCorrection = "0" }
    if (-not (Test-CorrectionValue $RxCorrection) -or -not (Test-CorrectionValue $TxCorrection)) { return $false }

    $rxBytes = 0; $txBytes = 0
    $rxBytes = [long]([double]$RxCorrection * 1GB)
    $txBytes = [long]([double]$TxCorrection * 1GB)

    $saved = @{
        RX_PREV = "0"; TX_PREV = "0"
        RX_PERIOD = "0"; TX_PERIOD = "0"
        LAST_CHECK = "0"; PERIOD_START = "0"
    }
    if (Test-Path $TRAFFIC_FILE) {
        Get-Content $TRAFFIC_FILE | ForEach-Object {
            $parts = $_.Split('=', 2)
            if ($parts.Count -eq 2) { $saved[$parts[0].Trim()] = $parts[1].Trim() }
        }
    }

    $saved.RX_PERIOD = $rxBytes.ToString()
    $saved.TX_PERIOD = $txBytes.ToString()
    Write-Log "流量校正已应用: RX=${RxCorrection}GB (${rxBytes} bytes) TX=${TxCorrection}GB (${txBytes} bytes)" "INFO"

    $nowTs = [long]([DateTimeOffset]::Now.ToUnixTimeSeconds())
    $saved.LAST_CHECK = $nowTs.ToString()
    Save-TrafficData -Data $saved
    return $true
}

function Normalize-CorrectionValue {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return "0" }
    return $Value
}

function Test-CorrectionValue {
    param([string]$Value)
    $normalized = Normalize-CorrectionValue $Value
    if ($normalized -notmatch '^[0-9]+(\.[0-9]+)?$') { return $false }
    $number = [double]$normalized
    return $number -ge 0 -and $number -le $MAX_TRAFFIC_CORRECTION_GB
}

function Send-CorrectionConfirm {
    param([string]$ServerId, [string]$Secret, [string]$WorkerUrl, [string]$RxCorrection, [string]$TxCorrection)
    $rxValue = Normalize-CorrectionValue $RxCorrection
    $txValue = Normalize-CorrectionValue $TxCorrection
    if (-not (Test-CorrectionValue $rxValue) -or -not (Test-CorrectionValue $txValue)) { return $false }
    $payload = @{
        id = $ServerId
        secret = $Secret
        rx_correction = [double]$rxValue
        tx_correction = [double]$txValue
    } | ConvertTo-Json -Compress

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $WorkerUrl -Method Post -Body $payload `
            -ContentType "application/json; charset=utf-8" -TimeoutSec 4 -ErrorAction Stop
        if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) {
            Write-Log "流量校正确认已发送: RX=${rxValue}GB TX=${txValue}GB" "INFO"
            return $true
        }
    } catch {
        Write-Log "流量校正确认发送失败: $_" "DEBUG"
    }
    return $false
}

function Invoke-TrafficCorrection {
    param([string]$ServerId, [string]$Secret, [string]$WorkerUrl, [string]$RxCorrection, [string]$TxCorrection)
    $rxValue = Normalize-CorrectionValue $RxCorrection
    $txValue = Normalize-CorrectionValue $TxCorrection

    if (Apply-TrafficCorrection -RxCorrection $rxValue -TxCorrection $txValue) {
        [void](Send-CorrectionConfirm -ServerId $ServerId -Secret $Secret -WorkerUrl $WorkerUrl -RxCorrection $rxValue -TxCorrection $txValue)
    }
}

function Get-PeriodStartTimestamp {
    param([int]$ResetDay, [long]$NowTs)
    if ($ResetDay -eq 0) { return 0 }
    $dt = [DateTimeOffset]::FromUnixTimeSeconds($NowTs).UtcDateTime
    $year = $dt.Year; $month = $dt.Month; $day = $dt.Day
    $targetDay = $ResetDay
    $daysInMonth = [DateTime]::DaysInMonth($year, $month)
    if ($targetDay -gt $daysInMonth) { $targetDay = $daysInMonth }
    if ($day -ge $targetDay) {
        $start = [DateTime]::SpecifyKind([DateTime]::new($year, $month, $targetDay), [DateTimeKind]::Utc)
    } else {
        $prevMonth = $month - 1
        if ($prevMonth -eq 0) { $prevMonth = 12; $year-- }
        $daysInPrev = [DateTime]::DaysInMonth($year, $prevMonth)
        $td = [math]::Min($ResetDay, $daysInPrev)
        $start = [DateTime]::SpecifyKind([DateTime]::new($year, $prevMonth, $td), [DateTimeKind]::Utc)
    }
    return [long]([DateTimeOffset]::new($start).ToUnixTimeSeconds())
}

function Convert-ToLongOrDefault {
    param($Value, [long]$Default = 0)
    if ($null -eq $Value -or $Value -eq "") { return $Default }
    try { return [long]$Value } catch { return $Default }
}

function Update-MonthlyTraffic {
    param([long]$CurrentRx, [long]$CurrentTx, [int]$ResetDay)
    $nowTs = [long]([DateTimeOffset]::Now.ToUnixTimeSeconds())
    $saved = Get-TrafficData
    $savedRxPrev = Convert-ToLongOrDefault $saved["RX_PREV"]
    $savedTxPrev = Convert-ToLongOrDefault $saved["TX_PREV"]
    $savedRxPeriod = Convert-ToLongOrDefault $saved["RX_PERIOD"]
    $savedTxPeriod = Convert-ToLongOrDefault $saved["TX_PERIOD"]
    $savedLastCheck = Convert-ToLongOrDefault $saved["LAST_CHECK"]
    $savedPeriodStart = Convert-ToLongOrDefault $saved["PERIOD_START"]

    $periodStart = Get-PeriodStartTimestamp -ResetDay $ResetDay -NowTs $nowTs
    $rxDelta = 0; $txDelta = 0

    if ($savedLastCheck -ne 0) {
        if ($CurrentRx -lt $savedRxPrev -or $CurrentTx -lt $savedTxPrev) {
            $rxDelta = 0; $txDelta = 0
        } else {
            $rxDelta = $CurrentRx - $savedRxPrev
            $txDelta = $CurrentTx - $savedTxPrev
        }
        if ($periodStart -ne 0 -and $periodStart -ne $savedPeriodStart -and $savedPeriodStart -ne 0) {
            $savedRxPeriod = $rxDelta
            $savedTxPeriod = $txDelta
        } else {
            $savedRxPeriod += $rxDelta
            $savedTxPeriod += $txDelta
        }
    }

    $newData = @{
        RX_PREV = $CurrentRx.ToString()
        TX_PREV = $CurrentTx.ToString()
        RX_PERIOD = $savedRxPeriod.ToString()
        TX_PERIOD = $savedTxPeriod.ToString()
        LAST_CHECK = $nowTs.ToString()
        PERIOD_START = $periodStart.ToString()
    }
    Save-TrafficData -Data $newData
    return @{ rx = $savedRxPeriod; tx = $savedTxPeriod }
}

# ============================================================
# 主采集循环
# ============================================================

function Invoke-TrayCollectLoop {
    [void][System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
    [void][System.Reflection.Assembly]::LoadWithPartialName("System.Drawing")
    
    $trayIcon = New-Object System.Windows.Forms.NotifyIcon
    $trayIcon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Get-Command powershell).Source)
    $trayIcon.Visible = $true
    $trayIcon.Text = "CF-Server-Monitor"
    
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $statusItem.Text = "查看状态"
    $statusItem.Add_Click({
        $config = Load-Config
        $effectiveStatusReportInterval = [math]::Max([int]$config.report_interval, 60)
        $msg = "CF-Server-Monitor 状态`n"
        $msg += "Server ID: $($config.server_id)`n"
        $msg += "Worker URL: $($config.worker_url)`n"
        $msg += "上报间隔: $($config.report_interval)秒`n"
        $msg += "实际上报间隔: $effectiveStatusReportInterval秒`n"
        $msg += "日志文件: $LOG_FILE"
        [System.Windows.Forms.MessageBox]::Show($msg, "CF-Server-Monitor", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    })
    
    $stopItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $stopItem.Text = "停止探针"
    $stopItem.Add_Click({
        Write-Log "用户从托盘菜单停止探针" "INFO"
        $trayIcon.Visible = $false
        $trayIcon.Dispose()
        [System.Windows.Forms.Application]::Exit()
        exit 0
    })
    
    $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
    $exitItem.Text = "退出"
    $exitItem.Add_Click({
        Write-Log "用户从托盘菜单退出" "INFO"
        $trayIcon.Visible = $false
        $trayIcon.Dispose()
        [System.Windows.Forms.Application]::Exit()
        exit 0
    })
    
    $menu.Items.Add($statusItem)
    $menu.Items.Add($stopItem)
    $menu.Items.Add($exitItem)
    $trayIcon.ContextMenuStrip = $menu
    
    Write-Log "探针已启动（托盘模式）" "INFO"
    
    # 使用 Timer + Application.Run 启动消息泵，托盘菜单才能响应
    Start-TimerCollectLoop -TrayIcon $trayIcon
}

function Start-TimerCollectLoop {
    param($TrayIcon = $null)

    # ========================================
    # 加载配置（与原 Invoke-CollectLoop 相同）
    # ========================================
    $config = Load-Config
    if (-not $config) {
        Write-Log "配置文件不存在，使用命令行参数..." "WARN"
        if (-not $Id -or -not $Secret -or -not $Url) {
            Write-Log "错误: 缺少必要参数" "ERROR"
            Write-Host "请使用: .\cf-server-monitor.ps1 run -Id 'ID' -Secret '密钥' -Url '地址'" -ForegroundColor Yellow
            return
        }
        $config = @{
            server_id = $Id
            secret = $Secret
            worker_url = $Url
            collect_interval = [int]$CollectInterval
            report_interval = [int]$ReportInterval
            ping_type = $PingType
            reset_day = [int]$ResetDay
            config_md5 = "none"
            ct_node = if ($CtNode) { $CtNode } else { $DEFAULT_CT }
            cu_node = if ($CuNode) { $CuNode } else { $DEFAULT_CU }
            cm_node = if ($CmNode) { $CmNode } else { $DEFAULT_CM }
            bd_node = if ($BdNode) { $BdNode } else { $DEFAULT_BD }
        }
        Save-Config -Config $config
        Write-Log "已保存配置到: $CONFIG_FILE" "INFO"
    }

    $serverId = if ($Id) { $Id } else { $config.server_id }
    $secret = if ($Secret) { $Secret } else { $config.secret }
    $workerUrl = if ($Url) { $Url.Trim().Trim("'").Trim('"') } else { $config.worker_url.Trim().Trim("'").Trim('"') }

    if ($config.report_interval) {
        $reportInterval = [int]$config.report_interval
    } else {
        $reportInterval = 60
    }

    if ($config.ping_type) {
        $pingType = $config.ping_type
    } else {
        $pingType = "tcp"
    }

    if ($null -ne $config.reset_day) {
        $resetDay = [int]$config.reset_day
    } else {
        $resetDay = 1
    }
    $configMd5 = if ($config.config_md5) { $config.config_md5.ToString().Trim().ToLowerInvariant() } else { "none" }
    $ctNode = if ($CtNode) { $CtNode } elseif ($config.ct_node) { $config.ct_node } else { $DEFAULT_CT }
    $cuNode = if ($CuNode) { $CuNode } elseif ($config.cu_node) { $config.cu_node } else { $DEFAULT_CU }
    $cmNode = if ($CmNode) { $CmNode } elseif ($config.cm_node) { $config.cm_node } else { $DEFAULT_CM }
    $bdNode = if ($BdNode) { $BdNode } elseif ($config.bd_node) { $config.bd_node } else { $DEFAULT_BD }
    $ctNode = $ctNode.Trim()
    $cuNode = $cuNode.Trim()
    $cmNode = $cmNode.Trim()
    $bdNode = $bdNode.Trim()

    if ($workerUrl -notmatch '^https?://') {
        Write-Log "警告: worker_url 格式可能不正确: '$workerUrl'" "WARN"
        $workerUrl = $workerUrl.Trim().Trim("'").Trim('"')
        Write-Log "清理后的 URL: '$workerUrl'" "WARN"
    }
    if ($workerUrl -notmatch '^https?://') {
        Write-Log "错误: worker_url 无效: '$workerUrl'" "ERROR"
        Write-Log "请检查配置文件: $CONFIG_FILE" "ERROR"
        return
    }
    if (-not $serverId -or -not $secret -or -not $workerUrl) {
        Write-Log "配置不完整，请填写 server_id, secret, worker_url" "ERROR"
        return
    }
    if (@(30, 60, 120, 180) -notcontains $reportInterval) { $reportInterval = 60 }
    if (@('http', 'tcp') -notcontains $pingType) { $pingType = 'tcp' }
    if ($resetDay -lt 0 -or $resetDay -gt 31) { $resetDay = 1 }
    $effectiveReportInterval = [math]::Max($reportInterval, 60)

    # ========================================
    # 持久状态变量（脚本作用域，跨 Timer Tick 保持）
    # ========================================
    $script:cs_prevNet = @{ rx = 0; tx = 0; time = 0 }
    $script:cs_lastIpCheck = 0
    $script:cs_lastPingCheck = 0
    $script:cs_ipV4 = "0"
    $script:cs_ipV6 = "0"
    $script:cs_pingCt = ""
    $script:cs_pingCu = ""
    $script:cs_pingCm = ""
    $script:cs_pingBd = ""
    $script:cs_lossCt = ""
    $script:cs_lossCu = ""
    $script:cs_lossCm = ""
    $script:cs_lossBd = ""
    $script:cs_lastReportTime = 0
    $script:cs_reportInterval = $effectiveReportInterval
    $script:cs_pingType = $pingType
    $script:cs_resetDay = $resetDay
    $script:cs_configMd5 = $configMd5

    $pingTempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "cf_probe_ping_results.json")

    # 首次 CPU 采样
    try {
        $counter = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
        $null = $counter.NextValue()
        Start-Sleep -Milliseconds 300
    } catch {}

    Write-Log "探针已启动。 ServerID=$serverId Url='$workerUrl' ReportInterval=${reportInterval}s EffectiveReportInterval=${effectiveReportInterval}s CollectInterval=ignored"

    # ========================================
    # Timer 驱动采集：每次 Tick 执行一轮采集+上报
    # ========================================
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = $effectiveReportInterval * 1000
    $timer.Add_Tick({
        try {
            # 捕获外部参数到局部变量，避免作用域问题
            $srvId = $serverId
            $sec = $secret
            $wUrl = $workerUrl
            $ctN = if ($config.ct_node) { $config.ct_node } else { $ctNode }
            $cuN = if ($config.cu_node) { $config.cu_node } else { $cuNode }
            $cmN = if ($config.cm_node) { $config.cm_node } else { $cmNode }
            $bdN = if ($config.bd_node) { $config.bd_node } else { $bdNode }
            $pType = $script:cs_pingType
            $rDay = $script:cs_resetDay
            $rInterval = $script:cs_reportInterval
            $pFile = $pingTempFile

            $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()

            # IP 检测（每 10 分钟）
            if ($now - $script:cs_lastIpCheck -ge 600 -or $script:cs_lastIpCheck -eq 0) {
                $script:cs_ipV4 = if (Test-PublicIPv4) { "1" } else { "0" }
                $script:cs_ipV6 = if (Test-PublicIPv6) { "1" } else { "0" }
                $script:cs_lastIpCheck = $now
            }

            # Ping 检测（每 30 秒，异步执行）
            if ($now - $script:cs_lastPingCheck -ge 30 -or $script:cs_lastPingCheck -eq 0) {
                $script:cs_lastPingCheck = $now
                $existingJob = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
                if (-not $existingJob -or $existingJob.State -in @("Completed", "Failed", "Stopped")) {
                    Remove-PingBackgroundJob
                    Start-PingBackgroundJob -CtNode $ctN -CuNode $cuN -CmNode $cmN -BdNode $bdN -PingType $pType -TempFile $pFile
                }
            }

            # 读取异步 Ping 检测结果
            $pingResults = Read-PingResults -TempFile $pFile
            if ($pingResults) {
                $script:cs_pingCt = if ($pingResults.ct_ping) { $pingResults.ct_ping } else { $script:cs_pingCt }
                $script:cs_pingCu = if ($pingResults.cu_ping) { $pingResults.cu_ping } else { $script:cs_pingCu }
                $script:cs_pingCm = if ($pingResults.cm_ping) { $pingResults.cm_ping } else { $script:cs_pingCm }
                $script:cs_pingBd = if ($pingResults.bd_ping) { $pingResults.bd_ping } else { $script:cs_pingBd }
                $script:cs_lossCt = if ($pingResults.ct_loss) { $pingResults.ct_loss } else { $script:cs_lossCt }
                $script:cs_lossCu = if ($pingResults.cu_loss) { $pingResults.cu_loss } else { $script:cs_lossCu }
                $script:cs_lossCm = if ($pingResults.cm_loss) { $pingResults.cm_loss } else { $script:cs_lossCm }
                $script:cs_lossBd = if ($pingResults.bd_loss) { $pingResults.bd_loss } else { $script:cs_lossBd }
            }

            # 采集各项指标
            $cpuPercent = Get-CpuUsage
            $cpuInfo = Get-CpuInfo
            $cpuCores = Get-CpuCores
            $mem = Get-MemoryInfo
            $swap = Get-SwapInfo
            $disk = Get-DiskInfo

            $netStat = Get-NetworkStats
            $rxNow = [long]$netStat.rx
            $txNow = [long]$netStat.tx
            $netTraffic = Update-MonthlyTraffic -CurrentRx $rxNow -CurrentTx $txNow -ResetDay $rDay

            $rxPrev = if ($script:cs_prevNet.time -gt 0) { $script:cs_prevNet.rx } else { $rxNow }
            $txPrev = if ($script:cs_prevNet.time -gt 0) { $script:cs_prevNet.tx } else { $txNow }
            $deltaTime = if ($script:cs_prevNet.time -gt 0) { [math]::Max($now - $script:cs_prevNet.time, 1) } else { 1 }
            $rxSpeed = [math]::Max(($rxNow - $rxPrev) / $deltaTime, 0)
            $txSpeed = [math]::Max(($txNow - $txPrev) / $deltaTime, 0)
            $script:cs_prevNet = @{ rx = $rxNow; tx = $txNow; time = $now }

            $conn = Get-TcpUdpConnections
            $processCount = Get-ProcessCount
            $gpu = Get-GpuInfo
            $bootTime = Get-BootTime
            $loadAvg = Get-LoadAvg -CpuPercent $cpuPercent
            $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "x86" }
            $osName = (Get-CimInstance Win32_OperatingSystem).Caption

            # 构建指标
            $metrics = @{
                cpu = $cpuPercent.ToString("F2")
                ram_total = $mem.total.ToString()
                ram_used = $mem.used.ToString()
                swap_total = $swap.total.ToString()
                swap_used = $swap.used.ToString()
                disk_total = $disk.total.ToString()
                disk_used = $disk.used.ToString()
                load_avg = $loadAvg
                boot_time = $bootTime.ToString()
                net_rx = $rxNow.ToString()
                net_tx = $txNow.ToString()
                net_rx_monthly = $netTraffic.rx.ToString()
                net_tx_monthly = $netTraffic.tx.ToString()
                net_in_speed = [math]::Floor($rxSpeed).ToString()
                net_out_speed = [math]::Floor($txSpeed).ToString()
                os = $osName
                arch = $arch
                cpu_info = $cpuInfo
                cpu_cores = $cpuCores.ToString()
                gpu = if ($gpu.usage) { [double]$gpu.usage } else { $null }
                gpu_info = $gpu.name
                processes = $processCount.ToString()
                tcp_conn = $conn.tcp.ToString()
                udp_conn = $conn.udp.ToString()
                ip_v4 = $script:cs_ipV4
                ip_v6 = $script:cs_ipV6
                ping_ct = $script:cs_pingCt
                ping_cu = $script:cs_pingCu
                ping_cm = $script:cs_pingCm
                ping_bd = $script:cs_pingBd
                loss_ct = $script:cs_lossCt
                loss_cu = $script:cs_lossCu
                loss_cm = $script:cs_lossCm
                loss_bd = $script:cs_lossBd
            }

            # 上报
            $shouldReport = ($script:cs_lastReportTime -eq 0) -or ($now - $script:cs_lastReportTime -ge $rInterval)
            if ($shouldReport) {
                $payload = @{
                    id = $srvId
                    secret = $sec
                    metrics = $metrics
                    collect_interval = 0
                    report_interval = $rInterval
                }
                $json = $payload | ConvertTo-Json -Depth 10 -Compress
                try {
                    $requestHeaders = @{
                        'X-Agent-Config-Schema' = '1'
                        'X-Agent-Config-Md5' = if ($script:cs_configMd5) { $script:cs_configMd5 } else { 'none' }
                    }
                    $response = Invoke-WebRequest -UseBasicParsing -Uri $wUrl -Method Post -Body $json `
                        -ContentType "application/json; charset=utf-8" -Headers $requestHeaders -TimeoutSec 8 -ErrorAction Stop
                    if ([int]$response.StatusCode -eq 200 -and $response.Headers['X-Agent-Config-Md5']) {
                        $remoteConfig = ConvertFrom-AgentConfigResponse `
                            -Body ([string]$response.Content) `
                            -ConfigMd5 ([string]$response.Headers['X-Agent-Config-Md5'])
                        foreach ($entry in $remoteConfig.GetEnumerator()) {
                            if ($config -is [hashtable]) {
                                $config[$entry.Key] = $entry.Value
                            } else {
                                $config | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
                            }
                        }
                        if (Save-Config -Config $config) {
                            $effectiveRemoteReportInterval = [math]::Max($remoteConfig.report_interval, 60)
                            $script:cs_reportInterval = $effectiveRemoteReportInterval
                            $script:cs_pingType = $remoteConfig.ping_type
                            $script:cs_resetDay = $remoteConfig.reset_day
                            $script:cs_configMd5 = $remoteConfig.config_md5
                            if ($remoteConfig.ContainsKey('ct_node')) { $script:cs_ctNode = $remoteConfig.ct_node }
                            if ($remoteConfig.ContainsKey('cu_node')) { $script:cs_cuNode = $remoteConfig.cu_node }
                            if ($remoteConfig.ContainsKey('cm_node')) { $script:cs_cmNode = $remoteConfig.cm_node }
                            if ($remoteConfig.ContainsKey('bd_node')) { $script:cs_bdNode = $remoteConfig.bd_node }
                            $timer.Interval = $effectiveRemoteReportInterval * 1000
                            Write-Log "动态配置已应用: md5=$($remoteConfig.config_md5) report_interval=$($remoteConfig.report_interval)s ct=$($remoteConfig.ct_node) cu=$($remoteConfig.cu_node) cm=$($remoteConfig.cm_node) bd=$($remoteConfig.bd_node)" "INFO"

                            if ($remoteConfig.ContainsKey('rx_correction') -or $remoteConfig.ContainsKey('tx_correction')) {
                                $rxCorr = if ($remoteConfig.ContainsKey('rx_correction')) { $remoteConfig.rx_correction } else { "" }
                                $txCorr = if ($remoteConfig.ContainsKey('tx_correction')) { $remoteConfig.tx_correction } else { "" }
                                Invoke-TrafficCorrection -ServerId $srvId -Secret $sec -WorkerUrl $wUrl -RxCorrection $rxCorr -TxCorrection $txCorr
                            }
                        }
                    }
                } catch {
                    Write-Log "上报失败: $_" "WARN"
                }
                $script:cs_lastReportTime = $now
            }
        } catch {
            Write-Log "采集异常: $_" "ERROR"
        }
    })

    $timer.Start()

    # 启动 WinForms 消息泵 — 这是托盘菜单能响应的关键
    [System.Windows.Forms.Application]::Run()
}

# ============================================================
# 服务管理
# ============================================================

function Install-Service {
    # 添加调试输出
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "开始安装 CF-Server-Monitor" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "调试信息:" -ForegroundColor Cyan
    Write-Host "  Id: '$Id'" -ForegroundColor Cyan
    Write-Host "  Secret: '********'" -ForegroundColor Cyan
    Write-Host "  Url: '$Url'" -ForegroundColor Cyan
    Write-Host "  脚本目录: $SCRIPT_DIR" -ForegroundColor Cyan
    Write-Host "  配置文件: $CONFIG_FILE" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""
    
    if (-not (Test-Admin)) {
        Write-Host "需要管理员权限，正在提升..." -ForegroundColor Yellow
        Invoke-AsAdmin
        return
    }

    # 写入配置
    $existingConfig = Load-Config
    # 清理输入参数
    $cleanId = if ($Id) { $Id.Trim().Trim("'").Trim('"') } else { "" }
    $cleanSecret = if ($Secret) { $Secret.Trim().Trim("'").Trim('"') } else { "" }
    $cleanUrl = if ($Url) { $Url.Trim().Trim("'").Trim('"') } else { "" }

    $config = @{
        server_id = if ($cleanId) { $cleanId } elseif ($existingConfig) { $existingConfig.server_id } else { "" }
        secret = if ($cleanSecret) { $cleanSecret } elseif ($existingConfig) { $existingConfig.secret } else { "" }
        worker_url = if ($cleanUrl) { $cleanUrl } elseif ($existingConfig) { $existingConfig.worker_url } else { "" }
        collect_interval = [int]$CollectInterval
        report_interval = [int]$ReportInterval
        ping_type = $PingType
        reset_day = [int]$ResetDay
        config_md5 = "none"
        ct_node = if ($CtNode) { $CtNode } elseif ($existingConfig -and $existingConfig.ct_node) { $existingConfig.ct_node } else { $DEFAULT_CT }
        cu_node = if ($CuNode) { $CuNode } elseif ($existingConfig -and $existingConfig.cu_node) { $existingConfig.cu_node } else { $DEFAULT_CU }
        cm_node = if ($CmNode) { $CmNode } elseif ($existingConfig -and $existingConfig.cm_node) { $existingConfig.cm_node } else { $DEFAULT_CM }
        bd_node = if ($BdNode) { $BdNode } elseif ($existingConfig -and $existingConfig.bd_node) { $existingConfig.bd_node } else { $DEFAULT_BD }
    }

    if (-not $config.server_id -or -not $config.secret -or -not $config.worker_url) {
        Write-Host "错误: 缺少必要参数 -Id, -Secret, -Url" -ForegroundColor Red
        Write-Host "当前值:" -ForegroundColor Yellow
        Write-Host "  server_id: '$($config.server_id)'" -ForegroundColor Yellow
        Write-Host "  secret: '$($config.secret)'" -ForegroundColor Yellow
        Write-Host "  worker_url: '$($config.worker_url)'" -ForegroundColor Yellow
        return
    }

    Write-Host "正在保存配置..." -ForegroundColor Cyan
    Write-Host "配置文件路径: $CONFIG_FILE" -ForegroundColor Cyan
    $saveResult = Save-Config -Config $config
    if ($saveResult) {
        Write-Host "配置保存成功" -ForegroundColor Green
        # 验证文件是否存在
        if (Test-Path $CONFIG_FILE) {
            Write-Host "配置文件已创建: $CONFIG_FILE" -ForegroundColor Green
        } else {
            Write-Host "警告: 配置文件保存后未找到！" -ForegroundColor Yellow
        }
    } else {
        Write-Host "配置保存失败！" -ForegroundColor Red
        Write-Host "请检查是否有写入权限: $CONFIG_DIR" -ForegroundColor Yellow
        Read-Host "按 Enter 退出"
        return
    }

    # 流量校正
    $hasRxCorr = $RxCorrection -ne ""
    $hasTxCorr = $TxCorrection -ne ""
    if ($hasRxCorr -or $hasTxCorr) {
        Write-Host "应用流量校正..." -ForegroundColor Cyan
        $netStat = Get-NetworkStats
        $currentRx = [long]$netStat.rx
        $currentTx = [long]$netStat.tx
        $nowTs = [long]([DateTimeOffset]::Now.ToUnixTimeSeconds())
        $rxBytes = if ($hasRxCorr) { [long]([double]$RxCorrection * 1GB) } else { 0 }
        $txBytes = if ($hasTxCorr) { [long]([double]$TxCorrection * 1GB) } else { 0 }
        $trafficData = @{
            RX_PREV = $currentRx.ToString()
            TX_PREV = $currentTx.ToString()
            RX_PERIOD = $rxBytes.ToString()
            TX_PERIOD = $txBytes.ToString()
            LAST_CHECK = $nowTs.ToString()
            PERIOD_START = "0"
        }
        Save-TrafficData -Data $trafficData
        if ($hasRxCorr) { Write-Host "  下行校正: ${RxCorrection}GB" -ForegroundColor Cyan }
        if ($hasTxCorr) { Write-Host "  上行校正: ${TxCorrection}GB" -ForegroundColor Cyan }
    }

    # 创建计划任务
    if ($MyInvocation.MyCommand.Path) {
        $scriptPath = $MyInvocation.MyCommand.Path
    } elseif ($PSCommandPath) {
        $scriptPath = $PSCommandPath
    } else {
        $scriptPath = Join-Path (Get-Location).Path "cf-server-monitor.ps1"
    }
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$scriptPath`" run -STA"
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    $existingTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    }

    Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null

    $effectiveInstallReportInterval = [math]::Max([int]$config.report_interval, 60)

    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "       CF-Server-Monitor 安装成功" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  Server ID  : $($config.server_id)"
    Write-Host "  Worker URL : $($config.worker_url)"
    Write-Host "  上报间隔   : $($config.report_interval)秒"
    Write-Host "  实际间隔   : $effectiveInstallReportInterval秒"
    Write-Host "  采样间隔   : Windows PowerShell 版不启用 samples 缓存"
    Write-Host "  探测类型   : $($config.ping_type)"
    Write-Host "  流量重置日 : $($config.reset_day)号"
    Write-Host "  配置文件   : $CONFIG_FILE"
    Write-Host "  日志文件   : $LOG_FILE"
    Write-Host "  自动启动   : 已注册计划任务 $TASK_NAME"
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""


    # 先停止已有的探针进程
    Write-Host "检查并停止已有的探针进程..." -ForegroundColor Cyan
    $existing = @()
    try {
        $processes = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($proc in $processes) {
            if ($proc.CommandLine -like "*cf-server-monitor*run*" -or $proc.CommandLine -like "*$scriptPath*run*") {
                $existing += Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
            }
        }
    } catch {
        $existing = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*cf-server-monitor*run*" -or $_.CommandLine -like "*$scriptPath*run*"
        }
    }
    if ($existing) {
        Write-Host "发现已有探针进程 (PID: $($existing.Id -join ', '))，正在停止..." -ForegroundColor Yellow
        $existing | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    # 启动探针，传递必要的参数
    Write-Host "正在启动探针..." -ForegroundColor Yellow
    $runArgs = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$scriptPath`" run -STA"
    Write-Host "启动命令: powershell.exe $runArgs" -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList $runArgs -WindowStyle Hidden
    Start-Sleep -Seconds 2  # 等待进程启动

    # 检查是否启动成功
    $running = $false
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($p in $procs) {
            if ($p.CommandLine -like "*cf-server-monitor*run*") {
                $running = $true
                break
            }
        }
    } catch {}
    if ($running) {
        Write-Host "探针已启动" -ForegroundColor Green
    } else {
        Write-Host "警告: 探针可能未启动，请检查日志: $LOG_FILE" -ForegroundColor Yellow
    }

    Write-Host "查看日志: $LOG_FILE" -ForegroundColor Green
    Write-Host "按 Enter 查看实时日志，或关闭窗口退出..." -ForegroundColor Yellow
    Read-Host
    # 显示实时日志
    if (Test-Path $LOG_FILE) {
        Get-Content -Path $LOG_FILE -Wait
    } else {
        Write-Host "日志文件尚未生成，请稍后检查" -ForegroundColor Yellow
    }
}

function Uninstall-Service {
    if (-not (Test-Admin)) {
        Write-Host "需要管理员权限，正在提升..." -ForegroundColor Yellow
        Invoke-AsAdmin
        return
    }

    # 删除计划任务
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Host "已删除计划任务: $TASK_NAME" -ForegroundColor Green
    }

    # 终止进程
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($p in $procs) {
            if ($p.CommandLine -like "*cf-server-monitor*run*") {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}

    # 清理文件
    if (Test-Path $CONFIG_FILE) { Remove-Item $CONFIG_FILE -Force }
    if (Test-Path $TRAFFIC_FILE) { Remove-Item $TRAFFIC_FILE -Force }
    if (Test-Path $LOG_FILE) { Remove-Item $LOG_FILE -Force }
    for ($i = 1; $i -le $LOG_BACKUP_COUNT; $i++) {
        $backup = Join-Path $CONFIG_DIR "cf_probe.log.$i"
        if (Test-Path $backup) { Remove-Item $backup -Force }
    }

    Write-Host "卸载完成。" -ForegroundColor Green
}

function Get-ServiceStatus {
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "计划任务: $($task.State)" -ForegroundColor Green
    } else {
        Write-Host "计划任务: 未注册" -ForegroundColor Yellow
    }
    $running = @()
    try {
        $processes = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($proc in $processes) {
            if ($proc.CommandLine -like "*cf-server-monitor*run*") {
                $running += Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
            }
        }
    } catch {
        $running = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*cf-server-monitor*run*"
        }
    }
    if ($running) {
        Write-Host "探针进程: 运行中 (PID: $($running.Id -join ', '))" -ForegroundColor Green
    } else {
        Write-Host "探针进程: 未运行" -ForegroundColor Yellow
    }
    $config = Load-Config
    if ($config) {
        $effectiveStatusReportInterval = [math]::Max([int]$config.report_interval, 60)
        Write-Host "配置文件: $CONFIG_FILE" -ForegroundColor Cyan
        Write-Host "  Server ID  : $($config.server_id)"
        Write-Host "  Worker URL : $($config.worker_url)"
        Write-Host "  上报间隔   : $($config.report_interval)秒"
        Write-Host "  实际间隔   : $effectiveStatusReportInterval秒"
    }
}

function Stop-Service {
    $running = @()
    try {
        $processes = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($proc in $processes) {
            if ($proc.CommandLine -like "*cf-server-monitor*run*") {
                $running += Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
            }
        }
    } catch {
        $running = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*cf-server-monitor*run*"
        }
    }
    if ($running) {
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "探针已停止 (PID: $($running.Id -join ', '))。" -ForegroundColor Green
    } else {
        Write-Host "探针未运行。" -ForegroundColor Yellow
    }
}

# ============================================================
# 入口
# ============================================================

# 入口点 - 添加全局错误捕获
try {
    switch ($Action) {
        "install"   { Install-Service }
        "uninstall" { Uninstall-Service }
        "run"       { Invoke-TrayCollectLoop }
        "tray"      { Invoke-TrayCollectLoop }
        "status"    { Get-ServiceStatus }
        "stop"      { Stop-Service }
    }
} catch {
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host "错误: $_" -ForegroundColor Red
    Write-Host "错误详情: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "错误行: $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor Red
    Write-Host "=============================================" -ForegroundColor Red
    Read-Host "按 Enter 退出"
}
