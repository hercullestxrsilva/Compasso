# Opens Compasso: starts the dev server if it is not running yet, then opens the app in the default browser.
# Always 127.0.0.1:5188 — the browser keeps the app's data per address, so another address would show it empty.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$url = 'http://127.0.0.1:5188'
$log = Join-Path $env:TEMP 'compasso-dev.log'

function Test-Server {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect('127.0.0.1', 5188, $null, $null)
    return $wait.AsyncWaitHandle.WaitOne(300) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-Server)) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList "/c npm run dev > `"$log`" 2>&1" `
    -WorkingDirectory $project -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Server)) {
    if ((Get-Date) -gt $deadline) {
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.MessageBox]::Show(
        "O Compasso não iniciou em 90 segundos. Veja o registro em:`n$log",
        'Compasso', 'OK', 'Warning') | Out-Null
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
}
Start-Process $url
