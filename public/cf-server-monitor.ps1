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
    兼容旧版 Worker 上报地址
.PARAMETER BaseUrl
    探针 BaseURL，用于脚本下载、/update 上报和自动更新
.PARAMETER ProxyUrl
    仅用于访问 BaseURL 的 HTTP(S) 代理 URL，可包含 URL 编码的用户名密码
.PARAMETER CollectInterval
    兼容参数。Windows PowerShell 版不使用 samples 采样缓存，始终按上报间隔采集并上报。
.PARAMETER ReportInterval
    上报间隔（秒），默认 60
.PARAMETER ResetDay
    流量重置日（1-31, 0=不重置），默认 1
.PARAMETER AutoUpdate
    自动更新探针（0/1），默认 0
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
    .\cf-server-monitor.ps1 install -Id "xxx" -Secret "yyy" -BaseUrl "https://worker.example.com"
.EXAMPLE
    .\cf-server-monitor.ps1 install -Id "xxx" -Secret "yyy" -BaseUrl "https://worker.example.com/prefix" -ProxyUrl "http://user:pass@proxy.example.com:8080"
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
    [string]$BaseUrl = "",
    [string]$ProxyUrl = "",
    [string]$CollectInterval = "0",
    [string]$ReportInterval = "60",
    [string]$ResetDay = "1",
    [string]$AutoUpdate = "",
    [string]$RxCorrection = "",
    [string]$TxCorrection = "",
    [string]$CtNode = "",
    [string]$CuNode = "",
    [string]$CmNode = "",
    [string]$BdNode = "",
    
    [switch]$STA
)

$BASE_URL_WAS_BOUND = $PSBoundParameters.ContainsKey('BaseUrl')
$PROXY_URL_WAS_BOUND = $PSBoundParameters.ContainsKey('ProxyUrl')

function ConvertTo-NativeArgument {
    param([string]$Value)
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in ([string]$Value).ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

if (-not $STA -and $host.Runspace.ApartmentState -ne 'STA') {
    if ($MyInvocation.MyCommand.Path) {
        $scriptPath = $MyInvocation.MyCommand.Path
    } elseif ($PSCommandPath) {
        $scriptPath = $PSCommandPath
    } else {
        $scriptPath = Join-Path (Get-Location).Path "cf-server-monitor.ps1"
    }
    $argList = "-NoProfile -ExecutionPolicy Bypass -STA -File $(ConvertTo-NativeArgument $scriptPath) $(ConvertTo-NativeArgument $Action) -STA"
    if ($Id) { $argList += " -Id $(ConvertTo-NativeArgument $Id)" }
    if ($Secret) { $argList += " -Secret $(ConvertTo-NativeArgument $Secret)" }
    if ($Url) { $argList += " -Url $(ConvertTo-NativeArgument $Url)" }
    if ($BASE_URL_WAS_BOUND) { $argList += " -BaseUrl $(ConvertTo-NativeArgument $BaseUrl)" }
    if ($PROXY_URL_WAS_BOUND) { $argList += " -ProxyUrl $(ConvertTo-NativeArgument $ProxyUrl)" }
    if ($CollectInterval) { $argList += " -CollectInterval $(ConvertTo-NativeArgument $CollectInterval)" }
    if ($ReportInterval) { $argList += " -ReportInterval $(ConvertTo-NativeArgument $ReportInterval)" }
    if ($ResetDay) { $argList += " -ResetDay $(ConvertTo-NativeArgument $ResetDay)" }
    if ($AutoUpdate -ne "") { $argList += " -AutoUpdate $(ConvertTo-NativeArgument $AutoUpdate)" }
    if ($RxCorrection) { $argList += " -RxCorrection $(ConvertTo-NativeArgument $RxCorrection)" }
    if ($TxCorrection) { $argList += " -TxCorrection $(ConvertTo-NativeArgument $TxCorrection)" }
    if ($CtNode) { $argList += " -CtNode $(ConvertTo-NativeArgument $CtNode)" }
    if ($CuNode) { $argList += " -CuNode $(ConvertTo-NativeArgument $CuNode)" }
    if ($CmNode) { $argList += " -CmNode $(ConvertTo-NativeArgument $CmNode)" }
    if ($BdNode) { $argList += " -BdNode $(ConvertTo-NativeArgument $BdNode)" }
    Start-Process powershell.exe -ArgumentList $argList
    exit 0
}

$DebugPreference = "SilentlyContinue"

$ErrorActionPreference = "Stop"

$APP_NAME = "CF-Server-Monitor"
$AGENT_VERSION = "1.3.3"
$TASK_NAME = "CFProbe"
# 获取脚本所在目录
if ($MyInvocation.MyCommand.Path) {
    $SCRIPT_PATH = $MyInvocation.MyCommand.Path
} elseif ($PSCommandPath) {
    $SCRIPT_PATH = $PSCommandPath
} else {
    $SCRIPT_PATH = Join-Path (Get-Location).Path "cf-server-monitor.ps1"
}
$SCRIPT_DIR = Split-Path -Parent $SCRIPT_PATH
$CONFIG_DIR = $SCRIPT_DIR
$CONFIG_FILE = Join-Path $CONFIG_DIR "cf_probe_config.json"
$LOG_FILE = Join-Path $CONFIG_DIR "cf_probe.log"
$TRAFFIC_FILE = Join-Path $CONFIG_DIR "cf_probe_traffic.dat"

$DEFAULT_CT = "gd-ct-dualstack.ip.zstaticcdn.com"
$DEFAULT_CU = "gd-cu-dualstack.ip.zstaticcdn.com"
$DEFAULT_CM = "gd-cm-dualstack.ip.zstaticcdn.com"
$DEFAULT_BD = "ip.zstaticcdn.com"
$MAX_TRAFFIC_CORRECTION_GB = 1000000

$MAX_LOG_SIZE = 1MB

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
                $lines = [System.IO.File]::ReadAllLines($LOG_FILE, [System.Text.Encoding]::UTF8)
                if ($lines.Length -gt 0) {
                    $targetSize = 102400
                    $totalBytes = 0
                    $keepCount = 0
                    for ($i = $lines.Length - 1; $i -ge 0; $i--) {
                        $lineBytes = [System.Text.Encoding]::UTF8.GetByteCount($lines[$i] + "`r`n")
                        if ($totalBytes + $lineBytes -gt $targetSize) { break }
                        $totalBytes += $lineBytes
                        $keepCount++
                    }
                    if ($keepCount -eq 0) { $keepCount = 1 }
                    if ($keepCount -gt 0 -and $keepCount -lt $lines.Length) {
                        $startIdx = $lines.Length - $keepCount
                        $keepLines = New-Object string[] $keepCount
                        [Array]::Copy($lines, $startIdx, $keepLines, 0, $keepCount)
                        [System.IO.File]::WriteAllLines($LOG_FILE, $keepLines, [System.Text.Encoding]::UTF8)
                    }
                }
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
            if ($raw.base_url) {
                $raw.base_url = $raw.base_url.Trim().Trim("'").Trim('"').TrimEnd('/')
            } elseif ($raw.worker_url) {
                $raw | Add-Member -NotePropertyName base_url -NotePropertyValue (Get-AgentBaseUrl -BaseUrl "" -WorkerUrl $raw.worker_url) -Force
            }
            if (-not $raw.worker_url -and $raw.base_url) {
                $raw.worker_url = "$($raw.base_url)/update"
            }
            if ($raw.proxy_url) {
                $raw.proxy_url = $raw.proxy_url.Trim().Trim("'").Trim('"')
            } elseif ($null -eq $raw.PSObject.Properties['proxy_url']) {
                $raw | Add-Member -NotePropertyName proxy_url -NotePropertyValue "" -Force
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
        Protect-SensitiveFile -Path $CONFIG_FILE
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

function Protect-SensitiveFile {
    param([string]$Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return }
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
        $allow = [System.Security.AccessControl.AccessControlType]::Allow
        $identities = @(
            (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),
            (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')),
            [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        ) | Select-Object -Unique
        foreach ($identity in $identities) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, $fullControl, $allow)
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $Path -AclObject $acl
    } catch {
        Write-Log "敏感文件权限收紧失败: $Path ($($_.Exception.Message))" "WARN"
    }
}

function Get-ConfigProperty {
    param($Config, [string]$Name, $Default = $null)
    if ($null -eq $Config) { return $Default }
    if ($Config -is [hashtable]) {
        if ($Config.ContainsKey($Name)) { return $Config[$Name] }
        return $Default
    }
    $prop = $Config.PSObject.Properties[$Name]
    if ($null -ne $prop) { return $prop.Value }
    return $Default
}

function Get-ProbeInitialValue {
    param([string]$Node)
    if ([string]::IsNullOrWhiteSpace($Node)) { return $false }
    return ""
}

function ConvertTo-BinaryFlag {
    param(
        [object]$Value,
        [string]$Default = "0",
        [switch]$Strict
    )

    if ($Default -ne "1") { $Default = "0" }
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $Default
    }

    $text = ([string]$Value).Trim()
    if ($text -eq "0" -or $text -eq "1") {
        return $text
    }
    if ($Strict) {
        throw "AutoUpdate 参数非法，仅支持 0 或 1"
    }
    return $Default
}

function ConvertTo-PowerShellLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-AgentBaseUrl {
    param([string]$BaseUrl, [string]$WorkerUrl)

    $candidate = if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl } else { $WorkerUrl }
    if ([string]::IsNullOrWhiteSpace($candidate)) { return "" }
    $candidate = $candidate.Trim().Trim("'").Trim('"')
    if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
        $candidate = $candidate -replace '/update/?$', ''
    }
    try {
        $uri = [Uri]$candidate
        if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host) -or
            -not [string]::IsNullOrWhiteSpace($uri.UserInfo) -or
            -not [string]::IsNullOrWhiteSpace($uri.Query) -or
            -not [string]::IsNullOrWhiteSpace($uri.Fragment)) {
            throw 'BaseURL 格式无效'
        }
        return $uri.AbsoluteUri.TrimEnd('/')
    } catch {
        throw 'BaseURL 仅支持无凭据、无 query/hash 的 HTTP(S) URL'
    }
}

function Normalize-AgentProxyUrl {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    try {
        $uri = [Uri]$Value.Trim().Trim("'").Trim('"')
        if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host) -or
            ($uri.AbsolutePath -ne '/' -and -not [string]::IsNullOrWhiteSpace($uri.AbsolutePath)) -or
            -not [string]::IsNullOrWhiteSpace($uri.Query) -or
            -not [string]::IsNullOrWhiteSpace($uri.Fragment)) {
            throw '代理 URL 格式无效'
        }
        return $uri.AbsoluteUri.TrimEnd('/')
    } catch {
        throw '代理仅支持 HTTP(S) URL，且不能包含业务路径、query 或 hash'
    }
}

function Get-MaskedProxyUrl {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return 'direct' }
    try {
        $uri = [Uri]$Value
        if ([string]::IsNullOrWhiteSpace($uri.UserInfo)) { return $uri.AbsoluteUri.TrimEnd('/') }
        $parts = $uri.UserInfo -split ':', 2
        $username = [Uri]::UnescapeDataString($parts[0])
        return "$($uri.Scheme)://${username}:******@$($uri.Authority)"
    } catch {
        return 'configured'
    }
}

function Get-AgentProxyParameters {
    param([string]$Value)
    $parameters = @{}
    $normalized = Normalize-AgentProxyUrl $Value
    if (-not $normalized) { return $parameters }

    $uri = [Uri]$normalized
    $parameters.Proxy = "$($uri.Scheme)://$($uri.Authority)"
    if (-not [string]::IsNullOrWhiteSpace($uri.UserInfo)) {
        $parts = $uri.UserInfo -split ':', 2
        $username = [Uri]::UnescapeDataString($parts[0])
        $password = if ($parts.Count -gt 1) { [Uri]::UnescapeDataString($parts[1]) } else { "" }
        $securePassword = if ($password.Length -gt 0) {
            ConvertTo-SecureString $password -AsPlainText -Force
        } else {
            New-Object System.Security.SecureString
        }
        $parameters.ProxyCredential = New-Object System.Management.Automation.PSCredential($username, $securePassword)
    }
    return $parameters
}

function Invoke-AgentWebRequest {
    param([string]$Uri, [string]$ProxyUrl, [hashtable]$Parameters = @{})
    $request = @{ UseBasicParsing = $true; Uri = $Uri }
    foreach ($entry in $Parameters.GetEnumerator()) { $request[$entry.Key] = $entry.Value }
    $proxyParameters = Get-AgentProxyParameters $ProxyUrl
    foreach ($entry in $proxyParameters.GetEnumerator()) { $request[$entry.Key] = $entry.Value }
    $useDirectConnection = [string]::IsNullOrWhiteSpace($ProxyUrl)
    $previousDefaultProxy = $null
    if ($useDirectConnection) {
        $previousDefaultProxy = [System.Net.WebRequest]::DefaultWebProxy
        [System.Net.WebRequest]::DefaultWebProxy = $null
    }
    try {
        return Invoke-WebRequest @request
    } finally {
        if ($useDirectConnection) {
            [System.Net.WebRequest]::DefaultWebProxy = $previousDefaultProxy
        }
    }
}

function Invoke-DirectRestMethod {
    param([string]$Uri, [int]$TimeoutSec = 3)
    $previousDefaultProxy = [System.Net.WebRequest]::DefaultWebProxy
    [System.Net.WebRequest]::DefaultWebProxy = $null
    try {
        return Invoke-RestMethod -Uri $Uri -TimeoutSec $TimeoutSec -ErrorAction Stop
    } finally {
        [System.Net.WebRequest]::DefaultWebProxy = $previousDefaultProxy
    }
}

function Get-AgentInstallUrl {
    param([string]$BaseUrl)

    try {
        $uri = [Uri]$BaseUrl
        if ($uri.Scheme -notin @("http", "https") -or [string]::IsNullOrWhiteSpace($uri.Authority)) {
            return $null
        }
        return "$($BaseUrl.TrimEnd('/'))/cf-server-monitor.ps1"
    } catch {
        return $null
    }
}

function Get-AgentUpdateTempDir {
    $candidates = @(
        [System.IO.Path]::GetTempPath(),
        $env:TEMP,
        $env:TMP,
        $CONFIG_DIR
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($candidate in $candidates) {
        try {
            if (-not (Test-Path -LiteralPath $candidate)) {
                New-Item -ItemType Directory -Path $candidate -Force | Out-Null
            }
            if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
                continue
            }
            $probeFile = Join-Path $candidate "cf-probe-write-test-$PID.tmp"
            [System.IO.File]::WriteAllText($probeFile, "1", [System.Text.Encoding]::ASCII)
            Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
            return $candidate
        } catch {}
    }
    return $null
}

function Schedule-AgentUpdate {
    param(
        [string]$BaseUrl,
        [string]$ProxyUrl,
        [string]$AutoUpdate
    )

    if ((ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0") -ne "1") {
        Write-Log "Auto update ignored: local auto_update=$AutoUpdate" "DEBUG"
        return
    }

    $lockFile = Join-Path $CONFIG_DIR "auto_update.lock"
    $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    if (Test-Path -LiteralPath $lockFile) {
        try {
            $last = [long]((Get-Content -LiteralPath $lockFile -Raw -ErrorAction Stop).Trim())
        } catch {
            $last = 0
        }
        if (($now - $last) -lt 1800) {
            Write-Log "Auto update already scheduled recently: age=$($now - $last)s lock=$lockFile" "DEBUG"
            return
        }
    }

    $installUrl = Get-AgentInstallUrl -BaseUrl $BaseUrl
    if (-not $installUrl) {
        Write-Log "Auto update skipped: invalid base_url=$BaseUrl" "WARN"
        return
    }

    $updateTmpDir = Get-AgentUpdateTempDir
    if (-not $updateTmpDir) {
        Write-Log "Auto update skipped: no writable temp dir" "WARN"
        return
    }

    $id = [Guid]::NewGuid().ToString("N")
    $downloadScript = Join-Path $updateTmpDir "cf-probe-auto-update-$id.ps1"
    $runnerScript = Join-Path $updateTmpDir "cf-probe-auto-update-runner-$id.ps1"
    $installUrlLiteral = ConvertTo-PowerShellLiteral $installUrl
    $downloadScriptLiteral = ConvertTo-PowerShellLiteral $downloadScript
    $targetScriptLiteral = ConvertTo-PowerShellLiteral $SCRIPT_PATH
    $proxyUrlLiteral = ConvertTo-PowerShellLiteral $ProxyUrl

    $runnerContent = @"
`$ErrorActionPreference = 'Stop'
try {
    `$proxyParameters = @{}
    `$proxyUrl = $proxyUrlLiteral
    if (-not [string]::IsNullOrWhiteSpace(`$proxyUrl)) {
        `$proxyUri = [Uri]`$proxyUrl
        `$proxyParameters.Proxy = "`$(`$proxyUri.Scheme)://`$(`$proxyUri.Authority)"
        if (-not [string]::IsNullOrWhiteSpace(`$proxyUri.UserInfo)) {
            `$proxyParts = `$proxyUri.UserInfo -split ':', 2
            `$proxyUser = [Uri]::UnescapeDataString(`$proxyParts[0])
            `$proxyPassword = if (`$proxyParts.Count -gt 1) { [Uri]::UnescapeDataString(`$proxyParts[1]) } else { '' }
            `$secureProxyPassword = if (`$proxyPassword.Length -gt 0) { ConvertTo-SecureString `$proxyPassword -AsPlainText -Force } else { New-Object System.Security.SecureString }
            `$proxyParameters.ProxyCredential = New-Object System.Management.Automation.PSCredential(`$proxyUser, `$secureProxyPassword)
        }
    }
    `$useDirectConnection = [string]::IsNullOrWhiteSpace(`$proxyUrl)
    `$previousDefaultProxy = `$null
    if (`$useDirectConnection) {
        `$previousDefaultProxy = [System.Net.WebRequest]::DefaultWebProxy
        [System.Net.WebRequest]::DefaultWebProxy = `$null
    }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $installUrlLiteral -OutFile $downloadScriptLiteral -TimeoutSec 30 @proxyParameters
    } finally {
        if (`$useDirectConnection) { [System.Net.WebRequest]::DefaultWebProxy = `$previousDefaultProxy }
    }
    Copy-Item -LiteralPath $downloadScriptLiteral -Destination $targetScriptLiteral -Force
    Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$targetScriptLiteral,'install') -WindowStyle Hidden -Wait
} catch {
} finally {
    Remove-Item -LiteralPath $downloadScriptLiteral -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue
}
"@

    try {
        [System.IO.File]::WriteAllText($runnerScript, $runnerContent, (New-Object System.Text.UTF8Encoding($false)))
        Protect-SensitiveFile -Path $runnerScript
        Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $runnerScript) -WindowStyle Hidden
        [System.IO.File]::WriteAllText($lockFile, [string]$now, [System.Text.Encoding]::ASCII)
        Write-Log "Auto update scheduled: url=$installUrl temp=$updateTmpDir" "INFO"
    } catch {
        Write-Log "Auto update schedule failed: $($_.Exception.Message)" "WARN"
    }
}

function ConvertFrom-AgentConfigResponse {
    param([string]$Body, [string]$ConfigMd5)

    $bodyText = if ($null -eq $Body) { "" } else { $Body.Trim() }
    if ([string]::IsNullOrEmpty($bodyText) -or [Text.Encoding]::UTF8.GetByteCount($bodyText) -gt 1024) {
        throw "动态配置响应长度无效"
    }
    if ($bodyText -notmatch '^[a-z0-9_=&.\-:]+$') { throw "动态配置包含非法字符" }

    $allowedKeys = @(
        'collect_interval', 'report_interval', 'reset_day', 'schema_version',
        'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd',
        'rx_correction', 'tx_correction', 'update'
    )
    $values = @{}
    foreach ($part in $bodyText.Split('&')) {
        if ([string]::IsNullOrEmpty($part)) { continue }
        $eqIndex = $part.IndexOf('=')
        if ($eqIndex -lt 0) { throw "动态配置字段格式无效" }
        $key = $part.Substring(0, $eqIndex)
        $value = $part.Substring($eqIndex + 1)
        if ($allowedKeys -notcontains $key) { throw "动态配置包含未知字段: $key" }
        if ($values.ContainsKey($key)) { throw "动态配置包含重复字段: $key" }
        $values[$key] = $value
    }

    $updateValue = if ($values.ContainsKey('update')) { $values['update'] } else { "" }
    if ($updateValue -ne "" -and $updateValue -ne "0" -and $updateValue -ne "1") {
        throw "动态配置 update 无效"
    }

    $requiredKeys = @('collect_interval', 'report_interval', 'reset_day', 'schema_version', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd')
    $hasConfig = $false
    foreach ($key in $requiredKeys) {
        if ($values.ContainsKey($key)) {
            $hasConfig = $true
            break
        }
    }

    if (-not $hasConfig) {
        if ($updateValue -eq "1") {
            return @{
                has_config = $false
                update = "1"
            }
        }
        throw "动态配置缺少配置字段"
    }

    foreach ($key in $requiredKeys) {
        if (-not $values.ContainsKey($key)) { throw "动态配置缺少必要字段: $key" }
    }

    $ConfigMd5 = if ($null -eq $ConfigMd5) { "" } else { $ConfigMd5.Trim().ToLowerInvariant() }
    if ($ConfigMd5 -notmatch '^[a-f0-9]{32}$') { throw "动态配置 MD5 无效" }

    foreach ($key in @('collect_interval', 'report_interval', 'reset_day', 'schema_version')) {
        if ($values[$key] -notmatch '^(0|[1-9][0-9]*)$') { throw "动态配置数值无效" }
    }
    $collect = [int]$values['collect_interval']
    $report = [int]$values['report_interval']
    $reset = [int]$values['reset_day']
    $schema = [int]$values['schema_version']
    if (@(0, 1, 2, 5, 10) -notcontains $collect) { throw "collect_interval 无效" }
    if (@(30, 60, 120, 180) -notcontains $report -or $report -lt $collect) { throw "report_interval 无效" }
    if ($reset -lt 0 -or $reset -gt 31 -or $schema -ne 2) { throw "reset_day 或 schema_version 无效" }

    $result = @{
        has_config = $true
        collect_interval = $collect
        report_interval = $report
        reset_day = $reset
        config_md5 = $ConfigMd5
        ct_node = $values['custom_ct']
        cu_node = $values['custom_cu']
        cm_node = $values['custom_cm']
        bd_node = $values['custom_bd']
    }

    if ($values.ContainsKey('rx_correction') -and $values['rx_correction'] -ne '') {
        $result.rx_correction = $values['rx_correction']
    }
    if ($values.ContainsKey('tx_correction') -and $values['tx_correction'] -ne '') {
        $result.tx_correction = $values['tx_correction']
    }
    if ($updateValue -ne '') {
        $result.update = $updateValue
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
    $argList = "-NoProfile -ExecutionPolicy Bypass -STA -File $(ConvertTo-NativeArgument $scriptPath) $(ConvertTo-NativeArgument $Action) -STA"
    if ($Id) { $argList += " -Id $(ConvertTo-NativeArgument $Id)" }
    if ($Secret) { $argList += " -Secret $(ConvertTo-NativeArgument $Secret)" }
    if ($Url) { $argList += " -Url $(ConvertTo-NativeArgument $Url)" }
    if ($BASE_URL_WAS_BOUND) { $argList += " -BaseUrl $(ConvertTo-NativeArgument $BaseUrl)" }
    if ($PROXY_URL_WAS_BOUND) { $argList += " -ProxyUrl $(ConvertTo-NativeArgument $ProxyUrl)" }
    if ($CollectInterval -and $CollectInterval -ne "0") { $argList += " -CollectInterval $(ConvertTo-NativeArgument $CollectInterval)" }
    if ($ReportInterval -and $ReportInterval -ne "60") { $argList += " -ReportInterval $(ConvertTo-NativeArgument $ReportInterval)" }
    if ($ResetDay -and $ResetDay -ne "1") { $argList += " -ResetDay $(ConvertTo-NativeArgument $ResetDay)" }
    if ($AutoUpdate -ne "") { $argList += " -AutoUpdate $(ConvertTo-NativeArgument $AutoUpdate)" }
    if ($RxCorrection) { $argList += " -RxCorrection $(ConvertTo-NativeArgument $RxCorrection)" }
    if ($TxCorrection) { $argList += " -TxCorrection $(ConvertTo-NativeArgument $TxCorrection)" }
    if ($CtNode) { $argList += " -CtNode $(ConvertTo-NativeArgument $CtNode)" }
    if ($CuNode) { $argList += " -CuNode $(ConvertTo-NativeArgument $CuNode)" }
    if ($CmNode) { $argList += " -CmNode $(ConvertTo-NativeArgument $CmNode)" }
    if ($BdNode) { $argList += " -BdNode $(ConvertTo-NativeArgument $BdNode)" }
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
        $pageFiles = Get-CimInstance Win32_PageFile -ErrorAction SilentlyContinue
        if ($pageFiles) {
            $totalMB = 0
            foreach ($pf in $pageFiles) {
                if ($pf.MaxSize) {
                    $totalMB += [math]::Round($pf.MaxSize / 1024)
                } elseif ($pf.Size) {
                    $totalMB += [math]::Round($pf.Size / 1024)
                }
            }
            $usage = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
            $usedMB = 0
            if ($usage) {
                foreach ($u in $usage) {
                    $usedMB += [math]::Round($u.CurrentUsage / 1024)
                }
            }
            if ($totalMB -gt 0) {
                return @{ total = $totalMB; used = [math]::Min($usedMB, $totalMB) }
            }
        }
        return @{ total = 0; used = 0 }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Get-DiskInfo {
    try {
        $disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue)
        if (-not $disks -or $disks.Count -eq 0) {
            $disks = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object {
                $_.Root -match '^[A-Za-z]:\\$' -and $null -ne $_.Used -and $null -ne $_.Free
            } | ForEach-Object {
                [PSCustomObject]@{
                    Size = ([int64]$_.Used + [int64]$_.Free)
                    FreeSpace = [int64]$_.Free
                }
            })
        }

        $totalBytes = [int64]0
        $freeBytes = [int64]0
        foreach ($disk in $disks) {
            if ($null -eq $disk.Size -or $null -eq $disk.FreeSpace) { continue }
            $size = [int64]$disk.Size
            $free = [int64]$disk.FreeSpace
            if ($size -le 0 -or $free -lt 0) { continue }
            $totalBytes += $size
            $freeBytes += $free
        }

        if ($totalBytes -le 0) { return @{ total = 0; used = 0 } }
        $totalMB = [math]::Round($totalBytes / 1024 / 1024)
        $freeMB = [math]::Round($freeBytes / 1024 / 1024)
        $usedMB = [math]::Max($totalMB - $freeMB, 0)
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

function Resolve-ProbeTarget {
    param([string]$TargetHost, [int]$DefaultPort = 443)
    $target = if ($TargetHost) { $TargetHost.Trim() } else { "" }
    if (-not $target) { return @{ host = ""; port = $DefaultPort } }
    if ($target.Contains(':')) {
        if ($target -notmatch '^([^:]+):([0-9]{1,5})$') { return $null }
        $port = [int]$Matches[2]
        if ($port -ge 1 -and $port -le 65535) {
            return @{ host = $Matches[1]; port = $port }
        }
        return $null
    }
    return @{ host = $target; port = $DefaultPort }
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


function Get-Probe {
    param([string]$TargetHost, [int]$Count = 4)
    if ([string]::IsNullOrWhiteSpace($TargetHost)) { return @{ rtt = $false; loss = $false } }
    $target = Resolve-ProbeTarget -TargetHost $TargetHost -DefaultPort 443
    if (-not $target) { return @{ rtt = "null"; loss = "100" } }
    $TargetHost = $target.host
    $port = [int]$target.port
    if (-not $TargetHost) { return @{ rtt = "null"; loss = "100" } }
    $ok = 0; $totalRtt = 0
    for ($i = 0; $i -lt $Count; $i++) {
        $r = Get-TcpPing -TargetHost $TargetHost -Port $port
        if ($r -match '^\d+$') { $ok++; $totalRtt += [int]$r }
    }
    $rtt = if ($ok -gt 0) { [math]::Floor($totalRtt / $ok).ToString() } else { "null" }
    $loss = [math]::Floor(($Count - $ok) / $Count * 100).ToString()
    return @{ rtt = $rtt; loss = $loss }
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
        [string]$TempFile
    )

    $jobScript = {
        param($ct, $cu, $cm, $bd, $tempFile)

        function Resolve-ProbeTarget {
            param([string]$TargetHost, [int]$DefaultPort = 443)
            $target = if ($TargetHost) { $TargetHost.Trim() } else { "" }
            if (-not $target) { return @{ host = ""; port = $DefaultPort } }
            if ($target.Contains(':')) {
                if ($target -notmatch '^([^:]+):([0-9]{1,5})$') { return $null }
                $port = [int]$Matches[2]
                if ($port -ge 1 -and $port -le 65535) {
                    return @{ host = $Matches[1]; port = $port }
                }
                return $null
            }
            return @{ host = $target; port = $DefaultPort }
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
            } catch { return "" }
        }

        function Get-Probe {
            param([string]$TargetHost, [int]$Count = 4)
            if ([string]::IsNullOrWhiteSpace($TargetHost)) { return @{ rtt = $false; loss = $false } }
            $target = Resolve-ProbeTarget -TargetHost $TargetHost -DefaultPort 443
            if (-not $target) { return @{ rtt = "null"; loss = "100" } }
            $TargetHost = $target.host
            $port = [int]$target.port
            if (-not $TargetHost) { return @{ rtt = $false; loss = $false } }
            $ok = 0; $totalRtt = 0
            for ($i = 0; $i -lt $Count; $i++) {
                $r = Get-TcpPing -TargetHost $TargetHost -Port $port
                if ($r -match '^\d+$') { $ok++; $totalRtt += [int]$r }
            }
            $rtt = if ($ok -gt 0) { [math]::Floor($totalRtt / $ok).ToString() } else { "null" }
            $loss = [math]::Floor(($Count - $ok) / $Count * 100).ToString()
            return @{ rtt = $rtt; loss = $loss }
        }

        $ctProbe = Get-Probe -TargetHost $ct
        $cuProbe = Get-Probe -TargetHost $cu
        $cmProbe = Get-Probe -TargetHost $cm
        $bdProbe = Get-Probe -TargetHost $bd

        $result = @{
            ct_ping = $ctProbe.rtt; ct_loss = $ctProbe.loss
            cu_ping = $cuProbe.rtt; cu_loss = $cuProbe.loss
            cm_ping = $cmProbe.rtt; cm_loss = $cmProbe.loss
            bd_ping = $bdProbe.rtt; bd_loss = $bdProbe.loss
            timestamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        }

        $json = $result | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($tempFile, $json, [System.Text.Encoding]::UTF8)
    }

    Start-Job -ScriptBlock $jobScript -ArgumentList $CtNode, $CuNode, $CmNode, $BdNode, $TempFile -Name "CFProbePingJob" | Out-Null
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
        $ip = (Invoke-DirectRestMethod -Uri "https://ipv4.icanhazip.com" -TimeoutSec 3).Trim()
        if ($ip -match '\.') { return $true }
    } catch {}
    try {
        $ip = (Invoke-DirectRestMethod -Uri "https://api.ipify.org" -TimeoutSec 3).Trim()
        if ($ip -match '\.') { return $true }
    } catch {}
    return $false
}

function Test-PublicIPv6 {
    try {
        $ip = (Invoke-DirectRestMethod -Uri "https://ipv6.icanhazip.com" -TimeoutSec 3).Trim()
        if ($ip -match ':') { return $true }
    } catch {}
    try {
        $ip = (Invoke-DirectRestMethod -Uri "https://api64.ipify.org" -TimeoutSec 3).Trim()
        if ($ip -match ':') { return $true }
    } catch {}
    return $false
}

function Get-DirectAgentRegion {
    try {
        $trace = [string](Invoke-DirectRestMethod -Uri "https://cloudflare.com/cdn-cgi/trace" -TimeoutSec 3)
        foreach ($line in ($trace -split '\r?\n')) {
            if ($line -match '^loc=([A-Za-z]{2})$') {
                return $Matches[1].ToUpperInvariant()
            }
        }
    } catch {}
    return ""
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
    $tmpFile = "$TRAFFIC_FILE.tmp"
    $lines -join "`n" | Set-Content $tmpFile -Encoding UTF8
    Move-Item -LiteralPath $tmpFile -Destination $TRAFFIC_FILE -Force -ErrorAction SilentlyContinue
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
    param([string]$ServerId, [string]$Secret, [string]$WorkerUrl, [string]$ProxyUrl, [string]$RxCorrection, [string]$TxCorrection)
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
        $response = Invoke-AgentWebRequest -Uri $WorkerUrl -ProxyUrl $ProxyUrl -Parameters @{
            Method = 'Post'
            Body = $payload
            ContentType = 'application/json; charset=utf-8'
            TimeoutSec = 4
            ErrorAction = 'Stop'
        }
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
    param([string]$ServerId, [string]$Secret, [string]$WorkerUrl, [string]$ProxyUrl, [string]$RxCorrection, [string]$TxCorrection)
    $rxValue = Normalize-CorrectionValue $RxCorrection
    $txValue = Normalize-CorrectionValue $TxCorrection

    if (Apply-TrafficCorrection -RxCorrection $rxValue -TxCorrection $txValue) {
        [void](Send-CorrectionConfirm -ServerId $ServerId -Secret $Secret -WorkerUrl $WorkerUrl -ProxyUrl $ProxyUrl -RxCorrection $rxValue -TxCorrection $txValue)
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
        $statusAutoUpdate = ConvertTo-BinaryFlag -Value $config.auto_update -Default "0"
        $msg = "CF-Server-Monitor 状态`n"
        $msg += "Server ID: $($config.server_id)`n"
        $msg += "Base URL: $($config.base_url)`n"
        $msg += "Proxy: $(Get-MaskedProxyUrl $config.proxy_url)`n"
        $msg += "上报间隔: $($config.report_interval)秒`n"
        $msg += "实际上报间隔: $effectiveStatusReportInterval秒`n"
        $msg += "自动更新: $statusAutoUpdate`n"
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
        if (-not $Id -or -not $Secret -or (-not $BaseUrl -and -not $Url)) {
            Write-Log "错误: 缺少必要参数" "ERROR"
            Write-Host "请使用: .\cf-server-monitor.ps1 run -Id 'ID' -Secret '密钥' -BaseUrl '地址'" -ForegroundColor Yellow
            return
        }
        try {
            $newAutoUpdate = if ($AutoUpdate -ne "") {
                ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0" -Strict
            } else {
                "0"
            }
        } catch {
            Write-Log "错误: $($_.Exception.Message)" "ERROR"
            return
        }
        try {
            $newBaseUrl = Get-AgentBaseUrl -BaseUrl $BaseUrl -WorkerUrl $Url
            $newProxyUrl = Normalize-AgentProxyUrl $ProxyUrl
        } catch {
            Write-Log "错误: $($_.Exception.Message)" "ERROR"
            return
        }
        $config = @{
            server_id = $Id
            secret = $Secret
            base_url = $newBaseUrl
            proxy_url = $newProxyUrl
            worker_url = "$newBaseUrl/update"
            collect_interval = [int]$CollectInterval
            report_interval = [int]$ReportInterval
            reset_day = [int]$ResetDay
            auto_update = $newAutoUpdate
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
    try {
        $baseUrl = if ($BASE_URL_WAS_BOUND -or $Url) {
            Get-AgentBaseUrl -BaseUrl $BaseUrl -WorkerUrl $Url
        } else {
            Get-AgentBaseUrl -BaseUrl (Get-ConfigProperty $config 'base_url' '') -WorkerUrl (Get-ConfigProperty $config 'worker_url' '')
        }
        $proxyUrl = if ($PROXY_URL_WAS_BOUND) {
            Normalize-AgentProxyUrl $ProxyUrl
        } else {
            Normalize-AgentProxyUrl (Get-ConfigProperty $config 'proxy_url' '')
        }
    } catch {
        Write-Log "错误: $($_.Exception.Message)" "ERROR"
        return
    }
    $workerUrl = "$baseUrl/update"

    if ($config.report_interval) {
        $reportInterval = [int]$config.report_interval
    } else {
        $reportInterval = 60
    }

    if ($null -ne $config.reset_day) {
        $resetDay = [int]$config.reset_day
    } else {
        $resetDay = 1
    }
    $configMd5 = if ($config.config_md5) { $config.config_md5.ToString().Trim().ToLowerInvariant() } else { "none" }
    $ctNode = if ($CtNode) { $CtNode } else { Get-ConfigProperty $config 'ct_node' $DEFAULT_CT }
    $cuNode = if ($CuNode) { $CuNode } else { Get-ConfigProperty $config 'cu_node' $DEFAULT_CU }
    $cmNode = if ($CmNode) { $CmNode } else { Get-ConfigProperty $config 'cm_node' $DEFAULT_CM }
    $bdNode = if ($BdNode) { $BdNode } else { Get-ConfigProperty $config 'bd_node' $DEFAULT_BD }
    try {
        $autoUpdate = if ($AutoUpdate -ne "") {
            ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0" -Strict
        } else {
            ConvertTo-BinaryFlag -Value $config.auto_update -Default "0"
        }
    } catch {
        Write-Log "错误: $($_.Exception.Message)" "ERROR"
        return
    }
    $ctNode = $ctNode.Trim()
    $cuNode = $cuNode.Trim()
    $cmNode = $cmNode.Trim()
    $bdNode = $bdNode.Trim()

    if (-not $serverId -or -not $secret -or -not $baseUrl) {
        Write-Log "配置不完整，请填写 server_id, secret, base_url" "ERROR"
        return
    }
    if (@(30, 60, 120, 180) -notcontains $reportInterval) { $reportInterval = 60 }
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
    $script:cs_region = ""
    $script:cs_pingCt = Get-ProbeInitialValue $ctNode
    $script:cs_pingCu = Get-ProbeInitialValue $cuNode
    $script:cs_pingCm = Get-ProbeInitialValue $cmNode
    $script:cs_pingBd = Get-ProbeInitialValue $bdNode
    $script:cs_lossCt = Get-ProbeInitialValue $ctNode
    $script:cs_lossCu = Get-ProbeInitialValue $cuNode
    $script:cs_lossCm = Get-ProbeInitialValue $cmNode
    $script:cs_lossBd = Get-ProbeInitialValue $bdNode
    $script:cs_lastReportTime = 0
    $script:cs_reportInterval = $effectiveReportInterval
    $script:cs_resetDay = $resetDay
    $script:cs_configMd5 = $configMd5
    $script:cs_ctNode = $ctNode
    $script:cs_cuNode = $cuNode
    $script:cs_cmNode = $cmNode
    $script:cs_bdNode = $bdNode
    $script:cs_autoUpdate = $autoUpdate

    $pingTempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "cf_probe_ping_results.json")

    # 首次 CPU 采样
    try {
        $counter = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
        $null = $counter.NextValue()
        Start-Sleep -Milliseconds 300
    } catch {}

    Write-Log "探针已启动。 ServerID=$serverId BaseUrl='$baseUrl' Proxy='$(Get-MaskedProxyUrl $proxyUrl)' ReportInterval=${reportInterval}s EffectiveReportInterval=${effectiveReportInterval}s CollectInterval=ignored AutoUpdate=$autoUpdate"

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
            $bUrl = $baseUrl
            $pUrl = $proxyUrl
            $ctN = [string]$script:cs_ctNode
            $cuN = [string]$script:cs_cuNode
            $cmN = [string]$script:cs_cmNode
            $bdN = [string]$script:cs_bdNode
            $rDay = $script:cs_resetDay
            $rInterval = $script:cs_reportInterval
            $pFile = $pingTempFile

            $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()

            # IP 检测（每 10 分钟）
            if ($now - $script:cs_lastIpCheck -ge 600 -or $script:cs_lastIpCheck -eq 0) {
                $script:cs_ipV4 = if (Test-PublicIPv4) { "1" } else { "0" }
                $script:cs_ipV6 = if (Test-PublicIPv6) { "1" } else { "0" }
                $detectedRegion = Get-DirectAgentRegion
                if ($detectedRegion) { $script:cs_region = $detectedRegion }
                $script:cs_lastIpCheck = $now
            }

            # Ping 跟随上报间隔并限制在 30-60 秒（同时计算延迟和丢包率）
            $probeInterval = [int]$script:cs_reportInterval
            if ($probeInterval -lt 30) { $probeInterval = 30 }
            if ($probeInterval -gt 60) { $probeInterval = 60 }
            if ($now - $script:cs_lastPingCheck -ge $probeInterval -or $script:cs_lastPingCheck -eq 0) {
                $script:cs_lastPingCheck = $now
                $existingJob = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
                if (-not $existingJob -or $existingJob.State -in @("Completed", "Failed", "Stopped")) {
                    Remove-PingBackgroundJob
                    Start-PingBackgroundJob -CtNode $ctN -CuNode $cuN -CmNode $cmN -BdNode $bdN -TempFile $pFile
                }
            }

            # 读取异步 Ping 检测结果
            $pingResults = Read-PingResults -TempFile $pFile
            if ($pingResults) {
                $props = $pingResults.PSObject.Properties
                if ($props['ct_ping']) { $script:cs_pingCt = $pingResults.ct_ping }
                if ($props['cu_ping']) { $script:cs_pingCu = $pingResults.cu_ping }
                if ($props['cm_ping']) { $script:cs_pingCm = $pingResults.cm_ping }
                if ($props['bd_ping']) { $script:cs_pingBd = $pingResults.bd_ping }
                if ($props['ct_loss']) { $script:cs_lossCt = $pingResults.ct_loss }
                if ($props['cu_loss']) { $script:cs_lossCu = $pingResults.cu_loss }
                if ($props['cm_loss']) { $script:cs_lossCm = $pingResults.cm_loss }
                if ($props['bd_loss']) { $script:cs_lossBd = $pingResults.bd_loss }
            }

            if ([string]::IsNullOrWhiteSpace($ctN)) { $script:cs_pingCt = $false; $script:cs_lossCt = $false }
            if ([string]::IsNullOrWhiteSpace($cuN)) { $script:cs_pingCu = $false; $script:cs_lossCu = $false }
            if ([string]::IsNullOrWhiteSpace($cmN)) { $script:cs_pingCm = $false; $script:cs_lossCm = $false }
            if ([string]::IsNullOrWhiteSpace($bdN)) { $script:cs_pingBd = $false; $script:cs_lossBd = $false }

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
                    agent_region = $script:cs_region
                    metrics = $metrics
                    collect_interval = 0
                    report_interval = $rInterval
                }
                $json = $payload | ConvertTo-Json -Depth 10 -Compress
                try {
                    $requestHeaders = @{
                        'X-Agent-Config-Schema' = '2'
                        'X-Agent-Version' = $AGENT_VERSION
                        'X-Agent-Config-Md5' = if ($script:cs_configMd5) { $script:cs_configMd5 } else { 'none' }
                    }
                    $response = Invoke-AgentWebRequest -Uri $wUrl -ProxyUrl $pUrl -Parameters @{
                        Method = 'Post'
                        Body = $json
                        ContentType = 'application/json; charset=utf-8'
                        Headers = $requestHeaders
                        TimeoutSec = 8
                        ErrorAction = 'Stop'
                    }
                    if ([int]$response.StatusCode -eq 200) {
                        # Windows PowerShell 5.1 returns byte[] for some textual content types.
                        $responseBody = if ($response.Content -is [byte[]]) {
                            [Text.Encoding]::UTF8.GetString([byte[]]$response.Content)
                        } else {
                            [string]$response.Content
                        }
                        $responseBody = if ($null -eq $responseBody) { "" } else { $responseBody.Trim() }
                        if (-not [string]::IsNullOrWhiteSpace($responseBody) -and $responseBody -ne "OK") {
                            $remoteConfig = ConvertFrom-AgentConfigResponse `
                                -Body $responseBody `
                                -ConfigMd5 ([string]$response.Headers['X-Agent-Config-Md5'])

                            $hasRemoteConfig = (-not $remoteConfig.ContainsKey('has_config')) -or [bool]$remoteConfig['has_config']
                            $configApplied = $true
                            if ($hasRemoteConfig) {
                                $configChanged = $remoteConfig.config_md5 -ne $script:cs_configMd5
                                if ($configChanged) {
                                    foreach ($entry in $remoteConfig.GetEnumerator()) {
                                        if (@('has_config', 'update', 'rx_correction', 'tx_correction') -contains $entry.Key) {
                                            continue
                                        }
                                        if ($config -is [hashtable]) {
                                            $config[$entry.Key] = $entry.Value
                                        } else {
                                            $config | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
                                        }
                                    }
                                    $configApplied = Save-Config -Config $config
                                    if ($configApplied) {
                                        $effectiveRemoteReportInterval = [math]::Max($remoteConfig.report_interval, 60)
                                        $script:cs_reportInterval = $effectiveRemoteReportInterval
                                        $script:cs_resetDay = $remoteConfig.reset_day
                                        $script:cs_configMd5 = $remoteConfig.config_md5
                                        if ($remoteConfig.ContainsKey('ct_node')) { $script:cs_ctNode = $remoteConfig.ct_node }
                                        if ($remoteConfig.ContainsKey('cu_node')) { $script:cs_cuNode = $remoteConfig.cu_node }
                                        if ($remoteConfig.ContainsKey('cm_node')) { $script:cs_cmNode = $remoteConfig.cm_node }
                                        if ($remoteConfig.ContainsKey('bd_node')) { $script:cs_bdNode = $remoteConfig.bd_node }
                                        $timer.Stop()
                                        $timer.Interval = $effectiveRemoteReportInterval * 1000
                                        $timer.Start()
                                        Write-Log "动态配置已应用: md5=$($remoteConfig.config_md5) report_interval=$($remoteConfig.report_interval)s ct=$($remoteConfig.ct_node) cu=$($remoteConfig.cu_node) cm=$($remoteConfig.cm_node) bd=$($remoteConfig.bd_node)" "INFO"

                                        $script:cs_lastPingCheck = 0
                                        $script:cs_pingCt = Get-ProbeInitialValue $script:cs_ctNode
                                        $script:cs_pingCu = Get-ProbeInitialValue $script:cs_cuNode
                                        $script:cs_pingCm = Get-ProbeInitialValue $script:cs_cmNode
                                        $script:cs_pingBd = Get-ProbeInitialValue $script:cs_bdNode
                                        $script:cs_lossCt = Get-ProbeInitialValue $script:cs_ctNode
                                        $script:cs_lossCu = Get-ProbeInitialValue $script:cs_cuNode
                                        $script:cs_lossCm = Get-ProbeInitialValue $script:cs_cmNode
                                        $script:cs_lossBd = Get-ProbeInitialValue $script:cs_bdNode
                                        Remove-Item -LiteralPath $pingTempFile -Force -ErrorAction SilentlyContinue

                                        $existingPingJob = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
                                        if ($existingPingJob) {
                                            $existingPingJob | Stop-Job -ErrorAction SilentlyContinue | Out-Null
                                            $existingPingJob | Remove-Job -Force -ErrorAction SilentlyContinue | Out-Null
                                        }
                                        $newCtNode = if ($remoteConfig.ContainsKey('ct_node')) { $remoteConfig.ct_node } else { $config.ct_node }
                                        $newCuNode = if ($remoteConfig.ContainsKey('cu_node')) { $remoteConfig.cu_node } else { $config.cu_node }
                                        $newCmNode = if ($remoteConfig.ContainsKey('cm_node')) { $remoteConfig.cm_node } else { $config.cm_node }
                                        $newBdNode = if ($remoteConfig.ContainsKey('bd_node')) { $remoteConfig.bd_node } else { $config.bd_node }
                                        Start-PingBackgroundJob -CtNode $newCtNode -CuNode $newCuNode -CmNode $newCmNode -BdNode $newBdNode -TempFile $pingTempFile
                                    }
                                }
                            }

                            if ($hasRemoteConfig -and $configApplied -and ($remoteConfig.ContainsKey('rx_correction') -or $remoteConfig.ContainsKey('tx_correction'))) {
                                $rxCorr = if ($remoteConfig.ContainsKey('rx_correction')) { $remoteConfig.rx_correction } else { "" }
                                $txCorr = if ($remoteConfig.ContainsKey('tx_correction')) { $remoteConfig.tx_correction } else { "" }
                                Invoke-TrafficCorrection -ServerId $srvId -Secret $sec -WorkerUrl $wUrl -ProxyUrl $pUrl -RxCorrection $rxCorr -TxCorrection $txCorr
                            }

                            if ($remoteConfig.ContainsKey('update') -and $remoteConfig.update -eq "1") {
                                Write-Log "收到自动更新指令" "DEBUG"
                                Schedule-AgentUpdate -BaseUrl $bUrl -ProxyUrl $pUrl -AutoUpdate $script:cs_autoUpdate
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
    Write-Host "  BaseUrl: '$BaseUrl'" -ForegroundColor Cyan
    Write-Host "  Proxy: '$(Get-MaskedProxyUrl $ProxyUrl)'" -ForegroundColor Cyan
    Write-Host "  AutoUpdate: '$AutoUpdate'" -ForegroundColor Cyan
    Write-Host "  脚本目录: $SCRIPT_DIR" -ForegroundColor Cyan
    Write-Host "  配置文件: $CONFIG_FILE" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""

    if ($AutoUpdate -ne "") {
        try {
            $null = ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0" -Strict
        } catch {
            Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red
            return
        }
    }
    
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
    $cleanBaseUrl = if ($BASE_URL_WAS_BOUND) { $BaseUrl.Trim().Trim("'").Trim('"') } else { "" }
    $cleanProxyUrl = if ($PROXY_URL_WAS_BOUND) { $ProxyUrl.Trim().Trim("'").Trim('"') } else { "" }
    try {
        $existingBaseUrl = if ($existingConfig) {
            Get-AgentBaseUrl -BaseUrl (Get-ConfigProperty $existingConfig 'base_url' '') -WorkerUrl (Get-ConfigProperty $existingConfig 'worker_url' '')
        } else { "" }
        $baseUrlValue = if ($BASE_URL_WAS_BOUND -or $cleanUrl) {
            Get-AgentBaseUrl -BaseUrl $cleanBaseUrl -WorkerUrl $cleanUrl
        } else {
            $existingBaseUrl
        }
        $proxyUrlValue = if ($PROXY_URL_WAS_BOUND) {
            Normalize-AgentProxyUrl $cleanProxyUrl
        } elseif ($existingConfig) {
            Normalize-AgentProxyUrl (Get-ConfigProperty $existingConfig 'proxy_url' '')
        } else { "" }
        $existingAutoUpdate = if ($existingConfig -and $null -ne $existingConfig.auto_update) {
            ConvertTo-BinaryFlag -Value $existingConfig.auto_update -Default "0"
        } else {
            "0"
        }
        $autoUpdateValue = if ($AutoUpdate -ne "") {
            ConvertTo-BinaryFlag -Value $AutoUpdate -Default $existingAutoUpdate -Strict
        } else {
            $existingAutoUpdate
        }
    } catch {
        Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red
        return
    }

    $config = @{
        server_id = if ($cleanId) { $cleanId } elseif ($existingConfig) { $existingConfig.server_id } else { "" }
        secret = if ($cleanSecret) { $cleanSecret } elseif ($existingConfig) { $existingConfig.secret } else { "" }
        base_url = $baseUrlValue
        proxy_url = $proxyUrlValue
        worker_url = if ($baseUrlValue) { "$baseUrlValue/update" } else { "" }
        collect_interval = [int]$CollectInterval
        report_interval = [int]$ReportInterval
        reset_day = [int]$ResetDay
        auto_update = $autoUpdateValue
        config_md5 = "none"
        ct_node = if ($CtNode) { $CtNode } else { Get-ConfigProperty $existingConfig 'ct_node' $DEFAULT_CT }
        cu_node = if ($CuNode) { $CuNode } else { Get-ConfigProperty $existingConfig 'cu_node' $DEFAULT_CU }
        cm_node = if ($CmNode) { $CmNode } else { Get-ConfigProperty $existingConfig 'cm_node' $DEFAULT_CM }
        bd_node = if ($BdNode) { $BdNode } else { Get-ConfigProperty $existingConfig 'bd_node' $DEFAULT_BD }
    }

    if (-not $config.server_id -or -not $config.secret -or -not $config.base_url) {
        Write-Host "错误: 缺少必要参数 -Id, -Secret, -BaseUrl" -ForegroundColor Red
        Write-Host "当前值:" -ForegroundColor Yellow
        Write-Host "  server_id: '$($config.server_id)'" -ForegroundColor Yellow
        Write-Host "  secret: '$($config.secret)'" -ForegroundColor Yellow
        Write-Host "  base_url: '$($config.base_url)'" -ForegroundColor Yellow
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
    Write-Host "       CF-Server-Monitor $AGENT_VERSION 安装成功" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  Server ID  : $($config.server_id)"
    Write-Host "  Base URL   : $($config.base_url)"
    Write-Host "  Proxy      : $(Get-MaskedProxyUrl $config.proxy_url)"
    Write-Host "  上报间隔   : $($config.report_interval)秒"
    Write-Host "  实际间隔   : $effectiveInstallReportInterval秒"
    Write-Host "  采样间隔   : Windows PowerShell 版不启用 samples 缓存"
    Write-Host "  流量重置日 : $($config.reset_day)号"
    Write-Host "  自动更新   : $($config.auto_update)"
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
        $statusAutoUpdate = ConvertTo-BinaryFlag -Value $config.auto_update -Default "0"
        Write-Host "配置文件: $CONFIG_FILE" -ForegroundColor Cyan
        Write-Host "  Server ID  : $($config.server_id)"
        Write-Host "  Base URL   : $($config.base_url)"
        Write-Host "  Proxy      : $(Get-MaskedProxyUrl $config.proxy_url)"
        Write-Host "  上报间隔   : $($config.report_interval)秒"
        Write-Host "  实际间隔   : $effectiveStatusReportInterval秒"
        Write-Host "  自动更新   : $statusAutoUpdate"
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
}
