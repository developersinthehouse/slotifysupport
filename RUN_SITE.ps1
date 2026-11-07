# Starts this website at http://localhost:8081. Usage: powershell -ExecutionPolicy Bypass -File RUN_SITE.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$serve = Join-Path $here 'tools\serve.py'
if (Get-Command py -ErrorAction SilentlyContinue) { & py $serve 8081 }
elseif (Get-Command python -ErrorAction SilentlyContinue) { & python $serve 8081 }
else { Write-Host 'Python was not found. Install Python from https://python.org, then run this again.' }
