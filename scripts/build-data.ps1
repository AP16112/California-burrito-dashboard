param(
  [string]$WorkbookPath = "data.xlsx",
  [string]$OutputPath = "public/data/analytics.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ColumnName {
  param([string]$CellReference)
  return ($CellReference -replace '\d', '')
}

function Get-CellText {
  param(
    [string]$Value,
    [string]$CellType,
    [string[]]$SharedStrings
  )

  if ($null -eq $Value) { return "" }
  if ($CellType -eq "s") { return $SharedStrings[[int]$Value] }
  return $Value
}

function Add-Amount {
  param(
    [hashtable]$Map,
    [string]$Key,
    [decimal]$Revenue,
    [int]$Quantity
  )

  if (-not $Map.ContainsKey($Key)) {
    $Map[$Key] = [ordered]@{
      revenue = 0.0
      quantity = 0
      records = 0
    }
  }

  $Map[$Key].revenue += [double]$Revenue
  $Map[$Key].quantity += $Quantity
  $Map[$Key].records += 1
}

$workbookFullPath = Resolve-Path $WorkbookPath
$outputFullPath = Join-Path (Get-Location) $OutputPath
$outputDir = Split-Path $outputFullPath -Parent
if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($workbookFullPath)
try {
  $shared = New-Object System.Collections.Generic.List[string]
  $sharedEntry = $zip.GetEntry("xl/sharedStrings.xml")
  if ($null -ne $sharedEntry) {
    $sharedReader = [System.Xml.XmlReader]::Create($sharedEntry.Open())
    try {
      while ($sharedReader.Read()) {
        if ($sharedReader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $sharedReader.LocalName -eq "t") {
          $shared.Add($sharedReader.ReadElementContentAsString())
        }
      }
    }
    finally {
      $sharedReader.Close()
    }
  }
  $sharedArray = $shared.ToArray()

  $orders = @{}
  $lineCube = @{}
  $itemCube = @{}
  $dimensions = [ordered]@{
    outlets = @{}
    brands = @{}
    groups = @{}
    orderTypes = @{}
    settlements = @{}
    items = @{}
  }

  $metadata = [ordered]@{
    sourceFile = (Split-Path $WorkbookPath -Leaf)
    generatedAt = (Get-Date).ToString("s")
    totalRecords = 0
    totalRevenue = 0.0
    totalQuantity = 0
    dateMin = $null
    dateMax = $null
  }

  $sheet = $zip.GetEntry("xl/worksheets/sheet1.xml")
  $reader = [System.Xml.XmlReader]::Create($sheet.Open())
  $current = @{}
  $cellRef = ""
  $cellType = ""
  $isHeader = $true

  try {
    while ($reader.Read()) {
      if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.LocalName -eq "row") {
        $current = @{}
      }
      elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.LocalName -eq "c") {
        $cellRef = $reader.GetAttribute("r")
        $cellType = $reader.GetAttribute("t")
      }
      elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.LocalName -eq "v") {
        $value = Get-CellText -Value $reader.ReadElementContentAsString() -CellType $cellType -SharedStrings $sharedArray
        $current[(Get-ColumnName $cellRef)] = $value
      }
      elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::EndElement -and $reader.LocalName -eq "row") {
        if ($isHeader) {
          $isHeader = $false
          continue
        }

        if (-not $current.ContainsKey("A")) { continue }

        $billNo = [string]$current["A"]
        $outlet = [string]$current["B"]
        $dateTime = [DateTime]::FromOADate([double]$current["C"])
        $date = $dateTime.ToString("yyyy-MM-dd")
        $group = [string]$current["D"]
        $orderType = [string]$current["E"]
        $item = [string]$current["F"]
        $price = [decimal]$current["G"]
        $quantity = [int][double]$current["H"]
        $settlement = [string]$current["I"]
        $brand = [string]$current["J"]
        $revenue = $price * $quantity

        $metadata.totalRecords += 1
        $metadata.totalRevenue += [double]$revenue
        $metadata.totalQuantity += $quantity
        if ($null -eq $metadata.dateMin -or $date -lt $metadata.dateMin) { $metadata.dateMin = $date }
        if ($null -eq $metadata.dateMax -or $date -gt $metadata.dateMax) { $metadata.dateMax = $date }

        $dimensions.outlets[$outlet] = $true
        $dimensions.brands[$brand] = $true
        $dimensions.groups[$group] = $true
        $dimensions.orderTypes[$orderType] = $true
        $dimensions.settlements[$settlement] = $true
        $dimensions.items[$item] = $true

        if (-not $orders.ContainsKey($billNo)) {
          $orders[$billNo] = [ordered]@{
            billNo = $billNo
            date = $date
            outlet = $outlet
            brand = $brand
            orderType = $orderType
            settlement = $settlement
            revenue = 0.0
            quantity = 0
            records = 0
            groups = @{}
          }
        }

        $orders[$billNo].revenue += [double]$revenue
        $orders[$billNo].quantity += $quantity
        $orders[$billNo].records += 1
        $orders[$billNo].groups[$group] = $true

        Add-Amount -Map $lineCube -Key "$date|$outlet|$brand|$group|$orderType|$settlement" -Revenue $revenue -Quantity $quantity
        Add-Amount -Map $itemCube -Key "$date|$outlet|$brand|$group|$item|$orderType" -Revenue $revenue -Quantity $quantity
      }
    }
  }
  finally {
    $reader.Close()
  }

  $orderRows = New-Object System.Collections.Generic.List[object]
  foreach ($order in $orders.Values) {
    $order.groups = @($order.groups.Keys | Sort-Object)
    $orderRows.Add($order)
  }

  $lineRows = New-Object System.Collections.Generic.List[object]
  foreach ($entry in $lineCube.GetEnumerator()) {
    $parts = $entry.Key.Split("|")
    $lineRows.Add([ordered]@{
      date = $parts[0]
      outlet = $parts[1]
      brand = $parts[2]
      group = $parts[3]
      orderType = $parts[4]
      settlement = $parts[5]
      revenue = [math]::Round($entry.Value.revenue, 2)
      quantity = $entry.Value.quantity
      records = $entry.Value.records
    })
  }

  $itemRows = New-Object System.Collections.Generic.List[object]
  foreach ($entry in $itemCube.GetEnumerator()) {
    $parts = $entry.Key.Split("|")
    $itemRows.Add([ordered]@{
      date = $parts[0]
      outlet = $parts[1]
      brand = $parts[2]
      group = $parts[3]
      item = $parts[4]
      orderType = $parts[5]
      revenue = [math]::Round($entry.Value.revenue, 2)
      quantity = $entry.Value.quantity
      records = $entry.Value.records
    })
  }

  $dimensionRows = [ordered]@{
    outlets = @($dimensions.outlets.Keys | Sort-Object)
    brands = @($dimensions.brands.Keys | Sort-Object)
    groups = @($dimensions.groups.Keys | Sort-Object)
    orderTypes = @($dimensions.orderTypes.Keys | Sort-Object)
    settlements = @($dimensions.settlements.Keys | Sort-Object)
    items = @($dimensions.items.Keys | Sort-Object)
  }

  $payload = [ordered]@{
    metadata = $metadata
    dimensions = $dimensionRows
    orders = $orderRows
    lineCube = $lineRows
    itemCube = $itemRows
  }

  $json = $payload | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($outputFullPath, $json, [System.Text.Encoding]::UTF8)
  Write-Host "Wrote $OutputPath"
  Write-Host "Rows: $($metadata.totalRecords), orders: $($orderRows.Count), revenue: $([math]::Round($metadata.totalRevenue, 2))"
}
finally {
  $zip.Dispose()
}
