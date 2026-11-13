#!/usr/bin/env python3
"""Bench harness (Linux proxy only): load src/index.html in a bare WebKitGTK 4.1 view (same engine as the Tauri
Linux build), run an optional JS snippet, so CPU can be bisected without rebuilding. Usage: mini.py [js]"""
import sys, gi
gi.require_version('WebKit2', '4.1'); gi.require_version('Gtk', '3.0')
from gi.repository import WebKit2, Gtk, GLib
js = sys.argv[1] if len(sys.argv) > 1 else ''
w = Gtk.Window(title='MINI'); w.set_default_size(1440, 900)
v = WebKit2.WebView(); s = v.get_settings(); s.set_allow_file_access_from_file_urls(True); s.set_allow_universal_access_from_file_urls(True)
import os
if os.environ.get('HWACC'): s.set_hardware_acceleration_policy(getattr(WebKit2.HardwareAccelerationPolicy, os.environ['HWACC']))
print('hw policy', s.get_hardware_acceleration_policy(), flush=True)
w.add(v); w.connect('destroy', Gtk.main_quit); w.show_all()
def done(view, ev):
    if ev == WebKit2.LoadEvent.FINISHED and js:
        GLib.timeout_add(1500, lambda: (v.run_javascript(js, None, None, None), False)[1])
v.connect('load-changed', done)
v.load_uri('file:///workspace/solfall-launcher/src/index.html')
Gtk.main()
