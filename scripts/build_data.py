import json
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree.ElementTree import iterparse


ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "data.xlsx"
OUTPUT = ROOT / "public" / "data" / "analytics.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def column_name(cell_ref):
    return "".join(char for char in cell_ref if char.isalpha())


def excel_date(serial):
    return (datetime(1899, 12, 30) + timedelta(days=float(serial))).date().isoformat()


def shared_strings(zf):
    try:
        source = zf.open("xl/sharedStrings.xml")
    except KeyError:
        return []

    values = []
    pieces = []
    for event, elem in iterparse(source, events=("start", "end")):
        if event == "start" and elem.tag == f"{NS}si":
            pieces = []
        elif event == "end" and elem.tag == f"{NS}t":
            pieces.append(elem.text or "")
        elif event == "end" and elem.tag == f"{NS}si":
            values.append("".join(pieces))
            elem.clear()
    source.close()
    return values


def cell_value(value, cell_type, strings):
    if value is None:
        return ""
    if cell_type == "s":
        return strings[int(value)]
    return value


def add_amount(cube, key, revenue, quantity):
    row = cube[key]
    row["revenue"] += revenue
    row["quantity"] += quantity
    row["records"] += 1


def parse_sheet(zf, strings):
    metadata = {
        "sourceFile": WORKBOOK.name,
        "sourceModifiedAt": datetime.fromtimestamp(WORKBOOK.stat().st_mtime).replace(microsecond=0).isoformat(),
        "totalRecords": 0,
        "totalRevenue": 0.0,
        "totalQuantity": 0,
        "dateMin": None,
        "dateMax": None,
    }
    dimensions = {
        "outlets": set(),
        "brands": set(),
        "groups": set(),
        "orderTypes": set(),
        "settlements": set(),
        "items": set(),
    }
    orders = {}
    line_cube = defaultdict(lambda: {"revenue": 0.0, "quantity": 0, "records": 0})
    item_cube = defaultdict(lambda: {"revenue": 0.0, "quantity": 0, "records": 0})

    source = zf.open("xl/worksheets/sheet1.xml")
    current = {}
    cell_ref = ""
    cell_type = ""
    header = True

    for event, elem in iterparse(source, events=("start", "end")):
        if event == "start" and elem.tag == f"{NS}row":
            current = {}
        elif event == "start" and elem.tag == f"{NS}c":
            cell_ref = elem.attrib.get("r", "")
            cell_type = elem.attrib.get("t", "")
        elif event == "end" and elem.tag == f"{NS}v":
            current[column_name(cell_ref)] = cell_value(elem.text, cell_type, strings)
        elif event == "end" and elem.tag == f"{NS}row":
            if header:
                header = False
                elem.clear()
                continue
            if not current.get("A"):
                elem.clear()
                continue

            bill_no = str(current["A"])
            outlet = str(current["B"])
            date = excel_date(current["C"])
            group = str(current["D"])
            order_type = str(current["E"])
            item = str(current["F"])
            price = float(current["G"])
            quantity = int(float(current["H"]))
            settlement = str(current["I"])
            brand = str(current["J"])
            revenue = price * quantity

            metadata["totalRecords"] += 1
            metadata["totalRevenue"] += revenue
            metadata["totalQuantity"] += quantity
            metadata["dateMin"] = date if metadata["dateMin"] is None else min(metadata["dateMin"], date)
            metadata["dateMax"] = date if metadata["dateMax"] is None else max(metadata["dateMax"], date)

            dimensions["outlets"].add(outlet)
            dimensions["brands"].add(brand)
            dimensions["groups"].add(group)
            dimensions["orderTypes"].add(order_type)
            dimensions["settlements"].add(settlement)
            dimensions["items"].add(item)

            order = orders.setdefault(
                bill_no,
                {
                    "billNo": bill_no,
                    "date": date,
                    "outlet": outlet,
                    "brand": brand,
                    "orderType": order_type,
                    "settlement": settlement,
                    "revenue": 0.0,
                    "quantity": 0,
                    "records": 0,
                    "groups": set(),
                },
            )
            order["revenue"] += revenue
            order["quantity"] += quantity
            order["records"] += 1
            order["groups"].add(group)

            add_amount(line_cube, (date, outlet, brand, group, order_type, settlement), revenue, quantity)
            add_amount(item_cube, (date, outlet, brand, group, item, order_type), revenue, quantity)
            elem.clear()

    source.close()

    dates = sorted({order["date"] for order in orders.values()})
    dimension_rows = {key: sorted(value) for key, value in dimensions.items()}
    dimension_rows["dates"] = dates

    indexes = {
        key: {value: index for index, value in enumerate(values)}
        for key, values in dimension_rows.items()
    }

    order_rows = []
    for order in orders.values():
        group_mask = 0
        for group in order["groups"]:
            group_mask |= 1 << indexes["groups"][group]
        order_rows.append(
            [
                indexes["dates"][order["date"]],
                indexes["outlets"][order["outlet"]],
                indexes["orderTypes"][order["orderType"]],
                indexes["settlements"][order["settlement"]],
                round(order["revenue"], 2),
                order["quantity"],
                order["records"],
                group_mask,
            ]
        )

    line_rows = [
        [
            indexes["dates"][key[0]],
            indexes["outlets"][key[1]],
            indexes["brands"][key[2]],
            indexes["groups"][key[3]],
            indexes["orderTypes"][key[4]],
            indexes["settlements"][key[5]],
            round(value["revenue"], 2),
            value["quantity"],
            value["records"],
        ]
        for key, value in line_cube.items()
    ]

    item_rows = [
        [
            indexes["dates"][key[0]],
            indexes["outlets"][key[1]],
            indexes["brands"][key[2]],
            indexes["groups"][key[3]],
            indexes["items"][key[4]],
            indexes["orderTypes"][key[5]],
            round(value["revenue"], 2),
            value["quantity"],
            value["records"],
        ]
        for key, value in item_cube.items()
    ]

    return {
        "metadata": {**metadata, "totalRevenue": round(metadata["totalRevenue"], 2)},
        "dimensions": dimension_rows,
        "schema": {
            "orders": ["date", "outlet", "orderType", "settlement", "revenue", "quantity", "records", "groupMask"],
            "lineCube": ["date", "outlet", "brand", "group", "orderType", "settlement", "revenue", "quantity", "records"],
            "itemCube": ["date", "outlet", "brand", "group", "item", "orderType", "revenue", "quantity", "records"],
        },
        "orders": order_rows,
        "lineCube": line_rows,
        "itemCube": item_rows,
    }


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(WORKBOOK) as zf:
        strings = shared_strings(zf)
        payload = parse_sheet(zf, strings)

    OUTPUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")
    print(
        "Rows: {rows:,}, orders: {orders:,}, revenue: {revenue:,.2f}".format(
            rows=payload["metadata"]["totalRecords"],
            orders=len(payload["orders"]),
            revenue=payload["metadata"]["totalRevenue"],
        )
    )


if __name__ == "__main__":
    main()
