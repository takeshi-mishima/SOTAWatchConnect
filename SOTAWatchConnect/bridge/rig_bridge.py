#
# rig_bridge.py : SOTAWatch to Rig Bridge
#
# Send frequency and mode from browser extension to rigctld.
#
# Supports multiple rigs: each rig has its own rigctld instance
# listening on its own TCP port (started by start_rig_bridge.vbs).
# The rig list (name -> rigctld port, hamlib model) is loaded from
# rigs.csv in this same folder, which is the single shared source of
# truth also used by start_rig_bridge.vbs.
#
# FTX-1: the rig rejects frequency set while in memory mode, but
# rigctld still replies RPRT 0, so the rig is put back to VFO first.
# FTX-1: switching to DATA-U by CAT may turn the narrow filter on,
# so it is turned back off after the mode is set.
#
# The passband is always -1 (leave the width as the rig remembers it
# for each mode). Hamlib sends the width for SUB to MAIN (SH0...) on
# the FTX-1 (Hamlib issue #2241), and width -1 sends no SH at all.
#
# (c) 2026 Takeshi Mishima JK1VUZ
#

import csv
import os
import socket
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": [
    "https://sotawatch.sota.org.uk",
    "http://sotawatch.sota.org.uk",
    "https://pota.app"
]}})

# --- Setting ---
RIGCTLD_HOST = '127.0.0.1'
BRIDGE_PORT = 5001
RIGS_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rigs.csv')
MODEL_FTX1 = '1051'

# --- Load rig list (name -> (rigctld TCP port, model)) from rigs.csv ---
# This also acts as the allow-list for /set_rig: a rig name that is
# not in rigs.csv is rejected rather than connecting to an arbitrary
# port supplied by the request.
def load_rigs():
    rigs = {}
    try:
        with open(RIGS_CSV, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = (row.get('name') or '').strip()
                port_str = (row.get('rigctld_port') or '').strip()
                model = (row.get('model') or '').strip()
                if not name or not port_str:
                    continue
                try:
                    rigs[name] = (int(port_str), model)
                except ValueError:
                    print(f"rigs.csv: invalid rigctld_port for '{name}': {port_str!r} (skipped)")
    except FileNotFoundError:
        print(f"rigs.csv not found: {RIGS_CSV}")
        print("Copy rigs.sample.csv to rigs.csv in the same folder, then edit the COM port and other values for your rig(s).")
    return rigs

RIGS = load_rigs()
if not RIGS:
    print("WARNING: No rigs loaded from rigs.csv. /set_rig will reject all requests.")
else:
    print(f"Configured rigs: {', '.join(f'{name} (port {port})' for name, (port, _) in RIGS.items())}")

# --- Send one command (extended response) and return {key: value} ---
def rig_cmd(f, cmd):
    f.write(f"+{cmd}\n")
    f.flush()
    values = {}
    while True:
        line = f.readline()
        if not line:
            raise RuntimeError(f"'{cmd}': connection closed by rigctld")
        line = line.strip()
        if line.startswith('RPRT'):
            if line != 'RPRT 0':
                raise RuntimeError(f"'{cmd}': {line}")
            return values
        if ':' in line:
            key, val = line.split(':', 1)
            values[key.strip()] = val.strip()

# --- FTX-1: operating side ('MAIN' or 'SUB') ---
def ftx1_side(f):
    return 'SUB' if rig_cmd(f, 'v').get('VFO', '').upper() in ('SUB', 'VFOB') else 'MAIN'

# --- FTX-1: put the operating side back to VFO. Returns True if switched ---
def ftx1_ensure_vfo(f, side):
    vfo = 'VM100;' if side == 'SUB' else 'VM000;'
    if rig_cmd(f, f"\\send_raw ; {vfo[:3]};").get('Send raw answer') == vfo:
        return False
    reply = rig_cmd(f, f"\\send_raw ; {vfo}{vfo[:3]};").get('Send raw answer')
    if reply != vfo:
        raise RuntimeError(f"cannot switch {side} to VFO (reply: {reply})")
    return True

# --- FTX-1: turn the narrow filter off. Returns True if it was on ---
def ftx1_narrow_off(f, side):
    p1 = '1' if side == 'SUB' else '0'
    wide = f"NA{p1}0;"
    if rig_cmd(f, f"\\send_raw ; NA{p1};").get('Send raw answer') == wide:
        return False
    reply = rig_cmd(f, f"\\send_raw ; {wide}NA{p1};").get('Send raw answer')
    if reply != wide:
        raise RuntimeError(f"cannot turn {side} narrow off (reply: {reply})")
    return True

# --- List configured rigs (for the extension popup) ---
@app.route('/rigs', methods=['GET'])
def get_rigs():
    return jsonify({"rigs": [{"name": name} for name in RIGS.keys()]}), 200

# --- Endpoint that relays frequency and mode from browser extension to rigctld commands ---
@app.route('/set_rig', methods=['POST'])
def set_rig():
    data = request.json
    if not data:
        return jsonify({"success": False, "message": "No data received"}), 400 # Bad Request

    rig_name = data.get('rig')
    if not rig_name:
        return jsonify({"success": False, "message": "No rig specified. Select a rig in the extension popup."}), 400 # Bad Request

    if rig_name not in RIGS:
        return jsonify({"success": False, "message": f"Unknown rig: {rig_name}"}), 400 # Bad Request
    rigctld_port, model = RIGS[rig_name]

    freq_mhz_str = data.get('freq')
    mode_raw = data.get('mode', '').upper()

    try:
        freq_mhz = float(freq_mhz_str)
        freq_hz = round(freq_mhz * 1_000_000)
    except (ValueError, TypeError):
        return jsonify({"success": False, "message": "Invalid frequency format"}), 422 # Unprocessable Entity

    # --- mode ---
    passband = -1   # -1: leave the width as is (see the note at the top)
    if mode_raw in ("DATA", "FT2", "FT4", "FT8", "Q65"):
        # SOTA's "DATA" and POTA's "FT4"/"FT8" all map to the rig's
        # DIG mode (rigctld mode name PKTUSB)
        ham_mode = "PKTUSB"
    elif mode_raw == "CW":
        ham_mode = "CW"
    elif mode_raw == "AM":
        ham_mode = "AM"
    elif mode_raw == "FM":
        ham_mode = "FM"
    elif mode_raw == "SSB":
        # LSB for below 10MHz, USB otherwise
        if freq_mhz < 10.0:
            ham_mode = "LSB"
        else:
            ham_mode = "USB"
    else:
        # Default to USB for unknown modes
        ham_mode = "USB"

    # --- send commands over one connection (mode first, then frequency) ---
    side = None
    switched = narrowed = False
    try:
        with socket.create_connection((RIGCTLD_HOST, rigctld_port), timeout=6) as s:
            f = s.makefile('rw', encoding='ascii', newline='\n')
            if model == MODEL_FTX1:
                side = ftx1_side(f)
                switched = ftx1_ensure_vfo(f, side)
            rig_cmd(f, f"M {ham_mode} {passband}")
            rig_cmd(f, f"F {freq_hz}")
            if model == MODEL_FTX1 and ham_mode == "PKTUSB":
                narrowed = ftx1_narrow_off(f, side)
    except (OSError, RuntimeError) as e:
        return jsonify({"success": False, "message": f"[{rig_name}] rigctld error: {e}"}), 503 # Service Unavailable

    notes = (["MEM->VFO"] if switched else []) + (["NAR->WIDE"] if narrowed else [])
    note = f"{side}: {', '.join(notes)}, " if notes else ""
    return jsonify({"success": True, "message": f"[{rig_name}] {note}Rig set: {freq_mhz}MHz / {ham_mode}"}), 200

if __name__ == '__main__':
    print("RIG Bridge starting...")
    app.run(host='127.0.0.1', port=BRIDGE_PORT)
