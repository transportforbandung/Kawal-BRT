#!/usr/bin/env python3
"""Local development server and GeoJSON route storage for the BRT route editor."""

import json
import html
import os
import re
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, unquote, urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROUTES_DIR = PROJECT_ROOT / "dataset" / "BRT-Route" / "Created-Routes"
STOP_DATASETS = {
    "On-Corridor": PROJECT_ROOT / "dataset" / "On-Corridor-Stops" / "On-Corridor-Stops.geojson",
    "Off-Corridor": PROJECT_ROOT / "dataset" / "Off-Corridor-Stops" / "Off-Corridor-Stops.geojson",
    "End-Station": PROJECT_ROOT / "dataset" / "End-Stations" / "End-Stations.geojson",
}
ROUTE_FILENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,79}\.geojson\Z")
ROUTE_REF = re.compile(r"[0-9]{1,3}[A-Za-z]?\Z")
MAX_BODY_SIZE = 5 * 1024 * 1024
SAVE_LOCK = Lock()


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def read_stops():
    features = []
    for group, path in STOP_DATASETS.items():
        with path.open(encoding="utf-8") as source:
            collection = json.load(source)
        source_features = collection.get("features", [])
        refs = read_dbf_refs(path.with_suffix(".dbf"), len(source_features))
        for index, feature in enumerate(source_features):
            properties = dict(feature.get("properties") or {})
            identifier = properties.get("ID", properties.get("No"))
            properties["_stop_id"] = f"{group}:{identifier}"
            properties["_stop_group"] = group
            properties["ref"] = refs[index]
            features.append(
                {
                    "type": "Feature",
                    "geometry": feature["geometry"],
                    "properties": properties,
                }
            )
    return {"type": "FeatureCollection", "features": features}


def dbf_fields(data):
    header_length = int.from_bytes(data[8:10], "little")
    record_length = int.from_bytes(data[10:12], "little")
    record_count = int.from_bytes(data[4:8], "little")
    if header_length < 33 or data[header_length - 1] != 0x0D:
        raise ValueError("Invalid DBF header")

    fields = []
    position = 32
    while position < header_length - 1:
        descriptor = data[position:position + 32]
        if len(descriptor) != 32:
            raise ValueError("Invalid DBF field descriptor")
        name = descriptor[:11].split(b"\0", 1)[0].decode("ascii").lower()
        fields.append(
            {
                "name": name,
                "type": chr(descriptor[11]),
                "width": descriptor[16],
                "descriptor": descriptor,
            }
        )
        position += 32

    if record_length < 1 or len(data) < header_length + record_count * record_length:
        raise ValueError("Invalid DBF record data")
    return record_count, header_length, record_length, fields


def read_dbf_refs(dbf_path, expected_count):
    data = dbf_path.read_bytes()
    record_count, header_length, record_length, fields = dbf_fields(data)
    if record_count != expected_count:
        raise ValueError(f"{dbf_path.name} record count does not match its stop dataset")
    ref_index = next((index for index, field in enumerate(fields) if field["name"] == "ref"), None)
    if ref_index is None:
        return [""] * record_count

    offset = 1 + sum(field["width"] for field in fields[:ref_index])
    width = fields[ref_index]["width"]
    refs = []
    for index in range(record_count):
        start = header_length + index * record_length + offset
        refs.append(data[start:start + width].decode("utf-8", errors="replace").strip())
    return refs


def update_dbf_refs(dbf_path, expected_count, selected_indices, route_ref, previous_ref=None, previous_indices=None):
    data = dbf_path.read_bytes()
    record_count, header_length, record_length, fields = dbf_fields(data)
    if record_count != expected_count:
        raise ValueError(f"{dbf_path.name} record count does not match its stop dataset")

    ref_index = next((index for index, field in enumerate(fields) if field["name"] == "ref"), None)
    new_field = ref_index is None
    if new_field:
        descriptor = bytearray(32)
        descriptor[:3] = b"ref"
        descriptor[11] = ord("C")
        descriptor[16] = 254
        fields.append({"name": "ref", "type": "C", "width": 254, "descriptor": bytes(descriptor)})
        ref_index = len(fields) - 1
    elif fields[ref_index]["type"] != "C":
        raise ValueError(f"{dbf_path.name} has a non-text ref field")

    old_ref_width = 0 if new_field else fields[ref_index]["width"]
    new_ref_width = 254
    new_header_length = header_length + (32 if new_field else 0)
    new_record_length = record_length + (new_ref_width if new_field else new_ref_width - old_ref_width)

    header = bytearray(data[:header_length])
    header[8:10] = new_header_length.to_bytes(2, "little")
    header[10:12] = new_record_length.to_bytes(2, "little")
    if new_field:
        header = header[:-1] + fields[-1]["descriptor"] + b"\x0d"
    else:
        descriptor_start = 32 + ref_index * 32
        descriptor = bytearray(header[descriptor_start:descriptor_start + 32])
        descriptor[16] = new_ref_width
        header[descriptor_start:descriptor_start + 32] = descriptor

    old_offset = 1 + sum(field["width"] for field in fields[:ref_index])

    records = bytearray()
    updated_indices = selected_indices | (previous_indices or set())
    for index in range(record_count):
        start = header_length + index * record_length
        record = data[start:start + record_length]
        if len(record) != record_length:
            raise ValueError(f"{dbf_path.name} has a truncated DBF record")
        if new_field:
            old_ref = ""
            updated = record + b" " * new_ref_width
        else:
            old_value = record[old_offset:old_offset + old_ref_width]
            old_ref = old_value.decode("utf-8", errors="replace").strip()
            updated = record[:old_offset] + b" " * new_ref_width + record[old_offset + old_ref_width:]

        if index in updated_indices:
            refs = [value.strip() for value in old_ref.split(";") if value.strip()]
            if previous_ref:
                refs = [value for value in refs if value != previous_ref]
            if index in selected_indices and route_ref not in refs:
                refs.append(route_ref)
            encoded = "; ".join(refs).encode("utf-8")
            if len(encoded) > new_ref_width:
                raise ValueError(f"{dbf_path.name} route refs exceed the DBF field limit")
            updated = updated[:old_offset] + encoded.ljust(new_ref_width, b" ") + updated[old_offset + new_ref_width:]
        records.extend(updated)

    eof = data[header_length + record_count * record_length:]
    return bytes(header) + bytes(records) + (eof if eof else b"\x1a")


def selected_stop_indices(stop_ids):
    wanted = set(stop_ids)
    found = set()
    updates = {}
    for group, path in STOP_DATASETS.items():
        with path.open(encoding="utf-8") as source:
            features = json.load(source).get("features", [])
        indices = set()
        for index, feature in enumerate(features):
            properties = feature.get("properties") or {}
            identifier = properties.get("ID", properties.get("No"))
            stop_id = f"{group}:{identifier}"
            if stop_id in wanted:
                indices.add(index)
                found.add(stop_id)
        if indices:
            updates[group] = (path.with_suffix(".dbf"), len(features), indices)
    missing = wanted - found
    if missing:
        raise RequestError(400, f"Unknown stop ID(s): {', '.join(sorted(missing))}")
    return updates


def route_kml(data):
    properties = data["properties"]
    name = html.escape(properties["name"], quote=True)
    route_ref = html.escape(properties["ref"], quote=True)
    coordinates = "\n".join(
        f"              {coordinate[0]:.7f},{coordinate[1]:.7f},0"
        for coordinate in data["geometry"]["coordinates"]
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        "  <Document>\n"
        f"    <name>{name}</name>\n"
        "    <Placemark>\n"
        f"      <name>{name}</name>\n"
        "      <ExtendedData>\n"
        '        <Data name="ref"><value>' + route_ref + "</value></Data>\n"
        "      </ExtendedData>\n"
        "      <LineString>\n"
        "        <tessellate>1</tessellate>\n"
        "        <coordinates>\n"
        f"{coordinates}\n"
        "        </coordinates>\n"
        "      </LineString>\n"
        "    </Placemark>\n"
        "  </Document>\n"
        "</kml>\n"
    )


def stage_file(path, content):
    handle = tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False)
    try:
        with handle:
            handle.write(content)
        return Path(handle.name)
    except OSError:
        Path(handle.name).unlink(missing_ok=True)
        raise


def save_route_files(path, data):
    properties = data["properties"]
    stop_updates = selected_stop_indices(properties["stop_ids"])
    previous_ref = None
    previous_stop_updates = {}
    if path.exists():
        try:
            previous_route = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise RequestError(409, f"Existing route file is invalid GeoJSON: {error}") from error
        previous_properties = previous_route.get("properties", {})
        previous_ref = previous_properties.get("ref")
        previous_stop_ids = previous_properties.get("stop_ids", [])
        if previous_stop_ids:
            previous_stop_updates = selected_stop_indices(previous_stop_ids)

    staged = []
    try:
        all_groups = set(stop_updates) | set(previous_stop_updates)
        for group in all_groups:
            dbf_path, feature_count, selected_indices = stop_updates.get(
                group,
                (None, 0, set()),
            )
            previous_dbf, previous_count, previous_indices = previous_stop_updates.get(
                group,
                (None, 0, set()),
            )
            if dbf_path is None:
                dbf_path, feature_count = previous_dbf, previous_count
            contents = update_dbf_refs(
                dbf_path,
                feature_count,
                selected_indices,
                properties["ref"],
                previous_ref,
                previous_indices,
            )
            staged.append((stage_file(dbf_path, contents), dbf_path))

        geojson = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        kml_path = path.with_suffix(".kml")
        kml = route_kml(data).encode("utf-8")
        staged.append((stage_file(path, geojson), path))
        staged.append((stage_file(kml_path, kml), kml_path))
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)

    return path.with_suffix(".kml").name, len(set(properties["stop_ids"]))


def route_path(filename):
    if not ROUTE_FILENAME.fullmatch(filename):
        raise RequestError(400, "Invalid route filename")
    return ROUTES_DIR / filename


def validate_route(data):
    if not isinstance(data, dict) or data.get("type") != "Feature":
        raise RequestError(400, "Expected a GeoJSON LineString Feature")
    geometry = data.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise RequestError(400, "Route geometry must be a LineString")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise RequestError(400, "Route must contain at least two coordinates")
    for coordinate in coordinates:
        if (
            not isinstance(coordinate, list)
            or len(coordinate) < 2
            or not all(isinstance(value, (int, float)) for value in coordinate[:2])
            or not -180 <= coordinate[0] <= 180
            or not -90 <= coordinate[1] <= 90
        ):
            raise RequestError(400, "Route contains an invalid longitude/latitude")

    properties = data.get("properties")
    if not isinstance(properties, dict) or not isinstance(properties.get("name"), str):
        raise RequestError(400, "Route must have a name")
    if not isinstance(properties.get("ref"), str) or not ROUTE_REF.fullmatch(properties["ref"]):
        raise RequestError(400, "Route name must provide a BRT route number for its ref")
    stop_ids = properties.get("stop_ids")
    stop_names = properties.get("stop_names")
    if (
        not isinstance(stop_ids, list)
        or not isinstance(stop_names, list)
        or len(stop_ids) != len(stop_names)
        or len(stop_ids) < 2
        or not all(isinstance(value, str) for value in stop_ids + stop_names)
    ):
        raise RequestError(400, "Route must include at least two named stops")
    return data


class RouteEditorHandler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def get_query_filename(self):
        values = parse_qs(urlparse(self.path).query).get("file")
        if not values:
            raise RequestError(400, "A route filename is required")
        return route_path(unquote(values[0]))

    def do_GET(self):
        try:
            request_path = urlparse(self.path).path
            if request_path == "/api/stops":
                self.send_json(200, read_stops())
            elif request_path == "/api/routes":
                ROUTES_DIR.mkdir(parents=True, exist_ok=True)
                routes = []
                for path in sorted(ROUTES_DIR.glob("*.geojson")):
                    with path.open(encoding="utf-8") as source:
                        route = json.load(source)
                    routes.append(
                        {
                            "file": path.name,
                            "name": route.get("properties", {}).get("name", path.stem),
                        }
                    )
                self.send_json(200, routes)
            elif request_path == "/api/route":
                path = self.get_query_filename()
                if not path.is_file():
                    raise RequestError(404, "Route not found")
                self.send_file(path, "application/geo+json; charset=utf-8")
            elif request_path == "/tools/routes_editor/":
                self.send_file(
                    PROJECT_ROOT / "tools" / "routes_editor" / "index.html",
                    "text/html; charset=utf-8",
                )
            elif request_path in (
                "/tools/routes_editor/app.js",
                "/tools/routes_editor/style.css",
            ):
                path = PROJECT_ROOT / request_path.lstrip("/")
                content_type = "text/javascript; charset=utf-8" if path.suffix == ".js" else "text/css; charset=utf-8"
                self.send_file(path, content_type)
            else:
                self.send_json(404, {"error": "Not found"})
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f"Request failed: {error}")
            self.send_json(500, {"error": "Could not read the requested data"})

    def do_PUT(self):
        try:
            if urlparse(self.path).path != "/api/route":
                raise RequestError(404, "Not found")
            path = self.get_query_filename()
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_BODY_SIZE:
                raise RequestError(413, "Route file is empty or too large")
            data = json.loads(self.rfile.read(content_length))
            validate_route(data)
            ROUTES_DIR.mkdir(parents=True, exist_ok=True)
            with SAVE_LOCK:
                kml_file, updated_stops = save_route_files(path, data)
            self.send_json(
                200,
                {
                    "file": path.name,
                    "kml_file": kml_file,
                    "updated_stops": updated_stops,
                },
            )
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": f"Invalid route data: {error}"})
        except OSError as error:
            print(f"Could not save route: {error}")
            self.send_json(500, {"error": "Could not save route to disk"})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


def main():
    host = "127.0.0.1"
    port = 8765
    server = ThreadingHTTPServer((host, port), RouteEditorHandler)
    print(f"BRT route editor: http://{host}:{port}/tools/routes_editor/")
    print("Press Ctrl+C to stop the local server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping route editor server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
