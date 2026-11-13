<#
.SYNOPSIS
  Measures RAM (Working Set and Private Bytes) and CPU of an app and its WHOLE process tree
  (includes the msedgewebview2.exe children of WebView2, or the renderer/GPU/utility processes of Electron/NW.js/Chrome).

.EXAMPLE
  # 1) Open the app, leave it on its home/news screen ("idle") and run:
  .\measure-webview.ps1 -ProcessName solfall-launcher -Label launcher-idle -Seconds 60
  # 2) Enter the game (do nothing else), wait ~30 s and run:
  .\measure-webview.ps1 -ProcessName solfall-launcher -Label launcher-game -Seconds 60
  # 3) Repeat with the current prototype (use its .exe name, without ".exe", as -ProcessName)
  # Output: CSV appended to .\measure-results.csv (one row per sample + one "SUMMARY" row)

.NOTES
  - PowerShell 5.1+ (Windows 10/11). No admin needed.
  - Close other WebView2 apps (Teams, Widgets, new Outlook) to isolate, although the script only sums
    the tree of the given app.
  - CPU % = CPU time used in the window / (seconds * logical cores) * 100  (same as Task Manager).
#>
param(
  [Parameter(Mandatory=$true)][string]$ProcessName,   # root process name, without .exe
  [string]$Label = "run",
  [int]$Seconds = 60,
  [int]$IntervalSeconds = 5,
  [string]$OutCsv = ".\measure-results.csv"
)

function Get-Tree([int[]]$rootIds) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $set = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  foreach ($r in $rootIds) { [void]$set.Add($r); $queue.Enqueue($r) }
  while ($queue.Count -gt 0) {
    $p = $queue.Dequeue()
    foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $p })) {
      if ($set.Add([int]$c.ProcessId)) { $queue.Enqueue([int]$c.ProcessId) }
    }
  }
  return $set
}

$roots = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($roots.Count -eq 0) { throw "No processes named '$ProcessName'. Open the app first." }
$cores = [Environment]::ProcessorCount

function Snapshot {
  $ids = Get-Tree $roots
  $procs = @(Get-Process -Id ($ids | ForEach-Object { $_ }) -ErrorAction SilentlyContinue)
  [pscustomobject]@{
    Procs      = $procs.Count
    WS_MB      = [math]::Round(($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1)
    Private_MB = [math]::Round(($procs | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB, 1)
    CPU_s      = [double](($procs | ForEach-Object { if ($_.TotalProcessorTime) { $_.TotalProcessorTime.TotalSeconds } else { 0 } } | Measure-Object -Sum).Sum)
    Names      = (($procs | Group-Object Name | ForEach-Object { "$($_.Name)x$($_.Count)" }) -join ';')
  }
}

$rows = @()
$start = Snapshot; $t0 = Get-Date; $prev = $start; $prevT = $t0
for ($i = $IntervalSeconds; $i -le $Seconds; $i += $IntervalSeconds) {
  Start-Sleep -Seconds $IntervalSeconds
  $s = Snapshot; $now = Get-Date
  $cpu = [math]::Round((($s.CPU_s - $prev.CPU_s) / (($now - $prevT).TotalSeconds * $cores)) * 100, 2)
  $rows += [pscustomobject]@{ Timestamp=$now.ToString("s"); Label=$Label; App=$ProcessName; Kind="sample";
    Procs=$s.Procs; WorkingSet_MB=$s.WS_MB; PrivateBytes_MB=$s.Private_MB; CPU_pct=$cpu; Processes=$s.Names }
  $prev = $s; $prevT = $now
}
$end = $prev
$avgWS = [math]::Round(($rows | Measure-Object WorkingSet_MB -Average).Average, 1)
$avgPB = [math]::Round(($rows | Measure-Object PrivateBytes_MB -Average).Average, 1)
$maxPB = ($rows | Measure-Object PrivateBytes_MB -Maximum).Maximum
$cpuAvg = [math]::Round((($end.CPU_s - $start.CPU_s) / (((Get-Date) - $t0).TotalSeconds * $cores)) * 100, 2)
$rows += [pscustomobject]@{ Timestamp=(Get-Date).ToString("s"); Label=$Label; App=$ProcessName; Kind="SUMMARY";
  Procs=$end.Procs; WorkingSet_MB=$avgWS; PrivateBytes_MB=$avgPB; CPU_pct=$cpuAvg; Processes="max_private_MB=$maxPB" }

$rows | Export-Csv -Path $OutCsv -NoTypeInformation -Append -Encoding UTF8
$rows | Where-Object Kind -eq "SUMMARY" | Format-Table Label, App, Procs, WorkingSet_MB, PrivateBytes_MB, CPU_pct -AutoSize
Write-Host "Saved to $OutCsv  (Private Bytes = the number to compare; Working Set counts shared memory)."
Write-Host "GPU: see Task Manager > Details > columns 'GPU' and 'Dedicated GPU memory' (not measured here)."
