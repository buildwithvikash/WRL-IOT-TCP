import socket
import threading
import time
import crcmod
from pymongo import MongoClient
import struct
import os

# ================= CONFIG =================
PORT = int(os.getenv("PORT", 15000))
POLL_INTERVAL = 2

# ================= MONGO =================
mongo = MongoClient("mongodb://localhost:27017")
db = mongo.iot
collection = db.readings

# ================= MODBUS =================
crc16 = crcmod.predefined.mkCrcFun("modbus")

def build_modbus_frame(slave, func, start, qty):
    frame = struct.pack(">BBHH", slave, func, start, qty)
    crc = crc16(frame)
    return frame + struct.pack("<H", crc)

def parse_float_cdab(data):
    reordered = data[2:4] + data[0:2]
    return struct.unpack(">f", reordered)[0]

# ================= POLL MAP =================
poll_list = [
    {"slave": 1, "name": "temperature", "addr": 44096, "type": "short"},
    {"slave": 2, "name": "energy", "addr": 30000, "type": "float"},
    {"slave": 2, "name": "power", "addr": 30014, "type": "float"},
    {"slave": 2, "name": "voltage", "addr": 30020, "type": "float"},
    {"slave": 2, "name": "current", "addr": 30022, "type": "float"},
    {"slave": 2, "name": "powerFactor", "addr": 30024, "type": "float"},
    {"slave": 2, "name": "frequency", "addr": 30026, "type": "float"},
]

# ================= CLIENT HANDLER =================
def handle_client(conn, addr):
    print("📡 Device connected:", addr)
    imei = None
    rx_buffer = b""
    poll_index = 0
    waiting = False

    conn.settimeout(10)

    def poll_loop():
        nonlocal poll_index, waiting
        while True:
            if not imei or waiting:
                time.sleep(1)
                continue

            item = poll_list[poll_index]
            qty = 1 if item["type"] == "short" else 2
            func = 0x04 if item["addr"] >= 40000 else 0x03

            frame = build_modbus_frame(
                item["slave"], func, item["addr"], qty
            )

            try:
                conn.sendall(frame)
                waiting = True
            except:
                break

            poll_index = (poll_index + 1) % len(poll_list)
            time.sleep(POLL_INTERVAL)

    threading.Thread(target=poll_loop, daemon=True).start()

    try:
        while True:
            data = conn.recv(1024)
            if not data:
                break

            print("⬇ RAW HEX:", data.hex())

            # Drop HTTP / TLS scanners
            if data.startswith(b"GET ") or data[:2] == b"\x16\x03":
                conn.close()
                return

            # IMEI Login
            if not imei:
                text = data.decode(errors="ignore")
                import re
                match = re.search(r"\d{15}", text)
                if match:
                    imei = match.group()
                    print("📱 IMEI REGISTERED:", imei)
                continue

            rx_buffer += data
            if len(rx_buffer) < 7:
                continue

            byte_count = rx_buffer[2]
            frame_len = 3 + byte_count + 2
            if len(rx_buffer) < frame_len:
                continue

            payload = rx_buffer[3:3 + byte_count]
            rx_buffer = rx_buffer[frame_len:]
            waiting = False

            item = poll_list[poll_index - 1]

            if item["type"] == "short":
                value = struct.unpack(">h", payload[:2])[0]
            else:
                value = parse_float_cdab(payload[:4])

            print(f"🟢 LIVE | {imei} | {item['name']} = {value}")

            collection.insert_one({
                "imei": imei,
                "parameter": item["name"],
                "value": value,
                "timestamp": time.time()
            })

    except Exception as e:
        print("⚠️ Error:", e)

    finally:
        conn.close()
        print("🔌 Device disconnected:", imei)

# ================= SERVER =================
def start_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("0.0.0.0", PORT))
    server.listen(20)
    print(f"🚀 Python TCP Server running on port {PORT}")

    while True:
        conn, addr = server.accept()
        threading.Thread(
            target=handle_client, args=(conn, addr), daemon=True
        ).start()

if __name__ == "__main__":
    start_server()
