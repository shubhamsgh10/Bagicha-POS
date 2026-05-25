# Lists installed print queues with optional VID/PID (USBPRINT queues often have no VID in InstanceId).
$ErrorActionPreference = 'Stop'
$skipPattern = 'pdf|onenote|xps|fax|microsoft print|send to'

$out = @()
Get-CimInstance Win32_Printer | ForEach-Object {
  $queue = $_.Name
  if (-not $queue) { return }
  if (-not (Get-Printer -Name $queue -ErrorAction SilentlyContinue)) { return }
  $lower = $queue.ToLower()
  if ($lower -match 'pdf|onenote|xps|fax|microsoft print|send to') { return }

  # Skip queues Windows reports as offline / not ready (disconnected USB often stays installed).
  if ($_.WorkOffline -eq $true) { return }
  if ($_.PrinterStatus -eq 7) { return }

  $port = $_.PortName
  if (-not $port -or $port -match '^(nul|file:|portprompt:)') { return }
  $vid = $null
  $prodId = $null

  # Printer class PnP device (USBPRINT\... — usually no VID in InstanceId)
  $pnpPrinter = Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq $queue } |
    Select-Object -First 1

  if ($pnpPrinter -and $pnpPrinter.InstanceId -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') {
    $vid = $matches[1]
    $prodId = $matches[2]
  }

  if (-not $vid) {
    $entity = Get-CimInstance Win32_PnPEntity |
      Where-Object { $_.Name -eq $queue } |
      Select-Object -First 1
    if ($entity -and $entity.PNPDeviceID -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') {
      $vid = $matches[1]
      $prodId = $matches[2]
    }
  }

  # Match any USB node with a similar name (e.g. HP LaserJet M1136, RP3160 GOLD)
  if (-not $vid) {
    $prefix = if ($queue.Length -gt 14) { $queue.Substring(0, 14) } else { $queue }
    $portKey = if ($port) { ($port -replace '[^A-Za-z0-9]', '').Substring(0, [Math]::Min(8, ($port -replace '[^A-Za-z0-9]', '').Length)) } else { '' }
    $usb = Get-CimInstance Win32_PnPEntity |
      Where-Object {
        $_.PNPDeviceID -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})' -and
        (
          $_.Name -eq $queue -or
          $_.Name -like "$prefix*" -or
          $queue -like "$($_.Name)*" -or
          ($portKey -and (($_.Name -replace '[^A-Za-z0-9]', '') -like "*$portKey*"))
        )
      } |
      Select-Object -First 1
    if ($usb -and $usb.PNPDeviceID -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})') {
      $vid = $matches[1]
      $prodId = $matches[2]
    }
  }

  $row = [PSCustomObject]@{
    queueName = $queue
    portName  = $port
    vid       = $vid
    pid       = $prodId
  }
  $out += $row
}

if ($out.Count -eq 0) {
  '[]'
} else {
  $out | ConvertTo-Json -Compress
}
